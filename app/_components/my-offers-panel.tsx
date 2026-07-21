"use client";

import { CalendarDays, Clock, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getRevealedContactForOffer } from "../_lib/contact-access";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOffersByProvider, getOfferStatusLabel, getOfferStatusTone, requestCompletion } from "../_lib/offers";
import type { Offer } from "../_lib/types";
import { useAllJobs } from "../_lib/use-jobs";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { ContactInfoBlock } from "./contact-info-block";
import { StatusBadge } from "./status-badge";

const DESCRIPTION_PREVIEW_LENGTH = 140;

/** Mevcut "Görüşme Sonucu" diyaloglarıyla (offer-outcome-panel.tsx) aynı desen. */
function RequestCompletionDialog({
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
      aria-labelledby="tamamlandi-isaretle-baslik"
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
        <h2 id="tamamlandi-isaretle-baslik" className="text-lg font-semibold text-foreground">
          Tamamlandı Olarak İşaretle
        </h2>
        <p className="mt-2 text-sm font-medium text-foreground">{jobTitle}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          İşin tamamlandığını Hizmet Alan&apos;a bildirmek istediğinize emin misiniz? Hizmet Alan
          onayladığında iş tamamlanmış sayılacaktır.
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
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "İşleniyor..." : "Evet, Tamamlandı Olarak İşaretle"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyOffersPanel() {
  const session = useSession();
  const jobs = useAllJobs();
  const jobById = new Map(jobs.map((job) => [job.id, job]));

  const [completionTarget, setCompletionTarget] = useState<Offer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  if (!session) {
    return (
      <AuthGateNotice
        message="Tekliflerinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/tekliflerim"
      />
    );
  }

  if (session.role !== "hizmet-veren") {
    return (
      <AuthGateNotice message="Bu sayfa yalnızca Hizmet Veren kullanıcılar içindir." />
    );
  }

  function openCompletionDialog(offer: Offer) {
    setCompletionTarget(offer);
    setCompletionError(null);
  }

  function closeCompletionDialog() {
    if (submitting) return;
    setCompletionTarget(null);
    setCompletionError(null);
  }

  function handleConfirmRequestCompletion() {
    if (!completionTarget || submitting) return;
    setSubmitting(true);
    setCompletionError(null);
    const result = requestCompletion(session, completionTarget.id);
    setSubmitting(false);
    if (!result.ok) {
      setCompletionError(result.error);
      return;
    }
    setCompletionTarget(null);
  }

  const offers = getOffersByProvider(session.id);

  if (offers.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Henüz herhangi bir ilana teklif vermediniz.
        </p>
        <Link
          href="/ilanlar"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İş ilanlarını incele
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {offers.map((offer) => {
        const job = jobById.get(offer.jobId);
        const revealedContact = getRevealedContactForOffer(session, offer.id);
        const isLong = offer.description.length > DESCRIPTION_PREVIEW_LENGTH;
        const preview = isLong
          ? `${offer.description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}…`
          : offer.description;

        return (
          <div
            key={offer.id}
            className="rounded-card border border-border bg-surface p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {job && (
                  <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                    {job.category}
                  </span>
                )}
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                  {job ? job.title : "İlan artık mevcut değil"}
                </h3>
              </div>
              <StatusBadge
                label={getOfferStatusLabel(offer.status)}
                tone={getOfferStatusTone(offer.status)}
              />
            </div>

            <p className="mt-3 text-lg font-semibold text-foreground">
              {formatMoney(offer.amount, offer.currency)}
            </p>

            <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {offer.estimatedDuration}
              </span>
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                {formatJobDate(offer.createdAt)}
              </span>
            </div>

            {isLong ? (
              <details className="mt-3 text-sm text-muted-foreground">
                <summary className="cursor-pointer list-none font-medium text-primary marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">
                  {preview} <span className="underline">Tamamını gör</span>
                </summary>
                <p className="mt-2 leading-relaxed">{offer.description}</p>
              </details>
            ) : (
              <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {offer.description}
              </p>
            )}

            {job && (
              <Link
                href={`/ilanlar/${job.id}`}
                className="mt-4 inline-block text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
              >
                İlan detayına git
              </Link>
            )}

            {revealedContact && <ContactInfoBlock contact={revealedContact.requester} />}

            {offer.status === "in_progress" && (
              <button
                type="button"
                onClick={() => openCompletionDialog(offer)}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                Tamamlandı Olarak İşaretle
              </button>
            )}

            {offer.status === "completion_requested" && (
              <p className="mt-4 text-sm font-medium text-warning">
                Onay bekleniyor — Hizmet Alan işlemi onaylayacak.
              </p>
            )}

            {offer.status === "completion_disputed" && (
              <p className="mt-4 text-sm leading-relaxed text-danger">
                İtiraz edildi
                {offer.completionDisputeNote ? `: "${offer.completionDisputeNote}"` : "."} Hizmet
                Alan sonucu belirleyecek.
              </p>
            )}
          </div>
        );
      })}

      {completionTarget && (
        <RequestCompletionDialog
          jobTitle={jobById.get(completionTarget.jobId)?.title ?? "İlan"}
          submitting={submitting}
          error={completionError}
          onConfirm={handleConfirmRequestCompletion}
          onCancel={closeCompletionDialog}
        />
      )}
    </div>
  );
}
