"use client";

import { Anchor } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getAllLegalDocuments, type LegalDocumentId } from "../_lib/legal-documents";
import { LegalDocumentModal } from "./legal-document-modal";

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
 * "Yasal" bağlantıları — artık "Yakında" rozetiyle pasif değil, GERÇEKTEN
 * tıklanabilir. Her bağlantının `href`i o belgenin bağımsız sayfasına
 * (bkz. legal-documents.ts#routePath) işaret eder — bu, sağ tık/orta
 * tık/yeni sekme/klavye ile Ctrl+Enter gibi tüm "varsayılan gezinme"
 * senaryolarının GERÇEKTEN çalışmasını sağlar (boş/kırık bağlantı yok).
 * Sıradan bir sol tıkta ise `onClick` `preventDefault()` çağırır ve sayfaya
 * gitmek yerine `legal-document-modal.tsx`yi açar — bkz. görev gereksinimi
 * ("kullanıcı yeni sayfaya gitmesin"). Değiştirici tuşla (Ctrl/Cmd/Shift/Alt)
 * veya orta tıkla yapılan tıklamalar KASITLI olarak engellenmez — tarayıcının
 * "yeni sekmede aç" gibi standart davranışları bu sayede bozulmaz.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const [openDocumentId, setOpenDocumentId] = useState<LegalDocumentId | null>(null);
  const legalDocuments = getAllLegalDocuments();

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
          <nav aria-label="Yasal" className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-primary-foreground/55">
              Yasal
            </h3>
            <ul className="flex flex-col gap-2">
              {legalDocuments.map((document) => (
                <li key={document.id}>
                  <Link
                    href={document.routePath}
                    className={footerLinkClass}
                    onClick={(event) => {
                      const isPlainLeftClick =
                        event.button === 0 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey;
                      if (!isPlainLeftClick) return;
                      event.preventDefault();
                      setOpenDocumentId(document.id);
                    }}
                  >
                    {document.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-primary-foreground/60">
            © {year} MALSEVK.COM. Tüm hakları saklıdır.
          </p>
        </div>
      </div>

      {openDocumentId && (
        <LegalDocumentModal documentId={openDocumentId} mode="readonly" onClose={() => setOpenDocumentId(null)} />
      )}
    </footer>
  );
}
