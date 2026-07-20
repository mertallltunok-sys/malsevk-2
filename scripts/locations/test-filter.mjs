// npm run locations:test-filter
//
// app/_lib/turkey-locations.ts, Next.js'in bundler'ına (bare JSON import)
// bağımlı olduğu için düz `node` ile doğrudan import edilemiyor. Bu script
// o dosyadaki filtreleme mantığını (provinceId+districtId+type eşleşmesi,
// active===true şartı) BİREBİR yansıtır ve gerçek data/locations/locations.json
// dosyasına karşı çalıştırır.
//
// turkey-locations.ts'teki getFacilitiesByProvinceDistrictAndType değişirse,
// bu dosya da senkron güncellenmelidir.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const locationsData = JSON.parse(
  await readFile(new URL("../../data/locations/locations.json", import.meta.url)),
);

const FACILITY_TYPES = new Set(["LIMAN", "OSB", "SERBEST_BOLGE", "DEPO", "FABRIKA", "ACIK_SAHA", "DIGER"]);

const facilities = locationsData
  .filter((record) => record.active && record.districtId !== null && FACILITY_TYPES.has(record.type))
  .map((record) => ({
    id: record.id,
    name: record.name,
    type: record.type,
    provinceId: record.provinceId,
    districtId: record.districtId,
    aliases: record.aliases ?? [],
  }));

function getFacilitiesByProvinceDistrictAndType(provinceId, districtId, type) {
  return facilities.filter(
    (facility) =>
      facility.provinceId === provinceId && facility.districtId === districtId && facility.type === type,
  );
}

const TURKISH_FOLD_MAP = { ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u" };
function foldTurkish(value) {
  return value.split("").map((c) => TURKISH_FOLD_MAP[c] ?? c).join("").toLocaleLowerCase("tr-TR");
}

function foldTurkishSlug(value) {
  return foldTurkish(value.trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function searchMatches(facility, query) {
  const folded = foldTurkish(query);
  if (foldTurkish(facility.name).includes(folded)) return true;
  return facility.aliases.some((alias) => foldTurkish(alias).includes(folded));
}

const KOCAELI = "kocaeli";
let passed = 0;

function check(description, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${description}`);
}

console.log("[locations:test-filter] Kocaeli il/ilçe/yer-türü filtreleme testleri\n");

// --- Zorunlu 4 zincir testi ---

check("Kocaeli -> Dilovası -> Liman: yalnızca Dilovası'na bağlı limanlar (Beldeport, Yılport Gebze, Poliport dahil)", () => {
  const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, "dilovasi", "LIMAN");
  const names = results.map((f) => f.name);
  assert.ok(names.includes("Beldeport"), "Beldeport, Dilovası->Liman listesinde yok");
  assert.ok(names.includes("Yılport Gebze"), "Yılport Gebze, Dilovası->Liman listesinde yok");
  assert.ok(names.includes("Poliport"), "Poliport, Dilovası->Liman listesinde yok");
  assert.ok(
    results.every((f) => f.districtId === "dilovasi" && f.type === "LIMAN"),
    "Sonuçlarda districtId veya type uyuşmayan bir kayıt var",
  );
});

check("Kocaeli -> Dilovası -> OSB: yalnızca Dilovası'na bağlı OSB'ler", () => {
  const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, "dilovasi", "OSB");
  const names = results.map((f) => f.name);
  assert.ok(names.includes("Global OSB Yönetim"), "Global OSB Yönetim, Dilovası->OSB listesinde yok");
  assert.ok(
    names.includes("Kocaeli Gebze V Kimya İhtisas Organize Sanayi Bölgesi"),
    "Gebze V Kimya İhtisas OSB, Dilovası->OSB listesinde yok",
  );
  assert.ok(
    results.every((f) => f.districtId === "dilovasi" && f.type === "OSB"),
    "Sonuçlarda districtId veya type uyuşmayan bir kayıt var",
  );
  assert.ok(!names.includes("Gebze Organize Sanayi Bölgesi (GOSB)"), "Gebze'ye ait bir OSB yanlışlıkla Dilovası listesinde");
});

check("Kocaeli -> Körfez -> Liman: yalnızca Körfez'e bağlı limanlar", () => {
  const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, "korfez", "LIMAN");
  const names = results.map((f) => f.name);
  assert.ok(names.includes("DP World Evyapport"), "DP World Evyapport, Körfez->Liman listesinde yok");
  assert.ok(names.includes("Marmara Tersanesi A.Ş."), "Marmara Tersanesi (tersane->Liman eşlemesi), Körfez'de yok");
  assert.ok(
    results.every((f) => f.districtId === "korfez" && f.type === "LIMAN"),
    "Sonuçlarda districtId veya type uyuşmayan bir kayıt var",
  );
  assert.ok(!names.includes("Beldeport") && !names.includes("Yılport Gebze"), "Dilovası'na ait bir liman Körfez listesine sızdı");
});

check("Kocaeli -> Gebze -> OSB: yalnızca Gebze'ye bağlı OSB'ler", () => {
  const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, "gebze", "OSB");
  const names = results.map((f) => f.name);
  assert.ok(names.includes("Gebze Organize Sanayi Bölgesi (GOSB)"), "GOSB, Gebze->OSB listesinde yok");
  assert.ok(names.includes("Gebze Güzeller Organize Sanayi Bölgesi"), "Güzeller OSB, Gebze->OSB listesinde yok");
  assert.ok(
    results.every((f) => f.districtId === "gebze" && f.type === "OSB"),
    "Sonuçlarda districtId veya type uyuşmayan bir kayıt var",
  );
  assert.ok(
    !names.includes("Global OSB Yönetim") &&
      !names.includes("Kocaeli Gebze V Kimya İhtisas Organize Sanayi Bölgesi"),
    "Dilovası'na ait bir OSB yanlışlıkla Gebze listesine sızdı",
  );
});

// --- Temel kural: tesis yalnızca doğru il+ilçe+tür eşleştiğinde görünür ---

check("Bir tesis yanlış ilçede asla görünmez (tüm Kocaeli ilçeleri çapraz kontrol)", () => {
  const districts = [
    "basiskele", "cayirova", "darica", "derince", "dilovasi", "gebze",
    "golcuk", "izmit", "kandira", "karamursel", "kartepe", "korfez",
  ];
  for (const facility of facilities.filter((f) => f.provinceId === KOCAELI)) {
    for (const districtId of districts) {
      if (districtId === facility.districtId) continue;
      const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, districtId, facility.type);
      assert.ok(
        !results.some((f) => f.id === facility.id),
        `"${facility.name}" (${facility.districtId}) yanlışlıkla "${districtId}" filtresinde çıktı`,
      );
    }
  }
});

check("Yalnızca isim eşleşmesiyle filtreleme yapılmıyor (aynı isimde farklı ilçe testi)", () => {
  // Dilovası'ndaki bir limanı Körfez ilçe ID'siyle ararsak (isim aynı kalsa
  // bile) sonuç dönmemeli — filtre yalnızca provinceId+districtId+type'a bakar.
  const dilovasiLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "dilovasi", "LIMAN");
  const korfezLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "korfez", "LIMAN");
  const overlap = dilovasiLiman.filter((f) => korfezLiman.some((k) => k.id === f.id));
  assert.equal(overlap.length, 0, "Aynı tesis hem Dilovası hem Körfez sonuçlarında çıktı");
});

check("active !== true olan kayıtlar hiçbir filtrede çıkmaz", () => {
  const inactiveIds = new Set(
    locationsData.filter((r) => r.provinceId === KOCAELI && !r.active).map((r) => r.id),
  );
  for (const facility of facilities) {
    assert.ok(!inactiveIds.has(facility.id), `Pasif bir kayıt (${facility.id}) aktif listede çıktı`);
  }
});

check("districtId === null olan kayıtlar hiçbir ilçe filtresinde çıkmaz", () => {
  const nullDistrictIds = new Set(
    locationsData.filter((r) => r.provinceId === KOCAELI && r.districtId === null).map((r) => r.id),
  );
  assert.ok(nullDistrictIds.size > 0, "Test kurulumu hatalı: districtId=null hiç kayıt yok");
  for (const facility of facilities) {
    assert.ok(!nullDistrictIds.has(facility.id));
  }
});

// --- Türkçe arama (alias) testi ---

check("Türkçe arama: 'Yılport' / 'Yilport' / 'YILPORT' hepsi aynı kaydı bulur (TEST 4)", () => {
  const target = facilities.find((f) => f.name === "Yılport Gebze");
  assert.ok(target, "Yılport Gebze aktif listede bulunamadı");
  for (const query of ["Yılport", "Yilport", "YILPORT", "yılport", "yilport"]) {
    assert.ok(searchMatches(target, query), `"${query}" araması Yılport Gebze'yi bulamadı`);
  }
});

check("Türkçe ilçe adı normalize: 'Dilovası'/'Dilovasi'/'DİLOVASI'/'dilovası' aynı districtId'yi üretir", () => {
  const districtIdVariants = ["Dilovası", "Dilovasi", "DİLOVASI", "dilovası", "  Dilovası  "].map(foldTurkishSlug);
  for (const variant of districtIdVariants) assert.equal(variant, "dilovasi");

  const a = getFacilitiesByProvinceDistrictAndType(KOCAELI, foldTurkishSlug("İzmit"), "OSB");
  const b = getFacilitiesByProvinceDistrictAndType(KOCAELI, foldTurkishSlug("Izmit"), "OSB");
  const c = getFacilitiesByProvinceDistrictAndType(KOCAELI, foldTurkishSlug("izmit"), "OSB");
  assert.deepEqual(a.map((f) => f.id).sort(), b.map((f) => f.id).sort());
  assert.deepEqual(a.map((f) => f.id).sort(), c.map((f) => f.id).sort());
});

console.log(`\n[locations:test-filter] ${passed}/${passed} test geçti.`);
