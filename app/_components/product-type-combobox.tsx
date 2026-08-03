"use client";

import { useMemo } from "react";
import { useDropdown } from "../_lib/use-dropdown";
import { useFocusOnBecomeTrue } from "../_lib/use-focus-on-become-true";
import { foldTurkish } from "../_lib/turkish-text";
import { PRODUCT_TYPE_CUSTOM_OPTION_LABEL, PRODUCT_TYPE_CUSTOM_VALUE } from "../_lib/product-catalog";

const CUSTOM_TEXT_MAX_LENGTH = 100;

/**
 * "Ürün Cinsi" alanı için serbest metin + öneri listesi combobox'ı —
 * searchable-select.tsx'ten BİLEREK AYRI: o bileşen kesin bir listeden seçim
 * yapmaya zorlar (trigger bir buton, yalnızca options içindeki bir value
 * kabul edilir), bu alan ise listeden seçilebilir YA DA serbestçe
 * yazılabilir olmalı.
 *
 * TEK kutu, TEK label — "Listede Yok, Kendim Gireceğim" seçildiğinde İKİNCİ
 * bir input AÇILMAZ (bu, düzeltilen bir hataydı: önceki sürüm salt-okunur
 * combobox tetikleyicisini olduğu gibi bırakıp altına ayrı bir "Ürün
 * Cinsini Yazınız" kutusu daha ekliyordu, aynı alan için iki kutu
 * görünüyordu). Bunun yerine `isCustom` (`value === PRODUCT_TYPE_CUSTOM_VALUE`)
 * iki KARŞILIKLI DIŞLAYICI dal arasında geçiş yapar — aynı anda yalnızca
 * biri DOM'dadır: `!isCustom` iken combobox tetikleyicisi (öneri açılır
 * listesiyle), `isCustom` iken AYNI konumda, AYNI boyut/kenarlık/radius/
 * font sınıflarını taşıyan düz bir metin `<input>`ı. Label her zaman
 * "Ürün Cinsi" metnini gösterir (`htmlFor` o an aktif olan input'un id'sine
 * işaret eder) — ayrı bir "Ürün Cinsini Yazınız" etiketi YOKTUR.
 *
 * `value`/`onChange` HER ZAMAN "Ürün Cinsi" alanının kendi state'ini
 * (gerçek değer YA DA sentinel) taşır; `customText`/`onCustomTextChange`
 * yalnızca sentinel modundaki gerçek serbest metni taşır — bu iki-parçalı
 * veri sözleşmesi BİLEREK değişmedi (görev tanımı: "ürün cinsi veri
 * modelini gereksiz yere değiştirme"), çağıran taraf gönderim anında
 * hangisinin geçerli olduğuna `value === PRODUCT_TYPE_CUSTOM_VALUE` ile
 * karar verir (bkz. job-form-validation.ts#validateProductInfoFields) —
 * yalnızca bu dosyanın GÖRÜNÜMÜ değişti, prop sözleşmesi/çağıranlar
 * DOKUNULMADAN kaldı.
 *
 * Otomatik odak: manuel input DOM'a girer girmez `useFocusOnBecomeTrue`
 * (yalnızca false→true geçişinde tetiklenir, ilk render'da/her render'da
 * DEĞİL) onu odaklar — kullanıcı seçimden sonra ayrıca tıklamak zorunda
 * kalmaz.
 */
export function ProductTypeCombobox({
  id,
  label,
  value,
  onChange,
  customText,
  onCustomTextChange,
  customFieldId,
  suggestions,
  placeholder = "Örn. Rulo Sac",
  errorId,
  customTextErrorId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  customText: string;
  onCustomTextChange: (value: string) => void;
  /** Manuel moddayken aktif olan kutunun DOM id'si — çağıran taraf kendi hata-odaklama mantığının (bkz. job-request-form.tsx#focusFirstServiceError) üretebileceği/bildiği bir id vermelidir, burada TAHMİN edilmez. */
  customFieldId: string;
  suggestions: readonly string[];
  placeholder?: string;
  errorId?: string;
  customTextErrorId?: string;
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const isCustom = value === PRODUCT_TYPE_CUSTOM_VALUE;
  const manualInputRef = useFocusOnBecomeTrue<HTMLInputElement>(isCustom);

  const filteredSuggestions = useMemo(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return suggestions;
    const folded = foldTurkish(trimmed);
    return suggestions.filter((suggestion) => foldTurkish(suggestion).includes(folded));
  }, [suggestions, value]);

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div>
      <label htmlFor={isCustom ? customFieldId : id} className="text-sm font-medium text-foreground">
        {label}
      </label>

      {isCustom ? (
        <input
          ref={manualInputRef}
          id={customFieldId}
          type="text"
          value={customText}
          onChange={(event) => onCustomTextChange(event.target.value)}
          maxLength={CUSTOM_TEXT_MAX_LENGTH}
          aria-invalid={customTextErrorId ? true : undefined}
          aria-describedby={customTextErrorId}
          placeholder="Örnek: Galvanizli çelik rulo"
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            customTextErrorId ? "border-danger" : "border-border"
          }`}
        />
      ) : (
        <div ref={containerRef} className="relative">
          <input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            autoComplete="off"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            maxLength={100}
            aria-invalid={errorId ? true : undefined}
            aria-describedby={errorId}
            placeholder={placeholder}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errorId ? "border-danger" : "border-border"
            }`}
          />

          {open && (
            <div className="absolute z-50 mt-2 w-max min-w-full max-w-[min(320px,90vw)] rounded-card border border-border bg-surface shadow-md">
              <ul id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto p-1">
                {filteredSuggestions.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    Listede yok — girdiğiniz değer kullanılacak.
                  </li>
                ) : (
                  filteredSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={suggestion === value}
                        onClick={() => handleSelect(suggestion)}
                        className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          suggestion === value ? "bg-accent-soft text-primary" : "text-foreground"
                        }`}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))
                )}
                <li className="mt-1 border-t border-border pt-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(PRODUCT_TYPE_CUSTOM_VALUE)}
                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {PRODUCT_TYPE_CUSTOM_OPTION_LABEL}
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {isCustom && (
        <button
          type="button"
          onClick={() => handleSelect("")}
          className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Hazır listeden seç
        </button>
      )}
    </div>
  );
}
