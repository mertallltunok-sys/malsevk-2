import { CalendarDays, CheckCircle2, MapPin, Package } from "lucide-react";
import Link from "next/link";
import { getProviderClosedReasonLabel } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { getJobListingCategoryBadgeLabel, type JobListingDisplayItem } from "../_lib/job-listing-row";
import { JobThumbnail } from "./job-thumbnail";
import { NakliyeListingRoute } from "./nakliye-listing-route";
import { OperationServiceTags } from "./operation-service-tags";

/**
 * Mobil/tablet (<1024px) görünümü — tablo YOK, responsive kart yığını.
 * 320px'ten itibaren yatay scroll oluşturmayacak şekilde: sabit boyutlu
 * thumbnail + `min-w-0`/`break-words` ile taşan metin sarmalanır, hiçbir
 * eleman genişliği ekran genişliğini aşmaz. Favori ve Rozetler bilerek
 * kaldırıldı (bkz. CLAUDE.md "Provider job listing").
 *
 * Çoklu Hizmet Operasyonu — Aşama 5: her `item` ya tek bir ilan (`kind:
 * "single"`, markup BİREBİR eskisiyle aynı) ya da 2+ ilanı temsil eden bir
 * operasyon özeti (`kind: "operation"`, bkz. job-listing-row.ts). Rozetin
 * (kategori/operasyon hap'ı) metni artık job-listing-row.ts#
 * getJobListingCategoryBadgeLabel'ın hesapladığı "Operasyon • {kalan} Hizmet
 * Arıyor" (operasyon) / "{Kategori} Hizmeti Arıyor" (tekil) biçimindedir —
 * rozetin kendi görünümü (mavi `text-accent` yazı, `bg-accent-soft` dolgu,
 * boyut/padding/hizalama) HİÇ DEĞİŞMEDİ, yalnızca İÇİNDEKİ METİN değişti.
 * "İlan Başlığı" (job title Link'i, aşağıda) HİÇ DOKUNULMADI — kullanıcının
 * kendi yazdığı `job.title`i, eski font/boyut/sırasıyla göstermeye AYNEN
 * devam eder. Teklif sayısı satırının altına ilerleme yüzdesi eklenir,
 * rozetin HEMEN ALTINA (başlıktan ÖNCE) `OperationServiceTags` ile
 * operasyondaki HER hizmet adı (hiçbiri gizlenmeden, "·" ayracıyla saran bir
 * `flex flex-wrap` satırında) tıklanamaz şekilde eklenir — her hizmetin
 * gerçek tamamlanma durumu (bkz. o bileşenin dokümantasyonu) gösterilir,
 * ayrıntılı durum yine gösterilmez; geri kalan kart markup'ı (thumbnail,
 * konum, tarih, İlanı İncele butonu) değişmeden paylaşılır. Kart alanı sırası
 * (1. görsel+operasyon rozeti, 2. hizmet adları+tamamlanma durumu, 3. ilan
 * başlığı, 4. firma/bölge/konum, 5. iş tarihi+teklif sayısı, 6. İlanı İncele
 * butonu) değişmedi. Operasyondaki TÜM hizmetler tamamlandığında teklif
 * sayısı satırının altındaki ilerleme yüzdesi yerine sade bir "Operasyon
 * Tamamlandı" etiketi gösterilir (bkz. job-listing-table.tsx'teki AYNI mantık
 * — pratikte artık hiç tetiklenmiyor, bkz. o dosyadaki AYNI not: tam
 * tamamlanmış bir operasyon zaten activeJobs aşamasında listeden tamamen
 * düşüyor). Tekil ilan kartları bu değişikliklerin hiçbirinden (rozet metni
 * hariç) etkilenmez.
 */
export function JobListingCards({
  items,
  onJobClick,
  showNakliyeRoute,
}: {
  items: JobListingDisplayItem[];
  onJobClick: (jobId: string) => void;
  /** İzleyen Hizmet Veren gerçek bir Nakliyeci mi (bkz. provider-job-listing.tsx#viewerIsNakliyeci) — false ise bu satırın Nakliye olup olmadığına bakılmaksızın her zaman standart Firma/Bölge/Konum görünümü kullanılır. */
  showNakliyeRoute: boolean;
}) {
  return (
    <ul role="list" className="flex flex-col gap-4">
      {items.map((item) => {
        const row = item.kind === "operation" ? item.primaryRow : item.row;
        const { job } = row;
        return (
          <li
            key={item.kind === "operation" ? item.operationId : job.id}
            className="rounded-card border border-border bg-surface p-4 shadow-sm"
          >
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
                  {getJobListingCategoryBadgeLabel(item)}
                </span>
                {item.kind === "operation" && <OperationServiceTags services={item.services} />}
                <Link
                  href={`/ilanlar/${job.id}`}
                  onClick={() => onJobClick(job.id)}
                  className="mt-1.5 block break-words text-sm font-bold italic tracking-heading leading-snug text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  {job.title}
                </Link>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
              {/* Nakliyeci güzergâh görünümü — bkz. job-listing-table.tsx'teki AYNI
                  showNakliyeRoute/row.nakliyeRoute gate ve nakliye-listing-route.tsx. */}
              {showNakliyeRoute && row.nakliyeRoute ? (
                <span className="flex min-w-0 items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <NakliyeListingRoute pickup={row.nakliyeRoute.pickup} delivery={row.nakliyeRoute.delivery} />
                </span>
              ) : (
                <span className="flex min-w-0 items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {row.location.companyOrFactoryName && (
                      <span className="block truncate font-medium text-foreground">
                        {row.location.companyOrFactoryName}
                      </span>
                    )}
                    <span className="block truncate">
                      {row.location.facilityDisplayName && (
                        <>
                          {row.location.facilityDisplayName}
                          {row.location.facilityTypeLabel && ` (${row.location.facilityTypeLabel})`} ·{" "}
                        </>
                      )}
                      {row.location.district} / {row.location.province}
                    </span>
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatJobDate(job.workDate)}
              </span>
              <span>{item.kind === "operation" ? item.visibleOfferCount : row.visibleOfferCount} teklif</span>
              {item.kind === "single" && row.productInfoLine && (
                <span className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {row.productInfoLine}
                </span>
              )}
              {item.kind === "operation" &&
                (item.completedCount === item.totalCount ? (
                  <span className="flex items-center gap-1 font-medium text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Operasyon Tamamlandı
                  </span>
                ) : (
                  <span>Operasyon İlerlemesi: %{item.progressPercent}</span>
                ))}
            </div>

            {item.kind === "single" && !row.availability.open && row.availability.closedReason && (
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
