"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { useDropdown } from "../_lib/use-dropdown";
import { useScrollLock } from "../_lib/use-scroll-lock";
import { HeaderAuthActions } from "./header-auth-actions";

type NavLink = { href: string; label: string };

const createJobCtaClass =
  "mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Header artık layout.tsx içinde yaşadığı için sayfa geçişlerinde
 * yeniden monte olmuyor. Menü, linke tıklayınca, dışına/karartılmış alana
 * tıklayınca veya Escape'e basınca kapanır (kapatma mantığının çoğu
 * use-dropdown.ts'te — bu hook değiştirilmedi, bildirim zili ve profil
 * menüsü de aynı hook'u kullanıyor). Panel + perde her zaman DOM'da kalır
 * (yalnızca opaklık/transform ile gizlenir) ki kapanış da açılış gibi
 * CSS geçişiyle yumuşak olsun; `inert`, kapalıyken içindeki linklerin
 * klavye/screen-reader ile erişilememesini sağlar.
 */
export function MobileMenu({
  navLinks,
  showCreateJobCta = false,
}: {
  navLinks: NavLink[];
  showCreateJobCta?: boolean;
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  useScrollLock(open);

  function closeIfLinkClicked(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a")) setOpen(false);
  }

  return (
    <div ref={containerRef} className="contents">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="mobil-menu-panel"
        className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 md:hidden"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
        <span className="sr-only">{open ? "Menüyü kapat" : "Menüyü aç"}</span>
      </button>

      {/* Karartılmış perde: yalnızca aşağıya, header'ın altını kaplar. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-x-0 top-16 bottom-0 z-50 bg-black/50 transition-opacity duration-200 ease-out motion-reduce:transition-none md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div
        id="mobil-menu-panel"
        inert={!open}
        onClick={closeIfLinkClicked}
        className={`absolute inset-x-0 top-16 z-50 max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain border-b border-border bg-surface shadow-md transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none md:hidden ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-1 p-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-background hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {link.label}
            </Link>
          ))}
          {showCreateJobCta && (
            <Link href="/hizmet-talebi-olustur" className={createJobCtaClass}>
              Hizmet Talebi Oluştur
            </Link>
          )}
          <HeaderAuthActions layout="mobile" />
        </div>
      </div>
    </div>
  );
}
