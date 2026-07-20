const TURKISH_FOLD_MAP: Record<string, string> = {
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
 * Türkçe karakterleri ASCII karşılıklarına indirger (İ/I/ı/i hepsi "i" olur,
 * "Yılport"/"Yilport"/"YILPORT" hepsi "yilport" olur). Yalnızca ARAMA ve ID
 * üretimi için kullanılır — ekranda gösterilen orijinal Türkçe ad bu
 * fonksiyondan hiçbir zaman geçirilip değiştirilmez, yalnızca karşılaştırma
 * amaçlı bir gölge değer üretir.
 *
 * NOT: scripts/locations/lib/canonical.mjs'teki foldTurkish/slugifyTurkish
 * ile birebir aynı mantığı uygular (pipeline scriptleri ayrı bir Node ESM
 * bağlamında çalıştığı için app/_lib içinden içe aktarılamaz). Biri
 * değişirse diğeri de güncellenmelidir.
 */
export function foldTurkish(value: string): string {
  return value
    .split("")
    .map((char) => TURKISH_FOLD_MAP[char] ?? char)
    .join("")
    .toLocaleLowerCase("tr-TR");
}

/** İl/ilçe adından kararlı, URL-güvenli bir ID üretir (ör. "Dilovası" -> "dilovasi"). */
export function slugifyTurkish(value: string): string {
  return foldTurkish(value.trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
