"use client";

import {
  ALL_RECYCLING_SCOPE_OF_WORK_IDS,
  RECYCLING_MATERIAL_CONDITION_OPTIONS,
  RECYCLING_REQUESTED_OPERATION_OPTIONS,
  RECYCLING_SCOPE_OF_WORK_OPTIONS,
  WASTE_QUANTITY_UNIT_OPTIONS,
} from "../_lib/recycling-catalog";
import {
  deriveWasteCodeHazardous,
  formatWasteCodeOptionLabel,
  getWasteCodeEntry,
  RECYCLING_UNKNOWN_WASTE_CODE_VALUE,
  requiresSpecialWasteCodeVerification,
  WASTE_CODE_SELECT_ITEMS,
  WASTE_HAZARD_PROPERTY_OPTIONS,
  WASTE_TYPE_OPTIONS,
  type WasteCodeEntry,
} from "../_lib/recycling-waste-code-catalog";
import { MultiSelectChips } from "./multi-select-chips";
import { SearchableSelect, type SearchableSelectOption } from "./searchable-select";

export type RecyclingFieldValues = {
  recyclingMaterialCategoryId: string;
  /** Yalnızca recyclingMaterialCategoryId === "diger" iken anlamlı — Atık Türü'nün serbest metin açıklaması (eski "Alt Tür" alanının YENİDEN KULLANIMI, bkz. job-form-validation.ts'in kendi notu). */
  recyclingMaterialSubtypeId: string;
  recyclingQuantity: string;
  recyclingUnit: string;
  recyclingMaterialCondition: string;
  recyclingMaterialConditionNote: string;
  recyclingScopeOfWork: string[];
  recyclingRequestedOperation: string;
  /** Boşsa VE recyclingWasteCodeUnknown false iken "seçilmemiş" anlamına gelir. */
  recyclingWasteCode: string;
  recyclingWasteCodeUnknown: boolean;
  recyclingHazardProperties: string[];
};

export type RecyclingFieldErrors = Partial<Record<keyof RecyclingFieldValues, string>>;

const WASTE_TYPE_SELECT_OPTIONS = WASTE_TYPE_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const UNIT_OPTIONS = WASTE_QUANTITY_UNIT_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const CONDITION_OPTIONS = RECYCLING_MATERIAL_CONDITION_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const SCOPE_OF_WORK_OPTIONS = RECYCLING_SCOPE_OF_WORK_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
  description: option.description,
}));
const REQUESTED_OPERATION_OPTIONS = RECYCLING_REQUESTED_OPERATION_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const HAZARD_PROPERTY_SELECT_OPTIONS = WASTE_HAZARD_PROPERTY_OPTIONS.map((option) => ({ value: option.id, label: option.label }));

/**
 * Geri Dönüşüm & Atık Tahliye'ye özel alan grubu — TEK paylaşılan JSX bloğu,
 * `customs-brokerage-fields.tsx` ile BİREBİR aynı rol: hem
 * `job-request-form.tsx`in her hizmet kartında hem `job-edit-form.tsx`de hem
 * `admin-job-edit-form.tsx`de aynı şekilde render edilir. Yalnızca çağıranın
 * zaten `isRecyclingCategory(category)` true olduğunda mount etmesi
 * beklenir — bu bileşen kendi içinde kategori kontrolü yapmaz.
 *
 * KASITLI OLARAK YOK: bir "İşlem Türü" (hizmet satın alma / alım teklifi)
 * seçimi. Teklif tarafı bu kategori için hiç değişmedi (bkz. offer-form.tsx)
 * — Hizmet Veren, "Hizmet Kapsamı"nda işaretlenen seçeneklerin TAMAMI için
 * TEK bir toplam hizmet bedeli teklif eder (bu hizmet anahtar teslimdir).
 * Hiçbir kapsam seçeneği (özellikle "Yükleme"/"Taşıma") otomatik olarak
 * ayrı bir Forklift/Vinç/Nakliye ilanı OLUŞTURMAZ.
 */
/** SearchableSelect'in kendi arama alanı hem koda (label) hem açıklamaya (keywords) bakar — görev talimatı: "Kullanıcı hem kodla hem açıklamayla arama yapabilsin." `hint` sağda EK-4 bölüm başlığını gösterir, "Ana gruplar... anlaşılır biçimde gösterilmeli" gereksinimi bu satır-bazlı bağlamla karşılanır (SearchableSelect gerçek optgroup DESTEKLEMEZ, bkz. component'in kendi dosyası) — liste WASTE_CODE_ENTRIES'in KENDİ resmî sırasıyla (arama yokken) gelir, asla alfabetik değil. */
/**
 * DÜZELTME (kök neden): WASTE_CODE_SELECT_ITEMS'daki HER kod gerçekte bir
 * `groupLabel` taşıdığı için (bkz. o dosyanın kendi kaçış-kapısı notu) her
 * zaman `kind: "group"` dalına düşer — önceki sürüm yalnızca (hiç
 * üretilmeyen) `kind: "entry"` dalını okuyordu ve bu yüzden Atık Kodu
 * seçicisi "Atık kodunu bilmiyorum" DIŞINDA HİÇBİR kod göstermiyordu
 * (gerçek tarayıcı testiyle bulunan bir bug). Doğru davranış: HER İKİ dal
 * da düzleştirilir (`kind: "group"`ın kendi `entries` dizisi dahil) —
 * SearchableSelect gerçek optgroup DESTEKLEMEZ, bu yüzden grup sınırı bir
 * bölücü olarak DEĞİL, her satırın kendi `hint`i (sağda EK-4 bölüm başlığı)
 * olarak taşınır.
 */
function flattenWasteCodeEntry(entry: WasteCodeEntry): SearchableSelectOption {
  return { value: entry.code, label: formatWasteCodeOptionLabel(entry), hint: entry.groupLabel, keywords: [entry.description, entry.groupLabel] };
}
const WASTE_CODE_SEARCHABLE_OPTIONS: SearchableSelectOption[] = WASTE_CODE_SELECT_ITEMS.flatMap<SearchableSelectOption>((item) =>
  item.kind === "entry" ? [flattenWasteCodeEntry(item.entry)] : item.entries.map(flattenWasteCodeEntry),
).concat([{ value: RECYCLING_UNKNOWN_WASTE_CODE_VALUE, label: "Atık kodunu bilmiyorum", keywords: [] }]);

export function RecyclingFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  /** Her alanın DOM id'sini benzersizleştirmek için — bkz. job-request-form.tsx#serviceFieldId'deki AYNI gerekçe. */
  idPrefix: string;
  values: RecyclingFieldValues;
  errors: RecyclingFieldErrors;
  onChange: (patch: Partial<RecyclingFieldValues>) => void;
}) {
  const requestedOperationId = `${idPrefix}-recyclingRequestedOperation`;
  const materialCategoryId = `${idPrefix}-recyclingMaterialCategoryId`;
  const materialSubtypeId = `${idPrefix}-recyclingMaterialSubtypeId`;
  const wasteCodeId = `${idPrefix}-recyclingWasteCode`;
  const hazardPropertiesId = `${idPrefix}-recyclingHazardProperties`;
  const quantityId = `${idPrefix}-recyclingQuantity`;
  const unitId = `${idPrefix}-recyclingUnit`;
  const conditionId = `${idPrefix}-recyclingMaterialCondition`;
  const conditionNoteId = `${idPrefix}-recyclingMaterialConditionNote`;
  const scopeOfWorkId = `${idPrefix}-recyclingScopeOfWork`;

  const isOtherWasteType = values.recyclingMaterialCategoryId === "diger";
  const wasteCodeSelectValue = values.recyclingWasteCodeUnknown ? RECYCLING_UNKNOWN_WASTE_CODE_VALUE : values.recyclingWasteCode;
  const selectedWasteCodeEntry = getWasteCodeEntry(values.recyclingWasteCode);
  // "D. TEHLİKE DURUMU" — TEK doğruluk kaynağı koddan türetilir, kullanıcı
  // hiçbir zaman bunu doğrudan değiştiremez (görev talimatının kesin şartı).
  const hazardous = values.recyclingWasteCodeUnknown ? null : deriveWasteCodeHazardous(values.recyclingWasteCode);

  function handleWasteCodeChange(next: string) {
    if (next === RECYCLING_UNKNOWN_WASTE_CODE_VALUE) {
      onChange({ recyclingWasteCode: "", recyclingWasteCodeUnknown: true, recyclingHazardProperties: [] });
      return;
    }
    // Kod değişince (ya da "bilmiyorum"dan çıkılınca), o kodun ARTIK
    // tehlikeli olmayabileceği ihtimaline karşı tehlike özellikleri
    // seçimi temizlenir — bir önceki kodun tehlike özellikleri yeni koda
    // sahte olarak taşınmasın (turkey-locations.ts'in il/ilçe değişince
    // facilityId'yi temizlemesiyle AYNI ilke).
    onChange({ recyclingWasteCode: next, recyclingWasteCodeUnknown: false, recyclingHazardProperties: [] });
  }

  return (
    <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-bold tracking-heading leading-tight text-foreground">
          Geri Dönüşüm & Atık Tahliye — Atık Bilgileri
        </h3>
      </div>

      <div>
        <SearchableSelect
          id={requestedOperationId}
          label="Talep Edilen İşlem"
          options={REQUESTED_OPERATION_OPTIONS}
          value={values.recyclingRequestedOperation}
          onChange={(next) => onChange({ recyclingRequestedOperation: next })}
          placeholder="İşlem türünü seçiniz"
          errorId={errors.recyclingRequestedOperation ? `${requestedOperationId}-error` : undefined}
        />
        {errors.recyclingRequestedOperation && (
          <p id={`${requestedOperationId}-error`} className="mt-2 text-sm text-danger">
            {errors.recyclingRequestedOperation}
          </p>
        )}
      </div>

      <div className={isOtherWasteType ? "grid gap-6 sm:grid-cols-2" : undefined}>
        <div>
          <SearchableSelect
            id={materialCategoryId}
            label="Atık Türü"
            options={WASTE_TYPE_SELECT_OPTIONS}
            value={values.recyclingMaterialCategoryId}
            onChange={(next) => onChange({ recyclingMaterialCategoryId: next, recyclingMaterialSubtypeId: "" })}
            placeholder="Atık türü seçiniz"
            errorId={errors.recyclingMaterialCategoryId ? `${materialCategoryId}-error` : undefined}
          />
          {errors.recyclingMaterialCategoryId && (
            <p id={`${materialCategoryId}-error`} className="mt-2 text-sm text-danger">
              {errors.recyclingMaterialCategoryId}
            </p>
          )}
        </div>

        {isOtherWasteType && (
          <div>
            <label htmlFor={materialSubtypeId} className="text-sm font-medium text-foreground">
              Atık Türünü Açıklayın
            </label>
            <input
              id={materialSubtypeId}
              type="text"
              value={values.recyclingMaterialSubtypeId}
              onChange={(event) => onChange({ recyclingMaterialSubtypeId: event.target.value })}
              aria-invalid={errors.recyclingMaterialSubtypeId ? true : undefined}
              aria-describedby={errors.recyclingMaterialSubtypeId ? `${materialSubtypeId}-error` : undefined}
              placeholder="Kısaca açıklayın"
              maxLength={200}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {errors.recyclingMaterialSubtypeId && (
              <p id={`${materialSubtypeId}-error`} className="mt-2 text-sm text-danger">
                {errors.recyclingMaterialSubtypeId}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <SearchableSelect
          id={wasteCodeId}
          label="Atık Kodu"
          options={WASTE_CODE_SEARCHABLE_OPTIONS}
          value={wasteCodeSelectValue}
          onChange={handleWasteCodeChange}
          placeholder="Kod veya açıklama ile arayın"
          errorId={errors.recyclingWasteCode ? `${wasteCodeId}-error` : undefined}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Atık kodları Atık Yönetimi Yönetmeliği EK-4 listesine göredir. Bilmiyorsanız &quot;Atık kodunu bilmiyorum&quot;
          seçeneğini işaretleyebilirsiniz — bu durumda ilanınız admin incelemesinden geçmeden depocu eşleşmesine
          açılmaz.
        </p>
        {errors.recyclingWasteCode && (
          <p id={`${wasteCodeId}-error`} className="mt-2 text-sm text-danger">
            {errors.recyclingWasteCode}
          </p>
        )}

        {!values.recyclingWasteCodeUnknown && selectedWasteCodeEntry && (
          <p className="mt-3 text-sm font-medium text-foreground">
            Atık Durumu:{" "}
            <span className={hazardous ? "text-danger" : "text-success"}>{hazardous ? "Tehlikeli Atık" : "Tehlikesiz Atık"}</span>
          </p>
        )}
        {!values.recyclingWasteCodeUnknown && requiresSpecialWasteCodeVerification(values.recyclingWasteCode) && (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
            Bu atık kodu özel/yüksek riskli bir kapsamdır — yalnızca bu kod için ayrıca admin onayı almış bir hizmet
            veren teklif verebilir; genel Geri Dönüşüm & Atık Tahliye yetkisi bu kod için otomatik yeterli değildir.
          </p>
        )}
      </div>

      {hazardous === true && (
        <div>
          <MultiSelectChips
            id={hazardPropertiesId}
            label="Atığın Tehlike Özelliği"
            options={HAZARD_PROPERTY_SELECT_OPTIONS}
            selected={values.recyclingHazardProperties}
            onChange={(next) => onChange({ recyclingHazardProperties: next })}
            errorId={errors.recyclingHazardProperties ? `${hazardPropertiesId}-error` : undefined}
          />
          {errors.recyclingHazardProperties && (
            <p id={`${hazardPropertiesId}-error`} className="mt-2 text-sm text-danger">
              {errors.recyclingHazardProperties}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor={quantityId} className="text-sm font-medium text-foreground">
            Tahmini Miktar
          </label>
          <input
            id={quantityId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.recyclingQuantity}
            onChange={(event) => onChange({ recyclingQuantity: event.target.value.replace(/[^0-9.,]/g, "") })}
            aria-invalid={errors.recyclingQuantity ? true : undefined}
            aria-describedby={errors.recyclingQuantity ? `${quantityId}-error` : undefined}
            placeholder="Ör. 8"
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.recyclingQuantity && (
            <p id={`${quantityId}-error`} className="mt-2 text-sm text-danger">
              {errors.recyclingQuantity}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={unitId}
            label="Birim"
            options={UNIT_OPTIONS}
            value={values.recyclingUnit}
            onChange={(next) => onChange({ recyclingUnit: next })}
            placeholder="Birim seçiniz"
            errorId={errors.recyclingUnit ? `${unitId}-error` : undefined}
          />
          {errors.recyclingUnit && (
            <p id={`${unitId}-error`} className="mt-2 text-sm text-danger">
              {errors.recyclingUnit}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className={values.recyclingMaterialCondition === "diger" ? undefined : "sm:col-span-2"}>
          <SearchableSelect
            id={conditionId}
            label="Malzeme Durumu"
            options={CONDITION_OPTIONS}
            value={values.recyclingMaterialCondition}
            onChange={(next) =>
              onChange({
                recyclingMaterialCondition: next,
                recyclingMaterialConditionNote: next === "diger" ? values.recyclingMaterialConditionNote : "",
              })
            }
            placeholder="Malzeme durumu seçiniz"
            errorId={errors.recyclingMaterialCondition ? `${conditionId}-error` : undefined}
          />
          {errors.recyclingMaterialCondition && (
            <p id={`${conditionId}-error`} className="mt-2 text-sm text-danger">
              {errors.recyclingMaterialCondition}
            </p>
          )}
        </div>

        {values.recyclingMaterialCondition === "diger" && (
          <div>
            <label htmlFor={conditionNoteId} className="text-sm font-medium text-foreground">
              Malzeme Durumu Açıklaması
            </label>
            <input
              id={conditionNoteId}
              type="text"
              value={values.recyclingMaterialConditionNote}
              onChange={(event) => onChange({ recyclingMaterialConditionNote: event.target.value })}
              aria-invalid={errors.recyclingMaterialConditionNote ? true : undefined}
              aria-describedby={errors.recyclingMaterialConditionNote ? `${conditionNoteId}-error` : undefined}
              placeholder="Kısaca açıklayın"
              maxLength={300}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {errors.recyclingMaterialConditionNote && (
              <p id={`${conditionNoteId}-error`} className="mt-2 text-sm text-danger">
                {errors.recyclingMaterialConditionNote}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        {/*
          "Tüm Süreç" (görev tanımı: "Geri Dönüşüm Hizmet Kapsamı
          Sadeleştirmesi") — bağımsız 5. bir kapsam DEĞİLDİR, hiçbir zaman
          `onChange`e kendi id'siyle YAZILMAZ. Salt türetilmiş (derived)
          durum: `allSelected` her render'da 4 gerçek id'nin TAMAMI seçili mi
          diye kontrol eder — ayrı bir state değişkeni TUTULMAZ, bu sayede
          "tek tek 4'ünü seçince Tüm Süreç otomatik aktif görünsün" /
          "4'ünden biri kaldırılınca Tüm Süreç aktiflikten çıksın" davranışı
          KENDİLİĞİNDEN doğru olur (görev tanımının 2 ayrı maddesi, tek bir
          hesaplamayla karşılanıyor). Tıklanınca: hiçbiri eksik değilse (tam
          4/4) hepsini TEMİZLER, aksi halde (0 ya da kısmi seçim) hepsini
          SEÇER.
        */}
        <MultiSelectChips
          id={scopeOfWorkId}
          label="Hangi işlemler hizmete dahil olsun?"
          options={SCOPE_OF_WORK_OPTIONS}
          selected={values.recyclingScopeOfWork}
          onChange={(next) => onChange({ recyclingScopeOfWork: next })}
          errorId={errors.recyclingScopeOfWork ? `${scopeOfWorkId}-error` : undefined}
          headerAction={
            <button
              type="button"
              aria-pressed={ALL_RECYCLING_SCOPE_OF_WORK_IDS.every((id) => values.recyclingScopeOfWork.includes(id))}
              onClick={() =>
                onChange({
                  recyclingScopeOfWork: ALL_RECYCLING_SCOPE_OF_WORK_IDS.every((id) =>
                    values.recyclingScopeOfWork.includes(id),
                  )
                    ? []
                    : [...ALL_RECYCLING_SCOPE_OF_WORK_IDS],
                })
              }
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                ALL_RECYCLING_SCOPE_OF_WORK_IDS.every((id) => values.recyclingScopeOfWork.includes(id))
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:border-primary/40"
              }`}
            >
              Tüm Süreç
            </button>
          }
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Birden fazla işlem seçebilirsiniz. Seçtiğiniz işlemlerin tamamı için tek bir toplam hizmet bedeli teklif
          edilir.
        </p>
        {errors.recyclingScopeOfWork && (
          <p id={`${scopeOfWorkId}-error`} className="mt-2 text-sm text-danger">
            {errors.recyclingScopeOfWork}
          </p>
        )}
      </div>
    </div>
  );
}
