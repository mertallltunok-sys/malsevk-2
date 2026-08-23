import type { Metadata } from "next";
import { JobEditForm } from "../../../../_components/job-edit-form";
import { PageCardShell } from "../../../../_components/guest-access-card";

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
    <PageCardShell
      title="İlanı Düzenle"
      description="İlan bilgilerinizi güncelleyin. Fotoğraflarınızı, konumunuzu ve açıklamanızı istediğiniz zaman değiştirebilirsiniz."
    >
      <JobEditForm jobId={id} />
    </PageCardShell>
  );
}
