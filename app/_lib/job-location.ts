import { getFacilitiesByProvinceAndDistrict, getDistrictId, getFacilityTypeLabel, type Facility } from "./turkey-locations";
import { foldTurkish, slugifyTurkish } from "./turkish-text";
import type { Job } from "./types";

/**
 * job-request-form.tsx/job-edit-form.tsx'in Bölge/Tesis SearchableSelect'inde
 * sentetik "Listede yok — tesis bilgilerini kendim gireceğim" (özel tesis)
 * seçeneğinin value'su. Gerçek Facility.id'ler data/locations/locations.json'dan
 * gelir ve bu değerle asla çakışmaz. Seçildiğinde ilan `locationMode: "custom"`
 * ile kaydedilir (bkz. job-store.ts#resolveLocationFields).
 */
export const FACILITY_FREE_TEXT_VALUE = "__diger__";

/** job-request-form.tsx/job-edit-form.tsx'teki özel tesis seçeneğinin görünen etiketi — tek yerde tanımlanır, ikisi de aynı metni kullanır. */
export const CUSTOM_FACILITY_OPTION_LABEL = "Listede yok — tesis bilgilerini kendim gireceğim";

/** searchable-select.tsx#SearchableSelectOption ile yapısal olarak aynı — _lib, _components'e bağımlı olmasın diye burada ayrıca tanımlanır (job-listing-filters.ts#FilterOption ile aynı desen). */
export type FacilitySelectOption = { value: string; label: string; hint?: string; keywords?: string[] };

/**
 * Bir il+ilçe kapsamındaki tesisleri (bkz. getFacilitiesByProvinceAndDistrict),
 * alfabetik sıralı + sona eklenen "Listede yok / Diğer" seçeneğiyle birlikte
 * SearchableSelect seçeneklerine çevirir. `hint` = tesis türü etiketi (ör.
 * "Liman") — yalnızca görsel bir ayraç, arama `keywords` (takma adlar)
 * üzerinden çalışır.
 */
export function toFacilitySelectOptions(facilities: Facility[]): FacilitySelectOption[] {
  return [
    ...facilities
      .map((facility) => ({
        value: facility.id,
        label: facility.name,
        hint: getFacilityTypeLabel(facility.type),
        keywords: facility.aliases,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr")),
    { value: FACILITY_FREE_TEXT_VALUE, label: CUSTOM_FACILITY_OPTION_LABEL },
  ];
}

/**
 * Bir ilanın Facility'sini çözer — ÖNCE job.facilityId (kendi il+ilçesi
 * kapsamında doğrulanır), facilityId yoksa VEYA o kapsamda artık
 * bulunamıyorsa (veri tutarsızlığı/katalog değişmiş) job.workLocationType'ı
 * ad/takma ad üzerinden fold-eşleştirir (eski ilanlar ya da "Listede yok"
 * seçilerek girilmiş serbest metin). Eşleşme yoksa null — veri kaybı
 * değildir. job-listing-filters.ts#matchesFacilityFilter de AYNI bu
 * fonksiyonu kullanır (ayrı bir kopyası tutulmaz).
 *
 * `locationMode === "custom"` olan ilanlarda ad/takma-ad eşleştirmesi
 * BİLEREK hiç denenmez — kullanıcının serbestçe yazdığı bir tesis/işletme
 * adı tesadüfen katalogdaki gerçek bir tesisin adı/alias'ıyla eşleşse bile
 * (ör. "Beldeport" yazması), bu ilan o gerçek tesisle YANLIŞLIKLA
 * ilişkilendirilmemeli. Bu ayrım yalnızca locationMode alanı olan (bu
 * özellikten SONRA oluşturulmuş) ilanlarda mümkündür; eski serbest-metin
 * ilanlarda (locationMode yok) eşleştirme öncekiyle AYNI şekilde çalışmaya
 * devam eder — bu, geriye dönük uyumluluğu koruyan bilinçli bir sınırdır.
 */
export function resolveJobFacility(job: Job): Facility | null {
  if (job.locationMode === "custom") return null;

  const provinceKey = slugifyTurkish(job.province);
  const districtKey = getDistrictId(job.district);
  const candidates = getFacilitiesByProvinceAndDistrict(provinceKey, districtKey);
  if (candidates.length === 0) return null;

  if (job.facilityId) {
    const byId = candidates.find((facility) => facility.id === job.facilityId);
    if (byId) return byId;
  }

  const foldedWorkLocation = foldTurkish(job.workLocationType.trim());
  if (!foldedWorkLocation) return null;
  return (
    candidates.find(
      (facility) =>
        foldTurkish(facility.name) === foldedWorkLocation ||
        facility.aliases.some((alias) => foldTurkish(alias) === foldedWorkLocation),
    ) ?? null
  );
}

export type JobLocationSummary = {
  /** job.companyOrFactoryName, trim'lenmiş; boş/yok ise null (asla ""). */
  companyOrFactoryName: string | null;
  /** Bölge/Tesis görünen adı — resolveJobFacility bulabiliyorsa Facility.name, bulamıyorsa job.workLocationType aynen (her zaman dolu, zorunlu bir alan). */
  facilityDisplayName: string;
  /** Yalnızca resolveJobFacility bir Facility bulabiliyorsa dolu; serbest metin/eski ilanlarda null. */
  facilityTypeLabel: string | null;
  district: string;
  province: string;
};

export function getJobLocationSummary(job: Job): JobLocationSummary {
  const facility = resolveJobFacility(job);
  return {
    companyOrFactoryName: job.companyOrFactoryName?.trim() || null,
    facilityDisplayName: facility?.name ?? job.workLocationType,
    facilityTypeLabel: facility ? getFacilityTypeLabel(facility.type) : null,
    district: job.district,
    province: job.province,
  };
}

/**
 * Kısa tek satır özet — kart/liste bağlamları için. Firma adı BİLEREK
 * dışarıda bırakılır (kart/liste bağlamları firma adını ayrı, kendi
 * satırında gösterir — bkz. job-listing-row.ts/job-listing-table.tsx).
 * Örnek: "İMES OSB • Dilovası / Kocaeli".
 */
export function formatJobLocationLine(job: Job): string {
  const summary = getJobLocationSummary(job);
  return `${summary.facilityDisplayName} • ${summary.district} / ${summary.province}`;
}
