import type { Metadata } from "next";
import { AdminRequesterDetail } from "../../../_components/admin-requester-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Hizmet Alan Detayı | MALSEVK.COM Yönetim Paneli",
  description: "Hizmet alan kullanıcının profil bilgilerini görüntüleyin, hesabı askıya alın veya askıyı kaldırın.",
};

export default async function AdminRequesterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/hizmet-alanlar/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="Hizmet Alan Detayı">
        <AdminRequesterDetail userId={id} />
      </AdminShell>
    </section>
  );
}
