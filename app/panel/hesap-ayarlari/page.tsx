import type { Metadata } from "next";
import { AccountSettingsContent } from "../../_components/account-settings-content";
import { PageContainer } from "../../_components/page-container";

export const metadata: Metadata = {
  title: "Hesap Ayarları | MALSEVK.COM",
  description: "Hesabınız ve oturumunuzla ilgili ayarları yönetin.",
};

export default function HesapAyarlariPage() {
  return (
    <section className="bg-background">
      <PageContainer size="form" className="py-16">
        <AccountSettingsContent />
      </PageContainer>
    </section>
  );
}
