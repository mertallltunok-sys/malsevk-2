import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { reportSystemError } from "./system-health";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { ProviderDocumentType } from "./provider-documents";
import type { ProviderDocumentReviewStatus } from "./types";

/**
 * SUPABASE AUTH GEÇİŞİ (belge inceleme akışı, gerçek admin hesabıyla uçtan
 * uca doğrulama görevi): `provider_documents`/`provider_document_reviews`
 * (0007) ve `review_provider_document`/`create_provider_document` RPC'leri
 * (0016/0023) ZATEN tam işlevsel ve önceki turlarda doğrulanmıştı —
 * `tmp-supabase-provider-profile-writes-test.mjs`'in kendi yorumu (madde
 * 43-54) `review_provider_document`in POZİTİF (onay/red) ucunun gerçek bir
 * admin hesabı olmadığı için test EDİLEMEDİĞİNİ açıkça belirtiyordu — bu
 * dosya ve ona bağlı UI, tam olarak o eksik ucu (ve app-code tarafında hiç
 * var olmayan admin görüntüleme/inceleme ile hizmet-verenin kendi belge
 * durumunu görme/yeniden yükleme ekranlarını) tamamlar. Hiçbir migration
 * değişmedi/eklenmedi — RLS zaten `provider_id = auth.uid() or is_admin()`
 * (0013) ile admin'in TÜM satırları görmesine izin veriyor, bu yüzden admin
 * listesi düz bir `select` ile okunur; yazma yolu yalnızca `review_provider_
 * document` RPC'sidir (SECURITY DEFINER, is_admin() zorunlu).
 */

/**
 * 0024 (belge yaşam döngüsü): `'superseded'` yalnızca GERÇEK (Supabase)
 * `provider_documents` şemasında var — legacy localStorage `provider-
 * documents.ts`in paylaştığı `ProviderDocumentReviewStatus` (types.ts) BUNU
 * BİLEREK içermez (localStorage sisteminde bu kavram hiç yok). Bu yüzden
 * genişletilmiş birleşim burada, yalnızca bu dosyaya özgü olarak tanımlanır —
 * `types.ts`'i genişletmek legacy sisteme ilgisiz bir değer sızdırırdı.
 */
export type RemoteProviderDocumentReviewStatus = ProviderDocumentReviewStatus | "superseded";

export type RemoteProviderDocument = {
  id: string;
  providerId: string;
  documentType: ProviderDocumentType;
  /** HANGİ hizmeti desteklediği (migration 0038) — null: genel belge (Gümrük Müşaviri İzin Belgesi zaten kendi documentType'ıyla ayrışır, bu alan onun için de doldurulabilir ama gerekmez). */
  serviceCategoryId: string | null;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  currentReviewStatus: RemoteProviderDocumentReviewStatus;
  currentReviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  /** "Depocu Faaliyet Alanları" (migration 0059) — provider'ın belge yüklerken TALEP ettiği Konteyner Depolama kapsamları. YALNIZCA konteyner-depolama'yı kapsayan belgelerde dolu, diğerlerinde her zaman null. storage-container-catalog.ts#StorageActivityScopeId değerleri. */
  storageActivityScopes: string[] | null;
  /** YALNIZCA storageActivityScopes içinde "dolu-tehlikeli-konteyner-depolama" varsa anlamlı — TALEP edilen IMO sınıfları (storage-container-catalog.ts#ImoClassCode). */
  imoClassCodes: string[] | null;
  /** "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi (migration 0068) — provider'ın belge yüklerken KENDİSİNİN talep ettiği risk grupları (storage-hazard-catalog.ts#StorageRiskGroupId). Otomatik yetki VERMEZ — yalnızca admin'in reviewProviderDocumentRemote'ta AYRI onayladığı alt küme provider_storage_risk_authorizations'a yansır. */
  requestedStorageRiskGroups: string[] | null;
  /** "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi (migration 0069) — requestedStorageRiskGroups İLE AYNI ilke, iki BAĞIMSIZ eksen: recycling-catalog.ts#RecyclingActivityId (faaliyet) ve resmî atık kodları. */
  requestedRecyclingActivities: string[] | null;
  requestedRecyclingWasteCodes: string[] | null;
};

type ProviderDocumentRow = {
  id: string;
  provider_id: string;
  document_type: string;
  service_category_id: string | null;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  current_review_status: string;
  current_review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  uploaded_at: string;
  storage_activity_scopes: string[] | null;
  imo_class_codes: string[] | null;
  requested_storage_risk_groups: string[] | null;
  requested_recycling_activities: string[] | null;
  requested_recycling_waste_codes: string[] | null;
};

function mapRow(row: ProviderDocumentRow): RemoteProviderDocument {
  return {
    id: row.id,
    providerId: row.provider_id,
    documentType: row.document_type as ProviderDocumentType,
    serviceCategoryId: row.service_category_id,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    currentReviewStatus: row.current_review_status as RemoteProviderDocumentReviewStatus,
    currentReviewNote: row.current_review_note,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    uploadedAt: row.uploaded_at,
    storageActivityScopes: row.storage_activity_scopes,
    imoClassCodes: row.imo_class_codes,
    requestedStorageRiskGroups: row.requested_storage_risk_groups,
    requestedRecyclingActivities: row.requested_recycling_activities,
    requestedRecyclingWasteCodes: row.requested_recycling_waste_codes,
  };
}

const DOCUMENT_COLUMNS =
  "id, provider_id, document_type, service_category_id, storage_path, original_file_name, mime_type, extension, size_bytes, current_review_status, current_review_note, reviewed_at, reviewed_by, uploaded_at, storage_activity_scopes, imo_class_codes, requested_storage_risk_groups, requested_recycling_activities, requested_recycling_waste_codes";

export type AdminProviderDocumentEntry = RemoteProviderDocument & {
  providerName: string | null;
  providerCompanyName: string | null;
};

export type ListProviderDocumentsResult =
  | { ok: true; documents: AdminProviderDocumentEntry[] }
  | { ok: false; error: string };

/**
 * Admin-only liste — RLS (`provider_documents_select_own_or_admin`, 0013)
 * çağıranın gerçekten admin olduğunu ZATEN sunucu tarafında garanti eder; bu
 * fonksiyon admin OLMAYAN bir oturumdan çağrılırsa yalnızca kendi (muhtemelen
 * sıfır) satırını görür — sessizce "boş liste" döner, hata FIRLATMAZ, çünkü
 * bu bir yetki hatası değil, RLS'in kendi doğal filtrelemesidir.
 */
export async function listAllProviderDocumentsForAdminRemote(): Promise<ListProviderDocumentsResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) {
    return { ok: false, error: "Belgeler yüklenemedi. Lütfen tekrar deneyin." };
  }

  const rows = (data ?? []) as unknown as ProviderDocumentRow[];
  const providerIds = Array.from(new Set(rows.map((row) => row.provider_id)));
  const profilesById = new Map<string, { full_name: string | null; company_name: string | null }>();
  if (providerIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name, company_name")
      .in("id", providerIds);
    for (const profile of (profileRows ?? []) as { id: string; full_name: string | null; company_name: string | null }[]) {
      profilesById.set(profile.id, profile);
    }
  }

  return {
    ok: true,
    documents: rows.map((row) => {
      const profile = profilesById.get(row.provider_id);
      return {
        ...mapRow(row),
        providerName: profile?.full_name ?? null,
        providerCompanyName: profile?.company_name ?? null,
      };
    }),
  };
}

export type ListMyProviderDocumentsResult =
  | { ok: true; documents: RemoteProviderDocument[] }
  | { ok: false; error: string };

/** Yalnızca çağıranın KENDİ belgelerini döner (RLS zaten bunu garanti eder — `.eq` burada yalnızca niyeti netleştirmek için var, güvenlik sınırı değil). */
export async function listMyProviderDocumentsRemote(): Promise<ListMyProviderDocumentsResult> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Belgelerinizi görmek için giriş yapmalısınız." };
  }

  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("provider_id", user.id)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) {
    return { ok: false, error: "Belgeleriniz yüklenemedi. Lütfen tekrar deneyin." };
  }

  return { ok: true, documents: (data ?? []).map((row) => mapRow(row as unknown as ProviderDocumentRow)) };
}

export type ReviewProviderDocumentResult =
  | { ok: true; document: RemoteProviderDocument }
  | { ok: false; error: string };

function mapReviewRpcError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK50":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK71":
      return "Geçersiz inceleme durumu.";
    case "MLK75":
      return "Reddetme veya yeniden belge isteme işlemi için açıklama girmelisiniz.";
    case "MLK76":
      return "Belge bulunamadı.";
    case "MLK97":
      return "Seçilen faaliyet alanlarından biri geçersiz.";
    case "MLK86":
      return "Seçilen IMO sınıflarından biri geçersiz.";
    case "ML138":
      return "Seçilen depolama risk gruplarından biri geçersiz.";
    case "ML142":
      return "Seçilen faaliyetlerden biri geçersiz.";
    case "ML140":
      return "Seçilen atık kodlarından biri geçersiz.";
    default:
      return error.message || "Belge durumu güncellenemedi. Lütfen tekrar deneyin.";
  }
}

export type AdminProviderDocumentDetail = AdminProviderDocumentEntry & {
  providerPhone: string | null;
  providerProvince: string | null;
  providerDistrict: string | null;
};

/** Tek bir belgeyi (+ firma bilgileri) döner — "İncele" ekranı için. RLS aynı `provider_documents_select_own_or_admin`dir; admin olmayan bir çağrı `null` döner (satır bulunamaz), hata fırlatmaz. */
export async function getProviderDocumentForAdmin(documentId: string): Promise<AdminProviderDocumentDetail | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as ProviderDocumentRow;
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("full_name, company_name, phone, province, district")
    .eq("id", row.provider_id)
    .maybeSingle();

  return {
    ...mapRow(row),
    providerName: profileRow?.full_name ?? null,
    providerCompanyName: profileRow?.company_name ?? null,
    providerPhone: profileRow?.phone ?? null,
    providerProvince: profileRow?.province ?? null,
    providerDistrict: profileRow?.district ?? null,
  };
}

export type ProviderDocumentReviewHistoryEntry = {
  id: string;
  action: "approved" | "rejected" | "revision_requested";
  note: string | null;
  adminId: string;
  createdAt: string;
};

/**
 * `provider_document_reviews` (0007) — append-only inceleme geçmişi. RLS
 * (`provider_document_reviews_select_own_or_admin`, 0013) admin'in TÜM
 * satırları görmesine zaten izin verir; ayrı bir RPC gerekmez.
 */
export async function listProviderDocumentReviewHistory(documentId: string): Promise<ProviderDocumentReviewHistoryEntry[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("provider_document_reviews")
    .select("id, action, note, admin_id, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as { id: string; action: string; note: string | null; admin_id: string; created_at: string }[]).map((row) => ({
    id: row.id,
    action: row.action as ProviderDocumentReviewHistoryEntry["action"],
    note: row.note,
    adminId: row.admin_id,
    createdAt: row.created_at,
  }));
}

/**
 * `review_provider_document` (0016, migration 0059 ile +2 opsiyonel
 * parametre) — admin-only, SECURITY DEFINER. `note`, reddetme/yeniden-belge-
 * isteme için sunucu tarafında ZORUNLU kılınır (MLK75).
 *
 * `approvedStorageActivityScopes`/`approvedImoClassCodes`: YALNIZCA `status
 * === "approved"` VE belge Konteyner Depolama'yı kapsıyorsa (`document.
 * serviceCategoryId === "konteyner-depolama"` YA DA `document.documentType
 * === "depo-hizmetleri-belgesi"`) anlamlı — admin'in belgenin TALEP edilen
 * kapsamından (bkz. RemoteProviderDocument.storageActivityScopes/
 * imoClassCodes) DAR bir alt küme onaylamasına izin verir (görev talimatı:
 * "belgenin kapsamadığı faaliyet alanını/IMO sınıfını onay dışında
 * bırakabilmeli" — KISMİ ONAY). Diğer TÜM belge türleri için bu iki
 * parametre gönderilmemeli (undefined) — RPC bunları null alır, davranış
 * BİREBİR AYNI kalır (bkz. migration 0059'un review_provider_document
 * gövdesi).
 */
export async function reviewProviderDocumentRemote(
  documentId: string,
  status: Exclude<ProviderDocumentReviewStatus, "pending">,
  note?: string,
  approvedStorageActivityScopes?: string[],
  approvedImoClassCodes?: string[],
  approvedStorageRiskGroups?: string[],
  approvedRecyclingActivities?: string[],
  approvedRecyclingWasteCodes?: string[],
): Promise<ReviewProviderDocumentResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("review_provider_document", {
    p_document_id: documentId,
    p_status: status,
    p_note: note && note.trim().length > 0 ? note.trim() : null,
    p_approved_storage_activity_scopes: approvedStorageActivityScopes ?? null,
    p_approved_imo_class_codes: approvedImoClassCodes ?? null,
    p_approved_storage_risk_groups: approvedStorageRiskGroups ?? null,
    p_approved_recycling_activities: approvedRecyclingActivities ?? null,
    p_approved_recycling_waste_codes: approvedRecyclingWasteCodes ?? null,
  });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "review_provider_document", affectedScreen: "Firma Belgeleri (Admin)" });
    return { ok: false, error: mapReviewRpcError(error) };
  }
  return { ok: true, document: mapRow(data as unknown as ProviderDocumentRow) };
}
