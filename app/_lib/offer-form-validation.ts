import { isValidCurrency, parsePriceInput } from "./money";
import { MAX_COMMITTED_DAYS, MIN_COMMITTED_DAYS } from "./offers";
import { isTransportationCategory } from "./product-catalog";
import type { Currency } from "./types";

export type OfferFormFields = {
  currency: Currency | "";
  amountInput: string;
  description: string;
  /** "Tamamlanması Taahhüt Edilen Gün" açılır listesinin seçili değeri — henüz seçilmemişse "" (bkz. currency alanının AYNI sentinel deseni). Yalnızca category Nakliye ise doğrulanır (bkz. aşağıdaki fonksiyon). */
  estimatedDuration: number | "";
  /** İlgili ilanın kategorisi — bu alanın YALNIZCA Nakliye'de zorunlu olduğunu belirlemek için (bkz. product-catalog.ts#isTransportationCategory). Başka hiçbir amaçla kullanılmaz. */
  category: string;
};

export type OfferFormErrors = Partial<{
  currency: string;
  amount: string;
  description: string;
  estimatedDuration: string;
}>;

export type OfferFormValidation = {
  errors: OfferFormErrors;
  amount: number | null;
};

export function validateOfferForm(fields: OfferFormFields): OfferFormValidation {
  const errors: OfferFormErrors = {};

  if (!isValidCurrency(fields.currency)) {
    errors.currency = "Para birimi seçiniz.";
  }

  let amount: number | null = null;
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

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "Teklif açıklaması zorunludur.";
  } else if (description.length < 20) {
    errors.description = "Teklif açıklaması en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "Teklif açıklaması en fazla 1.000 karakter olabilir.";
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
