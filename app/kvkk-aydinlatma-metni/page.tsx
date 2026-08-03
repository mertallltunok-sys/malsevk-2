import type { Metadata } from "next";
import { ClosePageButton } from "../_components/close-page-button";
import { LegalDocumentContent } from "../_components/legal-document-content";

export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni | MALSEVK.COM",
  description: "6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca MALSEVK.COM'un veri işleme faaliyetlerine ilişkin aydınlatma metni.",
};

/** Bkz. app/gizlilik-politikasi/page.tsx'in başındaki not — aynı desen. */
export default function KvkkAydinlatmaMetniPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex justify-end">
          <ClosePageButton />
        </div>
        <div className="mt-6 rounded-card border border-border bg-surface p-6 sm:p-8">
          <LegalDocumentContent documentId="kvkk" />
        </div>
      </div>
    </section>
  );
}
