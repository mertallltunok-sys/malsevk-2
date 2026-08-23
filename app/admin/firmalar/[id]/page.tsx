import type { Metadata } from "next";
import { AdminCompanyDetailContent } from "../../../_components/admin-company-detail";
import { AdminShell } from "../../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Firma Detayı | MALSEVK.COM Yönetim Paneli",
};

export default async function AdminCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/firmalar/${id}`);
  return (
    <section className="bg-background">
      <AdminShell title="Firma Detayı">
        <AdminCompanyDetailContent providerId={id} />
      </AdminShell>
    </section>
  );
}
