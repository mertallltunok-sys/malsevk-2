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

const AUTH_CONFIRM_ERROR_MESSAGES: Record<string, string> = {
  "dogrulama-eksik": "Doğrulama bağlantısı eksik veya geçersiz.",
  "dogrulama-basarisiz": "Doğrulama bağlantısının süresi dolmuş veya daha önce kullanılmış. Lütfen tekrar deneyin.",
};

export default async function GirisYapPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect?: string;
    mode?: string;
    hata?: string;
    "sifre-guncellendi"?: string;
    emailConfirmed?: string;
  }>;
}) {
  const params = await searchParams;
  const redirectTo = resolveRedirectTarget(params.redirect);
  const initialMode = params.mode === "kayit" ? "kayit" : "giris";
  const confirmErrorMessage = params.hata ? AUTH_CONFIRM_ERROR_MESSAGES[params.hata] : undefined;
  const passwordUpdated = params["sifre-guncellendi"] === "1";
  const emailJustConfirmed = params.emailConfirmed === "1";

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">
          Giriş Yap / Kayıt Ol
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Devam etmek için e-posta adresinizi ve şifrenizi girin.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          <LoginForm
            redirectTo={redirectTo}
            initialMode={initialMode}
            confirmErrorMessage={confirmErrorMessage}
            passwordUpdated={passwordUpdated}
            emailJustConfirmed={emailJustConfirmed}
          />
        </div>
      </div>
    </section>
  );
}
