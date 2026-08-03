"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildCategoryOptions,
  buildDistrictOptions,
  buildFacilityOptions,
  buildNakliyeDeliveryProvinceOptions,
  buildNakliyePickupProvinceOptions,
  buildProvinceOptions,
  DEFAULT_JOB_LISTING_FILTERS,
  hasActiveFilters,
  matchesDateBucket,
  matchesDistrictFilter,
  matchesFacilityFilter,
  matchesJobCategory,
  matchesNakliyeDeliveryDistrictFilter,
  matchesNakliyeDeliveryProvinceFilter,
  matchesNakliyePickupDistrictFilter,
  matchesNakliyePickupProvinceFilter,
  matchesOfferStatusFilter,
  matchesProvinceFilter,
  type JobListingFilterState,
} from "../_lib/job-listing-filters";
import { isTransportationCategory } from "../_lib/nakliye-route";
import { isJobFullyCompletedForListing } from "../_lib/job-completion";
import { buildJobListingRows, groupJobListingRowsByOperation } from "../_lib/job-listing-row";
import { isJobListingExpired } from "../_lib/job-publish-window";
import { isJobManuallyClosed } from "../_lib/job-closure";
import { useFilterVisibleJobs } from "../_lib/job-visibility";
import { useMediaQuery } from "../_lib/use-media-query";
import { recordJobViewed } from "../_lib/recently-viewed-jobs";
import {
  getStorageGroupCategoryIds,
  isServiceCategoryId,
  resolveLegacyJobCategoryToId,
  STORAGE_SERVICE_GROUP_ID,
} from "../_lib/service-catalog";
import type { Session } from "../_lib/types";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useProviderServiceCategoryIds } from "../_lib/use-provider-services";
import { JobListingCards } from "./job-listing-cards";
import { JobListingFilterBar } from "./job-listing-filter-bar";
import { JobListingTable } from "./job-listing-table";

const PAGE_SIZE = 24;

/**
 * Hizmet Veren'in "İş İlanları" (Aktif İlanlar) ana operasyon ekranı.
 * Eskiden burada "Teklife Açık"/"Teklife Kapalı" iki ayrı bölüm vardı — bu
 * ayrım tamamen kaldırıldı: bir ilana başka bir Hizmet Veren'in teklifi
 * kabul edilmiş olsa bile ilan burada görünmeye ve yeni teklif almaya devam
 * eder (Tek Aktif Kabul kuralı hiç değişmedi, yalnızca Kabul Et/Reddet
 * aksiyonları üzerinde uygulanıyor — bkz. job-requests.ts#isOfferPendingActionBlocked).
 */
export function ProviderJobListing({ session }: { session: Session }) {
  const jobs = useAllJobs();
  const offers = useAllOffers();
  // Yalnızca TEK bir ağaç (tablo YA DA kart) her zaman mount edilir — ikisini
  // birden DOM'da tutup CSS ile gizlemek aynı ilan başlığını/linkini iki kez
  // yazardı (erişilebilirlik ağaçlarında/aramada tekrar, ayrıca her satırın
  // thumbnail'inin İKİ KEZ IndexedDB'den çözülmesi anlamına gelirdi — gereksiz
  // render/iş yükü). Bu bileşen ağacı yalnızca oturum çözüldükten SONRA
  // (use-session.ts'in SSR-güvenli null dönüşü) mount edildiği için
  // `useMediaQuery`nin istemci-taraflı okuması hydration uyuşmazlığı
  // yaratmaz.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Nakliyeci güzergâh görünümü: "Firma / Bölge / Konum" alanının yerine
  // yükleme→teslimat güzergâhının (bkz. nakliye-listing-route.tsx) geçmesi
  // İKİ koşula birden bağlıdır — bu ekranın kendi oturumu zaten her zaman
  // hizmet-veren olsa da (job-listing-screen.tsx bu bileşeni yalnızca o rol
  // için mount eder), rol kontrolü burada AYRICA yapılır (veri katmanı
  // fonksiyonlarının rol kontrolünü UI'ye güvenmeden tekrarlaması ile AYNI
  // savunma ilkesi). `useProviderServiceCategoryIds` reaktiftir — Hizmet
  // Bilgilerim'den Nakliye eklenip/çıkarılınca bu ekran sayfa yenilenmeden
  // günceller. Bir satırın GERÇEKTEN güzergâh gösterip göstermeyeceği
  // (job.category === Nakliye VE teslimat bilgisi dolu) ayrıca `row.nakliyeRoute`
  // üzerinden kontrol edilir (bkz. job-listing-table.tsx/job-listing-cards.tsx)
  // — bu yalnızca "izleyici bir Nakliyeci mi" sorusuna cevap verir, Gümrük
  // Müşavirliği de seçmiş bir Nakliyeci'nin Gümrük satırlarını ETKİLEMEZ.
  const viewerServiceCategoryIds = useProviderServiceCategoryIds(session.id);
  const viewerIsNakliyeci = session.role === "hizmet-veren" && viewerServiceCategoryIds.some(isTransportationCategory);

  // Ana sayfadaki rol bazlı hizmet bölümü (services-section.tsx) bir
  // Hizmet Veren kartına tıklandığında buraya `?kategori=<serviceId>` ile
  // yönlendirir — filtre ismiyle DEĞİL, service-catalog.ts'in merkezi id
  // uzayıyla eşleşir (aynı id `matchesJobCategory`/`buildCategoryOptions`
  // tarafından zaten kullanılıyor). Yalnızca İLK render'da okunur: bu sayfa
  // her navigasyonda yeniden mount olduğundan (ayrı bir route), geri/ileri
  // gezinme her zaman URL'deki güncel kategoriyle doğru başlangıç filtresini
  // üretir — kullanıcı sonradan filtreyi değiştirir/temizlerse bu yalnızca
  // `filters` state'inde kalır, URL'e geri yazılmaz (mevcut davranış).
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<JobListingFilterState>(() => {
    const categoryParam = searchParams.get("kategori");
    return {
      ...DEFAULT_JOB_LISTING_FILTERS,
      category: categoryParam && isServiceCategoryId(categoryParam) ? categoryParam : "",
    };
  });
  // Ana sayfadaki birleşik "Depolama Hizmetleri" kartı (bkz. services-section.tsx)
  // tek bir alt kategori id'si DEĞİL, `STORAGE_SERVICE_GROUP_ID` GRUP id'sini
  // taşır — job-listing-filters.ts'in tek-kategori eşleştiren Hizmet Türü
  // filtresi (KASITLI OLARAK dokunulmadı, bkz. görev tanımı "İlan filtreleri")
  // bunu temsil edemez. Bu yüzden AYRI, salt bu tek giriş noktasına özel bir
  // ek filtre boyutu olarak tutulur: Hizmet Türü açılır listesi hâlâ "Tümü"
  // gösterir (filters.category boş kalır, kullanıcı normal kategori
  // filtresini istediği gibi kullanmaya devam edebilir), yalnızca aşağıdaki
  // `visibleJobIds` hesaplamasına "kategorisi bu 12 depolama alt türünden
  // biri mi" şeklinde bağımsız bir ek koşul eklenir. `kategori` her zamanki
  // gibi yalnızca İLK render'da okunur (bkz. yukarıdaki AYNI not).
  const [isStorageGroupFilterActive] = useState(() => searchParams.get("kategori") === STORAGE_SERVICE_GROUP_ID);
  const storageGroupCategoryIds = useMemo(
    () => (isStorageGroupFilterActive ? new Set(getStorageGroupCategoryIds()) : null),
    [isStorageGroupFilterActive],
  );
  const [page, setPage] = useState(1);

  // Nakliye izolasyonu (bkz. job-visibility.ts): görünürlük filtresi EN
  // ERKEN noktada, henüz durum/süre filtrelerinden bile ÖNCE uygulanır — bu
  // sayede aşağıdaki operasyon gruplama toplamları (job-listing-row.ts) dahil
  // her hesaplama, bu oturum için zaten "yalnızca görünür ilanlar"dan oluşan
  // bir dünya üzerinde çalışır; ayrı bir "gizli kardeş" özel durumu gerekmez.
  // `useFilterVisibleJobs` (reaktif hook, bkz. o dosyanın dokümantasyonu)
  // kullanılır — provider-services.ts değiştiğinde bu ekran sayfa
  // yenilenmeden otomatik güncellenir.
  const visibleJobs = useFilterVisibleJobs(session, jobs);

  // İlan Yayın Süresi Yönetimi: 14 günlük yayın süresi dolmuş bir ilan
  // (bkz. job-publish-window.ts, tek doğruluk kaynağı) Hizmet Veren'in
  // aktif ilan listesinde/aramasında/keşif sonuçlarında ARTIK görünmez —
  // sabit örnek ilanlar (jobs.ts, requesterId: null) `createdAt`e hiç sahip
  // olmadığından bu kuraldan otomatik ve güvenle muaf kalır, ayrı bir
  // istisna kodu gerekmez. İlan Kapatma: Hizmet Alan tarafından manuel
  // olarak kapatılmış (bkz. job-closure.ts) bir ilan da AYNI şekilde bu
  // listeden düşer — sabit örnek ilanlar `closedAt`e de hiç sahip
  // olamayacağından burada da otomatik muaftır. Tamamlanma: bir tekil ilanın
  // KENDİ, ya da bir operasyona bağlı ilansa operasyonun TÜM kardeşlerinin,
  // gerçek Offer/Job durumu "tamamlandi" olduğunda (bkz. job-completion.ts#
  // isJobFullyCompletedForListing, TEK doğruluk kaynağı) o ilan da AYNI
  // şekilde bu listeden düşer — ilan/teklif verisi SİLİNMEZ, yalnızca bu
  // keşif beslemesinden çıkar; "Tamamlandı"/geçmiş sekmeleri (job-requests-
  // panel.tsx, my-offers-panel.tsx) ve operation-status-card.tsx bu
  // fonksiyonu HİÇ kullanmaz, kendi yollarından görünmeye devam eder.
  const activeJobs = useMemo(
    () =>
      visibleJobs.filter(
        (job) =>
          job.status === "yayinda" &&
          !isJobListingExpired(job, offers) &&
          !isJobManuallyClosed(job) &&
          !isJobFullyCompletedForListing(job, offers),
      ),
    [visibleJobs, offers],
  );

  const rows = useMemo(
    () => buildJobListingRows(activeJobs, offers, session.id),
    [activeJobs, offers, session.id],
  );

  const categoryOptions = useMemo(() => buildCategoryOptions(), []);
  // Türkiye Geneli İl/İlçe — İl seçenekleri artık İlçe/Bölge-Tesis
  // filtreleriyle AYNI ilkeyle turkey-locations.ts'in merkezi 81 illik
  // referans verisinden gelir, o an ekrandaki aktif ilanlardan DEĞİL (bkz.
  // job-listing-filters.ts#buildProvinceOptions'ın kendi dokümanı) — bu
  // yüzden `activeJobs`e bağımlı değildir. Nakliye pickup/delivery İl
  // seçenekleri (aşağıda) BİLEREK bu değişiklikten HARİÇ tutulur ve kendi
  // "gerçek kayıtlı güzergâh verisinden türet" ilkesini korur (bkz. o
  // fonksiyonların kendi dokümanı).
  const provinceOptions = useMemo(() => buildProvinceOptions(), []);
  const districtOptions = useMemo(() => buildDistrictOptions(filters.province), [filters.province]);
  const facilityOptions = useMemo(
    () => buildFacilityOptions(filters.province, filters.district),
    [filters.province, filters.district],
  );
  // Nakliye Güzergâh Yönetimi — yalnızca Hizmet Türü Nakliye iken kullanılır
  // (bkz. job-listing-filter-bar.tsx). İl seçenekleri `activeJobs`teki GERÇEK
  // Nakliye ilanlarından türetilir (görev tanımı madde 9), İlçe seçenekleri
  // ise (buildDistrictOptions'ın kendisi zaten ilan verisinden bağımsız,
  // turkey-locations.ts referans verisinden geldiği için) mevcut İlçe/Bölge-Tesis
  // filtreleriyle AYNI fonksiyon yeniden kullanılır.
  const nakliyePickupProvinceOptions = useMemo(() => buildNakliyePickupProvinceOptions(activeJobs), [activeJobs]);
  const nakliyePickupDistrictOptions = useMemo(
    () => buildDistrictOptions(filters.nakliyePickupProvince),
    [filters.nakliyePickupProvince],
  );
  const nakliyeDeliveryProvinceOptions = useMemo(() => buildNakliyeDeliveryProvinceOptions(activeJobs), [activeJobs]);
  const nakliyeDeliveryDistrictOptions = useMemo(
    () => buildDistrictOptions(filters.nakliyeDeliveryProvince),
    [filters.nakliyeDeliveryProvince],
  );

  // Bir satırın filtre kriterlerini TEK BAŞINA (kendi kategorisi/ilçesi/
  // tesisi/tarihi/teklif durumu) geçip geçmediği — filtre mantığı hiç
  // değişmedi, yalnızca artık bir Set'e (visibleJobIds) toplanıyor. Aşama
  // 5.1: bu, bir operasyonun listede GÖRÜNÜP GÖRÜNMEYECEĞİNİ belirlemek için
  // kullanılır (üyelerinden en az biri geçerse operasyon görünür) — kartın
  // toplam/ilerleme/teklif sayısı içeriğini KÜÇÜLTMEK için değil (bkz.
  // job-listing-row.ts#groupJobListingRowsByOperation).
  // Nakliye Güzergâh Yönetimi: Hizmet Türü Nakliye iken genel (Türkiye
  // geneli serbestçe seçilebilir) İl/İlçe/Liman-Sanayi-OSB eşleştirmesi
  // Nakliye satırlarına UYGULANMAZ — bunun yerine dört ayrı pickup/delivery
  // filtresi kullanılır (bkz. job-listing-filter-bar.tsx). Nakliye DIŞINDAKİ
  // tüm kategoriler için eşleştirme hiç değişmedi.
  const isNakliyeFilterActive = isTransportationCategory(filters.category);
  const visibleJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!matchesJobCategory(row.job, filters.category)) continue;
      if (storageGroupCategoryIds) {
        const resolvedCategoryId = resolveLegacyJobCategoryToId(row.job.category);
        if (!resolvedCategoryId || !storageGroupCategoryIds.has(resolvedCategoryId)) continue;
      }
      if (isNakliyeFilterActive) {
        if (!matchesNakliyePickupProvinceFilter(row.job, filters.nakliyePickupProvince)) continue;
        if (!matchesNakliyePickupDistrictFilter(row.job, filters.nakliyePickupDistrict)) continue;
        if (!matchesNakliyeDeliveryProvinceFilter(row.job, filters.nakliyeDeliveryProvince)) continue;
        if (!matchesNakliyeDeliveryDistrictFilter(row.job, filters.nakliyeDeliveryDistrict)) continue;
      } else {
        if (!matchesProvinceFilter(row.job, filters.province)) continue;
        if (!matchesDistrictFilter(row.job, filters.district)) continue;
        if (!matchesFacilityFilter(row.job, filters.facility)) continue;
      }
      if (!matchesDateBucket(row.job.workDate, filters.dateBucket)) continue;
      if (!matchesOfferStatusFilter(row.job.id, session.id, filters.offerStatus)) continue;
      ids.add(row.job.id);
    }
    return ids;
  }, [rows, filters, session.id, isNakliyeFilterActive, storageGroupCategoryIds]);

  // Çoklu Hizmet Operasyonu — Aşama 5.1: gruplama artık TÜM (`rows`,
  // filtresiz) ilanlar üzerinden çalışır — bir operasyonun toplam/tamamlanan/
  // ilerleme/teklif sayısı HER ZAMAN operasyonun GERÇEK tüm üyelerinden
  // hesaplanır, yalnızca filtreyi geçen alt kümeden DEĞİL. `visibleJobIds`
  // yalnızca "bu operasyon/tekil ilan listede görünsün mü" kararı için
  // kullanılır (bkz. job-listing-row.ts#groupJobListingRowsByOperation).
  // Sayfalama bu birleştirilmiş liste üzerinde çalışır ki bir operasyon da
  // sayfa boyutuna TEK bir öğe olarak sayılsın.
  const displayItems = useMemo(
    () => groupJobListingRowsByOperation(rows, visibleJobIds, offers),
    [rows, visibleJobIds, offers],
  );

  const pagedItems = useMemo(() => displayItems.slice(0, page * PAGE_SIZE), [displayItems, page]);
  const hasMore = pagedItems.length < displayItems.length;

  function handleFiltersChange(next: JobListingFilterState) {
    setFilters(next);
    setPage(1);
  }

  function handleReset() {
    setFilters(DEFAULT_JOB_LISTING_FILTERS);
    setPage(1);
  }

  function handleJobClick(jobId: string) {
    recordJobViewed(session.id, jobId);
  }

  return (
    <>
      {/* Görsel olarak kaldırıldı (bkz. yukarıdaki not) ama sayfanın hâlâ
          geçerli bir h1'i olsun diye erişilebilirlik ağacında duruyor —
          ekran okuyucu kullanıcıları için sayfa yapısı bozulmasın diye. */}
      <h1 className="sr-only">Aktif İlanlar</h1>
      <JobListingFilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        categoryOptions={categoryOptions}
        provinceOptions={provinceOptions}
        districtOptions={districtOptions}
        facilityOptions={facilityOptions}
        nakliyePickupProvinceOptions={nakliyePickupProvinceOptions}
        nakliyePickupDistrictOptions={nakliyePickupDistrictOptions}
        nakliyeDeliveryProvinceOptions={nakliyeDeliveryProvinceOptions}
        nakliyeDeliveryDistrictOptions={nakliyeDeliveryDistrictOptions}
        onReset={handleReset}
        hasActiveFilters={hasActiveFilters(filters)}
      />

      <p aria-live="polite" aria-atomic="true" className="mt-3 text-sm font-medium text-foreground">
        {displayItems.length} Aktif İlan
      </p>

      {pagedItems.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Filtre kriterlerinize uyan ilan bulunamadı.
        </p>
      ) : isDesktop ? (
        <div className="mt-3 overflow-x-auto rounded-card border border-border bg-surface shadow-sm">
          <JobListingTable items={pagedItems} onJobClick={handleJobClick} showNakliyeRoute={viewerIsNakliyeci} />
        </div>
      ) : (
        <div className="mt-3">
          <JobListingCards items={pagedItems} onJobClick={handleJobClick} showNakliyeRoute={viewerIsNakliyeci} />
        </div>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setPage((current) => current + 1)}
            className="rounded-full border border-border bg-surface px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Daha Fazla Göster
          </button>
        </div>
      )}
    </>
  );
}
