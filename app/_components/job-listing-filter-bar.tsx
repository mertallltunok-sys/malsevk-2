"use client";

import {
  DATE_BUCKET_OPTIONS,
  OFFER_STATUS_FILTER_OPTIONS,
  type DateBucket,
  type FilterOption,
  type JobListingFilterState,
  type OfferStatusFilter,
} from "../_lib/job-listing-filters";
import { isTransportationCategory } from "../_lib/nakliye-route";
import { SearchableSelect } from "./searchable-select";

/** Seçili değeri "Tümü"ne döndürebilmek için her seçilebilir alanın başına eklenen sentetik seçenek. */
const CLEAR_OPTION: FilterOption = { value: "", label: "Tümü" };

/**
 * İnce/kompakt bir filtre araç çubuğu: Hizmet Türü, İl, İlçe, Liman / Sanayi
 * / OSB, Tarih, Teklif Durumu — masaüstünde (≥1024px) tek satır, tablette
 * (640–1023px) düzenli 2 satır (3+3), mobilde alt alta. Odak noktası bilerek
 * ilan kartlarında kalsın diye bu araç çubuğu geri planda, sade ve az dikey
 * alan kaplayan bir bileşendir — ayrı bir arama kutusu YOKTUR (kaldırıldı,
 * bkz. CLAUDE.md "Provider job listing").
 *
 * Türkiye Geneli İl/İlçe: İl artık gerçek bir SearchableSelect'tir
 * (job-listing-filters.ts#buildProvinceOptions ile beslenir) — Kocaeli
 * yalnızca DEFAULT_JOB_LISTING_FILTERS'ın başlangıç değeridir, kilitli/
 * readonly DEĞİLDİR (bkz. görev tanımı madde 9). İl değişince İlçe/Liman-
 * Sanayi-OSB seçimi (başka ile ait kalmasın diye) temizlenir — aynı ilke
 * ilan oluşturma formundaki (job-request-form.tsx) paylaşılan İl'le birebir
 * aynıdır.
 *
 * Tüm SearchableSelect'ler `compact` ile render edilir — bu yalnızca bu
 * araç çubuğunun görünümünü inceltir (daha az padding/daha küçük ikon/daha
 * soluk etiket), job-request-form.tsx/job-edit-form.tsx/login-form.tsx gibi
 * diğer ekranlardaki (compact geçmeyen) SearchableSelect'lerin görünümü
 * hiç değişmez.
 */
export function JobListingFilterBar({
  filters,
  onFiltersChange,
  categoryOptions,
  provinceOptions,
  districtOptions,
  facilityOptions,
  nakliyePickupProvinceOptions,
  nakliyePickupDistrictOptions,
  nakliyeDeliveryProvinceOptions,
  nakliyeDeliveryDistrictOptions,
  onReset,
  hasActiveFilters,
}: {
  filters: JobListingFilterState;
  onFiltersChange: (next: JobListingFilterState) => void;
  categoryOptions: FilterOption[];
  provinceOptions: FilterOption[];
  districtOptions: FilterOption[];
  facilityOptions: FilterOption[];
  /** Yalnızca Hizmet Türü Nakliye iken anlamlı — bkz. aşağıdaki `isNakliye` dalı. */
  nakliyePickupProvinceOptions: FilterOption[];
  nakliyePickupDistrictOptions: FilterOption[];
  nakliyeDeliveryProvinceOptions: FilterOption[];
  nakliyeDeliveryDistrictOptions: FilterOption[];
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  // Nakliye Güzergâh Yönetimi: Hizmet Türü Nakliye iken mevcut İlçe/Bölge-Tesis
  // filtreleri GİZLENİR, yerlerinde Alınacak İl/İlçe + Teslim İli/İlçesi
  // görünür (bkz. görev tanımı madde 9) — genel İl (sabit Kocaeli) kilidi
  // görsel olarak AYNEN kalır. Hizmet Türü Nakliye DIŞINA değiştiğinde eski
  // Nakliye filtre seçimleri de temizlenir (aksi halde kategori değiştirilip
  // geri dönülmeden bu filtreler "hayalet" biçimde uygulanmaya devam ederdi).
  const isNakliye = isTransportationCategory(filters.category);

  function patch(partial: Partial<JobListingFilterState>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function handleCategoryChange(value: string) {
    if (isTransportationCategory(value)) {
      patch({ category: value });
    } else {
      patch({
        category: value,
        nakliyePickupProvince: "",
        nakliyePickupDistrict: "",
        nakliyeDeliveryProvince: "",
        nakliyeDeliveryDistrict: "",
      });
    }
  }

  /** İl değişince İlçe/Liman-Sanayi-OSB seçimi geçersizleşir — başka ile ait bir ilçe/tesis seçili kalamaz (bkz. görev tanımı madde 1/9). */
  function handleProvinceChange(value: string) {
    patch({ province: value, district: "", facility: "" });
  }

  /** İlçe değişince yalnızca bölge/tesis seçimi geçersizleşir. */
  function handleDistrictChange(value: string) {
    patch({ district: value, facility: "" });
  }

  /** Alınacak İl değişince Alınacak İlçe temizlenir — başka ile ait bir ilçe seçili kalamaz (bkz. görev tanımı madde 9). */
  function handleNakliyePickupProvinceChange(value: string) {
    patch({ nakliyePickupProvince: value, nakliyePickupDistrict: "" });
  }

  /** Teslim İli değişince Teslim İlçesi temizlenir — AYNI kural, delivery için. */
  function handleNakliyeDeliveryProvinceChange(value: string) {
    patch({ nakliyeDeliveryProvince: value, nakliyeDeliveryDistrict: "" });
  }

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 shadow-sm">
      <div
        className={`grid grid-cols-1 items-start gap-2.5 sm:grid-cols-3 sm:gap-3 ${isNakliye ? "lg:grid-cols-4" : "lg:grid-cols-6"}`}
      >
        <SearchableSelect
          id="job-listing-filter-category"
          label="Hizmet Türü"
          options={[CLEAR_OPTION, ...categoryOptions]}
          value={filters.category}
          onChange={handleCategoryChange}
          placeholder="Tümü"
          compact
        />

        <SearchableSelect
          id="job-listing-filter-province"
          label="İl"
          options={[CLEAR_OPTION, ...provinceOptions]}
          value={filters.province}
          onChange={handleProvinceChange}
          placeholder="Tümü"
          compact
        />

        {isNakliye ? (
          <>
            <SearchableSelect
              id="job-listing-filter-nakliye-pickup-province"
              label="Alınacak İl"
              options={[CLEAR_OPTION, ...nakliyePickupProvinceOptions]}
              value={filters.nakliyePickupProvince}
              onChange={handleNakliyePickupProvinceChange}
              placeholder="Tümü"
              compact
            />

            <SearchableSelect
              id="job-listing-filter-nakliye-pickup-district"
              label="Alınacak İlçe"
              options={[CLEAR_OPTION, ...nakliyePickupDistrictOptions]}
              value={filters.nakliyePickupDistrict}
              onChange={(value) => patch({ nakliyePickupDistrict: value })}
              placeholder="Tümü"
              disabled={filters.nakliyePickupProvince === ""}
              disabledHint="Önce il seçin"
              compact
            />

            <SearchableSelect
              id="job-listing-filter-nakliye-delivery-province"
              label="Teslim İli"
              options={[CLEAR_OPTION, ...nakliyeDeliveryProvinceOptions]}
              value={filters.nakliyeDeliveryProvince}
              onChange={handleNakliyeDeliveryProvinceChange}
              placeholder="Tümü"
              compact
            />

            <SearchableSelect
              id="job-listing-filter-nakliye-delivery-district"
              label="Teslim İlçesi"
              options={[CLEAR_OPTION, ...nakliyeDeliveryDistrictOptions]}
              value={filters.nakliyeDeliveryDistrict}
              onChange={(value) => patch({ nakliyeDeliveryDistrict: value })}
              placeholder="Tümü"
              disabled={filters.nakliyeDeliveryProvince === ""}
              disabledHint="Önce il seçin"
              compact
            />
          </>
        ) : (
          <>
            <SearchableSelect
              id="job-listing-filter-district"
              label="İlçe"
              options={[CLEAR_OPTION, ...districtOptions]}
              value={filters.district}
              onChange={handleDistrictChange}
              placeholder="Tümü"
              disabled={filters.province === ""}
              disabledHint="Önce il seçin"
              compact
            />

            <SearchableSelect
              id="job-listing-filter-facility"
              label="Liman / Sanayi / OSB"
              options={[CLEAR_OPTION, ...facilityOptions]}
              value={filters.facility}
              onChange={(value) => patch({ facility: value })}
              placeholder="Tümü"
              disabled={filters.district === ""}
              disabledHint="Önce ilçe seçin"
              compact
            />
          </>
        )}

        <SearchableSelect
          id="job-listing-filter-date"
          label="Tarih"
          options={DATE_BUCKET_OPTIONS}
          value={filters.dateBucket}
          onChange={(value) => patch({ dateBucket: value as DateBucket })}
          placeholder="Tümü"
          compact
        />

        <SearchableSelect
          id="job-listing-filter-offer-status"
          label="Teklif Durumu"
          options={OFFER_STATUS_FILTER_OPTIONS}
          value={filters.offerStatus}
          onChange={(value) => patch({ offerStatus: value as OfferStatusFilter })}
          placeholder="Tümü"
          compact
        />
      </div>

      {hasActiveFilters && (
        <div className="mt-2.5 flex justify-end border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
          >
            Filtreleri Temizle
          </button>
        </div>
      )}
    </div>
  );
}
