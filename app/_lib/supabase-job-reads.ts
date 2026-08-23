import { sanitizeContainerTransport, sanitizeHazmatDetail, sanitizeMeasurementInfo } from "./nakliye-transport-catalog";
import { sanitizeStorageContainerGroups } from "./storage-container-catalog";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Job, JobPhoto } from "./types";

/**
 * Merkezi Veri Zorunluluğu (Development Temizliği görevi, Faz 5) —
 * `jobs-lookup.ts#findJobById`in localStorage-only okuma yolunun YANINA,
 * ikinci bir ilan sistemi KURMADAN, tek bir salt-okunur Supabase geri
 * dönüş katmanı ekler. `create_job`/`update_job_as_requester` RPC'lerinin
 * YAZDIĞI AYNI `jobs`/`job_photos` tablolarını okur — ama artık (MALSEVK
 * genel ilan gizlilik kuralı, bkz. supabase/migrations/0052) ham `select`
 * İLE DEĞİL, `get_visible_job`/`get_visible_jobs` RPC'leri üzerinden: bu
 * RPC'ler hem `jobs_select_visible` (0013/0035, moderasyon +
 * `provider_can_view_category`) satır-görünürlük kuralını BİREBİR
 * uygular hem de tesis adı/açık adres alanlarını, çağıranın o ilanda kabul
 * edilmiş bir teklifi olmadığı sürece sunucu tarafında NULL'a indirger —
 * bu dosyanın kendisi ikinci bir RLS/görünürlük/maskeleme mantığı YAZMAZ.
 *
 * ÖNCELİK KURALI: yerel (localStorage) kopya HER ZAMAN önce denenir (bkz.
 * çağıran taraf, `use-jobs.ts#useAllJobs`/`useRemoteJobsFallback`) — bu
 * modül yalnızca yerelde HİÇ bulunamayan bir ilan için devreye girer.
 * Pratikte bu, bir ilanın SAHİBİNİN kendi tarayıcısı dışındaki HER profil
 * için (başka bir hesap, admin, farklı bir cihaz/tarayıcı) Supabase'in
 * fiilen "merkezi kaynak" olması anlamına gelir — çünkü o profillerin
 * localStorage'ında bu ilana ait zaten hiçbir satır yoktur. `job-edit-form.tsx`
 * artık, ilan hâlâ `pending_review` iken, `update_job_as_requester`
 * (migration 0051) üzerinden Supabase'e de yazıyor — ama yalnızca o dar
 * durumda; onaylanmış/reddedilmiş bir ilanın sahip düzenlemesi hâlâ yalnızca
 * yereldir. Bu yüzden "yerel varsa yerel kazanır" kuralı (bkz.
 * `use-jobs.ts#remoteWinsOverLocal`) BİLEREK korunur, aksi halde bir ilan
 * sahibinin kendi tazecik düzenlemesi, Supabase'deki eski kopya tarafından
 * geçersiz kılınabilirdi.
 */

type SupabaseJobRow = {
  id: string;
  operation_id: string | null;
  requester_id: string;
  category_id: string;
  title: string;
  description: string;
  operation_details: string | null;
  province: string;
  district: string;
  work_location_type: string;
  facility_id: string | null;
  location_mode: string | null;
  address_text: string | null;
  neighborhood: string | null;
  location_url: string | null;
  directions_note: string | null;
  work_date: string;
  work_end_date: string | null;
  listing_status: string;
  created_at: string;
  publish_end_at: string | null;
  closed_at: string | null;
  closure_reason: string | null;
  republished_from_job_id: string | null;
  republished_to_job_id: string | null;
  product_quantity: number | null;
  product_tonnage: number | null;
  product_type: string | null;
  customs_product_type: string | null;
  delivery_province: string | null;
  delivery_district: string | null;
  delivery_location_type: string | null;
  delivery_facility_id: string | null;
  delivery_facility_name: string | null;
  delivery_address_text: string | null;
  moderation_status: string | null;
  moderation_reviewed_at: string | null;
  moderation_reviewed_by: string | null;
  moderation_rejection_reason: string | null;
  recycling_material_category_id: string | null;
  recycling_material_subtype_id: string | null;
  recycling_quantity: number | null;
  recycling_unit: string | null;
  recycling_material_condition: string | null;
  recycling_material_condition_note: string | null;
  recycling_scope_of_work: string[] | null;
  customs_transaction_type: string | null;
  customs_requested_services: string[] | null;
  storage_product_type: string | null;
  storage_product_quantity: number | null;
  storage_product_unit: string | null;
  storage_product_tonnage: number | null;
  storage_container_groups: unknown;
  product_tonnage_unit: string | null;
  nakliye_load_preparation_type: string | null;
  nakliye_load_preparation_custom_text: string | null;
  nakliye_loading_method: string | null;
  nakliye_loading_method_custom_text: string | null;
  /** Ham JSONB — sanitizeNakliyeDetails ile AYNI derin doğrulama, ama burada doğrudan mapJobRow içinde uygulanır. */
  nakliye_measurement_info: unknown;
  nakliye_hazmat: unknown;
  nakliye_container_transport: unknown;
  /** "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi (migration 0068) — GERÇEK tarayıcı testiyle bulunan bir bug: bu iki alan bu satırdan ÖNCE burada hiç yoktu, bu yüzden yalnızca YEREL kopyası OLMAYAN (uzak/Supabase okuma yoluna düşen) bir Hizmet Veren'in ekranında job.storageHazardous/storageRiskGroups DAİMA undefined kalıyordu — isProviderEligibleForHazardousStorageJob bunu (yanlışlıkla) "tehlikeli değil" (fail-OPEN, storage-hazard-catalog.ts'in kendi "tehlikeli değilse true" varsayımı) olarak okuyordu. Sunucu tarafı (create_offer'ın MLK60 kapısı) bu HİÇ etkilenmedi — yalnızca istemci tarafı görünürlük/buton gösterimi. */
  storage_hazardous: boolean | null;
  storage_risk_groups: string[] | null;
  /** "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi (migration 0069) — storage_hazardous/storage_risk_groups İLE AYNI, GERÇEK tarayıcı testiyle bulunan bug — burada ise fail-closed (isProviderEligibleForRecyclingJob'un "kod undefined ise false" ilk koşulu) OLDUĞU İÇİN etkisi TERSTİ: tam yetkili bir Hizmet Veren bile, ilanı KENDİSİ yerelde hiç oluşturmadıysa, ilana asla teklif VEREMİYORDU (backend zaten doğru izin veriyordu, yalnızca istemci tarafı "İlan bulunamadı" hatası gösteriyordu). */
  recycling_requested_operation: string | null;
  recycling_waste_code: string | null;
  recycling_waste_code_unknown: boolean | null;
  recycling_hazardous: boolean | null;
  recycling_hazard_properties: string[] | null;
};

type SupabaseJobPhotoRow = {
  id: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
};

/**
 * `use-job-photo-url.ts`in tanıdığı özel önek — IndexedDB'de hiç blob'u
 * olmayan (yalnızca Supabase Storage'da var olan) bir fotoğraf için, storageKey
 * alanına doğrudan çözülmüş bir genel URL taşımanın yolu. `job-photos`
 * bucket'ı zaten `public: true` (0019) — imzalı URL üretmeye gerek yok.
 */
export const SUPABASE_PUBLIC_PHOTO_PREFIX = "supabase-public-url:";

function mapPhotoRow(row: SupabaseJobPhotoRow, publicUrl: string): JobPhoto {
  return {
    id: row.id,
    order: row.sort_order,
    fileName: row.original_file_name,
    fileSize: row.size_bytes,
    mimeType: row.mime_type,
    storageKey: `${SUPABASE_PUBLIC_PHOTO_PREFIX}${publicUrl}`,
  };
}

function mapJobRow(row: SupabaseJobRow, photos: JobPhoto[]): Job {
  return {
    id: row.id,
    title: row.title,
    category: row.category_id,
    province: row.province,
    district: row.district,
    // MALSEVK genel ilan gizlilik kuralı (bkz. supabase/migrations/0052) —
    // get_visible_job(s) bu alanı, çağıranın teklifi kabul edilmediği
    // sürece sunucu tarafında NULL'a indirger; ama types.ts#Job.workLocationType
    // OPSİYONEL DEĞİL (`string`, `string | undefined` değil) — job-location.ts#
    // resolveJobFacility gibi çağıranlar onu koşulsuz `.trim()`ler. `?? ""`
    // olmadan bu, teklifi kabul edilmemiş her Hizmet Veren'in (yalnızca
    // uzak/Supabase okuma yoluna düşen — kendi tarayıcısında yerel kopyası
    // OLMAYAN) ilan detay sayfasını GERÇEKTEN ÇÖKERTİYORDU (canlı olarak
    // gözlemlendi — "Depolama İlan Oluşturma" görevinin uçtan uca tarayıcı
    // testinde bulundu, bu kategoriye özel değil, TÜM kategorileri etkiler).
    workLocationType: row.work_location_type ?? "",
    facilityId: row.facility_id ?? undefined,
    addressText: row.address_text ?? undefined,
    locationMode: row.location_mode === "custom" ? "custom" : "catalog",
    neighborhood: row.neighborhood ?? undefined,
    locationUrl: row.location_url ?? undefined,
    directionsNote: row.directions_note ?? undefined,
    workDate: row.work_date,
    workEndDate: row.work_end_date ?? undefined,
    description: row.description,
    operationDetails: row.operation_details ?? "",
    status: row.listing_status === "tamamlandi" || row.listing_status === "iptal" ? row.listing_status : "yayinda",
    requesterId: row.requester_id,
    operationId: row.operation_id ?? undefined,
    productQuantity: row.product_quantity ?? undefined,
    productTonnage: row.product_tonnage ?? undefined,
    productType: row.product_type ?? undefined,
    photos,
    customsTransactionType: row.customs_transaction_type ?? undefined,
    customsRequestedServices: row.customs_requested_services ?? undefined,
    customsProductType: row.customs_product_type ?? undefined,
    createdAt: row.created_at,
    publishEndAt: row.publish_end_at ?? undefined,
    republishedFromJobId: row.republished_from_job_id ?? undefined,
    republishedToJobId: row.republished_to_job_id ?? undefined,
    closedAt: row.closed_at ?? undefined,
    closureReason: (row.closure_reason as Job["closureReason"]) ?? undefined,
    deliveryProvince: row.delivery_province ?? undefined,
    deliveryDistrict: row.delivery_district ?? undefined,
    deliveryLocationType: (row.delivery_location_type as Job["deliveryLocationType"]) ?? undefined,
    deliveryFacilityId: row.delivery_facility_id ?? undefined,
    deliveryFacilityName: row.delivery_facility_name ?? undefined,
    deliveryAddressText: row.delivery_address_text ?? undefined,
    recyclingMaterialCategoryId: row.recycling_material_category_id ?? undefined,
    recyclingMaterialSubtypeId: row.recycling_material_subtype_id ?? undefined,
    recyclingQuantity: row.recycling_quantity ?? undefined,
    recyclingUnit: (row.recycling_unit as Job["recyclingUnit"]) ?? undefined,
    recyclingMaterialCondition: (row.recycling_material_condition as Job["recyclingMaterialCondition"]) ?? undefined,
    recyclingMaterialConditionNote: row.recycling_material_condition_note ?? undefined,
    recyclingScopeOfWork: row.recycling_scope_of_work ?? undefined,
    storageProductType: row.storage_product_type ?? undefined,
    storageProductQuantity: row.storage_product_quantity ?? undefined,
    storageProductUnit: (row.storage_product_unit as Job["storageProductUnit"]) ?? undefined,
    storageProductTonnage: row.storage_product_tonnage ?? undefined,
    storageContainerGroups: sanitizeStorageContainerGroups(row.storage_container_groups),
    productTonnageUnit: (row.product_tonnage_unit as Job["productTonnageUnit"]) ?? undefined,
    nakliyeDetails: row.nakliye_load_preparation_type || row.nakliye_loading_method || row.nakliye_measurement_info || row.nakliye_hazmat || row.nakliye_container_transport
      ? {
          loadPreparationType: row.nakliye_load_preparation_type ?? undefined,
          loadPreparationCustomText: row.nakliye_load_preparation_custom_text ?? undefined,
          measurementInfo: sanitizeMeasurementInfo(row.nakliye_measurement_info),
          loadingMethod: row.nakliye_loading_method ?? undefined,
          loadingMethodCustomText: row.nakliye_loading_method_custom_text ?? undefined,
          hazmat: sanitizeHazmatDetail(row.nakliye_hazmat),
          containerTransport: sanitizeContainerTransport(row.nakliye_container_transport),
        }
      : undefined,
    moderationStatus: (row.moderation_status as Job["moderationStatus"]) ?? undefined,
    moderationReviewedAt: row.moderation_reviewed_at ?? undefined,
    moderationReviewedBy: row.moderation_reviewed_by ?? undefined,
    moderationRejectionReason: row.moderation_rejection_reason ?? undefined,
    storageHazardous: row.storage_hazardous ?? undefined,
    storageRiskGroups: row.storage_risk_groups ?? undefined,
    recyclingRequestedOperation: row.recycling_requested_operation ?? undefined,
    recyclingWasteCode: row.recycling_waste_code ?? undefined,
    recyclingWasteCodeUnknown: row.recycling_waste_code_unknown ?? undefined,
    recyclingHazardous: row.recycling_hazardous ?? undefined,
    recyclingHazardProperties: row.recycling_hazard_properties ?? undefined,
  };
}

async function fetchPhotosForJobs(jobIds: string[]): Promise<Map<string, JobPhoto[]>> {
  const supabase = createSupabaseBrowserClient();
  const byJob = new Map<string, JobPhoto[]>();
  if (jobIds.length === 0) return byJob;

  const { data } = await supabase
    .from("job_photos")
    .select("id, job_id, storage_path, original_file_name, mime_type, size_bytes, sort_order")
    .in("job_id", jobIds)
    .order("sort_order", { ascending: true });

  for (const row of (data ?? []) as unknown as (SupabaseJobPhotoRow & { job_id: string })[]) {
    const { data: publicUrlData } = supabase.storage.from("job-photos").getPublicUrl(row.storage_path);
    const photo = mapPhotoRow(row, publicUrlData.publicUrl);
    const existing = byJob.get(row.job_id) ?? [];
    existing.push(photo);
    byJob.set(row.job_id, existing);
  }
  return byJob;
}

/**
 * Tek bir ilanı, `jobId` ile, RLS'in izin verdiği ölçüde Supabase'ten çeker.
 * MALSEVK genel ilan gizlilik kuralı (bkz. supabase/migrations/0052) — artık
 * ham `jobs` tablosu DEĞİL, `get_visible_job` RPC'si çağrılır: bu RPC hem
 * satır görünürlüğünü (jobs_select_visible ile birebir aynı — moderasyon +
 * kategori yetkisi) hem de tesis adı/açık adres alanlarının, çağıranın bu
 * ilanda kabul edilmiş (ENGAGED_OFFER_STATUSES) bir teklifi olmadığı sürece
 * sunucu tarafında NULL'a indirgenmesini tek yerde uygular — bu dosyanın
 * kendisi hiçbir maskeleme mantığı YAZMAZ, yalnızca dönen satırı `mapJobRow`
 * ile aynı şekle çevirir. Görünmüyorsa/yoksa `null` — "yok" ile "erişimin
 * yok" ayrımı burada da sızdırılmaz.
 */
export async function fetchJobByIdFromSupabase(jobId: string): Promise<Job | null> {
  const supabase = createSupabaseBrowserClient();
  const { data: jobRow, error } = await supabase.rpc("get_visible_job", { p_job_id: jobId }).maybeSingle();
  if (error || !jobRow) return null;

  const photosByJob = await fetchPhotosForJobs([jobId]);
  return mapJobRow(jobRow as unknown as SupabaseJobRow, photosByJob.get(jobId) ?? []);
}

/**
 * İlan listeleme ekranları için — `get_visible_jobs` RPC'si üzerinden,
 * RLS'in izin verdiği TÜM ilanları (moderasyon onaylı + kategori yetkisi
 * olanlar), tesis adı/açık adres alanları teklifi kabul edilmemiş
 * çağıranlar için sunucu tarafında maskelenmiş olarak çeker (bkz.
 * fetchJobByIdFromSupabase'in dokümanı — aynı RPC ailesi, aynı kural).
 * Çağıran taraf yerel (localStorage) listeyle `id`ye göre birleştirir, yerel
 * kopya her zaman kazanır (bkz. bu dosyanın üst dokümantasyonu).
 */
export async function fetchAllVisibleJobsFromSupabase(): Promise<Job[]> {
  const supabase = createSupabaseBrowserClient();
  const { data: jobRows, error } = await supabase.rpc("get_visible_jobs").order("created_at", { ascending: false });
  if (error || !jobRows) return [];

  const rows = jobRows as unknown as SupabaseJobRow[];
  const photosByJob = await fetchPhotosForJobs(rows.map((r) => r.id));
  return rows.map((row) => mapJobRow(row, photosByJob.get(row.id) ?? []));
}
