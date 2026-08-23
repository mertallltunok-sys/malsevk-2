"use client";

import { Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPhotoBlob } from "../_lib/photo-blob-store";
import { formatFileSize } from "../_lib/photo-validation";
import { getProviderDocumentTypeLabel } from "../_lib/provider-documents";
import { getProviderAuthorizationGroupByDocumentType, getServiceCategoryLabel } from "../_lib/service-catalog";
import {
  listMyProviderDocumentsRemote,
  type RemoteProviderDocument,
  type RemoteProviderDocumentReviewStatus,
} from "../_lib/supabase-provider-document-review";
import { uploadAndRegisterProviderDocument } from "../_lib/supabase-provider-documents";
import { ProviderDocumentUpload, type ReadyProviderDocument } from "./provider-document-upload";
import { StatusBadge } from "./status-badge";

const STATUS_LABEL: Record<RemoteProviderDocumentReviewStatus, string> = {
  pending: "İnceleniyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  revision_requested: "Yeniden Belge Gerekli",
  // 0024 (belge yaşam döngüsü): bu sağlayıcının AYNI türde YENİ bir belgesi
  // onaylandığı için artık geçerli olmayan, ama tarihçe olarak korunan eski
  // bir onaylı belge — silinmez, yalnızca burada "geçmiş" olarak görünür.
  superseded: "Yenisiyle Değiştirildi",
};

const STATUS_TONE: Record<RemoteProviderDocumentReviewStatus, "success" | "warning" | "neutral" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  revision_requested: "neutral",
  superseded: "neutral",
};


function ReplacementUpload({
  documentType,
  serviceCategoryId,
  onUploaded,
  onCancel,
}: {
  documentType: RemoteProviderDocument["documentType"];
  /** Değiştirilen belgenin bağlı olduğu hizmet — yeni (replacement) belgeye de AYNEN taşınır, aksi halde per-service bağ kaybolur (bkz. modülün üstündeki dokümantasyon). */
  serviceCategoryId: string | null;
  onUploaded: () => void;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState<ReadyProviderDocument[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const document = ready[0];
    if (!document) return;
    setSubmitting(true);
    setError(null);
    const blob = await getPhotoBlob(document.indexedDbStorageKey);
    if (!blob) {
      setSubmitting(false);
      setError("Belge dosyası okunamadı. Lütfen tekrar yükleyin.");
      return;
    }
    const result = await uploadAndRegisterProviderDocument({
      blob,
      extension: document.extension,
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
      sizeBytes: document.size,
      documentType,
      serviceCategoryId: serviceCategoryId ?? undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onUploaded();
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-surface p-3">
      <p className="text-xs font-medium text-foreground">Yeni belge yükleyin</p>
      <div className="mt-2">
        <ProviderDocumentUpload maxFiles={1} onDocumentsChange={setReady} />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={ready.length === 0 || submitting}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Belgeyi Gönder
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-muted-foreground hover:text-foreground">
          İptal
        </button>
      </div>
    </div>
  );
}

/**
 * Hesap Ayarları'na eklenen yeni bölüm — `notifications.ts#getProviderDocumentReviewNotifications`'ın
 * reddedilen/yeniden belge istenen bir belge için ZATEN "/panel/hesap-ayarlari"ya
 * yönlendirdiği (ama o zamana kadar orada hiçbir belge bölümü olmadığı için
 * çıkmaz sokak olan) bildirim linkini gerçek bir hedefe kavuşturur. Yalnızca
 * gerçek Supabase `provider_documents` satırlarını gösterir — kayıt sırasında
 * yüklenen belgeler zaten `complete-registration.ts` ile buraya yazılmıştı
 * (dual-write); bu bileşen o satırları OKUR, yeni bir yerel tablo icat etmez.
 * Reddedilen/yeniden belge istenen bir satır için "Yeni Belge Yükle" bir
 * REPLACEMENT satırı ekler (`create_provider_document`, 0023) — eski satır
 * kendi geçmişiyle birlikte `rejected`/`revision_requested` olarak kalır,
 * silinmez/üzerine yazılmaz (provider_documents'ta böyle bir "yerine koy"
 * RPC'si yok, bkz. 0023'ün kendi "KAPSAM DIŞI" notu).
 */
export function ProviderDocumentStatusList() {
  const [documents, setDocuments] = useState<RemoteProviderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void listMyProviderDocumentsRemote().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setDocuments(result.documents);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Belgelerim</h2>
        <p className="mt-2 text-sm text-muted-foreground">Yükleniyor...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Belgelerim</h2>
        <p className="mt-2 text-sm text-danger">{loadError}</p>
      </div>
    );
  }

  if (documents.length === 0) return null;

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Belgelerim</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Yüklediğiniz Faaliyet Belgesi/Raporu ve Gümrük Müşaviri İzin Belgesi&apos;nin inceleme durumu.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {documents.map((document) => {
          const canReplace = document.currentReviewStatus === "rejected" || document.currentReviewStatus === "revision_requested";
          return (
            <div key={document.id} className="rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" title={document.originalFileName}>
                    {document.originalFileName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatFileSize(document.sizeBytes)} · {document.extension.toUpperCase()} ·{" "}
                    {getProviderDocumentTypeLabel(document.documentType)}
                    {document.serviceCategoryId
                      ? ` · ${getServiceCategoryLabel(document.serviceCategoryId) ?? document.serviceCategoryId}`
                      : (getProviderAuthorizationGroupByDocumentType(document.documentType) ? ` · ${getProviderAuthorizationGroupByDocumentType(document.documentType)!.label}` : "")}
                  </p>
                  {document.currentReviewNote && (
                    <p className="mt-1 text-xs text-muted-foreground">Not: {document.currentReviewNote}</p>
                  )}
                </div>
                <StatusBadge label={STATUS_LABEL[document.currentReviewStatus]} tone={STATUS_TONE[document.currentReviewStatus]} />
              </div>

              {canReplace &&
                (replacingId === document.id ? (
                  <ReplacementUpload
                    documentType={document.documentType}
                    serviceCategoryId={document.serviceCategoryId}
                    onUploaded={() => {
                      setReplacingId(null);
                      refresh();
                    }}
                    onCancel={() => setReplacingId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplacingId(document.id)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Yeni Belge Yükle
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
