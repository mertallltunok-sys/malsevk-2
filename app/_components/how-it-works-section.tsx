const steps = [
  {
    title: "İhtiyacını oluştur",
    description: "Hizmet türünü, konumu, tarihi ve operasyon detaylarını belirt.",
  },
  {
    title: "Teklifleri karşılaştır",
    description: "Uygun hizmet verenlerden gelen teklifleri tek yerde incele.",
  },
  {
    title: "Hizmet vereni seç",
    description: "İhtiyacınıza en uygun teklifi seçerek süreci başlat.",
  },
];

export function HowItWorksSection() {
  return (
    <section
      id="nasil-calisir"
      aria-labelledby="nasil-calisir-baslik"
      className="scroll-mt-20 bg-surface"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="nasil-calisir-baslik"
            className="text-2xl font-semibold text-foreground sm:text-3xl"
          >
            Üç adımda doğru hizmete ulaşın
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            İhtiyacınızı tanımlayın, teklifleri karşılaştırın ve uygun hizmet
            vereni seçin.
          </p>
        </div>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-card border border-border bg-background p-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="hidden h-px flex-1 bg-border sm:block"
                  />
                )}
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
