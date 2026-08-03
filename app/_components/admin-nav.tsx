"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_TABS = [
  { href: "/admin", label: "Hizmet Veren Belge Kontrolü" },
  { href: "/admin/iletisim-mesajlari", label: "Bize Ulaşın Mesajları" },
];

/**
 * `/admin` altındaki iki bağımsız modül (belge kontrolü, Bize Ulaşın
 * mesajları) arasında gezinme — henüz paylaşılan bir "AdminLayout" yok
 * (bkz. CLAUDE.md "No real backend"), bu yüzden her iki sayfanın kendi
 * bileşeni bu KÜÇÜK, tekrar kullanılan navigasyonu kendi başlığının hemen
 * altına render eder; iki ayrı kopyası yazılmaz.
 */
export function AdminNav({ newContactMessageCount = 0 }: { newContactMessageCount?: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin modülleri" className="mb-6 flex flex-wrap gap-2 border-b border-border pb-4">
      {ADMIN_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? "bg-primary text-primary-foreground"
                : "border border-border text-foreground hover:border-primary/40"
            }`}
          >
            {tab.label}
            {tab.href === "/admin/iletisim-mesajlari" && newContactMessageCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">
                {newContactMessageCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
