"use client";

import Link from "next/link";
import { getAllLegalDocuments } from "../_lib/legal-documents";

const platformLinks = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/#hizmetler", label: "Hizmetler" },
  { href: "/#nasil-calisir", label: "Nasıl Çalışır" },
];

const accountLinks = [
  { href: "/giris-yap", label: "Giriş Yap" },
  { href: "/giris-yap?mode=kayit", label: "Kayıt Ol" },
];

const footerLinkClass =
  "w-fit rounded-sm text-sm text-primary-foreground/80 transition-colors hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary";

function FooterLinkList({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string }[];
}) {
  return (
    <nav aria-label={heading} className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-primary-foreground/55">
        {heading}
      </h3>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className={footerLinkClass}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * "Bize Ulaşın" ve "Yasal" bağlantılarının TÜMÜ düz `<Link>`lerdir — hiçbiri
 * modal/dialog/pop-up AÇMAZ (görev tanımı: önceki modal kararı iptal
 * edildi; bkz. app/bize-ulasin/page.tsx, app/gizlilik-politikasi/page.tsx
 * vb. bağımsız sayfalar). Her bağlantı kendi gerçek rotasına gider —
 * sağ tık/orta tık/yeni sekme/klavye ile Ctrl+Enter gibi tüm "varsayılan
 * gezinme" senaryoları normal bir `<Link>`te olduğu gibi çalışır, ayrıca
 * bir `onClick`/`preventDefault` müdahalesi YOKTUR. Oturum durumundan
 * (giriş yapılmış/yapılmamış) bağımsız olarak her zaman aynı yerde
 * render edilir.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const legalDocuments = getAllLegalDocuments();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold tracking-tight">
                MALSEVK.com
              </span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-primary-foreground/75">
              Lojistik hizmet alan firmalar ile uzman hizmet verenleri
              buluşturan profesyonel platform.
            </p>
            {/*
              Bize Ulaşın'a erişim BİLEREK yalnızca burada (footer'ın sol
              marka/açıklama kolonu) sağlanır — üst menü/profil menüsü/mobil
              menü/panel menüleri gibi tekrarlayan navigasyon alanlarının
              hiçbirinde YOKTUR ve olmamalıdır (görev tanımı: "Bize Ulaşın"
              yalnızca footer'da bulunacak). `app/bize-ulasin/page.tsx`e
              giden GERÇEK bir sayfa bağlantısıdır — modal AÇMAZ.
            */}
            <Link href="/bize-ulasin" className={footerLinkClass}>
              Bize Ulaşın
            </Link>
          </div>
          <FooterLinkList heading="Platform" links={platformLinks} />
          <FooterLinkList heading="Hesap" links={accountLinks} />
          <nav aria-label="Yasal" className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-primary-foreground/55">
              Yasal
            </h3>
            <ul className="flex flex-col gap-2">
              {legalDocuments.map((document) => (
                <li key={document.id}>
                  <Link href={document.routePath} className={footerLinkClass}>
                    {document.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-primary-foreground/60">
            © {year} MALSEVK.com. Tüm hakları saklıdır.
          </p>
        </div>
      </div>
    </footer>
  );
}
