import type { Metadata } from "next";
import { JobEditForm } from "../../../../_components/job-edit-form";

export const metadata: Metadata = {
  title: "İlanı Düzenle | MALSEVK.COM",
  description: "Mevcut hizmet talebinizi güncelleyin.",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function IlanDuzenlePage({ params }: PageProps) {
  const { id } = await params;

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          İlanı Düzenle
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          İlan bilgilerinizi güncelleyin. Fotoğraflarınızı, konumunuzu ve
          açıklamanızı istediğiniz zaman değiştirebilirsiniz.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <JobEditForm jobId={id} />
        </div>
      </div>
    </section>
  );
}
