// node scripts/locations/migrate-legacy.mjs
//
// TEK SEFERLİK göç scripti: app/_data/turkey/{osb,ports,free-zones,
// logistics-centers}.json içindeki, henüz Overpass pilotundan geçmemiş
// iller için elle yazılmış eski kayıtları, data/locations/locations.json'ın
// tek merkezi şemasına (id, name, type, provinceId, districtId, aliases,
// active) dönüştürür. Veri EKLEMEZ/ÇIKARMAZ — yalnızca aynı 70 kaydı
// (bugüne kadar zaten kullanıcıya gösterilen) yeni şemaya taşır. Kocaeli
// (pipeline'dan geçmiş il) hariç tutulur; hâlihazırda orada kayıt yoktur,
// bu script yalnızca bir güvenlik kontrolü olarak hariç tutar.
//
// Çalıştırıldıktan sonra: app/_data/turkey/{osb,ports,free-zones,
// logistics-centers}.json silinir, app/_lib/turkey-locations.ts artık
// yalnızca data/locations/locations.json okur.

import { readJsonFile, writeJsonFile } from "./lib/store.mjs";
import { slugifyTurkish } from "./lib/canonical.mjs";

const LOCATIONS_PATH = "data/locations/locations.json";
const KOCAELI_PROVINCE_CODE = "41";

const LEGACY_SOURCES = [
  { file: "app/_data/turkey/osb.json", type: "OSB" },
  { file: "app/_data/turkey/ports.json", type: "LIMAN" },
  { file: "app/_data/turkey/free-zones.json", type: "SERBEST_BOLGE" },
  { file: "app/_data/turkey/logistics-centers.json", type: "DEPO" },
];

async function main() {
  const provinces = await readJsonFile("app/_data/turkey/provinces.json", []);
  const provinceNameByCode = new Map(provinces.map((p) => [p.code, p.name]));

  const existingLocations = (await readJsonFile(LOCATIONS_PATH, [])) ?? [];
  const now = new Date().toISOString();
  const migrated = [];
  let skippedKocaeli = 0;

  for (const { file, type } of LEGACY_SOURCES) {
    const entries = await readJsonFile(file, []);
    for (const entry of entries) {
      if (entry.provinceCode === KOCAELI_PROVINCE_CODE) {
        skippedKocaeli++;
        continue;
      }
      const provinceName = provinceNameByCode.get(entry.provinceCode);
      if (!provinceName) {
        console.warn(`[migrate-legacy] Bilinmeyen il kodu ${entry.provinceCode} (${entry.id}), atlanıyor.`);
        continue;
      }

      migrated.push({
        id: entry.id,
        name: entry.name,
        type,
        subtype: type,
        provinceId: slugifyTurkish(provinceName),
        districtId: entry.district ? slugifyTurkish(entry.district) : null,
        district: entry.district ?? null,
        aliases: [],
        active: true,
        verificationStatus: "VERIFIED",
        confidenceScore: null,
        sourcePriority: "D",
        latitude: null,
        longitude: null,
        officialWebsite: null,
        phone: null,
        fullAddress: null,
        externalId: null,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
        scoreReasons: ["(göç: eski elle yazılmış liste, app/_data/turkey/*.json)"],
      });
    }
  }

  const merged = [...existingLocations, ...migrated];
  await writeJsonFile(LOCATIONS_PATH, merged);

  console.log(`[migrate-legacy] ${migrated.length} eski kayıt yeni şemaya göçürüldü -> ${LOCATIONS_PATH}`);
  console.log(`[migrate-legacy] ${skippedKocaeli} Kocaeli kaydı atlandı (beklenen: 0, pipeline zaten kapsıyor)`);
}

main().catch((error) => {
  console.error("[migrate-legacy] HATA:", error.message);
  process.exitCode = 1;
});
