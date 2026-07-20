import type { Currency } from "./types";

/**
 * Teknik güvenlik sınırı — veri taşmasını / anlamsız büyüklükte değerleri
 * engellemek içindir, kullanıcıya bir fiyat önerisi değildir.
 */
export const MAX_OFFER_AMOUNT = 999_999_999;

export type PriceParseError =
  | "empty"
  | "invalid"
  | "too-many-decimals"
  | "not-positive"
  | "too-large";

export type PriceParseResult =
  | { ok: true; value: number }
  | { ok: false; error: PriceParseError };

/**
 * Kullanıcının yazdığı fiyat metnini güvenli şekilde sayıya çevirir.
 * Türkçe girişte virgül ondalık ayracıdır. Nokta; tam olarak üç haneli
 * gruplar halindeyse binlik ayraç, tek haneli/iki haneli bir kesir
 * takip ediyorsa ondalık ayraç olarak yorumlanır (örn. "2.500" -> 2500,
 * "2500.50" -> 2500.5). Bu, kullanıcı yazarken değerin sıçramaması için
 * yalnızca gönderim anında (canlı formatlama sırasında değil) çağrılmalıdır.
 */
export function parsePriceInput(raw: string): PriceParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (!/^-?[0-9.,]+$/.test(trimmed)) return { ok: false, error: "invalid" };

  const isNegative = trimmed.startsWith("-");
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;

  let normalized: string;
  const commaIndex = unsigned.lastIndexOf(",");

  if (commaIndex !== -1) {
    const integerPart = unsigned.slice(0, commaIndex).split(".").join("");
    const decimalPart = unsigned.slice(commaIndex + 1);
    if (!/^\d+$/.test(integerPart) || !/^\d+$/.test(decimalPart)) {
      return { ok: false, error: "invalid" };
    }
    if (decimalPart.length > 2) return { ok: false, error: "too-many-decimals" };
    normalized = `${integerPart}.${decimalPart}`;
  } else if (unsigned.includes(".")) {
    const segments = unsigned.split(".");
    const lastSegment = segments[segments.length - 1];

    if (segments.length === 2 && /^\d{1,2}$/.test(lastSegment)) {
      // Tek nokta + 1-2 haneli kesir -> ondalık ayraç (ör. "2500.50")
      if (!/^\d+$/.test(segments[0])) return { ok: false, error: "invalid" };
      normalized = `${segments[0]}.${lastSegment}`;
    } else {
      // Tüm parçalar binlik grup olmalı (ör. "2.500", "1.234.567")
      const groupsAreValid = segments.every((segment, index) =>
        index === 0 ? /^\d{1,3}$/.test(segment) : /^\d{3}$/.test(segment),
      );
      if (!groupsAreValid) return { ok: false, error: "invalid" };
      normalized = segments.join("");
    }
  } else {
    if (!/^\d+$/.test(unsigned)) return { ok: false, error: "invalid" };
    normalized = unsigned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  if (isNegative || value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_OFFER_AMOUNT) return { ok: false, error: "too-large" };

  return { ok: true, value };
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

/**
 * Örnekler: 2500 -> "2.500 TL", 12500.5 -> "12.500,50 TL", 350 USD -> "350 USD".
 * Intl'in "currency" biçimindeki sembol/kod yerleşimi ortama göre değişebildiği
 * için burada sayı grupları Intl ile biçimlendirilip para birimi kodu açıkça
 * sona eklenir; böylece kullanıcıya her zaman TL veya USD net şekilde gösterilir.
 */
export function formatMoney(amount: number, currency: Currency): string {
  const isWholeNumber = Number.isInteger(amount);
  const formattedNumber = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: isWholeNumber ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const label = currency === "TRY" ? "TL" : "USD";
  return `${formattedNumber} ${label}`;
}
