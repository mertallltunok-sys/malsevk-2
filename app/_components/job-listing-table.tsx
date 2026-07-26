import Link from "next/link";
import { getProviderClosedReasonLabel } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import type { JobListingDisplayItem } from "../_lib/job-listing-row";
import { JobThumbnail } from "./job-thumbnail";

/**
 * Masaüstü (≥1024px) görünümü — gerçek `<table>`, 7 sütun: Fotoğraf, Hizmet
 * Türü, İlan Başlığı, Şehir/İlçe/Bölge, İş Tarihi, Teklif Sayısı, İşlem.
 * Favori ve Rozetler sütunları bilerek kaldırıldı (bkz. CLAUDE.md "Provider
 * job listing").
 *
 * Çoklu Hizmet Operasyonu — Aşama 5: her `item` ya tek bir ilan (`kind:
 * "single"`, satır markup'ı BİREBİR eskisiyle aynı) ya da 2+ ilanı temsil eden
 * bir operasyon özeti (`kind: "operation"`, bkz. job-listing-row.ts). İkisi de
 * AYNI 7 sütuna oturur — yeni bir sütun eklenmedi: operasyon satırı Hizmet
 * Türü sütununda kategori yerine "Operasyon · N Hizmet" rozetini, İşlem
 * sütununda "İlanı İncele" butonunun altında (closedReason notuyla AYNI
 * konumda) ilerleme yüzdesini gösterir.
 */
export function JobListingTable({
  items,
  onJobClick,
}: {
  items: JobListingDisplayItem[];
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
            Firma / Bölge / Konum
          </th>
          <th scope="col" className="px-3 py-3">
            İş Tarihi
          </th>
          <th scope="col" className="px-3 py-3 text-center">
            Teklif Sayısı
          </th>
          <th scope="col" className="px-3 py-3">
            <span className="sr-only">İşlem</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const row = item.kind === "operation" ? item.primaryRow : item.row;
          const { job } = row;
          return (
            <tr key={item.kind === "operation" ? item.operationId : job.id} className="border-b border-border last:border-b-0 hover:bg-background/60">
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
                {item.kind === "operation" ? (
                  <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    Operasyon · {item.totalCount} Hizmet
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    {row.categoryLabel}
                  </span>
                )}
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
              <td className="max-w-[220px] px-3 py-3 align-top text-muted-foreground">
                {row.location.companyOrFactoryName && (
                  <p className="truncate font-medium text-foreground">{row.location.companyOrFactoryName}</p>
                )}
                <p className="truncate">
                  {row.location.facilityDisplayName}
                  {row.location.facilityTypeLabel && ` (${row.location.facilityTypeLabel})`}
                </p>
                <p className="truncate text-xs">
                  {row.location.district} / {row.location.province}
                </p>
              </td>
              <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                {formatJobDate(job.workDate)}
              </td>
              <td className="px-3 py-3 text-center align-top font-medium text-foreground">
                {item.kind === "operation" ? item.visibleOfferCount : row.visibleOfferCount}
              </td>
              <td className="px-3 py-3 align-top">
                <Link
                  href={`/ilanlar/${job.id}`}
                  onClick={() => onJobClick(job.id)}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  İlanı İncele
                </Link>
                {item.kind === "operation" ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Operasyon İlerlemesi: %{item.progressPercent}
                  </p>
                ) : (
                  !row.availability.open &&
                  row.availability.closedReason && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {getProviderClosedReasonLabel(row.availability.closedReason)}
                    </p>
                  )
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
