import { isOfferVisibleInNormalLists } from "./job-requests";
import { getOfferForJob } from "./offers";
import { getCategoryDisplayLabel } from "./service-catalog";
import { foldTurkish } from "./turkish-text";
import type { Job } from "./types";

export type DateBucket = "tumu" | "bugun" | "bu-hafta" | "bu-ay";

export const DATE_BUCKET_OPTIONS: { value: DateBucket; label: string }[] = [
  { value: "tumu", label: "Tümü" },
  { value: "bugun", label: "Bugün" },
  { value: "bu-hafta", label: "Bu Hafta" },
  { value: "bu-ay", label: "Bu Ay" },
];

export type OfferStatusFilter = "tumu" | "teklif-verdiklerim" | "teklif-vermediklerim";

export const OFFER_STATUS_FILTER_OPTIONS: { value: OfferStatusFilter; label: string }[] = [
  { value: "tumu", label: "Tümü" },
  { value: "teklif-verdiklerim", label: "Teklif Verdiklerim" },
  { value: "teklif-vermediklerim", label: "Teklif Vermediklerim" },
];

export type JobListingFilterState = {
  category: string;
  province: string;
  district: string;
  dateBucket: DateBucket;
  offerStatus: OfferStatusFilter;
  onlyFavorites: boolean;
  /** job-listing-badges.ts#GENERAL_BADGE_OPTIONS/PROVIDER_BADGE_OPTIONS'taki `kind` değerleri — OR mantığıyla eşleşir. */
  badgeKinds: string[];
};

export const DEFAULT_JOB_LISTING_FILTERS: JobListingFilterState = {
  category: "",
  province: "",
  district: "",
  dateBucket: "tumu",
  offerStatus: "tumu",
  onlyFavorites: false,
  badgeKinds: [],
};

export function hasActiveFilters(filters: JobListingFilterState): boolean {
  return (
    filters.category !== "" ||
    filters.province !== "" ||
    filters.district !== "" ||
    filters.dateBucket !== "tumu" ||
    filters.offerStatus !== "tumu" ||
    filters.onlyFavorites ||
    filters.badgeKinds.length > 0
  );
}

/**
 * Canlı arama — başlık/açıklama/hizmet türü etiketi/il/ilçe/tesis (workLocationType)
 * üzerinde, searchable-select.tsx'te de kullanılan aynı Türkçe-duyarlı
 * `foldTurkish` ile. Yeni bir metin-normalize fonksiyonu icat edilmez.
 */
export function matchesJobSearch(job: Job, foldedQuery: string): boolean {
  if (foldedQuery.length === 0) return true;
  const haystack = foldTurkish(
    [
      job.title,
      job.description,
      getCategoryDisplayLabel(job.category),
      job.province,
      job.district,
      job.workLocationType,
    ].join(" "),
  );
  return haystack.includes(foldedQuery);
}

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Bu Hafta"/"Bu Ay" — gerçek bir tarih aralığı seçici yerine, mevcut filtrelerle (İl/İlçe/Teklif Durumu) aynı kategorik/segmented stilde basit göreli kovalar. */
export function matchesDateBucket(workDate: string, bucket: DateBucket): boolean {
  if (bucket === "tumu") return true;
  const diffDays = Math.round((startOfDay(new Date(workDate)) - startOfDay(new Date())) / DAY_MS);
  switch (bucket) {
    case "bugun":
      return diffDays === 0;
    case "bu-hafta":
      return diffDays >= 0 && diffDays <= 6;
    case "bu-ay":
      return diffDays >= 0 && diffDays <= 29;
  }
}

/** offers.ts#getOfferForJob'ı tekrar yazmaz — yalnızca "görünür bir teklifim var mı" sorusuna indirger. */
export function matchesOfferStatusFilter(
  jobId: string,
  providerId: string,
  filter: OfferStatusFilter,
): boolean {
  if (filter === "tumu") return true;
  const offer = getOfferForJob(jobId, providerId);
  const hasVisibleOffer = offer !== null && isOfferVisibleInNormalLists(offer);
  return filter === "teklif-verdiklerim" ? hasVisibleOffer : !hasVisibleOffer;
}

/** Rozetler filtresi: seçilenlerden HERHANGİ BİRİ ilanda varsa geçer (OR) — rozetlerin çoğu zaten birbirini dışladığı için AND neredeyse hiçbir zaman sonuç vermezdi. */
export function matchesBadgeFilter(selectedKinds: string[], jobBadgeKinds: string[]): boolean {
  if (selectedKinds.length === 0) return true;
  return selectedKinds.some((kind) => jobBadgeKinds.includes(kind));
}

export type FilterOption = { value: string; label: string };

function distinctByFold(values: string[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = foldTurkish(trimmed);
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b, "tr"))
    .map((label) => ({ value: label, label }));
}

/**
 * Hizmet Türü/İl/İlçe filtre seçenekleri, `service-catalog.ts`/`turkey-locations.ts`
 * gibi TAM kataloglardan değil, o an ekrandaki GERÇEK ilan verisinden
 * üretilir — böylece her seçenek en az 1 sonuç verir ve eski/serbest-metin
 * (legacy) değerler de kaybolmaz.
 */
export function buildCategoryOptions(jobs: Job[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const job of jobs) {
    if (!seen.has(job.category)) seen.set(job.category, getCategoryDisplayLabel(job.category));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export function buildProvinceOptions(jobs: Job[]): FilterOption[] {
  return distinctByFold(jobs.map((job) => job.province));
}

/** Seçili bir il varsa ilçe seçenekleri o ile göre daraltılır — job-request-form.tsx'teki İl->İlçe deseniyle tutarlı. */
export function buildDistrictOptions(jobs: Job[], selectedProvince: string): FilterOption[] {
  const scoped = selectedProvince
    ? jobs.filter((job) => foldTurkish(job.province) === foldTurkish(selectedProvince))
    : jobs;
  return distinctByFold(scoped.map((job) => job.district));
}
