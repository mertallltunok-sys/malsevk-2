"use client";

import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getCustomsRequestedServiceLabels,
  getCustomsTransactionTypeLabel,
  isCustomsBrokerageCategory,
} from "../_lib/customs-brokerage-catalog";
import { ADDRESS_MAX_LENGTH } from "../_lib/field-limits";
import {
  findDuplicateServiceCategoryIds,
  SERVICE_LOCATION_ERROR_KEYS,
  validateNakliyeCargoGroups,
  validateNakliyeDetails,
  validateServiceItem,
  validateSharedOperationFields,
  type NakliyeCargoGroupErrors,
  type NakliyeDetailsErrors,
  type ServiceItemErrors,
  type ServiceItemFields,
  type SharedOperationErrors,
} from "../_lib/job-form-validation";
import {
  FACILITY_FREE_TEXT_VALUE,
  isSimplifiedLocationCategory,
  STANDARD_MANUAL_FACILITY_OPTION_LABEL,
  toFacilitySelectOptions,
} from "../_lib/job-location";
import { FIXED_PROVINCE_LABEL } from "../_lib/job-listing-filters";
import { formatJobDate, getTodayLocalDateString } from "../_lib/jobs";
import {
  DELIVERY_MANUAL_LOCATION_VALUE,
  isTransportationCategory,
  PICKUP_MANUAL_LOCATION_VALUE,
} from "../_lib/nakliye-route";
import { deriveLegacyMirrorFields } from "../_lib/nakliye-cargo-groups";
import {
  createEmptyNakliyeCargoGroupFields,
  fromCargoGroupsFields,
  isNakliyeContainerProductType,
  type NakliyeCargoGroupFieldValues,
} from "../_lib/nakliye-transport-catalog";
import { MIN_PHOTOS } from "../_lib/photo-validation";
import {
  formatProductQuantity,
  formatProductTonnage,
  isProductTonnageUnit,
  isTonnageRequired,
  parseProductQuantity,
  parseProductTonnage,
  PRODUCT_TONNAGE_UNIT_OPTIONS,
  PRODUCT_TYPE_CUSTOM_VALUE,
  PRODUCT_TYPE_SUGGESTIONS,
  requiresProductInfo,
} from "../_lib/product-catalog";
import {
  formatRecyclingQuantity,
  getRecyclingMaterialConditionLabel,
  getRecyclingMaterialTypeDetailLine,
  getRecyclingMaterialTypeLabel,
  getRecyclingRequestedOperationLabel,
  getRecyclingScopeOfWorkLabels,
  isRecyclingCategory,
  isRecyclingMaterialCondition,
  isRecyclingUnit,
  isWasteQuantityUnit,
  parseRecyclingQuantity,
} from "../_lib/recycling-catalog";
import {
  deriveWasteCodeHazardous,
  formatWasteCodeForDisplay,
  getWasteCodeEntry,
  getWasteHazardPropertyLabel,
} from "../_lib/recycling-waste-code-catalog";
import { getServiceCategoryLabel, isStorageOnlyLocationCategory, SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import { isContainerStorageCategory } from "../_lib/storage-container-catalog";
import { isHazardousStorageCategory, isTehlikeliMaddeDepolamaCategory } from "../_lib/storage-hazard-catalog";
import { submitFacilityCandidateBestEffort } from "../_lib/supabase-facility-candidates";
import { createJobWithSupabaseSync, createJobsForOperationWithSupabaseSync } from "../_lib/supabase-job-sync";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceCodeByName,
  getProvinceIdByCode,
  getProvinces,
  type Facility,
} from "../_lib/turkey-locations";
import type { NakliyeCargoGroup, NakliyeDetails } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { CustomsBrokerageFields, type CustomsBrokerageFieldValues } from "./customs-brokerage-fields";
import { GuestAccessCard, PageCardShell } from "./guest-access-card";
import { JobCustomsDocumentUpload, type ReadyJobCustomsDocument } from "./job-customs-document-upload";
import { JobPhotoUpload, type ReadyJobPhoto } from "./job-photo-upload";
import { ManualFacilityNameField } from "./manual-facility-name-field";
import { NakliyeCargoGroupsFields } from "./nakliye-cargo-group-fields";
import { NakliyeLocationFields, type NakliyeLocationFieldValues } from "./nakliye-location-fields";
import { NakliyeSectionCard } from "./nakliye-section-card";
import {
  createEmptyNakliyeDetailsFields,
  fromNakliyeDetailsFields,
  LoadingMethodField,
  ShipmentPlanFields,
  VehiclePreferenceFields,
  type NakliyeDetailsFieldValues,
} from "./nakliye-transport-fields";
import { ProductTypeCombobox } from "./product-type-combobox";
import { RecyclingFields, type RecyclingFieldValues } from "./recycling-fields";
import { SearchableSelect } from "./searchable-select";
import { StorageHazardFields, type StorageHazardFieldValues } from "./storage-hazard-fields";
import { StorageProductFields, type StorageProductFieldValues } from "./storage-product-fields";
import {
  createEmptyStorageContainerGroupFields,
  fromStorageContainerGroupsFields,
  StorageContainerGroupsFields,
  type StorageContainerGroupFieldValues,
} from "./storage-container-details-fields";

const PAGE_TITLE = "Hizmet Talebi Oluştur";
const PAGE_DESCRIPTION =
  "İhtiyacınızı tanımlayın; uzman hizmet verenler ilanınızı inceleyip teklif göndersin.";

/**
 * Çoklu Hizmet Operasyonu — Aşama 2.2: tek bir hizmet kartının TÜM form
 * state'i (kategori, başlık, hizmete özel açıklama, kendi tarih aralığı,
 * kendi konumu). `localId` YALNIZCA React key/hata eşleştirmesi için vardır
 * (bkz. job-photo-upload.tsx#PhotoItem.clientId ile AYNI desen,
 * crypto.randomUUID()) — dizi index'i kalıcı kimlik olarak KULLANILMAZ (bir
 * kart silindiğinde diğerlerinin index'i kayar, ama localId hiç değişmez).
 * `localId` hiçbir zaman `createJob`/`createJobsForOperation`'a gönderilmez.
 *
 * `useMainLocation` yalnızca EK hizmetler (index > 0) için anlamlıdır: true
 * ise bu hizmetin efektif konumu, kendi (boş kalan) alanları değil, ana
 * hizmetin (index 0) konumudur — bkz. getEffectiveLocation. Ana hizmette bu
 * alan hiç okunmaz, her zaman kendi konumu geçerlidir.
 *
 * `provinceCode` — Nakliye Güzergâh Yönetimi: "Yük Alınacak Yer"in kendi ili
 * (serbestçe seçilebilir, Türkiye geneli). Nakliye DIŞINDAKİ kategorilerde
 * hiç okunmaz/gösterilmez — o kategoriler bunun yerine operasyon-geneli
 * PAYLAŞILAN `provinceCode` state'ini (bkz. handleSharedProvinceChange) kullanır,
 * o da artık serbestçe seçilebilir (Türkiye geneli) — Kocaeli yalnızca ikisinin
 * de ortak başlangıç varsayılanıdır (bkz. createEmptyServiceEntry), kilitli
 * DEĞİLDİR.
 */
type ServiceEntry = {
  localId: string;
  category: string;
  title: string;
  description: string;
  workDate: string;
  workEndDate: string;
  useMainLocation: boolean;
  provinceCode: string;
  district: string;
  facilityId: string;
  otherFacilityText: string;
  addressText: string;
  /**
   * "Ürün Bilgileri" — product-catalog.ts#requiresProductInfo(category)
   * true iken gösterilir. Konum alanlarının aksine "Ana hizmetle aynı"
   * kavramı YOK: her hizmet, kategorisi ne olursa olsun, HER ZAMAN kendi
   * ürün bilgisini taşır (bkz. görev tanımı — "her hizmet ilanı kendi ürün
   * bilgilerini saklasın").
   */
  productQuantity: string;
  productTonnage: string;
  /** Bkz. job-form-validation.ts#JobFormFields.productTonnageUnit — yalnızca isTransportationCategory(category) true iken gösterilir/anlamlıdır; Liman Hizmetleri bu alanı hiç okumaz, kendi Tonaj alanı sabit "ton" gösterir. Her zaman geçerli bir varsayılanla ("ton") başlar. */
  productTonnageUnit: string;
  productType: string;
  /** Bkz. job-form-validation.ts#JobFormFields.productTypeCustomText — yalnızca productType === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı. */
  productTypeCustomText: string;
  /**
   * Gümrük Müşavirliği'ne özel "Operasyon Bilgileri" — customs-brokerage-catalog.ts#
   * isCustomsBrokerageCategory(category) true iken gösterilir. product-catalog.ts'in
   * alanlarıyla AYNI ilke: her hizmet, kategorisi ne olursa olsun HER ZAMAN
   * kendi bilgisini taşır ("Ana hizmetle aynı" kavramı burada da YOK).
   * `customsDocuments` henüz IndexedDB'ye yazılmamış, doğrulanmış blob'lardır
   * (bkz. JobCustomsDocumentUpload) — "Aynı hizmet birden fazla kez
   * seçilemez" kuralı sayesinde aynı anda en fazla BİR karta ait olabilir.
   */
  customsTransactionType: string;
  customsRequestedServices: string[];
  customsProductType: string;
  /** Yalnızca customsProductType === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı — bkz. productTypeCustomText üstündeki AYNI desen. */
  customsProductTypeCustomText: string;
  customsDocuments: ReadyJobCustomsDocument[];
  /**
   * Geri Dönüşüm & Atık Tahliye'ye özel "Malzeme Bilgileri" —
   * recycling-catalog.ts#isRecyclingCategory(category) true iken gösterilir.
   * Diğer hizmete-özel alan gruplarıyla AYNI ilke: her hizmet, kategorisi ne
   * olursa olsun HER ZAMAN kendi bilgisini taşır.
   */
  recyclingMaterialCategoryId: string;
  recyclingMaterialSubtypeId: string;
  recyclingQuantity: string;
  recyclingUnit: string;
  recyclingMaterialCondition: string;
  recyclingMaterialConditionNote: string;
  recyclingScopeOfWork: string[];
  recyclingRequestedOperation: string;
  recyclingWasteCode: string;
  recyclingWasteCodeUnknown: boolean;
  recyclingHazardProperties: string[];
  /**
   * Depolama'ya özel "Depolanacak Ürün Bilgileri" —
   * service-catalog.ts#isStorageOnlyLocationCategory(category) (Depo
   * Hizmetleri grubunun TAMAMI, 12 alt kategori) true iken gösterilir.
   * Diğer hizmete-özel alan gruplarıyla AYNI ilke: her hizmet, kategorisi ne
   * olursa olsun HER ZAMAN kendi bilgisini taşır.
   */
  storageProductType: string;
  storageProductTypeCustomText: string;
  storageProductQuantity: string;
  storageProductUnit: string;
  storageProductTonnage: string;
  /**
   * "Konteyner Grupları" — yalnızca storage-container-catalog.ts#
   * isContainerStorageCategory(category) true iken (yalnızca "Konteyner
   * Depolama" alt kategorisi) gösterilir/anlamlıdır. Bu kategoride
   * yukarıdaki storageProductType/Quantity/Unit/Tonnage alanları HİÇ
   * KULLANILMAZ (bir ilan birden fazla konteyner grubu taşıyabildiği için
   * TEK değerli o alanlar artık yetersiz — bkz. storage-container-catalog.ts'in
   * kendi başlık dokümanındaki 3. tasarım notu). Çoklu hizmet operasyonunda
   * HER Konteyner Depolama kartı kendi bağımsız grup dizisini taşır (bu
   * dizi zaten ServiceEntry'nin kendisinde olduğu için — ikinci bir
   * izolasyon mekanizması gerekmez).
   */
  storageContainerGroups: StorageContainerGroupFieldValues[];
  /**
   * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — yalnızca
   * storage-hazard-catalog.ts#isHazardousStorageCategory(category) true
   * iken (bu iki alt kategoride) gösterilir/anlamlıdır.
   */
  storageHazardous: string;
  storageRiskGroups: string[];
  /**
   * Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer" (delivery). Yalnızca
   * isTransportationCategory(category) true iken gösterilir. Ürün/Gümrük
   * alanlarıyla AYNI ilke: "Ana hizmetle aynı lokasyon" kavramı YOK — bu
   * alanlar her zaman bu kartın kendisine aittir (bkz. görev tanımı madde
   * 12 "Bu bilgiler yalnızca Nakliye ilanına ait olacaktır").
   */
  deliveryProvinceCode: string;
  deliveryDistrict: string;
  deliveryFacilityId: string;
  /** Yalnızca deliveryFacilityId === DELIVERY_MANUAL_LOCATION_VALUE iken anlamlı — kullanıcının serbestçe yazdığı GERÇEK teslimat liman/sanayi/OSB adı (bkz. NakliyeLocationFieldValues.customFacilityName dokümanı). Pickup'ın otherFacilityText'iyle AYNI ilke, ayrı Job alanına (deliveryFacilityName) yazıldığı için ayrı bir state. */
  deliveryOtherFacilityText: string;
  deliveryAddressText: string;
  /**
   * "Nakliye Yeniden Tasarımı" / "Nakliye Alan Sadeleştirmesi" — Araç
   * Tercihi/Yükleme-Teslimat operasyon detayları/Özel Taşıma Koşulları
   * ve (bu görevle TEK seçimli birer dropdown'a indirgenmiş) Yükün
   * Hazırlanış Biçimi/Yükleme Yöntemi dahil TÜM Nakliye'ye özel alanlar
   * tek bir `NakliyeDetailsFieldValues` objesinde tutulur. Yalnızca
   * isTransportationCategory(category) true iken gösterilir/anlamlıdır —
   * diğer alan gruplarıyla AYNI "her hizmet kendi bilgisini taşır" ilkesi.
   */
  nakliyeDetails: NakliyeDetailsFieldValues;
  /**
   * "Nakliye Çoklu Yük Grubu" görevi — "2 — Yük Bilgileri" kartının artık
   * TEK değil, bağımsız bir "Yük Grubu" dizisi taşıdığı YENİ alan (bkz.
   * nakliye-transport-catalog.ts#NakliyeCargoGroupFieldValues). Yalnızca
   * isTransportationCategory(category) true iken gösterilir/anlamlıdır —
   * bu durumda üstteki `productQuantity`/`productTonnage`/`productType`/
   * `productTonnageUnit` (job-üstü/paylaşılan alanlar) Nakliye için ARTIK
   * KULLANILMAZ, her Yük Grubu kendi kopyasını taşır. Diğer alan gruplarıyla
   * AYNI "her hizmet kendi bilgisini taşır" ilkesi — HER ZAMAN en az 1 grup
   * içerir (createEmptyServiceEntry, storageContainerGroups İLE AYNI "ilk
   * grup hazır gelir" ilkesi).
   */
  nakliyeCargoGroups: NakliyeCargoGroupFieldValues[];
};

type ServiceLocation = Pick<
  ServiceEntry,
  "provinceCode" | "district" | "facilityId" | "otherFacilityText" | "addressText"
>;

type ServiceFieldName =
  | "category"
  | "title"
  | "description"
  | "workDate"
  | "workEndDate"
  | "district"
  | "workLocationType"
  | "customFacilityName"
  | "addressText"
  | "productQuantity"
  | "productTonnage"
  | "productTonnageUnit"
  | "productType"
  | "productTypeCustomText"
  | "customsTransactionType"
  | "customsRequestedServices"
  | "customsProductType"
  | "customsProductTypeCustomText"
  | "recyclingMaterialCategoryId"
  | "recyclingMaterialSubtypeId"
  | "recyclingQuantity"
  | "recyclingUnit"
  | "recyclingMaterialCondition"
  | "recyclingMaterialConditionNote"
  | "recyclingScopeOfWork";

function createEmptyServiceEntry(): ServiceEntry {
  return {
    localId: crypto.randomUUID(),
    category: "",
    title: "",
    description: "",
    workDate: "",
    workEndDate: "",
    useMainLocation: true,
    // Nakliye seçildiğinde kullanışlı bir başlangıç değeri (Kocaeli) — diğer
    // kategoriler bu alanı hiç okumaz (hâlâ FIXED_PROVINCE_LABEL kullanır).
    provinceCode: getProvinceCodeByName(FIXED_PROVINCE_LABEL) ?? "",
    district: "",
    facilityId: "",
    otherFacilityText: "",
    addressText: "",
    productQuantity: "",
    productTonnage: "",
    // Varsayılan birim "ton" (bkz. görev tanımı) — yalnızca Nakliye
    // kartlarında gösterilir/anlamlıdır, Liman Hizmetleri hiç okumaz.
    productTonnageUnit: "ton",
    productType: "",
    productTypeCustomText: "",
    customsTransactionType: "",
    customsRequestedServices: [],
    customsProductType: "",
    customsProductTypeCustomText: "",
    customsDocuments: [],
    recyclingMaterialCategoryId: "",
    recyclingMaterialSubtypeId: "",
    recyclingQuantity: "",
    recyclingUnit: "",
    recyclingMaterialCondition: "",
    recyclingMaterialConditionNote: "",
    recyclingScopeOfWork: [],
    recyclingRequestedOperation: "",
    recyclingWasteCode: "",
    recyclingWasteCodeUnknown: false,
    recyclingHazardProperties: [],
    storageProductType: "",
    storageProductTypeCustomText: "",
    storageProductQuantity: "",
    storageProductUnit: "",
    storageProductTonnage: "",
    storageContainerGroups: [createEmptyStorageContainerGroupFields()],
    storageHazardous: "hayir",
    storageRiskGroups: [],
    deliveryProvinceCode: "",
    deliveryDistrict: "",
    deliveryFacilityId: "",
    deliveryOtherFacilityText: "",
    deliveryAddressText: "",
    nakliyeDetails: createEmptyNakliyeDetailsFields(),
    nakliyeCargoGroups: [createEmptyNakliyeCargoGroupFields()],
  };
}

/** Bir hizmet kartındaki bir alanın DOM id'si — kartlar dinamik bir dizi olduğu için `useId()` yerine (hook kuralları bunu yasaklar) zaten benzersiz olan `localId`den türetilir. */
function serviceFieldId(localId: string, field: ServiceFieldName): string {
  return `service-${field}-${localId}`;
}

/**
 * `idPrefix` + alan adını `${idPrefix}-${alan}` şeklinde birleştiren, bu
 * dosyadaki HER "idPrefix tabanlı" alt-form bileşeninin (NakliyeLocationFields,
 * CustomsBrokerageFields, RecyclingFields — üçü de kendi içinde AYNI
 * `${idPrefix}-${alan}` kuralıyla DOM id üretir) GERÇEK DOM id'siyle birebir
 * eşleşen TEK ortak üretim kuralı — `focusFirstServiceError`in hedef elemanı
 * bulabilmesi için `serviceFieldId`in (genel/prefix'siz alanlar için) yerine
 * BUNU kullanması gerekir. Yeni bir idPrefix'li alt-form bileşeni eklenirse
 * (customs/recycling ile AYNI desende) buraya tekrar dokunmaya gerek yoktur —
 * yalnızca çağıran taraf doğru `idPrefix`i geçirir.
 */
function prefixedFieldId(idPrefix: string, field: string): string {
  return `${idPrefix}-${field}`;
}

/**
 * Bir hizmetin EFEKTİF (pickup) konumu — "Ana hizmetle aynı lokasyon"
 * işaretliyse (yalnızca ek hizmetlerde anlamlı) ana hizmetin (index 0)
 * konumu, aksi halde kendi konumu. Depolama (bkz. isStorageOnlyLocationCategory)
 * bu devirden BİLEREK hariç tutulur — "Ana hizmetle aynı lokasyon" seçeneği
 * Depolama kartlarında hiç gösterilmez (bkz. görev tanımı madde 1), bu yüzden
 * `useMainLocation` bayrağı (varsayılan `true`) hiçbir zaman kullanıcı
 * tarafından değiştirilemez ve TEK BAŞINA güvenilemez — burada AYRICA
 * kontrol edilmezse bir Depolama kartı sessizce ana hizmetin (var olsa bile
 * anlamsız) tesis/adres bilgisini devralırdı. Gümrük Müşavirliği (lokasyonu
 * artık AYNI şekilde yalnızca İl/İlçe olsa da) bu istisnaya DAHİL DEĞİLDİR —
 * kendi "Ana hizmetle aynı lokasyon" seçeneği normal şekilde çalışmaya devam
 * eder.
 */
function getEffectiveLocation(services: ServiceEntry[], index: number): ServiceLocation {
  const service = services[index];
  if (index > 0 && service.useMainLocation && !isStorageOnlyLocationCategory(service.category)) return services[0];
  return service;
}

/** Bir hizmetin ham "Ürün Bilgileri" alanlarını createJob/createJobsForOperation'a gönderilecek son hâline (ayrıştırılmış sayı/trim'lenmiş metin) indirger — YALNIZCA Nakliye DIŞI requiresProductInfo kapsamındaki kategoriler için (bugün yalnızca Liman Hizmetleri). "Nakliye Çoklu Yük Grubu" görevi — Nakliye artık bu alanları hiç kullanmaz/göstermez; kendi Ürün Bilgisi'ni HER Yük Grubu kendi taşır (bkz. resolveNakliyeYukBilgileriPayload). */
function resolveProductInfoPayload(
  service: ServiceEntry,
): { productQuantity?: number; productTonnage?: number; productTonnageUnit?: "ton" | "kg"; productType?: string } {
  if (!requiresProductInfo(service.category) || isTransportationCategory(service.category)) return {};
  const quantityResult = parseProductQuantity(service.productQuantity);
  const tonnageRaw = service.productTonnage.trim();
  const tonnageResult = tonnageRaw.length > 0 ? parseProductTonnage(service.productTonnage) : null;
  // "Listede Yok, Kendim Gireceğim" seçiliyken gerçek metin
  // productTypeCustomText'te yaşar — sentinel'in kendisi hiçbir zaman
  // Job.productType olarak kaydedilmez (bkz. görev tanımı).
  const resolvedProductType =
    service.productType === PRODUCT_TYPE_CUSTOM_VALUE
      ? service.productTypeCustomText.trim()
      : service.productType.trim();
  return {
    productQuantity: quantityResult.ok ? quantityResult.value : undefined,
    productTonnage: tonnageResult?.ok ? tonnageResult.value : undefined,
    productType: resolvedProductType || undefined,
  };
}

/**
 * Nakliye "Yük Alınacak Yer" (pickup) — ham state'i (il KODU, ilçe,
 * tesis-ya-da-manuel seçimi, manuel tesis adı) mevcut/paylaşılan Job
 * alanlarına (il ADI, çözümlenmiş/manuel tesis adı, facilityId, addressText,
 * locationMode) indirger — pickup için AYRI bir Job alan grubu YOKTUR (bkz.
 * CLAUDE.md/görev tanımı: mevcut veri modeli korunur), bu fonksiyon yalnızca
 * formun Nakliye-özel state'ini o paylaşılan alanlara dönüştürür. Manuel
 * moddaki GERÇEK ad (customFacilityName) workLocationType'a yazılır —
 * job-location.ts'in Nakliye DIŞI kategorilerde zaten yaptığı "serbest metin
 * adı aynı görünen alana yazılır" ilkesiyle AYNI (bkz. görev tanımı madde
 * 1/4/7). Açık adres artık seçilen yönteme bakılmaksızın HER ZAMAN taşınır
 * (bkz. görev tanımı madde 2/3) — eskiden yalnızca manuel modda taşınırdı.
 * Kategori Nakliye değilse hepsi boş/varsayılan döner — çağıran taraf bu
 * durumda bunun yerine LEGACY resolveWorkLocationTypeValue/ServiceLocation
 * yolunu kullanır.
 */
function resolveNakliyePickupPayload(input: {
  category: string;
  provinceCode: string;
  district: string;
  facilityId: string;
  customFacilityName: string;
  addressText: string;
}): { province: string; workLocationType: string; facilityId: string; addressText: string; locationMode: "catalog" | "custom" } {
  if (!isTransportationCategory(input.category)) {
    return { province: "", workLocationType: "", facilityId: "", addressText: "", locationMode: "catalog" };
  }

  const province = getProvinces().find((item) => item.code === input.provinceCode)?.name ?? "";
  const isManual = input.facilityId === PICKUP_MANUAL_LOCATION_VALUE;

  let facilityName = "";
  if (!isManual && input.facilityId && input.provinceCode && input.district) {
    const provinceIdValue = getProvinceIdByCode(input.provinceCode);
    if (provinceIdValue) {
      const facilities = getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(input.district));
      facilityName = facilities.find((facility) => facility.id === input.facilityId)?.name ?? "";
    }
  }

  return {
    province,
    workLocationType: isManual ? input.customFacilityName.trim() : facilityName,
    facilityId: isManual ? "" : input.facilityId,
    addressText: input.addressText,
    locationMode: isManual ? "custom" : "catalog",
  };
}

/**
 * Bir hizmetin ham Nakliye "Teslim Edilecek Yer" state'ini (il KODU, ilçe,
 * tesis-ya-da-manuel seçimi, manuel tesis adı) createJob/createJobsForOperation'a
 * gönderilecek son hâline (il ADI, çözümlenmiş/manuel tesis adı, "facility"/
 * "open_address" yöntemi) indirger — kategori isTransportationCategory
 * kapsamı dışındaysa hepsi boş döner (job-store.ts#resolveDeliveryLocationFields
 * zaten aynı korumayı uygular, burada erken/temiz bir payload üretmek
 * içindir, bkz. resolveProductInfoPayload/resolveCustomsBrokerageServicePayload
 * ile AYNI desen). Manuel moddaki GERÇEK ad (deliveryOtherFacilityText)
 * deliveryFacilityName'e yazılır (pickup'ın workLocationType'ıyla AYNI ilke,
 * bkz. resolveNakliyePickupPayload) ve açık adres artık seçilen yönteme
 * bakılmaksızın HER ZAMAN taşınır (bkz. görev tanımı madde 2/3). Tüm alanlar
 * `string` döner (asla `undefined`) — hem `ServiceItemFields`in (doğrulama)
 * hem createJob/createJobsForOperation girdisinin (job-store.ts kendi içinde
 * boş string'i "yok" olarak yorumlar) ihtiyacını TEK bir fonksiyonla karşılar.
 */
function resolveDeliveryLocationPayload(service: ServiceEntry): {
  deliveryProvince: string;
  deliveryDistrict: string;
  deliveryLocationType: "facility" | "open_address" | "";
  deliveryFacilityId: string;
  deliveryFacilityName: string;
  deliveryAddressText: string;
} {
  if (!isTransportationCategory(service.category)) {
    return {
      deliveryProvince: "",
      deliveryDistrict: "",
      deliveryLocationType: "",
      deliveryFacilityId: "",
      deliveryFacilityName: "",
      deliveryAddressText: "",
    };
  }

  const deliveryProvince = getProvinces().find((province) => province.code === service.deliveryProvinceCode)?.name ?? "";
  const isManual = service.deliveryFacilityId === DELIVERY_MANUAL_LOCATION_VALUE;
  const deliveryLocationType: "facility" | "open_address" | "" = !service.deliveryFacilityId
    ? ""
    : isManual
      ? "open_address"
      : "facility";

  let deliveryFacilityName = "";
  if (!isManual && service.deliveryFacilityId && service.deliveryProvinceCode && service.deliveryDistrict) {
    const provinceIdValue = getProvinceIdByCode(service.deliveryProvinceCode);
    if (provinceIdValue) {
      const facilities = getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(service.deliveryDistrict));
      deliveryFacilityName = facilities.find((facility) => facility.id === service.deliveryFacilityId)?.name ?? "";
    }
  }

  return {
    deliveryProvince,
    deliveryDistrict: service.deliveryDistrict,
    deliveryLocationType,
    deliveryFacilityId: isManual ? "" : service.deliveryFacilityId,
    deliveryFacilityName: isManual ? service.deliveryOtherFacilityText.trim() : deliveryFacilityName,
    deliveryAddressText: service.deliveryAddressText,
  };
}

/**
 * `resolveProductInfoPayload` ile AYNI desen — Gümrük Müşavirliği'ne özel
 * alanlar için. `customsProductType`, diğer hizmetlerin `productType`'ıyla
 * AYNI katalog+sentinel çözümlemesini kullanır: "Listede Yok, Kendim
 * Gireceğim" seçiliyken gerçek metin `customsProductTypeCustomText`'ten
 * alınır — sentinel'in kendisi hiçbir zaman Job.customsProductType olarak
 * kaydedilmez (bkz. resolveProductInfoPayload'daki AYNI kural).
 */
function resolveCustomsBrokerageServicePayload(service: ServiceEntry) {
  if (!isCustomsBrokerageCategory(service.category)) return {};
  const resolvedCustomsProductType =
    service.customsProductType === PRODUCT_TYPE_CUSTOM_VALUE
      ? service.customsProductTypeCustomText.trim()
      : service.customsProductType.trim();
  return {
    customsTransactionType: service.customsTransactionType || undefined,
    customsRequestedServices: service.customsRequestedServices.length > 0 ? service.customsRequestedServices : undefined,
    customsProductType: resolvedCustomsProductType || undefined,
    customsDocuments: service.customsDocuments,
  };
}

/**
 * `resolveCustomsBrokerageServicePayload` ile AYNI desen — Geri Dönüşüm &
 * Atık Tahliye'ye özel alanlar için. KASITLI OLARAK bir "işlem türü" alanı
 * YOK (bkz. recycling-fields.tsx başlığındaki gerekçe).
 */
function resolveRecyclingServicePayload(service: ServiceEntry) {
  if (!isRecyclingCategory(service.category)) return {};
  const quantityResult = parseRecyclingQuantity(service.recyclingQuantity);
  return {
    recyclingMaterialCategoryId: service.recyclingMaterialCategoryId || undefined,
    recyclingMaterialSubtypeId: service.recyclingMaterialSubtypeId || undefined,
    recyclingQuantity: quantityResult.ok ? quantityResult.value : undefined,
    recyclingUnit: isWasteQuantityUnit(service.recyclingUnit) ? service.recyclingUnit : undefined,
    recyclingMaterialCondition: isRecyclingMaterialCondition(service.recyclingMaterialCondition)
      ? service.recyclingMaterialCondition
      : undefined,
    recyclingMaterialConditionNote:
      service.recyclingMaterialCondition === "diger" ? service.recyclingMaterialConditionNote.trim() || undefined : undefined,
    recyclingScopeOfWork: service.recyclingScopeOfWork.length > 0 ? service.recyclingScopeOfWork : undefined,
    recyclingRequestedOperation: service.recyclingRequestedOperation || undefined,
    recyclingWasteCode: service.recyclingWasteCodeUnknown ? undefined : service.recyclingWasteCode || undefined,
    recyclingWasteCodeUnknown: service.recyclingWasteCodeUnknown,
    // NOT: recyclingHazardous BİLEREK burada gönderilmiyor — job-store.ts#resolveRecyclingFields
    // bunu HER ZAMAN resmi atık kodundan yeniden türetir, forma/istemciye asla güvenmez.
    recyclingHazardProperties: service.recyclingHazardProperties.length > 0 ? service.recyclingHazardProperties : undefined,
  };
}

/**
 * `resolveRecyclingServicePayload` ile AYNI desen — Depolama'ya özel
 * "Depolanacak Ürün Bilgileri" için. `storageProductType`,
 * `resolveCustomsBrokerageServicePayload`in `customsProductType`'ıyla AYNI
 * katalog+sentinel çözümlemesini kullanır.
 *
 * "Konteyner Depolama" BİLEREK AYRI bir dal: bu kategoride "Depolanacak
 * Ürün Bilgileri" kartı hiç gösterilmez, storageProductType/Quantity/Unit/
 * Tonnage HİÇ KULLANILMAZ (bir ilan birden fazla konteyner grubu
 * taşıyabildiği için TEK değerli bu alanlar yetersiz — bkz. storage-
 * container-catalog.ts'in kendi başlık dokümanındaki 3. tasarım notu) —
 * aşağıdaki genel çözümleme (farklı ayrıştırma/doğrulama kuralları taşır)
 * burada ÇALIŞTIRILMAZ, tüm konteyner verisi `storageContainerGroups`
 * dizisinden `fromStorageContainerGroupsFields`e devredilir.
 */
function resolveStorageProductServicePayload(service: ServiceEntry) {
  if (!isStorageOnlyLocationCategory(service.category)) return {};
  if (isContainerStorageCategory(service.category)) {
    return { storageContainerGroups: fromStorageContainerGroupsFields(service.storageContainerGroups) };
  }
  // NOT: `parseProductQuantity` DEĞİL — o yalnızca pozitif TAM SAYI kabul
  // eder ("Ürün Adedi" içindir), ama Depolama'nın Miktar'ı birime (kg/ton/adet)
  // bağlı olarak ondalıklı da olabilir (ör. "4,5 ton") — bkz.
  // job-form-validation.ts#validateStorageProductFields'daki AYNI seçim
  // (doğrulayıcı ile bu çözümleyici FARKLI parser kullanırsa, doğrulamadan
  // geçen bir değer burada sessizce undefined'a düşebilirdi).
  const quantityResult = parseProductTonnage(service.storageProductQuantity);
  const tonnageRaw = service.storageProductTonnage.trim();
  const tonnageResult = tonnageRaw.length > 0 ? parseProductTonnage(service.storageProductTonnage) : null;
  const resolvedStorageProductType =
    service.storageProductType === PRODUCT_TYPE_CUSTOM_VALUE
      ? service.storageProductTypeCustomText.trim()
      : service.storageProductType.trim();
  return {
    storageProductType: resolvedStorageProductType || undefined,
    storageProductQuantity: quantityResult.ok ? quantityResult.value : undefined,
    storageProductUnit: isRecyclingUnit(service.storageProductUnit) ? service.storageProductUnit : undefined,
    storageProductTonnage: tonnageResult?.ok ? tonnageResult.value : undefined,
  };
}

/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi —
 * `resolveStorageProductServicePayload` İLE AYNI desen, AYRI bir fonksiyon
 * (iki alan grubu BAĞIMSIZ — bu iki kategoride HER İKİSİ de gösterilir,
 * biri diğerinin YERİNE geçmez). Tehlikeli Madde Depolama'da soru hiç
 * sorulmadığı için `storageHazardous` her zaman `true` gönderilir (job-
 * store.ts#resolveStorageHazardFields zaten AYNI kuralı ikinci/sunucu
 * tarafı güvenlik ağı olarak uygular — burası yalnızca formun kendi görünen
 * davranışını yansıtır).
 */
function resolveStorageHazardServicePayload(service: ServiceEntry) {
  if (!isHazardousStorageCategory(service.category)) return {};
  const hazardous = isTehlikeliMaddeDepolamaCategory(service.category) || service.storageHazardous === "evet";
  return {
    storageHazardous: hazardous,
    storageRiskGroups: hazardous && service.storageRiskGroups.length > 0 ? service.storageRiskGroups : undefined,
  };
}

/**
 * "Nakliye Çoklu Yük Grubu" görevi — Nakliye'nin TÜM "Yük Bilgileri"
 * payload'unu (createJob/createJobsForOperation'ın productQuantity/
 * productTonnage/productTonnageUnit/productType/nakliyeDetails/
 * nakliyeCargoGroups anahtarlarının HEPSİ) TEK yerden üretir — Nakliye DIŞI
 * kategorilerde hiçbir anahtar döndürmez (bu durumda resolveProductInfoPayload'ın
 * kendi payı geçerli kalır, nakliyeDetails/nakliyeCargoGroups hiç gönderilmez).
 * Gerçek grup dizisi (`fromCargoGroupsFields`) HER ZAMAN gönderilir;
 * productQuantity/productTonnage/productTonnageUnit/productType VE
 * nakliyeDetails.loadPreparationType/measurementInfo/containerTransport, İLK
 * grubun bir KOPYASI olarak "aynalanır" (bkz. nakliye-cargo-groups.ts#
 * deriveLegacyMirrorFields üstündeki doküman) — cargo-groups-farkında
 * OLMAYAN eski okuyucular (job-listing-row.ts vb.) en azından ilk grubu
 * doğru göstermeye devam eder. Araç Tercihi (vehiclePreference) yalnızca en
 * az bir grup normal (Hayır) modundaysa korunur — TÜM gruplar Evet
 * (konteyner) modundaysa formda kalmış eski bir değer bile olsa payload'a
 * asla sızmaz (bkz. job-form-validation.ts#NakliyeDetailsFieldsForValidation.
 * anyCargoGroupIsNormalMode İLE AYNI gerekçe/eşik).
 */
function resolveNakliyeYukBilgileriPayload(service: ServiceEntry): {
  productQuantity?: number;
  productTonnage?: number;
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
  nakliyeDetails?: NakliyeDetails;
  nakliyeCargoGroups?: NakliyeCargoGroup[];
} {
  if (!isTransportationCategory(service.category)) return {};
  const cargoGroups = fromCargoGroupsFields(service.nakliyeCargoGroups);
  const mirror = deriveLegacyMirrorFields(cargoGroups);
  const showVehiclePreference = cargoGroups.some((group) => group.containerTransport.status !== "evet");
  const baseDetails = fromNakliyeDetailsFields(service.nakliyeDetails);
  return {
    productQuantity: mirror.productQuantity,
    productTonnage: mirror.productTonnage,
    productTonnageUnit: mirror.productTonnageUnit,
    productType: mirror.productType,
    nakliyeDetails: {
      ...baseDetails,
      vehiclePreference: showVehiclePreference ? baseDetails.vehiclePreference : undefined,
      loadPreparationType: mirror.nakliyeLoadPreparationType,
      loadPreparationCustomText: mirror.nakliyeLoadPreparationCustomText,
      measurementInfo: mirror.nakliyeMeasurementInfo,
      containerTransport: mirror.nakliyeContainerTransport,
      hazmat: mirror.nakliyeHazmat,
    },
    nakliyeCargoGroups: cargoGroups,
  };
}


export function JobRequestForm() {
  const session = useSession();
  const router = useRouter();

  const photosId = useId();
  // Başlangıç/bitiş tarihi alanlarının `min` değeri — jobs.ts#getTodayLocalDateString
  // KASITLI olarak `toISOString().slice(0, 10)` yerine kullanılır, o çağrı
  // negatif UTC ofsetli kullanıcılar için günün ilerleyen saatlerinde YARININ
  // tarihini döndürebilirdi (bkz. o fonksiyonun dokümanı).
  const todayLocalDate = getTodayLocalDateString();

  const [services, setServices] = useState<ServiceEntry[]>(() => [createEmptyServiceEntry()]);
  const [serviceErrors, setServiceErrors] = useState<Record<string, ServiceItemErrors>>({});
  // Nakliye'nin Araç Tercihi/Yükün Hazırlanış Biçimi/Yükleme Yöntemi/Özel
  // Taşıma Koşulları hataları (nakliyeErrors) BİLEREK `serviceErrors`in
  // DIŞINDA, PARALEL bir yapıda tutulur — mevcut `ServiceItemErrors`/
  // `validateServiceItem` tipini/gövdesini genişletmek yerine (zaten büyük,
  // riskli bir yüzey), `localId`ye göre anahtarlanır, `serviceErrors` İLE
  // AYNI "kart başına hata nesnesi" ilkesini izler.
  const [nakliyeErrors, setNakliyeErrors] = useState<Record<string, NakliyeDetailsErrors>>({});
  // "Nakliye Çoklu Yük Grubu" görevi — eski TEK karta ait `measurementErrors`
  // yerine geçti: her Yük Grubu artık kendi ürün/konteyner/ölçü hatalarını
  // KENDİ `id`sine göre anahtarlanmış bir alt nesnede taşır (bkz. job-form-
  // validation.ts#validateNakliyeCargoGroups), bu yüzden ANAHTARLAMA iki
  // seviyeli: önce hizmetin `localId`si, sonra grubun kendi `id`si.
  const [cargoGroupErrors, setCargoGroupErrors] = useState<Record<string, Record<string, NakliyeCargoGroupErrors>>>({});
  // "Operasyon Detayları" form alanı kaldırıldı (bkz. görev tanımı) — bu
  // artık kullanıcı tarafından hiç değiştirilemeyen sabit bir değer, yalnızca
  // createJob/createJobsForOperation'ın hâlâ zorunlu kıldığı alanı doldurmak
  // için tutulur (bkz. job-form-validation.ts#SharedOperationFields üstündeki
  // AYNI doküman).
  const operationDetails = "";
  const [photos, setPhotos] = useState<ReadyJobPhoto[]>([]);
  const [photosProcessing, setPhotosProcessing] = useState(false);
  // Gümrük Müşavirliği evrakları: "Aynı hizmet birden fazla kez seçilemez"
  // kuralı sayesinde aynı anda en fazla BİR kart Gümrük Müşavirliği
  // olabilir, bu yüzden `photosProcessing` ile AYNI TEK, paylaşılan bayrak
  // yeterlidir (kart başına ayrı bir state gerekmez).
  const [customsDocumentsProcessing, setCustomsDocumentsProcessing] = useState(false);
  const [sharedErrors, setSharedErrors] = useState<SharedOperationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Çoklu Hizmet Operasyonu — Aşama 2.3: "form" (düzenleme) <-> "preview"
  // (Operasyon Önizleme) arasında geçiş yalnızca bu bayrakla yapılır — YENİ
  // BİR ROUTE/SAYFA YOK, aynı bileşen içinde koşullu render. Bu yüzden
  // "Düzenlemeye Dön" hiçbir state'i kaybetmez: services/operationDetails/
  // photos hiç unmount olmadan aynı component'te kalmaya devam eder.
  const [mode, setMode] = useState<"form" | "preview">("form");

  // React state (submitting) yalnızca UI'yi (buton disabled/metin) sürer —
  // aynı JS event-loop turunda art arda iki tıklama, ikisi de state commit
  // edilmeden ÖNCE handlePublish'e ulaşabilir, bu yüzden çift-gönderim
  // koruması BUNA dayanamaz. `submitLockRef` senkron, render'dan bağımsız
  // bir kilit: ilk geçerli çağrıda hemen kapanır, ikinci çağrı state
  // güncellemesini beklemeden bu kilidi görüp döner (bkz. handlePublish).
  const submitLockRef = useRef(false);
  // Kullanıcı createJob()/createJobsForOperation() sonucu beklenirken
  // sayfadan ayrılırsa component unmount olabilir; bu durumda await sonrası
  // setSubmitting/setSubmitError çağrısı React'in "unmounted component'te
  // state güncelleme" uyarısını tetikler. isMountedRef bunu engeller.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Türkiye Geneli İl/İlçe: Nakliye DIŞINDAKİ hizmetlerin PAYLAŞILAN
  // (operasyon-geneli, her kartın kendi ilçesi bu tek İl'e göre hesaplanır)
  // İl'i artık serbestçe seçilebilir — Kocaeli yalnızca başlangıç
  // varsayılanıdır, kilitli/readonly DEĞİLDİR (bkz. görev tanımı madde 1).
  // Nakliye'nin KENDİ İl'i bundan tamamen bağımsızdır ve zaten serbestçe
  // seçilebilir (bkz. ServiceEntry.provinceCode/NakliyeLocationFields) —
  // BU state hiçbir Nakliye kartını etkilemez/etkilenmez.
  const [provinceCode, setProvinceCode] = useState(() => getProvinceCodeByName(FIXED_PROVINCE_LABEL) ?? "");
  const provinceName = getProvinces().find((item) => item.code === provinceCode)?.name ?? "";

  const provinceOptions = useMemo(
    () => getProvinces().map((province) => ({ value: province.code, label: province.name })),
    [],
  );

  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  /**
   * Bölge/Tesis: seçilen il+ilçe kapsamındaki TÜM tesis türleri tek listede
   * sunulur (bkz. job-location.ts). Her hizmet kartı KENDİ ilçesine göre bu
   * listeyi ayrı ayrı hesaplar (dizi dinamik olduğu için üst seviye
   * `useMemo` kullanılamaz, bkz. React hook kuralları) — küçük veri
   * kümesi üzerinde basit bir filtre olduğu için performans kaygısı yoktur.
   * Nakliye DIŞINDAKİ kategoriler için hâlâ sabit Kocaeli koduyla çalışır —
   * DEĞİŞMEDİ.
   */
  const getFacilitiesForDistrict = useCallback(
    (districtName: string): Facility[] => {
      if (!provinceCode || !districtName) return [];
      const provinceIdValue = getProvinceIdByCode(provinceCode);
      if (!provinceIdValue) return [];
      return getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(districtName));
    },
    [provinceCode],
  );

  /** Bir konumun "Bölge / Tesis" GÖRÜNEN adı — katalogdan seçilmiş bir tesisin gerçek adı, ya da özel modda kullanıcının yazdığı metin. Nakliye DIŞINDAKİ kategoriler için — DEĞİŞMEDİ. */
  const resolveWorkLocationTypeValue = useCallback(
    (location: ServiceLocation): string => {
      if (location.facilityId === FACILITY_FREE_TEXT_VALUE) return location.otherFacilityText.trim();
      const facilities = getFacilitiesForDistrict(location.district);
      return facilities.find((facility) => facility.id === location.facilityId)?.name ?? "";
    },
    [getFacilitiesForDistrict],
  );

  // `services`in GÜNCEL değerini, handlePhotosChange'in kararlılığını
  // (aşağıdaki AYNI "KARARLI TUTULMASI ZORUNLU" gerekçesi) bozmadan okumak
  // için — job-photo-upload.tsx#itemsRef ile AYNI desen.
  const servicesRef = useRef(services);
  useEffect(() => {
    servicesRef.current = services;
  });

  // useCallback İLE KARARLI TUTULMASI ZORUNLU: JobPhotoUpload, bu prop'u
  // kendi useEffect'inin bağımlılık dizisinde tutuyor (bkz. job-photo-upload.tsx).
  const handlePhotosChange = useCallback((nextPhotos: ReadyJobPhoto[]) => {
    setPhotos(nextPhotos);
    if (nextPhotos.length >= MIN_PHOTOS) {
      setSharedErrors((current) => {
        if (!("photoCount" in current)) return current;
        const next = { ...current };
        delete next.photoCount;
        return next;
      });
    }
  }, []);

  // Aşama 2.3 önizlemesinde "ilk fotoğraf küçük thumbnail" için — fotoğraflar
  // yeniden yüklenmez, yalnızca zaten işlenmiş `photos[0].blob`'tan tek bir
  // object URL üretilir. `photos` referansı her değiştiğinde eskisi serbest
  // bırakılır (bellek sızıntısı olmasın diye).
  const previewThumbnailUrl = useMemo(() => (photos[0] ? URL.createObjectURL(photos[0].blob) : null), [photos]);
  useEffect(() => {
    return () => {
      if (previewThumbnailUrl) URL.revokeObjectURL(previewThumbnailUrl);
    };
  }, [previewThumbnailUrl]);

  /** Bir kartın PICKUP konum etiketi — Nakliye ise resolveNakliyePickupPayload, değilse LEGACY resolveWorkLocationTypeValue. Önizleme/"Ana hizmetle aynı lokasyon" özet metni İKİSİNDE de kullanılır. */
  function resolvePickupDisplayLabel(service: ServiceEntry, effective: ServiceLocation): string {
    if (isTransportationCategory(service.category)) {
      return resolveNakliyePickupPayload({
        category: service.category,
        provinceCode: effective.provinceCode,
        district: effective.district,
        facilityId: effective.facilityId,
        customFacilityName: effective.otherFacilityText,
        addressText: effective.addressText,
      }).workLocationType;
    }
    return resolveWorkLocationTypeValue(effective);
  }

  function updateService(localId: string, patch: Partial<ServiceEntry>) {
    setServices((current) => current.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  /** Bir hizmet kartının hata durumunu temizler — o kart düzeltildiğinde hemen kalksın diye. */
  function clearServiceFieldError(localId: string, field: keyof ServiceItemErrors) {
    setServiceErrors((current) => {
      const entry = current[localId];
      if (!entry || !(field in entry)) return current;
      const nextEntry = { ...entry };
      delete nextEntry[field];
      const next = { ...current };
      if (Object.keys(nextEntry).length === 0) delete next[localId];
      else next[localId] = nextEntry;
      return next;
    });
  }

  function handleServiceCategoryChange(localId: string, next: string) {
    updateService(localId, { category: next });
    clearServiceFieldError(localId, "category");
  }
  function handleServiceTitleChange(localId: string, next: string) {
    updateService(localId, { title: next });
    clearServiceFieldError(localId, "title");
  }
  function handleServiceDescriptionChange(localId: string, next: string) {
    updateService(localId, { description: next });
    clearServiceFieldError(localId, "description");
  }
  function handleServiceWorkDateChange(localId: string, next: string) {
    updateService(localId, { workDate: next });
    clearServiceFieldError(localId, "workDate");
  }
  function handleServiceWorkEndDateChange(localId: string, next: string) {
    updateService(localId, { workEndDate: next });
    clearServiceFieldError(localId, "workEndDate");
  }
  function handleServiceAddressChange(localId: string, next: string) {
    updateService(localId, { addressText: next });
    clearServiceFieldError(localId, "addressText");
  }
  function handleServiceProductQuantityChange(localId: string, next: string) {
    updateService(localId, { productQuantity: next });
    clearServiceFieldError(localId, "productQuantity");
  }
  function handleServiceProductTonnageChange(localId: string, next: string) {
    updateService(localId, { productTonnage: next });
    clearServiceFieldError(localId, "productTonnage");
  }
  /** Birim değişince sayısal değere HİÇ dokunulmaz — kullanıcı arasında otomatik dönüşüm YAPILMAZ (bkz. görev tanımı). */
  function handleServiceProductTonnageUnitChange(localId: string, next: string) {
    updateService(localId, { productTonnageUnit: next });
    clearServiceFieldError(localId, "productTonnageUnit");
  }
  function handleServiceProductTypeChange(localId: string, next: string) {
    updateService(localId, { productType: next });
    clearServiceFieldError(localId, "productType");
    clearServiceFieldError(localId, "productTypeCustomText");
  }
  function handleServiceProductTypeCustomTextChange(localId: string, next: string) {
    updateService(localId, { productTypeCustomText: next });
    clearServiceFieldError(localId, "productTypeCustomText");
  }
  /** CustomsBrokerageFields'ın tek `onChange(patch)` sözleşmesi — güncellenen her alanın hatasını da aynı anda temizler. */
  function handleServiceCustomsFieldsChange(localId: string, patch: Partial<CustomsBrokerageFieldValues>) {
    updateService(localId, patch);
    for (const field of Object.keys(patch) as (keyof CustomsBrokerageFieldValues)[]) {
      clearServiceFieldError(localId, field);
    }
  }
  /** RecyclingFields'ın tek `onChange(patch)` sözleşmesi — handleServiceCustomsFieldsChange ile AYNI desen. */
  function handleServiceRecyclingFieldsChange(localId: string, patch: Partial<RecyclingFieldValues>) {
    updateService(localId, patch);
    for (const field of Object.keys(patch) as (keyof RecyclingFieldValues)[]) {
      clearServiceFieldError(localId, field);
    }
  }
  /** StorageProductFields'ın tek `onChange(patch)` sözleşmesi — handleServiceRecyclingFieldsChange ile AYNI desen. */
  function handleServiceStorageFieldsChange(localId: string, patch: Partial<StorageProductFieldValues>) {
    updateService(localId, patch);
    for (const field of Object.keys(patch) as (keyof StorageProductFieldValues)[]) {
      clearServiceFieldError(localId, field);
    }
  }
  /** StorageHazardFields'ın tek `onChange(patch)` sözleşmesi — handleServiceStorageFieldsChange İLE AYNI desen. */
  function handleServiceStorageHazardFieldsChange(localId: string, patch: Partial<StorageHazardFieldValues>) {
    updateService(localId, patch);
    for (const field of Object.keys(patch) as (keyof StorageHazardFieldValues)[]) {
      clearServiceFieldError(localId, field);
    }
  }

  /**
   * StorageContainerGroupsFields'ın tek `onChange(nextGroups)` sözleşmesi —
   * diğer hizmete-özel alan gruplarıyla AYNI desen — ama tekil bir `patch`
   * yerine TÜM grup dizisini alır/değiştirir
   * (bkz. storage-container-details-fields.tsx#StorageContainerGroupsFields'ın
   * `onChange(nextGroups)` sözleşmesi). Durum "Dolu"dan "Boş"a değişince
   * içeriği/Tehlikeli Madde=Hayır iken UN/IMO'yu/Tip≠Reefer iken sıcaklık-
   * elektrik alanlarını CANLI temizleme bileşenin kendi onChange'i içinde
   * zaten yapılır, burada ikinci bir temizleme gerekmez. Her değişiklikte
   * bu servisin TÜM grup hatalarını temizler (granüler grup+alan bazlı takip
   * yerine — bir sonraki gönderim denemesi gerçek hataları zaten yeniden
   * üretir); kategori "Konteyner Depolama"dan başka bir değere değiştiğinde
   * gruplar gönderim anında `resolveStorageProductServicePayload`/
   * `resolveStorageProductFields` tarafından temizlenir (diğer tüm
   * hizmete-özel alan gruplarıyla AYNI ilke — bkz. handleServiceCategoryChange).
   */
  function handleServiceContainerGroupsChange(localId: string, nextGroups: StorageContainerGroupFieldValues[]) {
    updateService(localId, { storageContainerGroups: nextGroups });
    setServiceErrors((current) => {
      const entry = current[localId];
      if (!entry?.storageContainerGroupErrors) return current;
      const nextEntry = { ...entry };
      delete nextEntry.storageContainerGroupErrors;
      const next = { ...current };
      if (Object.keys(nextEntry).length === 0) delete next[localId];
      else next[localId] = nextEntry;
      return next;
    });
  }

  /**
   * Nakliye'nin "Yük Alınacak Yer" (pickup) NakliyeLocationFields onChange'i
   * — patch, mevcut/paylaşılan alanlara (province"Code"->provinceCode,
   * district->district, facilityId->facilityId, customFacilityName->
   * otherFacilityText, addressText->addressText) eşlenir. `province`/
   * `district`/`workLocationType` hata anahtarları temizlenir —
   * job-form-validation.ts#validateNakliyeRouteSide'ın "facility modunda
   * seçim eksik" ya da "manuel ad eksik/çok uzun" hatalarının İKİSİ de
   * `workLocationType` altında taşınır (mevcut pickup hata anahtarıyla AYNI),
   * açık adresin KENDİ, AYRI `addressText` hata anahtarı ayrıca temizlenir
   * (bkz. validateJobForm/validateServiceItem).
   */
  function handleServicePickupChange(localId: string, patch: Partial<NakliyeLocationFieldValues>) {
    const mapped: Partial<ServiceEntry> = {};
    if (patch.provinceCode !== undefined) mapped.provinceCode = patch.provinceCode;
    if (patch.district !== undefined) mapped.district = patch.district;
    if (patch.facilityId !== undefined) mapped.facilityId = patch.facilityId;
    if (patch.customFacilityName !== undefined) mapped.otherFacilityText = patch.customFacilityName;
    if (patch.addressText !== undefined) mapped.addressText = patch.addressText;
    updateService(localId, mapped);
    if (patch.provinceCode !== undefined) clearServiceFieldError(localId, "province");
    if (patch.district !== undefined) clearServiceFieldError(localId, "district");
    if (patch.facilityId !== undefined || patch.customFacilityName !== undefined) {
      clearServiceFieldError(localId, "workLocationType");
    }
    if (patch.addressText !== undefined) clearServiceFieldError(localId, "addressText");
  }

  /** NakliyeLocationFields'ın "Teslim Edilecek Yer" için AYNI `onChange(patch)` sözleşmesi — AYNI desen (bkz. handleServiceCustomsFieldsChange). `deliveryFacilityId`/`customFacilityName`in hatası doğrulama tarafında `deliveryLocationType` anahtarı altında taşındığı için o hata burada AYRICA temizlenir; açık adresin KENDİ, AYRI `deliveryAddressText` hata anahtarı ayrıca temizlenir. */
  function handleServiceDeliveryChange(localId: string, patch: Partial<NakliyeLocationFieldValues>) {
    const mapped: Partial<ServiceEntry> = {};
    if (patch.provinceCode !== undefined) mapped.deliveryProvinceCode = patch.provinceCode;
    if (patch.district !== undefined) mapped.deliveryDistrict = patch.district;
    if (patch.facilityId !== undefined) mapped.deliveryFacilityId = patch.facilityId;
    if (patch.customFacilityName !== undefined) mapped.deliveryOtherFacilityText = patch.customFacilityName;
    if (patch.addressText !== undefined) mapped.deliveryAddressText = patch.addressText;
    updateService(localId, mapped);
    if (patch.provinceCode !== undefined) clearServiceFieldError(localId, "deliveryProvince");
    if (patch.district !== undefined) clearServiceFieldError(localId, "deliveryDistrict");
    if (patch.facilityId !== undefined || patch.customFacilityName !== undefined) {
      clearServiceFieldError(localId, "deliveryLocationType");
    }
    if (patch.addressText !== undefined) clearServiceFieldError(localId, "deliveryAddressText");
  }

  /**
   * Türkiye Geneli İl/İlçe — Nakliye DIŞINDAKİ hizmetlerin PAYLAŞILAN İl'i
   * değiştiğinde: eski ile ait olup artık geçersiz kalan TÜM Nakliye dışı
   * kartların İlçe/Liman-Sanayi-OSB/manuel-ad alanları temizlenir; Gümrük
   * Müşavirliği DIŞINDAKİ kartlarda AYRICA Açık Adres de temizlenir (bkz.
   * görev tanımı madde 10 "Açık adres eski konuma taşınmaması için
   * temizlensin") — Gümrük Müşavirliği bu değişiklikten HARİÇ tutulur, kendi
   * eski davranışını (Açık Adres İl/İlçe değişse de temizlenmez) aynen korur
   * (bkz. görev tanımı madde 9/14). Nakliye kartları (kendi bağımsız
   * provinceCode/district'i olan, bkz. NakliyeLocationFields) bu döngüden
   * BİLEREK hariç tutulur, hiç etkilenmez.
   */
  function handleSharedProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setServices((current) =>
      current.map((service) => {
        if (isTransportationCategory(service.category)) return service;
        return {
          ...service,
          district: "",
          facilityId: "",
          otherFacilityText: "",
          addressText: "",
        };
      }),
    );
    for (const service of services) {
      if (isTransportationCategory(service.category)) continue;
      for (const field of ["district", "workLocationType", "addressText"] as const) {
        clearServiceFieldError(service.localId, field);
      }
    }
  }

  // İlçe değiştiğinde: Liman/Sanayi/OSB seçimi, manuel ad VE Açık Adres her
  // zaman temizlenir — Depolama/Gümrük Müşavirliği (bkz.
  // isSimplifiedLocationCategory) kartlarında bu alanlar zaten hiç
  // gösterilmediği/toplanmadığı için bu temizlik onlarda no-op'tur. Yalnızca
  // Nakliye DIŞINDAKİ kategoriler için — Nakliye pickup'ın İlçe değişikliği
  // NakliyeLocationFields kendi içinde, handleServicePickupChange üzerinden
  // yönetir.
  function handleServiceDistrictChange(localId: string, nextDistrict: string) {
    updateService(localId, {
      district: nextDistrict,
      facilityId: "",
      otherFacilityText: "",
      addressText: "",
    });
    for (const field of ["district", "workLocationType", "addressText"] as const) {
      clearServiceFieldError(localId, field);
    }
  }

  /**
   * Katalog↔manuel geçişi (yalnızca "standart" — Nakliye/Depolama/Gümrük
   * Müşavirliği dışındaki — kategorilerin Liman/Sanayi/OSB seçicisinden
   * çağrılır, bkz. aşağıdaki render). Açık Adres HİÇBİR ZAMAN temizlenmez
   * (bkz. görev tanımı madde 4/5/6) — yalnızca manuelden katalog seçimine
   * geçilirken artık anlamsız kalan otherFacilityText temizlenir; katalogdan
   * manuele geçilirken (nextValue === FACILITY_FREE_TEXT_VALUE)
   * otherFacilityText'e dokunulmaz (kullanıcı daha önce yazmışsa kaybolmasın)
   * — nakliye-location-fields.tsx#NakliyeLocationFields'ın
   * handleFacilityChange'İYLE BİREBİR AYNI ilke.
   */
  function handleServiceFacilityChange(localId: string, nextValue: string) {
    if (nextValue === FACILITY_FREE_TEXT_VALUE) {
      updateService(localId, { facilityId: nextValue });
    } else {
      updateService(localId, { facilityId: nextValue, otherFacilityText: "" });
    }
    clearServiceFieldError(localId, "workLocationType");
  }

  /** "Ana hizmetle aynı lokasyon" değiştiğinde, o karta ait konum hataları anlamsız kalır (alan artık gösterilmiyor/kendi konumu değil) — temizlenir. */
  function handleServiceUseMainLocationChange(localId: string, useMain: boolean) {
    updateService(localId, { useMainLocation: useMain });
    for (const field of SERVICE_LOCATION_ERROR_KEYS) clearServiceFieldError(localId, field);
  }

  /**
   * "Ek hizmet ekle" — yeni, boş bir kart ekler. Diğer kartların
   * seçim/tarihlerine/konumuna hiç dokunmaz. Yeni kart, TIKLANDIĞI ANDAKİ
   * birinci (ana) hizmetin Ürün Adedi/Tonaj/Ürün Cinsi (ve seçiliyse özel
   * ürün metni) değerlerini devralır — bkz. görev tanımı. Bu üç/dört alan
   * hep primitif `string` olduğu için kopya, referans paylaşmadan
   * (JS değer semantiği) bağımsızdır: yeni karttaki sonraki bir değişiklik
   * ana hizmeti asla etkilemez, ana hizmetteki sonraki bir değişiklik de
   * daha önce eklenmiş kartları asla etkilemez (yalnızca EKLEME anında,
   * bir kerelik bir kopyadır).
   */
  function handleAddService() {
    setServices((current) => {
      const mainService = current[0];
      const newEntry = createEmptyServiceEntry();
      if (mainService) {
        newEntry.productQuantity = mainService.productQuantity;
        newEntry.productTonnage = mainService.productTonnage;
        newEntry.productType = mainService.productType;
        newEntry.productTypeCustomText = mainService.productTypeCustomText;
      }
      return [...current, newEntry];
    });
  }

  /** İlk (ana) kart HİÇBİR ZAMAN silinemez — bu fonksiyon yalnızca ek kartlar için render edilen butondan çağrılır. Kalan kartların seçim/tarihleri/konumu/sırası DEĞİŞMEZ (bkz. ServiceEntry'nin localId ile, index ile DEĞİL, hedeflenmesi). */
  function handleRemoveService(localId: string) {
    setServices((current) => current.filter((s) => s.localId !== localId));
    setServiceErrors((current) => {
      if (!(localId in current)) return current;
      const next = { ...current };
      delete next[localId];
      return next;
    });
  }

  /** service.localId HARİÇ, o kategoriyi zaten seçmiş BAŞKA kartların id'lerini döndürür — bir kartın kendi mevcut seçimini kendi listesinde devre dışı bırakmamak için. */
  function otherSelectedCategoryIds(currentLocalId: string): Set<string> {
    return new Set(services.filter((s) => s.localId !== currentLocalId && s.category !== "").map((s) => s.category));
  }

  function buildServiceValidationFields(allServices: ServiceEntry[], index: number): ServiceItemFields {
    const service = allServices[index];
    const location = getEffectiveLocation(allServices, index);
    const isTransportation = isTransportationCategory(service.category);
    const pickupPayload = isTransportation
      ? resolveNakliyePickupPayload({
          category: service.category,
          provinceCode: location.provinceCode,
          district: location.district,
          facilityId: location.facilityId,
          customFacilityName: location.otherFacilityText,
          addressText: location.addressText,
        })
      : null;
    const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
    return {
      category: service.category,
      title: service.title,
      description: service.description,
      workDate: service.workDate,
      workEndDate: service.workEndDate,
      province: pickupPayload ? pickupPayload.province : provinceName,
      district: location.district,
      workLocationType: pickupPayload ? pickupPayload.workLocationType : resolveWorkLocationTypeValue(location),
      addressText: pickupPayload ? pickupPayload.addressText : location.addressText,
      locationMode: pickupPayload ? pickupPayload.locationMode : isCustomLocation ? "custom" : "catalog",
      productQuantity: service.productQuantity,
      productTonnage: service.productTonnage,
      productTonnageUnit: service.productTonnageUnit,
      productType: service.productType,
      productTypeCustomText: service.productTypeCustomText,
      customsTransactionType: service.customsTransactionType,
      customsRequestedServices: service.customsRequestedServices,
      customsProductType: service.customsProductType,
      customsProductTypeCustomText: service.customsProductTypeCustomText,
      recyclingMaterialCategoryId: service.recyclingMaterialCategoryId,
      recyclingMaterialSubtypeId: service.recyclingMaterialSubtypeId,
      recyclingQuantity: service.recyclingQuantity,
      recyclingUnit: service.recyclingUnit,
      recyclingMaterialCondition: service.recyclingMaterialCondition,
      recyclingMaterialConditionNote: service.recyclingMaterialConditionNote,
      recyclingScopeOfWork: service.recyclingScopeOfWork,
      recyclingRequestedOperation: service.recyclingRequestedOperation,
      recyclingWasteCode: service.recyclingWasteCode,
      recyclingWasteCodeUnknown: service.recyclingWasteCodeUnknown,
      recyclingHazardProperties: service.recyclingHazardProperties,
      storageProductType: service.storageProductType,
      storageProductTypeCustomText: service.storageProductTypeCustomText,
      storageProductQuantity: service.storageProductQuantity,
      storageProductUnit: service.storageProductUnit,
      storageProductTonnage: service.storageProductTonnage,
      storageContainerGroups: service.storageContainerGroups,
      storageHazardous: service.storageHazardous,
      storageRiskGroups: service.storageRiskGroups,
      ...resolveDeliveryLocationPayload(service),
    };
  }

  /** İlk hatalı/eksik zorunlu paylaşılan (Fotoğraf) alana kaydırır ve odak verir. */
  function focusFirstSharedError(fieldErrors: SharedOperationErrors) {
    if (fieldErrors.photoCount) {
      document.getElementById(photosId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Kart SIRASINA göre ilk hatalı karta (kategori > başlık > açıklama >
   * ürün bilgileri > [Gümrük Müşavirliği/Geri Dönüşüm'e özel alanlar, varsa]
   * > konum > tarihler sırasıyla) kaydırır/odaklar.
   *
   * DÜZELTME (kök neden): `CustomsBrokerageFields`/`RecyclingFields`, tıpkı
   * `NakliyeLocationFields` gibi, kendi DOM id'lerini `${idPrefix}-${alan}`
   * kuralıyla (bkz. `prefixedFieldId`) üretir — `serviceFieldId`in ürettiği
   * `service-${alan}-${localId}` kalıbıyla ASLA eşleşmez. Bu iki alan grubu
   * daha önce (yanlışlıkla) tek, genel `fieldOrder` dizisinin içinde
   * `serviceFieldId` ile aranıyordu; bu yüzden bu iki kategoride bir
   * doğrulama hatası oluştuğunda hedef eleman hiçbir zaman bulunamıyor,
   * kaydırma/odaklama sessizce hiçbir şey yapmıyordu (hata metninin kendisi
   * yine de görünüyordu, yalnızca kaydırma/odak eksikti). Çözüm: bu iki
   * grup, Nakliye'nin pickup/delivery'siyle AYNI idPrefix tabanlı arama
   * deseniyle, kendi AYRI alan listeleriyle kontrol edilir — üçü de artık
   * TEK ortak `prefixedFieldId` yardımcısını kullanır, hiçbir kategoriye
   * özel ayrı bir arama mantığı İCAT EDİLMEDİ. Diğer (genel/prefix'siz)
   * alanların `serviceFieldId` üzerinden aranması ve sırası DEĞİŞMEDİ.
   */
  function focusFirstServiceError(currentServices: ServiceEntry[], errorsByLocalId: Record<string, ServiceItemErrors>) {
    const beforeCategoryFieldsFieldOrder: Exclude<ServiceFieldName, "customFacilityName">[] = [
      "category",
      "title",
      "description",
      "productQuantity",
      "productTonnage",
      "productTonnageUnit",
      "productType",
      "productTypeCustomText",
    ];
    const afterCategoryFieldsFieldOrder: Exclude<ServiceFieldName, "customFacilityName">[] = [
      "district",
      "workLocationType",
      "addressText",
      "workDate",
      "workEndDate",
    ];
    // Bkz. CustomsBrokerageFields'a geçilen `idPrefix={`customs-${service.localId}`}` —
    // bu iki değer BİREBİR aynı kalmalı (yalnızca burada tekrar üretilir).
    const customsFieldOrder: (keyof CustomsBrokerageFieldValues)[] = [
      "customsTransactionType",
      "customsProductType",
      "customsProductTypeCustomText",
    ];
    // Bkz. RecyclingFields'a geçilen `idPrefix={`recycling-${service.localId}`}`.
    const recyclingFieldOrder: (keyof RecyclingFieldValues)[] = [
      "recyclingMaterialCategoryId",
      "recyclingMaterialSubtypeId",
      "recyclingQuantity",
      "recyclingUnit",
      "recyclingMaterialCondition",
      "recyclingMaterialConditionNote",
      "recyclingScopeOfWork",
    ];
    // Bkz. StorageProductFields'a geçilen `idPrefix={`storage-${service.localId}`}`.
    const storageFieldOrder: (keyof StorageProductFieldValues)[] = [
      "storageProductType",
      "storageProductTypeCustomText",
      "storageProductQuantity",
      "storageProductUnit",
      "storageProductTonnage",
    ];
    const deliveryFieldOrder = [
      "deliveryProvince",
      "deliveryDistrict",
      "deliveryLocationType",
      "deliveryAddressText",
    ] as const;
    for (const service of currentServices) {
      const itemErrors = errorsByLocalId[service.localId];
      if (!itemErrors) continue;
      // Nakliye pickup'ının kendi il/ilçe hataları — "province"/"district"
      // anahtarları burada, tarih/başlık gibi diğer alanlarla AYNI kart
      // içinde, workLocationType'tan ÖNCE kontrol edilir.
      if (itemErrors.province) {
        const target = document.getElementById(prefixedFieldId(`service-pickup-${service.localId}`, "province"));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      const beforeField = beforeCategoryFieldsFieldOrder.find((key) => itemErrors[key]);
      if (beforeField) {
        const target = document.getElementById(serviceFieldId(service.localId, beforeField));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      const customsField = customsFieldOrder.find((key) => itemErrors[key]);
      if (customsField) {
        const target = document.getElementById(prefixedFieldId(`customs-${service.localId}`, customsField));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      const recyclingField = recyclingFieldOrder.find((key) => itemErrors[key]);
      if (recyclingField) {
        const target = document.getElementById(prefixedFieldId(`recycling-${service.localId}`, recyclingField));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      const storageField = storageFieldOrder.find((key) => itemErrors[key]);
      if (storageField) {
        const target = document.getElementById(prefixedFieldId(`storage-${service.localId}`, storageField));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      const afterField = afterCategoryFieldsFieldOrder.find((key) => itemErrors[key]);
      if (afterField) {
        const target = document.getElementById(serviceFieldId(service.localId, afterField));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
      // Nakliye "Teslim Edilecek Yer" hataları — bkz. NakliyeLocationFields'ın
      // idPrefix'i ile AYNI id üretim kuralı.
      const deliveryField = deliveryFieldOrder.find((key) => itemErrors[key]);
      if (deliveryField) {
        const suffix =
          deliveryField === "deliveryProvince"
            ? "province"
            : deliveryField === "deliveryDistrict"
              ? "district"
              : deliveryField === "deliveryAddressText"
                ? "addressText"
                : "locationType";
        const target = document.getElementById(prefixedFieldId(`service-delivery-${service.localId}`, suffix));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        return;
      }
    }
  }

  if (!session) {
    return (
      <GuestAccessCard
        pageTitle={PAGE_TITLE}
        pageDescription={PAGE_DESCRIPTION}
        cardTitle="İlan oluşturmak için giriş yapmalısınız."
        cardDescription="Hizmet talebi oluşturmak ve uzman hizmet verenlerden teklif alabilmek için hesabınıza giriş yapın veya yeni bir hesap oluşturun."
        redirectTo="/hizmet-talebi-olustur"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return (
      <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <AuthGateNotice message="Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir." />
      </PageCardShell>
    );
  }

  /** Form gönderimi: HENÜZ HİÇBİR İLAN OLUŞTURULMAZ — yalnızca doğrular ve geçerliyse Operasyon Önizleme'ye (mode="preview") geçer. Gerçek createJob/createJobsForOperation çağrısı yalnızca önizlemenin kendi Yayınla butonundan (handlePublish) yapılır. */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (photosProcessing || customsDocumentsProcessing) return;

    const nextSharedErrors = validateSharedOperationFields({
      operationDetails,
      photoCount: photos.length,
    });

    const duplicateCategoryIds = findDuplicateServiceCategoryIds(services.map((s) => s.category));
    const nextServiceErrors: Record<string, ServiceItemErrors> = {};
    const nextNakliyeErrors: Record<string, NakliyeDetailsErrors> = {};
    const nextCargoGroupErrors: Record<string, Record<string, NakliyeCargoGroupErrors>> = {};
    for (let index = 0; index < services.length; index++) {
      const service = services[index];
      const itemErrors = validateServiceItem(buildServiceValidationFields(services, index));
      // "Ana hizmetle aynı lokasyon" işaretliyse, o kartın KENDİ konum
      // alanları hiç gösterilmez/düzenlenemez — konumla ilgili bir hata
      // varsa (ör. ana hizmetin konumu eksikse) bu zaten ANA HİZMETİN
      // kendi kartında gösterilir; burada yinelenmez.
      if (index > 0 && service.useMainLocation) {
        for (const key of SERVICE_LOCATION_ERROR_KEYS) delete itemErrors[key];
      }
      if (duplicateCategoryIds.has(service.category)) {
        itemErrors.category = "Bu hizmet zaten seçildi.";
      }
      if (Object.keys(itemErrors).length > 0) nextServiceErrors[service.localId] = itemErrors;

      if (isTransportationCategory(service.category)) {
        const showVehiclePreference = service.nakliyeCargoGroups.some((group) => !isNakliyeContainerProductType(group.productType));
        const detailErrors = validateNakliyeDetails({ ...service.nakliyeDetails, anyCargoGroupIsNormalMode: showVehiclePreference });
        if (Object.keys(detailErrors).length > 0) nextNakliyeErrors[service.localId] = detailErrors;

        const cargoGroupsResult = validateNakliyeCargoGroups(service.nakliyeCargoGroups);
        if (cargoGroupsResult.hasErrors) nextCargoGroupErrors[service.localId] = cargoGroupsResult.groupErrors;
      }
    }

    setSharedErrors(nextSharedErrors);
    setServiceErrors(nextServiceErrors);
    setNakliyeErrors(nextNakliyeErrors);
    setCargoGroupErrors(nextCargoGroupErrors);
    setSubmitError(null);

    const hasSharedErrors = Object.keys(nextSharedErrors).length > 0;
    const hasServiceErrors = Object.keys(nextServiceErrors).length > 0;
    const hasNakliyeErrors = Object.keys(nextNakliyeErrors).length > 0 || Object.keys(nextCargoGroupErrors).length > 0;
    if (hasSharedErrors || hasServiceErrors || hasNakliyeErrors) {
      if (hasServiceErrors) focusFirstServiceError(services, nextServiceErrors);
      else if (!hasSharedErrors) {
        // Yük Grubu hataları — daha SPESİFİK/YENİ hedef (kart #2'nin kendisi)
        // — job-üstü Taşıma Koşulları hatalarından (nakliye-details anchor'ı)
        // ÖNCELİKLİDİR, çünkü artık çok daha sık karşılaşılan durum bu.
        const cargoGroupIndex = services.findIndex((s) => nextCargoGroupErrors[s.localId]);
        if (cargoGroupIndex >= 0) {
          document.getElementById(`nakliye-cargo-groups-${services[cargoGroupIndex].localId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          const firstIndex = services.findIndex((s) => nextNakliyeErrors[s.localId]);
          if (firstIndex >= 0) {
            document.getElementById(`nakliye-details-${services[firstIndex].localId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      } else focusFirstSharedError(nextSharedErrors);
      return;
    }

    setMode("preview");
  }

  /** Operasyon Önizleme'nin "Yayınla" butonu — projede createJob/createJobsForOperation'ın İLK KEZ çağrıldığı yer budur. */
  async function handlePublish() {
    // Senkron kilit: state (submitting) commit edilmeden önce gelebilecek
    // ikinci bir çağrıyı da hemen durdurur (bkz. submitLockRef tanımı).
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (services.length === 1) {
        // Tek hizmet: bugünkü davranış BİREBİR korunur — mevcut createJob
        // yolu kullanılır, operationId hiç oluşturulmaz.
        const service = services[0];
        const location = getEffectiveLocation(services, 0);
        const isNakliye = isTransportationCategory(service.category);
        const pickupPayload = isNakliye
          ? resolveNakliyePickupPayload({
              category: service.category,
              provinceCode: location.provinceCode,
              district: location.district,
              facilityId: location.facilityId,
              customFacilityName: location.otherFacilityText,
              addressText: location.addressText,
            })
          : null;
        const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
        const deliveryPayload = resolveDeliveryLocationPayload(service);
        const result = await createJobWithSupabaseSync(session, {
          category: service.category,
          title: service.title,
          description: service.description,
          province: pickupPayload ? pickupPayload.province : provinceName,
          district: location.district,
          workLocationType: pickupPayload ? pickupPayload.workLocationType : resolveWorkLocationTypeValue(location),
          facilityId: pickupPayload ? pickupPayload.facilityId || undefined : isCustomLocation ? undefined : location.facilityId || undefined,
          addressText: pickupPayload ? pickupPayload.addressText : location.addressText,
          locationMode: pickupPayload ? pickupPayload.locationMode : isCustomLocation ? "custom" : "catalog",
          workDate: service.workDate,
          workEndDate: service.workEndDate,
          ...resolveProductInfoPayload(service),
          ...resolveCustomsBrokerageServicePayload(service),
          ...resolveRecyclingServicePayload(service),
          ...resolveStorageProductServicePayload(service),
          ...resolveStorageHazardServicePayload(service),
          ...resolveNakliyeYukBilgileriPayload(service),
          ...deliveryPayload,
          operationDetails,
          photos,
        });

        if (!result.ok) {
          if (isMountedRef.current) setSubmitError(result.error);
          return;
        }

        // Sistem Beslemesi (bkz. supabase-facility-candidates.ts) — ana
        // localStorage yazımı BAŞARILI olduktan SONRA, en-iyi-çaba/bloklamayan
        // aday bildirimi. Yalnızca gerçekten serbest metin girilmiş (custom)
        // tesis adları bildirilir; katalogdan seçilmiş bir tesisin zaten
        // doğrulanmış bir adı vardır, aday değildir.
        const pickupIsCustom = pickupPayload ? pickupPayload.locationMode === "custom" : isCustomLocation;
        if (pickupIsCustom && location.otherFacilityText.trim()) {
          submitFacilityCandidateBestEffort(
            location.otherFacilityText,
            pickupPayload ? pickupPayload.province : provinceName,
            location.district,
            "job_pickup_location",
          );
        }
        if (deliveryPayload.deliveryLocationType === "open_address" && deliveryPayload.deliveryFacilityName.trim()) {
          submitFacilityCandidateBestEffort(
            deliveryPayload.deliveryFacilityName,
            deliveryPayload.deliveryProvince,
            deliveryPayload.deliveryDistrict,
            "job_delivery_location",
          );
        }

        // "Supabase Gerçek Kaynak" görevi — `createJobWithSupabaseSync`
        // (yukarıda çağrıldı) artık Supabase RPC'sini BLOKLAYAN olarak
        // içeriyor: bu satıra yalnızca sunucu kaydı GERÇEKTEN başarılı
        // olduysa ulaşılır (aksi hâlde `result.ok` zaten false döner ve
        // yukarıdaki erken `return` ile formda kalınır). Bu yüzden burada
        // artık ayrı bir senkron denemesi/uyarı bayrağı YOK — ilan bu satıra
        // ulaştığında zaten hem yerelde hem Supabase'te gerçekten var.
        router.push(`/ilanlar/${result.job.id}`);
      } else {
        // Sistem Beslemesi (bkz. supabase-facility-candidates.ts) — RPC
        // gövdesini üreten AYNI map geçişinde, her hizmetin custom pickup/
        // delivery tesis adını da (varsa) ayrı bir listede toplar, RPC
        // başarılı olana kadar HİÇBİRİNİ göndermez (aşağıda, result.ok'tan
        // sonra).
        const pendingCandidates: { rawText: string; province: string; district: string; source: string }[] = [];
        const result = await createJobsForOperationWithSupabaseSync(session, {
          province: provinceName,
          operationDetails,
          photos,
          services: services.map((service, index) => {
            const location = getEffectiveLocation(services, index);
            const isNakliye = isTransportationCategory(service.category);
            const pickupPayload = isNakliye
              ? resolveNakliyePickupPayload({
                  category: service.category,
                  provinceCode: location.provinceCode,
                  district: location.district,
                  facilityId: location.facilityId,
                  customFacilityName: location.otherFacilityText,
                  addressText: location.addressText,
                })
              : null;
            const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
            const deliveryPayload = resolveDeliveryLocationPayload(service);

            const pickupIsCustom = pickupPayload ? pickupPayload.locationMode === "custom" : isCustomLocation;
            if (pickupIsCustom && location.otherFacilityText.trim()) {
              pendingCandidates.push({
                rawText: location.otherFacilityText,
                province: pickupPayload ? pickupPayload.province : provinceName,
                district: location.district,
                source: "job_pickup_location",
              });
            }
            if (deliveryPayload.deliveryLocationType === "open_address" && deliveryPayload.deliveryFacilityName.trim()) {
              pendingCandidates.push({
                rawText: deliveryPayload.deliveryFacilityName,
                province: deliveryPayload.deliveryProvince,
                district: deliveryPayload.deliveryDistrict,
                source: "job_delivery_location",
              });
            }

            return {
              category: service.category,
              title: service.title,
              description: service.description,
              workDate: service.workDate,
              workEndDate: service.workEndDate,
              // Nakliye'nin kendi ili, operasyonun paylaşılan (her zaman
              // Kocaeli) ilinden BAĞIMSIZDIR (bkz. job-store.ts#
              // OperationServiceInput.province) — diğer kardeş hizmetler bu
              // alanı hiç göndermez (undefined), bu durumda job-store.ts
              // paylaşılan `province`yi kullanmaya devam eder.
              province: pickupPayload ? pickupPayload.province || undefined : undefined,
              district: location.district,
              workLocationType: pickupPayload ? pickupPayload.workLocationType : resolveWorkLocationTypeValue(location),
              facilityId: pickupPayload ? pickupPayload.facilityId || undefined : isCustomLocation ? undefined : location.facilityId || undefined,
              addressText: pickupPayload ? pickupPayload.addressText : location.addressText,
              locationMode: pickupPayload ? pickupPayload.locationMode : isCustomLocation ? "custom" : "catalog",
              ...resolveProductInfoPayload(service),
              ...resolveCustomsBrokerageServicePayload(service),
              ...resolveRecyclingServicePayload(service),
              ...resolveStorageProductServicePayload(service),
              ...resolveStorageHazardServicePayload(service),
              ...resolveNakliyeYukBilgileriPayload(service),
              ...deliveryPayload,
            };
          }),
        });

        if (!result.ok) {
          if (isMountedRef.current) setSubmitError(result.error);
          return;
        }

        for (const candidate of pendingCandidates) {
          submitFacilityCandidateBestEffort(candidate.rawText, candidate.province, candidate.district, candidate.source);
        }

        // "Supabase Gerçek Kaynak" görevi — `createJobsForOperationWithSupabaseSync`
        // (yukarıda çağrıldı) `create_operation_with_jobs` RPC'sini BLOKLAYAN
        // olarak içeriyor: bu satıra yalnızca TÜM operasyon sunucuda
        // GERÇEKTEN başarıyla oluştuysa ulaşılır. Ayrı bir senkron uyarısı
        // YOK — operasyon bu satıra ulaştığında zaten hem yerelde hem
        // Supabase'te gerçekten var.
        //
        // Yeni bir operasyon detay sayfası/route YOK — kullanıcı rastgele
        // tek bir ilan detayına değil, kendi ilanlarını topluca gördüğü
        // mevcut "Hizmet Taleplerim" sayfasına yönlendirilir. Başarı mesajı,
        // o sayfadaki mevcut "guncellendi=1" (bkz. job-edit-form.tsx) ile
        // AYNI query-param tabanlı banner deseniyle gösterilir (bkz.
        // job-requests-panel.tsx).
        router.push(`/panel/hizmet-taleplerim?operasyonIlanSayisi=${result.jobs.length}`);
      }
    } finally {
      // createJob()/createJobsForOperation() beklenmedik şekilde reddedilse/
      // hata fırlatsa bile kilit burada mutlaka açılır — takılı kalmaz.
      submitLockRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  // Depolama (Depo Hizmetleri grubunun TAMAMI) TEK hizmet olarak
  // gönderildiğinde buton metni "İlanı Onaya Gönder" olur — bkz. görev
  // tanımı. Diğer TÜM kategoriler (ve çok-hizmetli operasyonlar, Depolama
  // içerseler bile) mevcut "İlanı Yayınla" metnini AYNEN korur; bu buton
  // gerçek moderasyon durumunu (her yeni ilan zaten "pending_review" başlar,
  // bkz. job-store.ts) DEĞİŞTİRMEZ, yalnızca Depolama'ya özel metni gösterir.
  const isSingleStorageSubmission = services.length === 1 && isStorageOnlyLocationCategory(services[0].category);
  // Nakliye Yeniden Tasarımı görevi (görsel düzeltme turu) — paylaşılan
  // Fotoğraflar bölümü yalnızca operasyondaki HER hizmet Nakliye ise 7
  // numaralı SectionCard görünümüne geçer; karışık/diğer kategori
  // operasyonlarında (ör. Depolama + Nakliye) eski, sarmalanmamış görünüm
  // AYNEN korunur — "diğer hizmetlere dokunma" kuralı bu şekilde tutulur.
  const isNakliyeOnlyOperation = services.every((service) => isTransportationCategory(service.category));
  // "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi — paylaşılan
  // Fotoğraflar kartı per-service map'in DIŞINDA olduğu için kendi numarasını
  // ana (ilk) hizmetin Konteyner Taşıması durumuna göre hesaplar (bu formun
  // "paylaşılan alanlar ana hizmeti izler" kuralıyla AYNI ilke — bkz.
  // mainLocationLabel). Çok-Nakliye-servisli bir operasyonda servisler
  // arasında Konteyner durumu farklı olabilir; bu, yalnızca bu TEK paylaşılan
  // kartın numarası için bir yaklaşımdır, her servisin KENDİ Araç Tercihi
  // görünürlüğü hâlâ bağımsız olarak `showVehiclePreference` ile yönetilir.
  const nakliyeSharedShowsVehiclePreference =
    services[0]?.nakliyeCargoGroups.some((group) => !isNakliyeContainerProductType(group.productType)) ?? true;
  const nakliyePhotosCardNumber = nakliyeSharedShowsVehiclePreference ? 6 : 5;
  const publishLabel = isSingleStorageSubmission
    ? "İlanı Onaya Gönder"
    : services.length === 1
      ? "İlanı Yayınla"
      : `${services.length} Hizmet İlanını Yayınla`;
  const summaryLabel = services.length === 1 ? "1 Hizmet İlanı Yayınlanacak" : `${services.length} Hizmet İlanı Yayınlanacak`;

  if (mode === "preview") {
    return (
      <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-xl font-bold tracking-heading leading-tight text-foreground">Operasyon Özeti</h2>
            <p className="mt-2 text-sm text-muted-foreground">Toplam oluşturulacak ilan:</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{summaryLabel}</p>
          </div>

          {photos.length > 0 && (
            <div className="flex items-center gap-3">
              {previewThumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewThumbnailUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              {photos.length > 1 && (
                <span className="text-sm font-medium text-muted-foreground">+{photos.length - 1}</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4">
            {services.map((service, index) => {
              const location = getEffectiveLocation(services, index);
              const categoryLabel = getServiceCategoryLabel(service.category) ?? service.category;
              const locationLabel = resolvePickupDisplayLabel(service, location);
              const isNakliye = isTransportationCategory(service.category);
              const deliveryPayload = isNakliye ? resolveDeliveryLocationPayload(service) : null;
              return (
                <div key={service.localId} className="rounded-card border border-border bg-surface p-4">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {index === 0 ? "Ana Hizmet" : "Ek Hizmet"}
                  </span>
                  <h3 className="mt-1 text-base font-bold tracking-heading leading-tight text-foreground">{service.title}</h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Hizmet Türü</dt>
                      <dd className="text-sm text-foreground">{categoryLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">İlçe</dt>
                      <dd className="text-sm text-foreground">
                        {/* Depolama/Gümrük Müşavirliği'nin Tesis/Lokasyon satırı hiç yok
                            (bkz. aşağıdaki isSimplifiedLocationCategory dalı) — bu iki
                            kategoride il adı burada, ilçenin yanında gösterilir; diğer
                            kategorilerde il zaten Tesis/Lokasyon satırının kendisinden
                            (facility adı ya da açık adres) anlaşılır. */}
                        {isSimplifiedLocationCategory(service.category)
                          ? `${location.district} / ${provinceName}`
                          : location.district}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Başlangıç Tarihi</dt>
                      <dd className="text-sm text-foreground">{formatJobDate(service.workDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Bitiş Tarihi</dt>
                      <dd className="text-sm text-foreground">{formatJobDate(service.workEndDate)}</dd>
                    </div>
                    {!isSimplifiedLocationCategory(service.category) && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground">Tesis / Lokasyon</dt>
                        <dd className="text-sm text-foreground">{locationLabel}</dd>
                      </div>
                    )}
                    {isTransportationCategory(service.category) ? (
                      // "Nakliye Çoklu Yük Grubu" görevi — Nakliye'nin Ürün
                      // Adedi/Ağırlık/Cinsi artık `service.productQuantity`/vb.
                      // (Nakliye için hiç kullanılmayan, eski üst seviye
                      // alanlar) DEĞİL, HER Yük Grubu'nun kendi kopyasında.
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-medium text-muted-foreground">Yük Bilgileri</dt>
                        <dd className="text-sm text-foreground">
                          <ul className="flex flex-col gap-1">
                            {service.nakliyeCargoGroups.map((group, groupIndex) => {
                              const isGroupContainerMode = isNakliyeContainerProductType(group.productType);
                              const groupTonnageResult = parseProductTonnage(group.productTonnage);
                              if (isGroupContainerMode) {
                                return (
                                  <li key={group.id}>
                                    <span className="font-medium">Yük Grubu {groupIndex + 1}:</span> Konteyner Taşıması
                                    {group.containerQuantity ? ` • ${group.containerQuantity} adet` : ""}
                                    {group.containerLoadStatus === "dolu" ? " • Dolu" : group.containerLoadStatus === "bos" ? " • Boş" : ""}
                                    {groupTonnageResult.ok
                                      ? ` • ${formatProductTonnage(groupTonnageResult.value, isProductTonnageUnit(group.productTonnageUnit) ? group.productTonnageUnit : undefined)}`
                                      : ""}
                                  </li>
                                );
                              }
                              const quantityResult = parseProductQuantity(group.productQuantity);
                              const tonnageResult = groupTonnageResult;
                              const productLabel =
                                (group.productType === PRODUCT_TYPE_CUSTOM_VALUE ? group.productTypeCustomText : group.productType) || "-";
                              return (
                                <li key={group.id}>
                                  <span className="font-medium">Yük Grubu {groupIndex + 1}:</span> {productLabel}
                                  {quantityResult.ok ? ` • ${formatProductQuantity(quantityResult.value)}` : ""}
                                  {tonnageResult.ok
                                    ? ` • ${formatProductTonnage(tonnageResult.value, isProductTonnageUnit(group.productTonnageUnit) ? group.productTonnageUnit : undefined)}`
                                    : ""}
                                </li>
                              );
                            })}
                          </ul>
                        </dd>
                      </div>
                    ) : (
                      requiresProductInfo(service.category) && (
                        <>
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground">Ürün Adedi</dt>
                            <dd className="text-sm text-foreground">
                              {(() => {
                                const quantityResult = parseProductQuantity(service.productQuantity);
                                return quantityResult.ok ? formatProductQuantity(quantityResult.value) : "-";
                              })()}
                            </dd>
                          </div>
                          {(() => {
                            const tonnageResult = parseProductTonnage(service.productTonnage);
                            if (!tonnageResult.ok) return null;
                            return (
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">Tonaj</dt>
                                <dd className="text-sm text-foreground">{formatProductTonnage(tonnageResult.value)}</dd>
                              </div>
                            );
                          })()}
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground">Ürün Cinsi</dt>
                            <dd className="text-sm text-foreground">
                              {/* DÜZELTME (Y1, veritabanı geçişi öncesi denetim): "Listede Yok,
                                  Kendim Gireceğim" seçilince ham sentinel değer (PRODUCT_TYPE_CUSTOM_VALUE)
                                  değil, kullanıcının girdiği özel metin gösterilir — Gümrük
                                  Müşavirliği bloğundaki (aşağıda) AYNI ternary deseni. */}
                              {(service.productType === PRODUCT_TYPE_CUSTOM_VALUE
                                ? service.productTypeCustomText
                                : service.productType) || "-"}
                            </dd>
                          </div>
                        </>
                      )
                    )}
                    {isCustomsBrokerageCategory(service.category) && (
                      <>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">İşlem Türü</dt>
                          <dd className="text-sm text-foreground">
                            {getCustomsTransactionTypeLabel(service.customsTransactionType) ?? "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Ürün Cinsi</dt>
                          <dd className="text-sm text-foreground">
                            {(service.customsProductType === PRODUCT_TYPE_CUSTOM_VALUE
                              ? service.customsProductTypeCustomText
                              : service.customsProductType) || "-"}
                          </dd>
                        </div>
                        {service.customsRequestedServices.length > 0 && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-muted-foreground">Talep Edilen Hizmetler</dt>
                            <dd className="text-sm text-foreground">
                              {getCustomsRequestedServiceLabels(service.customsRequestedServices).join(", ")}
                            </dd>
                          </div>
                        )}
                      </>
                    )}
                    {isRecyclingCategory(service.category) && (
                      <>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Talep Edilen İşlem</dt>
                          <dd className="text-sm text-foreground">
                            {getRecyclingRequestedOperationLabel(service.recyclingRequestedOperation) ?? "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Atık Türü</dt>
                          <dd className="text-sm text-foreground">
                            {getRecyclingMaterialTypeLabel(service.recyclingMaterialCategoryId) ?? "-"}
                            {(() => {
                              const detail = getRecyclingMaterialTypeDetailLine(
                                service.recyclingMaterialCategoryId,
                                service.recyclingMaterialSubtypeId,
                              );
                              return detail ? ` — ${detail}` : "";
                            })()}
                          </dd>
                        </div>
                        {service.recyclingWasteCodeUnknown ? (
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground">Atık Kodu</dt>
                            <dd className="text-sm text-warning">Bilinmiyor — admin incelemesi bekleniyor</dd>
                          </div>
                        ) : service.recyclingWasteCode ? (
                          <>
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground">Atık Kodu</dt>
                              <dd className="text-sm text-foreground">
                                {formatWasteCodeForDisplay(service.recyclingWasteCode)}
                                {getWasteCodeEntry(service.recyclingWasteCode)
                                  ? ` — ${getWasteCodeEntry(service.recyclingWasteCode)!.description}`
                                  : ""}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground">Tehlike Durumu</dt>
                              <dd className="text-sm font-medium text-foreground">
                                {deriveWasteCodeHazardous(service.recyclingWasteCode) ? "Tehlikeli" : "Tehlikesiz"}
                              </dd>
                            </div>
                            {service.recyclingHazardProperties.length > 0 && (
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-muted-foreground">Tehlike Özelliği</dt>
                                <dd className="text-sm text-foreground">
                                  {service.recyclingHazardProperties.map((id) => getWasteHazardPropertyLabel(id) ?? id).join(", ")}
                                </dd>
                              </div>
                            )}
                          </>
                        ) : null}
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Tahmini Miktar</dt>
                          <dd className="text-sm text-foreground">
                            {(() => {
                              const quantityResult = parseRecyclingQuantity(service.recyclingQuantity);
                              return quantityResult.ok && service.recyclingUnit
                                ? formatRecyclingQuantity(quantityResult.value, service.recyclingUnit)
                                : "-";
                            })()}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Malzeme Durumu</dt>
                          <dd className="text-sm text-foreground">
                            {getRecyclingMaterialConditionLabel(service.recyclingMaterialCondition) ?? "-"}
                          </dd>
                        </div>
                        {service.recyclingScopeOfWork.length > 0 && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-muted-foreground">Hizmet Kapsamı</dt>
                            <dd className="text-sm text-foreground">
                              {getRecyclingScopeOfWorkLabels(service.recyclingScopeOfWork).join(", ")}
                            </dd>
                          </div>
                        )}
                      </>
                    )}
                    {isStorageOnlyLocationCategory(service.category) && (
                      <>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Ürün Cinsi</dt>
                          <dd className="text-sm text-foreground">
                            {(service.storageProductType === PRODUCT_TYPE_CUSTOM_VALUE
                              ? service.storageProductTypeCustomText
                              : service.storageProductType) || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Miktar</dt>
                          <dd className="text-sm text-foreground">
                            {(() => {
                              const quantityResult = parseProductTonnage(service.storageProductQuantity);
                              return quantityResult.ok && service.storageProductUnit
                                ? formatRecyclingQuantity(quantityResult.value, service.storageProductUnit)
                                : "-";
                            })()}
                          </dd>
                        </div>
                        {(() => {
                          const tonnageResult = parseProductTonnage(service.storageProductTonnage);
                          if (!tonnageResult.ok) return null;
                          return (
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground">Toplam Tonaj</dt>
                              <dd className="text-sm text-foreground">{formatProductTonnage(tonnageResult.value)}</dd>
                            </div>
                          );
                        })()}
                      </>
                    )}
                    {isNakliye && deliveryPayload ? (
                      <>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Yük Alınacak Yer</dt>
                          <dd className="text-sm text-foreground">
                            {location.district} / {resolveNakliyePickupPayload({
                              category: service.category,
                              provinceCode: location.provinceCode,
                              district: location.district,
                              facilityId: location.facilityId,
                              customFacilityName: location.otherFacilityText,
                              addressText: location.addressText,
                            }).province}
                            {" • "}
                            {locationLabel}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Teslim Edilecek Yer</dt>
                          <dd className="text-sm text-foreground">
                            {deliveryPayload.deliveryDistrict} / {deliveryPayload.deliveryProvince}
                            {" • "}
                            {deliveryPayload.deliveryLocationType === "open_address"
                              ? deliveryPayload.deliveryAddressText
                              : deliveryPayload.deliveryFacilityName}
                          </dd>
                        </div>
                      </>
                    ) : (
                      !isSimplifiedLocationCategory(service.category) && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Adres</dt>
                          <dd className="text-sm text-foreground">{location.addressText}</dd>
                        </div>
                      )
                    )}
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium text-muted-foreground">Hizmete Özel Açıklama</dt>
                      <dd className="whitespace-pre-wrap text-sm text-foreground">{service.description}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-danger">
              {submitError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => setMode("form")}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Düzenlemeye Dön
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
              {submitting ? "İlan oluşturuluyor..." : publishLabel}
            </button>
          </div>
          {isSingleStorageSubmission && (
            <p className="text-right text-xs text-muted-foreground">İlanınız admin onayından sonra yayımlanacaktır.</p>
          )}
        </div>
      </PageCardShell>
    );
  }

  return (
    <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {services.map((service, index) => {
          const itemErrors = serviceErrors[service.localId] ?? {};
          const itemNakliyeErrors = nakliyeErrors[service.localId] ?? {};
          const disabledCategoryIds = otherSelectedCategoryIds(service.localId);
          const isMain = index === 0;
          const isStorageCard = isStorageOnlyLocationCategory(service.category);
          const usingMainLocation = !isMain && service.useMainLocation && !isStorageCard;
          const location = getEffectiveLocation(services, index);
          const isCustomLocationForCard = location.facilityId === FACILITY_FREE_TEXT_VALUE;
          // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği artık AYNI sade
          // konum modelini paylaşır — yalnızca İl/İlçe, Liman/Sanayi/OSB ve
          // Açık Adres hiç gösterilmez (bkz. job-location.ts#
          // isSimplifiedLocationCategory).
          const isSimplifiedLocationCard = isSimplifiedLocationCategory(service.category);
          const cardFacilities = getFacilitiesForDistrict(service.district);
          const cardFacilityOptions = toFacilitySelectOptions(cardFacilities, STANDARD_MANUAL_FACILITY_OPTION_LABEL);
          const mainLocationLabel = resolvePickupDisplayLabel(services[0], services[0] ? getEffectiveLocation(services, 0) : location);
          const isNakliyeCard = isTransportationCategory(service.category);

          const categoryFieldId = serviceFieldId(service.localId, "category");
          const titleFieldId = serviceFieldId(service.localId, "title");
          const descriptionFieldId = serviceFieldId(service.localId, "description");
          const workDateFieldId = serviceFieldId(service.localId, "workDate");
          const workEndDateFieldId = serviceFieldId(service.localId, "workEndDate");
          const provinceFieldId = `service-province-${service.localId}`;
          const districtFieldId = serviceFieldId(service.localId, "district");
          const workLocationTypeFieldId = serviceFieldId(service.localId, "workLocationType");
          const customFacilityNameFieldId = serviceFieldId(service.localId, "customFacilityName");
          const addressTextFieldId = serviceFieldId(service.localId, "addressText");
          const productQuantityFieldId = serviceFieldId(service.localId, "productQuantity");
          const productTonnageFieldId = serviceFieldId(service.localId, "productTonnage");
          const productTypeFieldId = serviceFieldId(service.localId, "productType");
          const productTypeCustomTextFieldId = serviceFieldId(service.localId, "productTypeCustomText");
          const showProductFields = requiresProductInfo(service.category);
          const tonnageRequiredForCard = isTonnageRequired(service.category);

          if (isNakliyeCard) {
            const nakliyeDetails = service.nakliyeDetails;
            // "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük
            // Cinsi'ne Taşındı" görevleri — job seviyesindeki nakliyeDetails
            // artık YALNIZCA Araç Tercihi/Yükleme Yöntemi taşır
            // (loadPreparationType/measurement/containerTransport/hazmat
            // tamamen Yük Grubu'na taşındı), bu yüzden dal-değişimine bağlı
            // BİDİRECTİONAL temizleme mantığına burada artık gerek YOK — o
            // mantık artık nakliye-cargo-group-fields.tsx#NakliyeCargoGroupCard'ın
            // KENDİ handleProductTypeChange'inde, grup başına uygulanır.
            const patchNakliyeDetails = (patch: Partial<NakliyeDetailsFieldValues>) => {
              updateService(service.localId, { nakliyeDetails: { ...nakliyeDetails, ...patch } });
            };
            const itemCargoGroupErrors = cargoGroupErrors[service.localId] ?? {};
            // "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi hâlâ
            // geçerli — ama artık TÜM Yük Gruplarına bakar: en az bir grup
            // hâlâ normal (Hayır) modundaysa Araç Tercihi gösterilir (bkz.
            // job-form-validation.ts#NakliyeDetailsFieldsForValidation.
            // anyCargoGroupIsNormalMode üstündeki AYNI gerekçe).
            const showVehiclePreference = service.nakliyeCargoGroups.some((group) => !isNakliyeContainerProductType(group.productType));
            // Bölüm numaraları hem Konteyner hem Araç Tercihi görünürlüğüne
            // göre kesintisiz yeniden hesaplanır — görev talimatı: "Sonraki
            // numaralı bölümleri ... ardışık biçimde yeniden numaralandır"
            // ve "bölüm numarası boşluğu veya atlama oluşmasın." Eskiden
            // ayrı bir "3 — Tehlikeli Madde / ADR" kartı vardı ("Konteyner
            // Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" göreviyle TAMAMEN
            // kaldırıldı, ADR artık her Yük Grubu'nun kendi kartının altında)
            // — bu yüzden sonraki TÜM numaralar bir kayar.
            const shipmentPlanCardNumber = 3;
            const vehiclePreferenceCardNumber = 4;
            const yuklemeTeslimatCardNumber = showVehiclePreference ? 5 : 4;
            const removeButton = !isMain && (
              <button
                type="button"
                onClick={() => handleRemoveService(service.localId)}
                aria-label="Bu hizmeti kaldır"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Kaldır
              </button>
            );
            return (
              <div key={service.localId} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {isMain ? "Ana Hizmet" : "Ek Hizmet"}
                  </span>
                  {removeButton}
                </div>

                <NakliyeSectionCard number={1} title="Temel Bilgiler">
                  <div className="grid gap-4 sm:grid-cols-10">
                    <div className="sm:col-span-3">
                      <label htmlFor={categoryFieldId} className="text-sm font-medium text-foreground">
                        Hizmet Kategorisi
                      </label>
                      <select
                        id={categoryFieldId}
                        value={service.category}
                        onChange={(event) => handleServiceCategoryChange(service.localId, event.target.value)}
                        aria-invalid={itemErrors.category ? true : undefined}
                        aria-describedby={itemErrors.category ? `${categoryFieldId}-error` : undefined}
                        className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          itemErrors.category ? "border-danger" : "border-border"
                        }`}
                      >
                        <option value="">Kategori seçiniz</option>
                        {SERVICE_CATEGORY_GROUPS.map((group) => (
                          <optgroup key={group.id} label={group.label}>
                            {group.categories.map((item) => (
                              <option key={item.id} value={item.id} disabled={disabledCategoryIds.has(item.id)}>
                                {item.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {itemErrors.category && (
                        <p id={`${categoryFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.category}
                        </p>
                      )}
                    </div>
                    <div className="sm:col-span-7">
                      <div className="flex items-baseline justify-between gap-3">
                        <label htmlFor={titleFieldId} className="text-sm font-medium text-foreground">
                          İlan Başlığı
                        </label>
                        <span className="text-xs text-muted-foreground">{service.title.length} / 80</span>
                      </div>
                      <input
                        id={titleFieldId}
                        type="text"
                        value={service.title}
                        onChange={(event) => handleServiceTitleChange(service.localId, event.target.value)}
                        maxLength={80}
                        aria-invalid={itemErrors.title ? true : undefined}
                        aria-describedby={itemErrors.title ? `${titleFieldId}-error` : undefined}
                        placeholder="Örnek: Gebze'deki Sahadan Depoya Paletli Yük Nakliyesi"
                        className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          itemErrors.title ? "border-danger" : "border-border"
                        }`}
                      />
                      {itemErrors.title && (
                        <p id={`${titleFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.title}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <label htmlFor={descriptionFieldId} className="text-sm font-medium text-foreground">
                      Hizmete Özel Açıklama
                    </label>
                    <textarea
                      id={descriptionFieldId}
                      value={service.description}
                      onChange={(event) => handleServiceDescriptionChange(service.localId, event.target.value)}
                      maxLength={1000}
                      rows={3}
                      aria-invalid={itemErrors.description ? true : undefined}
                      aria-describedby={itemErrors.description ? `${descriptionFieldId}-error` : undefined}
                      placeholder="Bu hizmete özel iş kapsamını ve beklentilerinizi açıklayın."
                      className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        itemErrors.description ? "border-danger" : "border-border"
                      }`}
                    />
                    {itemErrors.description ? (
                      <p id={`${descriptionFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.description}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Başlık ve açıklamaya firma/tesis adı, açık adres, telefon veya e-posta yazmayın — bu bilgiler
                        yalnızca teklif kabul edildikten sonra paylaşılabilir.
                      </p>
                    )}
                  </div>
                </NakliyeSectionCard>

                <NakliyeSectionCard number={2} title="Yük Bilgileri">
                  <div id={`nakliye-cargo-groups-${service.localId}`}>
                    <NakliyeCargoGroupsFields
                      idPrefix={`nakliye-cargo-${service.localId}`}
                      groups={service.nakliyeCargoGroups}
                      errors={itemCargoGroupErrors}
                      onChange={(nextGroups) => updateService(service.localId, { nakliyeCargoGroups: nextGroups })}
                    />
                  </div>
                </NakliyeSectionCard>

                <NakliyeSectionCard number={shipmentPlanCardNumber} title="Taşıma Planı">
                  <div id={`nakliye-details-${service.localId}`}>
                    <ShipmentPlanFields
                      idPrefix={`nakliye-plan-${service.localId}`}
                      workDate={service.workDate}
                      workEndDate={service.workEndDate}
                      onWorkDateChange={(next) => handleServiceWorkDateChange(service.localId, next)}
                      onWorkEndDateChange={(next) => handleServiceWorkEndDateChange(service.localId, next)}
                      workDateError={itemErrors.workDate}
                      workEndDateError={itemErrors.workEndDate}
                      todayLocalDate={todayLocalDate}
                    />
                  </div>
                </NakliyeSectionCard>

                {showVehiclePreference && (
                  <NakliyeSectionCard number={vehiclePreferenceCardNumber} title="Araç Tercihi">
                    <VehiclePreferenceFields idPrefix={`nakliye-vehicle-${service.localId}`} values={nakliyeDetails} onChange={patchNakliyeDetails} />
                    {itemNakliyeErrors.vehiclePreference && (
                      <p className="mt-2 text-sm text-danger">{itemNakliyeErrors.vehiclePreference}</p>
                    )}
                  </NakliyeSectionCard>
                )}

                <NakliyeSectionCard number={yuklemeTeslimatCardNumber} title="Yükleme ve Teslimat">
                  {!isMain && !isStorageCard && (
                    <label className="mb-4 flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={service.useMainLocation}
                        onChange={(event) => handleServiceUseMainLocationChange(service.localId, event.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      Ana hizmetle aynı lokasyon
                    </label>
                  )}
                  {usingMainLocation ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Bu hizmet, ana hizmetin lokasyonunu kullanacak: {services[0].district || "İlçe seçilmedi"}
                      {mainLocationLabel ? ` / ${mainLocationLabel}` : ""}.
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-md border border-border p-3">
                          <p className="text-sm font-semibold text-foreground">Yükleme (Nereden)</p>
                          <div className="mt-3">
                            <NakliyeLocationFields
                              idPrefix={`service-pickup-${service.localId}`}
                              manualValue={PICKUP_MANUAL_LOCATION_VALUE}
                              values={{
                                provinceCode: service.provinceCode,
                                district: service.district,
                                facilityId: service.facilityId,
                                customFacilityName: service.otherFacilityText,
                                addressText: service.addressText,
                              }}
                              errors={{
                                province: itemErrors.province,
                                district: itemErrors.district,
                                locationType: itemErrors.workLocationType,
                                addressText: itemErrors.addressText,
                              }}
                              onChange={(patch) => handleServicePickupChange(service.localId, patch)}
                            />
                          </div>
                        </div>
                        <div className="rounded-md border border-border p-3">
                          <p className="text-sm font-semibold text-foreground">Teslimat (Nereye)</p>
                          <div className="mt-3">
                            <NakliyeLocationFields
                              idPrefix={`service-delivery-${service.localId}`}
                              manualValue={DELIVERY_MANUAL_LOCATION_VALUE}
                              values={{
                                provinceCode: service.deliveryProvinceCode,
                                district: service.deliveryDistrict,
                                facilityId: service.deliveryFacilityId,
                                customFacilityName: service.deliveryOtherFacilityText,
                                addressText: service.deliveryAddressText,
                              }}
                              errors={{
                                province: itemErrors.deliveryProvince,
                                district: itemErrors.deliveryDistrict,
                                locationType: itemErrors.deliveryLocationType,
                                addressText: itemErrors.deliveryAddressText,
                              }}
                              onChange={(patch) => handleServiceDeliveryChange(service.localId, patch)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <LoadingMethodField idPrefix={`nakliye-loading-${service.localId}`} values={nakliyeDetails} onChange={patchNakliyeDetails} customTextError={itemNakliyeErrors.loadingMethodCustomText} />
                      </div>
                    </>
                  )}
                </NakliyeSectionCard>
              </div>
            );
          }

          return (
            <div key={service.localId} className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isMain ? "Ana Hizmet" : "Ek Hizmet"}
                </span>
                {!isMain && (
                  <button
                    type="button"
                    onClick={() => handleRemoveService(service.localId)}
                    aria-label="Bu hizmeti kaldır"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Kaldır
                  </button>
                )}
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor={categoryFieldId} className="text-sm font-medium text-foreground">
                    Hizmet Kategorisi
                  </label>
                  <select
                    id={categoryFieldId}
                    value={service.category}
                    onChange={(event) => handleServiceCategoryChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.category ? true : undefined}
                    aria-describedby={itemErrors.category ? `${categoryFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.category ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="">Kategori seçiniz</option>
                    {SERVICE_CATEGORY_GROUPS.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.categories.map((item) => (
                          <option key={item.id} value={item.id} disabled={disabledCategoryIds.has(item.id)}>
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {itemErrors.category && (
                    <p id={`${categoryFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.category}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={workDateFieldId} className="text-sm font-medium text-foreground">
                    Başlangıç Tarihi
                  </label>
                  <input
                    id={workDateFieldId}
                    type="date"
                    min={todayLocalDate}
                    value={service.workDate}
                    onChange={(event) => handleServiceWorkDateChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.workDate ? true : undefined}
                    aria-describedby={itemErrors.workDate ? `${workDateFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.workDate ? "border-danger" : "border-border"
                    }`}
                  />
                  {itemErrors.workDate && (
                    <p id={`${workDateFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.workDate}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={workEndDateFieldId} className="text-sm font-medium text-foreground">
                    Bitiş Tarihi
                  </label>
                  <input
                    id={workEndDateFieldId}
                    type="date"
                    min={service.workDate || todayLocalDate}
                    value={service.workEndDate}
                    onChange={(event) => handleServiceWorkEndDateChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.workEndDate ? true : undefined}
                    aria-describedby={itemErrors.workEndDate ? `${workEndDateFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.workEndDate ? "border-danger" : "border-border"
                    }`}
                  />
                  {itemErrors.workEndDate && (
                    <p id={`${workEndDateFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.workEndDate}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                {/*
                  İlan detay sayfası masaüstü tek-ekran yoğunlaştırma
                  görevi (3. tur) — yeni ilanlar için önerilen kısa başlık:
                  input'un `maxLength`'i 150'den 80'e indirildi + sayaç
                  eklendi (mevcut "Teklif Açıklaması"nın `0 / 1000`
                  sayacıyla AYNI desen). BİLEREK yalnızca bu GİRİŞ
                  kısıtlaması değişti — job-form-validation.ts'in paylaşılan
                  150 karakterlik ÜST SINIRI (hem oluşturma hem düzenleme
                  yolunda kullanılıyor) BİLEREK DOKUNULMADI: bunu da 80'e
                  indirmek, 80 karakterden UZUN başlıkla oluşturulmuş eski
                  bir ilanın (bu alana hiç dokunmadan) düzenlenip
                  kaydedilmesini YENİ bir doğrulama hatasıyla engellerdi —
                  "mevcut eski ve daha uzun ilan verilerini... değiştirme"
                  görev kuralını ihlal ederdi. 80, yalnızca YENİ girişler
                  için bir ÖNERİ/yumuşak sınır; sunucu tarafı kural hâlâ 150.
                */}
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={titleFieldId} className="text-sm font-medium text-foreground">
                    İlan Başlığı
                  </label>
                  <span className="text-xs text-muted-foreground">{service.title.length} / 80</span>
                </div>
                <input
                  id={titleFieldId}
                  type="text"
                  value={service.title}
                  onChange={(event) => handleServiceTitleChange(service.localId, event.target.value)}
                  maxLength={80}
                  aria-invalid={itemErrors.title ? true : undefined}
                  aria-describedby={itemErrors.title ? `${titleFieldId}-error` : undefined}
                  placeholder={
                    isContainerStorageCategory(service.category)
                      ? "Örnek: 100 Adet Karışık Ölçülü Konteyner İçin Depolama Talebi"
                      : "Örnek: Gebze'deki Sahadan Depoya Paletli Yük Nakliyesi"
                  }
                  className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    itemErrors.title ? "border-danger" : "border-border"
                  }`}
                />
                {itemErrors.title && (
                  <p id={`${titleFieldId}-error`} className="mt-2 text-sm text-danger">
                    {itemErrors.title}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <label htmlFor={descriptionFieldId} className="text-sm font-medium text-foreground">
                  Hizmete Özel Açıklama
                </label>
                <textarea
                  id={descriptionFieldId}
                  value={service.description}
                  onChange={(event) => handleServiceDescriptionChange(service.localId, event.target.value)}
                  maxLength={1000}
                  rows={3}
                  aria-invalid={itemErrors.description ? true : undefined}
                  aria-describedby={itemErrors.description ? `${descriptionFieldId}-error` : undefined}
                  placeholder="Bu hizmete özel iş kapsamını ve beklentilerinizi açıklayın."
                  className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    itemErrors.description ? "border-danger" : "border-border"
                  }`}
                />
                {itemErrors.description ? (
                  <p id={`${descriptionFieldId}-error`} className="mt-2 text-sm text-danger">
                    {itemErrors.description}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Başlık ve açıklamaya firma/tesis adı, açık adres, telefon veya e-posta yazmayın — bu bilgiler
                    yalnızca teklif kabul edildikten sonra paylaşılabilir.
                  </p>
                )}
              </div>

              {showProductFields && (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor={productQuantityFieldId} className="text-sm font-medium text-foreground">
                      Ürün Adedi
                    </label>
                    <div className="relative mt-2">
                      <input
                        id={productQuantityFieldId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={service.productQuantity}
                        onChange={(event) =>
                          handleServiceProductQuantityChange(
                            service.localId,
                            event.target.value.replace(/[^0-9]/g, ""),
                          )
                        }
                        aria-invalid={itemErrors.productQuantity ? true : undefined}
                        aria-describedby={itemErrors.productQuantity ? `${productQuantityFieldId}-error` : undefined}
                        placeholder="Örn. 120"
                        className={`w-full rounded-md border bg-surface px-4 py-3 pr-14 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          itemErrors.productQuantity ? "border-danger" : "border-border"
                        }`}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
                      >
                        adet
                      </span>
                    </div>
                    {itemErrors.productQuantity && (
                      <p id={`${productQuantityFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.productQuantity}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor={productTonnageFieldId} className="text-sm font-medium text-foreground">
                      {isNakliyeCard ? "Toplam Ağırlık" : "Tonaj"}{" "}
                      {!tonnageRequiredForCard && (
                        <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                      )}
                    </label>
                    {isNakliyeCard ? (
                      // Nakliye: iki parçalı kontrol — sayısal giriş + birim
                      // seçimi (bkz. görev tanımı). Sabit "ton" son eki
                      // KALDIRILDI, yerine erişilebilir bir <select> geldi.
                      // Birim değişince sayısal değere DOKUNULMAZ (otomatik
                      // dönüşüm YOK).
                      <div className="mt-2 flex gap-2">
                        <input
                          id={productTonnageFieldId}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={service.productTonnage}
                          onChange={(event) =>
                            handleServiceProductTonnageChange(
                              service.localId,
                              event.target.value.replace(/[^0-9.,]/g, ""),
                            )
                          }
                          aria-invalid={itemErrors.productTonnage ? true : undefined}
                          aria-describedby={itemErrors.productTonnage ? `${productTonnageFieldId}-error` : undefined}
                          placeholder="Örn. 8,5"
                          className={`w-full min-w-0 flex-1 rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.productTonnage ? "border-danger" : "border-border"
                          }`}
                        />
                        <select
                          id={serviceFieldId(service.localId, "productTonnageUnit")}
                          aria-label="Ağırlık birimi"
                          value={service.productTonnageUnit}
                          onChange={(event) => handleServiceProductTonnageUnitChange(service.localId, event.target.value)}
                          aria-invalid={itemErrors.productTonnageUnit ? true : undefined}
                          aria-describedby={itemErrors.productTonnageUnit ? `${productTonnageFieldId}-unit-error` : undefined}
                          className={`w-24 shrink-0 rounded-md border bg-surface px-2 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.productTonnageUnit ? "border-danger" : "border-border"
                          }`}
                        >
                          {PRODUCT_TONNAGE_UNIT_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="relative mt-2">
                        <input
                          id={productTonnageFieldId}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={service.productTonnage}
                          onChange={(event) =>
                            handleServiceProductTonnageChange(
                              service.localId,
                              event.target.value.replace(/[^0-9.,]/g, ""),
                            )
                          }
                          aria-invalid={itemErrors.productTonnage ? true : undefined}
                          aria-describedby={itemErrors.productTonnage ? `${productTonnageFieldId}-error` : undefined}
                          placeholder="Örn. 8,5"
                          className={`w-full rounded-md border bg-surface px-4 py-3 pr-12 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.productTonnage ? "border-danger" : "border-border"
                          }`}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
                        >
                          ton
                        </span>
                      </div>
                    )}
                    {itemErrors.productTonnage && (
                      <p id={`${productTonnageFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.productTonnage}
                      </p>
                    )}
                    {isNakliyeCard && itemErrors.productTonnageUnit && (
                      <p id={`${productTonnageFieldId}-unit-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.productTonnageUnit}
                      </p>
                    )}
                  </div>

                  {/* Manuel giriş kutusu (bkz. job-edit-form.tsx'teki AYNI gerekçe) dar tek kolona hapsolmasın diye satırın tamamını kaplar. */}
                  <div className={service.productType === PRODUCT_TYPE_CUSTOM_VALUE ? "col-span-full" : undefined}>
                    <ProductTypeCombobox
                      id={productTypeFieldId}
                      label="Ürün Cinsi"
                      value={service.productType}
                      onChange={(next) => handleServiceProductTypeChange(service.localId, next)}
                      customText={service.productTypeCustomText}
                      onCustomTextChange={(next) =>
                        handleServiceProductTypeCustomTextChange(service.localId, next)
                      }
                      customFieldId={productTypeCustomTextFieldId}
                      suggestions={PRODUCT_TYPE_SUGGESTIONS}
                      errorId={itemErrors.productType ? `${productTypeFieldId}-error` : undefined}
                      customTextErrorId={
                        itemErrors.productTypeCustomText ? `${productTypeCustomTextFieldId}-error` : undefined
                      }
                    />
                    {itemErrors.productType && (
                      <p id={`${productTypeFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.productType}
                      </p>
                    )}
                    {itemErrors.productTypeCustomText && (
                      <p id={`${productTypeCustomTextFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.productTypeCustomText}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {isCustomsBrokerageCategory(service.category) && (
                <div className="mt-4 flex flex-col gap-4">
                  <CustomsBrokerageFields
                    idPrefix={`customs-${service.localId}`}
                    values={service}
                    errors={itemErrors}
                    onChange={(patch) => handleServiceCustomsFieldsChange(service.localId, patch)}
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Destekleyici Evraklar <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                    </p>
                    <div className="mt-2">
                      <JobCustomsDocumentUpload
                        onDocumentsChange={(documents) => updateService(service.localId, { customsDocuments: documents })}
                        onBusyChange={setCustomsDocumentsProcessing}
                      />
                    </div>
                  </div>
                </div>
              )}

              {isRecyclingCategory(service.category) && (
                <div className="mt-4">
                  <RecyclingFields
                    idPrefix={`recycling-${service.localId}`}
                    values={service}
                    errors={itemErrors}
                    onChange={(patch) => handleServiceRecyclingFieldsChange(service.localId, patch)}
                  />
                </div>
              )}

              {isStorageCard && !isContainerStorageCategory(service.category) && (
                <div className="mt-4">
                  <StorageProductFields
                    idPrefix={`storage-${service.localId}`}
                    values={service}
                    errors={itemErrors}
                    onChange={(patch) => handleServiceStorageFieldsChange(service.localId, patch)}
                  />
                </div>
              )}

              {isHazardousStorageCategory(service.category) && (
                <div className="mt-4">
                  <StorageHazardFields
                    idPrefix={`storage-hazard-${service.localId}`}
                    category={service.category}
                    values={service}
                    errors={{ storageRiskGroups: itemErrors.storageRiskGroups }}
                    onChange={(patch) => handleServiceStorageHazardFieldsChange(service.localId, patch)}
                  />
                </div>
              )}

              {isContainerStorageCategory(service.category) && (
                <div className="mt-4">
                  <StorageContainerGroupsFields
                    idPrefix={`storage-container-${service.localId}`}
                    groups={service.storageContainerGroups}
                    errors={itemErrors.storageContainerGroupErrors}
                    onChange={(nextGroups) => handleServiceContainerGroupsChange(service.localId, nextGroups)}
                  />
                </div>
              )}

              {!isMain && !isStorageCard && (
                <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={service.useMainLocation}
                    onChange={(event) => handleServiceUseMainLocationChange(service.localId, event.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  Ana hizmetle aynı lokasyon
                </label>
              )}

              {usingMainLocation ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Bu hizmet, ana hizmetin lokasyonunu kullanacak: {services[0].district || "İlçe seçilmedi"}
                  {mainLocationLabel ? ` / ${mainLocationLabel}` : ""}.
                </p>
              ) : isSimplifiedLocationCard ? (
                // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği: lokasyon
                // yalnızca İl/İlçe'dir (bkz. görev tanımı) — Liman/Sanayi/OSB
                // ve Açık Adres hiç render edilmez.
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <SearchableSelect
                      id={provinceFieldId}
                      label="İl"
                      options={provinceOptions}
                      value={provinceCode}
                      onChange={handleSharedProvinceChange}
                      placeholder="İl seçiniz"
                    />
                  </div>

                  <div>
                    <SearchableSelect
                      id={districtFieldId}
                      label="İlçe"
                      options={districtOptions}
                      value={service.district}
                      onChange={(next) => handleServiceDistrictChange(service.localId, next)}
                      placeholder="İlçe seçiniz"
                      disabled={!provinceCode}
                      disabledHint="Önce il seçin"
                      errorId={itemErrors.district ? `${districtFieldId}-error` : undefined}
                    />
                    {itemErrors.district && (
                      <p id={`${districtFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.district}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <SearchableSelect
                        id={provinceFieldId}
                        label="İl"
                        options={provinceOptions}
                        value={provinceCode}
                        onChange={handleSharedProvinceChange}
                        placeholder="İl seçiniz"
                      />
                    </div>

                    <div>
                      <SearchableSelect
                        id={districtFieldId}
                        label="İlçe"
                        options={districtOptions}
                        value={service.district}
                        onChange={(next) => handleServiceDistrictChange(service.localId, next)}
                        placeholder="İlçe seçiniz"
                        disabled={!provinceCode}
                        disabledHint="Önce il seçin"
                        errorId={itemErrors.district ? `${districtFieldId}-error` : undefined}
                      />
                      {itemErrors.district && (
                        <p id={`${districtFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.district}
                        </p>
                      )}
                    </div>

                    <div>
                      <SearchableSelect
                        id={workLocationTypeFieldId}
                        label="Liman / Sanayi / OSB"
                        options={cardFacilityOptions}
                        value={service.facilityId}
                        onChange={(next) => handleServiceFacilityChange(service.localId, next)}
                        placeholder="Liman / Sanayi / OSB seçiniz"
                        disabled={!service.district}
                        disabledHint="Önce ilçe seçin"
                        errorId={itemErrors.workLocationType && !isCustomLocationForCard ? `${workLocationTypeFieldId}-error` : undefined}
                      />
                      {itemErrors.workLocationType && !isCustomLocationForCard && (
                        <p id={`${workLocationTypeFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.workLocationType}
                        </p>
                      )}
                    </div>
                  </div>

                  <ManualFacilityNameField
                    id={customFacilityNameFieldId}
                    value={service.otherFacilityText}
                    onChange={(next) => {
                      updateService(service.localId, { otherFacilityText: next });
                      clearServiceFieldError(service.localId, "workLocationType");
                    }}
                    active={isCustomLocationForCard}
                    error={isCustomLocationForCard ? itemErrors.workLocationType : undefined}
                  />

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor={addressTextFieldId} className="text-sm font-medium text-foreground">
                        Açık Adres
                      </label>
                      <span className="text-xs text-muted-foreground">{service.addressText.trim().length} / {ADDRESS_MAX_LENGTH}</span>
                    </div>
                    <textarea
                      id={addressTextFieldId}
                      value={service.addressText}
                      onChange={(event) => handleServiceAddressChange(service.localId, event.target.value)}
                      maxLength={ADDRESS_MAX_LENGTH}
                      rows={2}
                      aria-invalid={itemErrors.addressText ? true : undefined}
                      aria-describedby={itemErrors.addressText ? `${addressTextFieldId}-error` : undefined}
                      placeholder="Mahalle, cadde/sokak, kapı no ve varsa ilave tarif bilgilerini girin."
                      className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        itemErrors.addressText ? "border-danger" : "border-border"
                      }`}
                    />
                    {itemErrors.addressText && (
                      <p id={`${addressTextFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.addressText}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/*
          Taşıma–Nakliye mükerrerlik bilgilendirmesi (görev tanımı: "Geri
          Dönüşüm Hizmet Kapsamı Sadeleştirmesi", bölüm 6) — BLOKLAMAZ,
          yalnızca bilgilendirir; mevcut çoklu hizmet mimarisine (services
          state'i, createJobsForOperation) ikinci bir kontrol katmanı
          EKLEMEZ. Her iki koşul da AYNI ANDA true olduğunda görünür:
          herhangi bir kart Geri Dönüşüm & Atık Tahliye kategorisinde VE
          kendi "Hizmet Kapsamı"nda "Taşıma"yı seçmiş, VE ayrı bir kart
          zaten Nakliye kategorisinde. Türetilmiş (derived) — ayrı bir
          state TUTULMAZ, `services` her değiştiğinde otomatik yeniden
          hesaplanır.
        */}
        {services.some((s) => isRecyclingCategory(s.category) && s.recyclingScopeOfWork.includes("tasima")) &&
          services.some((s) => isTransportationCategory(s.category)) && (
            <div role="status" className="rounded-md bg-accent-soft px-4 py-3 text-sm text-accent">
              Taşıma işlemi bu hizmetin kapsamına zaten dahil. Ayrı bir Nakliye hizmeti yalnız farklı bir taşıma
              operasyonu için eklenmelidir.
            </div>
          )}

        {isNakliyeOnlyOperation ? (
          <NakliyeSectionCard number={nakliyePhotosCardNumber} title="Fotoğraflar ve Belgeler">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Operasyonun yapılacağı alanı, yükü, ekipmanı veya mevcut saha koşullarını gösteren güncel fotoğraflar
              yükleyin. Fotoğraflar, hizmet verenlerin işi doğru değerlendirmesine yardımcı olacaktır.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Kişisel bilgi, telefon numarası, plaka veya gizli belge içeren fotoğraflar yüklemeyin.
            </p>
            <div className="mt-3">
              <JobPhotoUpload
                role={session.role}
                onPhotosChange={handlePhotosChange}
                onBusyChange={setPhotosProcessing}
                disabled={submitting || photosProcessing}
                errorId={sharedErrors.photoCount ? `${photosId}-error` : undefined}
              />
            </div>
            {sharedErrors.photoCount && (
              <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
                {sharedErrors.photoCount}
              </p>
            )}
          </NakliyeSectionCard>
        ) : (
          <div>
            <p id={photosId} className="text-sm font-medium text-foreground">
              {isSingleStorageSubmission ? "Yük / Ürün Fotoğrafları *" : "Operasyon Fotoğrafları *"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isSingleStorageSubmission
                ? "Depolanacak ürünün/yükün mevcut durumunu, ambalajını ve paketleme koşullarını net şekilde gösteren güncel fotoğraflar yükleyin. Fotoğraflar, hizmet verenlerin depolama koşullarını doğru değerlendirmesine yardımcı olacaktır."
                : "Operasyonun yapılacağı alanı, yükü, ekipmanı veya mevcut saha koşullarını gösteren güncel fotoğraflar yükleyin. Fotoğraflar, hizmet verenlerin işi doğru değerlendirmesine yardımcı olacaktır."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Kişisel bilgi, telefon numarası, plaka veya gizli belge içeren
              fotoğraflar yüklemeyin.
            </p>
            <div className="mt-3">
              <JobPhotoUpload
                role={session.role}
                onPhotosChange={handlePhotosChange}
                onBusyChange={setPhotosProcessing}
                disabled={submitting || photosProcessing}
                errorId={sharedErrors.photoCount ? `${photosId}-error` : undefined}
              />
            </div>
            {sharedErrors.photoCount && (
              <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
                {sharedErrors.photoCount}
              </p>
            )}
          </div>
        )}

        {services[0].category !== "" && (
          <div className="rounded-md border border-dashed border-border p-4">
            <p className="text-sm font-medium text-foreground">
              Bu operasyon için başka bir hizmete ihtiyacınız var mı?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              İsterseniz aynı operasyon için ek hizmet ilanları oluşturabilirsiniz. Her hizmet ayrı ilan
              olarak yayınlanır.
            </p>
            <button
              type="button"
              onClick={handleAddService}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ek hizmet ekle
            </button>
          </div>
        )}
      </div>

      {(Object.keys(sharedErrors).length > 0 || Object.keys(serviceErrors).length > 0) && (
        <p role="alert" className="text-sm font-medium text-danger">
          Lütfen işaretlenen zorunlu alanları tamamlayın.
        </p>
      )}

      <button
        type="submit"
        disabled={photosProcessing || customsDocumentsProcessing}
        aria-disabled={photosProcessing || customsDocumentsProcessing}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {(photosProcessing || customsDocumentsProcessing) && (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {photosProcessing
          ? "Fotoğraflar işleniyor..."
          : customsDocumentsProcessing
            ? "Belgeler işleniyor..."
            : isSingleStorageSubmission
              ? "İlanı Onaya Gönder"
              : "İlanı Yayınla"}
      </button>
      {isSingleStorageSubmission && (
        <p className="-mt-4 text-xs text-muted-foreground">İlanınız admin onayından sonra yayımlanacaktır.</p>
      )}
      </form>
    </PageCardShell>
  );
}
