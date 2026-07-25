"use client";

import { ChevronDown, Heart } from "lucide-react";
import {
  GENERAL_BADGE_OPTIONS,
  PROVIDER_BADGE_OPTIONS,
} from "../_lib/job-listing-badges";
import {
  DATE_BUCKET_OPTIONS,
  OFFER_STATUS_FILTER_OPTIONS,
  type DateBucket,
  type FilterOption,
  type JobListingFilterState,
  type OfferStatusFilter,
} from "../_lib/job-listing-filters";
import { useDropdown } from "../_lib/use-dropdown";
import { SearchableSelect } from "./searchable-select";

const ALL_BADGE_OPTIONS = [...GENERAL_BADGE_OPTIONS, ...PROVIDER_BADGE_OPTIONS];

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

function BadgeFilterDropdown({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();

  function toggle(kind: string) {
    onChange(selected.includes(kind) ? selected.filter((item) => item !== kind) : [...selected, kind]);
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="text-xs font-medium text-muted-foreground">Rozetler</span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="true"
        aria-expanded={open}
        className="mt-1.5 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Rozetlere göre{selected.length > 0 ? ` (${selected.length})` : ""}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Rozetlere göre filtrele"
          className="absolute z-50 mt-2 w-64 rounded-card border border-border bg-surface p-3 shadow-md"
        >
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {ALL_BADGE_OPTIONS.map((option) => (
              <label key={option.kind} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={selected.includes(option.kind)}
                  onChange={() => toggle(option.kind)}
                  className="h-4 w-4 accent-primary focus-visible:outline-none"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function JobListingFilterBar({
  filters,
  onFiltersChange,
  categoryOptions,
  provinceOptions,
  districtOptions,
  onReset,
  hasActiveFilters,
}: {
  filters: JobListingFilterState;
  onFiltersChange: (next: JobListingFilterState) => void;
  categoryOptions: FilterOption[];
  provinceOptions: FilterOption[];
  districtOptions: FilterOption[];
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  function patch(partial: Partial<JobListingFilterState>) {
    onFiltersChange({ ...filters, ...partial });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          onChange={(value) => patch({ province: value, district: "" })}
          placeholder="Tümü"
        />
        <SearchableSelect
          id="job-listing-filter-district"
          label="İlçe"
          options={[CLEAR_OPTION, ...districtOptions]}
          value={filters.district}
          onChange={(value) => patch({ district: value })}
          placeholder="Tümü"
        />
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
        <BadgeFilterDropdown
          selected={filters.badgeKinds}
          onChange={(badgeKinds) => patch({ badgeKinds })}
        />

        <div>
          <span className="text-xs font-medium text-muted-foreground">Favoriler</span>
          <div className="mt-1.5">
            <button
              type="button"
              aria-pressed={filters.onlyFavorites}
              onClick={() => patch({ onlyFavorites: !filters.onlyFavorites })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                filters.onlyFavorites
                  ? "border-danger bg-danger-soft text-danger"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Heart className="h-3.5 w-3.5" fill={filters.onlyFavorites ? "currentColor" : "none"} aria-hidden="true" />
              Yalnızca Favorilerim
            </button>
          </div>
        </div>

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
