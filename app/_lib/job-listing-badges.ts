import { getOfferForJob, getOfferStatusLabel, getOfferStatusTone } from "./offers";
import { isOfferVisibleInNormalLists } from "./job-requests";
import { foldTurkish } from "./turkish-text";
import type { Job, Offer } from "./types";

/** status-badge.tsx#StatusBadge'in desteklediği TEK tonlar — yeni bir tasarım sistemi icat edilmez. */
export type BadgeTone = "success" | "warning" | "neutral" | "danger";

export type JobBadge = {
  /** Rozetler filtresinde eşleştirme için kullanılan kararlı anahtar. */
  kind: string;
  label: string;
  tone: BadgeTone;
};

export type GeneralBadgeKind =
  | "yeni"
  | "acil"
  | "bugun"
  | "son-gun"
  | "teklif-bekliyor"
  | "yogun-ilgi";

export type ProviderBadgeKind =
  | "teklifiniz-beklemede"
  | "teklifiniz-kabul-edildi"
  | "is-basladi"
  | "tamamlandi"
  | "teklifiniz-reddedildi";

/** Rozetler filtresinde gösterilecek, adı ürün talebinde geçen 6 genel rozet — "Öne Çıkan" bilerek yok, hiçbir zaman tetiklenmediği için filtrelenebilir değil. */
export const GENERAL_BADGE_OPTIONS: { kind: GeneralBadgeKind; label: string }[] = [
  { kind: "yeni", label: "Yeni" },
  { kind: "acil", label: "Acil" },
  { kind: "bugun", label: "Bugün" },
  { kind: "son-gun", label: "Son Gün" },
  { kind: "teklif-bekliyor", label: "Teklif Bekliyor" },
  { kind: "yogun-ilgi", label: "Yoğun İlgi" },
];

/** Rozetler filtresinde gösterilecek 5 kullanıcıya-özel rozet. */
export const PROVIDER_BADGE_OPTIONS: { kind: ProviderBadgeKind; label: string }[] = [
  { kind: "teklifiniz-beklemede", label: "Teklifiniz Beklemede" },
  { kind: "teklifiniz-kabul-edildi", label: "Teklifiniz Kabul Edildi" },
  { kind: "is-basladi", label: "İş Başladı" },
  { kind: "tamamlandi", label: "Tamamlandı" },
  { kind: "teklifiniz-reddedildi", label: "Teklifiniz Reddedildi" },
];

/**
 * En son eklenen kaç GERÇEK (requesterId !== null) ilanın "Yeni" sayılacağı.
 * Job tipinde bir oluşturulma tarihi yok (bkz. types.ts) — bu yüzden yeni bir
 * alan eklemek yerine useAllJobs()'un zaten döndürdüğü "en yeni önde" sırası
 * kullanılır (bkz. job-listing-row.ts#buildJobListingRows).
 */
export const NEW_JOB_WINDOW_SIZE = 5;

/** Başlık/açıklamada bu kelimelerden biri geçiyorsa "Acil" rozeti gösterilir (Türkçe-duyarlı, foldTurkish ile). */
const URGENT_KEYWORDS = ["acil", "ivedi"];

/** Bir ilanın "Yoğun İlgi" sayılması için gereken en az görünür (withdrawn hariç) teklif sayısı. */
export const BUSY_OFFER_THRESHOLD = 3;

/**
 * "Öne Çıkan" rozetinin altyapısı — bilerek her zaman boş: hiçbir ilan bugün
 * bu rozeti tetiklemez ("altyapısını hazırla, aktif etme"). İleride gerçek
 * bir öne-çıkarma mekanizması istenirse tek değişiklik yeri burasıdır.
 */
const FEATURED_JOB_IDS: readonly string[] = [];

export function isFeaturedJob(jobId: string): boolean {
  return FEATURED_JOB_IDS.includes(jobId);
}

function truncatedDayTime(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** jobs.ts#isJobDateInPast ile aynı gün-bazlı karşılaştırma tekniği (saat bilgisi yok sayılır). */
function isWorkDateToday(workDate: string): boolean {
  return truncatedDayTime(new Date(workDate)) === truncatedDayTime(new Date());
}

/** "Son Gün": işin yapılacağı tarih yarın — bu ilana teklif vermek için son gün anlamında. */
function isWorkDateTomorrow(workDate: string): boolean {
  return truncatedDayTime(new Date(workDate)) === truncatedDayTime(new Date()) + DAY_MS;
}

function containsUrgentKeyword(job: Job): boolean {
  const folded = foldTurkish(`${job.title} ${job.description}`);
  return URGENT_KEYWORDS.some((keyword) => folded.includes(foldTurkish(keyword)));
}

/**
 * Bir ilanın genel (kullanıcıdan bağımsız) rozetlerini hesaplar — TEK ortak
 * doğruluk kaynağı: hem satır oluşturma (job-listing-row.ts) hem Rozetler
 * filtresi (job-listing-filters.ts) bunu çağırır, kurallar iki yerde ayrı
 * ayrı yazılmaz. "Bugün" ve "Son Gün" birbirini dışlar (bir ilan aynı anda
 * ikisi birden olamaz); "Teklif Bekliyor" ve "Yoğun İlgi" de öyle.
 */
export function computeGeneralJobBadges(
  job: Job,
  isAmongNewest: boolean,
  visibleOfferCount: number,
): JobBadge[] {
  const badges: JobBadge[] = [];

  if (job.requesterId !== null && isAmongNewest) {
    badges.push({ kind: "yeni", label: "Yeni", tone: "success" });
  }
  if (containsUrgentKeyword(job)) {
    badges.push({ kind: "acil", label: "Acil", tone: "danger" });
  }
  if (isWorkDateToday(job.workDate)) {
    badges.push({ kind: "bugun", label: "Bugün", tone: "warning" });
  } else if (isWorkDateTomorrow(job.workDate)) {
    badges.push({ kind: "son-gun", label: "Son Gün", tone: "danger" });
  }
  if (visibleOfferCount === 0) {
    badges.push({ kind: "teklif-bekliyor", label: "Teklif Bekliyor", tone: "neutral" });
  } else if (visibleOfferCount >= BUSY_OFFER_THRESHOLD) {
    badges.push({ kind: "yogun-ilgi", label: "Yoğun İlgi", tone: "warning" });
  }

  return badges;
}

/**
 * Oturumdaki Hizmet Veren'in KENDİ teklifine göre rozeti — yalnızca ilgili
 * kullanıcıya gösterilir. `offer` null ya da "withdrawn" ise (bkz.
 * isOfferVisibleInNormalLists, job-requests.ts'teki tek ortak doğruluk
 * kaynağı) hiçbir rozet dönmez. Ürün talebindeki "Teklif Verdiniz" ve
 * "Teklifiniz Beklemede" aynı "pending" durumuna karşılık geldiği için TEK
 * rozete birleştirilmiştir — aynı gerçeği iki ayrı çip olarak tekrar etmemek
 * için. Adı ürün talebinde geçmeyen durumlar (agreement_failed/cancelled/
 * completion_requested/completion_disputed) offers.ts'in kendi, zaten
 * Türkçe ve tutarlı `getOfferStatusLabel`/`getOfferStatusTone`'una düşer —
 * yeni bir metin icat edilmez, hiçbir durum çökmeden/etiketsiz kalmaz.
 */
export function computeProviderJobBadge(offer: Offer | null): JobBadge | null {
  if (!offer || !isOfferVisibleInNormalLists(offer)) return null;

  switch (offer.status) {
    case "pending":
      return { kind: "teklifiniz-beklemede", label: "Teklifiniz Beklemede", tone: "warning" };
    case "accepted":
      return { kind: "teklifiniz-kabul-edildi", label: "Teklifiniz Kabul Edildi", tone: "success" };
    case "in_progress":
      return { kind: "is-basladi", label: "İş Başladı", tone: "success" };
    case "completed":
      return { kind: "tamamlandi", label: "Tamamlandı", tone: "neutral" };
    case "rejected":
      return { kind: "teklifiniz-reddedildi", label: "Teklifiniz Reddedildi", tone: "danger" };
    default:
      return {
        kind: offer.status,
        label: getOfferStatusLabel(offer.status),
        tone: getOfferStatusTone(offer.status),
      };
  }
}

/** provider-job-listing.tsx'in kendi teklif durumunu türetmesi için ince sarmalayıcı — offers.ts#getOfferForJob'ı tekrar yazmaz. */
export function getProviderBadgeForJob(jobId: string, providerId: string): JobBadge | null {
  return computeProviderJobBadge(getOfferForJob(jobId, providerId));
}
