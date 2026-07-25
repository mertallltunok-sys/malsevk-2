import Link from "next/link";
import { getProviderClosedReasonLabel } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import type { JobListingRow } from "../_lib/job-listing-row";
import type { Session } from "../_lib/types";
import { JobFavoriteToggle } from "./job-favorite-toggle";
import { JobThumbnail } from "./job-thumbnail";
import { StatusBadge } from "./status-badge";

/**
 * Masaüstü (≥1024px) görünümü — gerçek `<table>`, ürün talebindeki 8 sütun
 * BİREBİR: Thumbnail, Hizmet Türü, İlan Başlığı, Konum, İş Tarihi, Teklif
 * Sayısı, Rozetler, İşlem. Favori butonu ayrı bir sütun DEĞİL — "İşlem"
 * sütununun bir parçası (talep edilen sütun sayısını bozmamak için).
 */
export function JobListingTable({
  rows,
  session,
  onJobClick,
}: {
  rows: JobListingRow[];
  session: Session;
  onJobClick: (jobId: string) => void;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Aktif ilanlar listesi</caption>
      <thead>
        <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="w-20 py-3 pr-3">
            <span className="sr-only">Fotoğraf</span>
          </th>
          <th scope="col" className="px-3 py-3">
            Hizmet Türü
          </th>
          <th scope="col" className="px-3 py-3">
            İlan Başlığı
          </th>
          <th scope="col" className="px-3 py-3">
            Konum
          </th>
          <th scope="col" className="px-3 py-3">
            İş Tarihi
          </th>
          <th scope="col" className="px-3 py-3 text-center">
            Teklif Sayısı
          </th>
          <th scope="col" className="px-3 py-3">
            Rozetler
          </th>
          <th scope="col" className="px-3 py-3">
            <span className="sr-only">İşlem</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { job } = row;
          const badges = row.providerBadge ? [...row.generalBadges, row.providerBadge] : row.generalBadges;
          return (
            <tr key={job.id} className="border-b border-border last:border-b-0 hover:bg-background/60">
              <td className="py-3 pr-3">
                <JobThumbnail
                  photo={row.thumbnailPhoto}
                  photoCount={row.photoCount}
                  category={job.category}
                  alt={job.title}
                  size={72}
                />
              </td>
              <td className="px-3 py-3 align-top">
                <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {row.categoryLabel}
                </span>
              </td>
              <td className="max-w-xs px-3 py-3 align-top">
                <Link
                  href={`/ilanlar/${job.id}`}
                  onClick={() => onJobClick(job.id)}
                  className="break-words font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  {job.title}
                </Link>
              </td>
              <td className="px-3 py-3 align-top text-muted-foreground">
                {job.district}, {job.province}
                <br />
                <span className="text-xs">{job.workLocationType}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                {formatJobDate(job.workDate)}
              </td>
              <td className="px-3 py-3 text-center align-top font-medium text-foreground">
                {row.visibleOfferCount}
              </td>
              <td className="px-3 py-3 align-top">
                {badges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {badges.map((badge) => (
                      <StatusBadge key={badge.kind} label={badge.label} tone={badge.tone} />
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <div className="flex items-center gap-2">
                  <JobFavoriteToggle userId={session.id} jobId={job.id} isFavorited={row.isFavorited} />
                  <Link
                    href={`/ilanlar/${job.id}`}
                    onClick={() => onJobClick(job.id)}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    İlanı İncele
                  </Link>
                </div>
                {!row.availability.open && row.availability.closedReason && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {getProviderClosedReasonLabel(row.availability.closedReason)}
                  </p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
