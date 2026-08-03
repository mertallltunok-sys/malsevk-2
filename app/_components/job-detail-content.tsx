"use client";

import { Building2, CalendarDays, Clock, ClipboardList, FileText, Home, MapPin, Package } from "lucide-react";
import Link from "next/link";
import {
  getCustomsRequestedServiceLabels,
  getCustomsTransactionTypeLabel,
  isCustomsBrokerageCategory,
} from "../_lib/customs-brokerage-catalog";
import { formatJobLocationLine, getJobLocationSummary } from "../_lib/job-location";
import {
  canViewJobAddress,
  getJobOfferAvailability,
  getJobOfferAvailabilityLabel,
  getJobOfferAvailabilityTone,
} from "../_lib/job-requests";
import { formatJobDateRange, getInclusiveDayCount, isJobDateInPast, isJobOpenForOffers } from "../_lib/jobs";
import { useIsJobVisibleToSession } from "../_lib/job-visibility";
import { formatProductQuantity, formatProductTonnage, hasProductInfo } from "../_lib/product-catalog";
import { getCategoryDisplayLabel, isStorageOnlyLocationCategory } from "../_lib/service-catalog";
import type { JobCustomsDocument } from "../_lib/types";
import { useAllOffers } from "../_lib/use-offers";
import { useJobById } from "../_lib/use-jobs";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { useSession } from "../_lib/use-session";
import { JobPhotoGallery } from "./job-photo-gallery";
import { NakliyeRouteCard } from "./nakliye-route-card";
import { OfferPanel } from "./offer-panel";
import { OperationStatusCard } from "./operation-status-card";
import { StatusBadge } from "./status-badge";

/** Bir Gümrük Müşavirliği evrakını, IndexedDB'deki blob'undan çözülen bir bağlantı olarak gösterir — job-photo-editor.tsx#ExistingPhotoCard'daki AYNI "hook'u sarmalayan küçük alt bileşen" deseni (hook'lar .map() içinde doğrudan çağrılamaz). */
function CustomsDocumentLink({ document }: { document: JobCustomsDocument }) {
  const url = useJobPhotoUrl(document.storageKey);
  if (!url) {
    return (
      <span className="truncate text-sm text-muted-foreground" title={document.fileName}>
        {document.fileName}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={document.fileName}
      className="truncate text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      title={document.fileName}
    >
      {document.fileName}
    </a>
  );
}

export function JobDetailContent({ id }: { id: string }) {
  const job = useJobById(id);
  const offers = useAllOffers();
  const session = useSession();

  // Nakliye izolasyonu (bkz. job-visibility.ts): doğrudan jobId URL erişimi
  // DAHİL, bu sayfaya ULAŞAN her yol (panel içi bağlantılar, bildirimler,
  // operasyon kardeş ilan linkleri) buradan geçer — bu yüzden merkezi kapı
  // burada uygulanmak, tüm bu yolları TEK seferde kapatmak için yeterlidir.
  // Görünmeyen bir ilan, mevcut "gerçekten yok" durumuyla AYNI mesajı
  // gösterir (bkz. aşağıdaki `!job` dalı) — ilanın var olduğu ama
  // erişilemediği bilgisi bile sızdırılmaz.
  const isVisible = useIsJobVisibleToSession(session, job);

  if (!job || !isVisible) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">
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
  const locationSummary = getJobLocationSummary(job);
  const showAddress = canViewJobAddress(session, job, offers) && Boolean(job.addressText);
  // Depolama Süresi: yalnızca Kapalı/Açık Saha Depolama ilanlarında (bkz.
  // isStorageOnlyLocationCategory) ve yalnızca tarih aralığı geçerliyse
  // (bkz. jobs.ts#getInclusiveDayCount — eksik/geçersiz tarihte null döner,
  // yanlış bir gün sayısı asla göstermeyiz) hesaplanır.
  const storageDurationDays = isStorageOnlyLocationCategory(job.category)
    ? getInclusiveDayCount(job.workDate, job.workEndDate ?? "")
    : null;

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
            {getCategoryDisplayLabel(job.category)}
          </span>
          <h1 className="mt-3 max-w-2xl break-words text-3xl font-bold leading-tight tracking-heading text-foreground sm:text-4xl">
            {job.title}
          </h1>
        </div>
        <StatusBadge
          label={getJobOfferAvailabilityLabel(offerAvailability)}
          tone={getJobOfferAvailabilityTone(offerAvailability)}
        />
      </div>

      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">
        {locationSummary.companyOrFactoryName && (
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {locationSummary.companyOrFactoryName}
          </span>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatJobLocationLine(job)}
          </span>
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatJobDateRange(job.workDate, job.workEndDate)}
          </span>
        </div>
        {showAddress && (
          <span className="flex items-start gap-2">
            <Home className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {job.neighborhood && <>{job.neighborhood}, </>}
              {job.addressText}
              {job.directionsNote && (
                <span className="mt-1 block text-xs text-muted-foreground">{job.directionsNote}</span>
              )}
              {job.locationUrl && (
                <a
                  href={job.locationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Haritada Görüntüle
                </a>
              )}
            </span>
          </span>
        )}
      </div>

      {session?.id === job.requesterId && job.status !== "tamamlandi" && isJobDateInPast(job.workDate) && (
        <p className="mt-2 text-xs text-warning">Tarihi güncellemeniz önerilir.</p>
      )}

      <div className="mt-8">
        <JobPhotoGallery photos={job.photos} jobTitle={job.title} />
      </div>

      {/*
        Tek sütunlu, yukarıdan aşağıya AKIŞ — masaüstünde de sağ tarafta
        bağımsız bir "Teklif Ver" sütunu YOK (bkz. görev tanımı: önceki
        `grid lg:grid-cols-2` iki sütunlu yerleşim BİLEREK kaldırıldı).
        Kullanıcı ÖNCE ilana ait TÜM bilgi kartlarını (Ürün Bilgileri -> İş
        Açıklaması -> hizmete özel kart(lar) -> varsa Operasyon Detayları)
        sırayla görür, Teklif Ver bu akışın EN ALTINDA, son bilgi kartının
        hemen ardından gelir — sticky/yapışkan DEĞİLDİR, sıradan bir sonraki
        flex öğesidir. Bu, masaüstü/mobil arasında ARTIK hiç fark yaratmaz;
        `lg:` breakpoint'ine bağlı hiçbir sınıf kalmadı, aynı tek `flex
        flex-col gap-6` her ekran genişliğinde aynı şekilde render olur.
      */}
      <div className="mt-10 flex flex-col gap-6">
        {hasProductInfo(job) && (
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
              <Package className="h-5 w-5 text-accent" aria-hidden="true" />
              Ürün Bilgileri
            </h2>
            {/*
              Etiket/değer AYNI görsel ağırlıkta değil bilerek — dt küçük/soluk
              (text-xs text-muted-foreground), dd ise kurumsal "istatistik
              kutusu" reçetesiyle (operation-status-card.tsx#SummaryStat İLE
              AYNI rounded-[10px]/border/bg-background kalıbı, yalnızca
              değerler burada sayfanın asıl içeriği olduğu için biraz daha
              büyük text-lg) belirgin — Ürün Cinsi/Adedi/Tonaj ilk bakışta
              okunsun diye.
            */}
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {job.productQuantity !== undefined && (
                <div className="min-w-0 rounded-[10px] border border-border bg-background px-4 py-3">
                  <dt className="text-xs text-muted-foreground">Ürün Adedi</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">
                    {formatProductQuantity(job.productQuantity)}
                  </dd>
                </div>
              )}
              {job.productTonnage !== undefined && (
                <div className="min-w-0 rounded-[10px] border border-border bg-background px-4 py-3">
                  <dt className="text-xs text-muted-foreground">Tonaj</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">
                    {formatProductTonnage(job.productTonnage)}
                  </dd>
                </div>
              )}
              <div className="min-w-0 rounded-[10px] border border-border bg-background px-4 py-3">
                <dt className="text-xs text-muted-foreground">Ürün Cinsi</dt>
                <dd className="mt-1 break-words text-lg font-semibold text-foreground">{job.productType}</dd>
              </div>
            </dl>
          </div>
        )}
        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">İş Açıklaması</h2>
          {/* Önceki text-sm/text-muted-foreground kombinasyonu bu bölümü çok
              soluk/geri planda gösteriyordu (bkz. görev tanımı) — text-base/
              text-foreground'a çıkarıldı, satır aralığı (leading-relaxed)
              korunarak uzun açıklamalar hâlâ rahat okunabilir kalıyor. */}
          <p className="mt-3 break-words text-base leading-relaxed text-foreground">
            {job.description}
          </p>
        </div>
        <NakliyeRouteCard job={job} offers={offers} session={session} />
        {storageDurationDays !== null && (
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
              <Clock className="h-5 w-5 text-accent" aria-hidden="true" />
              Depolama Süresi
            </h2>
            <p className="mt-3 text-2xl font-semibold text-foreground">{storageDurationDays} gün</p>
          </div>
        )}
        {isCustomsBrokerageCategory(job.category) && (
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
              <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
              Gümrük Müşavirliği Bilgileri
            </h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">İşlem Türü</dt>
                <dd className="text-right text-foreground">
                  {job.customsTransactionType ? getCustomsTransactionTypeLabel(job.customsTransactionType) ?? "-" : "-"}
                </dd>
              </div>
              {job.customsRequestedServices && job.customsRequestedServices.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Talep Edilen Hizmetler</dt>
                  <dd className="text-right text-foreground">
                    {getCustomsRequestedServiceLabels(job.customsRequestedServices).join(", ")}
                  </dd>
                </div>
              )}
              {job.customsProductType && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Ürün Cinsi</dt>
                  <dd className="text-right text-foreground">{job.customsProductType}</dd>
                </div>
              )}
            </dl>
            {job.customsDocuments && job.customsDocuments.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground">Destekleyici Evraklar</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {job.customsDocuments.map((document) => (
                    <li key={document.id}>
                      <CustomsDocumentLink document={document} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {job.operationDetails.trim().length > 0 && (
          // "Operasyon Detayları" form alanı ilan oluşturma/düzenlemeden
          // kaldırıldı (bkz. görev tanımı) — bu bölüm yalnızca bu
          // değişiklikten ÖNCE gerçek bir metinle oluşturulmuş eski
          // ilanlarda görünür; yeni ilanlarda alan hep boş olduğu için bu
          // kart hiç render edilmez (görüntülemenin kendisi kaldırılmadı,
          // yalnızca artık boş bir kutu göstermesi engellendi).
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
              <ClipboardList className="h-5 w-5 text-accent" aria-hidden="true" />
              Operasyon Detayları
            </h2>
            <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">
              {job.operationDetails}
            </p>
          </div>
        )}

        {/*
          Diğer TÜM bilgi kartlarıyla AYNI `rounded-card border ... bg-surface
          p-6` kabuğu — önceki iki sütunlu tasarımda bu bölüm HİÇ kart kabuğu
          taşımıyordu (sağ sütunun kendi hizalaması yeterliydi); tek sütunlu
          akışta bu fark birebir aynı sayfada üst üste dizilince (kartların sol
          kenarları hizasız kalıyordu) fark edilir hâle geldi — "Teklif
          formunun genişliği bilgi kartlarıyla uyumlu ve dengeli olsun" (bkz.
          görev tanımı) gereksinimini bu sağlıyor. OfferPanel'in kendi iç
          durumları (REOFFER_BLOCKED, süre dolmuş, kapasite dolu, vb.) zaten
          `bg-background` kartlar kullanıyor — bu, Ürün Bilgileri kartının
          kendi `bg-background` istatistik kutularını AYNEN nasıl iç içe
          kullandığıyla BİREBİR aynı, projede zaten var olan bir desen; yeni
          bir görsel dil eklenmedi.
        */}
        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Teklif Ver</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Yalnızca Hizmet Veren kullanıcılar bu ilana teklif verebilir.
          </p>
          <div className="mt-4">
            {isJobOpenForOffers(job.status) ? (
              <OfferPanel job={job} offers={offers} />
            ) : (
              <p className="rounded-card border border-border bg-background p-6 text-sm leading-relaxed text-muted-foreground">
                Bu ilan şu anda teklif almaya açık değil.
              </p>
            )}
          </div>
        </div>
      </div>

      {job.operationId && (
        <div className="mt-6">
          <OperationStatusCard currentJob={job} offers={offers} session={session} />
        </div>
      )}
    </div>
  );
}
