import type { Metadata } from "next";
import { Suspense } from "react";
import { IncomingOffersPanel } from "../../_components/incoming-offers-panel";

export const metadata: Metadata = {
  title: "Gelen Teklifler | MALSEVK.COM",
  description: "İlanlarınıza gelen teklifleri inceleyin, kabul edin veya reddedin.",
};

export default function GelenTekliflerPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Gelen Teklifler
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          İlanlarınıza gelen teklifleri inceleyin, uygun olanı kabul edin veya
          reddedin.
        </p>
        <div className="mt-10">
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                className="h-48 animate-pulse rounded-card border border-border bg-surface"
              />
            }
          >
            <IncomingOffersPanel />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
