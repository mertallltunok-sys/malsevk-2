import type { Metadata } from "next";
import { Suspense } from "react";
import { JobRequestsPanel } from "../../_components/job-requests-panel";

export const metadata: Metadata = {
  title: "Hizmet Taleplerim | MALSEVK.COM",
  description: "Oluşturduğunuz hizmet taleplerini ve güncel durumlarını görüntüleyin.",
};

export default function HizmetTaleplerimPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Hizmet Taleplerim
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Oluşturduğunuz hizmet taleplerini ve güncel durumlarını buradan takip edebilirsiniz.
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
            <JobRequestsPanel />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
