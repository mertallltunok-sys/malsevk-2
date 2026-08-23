"use client";

import { useMemo } from "react";
import { NAKLIYE_MANUAL_LOCATION_OPTION_LABEL, toNakliyeFacilitySelectOptions } from "../_lib/nakliye-route";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceIdByCode,
  getProvinces,
} from "../_lib/turkey-locations";
import { ADDRESS_MAX_LENGTH } from "../_lib/field-limits";
import { ManualFacilityNameField } from "./manual-facility-name-field";
import { SearchableSelect } from "./searchable-select";

export type NakliyeLocationFieldValues = {
  /** turkey-locations.ts il KODU (ör. "41") — types.ts#Job.province/deliveryProvince (il ADI) DEĞİL; il adı yalnızca gönderim anında çözülür (bkz. job-request-form.tsx/job-edit-form.tsx). */
  provinceCode: string;
  district: string;
  /** Gerçek bir turkey-locations.ts#Facility.id, ya da çağıranın verdiği `manualValue` sentinel'i, ya da henüz seçilmemişse "". */
  facilityId: string;
  /** Yalnızca facilityId === manualValue iken anlamlı — kullanıcının serbestçe yazdığı GERÇEK liman/sanayi/OSB adı (bkz. görev tanımı madde 1). Çağıran taraf bunu pickup için workLocationType'a, delivery için deliveryFacilityName'e eşler (job-location.ts'in Nakliye DIŞI kategorilerde workLocationType için zaten yaptığı "serbest metin adı aynı görünen alana yazılır" ilkesiyle AYNI, bkz. resolveNakliyePickupPayload/resolveDeliveryLocationPayload). */
  customFacilityName: string;
  /** Artık seçilen yönteme (katalog tesis ya da manuel ad) bakılmaksızın HER ZAMAN görünür ve zorunludur (bkz. görev tanımı madde 2/3) — tesis seçimi yalnızca adın KAYNAĞINI belirler, açık adresin kendisi ikisinde de aynı şekilde toplanır. */
  addressText: string;
};

export type NakliyeLocationFieldErrors = Partial<Record<"province" | "district" | "locationType" | "addressText", string>>;

/**
 * Nakliye'nin "Yük Alınacak Yer" VE "Teslim Edilecek Yer" bölümlerinin İKİSİ
 * için de kullanılan TEK paylaşılan alan grubu — görev tanımının "aynı
 * yapıda çalışsın" gereksinimi artık gerçekten TEK bir bileşenle karşılanıyor
 * (iki ayrı JSX kopyası YOK). Çağıran taraf hangi Job alan grubuna
 * yazacağını (`values`/`onChange`) ve hangi sentinel değerini kullanacağını
 * (`manualValue` — pickup için nakliye-route.ts#PICKUP_MANUAL_LOCATION_VALUE,
 * delivery için DELIVERY_MANUAL_LOCATION_VALUE) kendisi belirler; bu bileşen
 * yalnızca İl→İlçe→(Liman/Sanayi/OSB SEÇ ya da "Listede yok, kendim
 * gireceğim" + manuel ad)→Açık Adres kaskadını render eder, hangi Job
 * alanına yazıldığını bilmez.
 *
 * İl/İlçe artık HER İKİ taraf için de Türkiye geneli serbestçe seçilebilir
 * (job-edit-form.tsx'in zaten var olan İl SearchableSelect'iyle AYNI kaynak,
 * turkey-locations.ts#getProvinces — 81 il).
 *
 * Manuel mod seçildiğinde AYRICA "Liman / Sanayi / OSB Adı" serbest metin
 * input'u gösterilir, otomatik odak alır (bkz. useFocusOnBecomeTrue). Bu,
 * artık Gümrük Müşavirliği HARİÇ tüm kategorilerin standart "Liman / Sanayi /
 * OSB" davranışıdır — Nakliye DIŞINDAKİ kategoriler AYNI etiketleri/davranışı
 * kendi JSX'inde (job-request-form.tsx/job-edit-form.tsx, bkz. job-location.ts#
 * FACILITY_FREE_TEXT_VALUE) uygular, çünkü onların İl/İlçe state mimarisi
 * (bir operasyondaki kartlar arası PAYLAŞILAN İl) bu bileşenin kendi
 * bağımsız provinceCode/district state'iyle uyuşmaz — bu yüzden bileşenin
 * kendisi (İl/İlçe kaskadı) tekrar kullanılmaz, ama etiket metni
 * (job-location.ts#CUSTOM_FACILITY_OPTION_LABEL) ve odak davranışı
 * (useFocusOnBecomeTrue) TEK kaynaktan paylaşılır.
 */
export function NakliyeLocationFields({
  idPrefix,
  manualValue,
  values,
  errors,
  onChange,
}: {
  idPrefix: string;
  manualValue: string;
  values: NakliyeLocationFieldValues;
  errors: NakliyeLocationFieldErrors;
  onChange: (patch: Partial<NakliyeLocationFieldValues>) => void;
}) {
  const provinceFieldId = `${idPrefix}-province`;
  const districtFieldId = `${idPrefix}-district`;
  const locationFieldId = `${idPrefix}-locationType`;
  const addressTextFieldId = `${idPrefix}-addressText`;

  const provinceOptions = useMemo(
    () => getProvinces().map((province) => ({ value: province.code, label: province.name })),
    [],
  );

  const districtOptions = useMemo(
    () =>
      values.provinceCode
        ? getDistrictsByProvinceCode(values.provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [values.provinceCode],
  );

  const facilityOptions = useMemo(() => {
    if (!values.provinceCode || !values.district) return [];
    const provinceIdValue = getProvinceIdByCode(values.provinceCode);
    if (!provinceIdValue) return [];
    const facilities = getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(values.district));
    return toNakliyeFacilitySelectOptions(facilities, manualValue);
  }, [values.provinceCode, values.district, manualValue]);

  const isManual = values.facilityId === manualValue;
  const customFacilityNameFieldId = `${idPrefix}-customFacilityName`;

  // İl değiştirilirse: İlçe/Tesis seçimi/Manuel ad/Açık Adres temizlensin,
  // konum yöntemi başlangıç (henüz seçilmemiş) durumuna dönsün (bkz. görev
  // tanımı madde 8) — eski açık adres yeni ile taşınmasın diye.
  function handleProvinceChange(nextCode: string) {
    onChange({ provinceCode: nextCode, district: "", facilityId: "", customFacilityName: "", addressText: "" });
  }

  // İlçe değiştirilirse: Tesis seçimi/Manuel ad/Açık Adres temizlensin, konum
  // yöntemi başlangıç durumuna dönsün (bkz. görev tanımı madde 8) — başka
  // ilçeye ait bir tesis asla seçili kalamaz.
  function handleDistrictChange(nextDistrict: string) {
    onChange({ district: nextDistrict, facilityId: "", customFacilityName: "", addressText: "" });
  }

  // Katalog↔manuel geçişinde Açık Adres HİÇBİR ZAMAN temizlenmez (bkz. görev
  // tanımı madde 4) — yalnızca manuelden katalog seçimine geçilirken artık
  // anlamsız kalan customFacilityName temizlenir; katalogdan manuele
  // geçilirken (nextValue === manualValue) customFacilityName'e dokunulmaz
  // (kullanıcı daha önce yazmışsa kaybolmasın).
  function handleFacilityChange(nextValue: string) {
    if (nextValue === manualValue) {
      onChange({ facilityId: nextValue });
    } else {
      onChange({ facilityId: nextValue, customFacilityName: "" });
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <SearchableSelect
            id={provinceFieldId}
            label="İl"
            options={provinceOptions}
            value={values.provinceCode}
            onChange={handleProvinceChange}
            placeholder="İl seçiniz"
            errorId={errors.province ? `${provinceFieldId}-error` : undefined}
          />
          {errors.province && (
            <p id={`${provinceFieldId}-error`} className="mt-2 text-sm text-danger">
              {errors.province}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={districtFieldId}
            label="İlçe"
            options={districtOptions}
            value={values.district}
            onChange={handleDistrictChange}
            placeholder="İlçe seçiniz"
            disabled={!values.provinceCode}
            disabledHint="Önce il seçin"
            errorId={errors.district ? `${districtFieldId}-error` : undefined}
          />
          {errors.district && (
            <p id={`${districtFieldId}-error`} className="mt-2 text-sm text-danger">
              {errors.district}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={locationFieldId}
            label="Liman / Sanayi / OSB"
            options={facilityOptions}
            value={values.facilityId}
            onChange={handleFacilityChange}
            placeholder="Liman / Sanayi / OSB seçiniz"
            disabled={!values.district}
            disabledHint="Önce ilçe seçin"
            errorId={errors.locationType && !isManual ? `${locationFieldId}-error` : undefined}
          />
          {errors.locationType && !isManual && (
            <p id={`${locationFieldId}-error`} className="mt-2 text-sm text-danger">
              {errors.locationType}
            </p>
          )}
        </div>
      </div>

      <ManualFacilityNameField
        id={customFacilityNameFieldId}
        value={values.customFacilityName}
        onChange={(next) => onChange({ customFacilityName: next })}
        active={isManual}
        error={errors.locationType}
      />

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={addressTextFieldId} className="text-sm font-medium text-foreground">
            Açık Adres
          </label>
          <span className="text-xs text-muted-foreground">
            {values.addressText.trim().length} / {ADDRESS_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={addressTextFieldId}
          value={values.addressText}
          onChange={(event) => onChange({ addressText: event.target.value })}
          maxLength={ADDRESS_MAX_LENGTH}
          rows={3}
          aria-invalid={errors.addressText ? true : undefined}
          aria-describedby={errors.addressText ? `${addressTextFieldId}-error` : undefined}
          placeholder="Mahalle, cadde/sokak, kapı no ve varsa ilave tarif bilgilerini girin."
          className={`mt-2 w-full max-w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            errors.addressText ? "border-danger" : "border-border"
          }`}
        />
        {errors.addressText && (
          <p id={`${addressTextFieldId}-error`} className="mt-2 text-sm text-danger">
            {errors.addressText}
          </p>
        )}
      </div>
    </div>
  );
}

/** NAKLIYE_MANUAL_LOCATION_OPTION_LABEL'ı yeniden dışa aktarır — çağıran formların ayrı bir import satırına ihtiyaç duymadan sentinel seçeneğin görünen metnini (ör. bir onboarding ipucunda) referans alabilmesi için. */
export { NAKLIYE_MANUAL_LOCATION_OPTION_LABEL };
