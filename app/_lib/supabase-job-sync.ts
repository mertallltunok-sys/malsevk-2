import {
  buildJobForCreation,
  buildJobsForOperation,
  buildJobUpdate,
  commitJob,
  commitJobs,
  commitJobUpdate,
  markJobSupabaseSyncFailed,
  type CreateJobInput,
  type CreateJobResult,
  type CreateJobsForOperationInput,
  type CreateJobsForOperationResult,
  type UpdateJobInput,
} from "./job-store";
import { STORAGE_WRITE_ERROR_MESSAGE } from "./local-storage";
import { deletePhotoBlobs, getPhotoBlob } from "./photo-blob-store";
import { reportSystemError } from "./system-health";
import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import type { Offer, Session } from "./types";
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
 *   - Gümrük Müşavirliği'nin `customsDocuments` (destekleyici evrak listesi)
 *     — Supabase şemasında hiç karşılığı yok ve bilerek eklenmeyecek (bkz.
 *     migration 0025→0027: `job_customs_documents` eklenip "MALSEVK sevkiyat
 *     evrakı tutmaz" kararıyla tamamen geri alındı). `customsTransactionType`/
 *     `customsRequestedServices` ise migration 0048 ile şemaya eklendi ve
 *     aşağıda GERÇEKTEN senkronlanıyor — bu ikisi artık kapsam dışı DEĞİL.
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

/**
 * DÜZELTME (canlıya hazırlık, "Kritik Senkronizasyon Ayarı" görevi):
 * `NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC` eskiden bu fonksiyonun TEK kaynağıydı
 * ve `.env.example`'daki varsayılanı `false`ydu — bu, ilan/teklif/operasyon
 * yaşam döngüsünün TAMAMINI (ilan oluşturma senkronu, `findJobByIdWithRemoteFallback`
 * geri dönüşü, `useAllJobs`/`useAllOffers`'ın cihazlar-arası hidratasyonu, ve
 * offers.ts'teki TÜM `requiresBackendOfferSync()` blokları — kabul/ret/geri
 * çekme/işe başlama/tamamlama/itiraz/anlaşma sağlanamadı) bu TEK, kolayca
 * unutulabilir/yanlış bırakılabilir ortam değişkenine bağlıyordu. Gerçek
 * çapraz-cihaz testleri (bkz. proje raporu) bu yüzden değişken açıkken
 * (Development) çalışıyor, ama değişken `.env.example`'ın kendi varsayılanıyla
 * (`false`) hiç set edilmeden yapılacak bir prod deploy'da TÜM bu düzeltmeler
 * SESSİZCE devre dışı kalıyordu — hiçbir hata/uyarı olmadan, işlemler yerelde
 * "başarılı" görünmeye devam ederdi.
 *
 * `NEXT_PUBLIC_*` değişkenleri build zamanında gömüldüğü için (bir prod
 * ortamının runtime'da bunu "düzeltmesi" mümkün değildir — yalnızca doğru
 * değerle YENİDEN BUILD edilmesi gerekir) tek başına bir env-var varsayılanı
 * değiştirmek bu riski gerçek anlamda kapatmaz; bir sonraki ortam kurulumu
 * yine aynı hatayı tekrar edebilir. Bu yüzden senkron artık ortam
 * değişkeninden BAĞIMSIZ, KOŞULSUZ olarak etkin — Faz 2'nin "opt-in, kademeli
 * rollout" döneminin gerçek amacı zaten buydu, o dönem artık kapandı (bkz.
 * CLAUDE.md'nin Faz 2-4 doğrulama geçmişi). `NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC`
 * hâlâ okunuyor ama artık HİÇBİR davranışı belirlemiyor — geriye dönük
 * uyumluluk/dokümantasyon amaçlı `.env.example`'da bırakıldı, bkz. o dosyadaki
 * güncellenmiş açıklama.
 */
export function isSupabaseJobSyncEnabled(): boolean {
  return true;
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

/**
 * "Kritik İlan Senkronizasyonu" görevi Bölüm 2 — ilan sahibinin, admin karar
 * vermeden ÖNCE yaptığı bir düzenlemeyi (job-edit-form.tsx#updateJob YEREL
 * yazımı zaten başarılı olduktan SONRA) Supabase'e iter. `update_job_as_admin`
 * (0048) İLE AYNI alan kapsamı/coalesce disiplinini paylaşan, ama
 * auth.uid() = requester_id VE moderation_status = 'pending_review'
 * zorunluluğuyla çalışan `update_job_as_requester` RPC'sini (migration 0051)
 * sarmalar — "en dar RPC çözümü" (görev gereksinimi), ikinci bir ilan sistemi
 * İCAT EDİLMEZ. Fotoğraf/kategori/facility_id/location_mode/delivery_facility_id/
 * delivery_location_type/customsDocuments senkronlanmaz — update_job_as_admin'in
 * KENDİ zaten kabul ettiği aynı, bilerek bırakılmış sınır (bkz. o RPC'nin
 * migration'ındaki not) — bir requester bunları değiştirirse o değişiklik bu
 * çağrıda yalnızca yerel kalır, YENİ bir kapsam daralması değildir.
 */
async function updateJobAsRequesterOnSupabase(job: Job): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_job_as_requester", {
    p_job_id: job.id,
    p_title: job.title,
    p_description: job.description,
    p_province: job.province,
    p_district: job.district,
    p_work_location_type: job.workLocationType,
    p_address_text: job.addressText ?? "",
    p_work_date: job.workDate,
    p_work_end_date: job.workEndDate ?? null,
    p_product_quantity: job.productQuantity ?? null,
    p_product_tonnage: job.productTonnage ?? null,
    p_product_type: job.productType ?? null,
    p_customs_product_type: job.customsProductType ?? null,
    p_delivery_facility_name: job.deliveryFacilityName ?? null,
    p_delivery_address_text: job.deliveryAddressText ?? null,
    p_operation_details: job.operationDetails ?? null,
    p_neighborhood: job.neighborhood ?? null,
    p_location_url: job.locationUrl ?? null,
    p_directions_note: job.directionsNote ?? null,
    p_delivery_province: job.deliveryProvince ?? null,
    p_delivery_district: job.deliveryDistrict ?? null,
    p_recycling_material_category_id: job.recyclingMaterialCategoryId ?? null,
    p_recycling_material_subtype_id: job.recyclingMaterialSubtypeId ?? null,
    p_recycling_quantity: job.recyclingQuantity ?? null,
    p_recycling_unit: job.recyclingUnit ?? null,
    p_recycling_material_condition: job.recyclingMaterialCondition ?? null,
    p_recycling_material_condition_note: job.recyclingMaterialConditionNote ?? null,
    p_recycling_scope_of_work: job.recyclingScopeOfWork ?? null,
    p_customs_transaction_type: job.customsTransactionType ?? null,
    p_customs_requested_services: job.customsRequestedServices ?? null,
    p_storage_product_type: job.storageProductType ?? null,
    p_storage_product_quantity: job.storageProductQuantity ?? null,
    p_storage_product_unit: job.storageProductUnit ?? null,
    p_storage_product_tonnage: job.storageProductTonnage ?? null,
    p_storage_container_groups: job.storageContainerGroups ?? null,
    p_product_tonnage_unit: job.productTonnageUnit ?? null,
    p_nakliye_load_preparation_type: job.nakliyeDetails?.loadPreparationType ?? null,
    p_nakliye_load_preparation_custom_text: job.nakliyeDetails?.loadPreparationCustomText ?? null,
    p_nakliye_loading_method: job.nakliyeDetails?.loadingMethod ?? null,
    p_nakliye_loading_method_custom_text: job.nakliyeDetails?.loadingMethodCustomText ?? null,
    p_nakliye_measurement_info: job.nakliyeDetails?.measurementInfo ?? null,
    p_nakliye_hazmat: job.nakliyeDetails?.hazmat ?? null,
    p_nakliye_container_transport: job.nakliyeDetails?.containerTransport ?? null,
    p_nakliye_cargo_groups: job.nakliyeCargoGroups ?? null,
    p_storage_hazardous: job.storageHazardous ?? null,
    p_storage_risk_groups: job.storageRiskGroups ?? null,
    p_recycling_requested_operation: job.recyclingRequestedOperation ?? null,
    p_recycling_waste_code: job.recyclingWasteCode ?? null,
    p_recycling_waste_code_unknown: job.recyclingWasteCodeUnknown ?? null,
    p_recycling_hazard_properties: job.recyclingHazardProperties ?? null,
  });
  if (error) return { ok: false, error: getAccountStatusErrorMessage(error.code) ?? error.message };
  return { ok: true };
}

/**
 * "Kritik İlan Senkronizasyonu" görevi — `markJobSupabaseSyncFailed` ile
 * işaretlenmiş (ya da job-requests-panel.tsx'in mount-time reconciliation'ı
 * tarafından RETROAKTİF olarak işaretlenmiş, bkz. reconcileLocalPendingJobsWithSupabase
 * aşağıda) bir ilan için GÜVENLİ yeniden deneme. `job.id` zaten ilk denemede
 * `p_client_id` olarak gönderilmişti (bkz. syncJobToSupabase) — yani ÖNCE bu
 * id'nin Supabase'te GERÇEKTEN var olup olmadığı kontrol edilir:
 *   - Yoksa: ilk deneme (create) GERÇEKTEN hiç ulaşmamış/tamamlanmamış —
 *     normal `syncJobToSupabase` güvenle yeniden çalıştırılır (fotoğraflar da
 *     dahil, hiçbiri henüz Storage'a ulaşmamıştır). `create_job`ı TEKRAR
 *     çağırmak `jobs.id` birincil anahtarına çakışmaz çünkü satır hiç yok.
 *   - Varsa: satır zaten var — YENİDEN INSERT DENENMEZ (görev gereksinimi).
 *     Bunun İKİ olası nedeni var, ikisi de AYNI eylemi gerektirir (yerel
 *     GÜNCEL durumu sunucuya İT): (a) ilk create aslında başarılı olmuş ama
 *     yanıt tarayıcıya hiç ulaşmamış olabilir — bu durumda push no-op'a
 *     yakındır (aynı veriyi tekrar yazar); (b) bu bir DÜZENLEME sonrası
 *     yeniden deneme — satır zaten var ama YEREL düzenleme henüz sunucuya
 *     yansımamış. `update_job_as_requester`in kendisi moderation_status
 *     kontrolünü yapar (ilan bu arada admin tarafından karara bağlandıysa
 *     MLK102 ile açıkça reddeder, sessizce üzerine yazmaz).
 */
export async function retryJobSupabaseSync(job: Job): Promise<JobSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { data: existing, error: checkError } = await supabase.from("jobs").select("id").eq("id", job.id).maybeSingle();
  if (checkError) return { ok: false, error: checkError.message };
  if (existing) return updateJobAsRequesterOnSupabase(job);
  return syncJobToSupabase(job);
}

/**
 * "Kritik İlan Senkronizasyonu" görevi Bölüm 1 takip düzeltmesi — düzeltmeden
 * ÖNCE oluşturulmuş bir localStorage ilanının `supabaseSyncFailedAt`/
 * `supabaseSyncError` alanları hiç yoktur (bu alanlar sonradan eklendi), bu
 * yüzden yalnızca o alana bakmak eski takılı ilanları YAKALAYAMAZ. Bu
 * fonksiyon "Hizmet Taleplerim" her yüklendiğinde (job-requests-panel.tsx)
 * çağrılır: oturumdaki kullanıcıya ait, hâlâ `pending_review` VE henüz
 * bilinen bir senkron hatası TAŞIMAYAN yerel ilanları TEK bir toplu sorguyla
 * Supabase'e karşı doğrular.
 *
 * - Sunucuda GERÇEKTEN yoksa: bu "gerçek Onay Bekliyor" DEĞİLDİR (görev
 *   gereksinimi) — retroaktif olarak `markJobSupabaseSyncFailed` ile
 *   işaretlenir, tıpkı YENİ bir senkron hatası gibi aynı "Senkronizasyon
 *   Başarısız" + Yeniden Dene UI'ı devreye girer (job-requests-panel.tsx/
 *   job-detail-content.tsx, ayrı bir kod yolu İCAT EDİLMEZ).
 * - Sunucuda varsa: dokunulmaz (yeniden INSERT denenmez, görev gereksinimi)
 *   — hâlâ `pending_review` iken zaten `useAllJobs()`in `remoteWinsOverLocal`
 *   kuralı yerel kopyayı korur (edit senkronu ayrı bir mekanizma, bkz.
 *   updateJobAsRequesterOnSupabase), bu fonksiyon yalnızca VARLIK/YOKLUK
 *   sinyalini doğrular, içerik uzlaştırması yapmaz.
 * - "Tamamlanmamış gerçek taslaklar" bu kod tabanında AYRI bir kavram
 *   DEĞİLDİR (görev gereksinimi notu) — job-store.ts#createJob/createJobsForOperation
 *   yazma-sonra-kontrol disiplini nedeniyle (bkz. o dosyanın "Writes must not
 *   silently claim success" ilkesi), userJobsStore'da var olan HER `Job`
 *   zaten tam/başarılı bir yerel yazımı temsil eder — sahiden eksik bir
 *   "taslak" hiçbir zaman bu diziye girmez, bu yüzden ayrıca bir taslak/
 *   gönderildi ayrımına gerek yoktur.
 * - `isSupabaseJobSyncEnabled()` KAPALIYKEN bu fonksiyon HİÇBİR şey yapmaz
 *   (erken döner) — bayrak kapalıyken localStorage zaten TEK yetkili kaynak
 *   olmaya devam eder (Faz 2'nin kendi "opt-in, localStorage her koşulda
 *   yetkili kalır" ilkesi) — bu durumda "sunucuda yok" GERÇEK bir hata
 *   DEĞİLDİR, uygulamanın bugünkü tasarlanmış davranışıdır; bayrak kapalıyken
 *   her ilanı retroaktif olarak "Senkronizasyon Başarısız" işaretlemek YANLIŞ
 *   bir alarm olurdu.
 * - Sahiplik: çağıran zaten yalnızca `job.requesterId === session.id` olan
 *   ilanları bu fonksiyona geçirir (bkz. job-requests-panel.tsx); Supabase
 *   sorgusunun kendisi de RLS (`jobs_select_visible`, sahibi/admin) altında
 *   çalışır — `auth.uid()` sunucu tarafında JWT'den gelir, bu fonksiyon bir
 *   kullanıcı id'sini asla parametre olarak GEÇİRMEZ.
 */
export async function reconcileLocalPendingJobsWithSupabase(jobs: readonly Job[]): Promise<void> {
  if (!isSupabaseJobSyncEnabled()) return;

  const candidates = jobs.filter((job) => job.moderationStatus === "pending_review" && !job.supabaseSyncFailedAt);
  if (candidates.length === 0) return;

  const supabase = createSupabaseBrowserClient();
  const { data: existingRows, error } = await supabase
    .from("jobs")
    .select("id")
    .in("id", candidates.map((job) => job.id));
  if (error) return; // Ağ/erişim hatası — mevcut duruma dokunmadan sessizce vazgeç, sahte bir "başarısız" işareti KOYMA.

  const existingIds = new Set((existingRows ?? []).map((row) => row.id as string));
  for (const job of candidates) {
    if (!existingIds.has(job.id)) {
      markJobSupabaseSyncFailed(
        job.id,
        "Bu ilan sunucuda bulunamadı — senkronizasyon hiç tamamlanmamış olabilir (eski sürüm hatası).",
      );
    }
  }
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
    p_customs_transaction_type: job.customsTransactionType ?? null,
    p_customs_requested_services: job.customsRequestedServices ?? null,
    p_client_id: job.id,
    p_delivery_province: job.deliveryProvince ?? null,
    p_delivery_district: job.deliveryDistrict ?? null,
    p_delivery_location_type: job.deliveryLocationType ?? null,
    p_delivery_facility_id: job.deliveryFacilityId ?? null,
    p_delivery_facility_name: job.deliveryFacilityName ?? null,
    p_delivery_address_text: job.deliveryAddressText ?? null,
    p_recycling_material_category_id: job.recyclingMaterialCategoryId ?? null,
    p_recycling_material_subtype_id: job.recyclingMaterialSubtypeId ?? null,
    p_recycling_quantity: job.recyclingQuantity ?? null,
    p_recycling_unit: job.recyclingUnit ?? null,
    p_recycling_material_condition: job.recyclingMaterialCondition ?? null,
    p_recycling_material_condition_note: job.recyclingMaterialConditionNote ?? null,
    p_recycling_scope_of_work: job.recyclingScopeOfWork ?? null,
    p_storage_product_type: job.storageProductType ?? null,
    p_storage_product_quantity: job.storageProductQuantity ?? null,
    p_storage_product_unit: job.storageProductUnit ?? null,
    p_storage_product_tonnage: job.storageProductTonnage ?? null,
    p_storage_container_groups: job.storageContainerGroups ?? null,
    p_product_tonnage_unit: job.productTonnageUnit ?? null,
    p_nakliye_load_preparation_type: job.nakliyeDetails?.loadPreparationType ?? null,
    p_nakliye_load_preparation_custom_text: job.nakliyeDetails?.loadPreparationCustomText ?? null,
    p_nakliye_loading_method: job.nakliyeDetails?.loadingMethod ?? null,
    p_nakliye_loading_method_custom_text: job.nakliyeDetails?.loadingMethodCustomText ?? null,
    p_nakliye_measurement_info: job.nakliyeDetails?.measurementInfo ?? null,
    p_nakliye_hazmat: job.nakliyeDetails?.hazmat ?? null,
    p_nakliye_container_transport: job.nakliyeDetails?.containerTransport ?? null,
    p_nakliye_cargo_groups: job.nakliyeCargoGroups ?? null,
    p_storage_hazardous: job.storageHazardous ?? null,
    p_storage_risk_groups: job.storageRiskGroups ?? null,
    p_recycling_requested_operation: job.recyclingRequestedOperation ?? null,
    p_recycling_waste_code: job.recyclingWasteCode ?? null,
    p_recycling_waste_code_unknown: job.recyclingWasteCodeUnknown ?? null,
    p_recycling_hazard_properties: job.recyclingHazardProperties ?? null,
  });
  if (error) {
    // Metadata satırı hiç yazılamadı — az önce yüklenen fotoğraflar Storage'da
    // yetim kalmasın diye geri silinir (bkz. modülün üstündeki dokümantasyon).
    await deleteJobPhotosFromStorage(photosResult.uploadedPaths);
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "create_job", affectedScreen: "İlan Oluşturma" });
    return { ok: false, error: getAccountStatusErrorMessage(error.code) ?? error.message };
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
    customs_transaction_type: job.customsTransactionType ?? null,
    customs_requested_services: job.customsRequestedServices ?? null,
    // Yalnızca Nakliye kardeşi doludur (job-store.ts'in kendi aktif
    // temizleme ilkesi) — diğer kardeşlerde zaten `undefined`, RPC'ye her
    // zaman `null` gider (migration 0031).
    delivery_province: job.deliveryProvince ?? null,
    delivery_district: job.deliveryDistrict ?? null,
    delivery_location_type: job.deliveryLocationType ?? null,
    delivery_facility_id: job.deliveryFacilityId ?? null,
    delivery_facility_name: job.deliveryFacilityName ?? null,
    delivery_address_text: job.deliveryAddressText ?? null,
    // Yalnızca Geri Dönüşüm & Atık Tahliye kardeşi doludur (job-store.ts'in
    // kendi aktif temizleme ilkesi) — diğer kardeşlerde zaten `undefined`.
    recycling_material_category_id: job.recyclingMaterialCategoryId ?? null,
    recycling_material_subtype_id: job.recyclingMaterialSubtypeId ?? null,
    recycling_quantity: job.recyclingQuantity ?? null,
    recycling_unit: job.recyclingUnit ?? null,
    recycling_material_condition: job.recyclingMaterialCondition ?? null,
    recycling_material_condition_note: job.recyclingMaterialConditionNote ?? null,
    recycling_scope_of_work: job.recyclingScopeOfWork ?? null,
    recycling_requested_operation: job.recyclingRequestedOperation ?? null,
    recycling_waste_code: job.recyclingWasteCode ?? null,
    recycling_waste_code_unknown: job.recyclingWasteCodeUnknown ?? null,
    recycling_hazard_properties: job.recyclingHazardProperties ?? null,
    // Yalnızca Depo Hizmetleri grubundaki kardeşte doludur (job-store.ts'in
    // kendi aktif temizleme ilkesi) — diğer kardeşlerde zaten `undefined`.
    storage_product_type: job.storageProductType ?? null,
    storage_product_quantity: job.storageProductQuantity ?? null,
    storage_product_unit: job.storageProductUnit ?? null,
    storage_product_tonnage: job.storageProductTonnage ?? null,
    storage_container_groups: job.storageContainerGroups ?? null,
    // Yalnızca Kimyasal Depolama/Tehlikeli Madde Depolama kardeşinde
    // doludur (job-store.ts'in kendi aktif temizleme ilkesi).
    storage_hazardous: job.storageHazardous ?? null,
    storage_risk_groups: job.storageRiskGroups ?? null,
    // Yalnızca Nakliye kardeşi doludur (job-store.ts'in kendi aktif
    // temizleme ilkesi) — diğer kardeşlerde zaten `undefined`.
    product_tonnage_unit: job.productTonnageUnit ?? null,
    nakliye_load_preparation_type: job.nakliyeDetails?.loadPreparationType ?? null,
    nakliye_load_preparation_custom_text: job.nakliyeDetails?.loadPreparationCustomText ?? null,
    nakliye_loading_method: job.nakliyeDetails?.loadingMethod ?? null,
    nakliye_loading_method_custom_text: job.nakliyeDetails?.loadingMethodCustomText ?? null,
    nakliye_measurement_info: job.nakliyeDetails?.measurementInfo ?? null,
    nakliye_cargo_groups: job.nakliyeCargoGroups ?? null,
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
    return { ok: false, error: getAccountStatusErrorMessage(error.code) ?? error.message };
  }
  return { ok: true };
}

/**
 * "Supabase Gerçek Kaynak" görevi — `job-request-form.tsx`'in ÖNCEKİ
 * "önce yerelde oluştur, sonra en-iyi-çaba senkronla" sırasının yerine
 * geçen TEK giriş noktası. Sıra artık TERS: `buildJobForCreation`
 * (job-store.ts) yalnızca `Job` nesnesini İNŞA EDER (fotoğraflar zaten
 * IndexedDB'ye yazılır, çünkü `syncJobToSupabase`'in Storage yükleme adımı
 * bu blob'ları okur) — HENÜZ localStorage'a hiç YAZILMAZ. `syncJobToSupabase`
 * (yukarıda, DEĞİŞTİRİLMEDİ) BAŞARISIZ olursa, henüz hiçbir yere
 * bağlanmamış fotoğraf/evrak IndexedDB blob'ları geri alınır ve hata
 * döner — kullanıcı formda kalır, yerel "sahte yayımlanmış" bir ilan asla
 * oluşmaz. Yalnızca Supabase GERÇEKTEN başarılı döndükten SONRA `commitJob`
 * (job-store.ts) çağrılır; bu andan itibaren localStorage yalnızca
 * yardımcı önbellektir (görev gereksinimi #4) — asıl kaynak zaten
 * Supabase'te GERÇEKTEN var olan satırdır.
 *
 * Çift tıklama/mükerrer gönderim koruması bu fonksiyonun KENDİSİNDE değil,
 * çağıranın (job-request-form.tsx#submitLockRef, değişmedi) senkron
 * kilidinde kalmaya devam eder — burada YENİ bir kilit mekanizması İCAT
 * EDİLMEDİ.
 */
export async function createJobWithSupabaseSync(
  session: Session | null,
  input: CreateJobInput,
): Promise<CreateJobResult> {
  const built = await buildJobForCreation(session, input);
  if (!built.ok) return built;

  const syncResult = await syncJobToSupabase(built.job);
  if (!syncResult.ok) {
    await deletePhotoBlobs(
      [...built.job.photos, ...(built.job.customsDocuments ?? [])].map((item) => item.storageKey),
    );
    return { ok: false, error: syncResult.error };
  }

  // Sunucu kaydı ZATEN başarıyla oluştu — bu andan sonra yerel yazım
  // yalnızca bir önbellek adımıdır. Başarısız olsa bile genel sonuç
  // BAŞARIdır (görev gereksinimi #4): `useAllJobs()`'un uzak-geri-dönüşü
  // (bkz. use-jobs.ts) bu ilanı bir SONRAKİ getirmede zaten gösterecektir —
  // yalnızca gerçek hata console'a loglanır, kullanıcıya sahte bir
  // BAŞARISIZLIK gösterilmez (tam tersi de doğru: sahte başarı da
  // gösterilmez, çünkü Supabase zaten gerçekten başarılı oldu).
  if (!commitJob(built.job)) {
    console.error(`İlan Supabase'e kaydedildi ancak yerel önbelleğe yazılamadı (job ${built.job.id}).`);
  }

  return { ok: true, job: built.job };
}

/** `createJobWithSupabaseSync`in çoklu hizmet/operasyon karşılığı — AYNI ilke. */
export async function createJobsForOperationWithSupabaseSync(
  session: Session | null,
  input: CreateJobsForOperationInput,
): Promise<CreateJobsForOperationResult> {
  const built = await buildJobsForOperation(session, input);
  if (!built.ok) return built;

  // `.trim()` — `buildJobsForOperation`in (job-store.ts) kendi içinde
  // `province`/`operationDetails`i her bir `job` alanına yazarken uyguladığı
  // AYNI normalizasyon; burada tekrarlanır çünkü `CreateJobsForOperationResult`
  // trim'lenmiş halini ayrıca döndürmez — `.trim()` idempotent olduğu için
  // bu, sonucu asla değiştirmez, yalnızca iki tarafın (yerel `Job.province`
  // ve `syncOperationToSupabase`'e giden paylaşılan `province`) AYNI ham
  // girdiden AYNI şekilde türetildiğini garanti eder.
  const syncResult = await syncOperationToSupabase(
    built.jobs,
    built.operationId,
    input.province.trim(),
    input.operationDetails.trim(),
  );
  if (!syncResult.ok) {
    await Promise.all(
      built.jobs.map((job) =>
        deletePhotoBlobs([...job.photos, ...(job.customsDocuments ?? [])].map((item) => item.storageKey)),
      ),
    );
    return { ok: false, error: syncResult.error };
  }

  if (!commitJobs(built.jobs)) {
    console.error(`Operasyon Supabase'e kaydedildi ancak yerel önbelleğe yazılamadı (operation ${built.operationId}).`);
  }

  return { ok: true, jobs: built.jobs, operationId: built.operationId };
}

/**
 * "Supabase Gerçek Kaynak" görevi — `job-edit-form.tsx`'in ÖNCEKİ "önce
 * yerelde güncelle, sonra en-iyi-çaba senkronla" sırasının yerine geçen TEK
 * giriş noktası; `createJobWithSupabaseSync`'in AYNI ters-sıra ilkesi
 * (build -> uzak yazım BLOKLAYAN -> yalnızca başarılıysa yerel commit).
 *
 * KAPSAM SINIRI (bilerek, YENİ bir RPC/kapsam İCAT EDİLMEDİ): `update_job_
 * as_requester` RPC'si (migration 0051) yalnızca hâlâ "pending_review" olan
 * bir satırı kabul eder — admin ZATEN karar vermiş (approved/rejected) bir
 * ilanın sahibi tarafından düzenlenmesi bu RPC'nin ÖNCEDEN VAR OLAN, bilinçli
 * kapsam dışıdır (admin'in kendi ayrı `update_job_as_admin` yolu var). Bu
 * durumda (`previousModerationStatus !== "pending_review"`) GÖREV1'in
 * "Supabase önce" kuralı hiç uygulanmaz — düzenleme, bu görevden ÖNCEKİYLE
 * BİREBİR AYNI şekilde yalnızca yerel kalır (moderationStatus zaten
 * job-store.ts#buildJobUpdate içinde "pending_review"a sıfırlanmış olabilir,
 * bu YENİ bir davranış değil, önceden var olan "İlan Onayı" kuralıdır).
 *
 * `update_job_as_requester` fotoğraf/evrak senkronlamaz (bkz.
 * updateJobAsRequesterOnSupabase'in kendi dokümanı) — bu yüzden yeni
 * persistlenmiş blob'ların geri alınması SAF yerel bir kaygıdır, uzak
 * senkronun başarı/başarısızlığından bağımsız olarak (job-store.ts#updateJob'un
 * orijinal, değişmemiş davranışıyla BİREBİR aynı) ele alınır.
 */
export async function updateJobWithSupabaseSync(
  session: Session | null,
  jobId: string,
  input: UpdateJobInput,
  offers: Offer[],
  fallbackJob?: Job,
): Promise<CreateJobResult> {
  const built = await buildJobUpdate(session, jobId, input, offers, fallbackJob);
  if (!built.ok) return built;
  const { job: updated, existing, previousModerationStatus, newlyPersistedPhotos, newlyPersistedCustomsDocuments } = built;

  async function rollbackNewBlobs() {
    await deletePhotoBlobs([...newlyPersistedPhotos, ...newlyPersistedCustomsDocuments].map((item) => item.storageKey));
  }

  if (previousModerationStatus === "pending_review") {
    const syncResult = await retryJobSupabaseSync(updated);
    if (!syncResult.ok) {
      await rollbackNewBlobs();
      return { ok: false, error: syncResult.error };
    }
  }

  if (!commitJobUpdate(jobId, updated)) {
    if (previousModerationStatus === "pending_review") {
      // Sunucu kaydı ZATEN güncellendi — bu andan sonra yerel yazım yalnızca
      // bir önbellek adımıdır (createJobWithSupabaseSync'in AYNI ilkesi).
      console.error(`İlan güncellemesi Supabase'e kaydedildi ancak yerel önbelleğe yazılamadı (job ${jobId}).`);
    } else {
      await rollbackNewBlobs();
      return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
    }
  } else {
    const removedPhotos = existing.photos.filter((photo) => !input.keptPhotoIds.includes(photo.id));
    if (removedPhotos.length > 0) await deletePhotoBlobs(removedPhotos.map((photo) => photo.storageKey));
    const finalCustomsDocumentIds = new Set((updated.customsDocuments ?? []).map((doc) => doc.id));
    const orphanedCustomsDocuments = [...(existing.customsDocuments ?? []), ...newlyPersistedCustomsDocuments].filter(
      (doc) => !finalCustomsDocumentIds.has(doc.id),
    );
    if (orphanedCustomsDocuments.length > 0) await deletePhotoBlobs(orphanedCustomsDocuments.map((doc) => doc.storageKey));
  }

  return { ok: true, job: updated };
}
