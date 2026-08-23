import type { Metadata } from "next";
import { AdminOperationsList } from "../../_components/admin-operations-list";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Operasyon Yönetimi | MALSEVK.COM Yönetim Paneli",
  description: "Devam eden ve tamamlanan operasyonları durumlarına göre görüntüleyin.",
};

export default async function AdminOperationsPage() {
  await requireAdminOrRedirect("/admin/operasyonlar");
  return (
    <section className="bg-background">
      <AdminShell title="Operasyon Yönetimi">
        <AdminOperationsList />
      </AdminShell>
    </section>
  );
}
