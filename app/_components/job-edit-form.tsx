"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { isCustomsBrokerageCategory } from "../_lib/customs-brokerage-catalog";
import { ADDRESS_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from "../_lib/field-limits";
import {
  clearJobFormErrors,
  validateJobForm,
  validateNakliyeCargoGroups,
  validateNakliyeDetails,
  type JobFormErrors,
  type NakliyeCargoGroupErrors,
  type NakliyeDetailsErrors,
} from "../_lib/job-form-validation";
import {
  FACILITY_FREE_TEXT_VALUE,
  isSimplifiedLocationCategory,
  STANDARD_MANUAL_FACILITY_OPTION_LABEL,
  toFacilitySelectOptions,
} from "../_lib/job-location";
import { isJobEditable, JOB_NOT_EDITABLE_MESSAGE } from "../_lib/job-requests";
import { getTodayLocalDateString } from "../_lib/jobs";
import { deriveLegacyMirrorFields, getJobCargoGroups } from "../_lib/nakliye-cargo-groups";
import {
  DELIVERY_MANUAL_LOCATION_VALUE,
  isTransportationCategory,
  PICKUP_MANUAL_LOCATION_VALUE,
} from "../_lib/nakliye-route";
import {
  fromCargoGroupsFields,
  isNakliyeContainerProductType,
  toCargoGroupsFields,
  type NakliyeCargoGroupFieldValues,
} from "../_lib/nakliye-transport-catalog";
import { getMaxPhotos } from "../_lib/photo-validation";
import {
  isTonnageRequired,
  parseProductQuantity,
  parseProductTonnage,
  PRODUCT_TYPE_CUSTOM_VALUE,
  PRODUCT_TYPE_SUGGESTIONS,
  requiresProductInfo,
} from "../_lib/product-catalog";
import {
  isRecyclingCategory,
  isRecyclingMaterialCondition,
  isRecyclingUnit,
  isWasteQuantityUnit,
  parseRecyclingQuantity,
  resolveRecyclingScopeOfWorkIds,
} from "../_lib/recycling-catalog";
import { deriveWasteCodeHazardous } from "../_lib/recycling-waste-code-catalog";
import { isStorageOnlyLocationCategory, resolveLegacyJobCategoryToId, SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import { isContainerStorageCategory, normalizeStorageContainerGroupsForDisplay } from "../_lib/storage-container-catalog";
import { isHazardousStorageCategory, isTehlikeliMaddeDepolamaCategory } from "../_lib/storage-hazard-catalog";
import { submitFacilityCandidateBestEffort } from "../_lib/supabase-facility-candidates";
import { updateJobWithSupabaseSync } from "../_lib/supabase-job-sync";
import type { Job, Offer, Session } from "../_lib/types";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceIdByCode,
  getProvinces,
} from "../_lib/turkey-locations";
import { useJobById } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { CustomsBrokerageFields, type CustomsBrokerageFieldValues } from "./customs-brokerage-fields";
import { JobCustomsDocumentEditor } from "./job-customs-document-editor";
import type { ReadyJobCustomsDocument } from "./job-customs-document-upload";
import { JobPhotoEditor } from "./job-photo-editor";
import type { ReadyJobPhoto } from "./job-photo-upload";
import { ManualFacilityNameField } from "./manual-facility-name-field";
import { NakliyeCargoGroupsFields } from "./nakliye-cargo-group-fields";
import { NakliyeLocationFields, type NakliyeLocationFieldValues } from "./nakliye-location-fields";
import { NakliyeSectionCard } from "./nakliye-section-card";
import {
  fromNakliyeDetailsFields,
  LoadingMethodField,
  ShipmentPlanFields,
  toNakliyeDetailsFields,
  VehiclePreferenceFields,
  type NakliyeDetailsFieldValues,
} from "./nakliye-transport-fields";
import { ProductTypeCombobox } from "./product-type-combobox";
import { RecyclingFields, type RecyclingFieldValues } from "./recycling-fields";
import { SearchableSelect } from "./searchable-select";
import { StorageHazardFields, type StorageHazardFieldValues } from "./storage-hazard-fields";
import { StorageProductFields, type StorageProductFieldValues } from "./storage-product-fields";
import {
  fromStorageContainerGroupsFields,
  StorageContainerGroupsFields,
  toStorageContainerGroupsFields,
  type StorageContainerGroupFieldValues,
} from "./storage-container-details-fields";

export function JobEditForm({ jobId }: { jobId: string }) {
  const session = useSession();
  const job = useJobById(jobId);
  const offers = useAllOffers();

  if (!session) {
    return (
      <AuthGateNotice
        message="İlanınızı düzenlemek için giriş yapmalısınız."
        loginRedirect={`/panel/hizmet-taleplerim/${jobId}/duzenle`}
      />
    );
  }

  if (!job) {
    return <AuthGateNotice message="İlan bulunamadı." />;
  }

  if (session.role !== "hizmet-alan" || job.requesterId !== session.id) {
    return <AuthGateNotice message="Bu ilanı düzenleme yetkiniz yok." />;
  }

  // Teklif süreci başlamış (kabul edilmiş/devam eden/tamamlanmış/iptal
  // edilmiş) bir ilan artık düzenlenemez — job-requests-panel.tsx'teki
  // "Düzenle" linkinin görünürlüğü ve job-store.ts#updateJob'daki veri
  // katmanı koruması ile AYNI tek doğruluk kaynağını (isJobEditable)
  // kullanır, bu kural üç yerde ayrı ayrı yazılmaz.
  if (!isJobEditable(job.id, offers)) {
    return <AuthGateNotice message={JOB_NOT_EDITABLE_MESSAGE} />;
  }

  return <JobEditFormFields job={job} session={session} offers={offers} />;
}

function JobEditFormFields({ job, session, offers }: { job: Job; session: Session; offers: Offer[] }) {
  const router = useRouter();

  const categoryId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const provinceId = useId();
  const districtId = useId();
  const workLocationTypeId = useId();
  const customFacilityNameId = useId();
  const addressTextId = useId();
  const workDateId = useId();
  const workEndDateId = useId();
  const productQuantityId = useId();
  const productTonnageId = useId();
  const productTypeId = useId();
  const productTypeCustomTextId = useId();
  const photosId = useId();
  // Başlangıç/bitiş tarihi alanlarının `min` değeri — jobs.ts#getTodayLocalDateString
  // KASITLI olarak `toISOString().slice(0, 10)` yerine kullanılır (bkz. o
  // fonksiyonun dokümanı — UTC kaymasına karşı korumalı).
  const todayLocalDate = getTodayLocalDateString();

  // `job.category` eski (düz Türkçe metin) ya da yeni (katalog id'si)
  // olabilir — aşağıdaki <select>'in artık yalnızca yeni id'leri seçenek
  // olarak sunması nedeniyle, eski bir değer olduğu gibi bırakılırsa
  // hiçbir <option> ile eşleşmez ve seçim "boş" görünürdü. Bu yüzden
  // başlangıç değeri her zaman geçerli bir yeni id'ye (mümkünse) çözülür;
  // eşleşme yoksa (ör. "Depolama") kullanıcı yeni katalogdan açıkça bir
  // kategori seçmek zorunda kalır (bkz. service-catalog.ts#resolveLegacyJobCategoryToId).
  const [category, setCategory] = useState(() => resolveLegacyJobCategoryToId(job.category) ?? "");
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description);
  const [provinceCode, setProvinceCode] = useState(
    () => getProvinces().find((item) => item.name === job.province)?.code ?? "",
  );
  const [district, setDistrict] = useState(job.district);
  // Eski (facilityId'den önce oluşturulmuş) ilanlarda facilityId yoktur ama
  // workLocationType (serbest metin) doludur — bu durumda "Listede yok /
  // Diğer" seçilmiş gibi başlatılır ki kayıtlı değer kaybolmasın.
  const [facilityId, setFacilityId] = useState(
    () => job.facilityId ?? (job.workLocationType ? FACILITY_FREE_TEXT_VALUE : ""),
  );
  const [otherFacilityText, setOtherFacilityText] = useState(() => (job.facilityId ? "" : job.workLocationType));
  const [addressText, setAddressText] = useState(job.addressText ?? "");
  const [workDate, setWorkDate] = useState(job.workDate);
  // Bu alandan önce oluşturulmuş bir ilanda workEndDate hiç yoktur — sahte
  // bir tarih uydurmak yerine form boş başlar, kaydetmek için kullanıcının
  // (mevcut oluşturma akışıyla AYNI kuralla, bkz. job-form-validation.ts#
  // validateWorkDateRange) geçerli bir bitiş tarihi seçmesi gerekir.
  const [workEndDate, setWorkEndDate] = useState(job.workEndDate ?? "");
  const [productQuantity, setProductQuantity] = useState(
    () => (job.productQuantity !== undefined ? String(job.productQuantity) : ""),
  );
  const [productTonnage, setProductTonnage] = useState(
    () => (job.productTonnage !== undefined ? String(job.productTonnage) : ""),
  );
  // Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı. "Nakliye
  // Çoklu Yük Grubu" görevinden sonra bu üst seviye değer artık HİÇBİR
  // formda düzenlenemez (Nakliye'nin kendi birimi her Yük Grubu'nun kendi
  // kopyasındadır) — bu yüzden artık bir `useState` değil, `validateJobForm`'un
  // (Liman Hizmetleri'nde hiçbir zaman anlamlı olmayan) tip sözleşmesini
  // karşılamak için SALT OKUNUR bir sabit.
  const productTonnageUnit: "ton" | "kg" = job.productTonnageUnit === "kg" ? "kg" : "ton";
  // Bu state yalnızca Liman Hizmetleri için render edilir (aşağıdaki JSX
  // `!showDeliveryFields && showProductFields` şartıyla sarılı) — Nakliye
  // artık kendi Ürün/Yük Cinsi'ni HER Yük Grubu'nun kendi kopyasında taşır
  // (bkz. nakliyeCargoGroups state'i), bu üst seviye alan Nakliye için hiç
  // gösterilmez/gönderilmez (bkz. handleSubmit'in showDeliveryFields dalı).
  // "Konteyner" burada (Liman/Depolama bağlamında) sıradan, geçerli bir
  // seçenektir — eski bir "Nakliye'de artık geçersiz" uyarı kutusu ARTIK
  // GEÇERSİZ bir öncüle dayandığı için (Nakliye'nin kendi "Ürün/Yük Cinsi"
  // alanında "Konteyner" artık YENİDEN geçerli/asıl tetikleyici, bkz.
  // nakliye-transport-catalog.ts#isNakliyeContainerProductType) kaldırıldı.
  const [productType, setProductType] = useState(job.productType ?? "");
  // "Listede Yok, Kendim Gireceğim" seçildiğinde gerçek metin burada tutulur
  // (bkz. product-type-combobox.tsx üstündeki doküman) — eski ilanlarda bu
  // alan hep boş başlar, mevcut productType değeri (katalog önerisi olsun ya
  // da olmasın) ProductTypeCombobox'ta serbest metin olarak değişmeden
  // gösterilmeye devam eder, o yüzden burada ayrıca bir "eski değeri özel
  // moda taşı" mantığına gerek yoktur.
  const [productTypeCustomText, setProductTypeCustomText] = useState("");
  const [customsFields, setCustomsFields] = useState<CustomsBrokerageFieldValues>(() => ({
    customsTransactionType: job.customsTransactionType ?? "",
    customsRequestedServices: job.customsRequestedServices ?? [],
    // customsProductType/productType İLE AYNI ilke (bkz. productType üstündeki
    // doküman): eski ilanlarda bu alan hep boş başlar, mevcut customsProductType
    // değeri (katalog önerisi olsun ya da olmasın) ProductTypeCombobox'ta
    // serbest metin olarak değişmeden gösterilmeye devam eder — ayrıca bir
    // "eski değeri özel moda taşı" mantığına gerek yoktur.
    customsProductType: job.customsProductType ?? "",
    customsProductTypeCustomText: "",
  }));
  const [recyclingFields, setRecyclingFields] = useState<RecyclingFieldValues>(() => ({
    recyclingMaterialCategoryId: job.recyclingMaterialCategoryId ?? "",
    recyclingMaterialSubtypeId: job.recyclingMaterialSubtypeId ?? "",
    recyclingQuantity: job.recyclingQuantity !== undefined ? String(job.recyclingQuantity) : "",
    recyclingUnit: job.recyclingUnit ?? "",
    recyclingMaterialCondition: job.recyclingMaterialCondition ?? "",
    recyclingMaterialConditionNote: job.recyclingMaterialConditionNote ?? "",
    recyclingScopeOfWork: resolveRecyclingScopeOfWorkIds(job.recyclingScopeOfWork ?? []),
    recyclingRequestedOperation: job.recyclingRequestedOperation ?? "",
    recyclingWasteCode: job.recyclingWasteCode ?? "",
    recyclingWasteCodeUnknown: job.recyclingWasteCodeUnknown ?? false,
    recyclingHazardProperties: job.recyclingHazardProperties ?? [],
  }));
  // storageProductType/productType İLE AYNI ilke (bkz. productType üstündeki
  // doküman): eski ilanlarda bu alan hep boş başlar, mevcut storageProductType
  // değeri (katalog önerisi olsun ya da olmasın) ProductTypeCombobox'ta
  // serbest metin olarak değişmeden gösterilmeye devam eder.
  const [storageFields, setStorageFields] = useState<StorageProductFieldValues>(() => ({
    storageProductType: job.storageProductType ?? "",
    storageProductTypeCustomText: "",
    storageProductQuantity: job.storageProductQuantity !== undefined ? String(job.storageProductQuantity) : "",
    storageProductUnit: job.storageProductUnit ?? "",
    storageProductTonnage: job.storageProductTonnage !== undefined ? String(job.storageProductTonnage) : "",
  }));
  // "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — eski (bu
  // görevden önce oluşturulmuş) bir ilanda storageHazardous hiç yoktur,
  // "hayir" olarak yorumlanır (görev talimatı: "eski depolama ilanları
  // bozulmadan açılmalı").
  const [storageHazardFields, setStorageHazardFields] = useState<StorageHazardFieldValues>(() => ({
    storageHazardous: job.storageHazardous === true ? "evet" : "hayir",
    storageRiskGroups: job.storageRiskGroups ?? [],
  }));
  // "Konteyner Grupları" — bkz. storage-container-catalog.ts'in tetikleme
  // kuralı dokümanı (yalnızca hizmet türü "Konteyner Depolama").
  // `normalizeStorageContainerGroupsForDisplay` eski (storageContainerGroups'tan
  // ÖNCE oluşturulmuş, DEPRECATED düz alanlı) bir ilanı TEK elemanlı bir
  // gruba yükseltir — "eski tek gruplu ilanlar bozulmamalı" geriye dönük
  // uyumluluk katmanı. Hiç grup yoksa (yeni bir Konteyner Depolama ilanı
  // DEĞİLSE, ya da bu kategoriye SONRADAN geçilirse) TEK boş grupla başlar.
  const [containerGroups, setContainerGroups] = useState<StorageContainerGroupFieldValues[]>(() =>
    toStorageContainerGroupsFields(normalizeStorageContainerGroupsForDisplay(job)),
  );
  // Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer": bu job'dan önceki
  // (deliveryLocationType hiç yoksa) ya da Nakliye dışı ilanlarda boş
  // başlar. `deliveryFacilityId`, DELIVERY_MANUAL_LOCATION_VALUE sentinel'ini
  // (manuel adres modu) ya da gerçek bir Facility.id'yi taşır — pickup'ın
  // PICKUP_MANUAL_LOCATION_VALUE ile AYNI ilke (bkz. NakliyeLocationFields).
  const [deliveryProvinceCode, setDeliveryProvinceCode] = useState(
    () => getProvinces().find((item) => item.name === job.deliveryProvince)?.code ?? "",
  );
  const [deliveryDistrict, setDeliveryDistrict] = useState(job.deliveryDistrict ?? "");
  const [deliveryFacilityId, setDeliveryFacilityId] = useState(
    () => (job.deliveryLocationType === "open_address" ? DELIVERY_MANUAL_LOCATION_VALUE : job.deliveryFacilityId ?? ""),
  );
  // Manuel teslimat modunda kullanıcının serbestçe yazdığı GERÇEK tesis adı —
  // pickup'ın otherFacilityText'iyle AYNI ilke (bkz. o alanın üstündeki
  // doküman): facilityId'siz (manuel) bir kayıtta deliveryFacilityName zaten
  // bu adı taşır (bkz. resolveDeliveryLocationFields), bu yüzden var olan
  // değer kaybolmadan forma yüklenir.
  const [deliveryOtherFacilityText, setDeliveryOtherFacilityText] = useState(
    () => (job.deliveryFacilityId ? "" : job.deliveryFacilityName ?? ""),
  );
  const [deliveryAddressText, setDeliveryAddressText] = useState(job.deliveryAddressText ?? "");
  // Bu görevden ÖNCE oluşturulmuş bir Nakliye ilanında job.nakliyeDetails
  // hiç yoktur; toNakliyeDetailsFields bu durumda boş bir form state üretir
  // ("eski ilanlar bozulmaz" kuralı). Bu obje artık YALNIZCA Araç Tercihi/
  // Yükleme Yöntemi/Tehlikeli Madde-ADR taşır — bkz. "Nakliye Çoklu Yük
  // Grubu" görevi, nakliye-transport-fields.tsx#NakliyeDetailsFieldValues
  // üstündeki doküman.
  const [nakliyeDetails, setNakliyeDetails] = useState<NakliyeDetailsFieldValues>(
    () => toNakliyeDetailsFields(job.nakliyeDetails),
  );
  const [nakliyeErrors, setNakliyeErrors] = useState<NakliyeDetailsErrors>({});
  // "Nakliye Çoklu Yük Grubu" görevi — "2 — Yük Bilgileri" artık TEK değil,
  // bağımsız bir "Yük Grubu" dizisi (bkz. nakliye-transport-catalog.ts#
  // NakliyeCargoGroupFieldValues). `getJobCargoGroups` eski (bu görevden
  // önce kaydedilmiş) tek-gruplu bir ilanı SALT OKUNUR olarak "Yük Grubu 1"
  // olarak sentezler — bu sentez ASLA job'u geriye yazmaz, yalnızca formun
  // başlangıç değeridir (görev talimatı: "eski tek yüklü ilanlar... tek
  // kayıt Yük Grubu 1 olarak okunsun").
  const [nakliyeCargoGroups, setNakliyeCargoGroups] = useState<NakliyeCargoGroupFieldValues[]>(
    () => toCargoGroupsFields(getJobCargoGroups(job)),
  );
  const [cargoGroupErrors, setCargoGroupErrors] = useState<Record<string, NakliyeCargoGroupErrors>>({});
  function patchNakliyeDetails(patch: Partial<NakliyeDetailsFieldValues>) {
    setNakliyeDetails((current) => ({ ...current, ...patch }));
  }
  // "Operasyon Detayları" form alanı kaldırıldı (bkz. görev tanımı) — artık
  // kullanıcı tarafından hiç değiştirilemez, yalnızca eski ilanın mevcut
  // değerini değişmeden updateJob'a geri taşımak için okunur (bkz.
  // job-form-validation.ts#JobFormFields.operationDetails üstündeki AYNI
  // doküman).
  const operationDetails = job.operationDetails;
  const [photoState, setPhotoState] = useState<{ keptPhotoIds: string[]; newPhotos: ReadyJobPhoto[] }>(
    () => ({ keptPhotoIds: job.photos.map((photo) => photo.id), newPhotos: [] }),
  );
  const [photosProcessing, setPhotosProcessing] = useState(false);
  const [customsDocumentState, setCustomsDocumentState] = useState<{
    keptCustomsDocumentIds: string[];
    newCustomsDocuments: ReadyJobCustomsDocument[];
  }>(() => ({ keptCustomsDocumentIds: (job.customsDocuments ?? []).map((doc) => doc.id), newCustomsDocuments: [] }));
  const [customsDocumentsProcessing, setCustomsDocumentsProcessing] = useState(false);
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const provinces = useMemo(() => getProvinces(), []);
  const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";
  const showProductFields = requiresProductInfo(category);
  const tonnageRequired = isTonnageRequired(category);
  const showCustomsFields = isCustomsBrokerageCategory(category);
  const showRecyclingFields = isRecyclingCategory(category);
  const showStorageFields = isStorageOnlyLocationCategory(category);
  const showContainerFields = isContainerStorageCategory(category);
  const showHazardousStorageFields = isHazardousStorageCategory(category);
  const showDeliveryFields = isTransportationCategory(category);
  // "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi hâlâ geçerli —
  // ama artık TÜM Yük Gruplarına bakar: en az bir grup hâlâ normal (Hayır)
  // modundaysa Araç Tercihi gösterilir (bkz. job-form-validation.ts#
  // NakliyeDetailsFieldsForValidation.anyCargoGroupIsNormalMode üstündeki
  // AYNI gerekçe).
  const showNakliyeVehiclePreference = nakliyeCargoGroups.some((group) => !isNakliyeContainerProductType(group.productType));
  // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği artık AYNI sade konum
  // modelini paylaşır — yalnızca İl/İlçe (bkz. job-location.ts#
  // isSimplifiedLocationCategory).
  const showSimplifiedLocation = isSimplifiedLocationCategory(category);

  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  const candidateFacilities = useMemo(() => {
    if (!provinceCode || !district) return [];
    const provinceIdValue = getProvinceIdByCode(provinceCode);
    if (!provinceIdValue) return [];
    return getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(district));
  }, [provinceCode, district]);

  const facilityOptions = useMemo(
    () => toFacilitySelectOptions(candidateFacilities, STANDARD_MANUAL_FACILITY_OPTION_LABEL),
    [candidateFacilities],
  );

  function clearFieldError(field: keyof JobFormErrors) {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /**
   * İl/İlçe değiştiğinde: Liman/Sanayi/OSB seçimi, manuel ad VE Açık Adres
   * her zaman temizlenir — Depolama/Gümrük Müşavirliği'nde (bkz.
   * showSimplifiedLocation) bu alanlar zaten hiç gösterilmediği için bu
   * temizlik onlarda no-op'tur.
   */
  function handleProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setDistrict("");
    setFacilityId("");
    setOtherFacilityText("");
    setAddressText("");
    setErrors((current) => clearJobFormErrors(current, ["province", "district", "workLocationType", "addressText"]));
  }

  function handleDistrictChange(nextDistrict: string) {
    setDistrict(nextDistrict);
    setFacilityId("");
    setOtherFacilityText("");
    setAddressText("");
    setErrors((current) => clearJobFormErrors(current, ["district", "workLocationType", "addressText"]));
  }

  /**
   * Katalog↔manuel geçişi (yalnızca "standart" — Nakliye/Depolama/Gümrük
   * Müşavirliği dışındaki — kategorilerin Liman/Sanayi/OSB seçicisinden
   * çağrılır, bkz. aşağıdaki render). Açık Adres HİÇBİR ZAMAN temizlenmez
   * (bkz. görev tanımı madde 4/5/6) — yalnızca manuelden katalog seçimine
   * geçilirken artık anlamsız kalan otherFacilityText temizlenir; katalogdan
   * manuele geçilirken (nextValue === FACILITY_FREE_TEXT_VALUE)
   * otherFacilityText'e dokunulmaz (kullanıcı daha önce yazmışsa
   * kaybolmasın) — job-request-form.tsx#handleServiceFacilityChange/
   * nakliye-location-fields.tsx İLE BİREBİR AYNI ilke.
   */
  function handleFacilityChange(nextValue: string) {
    setFacilityId(nextValue);
    if (nextValue !== FACILITY_FREE_TEXT_VALUE) setOtherFacilityText("");
    clearFieldError("workLocationType");
  }

  /**
   * NakliyeLocationFields'ın "Yük Alınacak Yer" için `onChange(patch)`
   * sözleşmesi — pickup mevcut/paylaşılan provinceCode/district/facilityId/
   * addressText state'lerine doğrudan yazılır (job-request-form.tsx#
   * resolveNakliyePickupPayload İLE AYNI ilke: pickup için ayrı bir Job alan
   * grubu yok). Bileşenin kendi İl/İlçe değişikliğinde uyguladığı sıfırlama
   * (bkz. nakliye-location-fields.tsx) zaten patch içinde gelir — burada
   * AYRICA bir reset mantığı YOKTUR.
   */
  function handlePickupFieldsChange(patch: Partial<NakliyeLocationFieldValues>) {
    if (patch.provinceCode !== undefined) setProvinceCode(patch.provinceCode);
    if (patch.district !== undefined) setDistrict(patch.district);
    if (patch.facilityId !== undefined) setFacilityId(patch.facilityId);
    if (patch.customFacilityName !== undefined) setOtherFacilityText(patch.customFacilityName);
    if (patch.addressText !== undefined) setAddressText(patch.addressText);
    const clearedKeys: (keyof JobFormErrors)[] = [];
    if (patch.provinceCode !== undefined) clearedKeys.push("province");
    if (patch.district !== undefined) clearedKeys.push("district");
    if (patch.facilityId !== undefined || patch.customFacilityName !== undefined) clearedKeys.push("workLocationType");
    if (patch.addressText !== undefined) clearedKeys.push("addressText");
    if (clearedKeys.length > 0) setErrors((current) => clearJobFormErrors(current, clearedKeys));
  }

  /** NakliyeLocationFields'ın "Teslim Edilecek Yer" için AYNI `onChange(patch)` sözleşmesi — customsFields'ın onChange handler'ıyla AYNI desen. */
  function handleDeliveryFieldsChange(patch: Partial<NakliyeLocationFieldValues>) {
    if (patch.provinceCode !== undefined) setDeliveryProvinceCode(patch.provinceCode);
    if (patch.district !== undefined) setDeliveryDistrict(patch.district);
    if (patch.facilityId !== undefined) setDeliveryFacilityId(patch.facilityId);
    if (patch.customFacilityName !== undefined) setDeliveryOtherFacilityText(patch.customFacilityName);
    if (patch.addressText !== undefined) setDeliveryAddressText(patch.addressText);
    const clearedKeys: (keyof JobFormErrors)[] = [];
    if (patch.provinceCode !== undefined) clearedKeys.push("deliveryProvince");
    if (patch.district !== undefined) clearedKeys.push("deliveryDistrict");
    if (patch.facilityId !== undefined || patch.customFacilityName !== undefined) clearedKeys.push("deliveryLocationType");
    if (patch.addressText !== undefined) clearedKeys.push("deliveryAddressText");
    if (clearedKeys.length > 0) setErrors((current) => clearJobFormErrors(current, clearedKeys));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || photosProcessing || customsDocumentsProcessing) return;

    // `isCustomLocation` (facilityId === FACILITY_FREE_TEXT_VALUE) Nakliye
    // pickup'ının da manuel/açık-adres modu için AYNI sentinel'i kullanır
    // (bkz. nakliye-route.ts#PICKUP_MANUAL_LOCATION_VALUE, FACILITY_FREE_TEXT_VALUE'nin
    // takma adıdır) — bu yüzden tek bir kontrol her iki yol için de geçerlidir.
    const isCustomLocation = facilityId === FACILITY_FREE_TEXT_VALUE;
    const selectedFacility = candidateFacilities.find((facility) => facility.id === facilityId) ?? null;
    // Nakliye'nin manuel modu da (Nakliye DIŞI kategorilerle AYNI) kullanıcının
    // serbestçe yazdığı GERÇEK tesis adını otherFacilityText'ten alır (bkz.
    // NakliyeLocationFields'ın artık gösterdiği "Liman / Sanayi / OSB Adı"
    // input'u) — eski sabit placeholder (PICKUP_MANUAL_WORK_LOCATION_LABEL)
    // KALDIRILDI (bkz. görev tanımı madde 1).
    const workLocationTypeValue = isCustomLocation ? otherFacilityText.trim() : selectedFacility?.name ?? "";
    const locationMode: "catalog" | "custom" = isCustomLocation ? "custom" : "catalog";

    // Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer": ham state'i (il
    // KODU, tesis-ya-da-manuel seçimi, manuel tesis adı) job-request-form.tsx#
    // resolveDeliveryLocationPayload İLE AYNI mantıkla son hâline indirger.
    const isDeliveryManual = deliveryFacilityId === DELIVERY_MANUAL_LOCATION_VALUE;
    const deliveryProvinceName = getProvinces().find((item) => item.code === deliveryProvinceCode)?.name ?? "";
    const deliveryLocationTypeValue: "facility" | "open_address" | "" = !deliveryFacilityId
      ? ""
      : isDeliveryManual
        ? "open_address"
        : "facility";
    let deliveryFacilityName = "";
    if (showDeliveryFields && !isDeliveryManual && deliveryFacilityId && deliveryProvinceCode && deliveryDistrict) {
      const deliveryProvinceIdValue = getProvinceIdByCode(deliveryProvinceCode);
      if (deliveryProvinceIdValue) {
        const deliveryFacilities = getFacilitiesByProvinceAndDistrict(
          deliveryProvinceIdValue,
          getDistrictId(deliveryDistrict),
        );
        deliveryFacilityName = deliveryFacilities.find((facility) => facility.id === deliveryFacilityId)?.name ?? "";
      }
    }

    const photoCount = photoState.keptPhotoIds.length + photoState.newPhotos.length;
    const fieldErrors = validateJobForm({
      category,
      title,
      description,
      province: provinceName,
      district,
      workLocationType: workLocationTypeValue,
      addressText,
      locationMode,
      workDate,
      workEndDate,
      productQuantity,
      productTonnage,
      productTonnageUnit,
      productType,
      productTypeCustomText,
      ...customsFields,
      ...recyclingFields,
      ...storageFields,
      // `storageProductType`/vb. (yukarıdaki `...storageFields`) ile
      // `storageContainerGroups` ARTIK ÇAKIŞMIYOR (Konteyner Depolama bu
      // alanları hiç kullanmıyor) — "hangi kaynak kazanır" sorunu (eski bir
      // sürümde vardı) burada YOKTUR, doğrudan atanabilir.
      storageContainerGroups: containerGroups,
      ...storageHazardFields,
      deliveryProvince: deliveryProvinceName,
      deliveryDistrict,
      deliveryLocationType: deliveryLocationTypeValue,
      deliveryFacilityName: isDeliveryManual ? deliveryOtherFacilityText.trim() : deliveryFacilityName,
      deliveryAddressText,
      operationDetails,
      photoCount,
    });
    setErrors(fieldErrors);
    const nakliyeDetailErrors = showDeliveryFields
      ? validateNakliyeDetails({ ...nakliyeDetails, anyCargoGroupIsNormalMode: showNakliyeVehiclePreference })
      : {};
    setNakliyeErrors(nakliyeDetailErrors);
    const cargoGroupsValidation = showDeliveryFields
      ? validateNakliyeCargoGroups(nakliyeCargoGroups)
      : { groupErrors: {}, hasErrors: false };
    setCargoGroupErrors(cargoGroupsValidation.groupErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0 || Object.keys(nakliyeDetailErrors).length > 0 || cargoGroupsValidation.hasErrors) {
      return;
    }

    // "Nakliye Çoklu Yük Grubu" görevi — Nakliye artık üst seviye
    // productQuantity/productTonnage/productType state'ini hiç kullanmaz
    // (kart hiç göstermez/toplamaz); gerçek Ürün Bilgisi HER Yük Grubu'nun
    // kendi kopyasından, İLK grubun bir "aynası" olarak üretilir (bkz.
    // nakliye-cargo-groups.ts#deriveLegacyMirrorFields üstündeki doküman —
    // job-request-form.tsx#resolveNakliyeYukBilgileriPayload İLE AYNI ilke).
    const nakliyeCargoGroupsPayload = showDeliveryFields ? fromCargoGroupsFields(nakliyeCargoGroups) : undefined;
    const nakliyeMirror = nakliyeCargoGroupsPayload ? deriveLegacyMirrorFields(nakliyeCargoGroupsPayload) : undefined;
    const quantityResult = showProductFields && !showDeliveryFields ? parseProductQuantity(productQuantity) : null;
    const tonnageRaw = productTonnage.trim();
    const tonnageResult = showProductFields && !showDeliveryFields && tonnageRaw.length > 0 ? parseProductTonnage(productTonnage) : null;
    const recyclingQuantityResult = showRecyclingFields ? parseRecyclingQuantity(recyclingFields.recyclingQuantity) : null;
    // NOT: `parseProductQuantity` DEĞİL — bkz. job-request-form.tsx#
    // resolveStorageProductServicePayload üstündeki AYNI gerekçe (Miktar
    // birime bağlı olarak ondalıklı olabilir, doğrulayıcıyla AYNI parser
    // kullanılmalı).
    const storageQuantityResult = showStorageFields ? parseProductTonnage(storageFields.storageProductQuantity) : null;
    const storageTonnageRaw = storageFields.storageProductTonnage.trim();
    const storageTonnageResult =
      showStorageFields && storageTonnageRaw.length > 0 ? parseProductTonnage(storageFields.storageProductTonnage) : null;

    setSubmitting(true);
    const result = await updateJobWithSupabaseSync(
      session,
      job.id,
      {
        title,
        category,
        province: provinceName,
        district,
        workLocationType: workLocationTypeValue,
        facilityId: selectedFacility?.id,
        addressText,
        locationMode,
        workDate,
        workEndDate,
        productQuantity: showDeliveryFields ? nakliyeMirror?.productQuantity : quantityResult?.ok ? quantityResult.value : undefined,
        productTonnage: showDeliveryFields ? nakliyeMirror?.productTonnage : tonnageResult?.ok ? tonnageResult.value : undefined,
        productTonnageUnit: showDeliveryFields ? nakliyeMirror?.productTonnageUnit : undefined,
        productType: showDeliveryFields
          ? nakliyeMirror?.productType
          : showProductFields
            ? (productType === PRODUCT_TYPE_CUSTOM_VALUE ? productTypeCustomText.trim() : productType.trim())
            : undefined,
        customsTransactionType: showCustomsFields ? customsFields.customsTransactionType || undefined : undefined,
        customsRequestedServices:
          showCustomsFields && customsFields.customsRequestedServices.length > 0
            ? customsFields.customsRequestedServices
            : undefined,
        customsProductType: showCustomsFields
          ? (customsFields.customsProductType === PRODUCT_TYPE_CUSTOM_VALUE
              ? customsFields.customsProductTypeCustomText.trim()
              : customsFields.customsProductType.trim()) || undefined
          : undefined,
        recyclingMaterialCategoryId: showRecyclingFields ? recyclingFields.recyclingMaterialCategoryId || undefined : undefined,
        recyclingMaterialSubtypeId: showRecyclingFields ? recyclingFields.recyclingMaterialSubtypeId || undefined : undefined,
        recyclingQuantity: recyclingQuantityResult?.ok ? recyclingQuantityResult.value : undefined,
        recyclingUnit:
          showRecyclingFields && isWasteQuantityUnit(recyclingFields.recyclingUnit) ? recyclingFields.recyclingUnit : undefined,
        recyclingMaterialCondition:
          showRecyclingFields && isRecyclingMaterialCondition(recyclingFields.recyclingMaterialCondition)
            ? recyclingFields.recyclingMaterialCondition
            : undefined,
        recyclingMaterialConditionNote:
          showRecyclingFields && recyclingFields.recyclingMaterialCondition === "diger"
            ? recyclingFields.recyclingMaterialConditionNote.trim() || undefined
            : undefined,
        recyclingScopeOfWork:
          showRecyclingFields && recyclingFields.recyclingScopeOfWork.length > 0
            ? recyclingFields.recyclingScopeOfWork
            : undefined,
        recyclingRequestedOperation: showRecyclingFields
          ? recyclingFields.recyclingRequestedOperation || undefined
          : undefined,
        recyclingWasteCode:
          showRecyclingFields && !recyclingFields.recyclingWasteCodeUnknown
            ? recyclingFields.recyclingWasteCode || undefined
            : undefined,
        recyclingWasteCodeUnknown: showRecyclingFields ? recyclingFields.recyclingWasteCodeUnknown : undefined,
        recyclingHazardous: showRecyclingFields
          ? deriveWasteCodeHazardous(
              recyclingFields.recyclingWasteCodeUnknown ? null : recyclingFields.recyclingWasteCode,
            ) ?? undefined
          : undefined,
        recyclingHazardProperties:
          showRecyclingFields && recyclingFields.recyclingHazardProperties.length > 0
            ? recyclingFields.recyclingHazardProperties
            : undefined,
        storageProductType: showStorageFields && !showContainerFields
          ? (storageFields.storageProductType === PRODUCT_TYPE_CUSTOM_VALUE
              ? storageFields.storageProductTypeCustomText.trim()
              : storageFields.storageProductType.trim()) || undefined
          : undefined,
        storageProductQuantity: !showContainerFields && storageQuantityResult?.ok ? storageQuantityResult.value : undefined,
        storageProductUnit:
          showStorageFields && !showContainerFields && isRecyclingUnit(storageFields.storageProductUnit)
            ? storageFields.storageProductUnit
            : undefined,
        storageProductTonnage: !showContainerFields && storageTonnageResult?.ok ? storageTonnageResult.value : undefined,
        storageContainerGroups: showContainerFields ? fromStorageContainerGroupsFields(containerGroups) : undefined,
        storageHazardous: showHazardousStorageFields
          ? isTehlikeliMaddeDepolamaCategory(category) || storageHazardFields.storageHazardous === "evet"
          : undefined,
        storageRiskGroups:
          showHazardousStorageFields &&
          (isTehlikeliMaddeDepolamaCategory(category) || storageHazardFields.storageHazardous === "evet") &&
          storageHazardFields.storageRiskGroups.length > 0
            ? storageHazardFields.storageRiskGroups
            : undefined,
        deliveryProvince: showDeliveryFields ? deliveryProvinceName || undefined : undefined,
        deliveryDistrict: showDeliveryFields ? deliveryDistrict || undefined : undefined,
        deliveryLocationType: showDeliveryFields ? deliveryLocationTypeValue || undefined : undefined,
        deliveryFacilityId: showDeliveryFields && !isDeliveryManual ? deliveryFacilityId || undefined : undefined,
        deliveryFacilityName: showDeliveryFields
          ? (isDeliveryManual ? deliveryOtherFacilityText.trim() : deliveryFacilityName) || undefined
          : undefined,
        deliveryAddressText: showDeliveryFields ? deliveryAddressText || undefined : undefined,
        nakliyeDetails: showDeliveryFields
          ? {
              ...fromNakliyeDetailsFields(nakliyeDetails),
              vehiclePreference: showNakliyeVehiclePreference ? fromNakliyeDetailsFields(nakliyeDetails).vehiclePreference : undefined,
              loadPreparationType: nakliyeMirror?.nakliyeLoadPreparationType,
              loadPreparationCustomText: nakliyeMirror?.nakliyeLoadPreparationCustomText,
              measurementInfo: nakliyeMirror?.nakliyeMeasurementInfo,
              containerTransport: nakliyeMirror?.nakliyeContainerTransport,
              hazmat: nakliyeMirror?.nakliyeHazmat,
            }
          : undefined,
        nakliyeCargoGroups: nakliyeCargoGroupsPayload,
        description,
        operationDetails,
        keptPhotoIds: photoState.keptPhotoIds,
        newPhotos: photoState.newPhotos,
        keptCustomsDocumentIds: customsDocumentState.keptCustomsDocumentIds,
        newCustomsDocuments: customsDocumentState.newCustomsDocuments,
      },
      offers,
      job,
    );
    setSubmitting(false);

    // "Supabase Gerçek Kaynak" görevi — sıra artık TERS: `updateJobWithSupabaseSync`
    // (job hâlâ "pending_review" ise) gerçek `update_job_as_requester` RPC'sini
    // yerel yazımdan ÖNCE, BLOKLAYARAK çağırır (bkz. o fonksiyonun kendi
    // dokümanı, supabase-job-sync.ts) — bu yüzden `result.ok` ARTIK yalnızca
    // yerel değil, gerçek sunucu başarısını da garanti eder. Sunucu
    // güncellemesi başarısız olursa `result.error` zaten sunucudan gelen
    // gerçek hatadır, form verisi (henüz gönderilmemiş gibi) korunur ve
    // kullanıcı yeniden deneyebilir — ayrı bir "senkron başarısız" işaretleme/
    // uyarı akışına gerek yok, çünkü hiçbir sahte-yerel-başarı hiç oluşmadı.
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    // Sistem Beslemesi (bkz. supabase-facility-candidates.ts) — ana
    // localStorage yazımı BAŞARILI olduktan SONRA, en-iyi-çaba/bloklamayan
    // aday bildirimi, job-request-form.tsx'in oluşturma yolundaki AYNI
    // desen. Yalnızca serbest metin (custom) tesis adları bildirilir.
    if (isCustomLocation && otherFacilityText.trim()) {
      submitFacilityCandidateBestEffort(otherFacilityText, provinceName, district, "job_pickup_location");
    }
    if (showDeliveryFields && isDeliveryManual && deliveryOtherFacilityText.trim()) {
      submitFacilityCandidateBestEffort(deliveryOtherFacilityText, deliveryProvinceName, deliveryDistrict, "job_delivery_location");
    }

    router.push("/panel/hizmet-taleplerim?guncellendi=1");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {showDeliveryFields && (
        <NakliyeEditCards
          job={job}
          category={category}
          setCategory={setCategory}
          title={title}
          setTitle={setTitle}
          description={description}
          setDescription={setDescription}
          errors={errors}
          categoryId={categoryId}
          titleId={titleId}
          descriptionId={descriptionId}
          nakliyeDetails={nakliyeDetails}
          patchNakliyeDetails={patchNakliyeDetails}
          nakliyeErrors={nakliyeErrors}
          nakliyeCargoGroups={nakliyeCargoGroups}
          setNakliyeCargoGroups={setNakliyeCargoGroups}
          cargoGroupErrors={cargoGroupErrors}
          workDate={workDate}
          setWorkDate={setWorkDate}
          workEndDate={workEndDate}
          setWorkEndDate={setWorkEndDate}
          todayLocalDate={todayLocalDate}
          provinceCode={provinceCode}
          district={district}
          facilityId={facilityId}
          otherFacilityText={otherFacilityText}
          addressText={addressText}
          handlePickupFieldsChange={handlePickupFieldsChange}
          deliveryProvinceCode={deliveryProvinceCode}
          deliveryDistrict={deliveryDistrict}
          deliveryFacilityId={deliveryFacilityId}
          deliveryOtherFacilityText={deliveryOtherFacilityText}
          deliveryAddressText={deliveryAddressText}
          handleDeliveryFieldsChange={handleDeliveryFieldsChange}
          photosId={photosId}
          setPhotoState={setPhotoState}
          setPhotosProcessing={setPhotosProcessing}
        />
      )}

      {!showDeliveryFields && (
      <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={categoryId} className="text-sm font-medium text-foreground">
            Hizmet Kategorisi
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? `${categoryId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Kategori seçiniz</option>
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.category && (
            <p id={`${categoryId}-error`} className="mt-2 text-sm text-danger">
              {errors.category}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={workDateId} className="text-sm font-medium text-foreground">
            Başlangıç Tarihi
          </label>
          <input
            id={workDateId}
            type="date"
            min={todayLocalDate}
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
            aria-invalid={errors.workDate ? true : undefined}
            aria-describedby={errors.workDate ? `${workDateId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.workDate && (
            <p id={`${workDateId}-error`} className="mt-2 text-sm text-danger">
              {errors.workDate}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={workEndDateId} className="text-sm font-medium text-foreground">
            Bitiş Tarihi
          </label>
          <input
            id={workEndDateId}
            type="date"
            min={workDate || todayLocalDate}
            value={workEndDate}
            onChange={(event) => setWorkEndDate(event.target.value)}
            aria-invalid={errors.workEndDate ? true : undefined}
            aria-describedby={errors.workEndDate ? `${workEndDateId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.workEndDate && (
            <p id={`${workEndDateId}-error`} className="mt-2 text-sm text-danger">
              {errors.workEndDate}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={titleId} className="text-sm font-medium text-foreground">
          İlan Başlığı
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX_LENGTH}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
          placeholder="Örnek: Fabrika Sahasında Forklift Operatörü İhtiyacı"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.title && (
          <p id={`${titleId}-error`} className="mt-2 text-sm text-danger">
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={descriptionId} className="text-sm font-medium text-foreground">
            İş Açıklaması
          </label>
          <span className="text-xs text-muted-foreground">
            {description.trim().length} / {DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={DESCRIPTION_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
          placeholder="Hizmet ihtiyacınızı, iş kapsamını ve beklentilerinizi açıklayın."
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.description ? (
          <p id={`${descriptionId}-error`} className="mt-2 text-sm text-danger">
            {errors.description}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Başlık ve açıklamaya firma/tesis adı, açık adres, telefon veya e-posta yazmayın — bu bilgiler yalnızca
            teklif kabul edildikten sonra paylaşılabilir.
          </p>
        )}
      </div>
      </>
      )}

      {!showDeliveryFields && showProductFields && (
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <label htmlFor={productQuantityId} className="text-sm font-medium text-foreground">
              Ürün Adedi
            </label>
            <div className="relative mt-2">
              <input
                id={productQuantityId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={productQuantity}
                onChange={(event) => setProductQuantity(event.target.value.replace(/[^0-9]/g, ""))}
                aria-invalid={errors.productQuantity ? true : undefined}
                aria-describedby={errors.productQuantity ? `${productQuantityId}-error` : undefined}
                placeholder="Örn. 120"
                className={`w-full rounded-md border bg-surface px-4 py-3 pr-14 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  errors.productQuantity ? "border-danger" : "border-border"
                }`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
              >
                adet
              </span>
            </div>
            {errors.productQuantity && (
              <p id={`${productQuantityId}-error`} className="mt-2 text-sm text-danger">
                {errors.productQuantity}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={productTonnageId} className="text-sm font-medium text-foreground">
              Tonaj {!tonnageRequired && <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>}
            </label>
            <div className="relative mt-2">
              <input
                id={productTonnageId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={productTonnage}
                onChange={(event) => setProductTonnage(event.target.value.replace(/[^0-9.,]/g, ""))}
                aria-invalid={errors.productTonnage ? true : undefined}
                aria-describedby={errors.productTonnage ? `${productTonnageId}-error` : undefined}
                placeholder="Örn. 8,5"
                className={`w-full rounded-md border bg-surface px-4 py-3 pr-12 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  errors.productTonnage ? "border-danger" : "border-border"
                }`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
              >
                ton
              </span>
            </div>
            {errors.productTonnage && (
              <p id={`${productTonnageId}-error`} className="mt-2 text-sm text-danger">
                {errors.productTonnage}
              </p>
            )}
          </div>

          {/*
            "Listede Yok, Kendim Gireceğim" seçiliyken açılan manuel metin
            kutusu bu hücrenin (3 kolonlu ızgarada tek dar bir kolon)
            genişliğine hapsolmasın diye satırın TAMAMINI kaplar (bkz. görev
            tanımı) — `col-span-full` önek gerektirmez, mobildeki tek
            (örtük) kolonda zaten no-op'tur, yalnızca `sm:`/`lg:` açık
            kolonlarda etkilidir.
          */}
          <div className={productType === PRODUCT_TYPE_CUSTOM_VALUE ? "col-span-full" : undefined}>
            <ProductTypeCombobox
              id={productTypeId}
              label="Ürün Cinsi"
              value={productType}
              onChange={(next) => {
                setProductType(next);
                setErrors((current) => clearJobFormErrors(current, ["productType", "productTypeCustomText"]));
              }}
              customText={productTypeCustomText}
              onCustomTextChange={(next) => {
                setProductTypeCustomText(next);
                setErrors((current) => clearJobFormErrors(current, ["productTypeCustomText"]));
              }}
              customFieldId={productTypeCustomTextId}
              suggestions={PRODUCT_TYPE_SUGGESTIONS}
              errorId={errors.productType ? `${productTypeId}-error` : undefined}
              customTextErrorId={errors.productTypeCustomText ? `${productTypeCustomTextId}-error` : undefined}
            />
            {errors.productType && (
              <p id={`${productTypeId}-error`} className="mt-2 text-sm text-danger">
                {errors.productType}
              </p>
            )}
            {errors.productTypeCustomText && (
              <p id={`${productTypeCustomTextId}-error`} className="mt-2 text-sm text-danger">
                {errors.productTypeCustomText}
              </p>
            )}
          </div>
        </div>
      )}

      {showCustomsFields && (
        <div className="flex flex-col gap-4">
          <CustomsBrokerageFields
            idPrefix="customs-edit"
            values={customsFields}
            errors={errors}
            onChange={(patch) => {
              setCustomsFields((current) => ({ ...current, ...patch }));
              setErrors((current) => clearJobFormErrors(current, Object.keys(patch) as (keyof JobFormErrors)[]));
            }}
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Destekleyici Evraklar <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
            </p>
            <div className="mt-2">
              <JobCustomsDocumentEditor
                existingDocuments={job.customsDocuments ?? []}
                onChange={setCustomsDocumentState}
                onBusyChange={setCustomsDocumentsProcessing}
              />
            </div>
          </div>
        </div>
      )}

      {showRecyclingFields && (
        <RecyclingFields
          idPrefix="recycling-edit"
          values={recyclingFields}
          errors={errors}
          onChange={(patch) => {
            setRecyclingFields((current) => ({ ...current, ...patch }));
            setErrors((current) => clearJobFormErrors(current, Object.keys(patch) as (keyof JobFormErrors)[]));
          }}
        />
      )}

      {showStorageFields && !showContainerFields && (
        <StorageProductFields
          idPrefix="storage-edit"
          values={storageFields}
          errors={errors}
          onChange={(patch) => {
            setStorageFields((current) => ({ ...current, ...patch }));
            setErrors((current) => clearJobFormErrors(current, Object.keys(patch) as (keyof JobFormErrors)[]));
          }}
        />
      )}

      {showHazardousStorageFields && (
        <StorageHazardFields
          idPrefix="storage-hazard-edit"
          category={category}
          values={storageHazardFields}
          errors={{ storageRiskGroups: errors.storageRiskGroups }}
          onChange={(patch) => {
            setStorageHazardFields((current) => ({ ...current, ...patch }));
            setErrors((current) => clearJobFormErrors(current, Object.keys(patch) as (keyof JobFormErrors)[]));
          }}
        />
      )}

      {showContainerFields && (
        <StorageContainerGroupsFields
          idPrefix="storage-container-edit"
          groups={containerGroups}
          errors={errors.storageContainerGroupErrors}
          onChange={(nextGroups) => {
            setContainerGroups(nextGroups);
            setErrors((current) => clearJobFormErrors(current, ["storageContainerGroupErrors"]));
          }}
        />
      )}

      {!showDeliveryFields && (
      <div>
        <p id={photosId} className="text-sm font-medium text-foreground">
          {showStorageFields ? "Yük / Ürün Fotoğrafları *" : "Operasyon Fotoğrafları *"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {showStorageFields
            ? "Depolanacak ürünün/yükün mevcut durumunu, ambalajını ve paketleme koşullarını net şekilde gösteren güncel fotoğraflar yükleyin. Fotoğraflar, hizmet verenlerin depolama koşullarını doğru değerlendirmesine yardımcı olacaktır."
            : "Operasyonun yapılacağı alanı, yükü, ekipmanı veya mevcut saha koşullarını gösteren güncel fotoğraflar yükleyin. Fotoğraflar, hizmet verenlerin işi doğru değerlendirmesine yardımcı olacaktır."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Kişisel bilgi, telefon numarası, plaka veya gizli belge içeren
          fotoğraflar yüklemeyin.
        </p>
        <div className="mt-3">
          <JobPhotoEditor
            job={job}
            onChange={setPhotoState}
            onBusyChange={setPhotosProcessing}
            errorId={errors.photoCount ? `${photosId}-error` : undefined}
            maxPhotos={getMaxPhotos(category)}
          />
        </div>
        {errors.photoCount && (
          <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {errors.photoCount}
          </p>
        )}
      </div>
      )}

      {!showDeliveryFields && (showSimplifiedLocation ? (
        // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği: lokasyon
        // yalnızca İl/İlçe'dir (bkz. görev tanımı) — Liman/Sanayi/OSB ve
        // Açık Adres hiç render edilmez.
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <SearchableSelect
              id={provinceId}
              label="İl"
              options={provinces.map((item) => ({ value: item.code, label: item.name }))}
              value={provinceCode}
              onChange={handleProvinceChange}
              placeholder="İl seçiniz"
              errorId={errors.province ? `${provinceId}-error` : undefined}
            />
            {errors.province && (
              <p id={`${provinceId}-error`} className="mt-2 text-sm text-danger">
                {errors.province}
              </p>
            )}
          </div>

          <div>
            <SearchableSelect
              id={districtId}
              label="İlçe"
              options={districtOptions}
              value={district}
              onChange={handleDistrictChange}
              placeholder="İlçe seçiniz"
              disabled={!provinceCode}
              disabledHint="Önce il seçin"
              errorId={errors.district ? `${districtId}-error` : undefined}
            />
            {errors.district && (
              <p id={`${districtId}-error`} className="mt-2 text-sm text-danger">
                {errors.district}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <SearchableSelect
                id={provinceId}
                label="İl"
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                value={provinceCode}
                onChange={handleProvinceChange}
                placeholder="İl seçiniz"
                errorId={errors.province ? `${provinceId}-error` : undefined}
              />
              {errors.province && (
                <p id={`${provinceId}-error`} className="mt-2 text-sm text-danger">
                  {errors.province}
                </p>
              )}
            </div>

            <div>
              <SearchableSelect
                id={districtId}
                label="İlçe"
                options={districtOptions}
                value={district}
                onChange={handleDistrictChange}
                placeholder="İlçe seçiniz"
                disabled={!provinceCode}
                disabledHint="Önce il seçin"
                errorId={errors.district ? `${districtId}-error` : undefined}
              />
              {errors.district && (
                <p id={`${districtId}-error`} className="mt-2 text-sm text-danger">
                  {errors.district}
                </p>
              )}
            </div>

            <div>
              <SearchableSelect
                id={workLocationTypeId}
                label="Liman / Sanayi / OSB"
                options={facilityOptions}
                value={facilityId}
                onChange={handleFacilityChange}
                placeholder="Liman / Sanayi / OSB seçiniz"
                disabled={!district}
                disabledHint="Önce ilçe seçin"
                errorId={errors.workLocationType && facilityId !== FACILITY_FREE_TEXT_VALUE ? `${workLocationTypeId}-error` : undefined}
              />
              {errors.workLocationType && facilityId !== FACILITY_FREE_TEXT_VALUE && (
                <p id={`${workLocationTypeId}-error`} className="mt-2 text-sm text-danger">
                  {errors.workLocationType}
                </p>
              )}
            </div>
          </div>

          <ManualFacilityNameField
            id={customFacilityNameId}
            value={otherFacilityText}
            onChange={(next) => {
              setOtherFacilityText(next);
              clearFieldError("workLocationType");
            }}
            active={facilityId === FACILITY_FREE_TEXT_VALUE}
            error={facilityId === FACILITY_FREE_TEXT_VALUE ? errors.workLocationType : undefined}
          />

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={addressTextId} className="text-sm font-medium text-foreground">
                Açık Adres
              </label>
              <span className="text-xs text-muted-foreground">
                {addressText.trim().length} / {ADDRESS_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id={addressTextId}
              value={addressText}
              onChange={(event) => {
                setAddressText(event.target.value);
                clearFieldError("addressText");
              }}
              maxLength={ADDRESS_MAX_LENGTH}
              rows={3}
              aria-invalid={errors.addressText ? true : undefined}
              aria-describedby={errors.addressText ? `${addressTextId}-error` : undefined}
              placeholder="Mahalle, cadde/sokak, kapı no ve varsa ilave tarif bilgilerini girin."
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Açık adres yalnızca siz ve teklifi kabul edilen hizmet veren
              tarafından görülebilir.
            </p>
            {errors.addressText && (
              <p id={`${addressTextId}-error`} className="mt-2 text-sm text-danger">
                {errors.addressText}
              </p>
            )}
          </div>
        </>
      ))}

      {submitError && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || photosProcessing || customsDocumentsProcessing}
        aria-disabled={submitting || photosProcessing || customsDocumentsProcessing}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {(submitting || photosProcessing || customsDocumentsProcessing) && (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {submitting
          ? "Kaydediliyor..."
          : photosProcessing
            ? "Fotoğraflar işleniyor..."
            : customsDocumentsProcessing
              ? "Belgeler işleniyor..."
              : "Kaydet"}
      </button>
    </form>
  );
}

/**
 * Nakliye ilan düzenleme — "Konteyner Taşıması ve ADR Bağımsız Bölümleri"
 * görevi (kullanıcı seçimi: "Add numbered cards to edit form too, matching
 * create"): job-request-form.tsx'in isNakliyeCard dalıyla AYNI `NakliyeSectionCard`
 * sırası, ama TEK ilan (çoklu hizmet YOK) için. Diğer TÜM kategoriler
 * `JobEditFormFields`in kendi DEĞİŞMEMİŞ düz JSX'ini kullanmaya devam eder
 * (bkz. `!showDeliveryFields` dalları) — bu bileşen yalnızca Nakliye'de
 * (showDeliveryFields true) render edilir. Tüm state/handler'lar
 * `JobEditFormFields`e ait, prop olarak taşınır — ikinci bir state kopyası
 * İCAT EDİLMEDİ.
 *
 * "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi — bölüm sırası
 * artık SABİT 1-8 değil: Konteyner Taşıması=Evet iken Araç Tercihi kartı
 * hiç render edilmez ve toplam 7 kart kalır (job-request-form.tsx'teki AYNI
 * dinamik numaralandırma ilkesi, bkz. `showVehiclePreference` aşağıda).
 */
function NakliyeEditCards({
  job,
  category,
  setCategory,
  title,
  setTitle,
  description,
  setDescription,
  errors,
  categoryId,
  titleId,
  descriptionId,
  nakliyeDetails,
  patchNakliyeDetails,
  nakliyeErrors,
  nakliyeCargoGroups,
  setNakliyeCargoGroups,
  cargoGroupErrors,
  workDate,
  setWorkDate,
  workEndDate,
  setWorkEndDate,
  todayLocalDate,
  provinceCode,
  district,
  facilityId,
  otherFacilityText,
  addressText,
  handlePickupFieldsChange,
  deliveryProvinceCode,
  deliveryDistrict,
  deliveryFacilityId,
  deliveryOtherFacilityText,
  deliveryAddressText,
  handleDeliveryFieldsChange,
  photosId,
  setPhotoState,
  setPhotosProcessing,
}: {
  job: Job;
  category: string;
  setCategory: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  errors: JobFormErrors;
  categoryId: string;
  titleId: string;
  descriptionId: string;
  nakliyeDetails: NakliyeDetailsFieldValues;
  patchNakliyeDetails: (patch: Partial<NakliyeDetailsFieldValues>) => void;
  nakliyeErrors: NakliyeDetailsErrors;
  nakliyeCargoGroups: NakliyeCargoGroupFieldValues[];
  setNakliyeCargoGroups: (value: NakliyeCargoGroupFieldValues[]) => void;
  cargoGroupErrors: Record<string, NakliyeCargoGroupErrors>;
  workDate: string;
  setWorkDate: (value: string) => void;
  workEndDate: string;
  setWorkEndDate: (value: string) => void;
  todayLocalDate: string;
  provinceCode: string;
  district: string;
  facilityId: string;
  otherFacilityText: string;
  addressText: string;
  handlePickupFieldsChange: (patch: Partial<NakliyeLocationFieldValues>) => void;
  deliveryProvinceCode: string;
  deliveryDistrict: string;
  deliveryFacilityId: string;
  deliveryOtherFacilityText: string;
  deliveryAddressText: string;
  handleDeliveryFieldsChange: (patch: Partial<NakliyeLocationFieldValues>) => void;
  photosId: string;
  setPhotoState: (value: { keptPhotoIds: string[]; newPhotos: ReadyJobPhoto[] }) => void;
  setPhotosProcessing: (value: boolean) => void;
}) {
  // "Yük Bilgileri ve Konteyner Taşıması Birleştirmesi" + "Konteyner
  // Taşımalarında Araç Tercihini Gizleme" + "Konteyner Tetikleyicisi
  // Ürün/Yük Cinsi'ne Taşındı" görevleri — job-request-form.tsx İLE AYNI
  // dinamik numaralandırma ilkesi: ayrı "3 — Konteyner Taşıması" kartı ve
  // (bu görevle) ayrı "Tehlikeli Madde / ADR" kartı İKİSİ de KALDIRILDI
  // (ADR artık her Yük Grubu'nun kendi kartının altında), Araç Tercihi
  // gizlendiğinde de bölüm numaraları boşluk bırakmadan kesintisiz kayar.
  // "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi hâlâ geçerli —
  // ama artık TÜM Yük Gruplarına bakar (bkz. showNakliyeVehiclePreference'ın
  // JobEditFormFields'taki AYNI hesaplaması) — burası SADECE numaralandırma
  // için kendi kopyasını hesaplar, prop olarak taşımaya gerek yok.
  const showVehiclePreference = nakliyeCargoGroups.some((group) => !isNakliyeContainerProductType(group.productType));
  const shipmentPlanCardNumber = 3;
  const vehiclePreferenceCardNumber = 4;
  const yuklemeTeslimatCardNumber = showVehiclePreference ? 5 : 4;
  const photosCardNumber = showVehiclePreference ? 6 : 5;
  return (
    <div className="flex flex-col gap-4">
      <NakliyeSectionCard number={1} title="Temel Bilgiler">
        <div>
          <label htmlFor={categoryId} className="text-sm font-medium text-foreground">
            Hizmet Kategorisi
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? `${categoryId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Kategori seçiniz</option>
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.category && (
            <p id={`${categoryId}-error`} className="mt-2 text-sm text-danger">
              {errors.category}
            </p>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor={titleId} className="text-sm font-medium text-foreground">
            İlan Başlığı
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={TITLE_MAX_LENGTH}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${titleId}-error` : undefined}
            placeholder="Örnek: Gebze'deki Sahadan Depoya Paletli Yük Nakliyesi"
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.title && (
            <p id={`${titleId}-error`} className="mt-2 text-sm text-danger">
              {errors.title}
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={descriptionId} className="text-sm font-medium text-foreground">
              İş Açıklaması
            </label>
            <span className="text-xs text-muted-foreground">
              {description.trim().length} / {DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={DESCRIPTION_MAX_LENGTH}
            rows={4}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
            placeholder="Hizmet ihtiyacınızı, iş kapsamını ve beklentilerinizi açıklayın."
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.description ? (
            <p id={`${descriptionId}-error`} className="mt-2 text-sm text-danger">
              {errors.description}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Başlık ve açıklamaya firma/tesis adı, açık adres, telefon veya e-posta yazmayın — bu bilgiler yalnızca
              teklif kabul edildikten sonra paylaşılabilir.
            </p>
          )}
        </div>
      </NakliyeSectionCard>

      <NakliyeSectionCard number={2} title="Yük Bilgileri">
        <div id="nakliye-edit-cargo-groups">
          <NakliyeCargoGroupsFields
            idPrefix="nakliye-edit-cargo"
            groups={nakliyeCargoGroups}
            errors={cargoGroupErrors}
            onChange={setNakliyeCargoGroups}
          />
        </div>
      </NakliyeSectionCard>

      <NakliyeSectionCard number={shipmentPlanCardNumber} title="Taşıma Planı">
        <ShipmentPlanFields
          idPrefix="nakliye-edit-plan"
          workDate={workDate}
          workEndDate={workEndDate}
          onWorkDateChange={setWorkDate}
          onWorkEndDateChange={setWorkEndDate}
          workDateError={errors.workDate}
          workEndDateError={errors.workEndDate}
          todayLocalDate={todayLocalDate}
        />
      </NakliyeSectionCard>

      {showVehiclePreference && (
        <NakliyeSectionCard number={vehiclePreferenceCardNumber} title="Araç Tercihi">
          <VehiclePreferenceFields idPrefix="nakliye-edit-vehicle" values={nakliyeDetails} onChange={patchNakliyeDetails} />
          {nakliyeErrors.vehiclePreference && (
            <p className="mt-2 text-sm text-danger">{nakliyeErrors.vehiclePreference}</p>
          )}
        </NakliyeSectionCard>
      )}

      <NakliyeSectionCard number={yuklemeTeslimatCardNumber} title="Yükleme ve Teslimat">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-semibold text-foreground">Yükleme (Nereden)</p>
            <div className="mt-3">
              <NakliyeLocationFields
                idPrefix="job-edit-pickup"
                manualValue={PICKUP_MANUAL_LOCATION_VALUE}
                values={{ provinceCode, district, facilityId, customFacilityName: otherFacilityText, addressText }}
                errors={{
                  province: errors.province,
                  district: errors.district,
                  locationType: errors.workLocationType,
                  addressText: errors.addressText,
                }}
                onChange={handlePickupFieldsChange}
              />
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-semibold text-foreground">Teslimat (Nereye)</p>
            <div className="mt-3">
              <NakliyeLocationFields
                idPrefix="job-edit-delivery"
                manualValue={DELIVERY_MANUAL_LOCATION_VALUE}
                values={{
                  provinceCode: deliveryProvinceCode,
                  district: deliveryDistrict,
                  facilityId: deliveryFacilityId,
                  customFacilityName: deliveryOtherFacilityText,
                  addressText: deliveryAddressText,
                }}
                errors={{
                  province: errors.deliveryProvince,
                  district: errors.deliveryDistrict,
                  locationType: errors.deliveryLocationType,
                  addressText: errors.deliveryAddressText,
                }}
                onChange={handleDeliveryFieldsChange}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LoadingMethodField idPrefix="nakliye-edit-loading-method" values={nakliyeDetails} onChange={patchNakliyeDetails} customTextError={nakliyeErrors.loadingMethodCustomText} />
        </div>
      </NakliyeSectionCard>

      <NakliyeSectionCard number={photosCardNumber} title="Fotoğraflar ve Belgeler">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Operasyonun yapılacağı alanı, yükü, ekipmanı veya mevcut saha koşullarını gösteren güncel fotoğraflar
          yükleyin. Fotoğraflar, hizmet verenlerin işi doğru değerlendirmesine yardımcı olacaktır.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Kişisel bilgi, telefon numarası, plaka veya gizli belge içeren fotoğraflar yüklemeyin.
        </p>
        <div className="mt-3">
          <JobPhotoEditor
            job={job}
            onChange={setPhotoState}
            onBusyChange={setPhotosProcessing}
            errorId={errors.photoCount ? `${photosId}-error` : undefined}
            maxPhotos={getMaxPhotos(category)}
          />
        </div>
        {errors.photoCount && (
          <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {errors.photoCount}
          </p>
        )}
      </NakliyeSectionCard>
    </div>
  );
}
