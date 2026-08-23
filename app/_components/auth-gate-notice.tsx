import { Lock } from "lucide-react";
import { ButtonLink } from "./button-link";

export function AuthGateNotice({
  message,
  description,
  loginRedirect,
  registerRedirect,
  action,
  bare = false,
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
  /**
   * `true` iken kendi `rounded-card border ... p-6` kabuğunu HİÇ render
   * etmez — yalnızca ikon/mesaj/buton içeriği döner. Çağıran taraf ZATEN
   * kendi kartının içine yerleştiriyorsa (bkz. offer-panel.tsx, ilan detay
   * sayfasının "Teklif Ver" kartı) iç içe/çift kart görünümünü önlemek
   * için — masaüstü ilan detay yoğunlaştırma görevi. Varsayılan `false`:
   * bu bileşenin diğer ~25 çağrı yerinin (kendi bağımsız kartını
   * gerektiren) görünümü BİREBİR AYNI kalır.
   */
  bare?: boolean;
}) {
  const content = (
    <>
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
    </>
  );

  if (bare) {
    return <div className="text-center">{content}</div>;
  }

  return <div className="rounded-card border border-border bg-surface p-6 text-center sm:p-8">{content}</div>;
}
