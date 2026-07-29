"use client";

import {
  Anchor,
  ChevronRight,
  Forklift,
  HardHat,
  Package,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  getAllServiceCategories,
  type ServiceCategoryWithGroup,
} from "../_lib/service-catalog";
import { useSession } from "../_lib/use-session";

/**
 * Kart ikonu, tek tek hizmet için değil `service-catalog.ts#SERVICE_CATEGORY_GROUPS`
 * grup id'si başına atanır — 38+ kategorinin her biri için ayrı ikon bakımı
 * gerektirmeden mevcut ikon/tasarım dilini korur. Bilinmeyen/yeni bir grup
 * eklenirse `Package` ikonuna düşer (bkz. aşağıdaki kullanım).
 */
const GROUP_ICONS: Record<string, LucideIcon> = {
  "liman-hizmetleri": Anchor,
  "depo-hizmetleri": Warehouse,
  "is-makinesi-hizmetleri": Forklift,
  "operator-hizmetleri": HardHat,
  "diger-hizmetler": Users,
  "proje-yuku-hizmetleri": Package,
};

const CARD_BASE_CLASSNAME =
  "flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-7 shadow-sm";

/**
 * Tek kart bileşeni — Hizmet Alan ve Hizmet Veren AYNI görsel kartı görür,
 * yalnızca davranış rol bazlı değişir: `interactive` false ise düz bir `div`
 * (tıklanamaz, hover/link davranışı yok, "İncele" satırı yok); true ise
 * `/ilanlar`e, seçili kategori id'siyle yönlendiren bir `Link`.
 */
function ServiceCategoryCard({
  category,
  interactive,
}: {
  category: ServiceCategoryWithGroup;
  interactive: boolean;
}) {
  const Icon = GROUP_ICONS[category.groupId] ?? Package;
  const description = `${category.groupLabel} kapsamında sunulan hizmet.`;

  const content = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex-1">
        <h3 className="text-base font-bold tracking-heading leading-snug text-foreground">
          {category.label}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {interactive && (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          İncele
          <ChevronRight
            className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      )}
    </>
  );

  if (interactive) {
    return (
      <Link
        href={`/ilanlar?kategori=${category.id}`}
        className={`group ${CARD_BASE_CLASSNAME} transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
      >
        {content}
      </Link>
    );
  }

  return <div className={CARD_BASE_CLASSNAME}>{content}</div>;
}

export function ServicesSection() {
  const session = useSession();
  const isProvider = session?.role === "hizmet-veren";
  const categories = getAllServiceCategories();

  return (
    <section
      id="hizmetler"
      aria-labelledby="hizmetler-baslik"
      className="scroll-mt-20 bg-background"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="hizmetler-baslik"
            className="text-2xl font-bold tracking-heading leading-tight text-foreground sm:text-3xl"
          >
            Lojistik operasyon hizmetleri
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {isProvider
              ? "Uzmanlığınıza uygun hizmet kategorisini seçin, doğrudan ilgili iş ilanlarına ulaşın."
              : "İhtiyacınıza uygun hizmet kategorisini inceleyin ve uzman hizmet verenlerden teklif alın."}
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category) => (
            <ServiceCategoryCard
              key={category.id}
              category={category}
              interactive={isProvider}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
