// Uygulamanın (ve pipeline'ın) her yerde kullandığı TEK yer-türü sözlüğü ve
// il/ilçe ID üretme mantığı. classify.mjs OSM adaylarını daha ayrıntılı bir
// iç sınıflandırmayla (12 alt tür) etiketler; bu dosya, kullanıcıya gösterilen
// sabit 7 kategoriye (Liman, OSB, Serbest Bölge, Depo, Fabrika, Açık Saha,
// Diğer) düşürür. Ayrıntılı alt tür, denetim amacıyla `subtype` alanında saklanır.

export const FACILITY_TYPES = [
  "LIMAN",
  "OSB",
  "SERBEST_BOLGE",
  "DEPO",
  "FABRIKA",
  "ACIK_SAHA",
  "DIGER",
];

// classify.mjs'in ürettiği ayrıntılı iç türden, kullanıcıya gösterilen sabit
// 7 kategoriden birine eşleme. TERSANE (tersane bir liman/deniz tesisidir,
// listede ayrı bir "Tersane" seçeneği yok) -> LIMAN. LOJISTIK_MERKEZI
// (fonksiyonel olarak bir depolama/dağıtım merkezi) -> DEPO.
export const PIPELINE_TYPE_TO_FACILITY_TYPE = {
  LIMAN: "LIMAN",
  KONTEYNER_TERMINALI: "LIMAN",
  RO_RO_TERMINALI: "LIMAN",
  SIVI_YUK_TERMINALI: "LIMAN",
  KURU_YUK_TERMINALI: "LIMAN",
  TERSANE: "LIMAN",
  OSB: "OSB",
  SERBEST_BOLGE: "SERBEST_BOLGE",
  LOJISTIK_MERKEZI: "DEPO",
  DEPO: "DEPO",
  FABRIKA: "FABRIKA",
  DIGER: "DIGER",
};

const TURKISH_FOLD_MAP = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  I: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u",
};

/**
 * Türkçe karakterleri ASCII karşılıklarına indirger (İ/I/ı/i hepsi "i" olur).
 * Yalnızca ARAMA/ID üretimi için kullanılır — ekranda gösterilen orijinal
 * Türkçe ad asla bu fonksiyondan geçirilip değiştirilmez.
 */
export function foldTurkish(value) {
  return value
    .split("")
    .map((char) => TURKISH_FOLD_MAP[char] ?? char)
    .join("")
    .toLocaleLowerCase("tr-TR");
}

/** İl/ilçe adından kararlı, URL-güvenli bir ID üretir (ör. "Dilovası" -> "dilovasi"). */
export function slugifyTurkish(value) {
  return foldTurkish(value.trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
