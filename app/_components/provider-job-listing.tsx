"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildCategoryOptions,
  buildDistrictOptions,
  buildFacilityOptions,
  buildProvinceOptions,
  DEFAULT_JOB_LISTING_FILTERS,
  hasActiveFilters,
  matchesCompanySearch,
  matchesDateBucket,
  matchesDistrictFilter,
  matchesFacilityFilter,
  matchesJobCategory,
  matchesJobSearch,
  matchesOfferStatusFilter,
  matchesProvinceFilter,
  type JobListingFilterState,
} from "../_lib/job-listing-filters";
import { buildJobListingRows, type JobListingRow } from "../_lib/job-listing-row";
import { useMediaQuery } from "../_lib/use-media-query";
import { recordJobViewed } from "../_lib/recently-viewed-jobs";
import type { Session } from "../_lib/types";
import { foldTurkish } from "../_lib/turkish-text";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useRecentlyViewedJobIds } from "../_lib/use-recently-viewed-jobs";
import { JobListingCards } from "./job-listing-cards";
import { JobListingFilterBar } from "./job-listing-filter-bar";
import { JobListingSearchBar } from "./job-listing-search-bar";
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
  const recentlyViewedIds = useRecentlyViewedJobIds(session.id);
  // Yalnızca TEK bir ağaç (tablo YA DA kart) her zaman mount edilir — ikisini
  // birden DOM'da tutup CSS ile gizlemek aynı ilan başlığını/linkini iki kez
  // yazardı (erişilebilirlik ağaçlarında/aramada tekrar, ayrıca her satırın
  // thumbnail'inin İKİ KEZ IndexedDB'den çözülmesi anlamına gelirdi — gereksiz
  // render/iş yükü). Bu bileşen ağacı yalnızca oturum çözüldükten SONRA
  // (use-session.ts'in SSR-güvenli null dönüşü) mount edildiği için
  // `useMediaQuery`nin istemci-taraflı okuması hydration uyuşmazlığı
  // yaratmaz.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<JobListingFilterState>(DEFAULT_JOB_LISTING_FILTERS);
  const [page, setPage] = useState(1);

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === "yayinda"), [jobs]);

  const rows = useMemo(
    () => buildJobListingRows(activeJobs, offers, session.id),
    [activeJobs, offers, session.id],
  );

  const categoryOptions = useMemo(() => buildCategoryOptions(), []);
  const provinceOptions = useMemo(() => buildProvinceOptions(activeJobs), [activeJobs]);
  const districtOptions = useMemo(
    () => buildDistrictOptions(activeJobs, filters.province),
    [activeJobs, filters.province],
  );
  const facilityOptions = useMemo(
    () => buildFacilityOptions(filters.province, filters.district),
    [filters.province, filters.district],
  );

  const foldedQuery = useMemo(() => foldTurkish(query.trim()), [query]);
  const foldedCompanyQuery = useMemo(() => foldTurkish(filters.companyQuery.trim()), [filters.companyQuery]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesJobSearch(row.job, foldedQuery)) return false;
      if (!matchesJobCategory(row.job, filters.category)) return false;
      if (!matchesProvinceFilter(row.job, filters.province)) return false;
      if (!matchesDistrictFilter(row.job, filters.district)) return false;
      if (!matchesFacilityFilter(row.job, filters.facility)) return false;
      if (!matchesCompanySearch(row.job, foldedCompanyQuery)) return false;
      if (!matchesDateBucket(row.job.workDate, filters.dateBucket)) return false;
      if (!matchesOfferStatusFilter(row.job.id, session.id, filters.offerStatus)) return false;
      return true;
    });
  }, [rows, foldedQuery, foldedCompanyQuery, filters, session.id]);

  const pagedRows = useMemo(() => visibleRows.slice(0, page * PAGE_SIZE), [visibleRows, page]);
  const hasMore = pagedRows.length < visibleRows.length;

  const recentlyViewedRows = useMemo(() => {
    const rowById = new Map(rows.map((row) => [row.job.id, row] as const));
    return recentlyViewedIds
      .map((id) => rowById.get(id))
      .filter((row): row is JobListingRow => row !== undefined)
      .slice(0, 8);
  }, [rows, recentlyViewedIds]);

  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }

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
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Aktif İlanlar
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin ve uygun ilanlara teklif
          gönderin.
        </p>
      </div>

      {recentlyViewedRows.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Son Görüntülenenler
          </h2>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {recentlyViewedRows.map((row) => (
              <Link
                key={row.job.id}
                href={`/ilanlar/${row.job.id}`}
                onClick={() => handleJobClick(row.job.id)}
                className="max-w-[220px] shrink-0 truncate rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {row.job.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <JobListingSearchBar value={query} onChange={handleQueryChange} />
        <JobListingFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          categoryOptions={categoryOptions}
          provinceOptions={provinceOptions}
          districtOptions={districtOptions}
          facilityOptions={facilityOptions}
          onReset={handleReset}
          hasActiveFilters={hasActiveFilters(filters)}
        />
      </div>

      <p aria-live="polite" aria-atomic="true" className="mt-6 text-sm font-medium text-foreground">
        {visibleRows.length} Aktif İlan
      </p>

      {pagedRows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Arama/filtre kriterlerinize uyan ilan bulunamadı.
        </p>
      ) : isDesktop ? (
        <div className="mt-4 overflow-x-auto rounded-card border border-border bg-surface">
          <JobListingTable rows={pagedRows} onJobClick={handleJobClick} />
        </div>
      ) : (
        <div className="mt-4">
          <JobListingCards rows={pagedRows} onJobClick={handleJobClick} />
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
