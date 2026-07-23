"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { foldTurkish } from "../_lib/turkish-text";

export type MultiSelectOption = { value: string; label: string };

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
}: {
  id: string;
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  errorId?: string;
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
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div
        id={id}
        aria-describedby={errorId}
        className={`mt-2 rounded-md border bg-surface p-3 ${invalid ? "border-danger" : "border-border"}`}
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
                  onClick={() => toggle(option.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
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
