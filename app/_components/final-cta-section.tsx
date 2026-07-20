import { ButtonLink } from "./button-link";

export function FinalCtaSection() {
  return (
    <section aria-labelledby="son-cta-baslik" className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-primary px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2
            id="son-cta-baslik"
            className="text-2xl font-semibold text-primary-foreground sm:text-3xl"
          >
            Lojistik hizmet ihtiyacınızı bugün oluşturun
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-primary-foreground/80">
            İhtiyacınızı birkaç adımda tanımlayın ve uygun hizmet verenlerden
            teklif alın.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <ButtonLink
              href="/hizmet-talebi-olustur"
              variant="primary-on-dark"
              className="w-full sm:w-auto"
            >
              Hizmet Talebi Oluştur
            </ButtonLink>
            <ButtonLink
              href="/ilanlar"
              variant="secondary-on-dark"
              className="w-full sm:w-auto"
            >
              İş İlanlarını İncele
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
