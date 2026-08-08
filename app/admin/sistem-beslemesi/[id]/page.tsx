import type { Metadata } from "next";
import { AdminFacilityCandidateDetail } from "../../../_components/admin-facility-candidate-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Tesis Aday Detayı | MALSEVK.COM Yönetim Paneli",
  description: "Bir tesis adayının tüm benzer yazımlarını, kullanım geçmişini görüntüleyin, düzenleyin, onaylayın veya reddedin.",
};

export default async function AdminFacilityCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/sistem-beslemesi/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="Tesis Aday Detayı">
        <AdminFacilityCandidateDetail candidateId={id} />
      </AdminShell>
    </section>
  );
}
