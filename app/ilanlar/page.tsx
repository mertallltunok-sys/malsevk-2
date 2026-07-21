import type { Metadata } from "next";
import { JobListingScreen } from "../_components/job-listing-screen";

export const metadata: Metadata = {
  title: "İş İlanları | MALSEVK.COM",
  description: "Lojistik operasyon hizmeti veren firmalar için güncel iş ilanları.",
};

export default function IlanlarPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <JobListingScreen />
      </div>
    </section>
  );
}
