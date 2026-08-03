"use client";

import {
  CUSTOMS_REQUESTED_SERVICE_OPTIONS,
  CUSTOMS_TRANSACTION_TYPES,
} from "../_lib/customs-brokerage-catalog";
import { PRODUCT_TYPE_CUSTOM_VALUE, PRODUCT_TYPE_SUGGESTIONS } from "../_lib/product-catalog";
import { MultiSelectChips } from "./multi-select-chips";
import { ProductTypeCombobox } from "./product-type-combobox";
import { SearchableSelect } from "./searchable-select";

export type CustomsBrokerageFieldValues = {
  customsTransactionType: string;
  customsRequestedServices: string[];
  /** product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS listesinden bir öneri YA DA product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE sentinel'i — bkz. ProductTypeCombobox/customsProductTypeCustomText. Diğer hizmetlerin "Ürün Bilgileri"ndeki productType alanıyla AYNI ilke, ama TAMAMEN AYRI bir Job alanına (customsProductType) yazılır — iki katalog hâlâ hiçbir alanı paylaşmaz, yalnızca AYNI seçim sistemini/component'ini kullanır. */
  customsProductType: string;
  /** Yalnızca customsProductType === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı — bkz. job-form-validation.ts#JobFormFields.productTypeCustomText İLE AYNI desen. */
  customsProductTypeCustomText: string;
};

export type CustomsBrokerageFieldErrors = Partial<Record<keyof CustomsBrokerageFieldValues, string>>;

const TRANSACTION_TYPE_OPTIONS = CUSTOMS_TRANSACTION_TYPES.map((option) => ({
  value: option.id,
  label: option.label,
}));
const REQUESTED_SERVICE_OPTIONS = CUSTOMS_REQUESTED_SERVICE_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
}));

/**
 * Gümrük Müşavirliği'ne özel "Operasyon Bilgileri" alan grubu — TEK
 * paylaşılan JSX bloğu, hem `job-request-form.tsx`in her hizmet kartında
 * hem `job-edit-form.tsx`de BİREBİR aynı şekilde render edilir (görev
 * gereksinimi: aynı liste/alan seti farklı dosyalarda tekrar yazılmaz).
 * Yalnızca çağıranın zaten `isCustomsBrokerageCategory(category)` true
 * olduğunda mount etmesi beklenir — bu bileşen kendi içinde kategori
 * kontrolü yapmaz (görünürlük kararı çağıranındır, product-catalog.ts'in
 * kendi alan bloklarıyla AYNI sorumluluk ayrımı).
 */
export function CustomsBrokerageFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  /** Her alanın DOM id'sini benzersizleştirmek için — bkz. job-request-form.tsx#serviceFieldId'deki AYNI gerekçe (dinamik kartlarda useId() kullanılamaz). */
  idPrefix: string;
  values: CustomsBrokerageFieldValues;
  errors: CustomsBrokerageFieldErrors;
  onChange: (patch: Partial<CustomsBrokerageFieldValues>) => void;
}) {
  const transactionTypeId = `${idPrefix}-customsTransactionType`;
  const requestedServicesId = `${idPrefix}-customsRequestedServices`;
  const productTypeId = `${idPrefix}-customsProductType`;
  const productTypeCustomTextId = `${idPrefix}-customsProductTypeCustomText`;

  return (
    <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-bold tracking-heading leading-tight text-foreground">
          Gümrük Müşavirliği — Operasyon Bilgileri
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Bu bilgiler yalnızca Gümrük Müşavirliği hizmeti için görünür ve gümrük müşavirlerinin teklif vermeden önce
          işlemi değerlendirmesini sağlar.
        </p>
      </div>

      {/*
        Bu ızgaranın sağ sütunu eskiden "Gümrük Müdürlüğü" idi (görev tanımı:
        alan formdan tamamen kaldırıldı, eski ilanlardaki değeri silinmez —
        bkz. job-store.ts#resolveCustomsBrokerageFields — ama artık hiçbir
        formda toplanmaz/gösterilmez). Onun yerine, diğer hizmetlerin "Ürün
        Bilgileri"nde kullandığı AYNI merkezi katalog
        (product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS) VE AYNI seçim
        component'i (ProductTypeCombobox) buraya taşındı — Gümrük
        Müşavirliği'ne özel ayrı bir liste İCAT EDİLMEDİ. "Listede Yok, Kendim
        Gireceğim" seçildiğinde component kendi içinde manuel metin alanını
        açar; gönderim anında hangisinin geçerli olduğu (katalog değeri ya da
        customsProductTypeCustomText) çağıran tarafın (job-request-form.tsx/
        job-edit-form.tsx) resolveCustomsBrokerageServicePayload/handleSubmit'i
        product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE ile belirler — TAMAMEN
        AYNI karar mantığı, productType/productTypeCustomText için zaten var
        olan yerde tekrar kopyalanmadan kullanılır.
      */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <SearchableSelect
            id={transactionTypeId}
            label="İşlem Türü"
            options={TRANSACTION_TYPE_OPTIONS}
            value={values.customsTransactionType}
            onChange={(next) => onChange({ customsTransactionType: next })}
            placeholder="İşlem türü seçiniz"
            errorId={errors.customsTransactionType ? `${transactionTypeId}-error` : undefined}
          />
          {errors.customsTransactionType && (
            <p id={`${transactionTypeId}-error`} className="mt-2 text-sm text-danger">
              {errors.customsTransactionType}
            </p>
          )}
        </div>

        {/* Manuel giriş kutusu (bkz. job-edit-form.tsx'teki AYNI gerekçe) dar tek kolona hapsolmasın diye satırın tamamını kaplar. */}
        <div className={values.customsProductType === PRODUCT_TYPE_CUSTOM_VALUE ? "col-span-full" : undefined}>
          <ProductTypeCombobox
            id={productTypeId}
            label="Ürün Cinsi"
            value={values.customsProductType}
            onChange={(next) => onChange({ customsProductType: next })}
            customText={values.customsProductTypeCustomText}
            onCustomTextChange={(next) => onChange({ customsProductTypeCustomText: next })}
            customFieldId={productTypeCustomTextId}
            suggestions={PRODUCT_TYPE_SUGGESTIONS}
            errorId={errors.customsProductType ? `${productTypeId}-error` : undefined}
            customTextErrorId={errors.customsProductTypeCustomText ? `${productTypeCustomTextId}-error` : undefined}
          />
          {errors.customsProductType && (
            <p id={`${productTypeId}-error`} className="mt-2 text-sm text-danger">
              {errors.customsProductType}
            </p>
          )}
          {errors.customsProductTypeCustomText && (
            <p id={`${productTypeCustomTextId}-error`} className="mt-2 text-sm text-danger">
              {errors.customsProductTypeCustomText}
            </p>
          )}
        </div>
      </div>

      <MultiSelectChips
        id={requestedServicesId}
        label="Talep Edilen Hizmetler (isteğe bağlı)"
        options={REQUESTED_SERVICE_OPTIONS}
        selected={values.customsRequestedServices}
        onChange={(next) => onChange({ customsRequestedServices: next })}
        errorId={errors.customsRequestedServices ? `${requestedServicesId}-error` : undefined}
      />
    </div>
  );
}
