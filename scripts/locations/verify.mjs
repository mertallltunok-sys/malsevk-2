// npm run locations:verify
//
// data/locations/raw/{il}.json içindeki ham adayları işler: ilçe poligon
// doğrulaması, mükerrer birleştirme, güven skoru ve aktiflik ataması yapar.
// Sonucu TEK merkezi dosyaya (data/locations/locations.json) YAZAR — API
// kotasını korumak için her çalıştırmada dış servise tekrar istek atmaz,
// yalnızca zaten indirilmiş ham veriyi işler.
//
// Idempotenttir: aynı OSM kaydı ikinci kez işlense bile aynı location id
// güncellenir, yeni kayıt oluşturulmaz.
//
// ÇIKTI ŞEMASI (tek kaynak, ID tabanlı — bkz. CLAUDE.md):
//   id, name, type (7 sabit kategoriden biri), provinceId, districtId,
//   aliases[] (gömülü, ayrı bir dosya yok), active. Geri kalan alanlar
//   (confidenceScore, verificationStatus, coğrafi koordinatlar, kaynak
//   bilgisi...) yalnızca denetim/hata ayıklama içindir; uygulama bunları
//   okumaz.

import { readdir } from "node:fs/promises";
import { PIPELINE_TYPE_TO_FACILITY_TYPE, slugifyTurkish } from "./lib/canonical.mjs";
import { groupDuplicateCandidates } from "./lib/dedup.mjs";
import { distanceToAnyRingMeters, pointInAnyRing } from "./lib/geo.mjs";
import { normalizeDistrict, normalizeName } from "./lib/normalize.mjs";
import { computeConfidenceScore, statusForScore } from "./lib/score.mjs";
import { readJsonFile, writeJsonFile } from "./lib/store.mjs";

const RAW_DIR = "data/locations/raw";
const BOUNDARIES_DIR = "data/boundaries";
const LOCATIONS_PATH = "data/locations/locations.json";
// Otomatik OSM/Overpass adaylarının ÜZERİNE gelen, elle araştırılıp resmi
// kaynaklarla (kamu kurumu / işletmenin kendi sitesi) doğrulanmış katman.
// İki şey yapabilir: (1) "promote" — OSM'den gelen ama otomatik skoru
// eşiğin altında kalan gerçek bir tesisi elle doğrulanmış olarak işaretler;
// (2) "add" — OSM'de hiç bulunamayan gerçek bir tesisi doğrudan ekler.
// (3) "reject" — bilinen bir hayalet/mükerrer OSM kaydını kalıcı olarak
// pasifleştirir (silmez; idempotentlik ve denetim izi için kaydı tutar).
// Form her zaman yalnızca bu katmanla birleştirilmiş NİHAİ locations.json
// dosyasını okur; iki ayrı kaynak asla ayrı ayrı okunmaz.
const MANUAL_OVERRIDES_PATH = "data/locations/location_manual_overrides.json";

// Kıyı/rıhtım tesislerinin OSM koordinatı, idari sınır poligonunun (kara
// çizgisini takip eder) hemen dışına, denize doğru düşebilir. Nokta hiçbir
// poligonun içinde değilse ama tek bir ilçeye belirgin farkla en yakınsa
// (iki ilçe sınırının kesişimine yakın değilse), o ilçeye ata.
const NEAR_DISTRICT_FALLBACK_METERS = 1200;
const NEAR_DISTRICT_AMBIGUITY_MARGIN_METERS = 300;

function slugify(name, district) {
  const base = normalizeName(name).replace(/\s+/g, "-");
  const districtPart = normalizeDistrict(district).replace(/\s+/g, "-");
  return `${base}-${districtPart}`.replace(/-+/g, "-");
}

function districtMatchesForPoint(point, boundaryFeatures) {
  const featuresWithRings = boundaryFeatures.map((feature) => ({
    district: feature.properties.district,
    rings: feature.geometry.rings.map((ring) => ring.map(([lon, lat]) => ({ lat, lon }))),
  }));

  const containing = featuresWithRings.filter((feature) => pointInAnyRing(point, feature.rings));
  if (containing.length > 0) {
    return { matches: containing.map((feature) => feature.district), viaFallback: false };
  }

  const byDistance = featuresWithRings
    .map((feature) => ({
      district: feature.district,
      distance: distanceToAnyRingMeters(point, feature.rings),
    }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = byDistance[0];
  const secondNearest = byDistance[1];
  const isUnambiguouslyNear =
    nearest &&
    nearest.distance <= NEAR_DISTRICT_FALLBACK_METERS &&
    (!secondNearest || secondNearest.distance - nearest.distance >= NEAR_DISTRICT_AMBIGUITY_MARGIN_METERS);

  if (isUnambiguouslyNear) {
    return { matches: [nearest.district], viaFallback: true };
  }

  return { matches: [], viaFallback: false };
}

/**
 * Elle doğrulanmış katmanı (data/locations/location_manual_overrides.json)
 * bu ilin otomatik pipeline çıktısının ÜZERİNE uygular. Idempotenttir: aynı
 * override tekrar uygulansa da aynı sonucu üretir.
 */
function applyManualOverrides({ nextLocations, manualOverrides, provinceId, now }) {
  let applied = 0;
  for (const override of manualOverrides) {
    if (override.provinceId !== provinceId) continue;

    if (override.action === "promote") {
      const target = nextLocations.find((location) => location.id === override.matchId);
      if (!target) {
        console.warn(
          `[locations:verify] manuel override '${override.matchId}' eşleşmedi (kayıt bulunamadı), atlanıyor.`,
        );
        continue;
      }
      if (override.name) target.name = override.name;
      if (override.districtId) target.districtId = override.districtId;
      if (override.district) target.district = override.district;
      if (override.officialWebsite) target.officialWebsite = override.officialWebsite;
      if (override.phone) target.phone = override.phone;
      if (override.fullAddress) target.fullAddress = override.fullAddress;
      target.active = override.active ?? true;
      target.verificationStatus = "VERIFIED";
      if (typeof override.confidenceScore === "number") target.confidenceScore = override.confidenceScore;
      target.sourcePriority = override.sourcePriority ?? "B";
      target.updatedAt = now;
      target.aliases = Array.from(new Set([...(target.aliases ?? []), ...(override.aliases ?? [])]));
      target.scoreReasons = [...(target.scoreReasons ?? []), `(manuel doğrulama: ${override.manualSource})`];
      applied++;
      continue;
    }

    if (override.action === "reject") {
      const target = nextLocations.find((location) => location.id === override.matchId);
      if (!target) continue;
      target.active = false;
      target.verificationStatus = "REJECTED";
      target.updatedAt = now;
      target.scoreReasons = [...(target.scoreReasons ?? []), `(manuel reddedildi: ${override.manualSource})`];
      applied++;
      continue;
    }

    if (override.action === "add") {
      if (nextLocations.some((location) => location.id === override.id)) continue;

      nextLocations.push({
        id: override.id,
        name: override.name,
        type: override.type,
        subtype: override.type,
        provinceId: override.provinceId,
        districtId: override.districtId,
        district: override.district ?? null,
        aliases: override.aliases ?? [],
        active: true,
        verificationStatus: "VERIFIED",
        confidenceScore: override.confidenceScore ?? 100,
        sourcePriority: override.sourcePriority ?? "B",
        latitude: override.latitude ?? null,
        longitude: override.longitude ?? null,
        officialWebsite: override.officialWebsite ?? null,
        phone: override.phone ?? null,
        fullAddress: override.fullAddress ?? null,
        externalId: null,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
        scoreReasons: [`(manuel eklendi: ${override.manualSource})`],
      });
      applied++;
    }
  }
  return applied;
}

function pickCanonical(group) {
  return group
    .slice()
    .sort((a, b) => {
      const completeness = (item) =>
        (item.candidate.website ? 1 : 0) + (item.candidate.phone ? 1 : 0);
      return completeness(b) - completeness(a);
    })[0];
}

async function processProvince(provinceRawFile) {
  const raw = await readJsonFile(`${RAW_DIR}/${provinceRawFile}`, null);
  if (!raw) return null;

  const provinceId = slugifyTurkish(raw.province);

  const boundaryFile = provinceRawFile.replace(".json", "-districts.geojson");
  const boundaries = await readJsonFile(`${BOUNDARIES_DIR}/${boundaryFile}`, null);
  if (!boundaries) {
    console.warn(`[locations:verify] ${provinceRawFile} için sınır dosyası bulunamadı, atlanıyor.`);
    return null;
  }

  const existingLocations = (await readJsonFile(LOCATIONS_PATH, [])) ?? [];
  const sourceByExternalId = new Map(
    existingLocations
      .filter((l) => l.provinceId === provinceId && l.externalId)
      .map((l) => [l.externalId, l]),
  );

  const candidatesWithDistricts = raw.candidates.map((candidate) => {
    const { matches, viaFallback } = districtMatchesForPoint(
      { lat: candidate.lat, lon: candidate.lon },
      boundaries.features,
    );
    return { candidate, matches, viaFallback };
  });

  const groups = groupDuplicateCandidates(candidatesWithDistricts.map((c) => c.candidate));

  const now = new Date().toISOString();
  const nextLocations = [];

  let verifiedCount = 0;
  let reviewCount = 0;
  let rejectedDuplicateCount = 0;
  let districtConflictCount = 0;

  for (const group of groups) {
    const canonicalEntry = pickCanonical(group);
    const canonicalMeta = candidatesWithDistricts.find(
      (c) => c.candidate === canonicalEntry.candidate,
    );
    const districtMatches = canonicalMeta.matches;

    const distinctGroupDistricts = new Set(
      group
        .map((item) => candidatesWithDistricts.find((c) => c.candidate === item.candidate).matches)
        .flat(),
    );
    const hasInternalDistrictConflict = distinctGroupDistricts.size > 1;
    if (hasInternalDistrictConflict) districtConflictCount++;

    const { score, reasons } = computeConfidenceScore(canonicalEntry.candidate, {
      districtMatchCount: hasInternalDistrictConflict ? 2 : districtMatches.length,
    });
    if (!hasInternalDistrictConflict && canonicalMeta.viaFallback && districtMatches.length === 1) {
      reasons.push(
        `(ilçe sınır poligonu dışında ama <${NEAR_DISTRICT_FALLBACK_METERS}m ile tek anlamlı ilçeye yakın: ${districtMatches[0]})`,
      );
    }

    const status = statusForScore(score, { isDuplicate: false });
    if (status === "VERIFIED") verifiedCount++;
    else reviewCount++;

    const externalId = `${canonicalEntry.candidate.osm_type}:${canonicalEntry.candidate.osm_id}`;
    const existingLocation = sourceByExternalId.get(externalId);

    const district = districtMatches[0] ?? canonicalEntry.candidate.address.district ?? null;
    const districtIdValue = district ? slugifyTurkish(district) : null;
    const locationId =
      existingLocation?.id ??
      `loc-${slugify(canonicalEntry.candidate.name, district ?? "bilinmeyen")}-${canonicalEntry.candidate.osm_id}`;

    const aliasNames = new Set();
    for (const member of group) {
      if (member.candidate.name !== canonicalEntry.candidate.name) aliasNames.add(member.candidate.name);
      for (const alt of member.candidate.alt_names ?? []) aliasNames.add(alt);
    }

    nextLocations.push({
      id: locationId,
      name: canonicalEntry.candidate.name,
      type: PIPELINE_TYPE_TO_FACILITY_TYPE[canonicalEntry.candidate.facility_type] ?? "DIGER",
      subtype: canonicalEntry.candidate.facility_type,
      provinceId,
      districtId: districtIdValue,
      district,
      aliases: [...aliasNames],
      active: status === "VERIFIED" && canonicalEntry.candidate.business_status === "OPERATIONAL",
      verificationStatus: hasInternalDistrictConflict ? "REVIEW" : status,
      confidenceScore: score,
      sourcePriority: "D",
      latitude: canonicalEntry.candidate.lat,
      longitude: canonicalEntry.candidate.lon,
      officialWebsite: canonicalEntry.candidate.website,
      phone: canonicalEntry.candidate.phone,
      fullAddress: canonicalEntry.candidate.address.full,
      externalId,
      lastVerifiedAt: now,
      createdAt: existingLocation?.createdAt ?? now,
      updatedAt: now,
      districtConflict: hasInternalDistrictConflict ? [...distinctGroupDistricts] : undefined,
      scoreReasons: reasons,
    });

    if (group.length > 1) rejectedDuplicateCount += group.length - 1;
  }

  const manualOverrides = (await readJsonFile(MANUAL_OVERRIDES_PATH, [])) ?? [];
  const manualOverrideCount = applyManualOverrides({ nextLocations, manualOverrides, provinceId, now });
  verifiedCount = nextLocations.filter((l) => l.verificationStatus === "VERIFIED").length;
  reviewCount = nextLocations.filter((l) => l.verificationStatus === "REVIEW").length;

  // Bu ile ait eski kayıtları (artık gruplarda temsil edilmeyenler dahil) at,
  // bu çalıştırmanın ürettikleriyle değiştir; diğer illerin kayıtlarına dokunma.
  const otherProvinceLocations = existingLocations.filter((l) => l.provinceId !== provinceId);
  const mergedLocations = [...otherProvinceLocations, ...nextLocations];

  await writeJsonFile(LOCATIONS_PATH, mergedLocations);

  return {
    province: raw.province,
    totalCandidates: raw.candidates.length,
    totalGroups: groups.length,
    verifiedCount,
    reviewCount,
    rejectedDuplicateCount,
    districtConflictCount,
    manualOverrideCount,
  };
}

async function main() {
  const files = (await readdir(RAW_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("[locations:verify] İşlenecek ham veri bulunamadı. Önce bir import script'i çalıştırın.");
    return;
  }

  for (const file of files) {
    console.log(`[locations:verify] ${file} işleniyor...`);
    const result = await processProvince(file);
    if (result) {
      console.log(
        `[locations:verify] ${result.province}: ${result.totalCandidates} aday -> ${result.totalGroups} benzersiz konum ` +
          `(${result.verifiedCount} VERIFIED, ${result.reviewCount} REVIEW, ${result.rejectedDuplicateCount} mükerrer birleştirildi, ` +
          `${result.districtConflictCount} ilçe çelişkisi, ${result.manualOverrideCount} manuel override uygulandı)`,
      );
    }
  }
}

main().catch((error) => {
  console.error("[locations:verify] HATA:", error.message);
  process.exitCode = 1;
});
