import type { Metadata } from "next";
import { ContactMessagesAdminPanel } from "../../_components/contact-messages-admin-panel";

export const metadata: Metadata = {
  title: "Bize Ulaşın Mesajları | MALSEVK.COM",
  description: "Ana sayfadaki Bize Ulaşın formundan gelen mesajları inceleyin ve yönetin.",
};

export default function AdminContactMessagesPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <ContactMessagesAdminPanel />
      </div>
    </section>
  );
}
