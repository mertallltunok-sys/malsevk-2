"use client";

import { Check } from "lucide-react";
import { ButtonLink } from "./button-link";
import { HeroVisualPanel } from "./hero-visual-panel";
import { useSession } from "../_lib/use-session";

const trustPoints = [
  "Profesyonel hizmet verenler",
  "Türkiye genelinde hizmet",
  "Kolay teklif karşılaştırma",
];

/**
 * Rol bazlı Hero metni/CTA'sı. Oturum yokken (ya da sunucu snapshot'ı olan
 * `null` ile ilk hidrasyon anında) "visitor" içeriği gösterilir — bu,
 * RoleCardsSection'daki useSession/useSyncExternalStore deseniyle aynıdır,
 * bu yüzden ayrı bir hydration mismatch riski oluşturmaz.
 */
const heroCopy = {
  visitor: {
    title: "Yükünüzü güvenle taşıyacak doğru ekibi bulun",
    description:
      "MALSEVK, hizmet alan firmalar ile uzman hizmet verenleri güvenli, hızlı ve kolay şekilde buluşturur.",
  },
  "hizmet-alan": {
    title: "Lojistik hizmet ihtiyacınızı kolayca karşılayın",
    description:
      "İhtiyacınıza uygun hizmet talebi oluşturun, gelen teklifleri karşılaştırın ve doğru hizmet vereni seçin.",
  },
  "hizmet-veren": {
    title: "Uzmanlığınıza uygun iş fırsatlarını keşfedin",
    description:
      "Size uygun lojistik hizmet ilanlarını inceleyin, teklif verin ve yeni müşterilere ulaşın.",
  },
} as const;

export function HeroSection() {
  const session = useSession();
  const audience = session?.role ?? "visitor";
  const copy = heroCopy[audience];

  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:px-8">
        <div>
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            Türkiye&apos;nin lojistik hizmet platformu
          </span>
          <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {copy.description}
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            {audience === "hizmet-alan" && (
              <ButtonLink href="/hizmet-talebi-olustur" variant="primary">
                Hizmet Talebi Oluştur
              </ButtonLink>
            )}
            {audience === "hizmet-veren" && (
              <ButtonLink href="/ilanlar" variant="primary">
                İş İlanlarını İncele
              </ButtonLink>
            )}
            {audience === "visitor" && (
              <>
                <ButtonLink href="/hizmet-talebi-olustur" variant="primary">
                  Hizmet Talebi Oluştur
                </ButtonLink>
                <ButtonLink href="/ilanlar" variant="secondary">
                  İş İlanlarını İncele
                </ButtonLink>
              </>
            )}
          </div>
          <ul className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            {trustPoints.map((point) => (
              <li
                key={point}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <HeroVisualPanel />
      </div>
    </section>
  );
}
