// npm run locations:report
//
// data/locations/locations.json'ı (TEK merkezi kaynak) okuyup özet bir
// doğrulama raporu basar. Hiçbir dış servise istek atmaz.

import { readJsonFile } from "./lib/store.mjs";

const LOCATIONS_PATH = "data/locations/locations.json";

function statusBreakdown(locations) {
  const counts = { VERIFIED: 0, REVIEW: 0, REJECTED: 0 };
  for (const location of locations) {
    const status = location.verificationStatus ?? "VERIFIED";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const locations = (await readJsonFile(LOCATIONS_PATH, [])) ?? [];

  if (locations.length === 0) {
    console.log("[locations:report] Henüz kayıt yok. Önce import + verify çalıştırın.");
    return;
  }

  const byProvince = new Map();
  for (const location of locations) {
    if (!byProvince.has(location.provinceId)) byProvince.set(location.provinceId, []);
    byProvince.get(location.provinceId).push(location);
  }

  console.log("=== MALSEVK Lokasyon Doğrulama Raporu ===");
  console.log(`Oluşturulma: ${new Date().toISOString()}`);
  console.log(`Toplam konum kaydı: ${locations.length}`);
  console.log(`Aktif (kullanıcıya gösterilen) kayıt: ${locations.filter((l) => l.active).length}`);
  console.log("");

  for (const [provinceId, provinceLocations] of byProvince) {
    const counts = statusBreakdown(provinceLocations);
    console.log(`--- ${provinceId} ---`);
    console.log(`  VERIFIED: ${counts.VERIFIED ?? 0} | REVIEW: ${counts.REVIEW ?? 0} | REJECTED: ${counts.REJECTED ?? 0}`);

    const byDistrict = new Map();
    for (const location of provinceLocations) {
      const key = location.districtId ?? "(ilçesi doğrulanamadı)";
      if (!byDistrict.has(key)) byDistrict.set(key, []);
      byDistrict.get(key).push(location);
    }
    for (const [districtId, districtLocations] of [...byDistrict.entries()].sort()) {
      console.log(`  ${districtId}: ${districtLocations.length} kayıt`);
      for (const location of districtLocations) {
        const activeFlag = location.active ? "/active" : "";
        console.log(
          `    [${location.verificationStatus ?? "VERIFIED"}${activeFlag} score=${location.confidenceScore ?? "-"}] ${location.name} (${location.type})`,
        );
      }
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error("[locations:report] HATA:", error.message);
  process.exitCode = 1;
});
