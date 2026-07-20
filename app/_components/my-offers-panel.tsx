"use client";

import { CalendarDays, Clock, FileText } from "lucide-react";
import Link from "next/link";
import { getRevealedContactForOffer } from "../_lib/contact-access";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOffersByProvider, getOfferStatusLabel, getOfferStatusTone } from "../_lib/offers";
import { useAllJobs } from "../_lib/use-jobs";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { ContactInfoBlock } from "./contact-info-block";
import { StatusBadge } from "./status-badge";

const DESCRIPTION_PREVIEW_LENGTH = 140;

export function MyOffersPanel() {
  const session = useSession();
  const jobs = useAllJobs();
  const jobById = new Map(jobs.map((job) => [job.id, job]));

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

            {offer.status === "accepted" && revealedContact && (
              <ContactInfoBlock contact={revealedContact.requester} />
            )}
          </div>
        );
      })}
    </div>
  );
}
