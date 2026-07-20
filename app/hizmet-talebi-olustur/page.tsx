import type { Metadata } from "next";
import { JobRequestForm } from "../_components/job-request-form";

export const metadata: Metadata = {
  title: "Hizmet Talebi Oluştur | MALSEVK.COM",
  description: "Lojistik hizmet ihtiyacınızı tanımlayarak yeni bir ilan oluşturun.",
};

export default function HizmetTalebiOlusturPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Hizmet Talebi Oluştur
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          İhtiyacınızı tanımlayın; uzman hizmet verenler ilanınızı inceleyip
          teklif göndersin.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <JobRequestForm />
        </div>
      </div>
    </section>
  );
}
