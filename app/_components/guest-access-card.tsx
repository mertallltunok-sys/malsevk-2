import type { ReactNode } from "react";
import { AuthGateNotice } from "./auth-gate-notice";

/**
 * "Hizmet Talebi Oluştur" ve "İş İlanlarını İncele" sayfalarının paylaştığı
 * dış kart/başlık iskeleti — section + max-w-3xl kapsayıcı + başlık +
 * açıklama + iç kart. `job-request-form.tsx`'in üç dalı (giriş gerekli,
 * yanlış rol, gerçek form) ve `GuestAccessCard` (aşağıda) aynı JSX'i
 * tekrar yazmak yerine buradan paylaşır.
 */
export function PageCardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Oturum açılmamış kullanıcıya gösterilen tam sayfa "giriş gerekli"
 * deneyimi. "Hizmet Talebi Oluştur" sayfasında zaten kullanılan tasarım
 * sistemini (PageCardShell + AuthGateNotice) "İş İlanlarını İncele"
 * sayfasıyla birebir paylaşır — modal/popup DEĞİLDİR, doğrudan sayfa
 * içeriğinin yerine geçer. Yalnızca metinler (başlık/açıklama/kart mesajı)
 * sayfaya göre değişir.
 */
export function GuestAccessCard({
  pageTitle,
  pageDescription,
  cardTitle,
  cardDescription,
  redirectTo,
}: {
  pageTitle: string;
  pageDescription: string;
  cardTitle: string;
  cardDescription: string;
  redirectTo: string;
}) {
  return (
    <PageCardShell title={pageTitle} description={pageDescription}>
      <AuthGateNotice
        message={cardTitle}
        description={cardDescription}
        loginRedirect={redirectTo}
        registerRedirect={redirectTo}
      />
    </PageCardShell>
  );
}
