"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRevealedContactForOffer } from "../_lib/contact-access";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOfferStatusLabel, getOfferStatusTone, updateOfferStatus } from "../_lib/offers";
import type { Job, Offer, Session, UserRole } from "../_lib/types";
import { findUserById } from "../_lib/users";
import { ContactInfoBlock } from "./contact-info-block";
import { JobRatingModal } from "./job-rating-modal";
import { OfferOutcomePanel } from "./offer-outcome-panel";
import { StatusBadge } from "./status-badge";

function getRoleLabel(role: UserRole): string {
  return role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan";
}

export function IncomingOfferCard({
  offer,
  job,
  session,
  highlighted,
}: {
  offer: Offer;
  job: Job | undefined;
  session: Session;
  highlighted: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<"accepted" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratingModalOffer, setRatingModalOffer] = useState<Offer | null>(null);
  const [justRated, setJustRated] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const provider = findUserById(offer.providerId);
  const revealedContact = getRevealedContactForOffer(session, offer.id);

  useEffect(() => {
    if (!highlighted || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    cardRef.current.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [highlighted]);

  function handleDecision(nextStatus: "accepted" | "rejected") {
    if (pendingAction) return;
    setPendingAction(nextStatus);
    setError(null);
    const result = updateOfferStatus(session, offer.id, nextStatus);
    setPendingAction(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-card border bg-surface p-6 transition-colors ${
        highlighted ? "border-primary ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {job ? job.title : "İlan artık mevcut değil"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {provider ? provider.name : "Hizmet Veren"}
            <span className="ml-2 font-normal text-muted-foreground">
              ({getRoleLabel("hizmet-veren")})
            </span>
          </p>
        </div>
        <StatusBadge label={getOfferStatusLabel(offer.status)} tone={getOfferStatusTone(offer.status)} />
      </div>

      <p className="mt-3 text-lg font-semibold text-foreground">
        {formatMoney(offer.amount, offer.currency)}
      </p>

      <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
        <span>Tahmini süre: {offer.estimatedDuration}</span>
        <span>Teklif tarihi: {formatJobDate(offer.createdAt)}</span>
      </div>

      <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{offer.description}</p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {offer.status === "pending" && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => handleDecision("accepted")}
            disabled={pendingAction !== null}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-success px-5 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Kabul Et
          </button>
          <button
            type="button"
            onClick={() => handleDecision("rejected")}
            disabled={pendingAction !== null}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Reddet
          </button>
        </div>
      )}

      {revealedContact && <ContactInfoBlock contact={revealedContact.provider} />}

      {(offer.status === "accepted" ||
        offer.status === "completion_requested" ||
        offer.status === "completion_disputed") && (
        <OfferOutcomePanel
          offer={offer}
          session={session}
          onCompleted={(completedOffer) => setRatingModalOffer(completedOffer)}
        />
      )}

      {justRated && (
        <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-success">
          Değerlendirmeniz için teşekkür ederiz.
        </p>
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
