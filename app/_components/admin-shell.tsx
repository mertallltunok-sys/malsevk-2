"use client";

import { LayoutDashboard, Building2, FileCheck2, BadgeCheck, ClipboardList, Workflow, Database } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ADMIN_MODULES = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/firmalar", label: "Firmalar", icon: Building2 },
  { href: "/admin/firma-belgeleri", label: "Firma Belgeleri", icon: FileCheck2 },
  { href: "/admin/rozet-yonetimi", label: "Rozet Yönetimi", icon: BadgeCheck },
  { href: "/admin/ilanlar", label: "İlan Yönetimi", icon: ClipboardList },
  { href: "/admin/operasyonlar", label: "Operasyon Yönetimi", icon: Workflow },
  { href: "/admin/sistem-beslemesi", label: "Sistem Beslemesi", icon: Database },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Admin paneli için paylaşılan sol sidebar + üst başlık + içerik kabuğu.
 * Faz 1 (Dashboard/Firmalar/Firma Belgeleri), Faz 2 (Rozet Yönetimi/İlan
 * Yönetimi/Operasyon Yönetimi) ve Faz 3 (Sistem Beslemesi) modüllerinin
 * tamamını listeler — 7 modül de gerçek, çalışan sayfalara bağlanır, hiçbiri
 * yer tutucu değildir.
 * `/admin/iletisim-mesajlari` (Bize Ulaşın mesajları — "Destek", Faz 1/2'nin
 * kapsamı dışı) bu kabuğu KULLANMAZ, kendi mevcut `AdminNav` şeridiyle
 * değişmeden kalır — bu iki farklı navigasyon tarzının aynı anda var olması
 * bilinçli bir kapsam sınırı, gelecekte tüm admin modülleri bu kabuğa
 * taşındığında birleştirilebilir.
 *
 * Mobilde: sidebar yerine üstte yatay kaydırılabilir bir pil şeridi
 * (AdminNav'ın mevcut görsel dilini yansıtır) — ayrı bir açılır çekmece/
 * overlay state'i GEREKTİRMEZ, salt CSS breakpoint'i ile çözülür (basit,
 * daha az hataya açık).
 */
export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col lg:flex-row lg:gap-8 lg:px-6 lg:py-10">
      {/* Mobil/tablet: yatay kaydırılabilir modül şeridi */}
      <nav aria-label="Admin modülleri" className="flex gap-2 overflow-x-auto border-b border-border bg-surface px-4 py-3 lg:hidden">
        {ADMIN_MODULES.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Masaüstü: sabit sol sidebar */}
      <aside className="hidden shrink-0 lg:block lg:w-64">
        <div className="sticky top-24 rounded-card border border-border bg-surface p-3">
          <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Yönetim Paneli
          </p>
          <nav aria-label="Admin modülleri" className="flex flex-col gap-1">
            {ADMIN_MODULES.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent-soft hover:text-accent"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">{title}</h1>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
