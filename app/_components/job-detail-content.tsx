"use client";

import { CalendarDays, ClipboardList, MapPin } from "lucide-react";
import Link from "next/link";
import {
  getJobOfferAvailability,
  getJobOfferAvailabilityLabel,
  getJobOfferAvailabilityTone,
} from "../_lib/job-requests";
import { formatJobDate, isJobDateInPast, isJobOpenForOffers } from "../_lib/jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useJobById } from "../_lib/use-jobs";
import { useSession } from "../_lib/use-session";
import { JobPhotoGallery } from "./job-photo-gallery";
import { OfferPanel } from "./offer-panel";
import { StatusBadge } from "./status-badge";

export function JobDetailContent({ id }: { id: string }) {
  const job = useJobById(id);
  const offers = useAllOffers();
  const session = useSession();

  if (!job) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-foreground">
          İlan bulunamadı veya artık yayında değil.
        </h1>
        <Link
          href="/ilanlar"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İlanlara Dön
        </Link>
      </div>
    );
  }

  const offerAvailability = getJobOfferAvailability(job, offers);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <Link
        href="/ilanlar"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      >
        ← İlanlara Dön
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {job.category}
          </span>
          <h1 className="mt-3 max-w-2xl break-words text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {job.title}
          </h1>
        </div>
        <StatusBadge
          label={getJobOfferAvailabilityLabel(offerAvailability)}
          tone={getJobOfferAvailabilityTone(offerAvailability)}
        />
      </div>

      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {job.district}, {job.province} · {job.workLocationType}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDate(job.workDate)}
        </span>
      </div>

      {session?.id === job.requesterId && job.status !== "tamamlandi" && isJobDateInPast(job.workDate) && (
        <p className="mt-2 text-xs text-warning">Tarihi güncellemeniz önerilir.</p>
      )}

      <div className="mt-8">
        <JobPhotoGallery photos={job.photos} jobTitle={job.title} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold text-foreground">İş Açıklaması</h2>
            <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">
              {job.description}
            </p>
          </div>
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ClipboardList className="h-5 w-5 text-accent" aria-hidden="true" />
              Operasyon Detayları
            </h2>
            <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">
              {job.operationDetails}
            </p>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">Teklif Ver</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Yalnızca Hizmet Veren kullanıcılar bu ilana teklif verebilir.
          </p>
          <div className="mt-4">
            {isJobOpenForOffers(job.status) ? (
              <OfferPanel job={job} offers={offers} />
            ) : (
              <p className="rounded-card border border-border bg-surface p-6 text-sm leading-relaxed text-muted-foreground">
                Bu ilan şu anda teklif almaya açık değil.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
