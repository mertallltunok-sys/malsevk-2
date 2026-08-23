"use client";

import { SERVICE_CATEGORY_GROUPS, getProviderAuthorizationGroupByDocumentType } from "./service-catalog";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Sağlayıcının KENDİ "Hizmet Yetkileri" görünümü (Panel > Profilim) — görev
 * bölüm 20/42: TÜM katalog kategorileri (yalnızca seçilenler değil)
 * "Seçilmedi" durumuyla birlikte listelenir, TEK doğruluk kaynağı
 * service-catalog.ts#SERVICE_CATEGORY_GROUPS (ikinci bir kategori listesi
 * İCAT EDİLMEDİ). `admin-companies.ts#getServiceAuthorizationsForAdmin` ile
 * BENZER birleştirme mantığını taşır ama KASITLI OLARAK ayrı bir fonksiyondur
 * — o yalnızca "seçili ya da yetkilendirme geçmişi olan" kategorileri döner
 * (admin'in yönetmesi gereken satırlar), bu ise HER ZAMAN tam katalogu döner
 * (provider'ın "hangi hizmetleri henüz hiç seçmediğini" de görmesi gerekir).
 * RLS (`provider_id = auth.uid() or is_admin()`) zaten yalnızca KENDİ
 * satırlarını döndürmeyi garanti eder — bu dosya ayrıca bir yetki kontrolü
 * yapmaz, yapmasına gerek yoktur.
 */

export type MyServiceStatus =
  | "not_selected"
  | "document_required"
  | "document_pending"
  | "document_rejected"
  | "approved_awaiting_authorization"
  | "authorized"
  | "revoked";

export type MyServiceAuthorizationRow = {
  serviceCategoryId: string;
  serviceCategoryLabel: string;
  status: MyServiceStatus;
  documentReviewNote: string | null;
  revokeReason: string | null;
};

export async function getMyServiceAuthorizations(providerId: string): Promise<MyServiceAuthorizationRow[]> {
  const supabase = createSupabaseBrowserClient();
  const [servicesResult, documentsResult, authResult] = await Promise.all([
    supabase.from("provider_services").select("service_category_id").eq("provider_id", providerId),
    supabase
      .from("provider_documents")
      .select("service_category_id, document_type, current_review_status, current_review_note")
      .eq("provider_id", providerId)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("provider_service_authorizations")
      .select("service_category_id, revoked_at, revoke_reason")
      .eq("provider_id", providerId)
      .order("authorized_at", { ascending: false }),
  ]);

  const selectedIds = new Set(((servicesResult.data ?? []) as { service_category_id: string }[]).map((row) => row.service_category_id));
  const selectedNonCustomsIds = Array.from(selectedIds).filter((id) => id !== "gumruk-musavirligi");

  type DocRow = { service_category_id: string | null; document_type: string; current_review_status: "approved" | "pending" | "rejected" | "revision_requested"; current_review_note: string | null };
  const documentRows = (documentsResult.data ?? []) as DocRow[];
  const bestDocByCategory = new Map<string, DocRow>();
  for (const doc of documentRows) {
    const authorizationGroup = getProviderAuthorizationGroupByDocumentType(doc.document_type);
    const categoryIds =
      doc.document_type === "gumruk-musaviri-izin-belgesi"
        ? ["gumruk-musavirligi"]
        : authorizationGroup
          ? authorizationGroup.categoryIds
          : doc.service_category_id
            ? [doc.service_category_id]
            : selectedNonCustomsIds.length === 1
              ? selectedNonCustomsIds
              : [];
    for (const categoryId of categoryIds) {
      const existing = bestDocByCategory.get(categoryId);
      if (!existing || (doc.current_review_status === "approved" && existing.current_review_status !== "approved")) {
        bestDocByCategory.set(categoryId, doc);
      }
    }
  }

  type AuthRow = { service_category_id: string; revoked_at: string | null; revoke_reason: string | null };
  const authRows = (authResult.data ?? []) as AuthRow[];
  const authByCategory = new Map<string, AuthRow>();
  for (const row of authRows) {
    const existing = authByCategory.get(row.service_category_id);
    if (!existing) authByCategory.set(row.service_category_id, row);
    else if (existing.revoked_at !== null && row.revoked_at === null) authByCategory.set(row.service_category_id, row);
  }

  const rows: MyServiceAuthorizationRow[] = [];
  for (const group of SERVICE_CATEGORY_GROUPS) {
    for (const category of group.categories) {
      const selected = selectedIds.has(category.id);
      const doc = bestDocByCategory.get(category.id) ?? null;
      const auth = authByCategory.get(category.id) ?? null;
      const authorized = auth !== null && auth.revoked_at === null;

      // DÜZELTME (proje raporu, "Belge Onayı / Hizmet Yetkilendirme Senkron
      // Sorunu"): `doc?.current_review_status === "approved"` dalı burada
      // YOKTU — bir belge onaylanmış ama (ör. migration 0041'den önceki bir
      // yarış durumu ya da manuel bir DB düzeltmesi) karşılığında hâlâ aktif
      // bir yetki satırı yoksa, bu merdiven sessizce en alta ("hiçbir şey
      // eşleşmedi") düşüyor ve `document_required` (belge HİÇ yüklenmemiş
      // gibi) döndürüyordu — provider'a zaten onaylanmış belgesini YENİDEN
      // YÜKLEMESİNİ söyleyen yanlış bir CTA gösteriyordu. migration 0041
      // artık belge onayını otomatik yetkilendirmeye bağladığı için bu dal
      // pratikte nadiren tetiklenir, ama bu YİNE DE gerçek, bağımsız bir
      // sınıflandırma hatasıydı — düzeltildi, ikinci hatayı gizlemez.
      let status: MyServiceStatus;
      if (!selected) status = "not_selected";
      else if (authorized) status = "authorized";
      else if (auth !== null && auth.revoked_at !== null) status = "revoked";
      else if (doc?.current_review_status === "rejected") status = "document_rejected";
      else if (doc?.current_review_status === "pending" || doc?.current_review_status === "revision_requested") status = "document_pending";
      else if (doc?.current_review_status === "approved") status = "approved_awaiting_authorization";
      else status = "document_required";

      rows.push({
        serviceCategoryId: category.id,
        serviceCategoryLabel: category.label,
        status,
        documentReviewNote: doc?.current_review_note ?? null,
        revokeReason: auth?.revoke_reason ?? null,
      });
    }
  }
  return rows;
}

/**
 * BELGE/YETKİ SADELEŞTİRMESİ (migration 0044) — `/panel/belge-yukleme`'nin
 * seçici ekranının, bir "Provider Authorization Group"u (bkz. service-
 * catalog.ts#PROVIDER_AUTHORIZATION_GROUPS) yalnızca o grubun document_type'ı
 * için HENÜZ hiç belge (pending/approved/rejected/revision_requested —
 * DURUMU ne olursa olsun) yoksa göstermesi için: bir grup belgesi ZATEN
 * varsa (hangi durumda olursa olsun) o grup ikinci kez pickable OLMAMALI —
 * bu, tekil kategori akışının ZATEN yaptığı "belgesi olan bir kategori bir
 * daha seçilemez" kuralının (bkz. yukarıdaki `pickableCategoryIds` — yalnız
 * `not_selected`/`document_required` durumları pickable) grup seviyesindeki
 * birebir karşılığıdır — reddedilmiş/revizyon istenen bir grup belgesinin
 * yeniden yüklenmesi bu ekrandan DEĞİL, tekil kategorilerle AYNI ayrı akıştan
 * (provider-document-status-list.tsx, "Belgelerim") yapılır.
 */
export async function getMyExistingGroupDocumentTypes(providerId: string): Promise<Set<string>> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase
    .from("provider_documents")
    .select("document_type")
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .is("service_category_id", null)
    .in("document_type", ["depo-hizmetleri-belgesi", "operator-is-makinesi-belgesi"]);
  return new Set(((data ?? []) as { document_type: string }[]).map((row) => row.document_type));
}
