import type { Metadata } from "next";
import { AdminFacilityCandidatesList } from "../../_components/admin-facility-candidates-list";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Sistem Beslemesi | MALSEVK.COM Yönetim Paneli",
  description: "Kullanıcıların serbest yazdığı tesis adaylarını inceleyin, gruplandırılmış varyasyonları tek tuşla onaylayın veya reddedin.",
};

export default async function AdminFacilityCandidatesPage() {
  await requireAdminOrRedirect("/admin/sistem-beslemesi");
  return (
    <section className="bg-background">
      <AdminShell title="Sistem Beslemesi">
        <AdminFacilityCandidatesList />
      </AdminShell>
    </section>
  );
}
