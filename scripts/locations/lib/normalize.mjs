const LEGAL_SUFFIX_REGEX =
  /\b(a\.?s\.?|anonim sirketi|ltd\.?|limited|sti\.?|san\.?|tic\.?|ve|ic|dis|ticaret|sanayi)\b/gi;

/** Karşılaştırma amaçlı: küçük harf, Türkçe karakter farkı yok, noktalama/boşluk sadeleştirilmiş. */
export function normalizeName(name) {
  return name
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LEGAL_SUFFIX_REGEX, " ")
    .replace(/[^a-z0-9ığüşöç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDistrict(value) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

export function extractDomain(url) {
  if (!url) return null;
  try {
    const { hostname } = new URL(url.startsWith("http") ? url : `https://${url}`);
    return hostname.replace(/^www\./, "").toLocaleLowerCase("tr-TR");
  } catch {
    return null;
  }
}

export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}
