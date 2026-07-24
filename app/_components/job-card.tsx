import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import {
  getJobOfferAvailability,
  getJobOfferAvailabilityLabel,
  getJobOfferAvailabilityTone,
} from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import type { Job, Offer } from "../_lib/types";
import { StatusBadge } from "./status-badge";

export function JobCard({
  job,
  offers,
  forceClosed = false,
  closedReasonLabel,
}: {
  job: Job;
  offers: Offer[];
  /** İlan-geneli durum "açık" olsa bile bu kartı "kapalı" göstermeye zorlar — yalnızca oturumdaki kullanıcıya özel kapanma durumları için (bkz. job-requests.ts#getJobAvailabilityForProvider). */
  forceClosed?: boolean;
  /** Kartta rozetin altında gösterilecek kısa, güvenle türetilmiş kapanma nedeni. Verilmezse hiçbir ek metin gösterilmez. */
  closedReasonLabel?: string;
}) {
  const rawAvailability = getJobOfferAvailability(job, offers);
  const availability = forceClosed && rawAvailability === "acik" ? "kapali" : rawAvailability;

  return (
    <Link
      href={`/ilanlar/${job.id}`}
      className="flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-sm transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {getCategoryDisplayLabel(job.category)}
          </span>
          <StatusBadge
            label={getJobOfferAvailabilityLabel(availability)}
            tone={getJobOfferAvailabilityTone(availability)}
          />
        </div>
        {closedReasonLabel && (
          <p className="mt-2 text-right text-xs text-muted-foreground">{closedReasonLabel}</p>
        )}
      </div>

      <div>
        <h3 className="break-words text-lg font-semibold leading-snug text-foreground">
          {job.title}
        </h3>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
          {job.description}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {job.district}, {job.province} · {job.workLocationType}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDate(job.workDate)}
        </span>
      </div>

      <span className="text-sm font-medium text-primary">İlanı İncele</span>
    </Link>
  );
}
