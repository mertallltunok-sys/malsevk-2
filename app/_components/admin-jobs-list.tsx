"use client";

import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, listJobsForAdmin, type AdminJobListItem, type AdminJobStatus } from "../_lib/admin-jobs";
import { listServiceCategoryOptions, type ServiceCategoryOption } from "../_lib/admin-companies";
import { getJobModerationStatusLabel, getJobModerationStatusTone } from "../_lib/job-moderation";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const STATUS_OPTIONS = Object.entries(JOB_STATUS_LABEL) as [AdminJobStatus, string][];

/** İlan Onayı — "Onay Bekleyen" belirgin şekilde en solda/ilk sekme (görev bölüm 5, 13: "belirgin şekilde gösterilsin"). */
type ModerationTabKey = "pending_review" | "approved" | "rejected" | "all";
const MODERATION_TABS: { key: ModerationTabKey; label: string }[] = [
  { key: "pending_review", label: "Onay Bekleyen" },
  { key: "approved", label: "Yayındaki / Onaylanan" },
  { key: "rejected", label: "Reddedilen" },
  { key: "all", label: "Tümü" },
];

export function AdminJobsList() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<AdminJobListItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [serviceCategories, setServiceCategories] = useState<ServiceCategoryOption[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [moderationTab, setModerationTab] = useState<ModerationTabKey>("pending_review");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // refreshKey değiştiğinde (Yeniden Dene) loading/loadError sıfırlaması
  // BİLEREK burada değil, `handleRetry` (gerçek bir kullanıcı olayı
  // işleyicisi) içinde yapılır — bu proje `react-hooks/set-state-in-effect`
  // kuralını zorunlu kılar, bir effect gövdesinde SENKRON setState çağrısı
  // lint hatası verir (bkz. job-requests-panel.tsx'teki AYNI kalıp).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void Promise.all([listJobsForAdmin(), listServiceCategoryOptions()])
      .then(([jobsResult, categoriesResult]) => {
        if (cancelled) return;
        setJobs(jobsResult);
        setServiceCategories(categoriesResult);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  const provinceOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.province))).sort((a, b) => a.localeCompare(b, "tr-TR")), [jobs]);
  const districtOptions = useMemo(
    () =>
      Array.from(new Set(jobs.filter((job) => !provinceFilter || job.province === provinceFilter).map((job) => job.district))).sort((a, b) =>
        a.localeCompare(b, "tr-TR"),
      ),
    [jobs, provinceFilter],
  );

  const moderationTabCounts = useMemo(
    () =>
      ({
        pending_review: jobs.filter((job) => job.moderationStatus === "pending_review").length,
        approved: jobs.filter((job) => job.moderationStatus === "approved").length,
        rejected: jobs.filter((job) => job.moderationStatus === "rejected").length,
        all: jobs.length,
      }) satisfies Record<ModerationTabKey, number>,
    [jobs],
  );

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
    return jobs.filter((job) => {
      if (moderationTab !== "all" && job.moderationStatus !== moderationTab) return false;
      if (normalizedSearch) {
        const haystack = `${job.companyName ?? ""} ${job.requesterFullName ?? ""} ${job.title}`.toLocaleLowerCase("tr-TR");
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (categoryFilter && job.categoryId !== categoryFilter) return false;
      if (provinceFilter && job.province !== provinceFilter) return false;
      if (districtFilter && job.district !== districtFilter) return false;
      if (statusFilter && job.status !== statusFilter) return false;
      if (fromDate && job.createdAt < fromDate) return false;
      if (toDate && job.createdAt > `${toDate}T23:59:59`) return false;
      return true;
    });
  }, [jobs, moderationTab, search, categoryFilter, provinceFilter, districtFilter, statusFilter, fromDate, toDate]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/ilanlar" />;
  }
  if (!isAdmin) {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Yükleniyor...
      </div>
    );
  }
  {/* Bir Supabase sorgu hatası ASLA "0 Onay Bekleyen" gibi görünmemeli —
      bu, gerçekten bekleyen ilan yok durumundan ayırt edilemez SAHTE bir
      durum olurdu (görev bölüm 3). Yeniden Dene, aynı efekti `refreshKey`
      üzerinden yeniden tetikler. */}
  if (loadError) {
    return (
      <div className="rounded-card border border-danger/30 bg-danger/5 p-6 text-sm text-danger">
        <p className="font-medium">İlanlar yüklenemedi.</p>
        <p className="mt-1 text-danger/80">Supabase&apos;e erişilirken bir hata oluştu. Bu, bekleyen ilan olmadığı anlamına gelmez — sorgu başarısız oldu.</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setLoadError(false);
            setRefreshKey((key) => key + 1);
          }}
          className="mt-3 inline-flex items-center rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Yeniden Dene
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* İlan Onayı — görev bölüm 5/13: "Onay bekleyen ilanlar belirgin şekilde gösterilsin". Varsayılan sekme "Onay Bekleyen" (bkz. yukarıdaki useState). */}
      <nav aria-label="İlan onay durumu" className="flex flex-wrap gap-2">
        {MODERATION_TABS.map((tabItem) => {
          const active = moderationTab === tabItem.key;
          return (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setModerationTab(tabItem.key)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"
              }`}
            >
              {tabItem.label}
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-[11px] font-semibold text-muted-foreground">
                {moderationTabCounts[tabItem.key]}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="rounded-card border border-border bg-surface p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Firma veya ilan başlığı ara..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm hizmet türleri</option>
            {serviceCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={provinceFilter}
            onChange={(event) => {
              setProvinceFilter(event.target.value);
              setDistrictFilter("");
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm iller</option>
            {provinceOptions.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>

          <select
            value={districtFilter}
            onChange={(event) => setDistrictFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm ilçeler</option>
            {districtOptions.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm durumlar</option>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label="Oluşturulma tarihi (başlangıç)"
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              aria-label="Oluşturulma tarihi (bitiş)"
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} ilan bulundu.</p>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">İlan Başlığı</th>
              <th className="px-4 py-3">Hizmet Türü</th>
              <th className="px-4 py-3">Firma</th>
              <th className="px-4 py-3">İl</th>
              <th className="px-4 py-3">İlçe</th>
              <th className="px-4 py-3">Oluşturulma Tarihi</th>
              <th className="px-4 py-3">Durum</th>
              <th className="px-4 py-3">Onay Durumu</th>
              <th className="px-4 py-3">Teklif Sayısı</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => (
              <tr key={job.id} className="border-b border-border last:border-b-0">
                <td className="max-w-[220px] truncate px-4 py-3 font-medium text-foreground" title={job.title}>
                  {job.title}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{job.categoryLabel}</td>
                <td className="px-4 py-3 text-muted-foreground">{job.companyName ?? job.requesterFullName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{job.province}</td>
                <td className="px-4 py-3 text-muted-foreground">{job.district}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(job.createdAt).toLocaleDateString("tr-TR")}</td>
                <td className="px-4 py-3">
                  <StatusBadge label={JOB_STATUS_LABEL[job.status]} tone={JOB_STATUS_TONE[job.status]} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge label={getJobModerationStatusLabel(job.moderationStatus)} tone={getJobModerationStatusTone(job.moderationStatus)} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{job.offerCount}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/ilanlar/${job.id}`}
                    className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Detay
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Arama/filtre kriterlerine uyan ilan bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
