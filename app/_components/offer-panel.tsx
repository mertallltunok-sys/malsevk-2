"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { isReofferCooldownStatus } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOfferForJob, getOfferStatusLabel } from "../_lib/offers";
import { MAX_ACTIVE_JOBS, hasReachedActiveJobLimit } from "../_lib/provider-capacity";
import { computeRemainingTime, getReofferEligibleAtIso } from "../_lib/time-remaining";
import type { Job, Offer } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { CompletionCountdown } from "./completion-countdown";
import { OfferForm } from "./offer-form";

const REOFFER_BLOCKED_MESSAGES: Record<"withdrawn" | "rejected" | "agreement_failed", string> = {
  withdrawn: "Bu ilana daha önce verdiğiniz teklifi geri çektiniz.",
  rejected: "Bu ilana verdiğiniz teklif reddedildi.",
  agreement_failed:
    "Bu ilan için daha önce teklifiniz kabul edilmiş ancak anlaşma sağlanamamıştır.",
};

function OfferSummaryCard({ offer }: { offer: Offer }) {
  return (
    <div className="rounded-card border border-border bg-background p-6">
      <p className="text-sm font-semibold text-foreground">
        {formatMoney(offer.amount, offer.currency)}
      </p>
      <dl className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
        <div className="flex justify-between gap-4">
          <dt>Tahmini süre</dt>
          <dd className="text-right text-foreground">{offer.estimatedDuration}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Teklif tarihi</dt>
          <dd className="text-right text-foreground">{formatJobDate(offer.createdAt)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Durum</dt>
          <dd className="text-right text-foreground">{getOfferStatusLabel(offer.status)}</dd>
        </div>
      </dl>
      <p className="mt-4 break-words text-sm leading-relaxed text-muted-foreground">
        {offer.description}
      </p>
      <Link
        href="/panel/tekliflerim"
        className="mt-4 inline-block text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
      >
        Verdiğim Teklifler&apos;i görüntüle
      </Link>
    </div>
  );
}

export function OfferPanel({ job, offers }: { job: Job; offers: Offer[] }) {
  const session = useSession();
  const [existingOffer, setExistingOffer] = useState<Offer | null | undefined>(
    undefined,
  );
  const [justSubmitted, setJustSubmitted] = useState(false);

  if (!session) {
    return (
      <AuthGateNotice
        message="Bu ilana teklif verebilmek için giriş yapmalısınız."
        loginRedirect={`/ilanlar/${job.id}`}
      />
    );
  }

  if (session.role !== "hizmet-veren") {
    if (job.requesterId === session.id) {
      return (
        <AuthGateNotice
          message="Bu ilan size ait. Gelen teklifleri profil menüsündeki Gelen Teklifler bölümünden inceleyebilirsiniz."
          action={{
            label: "Gelen Teklifleri Gör",
            href: `/panel/gelen-teklifler?ilanId=${job.id}`,
          }}
        />
      );
    }
    return (
      <AuthGateNotice message="Yalnızca Hizmet Veren kullanıcılar teklif verebilir." />
    );
  }

  const currentOffer = existingOffer === undefined
    ? getOfferForJob(job.id, session.id)
    : existingOffer;

  // withdrawn/rejected/agreement_failed: aynı ilana yeniden teklif hakkı
  // KALICI değil, yalnızca REOFFER_COOLDOWN_DAYS (3 gün) süreyle askıda
  // (bkz. offers.ts#createOffer, job-requests.ts#REOFFER_COOLDOWN_OFFER_STATUSES).
  // Bekleme süresi dolunca bu blok atlanır, akış normal şekilde aşağıdaki
  // kapasite kontrolüne ve teklif formuna devam eder.
  if (currentOffer && isReofferCooldownStatus(currentOffer.status)) {
    const eligibleAtIso = getReofferEligibleAtIso(currentOffer.updatedAt);
    const remaining = computeRemainingTime(eligibleAtIso);
    if (!remaining.isExpired) {
      return (
        <div className="rounded-card border border-border bg-background p-6">
          <p className="text-sm font-semibold text-foreground">
            {REOFFER_BLOCKED_MESSAGES[currentOffer.status]}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Bekleme süresi dolduğunda aynı hizmet talebine yeniden teklif verebilirsiniz.
          </p>
          <CompletionCountdown deadlineIso={eligibleAtIso} />
        </div>
      );
    }
    // Bekleme süresi doldu — aşağıdaki normal akışa (form dahil) devam edilir.
  } else if (currentOffer) {
    return (
      <div>
        {justSubmitted && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Teklifiniz başarıyla gönderildi.
          </p>
        )}
        <p className="mb-4 text-sm font-medium text-foreground">
          Bu ilana daha önce teklif verdiniz.
        </p>
        <OfferSummaryCard offer={currentOffer} />
      </div>
    );
  }

  // Bu ilana kabul edilmiş/devam eden bir teklif olması artık yeni teklif
  // vermeyi engellemez — diğer Hizmet Verenler de teklif verebilir (bkz.
  // job-requests.ts#getJobOfferAvailability). Aynı anda yalnızca TEK
  // teklifin anlaşma sürecinin ilerleyebilmesi kuralı, Hizmet Alan'ın
  // Kabul Et/Reddet aksiyonları üzerinde uygulanır (bkz.
  // incoming-offer-card.tsx#isOfferPendingActionBlocked), bu ekranda değil.

  // Aktif iş kapasitesi dolu olduğunda ilanları/teklifleri görüntülemeye
  // devam edebilir, yalnızca YENİ teklif gönderemez — bu görsel engel,
  // offers.ts#createOffer içindeki arayüzden bağımsız kontrolün eşdeğeridir.
  if (hasReachedActiveJobLimit(session.id, offers)) {
    return (
      <div className="rounded-card border border-border bg-background p-6">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
        >
          Aktif hizmet verme sınırına ulaştınız.
        </button>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {`Aynı anda en fazla ${MAX_ACTIVE_JOBS} aktif iş yürütebilirsiniz. Mevcut işleriniz tamamlandıktan sonra yeni teklif verebilirsiniz.`}
        </p>
      </div>
    );
  }

  return (
    <OfferForm
      job={job}
      session={session}
      onSuccess={(offer) => {
        setExistingOffer(offer);
        setJustSubmitted(true);
      }}
    />
  );
}
