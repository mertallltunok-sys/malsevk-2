"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { getAdminJobCargoGroups, updateJobAsAdmin, type AdminJobDetail } from "../_lib/admin-jobs";
import { CUSTOMS_REQUESTED_SERVICE_OPTIONS, CUSTOMS_TRANSACTION_TYPES, isCustomsBrokerageCategory } from "../_lib/customs-brokerage-catalog";
import { ADDRESS_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, FACILITY_NAME_MAX_LENGTH, MAX_PRODUCT_QUANTITY, MAX_TONNAGE_TON, TITLE_MAX_LENGTH } from "../_lib/field-limits";
import { validateNakliyeCargoGroups } from "../_lib/job-form-validation";
import { getTodayLocalDateString } from "../_lib/jobs";
import { deriveLegacyMirrorFields } from "../_lib/nakliye-cargo-groups";
import {
  LOADING_METHOD_OPTIONS,
  NAKLIYE_MANUAL_ENTRY_OPTION_LABEL,
  NAKLIYE_MANUAL_ENTRY_VALUE,
  fromCargoGroupsFields,
  toCargoGroupsFields,
  type NakliyeCargoGroupFieldValues,
} from "../_lib/nakliye-transport-catalog";
import {
  isTonnageRequired,
  isTransportationCategory,
  requiresProductInfo,
} from "../_lib/product-catalog";
import {
  isRecyclingCategory,
  isRecyclingMaterialCondition,
  isWasteQuantityUnit,
  RECYCLING_UNIT_OPTIONS,
  resolveRecyclingScopeOfWorkIds,
} from "../_lib/recycling-catalog";
import { isStorageOnlyLocationCategory } from "../_lib/service-catalog";
import { isContainerStorageCategory, normalizeStorageContainerGroupsForDisplay } from "../_lib/storage-container-catalog";
import { isHazardousStorageCategory, isTehlikeliMaddeDepolamaCategory } from "../_lib/storage-hazard-catalog";
import { isSafeHttpUrl, UNSAFE_URL_MESSAGE } from "../_lib/text-sanitization";
import type { NakliyeHazmatDetail } from "../_lib/types";
import { NakliyeCargoGroupsFields } from "./nakliye-cargo-group-fields";
import { RecyclingFields, type RecyclingFieldValues } from "./recycling-fields";
import {
  fromStorageContainerGroupsFields,
  StorageContainerGroupsFields,
  toStorageContainerGroupsFields,
} from "./storage-container-details-fields";
import { StorageHazardFields, type StorageHazardFieldValues } from "./storage-hazard-fields";

/**
 * Admin'in bir ilanın içeriğini düzeltmesi — görev bölüm 6: mevcut
 * job-edit-form.tsx (Hizmet Alan'ın kendi düzenleme ekranı, 968 satır)
 * doğrudan yeniden kullanılamaz analiz edildi: o bileşen tamamen localStorage
 * kaynaklıdır (useJobById/job-store.ts#updateJob, sahiplik kontrolü
 * `session.role === "hizmet-alan" && requesterId === session.id`), bu admin
 * ekranıysa tamamen Supabase kaynaklıdır (admin-jobs.ts#AdminJobDetail) ve
 * admin-only bir RPC'ye (update_job_as_admin) yazar — iki farklı veri
 * kaynağını TEK bileşende birleştirmek (mevcut admin panelinin diğer tüm
 * modüllerinde zaten kurulu "Supabase-only" ayrımını bozacak şekilde)
 * gereksiz bir karmaşıklık olurdu. Bunun yerine, kaynağın PAYLAŞILAN, veri
 * kaynağından bağımsız saf yardımcı fonksiyonları (jobs.ts#getTodayLocalDateString,
 * product-catalog.ts#requiresProductInfo/isTonnageRequired/isTransportationCategory,
 * customs-brokerage-catalog.ts#isCustomsBrokerageCategory) GERÇEKTEN yeniden
 * kullanılır — yalnızca alan görünürlüğü/doğrulama kuralları için, ayrı bir
 * kopya İCAT EDİLMEZ. Kapsam görev bölüm 6'nın kendi listesiyle
 * SINIRLIDIR — hizmet türü (kategori) değiştirilemez (görev listesinde de
 * yok), fotoğraflar/Gümrük evrakları bu ekrandan yönetilmez (mevcut admin
 * panelinde zaten hiçbir modülde dosya yönetimi yok).
 *
 * ALAN KAYBI DÜZELTMESİ (0037): önceki sürümde Tonaj alanının GÖRÜNÜRLÜĞÜ
 * yanlışlıkla `isTonnageRequired` (yalnızca Nakliye) ile kapılıydı — Liman
 * Hizmetleri ilanlarında (tonaj isteğe bağlı ama GEÇERLİ) alan hiç
 * görünmüyor, bu yüzden değeri her admin kaydında sessizce siliniyordu.
 * Doğru koşul `requiresProductInfo` (Liman Hizmetleri BİRLEŞİM Nakliye) —
 * `tonnageRequired` (eski `showTonnage`) artık yalnızca "zorunlu mu"
 * göstergesi/doğrulaması için kullanılır, alanın GÖSTERİLİP gösterilmeyeceği
 * için değil. Ayrıca RPC (0037) artık coalesce-koruma kullanır — bu formda
 * HİÇ olmayan alanlar (facility_id/location_mode/delivery_facility_id/
 * delivery_location_type — bkz. o migration'ın kapsam-dışı gerekçesi) zaten
 * hiç parametre almadığı için RPC tarafından asla değiştirilemez.
 */
// "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu formdaki
// Ürün Adedi/Tonaj alanları `type="number"` idi — görev talimatının kendi
// uyarısı ("type='number' üzerinde maxLength özelliğinin güvenilir
// olmadığını dikkate al") burada birebir geçerliydi: tarayıcı `maxLength`i
// tamamen YOK SAYAR, kullanıcı `1e20`/binlerce haneli bir değer yapıştırabilir.
// `max` niteliği yalnızca bir ipucudur, GERÇEK sınır burada, gönderim anında
// uygulanır.
function clampToBounds(raw: string, max: number): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, max);
}

export function AdminJobEditForm({
  job,
  onSaved,
  onCancel,
}: {
  job: AdminJobDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description);
  const [operationDetails, setOperationDetails] = useState(job.operationDetails ?? "");
  const [province, setProvince] = useState(job.province);
  const [district, setDistrict] = useState(job.district);
  const [workLocationType, setWorkLocationType] = useState(job.workLocationType);
  const [addressText, setAddressText] = useState(job.addressText ?? "");
  const [neighborhood, setNeighborhood] = useState(job.neighborhood ?? "");
  const [locationUrl, setLocationUrl] = useState(job.locationUrl ?? "");
  const [directionsNote, setDirectionsNote] = useState(job.directionsNote ?? "");
  const [workDate, setWorkDate] = useState(job.workDate);
  const [workEndDate, setWorkEndDate] = useState(job.workEndDate ?? "");
  const [productQuantity, setProductQuantity] = useState(job.productQuantity !== null ? String(job.productQuantity) : "");
  const [productTonnage, setProductTonnage] = useState(job.productTonnage !== null ? String(job.productTonnage) : "");
  // Yalnızca Liman Hizmetleri'nde anlamlı/düzenlenebilir — Nakliye'nin kendi
  // Ürün/Yük Cinsi'si artık HER Yük Grubu'nun kendi kopyasındadır (bkz.
  // nakliyeCargoGroups üstündeki doküman), bu üst seviye değer Nakliye için
  // hiç gösterilmez/gönderilmez.
  const [productType, setProductType] = useState(job.productType ?? "");
  const [customsProductType, setCustomsProductType] = useState(job.customsProductType ?? "");
  const [customsTransactionType, setCustomsTransactionType] = useState(job.customsTransactionType ?? "");
  const [customsRequestedServices, setCustomsRequestedServices] = useState<string[]>(job.customsRequestedServices ?? []);
  const [deliveryProvince, setDeliveryProvince] = useState(job.deliveryProvince ?? "");
  const [deliveryDistrict, setDeliveryDistrict] = useState(job.deliveryDistrict ?? "");
  const [deliveryFacilityName, setDeliveryFacilityName] = useState(job.deliveryFacilityName ?? "");
  const [deliveryAddressText, setDeliveryAddressText] = useState(job.deliveryAddressText ?? "");
  const [nakliyeLoadingMethod, setNakliyeLoadingMethod] = useState(job.nakliyeLoadingMethod ?? "");
  const [nakliyeLoadingMethodCustomText, setNakliyeLoadingMethodCustomText] = useState(job.nakliyeLoadingMethodCustomText ?? "");
  // "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
  // Taşındı" görevleri — Ürün Bilgileri/Yükün Hazırlanış Biçimi/Ölçü ve
  // Yerleşim/Konteyner Bilgileri/Tehlikeli Madde-ADR artık BURADA (job
  // seviyesinde, TEK) DEĞİL, aşağıdaki Yük Grubu dizisinde — eski bağımsız
  // "Tehlikeli Madde / ADR" fieldset'i (hazmatStatus/hazmatAdrClass job-level
  // state'i) TAMAMEN kaldırıldı, her grup KENDİ hazmatStatus/hazmatAdrClass'ını
  // taşır. `AdminJobDetail` (Supabase kaynaklı, job-store.ts#Job'dan FARKLI
  // düz/ayrık alan şekli) `nakliyeCargoGroups` doluysa AYNEN, boşsa (eski/tek
  // gruplu bir ilan) üstteki tekil alanlardan ("Yük Grubu 1") SALT OKUNUR
  // sentezlenir — bkz. admin-jobs.ts#getAdminJobCargoGroups (admin-job-detail.tsx
  // İLE PAYLAŞILAN TEK sentez, ikinci bir kopya İCAT EDİLMEDİ).
  const [nakliyeCargoGroups, setNakliyeCargoGroups] = useState<NakliyeCargoGroupFieldValues[]>(() =>
    toCargoGroupsFields(getAdminJobCargoGroups(job)),
  );
  // "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi —
  // job-request-form.tsx/job-edit-form.tsx İLE AYNI paylaşılan `RecyclingFields`
  // bileşeni, bu dosyanın kendi bireysel-useState kuralına uygun TEK bir
  // state objesiyle (StorageHazardFields İLE AYNI desen). Bu blok eskiden
  // (Task C'nin ana rewrite'ından ÖNCE yazılmış) kendi bireysel useState'leriyle
  // ESKİ "Malzeme Kategorisi -> Alt Tür" ağacını doğrudan kullanıyordu —
  // yeni kayıtlar artık recycling-waste-code-catalog.ts#WasteTypeId taşıdığı
  // için o eski seçici admin ekranında hiçbir yeni kaydı doğru gösteremiyor/
  // düzenleyemiyordu (gerçek, önceden var olan bir tutarsızlık — bu görevle
  // düzeltildi).
  const [recyclingFields, setRecyclingFields] = useState<RecyclingFieldValues>(() => ({
    recyclingMaterialCategoryId: job.recyclingMaterialCategoryId ?? "",
    recyclingMaterialSubtypeId: job.recyclingMaterialSubtypeId ?? "",
    recyclingQuantity: job.recyclingQuantity !== null ? String(job.recyclingQuantity) : "",
    recyclingUnit: job.recyclingUnit ?? "",
    recyclingMaterialCondition: job.recyclingMaterialCondition ?? "",
    recyclingMaterialConditionNote: job.recyclingMaterialConditionNote ?? "",
    recyclingScopeOfWork: resolveRecyclingScopeOfWorkIds(job.recyclingScopeOfWork ?? []),
    recyclingRequestedOperation: job.recyclingRequestedOperation ?? "",
    recyclingWasteCode: job.recyclingWasteCode ?? "",
    recyclingWasteCodeUnknown: job.recyclingWasteCodeUnknown ?? false,
    recyclingHazardProperties: job.recyclingHazardProperties ?? [],
  }));
  const [storageProductType, setStorageProductType] = useState(job.storageProductType ?? "");
  const [storageProductQuantity, setStorageProductQuantity] = useState(
    job.storageProductQuantity !== null ? String(job.storageProductQuantity) : "",
  );
  const [storageProductUnit, setStorageProductUnit] = useState(job.storageProductUnit ?? "");
  const [storageProductTonnage, setStorageProductTonnage] = useState(
    job.storageProductTonnage !== null ? String(job.storageProductTonnage) : "",
  );
  // "Konteyner Grupları" — Supabase (admin) tarafında DEPRECATED düz alanlar
  // hiç var olmadı (bkz. migration 0057 — storage_container_groups TEK
  // sütun olarak baştan böyle eklendi), bu yüzden burada job-edit-form.tsx
  // (Hizmet Alan, localStorage kaynaklı) İLE AYNI eski-alan yükseltmesine
  // gerek YOKTUR — yine de normalizeStorageContainerGroupsForDisplay
  // kullanılır (TEK doğruluk kaynağı, "hiç grup yoksa TEK boş grupla
  // başlar" davranışı için).
  const [containerGroups, setContainerGroups] = useState(() =>
    toStorageContainerGroupsFields(normalizeStorageContainerGroupsForDisplay({ storageContainerGroups: job.storageContainerGroups ?? undefined })),
  );
  // "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi —
  // job-request-form.tsx/job-edit-form.tsx İLE AYNI `StorageHazardFields`
  // paylaşılan bileşeni, bu dosyanın kendi bireysel-useState kuralına uygun
  // TEK bir state objesiyle (bileşenin zaten beklediği şekil).
  const [storageHazardFields, setStorageHazardFields] = useState<StorageHazardFieldValues>(() => ({
    storageHazardous: job.storageHazardous === true ? "evet" : "hayir",
    storageRiskGroups: job.storageRiskGroups ?? [],
  }));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showProductInfo = requiresProductInfo(job.categoryId);
  const tonnageRequired = showProductInfo && isTonnageRequired(job.categoryId);
  const showCustomsProductType = isCustomsBrokerageCategory(job.categoryId);
  const showDelivery = isTransportationCategory(job.categoryId);
  const showRecycling = isRecyclingCategory(job.categoryId);
  const showStorage = isStorageOnlyLocationCategory(job.categoryId);
  const showContainerDetails = isContainerStorageCategory(job.categoryId);
  const showHazardousStorage = isHazardousStorageCategory(job.categoryId);
  const isTehlikeliMaddeDepolama = isTehlikeliMaddeDepolamaCategory(job.categoryId);
  const storageHazardIsHazardous = showHazardousStorage && (isTehlikeliMaddeDepolama || storageHazardFields.storageHazardous === "evet");
  const storageHazardValid = !storageHazardIsHazardous || storageHazardFields.storageRiskGroups.length > 0;

  function toggleCustomsRequestedService(id: string) {
    setCustomsRequestedServices((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }
  // Bölge/Mahalle, Konum Bağlantısı, Adres Tarifi — yalnızca özel/"Listede
  // yok" konum modunda (job.locationMode === "custom") ya da bu alanlardan
  // en az biri zaten doluysa (eski bir ilan/Gümrük Müşavirliği kalıntısı)
  // gösterilir; her ilanda boş üç alan daha göstermek gereksiz gürültü olur.
  const showLegacyLocationFields =
    job.locationMode === "custom" || Boolean(job.neighborhood || job.locationUrl || job.directionsNote);

  const nakliyeLoadingMethodValid =
    nakliyeLoadingMethod !== NAKLIYE_MANUAL_ENTRY_VALUE || nakliyeLoadingMethodCustomText.trim().length > 0;
  // "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
  // Taşındı" görevleri — Yükün Hazırlanış Biçimi/Ürün Bilgileri/Konteyner
  // Bilgileri/Tehlikeli Madde-ADR artık grup başına `validateNakliyeCargoGroups`
  // ile doğrulanır (ADR Sınıfı zorunluluğu dahil — eski bağımsız `hazmatValid`
  // kontrolü bu yüzden ARTIK YOK) — form katmanının `NakliyeCargoGroupFieldValues`i
  // zaten `NakliyeCargoGroupFieldsForValidation`in gerektirdiği TÜM alanları
  // (fazlasıyla) taşıdığı için doğrudan geçirilebilir, ikinci bir dönüşüme
  // gerek yoktur. Diğer alanların aksine (bu form yalnızca "Kaydet"
  // butonunu devre dışı bırakır, canlı hata metni GÖSTERMEZ) grup hataları
  // ayrıca `<NakliyeCargoGroupsFields>`e CANLI geçirilir (bkz. aşağıdaki
  // JSX) — job-request-form.tsx/job-edit-form.tsx'in kendi grup kartlarıyla
  // AYNI bileşeni paylaştığı için bu, ikinci bir hata gösterim mekanizması
  // İCAT ETMEDEN elde edilen bir iyileştirmedir.
  const cargoGroupsValidation = showDelivery ? validateNakliyeCargoGroups(nakliyeCargoGroups) : { groupErrors: {}, hasErrors: false };
  const cargoGroupsValid = !cargoGroupsValidation.hasErrors;
  // Genel Güvenlik görevi §9 — bulunan gerçek açık: locationUrl doğrulama
  // OLMADAN doğrudan bir `<a href>`e yazılıyordu (bkz. job-requests-panel.tsx/
  // service-location-panel.tsx). `isSafeHttpUrl` boş değeri geçerli sayar
  // (opsiyonel alan), yalnızca dolu-ama-http(s)-olmayan bir değeri reddeder.
  const locationUrlValid = isSafeHttpUrl(locationUrl);
  const isValid =
    title.trim().length > 0 &&
    description.trim().length >= 20 &&
    province.trim().length > 0 &&
    district.trim().length > 0 &&
    workDate.length > 0 &&
    nakliyeLoadingMethodValid &&
    cargoGroupsValid &&
    storageHazardValid &&
    locationUrlValid;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    // "Nakliye Çoklu Yük Grubu" görevi — Nakliye'nin TÜM "Yük Bilgileri"
    // payload'u (productQuantity/productTonnage/productTonnageUnit/
    // productType/nakliyeLoadPreparationType/nakliyeMeasurementInfo/
    // nakliyeContainerTransport/nakliyeHazmat'ın HEPSİ) artık TEK yerden,
    // gerçek grup dizisinin İLK elemanının bir "aynası" olarak üretilir
    // (bkz. job-request-form.tsx#resolveNakliyeYukBilgileriPayload İLE AYNI
    // ilke, nakliye-cargo-groups.ts#deriveLegacyMirrorFields).
    const nakliyeCargoGroupsPayload = showDelivery ? fromCargoGroupsFields(nakliyeCargoGroups) : undefined;
    const nakliyeMirror = nakliyeCargoGroupsPayload ? deriveLegacyMirrorFields(nakliyeCargoGroupsPayload) : undefined;
    // "Tehlikeli Madde / ADR Kartı Sadeleştirmesi" görevinin kendi kesin
    // kuralı: bu form artık UN Numarası/Resmî Taşımacılık Adı/Ambalaj
    // Grubu'nu HİÇ toplamıyor, ama eski bir ilan yalnız görüntülenip
    // düzenlendiğinde bu alanlara otomatik null gönderip mevcut veriyi
    // SİLEMEYİZ (görev talimatı). `job.nakliyeHazmat` bu formun kendi
    // Supabase'ten okuduğu, düzenlemeden ÖNCEKİ gerçek değerdir — status
    // hâlâ "evet" ise üç eski alan buradan geri taşınır, yeni status/adrClass
    // (artık grup 1'in aynası, bkz. yukarıdaki nakliyeMirror) her zaman
    // kazanır (job-store.ts#mergeLegacyHazmatFields İLE AYNI ilke, burada
    // admin formu zaten "before" değerini elinde tuttuğu için ayrı bir merge
    // fonksiyonuna gerek yok).
    const nakliyeHazmat: NakliyeHazmatDetail | undefined =
      showDelivery && nakliyeMirror?.nakliyeHazmat
        ? nakliyeMirror.nakliyeHazmat.status !== "evet"
          ? { status: nakliyeMirror.nakliyeHazmat.status }
          : {
              status: "evet",
              adrClass: nakliyeMirror.nakliyeHazmat.adrClass,
              ...(job.nakliyeHazmat?.status === "evet"
                ? {
                    unNumber: job.nakliyeHazmat.unNumber,
                    properShippingName: job.nakliyeHazmat.properShippingName,
                    packingGroup: job.nakliyeHazmat.packingGroup,
                  }
                : {}),
            }
        : undefined;
    const result = await updateJobAsAdmin(
      job.id,
      {
        title,
        description,
        operationDetails: operationDetails.trim() ? operationDetails : undefined,
        province,
        district,
        workLocationType,
        addressText,
        neighborhood: neighborhood.trim() ? neighborhood : undefined,
        locationUrl: locationUrl.trim() ? locationUrl : undefined,
        directionsNote: directionsNote.trim() ? directionsNote : undefined,
        workDate,
        workEndDate: workEndDate || undefined,
        productQuantity: showDelivery
          ? nakliyeMirror?.productQuantity
          : showProductInfo && productQuantity
            ? clampToBounds(productQuantity, MAX_PRODUCT_QUANTITY)
            : undefined,
        productTonnage: showDelivery
          ? nakliyeMirror?.productTonnage
          : showProductInfo && productTonnage
            ? clampToBounds(productTonnage, MAX_TONNAGE_TON)
            : undefined,
        productTonnageUnit: showDelivery ? nakliyeMirror?.productTonnageUnit : undefined,
        productType: showDelivery ? nakliyeMirror?.productType : showProductInfo && productType ? productType : undefined,
        customsProductType: showCustomsProductType && customsProductType ? customsProductType : undefined,
        customsTransactionType: showCustomsProductType && customsTransactionType ? customsTransactionType : undefined,
        customsRequestedServices: showCustomsProductType && customsRequestedServices.length > 0 ? customsRequestedServices : undefined,
        deliveryProvince: showDelivery && deliveryProvince ? deliveryProvince : undefined,
        deliveryDistrict: showDelivery && deliveryDistrict ? deliveryDistrict : undefined,
        deliveryFacilityName: showDelivery && deliveryFacilityName ? deliveryFacilityName : undefined,
        deliveryAddressText: showDelivery && deliveryAddressText ? deliveryAddressText : undefined,
        recyclingMaterialCategoryId: showRecycling ? recyclingFields.recyclingMaterialCategoryId || undefined : undefined,
        recyclingMaterialSubtypeId: showRecycling ? recyclingFields.recyclingMaterialSubtypeId || undefined : undefined,
        recyclingQuantity: showRecycling && recyclingFields.recyclingQuantity ? Number(recyclingFields.recyclingQuantity) : undefined,
        recyclingUnit:
          showRecycling && isWasteQuantityUnit(recyclingFields.recyclingUnit) ? recyclingFields.recyclingUnit : undefined,
        recyclingMaterialCondition:
          showRecycling && isRecyclingMaterialCondition(recyclingFields.recyclingMaterialCondition)
            ? recyclingFields.recyclingMaterialCondition
            : undefined,
        recyclingMaterialConditionNote:
          showRecycling && recyclingFields.recyclingMaterialCondition === "diger" && recyclingFields.recyclingMaterialConditionNote
            ? recyclingFields.recyclingMaterialConditionNote
            : undefined,
        recyclingScopeOfWork: showRecycling && recyclingFields.recyclingScopeOfWork.length > 0 ? recyclingFields.recyclingScopeOfWork : undefined,
        recyclingRequestedOperation: showRecycling ? recyclingFields.recyclingRequestedOperation || undefined : undefined,
        recyclingWasteCode:
          showRecycling && !recyclingFields.recyclingWasteCodeUnknown ? recyclingFields.recyclingWasteCode || undefined : undefined,
        recyclingWasteCodeUnknown: showRecycling ? recyclingFields.recyclingWasteCodeUnknown : undefined,
        recyclingHazardProperties:
          showRecycling && recyclingFields.recyclingHazardProperties.length > 0 ? recyclingFields.recyclingHazardProperties : undefined,
        storageProductType: showStorage && !showContainerDetails && storageProductType ? storageProductType : undefined,
        storageProductQuantity: showStorage && !showContainerDetails && storageProductQuantity ? Number(storageProductQuantity) : undefined,
        storageProductUnit:
          showStorage && !showContainerDetails && storageProductUnit ? (storageProductUnit as "kg" | "ton" | "adet") : undefined,
        storageProductTonnage: showStorage && !showContainerDetails && storageProductTonnage ? Number(storageProductTonnage) : undefined,
        storageContainerGroups: showContainerDetails ? fromStorageContainerGroupsFields(containerGroups) : undefined,
        storageHazardous: showHazardousStorage ? storageHazardIsHazardous : undefined,
        storageRiskGroups:
          showHazardousStorage && storageHazardIsHazardous && storageHazardFields.storageRiskGroups.length > 0
            ? storageHazardFields.storageRiskGroups
            : undefined,
        nakliyeLoadPreparationType: showDelivery ? nakliyeMirror?.nakliyeLoadPreparationType : undefined,
        nakliyeLoadPreparationCustomText: showDelivery ? nakliyeMirror?.nakliyeLoadPreparationCustomText : undefined,
        nakliyeLoadingMethod: showDelivery ? nakliyeLoadingMethod || undefined : undefined,
        nakliyeLoadingMethodCustomText:
          showDelivery && nakliyeLoadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE ? nakliyeLoadingMethodCustomText : undefined,
        nakliyeMeasurementInfo: showDelivery ? nakliyeMirror?.nakliyeMeasurementInfo : undefined,
        nakliyeHazmat,
        nakliyeContainerTransport: showDelivery ? nakliyeMirror?.nakliyeContainerTransport : undefined,
        nakliyeCargoGroups: nakliyeCargoGroupsPayload,
      },
      job.updatedAt,
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="mt-4 flex flex-col gap-5 rounded-md border border-border bg-background p-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Temel İlan Bilgileri</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground sm:col-span-2">
            İlan Başlığı
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TITLE_MAX_LENGTH}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground sm:col-span-2">
            Açıklama
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={DESCRIPTION_MAX_LENGTH}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground sm:col-span-2">
            Hizmete Özel Açıklama (Operasyon Detayı)
            <textarea
              value={operationDetails}
              onChange={(event) => setOperationDetails(event.target.value)}
              rows={2}
              maxLength={DESCRIPTION_MAX_LENGTH}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Lokasyon</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            İl
            <input
              type="text"
              value={province}
              onChange={(event) => setProvince(event.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            İlçe
            <input
              type="text"
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Bölge / Tesis
            <input
              type="text"
              value={workLocationType}
              onChange={(event) => setWorkLocationType(event.target.value)}
              maxLength={FACILITY_NAME_MAX_LENGTH}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Açık Adres
            <input
              type="text"
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
              maxLength={ADDRESS_MAX_LENGTH}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          {showLegacyLocationFields && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Bölge / Mahalle
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(event) => setNeighborhood(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Konum Bağlantısı
                <input
                  type="text"
                  value={locationUrl}
                  onChange={(event) => setLocationUrl(event.target.value)}
                  aria-invalid={!locationUrlValid || undefined}
                  className={`rounded-md border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    locationUrlValid ? "border-border" : "border-danger"
                  }`}
                />
                {!locationUrlValid && <span className="text-danger">{UNSAFE_URL_MESSAGE}</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground sm:col-span-2">
                Adres Tarifi
                <input
                  type="text"
                  value={directionsNote}
                  onChange={(event) => setDirectionsNote(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Tarihler</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            İş Tarihi
            <input
              type="date"
              value={workDate}
              min={getTodayLocalDateString()}
              onChange={(event) => setWorkDate(event.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Bitiş Tarihi (opsiyonel)
            <input
              type="date"
              value={workEndDate}
              min={workDate || getTodayLocalDateString()}
              onChange={(event) => setWorkEndDate(event.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
        </div>
      </fieldset>

      {(showProductInfo || showCustomsProductType) && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {showDelivery ? "Yük Bilgileri" : "Ürün Bilgileri"}
          </legend>
          {showProductInfo && !showDelivery && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Ürün Adedi
                <input
                  type="number"
                  min={1}
                  max={MAX_PRODUCT_QUANTITY}
                  value={productQuantity}
                  onChange={(event) => setProductQuantity(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Ürün Cinsi
                <input
                  type="text"
                  value={productType}
                  onChange={(event) => setProductType(event.target.value)}
                  maxLength={100}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Tonaj {tonnageRequired ? "" : "(opsiyonel)"}
                <input
                  type="number"
                  min={0}
                  max={MAX_TONNAGE_TON}
                  value={productTonnage}
                  onChange={(event) => setProductTonnage(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
            </div>
          )}
          {showDelivery && (
            <>
              <NakliyeCargoGroupsFields
                idPrefix="nakliye-admin-cargo"
                groups={nakliyeCargoGroups}
                errors={cargoGroupsValidation.groupErrors}
                onChange={setNakliyeCargoGroups}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                  Yükleme Yöntemi (opsiyonel)
                  <select
                    value={nakliyeLoadingMethod}
                    onChange={(event) => setNakliyeLoadingMethod(event.target.value)}
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="">Seçilmedi</option>
                    {LOADING_METHOD_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    <option value={NAKLIYE_MANUAL_ENTRY_VALUE}>{NAKLIYE_MANUAL_ENTRY_OPTION_LABEL}</option>
                  </select>
                </label>
                {nakliyeLoadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE && (
                  <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                    Yükleme yöntemini yazın
                    <input
                      type="text"
                      value={nakliyeLoadingMethodCustomText}
                      onChange={(event) => setNakliyeLoadingMethodCustomText(event.target.value)}
                      className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                )}
              </div>
            </>
          )}
          {showCustomsProductType && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Gümrük Ürün Cinsi
                <input
                  type="text"
                  value={customsProductType}
                  onChange={(event) => setCustomsProductType(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                İşlem Türü
                <select
                  value={customsTransactionType}
                  onChange={(event) => setCustomsTransactionType(event.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="">Seçilmedi</option>
                  {CUSTOMS_TRANSACTION_TYPES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {showCustomsProductType && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Talep Edilen Hizmetler</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {CUSTOMS_REQUESTED_SERVICE_OPTIONS.map((option) => (
                  <label key={option.id} className="flex items-center gap-1.5 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={customsRequestedServices.includes(option.id)}
                      onChange={() => toggleCustomsRequestedService(option.id)}
                      className="rounded border-border"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}

      {showDelivery && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Nakliye Rotası — Teslim Edilecek Yer</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Teslim İli
              <input
                type="text"
                value={deliveryProvince}
                onChange={(event) => setDeliveryProvince(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Teslim İlçesi
              <input
                type="text"
                value={deliveryDistrict}
                onChange={(event) => setDeliveryDistrict(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Teslim Tesisi
              <input
                type="text"
                value={deliveryFacilityName}
                onChange={(event) => setDeliveryFacilityName(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Teslim Adresi
              <input
                type="text"
                value={deliveryAddressText}
                onChange={(event) => setDeliveryAddressText(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </div>
        </fieldset>
      )}


      {showRecycling && (
        <RecyclingFields
          idPrefix="recycling-admin"
          values={recyclingFields}
          errors={{}}
          onChange={(patch) => setRecyclingFields((current) => ({ ...current, ...patch }))}
        />
      )}

      {showStorage && !showContainerDetails && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Depolama Bilgileri</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Depolanacak Ürün
              <input
                type="text"
                value={storageProductType}
                onChange={(event) => setStorageProductType(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Miktar
              <input
                type="number"
                min={0}
                value={storageProductQuantity}
                onChange={(event) => setStorageProductQuantity(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Birim
              <select
                value={storageProductUnit}
                onChange={(event) => setStorageProductUnit(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Seçiniz</option>
                {RECYCLING_UNIT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Toplam Tonaj (opsiyonel)
              <input
                type="number"
                min={0}
                value={storageProductTonnage}
                onChange={(event) => setStorageProductTonnage(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </div>
        </fieldset>
      )}

      {showHazardousStorage && (
        <StorageHazardFields
          idPrefix="storage-hazard-admin"
          category={job.categoryId}
          values={storageHazardFields}
          errors={{ storageRiskGroups: !storageHazardValid ? "En az bir depolama tehlike/risk grubu seçiniz." : undefined }}
          onChange={(patch) => setStorageHazardFields((current) => ({ ...current, ...patch }))}
        />
      )}

      {showContainerDetails && (
        <StorageContainerGroupsFields
          idPrefix="storage-container-admin"
          groups={containerGroups}
          onChange={setContainerGroups}
        />
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !isValid}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Değişiklikleri Kaydet
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          İptal
        </button>
      </div>
    </div>
  );
}
