import type { Metadata } from "next";
import Link from "next/link";
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
        <Link
          href="/"
          className="text-sm font-medium text-accent transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          ← Ana Sayfaya Dön
        </Link>
        <div className="mt-6 rounded-card border border-border bg-surface p-6 sm:p-8">
          <LegalDocumentContent documentId="kvkk" />
        </div>
      </div>
    </section>
  );
}
