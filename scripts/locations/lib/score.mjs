// Google/Yandex kullanılmadığı için orijinal Google tabanlı puanlama
// rubriği bu OSM-tabanlı pilotta doğrudan uygulanamaz; benzer mantıkla
// (yalnızca elimizdeki gerçek sinyallerle) yeniden türetilmiştir.
// 0-100 arası, aynı yayın eşikleri (80+ VERIFIED, 60-79 REVIEW, <60 gizli).

const STRONG_NAME_PATTERN =
  /\bliman\b|liman[ıi]$|port$|\bosb\b|organize sanayi|serbest b[öo]lge|lojistik|tersane|konteyner|ro[\s-]?ro/i;
const STRONG_TAG_TYPES = new Set(["LIMAN", "OSB", "SERBEST_BOLGE", "KONTEYNER_TERMINALI", "TERSANE", "RO_RO_TERMINALI"]);

export function computeConfidenceScore(candidate, { districtMatchCount }) {
  let score = 0;
  const reasons = [];

  if (STRONG_NAME_PATTERN.test(candidate.name)) {
    score += 40;
    reasons.push("+40 isim güçlü anahtar kelimeyle eşleşiyor");
  }

  if (districtMatchCount === 1) {
    score += 20;
    reasons.push("+20 koordinat tek ve net bir ilçe poligonunda");
  } else if (districtMatchCount > 1) {
    score -= 30;
    reasons.push("-30 koordinat birden fazla ilçe poligonuyla çelişiyor");
  } else {
    score -= 30;
    reasons.push("-30 koordinat hiçbir ilçe poligonunda değil");
  }

  if (candidate.website) {
    score += 15;
    reasons.push("+15 web sitesi mevcut");
  }

  if (candidate.phone) {
    score += 10;
    reasons.push("+10 telefon numarası mevcut");
  }

  if (STRONG_TAG_TYPES.has(candidate.facility_type)) {
    score += 15;
    reasons.push("+15 tesis türü güçlü/kesin sınıflandırılmış");
  }

  if (candidate.business_status !== "OPERATIONAL") {
    score -= 25;
    reasons.push("-25 işletme kapalı/geçici kapalı görünüyor");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function statusForScore(score, { isDuplicate }) {
  if (isDuplicate) return "REJECTED";
  if (score >= 80) return "VERIFIED";
  if (score >= 60) return "REVIEW";
  return "REVIEW";
}
