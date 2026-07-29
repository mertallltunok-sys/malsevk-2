import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentContent } from "../_components/legal-document-content";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | MALSEVK.COM",
  description: "MALSEVK.COM kişisel verilerinizi hangi amaçlarla ve nasıl işlediğini açıklayan Gizlilik Politikası.",
};

/**
 * Footer/kayıt formundaki modal (bkz. legal-document-modal.tsx) ile AYNI
 * içerik render'ını (legal-document-content.tsx) kullanan, doğrudan
 * bağlantıyla (SEO, yeni sekme, e-posta imzası vb.) erişilebilen bağımsız
 * sayfa — bkz. legal-documents.ts'deki `routePath` notu. Footer'daki normal
 * sol tık bu sayfaya GİTMEZ, modalı açar; bu sayfa yalnızca doğrudan
 * URL/orta tık/yeni sekme senaryoları için gerçek bir hedef sağlar.
 */
export default function GizlilikPolitikasiPage() {
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
          <LegalDocumentContent documentId="privacy_policy" />
        </div>
      </div>
    </section>
  );
}
