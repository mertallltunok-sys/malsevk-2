import { IN_PROGRESS_OFFER_STATUSES } from "./job-requests";
import { getProviderRatingSummary } from "./ratings";
import type { Offer, Rating } from "./types";

export const PROVIDER_BIO_MIN_LENGTH = 50;
export const PROVIDER_BIO_MAX_LENGTH = 500;
export const PROVIDER_COMPANY_NAME_MAX_LENGTH = 150;
export const MIN_FOUNDED_YEAR = 1900;

/** Kuruluş yılı doğrulamasının üst sınırı — inşa anındaki gerçek yıl (sahte/sabit bir üst yıl değil). */
export function getMaxFoundedYear(): number {
  return new Date().getFullYear();
}

export type ProviderProfileFormFields = {
  companyName: string;
  bio: string;
  foundedYear: number | null;
};

export type ProviderProfileFormErrors = Partial<Record<keyof ProviderProfileFormFields, string>>;

/**
 * Firma profili metin alanlarının doğrulaması — arayüzden bağımsız, tek
 * doğruluk kaynağıdır (bkz. users.ts#updateProviderProfile, aynı fonksiyonu
 * çağırır, kuralları tekrar yazmaz). `regions`/`expertise` burada
 * doğrulanmaz: ikisi de opsiyonel çoklu seçimlerdir, boş dizi geçerlidir.
 */
export function validateProviderProfileForm(fields: ProviderProfileFormFields): ProviderProfileFormErrors {
  const errors: ProviderProfileFormErrors = {};

  const companyName = fields.companyName.trim();
  if (companyName.length === 0) {
    errors.companyName = "Firma adı zorunludur.";
  } else if (companyName.length > PROVIDER_COMPANY_NAME_MAX_LENGTH) {
    errors.companyName = `Firma adı en fazla ${PROVIDER_COMPANY_NAME_MAX_LENGTH} karakter olabilir.`;
  }

  const bio = fields.bio.trim();
  if (bio.length < PROVIDER_BIO_MIN_LENGTH) {
    errors.bio = `Firma tanıtımı en az ${PROVIDER_BIO_MIN_LENGTH} karakter olmalıdır.`;
  } else if (bio.length > PROVIDER_BIO_MAX_LENGTH) {
    errors.bio = `Firma tanıtımı en fazla ${PROVIDER_BIO_MAX_LENGTH} karakter olabilir.`;
  }

  if (fields.foundedYear !== null) {
    const maxYear = getMaxFoundedYear();
    if (
      !Number.isInteger(fields.foundedYear) ||
      fields.foundedYear < MIN_FOUNDED_YEAR ||
      fields.foundedYear > maxYear
    ) {
      errors.foundedYear = `Kuruluş yılı ${MIN_FOUNDED_YEAR} ile ${maxYear} arasında olmalıdır.`;
    }
  }

  return errors;
}

/**
 * Bir Hizmet Veren'in, hiçbir zaman "kabul edilmemiş" sayılan üç durumun
 * (pending/rejected/withdrawn) dışında kalan tekliflerinin sayısı — yani
 * bir noktada kabul edilmiş (ve ardından ne olursa olsun, in_progress/
 * completed/agreement_failed/cancelled/completion_requested/
 * completion_disputed dahil) her teklif. Offer.status "accepted"tan sonra
 * asla geri "pending"e dönmediği için (bkz. offers.ts) bu, mevcut
 * durumlara bakarak "hiç kabul edilmiş miydi" sorusuna güvenli bir cevap
 * verir — ayrı bir geçmiş/olay kaydı gerekmez.
 */
function wasEverAccepted(status: Offer["status"]): boolean {
  return status !== "pending" && status !== "rejected" && status !== "withdrawn";
}

export type ProviderProfileSummary = {
  averageStars: number | null;
  ratingCount: number;
  completedJobCount: number;
  inProgressCount: number;
  /** 0-100 arası yüzde; hiç teklif verilmemişse null (bölme hatası/yanıltıcı %0 yerine). */
  acceptanceRatePercent: number | null;
};

/**
 * Hizmet Veren'in profil özetini hesaplar. Tamamen saf bir fonksiyondur:
 * kendi okuma fonksiyonlarını tekrar yazmaz — puan özeti
 * ratings.ts#getProviderRatingSummary'den, devam eden iş sayısı
 * job-requests.ts#IN_PROGRESS_OFFER_STATUSES'tan (tek ortak doğruluk
 * kaynağı) gelir.
 */
export function getProviderProfileSummary(
  providerId: string,
  offers: Offer[],
  ratings: Rating[],
): ProviderProfileSummary {
  const { averageStars, ratingCount, completedJobCount } = getProviderRatingSummary(
    providerId,
    offers,
    ratings,
  );

  const myOffers = offers.filter((offer) => offer.providerId === providerId);
  const inProgressCount = myOffers.filter((offer) =>
    IN_PROGRESS_OFFER_STATUSES.includes(offer.status),
  ).length;

  const acceptanceRatePercent =
    myOffers.length === 0
      ? null
      : Math.round((myOffers.filter((offer) => wasEverAccepted(offer.status)).length / myOffers.length) * 100);

  return { averageStars, ratingCount, completedJobCount, inProgressCount, acceptanceRatePercent };
}
