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
  SERVICE_CATEGORY_GROUPS,
  STORAGE_SERVICE_GROUP_ID,
  type ServiceCategoryWithGroup,
} from "../_lib/service-catalog";
import { PageContainer } from "./page-container";
import { useSession } from "../_lib/use-session";

/** Ana sayfada tek kart olarak gösterilen "Depolama Hizmetleri" — service-catalog.ts#STORAGE_SERVICE_GROUP_ID'nin görünen adı. Katalogdaki gerçek grup etiketi ("Depo Hizmetleri") KASITLI OLARAK farklı bırakılır ve DEĞİŞTİRİLMEZ — bu yalnızca bu bir kartın tanıtım metnidir, service-catalog.ts'teki hiçbir yeri etkilemez (bkz. görev tanımı). */
const STORAGE_CARD_LABEL = "Depolama Hizmetleri";
const STORAGE_CARD_DESCRIPTION =
  "Soğuk hava, açık/kapalı alan, antrepo, konteyner ve diğer tüm depolama hizmetleri.";

/**
 * Kart ikonu, tek tek hizmet için değil `service-catalog.ts#SERVICE_CATEGORY_GROUPS`
 * grup id'si başına atanır — 38+ kategorinin her biri için ayrı ikon bakımı
 * gerektirmeden mevcut ikon/tasarım dilini korur. Bilinmeyen/yeni bir grup
 * eklenirse `Package` ikonuna düşer (bkz. aşağıdaki kullanım). `depo-hizmetleri`
 * burada YOKTUR — o grup artık hiçbir zaman tek tek kategori kartı olarak
 * gelmez (bkz. buildHomepageServiceItems), sabit ikonu (Warehouse)
 * doğrudan StorageServicesCard'ta kullanılır.
 */
const GROUP_ICONS: Record<string, LucideIcon> = {
  "liman-hizmetleri": Anchor,
  "is-makinesi-hizmetleri": Forklift,
  "operator-hizmetleri": HardHat,
  "diger-hizmetler": Users,
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

/**
 * Ana sayfadaki 12 ayrı depolama alt kategorisini (bkz. service-catalog.ts#
 * STORAGE_SERVICE_GROUP_ID) TEK bir kart altında toplar — yalnızca bu
 * TANITIM gösterimi için (bkz. görev tanımı: "sadece ana sayfa gösterimi
 * için gruplama katmanı"); ilan oluşturma formu, hizmet kataloğu, filtreler
 * ve görünürlük kuralları bu bileşenden habersiz, birebir eskisi gibi
 * çalışmaya devam eder. `ServiceCategoryCard` ile AYNI görsel kabuğu/
 * interactive-dallanma desenini paylaşır, yalnızca sabit ikon/başlık/
 * açıklama taşır ve hedefi tek bir alt kategori id'si değil, GRUP id'sidir —
 * provider-job-listing.tsx bunu "bu 12 kategoriden herhangi biri" şeklinde
 * genişletilmiş bir filtre olarak yorumlar (bkz. o dosyadaki AYNI sabit).
 */
function StorageServicesCard({ interactive }: { interactive: boolean }) {
  const content = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Warehouse className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex-1">
        <h3 className="text-base font-bold tracking-heading leading-snug text-foreground">
          {STORAGE_CARD_LABEL}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{STORAGE_CARD_DESCRIPTION}</p>
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
        href={`/ilanlar?kategori=${STORAGE_SERVICE_GROUP_ID}`}
        className={`group ${CARD_BASE_CLASSNAME} transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
      >
        {content}
      </Link>
    );
  }

  return <div className={CARD_BASE_CLASSNAME}>{content}</div>;
}

/**
 * `SERVICE_CATEGORY_GROUPS`i (zaten `order`e göre sıralı) doğrudan okuyup
 * düz bir tanıtım listesi üretir — `getAllServiceCategories()` ile AYNI
 * gezinme, tek farkla: `STORAGE_SERVICE_GROUP_ID` grubunun 12 alt kategorisi
 * tek bir `"storage-group"` öğesine indirgenir. Diğer TÜM gruplar/kategoriler
 * birebir eskisi gibi, kendi sırasında, ayrı kart olarak kalır.
 */
type HomepageServiceItem =
  | { kind: "category"; category: ServiceCategoryWithGroup }
  | { kind: "storage-group" };

function buildHomepageServiceItems(): HomepageServiceItem[] {
  const items: HomepageServiceItem[] = [];
  for (const group of SERVICE_CATEGORY_GROUPS) {
    if (group.id === STORAGE_SERVICE_GROUP_ID) {
      items.push({ kind: "storage-group" });
      continue;
    }
    for (const category of group.categories) {
      items.push({ kind: "category", category: { ...category, groupId: group.id, groupLabel: group.label } });
    }
  }
  return items;
}

export function ServicesSection() {
  const session = useSession();
  const isProvider = session?.role === "hizmet-veren";
  const items = buildHomepageServiceItems();

  return (
    <section
      id="hizmetler"
      aria-labelledby="hizmetler-baslik"
      className="scroll-mt-20 bg-background"
    >
      <PageContainer className="py-16">
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
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) =>
            item.kind === "storage-group" ? (
              <StorageServicesCard key={STORAGE_SERVICE_GROUP_ID} interactive={isProvider} />
            ) : (
              <ServiceCategoryCard key={item.category.id} category={item.category} interactive={isProvider} />
            ),
          )}
        </div>
      </PageContainer>
    </section>
  );
}
