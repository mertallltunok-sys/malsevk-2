import { isJobEditable, JOB_NOT_EDITABLE_MESSAGE } from "./job-requests";
import { writeJson } from "./local-storage";
import { deletePhotoBlob, deletePhotoBlobs, putPhotoBlob } from "./photo-blob-store";
import { MAX_PHOTOS, MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";
import { getServiceCategoryLabel, isServiceCategoryId } from "./service-catalog";
import type { Job, JobPhoto, JobStatus, Offer, Session } from "./types";

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

function writeUserCreatedJobs(jobs: Job[]): void {
  writeJson(USER_JOBS_STORAGE_KEY, jobs);
  cachedRaw = null;
  hasCached = false;
  notify();
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
  writeUserCreatedJobs(all.filter((job) => !idSet.has(job.id)));

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
  workLocationType: string;
  facilityId?: string;
  addressText: string;
  locationMode?: "catalog" | "custom";
  neighborhood?: string;
  locationUrl?: string;
  directionsNote?: string;
};

/**
 * locationMode'a göre ham form girdisini Job'a yazılacak son alanlara
 * indirger — TEK yer, createJob ve updateJob arasında kopyalanmaz.
 * "custom" modda facilityId HER ZAMAN temizlenir (sahte/yanlış bir
 * Facility.id asla kalıcı hâle gelmez — bkz. job-location.ts#resolveJobFacility'nin
 * locationMode "custom" için katalog eşleştirmesini de bilerek atlaması).
 * "catalog" modda (ya da locationMode hiç verilmemişse, geriye dönük
 * varsayılan) yalnızca "custom"a özgü alanlar (neighborhood/locationUrl/
 * directionsNote) temizlenir.
 *
 * companyOrFactoryName ("Firma / Fabrika Adı") BİLEREK bu fonksiyonun
 * döndürdüğü nesnede YOK — alan create/edit formlarından tamamen kaldırıldı
 * (MALSEVK'in Kocaeli-odaklı sadeleştirmesi). Yeni ilanlarda hiç yazılmaz;
 * updateJob'daki `{...existing, ...resolveLocationFields(input)}` sıralaması
 * sayesinde bu alandan önce oluşturulmuş bir ilanın mevcut companyOrFactoryName
 * değeri (varsa) burada hiç dokunulmadığı için düzenleme sonrasında da
 * kaybolmadan aynen korunur — veri kaybı yoktur, yalnızca artık aktif
 * formlardan toplanmaz/gösterilmez.
 */
function resolveLocationFields(input: LocationInput) {
  const isCustom = input.locationMode === "custom";
  return {
    workLocationType: input.workLocationType.trim(),
    facilityId: isCustom ? undefined : input.facilityId?.trim() || undefined,
    addressText: input.addressText.trim(),
    locationMode: input.locationMode,
    neighborhood: isCustom ? input.neighborhood?.trim() || undefined : undefined,
    locationUrl: isCustom ? input.locationUrl?.trim() || undefined : undefined,
    directionsNote: isCustom ? input.directionsNote?.trim() || undefined : undefined,
  };
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
  neighborhood?: string;
  locationUrl?: string;
  directionsNote?: string;
  workDate: string;
  /** Bkz. types.ts#Job.workEndDate. Opsiyonel: bu alandan önceki çağıranlar/kayıtlar için geriye dönük uyumlu; yeni form akışı bunu doldurup zorunlu kılar. */
  workEndDate?: string;
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
  if (input.photos.length < MIN_PHOTOS) {
    return { ok: false, error: PHOTOS_REQUIRED_MESSAGE };
  }
  if (input.photos.length > MAX_PHOTOS) {
    return { ok: false, error: `En fazla ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz.` };
  }

  const photos = await persistPhotosOrRollback(input.photos);
  if (!photos) {
    return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const job: Job = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    category: input.category,
    province: input.province.trim(),
    district: input.district.trim(),
    ...resolveLocationFields(input),
    workDate: input.workDate,
    workEndDate: input.workEndDate,
    description: input.description.trim(),
    operationDetails: input.operationDetails.trim(),
    status: "yayinda",
    requesterId: session.id,
    photos,
  };

  const all = readUserCreatedJobsSnapshot();
  writeUserCreatedJobs([...all, job]);

  return { ok: true, job };
}

/**
 * Bir operasyondaki TEK bir hizmetin kendine özgü alanları — Aşama 2.2
 * itibarıyla `category`/`workDate`/`workEndDate`nin yanı sıra `title`/
 * `description`/konum alanları da (bkz. types.ts#Job'un aynı adlı alanları)
 * artık PER-SERVICE'tir; hiçbiri operasyon genelinde paylaşılmaz. Yalnızca
 * `province` (her zaman "Kocaeli"), `operationDetails` ve `photos` gerçekten
 * ortaktır (bkz. CreateJobsForOperationInput).
 */
export type OperationServiceInput = {
  /** service-catalog.ts#SERVICE_CATEGORY_GROUPS'a ait bir hizmet kategorisi id'si. */
  category: string;
  title: string;
  description: string;
  workDate: string;
  workEndDate: string;
  district: string;
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca katalogdan seçildiyse; "Listede yok / Diğer" seçilmişse yoktur. */
  facilityId?: string;
  addressText: string;
  /** Bkz. types.ts#Job.locationMode. */
  locationMode?: "catalog" | "custom";
  neighborhood?: string;
  locationUrl?: string;
  directionsNote?: string;
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
  for (let index = 0; index < input.services.length; index++) {
    const photos = await persistPhotosOrRollback(input.photos);
    if (!photos) {
      await Promise.all(
        persistedPhotoSets.map((set) => deletePhotoBlobs(set.map((photo) => photo.storageKey))),
      );
      return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
    }
    persistedPhotoSets.push(photos);
  }

  const jobs: Job[] = input.services.map((service, index) => ({
    id: crypto.randomUUID(),
    title: service.title.trim(),
    category: service.category,
    province,
    district: service.district.trim(),
    ...resolveLocationFields(service),
    workDate: service.workDate,
    workEndDate: service.workEndDate,
    description: service.description.trim(),
    operationDetails,
    status: "yayinda",
    requesterId: session.id,
    operationId,
    photos: persistedPhotoSets[index],
  }));

  const all = readUserCreatedJobsSnapshot();
  writeUserCreatedJobs([...all, ...jobs]);

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
  neighborhood?: string;
  locationUrl?: string;
  directionsNote?: string;
  workDate: string;
  description: string;
  operationDetails: string;
  /** Korunacak mevcut fotoğrafların id'leri (silinenler bu listede olmaz). */
  keptPhotoIds: string[];
  /** Bu düzenlemede eklenen, henüz IndexedDB'ye yazılmamış yeni fotoğraflar. */
  newPhotos: ProcessedPhotoInput[];
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
  if (!isJobEditable(jobId, offers)) {
    return { ok: false, error: JOB_NOT_EDITABLE_MESSAGE };
  }

  const keptPhotos = existing.photos.filter((photo) => input.keptPhotoIds.includes(photo.id));
  const totalPhotoCount = keptPhotos.length + input.newPhotos.length;
  if (totalPhotoCount < MIN_PHOTOS) {
    return { ok: false, error: PHOTOS_REQUIRED_MESSAGE };
  }
  if (totalPhotoCount > MAX_PHOTOS) {
    return { ok: false, error: `En fazla ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz.` };
  }

  const newlyPersisted = await persistPhotosOrRollback(input.newPhotos);
  if (!newlyPersisted) {
    return { ok: false, error: "Fotoğraflar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const combinedPhotos: JobPhoto[] = [...keptPhotos, ...newlyPersisted].map((photo, index) => ({
    ...photo,
    order: index,
  }));

  const updated: Job = {
    ...existing,
    title: input.title.trim(),
    category: input.category,
    province: input.province.trim(),
    district: input.district.trim(),
    ...resolveLocationFields(input),
    workDate: input.workDate,
    description: input.description.trim(),
    operationDetails: input.operationDetails.trim(),
    photos: combinedPhotos,
  };

  const all = readUserCreatedJobsSnapshot();
  writeUserCreatedJobs(all.map((item) => (item.id === jobId ? updated : item)));

  // Kayıt başarıyla güncellendikten SONRA artık kullanılmayan eski
  // fotoğraf blob'larını sil — sıra önemli: kayıt önce, silme sonra, ki
  // arada bir hata olsa bile kullanıcı eski fotoğraflarına erişebilsin.
  const removedPhotos = existing.photos.filter((photo) => !input.keptPhotoIds.includes(photo.id));
  if (removedPhotos.length > 0) {
    await deletePhotoBlobs(removedPhotos.map((photo) => photo.storageKey));
  }

  return { ok: true, job: updated };
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

  await deletePhotoBlob(target.storageKey);
  const remaining = job.photos
    .filter((photo) => photo.id !== photoId)
    .sort((a, b) => a.order - b.order)
    .map((photo, index) => ({ ...photo, order: index }));

  const updated: Job = { ...job, photos: remaining };
  const all = readUserCreatedJobsSnapshot();
  writeUserCreatedJobs(all.map((item) => (item.id === jobId ? updated : item)));

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
export async function deleteJob(session: Session | null, jobId: string): Promise<DeleteJobResult> {
  if (!session) {
    return { ok: false, error: "İlanı silmek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan silebilir." };
  }

  const existing = findUserCreatedJobById(jobId);
  if (!existing || existing.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  if (existing.status === "tamamlandi") {
    return {
      ok: false,
      error: "Bu ilana bağlı aktif veya tamamlanmış bir iş bulunduğu için ilan silinemez.",
    };
  }

  const all = readUserCreatedJobsSnapshot();
  writeUserCreatedJobs(all.filter((item) => item.id !== jobId));

  if (existing.photos.length > 0) {
    await deletePhotoBlobs(existing.photos.map((photo) => photo.storageKey));
  }

  return { ok: true };
}
