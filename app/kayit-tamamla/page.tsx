import type { Metadata } from "next";
import { CompleteRegistrationForm } from "../_components/complete-registration-form";

export const metadata: Metadata = {
  title: "Kaydınızı Tamamlayın | MALSEVK.COM",
  description: "E-posta adresiniz doğrulandı — hesap bilgilerinizi tamamlayarak MALSEVK'i kullanmaya başlayın.",
};

export default function KayitTamamlaPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">Kaydınızı Tamamlayın</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          E-posta adresiniz doğrulandı. Devam etmek için son birkaç bilgiyi tamamlayın.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <CompleteRegistrationForm />
        </div>
      </div>
    </section>
  );
}
