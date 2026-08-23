import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminSystemHealthContent } from "../../_components/admin-system-health-content";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Sistem Sağlığı | MALSEVK.COM Yönetim Paneli",
  description: "Gerçek istemci/sunucu hatalarının toplandığı, önceliklendirildiği ve çözüm talimatı üretilen ekran.",
};

export default async function AdminSystemHealthPage() {
  await requireAdminOrRedirect("/admin/sistem-sagligi");
  return (
    <section className="bg-background">
      <AdminShell title="Sistem Sağlığı">
        <Suspense
          fallback={<div aria-hidden="true" className="h-48 animate-pulse rounded-card border border-border bg-surface" />}
        >
          <AdminSystemHealthContent />
        </Suspense>
      </AdminShell>
    </section>
  );
}
