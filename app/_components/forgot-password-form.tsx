"use client";

import { Loader2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { isValidEmail } from "../_lib/login-form-validation";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import { mapSupabaseAuthError } from "../_lib/supabase-auth-errors";

/**
 * "Kullanıcının var olup olmadığını gereksiz yere açığa çıkaran mesaj
 * kullanma" gereksinimi: `resetPasswordForEmail` çağrısı BAŞARISIZ (ağ/rate
 * limit hatası HARİÇ) olsa bile Supabase'in kendisi zaten var olmayan bir
 * e-posta için sessizce "başarı" döner (numaralandırma saldırılarına karşı
 * kendi tasarımı) — bu form da AYNI ilkeyle, gerçek bir hata (ör. rate
 * limit) OLMADIĞI sürece her zaman TEK, nötr bir başarı mesajı gösterir.
 */
export function ForgotPasswordForm() {
  const emailId = useId();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // login-form.tsx#registerSubmitLockRef İLE AYNI desen: React state
  // (submitting) yalnızca UI'yi sürer, aynı event-loop turunda gelen hızlı
  // bir çift tıklama/Enter state commit edilmeden ÖNCE handler'a ikinci kez
  // ulaşabilir — bu, `resetPasswordForEmail`in paylaştığı çok kısıtlı
  // saatlik e-posta kotasını (bkz. Supabase Auth rate limit) gereksiz yere
  // tüketebilir. Senkron, render'dan bağımsız kilit.
  const submitLockRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      setFormError(null);

      const trimmedEmail = email.trim();
      if (!isValidEmail(trimmedEmail)) {
        setFormError("Geçerli bir e-posta adresi giriniz.");
        return;
      }

      setSubmitting(true);
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/sifre-guncelle`,
      });
      setSubmitting(false);

      if (error) {
        setFormError(mapSupabaseAuthError(error));
        return;
      }
      setSent(true);
    } finally {
      submitLockRef.current = false;
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-sm leading-relaxed text-foreground">
          Bu e-posta adresiyle bir hesap varsa, şifre sıfırlama bağlantısını içeren bir e-posta gönderdik.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          E-postayı bulamıyorsanız gereksiz/spam klasörünü kontrol edin.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div>
        <label htmlFor={emailId} className="text-sm font-medium text-foreground">
          E-posta
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="ornek@sirket.com"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-disabled={submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {submitting ? "Gönderiliyor..." : "Sıfırlama Bağlantısı Gönder"}
      </button>
    </form>
  );
}
