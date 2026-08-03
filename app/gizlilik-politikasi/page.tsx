import type { Metadata } from "next";
import { ClosePageButton } from "../_components/close-page-button";
import { LegalDocumentContent } from "../_components/legal-document-content";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | MALSEVK.COM",
  description: "MALSEVK.COM kişisel verilerinizi hangi amaçlarla ve nasıl işlediğini açıklayan Gizlilik Politikası.",
};

/**
 * Kayıt formundaki onay modalıyla (bkz. legal-document-modal.tsx,
 * login-form.tsx'in `mode="consent"` kullanımı — o akış BU görevin
 * kapsamı DIŞINDA, dokunulmadı) AYNI içerik render'ını
 * (legal-document-content.tsx) kullanan, GERÇEK ve doğrudan erişilebilir
 * bağımsız bir sayfa (SEO, yeni sekme, e-posta imzası, footer bağlantısı —
 * hepsi buraya GİDER, pop-up/modal AÇILMAZ; bkz. görev tanımı: önceki
 * modal kararı iptal edildi). `site-footer.tsx`'in "Yasal" bağlantıları da
 * artık düz `<Link href={routePath}>`dır. `ClosePageButton` tarayıcı
 * geçmişine göre karar verir (bkz. o dosya) — sabit "Ana Sayfaya Dön"
 * yerine geldiği sayfaya (varsa) döner.
 */
export default function GizlilikPolitikasiPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex justify-end">
          <ClosePageButton />
        </div>
        <div className="mt-6 rounded-card border border-border bg-surface p-6 sm:p-8">
          <LegalDocumentContent documentId="privacy_policy" />
        </div>
      </div>
    </section>
  );
}
