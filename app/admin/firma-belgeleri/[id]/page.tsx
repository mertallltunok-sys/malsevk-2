import type { Metadata } from "next";
import { AdminDocumentReviewDetail } from "../../../_components/admin-document-review-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Belge İncele | MALSEVK.COM Yönetim Paneli",
};

export default async function AdminDocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/firma-belgeleri/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="Belge İncele">
        <AdminDocumentReviewDetail documentId={id} />
      </AdminShell>
    </section>
  );
}
