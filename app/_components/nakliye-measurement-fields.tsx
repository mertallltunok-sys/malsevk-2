"use client";

import {
  getMeasurementFieldGroup,
  getPlacementOptionsForGroup,
  NAKLIYE_MANUAL_ENTRY_VALUE,
  ORIENTATION_OPTIONS,
  PALLET_SIZE_OPTIONS,
  placementAllowsMaxStackCount,
  type NakliyeMeasurementFieldGroup,
  type NakliyeMeasurementFieldValues,
} from "../_lib/nakliye-transport-catalog";
import type { NakliyeMeasurementFieldErrors } from "../_lib/job-form-validation";
import {
  MANUAL_ENTRY_TEXT_MAX_LENGTH,
  MAX_DIAMETER_CM,
  MAX_HEIGHT_CM,
  MAX_LENGTH_CM,
  MAX_ROLL_WIDTH_CM,
  MAX_STACK_COUNT,
  MAX_WIDTH_CM,
} from "../_lib/field-limits";
import { DropdownWithManualEntry, NumberField, TextField } from "./nakliye-transport-fields";
import { SearchableSelect } from "./searchable-select";

/** Girilebilecek en büyük değere (ondalık ayraç + basamaklar dahil) yetecek karakter sayısı. */
function digitInputMaxLength(max: number, decimalPlaces = 2): number {
  return String(Math.trunc(max)).length + decimalPlaces + 1;
}

/**
 * "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi — Yükün Hazırlanış
 * Biçimi kartının İÇİNDE açılan, TAMAMEN isteğe bağlı sade bir alt kart.
 * Eski, kaldırılmış zengin `nakliye-packaging-fields.tsx` (silinmiş dosya)
 * sisteminin YERİNE GEÇMEZ — bu, kasıtlı olarak çok daha küçük/basit bir
 * alt küme. `job-request-form.tsx`/`job-edit-form.tsx`/`admin-job-edit-
 * form.tsx` arasında birebir aynı JSX'i tekrar ETMEMEK için TEK paylaşılan
 * bileşen (job-request-form.tsx/job-edit-form.tsx arasındaki "storage-
 * container-details-fields.tsx İLE AYNI" paylaşım ilkesi).
 *
 * `NakliyeMeasurementFieldValues` tipi ve saf dönüştürücüler
 * (createEmptyMeasurementFields/toMeasurementFields/fromMeasurementFields)
 * BİLEREK burada değil, nakliye-transport-catalog.ts'te (_lib) tanımlıdır —
 * bu dosyanın `nakliye-transport-fields.tsx`teki `DropdownWithManualEntry`/
 * `NumberField`/`TextField`i yeniden kullanması GEREKİYOR, ve o dosyanın da
 * `NakliyeDetailsFieldValues.measurement` alanı için AYNI dönüştürücüleri
 * çağırması gerekiyor — iki `_components` dosyası birbirini İÇE AKTARSAYDI
 * dairesel bağımlılık oluşurdu; saf fonksiyonları `_lib`e taşımak (JSX'siz
 * oldukları için hiçbir mimari ilkeyi ihlal etmez) bunu TEK yönlü hâle
 * getirir.
 */
const DIMENSION_GRID = "grid gap-3 sm:grid-cols-3";

function PlacementField({
  idPrefix,
  group,
  values,
  onChange,
}: {
  idPrefix: string;
  group: NakliyeMeasurementFieldGroup;
  values: NakliyeMeasurementFieldValues;
  onChange: (patch: Partial<NakliyeMeasurementFieldValues>) => void;
}) {
  const options = getPlacementOptionsForGroup(group);
  if (options.length === 0) return null;

  if (group === "manual") {
    const optionsWithoutManual = options.filter((option) => option.id !== NAKLIYE_MANUAL_ENTRY_VALUE);
    return (
      <>
        <SearchableSelect
          id={`${idPrefix}-placement`}
          label="Araçta Yerleşim Biçimi"
          options={optionsWithoutManual.map((option) => ({ value: option.id, label: option.label }))}
          value={values.placementType}
          onChange={(next) => onChange({ placementType: next })}
          placeholder="Seçiniz"
        />
        <div className="sm:col-span-3">
          <TextField
            id={`${idPrefix}-placement-custom`}
            label="Özel Yerleşim Açıklaması"
            value={values.placementCustomText}
            onChange={(next) => onChange({ placementCustomText: next })}
            optional
            maxLength={MANUAL_ENTRY_TEXT_MAX_LENGTH}
          />
        </div>
      </>
    );
  }

  const hasManualOption = options.some((option) => option.id === NAKLIYE_MANUAL_ENTRY_VALUE);
  if (hasManualOption) {
    return (
      <div className="sm:col-span-3">
        <DropdownWithManualEntry
          id={`${idPrefix}-placement`}
          label="Araçta Yerleşim Biçimi"
          options={options.filter((option) => option.id !== NAKLIYE_MANUAL_ENTRY_VALUE)}
          value={values.placementType}
          onChange={(next) => onChange({ placementType: next, placementCustomText: next === NAKLIYE_MANUAL_ENTRY_VALUE ? values.placementCustomText : "" })}
          customText={values.placementCustomText}
          onCustomTextChange={(next) => onChange({ placementCustomText: next })}
          customFieldId={`${idPrefix}-placement-custom`}
          customLabel="Yerleşimi yazın"
        />
      </div>
    );
  }

  return (
    <SearchableSelect
      id={`${idPrefix}-placement`}
      label="Araçta Yerleşim Biçimi"
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      value={values.placementType}
      onChange={(next) => onChange({ placementType: next })}
      placeholder="Seçiniz"
    />
  );
}

/**
 * Yükün Hazırlanış Biçimi kartının içinde, seçim yapılınca hemen altında
 * açılan "Ölçü ve Yerleşim Bilgileri" alt kartı. `loadPreparationType`
 * boşsa ya da tanınmayan bir değerse HİÇ render edilmez (görev talimatı:
 * "Kullanıcı hazırlanış biçimini seçmeden alt kart görünmesin").
 */
export function NakliyeMeasurementCard({
  idPrefix,
  loadPreparationType,
  values,
  onChange,
  errors,
}: {
  idPrefix: string;
  loadPreparationType: string;
  values: NakliyeMeasurementFieldValues;
  onChange: (patch: Partial<NakliyeMeasurementFieldValues>) => void;
  errors?: NakliyeMeasurementFieldErrors;
}) {
  const group = getMeasurementFieldGroup(loadPreparationType);
  if (!group) return null;

  if (group === "container") {
    return (
      <div className="mt-4 rounded-[10px] border border-border bg-accent-soft/40 p-4">
        <p className="text-sm font-semibold text-foreground">Ölçü ve Yerleşim Bilgileri</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Konteyner taşıma bilgilerini (tip, dolu/boş, yön, şasi/jeneratör) &quot;Özel Taşıma Koşulları&quot; bölümünden doldurabilirsiniz.
        </p>
      </div>
    );
  }

  {/* "dokme" için TEK ölçü alanı olan Yaklaşık Hacim (m³), "Dinamik Ürün
     Adedi" göreviyle artık yukarıdaki Yük Bilgileri ızgarasında "Ürün Adedi"
     alanının YERİNE geçiyor (AYNI measurement.volumeM3 kaynağı — bkz.
     getProductQuantityFieldConfig'in dokümantasyonu) — burada TEKRAR
     göstermek yerine yalnızca yönlendirici bir not gösterilir. */}
  if (group === "bulk") {
    return (
      <div className="mt-4 rounded-[10px] border border-border bg-accent-soft/40 p-4">
        <p className="text-sm font-semibold text-foreground">Ölçü ve Yerleşim Bilgileri</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Yaklaşık hacim bilgisini yukarıdaki &quot;Yaklaşık Hacim&quot; alanından girebilirsiniz.
        </p>
      </div>
    );
  }

  const showMaxStack = values.placementType && placementAllowsMaxStackCount(values.placementType);

  return (
    <div className="mt-4 rounded-[10px] border border-border bg-accent-soft/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Ölçü ve Yerleşim Bilgileri</p>
        <span className="text-xs text-muted-foreground">İsteğe bağlı</span>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={values.dimensionsUnknown}
          onChange={(event) => onChange({ dimensionsUnknown: event.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        Ölçüleri bilmiyorum
      </label>

      {!values.dimensionsUnknown && (
        <div className="mt-3 flex flex-col gap-3">
          {group === "pallet" && (
            <div className={DIMENSION_GRID}>
              <SearchableSelect
                id={`${idPrefix}-pallet-size`}
                label="Palet Ölçüsü"
                options={PALLET_SIZE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                value={values.palletType}
                onChange={(next) => {
                  const preset = PALLET_SIZE_OPTIONS.find((option) => option.id === next);
                  onChange({
                    palletType: next,
                    widthCm: preset?.widthCm !== undefined ? String(preset.widthCm) : values.widthCm,
                    lengthCm: preset?.lengthCm !== undefined ? String(preset.lengthCm) : values.lengthCm,
                  });
                }}
                placeholder="Seçiniz"
              />
              <NumberField id={`${idPrefix}-width`} label="En (cm)" value={values.widthCm} onChange={(v) => onChange({ widthCm: v })} optional error={errors?.widthCm} maxLength={digitInputMaxLength(MAX_WIDTH_CM)} />
              <NumberField id={`${idPrefix}-length`} label="Boy (cm)" value={values.lengthCm} onChange={(v) => onChange({ lengthCm: v })} optional error={errors?.lengthCm} maxLength={digitInputMaxLength(MAX_LENGTH_CM)} />
              <NumberField id={`${idPrefix}-height`} label="Yükseklik (cm)" value={values.heightCm} onChange={(v) => onChange({ heightCm: v })} optional error={errors?.heightCm} maxLength={digitInputMaxLength(MAX_HEIGHT_CM)} />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
              {showMaxStack && (
                <NumberField id={`${idPrefix}-stack`} label="En Fazla İstif Katı" value={values.maxStackCount} onChange={(v) => onChange({ maxStackCount: v })} optional error={errors?.maxStackCount} maxLength={digitInputMaxLength(MAX_STACK_COUNT, 0)} />
              )}
            </div>
          )}

          {(group === "box" || group === "bigbag" || group === "bundle" || group === "unpackaged" || group === "manual") && (
            <div className={DIMENSION_GRID}>
              <NumberField id={`${idPrefix}-width`} label="En (cm)" value={values.widthCm} onChange={(v) => onChange({ widthCm: v })} optional error={errors?.widthCm} maxLength={digitInputMaxLength(MAX_WIDTH_CM)} />
              <NumberField id={`${idPrefix}-length`} label="Boy (cm)" value={values.lengthCm} onChange={(v) => onChange({ lengthCm: v })} optional error={errors?.lengthCm} maxLength={digitInputMaxLength(MAX_LENGTH_CM)} />
              <NumberField id={`${idPrefix}-height`} label="Yükseklik (cm)" value={values.heightCm} onChange={(v) => onChange({ heightCm: v })} optional error={errors?.heightCm} maxLength={digitInputMaxLength(MAX_HEIGHT_CM)} />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
              {showMaxStack && (
                <NumberField id={`${idPrefix}-stack`} label="En Fazla İstif Katı" value={values.maxStackCount} onChange={(v) => onChange({ maxStackCount: v })} optional error={errors?.maxStackCount} maxLength={digitInputMaxLength(MAX_STACK_COUNT, 0)} />
              )}
            </div>
          )}

          {group === "sack" && (
            <div className={DIMENSION_GRID}>
              <NumberField id={`${idPrefix}-width`} label="Yaklaşık En (cm)" value={values.widthCm} onChange={(v) => onChange({ widthCm: v })} optional error={errors?.widthCm} maxLength={digitInputMaxLength(MAX_WIDTH_CM)} />
              <NumberField id={`${idPrefix}-length`} label="Yaklaşık Boy (cm)" value={values.lengthCm} onChange={(v) => onChange({ lengthCm: v })} optional error={errors?.lengthCm} maxLength={digitInputMaxLength(MAX_LENGTH_CM)} />
              <NumberField id={`${idPrefix}-height`} label="Yaklaşık Yükseklik (cm)" value={values.heightCm} onChange={(v) => onChange({ heightCm: v })} optional error={errors?.heightCm} maxLength={digitInputMaxLength(MAX_HEIGHT_CM)} />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
              {showMaxStack && (
                <NumberField id={`${idPrefix}-stack`} label="En Fazla İstif Katı" value={values.maxStackCount} onChange={(v) => onChange({ maxStackCount: v })} optional error={errors?.maxStackCount} maxLength={digitInputMaxLength(MAX_STACK_COUNT, 0)} />
              )}
            </div>
          )}

          {group === "bale" && (
            <div className={DIMENSION_GRID}>
              <NumberField id={`${idPrefix}-width`} label="En (cm)" value={values.widthCm} onChange={(v) => onChange({ widthCm: v })} optional error={errors?.widthCm} maxLength={digitInputMaxLength(MAX_WIDTH_CM)} />
              <NumberField id={`${idPrefix}-length`} label="Boy (cm)" value={values.lengthCm} onChange={(v) => onChange({ lengthCm: v })} optional error={errors?.lengthCm} maxLength={digitInputMaxLength(MAX_LENGTH_CM)} />
              <NumberField id={`${idPrefix}-height`} label="Yükseklik (cm)" value={values.heightCm} onChange={(v) => onChange({ heightCm: v })} optional error={errors?.heightCm} maxLength={digitInputMaxLength(MAX_HEIGHT_CM)} />
              <SearchableSelect
                id={`${idPrefix}-orientation`}
                label="Yatay / Dikey"
                options={ORIENTATION_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                value={values.orientation}
                onChange={(next) => onChange({ orientation: next })}
                placeholder="Seçiniz"
              />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
              {showMaxStack && (
                <NumberField id={`${idPrefix}-stack`} label="En Fazla İstif Katı" value={values.maxStackCount} onChange={(v) => onChange({ maxStackCount: v })} optional error={errors?.maxStackCount} maxLength={digitInputMaxLength(MAX_STACK_COUNT, 0)} />
              )}
            </div>
          )}

          {group === "drum" && (
            <div className={DIMENSION_GRID}>
              <NumberField id={`${idPrefix}-diameter`} label="Çap (cm)" value={values.diameterCm} onChange={(v) => onChange({ diameterCm: v })} optional error={errors?.diameterCm} maxLength={digitInputMaxLength(MAX_DIAMETER_CM)} />
              <NumberField id={`${idPrefix}-height`} label="Yükseklik (cm)" value={values.heightCm} onChange={(v) => onChange({ heightCm: v })} optional error={errors?.heightCm} maxLength={digitInputMaxLength(MAX_HEIGHT_CM)} />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
            </div>
          )}

          {group === "roll" && (
            <div className={DIMENSION_GRID}>
              <NumberField id={`${idPrefix}-outer`} label="Dış Çap (cm)" value={values.outerDiameterCm} onChange={(v) => onChange({ outerDiameterCm: v })} optional error={errors?.outerDiameterCm} maxLength={digitInputMaxLength(MAX_DIAMETER_CM)} />
              <NumberField id={`${idPrefix}-inner`} label="İç Çap (cm)" value={values.innerDiameterCm} onChange={(v) => onChange({ innerDiameterCm: v })} optional error={errors?.innerDiameterCm} maxLength={digitInputMaxLength(MAX_DIAMETER_CM)} />
              <NumberField id={`${idPrefix}-roll-width`} label="Rulo/Bobin Genişliği (cm)" value={values.rollWidthCm} onChange={(v) => onChange({ rollWidthCm: v })} optional error={errors?.rollWidthCm} maxLength={digitInputMaxLength(MAX_ROLL_WIDTH_CM)} />
              <PlacementField idPrefix={idPrefix} group={group} values={values} onChange={onChange} />
            </div>
          )}

        </div>
      )}
    </div>
  );
}
