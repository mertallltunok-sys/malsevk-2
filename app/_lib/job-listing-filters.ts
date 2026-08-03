import { resolveJobFacility } from "./job-location";
import { isOfferVisibleInNormalLists } from "./job-requests";
import { isTransportationCategory } from "./nakliye-route";
import { getOfferForJob } from "./offers";
import { resolveLegacyJobCategoryToId, SERVICE_CATEGORY_GROUPS } from "./service-catalog";
import { slugifyTurkish } from "./turkish-text";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceCodeBySlug,
  getProvinces,
} from "./turkey-locations";
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

/**
 * Türkiye Geneli İl/İlçe: İl filtresi artık `job-listing-filter-bar.tsx`'te
 * gerçek bir `SearchableSelect` (bu dosyadaki `buildProvinceOptions`/
 * `matchesProvinceFilter` ile beslenen) — Kocaeli yalnızca başlangıç
 * varsayılanıdır, kilitli/readonly DEĞİLDİR. Anahtar, `resolveJobProvinceKey`
 * ile ayrı bir yerde tekrar üretilmesi gereken bir ham string olarak DEĞİL,
 * tesis/ilan eşleştirmesinde zaten kullanılan aynı `slugifyTurkish` üzerinden
 * türetilir.
 */
export const FIXED_PROVINCE_LABEL = "Kocaeli";
export const FIXED_PROVINCE_KEY = slugifyTurkish(FIXED_PROVINCE_LABEL);

export type JobListingFilterState = {
  /** service-catalog.ts#SERVICE_CATEGORY_GROUPS'taki bir kategori id'si, ya da "" (Tümü). */
  category: string;
  /** `slugifyTurkish(job.province)` ile üretilen il anahtarı — Türkiye geneli serbestçe seçilebilir, başlangıç değeri FIXED_PROVINCE_KEY (bkz. yukarıdaki not). */
  province: string;
  /** `getDistrictId(job.district)` ile üretilen ilçe anahtarı, ya da "" (Tümü). */
  district: string;
  /** turkey-locations.ts#Facility.id, ya da "" (Tümü). District seçilmeden anlamsızdır. */
  facility: string;
  dateBucket: DateBucket;
  offerStatus: OfferStatusFilter;
  /**
   * Nakliye Güzergâh Yönetimi — yalnızca `category` Nakliye'nin kendi id'sine
   * eşitken görünür/uygulanır (bkz. job-listing-filter-bar.tsx) ve o durumda
   * yukarıdaki `district`/`facility`nin YERİNE geçer — `province` (genel,
   * sabit Kocaeli kilidi) ayrı kalır, kilit görsel olarak DEĞİŞMEZ, ama
   * Nakliye satırları için eşleştirmede KULLANILMAZ (bkz.
   * provider-job-listing.tsx — pickup artık serbestçe seçilebildiği için bu
   * genel kilidi Nakliye satırlarına uygulamak, Kocaeli dışı pickup'lı her
   * Nakliye ilanını bu ekrandan tamamen gizlerdi). `nakliyePickupProvince`/
   * `nakliyePickupDistrict` job.province/job.district'in (pickup'ın kendisi)
   * anahtarlarıdır — `resolveJobProvinceKey`/`resolveJobDistrictKey` ile AYNI
   * şema.
   */
  nakliyePickupProvince: string;
  nakliyePickupDistrict: string;
  /** `job.deliveryProvince`/`job.deliveryDistrict`in anahtarları — AYNI şema. */
  nakliyeDeliveryProvince: string;
  nakliyeDeliveryDistrict: string;
};

export const DEFAULT_JOB_LISTING_FILTERS: JobListingFilterState = {
  category: "",
  province: FIXED_PROVINCE_KEY,
  district: "",
  facility: "",
  dateBucket: "tumu",
  offerStatus: "tumu",
  nakliyePickupProvince: "",
  nakliyePickupDistrict: "",
  nakliyeDeliveryProvince: "",
  nakliyeDeliveryDistrict: "",
};

export function hasActiveFilters(filters: JobListingFilterState): boolean {
  return (
    filters.category !== "" ||
    filters.province !== FIXED_PROVINCE_KEY ||
    filters.district !== "" ||
    filters.facility !== "" ||
    filters.dateBucket !== "tumu" ||
    filters.offerStatus !== "tumu" ||
    filters.nakliyePickupProvince !== "" ||
    filters.nakliyePickupDistrict !== "" ||
    filters.nakliyeDeliveryProvince !== "" ||
    filters.nakliyeDeliveryDistrict !== ""
  );
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
 * İl seçenekleri — İlçe/Bölge-Tesis filtreleriyle AYNI ilkeyle, o an
 * ekrandaki ilan verisinden DEĞİL, turkey-locations.ts'in merkezi il
 * referans verisinden (`getProvinces()`, ilan oluşturma/düzenleme
 * formlarının kullandığı AYNI 81 illik kaynak) gelir. ÖNCEDEN (bug) bu
 * liste yalnızca o an en az bir ilanı olan illeri gösteriyordu — Kocaeli
 * ağırlıklı örnek/seed verisiyle pratikte yalnızca 2-3 il listede
 * görünüyordu (bkz. buildDistrictOptions'ın aynı sınıf, zaten düzeltilmiş
 * hatası). Artık seçili ilde/hiçbir ilde hiç ilan olmasa da Türkiye'nin 81
 * ili eksiksiz listelenir. Anahtar (value) yine `resolveJobProvinceKey`
 * (slugifyTurkish) ile üretilir — matchesProvinceFilter'ın job.province'i
 * çözerken kullandığı AYNI şema, ayrı bir eşleştirme yolu icat edilmez.
 * `job-listing-filter-bar.tsx`'teki İl `SearchableSelect`ini besleyen kaynak.
 */
export function buildProvinceOptions(): FilterOption[] {
  return getProvinces()
    .map((province) => ({ value: resolveJobProvinceKey(province.name), label: province.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * İlçe seçenekleri — Bölge/Tesis filtresiyle AYNI ilkeyle, o an ekrandaki
 * ilan verisinden DEĞİL, turkey-locations.ts'in merkezi il/ilçe referans
 * verisinden (`getDistrictsByProvinceCode`, `app/_data/turkey/districts.json`)
 * gelir. ÖNCEDEN (bug) bu liste yalnızca o an en az bir ilanı olan ilçeleri
 * gösteriyordu — bir ilin resmî ilçelerinden çoğu hiç ilan almadıysa listede
 * hiç görünmüyordu (ör. Kocaeli'nin 12 ilçesinden yalnızca 2-3'ü). Artık
 * seçili ilin TÜM resmî ilçeleri, o ilçede hiç ilan olmasa bile listelenir.
 * Seçili bir il YOKSA (`selectedProvinceKey === ""`) ya da il koduna
 * çözülemeyen bir anahtarsa boş dizi döner.
 */
export function buildDistrictOptions(selectedProvinceKey: string): FilterOption[] {
  if (selectedProvinceKey === "") return [];
  const provinceCode = getProvinceCodeBySlug(selectedProvinceKey);
  if (!provinceCode) return [];
  return getDistrictsByProvinceCode(provinceCode)
    .map((districtName) => ({ value: getDistrictId(districtName), label: districtName }))
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

function buildProvinceOptionsFromNames(names: string[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = resolveJobProvinceKey(trimmed);
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * "Alınacak İl" seçenekleri — Nakliye ilanlarının PICKUP'ı (job.province,
 * mevcut/paylaşılan alan) artık serbestçe seçilebildiği için (bkz.
 * nakliye-route.ts) burada da `buildProvinceOptions` ile AYNI "gerçek
 * kayıtlı ilan verisinden türet" ilkesi kullanılır — yalnızca Nakliye
 * ilanları arasından, o an ekrandaki listeden (görev tanımı madde 9:
 * "Filtre sonuçları gerçek kayıtlı güzergâh verilerine göre hesaplanmalı").
 */
export function buildNakliyePickupProvinceOptions(jobs: Job[]): FilterOption[] {
  return buildProvinceOptionsFromNames(
    jobs.filter((job) => isTransportationCategory(job.category)).map((job) => job.province),
  );
}

/** "Teslim İli" seçenekleri — `buildNakliyePickupProvinceOptions` ile AYNI ilke, `job.deliveryProvince` üzerinden. */
export function buildNakliyeDeliveryProvinceOptions(jobs: Job[]): FilterOption[] {
  return buildProvinceOptionsFromNames(
    jobs
      .filter((job): job is Job & { deliveryProvince: string } => isTransportationCategory(job.category) && Boolean(job.deliveryProvince))
      .map((job) => job.deliveryProvince),
  );
}

/** "Alınacak İl" eşleştirmesi — pickup === job.province (mevcut/paylaşılan alan), matchesProvinceFilter'ın AYNEN kullanımı. */
export function matchesNakliyePickupProvinceFilter(job: Job, selectedProvinceKey: string): boolean {
  return matchesProvinceFilter(job, selectedProvinceKey);
}

/** "Alınacak İlçe" eşleştirmesi — pickup === job.district (mevcut/paylaşılan alan), matchesDistrictFilter'ın AYNEN kullanımı. */
export function matchesNakliyePickupDistrictFilter(job: Job, selectedDistrictKey: string): boolean {
  return matchesDistrictFilter(job, selectedDistrictKey);
}

/** "Teslim İli" eşleştirmesi — job.deliveryProvince üzerinden, matchesProvinceFilter ile AYNI anahtar şeması. */
export function matchesNakliyeDeliveryProvinceFilter(job: Job, selectedProvinceKey: string): boolean {
  if (selectedProvinceKey === "") return true;
  if (!job.deliveryProvince) return false;
  return resolveJobProvinceKey(job.deliveryProvince) === selectedProvinceKey;
}

/** "Teslim İlçesi" eşleştirmesi — job.deliveryDistrict üzerinden, matchesDistrictFilter ile AYNI anahtar şeması. */
export function matchesNakliyeDeliveryDistrictFilter(job: Job, selectedDistrictKey: string): boolean {
  if (selectedDistrictKey === "") return true;
  if (!job.deliveryDistrict) return false;
  return resolveJobDistrictKey(job.deliveryDistrict) === selectedDistrictKey;
}
