// npm run locations:import:kocaeli
//
// Overpass API'den (ücretsiz, açık OSM verisi) Kocaeli iline ait ilçe
// sınırlarını ve liman/OSB/serbest bölge/lojistik merkezi/tersane adaylarını
// çeker; ham adayları data/locations/raw/kocaeli.json'a kaydeder.
//
// Bu script hiçbir kaydı doğrudan VERIFIED yapmaz — yalnızca aday toplar.
// Doğrulama (poligon kontrolü, mükerrer birleştirme, güven skoru) ayrı
// olarak `npm run locations:verify` ile yapılır.

import { isLikelyRelevantCandidate, classifyFacilityType } from "./lib/classify.mjs";
import { stitchSegmentsIntoRings } from "./lib/geo.mjs";
import { runOverpassQuery } from "./lib/overpass.mjs";
import { writeJsonFile } from "./lib/store.mjs";

const PROVINCE_NAME = "Kocaeli";
const PROVINCE_CODE = "41";

const BOUNDARIES_PATH = "data/boundaries/kocaeli-districts.geojson";
const RAW_CANDIDATES_PATH = "data/locations/raw/kocaeli.json";

async function fetchDistrictBoundaries() {
  const query = `
    [out:json][timeout:180];
    area["name"="${PROVINCE_NAME}"]["admin_level"="4"]["boundary"="administrative"]->.province;
    relation["admin_level"="6"]["boundary"="administrative"](area.province);
    out geom;
  `;
  const result = await runOverpassQuery(query);

  const features = result.elements
    .filter((element) => element.type === "relation" && element.tags?.name)
    .map((relation) => {
      const outerSegments = (relation.members ?? [])
        .filter((member) => member.role === "outer" && Array.isArray(member.geometry))
        .map((member) => member.geometry.map((point) => ({ lat: point.lat, lon: point.lon })));

      const rings = stitchSegmentsIntoRings(outerSegments);

      return {
        type: "Feature",
        properties: {
          district: relation.tags.name,
          osm_type: "relation",
          osm_id: relation.id,
        },
        geometry: {
          type: "MultiPolygon",
          rings: rings.map((ring) => ring.map((point) => [point.lon, point.lat])),
        },
      };
    })
    .filter((feature) => feature.geometry.rings.length > 0);

  await writeJsonFile(BOUNDARIES_PATH, {
    type: "FeatureCollection",
    province: PROVINCE_NAME,
    provinceCode: PROVINCE_CODE,
    generatedAt: new Date().toISOString(),
    features,
  });

  return features;
}

async function fetchFacilityCandidates() {
  const query = `
    [out:json][timeout:180];
    area["name"="${PROVINCE_NAME}"]["admin_level"="4"]["boundary"="administrative"]->.province;
    (
      nwr["name"~"liman|port|terminal|OSB|organize sanayi|serbest b.lge|lojistik|tersane|konteyner",i](area.province);
      nwr["landuse"="port"](area.province);
      nwr["craft"="shipyard"](area.province);
      nwr["industrial"="port"](area.province);
      nwr["seamark:type"="harbour"](area.province);
      nwr["man_made"~"^(pier|wharf|breakwater)$"](area.province);
    );
    out center tags;
  `;
  const result = await runOverpassQuery(query);

  const candidates = [];
  for (const element of result.elements) {
    const name = element.tags?.name;
    if (!name) continue;
    if (!isLikelyRelevantCandidate(name, element.tags)) continue;

    const coordinate =
      element.type === "node"
        ? { lat: element.lat, lon: element.lon }
        : element.center
          ? { lat: element.center.lat, lon: element.center.lon }
          : null;
    if (!coordinate) continue;

    candidates.push({
      osm_type: element.type,
      osm_id: element.id,
      name,
      alt_names: [element.tags["alt_name"], element.tags["old_name"], element.tags["operator"]].filter(
        Boolean,
      ),
      facility_type: classifyFacilityType(name, element.tags),
      lat: coordinate.lat,
      lon: coordinate.lon,
      address: {
        street: element.tags["addr:street"] ?? null,
        province: element.tags["addr:province"] ?? element.tags["addr:city"] ?? null,
        district: element.tags["addr:district"] ?? null,
        full: element.tags["addr:full"] ?? null,
      },
      website: element.tags["website"] ?? element.tags["contact:website"] ?? null,
      phone: element.tags["phone"] ?? element.tags["contact:phone"] ?? null,
      operator: element.tags["operator"] ?? null,
      business_status: element.tags["disused"]
        ? "CLOSED_TEMPORARILY"
        : element.tags["was:landuse"] || element.tags["abandoned"]
          ? "CLOSED_PERMANENTLY"
          : "OPERATIONAL",
      raw_tags: element.tags,
      checked_at: new Date().toISOString(),
    });
  }

  await writeJsonFile(RAW_CANDIDATES_PATH, {
    province: PROVINCE_NAME,
    provinceCode: PROVINCE_CODE,
    source: "overpass",
    generatedAt: new Date().toISOString(),
    totalRawElements: result.elements.length,
    totalFilteredCandidates: candidates.length,
    candidates,
  });

  return candidates;
}

async function main() {
  console.log(`[locations:import:kocaeli] ${PROVINCE_NAME} ilçe sınırları çekiliyor...`);
  const boundaries = await fetchDistrictBoundaries();
  console.log(`[locations:import:kocaeli] ${boundaries.length} ilçe sınırı kaydedildi -> ${BOUNDARIES_PATH}`);

  // Overpass'ı art arda hızlıca çağırmamak için kısa bir bekleme.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`[locations:import:kocaeli] ${PROVINCE_NAME} tesis adayları çekiliyor...`);
  const candidates = await fetchFacilityCandidates();
  console.log(
    `[locations:import:kocaeli] ${candidates.length} alakalı aday bulundu -> ${RAW_CANDIDATES_PATH}`,
  );
}

main().catch((error) => {
  console.error("[locations:import:kocaeli] HATA:", error.message);
  process.exitCode = 1;
});
