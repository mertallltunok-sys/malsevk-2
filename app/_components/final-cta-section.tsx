"use client";

import { ButtonLink } from "./button-link";
import { PageContainer } from "./page-container";
import { useSession } from "../_lib/use-session";

/**
 * Yalnızca giriş yapılmamış ziyaretçiye gösterilir — Hizmet Alan/Hizmet
 * Veren için zaten Hero'da role özel CTA var (bkz. hero-section.tsx), bu
 * genel/ikinci CTA tekrar niteliğinde. `null` dönmek (CSS ile gizlemek
 * yerine) önceki bölüm ile footer arasında boşluk bırakan bir kapsayıcı
 * bırakmaz — aynı desen RoleCardsSection'da da kullanılıyor.
 */
export function FinalCtaSection() {
  const session = useSession();
  if (session) return null;

  return (
    <section aria-labelledby="son-cta-baslik" className="bg-background">
      <PageContainer className="py-16">
        <div className="rounded-2xl bg-primary px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2
            id="son-cta-baslik"
            className="text-2xl font-bold tracking-heading leading-tight text-primary-foreground sm:text-3xl"
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
      </PageContainer>
    </section>
  );
}
