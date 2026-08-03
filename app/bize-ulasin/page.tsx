import type { Metadata } from "next";
import { ClosePageButton } from "../_components/close-page-button";
import { ContactSection } from "../_components/contact-section";

export const metadata: Metadata = {
  title: "Bize Ulaşın | MALSEVK.COM",
  description: "Sorularınız, talepleriniz veya geri bildirimleriniz için MALSEVK.COM ekibiyle iletişime geçin.",
};

/**
 * Footer'ın sol marka/açıklama kolonundaki "Bize Ulaşın" bağlantısının
 * (bkz. site-footer.tsx) tek hedefi — legal-documents.ts'in standalone
 * sayfalarıyla (`app/gizlilik-politikasi` vb.) AYNI desen: gerçek bir rota,
 * pop-up/modal/dialog DEĞİL (bkz. görev tanımı: önceki modal kararı iptal
 * edildi). Büyük bir "MALSEVK.com" başlığı YOKTUR — sayfanın tek/ana
 * başlığı `ContactSection`'ın kendi içerdiği "Bize Ulaşın" `<h1>`ıdır.
 * `ClosePageButton` diğer bağımsız sayfalarla (Gizlilik Politikası vb.)
 * AYNI bileşendir — tarayıcı geçmişi varsa geldiği sayfaya, yoksa ana
 * sayfaya döner.
 */
export default function BizeUlasinPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex justify-end">
          <ClosePageButton />
        </div>
        <div className="mt-6 rounded-card border border-border bg-surface p-6 sm:p-8">
          <ContactSection />
        </div>
      </div>
    </section>
  );
}
