"use client";

import {
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Clock,
  Factory,
  HardHat,
  Inbox,
  LayoutDashboard,
  LogOut,
  Send,
  Settings,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getProviderOffersTabHref } from "../_lib/job-requests";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import type { Session } from "../_lib/types";
import { useDropdown } from "../_lib/use-dropdown";

type MenuItem = { label: string; href?: string; icon: LucideIcon };

const hizmetAlanMenuItems: MenuItem[] = [
  { label: "Profilim", href: "/panel/profil", icon: User },
  { label: "Panel Özeti", href: "/panel", icon: LayoutDashboard },
  { label: "Hizmet Taleplerim", href: "/panel/hizmet-taleplerim", icon: ClipboardList },
  { label: "Gelen Teklifler", href: "/panel/gelen-teklifler", icon: Inbox },
  { label: "Devam Eden İşler", href: "/panel/hizmet-taleplerim?durum=devam-eden", icon: Clock },
  { label: "Tamamlanan İşler", href: "/panel/hizmet-taleplerim?durum=tamamlandi", icon: CheckCircle2 },
  { label: "Bildirimler", href: "/panel/bildirimler", icon: Bell },
  { label: "Hesap Ayarları", href: "/panel/hesap-ayarlari", icon: Settings },
];

// "Kabul Edilen Teklifler" bilerek AYRI bir "kabul-edildi" sekmesine gitmez —
// job-requests.ts#getProviderOfferFilter'da böyle bir sekme yok (kabul
// edilmiş ama iş henüz başlamamış teklifler "aktif"e düşer, bkz. o dosyadaki
// dokümantasyon). Buradaki href, TEK doğruluk kaynağı olan
// getProviderOffersTabHref("aktif") ile üretilir — statik bir
// "?durum=kabul-edildi" yazılırsa my-offers-panel.tsx bunu tanımadığı için
// sessizce "Aktif" sekmesine düşer; aynı sonucu elle yazmak yerine merkezi
// yardımcı kullanılır.
const hizmetVerenMenuItems: MenuItem[] = [
  { label: "Profilim", href: "/panel/profil", icon: User },
  { label: "Panel Özeti", href: "/panel", icon: LayoutDashboard },
  { label: "Uygun İlanlar", href: "/ilanlar", icon: Briefcase },
  { label: "Verdiğim Teklifler", href: "/panel/tekliflerim", icon: Send },
  { label: "Kabul Edilen Teklifler", href: getProviderOffersTabHref("aktif"), icon: CircleCheck },
  { label: "Devam Eden İşler", href: "/panel/tekliflerim?durum=devam-eden", icon: Clock },
  { label: "Tamamlanan İşler", href: "/panel/tekliflerim?durum=tamamlandi", icon: CheckCircle2 },
  { label: "Bildirimler", href: "/panel/bildirimler", icon: Bell },
  { label: "Hesap Ayarları", href: "/panel/hesap-ayarlari", icon: Settings },
];

/**
 * SUPABASE AUTH GEÇİŞİ: eski `clearSession()` (localStorage'a doğrudan
 * yazma) yerine gerçek `supabase.auth.signOut()` çağrılır — bu, Supabase'in
 * kendi oturum çerezlerini/localStorage anahtarlarını temizler ve
 * `session.ts`'in `onAuthStateChange` dinleyicisini tetikleyerek uygulama
 * genelindeki `useSession()` önbelleğini otomatik olarak `null`a çevirir
 * (bkz. o dosyanın dokümantasyonu). `window.location.href = "/"` (tam sayfa
 * yenileme, `router.push` DEĞİL) BİLEREK korunur — mevcut davranışla aynı:
 * tüm client-side state'in (React ağacı, localStorage önbellekleri) sıfırdan
 * başlamasını garanti eder.
 */
export async function handleLogout() {
  const supabase = createSupabaseBrowserClient();
  await supabase.auth.signOut();
  window.location.href = "/";
}

function MenuRow({
  item,
  isActive,
  onNavigate,
}: {
  item: MenuItem;
  isActive: boolean;
  onNavigate: () => void;
}) {
  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm text-muted-foreground/70"
      >
        <span className="flex items-center gap-2.5">
          <item.icon className="h-4 w-4" aria-hidden="true" />
          {item.label}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Yakında
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      role="menuitem"
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isActive
          ? "bg-accent-soft font-medium text-primary"
          : "text-foreground hover:bg-background"
      }`}
    >
      <item.icon
        className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      {item.label}
    </Link>
  );
}

/**
 * Hizmet Alan -> minimal fabrika ikonu, Hizmet Veren -> minimal baretli
 * operatör ikonu, Admin -> kalkan ikonu (üçüncü, ayrı bir dal — admin bu
 * ikiden hiçbirine görsel olarak karışmamalı).
 */
function RoleIcon({ role, className }: { role: Session["role"]; className?: string }) {
  const Icon = role === "admin" ? ShieldCheck : role === "hizmet-veren" ? HardHat : Factory;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * ADMIN ETİKETİ UX DÜZELTMESİ (Supabase Geçişi Faz 2, görev bölüm 11): bu
 * etiket `session.role`den (bkz. session.ts — gerçek kaynağı `profiles.role`/
 * `is_admin()`, hiçbir hardcoded e-posta/`user_metadata` kontrolü yok) okur,
 * yalnızca görüntüleme metnini seçer — mevcut yetki mekanizması hiç
 * değişmedi. Normal Hizmet Alan/Hizmet Veren davranışı (aşağıdaki iki dal)
 * BİLEREK dokunulmadan kaldı; yalnızca üçüncü, önceden yanlışlıkla "Hizmet
 * Alan" dalına düşen `admin` durumu kendi metnini kazandı.
 */
function RoleLabel({ session }: { session: Session }) {
  const roleText = session.role === "admin" ? "Admin" : session.role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan";
  return (
    <div className="flex items-center gap-2.5">
      <RoleIcon role={session.role} className="h-5 w-5 shrink-0 text-foreground" />
      <div className="flex flex-col items-start leading-tight">
        <p className="text-sm font-bold tracking-heading text-foreground">{session.name}</p>
        <p className="text-xs text-muted-foreground">{roleText}</p>
      </div>
    </div>
  );
}

export function ProfileMenu({
  session,
  layout,
}: {
  session: Session;
  layout: "desktop" | "mobile";
}) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const items = session.role === "hizmet-veren" ? hizmetVerenMenuItems : hizmetAlanMenuItems;
  const pathname = usePathname();

  if (layout === "mobile") {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-1 pb-2">
          <RoleLabel session={session} />
        </div>
        {items.map((item) => (
          <MenuRow
            key={item.label}
            item={item}
            isActive={item.href === pathname}
            onNavigate={() => {}}
          />
        ))}
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Çıkış Yap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full px-2 py-1.5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <RoleLabel session={session} />
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Hesap menüsü"
          className="absolute right-0 top-12 z-50 w-64 rounded-card border border-border bg-surface p-2 shadow-md"
        >
          <div className="border-b border-border px-3 py-2.5">
            <RoleLabel session={session} />
          </div>
          <div className="flex flex-col gap-0.5 py-1">
            {items.map((item) => (
              <MenuRow
                key={item.label}
                item={item}
                isActive={item.href === pathname}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </div>
          <div className="border-t border-border pt-1">
            <button
              type="button"
              onClick={handleLogout}
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
