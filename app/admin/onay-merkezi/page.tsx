import type { Metadata } from "next";
import { AdminApprovalCenterContent } from "../../_components/admin-approval-center-content";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Onay Merkezi | MALSEVK.COM Yönetim Paneli",
  description: "Bekleyen firma belgesi ve ilan onaylarının birleşik listesi.",
};

export default async function AdminApprovalCenterPage() {
  await requireAdminOrRedirect("/admin/onay-merkezi");
  return (
    <section className="bg-background">
      <AdminShell title="Onay Merkezi">
        <AdminApprovalCenterContent />
      </AdminShell>
    </section>
  );
}
