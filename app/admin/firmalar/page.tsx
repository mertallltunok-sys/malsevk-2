import type { Metadata } from "next";
import { AdminCompaniesList } from "../../_components/admin-companies-list";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Firmalar | MALSEVK.COM Yönetim Paneli",
  description: "Tüm hizmet veren firmaları arayın, filtreleyin ve inceleyin.",
};

export default async function AdminCompaniesPage() {
  await requireAdminOrRedirect("/admin/firmalar");
  return (
    <section className="bg-background">
      <AdminShell title="Firmalar">
        <AdminCompaniesList />
      </AdminShell>
    </section>
  );
}
