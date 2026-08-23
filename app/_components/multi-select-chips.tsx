"use client";

import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { foldTurkish } from "../_lib/turkish-text";
import { useDropdown } from "../_lib/use-dropdown";

export type MultiSelectOption = { value: string; label: string; description?: string; groupLabel?: string };

/**
 * Genel amaçlı çoklu seçim bileşeni — searchable-select.tsx'in tekli seçim
 * modeliyle karıştırılmamalı (o `value: string`, bu `selected: string[]`
 * alır). Hizmet Veren firma profilindeki "Hizmet Verilen Bölgeler" (81 il,
 * `searchable`) ve "Uzmanlık Alanları" (8 sabit kategori, arama gerekmez)
 * alanlarının ikisi de aynı bileşeni paylaşır — aynı işi yapan iki ayrı
 * çoklu seçim arayüzü yazılmaz.
 */
export function MultiSelectChips({
  id,
  label,
  options,
  selected,
  onChange,
  searchable = false,
  searchPlaceholder = "Ara...",
  errorId,
  headerAction,
}: {
  id: string;
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  errorId?: string;
  /**
   * Etiketin YANINDA (aynı satırda, sağa hizalı) gösterilen isteğe bağlı
   * bir eylem — ör. recycling-fields.tsx'in "Tüm Süreç" hızlı seçim
   * butonu. Varsayılan `undefined`: diğer çağrı yerlerinin (Hizmet
   * Verilen Bölgeler/Uzmanlık Alanları) görünümü BİREBİR AYNI kalır.
   */
  headerAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  const invalid = Boolean(errorId);

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return options;
    const folded = foldTurkish(trimmed);
    return options.filter((option) => foldTurkish(option.label).includes(folded));
  }, [options, query]);

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {headerAction}
      </div>
      <div
        id={id}
        tabIndex={-1}
        aria-describedby={errorId}
        className={`mt-2 rounded-md border bg-surface p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${invalid ? "border-danger" : "border-border"}`}
      >
        {searchable && (
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={`${label} içinde ara`}
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        )}
        <div role="group" aria-label={label} className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <p className="px-1 py-1 text-sm text-muted-foreground">Sonuç bulunamadı.</p>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  title={option.description}
                  onClick={() => toggle(option.value)}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                    isSelected
                      ? "border-primary bg-accent-soft text-primary"
                      : "border-border bg-surface text-foreground hover:border-primary/40"
                  }`}
                >
                  {isSelected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  {option.label}
                </button>
              );
            })
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {selected.length === 0 ? "Henüz seçim yapılmadı." : `${selected.length} seçildi`}
      </p>
    </div>
  );
}

/**
 * Nakliye Yeniden Tasarımı görevi (görsel düzeltme turu) — `MultiSelectChips`
 * ile AYNI `options`/`selected`/`onChange` sözleşmesini paylaşan, ama
 * KAPALI başlayan, kompakt bir varyant: tetikleyici tek satırlık bir seçim
 * kutusu gibi görünür (seçili değerlerin kısa özetiyle), yalnızca tıklanınca
 * onay kutulu bir liste açılır. Araç Tipi/Kasa-Dorse Tipi gibi çok sayıda
 * (10-14) seçeneği olan alanların sayfada sürekli açık bir "seçenek
 * duvarı" olarak durmasını önlemek için — `MultiSelectChips`in KENDİSİ
 * değiştirilmez (Hizmet Verilen Bölgeler/Uzmanlık Alanları/vb. onlarca
 * mevcut çağrı yeri birebir aynı kalır), bu tamamen ayrı, ek bir bileşendir.
 */
export function CompactMultiSelect({
  id,
  label,
  options,
  selected,
  onChange,
  placeholder = "Seçiniz",
  disabled = false,
}: {
  id: string;
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const selectedSet = new Set(selected);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} seçildi`;

  function toggle(value: string) {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-3 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`truncate ${selectedLabels.length === 0 ? "text-muted-foreground" : ""}`}>{summary}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-surface p-2 shadow-md">
          <div role="group" aria-label={label} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {(() => {
              // "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi —
              // storage-container-catalog.ts#IMO_CLASS_SELECT_ITEMS İLE AYNI
              // "tek geçişte, ardışık aynı groupLabel'i topla" ilkesi.
              // groupLabel HİÇBİR mevcut çağıranda (Araç Tipi/Kasa-Dorse Tipi/
              // Hizmet Verilen Bölgeler) kullanılmıyor — bu yüzden görünüm
              // BİREBİR AYNI kalır, yalnızca yeni bir opsiyonel alan.
              let lastGroupLabel: string | undefined;
              return options.map((option) => {
                const isSelected = selectedSet.has(option.value);
                const showGroupHeader = option.groupLabel && option.groupLabel !== lastGroupLabel;
                lastGroupLabel = option.groupLabel;
                return (
                  <div key={option.value}>
                    {showGroupHeader && (
                      <p className="mt-1.5 px-2 pb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground first:mt-0">
                        {option.groupLabel}
                      </p>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-background">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(option.value)}
                        className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      {option.label}
                    </label>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
