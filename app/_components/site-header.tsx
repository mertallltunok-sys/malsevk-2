"use client";

import { Anchor } from "lucide-react";
import Link from "next/link";
import { useSession } from "../_lib/use-session";
import { HeaderAuthActions } from "./header-auth-actions";
import { MobileMenu } from "./mobile-menu";
import { NotificationBell } from "./notification-bell";

const navLinks = [{ href: "/#nasil-calisir", label: "Nasıl Çalışır" }];

const navLinkClass =
  "rounded-sm text-sm font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

const createJobCtaClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

export function SiteHeader() {
  // Yalnızca Hizmet Alan oturumunda gösterilir (bkz. header-auth-actions.tsx
  // ile aynı useSession() deseni) — giriş yapılmamışsa (session null) veya
  // Hizmet Veren ise bu bilerek false kalır, mevcut düzen hiç değişmez.
  const session = useSession();
  const showCreateJobCta = session?.role === "hizmet-alan";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Anchor className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              MALSEVK.COM
            </span>
            <span className="text-xs text-muted-foreground">
              Lojistik Hizmet Platformu
            </span>
          </span>
        </Link>

        <nav
          aria-label="Ana menü"
          className="hidden items-center gap-8 md:flex"
        >
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass}>
              {link.label}
            </Link>
          ))}
          {showCreateJobCta && (
            <Link href="/hizmet-talebi-olustur" className={createJobCtaClass}>
              Hizmet Talebi Oluştur
            </Link>
          )}
        </nav>

        <HeaderAuthActions layout="desktop" />

        {/* Mobilde bildirim zili, hamburger menüsünün AÇILMASINA gerek
            kalmadan her zaman erişilebilir olsun diye MobileMenu'nün dropdown
            panelinin dışında, header'ın kalıcı satırında (hamburger'ın hemen
            yanında) render edilir — aksi halde yalnızca menü açıkken görünür
            olurdu (bkz. header-auth-actions.tsx'in "mobile" dalı, ki o hâlâ
            MobileMenu'nün panelinin içinde kalıyor, profil menüsü için). */}
        <div className="flex items-center gap-1 md:hidden">
          {session && <NotificationBell session={session} />}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
