"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { SessionProfileDetails } from "../_lib/session";
import { updateMyContactVisibilityRemote } from "../_lib/supabase-contact-visibility";
import type { UserRole } from "../_lib/types";
import { CONTACT_VISIBILITY_MIN_ONE_MESSAGE } from "../_lib/users";

/**
 * Hesap Ayarları'na eklenen "İletişim Bilgisi Görünürlüğü" bölümü —
 * `basic-profile-editor.tsx` ile AYNI submit/loading/success/error deseni VE
 * AYNI veri kaynağı (`SessionProfileDetails`, GERÇEK Supabase `profiles`
 * satırı — localStorage `StoredUser` aynası DEĞİL, bkz. görev tanımı "asıl
 * kaynak Supabase olmalı"). BİLEREK role-gated DEĞİL (account-settings-
 * content.tsx'e hem hizmet-alan hem hizmet-veren için render edilir).
 */
export function ContactVisibilitySettings({
  profileDetails,
  role,
}: {
  profileDetails: SessionProfileDetails;
  role: UserRole;
}) {
  const [showEmail, setShowEmail] = useState(profileDetails.showEmailAfterAgreement);
  const [showPhone, setShowPhone] = useState(profileDetails.showPhoneAfterAgreement);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  /**
   * En az bir iletişim yönteminin her zaman açık kalması gereken kural
   * (bkz. görev tanımı) — kullanıcı seçili olan SON yöntemi de kapatmaya
   * çalışırsa değişiklik hiç uygulanmaz, yalnızca uyarı gösterilir. Bu
   * yalnızca bir kolaylık/erken-uyarı katmanıdır; asıl, atlanamaz kontrol
   * `users.ts#updateContactVisibility`de (aşağıdaki handleSubmit) tekrar
   * yapılır.
   */
  function handleEmailChange(checked: boolean) {
    if (!checked && !showPhone) {
      setWarning(CONTACT_VISIBILITY_MIN_ONE_MESSAGE);
      return;
    }
    setWarning(null);
    setShowEmail(checked);
  }

  function handlePhoneChange(checked: boolean) {
    if (!checked && !showEmail) {
      setWarning(CONTACT_VISIBILITY_MIN_ONE_MESSAGE);
      return;
    }
    setWarning(null);
    setShowPhone(checked);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setJustSaved(false);

    const result = await updateMyContactVisibilityRemote({
      showEmailAfterAgreement: showEmail,
      showPhoneAfterAgreement: showPhone,
      currentRole: role,
      currentName: profileDetails.fullName,
      currentEmail: profileDetails.email,
      currentPhone: profileDetails.phone ?? "",
    });

    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setJustSaved(true);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">
        İletişim Bilgisi Görünürlüğü
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Bir teklif kabul edilip anlaşma tamamlandıktan sonra, karşı tarafın e-posta adresinizi ve/veya
        telefon numaranızı görüp göremeyeceğini buradan belirleyebilirsiniz. Anlaşma tamamlanmadan önce bu
        bilgiler hiçbir zaman paylaşılmaz.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={showEmail}
            onChange={(event) => handleEmailChange(event.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          E-posta adresimi göster
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={showPhone}
            onChange={(event) => handlePhoneChange(event.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          Telefon numaramı göster
        </label>

        {warning && (
          <p role="alert" className="text-sm text-danger">
            {warning}
          </p>
        )}

        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}
        {justSaved && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            İletişim bilgisi tercihiniz kaydedildi.
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Kaydediliyor..." : "Tercihi Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
