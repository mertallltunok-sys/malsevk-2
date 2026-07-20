import {
  ChevronRight,
  Container,
  Forklift,
  HardHat,
  Link2,
  MoveVertical,
  PackageMinus,
  PackagePlus,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const services: {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    slug: "lashing",
    title: "Lashing",
    description:
      "Yüklerin araç veya konteyner içinde güvenli şekilde sabitlenmesi.",
    icon: Link2,
  },
  {
    slug: "yukleme-bosaltma-gozetimi",
    title: "Yükleme / Boşaltma Gözetimi",
    description: "Yükleme ve boşaltma operasyonlarının saha gözetimi.",
    icon: HardHat,
  },
  {
    slug: "konteyner-dolum",
    title: "Konteyner Dolum",
    description:
      "Yüklerin konteynere düzenli ve güvenli biçimde yerleştirilmesi.",
    icon: PackagePlus,
  },
  {
    slug: "konteyner-bosaltim",
    title: "Konteyner Boşaltım",
    description:
      "Konteyner yüklerinin kontrollü ve güvenli şekilde boşaltılması.",
    icon: PackageMinus,
  },
  {
    slug: "forklift-operatoru",
    title: "Forklift Operatörü",
    description: "Yükleme, boşaltma ve saha operasyonları için operatör desteği.",
    icon: Forklift,
  },
  {
    slug: "vinc-operatoru",
    title: "Vinç Operatörü",
    description: "Ağır yük kaldırma operasyonları için uzman operatör desteği.",
    icon: MoveVertical,
  },
  {
    slug: "reach-stacker-operatoru",
    title: "Reach Stacker Operatörü",
    description: "Konteyner elleçleme operasyonları için deneyimli operatör desteği.",
    icon: Container,
  },
  {
    slug: "depolama",
    title: "Depolama",
    description: "Konteyner, rulo sac, paletli ürün ve saha depolama çözümleri.",
    icon: Warehouse,
  },
];

export function ServicesSection() {
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
            className="text-2xl font-semibold text-foreground sm:text-3xl"
          >
            Lojistik operasyon hizmetleri
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            İhtiyacınıza uygun hizmet kategorisini seçin ve uzman hizmet
            verenlerden teklif alın.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <Link
              key={service.slug}
              href="/ilanlar"
              className="group flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-7 shadow-sm transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <service.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold leading-snug text-foreground">
                  {service.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                İncele
                <ChevronRight
                  className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
