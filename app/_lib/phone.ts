export type PhoneParseResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Türkiye cep telefonu numaralarını "+905XXXXXXXX" standart biçimine
 * dönüştürür. Kabul edilen girişler (boşluk/tire farkı gözetmeksizin):
 * "05XX XXX XX XX", "5XX XXX XX XX", "+90 5XX XXX XX XX", "90 5XX XXX XX XX".
 */
export function normalizePhoneNumber(raw: string): PhoneParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Telefon numarası zorunludur." };
  }

  const cleaned = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) {
    return { ok: false, error: "Geçerli bir Türkiye cep telefonu numarası girin." };
  }

  let digits = cleaned;
  if (digits.startsWith("+90")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("90") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^5\d{9}$/.test(digits)) {
    return { ok: false, error: "Geçerli bir Türkiye cep telefonu numarası girin." };
  }

  return { ok: true, value: `+90${digits}` };
}
