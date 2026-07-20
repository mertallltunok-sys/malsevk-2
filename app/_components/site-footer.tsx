import { Anchor } from "lucide-react";
import Link from "next/link";

const platformLinks = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/#hizmetler", label: "Hizmetler" },
  { href: "/#nasil-calisir", label: "Nasıl Çalışır" },
];

const accountLinks = [
  { href: "/giris-yap", label: "Giriş Yap" },
  { href: "/giris-yap?mode=kayit", label: "Kayıt Ol" },
];

// Bu sayfalar henüz oluşturulmadı; tıklanamaz "Yakında" etiketiyle
// gösterilir ki kullanıcı 404 veren bir bağlantıya yönlendirilmesin.
const legalLinks = [
  { label: "Gizlilik Politikası" },
  { label: "Kullanım Koşulları" },
  { label: "KVKK Aydınlatma Metni" },
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-foreground/55">
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

function FooterComingSoonList({
  heading,
  items,
}: {
  heading: string;
  items: { label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-foreground/55">
        {heading}
      </h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <span
              aria-disabled="true"
              className="flex w-fit items-center gap-2 text-sm text-primary-foreground/50"
            >
              {item.label}
              <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                Yakında
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <Anchor className="h-5 w-5" aria-hidden="true" />
              <span className="text-lg font-semibold tracking-tight">
                MALSEVK.COM
              </span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-primary-foreground/75">
              Lojistik hizmet alan firmalar ile uzman hizmet verenleri
              buluşturan profesyonel platform.
            </p>
          </div>
          <FooterLinkList heading="Platform" links={platformLinks} />
          <FooterLinkList heading="Hesap" links={accountLinks} />
          <FooterComingSoonList heading="Yasal" items={legalLinks} />
        </div>
        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-primary-foreground/60">
            © {year} MALSEVK.COM. Tüm hakları saklıdır.
          </p>
        </div>
      </div>
    </footer>
  );
}
