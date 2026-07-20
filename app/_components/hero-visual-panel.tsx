import { ClipboardList, Container, Forklift, Link2, Scale, Users, Warehouse } from "lucide-react";

const flowSteps = [
  {
    icon: ClipboardList,
    title: "Hizmet Talebi",
    description: "İhtiyacınızı birkaç adımda tanımlayın.",
  },
  {
    icon: Users,
    title: "Uygun Hizmet Veren",
    description: "Alanında uzman hizmet verenlerle eşleşin.",
  },
  {
    icon: Scale,
    title: "Teklif Karşılaştırma",
    description: "Gelen teklifleri kolayca karşılaştırın.",
  },
];

export function HeroVisualPanel() {
  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Container className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">
            MALSEVK Operasyon Akışı
          </p>
          <p className="text-xs text-muted-foreground">
            Talep, eşleşme ve teklif süreci tek ekranda
          </p>
        </div>
      </div>

      <ol className="mt-6 flex flex-col">
        {flowSteps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {index < flowSteps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="w-px flex-1 bg-border"
                />
              )}
            </div>
            <div className={index < flowSteps.length - 1 ? "pb-6" : ""}>
              <p className="text-sm font-semibold text-foreground">
                {step.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex items-center gap-3 border-t border-border pt-5 text-muted-foreground">
        <Warehouse className="h-4 w-4 shrink-0" aria-hidden="true" />
        <Forklift className="h-4 w-4 shrink-0" aria-hidden="true" />
        <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs leading-relaxed">
          Depolama · Elleçleme · Sahada operasyon desteği
        </span>
      </div>
    </div>
  );
}
