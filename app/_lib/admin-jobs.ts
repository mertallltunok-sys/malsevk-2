import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { getJobPhotoPublicUrl } from "./supabase-job-photos";
import type { JobClosureReason } from "./types";

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
 * render tarafı (`admin-job-detail.tsx`) yalnızca `deliveryProvince` doluysa
 * "Teslim Edilecek Yer" bölümünü gösterir (localStorage tarafının
 * nakliye-route-card.tsx'iyle AYNI "varsa göster" ilkesi).
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
    .select("id, operation_id, requester_id, category_id, title, province, district, created_at, publish_end_at, closed_at, deleted_at, offer_count")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (jobsError || !jobRows) return [];

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
  productType: string | null;
  customsProductType: string | null;
  deliveryProvince: string | null;
  deliveryDistrict: string | null;
  deliveryLocationType: string | null;
  deliveryFacilityId: string | null;
  deliveryFacilityName: string | null;
  deliveryAddressText: string | null;
  createdAt: string;
  publishEndAt: string;
  closedAt: string | null;
  closureReason: string | null;
  status: AdminJobStatus;
  operationId: string | null;
  siblings: AdminJobSibling[];
  offers: AdminJobOfferRow[];
  photos: AdminJobPhoto[];
};

export type AdminJobPhoto = { id: string; url: string; originalFileName: string };

export async function getJobDetailForAdmin(jobId: string): Promise<AdminJobDetail | null> {
  const supabase = createSupabaseBrowserClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select(
      "id, operation_id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, address_text, work_date, work_end_date, product_quantity, product_tonnage, product_type, customs_product_type, delivery_province, delivery_district, delivery_location_type, delivery_facility_id, delivery_facility_name, delivery_address_text, created_at, publish_end_at, closed_at, closure_reason, deleted_at",
    )
    .eq("id", jobId)
    .maybeSingle();
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
    operationDetails: jobRow.operation_details,
    categoryId: jobRow.category_id,
    categoryLabel: (categoryResult.data as { name: string } | null)?.name ?? jobRow.category_id,
    companyName: requester?.company_name ?? null,
    requesterFullName: requester?.full_name ?? null,
    requesterPhone: requester?.phone ?? null,
    province: jobRow.province,
    district: jobRow.district,
    workLocationType: jobRow.work_location_type,
    addressText: jobRow.address_text,
    workDate: jobRow.work_date,
    workEndDate: jobRow.work_end_date,
    productQuantity: jobRow.product_quantity,
    productTonnage: jobRow.product_tonnage,
    productType: jobRow.product_type,
    customsProductType: jobRow.customs_product_type,
    deliveryProvince: jobRow.delivery_province,
    deliveryDistrict: jobRow.delivery_district,
    deliveryLocationType: jobRow.delivery_location_type,
    deliveryFacilityId: jobRow.delivery_facility_id,
    deliveryFacilityName: jobRow.delivery_facility_name,
    deliveryAddressText: jobRow.delivery_address_text,
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
  };
}

export type JobActionResult = { ok: true } | { ok: false; error: string };

function mapCloseJobError(error: { code?: string; message: string }): string {
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
