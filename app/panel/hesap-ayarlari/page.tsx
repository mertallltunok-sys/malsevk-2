import type { Metadata } from "next";
import { AccountSettingsContent } from "../../_components/account-settings-content";

export const metadata: Metadata = {
  title: "Hesap Ayarları | MALSEVK.COM",
  description: "Hesabınız ve oturumunuzla ilgili ayarları yönetin.",
};

export default function HesapAyarlariPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <AccountSettingsContent />
      </div>
    </section>
  );
}
