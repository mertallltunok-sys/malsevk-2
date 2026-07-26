"use client";

import { useMemo, useState } from "react";
import {
  buildCategoryOptions,
  buildDistrictOptions,
  buildFacilityOptions,
  DEFAULT_JOB_LISTING_FILTERS,
  hasActiveFilters,
  matchesDateBucket,
  matchesDistrictFilter,
  matchesFacilityFilter,
  matchesJobCategory,
  matchesOfferStatusFilter,
  matchesProvinceFilter,
  type JobListingFilterState,
} from "../_lib/job-listing-filters";
import { buildJobListingRows, groupJobListingRowsByOperation } from "../_lib/job-listing-row";
import { useMediaQuery } from "../_lib/use-media-query";
import { recordJobViewed } from "../_lib/recently-viewed-jobs";
import type { Session } from "../_lib/types";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
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

  const [filters, setFilters] = useState<JobListingFilterState>(DEFAULT_JOB_LISTING_FILTERS);
  const [page, setPage] = useState(1);

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === "yayinda"), [jobs]);

  const rows = useMemo(
    () => buildJobListingRows(activeJobs, offers, session.id),
    [activeJobs, offers, session.id],
  );

  const categoryOptions = useMemo(() => buildCategoryOptions(), []);
  const districtOptions = useMemo(() => buildDistrictOptions(filters.province), [filters.province]);
  const facilityOptions = useMemo(
    () => buildFacilityOptions(filters.province, filters.district),
    [filters.province, filters.district],
  );

  // Bir satırın filtre kriterlerini TEK BAŞINA (kendi kategorisi/ilçesi/
  // tesisi/tarihi/teklif durumu) geçip geçmediği — filtre mantığı hiç
  // değişmedi, yalnızca artık bir Set'e (visibleJobIds) toplanıyor. Aşama
  // 5.1: bu, bir operasyonun listede GÖRÜNÜP GÖRÜNMEYECEĞİNİ belirlemek için
  // kullanılır (üyelerinden en az biri geçerse operasyon görünür) — kartın
  // toplam/ilerleme/teklif sayısı içeriğini KÜÇÜLTMEK için değil (bkz.
  // job-listing-row.ts#groupJobListingRowsByOperation).
  const visibleJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!matchesJobCategory(row.job, filters.category)) continue;
      if (!matchesProvinceFilter(row.job, filters.province)) continue;
      if (!matchesDistrictFilter(row.job, filters.district)) continue;
      if (!matchesFacilityFilter(row.job, filters.facility)) continue;
      if (!matchesDateBucket(row.job.workDate, filters.dateBucket)) continue;
      if (!matchesOfferStatusFilter(row.job.id, session.id, filters.offerStatus)) continue;
      ids.add(row.job.id);
    }
    return ids;
  }, [rows, filters, session.id]);

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
        districtOptions={districtOptions}
        facilityOptions={facilityOptions}
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
          <JobListingTable items={pagedItems} onJobClick={handleJobClick} />
        </div>
      ) : (
        <div className="mt-3">
          <JobListingCards items={pagedItems} onJobClick={handleJobClick} />
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
