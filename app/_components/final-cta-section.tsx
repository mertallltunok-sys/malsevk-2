"use client";

import { useState } from "react";
import { ButtonLink, buttonClassName } from "./button-link";
import { JobListingsAuthGateDialog } from "./job-listings-auth-gate";
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
  const [showJobsGate, setShowJobsGate] = useState(false);
  if (session) return null;

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
            <button
              type="button"
              onClick={() => setShowJobsGate(true)}
              className={buttonClassName("secondary-on-dark", "w-full sm:w-auto")}
            >
              İş İlanlarını İncele
            </button>
          </div>
        </div>
      </div>

      {showJobsGate && (
        <JobListingsAuthGateDialog onClose={() => setShowJobsGate(false)} />
      )}
    </section>
  );
}
