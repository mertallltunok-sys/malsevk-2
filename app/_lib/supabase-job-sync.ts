import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Job } from "./types";

/**
 * SUPABASE GEÇİŞİ FAZ 2 — "Gerçek İlan Oluşturma → Supabase". Bu modül,
 * localStorage'daki gerçek ilan oluşturma yazımının (job-store.ts#createJob/
 * createJobsForOperation) YANINA, en-iyi-çaba bir uzak senkron ekler —
 * localStorage HÂLÂ tek bloklayan/ana yazma yoludur (görev: "localStorage/
 * IndexedDB mirror yapısını şimdilik kaldırma"). `create_job`/
 * `create_operation_with_jobs` RPC'leri (supabase/migrations/0028, 0030)
 * zaten opsiyonel bir client-üretimli id parametresi kabul ediyor — bu
 * yüzden burada YENİ bir id üretilmez, localStorage'daki `Job.id`/
 * `Job.operationId` (ikisi de zaten `crypto.randomUUID()`) OLDUĞU GİBİ
 * `p_client_id`/`p_client_operation_id` olarak geçirilir; local/remote
 * kimlikler hiç ayrışmaz.
 *
 * BİLİNEN, BİLEREK BIRAKILMIŞ KAPSAM DIŞI (0028'in kendi başlığıyla AYNI
 * sınır, bu modül onu genişletmez):
 *   - Fotoğrafların GERÇEK dosya baytları Supabase Storage'a YÜKLENMEZ (bu
 *     görevin kendi kapsam dışı listesi). `job_photos.storage_path` bu
 *     yüzden gerçek bir Storage yolu DEĞİL, localStorage/IndexedDB'deki
 *     `JobPhoto.storageKey`yi taşıyan, "local-pending:" önekiyle AÇIKÇA
 *     işaretlenmiş bir yer tutucudur — hiçbir Storage API çağrısı yapılmaz,
 *     yalnızca RPC'nin 1-10 fotoğraf zorunluluğunu (MLK51) karşılamak için
 *     metadata satırı yazılır. `width`/`height` de aynı nedenle her zaman
 *     `null` (JobPhoto bu iki alanı hiç taşımıyor, kolonlar nullable).
 *   - Gümrük Müşavirliği'nin customsTransactionType/customsRequestedServices/
 *     customsDocuments alanları ve Nakliye'nin 6 teslimat alanı
 *     (deliveryProvince/vb.) — Supabase şemasında hiç karşılığı yok (0028'in
 *     kendi kapsam sınırı), bu yüzden burada da senkronlanmaz.
 * Her iki gruptaki eksiklik SESSİZCE değil, açıkça (bu dosyanın kendi
 * dokümantasyonu + görev sonu raporu) belgelenmiştir.
 *
 * Requester kimliği (`auth.uid()`) HER İKİ RPC'de de yalnızca sunucu
 * tarafında, oturumun kendi JWT'sinden belirlenir — bu modül hiçbir zaman
 * bir requester/user id'sini parametre olarak GEÇİRMEZ, bu yüzden bir
 * çağıran başka bir kullanıcı adına ilan oluşturamaz (görev bölüm 12).
 */

export type JobSyncResult = { ok: true } | { ok: false; error: string };

/** `.env.local`'a eklenecek, `NEXT_PUBLIC_SUPABASE_*` ile AYNI `NEXT_PUBLIC_` önek kuralını izleyen, opsiyonel/varsayılan-kapalı bayrak. */
export function isSupabaseJobSyncEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC === "true";
}

function toRpcPhotos(photos: Job["photos"]) {
  return photos.map((photo) => ({
    storage_path: `local-pending:${photo.storageKey}`,
    original_file_name: photo.fileName,
    mime_type: photo.mimeType,
    size_bytes: photo.fileSize,
    width: null,
    height: null,
  }));
}

/** Tek ilan (createJob) yolu için — job-request-form.tsx'in `services.length === 1` dalından çağrılır. */
export async function syncJobToSupabase(job: Job): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("create_job", {
    p_category_id: job.category,
    p_title: job.title,
    p_description: job.description,
    p_operation_details: job.operationDetails,
    p_province: job.province,
    p_district: job.district,
    p_work_location_type: job.workLocationType,
    p_work_date: job.workDate,
    p_photos: toRpcPhotos(job.photos),
    p_facility_id: job.facilityId ?? null,
    p_location_mode: job.locationMode ?? "catalog",
    p_address_text: job.addressText ?? "",
    p_neighborhood: job.neighborhood ?? null,
    p_location_url: job.locationUrl ?? null,
    p_directions_note: job.directionsNote ?? null,
    p_work_end_date: job.workEndDate ?? null,
    p_product_quantity: job.productQuantity ?? null,
    p_product_tonnage: job.productTonnage ?? null,
    p_product_type: job.productType ?? null,
    p_customs_product_type: job.customsProductType ?? null,
    p_client_id: job.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Çoklu hizmet (createJobsForOperation) yolu için — `jobs` aynı
 * `operationId`ye bağlı KARDEŞ ilanların TAMAMI olmalı (job-request-form.tsx
 * `result.jobs`'unu olduğu gibi geçirir). `province`/`operationDetails`
 * operasyon genelinde paylaşılan değerlerdir (bkz. CreateJobsForOperationInput)
 * — her `job`nun kendi `province`si yalnızca (Nakliye'de olduğu gibi) bu
 * paylaşılan değerden GERÇEKTEN farklıysa ayrıca `province` anahtarıyla
 * gönderilir (supabase/migrations/0030), aksi halde hiç gönderilmez ve RPC
 * paylaşılanı kullanır — job-store.ts#createJobsForOperation'ın kendi
 * `serviceProvince` önceliğiyle BİREBİR aynı.
 */
export async function syncOperationToSupabase(
  jobs: Job[],
  operationId: string,
  province: string,
  operationDetails: string,
): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const photosByServiceIndex: Record<string, ReturnType<typeof toRpcPhotos>> = {};
  const services = jobs.map((job, index) => {
    photosByServiceIndex[String(index)] = toRpcPhotos(job.photos);
    return {
      client_id: job.id,
      category_id: job.category,
      title: job.title,
      description: job.description,
      district: job.district,
      work_location_type: job.workLocationType,
      facility_id: job.facilityId ?? null,
      location_mode: job.locationMode ?? "catalog",
      address_text: job.addressText ?? "",
      neighborhood: job.neighborhood ?? null,
      location_url: job.locationUrl ?? null,
      directions_note: job.directionsNote ?? null,
      work_date: job.workDate,
      work_end_date: job.workEndDate ?? null,
      product_quantity: job.productQuantity ?? null,
      product_tonnage: job.productTonnage ?? null,
      product_type: job.productType ?? null,
      customs_product_type: job.customsProductType ?? null,
      // Yalnızca gerçekten paylaşılandan farklıysa gönderilir (bkz. bu
      // fonksiyonun dokümantasyonu) — diğer tüm kardeş hizmetler için bu
      // anahtar hiç yoktur, RPC 0030'un coalesce'i p_province'e düşer.
      ...(job.province && job.province !== province ? { province: job.province } : {}),
    };
  });

  const { error } = await supabase.rpc("create_operation_with_jobs", {
    p_province: province,
    p_operation_details: operationDetails,
    p_services: services,
    p_photos_by_service_index: photosByServiceIndex,
    p_client_operation_id: operationId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
