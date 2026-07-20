import { parsePriceInput } from "./money";
import type { Currency } from "./types";

export type OfferFormFields = {
  currency: Currency | "";
  amountInput: string;
  description: string;
  estimatedDuration: string;
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

  if (fields.currency !== "TRY" && fields.currency !== "USD") {
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

  const estimatedDuration = fields.estimatedDuration.trim();
  if (estimatedDuration.length === 0) {
    errors.estimatedDuration = "Tahmini hizmet süresini giriniz.";
  } else if (estimatedDuration.length < 2) {
    errors.estimatedDuration = "Tahmini hizmet süresi en az 2 karakter olmalıdır.";
  } else if (estimatedDuration.length > 100) {
    errors.estimatedDuration = "Tahmini hizmet süresi en fazla 100 karakter olabilir.";
  }

  return { errors, amount };
}
