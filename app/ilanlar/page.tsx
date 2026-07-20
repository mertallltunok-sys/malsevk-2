import type { Metadata } from "next";
import { JobList } from "../_components/job-list";

export const metadata: Metadata = {
  title: "İş İlanları | MALSEVK.COM",
  description: "Lojistik operasyon hizmeti veren firmalar için güncel iş ilanları.",
};

export default function IlanlarPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            İş İlanları
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin, ilan
            detayında teklifinizi gönderin.
          </p>
        </div>

        <JobList />
      </div>
    </section>
  );
}
