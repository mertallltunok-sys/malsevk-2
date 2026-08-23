"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { WhatsappSupportButton } from "./whatsapp-support-button";

/**
 * ADMIN PANELİ YENİDEN TASARIMI: `/admin/*` kendi bağımsız kabuğunu
 * (`AdminShell`) kullanır — herkese açık `SiteHeader`/`SiteFooter` ve
 * "7/24 Canlı Destek" WhatsApp balonu bu rotalarda ASLA görünmemeli (görev
 * gereksinimi). `app/layout.tsx` bu üç bileşeni artık doğrudan render ETMEZ,
 * bunun yerine TEK, kök seviyeli bir pathname kontrolü burada yapılır — her
 * sayfanın kendi route'unda ayrı ayrı "admin mi değil mi" kontrolü
 * TEKRARLANMAZ. `/admin` route grubu için Next.js'in paralel/nested layout
 * mekanizmasını (ayrı bir root layout) kullanmak yerine bu daha küçük,
 * tek dosyalık değişiklik tercih edildi — mevcut 14 admin sayfasının hiçbiri
 * taşınmadı/yeniden yapılandırılmadı.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <WhatsappSupportButton />
    </>
  );
}
