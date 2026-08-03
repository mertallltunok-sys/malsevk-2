import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getProviderClosedReasonLabel } from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { getJobListingCategoryBadgeLabel, type JobListingDisplayItem } from "../_lib/job-listing-row";
import { JobThumbnail } from "./job-thumbnail";
import { NakliyeListingRoute } from "./nakliye-listing-route";
import { OperationServiceTags } from "./operation-service-tags";

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
 * Türü sütununda kategori yerine bir rozet, İşlem sütununda "İlanı İncele"
 * butonunun altında (closedReason notuyla AYNI konumda) ilerleme yüzdesini
 * gösterir. Rozetin hemen altında, AYNI sütun içinde, `OperationServiceTags`
 * operasyondaki HER hizmet adını (hiçbiri gizlenmeden, "·" ayracıyla akan
 * tek bir paragrafta, ayrıntılı durum BİLEREK yok, tıklanamaz) listeler
 * (bkz. o bileşenin dokümantasyonu) — tekil ilan satırları bundan hiç
 * etkilenmez. Operasyondaki TÜM hizmetler tamamlandığında (`completedCount
 * === totalCount`) İşlem sütunundaki ilerleme yüzdesi yerine sade bir
 * "Operasyon Tamamlandı" etiketi gösterilir — durum yine job-listing-row.ts#
 * OperationListingItem'ın kendi (offer/job-türetilmiş) sayaçlarından gelir,
 * yeni bir hesap İCAT EDİLMEZ (NOT: bu dal artık pratikte hiç TETİKLENMEZ —
 * bkz. job-completion.ts#isJobFullyCompletedForListing: TÜM hizmetleri
 * tamamlanmış bir operasyon zaten provider-job-listing.tsx#activeJobs
 * aşamasında listeden tamamen çıkarılıyor, bu satıra hiç ulaşmıyor; kod
 * BİLEREK kaldırılmadı, zararsız ve gelecekte bu eşiğin farklı bir yerde
 * yeniden kullanılması ihtimaline karşı).
 *
 * "Hizmet Türü" ROZETİNİN metni artık `job-listing-row.ts#
 * getJobListingCategoryBadgeLabel`in hesapladığı "Operasyon • {kalan} Hizmet
 * Arıyor" (operasyon) / "{Kategori} Hizmeti Arıyor" (tekil) biçimindedir —
 * rozetin kendi görünümü (mavi `text-accent` yazı, `bg-accent-soft` dolgu,
 * `rounded-full`, boyut/padding/hizalama) HİÇ DEĞİŞMEDİ, yalnızca İÇİNDEKİ
 * METİN değişti. "İlan Başlığı" sütunu (aşağıdaki ayrı `<td>`) HİÇ
 * DOKUNULMADI — kullanıcının kendi yazdığı `job.title`i, eski font/boyut/
 * sırasıyla göstermeye AYNEN devam eder. "Hizmet Türü" başlığı (`<th>`) bu
 * metnin rahat oturması için, ekran büyüdükçe kademeli artan bir `min-width`
 * alır (tablo `w-full` + tarayıcının auto-layout'u nedeniyle asıl büyüme
 * geniş ekranlarda gerçekleşir — diğer altı sütunun hizası/genişliği bundan
 * etkilenmez, `overflow-x-auto` kapsayıcı sayesinde dar ekranlarda da sayfa
 * genelinde yatay kaydırma OLUŞMAZ, yalnızca tablo
 * kendi içinde kayar).
 */
export function JobListingTable({
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
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Aktif ilanlar listesi</caption>
      <thead>
        <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="w-20 py-3 pr-3">
            <span className="sr-only">Fotoğraf</span>
          </th>
          <th scope="col" className="min-w-[180px] px-3 py-3 xl:min-w-[220px] 2xl:min-w-[260px]">
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
                  <>
                    <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                      {getJobListingCategoryBadgeLabel(item)}
                    </span>
                    <OperationServiceTags services={item.services} />
                  </>
                ) : (
                  <>
                    <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                      {getJobListingCategoryBadgeLabel(item)}
                    </span>
                    {row.productInfoLine && (
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">{row.productInfoLine}</p>
                    )}
                  </>
                )}
              </td>
              <td className="max-w-xs px-3 py-3 align-top">
                <Link
                  href={`/ilanlar/${job.id}`}
                  onClick={() => onJobClick(job.id)}
                  className="break-words font-bold italic tracking-heading leading-tight text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  {job.title}
                </Link>
              </td>
              {/* Nakliyeci güzergâh görünümü: showNakliyeRoute (izleyici gerçek bir
                  Nakliyeci mi, bkz. provider-job-listing.tsx) VE row.nakliyeRoute
                  (bu satır Nakliye kategorisinde mi VE teslimat bilgisi dolu mu,
                  bkz. nakliye-route.ts#getNakliyeShortRoute) İKİSİ birden doğruysa
                  nakliye-listing-route.tsx#NakliyeListingRoute render edilir — aksi
                  halde (Nakliyeci olmayan bir izleyici, ya da Nakliyeci'nin Gümrük
                  Müşavirliği/başka kategoriden bir satırı) standart Firma/Bölge/
                  Konum görünümü AYNEN kalır. */}
              <td className="max-w-[220px] px-3 py-3 align-top text-muted-foreground">
                {showNakliyeRoute && row.nakliyeRoute ? (
                  <NakliyeListingRoute pickup={row.nakliyeRoute.pickup} delivery={row.nakliyeRoute.delivery} />
                ) : (
                  <>
                    {row.location.companyOrFactoryName && (
                      <p className="truncate font-medium text-foreground">{row.location.companyOrFactoryName}</p>
                    )}
                    {row.location.facilityDisplayName && (
                      <p className="truncate">
                        {row.location.facilityDisplayName}
                        {row.location.facilityTypeLabel && ` (${row.location.facilityTypeLabel})`}
                      </p>
                    )}
                    <p className="truncate text-xs">
                      {row.location.district} / {row.location.province}
                    </p>
                  </>
                )}
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
                  item.completedCount === item.totalCount ? (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Operasyon Tamamlandı
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Operasyon İlerlemesi: %{item.progressPercent}
                    </p>
                  )
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
