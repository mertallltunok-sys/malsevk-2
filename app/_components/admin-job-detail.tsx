"use client";

import { Ban, Loader2, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, getJobDetailForAdmin, unpublishJobAsAdmin, type AdminJobDetail } from "../_lib/admin-jobs";
import { JOB_CLOSURE_REASON_OPTIONS, getJobClosureReasonLabel, isJobClosureReason } from "../_lib/job-closure";
import type { JobClosureReason } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const OFFER_STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  accepted: "Kabul Edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri Çekildi",
  in_progress: "Devam Ediyor",
  agreement_failed: "Anlaşma Sağlanamadı",
  completion_requested: "Tamamlama Onayı Bekliyor",
  completion_disputed: "İtiraz Sürecinde",
  completed: "Tamamlandı",
  cancelled: "İptal Edildi",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function AdminJobDetail({ jobId }: { jobId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<AdminJobDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState<JobClosureReason>("hizmete-ihtiyac-kalmadi");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getJobDetailForAdmin(jobId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result) {
        setNotFound(true);
        return;
      }
      setJob(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, jobId, refreshKey]);

  async function handleUnpublish() {
    setSubmitting(true);
    setActionError(null);
    const result = await unpublishJobAsAdmin(jobId, unpublishReason);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setUnpublishOpen(false);
    setUnpublishReason("hizmete-ihtiyac-kalmadi");
    refresh();
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/ilanlar/${jobId}`} />;
  }
  if (!isAdmin) {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Yükleniyor...
      </div>
    );
  }
  if (notFound || !job) {
    return <p className="text-sm text-muted-foreground">İlan bulunamadı.</p>;
  }

  const canUnpublish = job.closedAt === null && job.status !== "tamamlandi" && job.status !== "devam_ediyor";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">{job.title}</h2>
            <p className="text-sm text-muted-foreground">{job.categoryLabel}</p>
          </div>
          <StatusBadge label={JOB_STATUS_LABEL[job.status]} tone={JOB_STATUS_TONE[job.status]} />
        </div>

        {job.photos.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {job.photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={photo.url}
                alt={photo.originalFileName}
                className="h-24 w-24 rounded-md border border-border object-cover"
              />
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="İl / İlçe" value={`${job.province} / ${job.district}`} />
          <InfoRow label="Bölge / Tesis" value={job.workLocationType || "—"} />
          <InfoRow label="Adres" value={job.addressText || "—"} />
          <InfoRow label="İş Tarihi" value={job.workEndDate ? `${job.workDate} – ${job.workEndDate}` : job.workDate} />
          {job.productQuantity !== null && <InfoRow label="Ürün Adedi" value={String(job.productQuantity)} />}
          {job.productTonnage !== null && <InfoRow label="Tonaj" value={`${job.productTonnage} ton`} />}
          {job.productType !== null && <InfoRow label="Ürün Cinsi" value={job.productType} />}
          {job.customsProductType !== null && <InfoRow label="Gümrük Ürün Cinsi" value={job.customsProductType} />}
          <InfoRow label="Oluşturulma Tarihi" value={new Date(job.createdAt).toLocaleString("tr-TR")} />
          <InfoRow label="Yayın Bitiş Tarihi" value={new Date(job.publishEndAt).toLocaleString("tr-TR")} />
          {job.closedAt && <InfoRow label="Kapatılma Tarihi" value={new Date(job.closedAt).toLocaleString("tr-TR")} />}
          {job.closureReason && (
            <InfoRow label="Kapatılma Nedeni" value={isJobClosureReason(job.closureReason) ? getJobClosureReasonLabel(job.closureReason) : job.closureReason} />
          )}
        </div>

        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Açıklama</p>
          <p className="mt-1 text-sm text-foreground">{job.description}</p>
        </div>
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Hizmet Bilgileri / Operasyon Detayı</p>
          <p className="mt-1 text-sm text-foreground">{job.operationDetails}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              setUnpublishOpen((value) => !value);
              setActionError(null);
            }}
            disabled={submitting || !canUnpublish}
            title={!canUnpublish ? "Bu ilan zaten kapalı ya da devam eden/tamamlanmış bir işi olduğu için kapatılamaz." : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Yayından Kaldır
          </button>
          <button
            type="button"
            disabled
            title="Bu işlem için gerekli admin RPC'si (republish_job_as_admin) bu fazda henüz eklenmedi — bkz. proje raporu, sonraki faz önerileri."
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Yeniden Yayınla
          </button>
          <button
            type="button"
            disabled
            title="Şemada 'kapatma'dan ayrı bir 'pasife alma' durumu yok — bu işlem için gerekli backend altyapısı bu fazda henüz eklenmedi, bkz. proje raporu."
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Pasife Al
          </button>
        </div>

        {unpublishOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="admin-job-unpublish-reason">
              Yayından kaldırma nedeni
            </label>
            <select
              id="admin-job-unpublish-reason"
              value={unpublishReason}
              onChange={(event) => setUnpublishReason(event.target.value as JobClosureReason)}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {JOB_CLOSURE_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleUnpublish()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Gönder
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnpublishOpen(false);
                  setUnpublishReason("hizmete-ihtiyac-kalmadi");
                }}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Firma Bilgisi</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Firma Adı" value={job.companyName ?? "—"} />
          <InfoRow label="Yetkili Kişi" value={job.requesterFullName ?? "—"} />
          <InfoRow label="Telefon" value={job.requesterPhone ?? "—"} />
        </div>
      </div>

      {job.operationId && (
        <div className="rounded-card border border-border bg-surface p-6">
          <h3 className="text-base font-bold tracking-heading text-foreground">Operasyon Bağlantısı</h3>
          {job.siblings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Bu operasyonun başka aktif hizmet kalemi yok.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {job.siblings.map((sibling) => (
                <li key={sibling.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{sibling.title}</p>
                    <p className="text-xs text-muted-foreground">{sibling.categoryLabel}</p>
                  </div>
                  <Link href={`/admin/ilanlar/${sibling.id}`} className="text-xs font-medium text-accent underline underline-offset-2">
                    Detay
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Gelen Teklifler</h3>
        {job.offers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Bu ilana henüz teklif verilmemiş.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {job.offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{offer.providerCompanyName ?? offer.providerFullName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {offer.amount.toLocaleString("tr-TR")} {offer.currency} · {new Date(offer.createdAt).toLocaleDateString("tr-TR")}
                  </p>
                </div>
                <StatusBadge label={OFFER_STATUS_LABEL[offer.status] ?? offer.status} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
