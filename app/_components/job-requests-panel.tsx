"use client";

import { CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatJobDate, formatJobDateRange, getJobStatusLabel, getJobStatusTone, isJobDateInPast } from "../_lib/jobs";
import { formatJobLocationLine } from "../_lib/job-location";
import {
  getCompletedOfferForJob,
  getEngagedOfferForJob,
  getJobRequestFilter,
  getJobRequestFilterLabel,
  getJobRequestFilterTone,
  isJobEditable,
  isOfferAwaitingCompletionConfirmation,
  isOfferVisibleInNormalLists,
  type JobRequestFilter,
} from "../_lib/job-requests";
import { getJobPublishEndAt, isJobListingExpired } from "../_lib/job-publish-window";
import {
  getJobClosureReasonLabel,
  isJobManuallyClosed,
  JOB_CLOSURE_REASON_OPTIONS,
} from "../_lib/job-closure";
import { republishJob } from "../_lib/job-store";
import { closeJobListing, deleteJobWithOffers } from "../_lib/offers";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import { AUTO_DISMISS_FADE_MS, useAutoDismissBanner } from "../_lib/use-auto-dismiss-banner";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import type { Job, JobClosureReason, Offer, Session } from "../_lib/types";
import { AuthGateNotice } from "./auth-gate-notice";
import { JobRatingModal } from "./job-rating-modal";
import { JobRatingWidget } from "./job-rating-widget";
import { OfferOutcomePanel } from "./offer-outcome-panel";
import { StatusBadge } from "./status-badge";

// "Kabul Edildi" (teklif kabul edildi, iş henüz başlamadı) durumu ayrı bir
// sekme değil: kullanıcı açısından ilan artık aktif değil (düzenlenemez/
// silinemez/yeni teklif alamaz), bu yüzden "Devam Eden" sekmesi altında
// listelenir — yalnızca listeleme/görünürlük kararı, rozet metni yine kendi
// ("Teklif Kabul Edildi") etiketiyle kalır (bkz. matchesTab, aşağıda).
// "suresi-dolmus" — İlan Yayın Süresi Yönetimi: `getJobRequestFilter`in
// KENDİSİ hiç değiştirilmedi (hâlâ yalnızca teklif durumuna bakar) — bu
// yeni sekme, zaten "aktif" olan ilanları AYRICA `isJobListingExpired`e
// (job-publish-window.ts, tek doğruluk kaynağı) göre ikiye böler (bkz.
// matchesTab). Bu yüzden "Aktif" sekmesi de bu değişiklikle DOLAYLI olarak
// güncellendi: artık yalnızca `filter === "aktif"` değil, AYRICA süresi
// dolmamış olmayı da şart koşar.
// "kapatildi" — İlan Kapatma: AYNI desen, yalnızca `isJobListingExpired`
// yerine `job-closure.ts#isJobManuallyClosed` kullanılır. Bir ilan aynı anda
// hem manuel kapatılmış hem de yayın süresi dolmuş olabilir — bu durumda
// "Kapatıldı" öncelikli kabul edilir (Hizmet Alan'ın kendi, bilinçli kararı,
// tarih tabanlı pasif bir sona ermeden daha belirleyicidir), bkz. matchesTab.
type TabKey = "aktif" | "devam-eden" | "tamamlandi" | "suresi-dolmus" | "kapatildi";

const TABS: { key: TabKey; label: string }[] = [
  { key: "aktif", label: "Aktif" },
  { key: "suresi-dolmus", label: "Süresi Dolan İlanlar" },
  { key: "kapatildi", label: "Kapatılan İlanlar" },
  { key: "devam-eden", label: "Devam Eden" },
  { key: "tamamlandi", label: "Tamamlanan" },
];

const EMPTY_MESSAGES: Record<TabKey, string> = {
  aktif: "Henüz aktif bir hizmet talebiniz bulunmuyor.",
  "devam-eden": "Henüz devam eden bir işiniz bulunmuyor.",
  tamamlandi: "Henüz tamamlanan bir işiniz bulunmuyor.",
  "suresi-dolmus": "Süresi dolan ilanınız bulunmuyor.",
  kapatildi: "Kapatılan ilanınız bulunmuyor.",
};

function tabHref(key: TabKey): string {
  return key === "aktif" ? "/panel/hizmet-taleplerim" : `/panel/hizmet-taleplerim?durum=${key}`;
}

/**
 * "Kabul Edildi" bilerek "Devam Eden" sekmesiyle eşleşir (bkz. yukarıdaki
 * not). `isExpired`/`isClosed` yalnızca "aktif" filtresini "Aktif", "Süresi
 * Dolan İlanlar" ve "Kapatılan İlanlar" arasında üçe ayırmak için kullanılır
 * — "Devam Eden"/"Tamamlanan" bu ayrımdan hiç etkilenmez (o durumdaki bir
 * ilan zaten job-publish-window.ts#isJobListingExpired'a/job-closure.ts'e
 * göre ASLA süresi dolmuş/kapatılmış sayılmaz — ikisi de yalnızca hiç
 * "meşgul" teklifi olmayan bir ilanda anlamlıdır). `isClosed` her zaman
 * `isExpired`e göre ÖNCELİKLİDİR — bir ilan hem manuel kapatılmış hem de
 * yayın süresi dolmuş olabilir, bu durumda "Kapatılan İlanlar" gösterilir.
 */
function matchesTab(filter: JobRequestFilter | null, isExpired: boolean, isClosed: boolean, tab: TabKey): boolean {
  if (tab === "devam-eden") return filter === "devam-eden" || filter === "kabul-edildi";
  if (tab === "kapatildi") return filter === "aktif" && isClosed;
  if (tab === "aktif") return filter === "aktif" && !isExpired && !isClosed;
  if (tab === "suresi-dolmus") return filter === "aktif" && isExpired && !isClosed;
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
        <h2 id="ilan-sil-baslik" className="text-lg font-bold tracking-heading leading-tight text-foreground">
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

/**
 * "İlanı Kapat" onay diyaloğu — DeleteJobDialog ile AYNI modal kabuğu
 * (hafif arka plan, ESC/dış tıklama ile kapanma, açılışta odak). Silmeden
 * TAMAMEN AYRI bir işlemdir (bkz. offers.ts#closeJobListing) — yalnızca bir
 * kapatma nedeni (görev gereksinimindeki dört seçenek) seçilmesini zorunlu
 * kılar, RepublishJobDialog'daki AYNI "istemci tarafı alan doğrulaması +
 * asıl yetkilendirme veri katmanında" deseniyle.
 */
function CloseJobDialog({
  jobTitle,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  jobTitle: string;
  submitting: boolean;
  error: string | null;
  onConfirm: (reason: JobClosureReason) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState<JobClosureReason | "">("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleConfirm() {
    if (submitting) return;
    if (!reason) {
      setFieldError("Lütfen bir kapatma nedeni seçin.");
      return;
    }
    setFieldError(null);
    onConfirm(reason);
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ilan-kapat-baslik"
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
        <h2 id="ilan-kapat-baslik" className="text-lg font-bold tracking-heading leading-tight text-foreground">
          İlanı Kapat
        </h2>
        <p className="mt-2 text-sm font-medium text-foreground">{jobTitle}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Bu işlem ilanı yayından kaldıracaktır. Lütfen kapatma nedenini seçin.
        </p>

        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="sr-only">Kapatma nedeni</legend>
          {JOB_CLOSURE_REASON_OPTIONS.map((option) => {
            const checked = reason === option.value;
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm text-foreground transition-colors ${
                  checked ? "border-primary bg-accent-soft" : "border-border bg-background hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="ilan-kapatma-nedeni"
                  value={option.value}
                  checked={checked}
                  onChange={() => {
                    setReason(option.value);
                    setFieldError(null);
                  }}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>

        <p className="mt-4 text-sm font-medium text-danger">Bu işlem geri alınamaz.</p>

        {(fieldError || error) && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {fieldError ?? error}
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
            onClick={handleConfirm}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Kapatılıyor..." : "Evet, İlanı Kapat"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tek bir hizmet talebi kartı — "Bir teklif geri çekildi" bildiriminin
 * (notifications.ts#getJobRequestNotificationHref) `?ilanId=` ile
 * yönlendirdiği kartı vurgulamak/odaklamak için ayrı bir bileşene
 * çıkarıldı; incoming-offer-card.tsx'teki AYNI mevcut vurgulama deseni
 * (ring border + scrollIntoView, prefers-reduced-motion'a saygılı).
 */
function JobRequestCard({
  job,
  filter,
  engagedOffer,
  completedOffer,
  editable,
  session,
  highlighted,
  onOpenDelete,
  onOpenClose,
  onCompleted,
}: {
  job: Job;
  filter: JobRequestFilter | null;
  engagedOffer: Offer | null;
  completedOffer: Offer | null;
  /** bkz. job-requests.ts#isJobEditable — teklif süreci başlamışsa (kabul edilmiş/devam eden/tamamlanmış/iptal edilmiş) false. */
  editable: boolean;
  session: Session;
  highlighted: boolean;
  onOpenDelete: (job: Job) => void;
  onOpenClose: (job: Job) => void;
  onCompleted: (offer: Offer) => void;
}) {
  const cardRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlighted || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [highlighted]);

  return (
    <li
      ref={cardRef}
      className={`rounded-card border bg-surface p-6 transition-colors ${
        highlighted ? "border-primary ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {getCategoryDisplayLabel(job.category)}
          </span>
          <h3 className="mt-2 break-words text-lg font-bold tracking-heading leading-snug text-foreground">
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
          {formatJobLocationLine(job)}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDateRange(job.workDate, job.workEndDate)}
        </span>
      </div>

      {/* Bu panel yalnızca job.requesterId === session.id olan ilanları listeler (bkz. JobRequestsList#myEntries)
          — ilan sahibi olduğu YAPISAL OLARAK garanti; ayrıca bir canViewJobAddress kontrolüne gerek yok.
          neighborhood/locationUrl/directionsNote addressText ile AYNI gizlilik
          kapısını paylaşır (bkz. types.ts#Job), bu yüzden burada da koşulsuz gösterilir. */}
      {job.addressText && (
        <p className="mt-1.5 break-words text-sm text-muted-foreground">
          Açık adres: {job.neighborhood && <>{job.neighborhood}, </>}
          {job.addressText}
          {job.directionsNote && <span className="block text-xs">{job.directionsNote}</span>}
          {job.locationUrl && (
            <a
              href={job.locationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Haritada Görüntüle
            </a>
          )}
        </p>
      )}

      {filter !== "tamamlandi" && isJobDateInPast(job.workDate) && (
        <p className="mt-2 text-xs text-warning">Tarihi güncellemeniz önerilir.</p>
      )}

      {engagedOffer &&
        (engagedOffer.status === "completion_requested" ||
          engagedOffer.status === "completion_disputed") && (
          <OfferOutcomePanel offer={engagedOffer} session={session} onCompleted={onCompleted} />
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
        {/* Düzenle: yalnızca teklif süreci başlamamış ilanlarda (bkz.
            job-requests.ts#isJobEditable) — bu, düzenleme route'unun
            kendisiyle (job-edit-form.tsx) ve veri katmanıyla
            (job-store.ts#updateJob) AYNI kuralı kullanır. */}
        {editable && (
          <Link
            href={`/panel/hizmet-taleplerim/${job.id}/duzenle`}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İlanı Düzenle
          </Link>
        )}
        {/* Kapat: "İlanı Sil"in TAMAMEN ayrı, ayrıca eklenmiş bir eylemi —
            aynı "Aktif" kısıtlamasını paylaşır (bkz. matchesTab: bu bileşen
            "kapatildi" sekmesi için hiç kullanılmaz, bu yüzden buraya
            ulaşan bir ilan zaten kapatılmamıştır). Silme davranışına HİÇ
            dokunmaz (bkz. offers.ts#closeJobListing, deleteJobWithOffers'tan
            bağımsız bir yol). */}
        {filter === "aktif" && (
          <button
            type="button"
            onClick={() => onOpenClose(job)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İlanı Kapat
          </button>
        )}
        {/* Sil: yalnızca "Aktif" ilanlarda gösterilir — bu görevin kapsamı
            dışında, kendi mevcut kısıtlamasıyla (bkz. matchesTab) değişmeden
            kalır. */}
        {filter === "aktif" && (
          <button
            type="button"
            onClick={() => onOpenDelete(job)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İlanı Sil
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * "Süresi Dolan İlanlar" sekmesine ÖZEL kart — İlanları bozmadan/tekrar
 * yazmadan ayrı bir bileşen olarak eklendi: bu kartın alanları (oluşturulma/
 * yayın bitiş tarihi, "Süresi Doldu" durumu, Yeniden Yayınla/Kalıcı Sil
 * aksiyonları) diğer üç sekmedeki `JobRequestCard`da hiç anlamlı değildir —
 * o bileşen bu görevle HİÇ değiştirilmedi. "İlanı Sil" (Kalıcı Olarak Sil)
 * BİLEREK yeni bir dialog AÇMAZ; çağıran (JobRequestsList) mevcut
 * `DeleteJobDialog`ı (yukarıda, değiştirilmedi) hem bu kart hem normal
 * "Aktif" kartı için PAYLAŞIR — silme davranışı (offers.ts#deleteJobWithOffers,
 * "devam eden/kabul edilmiş işi olan ilan silinemez" koruması dahil) HER
 * İKİ çağıran için de birebir aynıdır, yeniden yayınlama bir silme işlemi
 * DEĞİLDİR.
 */
function ExpiredJobRequestCard({
  job,
  visibleOfferCount,
  highlighted,
  onOpenRepublish,
  onOpenDelete,
}: {
  job: Job;
  visibleOfferCount: number;
  highlighted: boolean;
  onOpenRepublish: (job: Job) => void;
  onOpenDelete: (job: Job) => void;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const publishEndAt = getJobPublishEndAt(job);
  const alreadyRepublished = Boolean(job.republishedToJobId);

  useEffect(() => {
    if (!highlighted || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={cardRef}
      className={`rounded-card border bg-surface p-6 transition-colors ${
        highlighted ? "border-primary ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {getCategoryDisplayLabel(job.category)}
          </span>
          <h3 className="mt-2 break-words text-lg font-bold tracking-heading leading-snug text-foreground">{job.title}</h3>
        </div>
        <StatusBadge label="Süresi Doldu" tone="neutral" />
      </div>

      <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobLocationLine(job)}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDateRange(job.workDate, job.workEndDate)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-background px-4 py-3 text-sm sm:grid-cols-3">
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Oluşturulma Tarihi</dt>
          <dd className="font-semibold text-foreground">{job.createdAt ? formatJobDate(job.createdAt) : "-"}</dd>
        </div>
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Yayın Süresi Bitişi</dt>
          <dd className="font-semibold text-foreground">{publishEndAt ? formatJobDate(publishEndAt) : "-"}</dd>
        </div>
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Mevcut Teklif Sayısı</dt>
          <dd className="font-semibold text-foreground">{visibleOfferCount}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link
          href={`/ilanlar/${job.id}`}
          className="inline-block rounded-sm text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İlan detayına git
        </Link>
        {/* Kullanıcı isterse yeniden yayınlamadan önce mevcut ilan bilgilerini
            (başlık/açıklama/lokasyon/fotoğraf) gözden geçirebilsin diye —
            mevcut düzenleme akışı (job-edit-form.tsx) süresi dolmuş bir ilan
            için de zaten çalışır (bkz. job-requests.ts#isJobEditable — teklif
            süreci hiç başlamamış bir ilanı yayın süresi ayrıca kilitlemez). */}
        <Link
          href={`/panel/hizmet-taleplerim/${job.id}/duzenle`}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İlanı İncele / Düzenle
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {alreadyRepublished ? (
          // Aynı eski ilan üzerinden İKİNCİ bir kopya üretilmesin diye
          // (bkz. job-store.ts#republishJob'ın republishedToJobId kontrolü)
          // aksiyon butonları burada TAMAMEN kalkar — yalnızca geçmişin
          // izlenebilir kalması için yeni ilana bir bağlantı gösterilir.
          <p className="text-sm font-medium text-success">
            Yeniden Yayınlandı —{" "}
            <Link
              href={`/ilanlar/${job.republishedToJobId}`}
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
            >
              yeni ilanı görüntüle
            </Link>
          </p>
        ) : (
          <>
            {/* Birincil işlem: Yeniden Yayınla (öne çıkan, dolu buton). */}
            <button
              type="button"
              onClick={() => onOpenRepublish(job)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Yeniden Yayınla
            </button>
            {/* İkincil/pasif durum: kullanıcı hiçbir şey yapmazsa ilan zaten
                burada (arşivde) kalmaya devam eder — ayrıca zorunlu bir
                buton/onay YOKTUR, yalnızca bilgilendirme notu. */}
            <span className="text-xs text-muted-foreground">
              Hiçbir işlem yapılmazsa ilan burada (arşivde) kalmaya devam eder.
            </span>
            {/* Tehlikeli işlem: Kalıcı Olarak Sil — bilerek birincil buton gibi
                ÖNE ÇIKARILMAZ (outline/danger, JobRequestCard'daki "İlanı Sil"
                ile AYNI stil). */}
            <button
              type="button"
              onClick={() => onOpenDelete(job)}
              className="ml-auto inline-flex items-center justify-center gap-2 rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Kalıcı Olarak Sil
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * "Kapatılan İlanlar" sekmesine ÖZEL kart — `ExpiredJobRequestCard` ile AYNI
 * gerekçeyle ayrı bir bileşen: bu kartın alanları (kapatma nedeni/tarihi)
 * diğer sekmelerdeki `JobRequestCard`da hiç anlamlı değildir. `ExpiredJobRequestCard`in
 * aksine Yeniden Yayınla/Kalıcı Sil AKSİYONU YOKTUR — kapatma işlemi görev
 * gereksinimi gereği geri alınamaz ve bu ekranın kapsamı yalnızca "geçmiş
 * kaydı görüntüleme + ilana git"tir (bkz. job-closure.ts, tek doğruluk
 * kaynağı).
 */
function ClosedJobRequestCard({ job, highlighted }: { job: Job; highlighted: boolean }) {
  const cardRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlighted || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={cardRef}
      className={`rounded-card border bg-surface p-6 transition-colors ${
        highlighted ? "border-primary ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {getCategoryDisplayLabel(job.category)}
          </span>
          <h3 className="mt-2 break-words text-lg font-bold tracking-heading leading-snug text-foreground">{job.title}</h3>
        </div>
        <StatusBadge label="Kapatıldı" tone="neutral" />
      </div>

      <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobLocationLine(job)}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDateRange(job.workDate, job.workEndDate)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-background px-4 py-3 text-sm sm:grid-cols-2">
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Kapatılma Tarihi</dt>
          <dd className="font-semibold text-foreground">{job.closedAt ? formatJobDate(job.closedAt) : "-"}</dd>
        </div>
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Kapatma Nedeni</dt>
          <dd className="font-semibold text-foreground">
            {job.closureReason ? getJobClosureReasonLabel(job.closureReason) : "-"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link
          href={`/ilanlar/${job.id}`}
          className="inline-block rounded-sm text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İlan detayına git
        </Link>
      </div>
    </li>
  );
}

/**
 * "Yeniden Yayınla" onay diyaloğu — DeleteJobDialog ile AYNI modal kabuğu
 * (hafif arka plan, ESC/dış tıklama ile kapanma, açılışta odak). Yeni
 * başlangıç/bitiş tarihleri BURADA toplanır (job-store.ts#republishJob'ın
 * zorunlu kıldığı iki alan) — "Başlangıç tarihi geçmiş olamaz"/"Bitiş
 * başlangıçtan önce olamaz" istemci tarafında da (anında geri bildirim
 * için) doğrulanır, ama ASIL yetkilendirme her zaman olduğu gibi veri
 * katmanındadır (republishJob kendi kontrolünü ayrıca yapar).
 */
function RepublishJobDialog({
  job,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  job: Job;
  submitting: boolean;
  error: string | null;
  onConfirm: (workDate: string, workEndDate: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [workDate, setWorkDate] = useState("");
  const [workEndDate, setWorkEndDate] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleConfirm() {
    if (submitting) return;
    if (!workDate || !workEndDate) {
      setFieldError("Yeni başlangıç ve bitiş tarihi zorunludur.");
      return;
    }
    if (isJobDateInPast(workDate)) {
      setFieldError("Başlangıç tarihi geçmiş bir tarih olamaz.");
      return;
    }
    if (new Date(workEndDate).getTime() < new Date(workDate).getTime()) {
      setFieldError("Bitiş tarihi başlangıç tarihinden önce olamaz.");
      return;
    }
    setFieldError(null);
    onConfirm(workDate, workEndDate);
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ilan-yeniden-yayinla-baslik"
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
        <h2 id="ilan-yeniden-yayinla-baslik" className="text-lg font-bold tracking-heading leading-tight text-foreground">
          İlanı Yeniden Yayınla
        </h2>
        <p className="mt-2 text-sm font-medium text-foreground">{job.title}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Bu ilan yeni yayın tarihleriyle tekrar oluşturulacaktır. Eski ilan, teklifler ve geçmiş kayıtları
          korunacaktır.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="republish-work-date" className="text-sm font-medium text-foreground">
              Yeni Başlangıç Tarihi
            </label>
            <input
              id="republish-work-date"
              type="date"
              min={todayIso}
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div>
            <label htmlFor="republish-work-end-date" className="text-sm font-medium text-foreground">
              Yeni Bitiş Tarihi
            </label>
            <input
              id="republish-work-end-date"
              type="date"
              min={workDate || todayIso}
              value={workEndDate}
              onChange={(event) => setWorkEndDate(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        {(fieldError || error) && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {fieldError ?? error}
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
            onClick={handleConfirm}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Yayınlanıyor..." : "Yeniden Yayınla"}
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
    rawDurum === "devam-eden" || rawDurum === "tamamlandi" || rawDurum === "suresi-dolmus" || rawDurum === "kapatildi"
      ? rawDurum
      : "aktif";
  const justUpdated = searchParams.get("guncellendi") === "1";
  const highlightJobId = searchParams.get("ilanId");
  // Çoklu Hizmet Operasyonu — Aşama 2: birden fazla hizmet ilanı birlikte
  // oluşturulduğunda job-request-form.tsx buraya bu query param'la
  // yönlendirir (bkz. o dosyadaki handleSubmit) — "guncellendi=1" ile AYNI
  // desen (statik, süre tabanlı otomatik kaybolma yok), yalnızca ilan sayısı
  // da mesaja yazılabilsin diye bir sayı taşır. Tek ilan oluşturmada bu hiç
  // set edilmez (mevcut `/ilanlar/[id]` yönlendirmesi değişmedi).
  const operationJobCountParam = searchParams.get("operasyonIlanSayisi");
  const operationJobCount = operationJobCountParam ? Number.parseInt(operationJobCountParam, 10) : null;
  const justCreatedOperation =
    operationJobCount !== null && Number.isInteger(operationJobCount) && operationJobCount >= 2;

  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletedBanner = useAutoDismissBanner();
  const [ratingModalOffer, setRatingModalOffer] = useState<Offer | null>(null);
  const justRatedBanner = useAutoDismissBanner();
  // İlan Yayın Süresi Yönetimi: "Kalıcı Olarak Sil" bu AYNI `deleteTarget`/
  // `DeleteJobDialog` çiftini "Süresi Dolan İlanlar" kartından da kullanır —
  // yeni/ayrı bir silme dialogu YOKTUR, silme davranışı (offers.ts#
  // deleteJobWithOffers, aynı korumalarla) her iki çağıran için birebir
  // aynıdır (bkz. openDeleteDialog/handleConfirmDelete, değiştirilmedi).
  const [republishTarget, setRepublishTarget] = useState<Job | null>(null);
  const [republishing, setRepublishing] = useState(false);
  const [republishError, setRepublishError] = useState<string | null>(null);
  const republishedBanner = useAutoDismissBanner();
  // İlan Kapatma: "İlanı Sil"in yanına eklenen, TAMAMEN ayrı bir işlem —
  // kendi hedef/durum/hata state'ini ve kendi CloseJobDialog'unu taşır,
  // deleteTarget/DeleteJobDialog ile hiç paylaşılmaz (silme davranışı bu
  // görevle hiç değişmedi).
  const [closeTarget, setCloseTarget] = useState<Job | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closedBanner = useAutoDismissBanner();

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
    deletedBanner.trigger();
  }

  function openCloseDialog(job: Job) {
    setCloseTarget(job);
    setCloseError(null);
  }

  function closeCloseDialog() {
    if (closing) return;
    setCloseTarget(null);
    setCloseError(null);
  }

  async function handleConfirmClose(reason: JobClosureReason) {
    if (!closeTarget || closing) return;
    setClosing(true);
    setCloseError(null);
    const result = await closeJobListing(session, closeTarget.id, reason);
    setClosing(false);
    if (!result.ok) {
      setCloseError(result.error);
      return;
    }
    setCloseTarget(null);
    closedBanner.trigger();
  }

  function openRepublishDialog(job: Job) {
    setRepublishTarget(job);
    setRepublishError(null);
  }

  function closeRepublishDialog() {
    if (republishing) return;
    setRepublishTarget(null);
    setRepublishError(null);
  }

  async function handleConfirmRepublish(workDate: string, workEndDate: string) {
    if (!republishTarget || republishing) return;
    setRepublishing(true);
    setRepublishError(null);
    const result = await republishJob(session, republishTarget.id, offers, { workDate, workEndDate });
    setRepublishing(false);
    if (!result.ok) {
      setRepublishError(result.error);
      return;
    }
    setRepublishTarget(null);
    republishedBanner.trigger();
  }

  const myEntries = jobs
    .filter((job) => job.requesterId === session.id)
    .map((job) => ({
      job,
      filter: getJobRequestFilter(job, offers),
      engagedOffer: getEngagedOfferForJob(job.id, offers),
      completedOffer: getCompletedOfferForJob(job.id, offers),
      editable: isJobEditable(job.id, offers),
      isExpired: isJobListingExpired(job, offers),
      isClosed: isJobManuallyClosed(job),
      visibleOfferCount: offers.filter((offer) => offer.jobId === job.id && isOfferVisibleInNormalLists(offer))
        .length,
    }));

  const tabEntries = myEntries.filter((entry) => matchesTab(entry.filter, entry.isExpired, entry.isClosed, activeTab));
  // "Devam Eden" sekmesine ÖZEL bir sıralama: tamamlanma onayı bekleyen
  // (completion_requested) işler en üstte gösterilir — bkz.
  // job-requests.ts#isOfferAwaitingCompletionConfirmation (tek ortak
  // doğruluk kaynağı). `Array.prototype.sort` ES2019+ itibarıyla stabildir,
  // bu yüzden AYNI ağırlıktaki (ikisi de bekliyor ya da ikisi de beklemiyor)
  // girişler arasında sıralama SADECE mevcut (yukarıdaki `myEntries`/
  // `useAllJobs()` sırasından gelen) sırayı korur — ayrı bir tarih
  // karşılaştırması İCAT EDİLMEZ. Diğer sekmeler (Aktif/Tamamlanan) bu
  // sıralamadan hiç etkilenmez.
  const visible =
    activeTab === "devam-eden"
      ? [...tabEntries].sort((a, b) => {
          const aWeight = isOfferAwaitingCompletionConfirmation(a.engagedOffer) ? 0 : 1;
          const bWeight = isOfferAwaitingCompletionConfirmation(b.engagedOffer) ? 0 : 1;
          return aWeight - bWeight;
        })
      : tabEntries;

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

      {justCreatedOperation && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {operationJobCount} hizmet ilanı başarıyla oluşturuldu.
        </p>
      )}

      {deletedBanner.visible && (
        <p
          role="status"
          aria-live="polite"
          style={{
            transitionDuration: `${AUTO_DISMISS_FADE_MS}ms`,
            opacity: deletedBanner.fadingOut ? 0 : 1,
          }}
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success transition-opacity ease-out motion-reduce:transition-none"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          İlan başarıyla silindi.
        </p>
      )}

      {justRatedBanner.visible && (
        <p
          role="status"
          aria-live="polite"
          style={{
            transitionDuration: `${AUTO_DISMISS_FADE_MS}ms`,
            opacity: justRatedBanner.fadingOut ? 0 : 1,
          }}
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success transition-opacity ease-out motion-reduce:transition-none"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Değerlendirmeniz için teşekkür ederiz.
        </p>
      )}

      {republishedBanner.visible && (
        <p
          role="status"
          aria-live="polite"
          style={{
            transitionDuration: `${AUTO_DISMISS_FADE_MS}ms`,
            opacity: republishedBanner.fadingOut ? 0 : 1,
          }}
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success transition-opacity ease-out motion-reduce:transition-none"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          İlan başarıyla yeniden yayınlandı.
        </p>
      )}

      {closedBanner.visible && (
        <p
          role="status"
          aria-live="polite"
          style={{
            transitionDuration: `${AUTO_DISMISS_FADE_MS}ms`,
            opacity: closedBanner.fadingOut ? 0 : 1,
          }}
          className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success transition-opacity ease-out motion-reduce:transition-none"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          İlan başarıyla kapatıldı.
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
        ) : activeTab === "suresi-dolmus" ? (
          <ul className="flex flex-col gap-4">
            {visible.map(({ job, visibleOfferCount }) => (
              <ExpiredJobRequestCard
                key={job.id}
                job={job}
                visibleOfferCount={visibleOfferCount}
                highlighted={job.id === highlightJobId}
                onOpenRepublish={openRepublishDialog}
                onOpenDelete={openDeleteDialog}
              />
            ))}
          </ul>
        ) : activeTab === "kapatildi" ? (
          <ul className="flex flex-col gap-4">
            {visible.map(({ job }) => (
              <ClosedJobRequestCard key={job.id} job={job} highlighted={job.id === highlightJobId} />
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-4">
            {visible.map(({ job, filter, engagedOffer, completedOffer, editable }) => (
              <JobRequestCard
                key={job.id}
                job={job}
                filter={filter}
                engagedOffer={engagedOffer}
                completedOffer={completedOffer}
                editable={editable}
                session={session}
                highlighted={job.id === highlightJobId}
                onOpenDelete={openDeleteDialog}
                onOpenClose={openCloseDialog}
                onCompleted={(completedOffer) => setRatingModalOffer(completedOffer)}
              />
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

      {closeTarget && (
        <CloseJobDialog
          jobTitle={closeTarget.title}
          submitting={closing}
          error={closeError}
          onConfirm={handleConfirmClose}
          onCancel={closeCloseDialog}
        />
      )}

      {republishTarget && (
        <RepublishJobDialog
          job={republishTarget}
          submitting={republishing}
          error={republishError}
          onConfirm={handleConfirmRepublish}
          onCancel={closeRepublishDialog}
        />
      )}

      {ratingModalOffer && (
        <JobRatingModal
          offer={ratingModalOffer}
          session={session}
          onClose={(submitted) => {
            setRatingModalOffer(null);
            if (submitted) justRatedBanner.trigger();
          }}
        />
      )}
    </div>
  );
}
