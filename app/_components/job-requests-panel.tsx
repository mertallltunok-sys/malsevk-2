"use client";

import { CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatJobDate, getJobStatusLabel, getJobStatusTone, isJobDateInPast } from "../_lib/jobs";
import {
  getCompletedOfferForJob,
  getEngagedOfferForJob,
  getJobRequestFilter,
  getJobRequestFilterLabel,
  getJobRequestFilterTone,
  type JobRequestFilter,
} from "../_lib/job-requests";
import { deleteJobWithOffers } from "../_lib/offers";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import type { Job, Offer, Session } from "../_lib/types";
import { AuthGateNotice } from "./auth-gate-notice";
import { JobRatingModal } from "./job-rating-modal";
import { JobRatingWidget } from "./job-rating-widget";
import { OfferOutcomePanel } from "./offer-outcome-panel";
import { StatusBadge } from "./status-badge";

// Yalnızca 3 sekme var — "Tümü" kaldırıldı. "Kabul Edildi" (teklif kabul
// edildi, iş henüz başlamadı) durumu ayrı bir sekme değil: kullanıcı
// açısından ilan artık aktif değil (düzenlenemez/silinemez/yeni teklif
// alamaz), bu yüzden "Devam Eden" sekmesi altında listelenir — yalnızca
// listeleme/görünürlük kararı, rozet metni yine kendi ("Teklif Kabul
// Edildi") etiketiyle kalır (bkz. matchesTab, aşağıda).
type TabKey = "aktif" | "devam-eden" | "tamamlandi";

const TABS: { key: TabKey; label: string }[] = [
  { key: "aktif", label: "Aktif" },
  { key: "devam-eden", label: "Devam Eden" },
  { key: "tamamlandi", label: "Tamamlanan" },
];

const EMPTY_MESSAGES: Record<TabKey, string> = {
  aktif: "Henüz aktif bir hizmet talebiniz bulunmuyor.",
  "devam-eden": "Henüz devam eden bir işiniz bulunmuyor.",
  tamamlandi: "Henüz tamamlanan bir işiniz bulunmuyor.",
};

function tabHref(key: TabKey): string {
  return key === "aktif" ? "/panel/hizmet-taleplerim" : `/panel/hizmet-taleplerim?durum=${key}`;
}

/** "Kabul Edildi" bilerek "Devam Eden" sekmesiyle eşleşir (bkz. yukarıdaki not). */
function matchesTab(filter: JobRequestFilter | null, tab: TabKey): boolean {
  if (tab === "devam-eden") return filter === "devam-eden" || filter === "kabul-edildi";
  return filter === tab;
}

/** Mevcut "Görüşme Sonucu" diyaloglarıyla (offer-outcome-panel.tsx) aynı desen: hafif arka plan, ESC ile kapanma, açılışta odak. */
function DeleteJobDialog({
  jobTitle,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  jobTitle: string;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ilan-sil-baslik"
      tabIndex={-1}
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 focus:outline-none"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-md"
      >
        <h2 id="ilan-sil-baslik" className="text-lg font-semibold text-foreground">
          İlanı Sil
        </h2>
        <p className="mt-2 text-sm font-medium text-foreground">{jobTitle}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Bu ilanı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Siliniyor..." : "Evet, İlanı Sil"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function JobRequestsPanel() {
  const session = useSession();

  if (!session) {
    return (
      <AuthGateNotice
        message="Hizmet taleplerinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/hizmet-taleplerim"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return <AuthGateNotice message="Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir." />;
  }

  return <JobRequestsList session={session} />;
}

function JobRequestsList({ session }: { session: Session }) {
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const searchParams = useSearchParams();
  const rawDurum = searchParams.get("durum");
  const activeTab: TabKey =
    rawDurum === "devam-eden" || rawDurum === "tamamlandi" ? rawDurum : "aktif";
  const justUpdated = searchParams.get("guncellendi") === "1";

  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [justDeleted, setJustDeleted] = useState(false);
  const [ratingModalOffer, setRatingModalOffer] = useState<Offer | null>(null);
  const [justRated, setJustRated] = useState(false);

  function openDeleteDialog(job: Job) {
    setDeleteTarget(job);
    setDeleteError(null);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteJobWithOffers(session, deleteTarget.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleteTarget(null);
    setJustDeleted(true);
  }

  const myEntries = jobs
    .filter((job) => job.requesterId === session.id)
    .map((job) => ({
      job,
      filter: getJobRequestFilter(job, offers),
      engagedOffer: getEngagedOfferForJob(job.id, offers),
      completedOffer: getCompletedOfferForJob(job.id, offers),
    }));

  const visible = myEntries.filter((entry) => matchesTab(entry.filter, activeTab));

  return (
    <div>
      {justUpdated && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          İlan başarıyla güncellendi.
        </p>
      )}

      {justDeleted && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          İlan başarıyla silindi.
        </p>
      )}

      {justRated && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Değerlendirmeniz için teşekkür ederiz.
        </p>
      )}

      <div role="tablist" aria-label="Hizmet talebi durumu" className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              role="tab"
              aria-selected={isActive}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:border-primary/40"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        {visible.length === 0 ? (
          <div className="rounded-card border border-border bg-surface p-8 text-center">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {EMPTY_MESSAGES[activeTab]}
            </p>
            {activeTab === "aktif" && (
              <Link
                href="/hizmet-talebi-olustur"
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                Hizmet Talebi Oluştur
              </Link>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {visible.map(({ job, filter, engagedOffer, completedOffer }) => (
              <li key={job.id} className="rounded-card border border-border bg-surface p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                      {job.category}
                    </span>
                    <h3 className="mt-2 break-words text-lg font-semibold leading-snug text-foreground">
                      {job.title}
                    </h3>
                  </div>
                  <StatusBadge
                    label={filter ? getJobRequestFilterLabel(filter) : getJobStatusLabel(job.status)}
                    tone={filter ? getJobRequestFilterTone(filter) : getJobStatusTone(job.status)}
                  />
                </div>

                <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {job.district}, {job.province}
                  </span>
                  <span className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {formatJobDate(job.workDate)}
                  </span>
                </div>

                {filter !== "tamamlandi" && isJobDateInPast(job.workDate) && (
                  <p className="mt-2 text-xs text-warning">Tarihi güncellemeniz önerilir.</p>
                )}

                {engagedOffer &&
                  (engagedOffer.status === "completion_requested" ||
                    engagedOffer.status === "completion_disputed") && (
                    <OfferOutcomePanel
                      offer={engagedOffer}
                      session={session}
                      onCompleted={(completedOffer) => setRatingModalOffer(completedOffer)}
                    />
                  )}

                {filter === "tamamlandi" && completedOffer && (
                  <JobRatingWidget offer={completedOffer} session={session} />
                )}

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Link
                    href={`/ilanlar/${job.id}`}
                    className="inline-block rounded-sm text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    İlan detayına git
                  </Link>
                  {/* Düzenle/Sil yalnızca "Aktif" ilanlarda gösterilir — iş
                      başladıktan (ya da teklif kabul edildikten) sonra ilan
                      artık değiştirilemez/silinemez (bkz. matchesTab). */}
                  {filter === "aktif" && (
                    <>
                      <Link
                        href={`/panel/hizmet-taleplerim/${job.id}/duzenle`}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      >
                        İlanı Düzenle
                      </Link>
                      <button
                        type="button"
                        onClick={() => openDeleteDialog(job)}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      >
                        İlanı Sil
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleteTarget && (
        <DeleteJobDialog
          jobTitle={deleteTarget.title}
          submitting={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={closeDeleteDialog}
        />
      )}

      {ratingModalOffer && (
        <JobRatingModal
          offer={ratingModalOffer}
          session={session}
          onClose={(submitted) => {
            setRatingModalOffer(null);
            if (submitted) setJustRated(true);
          }}
        />
      )}
    </div>
  );
}
