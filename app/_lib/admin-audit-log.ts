import { getCategoryDisplayLabel } from "./service-catalog";
import { formatWasteCodeForDisplay, getWasteCodeEntry } from "./recycling-waste-code-catalog";
import { getStorageRiskGroupLabel } from "./storage-hazard-catalog";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * İŞLEM GEÇMİŞİ (görev bölüm 19) — ikinci bir günlük tablosu İCAT EDİLMEZ.
 * Tek veri kaynağı, ZATEN var olan `admin_audit_log_search` RPC'sidir (0017,
 * `audit_logs` tablosunun üzerinde, kendi kendine `is_admin()` ile
 * kapılıdır). Bu dosyanın tek işi: o RPC'nin ham `action`/`entity_type`/
 * `old_data`/`new_data` satırlarını, admin panelinin genelinde ZATEN var
 * olan etiket fonksiyonlarını (service-catalog, recycling katalogları,
 * storage-hazard-catalog) kullanarak anlaşılır Türkçe cümlelere çevirmek — ham teknik
 * işlem kodları ana ekranda GÖRÜNMEZ (görev gereksinimi), yalnızca detay
 * genişletildiğinde.
 */

export type HumanizedAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  title: string;
  actorName: string | null;
  createdAtIso: string;
};

type RawAuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export type AdminAuditLogFilters = {
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export async function listHumanizedAdminAuditLog(filters: AdminAuditLogFilters = {}): Promise<HumanizedAuditEntry[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("admin_audit_log_search", {
    p_entity_type: filters.entityType ?? null,
    p_entity_id: null,
    p_actor_id: filters.actorId ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: filters.limit ?? 200,
  });
  if (error || !data) return [];

  const rows = data as RawAuditRow[];
  if (rows.length === 0) return [];

  // İsim çözümlemesi tek seferde, entity_type'a göre gruplanmış toplu
  // sorgularla yapılır — her satır için ayrı bir round-trip AÇILMAZ.
  const actorIds = new Set<string>();
  const profileEntityIds = new Set<string>();
  const jobEntityIds = new Set<string>();
  const documentEntityIds = new Set<string>();
  const authorizationProviderIds = new Set<string>();

  for (const row of rows) {
    if (row.actor_id) actorIds.add(row.actor_id);
    if (row.entity_type === "profiles" && row.entity_id) profileEntityIds.add(row.entity_id);
    if (row.entity_type === "jobs" && row.entity_id) jobEntityIds.add(row.entity_id);
    if (row.entity_type === "provider_documents" && row.entity_id) documentEntityIds.add(row.entity_id);
    if (
      (row.entity_type === "provider_service_authorizations" ||
        row.entity_type === "provider_storage_risk_authorizations" ||
        row.entity_type === "provider_recycling_waste_code_authorizations") &&
      row.new_data
    ) {
      const providerId = str(row.new_data.provider_id);
      if (providerId) authorizationProviderIds.add(providerId);
    }
  }

  const [documentRows] = await Promise.all([
    documentEntityIds.size > 0
      ? supabase.from("provider_documents").select("id, provider_id, document_type").in("id", Array.from(documentEntityIds))
      : Promise.resolve({ data: [] as { id: string; provider_id: string; document_type: string }[] }),
  ]);
  const documentById = new Map<string, { providerId: string; documentType: string }>();
  for (const row of (documentRows.data ?? []) as { id: string; provider_id: string; document_type: string }[]) {
    documentById.set(row.id, { providerId: row.provider_id, documentType: row.document_type });
    authorizationProviderIds.add(row.provider_id);
  }

  const allProfileIds = new Set<string>([...actorIds, ...profileEntityIds, ...authorizationProviderIds]);
  const profileNameById = new Map<string, string>();
  if (allProfileIds.size > 0) {
    const { data: profileRows } = await supabase.from("profiles").select("id, full_name, company_name").in("id", Array.from(allProfileIds));
    for (const row of (profileRows ?? []) as { id: string; full_name: string | null; company_name: string | null }[]) {
      profileNameById.set(row.id, row.company_name ?? row.full_name ?? "İsimsiz Kullanıcı");
    }
  }

  const jobTitleById = new Map<string, string>();
  if (jobEntityIds.size > 0) {
    const { data: jobRows } = await supabase.from("admin_job_list").select("id, title").in("id", Array.from(jobEntityIds));
    for (const row of (jobRows ?? []) as { id: string; title: string }[]) {
      jobTitleById.set(row.id, row.title);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: humanizeAuditRow(row, { profileNameById, jobTitleById, documentById }),
    actorName: row.actor_id ? (profileNameById.get(row.actor_id) ?? null) : null,
    createdAtIso: row.created_at,
  }));
}

type ResolutionMaps = {
  profileNameById: Map<string, string>;
  jobTitleById: Map<string, string>;
  documentById: Map<string, { providerId: string; documentType: string }>;
};

function humanizeAuditRow(row: RawAuditRow, maps: ResolutionMaps): string {
  const newData = row.new_data ?? {};
  const oldData = row.old_data ?? {};

  const profileName = row.entity_id ? maps.profileNameById.get(row.entity_id) : undefined;
  const jobTitle = row.entity_id ? maps.jobTitleById.get(row.entity_id) : undefined;
  const document = row.entity_id ? maps.documentById.get(row.entity_id) : undefined;
  const documentProviderName = document ? maps.profileNameById.get(document.providerId) : undefined;

  switch (row.action) {
    case "authorize_provider_service": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const categoryId = str(newData.service_category_id);
      return `${providerName} firmasının ${categoryId ? getCategoryDisplayLabel(categoryId) : "hizmet"} yetkisi onaylandı.`;
    }
    case "revoke_provider_service_authorization": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const categoryId = str(newData.service_category_id);
      return `${providerName} firmasının ${categoryId ? getCategoryDisplayLabel(categoryId) : "hizmet"} yetkisi kaldırıldı.`;
    }
    case "authorize_provider_storage_risk_group": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const riskGroupId = str(newData.risk_group_id);
      return `${providerName} firmasının ${riskGroupId ? (getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId) : "depolama risk grubu"} yetkisi onaylandı.`;
    }
    case "revoke_provider_storage_risk_group": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const riskGroupId = str(newData.risk_group_id);
      return `${providerName} firmasının ${riskGroupId ? (getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId) : "depolama risk grubu"} yetkisi kaldırıldı.`;
    }
    case "authorize_provider_recycling_waste_code": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const wasteCode = str(newData.waste_code);
      const entry = wasteCode ? getWasteCodeEntry(wasteCode) : undefined;
      return `${providerName} firmasının ${wasteCode ? formatWasteCodeForDisplay(wasteCode) : "atık kodu"}${entry ? ` (${entry.description})` : ""} atık kodu yetkisi onaylandı.`;
    }
    case "revoke_provider_recycling_waste_code": {
      const providerId = str(newData.provider_id);
      const providerName = (providerId && maps.profileNameById.get(providerId)) || "Bir firma";
      const wasteCode = str(newData.waste_code);
      return `${providerName} firmasının ${wasteCode ? formatWasteCodeForDisplay(wasteCode) : "atık kodu"} atık kodu yetkisi kaldırıldı.`;
    }
    case "request_provider_document": {
      const providerId = str(newData.provider_id) ?? row.entity_id;
      const providerName = (providerId && maps.profileNameById.get(providerId)) || profileName || "Bir firma";
      const categoryId = str(newData.service_category_id);
      return `${providerName} için ${categoryId ? getCategoryDisplayLabel(categoryId) : "ek"} belge talep edildi.`;
    }
    case "review_provider_document": {
      const status = str(newData.current_review_status);
      const providerLabel = documentProviderName ?? "bir firmanın";
      const statusText =
        status === "approved"
          ? "onaylandı"
          : status === "rejected"
            ? "reddedildi"
            : status === "revision_requested"
              ? "için revizyon istendi"
              : "güncellendi";
      return `${providerLabel} belgesi ${statusText}.`;
    }
    case "close_job_as_admin":
      return `${jobTitle ?? "Bir ilan"} yönetici tarafından yayından kaldırıldı.`;
    case "delete_job_as_admin":
      return `${jobTitle ?? "Bir ilan"} yönetici tarafından silindi.`;
    case "approve_job_as_admin":
      return `${jobTitle ?? "Bir ilan"} onaylandı ve yayımlandı.`;
    case "reject_job_as_admin":
      return `${jobTitle ?? "Bir ilan"} reddedildi.`;
    case "update_job_as_admin":
      return `${jobTitle ?? "Bir ilan"} yönetici tarafından düzenlendi.`;
    case "update_job_as_requester":
      return `${jobTitle ?? "Bir ilan"} sahibi tarafından düzenlendi.`;
    case "suspend_user":
      return `${profileName ?? "Bir kullanıcı"} hesabı askıya alındı.`;
    case "reinstate_user":
      return `${profileName ?? "Bir kullanıcı"} hesabı yeniden etkinleştirildi.`;
    case "update_profile_as_admin":
      return `${profileName ?? "Bir kullanıcı"} profili yönetici tarafından düzenlendi.`;
    case "grant_provider_badge":
      return `${profileName ?? "Bir firma"}ya rozet verildi.`;
    case "revoke_provider_badge":
      return `${profileName ?? "Bir firma"}nın rozeti geri alındı.`;
    case "approve_facility_candidate":
      return "Bir tesis adayı onaylandı.";
    case "reject_facility_candidate":
      return "Bir tesis adayı reddedildi.";
    case "update_facility_candidate_suggestion":
      return "Bir tesis adayı önerisi güncellendi.";
    case "update_system_error_status": {
      const status = str(newData.status);
      const statusText = status === "cozuldu" ? "çözüldü" : status === "inceleniyor" ? "inceleniyor" : "yeni";
      return `Bir sistem hatası "${statusText}" olarak işaretlendi.`;
    }
    default: {
      void oldData;
      return `${row.action} (${row.entity_type})`;
    }
  }
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  jobs: "İlan",
  profiles: "Kullanıcı",
  provider_documents: "Belge",
  provider_service_authorizations: "Hizmet Yetkisi",
  provider_storage_risk_authorizations: "Depolama Risk Grubu",
  provider_recycling_waste_code_authorizations: "Atık Kodu Yetkisi",
  facility_candidates: "Tesis Adayı",
  system_error_log: "Sistem Hatası",
};

export function getAuditEntityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABEL[entityType] ?? entityType;
}

export const AUDIT_ENTITY_TYPE_FILTER_OPTIONS = Object.entries(ENTITY_TYPE_LABEL).map(([value, label]) => ({ value, label }));
