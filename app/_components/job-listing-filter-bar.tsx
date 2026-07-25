"use client";

import {
  DATE_BUCKET_OPTIONS,
  OFFER_STATUS_FILTER_OPTIONS,
  type DateBucket,
  type FilterOption,
  type JobListingFilterState,
  type OfferStatusFilter,
} from "../_lib/job-listing-filters";
import { SearchableSelect } from "./searchable-select";

/** Seçili değeri "Tümü"ne döndürebilmek için her seçilebilir alanın başına eklenen sentetik seçenek. */
const CLEAR_OPTION: FilterOption = { value: "", label: "Tümü" };

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              value === option.value
                ? "border-primary bg-accent-soft text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function JobListingFilterBar({
  filters,
  onFiltersChange,
  categoryOptions,
  provinceOptions,
  districtOptions,
  facilityOptions,
  onReset,
  hasActiveFilters,
}: {
  filters: JobListingFilterState;
  onFiltersChange: (next: JobListingFilterState) => void;
  categoryOptions: FilterOption[];
  provinceOptions: FilterOption[];
  districtOptions: FilterOption[];
  facilityOptions: FilterOption[];
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  function patch(partial: Partial<JobListingFilterState>) {
    onFiltersChange({ ...filters, ...partial });
  }

  /** İl değişince altındaki ilçe VE bölge/tesis seçimleri artık geçersizdir — job-request-form.tsx'teki İl->İlçe->Yer Türü kademesiyle aynı davranış. */
  function handleProvinceChange(value: string) {
    patch({ province: value, district: "", facility: "" });
  }

  /** İlçe değişince yalnızca bölge/tesis seçimi geçersizleşir, il aynı kalır. */
  function handleDistrictChange(value: string) {
    patch({ district: value, facility: "" });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SearchableSelect
          id="job-listing-filter-category"
          label="Hizmet Türü"
          options={[CLEAR_OPTION, ...categoryOptions]}
          value={filters.category}
          onChange={(value) => patch({ category: value })}
          placeholder="Tümü"
        />
        <SearchableSelect
          id="job-listing-filter-province"
          label="İl"
          options={[CLEAR_OPTION, ...provinceOptions]}
          value={filters.province}
          onChange={handleProvinceChange}
          placeholder="Tümü"
        />
        <SearchableSelect
          id="job-listing-filter-district"
          label="İlçe"
          options={[CLEAR_OPTION, ...districtOptions]}
          value={filters.district}
          onChange={handleDistrictChange}
          placeholder="Tümü"
          disabled={filters.province === ""}
          disabledHint="Önce şehir seçin"
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
        />
        <div>
          <label htmlFor="job-listing-filter-company" className="text-sm font-medium text-foreground">
            Firma / Fabrika Ara
          </label>
          <input
            id="job-listing-filter-company"
            type="text"
            value={filters.companyQuery}
            onChange={(event) => patch({ companyQuery: event.target.value })}
            placeholder="Firma veya fabrika adı"
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <SegmentedControl<DateBucket>
          label="Tarih"
          options={DATE_BUCKET_OPTIONS}
          value={filters.dateBucket}
          onChange={(value) => patch({ dateBucket: value })}
        />
        <SegmentedControl<OfferStatusFilter>
          label="Teklif Durumu"
          options={OFFER_STATUS_FILTER_OPTIONS}
          value={filters.offerStatus}
          onChange={(value) => patch({ offerStatus: value })}
        />

        {hasActiveFilters && (
          <div className="ml-auto">
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
    </div>
  );
}
