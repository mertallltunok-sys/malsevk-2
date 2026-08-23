import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminCompanyDocumentsPanel } from "../../_components/admin-company-documents-panel";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminOrRedirect } from "../../_lib/require-admin";

export const metadata: Metadata = {
  title: "Firma Belgeleri | MALSEVK.COM Yönetim Paneli",
  description: "Hizmet veren firmaların yüklediği doğrulama belgelerini inceleyin, onaylayın, reddedin veya revizyon isteyin.",
};

export default async function AdminCompanyDocumentsPage() {
  await requireAdminOrRedirect("/admin/firma-belgeleri");
  return (
    <section className="bg-background">
      <AdminShell title="Firma Belgeleri">
        <Suspense
          fallback={<div aria-hidden="true" className="h-48 animate-pulse rounded-card border border-border bg-surface" />}
        >
          <AdminCompanyDocumentsPanel />
        </Suspense>
      </AdminShell>
    </section>
  );
}
