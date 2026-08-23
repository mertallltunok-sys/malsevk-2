"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getApprovalCenterItems, type ApprovalCenterItem } from "../_lib/admin-approval-center";
import { listHumanizedAdminAuditLog, type HumanizedAuditEntry } from "../_lib/admin-audit-log";
import {
  getAdminDashboardCounts,
  getRecentCompanies,
  type AdminDashboardCounts,
  type RecentCompany,
} from "../_lib/admin-dashboard-data";
import { getUnresolvedCriticalErrorCount, getSystemErrorSeverityLabel, listSystemErrorLogs, type SystemErrorLog } from "../_lib/system-health";
import { useSession } from "../_lib/use-session";
import { AdminCompanyAuthorizationCheckCard } from "./admin-company-authorization-check-card";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

/**
 * YÖNETİM ÖZETİ (görev bölüm 6-10, 20) — referans görselin ana sayfası.
 * Her kart burada YENİDEN sorgu yazmaz; tamamı ZATEN var olan/bu görev
 * kapsamında eklenen veri katmanı fonksiyonlarını (`admin-dashboard-data.ts`,
 * `admin-approval-center.ts`, `system-health.ts`, `admin-audit-log.ts`)
 * çağırır. Sorgu hatasında sahte "0" ASLA gösterilmez — `null` ile gerçek
 * sıfır ayırt edilir (bkz. admin-dashboard-data.ts'in kendi ilkesi).
 */

const PRIMARY_STAT_CARDS: { key: keyof AdminDashboardCounts | "pendingApprovals" | "criticalErrors"; label: string; href?: string }[] = [
  { key: "totalUsers", label: "Toplam Kullanıcı" },
  { key: "totalProviderCompanies", label: "Hizmet Veren Firma", href: "/admin/firmalar" },
  { key: "activeJobs", label: "Aktif İlan", href: "/admin/ilanlar" },
  { key: "pendingApprovals", label: "Bekleyen Onay", href: "/admin/onay-merkezi" },
  { key: "ongoingOperations", label: "Devam Eden Operasyon", href: "/admin/operasyonlar" },
  { key: "criticalErrors", label: "Kritik Sistem Hatası", href: "/admin/sistem-sagligi" },
];

const SECONDARY_STAT_CARDS: { key: keyof AdminDashboardCounts; label: string; href?: string }[] = [
  { key: "totalRequesters", label: "Hizmet Alan", href: "/admin/hizmet-alanlar" },
  { key: "openContactMessages", label: "Açık Destek Mesajı", href: "/admin/iletisim-mesajlari" },
  { key: "todayRegistrations", label: "Bugün Kayıt Olan Kullanıcı" },
  { key: "todayJobs", label: "Bugün Oluşturulan İlan", href: "/admin/ilanlar" },
  { key: "todayOffers", label: "Bugün Verilen Teklif", href: "/admin/operasyonlar" },
];

function StatCard({ label, value, href, tone }: { label: string; value: number | null; href?: string; tone?: "danger" }) {
  const content = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-heading ${tone === "danger" && value && value > 0 ? "text-danger" : "text-foreground"}`}>
        {value === null ? "—" : value}
      </p>
    </>
  );
  if (!href) {
    return <div className="rounded-card border border-border bg-surface p-5">{content}</div>;
  }
  return (
    <Link
      href={href}
      className="block rounded-card border border-border bg-surface p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {content}
    </Link>
  );
}

function ApprovalCenterPreviewCard({ items, loading }: { items: ApprovalCenterItem[] | null; loading: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold tracking-heading text-foreground">Onay Merkezi</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Öncelikli inceleme bekleyen işlemler</p>
        </div>
        {items && items.length > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-soft px-2 text-xs font-semibold text-accent">
            {items.length}
          </span>
        )}
      </div>
      <div className="mt-4">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Yükleniyor...
          </p>
        )}
        {!loading && items && items.length === 0 && <p className="text-sm text-muted-foreground">Bekleyen hiçbir onay işlemi yok.</p>}
        {!loading && items && items.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {items.slice(0, 5).map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.subjectName}</p>
                </div>
                <Link
                  href={item.href}
                  className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
                >
                  İncele
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/admin/onay-merkezi" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        Tüm Onayları Gör
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function SystemHealthPreviewCard({ logs, loading }: { logs: SystemErrorLog[] | null; loading: boolean }) {
  const openLogs = (logs ?? []).filter((log) => log.status !== "cozuldu");
  const criticalCount = openLogs.filter((log) => log.severity === "critical").length;
  const warningCount = openLogs.filter((log) => log.severity === "warning" || log.severity === "high").length;
  const resolvedCount = (logs ?? []).filter((log) => log.status === "cozuldu").length;

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-bold tracking-heading text-foreground">Sistem Sağlığı</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Otomatik hata tespiti ve çözüm özeti</p>

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor...
        </p>
      )}

      {!loading && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-danger">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">Kritik</p>
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{warningCount}</p>
              <p className="text-xs text-muted-foreground">Uyarı</p>
            </div>
            <div>
              <p className="text-xl font-bold text-success">{resolvedCount}</p>
              <p className="text-xs text-muted-foreground">Çözüldü</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {openLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Şu anda çözülmemiş bir hata kaydı yok.</p>
            ) : (
              openLogs.slice(0, 3).map((log) => (
                <Link
                  key={log.id}
                  href={`/admin/sistem-sagligi?hata=${log.id}`}
                  className="rounded-md border border-border p-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge label={getSystemErrorSeverityLabel(log.severity)} tone={log.severity === "critical" ? "danger" : "warning"} />
                    <span className="text-xs text-muted-foreground">{log.occurrenceCount} tekrar</span>
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium text-foreground">{log.message}</p>
                  {log.probableCause && <p className="mt-0.5 truncate text-xs text-muted-foreground">Muhtemel Neden: {log.probableCause}</p>}
                </Link>
              ))
            )}
          </div>
        </>
      )}

      <Link href="/admin/sistem-sagligi" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        Tüm Hataları İncele
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function RecentAdminActionsCard({ actions, loading }: { actions: HumanizedAuditEntry[] | null; loading: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-bold tracking-heading text-foreground">Son Admin İşlemleri</h2>
      {loading && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor...
        </p>
      )}
      {!loading && actions && actions.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Henüz kayıtlı admin işlemi yok.</p>}
      {!loading && actions && actions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {actions.slice(0, 6).map((action) => (
            <li key={action.id} className="text-sm">
              <p className="font-medium text-foreground">{action.title}</p>
              <p className="text-xs text-muted-foreground">
                {action.actorName ?? "Bilinmeyen"} · {new Date(action.createdAtIso).toLocaleString("tr-TR")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/islem-gecmisi" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        Tüm İşlem Geçmişini Gör
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function RecentCompaniesCard({ companies }: { companies: RecentCompany[] }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-bold tracking-heading text-foreground">Son Kayıt Olan Firmalar</h2>
      {companies.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Henüz kayıtlı firma yok.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {companies.map((company) => (
            <li key={company.id} className="text-sm">
              <p className="font-medium text-foreground">{company.companyName ?? company.fullName ?? "İsimsiz Firma"}</p>
              <p className="text-xs text-muted-foreground">{new Date(company.createdAt).toLocaleDateString("tr-TR")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminDashboardContent() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<AdminDashboardCounts | null>(null);
  const [recentCompanies, setRecentCompanies] = useState<RecentCompany[]>([]);
  const [approvalItems, setApprovalItems] = useState<ApprovalCenterItem[] | null>(null);
  const [errorLogs, setErrorLogs] = useState<SystemErrorLog[] | null>(null);
  const [criticalCount, setCriticalCount] = useState<number | null>(null);
  const [recentActions, setRecentActions] = useState<HumanizedAuditEntry[] | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void Promise.all([
      getAdminDashboardCounts(),
      getRecentCompanies(),
      getApprovalCenterItems().catch(() => []),
      listSystemErrorLogs().catch(() => []),
      getUnresolvedCriticalErrorCount(),
      listHumanizedAdminAuditLog({ limit: 10 }).catch(() => []),
    ]).then(([countsResult, companiesResult, approvalResult, errorLogsResult, criticalResult, actionsResult]) => {
      if (cancelled) return;
      setCounts(countsResult);
      setRecentCompanies(companiesResult);
      setApprovalItems(approvalResult);
      setErrorLogs(errorLogsResult);
      setCriticalCount(criticalResult);
      setRecentActions(actionsResult);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin" />;
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

  const pendingApprovalsCount = approvalItems ? approvalItems.length : null;
  const statValues: Record<string, number | null> = {
    ...(counts ?? {}),
    pendingApprovals: pendingApprovalsCount,
    criticalErrors: criticalCount,
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Platformdaki
          güncel durum ve öncelikli işlemler
        </p>
        <Link
          href="/admin/onay-merkezi"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Tüm İşlemleri Gör
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {PRIMARY_STAT_CARDS.map((card) => (
          <StatCard key={card.key} label={card.label} value={statValues[card.key] ?? null} href={card.href} tone={card.key === "criticalErrors" ? "danger" : undefined} />
        ))}
      </div>

      {criticalCount !== null && criticalCount > 0 && (
        <Link
          href="/admin/sistem-sagligi?onem=critical"
          className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/5 p-4 transition-colors hover:border-danger/50"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <p className="flex-1 text-sm font-medium text-danger">
            {criticalCount} kritik hata müdahale bekliyor
          </p>
          <span className="text-sm font-medium text-danger">Hataları İncele →</span>
        </Link>
      )}

      {counts && typeof counts.documentApprovalAuthorizationGaps === "number" && counts.documentApprovalAuthorizationGaps > 0 && (
        <Link
          href="/admin/firma-belgeleri"
          className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 transition-colors hover:border-warning/50"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm text-foreground">
            <span className="font-bold">{counts.documentApprovalAuthorizationGaps} belge</span> onaylı ama karşılığında aktif bir
            hizmet yetkisi yok — beklenmeyen bir tutarsızlık, incelemek için tıklayın.
          </p>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ApprovalCenterPreviewCard items={approvalItems} loading={false} />
        <SystemHealthPreviewCard logs={errorLogs} loading={false} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminCompanyAuthorizationCheckCard />
        <RecentAdminActionsCard actions={recentActions} loading={false} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {SECONDARY_STAT_CARDS.map((card) => (
          <StatCard key={card.key} label={card.label} value={counts ? counts[card.key] : null} href={card.href} />
        ))}
      </div>

      <RecentCompaniesCard companies={recentCompanies} />

      <div className="rounded-card border border-border bg-surface p-6">
        <h2 className="text-base font-bold tracking-heading text-foreground">Süresi Yaklaşan Belgeler</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Firma belgeleri için bir geçerlilik/son kullanma tarihi alanı mevcut veri modelinde bulunmuyor — bu nedenle burada sahte bir
          &ldquo;süresi yaklaşıyor&rdquo; sayısı gösterilmiyor. Bu alan gerçek bir tarih alanı eklendiğinde doldurulacaktır.
        </p>
      </div>
    </div>
  );
}
