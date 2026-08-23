import type { Metadata } from "next";
import { UpdatePasswordForm } from "../_components/update-password-form";

export const metadata: Metadata = {
  title: "Yeni Şifre Belirle | MALSEVK.COM",
  description: "Hesabınız için yeni bir şifre belirleyin.",
};

export default function SifreGuncellePage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">Yeni Şifre Belirle</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">Hesabınız için yeni bir şifre girin.</p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <UpdatePasswordForm />
        </div>
      </div>
    </section>
  );
}
