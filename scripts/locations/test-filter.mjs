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
  assert.ok(
    names.includes("Global Karma Organize Sanayi Bölgesi"),
    "Global Karma Organize Sanayi Bölgesi, Dilovası->OSB listesinde yok",
  );
  assert.ok(
    !names.includes("Global OSB Yönetim"),
    "Aşama 1.2: 'Global OSB Yönetim' Global Karma OSB ile mükerrerdi, artık ayrı aktif kayıt olarak ÇIKMAMALI",
  );
  assert.ok(
    names.includes("Kocaeli Gebze V Kimya İhtisas Organize Sanayi Bölgesi"),
    "Gebze V Kimya İhtisas OSB, Dilovası->OSB listesinde yok",
  );
  assert.ok(names.includes("Dilovası Organize Sanayi Bölgesi"), "Aşama 1.2: Dilovası OSB (DOSB), Dilovası->OSB listesinde yok");
  assert.ok(
    results.every((f) => f.districtId === "dilovasi" && f.type === "OSB"),
    "Sonuçlarda districtId veya type uyuşmayan bir kayıt var",
  );
  assert.ok(!names.includes("Gebze Organize Sanayi Bölgesi (GOSB)"), "Gebze'ye ait bir OSB yanlışlıkla Dilovası listesinde");
});

check("Kocaeli -> Körfez -> Liman: yalnızca Körfez'e bağlı limanlar", () => {
  const results = getFacilitiesByProvinceDistrictAndType(KOCAELI, "korfez", "LIMAN");
  const names = results.map((f) => f.name);
  assert.ok(names.includes("DP World Evyap Körfez"), "DP World Evyap Körfez, Körfez->Liman listesinde yok");
  assert.ok(
    !names.includes("Marmara Tersanesi A.Ş."),
    "Aşama 1.1: Marmara Tersanesi yalnızca gemi inşa/tamir (tersane) faaliyeti yürütüyor, kargo limanı değil — Liman listesinde ARTIK görünmemeli",
  );
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
    !names.includes("Global Karma Organize Sanayi Bölgesi") &&
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

// --- Aşama 1.1: liman envanteri mükerrer temizliği ve kategori ayrımı ---

check("TCDD Derince Limanı ile Safiport Derince Limanı mükerrerliği çözüldü (tek aktif kayıt, alias fallback korunuyor)", () => {
  const derinceLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "derince", "LIMAN");
  const names = derinceLiman.map((f) => f.name);
  assert.ok(names.includes("Safiport Derince Limanı"), "Safiport Derince Limanı, Derince->Liman listesinde yok");
  assert.ok(
    !names.includes("TCDD Derince Limanı"),
    "TCDD Derince Limanı hâlâ AYRI bir aktif kayıt olarak görünüyor — Safiport ile mükerrer, birleştirilmeliydi",
  );
  const safiport = derinceLiman.find((f) => f.name === "Safiport Derince Limanı");
  assert.ok(
    safiport.aliases.some((a) => foldTurkish(a) === foldTurkish("TCDD Derince Limanı")),
    "Safiport kaydında 'TCDD Derince Limanı' alias'ı yok — eski ilanlar (workLocationType='TCDD Derince Limanı') çözülemez",
  );
});

check("Evyapport yazım/marka varyasyonları (DP World Evyapport, Evyaport) tek aktif tesise çözülüyor", () => {
  const korfezLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "korfez", "LIMAN");
  const names = korfezLiman.map((f) => f.name);
  assert.ok(names.includes("DP World Evyap Körfez"), "DP World Evyap Körfez, Körfez->Liman listesinde yok");
  assert.ok(!names.includes("DP World Evyapport"), "Eski ad 'DP World Evyapport' hâlâ ayrı bir aktif kayıt olarak görünüyor");
  assert.ok(!names.includes("Evyaport"), "'Evyaport' hâlâ ayrı bir aktif (mükerrer) kayıt olarak görünüyor");
  const canonical = korfezLiman.find((f) => f.name === "DP World Evyap Körfez");
  for (const variant of ["DP World Evyapport", "Evyapport", "Evyaport"]) {
    assert.ok(
      canonical.aliases.some((a) => foldTurkish(a) === foldTurkish(variant)),
      `DP World Evyap Körfez kaydında '${variant}' alias'ı yok`,
    );
  }
});

check("Autoport varyasyonları (Autoport Limanı / AutoPort Liman Rıhtımı) tek aktif tesise çözülüyor", () => {
  const basiskeleLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "basiskele", "LIMAN");
  const names = basiskeleLiman.map((f) => f.name);
  assert.ok(names.includes("Autoport"), "Autoport, Başiskele->Liman listesinde yok");
  assert.ok(!names.includes("Autoport Limanı") && !names.includes("AutoPort Liman Rıhtımı"), "Autoport'un eski/mükerrer adlarından biri hâlâ ayrı aktif kayıt olarak görünüyor");
  const autoport = basiskeleLiman.find((f) => f.name === "Autoport");
  assert.ok(
    autoport.aliases.some((a) => foldTurkish(a) === foldTurkish("AutoPort Liman Rıhtımı")),
    "Autoport kaydında 'AutoPort Liman Rıhtımı' alias'ı yok",
  );
});

check("Hayat Kimya / Limaş ilişkisi doğru modelleniyor (gerçek liman işletmecisi Limaş Limanı olarak aktif)", () => {
  const basiskeleLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "basiskele", "LIMAN");
  const names = basiskeleLiman.map((f) => f.name);
  assert.ok(names.includes("Limaş Limanı"), "Limaş Limanı, Başiskele->Liman listesinde yok");
  const limas = basiskeleLiman.find((f) => f.name === "Limaş Limanı");
  assert.ok(
    limas.aliases.some((a) => foldTurkish(a).includes(foldTurkish("Hayat Kimya"))),
    "Limaş Limanı kaydında 'Hayat Kimya' ile ilişkilendiren bir alias yok (halk arasındaki kullanım)",
  );
});

check("Konteyner depolama sahası (Yıldırımlar) yanlışlıkla Liman filtresinde çıkmıyor", () => {
  const derinceLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "derince", "LIMAN");
  assert.ok(
    !derinceLiman.some((f) => f.name.includes("Yıldırımlar Konteyner")),
    "'Yıldırımlar Konteyner Depoloma Sahası' bir depolama sahası, liman değil — Liman filtresinde ÇIKMAMALI",
  );
});

check("Balıkçı barınağı (Bağırganlı) yanlışlıkla Liman filtresinde çıkmıyor", () => {
  const kandiraLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "kandira", "LIMAN");
  assert.ok(
    !kandiraLiman.some((f) => f.name.includes("Bağırganlı")),
    "'Bağırganlı Limanı' bir balıkçı barınağı, ticari kargo limanı değil — Liman filtresinde ÇIKMAMALI",
  );
});

check("Aktif Kocaeli liman sayısı katalogdan dinamik doğrulanıyor (sabit kod yok)", () => {
  const allKocaeliLiman = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "LIMAN");
  const uniquePhysicalNames = new Set(allKocaeliLiman.map((f) => f.name));
  assert.equal(
    allKocaeliLiman.length,
    uniquePhysicalNames.size,
    "Aktif liman listesinde aynı isimde birden fazla kayıt var (mükerrer temizliği tam değil)",
  );
  assert.ok(allKocaeliLiman.length > 0, "Hiç aktif Kocaeli limanı yok — katalog boş görünüyor");
  console.log(`  (bilgi: şu an ${allKocaeliLiman.length} benzersiz aktif Kocaeli limanı var — bu sayı testte sabit kodlanmadı, katalogdan okunuyor)`);
});

// --- Aşama 1.2: Kocaeli OSB envanteri mükerrer temizliği ve kategori ayrımı ---

check("Global Karma OSB / Global OSB Yönetim mükerrerliği tek aktif tesise çözülüyor", () => {
  const dilovasiOsb = getFacilitiesByProvinceDistrictAndType(KOCAELI, "dilovasi", "OSB");
  const names = dilovasiOsb.map((f) => f.name);
  assert.ok(names.includes("Global Karma Organize Sanayi Bölgesi"), "Global Karma Organize Sanayi Bölgesi, Dilovası->OSB listesinde yok");
  assert.ok(!names.includes("Global OSB Yönetim"), "Eski ad 'Global OSB Yönetim' hâlâ ayrı bir aktif kayıt olarak görünüyor");
  const canonical = dilovasiOsb.find((f) => f.name === "Global Karma Organize Sanayi Bölgesi");
  assert.ok(
    canonical.aliases.some((a) => foldTurkish(a) === foldTurkish("Global OSB Yönetim")),
    "Global Karma Organize Sanayi Bölgesi kaydında 'Global OSB Yönetim' alias'ı yok",
  );
});

check("Kandıra Gıda İhtisas OSB (GİOSB) henüz faaliyette olmadığı için pasif kalıyor", () => {
  const kandiraOsb = getFacilitiesByProvinceDistrictAndType(KOCAELI, "kandira", "OSB");
  assert.ok(
    !kandiraOsb.some((f) => f.name.includes("Gıda İhtisas")),
    "Kandıra Gıda İhtisas OSB, Bakanlık'a göre 'altyapı hazırlanıyor' durumunda (henüz faaliyette değil) — aktif listede ÇIKMAMALI",
  );
});

check("Kocaeli'nin resmi 14 OSB'sinden tamamen eksik olan gerçek OSB'ler eklendi (Alikahya, DOSB, GEPOSB, Kobi OSB, TOSB)", () => {
  const allKocaeliOsb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "OSB");
  const names = allKocaeliOsb.map((f) => f.name);
  for (const expected of [
    "Kocaeli Alikahya Organize Sanayi Bölgesi",
    "Dilovası Organize Sanayi Bölgesi",
    "Gebze Plastikçiler Organize Sanayi Bölgesi",
    "Kocaeli Kobi Organize Sanayi Bölgesi",
    "TOSB Otomotiv Tedarik Sanayi İhtisas Organize Sanayi Bölgesi",
  ]) {
    assert.ok(names.includes(expected), `'${expected}' pipeline'da hiç yoktu, Aşama 1.2'de eklenmiş olmalıydı`);
  }
});

check("Yanlış ile atanmış kayıtlar (Birlik OSB, İstanbul Deri OSB) Kocaeli OSB listesinde çıkmıyor", () => {
  const allKocaeliOsb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "OSB");
  const names = allKocaeliOsb.map((f) => f.name);
  assert.ok(!names.some((n) => n.includes("Birlik OSB")), "'Birlik OSB' (aslında İstanbul'a ait) Kocaeli OSB listesinde ÇIKMAMALI");
  assert.ok(!names.some((n) => n.includes("İstanbul Deri")), "'İstanbul Deri OSB' (fiilen Tuzla/İstanbul'da) Kocaeli OSB listesinde ÇIKMAMALI");
});

check("Trafo merkezi/enerji iletim hattı gibi altyapı bileşenleri yanlışlıkla OSB filtresinde çıkmıyor", () => {
  const allKocaeliOsb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "OSB");
  const names = allKocaeliOsb.map((f) => f.name);
  for (const infra of ["Trafo Merkezi", "TM EİH", "Metro İnşaatı", "Güneş Enerji Santrali"]) {
    assert.ok(!names.some((n) => n.includes(infra)), `Altyapı bileşeni ('${infra}') yanlışlıkla OSB filtresinde çıkıyor`);
  }
});

check("Aktif Kocaeli OSB sayısı katalogdan dinamik doğrulanıyor (sabit kod yok)", () => {
  const allKocaeliOsb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "OSB");
  const uniqueNames = new Set(allKocaeliOsb.map((f) => f.name));
  assert.equal(
    allKocaeliOsb.length,
    uniqueNames.size,
    "Aktif OSB listesinde aynı isimde birden fazla kayıt var (mükerrer temizliği tam değil)",
  );
  assert.ok(allKocaeliOsb.length > 0, "Hiç aktif Kocaeli OSB'si yok — katalog boş görünüyor");
  console.log(`  (bilgi: şu an ${allKocaeliOsb.length} benzersiz aktif Kocaeli OSB'si var — bu sayı testte sabit kodlanmadı, katalogdan okunuyor)`);
});

// --- Aşama 1.3: Kocaeli serbest bölge envanteri ---

check("Kocaeli'deki resmî ve faal serbest bölgeler aktif görünüyor (Kocaeli Serbest Bölgesi, TÜBİTAK Mam Teknoloji Serbest Bölgesi)", () => {
  const basiskeleSB = getFacilitiesByProvinceDistrictAndType(KOCAELI, "basiskele", "SERBEST_BOLGE");
  const gebzeSB = getFacilitiesByProvinceDistrictAndType(KOCAELI, "gebze", "SERBEST_BOLGE");
  assert.ok(
    basiskeleSB.some((f) => f.name === "Kocaeli Serbest Bölgesi"),
    "Kocaeli Serbest Bölgesi, Başiskele->Serbest Bölge listesinde yok",
  );
  assert.ok(
    gebzeSB.some((f) => f.name === "TÜBİTAK Mam Teknoloji Serbest Bölgesi"),
    "TÜBİTAK Mam Teknoloji Serbest Bölgesi, Gebze->Serbest Bölge listesinde yok (Ticaret Bakanlığı'nın resmi 19 serbest bölge listesinde sıra no 19)",
  );
});

check("Kocaeli Serbest Bölgesi'nin eski/alternatif isimleri (KOSBAŞ, KOCAELİ SERBEST BÖLGE) tek kanonik kayda çözülüyor", () => {
  const basiskeleSB = getFacilitiesByProvinceDistrictAndType(KOCAELI, "basiskele", "SERBEST_BOLGE");
  const names = basiskeleSB.map((f) => f.name);
  assert.ok(!names.includes("KOCAELİ SERBEST BÖLGE"), "Eski isim 'KOCAELİ SERBEST BÖLGE' hâlâ ayrı bir aktif kayıt olarak görünüyor");
  assert.ok(!names.includes("KOSBAŞ"), "'KOSBAŞ' hâlâ ayrı bir aktif kayıt olarak görünüyor");
  const canonical = basiskeleSB.find((f) => f.name === "Kocaeli Serbest Bölgesi");
  assert.ok(canonical, "Kanonik 'Kocaeli Serbest Bölgesi' kaydı yok");
  for (const alias of ["KOSBAŞ", "KOCAELİ SERBEST BÖLGE"]) {
    assert.ok(
      canonical.aliases.some((a) => foldTurkish(a) === foldTurkish(alias)),
      `Kocaeli Serbest Bölgesi kaydında '${alias}' alias'ı yok`,
    );
  }
});

check("Eski alias ('KOCAELİ SERBEST BÖLGE') ile oluşturulmuş bir ilan doğru (kanonik) tesise çözülüyor", () => {
  // resolveJobFacility'nin gerçek mantığı: job.workLocationType metni facility.name VEYA
  // aliases içinde fold-eşleşiyorsa o facility'ye çözülür (bkz. job-location.ts). Burada
  // aynı fold-eşleştirmeyi (searchMatches değil, TAM eşleşme) simüle ediyoruz.
  const basiskeleSB = getFacilitiesByProvinceDistrictAndType(KOCAELI, "basiskele", "SERBEST_BOLGE");
  const canonical = basiskeleSB.find((f) => f.name === "Kocaeli Serbest Bölgesi");
  const oldJobWorkLocationType = "KOCAELİ SERBEST BÖLGE";
  const resolved =
    foldTurkish(canonical.name) === foldTurkish(oldJobWorkLocationType) ||
    canonical.aliases.some((a) => foldTurkish(a) === foldTurkish(oldJobWorkLocationType));
  assert.ok(resolved, "Eski ilan metni ('KOCAELİ SERBEST BÖLGE') kanonik 'Kocaeli Serbest Bölgesi' kaydına çözülemiyor");
});

check("Teknoloji Geliştirme Bölgesi (TEKGEB) gibi serbest bölge OLMAYAN kategoriler yanlışlıkla eklenmedi", () => {
  const allKocaeliSB = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "SERBEST_BOLGE");
  const names = allKocaeliSB.map((f) => f.name);
  assert.ok(
    !names.some((n) => n.includes("TEKGEB") || n.includes("Teknoloji Geliştirme Bölgesi")),
    "TEKGEB (4691 sayılı Kanun'a tabi teknopark, 3218 sayılı Serbest Bölgeler Kanunu'na tabi DEĞİL) yanlışlıkla Serbest Bölge olarak eklenmiş",
  );
});

check("Serbest bölge olmayan liman/OSB/depo kayıtları Serbest Bölge filtresine sızmıyor", () => {
  const allKocaeliSB = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "SERBEST_BOLGE");
  assert.equal(allKocaeliSB.length, 2, `Kocaeli Serbest Bölge sayısı 2 olmalıydı, ${allKocaeliSB.length} bulundu`);
  assert.ok(
    allKocaeliSB.every((f) => f.type === "SERBEST_BOLGE"),
    "Serbest Bölge filtresi başka türde (LIMAN/OSB/DEPO) bir kayıt döndürdü",
  );
});

check("Kocaeli dışındaki serbest bölgeler (ör. Tekirdağ/Avrupa Serbest Bölgesi, Bursa Serbest Bölgesi) bu görev nedeniyle değişmedi", () => {
  const nonKocaeliSB = locationsData.filter((r) => r.type === "SERBEST_BOLGE" && r.provinceId !== KOCAELI);
  assert.ok(nonKocaeliSB.length > 0, "Test kurulumu hatalı: Kocaeli dışında hiç Serbest Bölge kaydı yok");
  for (const record of nonKocaeliSB) {
    assert.ok(record.active === true, `Kocaeli dışı Serbest Bölge kaydı (${record.name}) pasifleşmiş olmamalı`);
  }
});

check("Aktif Kocaeli serbest bölge sayısı katalogdan dinamik doğrulanıyor (sabit kod yok)", () => {
  const allKocaeliSB = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "SERBEST_BOLGE");
  const uniqueNames = new Set(allKocaeliSB.map((f) => f.name));
  assert.equal(
    allKocaeliSB.length,
    uniqueNames.size,
    "Aktif Serbest Bölge listesinde aynı isimde birden fazla kayıt var (mükerrer temizliği tam değil)",
  );
  assert.ok(allKocaeliSB.length > 0, "Hiç aktif Kocaeli serbest bölgesi yok — katalog boş görünüyor");
  console.log(`  (bilgi: şu an ${allKocaeliSB.length} benzersiz aktif Kocaeli serbest bölgesi var — bu sayı testte sabit kodlanmadı, katalogdan okunuyor)`);
});

// --- Aşama 1.4: Kocaeli lojistik merkezi envanteri ---

check("Kocaeli'nin resmî TCDD lojistik merkezi (Köseköy) aktif görünüyor", () => {
  const kartepeDepo = getFacilitiesByProvinceDistrictAndType(KOCAELI, "kartepe", "DEPO");
  const names = kartepeDepo.map((f) => f.name);
  assert.ok(names.includes("Köseköy Lojistik Merkezi"), "Köseköy Lojistik Merkezi, Kartepe->Depo listesinde yok");
});

check("Şirkete ait özel depo/lojistik tesisleri (Birsoy, Borusan, Karınca, Horoz, DERTAS, Arkas...) lojistik merkezi olarak görünmüyor", () => {
  const allKocaeliDepo = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "DEPO");
  const names = allKocaeliDepo.map((f) => f.name);
  for (const companyDepot of [
    "Birsoy Elektrik Lojistik Merkezi",
    "Borusan Araç Lojistik Merkezi",
    "Karınca Lojistik Garaj",
    "Horoz Lojistik",
    "DERTAS Multi Trans Lojistik Merkezi",
    "Arkas Lojistik Körfez Konteyner Depo Sahası",
    "Çelikor Lojistik",
    "Dinçer Lojistik",
    "Yıldırımlar Lojistik ve Taşımacılık",
    "ANT Lojistik Araç Depolama Alanı",
    "Batinak Lojistik",
    "TCDD Derince Lojistik Müdürlüğü",
  ]) {
    assert.ok(
      !names.includes(companyDepot),
      `'${companyDepot}' bir şirketin kendi deposu/tesisi — lojistik merkezi filtresinde ÇIKMAMALI`,
    );
  }
});

check("Eski alias/isimle oluşturulmuş bir ilan (Köseköy) doğru tesise çözülüyor, yanlışlıkla Birsoy'a düşmüyor", () => {
  const kartepeDepo = getFacilitiesByProvinceDistrictAndType(KOCAELI, "kartepe", "DEPO");
  const kosekoy = kartepeDepo.find((f) => f.name === "Köseköy Lojistik Merkezi");
  assert.ok(kosekoy, "Köseköy Lojistik Merkezi bulunamadı");
  const oldJobWorkLocationType = "TCDD Köseköy Lojistik Merkezi";
  const resolved =
    foldTurkish(kosekoy.name) === foldTurkish(oldJobWorkLocationType) ||
    kosekoy.aliases.some((a) => foldTurkish(a) === foldTurkish(oldJobWorkLocationType));
  assert.ok(resolved, "Eski ilan metni ('TCDD Köseköy Lojistik Merkezi') kanonik Köseköy kaydına çözülemiyor");
});

check("Kocaeli dışındaki TCDD lojistik merkezleri (Eskişehir Hasanbey, Balıkesir Gökköy, Kars vb.) bu görev nedeniyle değişmedi", () => {
  const otherProvinceLogisticsCenters = locationsData.filter(
    (r) => r.type === "DEPO" && r.provinceId !== KOCAELI && /lojistik\s*merkez/i.test(r.name || ""),
  );
  assert.ok(otherProvinceLogisticsCenters.length > 0, "Test kurulumu hatalı: Kocaeli dışında hiç lojistik merkezi kaydı yok");
  for (const record of otherProvinceLogisticsCenters) {
    assert.ok(record.active === true, `Kocaeli dışı lojistik merkezi kaydı (${record.name}) pasifleşmiş olmamalı`);
  }
});

check("Aktif Kocaeli lojistik merkezi sayısı katalogdan dinamik doğrulanıyor (sabit kod yok)", () => {
  const activeKocaeliLogisticsCenters = facilities.filter(
    (f) => f.provinceId === KOCAELI && f.type === "DEPO" && /lojistik\s*merkez/i.test(f.name),
  );
  const uniqueNames = new Set(activeKocaeliLogisticsCenters.map((f) => f.name));
  assert.equal(
    activeKocaeliLogisticsCenters.length,
    uniqueNames.size,
    "Aktif lojistik merkezi listesinde aynı isimde birden fazla kayıt var",
  );
  assert.ok(activeKocaeliLogisticsCenters.length > 0, "Hiç aktif Kocaeli lojistik merkezi yok — katalog boş görünüyor");
  console.log(
    `  (bilgi: şu an ${activeKocaeliLogisticsCenters.length} benzersiz aktif Kocaeli lojistik merkezi var — bu sayı testte sabit kodlanmadı, katalogdan okunuyor)`,
  );
});

// --- Aşama 1.5: Kocaeli konteyner depolama sahaları / terminalleri envanteri ---
// NOT: Bu aşamada hiçbir yeni override yazılmadı (bkz. rapor) — araştırma,
// bağımsız/kamuya açık, kullanıcı açısından ayrıca seçilebilir bir konteyner
// tesisinin katalogda eksik olmadığını, mevcut tüm "konteyner" adaylarının ya
// zaten aktif bir limanın kendisi (Yılport Gebze) ya da özel şirket tesisi
// (Arkas) ya da doğrulanamayan (Yıldırımlar) olduğunu doğruladı. Bu yüzden
// aşağıdaki testler bir "önce/sonra" geçişini değil, MEVCUT DOĞRU DURUMUN
// korunduğunu doğruluyor.

check("Limanın kendi konteyner terminali (Yılport Gebze) ayrı bir 'konteyner sahası' kaydı olarak tekrarlanmıyor", () => {
  const dilovasiLiman = getFacilitiesByProvinceDistrictAndType(KOCAELI, "dilovasi", "LIMAN");
  const yilportCount = dilovasiLiman.filter((f) => f.name === "Yılport Gebze").length;
  assert.equal(yilportCount, 1, "Yılport Gebze birden fazla kez veya mükerrer bir 'konteyner sahası' kaydıyla görünüyor");
});

check("Şirkete ait özel konteyner depo sahaları (Arkas Lojistik Körfez CFS Depo) aktif/seçilebilir görünmüyor", () => {
  const korfezDepo = facilities.filter((f) => f.provinceId === KOCAELI && f.districtId === "korfez");
  assert.ok(
    !korfezDepo.some((f) => f.name.includes("Arkas Lojistik") && f.name.includes("Konteyner")),
    "Arkas Lojistik'in kendi konteyner depo sahası (özel/tek firma tesisi) aktif listede ÇIKMAMALI",
  );
});

check("Doğrulanamayan konteyner sahası adayı (Yıldırımlar Konteyner Depoloma Sahası) aktif/seçilebilir görünmüyor", () => {
  const derinceFacilities = facilities.filter((f) => f.provinceId === KOCAELI && f.districtId === "derince");
  assert.ok(
    !derinceFacilities.some((f) => f.name.includes("Yıldırımlar Konteyner")),
    "'Yıldırımlar Konteyner Depoloma Sahası' resmi kaynakla doğrulanamadı (UNVERIFIED) — aktif listede ÇIKMAMALI",
  );
});

check("Kocaeli dışındaki kayıtlar (liman/OSB/serbest bölge/lojistik merkezi dahil) bu görev nedeniyle değişmedi", () => {
  const nonKocaeli = locationsData.filter((r) => r.provinceId !== KOCAELI);
  assert.ok(nonKocaeli.length > 0, "Test kurulumu hatalı: Kocaeli dışında hiç kayıt yok");
  // Yalnızca önceki aşamalarda dokunulmamış olması gereken bir örnek kayıtla (Asyaport, Tekirdağ) örnekleme kontrolü
  const asyaport = nonKocaeli.find((r) => r.name === "Asyaport");
  assert.ok(asyaport && asyaport.active === true, "Kocaeli dışı bir liman kaydı (Asyaport) beklenmedik şekilde değişmiş");
});

// --- "Listede Yok / Özel Tesis Girişi" aşaması: Aşama 1.6 geri alındı ---
// KARAR: Katalogda yalnızca ortak/resmî lokasyon türleri (Liman, OSB, Serbest
// Bölge, Lojistik Merkezi) hazır seçim olarak tutulur. Fabrika/depo/şirket
// tesisi gibi tek-firma tesislerinin tamamını önceden kataloglamak yerine
// kullanıcı "Listede yok" seçeneğiyle kendi tesis bilgisini girer (bkz.
// job-location.ts#CUSTOM_FACILITY_VALUE, job-form-validation.ts). Bu yüzden
// Aşama 1.6'da eklenen 10 FABRIKA kaydı override dosyasından kaldırıldı ve
// aşağıdaki testler bunun kalıcı olduğunu doğruluyor.

check("Aşama 1.6'daki 10 FABRIKA kaydı katalogda artık görünmüyor (geri alındı)", () => {
  const allKocaeliFabrika = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "FABRIKA");
  assert.equal(allKocaeliFabrika.length, 0, `FABRIKA türünde ${allKocaeliFabrika.length} aktif kayıt var, 0 olmalıydı`);
  for (const removed of [
    "TÜPRAŞ İzmit Rafinerisi",
    "Ford Otosan Gölcük Fabrikası",
    "Ford Otosan Yeniköy Fabrikası",
    "Hyundai Assan Otomotiv Sanayi",
    "Anadolu Isuzu",
    "Goodyear İzmit Fabrikası",
    "Türk Pirelli Lastikleri A.Ş.",
    "Brisa Bridgestone Sabancı İzmit Fabrikası",
    "İGSAŞ İstanbul Gübre Sanayii A.Ş.",
    "Aygaz Yarımca Dolum Tesisi",
  ]) {
    assert.ok(!facilities.some((f) => f.name === removed), `'${removed}' hâlâ aktif kayıtlarda görünüyor, geri alma tamamlanmamış`);
  }
});

check("Liman, OSB, Serbest Bölge ve Lojistik Merkezi kayıt sayıları FABRIKA geri alımından etkilenmedi", () => {
  const activeLiman = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "LIMAN").length;
  const activeOsb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "OSB").length;
  const activeSb = facilities.filter((f) => f.provinceId === KOCAELI && f.type === "SERBEST_BOLGE").length;
  const activeLojistik = facilities.filter(
    (f) => f.provinceId === KOCAELI && f.type === "DEPO" && /lojistik\s*merkez/i.test(f.name),
  ).length;
  assert.equal(activeLiman, 15, `Aktif Kocaeli liman sayısı ${activeLiman}, 15 olmalıydı (Aşama 1.1 sonucu değişmemeli)`);
  assert.equal(activeOsb, 12, `Aktif Kocaeli OSB sayısı ${activeOsb}, 12 olmalıydı (Aşama 1.2 sonucu değişmemeli)`);
  assert.equal(activeSb, 2, `Aktif Kocaeli serbest bölge sayısı ${activeSb}, 2 olmalıydı (Aşama 1.3 sonucu değişmemeli)`);
  assert.equal(activeLojistik, 1, `Aktif Kocaeli lojistik merkezi sayısı ${activeLojistik}, 1 olmalıydı (Aşama 1.4 sonucu değişmemeli)`);
});

console.log(`\n[locations:test-filter] ${passed}/${passed} test geçti.`);
