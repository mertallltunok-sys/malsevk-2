"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import { useIsLocalDevHost } from "../_lib/use-local-dev-host";

/**
 * "Development Temizliği" görevinin demo-hesap altyapısı için giriş
 * ekranındaki kompakt, açılıp-kapanabilir seçim paneli. Yeni/ikinci bir
 * giriş sistemi DEĞİL — yalnızca `login-form.tsx`nin zaten var olan
 * e-posta/şifre alanlarını doldurur, kullanıcı hâlâ mevcut "Giriş Yap"
 * butonuna basarak gerçek `supabase.auth.signInWithPassword` akışını
 * kullanır (bkz. login-form.tsx#handleSubmit — burada hiç tekrarlanmaz).
 *
 * ÇİFT PROD KORUMASI (görev gereksinimi, `NODE_ENV` tek başına yeterli
 * SAYILMIYOR):
 *   1) Derleme zamanı — bu bileşen yalnızca çağıran tarafta
 *      (login-form.tsx) `process.env.NODE_ENV === "development"` ile
 *      koşullu render edilir; production build'inde bu koşul her zaman
 *      `false`e sabitlenir (Next.js'in kendi statik `process.env.NODE_ENV`
 *      değişimi), bu da hem JSX referansını hem bu modülün import
 *      bağını (dolayısıyla aşağıdaki 17 hesaplık listeyi/şifreyi) production
 *      bundle'ından TAMAMEN eler — yalnızca runtime'da gizlemez.
 *   2) Çalışma zamanı — `useIsLocalDevHost()` (use-media-query.ts ile AYNI
 *      useSyncExternalStore deseni) `window.location.hostname`in gerçekten
 *      `localhost`/`127.0.0.1` olduğunu doğrular; bir geliştiricinin
 *      `next dev`i herkese açık bir adreste çalıştırdığı senaryoyu kapatır.
 *      İkisinden BİRİ eksikse panel hiç render edilmez.
 *
 * Ortak demo şifresi `NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD` environment
 * değişkeninden okunur (bkz. .env.example) — normal uygulama koduna
 * hardcode edilmez (görev gereksinimi); Production ortamında bu değişken
 * hiç tanımlı olmamalıdır (yine de yukarıdaki 1. katman zaten bunu
 * production bundle'ına sokmaz).
 */

type DemoAccount = {
  label: string;
  email: string;
  role: "Hizmet Alan" | "Hizmet Veren";
  service?: string;
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  { label: "Demo İlan Veren", email: "ilanveren@demo.test", role: "Hizmet Alan" },
  { label: "Nakliyeci", email: "nakliyeci@demo.test", role: "Hizmet Veren", service: "Nakliye" },
  { label: "Gümrükçü", email: "gumrukcu@demo.test", role: "Hizmet Veren", service: "Gümrük Müşavirliği" },
  { label: "Lashingci", email: "lashingci@demo.test", role: "Hizmet Veren", service: "Lashing / Unlashing" },
  { label: "Gözetimci", email: "gozetimci@demo.test", role: "Hizmet Veren", service: "Gözetim Hizmetleri" },
  { label: "Forkliftçi", email: "forkliftci@demo.test", role: "Hizmet Veren", service: "Forklift" },
  { label: "Reach Stackerci", email: "reachci@demo.test", role: "Hizmet Veren", service: "Reach Stacker" },
  { label: "Vinççi", email: "vincci@demo.test", role: "Hizmet Veren", service: "Vinç" },
  { label: "Manliftçi", email: "manliftci@demo.test", role: "Hizmet Veren", service: "Manlift" },
  { label: "Forklift Operatörü", email: "forkliftop@demo.test", role: "Hizmet Veren", service: "Forklift Operatörü" },
  { label: "Reach Stacker Operatörü", email: "reachop@demo.test", role: "Hizmet Veren", service: "Reach Stacker Operatörü" },
  { label: "Vinç Operatörü", email: "vincop@demo.test", role: "Hizmet Veren", service: "Vinç Operatörü" },
  { label: "Manlift Operatörü", email: "manliftop@demo.test", role: "Hizmet Veren", service: "Manlift Operatörü" },
  { label: "Depocu", email: "depocu@demo.test", role: "Hizmet Veren", service: "Depolama Hizmetleri" },
  { label: "Personelci", email: "personelci@demo.test", role: "Hizmet Veren", service: "Personel Temini" },
  { label: "Acil Operasyoncu", email: "acilci@demo.test", role: "Hizmet Veren", service: "Acil Operasyon Desteği" },
  { label: "Geri Dönüşümcü", email: "donusumcu@demo.test", role: "Hizmet Veren", service: "Geri Dönüşüm & Atık Tahliye" },
];

const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD ?? "";

export function DemoAccountsPanel({ onSelectAccount }: { onSelectAccount: (email: string, password: string) => void }) {
  const isLocalDevHost = useIsLocalDevHost();
  const [open, setOpen] = useState(false);
  const contentId = useId();

  // NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD tanımsız/boşsa (ör. demo hesapları henüz
  // oluşturulmadığı için .env.local'dan bilerek kaldırıldığında) panel sahte/
  // boş bir kimlik bilgisiyle render edilmek yerine TAMAMEN gizlenir — hem
  // localhost hem dev-build kontrolüyle AYNI "ikisinden biri eksikse hiç
  // render edilmez" ilkesi.
  if (!isLocalDevHost || !DEMO_PASSWORD) return null;

  return (
    <div className="mt-6 rounded-[10px] border border-border bg-background">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[10px]"
      >
        <span>Demo Hesaplar</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
      </button>

      {open && (
        <div id={contentId} className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Yalnızca Development. Ortak şifre: <code className="rounded bg-surface px-1 py-0.5 font-mono">{DEMO_PASSWORD}</code>
          </p>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => onSelectAccount(account.email, DEMO_PASSWORD)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs transition-colors hover:border-accent hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-medium text-foreground">
                  {account.label} <span className="font-normal text-muted-foreground">({account.role})</span>
                </span>
                <span className="text-muted-foreground">{account.email}</span>
                {account.service && <span className="text-muted-foreground">{account.service}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
