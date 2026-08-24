import { isCustomsBrokerageCategory } from "./customs-brokerage-catalog";
import { isSimplifiedLocationCategory } from "./job-location";
import { isRecyclingCategory } from "./recycling-catalog";
import { deriveWasteCodeHazardous } from "./recycling-waste-code-catalog";
import { didCriticalJobContentChange, getJobModerationStatus } from "./job-moderation";
import { isJobEditable, JOB_NOT_EDITABLE_MESSAGE } from "./job-requests";
import { createPublishWindow, isJobListingExpired } from "./job-publish-window";
import { isJobClosureReason, isJobManuallyClosed, JOB_ALREADY_CLOSED_MESSAGE } from "./job-closure";
import { isJobDateInPast } from "./jobs";
import { STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { isFacilityInProvinceDistrict, isTransportationCategory } from "./nakliye-route";
import { sanitizeNakliyeCargoGroups, sanitizeNakliyeDetails } from "./nakliye-transport-catalog";
import { deletePhotoBlob, deletePhotoBlobs, getPhotoBlob, putPhotoBlob } from "./photo-blob-store";
import { getMaxPhotos, getMinPhotos, getPhotosRequiredMessage, MAX_PHOTOS, MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";
import { requiresProductInfo } from "./product-catalog";
import { getServiceCategoryLabel, isServiceCategoryId, isStorageGroupCategory } from "./service-catalog";
import { isContainerStorageCategory, sanitizeStorageContainerGroups } from "./storage-container-catalog";
import { isHazardousStorageCategory, isTehlikeliMaddeDepolamaCategory, sanitizeStorageRiskGroups } from "./storage-hazard-catalog";
import type {
  Job,
  JobClosureReason,
  JobCustomsDocument,
  JobPhoto,
  JobStatus,
  NakliyeCargoGroup,
  NakliyeContainerTransport,
  NakliyeDetails,
  NakliyeHazmatDetail,
  NakliyeMeasurementInfo,
  Offer,
  Session,
  StorageContainerGroup,
} from "./types";

const USER_JOBS_STORAGE_KEY = "malsevk.jobs.v1";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedJobs: Job[] = [];
let hasCached = false;

const VALID_STATUSES: JobStatus[] = ["yayinda", "tamamlandi", "iptal"];

function isJobPhoto(value: unknown): value is JobPhoto {
  if (typeof value !== "object" || value === null) return false;
  const photo = value as Record<string, unknown>;
  return (
    typeof photo.id === "string" &&
    typeof photo.order === "number" &&
    typeof photo.fileName === "string" &&
    typeof photo.fileSize === "number" &&
    typeof photo.mimeType === "string" &&
    typeof photo.storageKey === "string"
  );
}

function isJobCore(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === "string" &&
    typeof job.title === "string" &&
    typeof job.category === "string" &&
    typeof job.province === "string" &&
    typeof job.district === "string" &&
    typeof job.workLocationType === "string" &&
    typeof job.workDate === "string" &&
    typeof job.description === "string" &&
    typeof job.operationDetails === "string" &&
    typeof job.status === "string" &&
    VALID_STATUSES.includes(job.status as JobStatus) &&
    (job.requesterId === null || typeof job.requesterId === "string")
  );
}

/**
 * `photos` alanı bu özellikten önce oluşturulmuş ilanlarda hiç yoktur.
 * Geriye dönük uyumluluk için eksik/bozuk `photos` her zaman boş diziye
 * normalize edilir — eski ilanlar bu yüzden asla çökmeden, fotoğrafsız
 * olarak görüntülenmeye devam eder. `facilityId`/`companyOrFactoryName`/
 * `addressText` de AYNI mantıkla ele alınır: bu alanlardan önce oluşturulmuş
 * (ya da bozuk/tip uyuşmayan) kayıtlarda `undefined`e normalize edilir —
 * hiçbir zaman çökme veya "undefined" metni gösterme riski yaratmaz (bkz.
 * job-location.ts'in bu opsiyonel alanları nasıl güvenle varsaydığı).
 */
function normalizeStoredJob(value: unknown): Job | null {
  if (!isJobCore(value)) return null;
  const record = value as Record<string, unknown>;
  const rawPhotos = record.photos;
  const photos = Array.isArray(rawPhotos) ? rawPhotos.filter(isJobPhoto) : [];
  // Gümrük Müşavirliği'ne özel evraklar JobPhoto ile AYNI şekli paylaşır
  // (bkz. types.ts#JobCustomsDocument) — isJobPhoto aynen tekrar kullanılır.
  const rawCustomsDocuments = record.customsDocuments;
  const customsDocuments = Array.isArray(rawCustomsDocuments) ? rawCustomsDocuments.filter(isJobPhoto) : [];
  return {
    ...(value as Omit<Job, "photos">),
    photos,
    facilityId: typeof record.facilityId === "string" ? record.facilityId : undefined,
    companyOrFactoryName: typeof record.companyOrFactoryName === "string" ? record.companyOrFactoryName : undefined,
    addressText: typeof record.addressText === "string" ? record.addressText : undefined,
    // locationMode bu alandan önce oluşturulmuş TÜM ilanlarda yoktur — yokluğu
    // (ya da bozuk/tanınmayan bir değer) HER ZAMAN "catalog" olarak yorumlanır,
    // burada undefined'a normalize edilir (job-location.ts/job-edit-form.tsx
    // zaten facilityId varlığına bakarak aynı sonuca varır).
    locationMode: record.locationMode === "catalog" || record.locationMode === "custom" ? record.locationMode : undefined,
    neighborhood: typeof record.neighborhood === "string" ? record.neighborhood : undefined,
    locationUrl: typeof record.locationUrl === "string" ? record.locationUrl : undefined,
    directionsNote: typeof record.directionsNote === "string" ? record.directionsNote : undefined,
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    workEndDate: typeof record.workEndDate === "string" ? record.workEndDate : undefined,
    // "Ürün Bilgileri": bu üç alan da AYNI "eksikliği hata sayma" ilkesiyle
    // (bkz. facilityId/photos üstündeki not) normalize edilir — bu
    // alanlardan önce oluşturulmuş ya da ilgisiz bir kategoride oluşturulmuş
    // ilanlarda hiçbiri yoktur, bu bir hata değildir.
    productQuantity: typeof record.productQuantity === "number" && Number.isFinite(record.productQuantity)
      ? record.productQuantity
      : undefined,
    productTonnage: typeof record.productTonnage === "number" && Number.isFinite(record.productTonnage)
      ? record.productTonnage
      : undefined,
    // "Toplam Ağırlık" birimi — YALNIZCA "ton"/"kg" geçerli sayılır (bkz.
    // types.ts#Job.productTonnageUnit); bu alandan önceki Nakliye ilanlarında
    // hiç yoktur, o durumda job-detail-content.tsx/product-catalog.ts#
    // formatProductTonnage zaten "ton" varsayılanına düşer.
    productTonnageUnit:
      record.productTonnageUnit === "ton" || record.productTonnageUnit === "kg" ? record.productTonnageUnit : undefined,
    productType: typeof record.productType === "string" ? record.productType : undefined,
    // Gümrük Müşavirliği'ne özel "Operasyon Bilgileri": AYNI "eksikliği hata
    // sayma" ilkesiyle (bkz. productQuantity üstündeki not) normalize edilir
    // — bu alanlardan önce oluşturulmuş ya da ilgisiz bir kategoride
    // oluşturulmuş ilanlarda hiçbiri yoktur, bu bir hata değildir.
    customsTransactionType: typeof record.customsTransactionType === "string" ? record.customsTransactionType : undefined,
    customsOfficeId: typeof record.customsOfficeId === "string" ? record.customsOfficeId : undefined,
    customsRequestedServices:
      Array.isArray(record.customsRequestedServices) &&
      record.customsRequestedServices.every((item): item is string => typeof item === "string")
        ? record.customsRequestedServices
        : undefined,
    customsProductType: typeof record.customsProductType === "string" ? record.customsProductType : undefined,
    customsGtipCode: typeof record.customsGtipCode === "string" ? record.customsGtipCode : undefined,
    customsDeclarationItemCount:
      typeof record.customsDeclarationItemCount === "number" && Number.isFinite(record.customsDeclarationItemCount)
        ? record.customsDeclarationItemCount
        : undefined,
    customsContainerCount:
      typeof record.customsContainerCount === "number" && Number.isFinite(record.customsContainerCount)
        ? record.customsContainerCount
        : undefined,
    customsDocuments,
    // İlan Yayın Süresi Yönetimi: bu dört alan bu özellikten önce oluşturulmuş
    // TÜM ilanlarda (sabit örnek ilanlar dahil) yoktur — eksikliği bir hata
    // değildir, job-publish-window.ts bu durumu "yayın süresi kuralından
    // muaf" olarak güvenle yorumlar (bkz. o dosyanın dokümantasyonu). Kayıt
    // hiçbir şekilde bozulmaz/silinmez/yanlış bölüme taşınmaz.
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
    publishEndAt: typeof record.publishEndAt === "string" ? record.publishEndAt : undefined,
    republishedFromJobId: typeof record.republishedFromJobId === "string" ? record.republishedFromJobId : undefined,
    republishedToJobId: typeof record.republishedToJobId === "string" ? record.republishedToJobId : undefined,
    // İlan Kapatma: bu alanlar bu özellikten önce oluşturulmuş/hiç
    // kapatılmamış TÜM ilanlarda yoktur — aynı "eksikliği hata sayma"
    // ilkesiyle (bkz. photos/facilityId) undefined'a normalize edilir.
    closedAt: typeof record.closedAt === "string" ? record.closedAt : undefined,
    closureReason: isJobClosureReason(record.closureReason) ? record.closureReason : undefined,
    // Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer": AYNI "eksikliği hata
    // sayma" ilkesiyle (bkz. productQuantity/customsTransactionType üstündeki
    // notlar) normalize edilir — bu alanlardan önce oluşturulmuş ya da Nakliye
    // dışı bir kategoride oluşturulmuş ilanlarda hiçbiri yoktur.
    deliveryProvince: typeof record.deliveryProvince === "string" ? record.deliveryProvince : undefined,
    deliveryDistrict: typeof record.deliveryDistrict === "string" ? record.deliveryDistrict : undefined,
    deliveryLocationType:
      record.deliveryLocationType === "facility" || record.deliveryLocationType === "open_address"
        ? record.deliveryLocationType
        : undefined,
    deliveryFacilityId: typeof record.deliveryFacilityId === "string" ? record.deliveryFacilityId : undefined,
    deliveryFacilityName: typeof record.deliveryFacilityName === "string" ? record.deliveryFacilityName : undefined,
    deliveryAddressText: typeof record.deliveryAddressText === "string" ? record.deliveryAddressText : undefined,
    // İlan Onayı: bu alandan önce oluşturulmuş TÜM ilanlarda (sabit örnek
    // ilanlar dahil) yoktur — eksikliği job-moderation.ts#getJobModerationStatus
    // tarafından "approved" olarak yorumlanır (bkz. o dosyanın dokümantasyonu),
    // burada yalnızca bozuk/tanınmayan bir değeri undefined'a indirger.
    moderationStatus:
      record.moderationStatus === "pending_review" || record.moderationStatus === "approved" || record.moderationStatus === "rejected"
        ? record.moderationStatus
        : undefined,
    moderationReviewedAt: typeof record.moderationReviewedAt === "string" ? record.moderationReviewedAt : undefined,
    moderationReviewedBy: typeof record.moderationReviewedBy === "string" ? record.moderationReviewedBy : undefined,
    moderationRejectionReason: typeof record.moderationRejectionReason === "string" ? record.moderationRejectionReason : undefined,
    // Geri Dönüşüm & Atık Tahliye'ye özel alan grubu — AYNI "eksikliği hata
    // sayma" ilkesiyle (bkz. customsTransactionType/deliveryProvince üstündeki
    // notlar) normalize edilir — bu alanlardan önce oluşturulmuş ya da ilgisiz
    // bir kategoride oluşturulmuş ilanlarda hiçbiri yoktur.
    recyclingMaterialCategoryId: typeof record.recyclingMaterialCategoryId === "string" ? record.recyclingMaterialCategoryId : undefined,
    recyclingMaterialSubtypeId: typeof record.recyclingMaterialSubtypeId === "string" ? record.recyclingMaterialSubtypeId : undefined,
    recyclingQuantity:
      typeof record.recyclingQuantity === "number" && Number.isFinite(record.recyclingQuantity)
        ? record.recyclingQuantity
        : undefined,
    recyclingUnit:
      record.recyclingUnit === "kg" ||
      record.recyclingUnit === "ton" ||
      record.recyclingUnit === "adet" ||
      record.recyclingUnit === "litre"
        ? record.recyclingUnit
        : undefined,
    recyclingMaterialCondition:
      record.recyclingMaterialCondition === "ayristirilmis" ||
      record.recyclingMaterialCondition === "karisik" ||
      record.recyclingMaterialCondition === "diger"
        ? record.recyclingMaterialCondition
        : undefined,
    recyclingMaterialConditionNote:
      typeof record.recyclingMaterialConditionNote === "string" ? record.recyclingMaterialConditionNote : undefined,
    recyclingScopeOfWork:
      Array.isArray(record.recyclingScopeOfWork) &&
      record.recyclingScopeOfWork.every((item): item is string => typeof item === "string")
        ? record.recyclingScopeOfWork
        : undefined,
    recyclingRequestedOperation:
      typeof record.recyclingRequestedOperation === "string" ? record.recyclingRequestedOperation : undefined,
    recyclingWasteCode: typeof record.recyclingWasteCode === "string" ? record.recyclingWasteCode : undefined,
    recyclingWasteCodeUnknown:
      typeof record.recyclingWasteCodeUnknown === "boolean" ? record.recyclingWasteCodeUnknown : undefined,
    recyclingHazardous: typeof record.recyclingHazardous === "boolean" ? record.recyclingHazardous : undefined,
    recyclingHazardProperties:
      Array.isArray(record.recyclingHazardProperties) &&
      record.recyclingHazardProperties.every((item): item is string => typeof item === "string")
        ? record.recyclingHazardProperties
        : undefined,
    // "Konteyner Grupları" — bu alandan önce oluşturulmuş TÜM Depolama
    // ilanlarında (ve Konteyner Depolama dışındaki her ilanda) yoktur, bu bir
    // hata değildir; bkz. storage-container-catalog.ts#sanitizeStorageContainerGroups
    // (her grubu ayrı ayrı doğrular, bozuk bir grubu atlar).
    storageContainerGroups: sanitizeStorageContainerGroups(record.storageContainerGroups),
    // "Kimyasal Depolama / Tehlikeli Madde Depolama" — bu alandan önce
    // oluşturulmuş TÜM ilanlarda (ve bu iki alt kategori dışındaki her
    // ilanda) yoktur, bu bir hata değildir.
    storageHazardous: typeof record.storageHazardous === "boolean" ? record.storageHazardous : undefined,
    storageRiskGroups: sanitizeStorageRiskGroups(record.storageRiskGroups),
    // "Nakliye Yeniden Tasarımı" — bu alandan önce oluşturulmuş TÜM Nakliye
    // ilanlarında (ve Nakliye dışındaki her ilanda) yoktur, bu bir hata
    // değildir; bkz. nakliye-transport-catalog.ts#sanitizeNakliyeDetails.
    nakliyeDetails: sanitizeNakliyeDetails(record.nakliyeDetails),
    // "Nakliye Çoklu Yük Grubu" — bu alandan önce oluşturulmuş (ya da tek
    // grup asla eklenmemiş) TÜM Nakliye ilanlarında yoktur, bu bir hata
    // değildir; nakliye-cargo-groups.ts#getJobCargoGroups bu durumda
    // yukarıdaki tekil alanlardan "Yük Grubu 1" sentezler (SALT OKUNUR).
    nakliyeCargoGroups: sanitizeNakliyeCargoGroups(record.nakliyeCargoGroups),
    // DEPRECATED düz alanlar — types.ts#Job'un kendi notuna bkz., yalnızca
    // storageContainerGroups'tan ÖNCE oluşturulmuş (bu oturumun erken test
    // verisi dahil) bir ilanın geriye dönük okunabilmesi için normalize
    // edilir, yeni kod bunlara YAZMAZ.
    storageContainerSize:
      record.storageContainerSize === "20" || record.storageContainerSize === "40" || record.storageContainerSize === "45"
        ? record.storageContainerSize
        : undefined,
    storageContainerType:
      record.storageContainerType === "standart" ||
      record.storageContainerType === "high-cube" ||
      record.storageContainerType === "reefer" ||
      record.storageContainerType === "open-top" ||
      record.storageContainerType === "tank"
        ? record.storageContainerType
        : undefined,
    storageContainerStatus:
      record.storageContainerStatus === "dolu" || record.storageContainerStatus === "bos" ? record.storageContainerStatus : undefined,
    storageContainerHazardous: typeof record.storageContainerHazardous === "boolean" ? record.storageContainerHazardous : undefined,
    storageContainerUnNumber: typeof record.storageContainerUnNumber === "string" ? record.storageContainerUnNumber : undefined,
    storageContainerImoClass: typeof record.storageContainerImoClass === "string" ? record.storageContainerImoClass : undefined,
    storageContainerReeferTemperature:
      typeof record.storageContainerReeferTemperature === "number" && Number.isFinite(record.storageContainerReeferTemperature)
        ? record.storageContainerReeferTemperature
        : undefined,
    storageContainerReeferElectrical:
      typeof record.storageContainerReeferElectrical === "boolean" ? record.storageContainerReeferElectrical : undefined,
  } as Job;
}

function readUserCreatedJobsSnapshot(): Job[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(USER_JOBS_STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (hasCached && raw === cachedRaw) return cachedJobs;

  let parsed: Job[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        parsed = value
          .map(normalizeStoredJob)
          .filter((job): job is Job => job !== null);
      }
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedJobs = parsed;
  hasCached = true;
  return parsed;
}

const EMPTY_JOBS: Job[] = [];

function getServerJobsSnapshot(): Job[] {
  return EMPTY_JOBS;
}

function subscribeToJobs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * `writeJson` başarısız olursa (bkz. local-storage.ts) `false` döner ve
 * ÖNBELLEK/BİLDİRİM (notify) HİÇ TETİKLENMEZ — bu, arayüzün eski (gerçekte
 * hâlâ geçerli olan) veriyi göstermeye devam etmesini, yazılmamış bir
 * değişikliği asla "başarılı" gibi yansıtmamasını sağlar (bkz. CLAUDE.md B1
 * düzeltmesi). Her çağıran, bu sonucu kendi `{ok,error}` sözleşmesine çevirir.
 */
function writeUserCreatedJobs(jobs: Job[]): boolean {
  if (!writeJson(USER_JOBS_STORAGE_KEY, jobs)) return false;
  cachedRaw = null;
  hasCached = false;
  notify();
  return true;
}

export const userJobsStore = {
  subscribe: subscribeToJobs,
  getSnapshot: readUserCreatedJobsSnapshot,
  getServerSnapshot: getServerJobsSnapshot,
};

export function findUserCreatedJobById(id: string): Job | null {
  return readUserCreatedJobsSnapshot().find((job) => job.id === id) ?? null;
}

/** Tüm kullanıcı-oluşturmalı ilanları döndürür (statik örnek ilanlar hariç, bkz. jobs.ts). */
export function getAllUserCreatedJobs(): Job[] {
  return readUserCreatedJobsSnapshot();
}

/**
 * Aynı operasyona (bkz. types.ts#Job.operationId, aşağıdaki
 * createJobsForOperation) bağlı ilanları döndürür — yalnızca kullanıcı
 * tarafından oluşturulan ilanlar arasında arar (mevcut okuma/normalizasyon
 * yolu, readUserCreatedJobsSnapshot, üzerinden; ayrı/dağınık bir
 * localStorage erişimi açılmaz). Sabit örnek ilanlar (jobs.ts) bu alanı hiç
 * taşımadığı için zaten hiçbir zaman eşleşmez. Boş/geçersiz `operationId`
 * için boş dizi döner; `operationId`si olmayan (eski ya da tekil) ilanları
 * hiç etkilemez.
 */
export function getJobsByOperationId(operationId: string): Job[] {
  if (!operationId) return [];
  return readUserCreatedJobsSnapshot().filter((job) => job.operationId === operationId);
}

/**
 * Bir ilanın, AYNI operasyona bağlı KARDEŞ ilanlarını (kendisi HARİÇ)
 * döndürür — getJobsByOperationId'nin "kaynak ilanı bul + kendini dışla"
 * hâli. Kaynak ilan bulunamıyorsa ya da bir operasyona bağlı değilse
 * (operationId yoksa) boş dizi döner.
 */
export function getSiblingJobs(jobId: string): Job[] {
  const job = findUserCreatedJobById(jobId);
  if (!job || !job.operationId) return [];
  return getJobsByOperationId(job.operationId).filter((sibling) => sibling.id !== jobId);
}

/**
 * Verilen id'lere sahip ilanları, normal `deleteJob`'daki "tamamlandi
 * durumundaki ilan silinemez" gibi tekli-silme korumaları UYGULANMADAN
 * kaldırır. Yalnızca dev-only demo veri sıfırlama aracı (bkz.
 * reset-demo-data.ts) için vardır — gerçek kullanıcı akışlarının
 * kullanması gereken, yetkilendirilmiş giriş noktası hâlâ
 * offers.ts#deleteJobWithOffers'tır. `deleteJob` ile aynı sırayı izler:
 * kayıt önce silinir, fotoğraf blob'ları sonra temizlenir. Silinen
 * ilanları döndürür (rapor amaçlı).
 */
export async function removeUserCreatedJobsByIds(ids: string[]): Promise<Job[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const all = readUserCreatedJobsSnapshot();
  const removed = all.filter((job) => idSet.has(job.id));
  if (removed.length === 0) return [];
  if (!writeUserCreatedJobs(all.filter((job) => !idSet.has(job.id)))) return [];

  const photoKeys = removed.flatMap((job) => job.photos.map((photo) => photo.storageKey));
  if (photoKeys.length > 0) {
    await deletePhotoBlobs(photoKeys);
  }
  return removed;
}

/** Sunucuya gönderilecek, zaten işlenmiş (HEIC dönüştürülmüş, EXIF temizlenmiş) bir fotoğraf. */
export type ProcessedPhotoInput = {
  blob: Blob;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

/** createJob/updateJob'ın ortak aldığı, locationMode'a bağlı ham konum alanları. */
type LocationInput = {
  category: string;
  workLocationType: string;
  facilityId?: string;
  addressText: string;
  locationMode?: "catalog" | "custom";
};

/**
 * locationMode'a göre ham form girdisini Job'a yazılacak son alanlara
 * indirger — TEK yer, createJob ve updateJob arasında kopyalanmaz.
 * "custom" modda facilityId HER ZAMAN temizlenir (sahte/yanlış bir
 * Facility.id asla kalıcı hâle gelmez — bkz. job-location.ts#resolveJobFacility'nin
 * locationMode "custom" için katalog eşleştirmesini de bilerek atlaması).
 *
 * Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği (bkz. job-location.ts#
 * isSimplifiedLocationCategory) için lokasyon artık yalnızca İl/İlçe'den
 * oluşur — bu iki grup için workLocationType/facilityId/addressText/
 * locationMode HER ZAMAN temizlenir (girdi olarak ne gelirse gelsin, ör.
 * kategori değiştirilmeden önceki bir değer), `resolveProductInfoFields`/
 * `resolveCustomsBrokerageFields`/`resolveDeliveryLocationFields` İLE AYNI
 * "kapsam dışıysa aktif olarak temizle" ilkesi — bu alanlar HÂLÂ diğer
 * kategoriler (Lashing, Gözetim, Forklift, vb.) için anlamlı olduğundan,
 * "eski değeri koru" değil "aktif temizle" doğru davranıştır (aksi halde bir
 * Depolama/Gümrük ilanı düzenlenip kaydedildiğinde bu değişiklikten ÖNCEKİ
 * eski tesis/adres bilgisi sessizce sürüklenmeye devam ederdi).
 *
 * companyOrFactoryName ("Firma / Fabrika Adı") ve neighborhood/locationUrl/
 * directionsNote ("Bölge / Mahalle"/"Konum Bağlantısı"/"Adres Tarifi")
 * BİLEREK bu fonksiyonun döndürdüğü nesnede HİÇ YOK — hiçbir kategorinin
 * formu artık bunları toplamıyor (Gümrük Müşavirliği'nin eski "custom" konum
 * bloğu da yukarıdaki sadeleştirmeyle kaldırıldı), bu üçü de alan döndürülen
 * nesneden BİLEREK dışarıda bırakılır — updateJob'daki
 * `{...existing, ...resolveLocationFields(input)}` sıralaması sayesinde bu
 * alanlardan önce oluşturulmuş bir ilanın mevcut değeri (varsa) burada hiç
 * dokunulmadığı için düzenleme sonrasında da kaybolmadan aynen korunur — veri
 * kaybı yoktur, yalnızca artık aktif formlardan toplanmaz/gösterilmez.
 */
function resolveLocationFields(input: LocationInput) {
  if (isSimplifiedLocationCategory(input.category)) {
    return {
      workLocationType: "",
      facilityId: undefined,
      addressText: undefined,
      locationMode: undefined,
    };
  }
  const isCustom = input.locationMode === "custom";
  return {
    workLocationType: input.workLocationType.trim(),
    facilityId: isCustom ? undefined : input.facilityId?.trim() || undefined,
    addressText: input.addressText.trim(),
    locationMode: input.locationMode,
  };
}

/** createJob/createJobsForOperation/updateJob'ın ortak aldığı ham "Ürün Bilgileri" girdisi — form tarafında zaten sayıya ayrıştırılmış/doğrulanmıştır (bkz. product-catalog.ts#parseProductQuantity/parseProductTonnage). */
type ProductInfoInput = {
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de yazılır. */
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
};

/**
 * `resolveLocationFields` ile AYNI "TEK yer, kopyalanmaz" ilkesi — kategori
 * `product-catalog.ts#requiresProductInfo` kapsamı DIŞINDAYSA dört alan da
 * HER ZAMAN temizlenir (girdi olarak ne gelirse gelsin), bu yüzden bir ilan
 * düzenlemede ilgisiz bir kategoriye geçirilirse eski ürün bilgisi sessizce
 * kaybolur, yanlış kategoriyle birlikte sürüklenmez. `productTonnageUnit`
 * AYRICA daha DAR bir kapsama sahiptir — yalnızca Nakliye'de (Liman
 * Hizmetleri requiresProductInfo kapsamında olsa da bu birimi HİÇ kullanmaz,
 * bkz. görev tanımı) yazılır; kategori Liman Hizmetleri'yse (ya da kapsam
 * dışıysa) HER ZAMAN temizlenir.
 */
function resolveProductInfoFields(category: string, input: ProductInfoInput) {
  if (!requiresProductInfo(category)) {
    return { productQuantity: undefined, productTonnage: undefined, productTonnageUnit: undefined, productType: undefined };
  }
  return {
    productQuantity: input.productQuantity,
    productTonnage: input.productTonnage,
    productTonnageUnit: isTransportationCategory(category) ? input.productTonnageUnit : undefined,
    productType: input.productType?.trim() || undefined,
  };
}

/**
 * createJob/createJobsForOperation/updateJob'ın ortak aldığı ham Gümrük
 * Müşavirliği "Operasyon Bilgileri" girdisi — form tarafında zaten
 * doğrulanmış/ayrıştırılmıştır (bkz. job-form-validation.ts#
 * validateCustomsBrokerageFields). `customsDocuments` burada ZATEN
 * IndexedDB'ye yazılmış (persistPhotosOrRollback ile), storageKey'leri
 * hazır kayıtlardır — bu fonksiyon yalnızca kategori kapsam dışıysa bu
 * dizinin Job'a hiç yazılmamasına karar verir, blob'ların kendisiyle
 * ilgilenmez (bkz. createJob/createJobsForOperation/updateJob'ın kendi
 * persist/rollback sırası).
 */
type CustomsBrokerageInput = {
  customsTransactionType?: string;
  customsRequestedServices?: string[];
  customsProductType?: string;
  customsDocuments?: JobCustomsDocument[];
};

/**
 * `resolveLocationFields`/`resolveProductInfoFields` ile AYNI "TEK yer,
 * kopyalanmaz" ilkesi — kategori `isCustomsBrokerageCategory` kapsamı
 * DIŞINDAYSA dört alan da HER ZAMAN temizlenir (girdi olarak ne gelirse
 * gelsin, evraklar dahil), bu yüzden bir ilan düzenlemede ilgisiz bir
 * kategoriye geçirilirse eski Gümrük Müşavirliği bilgisi sessizce kaybolur,
 * yanlış kategoriyle birlikte sürüklenmez. Çoklu Hizmet Operasyonu'nda da
 * AYNI koruma her hizmet için ayrı ayrı uygulanır — bu, "yalnızca Gümrük
 * Müşavirliği hizmet kartı bu alanları taşır, kardeşlere kopyalanmaz"
 * kuralının tek uygulama noktasıdır.
 *
 * `customsGtipCode`/`customsDeclarationItemCount`/`customsContainerCount`/
 * `customsOfficeId` (Gümrük Müdürlüğü — sonradan kaldırıldı, eski yerinde
 * artık Ürün Cinsi var, bkz. customs-brokerage-fields.tsx) BİLEREK bu
 * fonksiyonun döndürdüğü nesnede HİÇ YOK — hiçbir kategorinin formu artık
 * bunları toplamıyor, `resolveLocationFields`'in
 * companyOrFactoryName/neighborhood/locationUrl/directionsNote'u dışarıda
 * bırakmasıyla AYNI ilke: `updateJob`daki `{...existing, ...resolved}`
 * sıralaması sayesinde bu dört alanı zaten taşıyan eski bir Gümrük
 * Müşavirliği ilanının değeri, o ilan sonradan düzenlense bile dokunulmadan
 * korunur — veri kaybı yoktur, yalnızca artık toplanmaz/gösterilmez.
 */
function resolveCustomsBrokerageFields(category: string, input: CustomsBrokerageInput) {
  if (!isCustomsBrokerageCategory(category)) {
    return {
      customsTransactionType: undefined,
      customsRequestedServices: undefined,
      customsProductType: undefined,
      customsDocuments: undefined,
    };
  }
  return {
    customsTransactionType: input.customsTransactionType,
    customsRequestedServices:
      input.customsRequestedServices && input.customsRequestedServices.length > 0
        ? input.customsRequestedServices
        : undefined,
    customsProductType: input.customsProductType?.trim() || undefined,
    customsDocuments: input.customsDocuments && input.customsDocuments.length > 0 ? input.customsDocuments : undefined,
  };
}

type RecyclingInput = {
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string[];
  recyclingRequestedOperation?: string;
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  /** Ham girdi — HER ZAMAN yok sayılır, bkz. fonksiyonun kendi notu: tehlike durumu istemciden asla güvenilmez, atık kodundan yeniden türetilir. */
  recyclingHazardous?: boolean;
  recyclingHazardProperties?: string[];
};

/**
 * `resolveCustomsBrokerageFields`/`resolveDeliveryLocationFields` ile AYNI
 * "TEK yer, kopyalanmaz" ilkesi — kategori `isRecyclingCategory` kapsamı
 * DIŞINDAYSA alanların tamamı HER ZAMAN temizlenir (girdi olarak ne gelirse
 * gelsin), bu yüzden bir ilan düzenlemede ilgisiz bir kategoriye geçirilirse
 * eski Geri Dönüşüm bilgisi sessizce kaybolur, yanlış kategoriyle birlikte
 * sürüklenmez. `recyclingMaterialConditionNote` yalnızca durum "diger" iken
 * taşınır — başka bir durum seçiliyken (ya da hiç seçilmemişken) girdi ne
 * olursa olsun temizlenir.
 *
 * `recyclingHazardous` istemciden gelen ham değer HİÇBİR ZAMAN doğrudan
 * kullanılmaz — `deriveWasteCodeHazardous` ile atık kodundan (ya da kod
 * bilinmiyorsa `null`'dan) burada yeniden türetilir. Bu, storage-hazard
 * tarafındaki `resolveStorageHazardFields`'in "tehlike bayrağını istemciye
 * bırakma" ilkesiyle aynıdır — yıldızlı (tehlikeli) bir kod hiçbir zaman
 * kullanıcı tarafından tehlikesiz olarak override edilemez, çünkü bu alan
 * hiç kullanıcı girdisinden okunmaz. `recyclingHazardProperties` de aynı
 * nedenle yalnızca türetilen tehlike durumu `true` iken taşınır.
 */
function resolveRecyclingFields(category: string, input: RecyclingInput) {
  if (!isRecyclingCategory(category)) {
    return {
      recyclingMaterialCategoryId: undefined,
      recyclingMaterialSubtypeId: undefined,
      recyclingQuantity: undefined,
      recyclingUnit: undefined,
      recyclingMaterialCondition: undefined,
      recyclingMaterialConditionNote: undefined,
      recyclingScopeOfWork: undefined,
      recyclingRequestedOperation: undefined,
      recyclingWasteCode: undefined,
      recyclingWasteCodeUnknown: undefined,
      recyclingHazardous: undefined,
      recyclingHazardProperties: undefined,
    };
  }
  const wasteCodeUnknown = input.recyclingWasteCodeUnknown === true;
  const wasteCode = wasteCodeUnknown ? undefined : input.recyclingWasteCode?.trim() || undefined;
  const hazardous = deriveWasteCodeHazardous(wasteCode ?? null) ?? undefined;
  return {
    recyclingMaterialCategoryId: input.recyclingMaterialCategoryId,
    recyclingMaterialSubtypeId: input.recyclingMaterialSubtypeId,
    recyclingQuantity: input.recyclingQuantity,
    recyclingUnit: input.recyclingUnit,
    recyclingMaterialCondition: input.recyclingMaterialCondition,
    recyclingMaterialConditionNote:
      input.recyclingMaterialCondition === "diger" ? input.recyclingMaterialConditionNote?.trim() || undefined : undefined,
    recyclingScopeOfWork:
      input.recyclingScopeOfWork && input.recyclingScopeOfWork.length > 0 ? input.recyclingScopeOfWork : undefined,
    recyclingRequestedOperation: input.recyclingRequestedOperation || undefined,
    recyclingWasteCode: wasteCode,
    recyclingWasteCodeUnknown: wasteCodeUnknown,
    recyclingHazardous: hazardous,
    recyclingHazardProperties:
      hazardous && input.recyclingHazardProperties && input.recyclingHazardProperties.length > 0
        ? input.recyclingHazardProperties
        : undefined,
  };
}

type StorageProductInput = {
  storageProductType?: string;
  storageProductQuantity?: number;
  storageProductUnit?: "kg" | "ton" | "adet";
  storageProductTonnage?: number;
  storageContainerGroups?: StorageContainerGroup[];
};

const EMPTY_STORAGE_CONTAINER_FIELDS: StorageProductInput = {
  storageProductType: undefined,
  storageProductQuantity: undefined,
  storageProductUnit: undefined,
  storageProductTonnage: undefined,
  storageContainerGroups: undefined,
};

/**
 * `resolveRecyclingFields`/`resolveCustomsBrokerageFields` ile AYNI "TEK
 * yer, kopyalanmaz" ilkesi — kategori `isStorageGroupCategory` kapsamı
 * DIŞINDAYSA her alan HER ZAMAN temizlenir (girdi olarak ne gelirse
 * gelsin), bu yüzden bir ilan düzenlemede ilgisiz bir kategoriye geçirilirse
 * eski Depolama bilgisi sessizce kaybolur, yanlış kategoriyle birlikte
 * sürüklenmez. Kategori "Konteyner Depolama" İSE `storageProductType/
 * Quantity/Unit/Tonnage` DÖRDÜ DE her zaman temizlenir (bkz. storage-
 * container-catalog.ts'in kendi başlık dokümanındaki 3. tasarım notu — bir
 * ilan birden fazla konteyner grubu taşıyabildiği için TEK değerli bu
 * alanlar artık bu kategoride HİÇ KULLANILMAZ) ve `storageContainerGroups`
 * `sanitizeStorageContainerGroups` ile (bileşenin kendi canlı
 * temizlemesinden BAĞIMSIZ, ikinci/sunucu tarafı bir güvenlik ağı olarak —
 * HER grubun kendi Yük Durumu/Tipine göre koşullu alanları TEK TEK süzülür)
 * yeniden doğrulanır. Depolama ailesinin BAŞKA bir alt türüyse davranış
 * DEĞİŞMEDİ (storageProductType/Quantity/Unit/Tonnage aynen geçirilir),
 * `storageContainerGroups` temizlenir.
 */
/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — `resolveStorageProductFields`
 * İLE AYNI "TEK yer, kopyalanmaz" ilkesi: kategori `isHazardousStorageCategory`
 * kapsamı DIŞINDAYSA (Konteyner Depolama dahil — o kategori kendi grup
 * başına `hazardous` alanını kullanır, bu ikisiyle KARIŞTIRILMAZ) her iki
 * alan HER ZAMAN temizlenir. "Tehlikeli Madde Depolama" İSE `storageHazardous`
 * girdi ne olursa olsun HER ZAMAN `true` yazılır (görev talimatı: "ürün
 * zaten tehlikeli kabul edilecek, soru sorulmasın") — istemci formu zaten bu
 * kategoride soruyu HİÇ göstermez, burası yalnızca ikinci/sunucu tarafı bir
 * güvenlik ağıdır. Derin doğrulama (risk grubu id'lerinin geçerliliği/en az
 * bir grup zorunluluğu) job-form-validation.ts#validateStorageHazardFields'e
 * bırakılır — burada yalnızca TİP güvenliği sağlanır.
 */
function resolveStorageHazardFields(
  category: string,
  input: { storageHazardous?: boolean; storageRiskGroups?: string[] },
): { storageHazardous?: boolean; storageRiskGroups?: string[] } {
  if (!isHazardousStorageCategory(category)) {
    return { storageHazardous: undefined, storageRiskGroups: undefined };
  }
  const riskGroups = sanitizeStorageRiskGroups(input.storageRiskGroups);
  const hazardous = isTehlikeliMaddeDepolamaCategory(category) ? true : input.storageHazardous === true;
  return {
    storageHazardous: hazardous,
    storageRiskGroups: hazardous ? riskGroups : undefined,
  };
}

function resolveStorageProductFields(category: string, input: StorageProductInput) {
  if (!isStorageGroupCategory(category)) {
    return EMPTY_STORAGE_CONTAINER_FIELDS;
  }
  if (isContainerStorageCategory(category)) {
    return {
      storageProductType: undefined,
      storageProductQuantity: undefined,
      storageProductUnit: undefined,
      storageProductTonnage: undefined,
      storageContainerGroups: sanitizeStorageContainerGroups(input.storageContainerGroups),
    };
  }
  return {
    ...EMPTY_STORAGE_CONTAINER_FIELDS,
    storageProductType: input.storageProductType,
    storageProductQuantity: input.storageProductQuantity,
    storageProductUnit: input.storageProductUnit,
    storageProductTonnage: input.storageProductTonnage,
  };
}

/**
 * createJob/createJobsForOperation/updateJob'ın ortak aldığı ham Nakliye
 * "Teslim Edilecek Yer" girdisi. `deliveryLocationType` `""` kabul eder
 * (form tarafında "henüz yöntem seçilmedi" durumunu temsil eder,
 * job-form-validation.ts#ServiceItemFields/JobFormFields ile AYNI gevşek
 * tip) — `resolveDeliveryLocationFields` bunu Job'a yazmadan önce
 * `undefined`e normalize eder (bkz. aşağıdaki fonksiyon).
 */
type DeliveryLocationInput = {
  deliveryProvince?: string;
  deliveryDistrict?: string;
  deliveryLocationType?: "facility" | "open_address" | "";
  deliveryFacilityId?: string;
  deliveryFacilityName?: string;
  deliveryAddressText?: string;
};

/**
 * Veri kayıt katmanı doğrulaması (görev tanımı madde 5: "Bu doğrulama
 * yalnızca form arayüzünde değil, veri kayıt katmanında da yapılmalıdır") —
 * verilen il/ilçe kapsamında GERÇEKTEN var olmayan bir facilityId SESSİZCE
 * reddedilir (undefined'a düşürülür, hem id hem denormalize edilmiş ad).
 * Yalnızca Nakliye'nin pickup/delivery alanları için çağrılır; Nakliye
 * dışındaki kategorilerin `job.facilityId`i (job-location.ts#resolveJobFacility
 * zaten kendi ad/takma-ad eşleştirmesini yapıyor) BUNDAN HİÇ ETKİLENMEZ.
 */
function verifyNakliyeFacility(
  province: string | undefined,
  district: string | undefined,
  facilityId: string | undefined,
): boolean {
  if (!facilityId || !province || !district) return false;
  return isFacilityInProvinceDistrict(province, district, facilityId);
}

/**
 * `resolveLocationFields`/`resolveProductInfoFields`/`resolveCustomsBrokerageFields`
 * ile AYNI "TEK yer, kopyalanmaz" ilkesi — kategori `isTransportationCategory`
 * kapsamı DIŞINDAYSA altı alan da HER ZAMAN temizlenir (girdi olarak ne
 * gelirse gelsin), bu yüzden bir ilan düzenlemede ilgisiz bir kategoriye
 * geçirilirse eski teslimat bilgisi sessizce kaybolur, yanlış kategoriyle
 * birlikte sürüklenmez. `deliveryFacilityName` artık seçilen yönteme
 * bakılmaksızın doldurulur — "facility" modunda katalogdan çözümlenmiş
 * (VE il/ilçe kapsamında doğrulanmış — bkz. verifyNakliyeFacility) tesis
 * adı, "open_address" modunda kullanıcının serbestçe yazdığı GERÇEK ad
 * (doğrulama gerekmez, serbest metindir). `deliveryAddressText` da artık
 * yönteme bakılmaksızın HER ZAMAN taşınır (bkz. görev tanımı madde 2/3/7) —
 * eski "ya tesis adı ya açık adres" karşılıklı dışlama kuralı KALDIRILDI.
 */
function resolveDeliveryLocationFields(category: string, input: DeliveryLocationInput) {
  if (!isTransportationCategory(category)) {
    return {
      deliveryProvince: undefined,
      deliveryDistrict: undefined,
      deliveryLocationType: undefined,
      deliveryFacilityId: undefined,
      deliveryFacilityName: undefined,
      deliveryAddressText: undefined,
    };
  }
  const deliveryProvince = input.deliveryProvince?.trim() || undefined;
  const deliveryDistrict = input.deliveryDistrict?.trim() || undefined;
  const deliveryLocationType = input.deliveryLocationType || undefined;
  const isOpenAddress = deliveryLocationType === "open_address";
  const rawFacilityId = isOpenAddress ? undefined : input.deliveryFacilityId?.trim() || undefined;
  const facilityVerified = verifyNakliyeFacility(deliveryProvince, deliveryDistrict, rawFacilityId);
  return {
    deliveryProvince,
    deliveryDistrict,
    deliveryLocationType,
    deliveryFacilityId: facilityVerified ? rawFacilityId : undefined,
    deliveryFacilityName: isOpenAddress
      ? input.deliveryFacilityName?.trim() || undefined
      : facilityVerified
        ? input.deliveryFacilityName?.trim() || undefined
        : undefined,
    deliveryAddressText: input.deliveryAddressText?.trim() || undefined,
  };
}

/**
 * "Tehlikeli Madde / ADR Kartı Sadeleştirmesi" görevinin kendi kesin kuralı:
 * UN Numarası/Resmî Taşımacılık Adı/Ambalaj Grubu artık hiçbir formda
 * toplanmadığı için `fromNakliyeDetailsFields`in ürettiği YENİ hazmat objesi
 * bu üç anahtarı hiç İÇERMEZ — ama bir eski ilan yalnız görüntülenip
 * düzenlendiğinde (ADR ile hiç ilgisi olmayan bir alan değiştirilse bile)
 * bu, `nakliyeDetails` bütün obje olarak yeniden yazılırken eski değerleri
 * SESSİZCE SİLERDİ (jsonb sütunu tam-değer değiştirilir, alan bazında
 * birleştirilmez). Bu fonksiyon, sanitize ETMEDEN ÖNCE, hâlâ "evet" olan bir
 * hazmat durumunda eski değerleri (varsa) YENİ objeye geri taşır — yeni
 * status/adrClass her zaman kazanır, yalnızca form'un hiç toplamadığı üç
 * anahtar korunur. Bu, diğer alan-kaldırma görevlerinin (Şasi/Free Time/
 * SDS-MSDS vb.) izlediği "bir sonraki düzenlemede doğal olarak düşer"
 * ilkesinden BİLEREK farklıdır — bu görevin talimatı açıkça "gizlenen
 * alanlara otomatik null göndererek mevcut veriyi silme" der.
 */
function mergeLegacyHazmatFields(rawInput: unknown, existing?: NakliyeDetails): unknown {
  if (existing?.hazmat?.status !== "evet" || typeof rawInput !== "object" || rawInput === null) return rawInput;
  const rawObj = rawInput as Record<string, unknown>;
  const rawHazmat = rawObj.hazmat;
  if (typeof rawHazmat !== "object" || rawHazmat === null || (rawHazmat as Record<string, unknown>).status !== "evet") {
    return rawInput;
  }
  return {
    ...rawObj,
    hazmat: {
      unNumber: existing.hazmat.unNumber,
      properShippingName: existing.hazmat.properShippingName,
      packingGroup: existing.hazmat.packingGroup,
      ...(rawHazmat as Record<string, unknown>),
    },
  };
}

/**
 * `resolveDeliveryLocationFields` İLE AYNI "TEK yer, kopyalanmaz, kategori
 * kapsamı dışındaysa HER ZAMAN temizlenir" ilkesi — Nakliye dışı bir
 * kategoriye geçirilen bir ilanın eski `nakliyeDetails`i sessizce kaybolur.
 * Derin doğrulama `sanitizeNakliyeDetails`e devredilir (ikinci bir
 * doğrulama mantığı İCAT EDİLMEDİ, bileşenin kendi canlı doğrulamasından
 * BAĞIMSIZ bir sunucu-tarafı güvenlik ağı olarak). `existing`: yalnızca bir
 * DÜZENLEME sırasında (createJob/createJobsForOperation'da yok — yeni bir
 * ilanda korunacak eski değer olamaz) geçirilir, `mergeLegacyHazmatFields`
 * için — bkz. o fonksiyonun kendi doküman notu.
 */
function resolveNakliyeDetails(category: string, input: { nakliyeDetails?: unknown }, existing?: NakliyeDetails) {
  if (!isTransportationCategory(category)) return undefined;
  return sanitizeNakliyeDetails(mergeLegacyHazmatFields(input.nakliyeDetails, existing));
}

/**
 * "Nakliye Çoklu Yük Grubu" görevi — `resolveNakliyeDetails` İLE AYNI "TEK
 * yer, kopyalanmaz, kategori kapsamı dışındaysa HER ZAMAN temizlenir" ilkesi:
 * Nakliye dışı bir kategoriye geçirilen bir ilanın eski `nakliyeCargoGroups`u
 * sessizce kaybolur. Derin doğrulama `sanitizeNakliyeCargoGroups`e
 * devredilir (ikinci bir doğrulama mantığı İCAT EDİLMEDİ). `input.nakliyeCargoGroups`
 * her zaman çağıranın (job-request-form.tsx/job-edit-form.tsx#
 * fromCargoGroupsFields) zaten ürettiği TAM/GÜNCEL dizi olduğu için —
 * `mergeLegacyHazmatFields`in ADR alanları için yaptığı gibi eski bir
 * değerle birleştirmeye gerek YOKTUR; caller zaten her grubun tüm alanlarını
 * (container moduna göre doğru şekilde boş/dolu) her seferinde yeniden
 * üretir.
 */
function resolveNakliyeCargoGroups(category: string, input: { nakliyeCargoGroups?: unknown }): NakliyeCargoGroup[] | undefined {
  if (!isTransportationCategory(category)) return undefined;
  return sanitizeNakliyeCargoGroups(input.nakliyeCargoGroups);
}

/**
 * Nakliye "Yük Alınacak Yer" (pickup) İÇİN — `resolveLocationFields`in
 * kendisi (yukarıda) Nakliye DAHİL HER kategori için paylaşılan/değişmemiş
 * kalır; bu fonksiyon SADECE Nakliye ilanlarında, `resolveLocationFields`in
 * ürettiği `facilityId`yi il/ilçe kapsamında AYRICA doğrular (görev tanımı
 * madde 5 — veri kayıt katmanı doğrulaması). Nakliye dışı kategorilerde
 * (ya da locationMode "custom" olduğunda, ki resolveLocationFields zaten
 * facilityId'yi orada temizliyor) girdi olduğu gibi geri döner/undefined
 * kalır — mevcut davranış hiç etkilenmez.
 */
function verifiedPickupFacilityId(
  category: string,
  province: string,
  district: string,
  facilityId: string | undefined,
): string | undefined {
  if (!isTransportationCategory(category) || !facilityId) return facilityId;
  return isFacilityInProvinceDistrict(province, district, facilityId) ? facilityId : undefined;
}

export type CreateJobInput = {
  category: string;
  title: string;
  description: string;
  province: string;
  district: string;
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca katalogdan seçildiyse; "Listede yok / Diğer" seçilmişse yoktur. */
  facilityId?: string;
  addressText: string;
  /** Bkz. types.ts#Job.locationMode. */
  locationMode?: "catalog" | "custom";
  workDate: string;
  /** Bkz. types.ts#Job.workEndDate. Opsiyonel: bu alandan önceki çağıranlar/kayıtlar için geriye dönük uyumlu; yeni form akışı bunu doldurup zorunlu kılar. */
  workEndDate?: string;
  /** Bkz. types.ts#Job.productQuantity/productTonnage/productType. Yalnızca category product-catalog.ts#requiresProductInfo kapsamındaysa anlamlıdır — aksi halde resolveProductInfoFields tarafından yok sayılır. */
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı, resolveProductInfoFields diğer kategorilerde HER ZAMAN temizler. */
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
  /** Bkz. types.ts#Job.customsTransactionType/vb. Yalnızca category customs-brokerage-catalog.ts#isCustomsBrokerageCategory kapsamındaysa anlamlıdır — aksi halde resolveCustomsBrokerageFields tarafından yok sayılır. */
  customsTransactionType?: string;
  customsRequestedServices?: string[];
  customsProductType?: string;
  /** Henüz IndexedDB'ye yazılmamış, doğrulanmış evraklar (bkz. JobCustomsDocumentUpload) — `photos` ile AYNI ertelenmiş-yazma deseni. */
  customsDocuments?: ProcessedPhotoInput[];
  /** Bkz. types.ts#Job.deliveryProvince/vb. Yalnızca category nakliye-route.ts#isTransportationCategory kapsamındaysa anlamlıdır — aksi halde resolveDeliveryLocationFields tarafından yok sayılır. */
  deliveryProvince?: string;
  deliveryDistrict?: string;
  deliveryLocationType?: "facility" | "open_address" | "";
  deliveryFacilityId?: string;
  deliveryFacilityName?: string;
  deliveryAddressText?: string;
  /** Bkz. types.ts#Job.recyclingMaterialCategoryId/vb. Yalnızca category recycling-catalog.ts#isRecyclingCategory kapsamındaysa anlamlıdır — aksi halde resolveRecyclingFields tarafından yok sayılır. */
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string[];
  /** Bkz. types.ts#Job.recyclingRequestedOperation. Yalnızca recycling kapsamında; hangi faaliyet yetkilerinin gerektiğini belirler (bkz. getRequiredRecyclingActivities). */
  recyclingRequestedOperation?: string;
  /** Bkz. types.ts#Job.recyclingWasteCode/recyclingWasteCodeUnknown. `recyclingHazardous` HER ZAMAN resolveRecyclingFields tarafından bu koddan yeniden türetilir — çağıranın gönderdiği ham değer asla doğrudan kullanılmaz. */
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  recyclingHazardous?: boolean;
  recyclingHazardProperties?: string[];
  /** Bkz. types.ts#Job.storageProductType/vb. Yalnızca category service-catalog.ts#isStorageGroupCategory kapsamındaysa anlamlıdır — aksi halde resolveStorageProductFields tarafından yok sayılır. */
  storageProductType?: string;
  storageProductQuantity?: number;
  storageProductUnit?: "kg" | "ton" | "adet";
  storageProductTonnage?: number;
  /** Bkz. types.ts#Job.storageContainerGroups. Yalnızca kategori "Konteyner Depolama" iken anlamlıdır — aksi halde resolveStorageProductFields tarafından yok sayılır. */
  storageContainerGroups?: StorageContainerGroup[];
  /** Bkz. types.ts#Job.storageHazardous/storageRiskGroups. Yalnızca storage-hazard-catalog.ts#isHazardousStorageCategory kapsamındaysa anlamlıdır — aksi halde resolveStorageHazardFields tarafından yok sayılır. */
  storageHazardous?: boolean;
  storageRiskGroups?: string[];
  /** Bkz. types.ts#Job.nakliyeDetails. Yalnızca category nakliye-route.ts#isTransportationCategory kapsamındaysa anlamlıdır — aksi halde resolveNakliyeDetails tarafından yok sayılır. */
  nakliyeDetails?: NakliyeDetails;
  /** Bkz. types.ts#Job.nakliyeCargoGroups. Yalnızca category nakliye-route.ts#isTransportationCategory kapsamındaysa anlamlıdır — aksi halde resolveNakliyeCargoGroups tarafından yok sayılır. */
  nakliyeCargoGroups?: NakliyeCargoGroup[];
  operationDetails: string;
  photos: ProcessedPhotoInput[];
};

export type CreateJobResult = { ok: true; job: Job } | { ok: false; error: string };

async function persistPhotosOrRollback(photos: ProcessedPhotoInput[]): Promise<JobPhoto[] | null> {
  const written: JobPhoto[] = [];
  try {
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      const storageKey = crypto.randomUUID();
      await putPhotoBlob(storageKey, photo.blob);
      written.push({
        id: crypto.randomUUID(),
        order: index,
        fileName: photo.fileName,
        fileSize: photo.fileSize,
        mimeType: photo.mimeType,
        storageKey,
      });
    }
    return written;
  } catch {
    // Kısmi yazımdan sonra hata olursa, sahipsiz (ilana bağlanmamış) dosya
    // bırakmamak için o ana kadar yazılmış olan blob'ları geri al.
    await deletePhotoBlobs(written.map((photo) => photo.storageKey));
    return null;
  }
}

/**
 * Bir operasyon grubunu (bkz. createJobsForOperation) oluşturan bağımsız
 * ilanları birbirine bağlayan Job.operationId değerini üretir — projede id
 * üretimi için zaten her yerde kullanılan (bu dosyadaki Job/JobPhoto id'leri,
 * offers.ts/ratings.ts/users.ts) aynı Web Crypto UUID'sini kullanır, yeni
 * bir paket/desen eklemez. Kullanıcıya gösterilecek bir operasyon kodu
 * DEĞİLDİR (bkz. types.ts#Job.operationId) — yalnızca dahili eşleştirme
 * kimliğidir.
 */
export function createOperationId(): string {
  return crypto.randomUUID();
}

/**
 * İlan oluşturma iş kuralları arayüzden bağımsız burada uygulanır: yalnızca
 * Hizmet Alan rolü ilan oluşturabilir, en az 1 en fazla 10 fotoğraf zorunludur.
 * Yeni ilan her zaman "yayinda" durumuyla ve oluşturan kullanıcının id'siyle
 * (requesterId) sistem tarafından oluşturulur. Fotoğraf dosyaları yalnızca
 * ilan kaydı da başarılı olursa IndexedDB'ye yazılır — form/ilan kaydı
 * herhangi bir noktada başarısız olursa hiçbir sahipsiz dosya kalmaz.
 */
export async function createJob(
  session: Session | null,
  input: CreateJobInput,
): Promise<CreateJobResult> {
  if (!session) {
    return { ok: false, error: "İlan oluşturmak için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir." };
  }
  // Depolama İlan Oluşturma: Depo Hizmetleri grubu (bkz. service-catalog.ts#
  // isStorageGroupCategory) için sınırlar 1-10 yerine 4-15'tir (görev
  // gereksinimi, mevcut genel sınırlarla BİLEREK çelişir — bkz. photo-
  // validation.ts#getMinPhotos/getMaxPhotos'ın kendi dokümanı, ÇÖZÜM
  // Depolamaya özel ikinci bir yükleme modülü DEĞİL, bu TEK merkezi
  // sınırın kategoriye duyarlı hâle getirilmesidir). Diğer TÜM kategoriler
  // için davranış BİREBİR eskisiyle aynıdır.
  const jobMinPhotos = getMinPhotos(input.category);
  const jobMaxPhotos = getMaxPhotos(input.category);
  if (input.photos.length < jobMinPhotos) {
    return { ok: false, error: getPhotosRequiredMessage(input.category) };
  }
  if (input.photos.length > jobMaxPhotos) {
    return { ok: false, error: `En fazla ${jobMaxPhotos} fotoğraf yükleyebilirsiniz.` };
  }

  const photos = await persistPhotosOrRollback(input.photos);
  if (!photos) {
    return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Gümrük Müşavirliği'ne özel evraklar: yalnızca kategori kapsamdaysa VE
  // gerçekten evrak varsa persist edilir. Fotoğraflar zaten yazıldıktan
  // SONRA denenir — burada başarısız olursa yukarıda yazılmış fotoğraf
  // blob'ları da geri alınır (yarım bir kayıt hiçbir zaman kalıcı olmaz).
  let customsDocuments: JobCustomsDocument[] = [];
  if (isCustomsBrokerageCategory(input.category) && input.customsDocuments && input.customsDocuments.length > 0) {
    const persistedDocuments = await persistPhotosOrRollback(input.customsDocuments);
    if (!persistedDocuments) {
      await deletePhotoBlobs(photos.map((photo) => photo.storageKey));
      return { ok: false, error: "Belgeler kaydedilemedi. Lütfen tekrar deneyin." };
    }
    customsDocuments = persistedDocuments;
  }

  // İlan Yayın Süresi Yönetimi: kullanıcı yayın süresi seçemez/değiştiremez —
  // sistem `createdAt`/`publishEndAt`i burada, formdan tamamen bağımsız
  // olarak belirler (bkz. job-publish-window.ts, tek doğruluk kaynağı).
  const { createdAt, publishEndAt } = createPublishWindow();
  const jobProvince = input.province.trim();
  const jobDistrict = input.district.trim();
  const job: Job = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    category: input.category,
    province: jobProvince,
    district: jobDistrict,
    ...resolveLocationFields(input),
    workDate: input.workDate,
    workEndDate: input.workEndDate,
    ...resolveProductInfoFields(input.category, input),
    ...resolveCustomsBrokerageFields(input.category, { ...input, customsDocuments }),
    ...resolveDeliveryLocationFields(input.category, input),
    ...resolveRecyclingFields(input.category, input),
    ...resolveStorageProductFields(input.category, input),
    ...resolveStorageHazardFields(input.category, input),
    nakliyeDetails: resolveNakliyeDetails(input.category, input),
    nakliyeCargoGroups: resolveNakliyeCargoGroups(input.category, input),
    description: input.description.trim(),
    operationDetails: input.operationDetails.trim(),
    status: "yayinda",
    requesterId: session.id,
    photos,
    createdAt,
    publishEndAt,
    // İlan Onayı: her yeni ilan admin incelemesi bekler — bkz. job-moderation.ts.
    moderationStatus: "pending_review",
  };
  job.facilityId = verifiedPickupFacilityId(job.category, jobProvince, jobDistrict, job.facilityId);

  const all = readUserCreatedJobsSnapshot();
  if (!writeUserCreatedJobs([...all, job])) {
    // Fotoğraflar/evraklar zaten IndexedDB'ye yazıldı (yukarıda) ama ilan
    // kaydı hiçbir yere bağlanamadı — sahipsiz blob bırakmamak için geri
    // alınır (persistPhotosOrRollback'teki kısmi-yazım geri alma ile aynı
    // gerekçe).
    await deletePhotoBlobs([...photos, ...customsDocuments].map((item) => item.storageKey));
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, job };
}

/**
 * Bir operasyondaki TEK bir hizmetin kendine özgü alanları — Aşama 2.2
 * itibarıyla `category`/`workDate`/`workEndDate`nin yanı sıra `title`/
 * `description`/konum alanları da (bkz. types.ts#Job'un aynı adlı alanları)
 * artık PER-SERVICE'tir; hiçbiri operasyon genelinde paylaşılmaz. Yalnızca
 * `province` (Türkiye geneli serbestçe seçilebilir, yalnızca Kocaeli
 * varsayılan başlangıç değeridir), `operationDetails` ve `photos` gerçekten
 * ortaktır (bkz. CreateJobsForOperationInput).
 */
export type OperationServiceInput = {
  /** service-catalog.ts#SERVICE_CATEGORY_GROUPS'a ait bir hizmet kategorisi id'si. */
  category: string;
  title: string;
  description: string;
  workDate: string;
  workEndDate: string;
  /**
   * Bu hizmetin KENDİ ili — YALNIZCA isTransportationCategory(category) true
   * iken anlamlıdır (Nakliye'nin Yük Alınacak Yer'i artık serbestçe
   * seçilebilir, operasyonun paylaşılan `province`sinden BAĞIMSIZDIR). Diğer
   * kardeş hizmetler bu alanı hiç göndermez — bu durumda job-store.ts kendi
   * içinde operasyonun paylaşılan `province`sini (`CreateJobsForOperationInput.province`,
   * artık Türkiye geneli serbestçe seçilebilir) kullanmaya devam eder;
   * mevcut davranış hiç değişmez.
   */
  province?: string;
  district: string;
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca katalogdan seçildiyse; "Listede yok / Diğer" seçilmişse yoktur. */
  facilityId?: string;
  addressText: string;
  /** Bkz. types.ts#Job.locationMode. */
  locationMode?: "catalog" | "custom";
  /** Bkz. types.ts#Job.productQuantity/productTonnage/productType — her hizmet kendi ürün bilgisini bağımsız taşır. */
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı, resolveProductInfoFields diğer kategorilerde HER ZAMAN temizler. */
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
  /** Bkz. types.ts#Job.customsTransactionType/vb. — YALNIZCA isCustomsBrokerageCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveCustomsBrokerageFields). */
  customsTransactionType?: string;
  customsRequestedServices?: string[];
  customsProductType?: string;
  /** Henüz IndexedDB'ye yazılmamış, doğrulanmış evraklar — bkz. CreateJobInput.customsDocuments. */
  customsDocuments?: ProcessedPhotoInput[];
  /** Bkz. types.ts#Job.deliveryProvince/vb. — YALNIZCA isTransportationCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveDeliveryLocationFields). */
  deliveryProvince?: string;
  deliveryDistrict?: string;
  deliveryLocationType?: "facility" | "open_address" | "";
  deliveryFacilityId?: string;
  deliveryFacilityName?: string;
  deliveryAddressText?: string;
  /** Bkz. types.ts#Job.recyclingMaterialCategoryId/vb. — YALNIZCA isRecyclingCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveRecyclingFields). */
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string[];
  recyclingRequestedOperation?: string;
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  recyclingHazardous?: boolean;
  recyclingHazardProperties?: string[];
  /** Bkz. types.ts#Job.storageProductType/vb. — YALNIZCA isStorageGroupCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveStorageProductFields). */
  storageProductType?: string;
  storageProductQuantity?: number;
  storageProductUnit?: "kg" | "ton" | "adet";
  storageProductTonnage?: number;
  storageContainerGroups?: StorageContainerGroup[];
  storageHazardous?: boolean;
  storageRiskGroups?: string[];
  /** Bkz. types.ts#Job.nakliyeDetails — YALNIZCA isTransportationCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveNakliyeDetails). */
  nakliyeDetails?: NakliyeDetails;
  /** Bkz. types.ts#Job.nakliyeCargoGroups — YALNIZCA isTransportationCategory(category) true olan hizmet kartında anlamlıdır; diğer kardeş hizmetlere hiç kopyalanmaz (bkz. resolveNakliyeCargoGroups). */
  nakliyeCargoGroups?: NakliyeCargoGroup[];
};

/**
 * Aşama 2.2: yalnızca gerçekten operasyon genelinde paylaşılan üç alan
 * kaldı — `province` (MALSEVK'in tek desteklediği il), `operationDetails`
 * (ekipman/PPE gibi operasyon-geneli notlar) ve `photos` (tek bir yükleme,
 * her ilana AYRI AYRI kopyalanır, bkz. aşağıdaki fonksiyon dokümantasyonu).
 * Başlık/açıklama/tarih/konum artık `services[]`'in içinde, hizmet başına.
 */
export type CreateJobsForOperationInput = {
  province: string;
  operationDetails: string;
  photos: ProcessedPhotoInput[];
  /** En az 2, TEKİL (yinelenmeyen) hizmet — her biri kendi kategorisini, başlığını, açıklamasını, tarih aralığını ve konumunu taşır. */
  services: OperationServiceInput[];
};

export type CreateJobsForOperationResult =
  | { ok: true; jobs: Job[]; operationId: string }
  | { ok: false; error: string };

/**
 * Çoklu Hizmet Operasyonu — Aşama 2.2 itibarıyla `job-request-form.tsx`
 * tarafından çağrılıyor. Bir Hizmet Alan'ın TEK formda seçtiği BİRDEN FAZLA
 * hizmetin her biri için bağımsız bir `Job` kaydı oluşturur; hepsi aynı (bu
 * çağrıda üretilen, bkz. createOperationId) `operationId` ile birbirine
 * bağlanır. Yalnızca `province`/`operationDetails`/fotoğraflar ortaktır
 * (aşağıda); `title`/`description`/tarih/konum HER hizmetin kendi
 * `OperationServiceInput` girdisinden gelir — `resolveLocationFields`,
 * trim vb. aynı `createJob` ile PAYLAŞILAN kuralları hizmet başına uygular.
 *
 * TEK hizmet için BU FONKSİYON KULLANILMAZ — `createJob` (yukarıda) bugünkü
 * tek-ilan akışı için DEĞİŞMEDEN kalır; `input.services.length < 2` burada
 * AÇIKÇA reddedilir (bkz. rapor: "tek hizmet davranışı" kararı — bu fonksiyon
 * createJob'a örtük olarak yönlendirme YAPMAZ; `job-request-form.tsx`
 * seçilen hizmet sayısına göre iki fonksiyondan hangisini çağıracağına kendi
 * karar verir).
 *
 * ATOMİKLİK: gerçek bir veritabanı işlemi (transaction) yok — bu yüzden
 * "hepsi ya da hiçbiri" garantisi burada ELLE sağlanır: ÖNCE tüm girdiler
 * doğrulanır (kategori sayısı/tekilliği/geçerliliği, HER hizmetin kendi
 * tarih aralığı, fotoğraf sayısı), SONRA her hizmet için fotoğraflar ayrı
 * ayrı IndexedDB'ye yazılır (bkz. persistPhotosOrRollback) — bunlardan biri
 * başarısız olursa o ana kadar başarıyla yazılmış TÜM kardeş fotoğraf
 * setleri geri alınır (silinir) ve `Job` kayıtları hiç localStorage'a
 * YAZILMAZ. Yalnızca TÜM fotoğraf setleri başarıyla yazıldıktan SONRA,
 * hazırlanan `Job[]` TEK bir `writeUserCreatedJobs` çağrısıyla (tek
 * `localStorage.setItem`, bkz. o fonksiyon) topluca kaydedilir — böylece
 * yarım bir operasyon (bazı ilanlar kaydedilmiş, bazıları değil) hiçbir
 * zaman oluşamaz.
 *
 * Fotoğraflar HER ilan için AYRI AYRI persistPhotosOrRollback ile (aynı
 * `input.photos` Blob'ları yeniden kullanılarak — Blob'lar IndexedDB'ye
 * structured-clone ile yazıldığı için tüketilmez/transfer edilmez, tekrar
 * tekrar okunabilir — ama her seferinde YENİ storageKey üretilerek)
 * kaydedilir: kardeş ilanlar arasında AYNI storageKey PAYLAŞILMAZ. Aksi
 * halde bir kardeş ilan silindiğinde (deleteJob/deleteJobPhoto) onun
 * fotoğraf blob'unun silinmesi, storageKey'i paylaşan diğer kardeş ilanın
 * fotoğrafını da kırardı — "Her ilan ... bakımından bağımsızdır" kuralı bunu
 * yasaklar. Bedeli: aynı fotoğraf içeriği IndexedDB'de hizmet sayısı kadar
 * tekrarlanır — bilinçli bir bağımsızlık/güvenlik tercihidir, depolama
 * verimliliği değil.
 */
export async function createJobsForOperation(
  session: Session | null,
  input: CreateJobsForOperationInput,
): Promise<CreateJobsForOperationResult> {
  if (!session) {
    return { ok: false, error: "İlan oluşturmak için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir." };
  }

  if (input.services.length === 0) {
    return { ok: false, error: "En az bir hizmet seçilmelidir." };
  }
  if (input.services.length < 2) {
    return {
      ok: false,
      error:
        "Bu işlem yalnızca birden fazla hizmet seçildiğinde kullanılabilir. Tek hizmet için mevcut ilan oluşturma akışı (createJob) kullanılmalıdır.",
    };
  }
  const categories = input.services.map((service) => service.category);
  if (new Set(categories).size !== categories.length) {
    return { ok: false, error: "Aynı hizmet birden fazla kez seçilemez." };
  }
  if (!categories.every((categoryId) => isServiceCategoryId(categoryId))) {
    return { ok: false, error: "Geçersiz hizmet kategorisi seçildi." };
  }

  // Her hizmetin KENDİ tarih aralığı geçerli olmalı — createJob'ın (tekil
  // workDate'i hiç doğrulamayan, bunu tamamen forma bırakan) davranışından
  // BİLEREK farklı: burada birden fazla bağımsız tarih çifti aynı çağrıda
  // bir arada geldiği için (form yeni de olsa) veri katmanında ayrıca
  // doğrulanması, ileride bu fonksiyonu formdan farklı/eksik bir doğrulamayla
  // çağıracak bir başka çağıranın tutarsız tarih aralığı kaydetmesini önler.
  for (const service of input.services) {
    const start = new Date(service.workDate).getTime();
    const end = new Date(service.workEndDate).getTime();
    const label = getServiceCategoryLabel(service.category) ?? service.category;
    if (service.workDate.trim().length === 0 || Number.isNaN(start)) {
      return { ok: false, error: `${label} için geçerli bir başlangıç tarihi giriniz.` };
    }
    if (service.workEndDate.trim().length === 0 || Number.isNaN(end)) {
      return { ok: false, error: `${label} için geçerli bir bitiş tarihi giriniz.` };
    }
    if (end < start) {
      return { ok: false, error: `${label} için bitiş tarihi başlangıç tarihinden önce olamaz.` };
    }
  }

  if (input.photos.length < MIN_PHOTOS) {
    return { ok: false, error: PHOTOS_REQUIRED_MESSAGE };
  }
  if (input.photos.length > MAX_PHOTOS) {
    return { ok: false, error: `En fazla ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz.` };
  }

  const operationId = createOperationId();
  const province = input.province.trim();
  const operationDetails = input.operationDetails.trim();

  // Her hizmet için AYRI bir fotoğraf seti kaydedilir (bkz. yukarıdaki
  // dokümantasyon notu) — biri başarısız olursa o ana kadar yazılmış
  // olanlar geri alınır, hiçbir Job kaydı yazılmadan hata döner.
  const persistedPhotoSets: JobPhoto[][] = [];
  // Gümrük Müşavirliği'ne özel evraklar: YALNIZCA o kategorideki hizmet
  // kartı için persist edilir (bkz. resolveCustomsBrokerageFields'ın kendi
  // dokümantasyonu — "kardeşlere kopyalanmaz" kuralının uygulama noktası
  // burasıdır). Diğer her hizmet için bu dizide her zaman boş bir set
  // bulunur — `persistedPhotoSets` ile AYNI index sırasını takip eder ki
  // aşağıdaki `jobs` haritalamasında ikisi birlikte güvenle okunabilsin.
  const persistedCustomsDocumentSets: JobCustomsDocument[][] = [];
  for (let index = 0; index < input.services.length; index++) {
    const service = input.services[index];
    const photos = await persistPhotosOrRollback(input.photos);
    if (!photos) {
      await Promise.all([
        ...persistedPhotoSets.map((set) => deletePhotoBlobs(set.map((photo) => photo.storageKey))),
        ...persistedCustomsDocumentSets.map((set) => deletePhotoBlobs(set.map((doc) => doc.storageKey))),
      ]);
      return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
    }
    persistedPhotoSets.push(photos);

    const rawCustomsDocuments =
      isCustomsBrokerageCategory(service.category) && service.customsDocuments ? service.customsDocuments : [];
    if (rawCustomsDocuments.length === 0) {
      persistedCustomsDocumentSets.push([]);
      continue;
    }
    const documents = await persistPhotosOrRollback(rawCustomsDocuments);
    if (!documents) {
      await Promise.all([
        ...persistedPhotoSets.map((set) => deletePhotoBlobs(set.map((photo) => photo.storageKey))),
        ...persistedCustomsDocumentSets.map((set) => deletePhotoBlobs(set.map((doc) => doc.storageKey))),
      ]);
      return { ok: false, error: "Belgeler kaydedilemedi. Lütfen tekrar deneyin." };
    }
    persistedCustomsDocumentSets.push(documents);
  }

  // İlan Yayın Süresi Yönetimi: aynı operasyondaki TÜM hizmetler aynı
  // anda (bu tek çağrıda) oluşturulduğu için AYNI `createdAt`/`publishEndAt`
  // çiftini paylaşır — her biri kendi bağımsız Job kaydında taşır (bkz.
  // job-publish-window.ts'in "her ilan kendi oluşturulma zamanına göre"
  // notu: burada hepsinin oluşturulma zamanı gerçekten aynı andır, bu yüzden
  // paylaşmak veri uydurmak değildir).
  const { createdAt, publishEndAt } = createPublishWindow();
  const jobs: Job[] = input.services.map((service, index) => {
    const serviceProvince =
      isTransportationCategory(service.category) && service.province?.trim() ? service.province.trim() : province;
    const serviceDistrict = service.district.trim();
    const job: Job = {
      id: crypto.randomUUID(),
      title: service.title.trim(),
      category: service.category,
      province: serviceProvince,
      district: serviceDistrict,
      ...resolveLocationFields(service),
      workDate: service.workDate,
      workEndDate: service.workEndDate,
      ...resolveProductInfoFields(service.category, service),
      ...resolveCustomsBrokerageFields(service.category, {
        ...service,
        customsDocuments: persistedCustomsDocumentSets[index],
      }),
      ...resolveDeliveryLocationFields(service.category, service),
      ...resolveRecyclingFields(service.category, service),
      ...resolveStorageProductFields(service.category, service),
      ...resolveStorageHazardFields(service.category, service),
      nakliyeDetails: resolveNakliyeDetails(service.category, service),
      nakliyeCargoGroups: resolveNakliyeCargoGroups(service.category, service),
      description: service.description.trim(),
      operationDetails,
      status: "yayinda",
      requesterId: session.id,
      operationId,
      photos: persistedPhotoSets[index],
      createdAt,
      publishEndAt,
      // İlan Onayı: createJob ile AYNI kural — her yeni hizmet kendi
      // moderasyon durumunu bağımsız taşır (bkz. types.ts#Job.moderationStatus
      // doc yorumu ve görev bölüm 10 — job-bazlı, operasyon-bazlı DEĞİL).
      moderationStatus: "pending_review",
    };
    job.facilityId = verifiedPickupFacilityId(job.category, serviceProvince, serviceDistrict, job.facilityId);
    return job;
  });

  const all = readUserCreatedJobsSnapshot();
  if (!writeUserCreatedJobs([...all, ...jobs])) {
    // Her hizmet için ayrı ayrı persistlenmiş TÜM fotoğraf/evrak setleri
    // (yukarıda) hiçbir ilana bağlanamadan sahipsiz kalmasın diye geri
    // alınır — "hepsi ya da hiçbiri" atomikliğinin yazma başarısızlığına da
    // uygulanmış hali.
    await Promise.all([
      ...persistedPhotoSets.map((set) => deletePhotoBlobs(set.map((photo) => photo.storageKey))),
      ...persistedCustomsDocumentSets.map((set) => deletePhotoBlobs(set.map((doc) => doc.storageKey))),
    ]);
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, jobs, operationId };
}

export type UpdateJobInput = {
  title: string;
  category: string;
  province: string;
  district: string;
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca katalogdan seçildiyse; "Listede yok / Diğer" seçilmişse yoktur. */
  facilityId?: string;
  addressText: string;
  /** Bkz. types.ts#Job.locationMode. */
  locationMode?: "catalog" | "custom";
  workDate: string;
  /** Bkz. types.ts#Job.workEndDate. Opsiyonel: verilmezse (undefined) mevcut kayıttaki değer korunur — job-edit-form.tsx her zaman bir değer gönderir, bu yalnızca geriye dönük uyumluluk içindir. */
  workEndDate?: string;
  /** Bkz. types.ts#Job.productQuantity/productTonnage/productType. category artık ürün bilgisi gerektirmiyorsa (kategori değiştirildiyse) resolveProductInfoFields üçünü de temizler. */
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı, resolveProductInfoFields diğer kategorilerde HER ZAMAN temizler. */
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
  /** Bkz. types.ts#Job.customsTransactionType/vb. category artık Gümrük Müşavirliği değilse (kategori değiştirildiyse) resolveCustomsBrokerageFields dördünü de (evraklar dahil) temizler. */
  customsTransactionType?: string;
  customsRequestedServices?: string[];
  customsProductType?: string;
  /** Bkz. types.ts#Job.deliveryProvince/vb. category artık Nakliye değilse (kategori değiştirildiyse) resolveDeliveryLocationFields yedisini de temizler. */
  deliveryProvince?: string;
  deliveryDistrict?: string;
  deliveryLocationType?: "facility" | "open_address" | "";
  deliveryFacilityId?: string;
  deliveryFacilityName?: string;
  deliveryAddressText?: string;
  /** Bkz. types.ts#Job.recyclingMaterialCategoryId/vb. category artık Geri Dönüşüm & Atık Tahliye değilse (kategori değiştirildiyse) resolveRecyclingFields tamamını temizler. */
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string[];
  recyclingRequestedOperation?: string;
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  recyclingHazardous?: boolean;
  recyclingHazardProperties?: string[];
  /** Bkz. types.ts#Job.storageProductType/vb. category artık Depo Hizmetleri grubunda değilse (kategori değiştirildiyse) resolveStorageProductFields dördünü de temizler. */
  storageProductType?: string;
  storageProductQuantity?: number;
  storageProductUnit?: "kg" | "ton" | "adet";
  storageProductTonnage?: number;
  storageContainerGroups?: StorageContainerGroup[];
  storageHazardous?: boolean;
  storageRiskGroups?: string[];
  /** Bkz. types.ts#Job.nakliyeDetails. category artık Nakliye değilse (kategori değiştirildiyse) resolveNakliyeDetails temizler. */
  nakliyeDetails?: NakliyeDetails;
  /** Bkz. types.ts#Job.nakliyeCargoGroups. category artık Nakliye değilse (kategori değiştirildiyse) resolveNakliyeCargoGroups temizler. */
  nakliyeCargoGroups?: NakliyeCargoGroup[];
  description: string;
  operationDetails: string;
  /** Korunacak mevcut fotoğrafların id'leri (silinenler bu listede olmaz). */
  keptPhotoIds: string[];
  /** Bu düzenlemede eklenen, henüz IndexedDB'ye yazılmamış yeni fotoğraflar. */
  newPhotos: ProcessedPhotoInput[];
  /** Korunacak mevcut Gümrük Müşavirliği evraklarının id'leri (bkz. keptPhotoIds ile AYNI desen). */
  keptCustomsDocumentIds: string[];
  /** Bu düzenlemede eklenen, henüz IndexedDB'ye yazılmamış yeni evraklar (bkz. newPhotos ile AYNI desen). */
  newCustomsDocuments: ProcessedPhotoInput[];
};

/**
 * Mevcut bir ilanı günceller — id, status ve requesterId hiç değişmez, yeni
 * bir ilan oluşturulmaz. Yalnızca ilanın sahibi olan Hizmet Alan, VE
 * yalnızca ilan hâlâ düzenlenebilir durumdaysa (bkz. `offers` parametresi
 * ve job-requests.ts#isJobEditable) çağırabilir. Fotoğraflarda:
 * `keptPhotoIds`'te olmayan eski fotoğrafların blob'ları silinir,
 * `newPhotos` işlenip eklenir, `keptPhotoIds`'teki fotoğraflara hiç
 * dokunulmaz (yeniden yüklenmez/yeniden işlenmez). Teklifler (Offer
 * kayıtları) ayrı bir depoda (offers.ts) tutulduğu için bu fonksiyon
 * onlara hiç YAZMAZ — ilan id'si değişmediğinden bağlantıları kendiliğinden
 * korunur. `offers` parametresi yalnızca OKUMA amaçlı: çağıran taraf
 * (job-edit-form.tsx) zaten elindeki güncel teklif listesini buraya
 * geçirir; job-store.ts kendisi offers.ts'i import ETMEZ (offers.ts zaten
 * job-store.ts'e bağımlı olduğu için döngüsel import olurdu, bkz. deleteJob
 * üstündeki not) — bu yüzden liste çağıran taraftan taşınır.
 */
export async function updateJob(
  session: Session | null,
  jobId: string,
  input: UpdateJobInput,
  offers: Offer[],
): Promise<CreateJobResult> {
  if (!session) {
    return { ok: false, error: "İlanı düzenlemek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan düzenleyebilir." };
  }

  const existing = findUserCreatedJobById(jobId);
  if (!existing || existing.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }
  // İlan Kapatma: kapatılmış bir ilan artık aktif sayılmadığından (bkz.
  // job-closure.ts) düzenleme de anlamsızdır — `isJobEditable`in kendisi
  // teklif durumlarına bakar, kapatma ise tamamen ayrı/manuel bir işlemdir,
  // bu yüzden burada AYRICA kontrol edilir. Aynı, mevcut hata mesajı
  // kullanılır (yeni bir metin icat edilmez).
  if (!isJobEditable(jobId, offers) || isJobManuallyClosed(existing)) {
    return { ok: false, error: JOB_NOT_EDITABLE_MESSAGE };
  }

  const keptPhotos = existing.photos.filter((photo) => input.keptPhotoIds.includes(photo.id));
  const totalPhotoCount = keptPhotos.length + input.newPhotos.length;
  // Bkz. createJob'daki AYNI "Depolama İlan Oluşturma" notu — düzenlenen
  // ilanın (olası yeni) kategorisi (input.category ?? existing.category)
  // Depo Hizmetleri grubundaysa sınırlar 4-15'tir, aksi halde 1-10.
  const editMinPhotos = getMinPhotos(input.category ?? existing.category);
  const editMaxPhotos = getMaxPhotos(input.category ?? existing.category);
  if (totalPhotoCount < editMinPhotos) {
    return { ok: false, error: getPhotosRequiredMessage(input.category ?? existing.category) };
  }
  if (totalPhotoCount > editMaxPhotos) {
    return { ok: false, error: `En fazla ${editMaxPhotos} fotoğraf yükleyebilirsiniz.` };
  }

  const newlyPersisted = await persistPhotosOrRollback(input.newPhotos);
  if (!newlyPersisted) {
    return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Gümrük Müşavirliği evrakları: fotoğraflarla AYNI kept+new deseni.
  // `newCustomsDocuments` boşsa persistPhotosOrRollback hiç çağrılmaz (boş
  // dizi zaten geçerli bir "başarı" sonucudur, gereksiz bir IndexedDB
  // turu atlanır).
  const keptCustomsDocuments = (existing.customsDocuments ?? []).filter((doc) =>
    input.keptCustomsDocumentIds.includes(doc.id),
  );
  const newlyPersistedCustomsDocuments =
    input.newCustomsDocuments.length > 0 ? await persistPhotosOrRollback(input.newCustomsDocuments) : [];
  if (!newlyPersistedCustomsDocuments) {
    // Yukarıda zaten persistlenmiş YENİ fotoğraflar da geri alınır — bu
    // düzenleme isteği bir bütün olarak başarısız sayılır (bkz. createJob'daki
    // AYNI "fotoğraf başarılı, evrak başarısız" geri alma sırası).
    await deletePhotoBlobs(newlyPersisted.map((photo) => photo.storageKey));
    return { ok: false, error: "Belgeler kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const combinedPhotos: JobPhoto[] = [...keptPhotos, ...newlyPersisted].map((photo, index) => ({
    ...photo,
    order: index,
  }));
  const combinedCustomsDocuments: JobCustomsDocument[] = [...keptCustomsDocuments, ...newlyPersistedCustomsDocuments];

  const updatedProvince = input.province.trim();
  const updatedDistrict = input.district.trim();
  const updated: Job = {
    ...existing,
    title: input.title.trim(),
    category: input.category,
    province: updatedProvince,
    district: updatedDistrict,
    ...resolveLocationFields(input),
    workDate: input.workDate,
    workEndDate: input.workEndDate ?? existing.workEndDate,
    ...resolveProductInfoFields(input.category, input),
    ...resolveCustomsBrokerageFields(input.category, { ...input, customsDocuments: combinedCustomsDocuments }),
    ...resolveDeliveryLocationFields(input.category, input),
    ...resolveRecyclingFields(input.category, input),
    ...resolveStorageProductFields(input.category, input),
    ...resolveStorageHazardFields(input.category, input),
    nakliyeDetails: resolveNakliyeDetails(input.category, input, existing.nakliyeDetails),
    nakliyeCargoGroups: resolveNakliyeCargoGroups(input.category, input),
    description: input.description.trim(),
    operationDetails: input.operationDetails.trim(),
    photos: combinedPhotos,
  };
  updated.facilityId = verifiedPickupFacilityId(updated.category, updatedProvince, updatedDistrict, updated.facilityId);

  // İlan Onayı — görev bölüm 9: ilan sahibi, admin tarafından zaten
  // karara bağlanmış (approved/rejected) bir ilanın içeriğini etkileyen bir
  // alanı değiştirirse eski karar artık geçerli sayılmaz, ilan yeniden
  // incelemeye alınır (bkz. job-moderation.ts#didCriticalJobContentChange —
  // yalnızca görevin listelediği "içerik" alanları kritik sayılır; salt
  // fotoğraf/operationDetails değişikliği gereksiz bir yeniden inceleme
  // OLUŞTURMAZ). Zaten "pending_review" olan bir ilan bu dalda hiç
  // değişmez — halihazırda incelemeyi bekliyor. Admin'in KENDİ düzenlemesi
  // (admin-job-edit-form.tsx -> update_job_as_admin) bu fonksiyonu hiç
  // çağırmaz, bu kural yalnızca sahibinin kendi düzenleme yoluna uygulanır.
  if (getJobModerationStatus(existing) !== "pending_review" && didCriticalJobContentChange(existing, updated)) {
    updated.moderationStatus = "pending_review";
    updated.moderationReviewedAt = undefined;
    updated.moderationReviewedBy = undefined;
    updated.moderationRejectionReason = undefined;
  }

  const all = readUserCreatedJobsSnapshot();
  if (!writeUserCreatedJobs(all.map((item) => (item.id === jobId ? updated : item)))) {
    // Bu düzenlemede eklenen YENİ fotoğraflar/evraklar (yukarıda persistlenmiş)
    // hiçbir ilana bağlanamadan sahipsiz kalmasın diye geri alınır. Mevcut
    // (korunan) fotoğraflara/evraklara hiç dokunulmaz — eski kayıt
    // localStorage'da olduğu gibi durur, kullanıcı hâlâ eski hâline erişebilir.
    await deletePhotoBlobs([...newlyPersisted, ...newlyPersistedCustomsDocuments].map((item) => item.storageKey));
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  // Kayıt başarıyla güncellendikten SONRA artık kullanılmayan eski
  // fotoğraf/evrak blob'larını sil — sıra önemli: kayıt önce, silme sonra, ki
  // arada bir hata olsa bile kullanıcı eski fotoğraflarına/evraklarına erişebilsin.
  const removedPhotos = existing.photos.filter((photo) => !input.keptPhotoIds.includes(photo.id));
  if (removedPhotos.length > 0) {
    await deletePhotoBlobs(removedPhotos.map((photo) => photo.storageKey));
  }
  // DÜZELTME (O7, veritabanı geçişi öncesi denetim): eskiden bu liste yalnızca
  // `input.keptCustomsDocumentIds`e bakıyordu — kategori Gümrük
  // Müşavirliği'nden BAŞKA bir kategoriye değiştirildiğinde ise
  // `resolveCustomsBrokerageFields` (yukarıda) `updated.customsDocuments`ı
  // SESSİZCE `undefined` yapar, ama form hâlâ eski belge id'lerini "kept"
  // olarak gönderiyorsa `removedCustomsDocuments` BOŞ çıkıyordu — evraklar
  // artık hiçbir kayıt tarafından referans edilmediği hâlde blob'ları hiç
  // silinmiyordu (sahipsiz/orphan kalıyordu). Artık ESKİ belgeler (+ bu
  // çağrıda yeni yüklenmiş ama nihai sonuçta kullanılmayan belgeler)
  // `updated.customsDocuments`ın GERÇEK/NİHAİ (resolveCustomsBrokerageFields
  // sonrası) haliyle karşılaştırılıyor — kategori değişikliği dahil her
  // durumda doğru sonuç verir.
  const finalCustomsDocumentIds = new Set((updated.customsDocuments ?? []).map((doc) => doc.id));
  const orphanedCustomsDocuments = [...(existing.customsDocuments ?? []), ...newlyPersistedCustomsDocuments].filter(
    (doc) => !finalCustomsDocumentIds.has(doc.id),
  );
  if (orphanedCustomsDocuments.length > 0) {
    await deletePhotoBlobs(orphanedCustomsDocuments.map((doc) => doc.storageKey));
  }

  return { ok: true, job: updated };
}

export type AdminModerationDecision =
  | { status: "approved"; reviewedBy: string }
  | { status: "rejected"; reviewedBy: string; reason: string };

/**
 * Admin onay/red kararının bu TARAYICININ paylaşılan localStorage ilan
 * havuzuna best-effort yansıması — bkz. admin-jobs.ts#approveJobAsAdmin/
 * rejectJobAsAdmin, ki gerçek yetkilendirme sınırı olan Supabase
 * `approve_job_as_admin`/`reject_job_as_admin` RPC'lerini bu fonksiyondan
 * ÖNCE çağırır. Bu fonksiyonun kendisi hiçbir session/rol kontrolü YAPMAZ
 * (yetkilendirme zaten Supabase RPC'sinde gerçekleşti) — bir GÜVENLİK sınırı
 * DEĞİLDİR, yalnızca bu ilan bu tarayıcıda da mevcutsa (Hizmet Alan/Hizmet
 * Veren/Admin aynı origin'i paylaştığı demo/geliştirme/test ortamında, bkz.
 * proje raporu "No real backend" notu) etkisi olur; farklı bir cihazdaki
 * gerçek bir kullanıcıya asla ulaşmaz. Eşleşen ilan bu tarayıcıda yoksa
 * (`false` döner) çağıran taraf bunu sessizce best-effort sayar, hata
 * saymaz — tıpkı supabase-job-sync.ts'in ters yönlü (localStorage ->
 * Supabase) senkronunun kendi başarısızlığını sessizce yutması gibi.
 */
export function applyAdminModerationDecision(jobId: string, decision: AdminModerationDecision): boolean {
  const all = readUserCreatedJobsSnapshot();
  const index = all.findIndex((job) => job.id === jobId);
  if (index === -1) return false;

  const updated: Job = {
    ...all[index],
    moderationStatus: decision.status,
    moderationReviewedAt: new Date().toISOString(),
    moderationReviewedBy: decision.reviewedBy,
    moderationRejectionReason: decision.status === "rejected" ? decision.reason : undefined,
  };
  const next = [...all];
  next[index] = updated;
  return writeUserCreatedJobs(next);
}

/**
 * "Kritik İlan Senkronizasyonu" görevi — bkz. types.ts#Job.supabaseSyncFailedAt
 * için tam dokümantasyon. `job-request-form.tsx`nin gönderim akışı, yerel
 * yazım BAŞARILI olduktan sonra Supabase senkronu BAŞARISIZ olursa bu
 * fonksiyonu çağırır — `applyAdminModerationDecision` ile AYNI "bu ilan bu
 * tarayıcıda mevcutsa etkisi olur" deseni (bulunamazsa sessizce `false`).
 */
export function markJobSupabaseSyncFailed(jobId: string, error: string): boolean {
  const all = readUserCreatedJobsSnapshot();
  const index = all.findIndex((job) => job.id === jobId);
  if (index === -1) return false;

  const updated: Job = {
    ...all[index],
    supabaseSyncFailedAt: new Date().toISOString(),
    supabaseSyncError: error,
  };
  const next = [...all];
  next[index] = updated;
  return writeUserCreatedJobs(next);
}

/** Bkz. markJobSupabaseSyncFailed — bir yeniden deneme (retryJobSupabaseSync, supabase-job-sync.ts) başarılı olduğunda çağrılır. */
export function clearJobSupabaseSyncFailure(jobId: string): boolean {
  const all = readUserCreatedJobsSnapshot();
  const index = all.findIndex((job) => job.id === jobId);
  if (index === -1) return false;

  const updated: Job = { ...all[index], supabaseSyncFailedAt: undefined, supabaseSyncError: undefined };
  const next = [...all];
  next[index] = updated;
  return writeUserCreatedJobs(next);
}

export type AdminJobEditInput = {
  title: string;
  description: string;
  province: string;
  district: string;
  workLocationType: string;
  addressText: string;
  workDate: string;
  workEndDate?: string;
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı, resolveProductInfoFields diğer kategorilerde HER ZAMAN temizler. */
  productTonnageUnit?: "ton" | "kg";
  productType?: string;
  customsProductType?: string;
  /** "Kritik İlan Senkronizasyonu" görevi bölüm 4 denetiminde bulunan boşluk — `customsProductType`'ın aksine bu ikisi daha önce hiç buraya taşınmamıştı, admin bu iki alanı ASLA değiştiremiyordu. */
  customsTransactionType?: string;
  customsRequestedServices?: string[];
  deliveryFacilityName?: string;
  deliveryAddressText?: string;
  operationDetails?: string;
  neighborhood?: string;
  locationUrl?: string;
  directionsNote?: string;
  deliveryProvince?: string;
  deliveryDistrict?: string;
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string[];
  recyclingRequestedOperation?: string;
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  recyclingHazardProperties?: string[];
  storageProductType?: string;
  storageProductQuantity?: number;
  storageProductUnit?: "kg" | "ton" | "adet";
  storageProductTonnage?: number;
  storageContainerGroups?: StorageContainerGroup[];
  storageHazardous?: boolean;
  storageRiskGroups?: string[];
  /** Bkz. types.ts#NakliyeDetails.loadPreparationType/loadPreparationCustomText — yalnızca Nakliye ilanlarında admin-job-edit-form.tsx tarafından gönderilir. */
  nakliyeLoadPreparationType?: string;
  nakliyeLoadPreparationCustomText?: string;
  /** Bkz. types.ts#NakliyeLoadingOperations.loadingMethod/loadingMethodCustomText. */
  nakliyeLoadingMethod?: string;
  nakliyeLoadingMethodCustomText?: string;
  /** "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi — bkz. types.ts#NakliyeMeasurementInfo. */
  nakliyeMeasurementInfo?: NakliyeMeasurementInfo;
  /** "Konteyner Taşıması ve ADR Bağımsız Bölümleri" görevi — bkz. types.ts#NakliyeHazmatDetail/NakliyeContainerTransport. */
  nakliyeHazmat?: NakliyeHazmatDetail;
  nakliyeContainerTransport?: NakliyeContainerTransport;
  /** "Nakliye Çoklu Yük Grubu" görevi — bkz. types.ts#Job.nakliyeCargoGroups. */
  nakliyeCargoGroups?: NakliyeCargoGroup[];
};

/**
 * Admin'in ilan içeriğini düzeltmesinin, `applyAdminModerationDecision` ile
 * AYNI "yalnızca bu tarayıcıda mevcutsa etkisi olur" sınırına sahip yerel
 * yansıması — gerçek yetkilendirme sınırı `update_job_as_admin` RPC'sidir
 * (bkz. admin-jobs.ts#updateJobAsAdmin, bu fonksiyondan ÖNCE çağrılır). Bu
 * yüzden `updateJob`ın (yukarıda) sahiplik/teklif-durumu kontrollerini VE
 * `didCriticalJobContentChange` yeniden-inceleme tetikleyicisini KASITLI
 * OLARAK atlar — admin zaten aynı akışın (İlanı Düzenle -> Onayla/Reddet)
 * bir parçası olarak kendi kararını ayrıca verecektir (bkz. admin-job-detail.tsx).
 */
export function applyAdminJobEdit(jobId: string, input: AdminJobEditInput): boolean {
  const all = readUserCreatedJobsSnapshot();
  const index = all.findIndex((job) => job.id === jobId);
  if (index === -1) return false;

  // NOT: RPC tarafındaki (0037) AYNI coalesce-koruma ilkesi burada da
  // uygulanır — formda görünmeyen/dokunulmamış bir alan (input.X undefined)
  // yerel aynada da asla var olan değeri SİLMEZ, yalnızca `input.X` GERÇEKTEN
  // bir değer taşıyorsa güncellenir. title/description/province/district/
  // workLocationType/addressText/workDate her zaman zorunlu/dolu olduğu için
  // (formun isValid kontrolü) doğrudan atanır; workEndDate formda HER ZAMAN
  // görünür olduğu için admin bilerek temizleyebilmeli, o da doğrudan atanır.
  const updated: Job = {
    ...all[index],
    title: input.title.trim(),
    description: input.description.trim(),
    province: input.province.trim(),
    district: input.district.trim(),
    workLocationType: input.workLocationType.trim(),
    addressText: input.addressText.trim(),
    workDate: input.workDate,
    workEndDate: input.workEndDate,
    productQuantity: input.productQuantity ?? all[index].productQuantity,
    productTonnage: input.productTonnage ?? all[index].productTonnage,
    productTonnageUnit: input.productTonnageUnit ?? all[index].productTonnageUnit,
    productType: input.productType ?? all[index].productType,
    customsProductType: input.customsProductType ?? all[index].customsProductType,
    customsTransactionType: input.customsTransactionType ?? all[index].customsTransactionType,
    customsRequestedServices: input.customsRequestedServices ?? all[index].customsRequestedServices,
    deliveryFacilityName: input.deliveryFacilityName ?? all[index].deliveryFacilityName,
    deliveryAddressText: input.deliveryAddressText ?? all[index].deliveryAddressText,
    operationDetails: input.operationDetails ?? all[index].operationDetails,
    neighborhood: input.neighborhood ?? all[index].neighborhood,
    locationUrl: input.locationUrl ?? all[index].locationUrl,
    directionsNote: input.directionsNote ?? all[index].directionsNote,
    deliveryProvince: input.deliveryProvince ?? all[index].deliveryProvince,
    deliveryDistrict: input.deliveryDistrict ?? all[index].deliveryDistrict,
    recyclingMaterialCategoryId: input.recyclingMaterialCategoryId ?? all[index].recyclingMaterialCategoryId,
    recyclingMaterialSubtypeId: input.recyclingMaterialSubtypeId ?? all[index].recyclingMaterialSubtypeId,
    recyclingQuantity: input.recyclingQuantity ?? all[index].recyclingQuantity,
    recyclingUnit: input.recyclingUnit ?? all[index].recyclingUnit,
    recyclingMaterialCondition: input.recyclingMaterialCondition ?? all[index].recyclingMaterialCondition,
    recyclingMaterialConditionNote: input.recyclingMaterialConditionNote ?? all[index].recyclingMaterialConditionNote,
    recyclingScopeOfWork: input.recyclingScopeOfWork ?? all[index].recyclingScopeOfWork,
    recyclingRequestedOperation: input.recyclingRequestedOperation ?? all[index].recyclingRequestedOperation,
    // NOT: recyclingHazardous admin girdisinden ASLA doğrudan alınmaz —
    // resmi atık kodundan yeniden türetilir (bkz. resolveRecyclingFields'in
    // aynı ilkesi), böylece admin de yıldızlı bir kodu tehlikesiz olarak
    // override edemez. Kod değişmediyse mevcut değer korunur.
    recyclingWasteCode: input.recyclingWasteCode ?? all[index].recyclingWasteCode,
    recyclingWasteCodeUnknown: input.recyclingWasteCodeUnknown ?? all[index].recyclingWasteCodeUnknown,
    recyclingHazardous:
      input.recyclingWasteCode !== undefined || input.recyclingWasteCodeUnknown !== undefined
        ? deriveWasteCodeHazardous(
            (input.recyclingWasteCodeUnknown ?? all[index].recyclingWasteCodeUnknown)
              ? null
              : (input.recyclingWasteCode ?? all[index].recyclingWasteCode) ?? null,
          ) ?? undefined
        : all[index].recyclingHazardous,
    recyclingHazardProperties: input.recyclingHazardProperties ?? all[index].recyclingHazardProperties,
    storageProductType: input.storageProductType ?? all[index].storageProductType,
    storageProductQuantity: input.storageProductQuantity ?? all[index].storageProductQuantity,
    storageProductUnit: input.storageProductUnit ?? all[index].storageProductUnit,
    storageProductTonnage: input.storageProductTonnage ?? all[index].storageProductTonnage,
    storageContainerGroups: input.storageContainerGroups ?? all[index].storageContainerGroups,
    storageHazardous: input.storageHazardous ?? all[index].storageHazardous,
    storageRiskGroups: input.storageRiskGroups ?? all[index].storageRiskGroups,
    nakliyeCargoGroups: input.nakliyeCargoGroups ?? all[index].nakliyeCargoGroups,
    nakliyeDetails: input.nakliyeLoadPreparationType !== undefined
      ? {
          ...all[index].nakliyeDetails,
          loadPreparationType: input.nakliyeLoadPreparationType || undefined,
          loadPreparationCustomText: input.nakliyeLoadPreparationCustomText,
          measurementInfo: input.nakliyeMeasurementInfo ?? all[index].nakliyeDetails?.measurementInfo,
          loadingMethod: input.nakliyeLoadingMethod || undefined,
          loadingMethodCustomText: input.nakliyeLoadingMethodCustomText,
          hazmat: input.nakliyeHazmat ?? all[index].nakliyeDetails?.hazmat,
          containerTransport: input.nakliyeContainerTransport ?? all[index].nakliyeDetails?.containerTransport,
        }
      : all[index].nakliyeDetails,
  };
  const next = [...all];
  next[index] = updated;
  return writeUserCreatedJobs(next);
}

export type DeleteJobPhotoResult = { ok: true; job: Job } | { ok: false; error: string };

/**
 * Bir ilana sonradan eklenmiş bir fotoğrafı siler. Yalnızca ilanın sahibi
 * olan Hizmet Alan kendi ilanındaki fotoğrafı silebilir — başka bir
 * kullanıcının (Hizmet Veren dahil, başka bir Hizmet Alan dahil) isteği
 * reddedilir. Şu an uygulamada ilan düzenleme arayüzü yok; bu fonksiyon
 * yetkilendirme kuralının veri katmanında (arayüzden bağımsız) var
 * olduğunu garanti eder ve doğrudan çağrılarak test edilebilir.
 */
export async function deleteJobPhoto(
  session: Session | null,
  jobId: string,
  photoId: string,
): Promise<DeleteJobPhotoResult> {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar fotoğraf silebilir." };
  }

  const job = findUserCreatedJobById(jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  const target = job.photos.find((photo) => photo.id === photoId);
  if (!target) {
    return { ok: false, error: "Fotoğraf bulunamadı." };
  }

  const remaining = job.photos
    .filter((photo) => photo.id !== photoId)
    .sort((a, b) => a.order - b.order)
    .map((photo, index) => ({ ...photo, order: index }));

  const updated: Job = { ...job, photos: remaining };
  const all = readUserCreatedJobsSnapshot();
  // Ana yazım ÖNCE, blob silme SONRA (bkz. updateJob'daki aynı sıralama
  // ilkesi) — ÖNCEDEN bu fonksiyon tersini yapıyordu (blob önce silinip
  // Job kaydı sonra yazılıyordu), bu yüzden localStorage yazımı başarısız
  // olursa ilan hâlâ artık var olmayan bir storageKey'e referans veriyor,
  // fotoğraf bir daha hiç yüklenemiyordu. Kayıt yazılamazsa blob'a hiç
  // dokunulmaz — kullanıcı fotoğrafına erişmeye devam eder.
  if (!writeUserCreatedJobs(all.map((item) => (item.id === jobId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  await deletePhotoBlob(target.storageKey);
  return { ok: true, job: updated };
}

export type DeleteJobResult = { ok: true } | { ok: false; error: string };

/**
 * Bir ilan kaydını (ve fotoğraf blob'larını) tamamen siler. Yalnızca ilanın
 * sahibi olan Hizmet Alan çağırabilir; durumu "tamamlandi" olan bir ilan
 * burada da engellenir. Bu fonksiyon teklif (Offer) deposunu hiç bilmez —
 * job-store.ts, offers.ts'i import edemez çünkü offers.ts zaten
 * jobs-lookup.ts üzerinden job-store.ts'e bağımlıdır (döngüsel import
 * olurdu). "Kabul edilmiş/devam eden teklifi var mı" kontrolü ve ilana
 * bağlı tekliflerin silinmesi, teklif verisine ihtiyaç duyduğu için
 * offers.ts#deleteJobWithOffers içinde yapılır — normal akışta kullanıcı
 * arayüzünün çağırması gereken, asıl yetkilendirilmiş giriş noktası odur.
 */
// DÜZELTME (TEKLİF DURUMLARINI SUPABASE İLE UZLAŞTIRMA GÖREVİ, `closeJob`
// ile AYNI kök nedenden gerçek çapraz-cihaz testinde bulundu): `job` artık
// ÇAĞIRANDAN (offers.ts#deleteJobWithOffers, zaten `findJobByIdWithRemoteFallback`
// ile sahipliği VE "aktif/tamamlanmış iş var mı" kuralını doğrulamış) parametre
// olarak alınır — eskiden bu fonksiyon KENDİ İÇİNDE `findUserCreatedJobById`
// (YEREL-ONLY) ile ayrıca arıyor ve `existing.status === "tamamlandi"` gibi
// daha kaba bir kontrol de tekrarlıyordu. Bu ilan yalnızca BAŞKA bir cihazda
// oluşturulmuşsa, sunucu tarafı silme ZATEN başarıyla tamamlanmış olsa bile
// (`deleteJobOnSupabase` başarılı döner) bu fonksiyon sahte bir "yetkiniz
// yok" hatası döndürüyordu. Artık: bu cihazda yerel bir kopya YOKSA
// silinecek/temizlenecek hiçbir şey yoktur — bu bir hata DEĞİLDİR, çünkü
// `fetchAllVisibleJobsFromSupabase` (bkz. supabase-job-reads.ts) silinen
// ilanı bir SONRAKİ getirmede zaten döndürmeyecektir.
export async function deleteJob(session: Session | null, job: Job): Promise<DeleteJobResult> {
  if (!session) {
    return { ok: false, error: "İlanı silmek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan silebilir." };
  }
  if (job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  if (job.status === "tamamlandi") {
    return {
      ok: false,
      error: "Bu ilana bağlı aktif veya tamamlanmış bir iş bulunduğu için ilan silinemez.",
    };
  }

  const all = readUserCreatedJobsSnapshot();
  if (all.some((item) => item.id === job.id)) {
    if (!writeUserCreatedJobs(all.filter((item) => item.id !== job.id))) {
      return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
    }

    if (job.photos.length > 0) {
      await deletePhotoBlobs(job.photos.map((photo) => photo.storageKey));
    }
    // DÜZELTME (Y5, veritabanı geçişi öncesi denetim): eskiden yalnızca
    // fotoğraf blob'ları temizleniyordu — Gümrük Müşavirliği evrakları
    // (customsDocuments) hiç silinmiyordu, ilan silindiğinde bu evrakların
    // IndexedDB blob'ları hiçbir kayıt tarafından referans edilmeden kalıcı
    // olarak sahipsiz (orphan) kalıyordu. `updateJob` bunu zaten doğru
    // yapıyordu (bkz. aşağıdaki removedCustomsDocuments) — bu, o desenle
    // tutarlı hale getirir. Yalnızca O6 düzeltmesiyle (republishJob artık
    // evrakları da bağımsız storageKey'lerle kopyalıyor) birlikte GÜVENLİDİR
    // — aksi halde yeniden yayınlanmış bir ilanın (eski storageKey'leri
    // PAYLAŞAN) evrakları da kırılırdı.
    if (job.customsDocuments && job.customsDocuments.length > 0) {
      await deletePhotoBlobs(job.customsDocuments.map((doc) => doc.storageKey));
    }
  }

  return { ok: true };
}

export type CloseJobResult = { ok: true; job: Job } | { ok: false; error: string };

/**
 * Bir ilan kaydını KAPATIR (bkz. job-closure.ts) — silmez, `Job.status`a
 * dokunmaz, yalnızca `closedAt`/`closureReason` yazar. `deleteJob`ın izlediği
 * AYNI bölünme: bu fonksiyon yalnızca ilan tablosunu bilir — "MALSEVK
 * üzerinden işe başlanmış/tamamlanma sürecine girmiş bir teklif var mı"
 * kontrolü (bkz. job-closure.ts#JOB_CLOSURE_BLOCKED_MESSAGE) teklif verisine
 * ihtiyaç duyduğu için offers.ts#closeJobListing içinde yapılır — normal
 * kullanıcı akışının çağırması gereken, asıl yetkilendirilmiş giriş noktası
 * odur. Zaten kapatılmış bir ilan için ikinci bir çağrı KESİN olarak
 * reddedilir (rule: işlem geri alınamaz — bir ilan iki kez, farklı
 * nedenlerle kapatılamaz).
 *
 * DÜZELTME (TEKLİF DURUMLARINI SUPABASE İLE UZLAŞTIRMA GÖREVİ, gerçek
 * çapraz-cihaz testinde bulundu): `job` artık ÇAĞIRANDAN (offers.ts#
 * closeJobListing, `jobs-lookup.ts#findJobByIdWithRemoteFallback` ile ZATEN
 * uzak-geri-dönüşlü olarak çözülmüş ve sahiplik doğrulanmış) parametre
 * olarak alınır — eskiden bu fonksiyon KENDİ İÇİNDE `findUserCreatedJobById`
 * (YEREL-ONLY, uzak geri dönüşü YOK) ile ayrıca arıyordu. Sonuç: ilan sahibi
 * bu ilanı BAŞKA bir cihazda oluşturmuşsa (bu cihazın `userJobsStore`'unda
 * hiç yoktur, yalnızca `useAllJobs()`'un render-zamanı uzak-geri-dönüş
 * birleşiminde vardır), sunucu tarafı kapatma ZATEN BAŞARIYLA tamamlanmış
 * olsa bile (`closeJobOnSupabase` başarılı döner) bu fonksiyon "Bu ilan
 * üzerinde işlem yapma yetkiniz yok." hatasıyla YANLIŞ BİR BAŞARISIZLIK
 * bildiriyordu — kullanıcı diyalog kapanmadan, sahte bir hata görüyordu,
 * oysa ilan sunucuda GERÇEKTEN kapanmıştı. Artık: bu cihazda yerel bir
 * kopya YOKSA yazacak hiçbir şey yoktur (silinecek/güncellenecek yerel
 * kayıt yok) — bu bir hata DEĞİLDİR, çünkü `useAllJobs()`'un kendi
 * `remoteWinsOverLocal`ı (`Boolean(remote.closedAt)`) bir SONRAKİ uzak
 * getirmede bu kapatmayı zaten doğru yansıtacaktır (bkz. use-jobs.ts).
 */
export function closeJob(
  session: Session | null,
  job: Job,
  reason: JobClosureReason,
): CloseJobResult {
  if (!session) {
    return { ok: false, error: "İlanı kapatmak için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan kapatabilir." };
  }
  if (job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }
  if (isJobManuallyClosed(job)) {
    return { ok: false, error: JOB_ALREADY_CLOSED_MESSAGE };
  }

  const updated: Job = { ...job, closedAt: new Date().toISOString(), closureReason: reason };
  const all = readUserCreatedJobsSnapshot();
  if (all.some((item) => item.id === job.id)) {
    if (!writeUserCreatedJobs(all.map((item) => (item.id === job.id ? updated : item)))) {
      return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
    }
  }
  return { ok: true, job: updated };
}

/**
 * Bir ilanın mevcut fotoğraflarını YENİ `storageKey`lerle IndexedDB'ye
 * kopyalar — `republishJob` (aşağıda) için. `persistPhotosOrRollback`ın
 * "createJobsForOperation'daki kardeş ilanlar arasında AYNI storageKey
 * PAYLAŞILMAZ" kuralıyla BİREBİR aynı gerekçe: yeniden yayınlanan ilan,
 * eski (artık salt geçmiş) ilandan TAMAMEN bağımsız olmalı — biri silinirse
 * (ör. eski ilan "Kalıcı Olarak Sil" ile kaldırılırsa) diğerinin fotoğrafı
 * kırılmamalı. Bir fotoğraf okunamazsa/yazılamazsa o ana kadar başarıyla
 * kopyalanmış olan blob'lar geri alınır (silinir) ve `null` döner — kısmi/
 * tutarsız bir kopya seti ASLA Job kaydına yazılmaz.
 */
async function duplicateJobPhotos(photos: JobPhoto[]): Promise<JobPhoto[] | null> {
  const copied: JobPhoto[] = [];
  try {
    for (const photo of photos) {
      const blob = await getPhotoBlob(photo.storageKey);
      if (!blob) throw new Error(`Fotoğraf bulunamadı: ${photo.storageKey}`);
      const storageKey = crypto.randomUUID();
      await putPhotoBlob(storageKey, blob);
      copied.push({ ...photo, storageKey });
    }
    return copied;
  } catch {
    await deletePhotoBlobs(copied.map((photo) => photo.storageKey));
    return null;
  }
}

export type RepublishJobInput = {
  workDate: string;
  workEndDate: string;
};

export type RepublishJobResult = { ok: true; job: Job } | { ok: false; error: string };

/**
 * Süresi dolmuş bir ilanı YENİ bir yayın dönemiyle yeniden yayınlar —
 * job-requests-panel.tsx'teki "Süresi Dolan İlanlar" bölümünün "Yeniden
 * Yayınla" aksiyonunun TEK yetkilendirilmiş giriş noktası.
 *
 * KÖK YAKLAŞIM — MEVCUT KAYDI MUTASYONA UĞRATMAK YERİNE KLONLAMA: eski ilan
 * SİLİNMEZ/DEĞİŞTİRİLMEZ (yalnızca `republishedToJobId` eklenir) ve YENİ,
 * bağımsız bir `Job` kaydı (yeni id) oluşturulur. Bu tercih, "eski tekliflerin
 * yeni yayın dönemine karışmaması" gereksinimini YAPISAL olarak, hiçbir ek
 * filtreleme koduna gerek kalmadan sağlar: teklifler `jobId`ye bağlıdır (bkz.
 * types.ts#Offer.jobId) — yeni ilan YENİ bir id taşıdığı için, eski ilana ait
 * hiçbir Offer/bildirim/geçmiş kaydı yeni ilana asla "sızamaz". Aynı sebeple
 * offers.ts/notifications.ts/job-requests.ts içinde bu görev için TEK BİR
 * satır bile değiştirilmesi gerekmedi.
 *
 * İki yönlü bağ: yeni ilanda `republishedFromJobId = existing.id`, eski
 * ilanda `republishedToJobId = yeni.id` — geçmiş HER İKİ yönden de izlenebilir
 * kalır (bkz. types.ts). `existing.republishedToJobId` zaten doluysa (bu eski
 * ilan DAHA ÖNCE yeniden yayınlanmış) istek KESİN olarak reddedilir — aynı
 * eski ilan üzerinden ikinci bir kopya asla üretilemez.
 *
 * KORUNAN ALANLAR: başlık, kategori, il/ilçe/lokasyon (facilityId/addressText/
 * locationMode/neighborhood/locationUrl/directionsNote), açıklama, operasyon
 * detayları, `operationId` (aynı operasyonun bir parçası olmaya devam eder —
 * kardeş ilanlar bundan ETKİLENMEZ, bkz. CLAUDE.md "sibling jobs are fully
 * independent") ve fotoğraflar (yeni storageKey'lerle kopyalanır, bkz.
 * `duplicateJobPhotos`) — hepsi eski kayıttan aynen taşınır. YENİ olan
 * yalnızca: id, `workDate`/`workEndDate` (kullanıcıdan alınan yeni tarihler),
 * `createdAt`/`publishEndAt` (yeni 14 günlük pencere) ve `photos`un
 * storageKey'leri.
 */
export async function republishJob(
  session: Session | null,
  jobId: string,
  offers: Offer[],
  input: RepublishJobInput,
): Promise<RepublishJobResult> {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan yeniden yayınlayabilir." };
  }

  const existing = findUserCreatedJobById(jobId);
  if (!existing || existing.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  // Arayüzden bağımsız, veri katmanındaki asıl yetkilendirme: yalnızca
  // GERÇEKTEN süresi dolmuş bir ilan yeniden yayınlanabilir (bkz.
  // job-publish-window.ts#isJobListingExpired, tek doğruluk kaynağı) — bu
  // ekranın DIŞINDA (ör. konsoldan doğrudan çağrılarak) hâlâ aktif bir
  // ilanın "yeniden yayınlanması" kılığında ikinci bir kopyası üretilemez.
  if (!isJobListingExpired(existing, offers)) {
    return { ok: false, error: "Bu ilan süresi dolmadığı için yeniden yayınlanamaz." };
  }
  // Aynı eski ilan üzerinden KONTROLSÜZ tekrar tetiklenirse (ör. çift
  // tıklama, iki açık sekme, ya da kullanıcı zaten yeniden yayınlanmış bir
  // kaydı yeniden denerse) mevcut `republishedToJobId` durumu buradan
  // KESİN olarak engeller — ikinci bir kopya asla oluşmaz.
  if (existing.republishedToJobId) {
    return { ok: false, error: "Bu ilan zaten yeniden yayınlanmış." };
  }

  const start = new Date(input.workDate).getTime();
  const end = new Date(input.workEndDate).getTime();
  if (input.workDate.trim().length === 0 || Number.isNaN(start)) {
    return { ok: false, error: "Geçerli bir başlangıç tarihi giriniz." };
  }
  if (input.workEndDate.trim().length === 0 || Number.isNaN(end)) {
    return { ok: false, error: "Geçerli bir bitiş tarihi giriniz." };
  }
  if (isJobDateInPast(input.workDate)) {
    return { ok: false, error: "Başlangıç tarihi geçmiş bir tarih olamaz." };
  }
  if (end < start) {
    return { ok: false, error: "Bitiş tarihi başlangıç tarihinden önce olamaz." };
  }

  const duplicatedPhotos = await duplicateJobPhotos(existing.photos);
  if (!duplicatedPhotos) {
    return { ok: false, error: "Fotoğraflar kopyalanamadı. Lütfen tekrar deneyin." };
  }

  // DÜZELTME (O6, veritabanı geçişi öncesi denetim): Gümrük Müşavirliği
  // evrakları da (varsa) fotoğraflarla BİREBİR AYNI gerekçeyle (yukarıdaki
  // duplicateJobPhotos doküman notu) YENİ storageKey'lerle kopyalanır —
  // eskiden `...existing` spread'i customsDocuments'ı ESKİ storageKey'lerle
  // olduğu gibi taşıyordu, bu da eski ilan "Kalıcı Olarak Sil" ile
  // silindiğinde (bkz. Y5 düzeltmesi) yeniden yayınlanan yeni ilanın
  // evraklarının da kırılmasına yol açardı.
  const existingCustomsDocuments = existing.customsDocuments ?? [];
  const duplicatedCustomsDocuments =
    existingCustomsDocuments.length > 0 ? await duplicateJobPhotos(existingCustomsDocuments) : [];
  if (!duplicatedCustomsDocuments) {
    // Yukarıda zaten kopyalanmış fotoğraflar da geri alınır — createJob'daki
    // AYNI "fotoğraf başarılı, evrak başarısız" geri alma sırası.
    await deletePhotoBlobs(duplicatedPhotos.map((photo) => photo.storageKey));
    return { ok: false, error: "Belgeler kopyalanamadı. Lütfen tekrar deneyin." };
  }

  const { createdAt, publishEndAt } = createPublishWindow();
  const newJobId = crypto.randomUUID();
  const republished: Job = {
    ...existing,
    id: newJobId,
    workDate: input.workDate,
    workEndDate: input.workEndDate,
    photos: duplicatedPhotos,
    ...(existingCustomsDocuments.length > 0 ? { customsDocuments: duplicatedCustomsDocuments } : {}),
    createdAt,
    publishEndAt,
    republishedFromJobId: existing.id,
    republishedToJobId: undefined,
  };

  const updatedExisting: Job = { ...existing, republishedToJobId: newJobId };

  const all = readUserCreatedJobsSnapshot();
  if (
    !writeUserCreatedJobs([
      ...all.map((item) => (item.id === jobId ? updatedExisting : item)),
      republished,
    ])
  ) {
    // Yeni ilan için kopyalanmış fotoğraflar/evraklar (yukarıda) hiçbir kayda
    // bağlanamadan sahipsiz kalmasın diye geri alınır; eski ilan hiç
    // değiştirilmediği için ona dokunmaya gerek yok.
    await deletePhotoBlobs([...duplicatedPhotos, ...duplicatedCustomsDocuments].map((item) => item.storageKey));
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, job: republished };
}
