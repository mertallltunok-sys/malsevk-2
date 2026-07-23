"use client";

import {
  Check,
  Clock,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { ButtonLink, buttonClassName } from "./button-link";
import { HeroVisualPanel } from "./hero-visual-panel";
import { JobListingsAuthGateDialog } from "./job-listings-auth-gate";
import { useSession } from "../_lib/use-session";

const trustPoints = [
  "Profesyonel hizmet verenler",
  "Türkiye genelinde hizmet",
  "Kolay teklif karşılaştırma",
];

type HeroFeature = { title: string; description: string; icon: LucideIcon };

/**
 * Oturum açmış roller için CTA altındaki avantaj alanı — visitor'daki sade
 * yeşil-tik listesinin yerini alır. Hizmet Alan ve Hizmet Veren AYNI render
 * yapısını (bkz. HeroSection içindeki <ul>) paylaşır, yalnızca bu veri
 * dizisi değişir.
 */
const heroFeatures: Record<"hizmet-alan" | "hizmet-veren", HeroFeature[]> = {
  "hizmet-veren": [
    {
      title: "Güvenilir İş Fırsatları",
      description: "Uygun lojistik hizmet ilanlarını inceleyin ve güvenle teklif verin.",
      icon: ShieldCheck,
    },
    {
      title: "Türkiye Genelinde İlanlar",
      description: "Farklı şehirlerdeki iş fırsatlarına tek platformdan ulaşın.",
      icon: MapPin,
    },
    {
      title: "İşinizi Büyütün",
      description: "Yeni müşterilere ulaşın, düzenli iş alın ve operasyon hacminizi artırın.",
      icon: TrendingUp,
    },
  ],
  "hizmet-alan": [
    {
      title: "İhtiyacınıza Uygun Hizmet",
      description: "Hizmet ihtiyacınızı tanımlayın ve uygun firmalardan teklif alın.",
      icon: Search,
    },
    {
      title: "Teklifleri Karşılaştırın",
      description: "Gelen teklifleri fiyat, süre ve firma bilgilerine göre değerlendirin.",
      icon: Scale,
    },
    {
      title: "Güvenli ve Şeffaf Süreç",
      description: "Tekliften iş tamamlanana kadar süreci tek platformdan takip edin.",
      icon: ShieldCheck,
    },
    {
      title: "Zamandan Tasarruf Edin",
      description: "Doğru hizmet verene hızlıca ulaşarak operasyonunuzu aksatmayın.",
      icon: Clock,
    },
  ],
};

/**
 * Rol bazlı Hero metni/CTA'sı. Oturum yokken (ya da sunucu snapshot'ı olan
 * `null` ile ilk hidrasyon anında) "visitor" içeriği gösterilir — bu,
 * RoleCardsSection'daki useSession/useSyncExternalStore deseniyle aynıdır,
 * bu yüzden ayrı bir hydration mismatch riski oluşturmaz.
 */
const heroCopy = {
  visitor: {
    title: "Lojistik operasyonlarınız için doğru hizmeti tek platformda bulun.",
    description:
      "MALSEVK, hizmet alan firmalar ile uzman hizmet verenleri güvenli, hızlı ve şeffaf şekilde buluşturan profesyonel lojistik hizmet platformudur.",
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
  const [showJobsGate, setShowJobsGate] = useState(false);

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
                <button
                  type="button"
                  onClick={() => setShowJobsGate(true)}
                  className={buttonClassName("secondary")}
                >
                  İş İlanlarını İncele
                </button>
              </>
            )}
          </div>
          {audience === "visitor" ? (
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
          ) : (
            <ul className="mt-8 flex max-w-xl flex-col divide-y divide-border">
              {heroFeatures[audience].map((feature) => (
                <li key={feature.title} className="flex items-start gap-4 py-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <feature.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground">
                      {feature.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <HeroVisualPanel />
      </div>

      {showJobsGate && (
        <JobListingsAuthGateDialog onClose={() => setShowJobsGate(false)} />
      )}
    </section>
  );
}
