"use client";

import { Lock } from "lucide-react";
import {
  DATE_BUCKET_OPTIONS,
  FIXED_PROVINCE_LABEL,
  OFFER_STATUS_FILTER_OPTIONS,
  type DateBucket,
  type FilterOption,
  type JobListingFilterState,
  type OfferStatusFilter,
} from "../_lib/job-listing-filters";
import { SearchableSelect } from "./searchable-select";

/** Seçili değeri "Tümü"ne döndürebilmek için her seçilebilir alanın başına eklenen sentetik seçenek. */
const CLEAR_OPTION: FilterOption = { value: "", label: "Tümü" };

/**
 * İnce/kompakt bir filtre araç çubuğu: Hizmet Türü, İl (sabit), İlçe,
 * Bölge/Tesis, Tarih, Teklif Durumu — masaüstünde (≥1024px) tek satır,
 * tablette (640–1023px) düzenli 2 satır (3+3), mobilde alt alta. Odak noktası
 * bilerek ilan kartlarında kalsın diye bu araç çubuğu geri planda, sade ve az
 * dikey alan kaplayan bir bileşendir — ayrı bir arama kutusu YOKTUR (kaldırıldı,
 * bkz. CLAUDE.md "Provider job listing").
 *
 * İl filtresi artık bir SearchableSelect değil: MALSEVK'in Kocaeli-odaklı
 * ilk sürümünde sabit/readonly bir değerdir (bkz. FIXED_PROVINCE_LABEL,
 * job-listing-filters.ts). `province` yine de filtre state'inin bir parçası
 * olarak (her zaman FIXED_PROVINCE_KEY değerinde) kalır — Türkiye geneline
 * açılınca bu blok, aynı filtre mantığına dokunmadan, tekrar bir
 * SearchableSelect'e çevrilebilir (bkz. job-listing-filters.ts#buildProvinceOptions).
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
  districtOptions,
  facilityOptions,
  onReset,
  hasActiveFilters,
}: {
  filters: JobListingFilterState;
  onFiltersChange: (next: JobListingFilterState) => void;
  categoryOptions: FilterOption[];
  districtOptions: FilterOption[];
  facilityOptions: FilterOption[];
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  function patch(partial: Partial<JobListingFilterState>) {
    onFiltersChange({ ...filters, ...partial });
  }

  /** İlçe değişince yalnızca bölge/tesis seçimi geçersizleşir. */
  function handleDistrictChange(value: string) {
    patch({ district: value, facility: "" });
  }

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 shadow-sm">
      <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <SearchableSelect
          id="job-listing-filter-category"
          label="Hizmet Türü"
          options={[CLEAR_OPTION, ...categoryOptions]}
          value={filters.category}
          onChange={(value) => patch({ category: value })}
          placeholder="Tümü"
          compact
        />

        <div>
          <span className="text-xs font-medium text-muted-foreground">İl</span>
          <div
            className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
            aria-readonly="true"
          >
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate text-foreground">{FIXED_PROVINCE_LABEL}</span>
          </div>
        </div>

        <SearchableSelect
          id="job-listing-filter-district"
          label="İlçe"
          options={[CLEAR_OPTION, ...districtOptions]}
          value={filters.district}
          onChange={handleDistrictChange}
          placeholder="Tümü"
          compact
        />

        <SearchableSelect
          id="job-listing-filter-facility"
          label="Bölge / Tesis"
          options={[CLEAR_OPTION, ...facilityOptions]}
          value={filters.facility}
          onChange={(value) => patch({ facility: value })}
          placeholder="Tümü"
          disabled={filters.district === ""}
          disabledHint="Önce ilçe seçin"
          compact
        />

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
