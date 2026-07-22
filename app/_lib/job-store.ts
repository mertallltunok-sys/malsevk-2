import { writeJson } from "./local-storage";
import { deletePhotoBlob, deletePhotoBlobs, putPhotoBlob } from "./photo-blob-store";
import { MAX_PHOTOS, MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";
import type { Job, JobPhoto, JobStatus, Session } from "./types";

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
 * olarak görüntülenmeye devam eder.
 */
function normalizeStoredJob(value: unknown): Job | null {
  if (!isJobCore(value)) return null;
  const rawPhotos = (value as Record<string, unknown>).photos;
  const photos = Array.isArray(rawPhotos) ? rawPhotos.filter(isJobPhoto) : [];
  return { ...(value as Omit<Job, "photos">), photos } as Job;
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

export type CreateJobInput = {
  category: string;
  title: string;
  description: string;
  province: string;
  district: string;
  workLocationType: string;
  workDate: string;
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
    workLocationType: input.workLocationType.trim(),
    workDate: input.workDate,
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

export type UpdateJobInput = {
  title: string;
  category: string;
  province: string;
  district: string;
  workLocationType: string;
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
 * bir ilan oluşturulmaz. Yalnızca ilanın sahibi olan Hizmet Alan
 * çağırabilir. Fotoğraflarda: `keptPhotoIds`'te olmayan eski fotoğrafların
 * blob'ları silinir, `newPhotos` işlenip eklenir, `keptPhotoIds`'teki
 * fotoğraflara hiç dokunulmaz (yeniden yüklenmez/yeniden işlenmez).
 * Teklifler (Offer kayıtları) bu fonksiyonun hiç bilmediği, ayrı bir
 * depoda (offers.ts) tutulduğu için burada dokunulmaz — ilan id'si
 * değişmediğinden bağlantıları kendiliğinden korunur.
 */
export async function updateJob(
  session: Session | null,
  jobId: string,
  input: UpdateJobInput,
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
    workLocationType: input.workLocationType.trim(),
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
