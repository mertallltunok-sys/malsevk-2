"use client";

import { Building2, Check, CheckCircle2, MapPin, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRevealedContactForOffer } from "../_lib/contact-access";
import { OFFER_PENDING_BLOCKED_MESSAGE, isOfferPendingActionBlocked } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOfferStatusLabel, getOfferStatusTone, updateOfferStatus } from "../_lib/offers";
import { getProviderProfileSummary } from "../_lib/provider-profile";
import type { Job, Offer, Session, UserRole } from "../_lib/types";
import { useAllOffers } from "../_lib/use-offers";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { useAllRatings } from "../_lib/use-ratings";
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
  const allOffers = useAllOffers();
  const allRatings = useAllRatings();
  const providerProfile = provider?.providerProfile;
  const providerSummary = getProviderProfileSummary(offer.providerId, allOffers, allRatings);
  const logoUrl = useJobPhotoUrl(providerProfile?.logoStorageKey ?? null);
  const companyName = providerProfile?.companyName?.trim() || (provider ? provider.name : "Hizmet Veren");

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
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- IndexedDB blob object URL, next/image optimize edemez
              <img src={logoUrl} alt={`${companyName} logosu`} className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {job ? job.title : "İlan artık mevcut değil"}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">
              {companyName}
              <span className="ml-2 font-normal text-muted-foreground">
                ({getRoleLabel("hizmet-veren")})
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex shrink-0 items-center gap-1">
                <span className="flex" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="h-3 w-3 text-rating"
                      fill={
                        providerSummary.averageStars !== null && star <= Math.round(providerSummary.averageStars)
                          ? "currentColor"
                          : "transparent"
                      }
                      strokeWidth={1.75}
                    />
                  ))}
                </span>
                {providerSummary.averageStars !== null ? (
                  <span>
                    {providerSummary.averageStars.toFixed(1)} ({providerSummary.ratingCount})
                  </span>
                ) : (
                  <span>Henüz değerlendirme yok</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                {providerSummary.completedJobCount} tamamlanan iş
              </span>
              {providerProfile && providerProfile.regions.length > 0 && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{providerProfile.regions.join(", ")}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <StatusBadge label={getOfferStatusLabel(offer.status)} tone={getOfferStatusTone(offer.status)} />
        </div>
      </div>

      {providerProfile && providerProfile.expertise.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {providerProfile.expertise.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {providerProfile?.bio?.trim() && (
        <p className="mt-3 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
          {providerProfile.bio}
        </p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-lg font-semibold text-foreground">
          {formatMoney(offer.amount, offer.currency)}
        </p>

        <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
          <span>Tahmini süre: {offer.estimatedDuration}</span>
          <span>Teklif tarihi: {formatJobDate(offer.createdAt)}</span>
        </div>

        <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{offer.description}</p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {offer.status === "pending" &&
        (isOfferPendingActionBlocked(offer, allOffers) ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{OFFER_PENDING_BLOCKED_MESSAGE}</p>
        ) : (
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
        ))}

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
