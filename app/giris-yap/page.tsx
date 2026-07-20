import type { Metadata } from "next";
import { LoginForm } from "../_components/login-form";

export const metadata: Metadata = {
  title: "Giriş Yap / Kayıt Ol | MALSEVK.COM",
  description: "E-posta ve şifrenizle MALSEVK'e giriş yapın veya yeni bir hesap oluşturun.",
};

function resolveRedirectTarget(redirect: string | undefined): string {
  if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }
  return "/";
}

export default async function GirisYapPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = resolveRedirectTarget(params.redirect);
  const initialMode = params.mode === "kayit" ? "kayit" : "giris";

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Giriş Yap / Kayıt Ol
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Devam etmek için e-posta adresinizi ve şifrenizi girin.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} />
        </div>
      </div>
    </section>
  );
}
