import type { Metadata } from "next";
import { AdminProviderDocumentReviewPanel } from "../_components/admin-provider-document-review-panel";

export const metadata: Metadata = {
  title: "Hizmet Veren Belge Kontrolü | MALSEVK.COM",
  description: "Hizmet Veren hesaplarının yüklediği faaliyet belgelerini inceleyin, onaylayın veya reddedin.",
};

export default function AdminPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <AdminProviderDocumentReviewPanel />
      </div>
    </section>
  );
}
