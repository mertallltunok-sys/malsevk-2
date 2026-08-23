import { containsDirectContactInfo } from "./contact-leak-detection";
import { isValidCurrency, parsePriceInput } from "./money";
import { containsDangerousMarkup } from "./text-sanitization";
import { MAX_COMMITTED_DAYS, MIN_COMMITTED_DAYS } from "./offers";
import { isTransportationCategory } from "./product-catalog";
import { isRecyclingCategory, isRecyclingCommercialDirection } from "./recycling-catalog";
import type { Currency } from "./types";

export type OfferFormFields = {
  currency: Currency | "";
  amountInput: string;
  description: string;
  /** "Tamamlanması Taahhüt Edilen Gün" açılır listesinin seçili değeri — henüz seçilmemişse "" (bkz. currency alanının AYNI sentinel deseni). Yalnızca category Nakliye ise doğrulanır (bkz. aşağıdaki fonksiyon). */
  estimatedDuration: number | "";
  /** İlgili ilanın kategorisi — bu alanın YALNIZCA Nakliye'de zorunlu olduğunu belirlemek için (bkz. product-catalog.ts#isTransportationCategory). Başka hiçbir amaçla kullanılmaz. */
  category: string;
  /** "Teklifin Ticari Yönü" — yalnızca Geri Dönüşüm & Atık Tahliye kategorisinde zorunlu (bkz. recycling-catalog.ts#RecyclingCommercialDirection). Henüz seçilmemişse "". */
  commercialDirection: string;
};

export type OfferFormErrors = Partial<{
  currency: string;
  amount: string;
  description: string;
  estimatedDuration: string;
  commercialDirection: string;
}>;

export type OfferFormValidation = {
  errors: OfferFormErrors;
  amount: number | null;
};

export function validateOfferForm(fields: OfferFormFields): OfferFormValidation {
  const errors: OfferFormErrors = {};

  const requiresCommercialDirection = isRecyclingCategory(fields.category);
  if (requiresCommercialDirection && !isRecyclingCommercialDirection(fields.commercialDirection)) {
    errors.commercialDirection = "Teklifin ticari yönünü seçiniz.";
  }
  // "Ücretsiz Alım" — hiçbir ödeme yapılmaz, tutar alanı offer-form.tsx
  // tarafından hiç gösterilmez; burada `amount` her zaman 0 kabul edilir,
  // aşağıdaki fiyat doğrulaması (sıfırdan büyük olma zorunluluğu dahil)
  // BİLEREK atlanır.
  const isFreePickup = requiresCommercialDirection && fields.commercialDirection === "ucretsiz-alim";

  if (!isValidCurrency(fields.currency)) {
    errors.currency = "Para birimi seçiniz.";
  }

  let amount: number | null = null;
  if (isFreePickup) {
    amount = 0;
  } else {
    const priceResult = parsePriceInput(fields.amountInput);
    if (!priceResult.ok) {
      if (priceResult.error === "too-many-decimals") {
        errors.amount = "En fazla iki ondalık basamak kullanabilirsiniz.";
      } else if (priceResult.error === "not-positive") {
        errors.amount = "Teklif fiyatı sıfırdan büyük olmalıdır.";
      } else {
        errors.amount = "Geçerli bir teklif fiyatı giriniz.";
      }
    } else {
      amount = priceResult.value;
    }
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "Teklif açıklaması zorunludur.";
  } else if (description.length < 20) {
    errors.description = "Teklif açıklaması en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "Teklif açıklaması en fazla 1.000 karakter olabilir.";
  } else if (containsDirectContactInfo(description)) {
    // Genel Güvenlik görevi §8 — sunucu tarafı yedeği: offers.ts#createOffer
    // ve supabase/migrations/0073'ün offers.description trigger'ı.
    errors.description =
      "Açıklamaya telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.";
  } else if (containsDangerousMarkup(description)) {
    errors.description = "Açıklama izin verilmeyen içerik barındırıyor.";
  }

  if (isTransportationCategory(fields.category)) {
    if (fields.estimatedDuration === "") {
      errors.estimatedDuration = "Tamamlanması taahhüt edilen gün sayısını seçiniz.";
    } else if (
      !Number.isInteger(fields.estimatedDuration) ||
      fields.estimatedDuration < MIN_COMMITTED_DAYS ||
      fields.estimatedDuration > MAX_COMMITTED_DAYS
    ) {
      errors.estimatedDuration = `Geçerli bir gün sayısı seçiniz (${MIN_COMMITTED_DAYS}-${MAX_COMMITTED_DAYS}).`;
    }
  }

  return { errors, amount };
}
