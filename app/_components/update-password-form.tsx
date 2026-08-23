"use client";

import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { evaluatePasswordRules, isPasswordValid } from "../_lib/password-rules";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import { mapSupabaseAuthError } from "../_lib/supabase-auth-errors";

type Status = "checking" | "ready" | "no-session";

/**
 * Yalnızca gerçek bir "recovery" oturumu varken anlamlıdır — bu oturum,
 * `app/auth/confirm/route.ts`in `type=recovery` dalının `verifyOtp` ile
 * kurduğu oturumdur (bkz. o dosyanın dokümantasyonu). Doğrudan bu sayfaya
 * (bağlantı olmadan) gelen bir ziyaretçi için `getUser()` boş döner ve
 * anlaşılır bir "önce bağlantıya tıklayın" mesajı gösterilir.
 */
export function UpdatePasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const passwordId = useId();
  const confirmPasswordId = useId();

  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setStatus(user ? "ready" : "no-session");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca mount anında bir kez çalışmalı.
  }, []);

  const passwordRules = evaluatePasswordRules(password, confirmPassword);
  const allPasswordRulesMet = passwordRules.every((rule) => rule.met);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    if (!isPasswordValid(password)) {
      setFormError("Şifre yukarıdaki tüm kuralları karşılamalıdır.");
      return;
    }
    if (confirmPassword !== password) {
      setFormError("Şifreler eşleşmiyor.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      setFormError(mapSupabaseAuthError(error));
      return;
    }

    // Recovery oturumu tek kullanımlıktır — güncelleme sonrası kapatılır ve
    // kullanıcı yeni şifresiyle normal girişe yönlendirilir (görev
    // gereksinimi: "başarı sonrası giriş ekranına yönlendirme").
    await supabase.auth.signOut();
    setSubmitting(false);
    router.push("/giris-yap?sifre-guncellendi=1");
  }

  if (status === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        Kontrol ediliyor...
      </div>
    );
  }

  if (status === "no-session") {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Bu sayfayı kullanmak için önce e-postanıza gönderilen şifre sıfırlama bağlantısına tıklamalısınız. Bağlantı
        süresi dolmuş olabilir —{" "}
        <a href="/sifre-sifirla" className="underline decoration-dotted underline-offset-2 hover:text-accent">
          yeni bir bağlantı isteyin
        </a>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div>
        <label htmlFor={passwordId} className="text-sm font-medium text-foreground">
          Yeni Şifre
        </label>
        <div className="relative mt-2">
          <input
            id={passwordId}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`w-full rounded-md border bg-surface px-4 py-3 pr-11 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              allPasswordRulesMet ? "border-success" : "border-border"
            }`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {passwordRules.map((rule) => (
            <li
              key={rule.id}
              className={`flex items-center gap-2 text-xs transition-colors ${
                rule.met ? "text-success" : "text-muted-foreground"
              }`}
            >
              {rule.met ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              {rule.label}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label htmlFor={confirmPasswordId} className="text-sm font-medium text-foreground">
          Yeni Şifre Tekrar
        </label>
        <input
          id={confirmPasswordId}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            allPasswordRulesMet ? "border-success" : "border-border"
          }`}
          placeholder="••••••••"
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
        {submitting ? "Kaydediliyor..." : "Şifreyi Güncelle"}
      </button>
    </form>
  );
}
