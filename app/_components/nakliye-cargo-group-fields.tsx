"use client";

import { Plus, Trash2 } from "lucide-react";
import type { NakliyeCargoGroupErrors } from "../_lib/job-form-validation";
import {
  createEmptyMeasurementFields,
  createEmptyNakliyeCargoGroupFields,
  getProductQuantityFieldConfig,
  isNakliyeContainerProductType,
  type NakliyeCargoGroupFieldValues,
} from "../_lib/nakliye-transport-catalog";
import { NakliyeMeasurementCard } from "./nakliye-measurement-fields";
import { ContainerBodyFields, HazmatFields, LoadPreparationField, NumberField } from "./nakliye-transport-fields";
import { NAKLIYE_PRODUCT_TYPE_SUGGESTIONS, PRODUCT_TONNAGE_UNIT_OPTIONS, PRODUCT_TYPE_CUSTOM_VALUE } from "../_lib/product-catalog";
import { MAX_CARGO_GROUPS, MAX_PRODUCT_QUANTITY, MAX_TONNAGE_KG, MAX_TONNAGE_TON, MAX_VOLUME_M3 } from "../_lib/field-limits";
import { ProductTypeCombobox } from "./product-type-combobox";

/** Girilebilecek en büyük değere (ondalık ayraç + basamaklar dahil) yetecek karakter sayısı — "1.000.000" gibi bir üst sınırdan `maxLength`'i türetir, her çağıranın kendi rakam saymasına gerek kalmaz. */
function digitInputMaxLength(max: number, decimalPlaces = 0): number {
  return String(Math.trunc(max)).length + (decimalPlaces > 0 ? decimalPlaces + 1 : 0);
}

/**
 * "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
 * Taşındı" görevleri — Nakliye'nin "2 — Yük Bilgileri" kartının TEK,
 * tekrarlanabilir alan grubu. Bir ilan farklı türde birden fazla yük
 * taşıyabilir (ör. 1 adet 40' konteyner + ayrı bir paletli yük) —
 * storage-container-details-fields.tsx#StorageContainerGroupsFields İLE AYNI
 * mimari desen (grup listesi + "+ Ekle" + `id`ye göre anahtarlanmış hatalar +
 * tek grup kalınca "Kaldır" gizlenir), Nakliye'ye uyarlanmış hâli. `job-
 * request-form.tsx`/`job-edit-form.tsx`/`admin-job-edit-form.tsx`in ÜÇÜ de
 * AYNI bileşeni kendi `idPrefix`'leriyle mount eder.
 *
 * Konteyner modunun eski bağımsız "Yük konteyner olarak mı taşınacak?"
 * sorusu TAMAMEN kaldırıldı — TEK tetikleyici artık "Ürün/Yük Cinsi"
 * alanının kendisi (`isNakliyeContainerProductType`, bkz. o fonksiyonun
 * kendi doküman notu). Bu yüzden "Ürün/Yük Cinsi" + PAYLAŞILAN "Toplam
 * Ağırlık" alanları HER İKİ dalda da (normal VE konteyner) görünür kalır,
 * kartın en üstünde render edilir — yalnızca "Yükün Hazırlanış Biçimi"/Ürün
 * Adedi/Ölçü ve Yerleşim (normal dal) VEYA Konteyner Tipi/Dolu-Boş/Adedi/
 * [Dolu alt kartı] (konteyner dalı) birbirini dışlayan biçimde altta
 * değişir. Grup başına bağımsız Tehlikeli Madde/ADR mini-bölümü (`HazmatFields`)
 * her zaman en altta, HER İKİ dalda da aynı şekilde render edilir.
 *
 * Bu dosya `nakliye-transport-fields.tsx` (ContainerBodyFields/HazmatFields/
 * LoadPreparationField) VE `nakliye-measurement-fields.tsx` (NakliyeMeasurementCard)
 * İKİSİNİ birden içe aktarır — o iki dosya birbirini karşılıklı içe
 * aktardığı için (nakliye-measurement-fields.tsx zaten nakliye-transport-
 * fields.tsx'in DropdownWithManualEntry/NumberField/TextField'ını kullanıyor)
 * bu bileşenin KENDİSİ ikisinin dışında, ÜÇÜNCÜ bir dosyada olmak zorunda —
 * aksi hâlde dairesel bağımlılık oluşurdu (nakliye-measurement-fields.tsx'in
 * kendi başlık dokümanındaki AYNI gerekçe).
 */
function NakliyeCargoGroupCard({
  idPrefix,
  index,
  values,
  errors,
  onChange,
  onRemove,
  canRemove,
}: {
  idPrefix: string;
  index: number;
  values: NakliyeCargoGroupFieldValues;
  errors?: NakliyeCargoGroupErrors;
  onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const isContainerMode = isNakliyeContainerProductType(values.productType);
  const quantityFieldConfig = getProductQuantityFieldConfig(values.loadPreparationType, values.loadPreparationCustomText);
  const productTypeFieldId = `${idPrefix}-product-type`;

  /**
   * "Ürün/Yük Cinsi" değiştiğinde konteyner↔normal dal geçişini tespit
   * eder — yalnızca GERÇEK bir mod sınırı aşıldığında (eski ContainerToggle'ın
   * kendi handleContainerToggleChange'iyle AYNI ilke) karşı dala ait alanlar
   * temizlenir, sıradan bir metin düzenlemesi (ör. "Alüminyum" -> "Alüminyum
   * Külçe") hiçbir şeyi silmez.
   */
  function handleProductTypeChange(next: string) {
    const nextIsContainer = isNakliyeContainerProductType(next);
    if (nextIsContainer === isContainerMode) {
      onChange({ productType: next });
      return;
    }
    if (nextIsContainer) {
      onChange({
        productType: next,
        productTypeCustomText: "",
        productQuantity: "",
        loadPreparationType: "",
        loadPreparationCustomText: "",
        measurement: createEmptyMeasurementFields(),
      });
    } else {
      onChange({
        productType: next,
        productTypeCustomText: "",
        containerType: "",
        containerTypeCustomText: "",
        containerLoadStatus: "",
        containerQuantity: "",
        containerContent: "",
        containerContentCustomText: "",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yük Grubu {index + 1}</p>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Yük Grubu ${index + 1}'i kaldır`}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Kaldır
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={values.productType === PRODUCT_TYPE_CUSTOM_VALUE ? "sm:col-span-2" : undefined}>
          <ProductTypeCombobox
            id={productTypeFieldId}
            label="Ürün/Yük Cinsi"
            value={values.productType}
            onChange={handleProductTypeChange}
            customText={values.productTypeCustomText}
            onCustomTextChange={(next) => onChange({ productTypeCustomText: next })}
            customFieldId={`${productTypeFieldId}-custom`}
            suggestions={NAKLIYE_PRODUCT_TYPE_SUGGESTIONS}
            errorId={errors?.productType ? `${productTypeFieldId}-error` : undefined}
            customTextErrorId={errors?.productTypeCustomText ? `${productTypeFieldId}-custom-error` : undefined}
          />
          {errors?.productType && <p id={`${productTypeFieldId}-error`} className="mt-2 text-sm text-danger">{errors.productType}</p>}
          {errors?.productTypeCustomText && (
            <p id={`${productTypeFieldId}-custom-error`} className="mt-2 text-sm text-danger">{errors.productTypeCustomText}</p>
          )}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-tonnage`} className="text-sm font-medium text-foreground">
            Toplam Ağırlık
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`${idPrefix}-tonnage`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.productTonnage}
              onChange={(event) => onChange({ productTonnage: event.target.value.replace(/[^0-9.,]/g, "") })}
              maxLength={values.productTonnageUnit === "kg" ? digitInputMaxLength(MAX_TONNAGE_KG, 2) : digitInputMaxLength(MAX_TONNAGE_TON, 3)}
              aria-invalid={errors?.productTonnage ? true : undefined}
              aria-describedby={errors?.productTonnage ? `${idPrefix}-tonnage-error` : undefined}
              placeholder="Örn. 8,5"
              className={`w-full min-w-0 flex-1 rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${errors?.productTonnage ? "border-danger" : "border-border"}`}
            />
            <select
              aria-label="Ağırlık birimi"
              value={values.productTonnageUnit}
              onChange={(event) => onChange({ productTonnageUnit: event.target.value === "kg" ? "kg" : "ton" })}
              className="w-24 shrink-0 rounded-md border border-border bg-surface px-2 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {PRODUCT_TONNAGE_UNIT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          {errors?.productTonnage && <p id={`${idPrefix}-tonnage-error`} className="mt-2 text-sm text-danger">{errors.productTonnage}</p>}
        </div>
      </div>

      {isContainerMode ? (
        <ContainerBodyFields
          idPrefix={idPrefix}
          values={values}
          onChange={onChange}
          errors={{
            containerType: errors?.containerType,
            containerLoadStatus: errors?.containerLoadStatus,
            containerQuantity: errors?.containerQuantity,
            containerContent: errors?.containerContent,
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {quantityFieldConfig.useVolumeInstead ? (
              <div>
                <label htmlFor={`${idPrefix}-quantity`} className="text-sm font-medium text-foreground">
                  {quantityFieldConfig.label} <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                </label>
                <input
                  id={`${idPrefix}-quantity`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={values.measurement.volumeM3}
                  onChange={(event) => onChange({ measurement: { ...values.measurement, volumeM3: event.target.value.replace(/[^0-9.,]/g, "") } })}
                  maxLength={digitInputMaxLength(MAX_VOLUME_M3, 2)}
                  placeholder={`Örn. ${quantityFieldConfig.placeholder}`}
                  className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            ) : (
              <NumberField
                id={`${idPrefix}-quantity`}
                label={quantityFieldConfig.label}
                value={values.productQuantity}
                onChange={(next) => onChange({ productQuantity: next.replace(/[^0-9]/g, "") })}
                placeholder={quantityFieldConfig.placeholder}
                error={errors?.productQuantity}
                maxLength={digitInputMaxLength(MAX_PRODUCT_QUANTITY)}
              />
            )}
            <LoadPreparationField
              idPrefix={idPrefix}
              values={values}
              onChange={onChange}
              selectError={errors?.loadPreparationType}
              customTextError={errors?.loadPreparationCustomText}
            />
          </div>

          <NakliyeMeasurementCard
            idPrefix={`${idPrefix}-measurement`}
            loadPreparationType={values.loadPreparationType}
            values={values.measurement}
            onChange={(patch) => onChange({ measurement: { ...values.measurement, ...patch } })}
            errors={errors?.measurement}
          />
        </>
      )}

      <div className="border-t border-border pt-4">
        <HazmatFields
          idPrefix={`${idPrefix}-hazmat`}
          values={values}
          onChange={onChange}
          errors={{ hazmatAdrClass: errors?.hazmatAdrClass }}
        />
      </div>
    </div>
  );
}

/**
 * "2 — Yük Bilgileri" kartının dış kabuğu — bir dizi `NakliyeCargoGroupCard`
 * + "+ Başka Yük Grubu Ekle" butonu. İlk açılışta TEK grup (StorageContainerGroupsFields
 * İLE AYNI "hiç grup yoksa TEK boş grupla başlar" ilkesi — çağıran taraf zaten
 * en az 1 elemanlı bir dizi geçirir). `errors` grup `id`sine göre anahtarlanır.
 */
export function NakliyeCargoGroupsFields({
  idPrefix,
  groups,
  errors,
  onChange,
}: {
  idPrefix: string;
  groups: NakliyeCargoGroupFieldValues[];
  errors?: Record<string, NakliyeCargoGroupErrors>;
  onChange: (nextGroups: NakliyeCargoGroupFieldValues[]) => void;
}) {
  function handleGroupChange(groupId: string, patch: Partial<NakliyeCargoGroupFieldValues>) {
    onChange(groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }
  // "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu buton
  // sınırsızca yeni grup ekleyebiliyordu (görev talimatı: "İlan başına
  // maksimum 20 yük grubu"). UI'daki bu sınır BİRİNCİ katman — job-form-
  // validation.ts#validateNakliyeCargoGroups VE nakliye-transport-catalog.ts#
  // sanitizeNakliyeCargoGroups aynı MAX_CARGO_GROUPS'u form-bypass'a karşı
  // ikinci/üçüncü katman olarak ayrıca uygular.
  const reachedGroupLimit = groups.length >= MAX_CARGO_GROUPS;
  function handleAddGroup() {
    if (reachedGroupLimit) return;
    onChange([...groups, createEmptyNakliyeCargoGroupFields()]);
  }
  function handleRemoveGroup(groupId: string) {
    if (groups.length <= 1) return;
    onChange(groups.filter((group) => group.id !== groupId));
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group, index) => (
        <NakliyeCargoGroupCard
          key={group.id}
          idPrefix={`${idPrefix}-${group.id}`}
          index={index}
          values={group}
          errors={errors?.[group.id]}
          onChange={(patch) => handleGroupChange(group.id, patch)}
          onRemove={() => handleRemoveGroup(group.id)}
          canRemove={groups.length > 1}
        />
      ))}
      {!reachedGroupLimit && (
        <button
          type="button"
          onClick={handleAddGroup}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Başka Yük Grubu Ekle
        </button>
      )}
      {reachedGroupLimit && (
        <p className="text-xs text-muted-foreground">En fazla {MAX_CARGO_GROUPS} yük grubu ekleyebilirsiniz.</p>
      )}
    </div>
  );
}
