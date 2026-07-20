import { ListChecks, Scale, ShieldCheck, type LucideIcon } from "lucide-react";

const features: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Doğru hizmet kategorisi",
    description:
      "İhtiyacınızı uygun kategori altında yayınlayarak doğru hizmet verenlere ulaşın.",
    icon: ListChecks,
  },
  {
    title: "Teklifleri tek yerde karşılaştırın",
    description:
      "Farklı hizmet verenlerin tekliflerini düzenli ve anlaşılır biçimde inceleyin.",
    icon: Scale,
  },
  {
    title: "Şeffaf iş süreci",
    description: "Talep, teklif ve iş adımlarını aynı platform üzerinden takip edin.",
    icon: ShieldCheck,
  },
];

export function TrustValueSection() {
  return (
    <section aria-labelledby="deger-onerisi-baslik" className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2
          id="deger-onerisi-baslik"
          className="max-w-2xl text-2xl font-semibold text-foreground sm:text-3xl"
        >
          Lojistik operasyonlarınızı daha düzenli yönetin
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="flex flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                <feature.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-lg font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
