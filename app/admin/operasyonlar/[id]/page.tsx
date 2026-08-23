import type { Metadata } from "next";
import { AdminOperationDetail } from "../../../_components/admin-operation-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Operasyon Detayı | MALSEVK.COM Yönetim Paneli",
  description: "Operasyonun hizmet veren, hizmet alan, ilan, teklif ve tarihçe bilgilerini görüntüleyin.",
};

export default async function AdminOperationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/operasyonlar/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="Operasyon Detayı">
        <AdminOperationDetail offerId={id} />
      </AdminShell>
    </section>
  );
}
