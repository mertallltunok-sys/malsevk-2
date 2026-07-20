import { Check } from "lucide-react";
import { ButtonLink } from "./button-link";
import { HeroVisualPanel } from "./hero-visual-panel";

const trustPoints = [
  "Profesyonel hizmet verenler",
  "Türkiye genelinde hizmet",
  "Kolay teklif karşılaştırma",
];

export function HeroSection() {
  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:px-8">
        <div>
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            Türkiye&apos;nin lojistik hizmet platformu
          </span>
          <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            Lojistik operasyonlarınız için doğru hizmeti kolayca bulun.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            MALSEVK, hizmet alan firmalar ile uzman hizmet verenleri güvenli,
            hızlı ve kolay şekilde buluşturur.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <ButtonLink href="/hizmet-talebi-olustur" variant="primary">
              Hizmet Talebi Oluştur
            </ButtonLink>
            <ButtonLink href="/ilanlar" variant="secondary">
              İş İlanlarını İncele
            </ButtonLink>
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
