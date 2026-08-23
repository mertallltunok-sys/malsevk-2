import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Admin "Operasyon Yönetimi" modülü — MALSEVK Faz 2. Salt görüntüleme (görev
 * gereği: "admin manuel operasyon durumu değiştirmesin"), hiçbir RPC/yazma
 * yolu içermez. Tamamı mevcut tablo/view'lardan okunur: admin_offer_list
 * (0017, offers.*, is_admin() kendi içinde), jobs/profiles (admin RLS dalı
 * zaten var), offer_status_history (0005, admin RLS dalı zaten var — bkz.
 * offer_status_history_select_parties_or_admin, 0013).
 *
 * TASARIM KARARI (kullanıcıya sorulmadı, kod+şema incelemesinden çıkarıldı —
 * bkz. proje raporu): "Operasyon" burada Supabase'in kendi `operations`
 * tablosuyla (Çoklu Hizmet Operasyonu başlık satırı, 0004) BİREBİR
 * eşlenmiyor — o tablo yalnızca gerçek çoklu-hizmet oluşturmalarında bir
 * satır alır (create_job/tek-ilan yolu hiç operation_id yazmaz, doğrudan
 * kontrol edildi: 0014#create_job), bu yüzden 5 durum sekmesini (Bekleyen/
 * Devam Eden/Tamamlanan/İptal/Anlaşmazlık) temsil edecek kadar zengin değil.
 * Görevin kendi detay alan listesi de ("Hizmet veren, Hizmet alan, İlan,
 * Teklif" — hepsi TEKİL) bunun yerine tek bir Offer'ın iş sürecini işaret
 * ediyor. Bu yüzden her satır bir `offers` kaydıdır; "Operasyon No" o
 * teklifin kısaltılmış id'sidir (varsa jobs.operation_id de ayrıca gösterilir).
 */

export type AdminOperationBucket = "bekleyen" | "devam_eden" | "tamamlanan" | "iptal" | "anlasmazlik";

const ONGOING_STATUSES = new Set(["accepted", "in_progress", "completion_requested"]);
const CANCELLED_STATUSES = new Set(["cancelled", "rejected", "withdrawn", "agreement_failed"]);

function bucketForStatus(status: string): AdminOperationBucket {
  if (status === "pending") return "bekleyen";
  if (status === "completed") return "tamamlanan";
  if (status === "completion_disputed") return "anlasmazlik";
  if (CANCELLED_STATUSES.has(status)) return "iptal";
  if (ONGOING_STATUSES.has(status)) return "devam_eden";
  return "devam_eden";
}

export const OPERATION_BUCKET_LABEL: Record<AdminOperationBucket, string> = {
  bekleyen: "Bekleyen",
  devam_eden: "Devam Eden",
  tamamlanan: "Tamamlanan",
  iptal: "İptal",
  anlasmazlik: "Anlaşmazlık",
};

export const OPERATION_BUCKET_TONE: Record<AdminOperationBucket, "success" | "warning" | "neutral" | "danger"> = {
  bekleyen: "warning",
  devam_eden: "warning",
  tamamlanan: "success",
  iptal: "danger",
  anlasmazlik: "danger",
};

export type AdminOperationListItem = {
  offerId: string;
  jobId: string;
  operationId: string | null;
  jobTitle: string;
  categoryLabel: string;
  providerCompanyName: string | null;
  providerFullName: string | null;
  requesterCompanyName: string | null;
  requesterFullName: string | null;
  startedAt: string;
  updatedAt: string;
  status: string;
  bucket: AdminOperationBucket;
};

type OfferRow = { id: string; job_id: string; provider_id: string; status: string; created_at: string; updated_at: string };
type JobRow = { id: string; operation_id: string | null; requester_id: string; title: string; category_id: string };

export async function listOperationsForAdmin(): Promise<AdminOperationListItem[]> {
  const supabase = createSupabaseBrowserClient();

  const { data: offerRows, error: offersError } = await supabase
    .from("admin_offer_list")
    .select("id, job_id, provider_id, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (offersError || !offerRows) return [];

  const offers = offerRows as OfferRow[];
  if (offers.length === 0) return [];

  const jobIds = Array.from(new Set(offers.map((offer) => offer.job_id)));
  const providerIds = Array.from(new Set(offers.map((offer) => offer.provider_id)));

  const { data: jobRows } = await supabase.from("jobs").select("id, operation_id, requester_id, title, category_id").in("id", jobIds);
  const jobs = (jobRows ?? []) as JobRow[];
  const jobById = new Map<string, JobRow>();
  for (const job of jobs) jobById.set(job.id, job);

  const requesterIds = Array.from(new Set(jobs.map((job) => job.requester_id)));
  const categoryIds = Array.from(new Set(jobs.map((job) => job.category_id)));
  const profileIds = Array.from(new Set([...providerIds, ...requesterIds]));

  const [profilesResult, categoriesResult] = await Promise.all([
    supabase.from("profiles").select("id, company_name, full_name").in("id", profileIds),
    supabase.from("service_categories").select("id, name").in("id", categoryIds),
  ]);

  const profileById = new Map<string, { company_name: string | null; full_name: string | null }>();
  for (const row of (profilesResult.data ?? []) as { id: string; company_name: string | null; full_name: string | null }[]) {
    profileById.set(row.id, row);
  }
  const categoryLabelById = new Map<string, string>();
  for (const row of (categoriesResult.data ?? []) as { id: string; name: string }[]) {
    categoryLabelById.set(row.id, row.name);
  }

  return offers
    .map((offer) => {
      const job = jobById.get(offer.job_id);
      if (!job) return null;
      const provider = profileById.get(offer.provider_id);
      const requester = profileById.get(job.requester_id);
      return {
        offerId: offer.id,
        jobId: offer.job_id,
        operationId: job.operation_id,
        jobTitle: job.title,
        categoryLabel: categoryLabelById.get(job.category_id) ?? job.category_id,
        providerCompanyName: provider?.company_name ?? null,
        providerFullName: provider?.full_name ?? null,
        requesterCompanyName: requester?.company_name ?? null,
        requesterFullName: requester?.full_name ?? null,
        startedAt: offer.created_at,
        updatedAt: offer.updated_at,
        status: offer.status,
        bucket: bucketForStatus(offer.status),
      };
    })
    .filter((row): row is AdminOperationListItem => row !== null);
}

export type AdminOperationHistoryEntry = {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminOperationDetail = AdminOperationListItem & {
  amount: number;
  currency: string;
  description: string;
  providerPhone: string | null;
  requesterPhone: string | null;
  history: AdminOperationHistoryEntry[];
};

export async function getOperationDetailForAdmin(offerId: string): Promise<AdminOperationDetail | null> {
  const supabase = createSupabaseBrowserClient();

  const { data: offerRow, error: offerError } = await supabase
    .from("offers")
    .select("id, job_id, provider_id, status, amount, currency, description, created_at, updated_at")
    .eq("id", offerId)
    .maybeSingle();
  if (offerError || !offerRow) return null;

  const { data: jobRow } = await supabase.from("jobs").select("id, operation_id, requester_id, title, category_id").eq("id", offerRow.job_id).maybeSingle();
  if (!jobRow) return null;

  const [providerResult, requesterResult, categoryResult, historyResult] = await Promise.all([
    supabase.from("profiles").select("company_name, full_name, phone").eq("id", offerRow.provider_id).maybeSingle(),
    supabase.from("profiles").select("company_name, full_name, phone").eq("id", jobRow.requester_id).maybeSingle(),
    supabase.from("service_categories").select("name").eq("id", jobRow.category_id).maybeSingle(),
    supabase.from("offer_status_history").select("id, previous_status, new_status, changed_by, reason, created_at").eq("offer_id", offerId).order("created_at", { ascending: false }),
  ]);

  const provider = providerResult.data as { company_name: string | null; full_name: string | null; phone: string | null } | null;
  const requester = requesterResult.data as { company_name: string | null; full_name: string | null; phone: string | null } | null;

  const historyRows = (historyResult.data ?? []) as { id: string; previous_status: string | null; new_status: string; changed_by: string | null; reason: string | null; created_at: string }[];
  const changedByIds = Array.from(new Set(historyRows.map((row) => row.changed_by).filter((id): id is string => Boolean(id))));
  const changedByNameById = new Map<string, string | null>();
  if (changedByIds.length > 0) {
    const { data: actorRows } = await supabase.from("profiles").select("id, full_name").in("id", changedByIds);
    for (const row of (actorRows ?? []) as { id: string; full_name: string | null }[]) {
      changedByNameById.set(row.id, row.full_name);
    }
  }

  return {
    offerId: offerRow.id,
    jobId: offerRow.job_id,
    operationId: jobRow.operation_id,
    jobTitle: jobRow.title,
    categoryLabel: (categoryResult.data as { name: string } | null)?.name ?? jobRow.category_id,
    providerCompanyName: provider?.company_name ?? null,
    providerFullName: provider?.full_name ?? null,
    providerPhone: provider?.phone ?? null,
    requesterCompanyName: requester?.company_name ?? null,
    requesterFullName: requester?.full_name ?? null,
    requesterPhone: requester?.phone ?? null,
    startedAt: offerRow.created_at,
    updatedAt: offerRow.updated_at,
    status: offerRow.status,
    bucket: bucketForStatus(offerRow.status),
    amount: offerRow.amount,
    currency: offerRow.currency,
    description: offerRow.description,
    history: historyRows.map((row) => ({
      id: row.id,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      changedByName: row.changed_by ? (changedByNameById.get(row.changed_by) ?? null) : null,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}
