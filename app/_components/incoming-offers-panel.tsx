"use client";

import { useSearchParams } from "next/navigation";
import { isOfferVisibleInNormalLists } from "../_lib/job-requests";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { IncomingOfferCard } from "./incoming-offer-card";

export function IncomingOffersPanel() {
  const session = useSession();
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const searchParams = useSearchParams();
  const highlightOfferId = searchParams.get("offerId");
  const highlightJobId = searchParams.get("ilanId");

  if (!session) {
    return (
      <AuthGateNotice
        message="Gelen teklifleri görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/gelen-teklifler"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return (
      <AuthGateNotice message="Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir." />
    );
  }

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const myJobIds = new Set(
    jobs.filter((job) => job.requesterId === session.id).map((job) => job.id),
  );

  // "withdrawn": Hizmet Veren'in kabul edilmeden önce geri çektiği teklif —
  // aktif Gelen Teklifler listesinde hiç görünmez, tekrar kabul edilemez
  // (bkz. offers.ts#withdrawOffer, job-requests.ts#isOfferVisibleInNormalLists
  // — tek ortak doğruluk kaynağı, burada tekrar yazılmaz).
  const incoming = offers
    .filter((offer) => myJobIds.has(offer.jobId))
    .filter(isOfferVisibleInNormalLists)
    .filter((offer) => !highlightJobId || offer.jobId === highlightJobId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (incoming.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Henüz gelen teklif yok.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {incoming.map((offer) => (
        <IncomingOfferCard
          key={offer.id}
          offer={offer}
          job={jobById.get(offer.jobId)}
          session={session}
          highlighted={offer.id === highlightOfferId}
        />
      ))}
    </div>
  );
}
