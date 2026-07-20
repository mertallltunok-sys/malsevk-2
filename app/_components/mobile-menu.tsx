"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { useDropdown } from "../_lib/use-dropdown";
import { HeaderAuthActions } from "./header-auth-actions";

type NavLink = { href: string; label: string };

/**
 * Header artık layout.tsx içinde yaşadığı için sayfa geçişlerinde
 * yeniden monte olmuyor. Menü, linke tıklayınca, dışına tıklayınca veya
 * Escape'e basılınca kapanır (bkz. use-dropdown.ts).
 */
export function MobileMenu({ navLinks }: { navLinks: NavLink[] }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();

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

      {open && (
        <div
          id="mobil-menu-panel"
          onClick={closeIfLinkClicked}
          className="absolute inset-x-0 top-16 flex flex-col gap-1 border-b border-border bg-surface p-4 md:hidden"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-background hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {link.label}
            </Link>
          ))}
          <HeaderAuthActions layout="mobile" />
        </div>
      )}
    </div>
  );
}
