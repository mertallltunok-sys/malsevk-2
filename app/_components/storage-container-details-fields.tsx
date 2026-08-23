"use client";

import { Plus, Trash2 } from "lucide-react";
import { PRODUCT_TYPE_CUSTOM_VALUE, PRODUCT_TYPE_SUGGESTIONS } from "../_lib/product-catalog";
import {
  canonicalizeImoClassCode,
  computeTotalContainerQuantity,
  getImoClassOptionLabel,
  IMO_CLASS_SELECT_ITEMS,
  isContainerLoadApplicable,
  isHazmatDetailApplicable,
  isImoClassCode,
  isReeferContainerType,
  STORAGE_CONTAINER_SIZE_OPTIONS,
  STORAGE_CONTAINER_STATUS_OPTIONS,
  STORAGE_CONTAINER_TYPE_OPTIONS,
  UN_NUMBER_MAX_LENGTH,
  YES_NO_OPTIONS,
} from "../_lib/storage-container-catalog";
import type { StorageContainerGroup } from "../_lib/types";
import { MAX_CONTAINER_QUANTITY, MAX_STORAGE_CONTAINER_GROUPS, MAX_TONNAGE_TON } from "../_lib/field-limits";
import { ProductTypeCombobox } from "./product-type-combobox";
import { SearchableSelect } from "./searchable-select";

/** Girilebilecek en büyük değere yetecek karakter sayısı. */
function digitInputMaxLength(max: number, decimalPlaces = 0): number {
  return String(Math.trunc(max)).length + (decimalPlaces > 0 ? decimalPlaces + 1 : 0);
}

/**
 * "Konteyner Grupları" — Konteyner Depolama'nın TEK, tekrarlanabilir alan
 * grubu. Bir ilan farklı ölçü/tip/yük durumuna sahip birden fazla konteyner
 * grubu taşıyabilir (bkz. types.ts#Job.storageContainerGroups). `job-request-
 * form.tsx`/`job-edit-form.tsx`/`admin-job-edit-form.tsx`in ÜÇÜ de AYNI
 * bileşeni kendi `idPrefix`'leriyle mount eder (çoklu hizmet operasyonunda
 * her Konteyner Depolama kartı kendi `service.localId`'sini kullanır).
 */
export type StorageContainerGroupFieldValues = {
  /** React key/hata eşleştirmesi için — iş kuralı taşımaz (bkz. job-photo-upload.tsx#PhotoItem.clientId İLE AYNI ilke). */
  id: string;
  quantity: string;
  size: string;
  type: string;
  status: string;
  /** product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS listesinden bir öneri YA DA PRODUCT_TYPE_CUSTOM_VALUE sentinel'i — bkz. storage-product-fields.tsx#StorageProductFieldValues.storageProductType İLE AYNI desen. */
  content: string;
  /** Yalnızca content === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı. */
  contentCustomText: string;
  grossWeight: string;
  /** "evet" | "hayir" | "" */
  hazardous: string;
  unNumber: string;
  imoClass: string;
  reeferTemperature: string;
  /** "evet" | "hayir" | "" */
  reeferElectrical: string;
};

export type StorageContainerGroupErrors = Partial<Record<Exclude<keyof StorageContainerGroupFieldValues, "id">, string>>;

const SIZE_OPTIONS = STORAGE_CONTAINER_SIZE_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const TYPE_OPTIONS = STORAGE_CONTAINER_TYPE_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const STATUS_OPTIONS = STORAGE_CONTAINER_STATUS_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const HAZARDOUS_OPTIONS = YES_NO_OPTIONS.map((option) => ({ value: option.id, label: option.label }));

/**
 * IMO Sınıfı `<select>`i için gruplanmış render sırası — "ADR Sınıfı
 * Sıralama Düzeltmesi" göreviyle merkezi hâle getirildi, bkz. storage-
 * container-catalog.ts#IMO_CLASS_SELECT_ITEMS'ın kendi doküman notu.
 */

export function createEmptyStorageContainerGroupFields(): StorageContainerGroupFieldValues {
  return {
    id: crypto.randomUUID(),
    quantity: "",
    size: "",
    type: "",
    status: "",
    content: "",
    contentCustomText: "",
    grossWeight: "",
    hazardous: "",
    unNumber: "",
    imoClass: "",
    reeferTemperature: "",
    reeferElectrical: "",
  };
}

function toStorageContainerGroupFields(group: StorageContainerGroup): StorageContainerGroupFieldValues {
  return {
    id: group.id,
    quantity: String(group.quantity),
    size: group.size,
    type: group.type,
    status: group.status,
    content: group.content ?? "",
    contentCustomText: "",
    grossWeight: group.grossWeight !== undefined ? String(group.grossWeight) : "",
    hazardous: group.hazardous === true ? "evet" : group.hazardous === false ? "hayir" : "",
    unNumber: group.unNumber ?? "",
    // Eski (serbest metin) bir IMO değeri (ör. "IMO 3") TANINABİLİYORSA
    // kanonik koda çevrilip ÖNCEDEN SEÇİLİ gösterilir (görev talimatı:
    // "tanınabilir eski değerleri güvenli şekilde kanonik koda dönüştür").
    // TANINAMAYAN bir değer için "" döner — `<select>` hiçbir seçeneği
    // ÖNCEDEN SEÇMEZ, admin/kullanıcı kanonik bir sınıf seçmeye ZORLANIR
    // (görev talimatı: "admin düzenleme ekranında kanonik bir sınıf
    // seçilmesi istensin") — ham değer SİLİNMEZ, yalnızca form state'inde
    // önceden-seçili DEĞİLDİR; job-detail-content.tsx#formatImoClassForDisplay
    // ilan detayında ham değeri HER ZAMAN korur.
    imoClass: canonicalizeImoClassCode(group.imoClass) ?? "",
    reeferTemperature: group.reeferTemperature !== undefined ? String(group.reeferTemperature) : "",
    reeferElectrical: group.reeferElectrical === true ? "evet" : group.reeferElectrical === false ? "hayir" : "",
  };
}

/** `Job.storageContainerGroups`i (varsa) form katmanının ham metin state'ine çevirir — hiç grup yoksa TEK boş grupla başlar (görev tanımı: "ilk konteyner grubu form açıldığında hazır gelsin"). */
export function toStorageContainerGroupsFields(groups: StorageContainerGroup[] | undefined): StorageContainerGroupFieldValues[] {
  if (!groups || groups.length === 0) return [createEmptyStorageContainerGroupFields()];
  return groups.map(toStorageContainerGroupFields);
}

/** Ters yön: bir grubun ham form state'ini gönderim anındaki tipli Job alanlarına çevirir. */
function fromStorageContainerGroupFields(values: StorageContainerGroupFieldValues): StorageContainerGroup | null {
  const quantityTrimmed = values.quantity.trim();
  const quantityParsed = /^\d+$/.test(quantityTrimmed) ? Number(quantityTrimmed) : NaN;
  // "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu bileşenin
  // kendi form->Job dönüştürücüsünde de üst sınır YOKTU (job-form-validation.ts#
  // validateStorageContainerGroup zaten hata gösterir, ama bu fonksiyon o
  // hatadan BAĞIMSIZ olarak yine de sınırsız bir değeri Job'a yazabiliyordu).
  const quantity = quantityParsed > 0 && quantityParsed <= MAX_CONTAINER_QUANTITY ? quantityParsed : undefined;
  const size = values.size === "20" || values.size === "40" || values.size === "45" ? values.size : undefined;
  const type =
    values.type === "standart" || values.type === "high-cube" || values.type === "reefer" || values.type === "open-top" || values.type === "tank"
      ? values.type
      : undefined;
  const status = values.status === "dolu" || values.status === "bos" ? values.status : undefined;
  if (quantity === undefined || !size || !type || !status) return null;

  const isLoaded = isContainerLoadApplicable(status);
  const isReefer = isReeferContainerType(type);
  const resolvedContent = values.content === PRODUCT_TYPE_CUSTOM_VALUE ? values.contentCustomText.trim() : values.content.trim();
  const hazardous = isLoaded && (values.hazardous === "evet" || values.hazardous === "hayir") ? values.hazardous === "evet" : undefined;
  const grossWeightTrimmed = values.grossWeight.trim();
  const reeferTempTrimmed = values.reeferTemperature.trim();

  return {
    id: values.id,
    quantity,
    size,
    type,
    status,
    content: isLoaded && resolvedContent.length > 0 ? resolvedContent.slice(0, 100) : undefined,
    grossWeight: (() => {
      if (!isLoaded || !/^\d+([.,]\d{1,3})?$/.test(grossWeightTrimmed)) return undefined;
      const value = Number(grossWeightTrimmed.replace(",", "."));
      return value > 0 && value <= MAX_TONNAGE_TON ? value : undefined;
    })(),
    hazardous,
    unNumber: isLoaded && hazardous ? values.unNumber.trim().slice(0, UN_NUMBER_MAX_LENGTH) || undefined : undefined,
    imoClass: isLoaded && hazardous && isImoClassCode(values.imoClass) ? values.imoClass : undefined,
    reeferTemperature: (() => {
      if (!isReefer || !/^-?\d+([.,]\d{1,2})?$/.test(reeferTempTrimmed)) return undefined;
      const value = Number(reeferTempTrimmed.replace(",", "."));
      return value >= -80 && value <= 50 ? value : undefined;
    })(),
    reeferElectrical: isReefer && (values.reeferElectrical === "evet" || values.reeferElectrical === "hayir") ? values.reeferElectrical === "evet" : undefined,
  };
}

/** Tüm grup dizisini gönderim anındaki `Job.storageContainerGroups`e çevirir — çözümlenemeyen (zorunlu alanı eksik) bir grup ATLANIR, formun kendi doğrulaması zaten bunu engeller. */
export function fromStorageContainerGroupsFields(groups: StorageContainerGroupFieldValues[]): StorageContainerGroup[] | undefined {
  const resolved = groups.map(fromStorageContainerGroupFields).filter((group): group is StorageContainerGroup => group !== null);
  return resolved.length > 0 ? resolved : undefined;
}

function StorageContainerGroupCard({
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
  values: StorageContainerGroupFieldValues;
  errors?: StorageContainerGroupErrors;
  onChange: (patch: Partial<StorageContainerGroupFieldValues>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const quantityId = `${idPrefix}-quantity`;
  const sizeId = `${idPrefix}-size`;
  const typeId = `${idPrefix}-type`;
  const statusId = `${idPrefix}-status`;
  const contentId = `${idPrefix}-content`;
  const weightId = `${idPrefix}-grossWeight`;
  const hazardousId = `${idPrefix}-hazardous`;
  const unNumberId = `${idPrefix}-unNumber`;
  const imoClassId = `${idPrefix}-imoClass`;
  const reeferTempId = `${idPrefix}-reeferTemperature`;
  const reeferElectricalId = `${idPrefix}-reeferElectrical`;

  const showLoadFields = isContainerLoadApplicable(values.status);
  const showHazmatDetail = showLoadFields && isHazmatDetailApplicable(values.hazardous);
  const showReeferFields = isReeferContainerType(values.type);

  function handleStatusChange(next: string) {
    onChange({
      status: next,
      ...(next !== "dolu" ? { content: "", contentCustomText: "", grossWeight: "", hazardous: "", unNumber: "", imoClass: "" } : {}),
    });
  }
  function handleHazardousChange(next: string) {
    onChange({ hazardous: next, ...(next !== "evet" ? { unNumber: "", imoClass: "" } : {}) });
  }
  function handleTypeChange(next: string) {
    onChange({ type: next, ...(next !== "reefer" ? { reeferTemperature: "", reeferElectrical: "" } : {}) });
  }

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konteyner Grubu {index + 1}</p>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Konteyner Grubu ${index + 1}'i kaldır`}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Kaldır
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={quantityId} className="text-sm font-medium text-foreground">
            Konteyner Adedi
          </label>
          <input
            id={quantityId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.quantity}
            onChange={(event) => onChange({ quantity: event.target.value.replace(/[^0-9]/g, "") })}
            maxLength={digitInputMaxLength(MAX_CONTAINER_QUANTITY)}
            aria-invalid={errors?.quantity ? true : undefined}
            aria-describedby={errors?.quantity ? `${quantityId}-error` : undefined}
            placeholder="Ör. 20"
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors?.quantity ? "border-danger" : "border-border"
            }`}
          />
          {errors?.quantity && (
            <p id={`${quantityId}-error`} className="mt-2 text-sm text-danger">
              {errors.quantity}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={sizeId}
            label="Konteyner Ölçüsü"
            options={SIZE_OPTIONS}
            value={values.size}
            onChange={(next) => onChange({ size: next })}
            placeholder="Seçiniz"
            errorId={errors?.size ? `${sizeId}-error` : undefined}
          />
          {errors?.size && (
            <p id={`${sizeId}-error`} className="mt-2 text-sm text-danger">
              {errors.size}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={typeId}
            label="Konteyner Tipi"
            options={TYPE_OPTIONS}
            value={values.type}
            onChange={handleTypeChange}
            placeholder="Seçiniz"
            errorId={errors?.type ? `${typeId}-error` : undefined}
          />
          {errors?.type && (
            <p id={`${typeId}-error`} className="mt-2 text-sm text-danger">
              {errors.type}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={statusId}
            label="Yük Durumu"
            options={STATUS_OPTIONS}
            value={values.status}
            onChange={handleStatusChange}
            placeholder="Seçiniz"
            errorId={errors?.status ? `${statusId}-error` : undefined}
          />
          {errors?.status && (
            <p id={`${statusId}-error`} className="mt-2 text-sm text-danger">
              {errors.status}
            </p>
          )}
        </div>
      </div>

      {showLoadFields && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={values.content === PRODUCT_TYPE_CUSTOM_VALUE ? "sm:col-span-3" : undefined}>
            <ProductTypeCombobox
              id={contentId}
              label="Yük İçeriği"
              value={values.content}
              onChange={(next) => onChange({ content: next })}
              customText={values.contentCustomText}
              onCustomTextChange={(next) => onChange({ contentCustomText: next })}
              customFieldId={`${contentId}-custom`}
              suggestions={PRODUCT_TYPE_SUGGESTIONS}
              errorId={errors?.content ? `${contentId}-error` : undefined}
              customTextErrorId={errors?.contentCustomText ? `${contentId}-custom-error` : undefined}
            />
            {errors?.content && (
              <p id={`${contentId}-error`} className="mt-2 text-sm text-danger">
                {errors.content}
              </p>
            )}
            {errors?.contentCustomText && (
              <p id={`${contentId}-custom-error`} className="mt-2 text-sm text-danger">
                {errors.contentCustomText}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={weightId} className="text-sm font-medium text-foreground">
              Toplam Brüt Ağırlık (ton) <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
            </label>
            <input
              id={weightId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.grossWeight}
              onChange={(event) => onChange({ grossWeight: event.target.value.replace(/[^0-9.,]/g, "") })}
              maxLength={digitInputMaxLength(MAX_TONNAGE_TON, 3)}
              aria-invalid={errors?.grossWeight ? true : undefined}
              aria-describedby={errors?.grossWeight ? `${weightId}-error` : undefined}
              placeholder="Bilinmiyorsa boş bırakın"
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors?.grossWeight ? "border-danger" : "border-border"
              }`}
            />
            {errors?.grossWeight && (
              <p id={`${weightId}-error`} className="mt-2 text-sm text-danger">
                {errors.grossWeight}
              </p>
            )}
          </div>

          <div>
            <SearchableSelect
              id={hazardousId}
              label="Tehlikeli Madde"
              options={HAZARDOUS_OPTIONS}
              value={values.hazardous}
              onChange={handleHazardousChange}
              placeholder="Seçiniz"
              errorId={errors?.hazardous ? `${hazardousId}-error` : undefined}
            />
            {errors?.hazardous && (
              <p id={`${hazardousId}-error`} className="mt-2 text-sm text-danger">
                {errors.hazardous}
              </p>
            )}
          </div>
        </div>
      )}

      {showHazmatDetail && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={unNumberId} className="text-sm font-medium text-foreground">
              UN Numarası
            </label>
            <input
              id={unNumberId}
              type="text"
              autoComplete="off"
              maxLength={UN_NUMBER_MAX_LENGTH}
              value={values.unNumber}
              onChange={(event) => onChange({ unNumber: event.target.value })}
              aria-invalid={errors?.unNumber ? true : undefined}
              aria-describedby={errors?.unNumber ? `${unNumberId}-error` : undefined}
              placeholder="Ör. UN1230"
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors?.unNumber ? "border-danger" : "border-border"
              }`}
            />
            {errors?.unNumber && (
              <p id={`${unNumberId}-error`} className="mt-2 text-sm text-danger">
                {errors.unNumber}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={imoClassId} className="text-sm font-medium text-foreground">
              IMO Sınıfı
            </label>
            <select
              id={imoClassId}
              value={values.imoClass}
              onChange={(event) => onChange({ imoClass: event.target.value })}
              aria-invalid={errors?.imoClass ? true : undefined}
              aria-describedby={errors?.imoClass ? `${imoClassId}-error` : undefined}
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors?.imoClass ? "border-danger" : "border-border"
              }`}
            >
              <option value="">IMO sınıfı seçin</option>
              {IMO_CLASS_SELECT_ITEMS.map((item) =>
                item.kind === "single" ? (
                  <option key={item.option.id} value={item.option.id}>
                    {getImoClassOptionLabel(item.option)}
                  </option>
                ) : (
                  <optgroup key={item.label} label={item.label}>
                    {item.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {getImoClassOptionLabel(option)}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
            {errors?.imoClass && (
              <p id={`${imoClassId}-error`} className="mt-2 text-sm text-danger">
                {errors.imoClass}
              </p>
            )}
          </div>
        </div>
      )}

      {showReeferFields && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={reeferTempId} className="text-sm font-medium text-foreground">
              İstenen Sıcaklık (°C)
            </label>
            <input
              id={reeferTempId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.reeferTemperature}
              onChange={(event) => onChange({ reeferTemperature: event.target.value.replace(/[^0-9.,-]/g, "") })}
              maxLength={6}
              aria-invalid={errors?.reeferTemperature ? true : undefined}
              aria-describedby={errors?.reeferTemperature ? `${reeferTempId}-error` : undefined}
              placeholder="Ör. -18"
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors?.reeferTemperature ? "border-danger" : "border-border"
              }`}
            />
            {errors?.reeferTemperature && (
              <p id={`${reeferTempId}-error`} className="mt-2 text-sm text-danger">
                {errors.reeferTemperature}
              </p>
            )}
          </div>
          <div>
            <SearchableSelect
              id={reeferElectricalId}
              label="Elektrik Bağlantısı Gerekiyor mu?"
              options={HAZARDOUS_OPTIONS}
              value={values.reeferElectrical}
              onChange={(next) => onChange({ reeferElectrical: next })}
              placeholder="Seçiniz"
              errorId={errors?.reeferElectrical ? `${reeferElectricalId}-error` : undefined}
            />
            {errors?.reeferElectrical && (
              <p id={`${reeferElectricalId}-error`} className="mt-2 text-sm text-danger">
                {errors.reeferElectrical}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Konteyner Grupları" — dış kabuk: başlık/açıklama, her grup için bir
 * `StorageContainerGroupCard`, canlı "Toplam Konteyner: N Adet" göstergesi
 * (görev tanımı: kullanıcıdan AYRICA manuel toplam istenmez, HER ekleme/
 * silme/adet değişikliğinde ANINDA yeniden hesaplanır) ve "+ Konteyner
 * Grubu Ekle" butonu. Tek grup kalınca o grubun "Kaldır" butonu gizlenir
 * (görev tanımı: "tek grup kaldığında kullanıcı son grubu silemesin").
 * `errors` grup `id`sine göre anahtarlanır (dizi index'ine GÖRE DEĞİL — bir
 * ortadaki grup silindiğinde diğerlerinin index'i kayar, `id` hiç değişmez,
 * job-request-form.tsx#ServiceEntry.localId İLE AYNI ilke).
 */
export function StorageContainerGroupsFields({
  idPrefix,
  groups,
  errors,
  onChange,
}: {
  idPrefix: string;
  groups: StorageContainerGroupFieldValues[];
  errors?: Record<string, StorageContainerGroupErrors>;
  onChange: (nextGroups: StorageContainerGroupFieldValues[]) => void;
}) {
  const total = computeTotalContainerQuantity(
    groups.map((group) => ({ quantity: /^\d+$/.test(group.quantity.trim()) ? Number(group.quantity.trim()) : 0 })),
  );

  function handleGroupChange(groupId: string, patch: Partial<StorageContainerGroupFieldValues>) {
    onChange(groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }
  // "Aşılamaz Giriş Sınırları" görevi — Nakliye Yük Grupları İLE AYNI
  // kötüye kullanım riski (sınırsız grup ekleme), aynı ortak sınır.
  const reachedGroupLimit = groups.length >= MAX_STORAGE_CONTAINER_GROUPS;
  function handleAddGroup() {
    if (reachedGroupLimit) return;
    onChange([...groups, createEmptyStorageContainerGroupFields()]);
  }
  function handleRemoveGroup(groupId: string) {
    if (groups.length <= 1) return;
    onChange(groups.filter((group) => group.id !== groupId));
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-bold tracking-heading leading-tight text-foreground">Konteyner Grupları</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Konteynerin ölçü, tip ve yük durumunu belirtin. Dolu konteynerlerde yük içeriği ve tehlikeli madde bilgisi
          gereklidir. Farklı ölçü/tip/yük durumundaki konteynerler için ayrı grup ekleyebilirsiniz.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group, index) => (
          <StorageContainerGroupCard
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
      </div>

      {!reachedGroupLimit ? (
        <button
          type="button"
          onClick={handleAddGroup}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Konteyner Grubu Ekle
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">En fazla {MAX_STORAGE_CONTAINER_GROUPS} konteyner grubu ekleyebilirsiniz.</p>
      )}

      <p className="text-sm font-semibold text-foreground">Toplam Konteyner: {total} Adet</p>
    </div>
  );
}
