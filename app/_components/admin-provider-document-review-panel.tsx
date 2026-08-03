"use client";

import { Check, Download, Loader2, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatFileSize } from "../_lib/photo-validation";
import { getPhotoBlob } from "../_lib/photo-blob-store";
import {
  CUSTOMS_LICENSE_STATEMENT_ID,
  getProviderDocumentConsent,
  type StoredProviderDocumentConsent,
} from "../_lib/provider-document-consents";
import { recordProviderDocumentReview } from "../_lib/provider-document-reviews";
import {
  CUSTOMS_LICENSE_DOCUMENT_TYPE,
  getAllProviderDocuments,
  type StoredProviderDocument,
} from "../_lib/provider-documents";
import { getProviderServiceCategoryIds } from "../_lib/provider-services";
import { getServiceCategoryLabel } from "../_lib/service-catalog";
import { useAllContactMessages } from "../_lib/use-contact-messages";
import { useSession } from "../_lib/use-session";
import { getAllUsers, type StoredUser } from "../_lib/users";
import { AdminNav } from "./admin-nav";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

type ReviewStatus = StoredProviderDocument["reviewStatus"];

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "İnceleniyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  revision_requested: "Yeniden Belge Gerekli",
};

const STATUS_TONE: Record<ReviewStatus, "success" | "warning" | "neutral" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  revision_requested: "neutral",
};

function DocumentRow({ document, onReviewed }: { document: StoredProviderDocument; onReviewed: () => void }) {
  const session = useSession();
  const [pendingAction, setPendingAction] = useState<"rejected" | "revision_requested" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await getPhotoBlob(document.indexedDbStorageKey);
      if (!blob) {
        setActionError("Belge dosyası bulunamadı.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.originalFileName;
      link.target = "_blank";
      link.rel = "noopener";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      // Nesne URL'sini hemen iptal etmek, yeni sekmede/indirmede henüz
      // yüklenmekte olan içeriği kırabilir — kısa bir gecikmeyle bırakılır.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally {
      setDownloading(false);
    }
  }

  async function submitReview(status: "approved" | "rejected" | "revision_requested", reviewNote?: string) {
    setSubmitting(true);
    setActionError(null);
    const result = recordProviderDocumentReview(session, { documentId: document.id, status, note: reviewNote });
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setPendingAction(null);
    setNote("");
    onReviewed();
  }

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground" title={document.originalFileName}>
            {document.originalFileName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatFileSize(document.size)} · {document.extension.toUpperCase()} · Yüklenme:{" "}
            {new Date(document.uploadedAt).toLocaleDateString("tr-TR")}
          </p>
          {document.reviewNote && (
            <p className="mt-1 text-xs text-muted-foreground">Not: {document.reviewNote}</p>
          )}
        </div>
        <StatusBadge label={STATUS_LABEL[document.reviewStatus]} tone={STATUS_TONE[document.reviewStatus]} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Görüntüle / İndir
        </button>

        <button
          type="button"
          onClick={() => void submitReview("approved")}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-3 py-1.5 text-xs font-medium text-success transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Onayla
        </button>

        <button
          type="button"
          onClick={() => setPendingAction(pendingAction === "rejected" ? null : "rejected")}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Reddet
        </button>

        <button
          type="button"
          onClick={() => setPendingAction(pendingAction === "revision_requested" ? null : "revision_requested")}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Yeniden Belge İste
        </button>
      </div>

      {pendingAction && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <label className="text-xs font-medium text-foreground">
            {pendingAction === "rejected" ? "Reddetme açıklaması (zorunlu)" : "Yeniden belge isteme açıklaması (zorunlu)"}
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="Açıklama girin..."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitReview(pendingAction, note)}
              disabled={submitting || note.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Gönder
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingAction(null);
                setNote("");
              }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="mt-2 text-xs text-danger">{actionError}</p>}
    </div>
  );
}

function ProviderReviewCard({
  user,
  documents,
  consent,
  onReviewed,
}: {
  user: StoredUser;
  documents: StoredProviderDocument[];
  consent: StoredProviderDocumentConsent | null;
  onReviewed: () => void;
}) {
  const serviceLabels = getProviderServiceCategoryIds(user.id)
    .map((id) => getServiceCategoryLabel(id))
    .filter((label): label is string => Boolean(label));

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold tracking-heading leading-tight text-foreground">{user.name}</p>
          <p className="text-sm text-muted-foreground">
            {user.companyName ?? user.providerProfile?.companyName ?? "Firma adı belirtilmemiş"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {user.email} · {user.phone}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {consent ? (
            <p>
              Beyan kabul edildi: {new Date(consent.acceptedAt).toLocaleDateString("tr-TR")} (v
              {consent.statementVersion})
            </p>
          ) : (
            <p className="text-danger">Belge doğruluk beyanı bulunamadı</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Seçilen Hizmetler</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {serviceLabels.length === 0 ? (
            <span className="text-xs text-muted-foreground">Hizmet seçilmemiş.</span>
          ) : (
            serviceLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground"
              >
                {label}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {documents.map((document) => (
          <DocumentRow key={document.id} document={document} onReviewed={onReviewed} />
        ))}
      </div>
    </div>
  );
}

/**
 * Admin > Hizmet Veren Belge Kontrolü — app/admin sayfasının tek içerik
 * bileşeni. Bu ekran, getAllProviderDocuments/getAllUsers gibi doğrudan
 * localStorage okuyan fonksiyonları kullanır (jobs/offers'ın aksine bu
 * tablolar için henüz bir useSyncExternalStore hook'u yok — tek tüketicisi
 * bu ekran olduğu için, jobs.ts/offers.ts ölçeğinde paylaşılan bir
 * reaktiflik altyapısı kurmak gereksiz bir soyutlama olurdu) — bir inceleme
 * eylemi sonrası `refreshKey`i artırarak listeyi yeniden okur.
 */
export function AdminProviderDocumentReviewPanel() {
  const session = useSession();
  const [refreshKey, setRefreshKey] = useState(0);
  // Yalnızca AdminNav'daki "Bize Ulaşın" sekmesinin rozet sayısı için —
  // bu ekranın kendi içeriğiyle ilgisi yok (bkz. contact-messages-admin-panel.tsx).
  const contactMessages = useAllContactMessages();
  const newContactMessageCount = useMemo(
    () => contactMessages.filter((message) => message.status === "yeni").length,
    [contactMessages],
  );

  const groups = useMemo(() => {
    if (!session || session.role !== "admin") return [];
    const allDocuments = getAllProviderDocuments();
    const providerUsers = getAllUsers().filter((user) => user.role === "hizmet-veren");
    return providerUsers
      .map((user) => ({
        user,
        // Gümrük Müşaviri İzin Belgesi kendi AYRI bölümünde gösterilir (bkz.
        // aşağıdaki `customsGroups`) — burada TEKRAR listelenmez.
        documents: allDocuments.filter((doc) => doc.userId === user.id && doc.documentType !== CUSTOMS_LICENSE_DOCUMENT_TYPE),
        consent: getProviderDocumentConsent(user.id),
      }))
      .filter((group) => group.documents.length > 0)
      .sort((a, b) => {
        const aLatest = a.documents.reduce((max, doc) => (doc.uploadedAt > max ? doc.uploadedAt : max), "");
        const bLatest = b.documents.reduce((max, doc) => (doc.uploadedAt > max ? doc.uploadedAt : max), "");
        return bLatest.localeCompare(aLatest);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshKey]);

  // Gümrük Müşavirliği Belgeleri — yukarıdaki genel Faaliyet Belgesi
  // bölümünden AYRI bir bölüm (görev gereksinimi). Aynı `ProviderReviewCard`/
  // `DocumentRow` bileşenleri yeniden kullanılır (merkezi mimari, ikinci bir
  // inceleme UI'ı İCAT EDİLMEZ) — yalnızca belge kümesi ve beyan (bu belgeye
  // özel "Yüklediğim belge bana aittir ve günceldir." kaydı, bkz.
  // CUSTOMS_LICENSE_STATEMENT_ID) farklıdır.
  const customsGroups = useMemo(() => {
    if (!session || session.role !== "admin") return [];
    const allDocuments = getAllProviderDocuments();
    const providerUsers = getAllUsers().filter((user) => user.role === "hizmet-veren");
    return providerUsers
      .map((user) => ({
        user,
        documents: allDocuments.filter((doc) => doc.userId === user.id && doc.documentType === CUSTOMS_LICENSE_DOCUMENT_TYPE),
        consent: getProviderDocumentConsent(user.id, CUSTOMS_LICENSE_STATEMENT_ID),
      }))
      .filter((group) => group.documents.length > 0)
      .sort((a, b) => {
        const aLatest = a.documents.reduce((max, doc) => (doc.uploadedAt > max ? doc.uploadedAt : max), "");
        const bLatest = b.documents.reduce((max, doc) => (doc.uploadedAt > max ? doc.uploadedAt : max), "");
        return bLatest.localeCompare(aLatest);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshKey]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin" />;
  }
  if (session.role !== "admin") {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }

  return (
    <div>
      <AdminNav newContactMessageCount={newContactMessageCount} />

      <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">Hizmet Veren Belge Kontrolü</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Hizmet Veren hesaplarının yüklediği faaliyet belgelerini inceleyin, onaylayın veya reddedin.
      </p>

      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Henüz incelenecek belge bulunmuyor.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((group) => (
            <ProviderReviewCard
              key={group.user.id}
              user={group.user}
              documents={group.documents}
              consent={group.consent}
              onReviewed={() => setRefreshKey((value) => value + 1)}
            />
          ))}
        </div>
      )}

      <h2 className="mt-10 text-2xl font-bold tracking-heading leading-tight text-foreground">
        Gümrük Müşavirliği Belgeleri
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Gümrük Müşavirliği hizmeti seçen Hizmet Veren hesaplarının Gümrük Müşaviri İzin Belgesini inceleyin,
        onaylayın veya reddedin — onay, ilgili hesabın teklif verme yetkisini otomatik olarak açar.
      </p>

      {customsGroups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Henüz incelenecek Gümrük Müşaviri İzin Belgesi bulunmuyor.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {customsGroups.map((group) => (
            <ProviderReviewCard
              key={group.user.id}
              user={group.user}
              documents={group.documents}
              consent={group.consent}
              onReviewed={() => setRefreshKey((value) => value + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
