import { Lock } from "lucide-react";
import { ButtonLink } from "./button-link";

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
   * gösterilir (bkz. guest-access-card.tsx#GuestAccessCard) — bunu
   * geçmeyen çağrı yerlerinin görünümü hiç değişmez.
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
            <ButtonLink href={`/giris-yap?redirect=${encodeURIComponent(loginRedirect)}`}>
              Giriş Yap
            </ButtonLink>
          )}
          {registerRedirect && (
            <ButtonLink
              href={`/giris-yap?mode=kayit&redirect=${encodeURIComponent(registerRedirect)}`}
              variant="secondary"
            >
              Kayıt Ol
            </ButtonLink>
          )}
        </div>
      )}
      {action && (
        <ButtonLink href={action.href} className="mt-4">
          {action.label}
        </ButtonLink>
      )}
    </div>
  );
}
