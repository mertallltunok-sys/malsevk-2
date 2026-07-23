import type { Metadata } from "next";
import { Suspense } from "react";
import { MyOffersPanel } from "../../_components/my-offers-panel";

export const metadata: Metadata = {
  title: "Verdiğim Teklifler | MALSEVK.COM",
  description: "İş ilanlarına verdiğiniz teklifleri görüntüleyin.",
};

export default function TekliflerimPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Verdiğim Teklifler
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          İş ilanlarına gönderdiğiniz teklifleri ve durumlarını buradan takip
          edebilirsiniz.
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
            <MyOffersPanel />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
