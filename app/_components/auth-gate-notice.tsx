import { Lock } from "lucide-react";
import Link from "next/link";
import { buttonClassName } from "./button-link";

export function AuthGateNotice({
  message,
  description,
  loginRedirect,
  registerRedirect,
  action,
}: {
  message: string;
  /** İsteğe bağlı, `message`'ın altında gösterilen kısa ek açıklama. */
  description?: string;
  loginRedirect?: string;
  /**
   * Verilirse "Giriş Yap"ın yanında ikincil bir "Kayıt Ol" bağlantısı da
   * gösterilir (bkz. job-listings-auth-gate.tsx) — mevcut 9 çağrı yerinden
   * hiçbiri bunu geçmediği için onların görünümü hiç değişmez.
   */
  registerRedirect?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6 text-center sm:p-8">
      <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {(loginRedirect || registerRedirect) && (
        <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {loginRedirect && (
            <Link
              href={`/giris-yap?redirect=${encodeURIComponent(loginRedirect)}`}
              className={buttonClassName("primary")}
            >
              Giriş Yap
            </Link>
          )}
          {registerRedirect && (
            <Link
              href={`/giris-yap?mode=kayit&redirect=${encodeURIComponent(registerRedirect)}`}
              className={buttonClassName("secondary")}
            >
              Kayıt Ol
            </Link>
          )}
        </div>
      )}
      {action && (
        <Link href={action.href} className={`mt-4 ${buttonClassName("primary")}`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
