import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Admin "Sistem Beslemesi" (Tesis Onay Merkezi) modülü — Admin Paneli Faz 3.
 * Tamamı facility_candidates/facility_candidate_raw_entries (0029) ve o
 * migration'ın dört RPC'sinden okunur/yazılır — yeni migration/tablo yok.
 * admin-badges.ts/admin-jobs.ts ile AYNI desen: `createSupabaseBrowserClient()`,
 * RLS'in `is_admin()` dalına güveniyor, service_role bypass'i yok.
 */

export type FacilityCandidateStatus = "pending" | "approved" | "rejected";
export type FacilityCandidateConfidence = "high" | "medium" | "low";
export type FacilityCandidateType = "LIMAN" | "OSB" | "SANAYI" | "ANTREPO" | "GUMRUK_SAHASI";

export const FACILITY_CANDIDATE_TYPE_OPTIONS: { value: FacilityCandidateType; label: string }[] = [
  { value: "LIMAN", label: "Liman" },
  { value: "OSB", label: "OSB" },
  { value: "SANAYI", label: "Sanayi" },
  { value: "ANTREPO", label: "Antrepo" },
  { value: "GUMRUK_SAHASI", label: "Gümrük Sahası" },
];

const FACILITY_CANDIDATE_TYPE_LABEL: Record<FacilityCandidateType, string> = {
  LIMAN: "Liman",
  OSB: "OSB",
  SANAYI: "Sanayi",
  ANTREPO: "Antrepo",
  GUMRUK_SAHASI: "Gümrük Sahası",
};

export function getFacilityCandidateTypeLabel(type: string): string {
  return FACILITY_CANDIDATE_TYPE_LABEL[type as FacilityCandidateType] ?? type;
}

export const FACILITY_CANDIDATE_STATUS_LABEL: Record<FacilityCandidateStatus, string> = {
  pending: "Bekleyen",
  approved: "Onaylanan",
  rejected: "Reddedilen",
};

export const FACILITY_CANDIDATE_STATUS_TONE: Record<FacilityCandidateStatus, "success" | "warning" | "neutral" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export const FACILITY_CANDIDATE_CONFIDENCE_LABEL: Record<FacilityCandidateConfidence, string> = {
  high: "Yüksek Güven",
  medium: "Orta Güven",
  low: "Düşük Güven",
};

export const FACILITY_CANDIDATE_CONFIDENCE_TONE: Record<FacilityCandidateConfidence, "success" | "warning" | "neutral" | "danger"> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

export type AdminFacilityCandidateListItem = {
  id: string;
  suggestedName: string;
  suggestedProvince: string;
  suggestedDistrict: string | null;
  suggestedTypes: FacilityCandidateType[];
  status: FacilityCandidateStatus;
  confidence: FacilityCandidateConfidence;
  usageCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** "Ham aday örneği" (görev bölüm 2) — bu gruba giren ilk ham kullanıcı girdisi. */
  sampleRawText: string | null;
};

type CandidateRow = {
  id: string;
  suggested_name: string;
  suggested_province: string;
  suggested_district: string | null;
  suggested_types: string[];
  status: string;
  confidence: string;
  usage_count: number;
  first_seen_at: string;
  last_seen_at: string;
};

function mapCandidateRow(row: CandidateRow, sampleRawText: string | null = null): AdminFacilityCandidateListItem {
  return {
    id: row.id,
    suggestedName: row.suggested_name,
    suggestedProvince: row.suggested_province,
    suggestedDistrict: row.suggested_district,
    suggestedTypes: row.suggested_types as FacilityCandidateType[],
    status: row.status as FacilityCandidateStatus,
    confidence: row.confidence as FacilityCandidateConfidence,
    usageCount: row.usage_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    sampleRawText,
  };
}

/**
 * Tüm aday gruplarını + her birinin "ham aday örneği"ni (o gruba giren ilk
 * ham girdi) tek geçişte döndürür — admin-badges.ts#listCompaniesForBadgeAdmin
 * İLE AYNI iki-sorgu-sonra-Map deseni (facility_candidate_raw_entries'in
 * candidate_id'den başka bir kolonu embed edilecek FK'sı yok, bu yüzden
 * PostgREST tek sorguda "ilk" satırı seçemez — client'ta indirgeniyor).
 */
export async function listFacilityCandidatesForAdmin(): Promise<AdminFacilityCandidateListItem[]> {
  const supabase = createSupabaseBrowserClient();

  const { data: candidateRows, error: candidatesError } = await supabase
    .from("facility_candidates")
    .select("id, suggested_name, suggested_province, suggested_district, suggested_types, status, confidence, usage_count, first_seen_at, last_seen_at")
    .order("usage_count", { ascending: false });
  if (candidatesError || !candidateRows) return [];

  const rows = candidateRows as CandidateRow[];
  if (rows.length === 0) return [];

  const candidateIds = rows.map((row) => row.id);
  const { data: rawRows } = await supabase
    .from("facility_candidate_raw_entries")
    .select("candidate_id, raw_text, created_at")
    .in("candidate_id", candidateIds)
    .order("created_at", { ascending: true });

  const sampleByCandidate = new Map<string, string>();
  for (const row of (rawRows ?? []) as { candidate_id: string; raw_text: string }[]) {
    if (!sampleByCandidate.has(row.candidate_id)) sampleByCandidate.set(row.candidate_id, row.raw_text);
  }

  return rows.map((row) => mapCandidateRow(row, sampleByCandidate.get(row.id) ?? null));
}

export type FacilityCandidateSpelling = {
  rawText: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type AdminFacilityCandidateDetail = AdminFacilityCandidateListItem & {
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /** "Benzer yazımlar" + "her yazımın kullanım sayısı" (görev bölüm 5) — tam ham metne göre gruplanmış, kullanım sayısına göre azalan sırada. */
  spellings: FacilityCandidateSpelling[];
};

export async function getFacilityCandidateDetail(candidateId: string): Promise<AdminFacilityCandidateDetail | null> {
  const supabase = createSupabaseBrowserClient();

  const { data: row, error } = await supabase
    .from("facility_candidates")
    .select(
      "id, suggested_name, suggested_province, suggested_district, suggested_types, status, confidence, usage_count, first_seen_at, last_seen_at, reviewed_by, reviewed_at, rejection_reason",
    )
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !row) return null;

  const { data: rawRows } = await supabase
    .from("facility_candidate_raw_entries")
    .select("raw_text, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });

  const spellingByText = new Map<string, FacilityCandidateSpelling>();
  for (const entry of (rawRows ?? []) as { raw_text: string; created_at: string }[]) {
    const existing = spellingByText.get(entry.raw_text);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = entry.created_at;
    } else {
      spellingByText.set(entry.raw_text, { rawText: entry.raw_text, count: 1, firstSeenAt: entry.created_at, lastSeenAt: entry.created_at });
    }
  }
  const spellings = Array.from(spellingByText.values()).sort((a, b) => b.count - a.count);

  let reviewedByName: string | null = null;
  const reviewedBy = (row as { reviewed_by: string | null }).reviewed_by;
  if (reviewedBy) {
    const { data: reviewerRow } = await supabase.from("profiles").select("full_name").eq("id", reviewedBy).maybeSingle();
    reviewedByName = (reviewerRow as { full_name: string | null } | null)?.full_name ?? null;
  }

  return {
    ...mapCandidateRow(row as CandidateRow),
    reviewedByName,
    reviewedAt: (row as { reviewed_at: string | null }).reviewed_at,
    rejectionReason: (row as { rejection_reason: string | null }).rejection_reason,
    spellings,
  };
}

export type FacilityCandidateActionResult = { ok: true } | { ok: false; error: string };

function mapFacilityCandidateError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "ML110":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "ML111":
      return "Geçersiz tesis türü seçildi.";
    case "ML112":
      return "Tesis adı gereklidir.";
    case "ML113":
      return "Aday bulunamadı — başka bir admin tarafından zaten işlenmiş olabilir.";
    case "ML114":
      return "Reddetmek için bir gerekçe girmelisiniz.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

/** approve_facility_candidate (0029) — admin-only, tek tuşla onay + sibling-merge (bkz. migration'ın kendi dosya başlığı). */
export async function approveFacilityCandidate(
  candidateId: string,
  name: string,
  province: string,
  district: string,
  types: FacilityCandidateType[],
): Promise<FacilityCandidateActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("approve_facility_candidate", {
    p_candidate_id: candidateId,
    p_name: name.trim(),
    p_province: province,
    p_district: district.trim().length > 0 ? district.trim() : null,
    p_types: types,
  });
  if (error) return { ok: false, error: mapFacilityCandidateError(error) };
  return { ok: true };
}

/** reject_facility_candidate (0029) — admin-only, gerekçe zorunlu (ML114 DB kısıtı). */
export async function rejectFacilityCandidate(candidateId: string, reason: string): Promise<FacilityCandidateActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("reject_facility_candidate", {
    p_candidate_id: candidateId,
    p_reason: reason.trim(),
  });
  if (error) return { ok: false, error: mapFacilityCandidateError(error) };
  return { ok: true };
}

/** update_facility_candidate_suggestion (0029) — admin-only "Düzenle", statüyü değiştirmez. */
export async function updateFacilityCandidateSuggestion(
  candidateId: string,
  name: string,
  province: string,
  district: string,
  types: FacilityCandidateType[],
): Promise<FacilityCandidateActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_facility_candidate_suggestion", {
    p_candidate_id: candidateId,
    p_name: name.trim(),
    p_province: province,
    p_district: district.trim().length > 0 ? district.trim() : null,
    p_types: types,
  });
  if (error) return { ok: false, error: mapFacilityCandidateError(error) };
  return { ok: true };
}
