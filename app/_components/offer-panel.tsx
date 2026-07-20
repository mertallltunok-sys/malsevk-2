"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { getOfferForJob, getOfferStatusLabel } from "../_lib/offers";
import type { Job, Offer } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { OfferForm } from "./offer-form";

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
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
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

export function OfferPanel({ job }: { job: Job }) {
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

  if (currentOffer) {
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
