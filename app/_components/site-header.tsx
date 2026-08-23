"use client";

import Link from "next/link";
import { useSession } from "../_lib/use-session";
import { HeaderAuthActions } from "./header-auth-actions";
import { MobileMenu } from "./mobile-menu";
import { NotificationBell } from "./notification-bell";
import { PageContainer } from "./page-container";

export function SiteHeader() {
  const session = useSession();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur">
      <PageContainer className="relative flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <span className="whitespace-nowrap text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            MALSEVK.com
          </span>
        </Link>

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
      </PageContainer>
    </header>
  );
}
