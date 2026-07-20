"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useDropdown } from "../_lib/use-dropdown";
import { foldTurkish } from "../_lib/turkish-text";

/**
 * `keywords`: label'a ek arama alternatifleri (ör. bir tesisin aliases
 * dizisi — "Yılport", "Yilport", "YILPORT"). Yalnızca arama eşleştirmesi
 * için kullanılır; ekranda hep `label` gösterilir.
 */
export type SearchableSelectOption = {
  value: string;
  label: string;
  hint?: string;
  keywords?: string[];
};

export function SearchableSelect({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = "Seçiniz",
  disabled = false,
  disabledHint,
  errorId,
}: {
  id: string;
  label: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  errorId?: string;
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return options;
    // Türkçe-duyarlı: "Yilport"/"YILPORT"/"Yılport" hepsi aynı kabul edilir
    // (İ/I/ı/i farkı yok sayılır). Yalnızca arama için normalize edilir —
    // ekranda her zaman option.label'ın orijinal Türkçe hali gösterilir.
    const folded = foldTurkish(trimmed);
    return options.filter((option) => {
      if (foldTurkish(option.label).includes(folded)) return true;
      return (option.keywords ?? []).some((keyword) => foldTurkish(keyword).includes(folded));
    });
  }, [options, query]);

  const selectedLabel = options.find((option) => option.value === value)?.label;

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={errorId}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`truncate ${selectedLabel ? "text-foreground" : "text-muted-foreground"}`}
        >
          {selectedLabel ?? (disabled && disabledHint ? disabledHint : placeholder)}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-2 w-full rounded-card border border-border bg-surface shadow-md">
          <div className="border-b border-border p-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ara..."
              aria-label={`${label} içinde ara`}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <ul role="listbox" aria-label={label} className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">Sonuç bulunamadı.</li>
            ) : (
              filteredOptions.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => handleSelect(option.value)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      option.value === value ? "bg-accent-soft text-primary" : "text-foreground"
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.hint && (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
