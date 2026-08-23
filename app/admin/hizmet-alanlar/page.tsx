import type { Metadata } from "next";
import { AdminRequestersList } from "../../_components/admin-requesters-list";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Hizmet Alanlar | MALSEVK.COM Yönetim Paneli",
  description: "Hizmet alan kullanıcıları listeleyin, temel profil bilgilerini görüntüleyin ve hesap durumunu yönetin.",
};

export default async function AdminRequestersPage() {
  await requireAdminOrRedirect("/admin/hizmet-alanlar");
  return (
    <section className="bg-background">
      <AdminShell title="Hizmet Alanlar">
        <AdminRequestersList />
      </AdminShell>
    </section>
  );
}
