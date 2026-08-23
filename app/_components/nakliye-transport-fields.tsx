"use client";

import { Info } from "lucide-react";
import {
  ADR_CLASS_DISCLAIMER_TEXT,
  ADR_CLASS_UNKNOWN_LABEL,
  ADR_CLASS_UNKNOWN_VALUE,
  ADR_HAZARD_CLASS_SELECT_ITEMS,
  CONTAINER_CONTENT_OPTIONS,
  CONTAINER_TOGGLE_OPTIONS,
  CONTAINER_TYPE_OPTIONS,
  getAdrHazardClassOptionLabel,
  isLoadingMethodId,
  LOAD_PREPARATION_TYPE_OPTIONS,
  LOADING_METHOD_OPTIONS,
  NAKLIYE_MANUAL_ENTRY_OPTION_LABEL,
  NAKLIYE_MANUAL_ENTRY_VALUE,
  TRAILER_TYPE_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  type NakliyeCargoGroupFieldValues,
} from "../_lib/nakliye-transport-catalog";
import { useFocusOnBecomeTrue } from "../_lib/use-focus-on-become-true";
import { MANUAL_ENTRY_TEXT_MAX_LENGTH, MAX_CONTAINER_QUANTITY } from "../_lib/field-limits";
import type { NakliyeDetails, NakliyeVehiclePreference } from "../_lib/types";
import { CompactMultiSelect } from "./multi-select-chips";
import { SearchableSelect } from "./searchable-select";

/**
 * "Nakliye Yeniden Tasarımı" / "Nakliye Alan Sadeleştirmesi" — Araç Tercihi,
 * Yükleme/Teslimat operasyon detayları ve Özel Taşıma Koşulları (Tehlikeli
 * Madde/ADR, Konteyner Taşıması) için TEK paylaşılan form bileşeni —
 * job-request-form.tsx/job-edit-form.tsx arasında birebir aynı JSX'i tekrar
 * ETMEMEK için. Yükün Hazırlanış Biçimi ve Yükleme Yöntemi de (bu görevle
 * TEK seçimli birer dropdown'a indirgendi) burada, `DropdownWithManualEntry`
 * paylaşılan alt bileşeni üzerinden render edilir — job-location.ts#
 * FACILITY_FREE_TEXT_VALUE'nün kurduğu "sentinel seçilince serbest metin
 * alanı aç" ilkesiyle AYNI, ikinci bir kalıp İCAT EDİLMEDİ.
 *
 * "Nakliye Alan Sadeleştirmesi" görevi (uncommitted, ikinci büyük revizyon):
 * Taşıma Şekli/Sevkiyat Yapısı (+ tüm sefer/tekrar alt alanları), Boşaltma
 * Yöntemi, Sıcaklık Kontrollü ve Gabari Dışı/Ağır Yük TAMAMEN kaldırıldı —
 * `ShipmentPlanFields` artık yalnızca Yükleme/Teslim Tarihi'ni render eder
 * (Taşıma Planı kartının geri kalanı boşaldığı için), `TemperatureControl-
 * Fields`/`OversizedLoadFields` bileşenleri ve eski çoklu-seçim `Loading-
 * MethodField`/`UnloadingMethodField` (chip listesi) tamamen silindi.
 *
 * TÜM alt bloklar (form state seviyesinde) STRING tabanlı düz nesnelerdir —
 * denetimli input + gönderim anında tipli Job alanına çevir deseni.
 * `toNakliyeDetailsFields`/`fromNakliyeDetailsFields` bu çeviriyi HER İKİ
 * yönde yapar.
 */
export type NakliyeDetailsFieldValues = {
  // Araç Tercihi
  suggestByProvider: boolean;
  vehicleTypes: string[];
  trailerTypes: string[];
  // Yükleme Yöntemi — "+ Ek yükleme koşulları"/"+ Ek teslimat koşulları"
  // panelleri (Yer Tipi/Randevu/Saat/Kantar/Erişim/PPE/Süre/Bekleme/POD)
  // TAMAMEN kaldırıldığı için bu ikisi dışında hiçbir yükleme/teslimat
  // operasyon alanı KALMADI.
  loadingMethod: string;
  loadingMethodCustomText: string;
};

/**
 * "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
 * Taşındı" görevleri — Yükün Hazırlanış Biçimi/Ölçü ve Yerleşim/Konteyner
 * Taşıması/Tehlikeli Madde-ADR artık BURADA (job/hizmet seviyesinde, TEK)
 * DEĞİL, `nakliye-transport-catalog.ts#NakliyeCargoGroupFieldValues`
 * dizisinde (grup başına) tutulur — bkz. o tipin üstündeki doküman. Bu
 * obje artık yalnızca Araç Tercihi/Yükleme Yöntemi gibi GERÇEKTEN job/hizmet
 * başına tekil kalan alanları taşır.
 */
export function createEmptyNakliyeDetailsFields(): NakliyeDetailsFieldValues {
  return {
    suggestByProvider: false, vehicleTypes: [], trailerTypes: [],
    loadingMethod: "", loadingMethodCustomText: "",
  };
}

export function toNakliyeDetailsFields(details: NakliyeDetails | undefined): NakliyeDetailsFieldValues {
  const empty = createEmptyNakliyeDetailsFields();
  if (!details) return empty;
  const vehicle = details.vehiclePreference;
  return {
    ...empty,
    suggestByProvider: vehicle?.suggestByProvider ?? false,
    vehicleTypes: vehicle?.vehicleTypes ?? [],
    trailerTypes: vehicle?.trailerTypes ?? [],
    loadingMethod: details.loadingMethod ?? "",
    loadingMethodCustomText: details.loadingMethodCustomText ?? "",
  };
}

/**
 * `fields`ten `NakliyeDetails`in artık YALNIZCA job/hizmet seviyesinde
 * tekil kalan alt kümesini üretir (vehiclePreference/loadingMethod).
 * "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
 * Taşındı" görevleri — Yükün Hazırlanış Biçimi/Ölçü ve Yerleşim/Konteyner
 * Taşıması/Tehlikeli Madde-ADR artık `nakliye-transport-catalog.ts#
 * fromCargoGroupsFields`ten (grup başına) gelir; bu fonksiyon o dört alanı
 * BİLEREK hiç DÖNDÜRMEZ (`NakliyeDetails`teki karşılıkları hâlâ opsiyonel
 * olduğu için eksik olmaları geçerlidir) — çağıran taraf (job-request-
 * form.tsx/job-edit-form.tsx) bu sonucu cargo-groups mirror'ıyla birleştirir.
 * "Konteyner Taşımalarında Araç Tercihi Gizleme" görevi hâlâ geçerli — ama
 * artık job seviyesinde DEĞİL, GRUP seviyesinde uygulanır (bkz. job-request-
 * form.tsx#showVehiclePreference — herhangi bir grup konteyner modundayken
 * tüm Araç Tercihi bölümü gizlenir), bu yüzden bu fonksiyon kendi başına bir
 * "container mode" kavramı taşımaz; gizleme/temizleme çağıran tarafın işidir.
 */
export function fromNakliyeDetailsFields(fields: NakliyeDetailsFieldValues): NakliyeDetails {
  const vehiclePreference: NakliyeVehiclePreference | undefined =
    fields.suggestByProvider || fields.vehicleTypes.length > 0 || fields.trailerTypes.length > 0
      ? { suggestByProvider: fields.suggestByProvider, vehicleTypes: fields.vehicleTypes.length > 0 ? fields.vehicleTypes : undefined, trailerTypes: fields.trailerTypes.length > 0 ? fields.trailerTypes : undefined }
      : undefined;

  const loadingMethod = isLoadingMethodId(fields.loadingMethod) || fields.loadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE ? fields.loadingMethod : undefined;

  return {
    vehiclePreference,
    loadingMethod,
    loadingMethodCustomText: loadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE ? fields.loadingMethodCustomText.trim() || undefined : undefined,
  };
}

/* ========================================================================
 * Küçük paylaşılan yardımcı bileşenler
 * ==================================================================== */
/**
 * "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu bileşenlerin
 * `<input>`larında `maxLength` HİÇ yoktu. Keystroke-filtresi (yalnızca
 * rakam/nokta/virgül kabul eden `replace`) tek başına yeterli DEĞİL — bir
 * kullanıcı 10.000 haneli bir sayı yapıştırabilir, her karakter filtreyi
 * geçer (hepsi rakam), yalnızca gönderim anında (ya da hiç, alan
 * doğrulanmıyorsa) reddedilir. `maxLength` artık ZORUNLU bir prop: her
 * çağıran (nakliye-cargo-group-fields.tsx/nakliye-measurement-fields.tsx)
 * kendi alanının gerçek üst sınırına (field-limits.ts) karşılık gelen
 * karakter sayısını geçer — "unutulan bir çağıran sınırsız kalır" riskini
 * ortadan kaldırmak için varsayılan değer YOK.
 */
export function TextField({ id, label, value, onChange, placeholder, optional, maxLength }: { id: string; label: string; value: string; onChange: (next: string) => void; placeholder?: string; optional?: boolean; maxLength: number }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label} {optional && <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>}
      </label>
      <input id={id} type="text" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
        className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    </div>
  );
}

export function NumberField({ id, label, value, onChange, placeholder, optional, allowNegative, error, maxLength }: { id: string; label: string; value: string; onChange: (next: string) => void; placeholder?: string; optional?: boolean; allowNegative?: boolean; error?: string; maxLength: number }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label} {optional && <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>}
      </label>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value}
        onChange={(e) => onChange(e.target.value.replace(allowNegative ? /[^0-9.,-]/g : /[^0-9.,]/g, ""))}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${error ? "border-danger" : "border-border"}`} />
      {error && <p id={`${id}-error`} className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * TEK seçimli dropdown + "Listede yok / Kendim gireceğim" seçilince hemen
 * altında açılan serbest metin alanı — job-location.ts#FACILITY_FREE_TEXT_VALUE
 * İLE AYNI sentinel ilkesi, ama o dosyanın "tek kutu morph" davranışından
 * FARKLI: buradaki dropdown her zaman görünür kalır (görev talimatının kendi
 * ifadesi — "İlgili dropdown'ın hemen altında manuel metin alanı açılsın"),
 * yalnızca hazır bir seçeneğe dönmek manuel alanı gizler (geri dönüş için
 * ayrı bir buton gerekmez, dropdown zaten açık). Yükün Hazırlanış Biçimi VE
 * Yükleme Yöntemi'nin İKİSİ de bu TEK bileşeni paylaşır — ikinci bir
 * dropdown bileşeni İCAT EDİLMEDİ.
 */
export function DropdownWithManualEntry({
  id,
  label,
  options,
  value,
  onChange,
  customText,
  onCustomTextChange,
  customFieldId,
  customLabel,
  customTextError,
  selectError,
}: {
  id: string;
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  customText: string;
  onCustomTextChange: (next: string) => void;
  customFieldId: string;
  customLabel: string;
  customTextError?: string;
  selectError?: string;
}) {
  const isCustom = value === NAKLIYE_MANUAL_ENTRY_VALUE;
  const customInputRef = useFocusOnBecomeTrue<HTMLInputElement>(isCustom);
  const selectOptions = [
    ...options.map((option) => ({ value: option.id, label: option.label })),
    { value: NAKLIYE_MANUAL_ENTRY_VALUE, label: NAKLIYE_MANUAL_ENTRY_OPTION_LABEL },
  ];
  return (
    <div>
      <SearchableSelect
        id={id}
        label={label}
        options={selectOptions}
        value={value}
        onChange={onChange}
        placeholder="Seçiniz"
        errorId={selectError ? `${id}-error` : undefined}
      />
      {selectError && <p id={`${id}-error`} className="mt-2 text-sm text-danger">{selectError}</p>}
      {isCustom && (
        <div className="mt-3">
          <label htmlFor={customFieldId} className="text-sm font-medium text-foreground">
            {customLabel}
          </label>
          <input
            ref={customInputRef}
            id={customFieldId}
            type="text"
            autoComplete="off"
            value={customText}
            onChange={(event) => onCustomTextChange(event.target.value)}
            maxLength={MANUAL_ENTRY_TEXT_MAX_LENGTH}
            aria-invalid={customTextError ? true : undefined}
            aria-describedby={customTextError ? `${customFieldId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${customTextError ? "border-danger" : "border-border"}`}
          />
          {customTextError && <p id={`${customFieldId}-error`} className="mt-2 text-sm text-danger">{customTextError}</p>}
        </div>
      )}
    </div>
  );
}

/** "Yükün Hazırlanış Biçimi" — DropdownWithManualEntry'nin TEK seçimli bir sarmalayıcısı. */
export function LoadPreparationField({
  idPrefix,
  values,
  onChange,
  selectError,
  customTextError,
}: {
  idPrefix: string;
  values: NakliyeCargoGroupFieldValues;
  onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void;
  selectError?: string;
  customTextError?: string;
}) {
  return (
    <DropdownWithManualEntry
      id={`${idPrefix}-load-preparation-type`}
      label="Yükün Hazırlanış Biçimi"
      options={LOAD_PREPARATION_TYPE_OPTIONS}
      value={values.loadPreparationType}
      onChange={(next) => onChange({ loadPreparationType: next, loadPreparationCustomText: next === NAKLIYE_MANUAL_ENTRY_VALUE ? values.loadPreparationCustomText : "" })}
      customText={values.loadPreparationCustomText}
      onCustomTextChange={(next) => onChange({ loadPreparationCustomText: next })}
      customFieldId={`${idPrefix}-load-preparation-custom`}
      customLabel="Yükün hazırlanış biçimini yazın"
      selectError={selectError}
      customTextError={customTextError}
    />
  );
}

/* ========================================================================
 * Taşıma Planı — "Nakliye Alan Sadeleştirmesi" görevi: Taşıma Şekli/
 * Sevkiyat Yapısı (+ tüm sefer/tekrar alt alanları) TAMAMEN kaldırıldı.
 * Geriye yalnızca Yükleme/Teslim Tarihi kalıyor — veri hâlâ TEK bir yerde
 * (`service.workDate`/`workEndDate`) tutulur, bu bileşen yalnızca onu
 * görüntüleyen/değiştiren giriş noktasıdır.
 * ==================================================================== */
export function ShipmentPlanFields({
  idPrefix,
  workDate,
  workEndDate,
  onWorkDateChange,
  onWorkEndDateChange,
  workDateError,
  workEndDateError,
  todayLocalDate,
}: {
  idPrefix: string;
  workDate: string;
  workEndDate: string;
  onWorkDateChange: (next: string) => void;
  onWorkEndDateChange: (next: string) => void;
  workDateError?: string;
  workEndDateError?: string;
  todayLocalDate: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-work-date`} className="text-sm font-medium text-foreground">Yükleme Tarihi</label>
        <input id={`${idPrefix}-work-date`} type="date" min={todayLocalDate} value={workDate} onChange={(e) => onWorkDateChange(e.target.value)}
          aria-invalid={workDateError ? true : undefined}
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${workDateError ? "border-danger" : "border-border"}`} />
        {workDateError && <p className="mt-2 text-sm text-danger">{workDateError}</p>}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-work-end-date`} className="text-sm font-medium text-foreground">Teslim Tarihi</label>
        <input id={`${idPrefix}-work-end-date`} type="date" min={workDate || todayLocalDate} value={workEndDate} onChange={(e) => onWorkEndDateChange(e.target.value)}
          aria-invalid={workEndDateError ? true : undefined}
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${workEndDateError ? "border-danger" : "border-border"}`} />
        {workEndDateError && <p className="mt-2 text-sm text-danger">{workEndDateError}</p>}
      </div>
    </div>
  );
}

/* ========================================================================
 * Araç Tercihi (değişmedi)
 * ==================================================================== */
export function VehiclePreferenceFields({ idPrefix, values, onChange }: { idPrefix: string; values: NakliyeDetailsFieldValues; onChange: (patch: Partial<NakliyeDetailsFieldValues>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <CompactMultiSelect
        id={`${idPrefix}-vehicle-types`}
        label="Araç Tipi"
        options={VEHICLE_TYPE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        selected={values.vehicleTypes}
        onChange={(next) => onChange({ vehicleTypes: next })}
        disabled={values.suggestByProvider}
      />
      <CompactMultiSelect
        id={`${idPrefix}-trailer-types`}
        label="Kasa/Dorse Tipi"
        options={TRAILER_TYPE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        selected={values.trailerTypes}
        onChange={(next) => onChange({ trailerTypes: next })}
        disabled={values.suggestByProvider}
      />
      <label className="flex items-start gap-2 text-sm text-foreground lg:pt-8">
        <input type="checkbox" checked={values.suggestByProvider} onChange={(e) => onChange({ suggestByProvider: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-border" />
        <span>
          Nakliyeci uygun aracı önersin
          <span className="mt-0.5 block text-xs text-muted-foreground">Seçerseniz, uygun araç teklif edilecektir. Teklif sahibi önerdiği aracın yüke uygunluğunu belirtmelidir.</span>
        </span>
      </label>
    </div>
  );
}

/* ========================================================================
 * Yükleme/Teslimat operasyon detayları
 * ==================================================================== */
/** Yükleme Yöntemi — her zaman görünür TEK seçimli dropdown (+ manuel giriş). */
export function LoadingMethodField({ idPrefix, values, onChange, customTextError }: { idPrefix: string; values: NakliyeDetailsFieldValues; onChange: (patch: Partial<NakliyeDetailsFieldValues>) => void; customTextError?: string }) {
  return (
    <DropdownWithManualEntry
      id={`${idPrefix}-method`}
      label="Yükleme Yöntemi"
      options={LOADING_METHOD_OPTIONS}
      value={values.loadingMethod}
      onChange={(next) => onChange({ loadingMethod: next, loadingMethodCustomText: next === NAKLIYE_MANUAL_ENTRY_VALUE ? values.loadingMethodCustomText : "" })}
      customText={values.loadingMethodCustomText}
      onCustomTextChange={(next) => onChange({ loadingMethodCustomText: next })}
      customFieldId={`${idPrefix}-method-custom`}
      customLabel="Yükleme yöntemini yazın"
      customTextError={customTextError}
    />
  );
}

/*
 * "+ Ek yükleme koşulları" / "+ Ek teslimat koşulları" kaldırıldı ("Nakliye
 * Yükleme/Teslimat Koşulları Sadeleştirmesi" görevi) — bu iki bağımsız
 * açılır bölüm ve altındaki ikincil alanlar (Yer Tipi/Randevu/Saat/Kantar/
 * Erişim/PPE/Süre/Bekleme/POD) tamamen kaldırıldı. Yükleme Yöntemi dropdown'ı
 * (kendi manuel giriş alanıyla birlikte) `LoadingMethodField` üzerinden
 * DEĞİŞMEDEN çalışmaya devam ediyor — yalnızca onu saran toggle/alt-alan
 * bileşenleri (LoadingRouteExtras/LoadingAdvancedFields/UnloadingRouteExtras/
 * UnloadingAdvancedFields) silindi. Eski kayıtlı veri (varsa) sanitizer
 * seviyesinde yok edilmiyor, yalnızca artık hiçbir form ekranında
 * gösterilmiyor/istenmiyor/yeni payload'a dahil edilmiyor.
 */

/* ========================================================================
 * Özel Taşıma Koşulları — yalnızca Tehlikeli Madde/ADR ve Konteyner
 * Taşıması kaldı ("Nakliye Alan Sadeleştirmesi" görevi: Sıcaklık Kontrollü
 * ve Gabari Dışı/Ağır Yük TAMAMEN kaldırıldı).
 * ==================================================================== */
export type SpecialConditionErrors = Partial<Record<
  "hazmatAdrClass" | "containerType" | "containerLoadStatus" | "containerQuantity" | "containerContent",
  string
>>;

export function CompactConditionToggle({
  id,
  title,
  hint,
  options,
  value,
  onChange,
}: {
  id: string;
  title: string;
  hint: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span title={hint} tabIndex={0} className="inline-flex cursor-help text-muted-foreground focus-visible:outline-none">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{hint}</span>
        </span>
      </div>
      <div role="radiogroup" aria-label={title} id={id} className="mt-2 flex rounded-md border border-border bg-background p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            onClick={() => onChange(option.id)}
            className={`flex-1 rounded-[6px] px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              value === option.id ? "bg-accent-soft text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Konteyner Tipi" — DropdownWithManualEntry'nin TEK seçimli bir sarmalayıcısı (LoadPreparationField/LoadingMethodField İLE AYNI desen). */
function ContainerTypeField({ idPrefix, values, onChange, selectError }: { idPrefix: string; values: NakliyeCargoGroupFieldValues; onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void; selectError?: string }) {
  return (
    <DropdownWithManualEntry
      id={`${idPrefix}-type`}
      label="Konteyner Tipi"
      options={CONTAINER_TYPE_OPTIONS}
      value={values.containerType}
      onChange={(next) => onChange({ containerType: next, containerTypeCustomText: next === NAKLIYE_MANUAL_ENTRY_VALUE ? values.containerTypeCustomText : "" })}
      customText={values.containerTypeCustomText}
      onCustomTextChange={(next) => onChange({ containerTypeCustomText: next })}
      customFieldId={`${idPrefix}-type-custom`}
      customLabel="Konteyner tipini yazın"
      selectError={selectError}
    />
  );
}

/** "Konteyner İçindeki Yük" — DropdownWithManualEntry'nin TEK seçimli bir sarmalayıcısı, yalnızca Dolu Konteyner Bilgileri alt kartında render edilir. */
function ContainerContentField({ idPrefix, values, onChange, selectError }: { idPrefix: string; values: NakliyeCargoGroupFieldValues; onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void; selectError?: string }) {
  return (
    <DropdownWithManualEntry
      id={`${idPrefix}-content`}
      label="Konteyner İçindeki Yük"
      options={CONTAINER_CONTENT_OPTIONS}
      value={values.containerContent}
      onChange={(next) => onChange({ containerContent: next, containerContentCustomText: next === NAKLIYE_MANUAL_ENTRY_VALUE ? values.containerContentCustomText : "" })}
      customText={values.containerContentCustomText}
      onCustomTextChange={(next) => onChange({ containerContentCustomText: next })}
      customFieldId={`${idPrefix}-content-custom`}
      customLabel="Yük adını yazın"
      selectError={selectError}
    />
  );
}

/**
 * Her Yük Grubu kartının ALTINDA render edilen, grup-başına bağımsız
 * Tehlikeli Madde/ADR mini-bölümü — "Konteyner Tetikleyicisi Ürün/Yük
 * Cinsi'ne Taşındı" göreviyle eski, job-seviyeli/bağımsız "4 — Tehlikeli
 * Madde / ADR" ana kartının YERİNİ ALDI (o kart tamamen kaldırıldı) VE aynı
 * zamanda soruyu ikili (Hayır/Evet, "Emin Değilim" YOK) hâle getirdi — görev
 * talimatının kendi kesin kuralı. UN Numarası, Resmî Taşımacılık Adı ve
 * Ambalaj Grubu form kontrolleri bir ÖNCEKİ görevde ZATEN kaldırılmıştı, bu
 * görev onları YENİDEN eklemez (bkz. types.ts#NakliyeCargoGroupHazmat
 * üstündeki doküman — eski kayıtlardaki değerler kanıtsız silinmez, yalnızca
 * artık hiçbir ekranda gösterilmez/toplanmaz). Her grup KENDİ `hazmatStatus`/
 * `hazmatAdrClass`sını taşır (`NakliyeCargoGroupFieldValues`in bir parçası) —
 * bir grubun ADR tercihi diğer grubu hiç etkilemez.
 */
export function HazmatFields({ idPrefix, values, onChange, errors }: { idPrefix: string; values: NakliyeCargoGroupFieldValues; onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void; errors?: SpecialConditionErrors }) {
  const status = values.hazmatStatus;
  return (
    <div className="flex flex-col gap-4">
      <CompactConditionToggle
        id={`${idPrefix}-status`}
        title="Yük tehlikeli madde / ADR kapsamında mı?"
        hint="Yükün ADR/tehlikeli madde sınıfı hakkında bilgi verin."
        options={CONTAINER_TOGGLE_OPTIONS}
        value={status}
        onChange={(next) => onChange({ hazmatStatus: next })}
      />
      {status === "evet" && (
        <div>
          <label htmlFor={`${idPrefix}-class`} className="text-sm font-medium text-foreground">ADR Sınıfı</label>
          <select id={`${idPrefix}-class`} value={values.hazmatAdrClass} onChange={(e) => onChange({ hazmatAdrClass: e.target.value })}
            aria-invalid={errors?.hazmatAdrClass ? true : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <option value="">Seçiniz</option>
            {ADR_HAZARD_CLASS_SELECT_ITEMS.map((item) =>
              item.kind === "single" ? (
                <option key={item.option.id} value={item.option.id}>{getAdrHazardClassOptionLabel(item.option)}</option>
              ) : (
                <optgroup key={item.label} label={item.label}>
                  {item.options.map((option) => <option key={option.id} value={option.id}>{getAdrHazardClassOptionLabel(option)}</option>)}
                </optgroup>
              ),
            )}
            <option value={ADR_CLASS_UNKNOWN_VALUE}>{ADR_CLASS_UNKNOWN_LABEL}</option>
          </select>
          {errors?.hazmatAdrClass && <p className="mt-2 text-sm text-danger">{errors.hazmatAdrClass}</p>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{ADR_CLASS_DISCLAIMER_TEXT}</p>
    </div>
  );
}

/**
 * "3 — Konteyner Taşıması" bağımsız kartının İÇERİĞİ — üst tri-state soru +
 * (yalnızca Evet iken) Konteyner Tipi/Dolu-Boş/Konteyner Adedi/(Boş iken)
 * Toplam Brüt Ağırlık + (yalnızca Dolu iken) "Dolu Konteyner Bilgileri" alt
 * kartı (Konteyner İçindeki Yük — "Listede yok / Kendim gireceğim" seçilirse
 * Yük adını yazın — ve Toplam Brüt Ağırlık-BURAYA TAŞINIR-aynı alan iki kez
 * gösterilmez). Dolu/Boş değişiminde `fromNakliyeDetailsFields` (bkz. o
 * fonksiyon) zaten content/contentCustomText'i Boş iken payload'a hiç dahil
 * etmiyor — bu bileşen yalnızca GÖRÜNÜRLÜĞÜ yönetir.
 *
 * "Dolu Konteyner Bilgileri İçindeki ADR Kontrolünün Kaldırılması" görevi:
 * bu alt kart eskiden kendi "Tehlikeli Madde / ADR var mı?" sorusunu da
 * (4 numaralı bağımsız bölümle AYNI `hazmatStatus` alanını okuyup yazan
 * ikinci bir kontrol olarak) barındırıyordu — BİLEREK kaldırıldı. ADR durumu
 * artık YALNIZCA 4 numaralı "Tehlikeli Madde / ADR" bölümünden
 * seçilir/yönetilir; bu bileşen `hazmatStatus`u hiç okumaz/yazmaz, Konteyner
 * İçindeki Yük'te "Kimyasal Ürün"/"Atık / Geri Dönüşüm Malzemesi" seçilmesi
 * dahil hiçbir Konteyner-tarafı etkileşim ADR durumunu OTOMATİK değiştirmez
 * (zaten hiç dokunmadığı için) — kullanıcı bu bölümü tamamladıktan sonra
 * hemen ardındaki 4 numaralı bölümden kendi ayrı kararını verir.
 *
 * "Dolu Konteyner Bilgileri İçindeki Yük Açıklaması Kaldırması" görevi: eski
 * "Yük Açıklaması" serbest metin alanı da (textarea/state/doğrulama/hata
 * odağı/payload değeri/detay gösterimi dahil) TAMAMEN kaldırıldı — bu alt
 * kart artık YALNIZCA Konteyner İçindeki Yük + Toplam Brüt Ağırlık taşır.
 * Eski kayıtlardaki contentDescription değerleri kanıtsız silinmez (bkz.
 * NakliyeContainerTransport üstündeki doküman), yalnızca artık hiç
 * toplanmaz/gösterilmez.
 *
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — eski
 * "2 — Yük Bilgileri" kartının başlık satırındaki bağımsız `ContainerToggle`
 * sorusu TAMAMEN kaldırıldı (bkz. types.ts#NakliyeCargoGroup üstündeki
 * doküman) — bu bileşen artık kendi üst sorusunu HİÇ barındırmadı zaten
 * (görünürlük kararı hep ÇAĞIRANındı, `nakliye-cargo-group-fields.tsx#
 * NakliyeCargoGroupCard`nin kendi `isNakliyeContainerProductType` kontrolü),
 * yalnızca Evet dalının GÖVDESİni (Konteyner Tipi/Dolu-Boş/Adedi/[Dolu alt
 * kartı) render eder. "Toplam Brüt Ağırlık" alanı bu bileşenden TAMAMEN
 * kaldırıldı — konteyner ağırlığı artık grup kartının PAYLAŞILAN "Toplam
 * Ağırlık" alanından girilir (görev talimatı: "toplam tonaj alanını tekrar
 * etmeden kullan", bkz. types.ts#NakliyeCargoGroup.containerTransport.grossWeightTon
 * üstündeki doküman).
 */
export function ContainerBodyFields({ idPrefix, values, onChange, errors }: { idPrefix: string; values: NakliyeCargoGroupFieldValues; onChange: (patch: Partial<NakliyeCargoGroupFieldValues>) => void; errors?: SpecialConditionErrors }) {
  const isDolu = values.containerLoadStatus === "dolu";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ContainerTypeField idPrefix={idPrefix} values={values} onChange={onChange} selectError={errors?.containerType} />
        <div>
          <SearchableSelect id={`${idPrefix}-load-status`} label="Dolu / Boş" options={[{ value: "dolu", label: "Dolu" }, { value: "bos", label: "Boş" }]} value={values.containerLoadStatus} onChange={(v) => onChange({ containerLoadStatus: v })} placeholder="Seçiniz" errorId={errors?.containerLoadStatus ? `${idPrefix}-load-status-error` : undefined} />
          {errors?.containerLoadStatus && <p id={`${idPrefix}-load-status-error`} className="mt-2 text-sm text-danger">{errors.containerLoadStatus}</p>}
        </div>
        <NumberField id={`${idPrefix}-qty`} label="Konteyner Adedi" value={values.containerQuantity} onChange={(v) => onChange({ containerQuantity: v })} error={errors?.containerQuantity} maxLength={String(MAX_CONTAINER_QUANTITY).length + 2} />
      </div>
      {isDolu && (
        <div className="rounded-[10px] border border-border bg-accent-soft/40 p-4">
          <p className="text-sm font-semibold text-foreground">Dolu Konteyner Bilgileri</p>
          <div className="mt-3 flex flex-col gap-4">
            <ContainerContentField idPrefix={idPrefix} values={values} onChange={onChange} selectError={errors?.containerContent} />
          </div>
        </div>
      )}
    </div>
  );
}
