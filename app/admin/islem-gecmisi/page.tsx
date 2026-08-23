import type { Metadata } from "next";
import { AdminAuditLogContent } from "../../_components/admin-audit-log-content";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "İşlem Geçmişi | MALSEVK.COM Yönetim Paneli",
  description: "Yöneticilerin gerçekleştirdiği işlemlerin anlaşılır Türkçe geçmişi.",
};

export default async function AdminAuditLogPage() {
  await requireAdminOrRedirect("/admin/islem-gecmisi");
  return (
    <section className="bg-background">
      <AdminShell title="İşlem Geçmişi">
        <AdminAuditLogContent />
      </AdminShell>
    </section>
  );
}
