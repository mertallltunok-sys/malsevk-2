import type { Metadata } from "next";
import { AdminJobsList } from "../../_components/admin-jobs-list";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "İlan Yönetimi | MALSEVK.COM Yönetim Paneli",
  description: "Tüm ilanları arayın, filtreleyin ve inceleyin; gerektiğinde yayından kaldırın.",
};

export default async function AdminJobsPage() {
  await requireAdminOrRedirect("/admin/ilanlar");
  return (
    <section className="bg-background">
      <AdminShell title="İlan Yönetimi">
        <AdminJobsList />
      </AdminShell>
    </section>
  );
}
