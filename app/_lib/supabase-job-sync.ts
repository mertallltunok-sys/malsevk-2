import { getPhotoBlob } from "./photo-blob-store";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { deleteJobPhotosFromStorage, uploadJobPhotoToStorage } from "./supabase-job-photos";
import type { Job } from "./types";

/**
 * SUPABASE GEÇİŞİ FAZ 2/3 — "Gerçek İlan Oluşturma → Supabase" + "Gerçek
 * Fotoğraf Storage Senkronu". Bu modül, localStorage'daki gerçek ilan
 * oluşturma yazımının (job-store.ts#createJob/createJobsForOperation)
 * YANINA, en-iyi-çaba bir uzak senkron ekler — localStorage HÂLÂ tek
 * bloklayan/ana yazma yoludur (görev: "localStorage/IndexedDB mirror
 * yapısını şimdilik kaldırma"). `create_job`/`create_operation_with_jobs`
 * RPC'leri (supabase/migrations/0028, 0030) zaten opsiyonel bir
 * client-üretimli id parametresi kabul ediyor — bu yüzden burada YENİ bir id
 * üretilmez, localStorage'daki `Job.id`/`Job.operationId` (ikisi de zaten
 * `crypto.randomUUID()`) OLDUĞU GİBİ `p_client_id`/`p_client_operation_id`
 * olarak geçirilir; local/remote kimlikler hiç ayrışmaz.
 *
 * FAZ 3 GÜNCELLEMESİ: fotoğraflar artık GERÇEKTEN `job-photos` bucket'ına
 * yüklenir (bkz. supabase-job-photos.ts — bucket/RLS zaten 0019'da mevcuttu,
 * yeni bir migration/bucket YOK) — Faz 2'nin `"local-pending:"` önekli
 * placeholder'ı tamamen kaldırıldı. Sıra `supabase-provider-documents.ts#
 * uploadAndRegisterProviderDocument` ile AYNI ilke: ÖNCE Storage'a yükle,
 * SONRA metadata'yı (burada RPC'nin `p_photos`si) yaz; RPC başarısız olursa
 * az önce yüklenmiş Storage nesneleri geri silinir (yetim dosya bırakılmaz —
 * görev bölüm 8). Yerel IndexedDB'deki (photo-blob-store.ts) blob zaten
 * job-store.ts#createJob tarafından yazılmıştı — bu modül onu yalnızca OKUR,
 * hiç silmez/değiştirmez (yerel kopyanın kendi ömrü bu senkrondan bağımsız).
 *
 * FAZ 4 GÜNCELLEMESİ: Nakliye'nin 6 teslimat alanı (deliveryProvince/
 * District/LocationType/FacilityId/FacilityName/AddressText — types.ts#Job
 * ve job-store.ts#resolveDeliveryLocationFields'ten BİREBİR çıkarıldı, bkz.
 * migration 0031) artık senkronlanıyor. `job.deliveryX` alanları
 * `isTransportationCategory` DIŞINDAKİ her kategoride zaten `undefined`dir
 * (job-store.ts'in kendi aktif temizleme ilkesi) — bu modül bunu tekrar
 * KONTROL ETMEZ, yalnızca olduğu gibi `?? null` ile taşır; Nakliye olmayan
 * bir ilan için RPC'ye her zaman `null` gider (görev bölüm 3).
 *
 * BİLİNEN, BİLEREK BIRAKILMIŞ KAPSAM DIŞI (0028'in kendi başlığıyla AYNI
 * sınır, bu modül onu genişletmez):
 *   - `width`/`height` her zaman `null` (JobPhoto bu iki alanı hiç
 *     taşımıyor, kolonlar nullable) — Faz 3'ün kapsamı yalnızca gerçek dosya
 *     baytlarının Storage'a ulaşmasıdır, boyut metadata'sı ayrı bir konudur.
 *   - Gümrük Müşavirliği'nin customsTransactionType/customsRequestedServices/
 *     customsDocuments alanları — Supabase şemasında hiç karşılığı yok
 *     (0028'in kendi kapsam sınırı, Faz 4 bunu genişletmedi — görev
 *     tanımının kendi kapsam sınırı: "gümrük alanları bu fazın kapsamı
 *     değildir"), bu yüzden burada da senkronlanmaz.
 * Bu eksiklik SESSİZCE değil, açıkça (bu dosyanın kendi dokümantasyonu +
 * görev sonu raporu) belgelenmiştir.
 *
 * Requester kimliği (`auth.uid()`) HER İKİ RPC'de de yalnızca sunucu
 * tarafında, oturumun kendi JWT'sinden belirlenir — bu modül bir requester/
 * user id'sini asla RPC parametresi olarak GEÇİRMEZ, bu yüzden bir çağıran
 * başka bir kullanıcı adına ilan oluşturamaz (görev bölüm 12). `auth.getUser()`
 * yalnızca Storage path'inin ilk segmentini (RLS'in zorunlu kıldığı
 * `{requester_id}/...` öneki, bkz. 0019) doğru kurmak için okunur — path'i
 * yanlış kurmak yalnızca RLS'in kendi INSERT reddiyle sonuçlanır, bir
 * yetkilendirme AÇIĞI değildir.
 */

export type JobSyncResult = { ok: true } | { ok: false; error: string };

/** `.env.local`'a eklenecek, `NEXT_PUBLIC_SUPABASE_*` ile AYNI `NEXT_PUBLIC_` önek kuralını izleyen, opsiyonel/varsayılan-kapalı bayrak. */
export function isSupabaseJobSyncEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC === "true";
}

type RpcPhoto = {
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  width: null;
  height: null;
};

type UploadJobPhotosResult =
  | { ok: true; rpcPhotos: RpcPhoto[]; uploadedPaths: string[] }
  | { ok: false; error: string };

/**
 * Bir ilanın TÜM fotoğraflarını sırayla Storage'a yükler — biri başarısız
 * olursa (blob IndexedDB'de bulunamadı ya da Storage upload'ı reddetti), bu
 * ÇAĞRIYA ait o ana kadar yüklenmiş olan nesneler hemen geri silinir (yetim
 * bırakmama, görev bölüm 8) ve `{ok:false}` döner — RPC hiç çağrılmaz.
 * Başarılı dönüşte hem RPC'ye verilecek `rpcPhotos` (gerçek storage_path'li)
 * hem de çağıranın (RPC kendisi başarısız olursa) geri silebilmesi için
 * `uploadedPaths` döner.
 */
async function uploadJobPhotosOrRollback(
  requesterId: string,
  jobId: string,
  photos: Job["photos"],
): Promise<UploadJobPhotosResult> {
  const uploadedPaths: string[] = [];
  const rpcPhotos: RpcPhoto[] = [];
  for (const photo of photos) {
    const blob = await getPhotoBlob(photo.storageKey);
    if (!blob) {
      await deleteJobPhotosFromStorage(uploadedPaths);
      return { ok: false, error: "Fotoğraf verisi bulunamadı." };
    }
    const uploadResult = await uploadJobPhotoToStorage(requesterId, jobId, photo, blob);
    if (!uploadResult.ok) {
      await deleteJobPhotosFromStorage(uploadedPaths);
      return { ok: false, error: uploadResult.error };
    }
    uploadedPaths.push(uploadResult.path);
    rpcPhotos.push({
      storage_path: uploadResult.path,
      original_file_name: photo.fileName,
      mime_type: photo.mimeType,
      size_bytes: photo.fileSize,
      width: null,
      height: null,
    });
  }
  return { ok: true, rpcPhotos, uploadedPaths };
}

/** Tek ilan (createJob) yolu için — job-request-form.tsx'in `services.length === 1` dalından çağrılır. */
export async function syncJobToSupabase(job: Job): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  const photosResult = await uploadJobPhotosOrRollback(user.id, job.id, job.photos);
  if (!photosResult.ok) return { ok: false, error: photosResult.error };

  const { error } = await supabase.rpc("create_job", {
    p_category_id: job.category,
    p_title: job.title,
    p_description: job.description,
    p_operation_details: job.operationDetails,
    p_province: job.province,
    p_district: job.district,
    p_work_location_type: job.workLocationType,
    p_work_date: job.workDate,
    p_photos: photosResult.rpcPhotos,
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
    p_delivery_province: job.deliveryProvince ?? null,
    p_delivery_district: job.deliveryDistrict ?? null,
    p_delivery_location_type: job.deliveryLocationType ?? null,
    p_delivery_facility_id: job.deliveryFacilityId ?? null,
    p_delivery_facility_name: job.deliveryFacilityName ?? null,
    p_delivery_address_text: job.deliveryAddressText ?? null,
  });
  if (error) {
    // Metadata satırı hiç yazılamadı — az önce yüklenen fotoğraflar Storage'da
    // yetim kalmasın diye geri silinir (bkz. modülün üstündeki dokümantasyon).
    await deleteJobPhotosFromStorage(photosResult.uploadedPaths);
    return { ok: false, error: error.message };
  }
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
 *
 * Fotoğraf yükleme sırayla, hizmet hizmet yapılır; herhangi bir hizmetin
 * fotoğrafları başarısız olursa (o hizmetin KENDİ kısmi yüklemesi
 * `uploadJobPhotosOrRollback` içinde zaten geri alınmıştır) ÖNCEKİ
 * hizmetlerden başarıyla yüklenmiş TÜM fotoğraflar da geri silinir (bütün
 * operasyon tek bir "hepsi ya da hiçbiri" birimidir) ve RPC hiç çağrılmaz.
 */
export async function syncOperationToSupabase(
  jobs: Job[],
  operationId: string,
  province: string,
  operationDetails: string,
): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  const allUploadedPaths: string[] = [];
  const photosByServiceIndex: Record<string, RpcPhoto[]> = {};
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const photosResult = await uploadJobPhotosOrRollback(user.id, job.id, job.photos);
    if (!photosResult.ok) {
      await deleteJobPhotosFromStorage(allUploadedPaths);
      return { ok: false, error: photosResult.error };
    }
    allUploadedPaths.push(...photosResult.uploadedPaths);
    photosByServiceIndex[String(index)] = photosResult.rpcPhotos;
  }

  const services = jobs.map((job) => ({
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
    // Yalnızca Nakliye kardeşi doludur (job-store.ts'in kendi aktif
    // temizleme ilkesi) — diğer kardeşlerde zaten `undefined`, RPC'ye her
    // zaman `null` gider (migration 0031).
    delivery_province: job.deliveryProvince ?? null,
    delivery_district: job.deliveryDistrict ?? null,
    delivery_location_type: job.deliveryLocationType ?? null,
    delivery_facility_id: job.deliveryFacilityId ?? null,
    delivery_facility_name: job.deliveryFacilityName ?? null,
    delivery_address_text: job.deliveryAddressText ?? null,
    // Yalnızca gerçekten paylaşılandan farklıysa gönderilir (bkz. bu
    // fonksiyonun dokümantasyonu) — diğer tüm kardeş hizmetler için bu
    // anahtar hiç yoktur, RPC 0030'un coalesce'i p_province'e düşer.
    ...(job.province && job.province !== province ? { province: job.province } : {}),
  }));

  const { error } = await supabase.rpc("create_operation_with_jobs", {
    p_province: province,
    p_operation_details: operationDetails,
    p_services: services,
    p_photos_by_service_index: photosByServiceIndex,
    p_client_operation_id: operationId,
  });
  if (error) {
    await deleteJobPhotosFromStorage(allUploadedPaths);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
