import type { Metadata } from "next";
import { AdminJobDetail } from "../../../_components/admin-job-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "İlan Detayı | MALSEVK.COM Yönetim Paneli",
  description: "İlanın tüm bilgilerini, gelen teklifleri ve operasyon bağlantısını görüntüleyin.",
};

export default async function AdminJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/ilanlar/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="İlan Detayı">
        <AdminJobDetail jobId={id} />
      </AdminShell>
    </section>
  );
}
