import { resolveJobFacility } from "./job-location";
import { isOfferVisibleInNormalLists } from "./job-requests";
import { getOfferForJob } from "./offers";
import { getCategoryDisplayLabel, resolveLegacyJobCategoryToId, SERVICE_CATEGORY_GROUPS } from "./service-catalog";
import { foldTurkish, slugifyTurkish } from "./turkish-text";
import { getDistrictId, getFacilitiesByProvinceAndDistrict } from "./turkey-locations";
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
  /** service-catalog.ts#SERVICE_CATEGORY_GROUPS'taki bir kategori id'si, ya da "" (Tümü). */
  category: string;
  /** `slugifyTurkish(job.province)` ile üretilen il anahtarı, ya da "" (Tümü). */
  province: string;
  /** `getDistrictId(job.district)` ile üretilen ilçe anahtarı, ya da "" (Tümü). Province seçilmeden anlamsızdır. */
  district: string;
  /** turkey-locations.ts#Facility.id, ya da "" (Tümü). District seçilmeden anlamsızdır. */
  facility: string;
  /** Serbest metin firma/fabrika arama sorgusu, ya da "" (devre dışı). Diğer 4 filtreden FARKLI: bir SearchableSelect değil, düz metin girişi (bkz. job-listing-filter-bar.tsx). */
  companyQuery: string;
  dateBucket: DateBucket;
  offerStatus: OfferStatusFilter;
};

export const DEFAULT_JOB_LISTING_FILTERS: JobListingFilterState = {
  category: "",
  province: "",
  district: "",
  facility: "",
  companyQuery: "",
  dateBucket: "tumu",
  offerStatus: "tumu",
};

export function hasActiveFilters(filters: JobListingFilterState): boolean {
  return (
    filters.category !== "" ||
    filters.province !== "" ||
    filters.district !== "" ||
    filters.facility !== "" ||
    filters.companyQuery.trim() !== "" ||
    filters.dateBucket !== "tumu" ||
    filters.offerStatus !== "tumu"
  );
}

/**
 * Canlı arama — başlık/açıklama/hizmet türü etiketi/il/ilçe/tesis
 * (workLocationType)/firma-fabrika adı üzerinde, searchable-select.tsx'te de
 * kullanılan aynı Türkçe-duyarlı `foldTurkish` ile. Yeni bir metin-normalize
 * fonksiyonu icat edilmez.
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
      job.companyOrFactoryName ?? "",
    ].join(" "),
  );
  return haystack.includes(foldedQuery);
}

/**
 * "Firma / Fabrika araması" filtresi — yalnızca job.companyOrFactoryName
 * üzerinde çalışır (matchesJobSearch'ün genel canlı aramasından FARKLI,
 * kendi bağımsız filtre alanı). Bu alan bu özellikten önce oluşturulmuş
 * ilanlarda hiç yoktur — bu durumda boş sorgu dışında hiçbir zaman eşleşmez
 * (veri kaybı değil, "aranabilir alan yok" durumu), asla fırlatmaz.
 */
export function matchesCompanySearch(job: Job, foldedQuery: string): boolean {
  if (foldedQuery.length === 0) return true;
  if (!job.companyOrFactoryName) return false;
  return foldTurkish(job.companyOrFactoryName).includes(foldedQuery);
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

export type FilterOption = { value: string; label: string; keywords?: string[] };

/**
 * Hizmet Türü filtresi seçenekleri: `SERVICE_CATEGORY_GROUPS` (job-request-form.tsx
 * ile AYNI merkezi katalog) TAMAMEN kullanılır — hiçbir ilan kullanmasa bile bir
 * kategori listede görünür, kaldırılmış/eski (jobs.ts#SERVICE_CATEGORIES) düz
 * metin kategoriler hiç görünmez. Ana kategori grubu `keywords`e (yalnızca
 * arama eşleştirmesi, bkz. searchable-select.tsx) konur — `hint` DEĞİL: hint
 * görünür etiketle birlikte erişilebilirlik adına (accessible name) karışır
 * ve `getByRole("option", { name: "Forklift", exact: true })` gibi tam eşleşen
 * sorguları kırar (bkz. job-request-form.tsx'in tesis `keywords` kullanımıyla
 * aynı desen — o da yalnızca arama içindir, görünür metne eklenmez).
 */
export function buildCategoryOptions(): FilterOption[] {
  return SERVICE_CATEGORY_GROUPS.flatMap((group) =>
    group.categories.map((category) => ({ value: category.id, label: category.label, keywords: [group.label] })),
  );
}

/**
 * Bir ilanın Hizmet Türü filtresiyle eşleşen kararlı katalog id'sini döner.
 * `resolveLegacyJobCategoryToId` zaten hem yeni (id) hem eski (düz Türkçe
 * metin, ör. "Forklift Operatörü") kayıtları güvenle çözer; eşleşmeyen eski
 * değerler (ör. "Depolama", bilerek eşlenmemiş — bkz. service-catalog.ts)
 * `null` döner ve filtrede hiçbir seçili kategoriyle eşleşmez (veri kaybı
 * değildir, yalnızca filtrelenemez).
 */
export function matchesJobCategory(job: Job, selectedCategoryId: string): boolean {
  if (selectedCategoryId === "") return true;
  return resolveLegacyJobCategoryToId(job.category) === selectedCategoryId;
}

/**
 * İl için sağlam eşleştirme anahtarı: turkey-locations.ts'in tesis
 * kayıtlarında (`Facility.provinceId`) zaten kullandığı AYNI şema
 * (`slugifyTurkish(ad)`) — ör. "Kocaeli"/"kocaeli"/"KOCAELİ" hepsi
 * "kocaeli"ye indirgenir. `job.province` gerçek il verisinden (job-request-form.tsx
 * `getProvinces()`) geldiği için bu her zaman il koduna kadar gitmeden de
 * kararlı bir kimliktir; yazım/harf farkı olan legacy kayıtlarda dahi güvenli
 * bir "en iyi çaba" anahtarı üretir (ayrı bir fallback dalına gerek kalmaz).
 */
export function resolveJobProvinceKey(provinceName: string): string {
  return slugifyTurkish(provinceName);
}

/** turkey-locations.ts#getDistrictId ile BİREBİR aynı — ayrı bir ilçe-kimliği şeması icat edilmez. */
export function resolveJobDistrictKey(districtName: string): string {
  return getDistrictId(districtName);
}

export function matchesProvinceFilter(job: Job, selectedProvinceKey: string): boolean {
  if (selectedProvinceKey === "") return true;
  return resolveJobProvinceKey(job.province) === selectedProvinceKey;
}

export function matchesDistrictFilter(job: Job, selectedDistrictKey: string): boolean {
  if (selectedDistrictKey === "") return true;
  return resolveJobDistrictKey(job.district) === selectedDistrictKey;
}

/**
 * `İlanlarda gerçekten kullanılan şehirleri gösterebilir` — seçenekler o an
 * ekrandaki aktif ilanlardan türetilir (hiçbir seçenek garanti sıfır sonuç
 * vermez), ama eşleştirme kimliği yukarıdaki `resolveJobProvinceKey` ile
 * (isim değil) üretilir; bu yüzden aynı il farklı yazımla iki kez görünmez.
 */
export function buildProvinceOptions(jobs: Job[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const job of jobs) {
    const trimmed = job.province.trim();
    if (!trimmed) continue;
    const key = resolveJobProvinceKey(trimmed);
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * Seçili bir il YOKSA boş dizi döner — job-listing-filter-bar.tsx bunu
 * "Önce şehir seçin" disabled durumuna çevirir (job-request-form.tsx'teki
 * İl->İlçe desenindeki `disabled={!provinceCode}` ile aynı davranış).
 * Seçili ilin dışındaki hiçbir ilçe asla listeye karışmaz — eşleştirme
 * `resolveJobProvinceKey` ile yapılır, ilçe adının kendisiyle değil.
 */
export function buildDistrictOptions(jobs: Job[], selectedProvinceKey: string): FilterOption[] {
  if (selectedProvinceKey === "") return [];
  const seen = new Map<string, string>();
  for (const job of jobs) {
    if (resolveJobProvinceKey(job.province) !== selectedProvinceKey) continue;
    const trimmed = job.district.trim();
    if (!trimmed) continue;
    const key = resolveJobDistrictKey(trimmed);
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * Bölge/Tesis filtresi seçenekleri: diğer üç konum/kategori filtresinden
 * FARKLI OLARAK o an ekrandaki ilan verisinden değil, doğrudan
 * turkey-locations.ts'in merkezi tesis kataloğundan (job-request-form.tsx'in
 * "Yer Türü" adımının okuduğu AYNI kaynak) gelir — çünkü görev tanımı bu
 * filtrenin "ilan oluşturma ekranında kullanılan merkezi location/facility
 * verisiyle aynı kaynağa bağlanmasını" açıkça istiyor. Seçili ilçe YOKSA boş
 * dizi döner (disabled durumu).
 */
export function buildFacilityOptions(selectedProvinceKey: string, selectedDistrictKey: string): FilterOption[] {
  if (selectedProvinceKey === "" || selectedDistrictKey === "") return [];
  return getFacilitiesByProvinceAndDistrict(selectedProvinceKey, selectedDistrictKey)
    .map((facility) => ({ value: facility.id, label: facility.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * job.facilityId (yeni ilanlar) VEYA workLocationType ad/takma-ad eşleşmesi
 * (eski ilanlar) üzerinden resolveJobFacility (bkz. job-location.ts) —
 * ayrı bir kopyası burada tutulmaz, bu yüzden ilan oluşturma formu ile Aktif
 * İlanlar filtresi her zaman AYNI tesis eşleştirme mantığını kullanır.
 */
export function matchesFacilityFilter(job: Job, selectedFacilityId: string): boolean {
  if (selectedFacilityId === "") return true;
  return resolveJobFacility(job)?.id === selectedFacilityId;
}
