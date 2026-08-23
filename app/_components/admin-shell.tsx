"use client";

import {
  Building2,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileCheck2,
  HeartPulse,
  History,
  LayoutDashboard,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getApprovalCenterPendingCount } from "../_lib/admin-approval-center";
import { getUnresolvedCriticalErrorCount } from "../_lib/system-health";
import { useSession } from "../_lib/use-session";
import { AdminGlobalSearch } from "./admin-global-search";
import { AdminNotificationBell } from "./admin-notification-bell";
import { AdminTopbarProfile } from "./admin-topbar-profile";

/**
 * ADMİN PANELİ YENİDEN TASARIMI — referans görsele birebir uyumlu kabuk:
 * tam yükseklikte koyu lacivert sabit sidebar (MALSEVK.com markası +
 * "YÖNETİM PANELİ" ibaresi + 10 modüllük nav + ortam göstergesi), üstte
 * beyaz bir çubuk (genel arama + bildirim zili + profil), sağda açık gri
 * çalışma alanı. Önceki sürümün 7 modüllük, `rounded-card` kutu içindeki
 * sidebar'ının YERİNE geçer — mevcut 14 admin sayfasının hiçbiri, `<AdminShell
 * title="...">{children}</AdminShell>` çağırma şekli DEĞİŞMEDİĞİ için,
 * kendileri değiştirilmeden bu yeni kabuğu otomatik alır.
 *
 * Lacivert/beyaz renk şeması YENİ token İCAT ETMEZ — `bg-primary` zaten
 * `var(--navy-900)`dir (bkz. globals.css), aktif/pasif nav durumları o AYNI
 * markanın üzerine yarı saydam beyaz katmanlarla (`bg-white/10` vb.) kurulur.
 *
 * "Onay Merkezi"/"Sistem Sağlığı" rozet sayıları GERÇEK verilerden gelir
 * (bkz. admin-approval-center.ts / system-health.ts) — sorgu hatasında
 * rozet hiç gösterilmez (sahte "0" değil, sessizce gizlenir), gerçek 0 iken
 * de rozet hiç gösterilmez (0 göstermek gürültü olurdu, sıfır zaten "rozet
 * yok" ile eşdeğerdir).
 */

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badgeKey?: "onayMerkezi" | "sistemSagligi";
};

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Yönetim Özeti", icon: LayoutDashboard },
  { href: "/admin/onay-merkezi", label: "Onay Merkezi", icon: ClipboardCheck, badgeKey: "onayMerkezi" },
  { href: "/admin/hizmet-alanlar", label: "Hizmet Alanlar", icon: Users },
  { href: "/admin/firmalar", label: "Firmalar", icon: Building2 },
  { href: "/admin/firma-belgeleri", label: "Firma Belgeleri", icon: FileCheck2 },
  { href: "/admin/ilanlar", label: "İlan Yönetimi", icon: ClipboardList },
  { href: "/admin/operasyonlar", label: "Operasyonlar", icon: Workflow },
  { href: "/admin/sistem-beslemesi", label: "Sistem Beslemesi", icon: Database },
  { href: "/admin/sistem-sagligi", label: "Sistem Sağlığı", icon: HeartPulse, badgeKey: "sistemSagligi" },
  { href: "/admin/islem-gecmisi", label: "İşlem Geçmişi", icon: History },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBadge({ count }: { count: number | null }) {
  if (!count || count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SidebarNav({ pathname, badges, onNavigate }: { pathname: string; badges: Record<string, number | null>; onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin modülleri" className="flex flex-col gap-0.5 px-3">
      {ADMIN_NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        const badgeCount = item.badgeKey ? badges[item.badgeKey] : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
            <NavBadge count={badgeCount} />
          </Link>
        );
      })}
    </nav>
  );
}

function EnvironmentIndicator() {
  const isDevelopment = process.env.NODE_ENV !== "production";
  return (
    <div className="mt-auto flex items-center gap-2 border-t border-white/10 px-6 py-4 text-xs text-white/60">
      <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
      <span>{isDevelopment ? "Development" : "Production"} · Çevrimiçi</span>
    </div>
  );
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const [badges, setBadges] = useState<Record<string, number | null>>({ onayMerkezi: null, sistemSagligi: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getApprovalCenterPendingCount(), getUnresolvedCriticalErrorCount()]).then(([onayMerkezi, sistemSagligi]) => {
      if (cancelled) return;
      setBadges({ onayMerkezi, sistemSagligi });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Masaüstü: tam yükseklikte sabit lacivert sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-primary lg:flex">
        <div className="px-6 pb-5 pt-6">
          <p className="text-xl font-bold tracking-tight text-white">MALSEVK.com</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">Yönetim Paneli</p>
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          <SidebarNav pathname={pathname} badges={badges} />
        </div>
        <EnvironmentIndicator />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Mobil/tablet: yatay kaydırılabilir modül şeridi (mevcut desen korunur) */}
        <nav aria-label="Admin modülleri" className="flex gap-2 overflow-x-auto border-b border-border bg-primary px-4 py-3 lg:hidden">
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? badges[item.badgeKey] : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? "bg-white text-primary" : "border border-white/20 text-white/80 hover:border-white/40"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
                {badgeCount !== null && badgeCount > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Üst yönetim çubuğu */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-surface px-4 sm:px-6">
          <p className="hidden shrink-0 text-sm font-semibold text-foreground lg:block">Yönetim Paneli</p>
          <div className="flex-1">
            <AdminGlobalSearch />
          </div>
          {session && (
            <div className="flex shrink-0 items-center gap-1">
              <AdminNotificationBell adminUserId={session.id} />
              <AdminTopbarProfile session={session} />
            </div>
          )}
        </header>

        <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <header className="mb-6 border-b border-border pb-4">
            <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">{title}</h1>
          </header>
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
