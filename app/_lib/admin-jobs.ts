import { applyAdminJobEdit, applyAdminModerationDecision, type AdminJobEditInput } from "./job-store";
import { sanitizeContainerTransport, sanitizeHazmatDetail, sanitizeMeasurementInfo, sanitizeNakliyeCargoGroups } from "./nakliye-transport-catalog";
import { sanitizeStorageContainerGroups } from "./storage-container-catalog";
import { sanitizeStorageRiskGroups } from "./storage-hazard-catalog";
import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { reportSystemError } from "./system-health";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { getJobPhotoPublicUrl } from "./supabase-job-photos";
import type {
  JobClosureReason,
  JobModerationStatus,
  NakliyeCargoGroup,
  NakliyeContainerTransport,
  NakliyeHazmatDetail,
  NakliyeMeasurementInfo,
  StorageContainerGroup,
} from "./types";

/**
 * Admin "İlan Yönetimi" modülü — MALSEVK Faz 2. Tamamı mevcut tablo/view/
 * RPC'lerden okunur/yazılır: admin_job_list view'ı (0017, jobs.* + offer_
 * count, is_admin() kendi içinde), offers (0005, admin RLS dalı zaten var),
 * service_categories (0002), profiles (0003), close_job_as_admin() RPC'si
 * (0016, admin-only).
 *
 * "Ürün Bilgileri" (Ürün Adedi/Tonaj/Ürün Cinsi/Gümrük Ürün Cinsi):
 * `product_quantity`/`product_tonnage`/`product_type`/`customs_product_type`
 * kolonları Supabase Geçişi Faz 2'nin migration 0028'iyle `jobs` tablosuna
 * eklendi (önceki bir denetimde bu kolonların yokluğu doğru şekilde tespit
 * edilmişti — o tespit artık geçerli değil). `getJobDetailForAdmin` bu dördü
 * de doğrudan `jobs`tan okur; render tarafı (`admin-job-detail.tsx`) yalnız
 * gerçekten dolu olan alanı gösterir (kategori kapsam dışıysa ya da bu
 * senkron henüz yazılmadan önce oluşturulmuş bir ilan için hepsi `null`
 * kalabilir — bu bir hata değildir, aynı localStorage tarafının
 * `hasProductInfo` ilkesiyle tutarlıdır).
 *
 * Fotoğraflar (Supabase Geçişi Faz 3): `job_photos` (0004) `job-photos`
 * public bucket'ına (0019) işaret eder — `getJobPhotoPublicUrl`
 * (supabase-job-photos.ts) ile doğrudan genel URL'e çevrilir, imzalı URL
 * gerekmez. `deleted_at is null` filtresi ve `sort_order` sıralaması
 * job-store.ts'in kendi (localStorage) JobPhoto listesiyle AYNI ilke.
 *
 * Nakliye teslimat alanları (Supabase Geçişi Faz 4, migration 0031):
 * `delivery_*` kolonları yalnızca Nakliye kategorisindeki ilanlarda dolu —
 * render tarafı (`admin-job-detail.tsx`, bu genel Nakliye ilan detay görsel
 * düzenlemesinin KAPSAMI DIŞINDA — admin ekranı kendi ayrı gösterimini
 * korur) yalnızca `deliveryProvince` doluysa "Teslim Edilecek Yer" bölümünü
 * gösterir (job-detail-content.tsx#NakliyeRouteSummary İLE AYNI "varsa
 * göster" ilkesi).
 *
 * İlan Onayı (admin moderasyonu, migration 0035): `moderation_status`/
 * `moderation_reviewed_at`/`moderation_reviewed_by`/`moderation_rejection_reason`
 * kolonları + `approve_job_as_admin`/`reject_job_as_admin`/
 * `update_job_as_admin` RPC'leri — `close_job_as_admin` ile AYNI is_admin()
 * self-gate deseni. `admin_job_list` view'ı (0017) bu migration'da yeniden
 * oluşturuldu (`j.*` bir view'ın kolon listesini CREATE anında sabitler —
 * bkz. 0035'in kendi notu) — bu yüzden bu view artık moderation_status'un
 * yanı sıra daha önce hiç dönmemiş olan product_ ve delivery_ önekli
 * kolonları da (0028/0031) döndürüyor. `approveJobAsAdmin`/`rejectJobAsAdmin`/
 * `updateJobAsAdmin` her başarılı RPC çağrısından SONRA, best-effort olarak
 * `job-store.ts#applyAdminModerationDecision`/`applyAdminJobEdit`yi de
 * çağırır — bu, GERÇEK yetkilendirme sınırı olan yukarıdaki RPC'nin bir
 * YANSIMASIDIR; yalnızca bu ilan bu tarayıcının paylaşılan localStorage ilan
 * havuzunda da mevcutsa canlı Hizmet Veren/Hizmet Alan ekranlarına yansır
 * (bkz. proje raporu "No real backend" notu — bugünkü CANLI uygulama akışı
 * Supabase'i hiç okumaz).
 */

export type AdminJobStatus = "yayinda" | "teklif_bekliyor" | "devam_ediyor" | "tamamlandi" | "suresi_doldu" | "kapatildi";

const ENGAGED_OFFER_STATUSES = new Set(["accepted", "in_progress", "completion_requested", "completion_disputed"]);

export type AdminJobListItem = {
  id: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  companyName: string | null;
  requesterFullName: string | null;
  province: string;
  district: string;
  createdAt: string;
  status: AdminJobStatus;
  offerCount: number;
  /** İlan Onayı (0035) — bkz. app/_lib/job-moderation.ts'in localStorage tarafındaki AYNI kavramı. */
  moderationStatus: JobModerationStatus;
};

type JobRow = {
  id: string;
  operation_id: string | null;
  requester_id: string;
  category_id: string;
  title: string;
  province: string;
  district: string;
  created_at: string;
  publish_end_at: string;
  closed_at: string | null;
  deleted_at: string | null;
  offer_count: number;
  moderation_status: JobModerationStatus;
};

function deriveStatus(job: { closed_at: string | null; publish_end_at: string }, offerStatuses: string[]): AdminJobStatus {
  if (job.closed_at !== null) return "kapatildi";
  if (offerStatuses.includes("completed")) return "tamamlandi";
  if (offerStatuses.some((status) => ENGAGED_OFFER_STATUSES.has(status))) return "devam_ediyor";
  if (new Date(job.publish_end_at).getTime() < Date.now()) return "suresi_doldu";
  if (offerStatuses.includes("pending")) return "teklif_bekliyor";
  return "yayinda";
}

export const JOB_STATUS_LABEL: Record<AdminJobStatus, string> = {
  yayinda: "Yayında",
  teklif_bekliyor: "Teklif Bekliyor",
  devam_ediyor: "Devam Ediyor",
  tamamlandi: "Tamamlandı",
  suresi_doldu: "Süresi Doldu",
  kapatildi: "Kapatıldı",
};

export const JOB_STATUS_TONE: Record<AdminJobStatus, "success" | "warning" | "neutral" | "danger"> = {
  yayinda: "success",
  teklif_bekliyor: "warning",
  devam_ediyor: "warning",
  tamamlandi: "success",
  suresi_doldu: "neutral",
  kapatildi: "danger",
};

export async function listJobsForAdmin(): Promise<AdminJobListItem[]> {
  const supabase = createSupabaseBrowserClient();

  const { data: jobRows, error: jobsError } = await supabase
    .from("admin_job_list")
    .select("id, operation_id, requester_id, category_id, title, province, district, created_at, publish_end_at, closed_at, deleted_at, offer_count, moderation_status")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  // "Kritik İlan Senkronizasyonu" görevi — bir sorgu hatası SESSİZCE boş
  // dizi olarak yutulursa admin ekranı "0 Onay Bekleyen" gösterir, bu da
  // "gerçekten hiç bekleyen ilan yok" ile ayırt edilemez bir SAHTE durumdur
  // (görev bölüm 3: "Bir Supabase erişim hatası hiçbir zaman eski veriyi
  // güncelmiş gibi sessizce sunmamalı" — burada "eski veri" değil ama aynı
  // ilke: hata asla "0 sonuç" gibi görünmemeli). `admin-dashboard-data.ts`nin
  // zaten kurduğu "hata durumunda sahte 0 değil gerçek hata" ilkesiyle
  // tutarlı olarak burada da hatayı yutmak yerine fırlatıyoruz; çağıran
  // (`admin-jobs-list.tsx`) bunu yakalayıp gerçek bir hata durumu gösterir.
  if (jobsError) {
    reportSystemError({ message: jobsError.message, source: "server", errorCode: jobsError.code, affectedAction: "list_jobs_for_admin", affectedScreen: "İlan Yönetimi (Admin)" });
    throw new Error(jobsError.message);
  }
  if (!jobRows) return [];

  const rows = jobRows as JobRow[];
  if (rows.length === 0) return [];

  const jobIds = rows.map((row) => row.id);
  const requesterIds = Array.from(new Set(rows.map((row) => row.requester_id)));
  const categoryIds = Array.from(new Set(rows.map((row) => row.category_id)));

  const [offersResult, requestersResult, categoriesResult] = await Promise.all([
    supabase.from("offers").select("job_id, status").in("job_id", jobIds),
    supabase.from("profiles").select("id, company_name, full_name").in("id", requesterIds),
    supabase.from("service_categories").select("id, name").in("id", categoryIds),
  ]);

  const offerStatusesByJob = new Map<string, string[]>();
  for (const row of (offersResult.data ?? []) as { job_id: string; status: string }[]) {
    const existing = offerStatusesByJob.get(row.job_id) ?? [];
    existing.push(row.status);
    offerStatusesByJob.set(row.job_id, existing);
  }

  const requesterById = new Map<string, { company_name: string | null; full_name: string | null }>();
  for (const row of (requestersResult.data ?? []) as { id: string; company_name: string | null; full_name: string | null }[]) {
    requesterById.set(row.id, row);
  }

  const categoryLabelById = new Map<string, string>();
  for (const row of (categoriesResult.data ?? []) as { id: string; name: string }[]) {
    categoryLabelById.set(row.id, row.name);
  }

  return rows.map((row) => {
    const requester = requesterById.get(row.requester_id);
    return {
      id: row.id,
      title: row.title,
      categoryId: row.category_id,
      categoryLabel: categoryLabelById.get(row.category_id) ?? row.category_id,
      companyName: requester?.company_name ?? null,
      requesterFullName: requester?.full_name ?? null,
      province: row.province,
      district: row.district,
      createdAt: row.created_at,
      status: deriveStatus(row, offerStatusesByJob.get(row.id) ?? []),
      offerCount: row.offer_count,
      moderationStatus: row.moderation_status,
    };
  });
}

export type AdminJobOfferRow = {
  id: string;
  providerCompanyName: string | null;
  providerFullName: string | null;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
};

export type AdminJobSibling = { id: string; title: string; categoryLabel: string };

export type AdminJobDetail = {
  id: string;
  title: string;
  description: string;
  operationDetails: string;
  categoryId: string;
  categoryLabel: string;
  companyName: string | null;
  requesterFullName: string | null;
  requesterPhone: string | null;
  province: string;
  district: string;
  workLocationType: string;
  addressText: string;
  workDate: string;
  workEndDate: string | null;
  productQuantity: number | null;
  productTonnage: number | null;
  /** Nakliye'nin "Toplam Ağırlık" birimi (bkz. types.ts#Job.productTonnageUnit) — yalnızca Nakliye'de dolu, Liman Hizmetleri'nde her zaman null (migration 0054). */
  productTonnageUnit: string | null;
  productType: string | null;
  customsProductType: string | null;
  /** Gümrük Müşavirliği "Operasyon Bilgileri" — İşlem Türü/Talep Edilen Hizmetler. `customsProductType`'ın aksine daha önce AdminJobDetail'e hiç dahil edilmemişti ("Kritik İlan Senkronizasyonu" görevi bölüm 4 denetiminde bulunan boşluk). */
  customsTransactionType: string | null;
  customsRequestedServices: string[] | null;
  deliveryProvince: string | null;
  deliveryDistrict: string | null;
  deliveryLocationType: string | null;
  deliveryFacilityId: string | null;
  deliveryFacilityName: string | null;
  deliveryAddressText: string | null;
  /** Geri Dönüşüm & Atık Tahliye Bilgileri (Supabase Geçişi ile birlikte eklendi, bkz. migration 0046). */
  recyclingMaterialCategoryId: string | null;
  recyclingMaterialSubtypeId: string | null;
  recyclingQuantity: number | null;
  recyclingUnit: string | null;
  recyclingMaterialCondition: string | null;
  recyclingMaterialConditionNote: string | null;
  recyclingScopeOfWork: string[] | null;
  /** "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi ile eklendi (bkz. types.ts#Job'un aynı adlı alanları). */
  recyclingRequestedOperation: string | null;
  recyclingWasteCode: string | null;
  recyclingWasteCodeUnknown: boolean | null;
  recyclingHazardous: boolean | null;
  recyclingHazardProperties: string[] | null;
  /** Depolama Bilgileri (Supabase Geçişi ile birlikte eklendi, bkz. migration 0053). */
  storageProductType: string | null;
  storageProductQuantity: number | null;
  storageProductUnit: string | null;
  storageProductTonnage: number | null;
  /**
   * "Konteyner Grupları" — yalnızca kategori "Konteyner Depolama" iken
   * anlamlıdır (bkz. migration 0057, storage-container-catalog.ts#
   * isContainerStorageCategory). Tek bir `jsonb` sütunu (storage_container_groups)
   * — bir ilan birden fazla konteyner grubu (farklı ölçü/tip/yük durumu)
   * taşıyabilir, bu yüzden yukarıdaki storageProductType/Quantity/Tonnage
   * BU KATEGORİDE HİÇ KULLANILMAZ (her zaman null). `null`, bozuk/tanınmayan
   * bir JSON değeri ya da hiç konteyner grubu olmayan bir ilan İÇİN geçerli
   * bir değerdir — storage-container-catalog.ts#sanitizeStorageContainerGroups
   * ile aynı doğrulama, admin salt-okunur listeleme için de uygulanır.
   */
  storageContainerGroups: StorageContainerGroup[] | null;
  /** "Kimyasal Depolama / Tehlikeli Madde Depolama" risk-grubu görevi (bkz. storage-hazard-catalog.ts) — Tehlikeli Madde Depolama'da storageHazardous her zaman `true`'dur (sunucu tarafı savunma), Kimyasal Depolama'da kullanıcının "Evet/Hayır" seçimini yansıtır. */
  storageHazardous: boolean | null;
  storageRiskGroups: string[] | null;
  /** Bkz. types.ts#NakliyeDetails.loadPreparationType/loadingOperations.loadingMethod — yalnızca Nakliye'de dolu (migration 0062). "__diger__" (NAKLIYE_MANUAL_ENTRY_VALUE) sentinel'i seçiliyse gerçek serbest metin CustomText alanındadır. */
  nakliyeLoadPreparationType: string | null;
  nakliyeLoadPreparationCustomText: string | null;
  nakliyeLoadingMethod: string | null;
  nakliyeLoadingMethodCustomText: string | null;
  /** "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi (migration 0063) — bkz. types.ts#NakliyeMeasurementInfo. */
  nakliyeMeasurementInfo: NakliyeMeasurementInfo | null;
  /** "Konteyner Taşıması ve ADR Bağımsız Bölümleri" görevi (migration 0064) — bkz. types.ts#NakliyeHazmatDetail/NakliyeContainerTransport. */
  nakliyeHazmat: NakliyeHazmatDetail | null;
  nakliyeContainerTransport: NakliyeContainerTransport | null;
  /** "Nakliye Çoklu Yük Grubu" görevi (migration 0066) — bkz. types.ts#Job.nakliyeCargoGroups. Doluysa admin-job-detail.tsx/admin-job-edit-form.tsx bu diziyi TEK doğruluk kaynağı sayar; boşsa (eski/tek gruplu bir ilan) nakliye-cargo-groups.ts#getJobCargoGroups üstteki tekil alanlardan "Yük Grubu 1" sentezler. */
  nakliyeCargoGroups: NakliyeCargoGroup[] | null;
  /** Katalog-ilişkili konum alanları — 0037'de admin edit formuna EKLENMEDİ (bkz. o migration'ın kendi gerekçesi: tam bir Bölge/Tesis seçici admin panelinde inşa etmek bu görevin kapsamı dışında), ama en azından GÖRÜNTÜLENEBİLİR olsun diye okunur. */
  facilityId: string | null;
  locationMode: string | null;
  /** Yalnızca özel/"Listede yok" konum modunda (ya da bu alanlardan önce oluşturulmuş eski Gümrük Müşavirliği ilanlarında) anlamlı — bkz. types.ts#Job.neighborhood. */
  neighborhood: string | null;
  locationUrl: string | null;
  directionsNote: string | null;
  createdAt: string;
  publishEndAt: string;
  closedAt: string | null;
  closureReason: string | null;
  status: AdminJobStatus;
  operationId: string | null;
  siblings: AdminJobSibling[];
  offers: AdminJobOfferRow[];
  photos: AdminJobPhoto[];
  /** İlan Onayı (0035). */
  moderationStatus: JobModerationStatus;
  moderationReviewedAt: string | null;
  moderationReviewedBy: string | null;
  moderationRejectionReason: string | null;
  /** Görev bölüm 14 (race condition) — approve/reject/updateJobAsAdmin'e p_expected_updated_at olarak geri gönderilir. */
  updatedAt: string;
};

/**
 * "Nakliye Çoklu Yük Grubu" görevi — `AdminJobDetail.nakliyeCargoGroups`
 * doluysa AYNEN, boşsa (eski/tek gruplu bir ilan) üstteki tekil alanlardan
 * ("Yük Grubu 1") SALT OKUNUR sentezlenir. `nakliye-cargo-groups.ts#
 * getJobCargoGroups` İLE AYNI ilke, ama `AdminJobDetail`in (Supabase
 * kaynaklı, job-store.ts#Job'un nested `nakliyeDetails` şeklinden FARKLI,
 * düz/ayrık alan şekli) kendi kaynağını okuyan AYRI bir sentez — admin-job-
 * edit-form.tsx (düzenleme formu) VE admin-job-detail.tsx (salt okunur
 * detay) İKİSİ de bu TEK fonksiyonu paylaşır, ikinci bir kopya İCAT
 * EDİLMEZ.
 */
export function getAdminJobCargoGroups(job: AdminJobDetail): NakliyeCargoGroup[] {
  if (job.nakliyeCargoGroups && job.nakliyeCargoGroups.length > 0) return job.nakliyeCargoGroups;
  const legacyContainer = job.nakliyeContainerTransport ?? { status: "hayir" as const };
  const legacyHazmat = job.nakliyeHazmat;
  return [
    {
      id: "legacy-group-1",
      productQuantity: job.productQuantity ?? undefined,
      productTonnage: job.productTonnage ?? undefined,
      // "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — eski
      // toggle-tabanlı bir konteyner kaydının productType'ı hiç yoktur; yeni
      // tetikleyici mekanizmasının onu doğru tanıması için "Konteyner"
      // SENTEZLENİR (nakliye-cargo-groups.ts#getJobCargoGroups İLE AYNI ilke).
      productType: job.productType ?? (legacyContainer.status === "evet" ? "Konteyner" : undefined),
      productTonnageUnit: job.productTonnageUnit === "kg" ? "kg" : job.productTonnageUnit === "ton" ? "ton" : undefined,
      loadPreparationType: job.nakliyeLoadPreparationType ?? undefined,
      loadPreparationCustomText: job.nakliyeLoadPreparationCustomText ?? undefined,
      measurementInfo: job.nakliyeMeasurementInfo ?? undefined,
      containerTransport: legacyContainer,
      // Eski job-seviyeli tri-state/dört alanlı hazmat kaydı burada grup-
      // seviyeli sade şekle GÜVENLİ GÖRÜNÜM olarak indirgenir — nakliye-
      // cargo-groups.ts#getJobCargoGroups İLE AYNI ilke.
      hazmat: legacyHazmat ? { status: legacyHazmat.status === "evet" ? ("evet" as const) : ("hayir" as const), adrClass: legacyHazmat.adrClass } : undefined,
    },
  ];
}

export type AdminJobPhoto = { id: string; url: string; originalFileName: string };

/**
 * `get_visible_job` RPC'sinin (bkz. supabase/migrations/0052) döndürdüğü
 * `public.jobs` satırından, `getJobDetailForAdmin`'in gerçekten okuduğu
 * alanların tip beyanı — Supabase istemcisi bu proje için `Database`
 * generic'i olmadan çağrıldığından (bkz. supabase/browser-client.ts) RPC
 * dönüş tipi TypeScript tarafında çıkarsanamaz; bu, `supabase-job-reads.ts#
 * SupabaseJobRow`'un AYNI "elle yazılmış satır tipi + tek noktada cast"
 * deseni.
 */
type AdminJobRow = {
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
  product_quantity: number | null;
  product_tonnage: number | null;
  product_tonnage_unit: string | null;
  product_type: string | null;
  customs_product_type: string | null;
  customs_transaction_type: string | null;
  customs_requested_services: string[] | null;
  delivery_province: string | null;
  delivery_district: string | null;
  delivery_location_type: string | null;
  delivery_facility_id: string | null;
  delivery_facility_name: string | null;
  delivery_address_text: string | null;
  recycling_material_category_id: string | null;
  recycling_material_subtype_id: string | null;
  recycling_quantity: number | null;
  recycling_unit: string | null;
  recycling_material_condition: string | null;
  recycling_material_condition_note: string | null;
  recycling_scope_of_work: string[] | null;
  recycling_requested_operation: string | null;
  recycling_waste_code: string | null;
  recycling_waste_code_unknown: boolean | null;
  recycling_hazardous: boolean | null;
  recycling_hazard_properties: string[] | null;
  storage_product_type: string | null;
  storage_product_quantity: number | null;
  storage_product_unit: string | null;
  storage_product_tonnage: number | null;
  /** Ham JSONB — Postgres jsonb sütunları PostgREST'ten zaten ayrıştırılmış (unknown) gelir, ikinci bir JSON.parse GEREKMEZ. */
  storage_container_groups: unknown;
  /** "Kimyasal Depolama / Tehlikeli Madde Depolama" risk-grubu görevi — bkz. storage-hazard-catalog.ts. */
  storage_hazardous: boolean | null;
  storage_risk_groups: string[] | null;
  nakliye_load_preparation_type: string | null;
  nakliye_load_preparation_custom_text: string | null;
  nakliye_loading_method: string | null;
  nakliye_loading_method_custom_text: string | null;
  nakliye_measurement_info: unknown;
  nakliye_hazmat: unknown;
  nakliye_container_transport: unknown;
  nakliye_cargo_groups: unknown;
  created_at: string;
  publish_end_at: string;
  closed_at: string | null;
  closure_reason: string | null;
  deleted_at: string | null;
  moderation_status: string | null;
  moderation_reviewed_at: string | null;
  moderation_reviewed_by: string | null;
  moderation_rejection_reason: string | null;
  updated_at: string;
};

export async function getJobDetailForAdmin(jobId: string): Promise<AdminJobDetail | null> {
  const supabase = createSupabaseBrowserClient();

  // MALSEVK genel ilan gizlilik kuralı (bkz. supabase/migrations/0052) —
  // hassas konum alanlarının ham SELECT ayrıcalığı anon/authenticated'ten
  // kaldırıldığı için bu (admin-only) okuma da artık ham `jobs` tablosunu
  // DEĞİL, `get_visible_job` RPC'sini kullanır — admin dalı o fonksiyonun
  // kendi `is_admin()` bypass'ıyla HİÇBİR alan maskelenmeden tam satırı
  // döner (bu sayfa zaten yalnızca admin'e render edilir).
  const { data: jobRowRaw, error: jobError } = await supabase.rpc("get_visible_job", { p_job_id: jobId }).maybeSingle();
  const jobRow = jobRowRaw as unknown as AdminJobRow | null;
  if (jobError || !jobRow || jobRow.deleted_at !== null) return null;

  const [requesterResult, categoryResult, offersResult, siblingsResult, photosResult] = await Promise.all([
    supabase.from("profiles").select("company_name, full_name, phone").eq("id", jobRow.requester_id).maybeSingle(),
    supabase.from("service_categories").select("name").eq("id", jobRow.category_id).maybeSingle(),
    supabase.from("offers").select("id, provider_id, amount, currency, status, created_at").eq("job_id", jobId).order("created_at", { ascending: false }),
    jobRow.operation_id
      ? supabase.from("jobs").select("id, title, category_id").eq("operation_id", jobRow.operation_id).neq("id", jobId).is("deleted_at", null)
      : Promise.resolve({ data: [] as { id: string; title: string; category_id: string }[] }),
    supabase
      .from("job_photos")
      .select("id, storage_path, original_file_name")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
  ]);

  const offerRows = (offersResult.data ?? []) as { id: string; provider_id: string; amount: number; currency: string; status: string; created_at: string }[];
  const providerIds = Array.from(new Set(offerRows.map((row) => row.provider_id)));
  const { data: providerRows } = providerIds.length > 0
    ? await supabase.from("profiles").select("id, company_name, full_name").in("id", providerIds)
    : { data: [] as { id: string; company_name: string | null; full_name: string | null }[] };
  const providerById = new Map<string, { company_name: string | null; full_name: string | null }>();
  for (const row of (providerRows ?? []) as { id: string; company_name: string | null; full_name: string | null }[]) {
    providerById.set(row.id, row);
  }

  const siblingRows = (siblingsResult.data ?? []) as { id: string; title: string; category_id: string }[];
  const siblingCategoryIds = Array.from(new Set(siblingRows.map((row) => row.category_id)));
  const { data: siblingCategoryRows } =
    siblingCategoryIds.length > 0
      ? await supabase.from("service_categories").select("id, name").in("id", siblingCategoryIds)
      : { data: [] as { id: string; name: string }[] };
  const siblingCategoryLabelById = new Map<string, string>();
  for (const row of (siblingCategoryRows ?? []) as { id: string; name: string }[]) {
    siblingCategoryLabelById.set(row.id, row.name);
  }

  const requester = requesterResult.data as { company_name: string | null; full_name: string | null; phone: string | null } | null;

  const photoRows = (photosResult.data ?? []) as { id: string; storage_path: string; original_file_name: string }[];
  const photos: AdminJobPhoto[] = photoRows.map((row) => ({
    id: row.id,
    url: getJobPhotoPublicUrl(row.storage_path),
    originalFileName: row.original_file_name,
  }));

  return {
    id: jobRow.id,
    title: jobRow.title,
    description: jobRow.description,
    operationDetails: jobRow.operation_details ?? "",
    categoryId: jobRow.category_id,
    categoryLabel: (categoryResult.data as { name: string } | null)?.name ?? jobRow.category_id,
    companyName: requester?.company_name ?? null,
    requesterFullName: requester?.full_name ?? null,
    requesterPhone: requester?.phone ?? null,
    province: jobRow.province,
    district: jobRow.district,
    // Bkz. supabase-job-reads.ts#mapJobRow'daki AYNI `?? ""` düzeltmesi —
    // admin dalı get_visible_job'ın is_admin() bypass'ından geçtiği için bu
    // alan admin için pratikte hiç NULL olmaz, ama AdminJobDetail.workLocationType
    // de opsiyonel olmayan bir `string` olduğundan aynı savunma burada da
    // ucuz bir güvence (görev tanımı: "test edilmeden çözüldü deme" — bu
    // satırın kendisi test edilmedi, yalnızca kardeş bug'la AYNI kalıba göre
    // savunmacı olarak eklendi).
    workLocationType: jobRow.work_location_type ?? "",
    facilityId: jobRow.facility_id,
    locationMode: jobRow.location_mode,
    addressText: jobRow.address_text ?? "",
    neighborhood: jobRow.neighborhood,
    locationUrl: jobRow.location_url,
    directionsNote: jobRow.directions_note,
    workDate: jobRow.work_date,
    workEndDate: jobRow.work_end_date,
    productQuantity: jobRow.product_quantity,
    productTonnage: jobRow.product_tonnage,
    productTonnageUnit: jobRow.product_tonnage_unit,
    productType: jobRow.product_type,
    customsProductType: jobRow.customs_product_type,
    customsTransactionType: jobRow.customs_transaction_type,
    customsRequestedServices: jobRow.customs_requested_services,
    deliveryProvince: jobRow.delivery_province,
    deliveryDistrict: jobRow.delivery_district,
    deliveryLocationType: jobRow.delivery_location_type,
    deliveryFacilityId: jobRow.delivery_facility_id,
    deliveryFacilityName: jobRow.delivery_facility_name,
    deliveryAddressText: jobRow.delivery_address_text,
    recyclingMaterialCategoryId: jobRow.recycling_material_category_id,
    recyclingMaterialSubtypeId: jobRow.recycling_material_subtype_id,
    recyclingQuantity: jobRow.recycling_quantity,
    recyclingUnit: jobRow.recycling_unit,
    recyclingMaterialCondition: jobRow.recycling_material_condition,
    recyclingMaterialConditionNote: jobRow.recycling_material_condition_note,
    recyclingScopeOfWork: jobRow.recycling_scope_of_work,
    recyclingRequestedOperation: jobRow.recycling_requested_operation,
    recyclingWasteCode: jobRow.recycling_waste_code,
    recyclingWasteCodeUnknown: jobRow.recycling_waste_code_unknown,
    recyclingHazardous: jobRow.recycling_hazardous,
    recyclingHazardProperties: jobRow.recycling_hazard_properties,
    storageProductType: jobRow.storage_product_type,
    storageProductQuantity: jobRow.storage_product_quantity,
    storageProductUnit: jobRow.storage_product_unit,
    storageProductTonnage: jobRow.storage_product_tonnage,
    storageContainerGroups: sanitizeStorageContainerGroups(jobRow.storage_container_groups) ?? null,
    storageHazardous: jobRow.storage_hazardous,
    storageRiskGroups: sanitizeStorageRiskGroups(jobRow.storage_risk_groups) ?? null,
    nakliyeLoadPreparationType: jobRow.nakliye_load_preparation_type,
    nakliyeLoadPreparationCustomText: jobRow.nakliye_load_preparation_custom_text,
    nakliyeLoadingMethod: jobRow.nakliye_loading_method,
    nakliyeLoadingMethodCustomText: jobRow.nakliye_loading_method_custom_text,
    nakliyeMeasurementInfo: sanitizeMeasurementInfo(jobRow.nakliye_measurement_info) ?? null,
    nakliyeHazmat: sanitizeHazmatDetail(jobRow.nakliye_hazmat) ?? null,
    nakliyeContainerTransport: sanitizeContainerTransport(jobRow.nakliye_container_transport) ?? null,
    nakliyeCargoGroups: sanitizeNakliyeCargoGroups(jobRow.nakliye_cargo_groups) ?? null,
    createdAt: jobRow.created_at,
    publishEndAt: jobRow.publish_end_at,
    closedAt: jobRow.closed_at,
    closureReason: jobRow.closure_reason,
    status: deriveStatus(jobRow, offerRows.map((row) => row.status)),
    operationId: jobRow.operation_id,
    siblings: siblingRows.map((row) => ({ id: row.id, title: row.title, categoryLabel: siblingCategoryLabelById.get(row.category_id) ?? row.category_id })),
    offers: offerRows.map((row) => ({
      id: row.id,
      providerCompanyName: providerById.get(row.provider_id)?.company_name ?? null,
      providerFullName: providerById.get(row.provider_id)?.full_name ?? null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
    })),
    photos,
    moderationStatus: (jobRow.moderation_status ?? "approved") as JobModerationStatus,
    moderationReviewedAt: jobRow.moderation_reviewed_at,
    moderationReviewedBy: jobRow.moderation_reviewed_by,
    moderationRejectionReason: jobRow.moderation_rejection_reason,
    updatedAt: jobRow.updated_at,
  };
}

export type JobActionResult = { ok: true } | { ok: false; error: string };

function mapCloseJobError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK84":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK76":
      return "İlan bulunamadı.";
    case "MLK55":
      return "Bu ilan zaten kapalı ya da devam eden/tamamlanmış bir teklifi olduğu için kapatılamıyor.";
    case "23514":
      return "Geçersiz kapatma nedeni.";
    default:
      return error.message || "İlan yayından kaldırılamadı. Lütfen tekrar deneyin.";
  }
}

/**
 * close_job_as_admin (0016) — admin-only, bekleyen teklifleri reddeder ve
 * sağlayıcılara bildirim gönderir. `reason` SERBEST METİN DEĞİL —
 * `jobs.closure_reason` (0004) sabit 4 değerli bir CHECK kısıtına sahip
 * (job-closure.ts#JobClosureReason ile BİREBİR aynı enum); bu ilk sürümde
 * serbest metin gönderilip 23514 (check_violation) ile sessizce reddedildiği
 * canlı Playwright testiyle bulundu ve düzeltildi — bkz. proje raporu.
 */
export async function unpublishJobAsAdmin(jobId: string, reason: JobClosureReason): Promise<JobActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("close_job_as_admin", {
    p_job_id: jobId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: mapCloseJobError(error) };
  return { ok: true };
}

/**
 * İlan Onayı (0035) — approve_job_as_admin/reject_job_as_admin/
 * update_job_as_admin RPC'lerini sarmalar. `close_job_as_admin` ile AYNI
 * çağrı desenini kullanır. `p_expected_updated_at` (görev bölüm 14, race
 * condition): admin-job-detail.tsx ilan detayını çektiği andaki `updatedAt`
 * değerini geri gönderir — o andan beri ilan değiştiyse RPC ML118 ile
 * reddeder, aşağıdaki `mapModerationError` bunu "yeniden inceleme gerekli"
 * mesajına çevirir.
 *
 * Her başarılı RPC çağrısından SONRA, best-effort olarak `job-store.ts#
 * applyAdminModerationDecision`/`applyAdminJobEdit` de çağrılır — bu, GERÇEK
 * yetkilendirme sınırı OLAN yukarıdaki RPC'nin BİR YANSIMASIDIR, kendisi
 * hiçbir yetkilendirme yapmaz. Yalnızca bu ilan bu TARAYICININ paylaşılan
 * localStorage ilan havuzunda da mevcutsa (Hizmet Alan/Hizmet Veren/Admin
 * aynı origin'i paylaştığı demo/geliştirme/test ortamında) canlı Hizmet
 * Veren/Hizmet Alan ekranlarına da yansır — bkz. proje raporu "No real
 * backend" notu. Eşleşen ilan bu tarayıcıda yoksa sessizce best-effort
 * sayılır, RPC'nin kendi başarısı asla bundan etkilenmez.
 */
function mapModerationError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "ML115":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "ML116":
      return "İlan bulunamadı.";
    case "ML117":
      return "Reddetme nedeni zorunludur.";
    case "ML118":
      return "Bu ilan siz incelerken değişti. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "MLK52":
      return "Bitiş tarihi başlangıç tarihinden önce olamaz.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

export async function approveJobAsAdmin(jobId: string, expectedUpdatedAt: string): Promise<JobActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("approve_job_as_admin", { p_job_id: jobId, p_expected_updated_at: expectedUpdatedAt });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "approve_job_as_admin", affectedScreen: "İlan Yönetimi (Admin)" });
    return { ok: false, error: mapModerationError(error) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) applyAdminModerationDecision(jobId, { status: "approved", reviewedBy: user.id });

  return { ok: true };
}

export async function rejectJobAsAdmin(jobId: string, reason: string, expectedUpdatedAt: string): Promise<JobActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("reject_job_as_admin", { p_job_id: jobId, p_reason: reason, p_expected_updated_at: expectedUpdatedAt });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "reject_job_as_admin", affectedScreen: "İlan Yönetimi (Admin)" });
    return { ok: false, error: mapModerationError(error) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) applyAdminModerationDecision(jobId, { status: "rejected", reviewedBy: user.id, reason: reason.trim() });

  return { ok: true };
}

export async function updateJobAsAdmin(jobId: string, input: AdminJobEditInput, expectedUpdatedAt: string): Promise<JobActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_job_as_admin", {
    p_job_id: jobId,
    p_title: input.title,
    p_description: input.description,
    p_province: input.province,
    p_district: input.district,
    p_work_location_type: input.workLocationType,
    p_address_text: input.addressText,
    p_work_date: input.workDate,
    p_work_end_date: input.workEndDate ?? null,
    p_product_quantity: input.productQuantity ?? null,
    p_product_tonnage: input.productTonnage ?? null,
    p_product_type: input.productType ?? null,
    p_customs_product_type: input.customsProductType ?? null,
    p_customs_transaction_type: input.customsTransactionType ?? null,
    p_customs_requested_services: input.customsRequestedServices ?? null,
    p_delivery_facility_name: input.deliveryFacilityName ?? null,
    p_delivery_address_text: input.deliveryAddressText ?? null,
    p_operation_details: input.operationDetails ?? null,
    p_neighborhood: input.neighborhood ?? null,
    p_location_url: input.locationUrl ?? null,
    p_directions_note: input.directionsNote ?? null,
    p_delivery_province: input.deliveryProvince ?? null,
    p_delivery_district: input.deliveryDistrict ?? null,
    p_recycling_material_category_id: input.recyclingMaterialCategoryId ?? null,
    p_recycling_material_subtype_id: input.recyclingMaterialSubtypeId ?? null,
    p_recycling_quantity: input.recyclingQuantity ?? null,
    p_recycling_unit: input.recyclingUnit ?? null,
    p_recycling_material_condition: input.recyclingMaterialCondition ?? null,
    p_recycling_material_condition_note: input.recyclingMaterialConditionNote ?? null,
    p_recycling_scope_of_work: input.recyclingScopeOfWork ?? null,
    p_recycling_requested_operation: input.recyclingRequestedOperation ?? null,
    p_recycling_waste_code: input.recyclingWasteCodeUnknown ? null : input.recyclingWasteCode ?? null,
    p_recycling_waste_code_unknown: input.recyclingWasteCodeUnknown ?? null,
    p_recycling_hazard_properties: input.recyclingHazardProperties ?? null,
    p_storage_product_type: input.storageProductType ?? null,
    p_storage_product_quantity: input.storageProductQuantity ?? null,
    p_storage_product_unit: input.storageProductUnit ?? null,
    p_storage_product_tonnage: input.storageProductTonnage ?? null,
    p_storage_container_groups: input.storageContainerGroups ?? null,
    p_storage_hazardous: input.storageHazardous ?? null,
    p_storage_risk_groups: input.storageRiskGroups ?? null,
    p_product_tonnage_unit: input.productTonnageUnit ?? null,
    p_nakliye_load_preparation_type: input.nakliyeLoadPreparationType ?? null,
    p_nakliye_load_preparation_custom_text: input.nakliyeLoadPreparationCustomText ?? null,
    p_nakliye_loading_method: input.nakliyeLoadingMethod ?? null,
    p_nakliye_loading_method_custom_text: input.nakliyeLoadingMethodCustomText ?? null,
    p_nakliye_measurement_info: input.nakliyeMeasurementInfo ?? null,
    p_nakliye_hazmat: input.nakliyeHazmat ?? null,
    p_nakliye_container_transport: input.nakliyeContainerTransport ?? null,
    p_nakliye_cargo_groups: input.nakliyeCargoGroups ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "update_job_as_admin", affectedScreen: "İlan Yönetimi (Admin)" });
    return { ok: false, error: mapModerationError(error) };
  }

  applyAdminJobEdit(jobId, input);

  return { ok: true };
}
