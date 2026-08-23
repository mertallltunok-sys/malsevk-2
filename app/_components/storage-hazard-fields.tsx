"use client";

import { CompactConditionToggle } from "./nakliye-transport-fields";
import { CompactMultiSelect, type MultiSelectOption } from "./multi-select-chips";
import {
  isTehlikeliMaddeDepolamaCategory,
  STORAGE_HAZARDOUS_TOGGLE_OPTIONS,
  STORAGE_RISK_GROUP_CATEGORIES,
} from "../_lib/storage-hazard-catalog";

/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — TEK paylaşılan
 * JSX bloğu, `StorageProductFields`/`CustomsBrokerageFields`/`RecyclingFields`
 * İLE AYNI rol: job-request-form.tsx/job-edit-form.tsx/admin-job-edit-
 * form.tsx üçünde de AYNI şekilde render edilir. Yalnızca çağıranın zaten
 * `isHazardousStorageCategory(category)` true olduğunda mount etmesi
 * beklenir — bu bileşen kendi içinde kategori kontrolü yapmaz (StorageProduct
 * Fields'in kendi dokümanındaki AYNI sözleşme), ama HANGİ iki kategoriden
 * biri olduğuna göre kendi İÇ görünümünü değiştirir:
 *
 *  - "Kimyasal Depolama": "Depolanacak ürün tehlikeli madde kapsamında mı?"
 *    Hayır/Evet sorusu (varsayılan Hayır, "Emin Değilim" YOK) gösterilir —
 *    yalnızca Evet iken risk grubu alanı açılır.
 *  - "Tehlikeli Madde Depolama": ürün zaten tehlikeli kabul edilir, soru HİÇ
 *    gösterilmez — risk grubu alanı DOĞRUDAN açık/zorunludur.
 *
 * Risk grubu çoklu seçimi `CompactMultiSelect`in (Nakliye Araç Tipi/Kasa-
 * Dorse Tipi ile AYNI bileşen) YENİ `groupLabel` desteğini kullanır — ikinci
 * bir çoklu seçim bileşeni İCAT EDİLMEDİ. UN Numarası/Ambalaj Grubu/Resmî
 * Taşımacılık Adı BİLEREK burada YOK (görev talimatının kendi kesin kuralı).
 */
export type StorageHazardFieldValues = {
  /** Yalnızca Kimyasal Depolama'da kullanıcı tarafından değiştirilebilir — "" | "hayir" | "evet". Tehlikeli Madde Depolama'da bu alan hiç render edilmez, gönderim anında her zaman "evet" olarak çözümlenir (bkz. fromStorageHazardFields). */
  storageHazardous: string;
  storageRiskGroups: string[];
};

export function createEmptyStorageHazardFields(): StorageHazardFieldValues {
  return { storageHazardous: "hayir", storageRiskGroups: [] };
}

const RISK_GROUP_MULTI_SELECT_OPTIONS: MultiSelectOption[] = STORAGE_RISK_GROUP_CATEGORIES.flatMap((category) =>
  category.options.map((option) => ({ value: option.id, label: option.label, groupLabel: category.label })),
);

export function StorageHazardFields({
  idPrefix,
  category,
  values,
  errors,
  onChange,
}: {
  idPrefix: string;
  category: string;
  values: StorageHazardFieldValues;
  errors?: { storageRiskGroups?: string };
  onChange: (patch: Partial<StorageHazardFieldValues>) => void;
}) {
  const isTehlikeliMaddeDepolama = isTehlikeliMaddeDepolamaCategory(category);
  const showRiskGroups = isTehlikeliMaddeDepolama || values.storageHazardous === "evet";

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-bold tracking-heading leading-tight text-foreground">
          Tehlikeli Madde Bilgileri
        </h3>
      </div>

      {!isTehlikeliMaddeDepolama && (
        <CompactConditionToggle
          id={`${idPrefix}-status`}
          title="Depolanacak ürün tehlikeli madde kapsamında mı?"
          hint="Ürün, ADR/tehlike sınıfı taşıyan bir kimyasal veya tehlikeli maddeyse Evet'i seçin."
          options={STORAGE_HAZARDOUS_TOGGLE_OPTIONS}
          value={values.storageHazardous || "hayir"}
          onChange={(next) => onChange({ storageHazardous: next, storageRiskGroups: next === "evet" ? values.storageRiskGroups : [] })}
        />
      )}

      {showRiskGroups && (
        <div>
          <CompactMultiSelect
            id={`${idPrefix}-risk-groups`}
            label="Depolama Tehlike / Risk Grubu"
            options={RISK_GROUP_MULTI_SELECT_OPTIONS}
            selected={values.storageRiskGroups}
            onChange={(next) => onChange({ storageRiskGroups: next })}
            placeholder="Risk grubu seçiniz"
          />
          {errors?.storageRiskGroups && <p className="mt-2 text-sm text-danger">{errors.storageRiskGroups}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Ürün birden fazla risk taşıyabilir — uygun olan tüm grupları seçebilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
}
