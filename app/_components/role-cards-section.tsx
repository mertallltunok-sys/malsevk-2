"use client";

import { ArrowRight, ClipboardList, Handshake, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { JobListingsAuthGateDialog } from "./job-listings-auth-gate";
import { useSession } from "../_lib/use-session";

const roles: {
  href: string;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
  /** true ise kart doğrudan navigasyon yapmaz, giriş-gerekli modalını açar (bkz. HeroSection'daki aynı davranış). */
  requiresAuthGate?: boolean;
}[] = [
  {
    href: "/hizmet-talebi-olustur",
    title: "Hizmet Alan",
    description:
      "İhtiyacınıza uygun lojistik hizmet talebi oluşturun, gelen teklifleri karşılaştırın ve uygun hizmet vereni seçin.",
    cta: "Hizmet talebi oluştur",
    icon: ClipboardList,
  },
  {
    href: "/ilanlar",
    title: "Hizmet Veren",
    description:
      "Uzmanlığınıza uygun ilanları inceleyin, teklif verin ve yeni müşterilere ulaşın.",
    cta: "İş ilanlarını incele",
    icon: Handshake,
    requiresAuthGate: true,
  },
];

const cardClassName =
  "group flex h-full flex-col justify-between gap-6 rounded-card border border-border bg-background p-8 transition duration-200 motion-safe:hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

/**
 * Yalnızca giriş yapılmamış ziyaretçiye gösterilir — Hizmet Alan veya
 * Hizmet Veren olarak oturum açmış bir kullanıcı için zaten hangi rolde
 * olduğu belli, "size uygun başlangıcı seçin" seçimi anlamsız. `null`
 * dönmek (CSS ile gizlemek yerine) Hero ile ServicesSection arasında
 * boşluk bırakan bir kapsayıcı bırakmaz.
 */
export function RoleCardsSection() {
  const session = useSession();
  const [showJobsGate, setShowJobsGate] = useState(false);
  if (session) return null;

  return (
    <section aria-labelledby="roller-baslik" className="bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="roller-baslik"
            className="text-2xl font-semibold text-foreground sm:text-3xl"
          >
            Size uygun başlangıcı seçin
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Hizmet ihtiyacınız varsa talep oluşturun, uzmanlığınıza uygun iş
            arıyorsanız ilanları inceleyin.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {roles.map((role) => {
            const cardInner = (
              <>
                <div>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <role.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-xl font-semibold text-foreground">
                    {role.title}
                  </h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                    {role.description}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {role.cta}
                  <ArrowRight
                    className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </>
            );

            if (role.requiresAuthGate) {
              return (
                <button
                  key={role.href}
                  type="button"
                  onClick={() => setShowJobsGate(true)}
                  className={`text-left ${cardClassName}`}
                >
                  {cardInner}
                </button>
              );
            }

            return (
              <Link key={role.href} href={role.href} className={cardClassName}>
                {cardInner}
              </Link>
            );
          })}
        </div>
      </div>

      {showJobsGate && (
        <JobListingsAuthGateDialog onClose={() => setShowJobsGate(false)} />
      )}
    </section>
  );
}
