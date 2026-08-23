import type { Metadata } from "next";
import { ForgotPasswordForm } from "../_components/forgot-password-form";

export const metadata: Metadata = {
  title: "Şifremi Unuttum | MALSEVK.COM",
  description: "Şifrenizi sıfırlamak için e-posta adresinizi girin.",
};

export default function SifreSifirlaPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">Şifremi Unuttum</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          E-posta adresinizi girin, size bir şifre sıfırlama bağlantısı gönderelim.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </section>
  );
}
