import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Admin Dashboard — tamamı GERÇEK Supabase verisinden, mevcut RLS üzerinden
 * (profiles/jobs/offers/operations/provider_documents için `is_admin()` dalı
 * zaten var, bkz. 0013_rls_policies.sql) okunur. Hiçbir sabit/demo sayı YOK —
 * bir sorgu başarısız olursa o kart `null` döner ve UI bunu "—" olarak
 * gösterir, asla 0 veya uydurma bir değer göstermez (0 gerçek bir sonuç
 * olabileceği için `null` ile ayırt edilir).
 *
 * "Bugün" sınırı çağıranın (adminin) TARAYICI saatine göre hesaplanır — sunucu
 * saatine değil; bir admin dashboard'u için makul, basit bir tanım.
 */

export type AdminDashboardCounts = {
  totalUsers: number | null;
  totalRequesters: number | null;
  totalProviderCompanies: number | null;
  activeJobs: number | null;
  ongoingOperations: number | null;
  pendingDocumentReviews: number | null;
  /**
   * SAĞLIK KONTROLÜ (migration 0041, "Belge Onayı / Hizmet Yetkilendirme
   * Senkron Sorunu"): `provider_document_authorization_gaps` view'ından —
   * onaylı bir belgenin karşılığında aktif bir hizmet yetkisi OLMADIĞI
   * satır sayısı. migration 0041'in düzeltmesinden SONRA teorik olarak her
   * zaman 0 olması beklenir; >0 ise `review_provider_document`'in
   * otomatik-yetkilendirme adımı gerçekten başarısız olmuş demektir —
   * `null` (sorgu hatası) ile gerçek `0`u ayırt etmek için diğer kartlarla
   * AYNI "null = —" ilkesi burada da geçerli.
   */
  documentApprovalAuthorizationGaps: number | null;
  openContactMessages: number | null;
  todayRegistrations: number | null;
  todayJobs: number | null;
  todayOffers: number | null;
};

function startOfTodayIso(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountQueryFilter = (query: any) => any;

async function countRows(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  table: string,
  apply?: CountQueryFilter,
): Promise<number | null> {
  const base = supabase.from(table).select("*", { count: "exact", head: true });
  const { count, error } = await (apply ? apply(base) : base);
  if (error) return null;
  return count ?? null;
}

export async function getAdminDashboardCounts(): Promise<AdminDashboardCounts> {
  const supabase = createSupabaseBrowserClient();
  const todayIso = startOfTodayIso();

  const [
    totalUsers,
    totalRequesters,
    totalProviderCompanies,
    activeJobs,
    ongoingOperations,
    pendingDocumentReviews,
    documentApprovalAuthorizationGaps,
    openContactMessages,
    todayRegistrations,
    todayJobs,
    todayOffers,
  ] = await Promise.all([
    countRows(supabase, "profiles"),
    countRows(supabase, "profiles", (q) => q.eq("role", "hizmet-alan")),
    countRows(supabase, "profiles", (q) => q.eq("role", "hizmet-veren")),
    countRows(supabase, "active_job_listings"),
    countRows(supabase, "operations", (q) => q.is("closed_at", null)),
    countRows(supabase, "provider_documents", (q) => q.eq("current_review_status", "pending").is("deleted_at", null)),
    countRows(supabase, "provider_document_authorization_gaps"),
    countRows(supabase, "contact_messages", (q) => q.eq("status", "yeni")),
    countRows(supabase, "profiles", (q) => q.gte("created_at", todayIso)),
    countRows(supabase, "jobs", (q) => q.gte("created_at", todayIso).is("deleted_at", null)),
    countRows(supabase, "offers", (q) => q.gte("created_at", todayIso)),
  ]);

  return {
    totalUsers,
    totalRequesters,
    totalProviderCompanies,
    activeJobs,
    ongoingOperations,
    pendingDocumentReviews,
    documentApprovalAuthorizationGaps,
    openContactMessages,
    todayRegistrations,
    todayJobs,
    todayOffers,
  };
}

export type RecentCompany = {
  id: string;
  companyName: string | null;
  fullName: string | null;
  createdAt: string;
};

export async function getRecentCompanies(limit = 5): Promise<RecentCompany[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, company_name, full_name, created_at")
    .eq("role", "hizmet-veren")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    companyName: row.company_name as string | null,
    fullName: row.full_name as string | null,
    createdAt: row.created_at as string,
  }));
}

export type RecentDocument = {
  id: string;
  providerId: string;
  companyName: string | null;
  fullName: string | null;
  documentType: string;
  originalFileName: string;
  uploadedAt: string;
  currentReviewStatus: string;
};

export async function getRecentDocuments(limit = 5): Promise<RecentDocument[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("provider_documents")
    .select("id, provider_id, document_type, original_file_name, uploaded_at, current_review_status")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  const providerIds = Array.from(new Set(data.map((row) => row.provider_id as string)));
  const profilesById = new Map<string, { company_name: string | null; full_name: string | null }>();
  if (providerIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, company_name, full_name")
      .in("id", providerIds);
    for (const profile of (profileRows ?? []) as { id: string; company_name: string | null; full_name: string | null }[]) {
      profilesById.set(profile.id, profile);
    }
  }

  return data.map((row) => {
    const profile = profilesById.get(row.provider_id as string);
    return {
      id: row.id as string,
      providerId: row.provider_id as string,
      companyName: profile?.company_name ?? null,
      fullName: profile?.full_name ?? null,
      documentType: row.document_type as string,
      originalFileName: row.original_file_name as string,
      uploadedAt: row.uploaded_at as string,
      currentReviewStatus: row.current_review_status as string,
    };
  });
}

export type RecentAdminAction = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  createdAt: string;
};

/**
 * admin_audit_log_search() (0017) — zaten is_admin() ile öz-kapılı. Kayıt
 * yoksa (henüz hiç review_provider_document/grant_provider_badge çağrılmadıysa)
 * boş dizi döner — çağıran taraf bunu "henüz kayıt yok" olarak göstermeli,
 * asla sahte bir satır UYDURMAMALI.
 */
export async function getRecentAdminActions(limit = 10): Promise<RecentAdminAction[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("admin_audit_log_search", { p_limit: limit });
  if (error || !data) return [];
  return (data as { id: string; action: string; entity_type: string; entity_id: string | null; actor_id: string | null; created_at: string }[]).map(
    (row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }),
  );
}
