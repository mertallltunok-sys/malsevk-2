import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { JobPhoto } from "./types";

/**
 * SUPABASE GEÇİŞİ FAZ 3 — "Gerçek Fotoğraf Storage Senkronu". `job-photos`
 * bucket'ı (public, 10MB limit, jpeg/png/webp) ve onun RLS politikaları
 * (`job_photos_bucket_write_own_folder`/`_delete_own_folder`/`_read_public`)
 * ZATEN supabase/migrations/0019_storage_policies.sql'de mevcuttu — bu dosya
 * ne yeni bir bucket ne de yeni bir migration gerektirir, yalnızca o
 * migration'ın kendi dokümante ettiği path kuralını (`job-photos/
 * {requester_id}/{job_id}/{photo_id}.{ext}`) gerçekten kullanan istemci
 * kodudur. `supabase-provider-documents.ts#uploadAndRegisterProviderDocument`
 * ile AYNI "önce Storage'a yükle, path'i sonra RPC'ye ver" ilkesi —
 * `supabase-job-sync.ts` bu modülü, o dosyanın kendi başarısızlıkta-geri-al
 * deseniyle çağırır (bkz. o dosyadaki kullanım).
 */
const BUCKET = "job-photos";

/** İşlenmiş fotoğraflar (bkz. photo-blob-store.ts) her zaman bu üç mime tipinden biridir — job-photos/process route'unun kendi çıktı sözleşmesi (CLAUDE.md "Photo upload pipeline"). */
function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

export type UploadJobPhotoResult = { ok: true; path: string } | { ok: false; error: string };

/** Yalnızca Storage'a yazar — jobs/job_photos tablosuna hiçbir satır yazmaz (bkz. modülün üstündeki dokümantasyon). */
export async function uploadJobPhotoToStorage(
  requesterId: string,
  jobId: string,
  photo: JobPhoto,
  blob: Blob,
): Promise<UploadJobPhotoResult> {
  const extension = extensionFromMimeType(photo.mimeType);
  const path = `${requesterId}/${jobId}/${photo.id}.${extension}`;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: photo.mimeType });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, path };
}

/** Kısmi/başarısız bir senkrondan sonra yetim (jobs/job_photos'a hiç bağlanamamış) dosya bırakmamak için — bkz. supabase-job-sync.ts'in kendi rollback çağrıları. */
export async function deleteJobPhotosFromStorage(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = createSupabaseBrowserClient();
  await supabase.storage.from(BUCKET).remove(paths);
}

/** `job-photos` public bir bucket'tır (bkz. 0019) — imzalı URL gerekmez, admin panelinin fotoğraf galerisi bunu doğrudan kullanır. */
export function getJobPhotoPublicUrl(path: string): string {
  const supabase = createSupabaseBrowserClient();
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
