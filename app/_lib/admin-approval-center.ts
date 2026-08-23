import { getProviderDocumentTypeLabel } from "./provider-documents";
import { getCategoryDisplayLabel } from "./service-catalog";
import { listAllProviderDocumentsForAdminRemote } from "./supabase-provider-document-review";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { listJobsForAdmin } from "./admin-jobs";

/**
 * ONAY MERKEZİ (Yönetim Paneli yeniden tasarımı, görev bölüm 8).
 *
 * Görev gereksinimi açıkça şunu söylüyor: "Bu ekran yeni bir onay kaydı
 * sistemi ÜRETMESİN." Bu dosya hiçbir yeni tablo/RPC yazmaz — yalnızca ZATEN
 * var olan iki gerçek kuyruğu (bekleyen `provider_documents` satırları,
 * bkz. `supabase-provider-document-review.ts`; ve `moderation_status =
 * 'pending_review'` ilanlar, bkz. `admin-jobs.ts`) TEK bir listede birleştirir.
 * Her satırın "İncele" bağlantısı mevcut admin detay ekranlarına
 * (`/admin/firma-belgeleri/[id]`, `/admin/ilanlar/[id]`) gider — yeni bir
 * detay ekranı İCAT EDİLMEZ.
 */

export type ApprovalCenterKind = "belge" | "ilan";

export type ApprovalCenterItem = {
  id: string;
  kind: ApprovalCenterKind;
  title: string;
  subjectName: string;
  categoryLabel: string | null;
  waitingSinceIso: string;
  /** Belge zaten "revizyon istendi" durumundaysa (admin ek belge istedi, top provider'da) — Ek Belge filtresi için. */
  isAdditionalDocumentFollowUp: boolean;
  /** 24 saatten uzun süredir bekliyorsa — Öncelikli filtresi için, gerçek bekleme süresinden türetilir, sabit/uydurma DEĞİL. */
  isPriority: boolean;
  href: string;
};

const PRIORITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function getApprovalCenterItems(): Promise<ApprovalCenterItem[]> {
  const now = Date.now();
  const [documentsResult, jobs] = await Promise.all([
    listAllProviderDocumentsForAdminRemote(),
    listJobsForAdmin().catch(() => [] as Awaited<ReturnType<typeof listJobsForAdmin>>),
  ]);

  const items: ApprovalCenterItem[] = [];

  if (documentsResult.ok) {
    for (const doc of documentsResult.documents) {
      if (doc.currentReviewStatus !== "pending" && doc.currentReviewStatus !== "revision_requested") continue;
      const waitingMs = now - new Date(doc.uploadedAt).getTime();
      items.push({
        id: doc.id,
        kind: "belge",
        title: getProviderDocumentTypeLabel(doc.documentType),
        subjectName: doc.providerCompanyName ?? doc.providerName ?? "İsimsiz Firma",
        categoryLabel: doc.serviceCategoryId ? getCategoryDisplayLabel(doc.serviceCategoryId) : null,
        waitingSinceIso: doc.uploadedAt,
        isAdditionalDocumentFollowUp: doc.currentReviewStatus === "revision_requested",
        isPriority: waitingMs > PRIORITY_THRESHOLD_MS,
        href: `/admin/firma-belgeleri/${doc.id}`,
      });
    }
  }

  for (const job of jobs) {
    if (job.moderationStatus !== "pending_review") continue;
    const waitingMs = now - new Date(job.createdAt).getTime();
    items.push({
      id: job.id,
      kind: "ilan",
      title: job.title,
      subjectName: job.companyName ?? job.requesterFullName ?? "İsimsiz Kullanıcı",
      categoryLabel: job.categoryLabel,
      waitingSinceIso: job.createdAt,
      isAdditionalDocumentFollowUp: false,
      isPriority: waitingMs > PRIORITY_THRESHOLD_MS,
      href: `/admin/ilanlar/${job.id}`,
    });
  }

  items.sort((a, b) => new Date(a.waitingSinceIso).getTime() - new Date(b.waitingSinceIso).getTime());
  return items;
}

/**
 * Sidebar rozeti / Yönetim Özeti "Bekleyen Onay" kartı için hafif, yalnızca
 * SAYI döndüren sürüm — her admin sayfa yüklemesinde tüm listeyi (firma/
 * kategori isimleriyle) çekmek yerine iki `count: "exact", head: true`
 * sorgusu yeterlidir.
 */
export async function getApprovalCenterPendingCount(): Promise<number | null> {
  const supabase = createSupabaseBrowserClient();
  const [documentsCount, jobsCount] = await Promise.all([
    supabase
      .from("provider_documents")
      .select("*", { count: "exact", head: true })
      .in("current_review_status", ["pending", "revision_requested"])
      .is("deleted_at", null),
    supabase
      .from("admin_job_list")
      .select("*", { count: "exact", head: true })
      .eq("moderation_status", "pending_review")
      .is("deleted_at", null),
  ]);
  if (documentsCount.error || jobsCount.error) return null;
  return (documentsCount.count ?? 0) + (jobsCount.count ?? 0);
}
