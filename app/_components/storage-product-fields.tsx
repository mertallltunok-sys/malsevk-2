"use client";

import { PRODUCT_TYPE_CUSTOM_VALUE, PRODUCT_TYPE_SUGGESTIONS } from "../_lib/product-catalog";
import { RECYCLING_UNIT_OPTIONS } from "../_lib/recycling-catalog";
import { MAX_TONNAGE_TON } from "../_lib/field-limits";
import { ProductTypeCombobox } from "./product-type-combobox";
import { SearchableSelect } from "./searchable-select";

const QUANTITY_MAX_INPUT_LENGTH = String(MAX_TONNAGE_TON).length + 4;

export type StorageProductFieldValues = {
  /** product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS listesinden bir öneri YA DA PRODUCT_TYPE_CUSTOM_VALUE sentinel'i — bkz. customs-brokerage-fields.tsx#customsProductType İLE AYNI desen (AYNI katalog+component, TAMAMEN AYRI bir Job alanına yazılır). */
  storageProductType: string;
  /** Yalnızca storageProductType === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı. */
  storageProductTypeCustomText: string;
  storageProductQuantity: string;
  storageProductUnit: string;
  storageProductTonnage: string;
};

export type StorageProductFieldErrors = Partial<Record<keyof StorageProductFieldValues, string>>;

const UNIT_OPTIONS = RECYCLING_UNIT_OPTIONS.map((option) => ({ value: option.id, label: option.label }));

/**
 * Depolama'ya özel "Depolanacak Ürün Bilgileri" alan grubu — TEK paylaşılan
 * JSX bloğu, `customs-brokerage-fields.tsx`/`recycling-fields.tsx` ile
 * BİREBİR aynı rol: `job-request-form.tsx`in her hizmet kartında,
 * `job-edit-form.tsx`de VE `admin-job-edit-form.tsx`de aynı şekilde render
 * edilir. Yalnızca çağıranın zaten `isStorageOnlyLocationCategory(category)`
 * (bkz. service-catalog.ts — artık Depo Hizmetleri grubunun TAMAMI, 12 alt
 * kategori) true olduğunda mount etmesi beklenir — bu bileşen kendi içinde
 * kategori kontrolü yapmaz.
 *
 * `productQuantity`/`productTonnage`/`productType` (Liman/Nakliye'nin "Ürün
 * Bilgileri") KASITLI OLARAK yeniden kullanılmaz — bkz. types.ts#Job.
 * storageProductType'ın üstündeki doküman. Birim (kg/ton/adet) ise
 * recycling-catalog.ts#RECYCLING_UNIT_OPTIONS'tan AYNEN alınır — ikinci bir
 * birim kataloğu İCAT EDİLMEDİ.
 */
export function StorageProductFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  /** Her alanın DOM id'sini benzersizleştirmek için — bkz. job-request-form.tsx#serviceFieldId'deki AYNI gerekçe. */
  idPrefix: string;
  values: StorageProductFieldValues;
  errors: StorageProductFieldErrors;
  onChange: (patch: Partial<StorageProductFieldValues>) => void;
}) {
  const productTypeId = `${idPrefix}-storageProductType`;
  const productTypeCustomTextId = `${idPrefix}-storageProductTypeCustomText`;
  const quantityId = `${idPrefix}-storageProductQuantity`;
  const unitId = `${idPrefix}-storageProductUnit`;
  const tonnageId = `${idPrefix}-storageProductTonnage`;

  return (
    <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-bold tracking-heading leading-tight text-foreground">
          Depolanacak Ürün Bilgileri
        </h3>
      </div>

      <div className={values.storageProductType === PRODUCT_TYPE_CUSTOM_VALUE ? undefined : "sm:col-span-2"}>
        <ProductTypeCombobox
          id={productTypeId}
          label="Ürün Cinsi"
          value={values.storageProductType}
          onChange={(next) => onChange({ storageProductType: next })}
          customText={values.storageProductTypeCustomText}
          onCustomTextChange={(next) => onChange({ storageProductTypeCustomText: next })}
          customFieldId={productTypeCustomTextId}
          suggestions={PRODUCT_TYPE_SUGGESTIONS}
          errorId={errors.storageProductType ? `${productTypeId}-error` : undefined}
          customTextErrorId={errors.storageProductTypeCustomText ? `${productTypeCustomTextId}-error` : undefined}
        />
        {errors.storageProductType && (
          <p id={`${productTypeId}-error`} className="mt-2 text-sm text-danger">
            {errors.storageProductType}
          </p>
        )}
        {errors.storageProductTypeCustomText && (
          <p id={`${productTypeCustomTextId}-error`} className="mt-2 text-sm text-danger">
            {errors.storageProductTypeCustomText}
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor={quantityId} className="text-sm font-medium text-foreground">
            Miktar
          </label>
          <input
            id={quantityId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.storageProductQuantity}
            onChange={(event) => onChange({ storageProductQuantity: event.target.value.replace(/[^0-9.,]/g, "") })}
            maxLength={QUANTITY_MAX_INPUT_LENGTH}
            aria-invalid={errors.storageProductQuantity ? true : undefined}
            aria-describedby={errors.storageProductQuantity ? `${quantityId}-error` : undefined}
            placeholder="Ör. 120"
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.storageProductQuantity && (
            <p id={`${quantityId}-error`} className="mt-2 text-sm text-danger">
              {errors.storageProductQuantity}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={unitId}
            label="Birim"
            options={UNIT_OPTIONS}
            value={values.storageProductUnit}
            onChange={(next) => onChange({ storageProductUnit: next })}
            placeholder="Birim seçiniz"
            errorId={errors.storageProductUnit ? `${unitId}-error` : undefined}
          />
          {errors.storageProductUnit && (
            <p id={`${unitId}-error`} className="mt-2 text-sm text-danger">
              {errors.storageProductUnit}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={tonnageId} className="text-sm font-medium text-foreground">
          Toplam Tonaj (isteğe bağlı)
        </label>
        <input
          id={tonnageId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={values.storageProductTonnage}
          onChange={(event) => onChange({ storageProductTonnage: event.target.value.replace(/[^0-9.,]/g, "") })}
          maxLength={QUANTITY_MAX_INPUT_LENGTH}
          aria-invalid={errors.storageProductTonnage ? true : undefined}
          aria-describedby={errors.storageProductTonnage ? `${tonnageId}-error` : undefined}
          placeholder="Ör. 4.5"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.storageProductTonnage && (
          <p id={`${tonnageId}-error`} className="mt-2 text-sm text-danger">
            {errors.storageProductTonnage}
          </p>
        )}
      </div>
    </div>
  );
}
