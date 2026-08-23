"use client";

import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { evaluatePasswordRules, isPasswordValid } from "../_lib/password-rules";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import { mapSupabaseAuthError } from "../_lib/supabase-auth-errors";

/**
 * "Profil İçinden Şifre Değiştirme" görevi — oturum açmış bir kullanıcının
 * (Hizmet Alan VEYA Hizmet Veren, aynı bileşen ikisinde de kullanılır,
 * account-settings-content.tsx'in eskiden `ComingSoonAction` ile "Yakında"
 * gösterdiği yerin YERİNE geçer) e-posta doğrulaması/bağlantı beklemeden
 * doğrudan şifresini değiştirmesi. `update-password-form.tsx` (Şifremi
 * Unuttum akışının "yeni şifre belirle" ekranı) İLE KARIŞTIRILMAMALI —
 * o, e-postadaki recovery bağlantısıyla kurulan GEÇİCİ bir oturumda çalışır
 * ve başarı sonrası kullanıcıyı sign-out edip girişe yönlendirir; bu
 * bileşen NORMAL, hâlâ aktif bir oturumda çalışır ve başarı sonrası
 * kullanıcıyı ASLA çıkışa zorlamaz (görev gereksinimi: "kullanıcıyı çıkış
 * yapıp yeniden giriş ekranına gitmeye zorlamamalısın").
 *
 * MEVCUT ŞİFRE DOĞRULAMASI: Supabase Auth'un `updateUser({password})`
 * fonksiyonu kendi başına eski şifreyi doğrulamaz (yalnızca AKTİF oturumu
 * günceller) — bu yüzden mevcut şifre, `signInWithPassword(email, mevcut
 * şifre)` ile GERÇEKTEN yeniden doğrulanır (başarısızsa "Mevcut şifreniz
 * hatalı." — Supabase'in kendi `invalid_credentials` kodu). Bu yeniden-giriş
 * mevcut oturumu (access/refresh token) YENİLER ama SONLANDIRMAZ — kullanıcı
 * hâlâ aynı hesapta, aynı sayfada kalır.
 *
 * "Yeni şifre mevcut şifreyle aynı olamaz" hem BURADA (girilen iki düz metin
 * karşılaştırılarak, hızlı/net geri bildirim için) HEM Supabase Auth'un
 * kendi `same_password` kontrolüyle (updateUser çağrısında, ikinci bir
 * güvenlik ağı olarak) uygulanır — ikisi de AYNI merkezi `mapSupabaseAuthError`
 * çevirisini kullanır.
 *
 * Şifreler/token'lar hiçbir yerde (console, Sistem Sağlığı, localStorage)
 * loglanmaz — yalnızca bu bileşenin kendi React state'inde, gönderim
 * sırasında Supabase'in resmî istemci kütüphanesine (HTTPS üzerinden) geçer.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Çift gönderim koruması — Genel Güvenlik görevinin offer-form.tsx/
  // document-upload-content.tsx'te kurduğu AYNI senkron ref deseni (React
  // state'i asenkron güncellendiği için tek başına `submitting` kontrolü
  // hızlı bir çift-tıklamayı YAKALAYAMAZ).
  const submitLockRef = useRef(false);

  const passwordRules = evaluatePasswordRules(newPassword, confirmPassword);
  const allPasswordRulesMet = passwordRules.every((rule) => rule.met);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;
    setFormError(null);
    setSuccessMessage(null);

    if (currentPassword.trim().length === 0) {
      setFormError("Mevcut şifrenizi giriniz.");
      return;
    }
    if (!isPasswordValid(newPassword)) {
      setFormError("Yeni şifre yukarıdaki tüm kuralları karşılamalıdır.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Yeni şifreler eşleşmiyor.");
      return;
    }
    if (newPassword === currentPassword) {
      setFormError("Yeni şifreniz mevcut şifrenizden farklı olmalıdır.");
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyError) {
        setFormError(verifyError.code === "invalid_credentials" ? "Mevcut şifreniz hatalı." : mapSupabaseAuthError(verifyError));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setFormError(mapSupabaseAuthError(updateError));
        return;
      }

      setSuccessMessage("Şifreniz başarıyla değiştirildi.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-5">
      <div>
        <label htmlFor={currentPasswordId} className="text-sm font-medium text-foreground">
          Mevcut Şifre
        </label>
        <div className="relative mt-2">
          <input
            id={currentPasswordId}
            type={showPasswords ? "text" : "password"}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-md border border-border bg-surface px-4 py-3 pr-11 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPasswords((value) => !value)}
            aria-label={showPasswords ? "Şifreleri gizle" : "Şifreleri göster"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor={newPasswordId} className="text-sm font-medium text-foreground">
          Yeni Şifre
        </label>
        <input
          id={newPasswordId}
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            allPasswordRulesMet ? "border-success" : "border-border"
          }`}
          placeholder="••••••••"
        />
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {passwordRules.map((rule) => (
            <li
              key={rule.id}
              className={`flex items-center gap-2 text-xs transition-colors ${rule.met ? "text-success" : "text-muted-foreground"}`}
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
          type={showPasswords ? "text" : "password"}
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
      {successMessage && (
        <p role="status" className="text-sm text-success">
          {successMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-disabled={submitting}
        className="inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {submitting ? "Kaydediliyor..." : "Şifreyi Değiştir"}
      </button>
    </form>
  );
}
