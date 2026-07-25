import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { getProviderClosedReasonLabel } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import type { JobListingRow } from "../_lib/job-listing-row";
import { JobThumbnail } from "./job-thumbnail";

/**
 * Mobil/tablet (<1024px) görünümü — tablo YOK, responsive kart yığını.
 * 320px'ten itibaren yatay scroll oluşturmayacak şekilde: sabit boyutlu
 * thumbnail + `min-w-0`/`break-words` ile taşan metin sarmalanır, hiçbir
 * eleman genişliği ekran genişliğini aşmaz. Favori ve Rozetler bilerek
 * kaldırıldı (bkz. CLAUDE.md "Provider job listing").
 */
export function JobListingCards({
  rows,
  onJobClick,
}: {
  rows: JobListingRow[];
  onJobClick: (jobId: string) => void;
}) {
  return (
    <ul role="list" className="flex flex-col gap-4">
      {rows.map((row) => {
        const { job } = row;
        return (
          <li key={job.id} className="rounded-card border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <JobThumbnail
                photo={row.thumbnailPhoto}
                photoCount={row.photoCount}
                category={job.category}
                alt={job.title}
                size={64}
              />
              <div className="min-w-0 flex-1">
                <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {row.categoryLabel}
                </span>
                <Link
                  href={`/ilanlar/${job.id}`}
                  onClick={() => onJobClick(job.id)}
                  className="mt-1.5 block break-words text-sm font-semibold leading-snug text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  {job.title}
                </Link>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {row.location.companyOrFactoryName && (
                    <span className="block truncate font-medium text-foreground">
                      {row.location.companyOrFactoryName}
                    </span>
                  )}
                  <span className="block truncate">
                    {row.location.facilityDisplayName}
                    {row.location.facilityTypeLabel && ` (${row.location.facilityTypeLabel})`} ·{" "}
                    {row.location.district} / {row.location.province}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatJobDate(job.workDate)}
              </span>
              <span>{row.visibleOfferCount} teklif</span>
            </div>

            {!row.availability.open && row.availability.closedReason && (
              <p className="mt-2 text-xs text-muted-foreground">
                {getProviderClosedReasonLabel(row.availability.closedReason)}
              </p>
            )}

            <Link
              href={`/ilanlar/${job.id}`}
              onClick={() => onJobClick(job.id)}
              className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              İlanı İncele
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
