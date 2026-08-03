"use client";

import { useFocusOnBecomeTrue } from "../_lib/use-focus-on-become-true";

const CUSTOM_FACILITY_NAME_MAX_LENGTH = 150;

/**
 * "Liman / Sanayi / OSB Adı" — "Listede yok, kendim gireceğim" seçildiğinde
 * görünen tek satırlık serbest metin alanı. Gümrük Müşavirliği HARİÇ
 * platformdaki HER "Liman / Sanayi / OSB" bloğunun (Nakliye'nin Yük
 * Alınacak Yer/Teslim Edilecek Yer'i — bkz. nakliye-location-fields.tsx —
 * VE Nakliye dışı kategorilerin tekil konum alanı — bkz. job-request-form.tsx/
 * job-edit-form.tsx) paylaştığı TEK bileşen; etiket/placeholder/karakter
 * sınırı/otomatik odak (bkz. useFocusOnBecomeTrue) hiçbir çağıranda ayrı ayrı
 * yeniden yazılmaz. `active` false iken hiçbir şey render ETMEZ — görünürlük
 * kararı TAMAMEN çağırana (facilityId === manuel sentinel mi) aittir, bu
 * bileşen kendi başına bir görünürlük mantığı taşımaz.
 */
export function ManualFacilityNameField({
  id,
  value,
  onChange,
  active,
  error,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  active: boolean;
  error?: string;
}) {
  const inputRef = useFocusOnBecomeTrue<HTMLInputElement>(active);
  if (!active) return null;

  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Liman / Sanayi / OSB Adı
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={CUSTOM_FACILITY_NAME_MAX_LENGTH}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="Örn. İzmir Aliağa Limanı"
        className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          error ? "border-danger" : "border-border"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
