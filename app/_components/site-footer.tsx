"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAllLegalDocuments } from "../_lib/legal-documents";
import { PageContainer } from "./page-container";

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
 * Faz 2 (masaüstü genişlik/yoğunluk düzeltmesi) — büyük pazarlama footer'ı
 * (marka açıklaması + Platform/Hesap/Yasal sütunları) her sayfada aynı
 * değildir; operasyonel/oturum-açılmış ekranlarda gereksiz/uygunsuz:
 *  - İlan DETAY sayfaları (`/ilanlar/[id]`): footer HİÇ render edilmiyor
 *    (`return null`) — bu sayfanın "ilk ekrana sığdırma" hedefi var,
 *    tek satırlık bir telif satırı bile kullanılabilir alanı daraltabilir
 *    (görev tanımı). `/ilanlar` listesinin KENDİSİ bu kapsamda DEĞİL, tam
 *    footer'ı korur.
 *  - `/panel`, `/admin`, `/hizmet-talebi-olustur`: sert bir viewport hedefi
 *    yok, ama bunlar pazarlama sayfası değil — yalnızca kısa bir telif
 *    hakkı satırı (Platform/Hesap/Yasal sütunları YOK) gösterilir. Bu aynı
 *    zamanda admin panelinin altında bugüne kadar anlamsızca duran
 *    "Kayıt Ol"/"Giriş Yap" linklerini de kaldırır.
 *  - Diğer her yerde (ana sayfa, `/ilanlar` listesi, yasal sayfalar,
 *    `/bize-ulasin`, giriş/kayıt) TAM pazarlama footer'ı değişmeden kalır.
 */
const COMPACT_FOOTER_PATH_PREFIXES = ["/panel", "/admin", "/hizmet-talebi-olustur"];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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
  const pathname = usePathname();
  const year = new Date().getFullYear();

  if (matchesPrefix(pathname, "/ilanlar") && pathname !== "/ilanlar") {
    return null;
  }

  if (COMPACT_FOOTER_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return (
      <footer className="border-t border-border bg-primary text-primary-foreground">
        <PageContainer className="py-4">
          <p className="text-xs text-primary-foreground/60">© {year} MALSEVK.com. Tüm hakları saklıdır.</p>
        </PageContainer>
      </footer>
    );
  }

  const legalDocuments = getAllLegalDocuments();

  return (
    <footer className="bg-primary text-primary-foreground">
      <PageContainer className="py-14">
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
      </PageContainer>
    </footer>
  );
}
