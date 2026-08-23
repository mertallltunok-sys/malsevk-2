"use client";

import { ChevronDown, ExternalLink, LogOut } from "lucide-react";
import Link from "next/link";
import { getInitials } from "../_lib/profile";
import type { Session } from "../_lib/types";
import { useDropdown } from "../_lib/use-dropdown";
import { handleLogout } from "./profile-menu";

/**
 * Admin kabuğunun kendi üst çubuk profil widget'ı — mevcut, herkese açık
 * site `ProfileMenu`sinden BİLEREK ayrı: o bileşenin öğeleri (Hizmet
 * Taleplerim, Gelen Teklifler, Belge Yükleme...) hizmet-alan/hizmet-veren
 * panel akışlarına özeldir ve admin hesabına hiç uygulanmaz. Burada yalnızca
 * admin'e anlamlı iki eylem var: herkese açık siteye dönmek ve çıkış yapmak.
 * `handleLogout` (profile-menu.tsx'ten) AYNEN yeniden kullanılır — ikinci
 * bir çıkış fonksiyonu YOK. Admin'in kendi avatarı/logosu hiç yok (yalnızca
 * hizmet veren profilleri logo taşır), bu yüzden her zaman baş harfler
 * gösterilir (görev gereksinimi: "Mevcut avatar varsa kullan; yoksa isim
 * baş harflerini göster").
 */
export function AdminTopbarProfile({ session }: { session: Session }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {getInitials(session.name)}
        </span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-sm font-bold tracking-heading text-foreground">{session.name}</span>
          <span className="text-xs text-muted-foreground">Admin</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Yönetici menüsü"
          className="absolute right-0 top-12 z-50 w-56 rounded-card border border-border bg-surface p-2 shadow-md"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="text-sm font-bold tracking-heading text-foreground">{session.name}</p>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
          <div className="flex flex-col gap-0.5 py-1">
            <Link
              href="/"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Siteye Dön
            </Link>
            <button
              type="button"
              onClick={() => handleLogout()}
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Çıkış Yap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
