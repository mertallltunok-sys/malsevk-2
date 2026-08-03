"use client";

import { Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_MESSAGE_MIN_LENGTH,
  CONTACT_MESSAGE_SUBJECT_OPTIONS,
  submitContactMessage,
  type ContactMessageSubject,
} from "../_lib/contact-messages";
import { findUserById } from "../_lib/users";
import { useSession } from "../_lib/use-session";

const SUCCESS_MESSAGE = "Mesajınız bize ulaştı. En kısa sürede sizinle iletişime geçeceğiz.";
/** Başarılı bir gönderimden sonra butonun yeniden aktifleşmesine kadar geçen süre — "temel spam koruması"nın bir parçası (bkz. görev tanımı), art arda gönderim akışını yavaşlatır. */
const RESUBMIT_COOLDOWN_MS = 15_000;

/**
 * Kurumsal "Bize Ulaşın" formu — TEK erişim noktası `app/bize-ulasin/page.tsx`,
 * `site-footer.tsx`'in footer'daki "Bize Ulaşın" bağlantısının GERÇEKTEN
 * yönlendirdiği bağımsız sayfa (pop-up/modal/dialog DEĞİL — bkz. görev
 * tanımı: önceki modal kararı iptal edildi). Sayfa kendi başlığını
 * (yalnızca "Bize Ulaşın", büyük bir "MALSEVK.com" başlığı OLMADAN) ve
 * "Kapat" davranışını (bkz. close-page-button.tsx) sağladığı için bu
 * bileşenin kendisi bir `<h1>`den başlayan, dış bir kart/sayfa sarmalayıcısı
 * OLMAYAN çıplak bir `<>...</>` parçasıdır — sayfa (`app/bize-ulasin/page.tsx`)
 * onu diğer bağımsız sayfalarla (Gizlilik Politikası vb.) AYNI
 * `rounded-card border` kutusuna oturtur. Giriş yapılmış/yapılmamış AYRI
 * bir görünüm DEĞİLDİR, TEK bileşen her iki durumda da render edilir;
 * yalnızca giriş yapılmışsa Ad Soyad/E-posta/Telefon `users.ts#findUserById`
 * ile önceden doldurulur (kullanıcı gönderimden önce değiştirebilir).
 * Gönderilen veri contact-messages.ts'in localStorage "tablosuna" yazılır ve
 * Admin > Bize Ulaşın modülünde (bkz. contact-messages-admin-panel.tsx)
 * gerçek bir kayıt olarak görünür — bu yalnızca görsel bir demo değildir.
 */
export function ContactSection() {
  const session = useSession();
  const profile = session ? findUserById(session.id) : null;

  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const subjectId = useId();
  const messageId = useId();
  const honeypotId = useId();

  const [name, setName] = useState(profile?.name ?? session?.name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [subject, setSubject] = useState<ContactMessageSubject | "">("");
  const [message, setMessage] = useState("");
  // Bot doldurma tuzağı: gerçek kullanıcılar bu alanı hiç görmez/doldurmaz
  // (CSS ile gizli) — doluysa gönderim sessizce (kullanıcıya hata GÖSTERMEDEN,
  // bot'u fark ettirmeden) reddedilir. Ayrı bir sunucu/servis GEREKMEZ.
  const [honeypot, setHoneypot] = useState("");

  const [errors, setErrors] = useState<{ name?: string; email?: string; phone?: string; subject?: string; message?: string }>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ referenceNumber: string } | null>(null);
  const [cooldownActive, setCooldownActive] = useState(false);
  // job-request-form.tsx#submitLockRef ile AYNI ilke: React state (submitting)
  // yalnızca UI'yi sürer, aynı event-loop turunda art arda iki tıklamaya karşı
  // senkron/render'dan bağımsız asıl kilit budur.
  const submitLockRef = useRef(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current || cooldownActive) return;

    if (honeypot.trim().length > 0) {
      // Bot: kullanıcıya normal başarı deneyimi göster, hiçbir şey kaydetme.
      setSuccessInfo({ referenceNumber: "" });
      return;
    }

    const nextErrors: typeof errors = {};
    if (name.trim().length === 0) nextErrors.name = "Ad soyad zorunludur.";
    if (subject === "") nextErrors.subject = "Konu seçiniz.";
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      nextErrors.message = "Mesaj zorunludur.";
    } else if (trimmedMessage.length < CONTACT_MESSAGE_MIN_LENGTH) {
      nextErrors.message = `Mesaj en az ${CONTACT_MESSAGE_MIN_LENGTH} karakter olmalıdır.`;
    } else if (trimmedMessage.length > CONTACT_MESSAGE_MAX_LENGTH) {
      nextErrors.message = `Mesaj en fazla ${CONTACT_MESSAGE_MAX_LENGTH} karakter olabilir.`;
    }
    if (email.trim().length === 0 && phone.trim().length === 0) {
      nextErrors.email = "E-posta veya telefon numaranızdan en az birini giriniz.";
    }

    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    submitLockRef.current = true;
    setSubmitting(true);
    const result = submitContactMessage({
      session,
      name,
      email,
      phone,
      subject: subject as ContactMessageSubject,
      message,
    });
    setSubmitting(false);
    submitLockRef.current = false;

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    setSuccessInfo({ referenceNumber: result.contactMessage.referenceNumber });
    setSubject("");
    setMessage("");
    setCooldownActive(true);
    setTimeout(() => setCooldownActive(false), RESUBMIT_COOLDOWN_MS);
  }

  return (
    <>
      <h1 id="bize-ulasin-baslik" className="text-2xl font-bold tracking-heading leading-tight text-foreground sm:text-3xl">
        Bize Ulaşın
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Sorularınız, talepleriniz veya geri bildirimleriniz için aşağıdaki formu doldurun; ekibimiz en kısa sürede
        size dönüş yapsın.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <div className="hidden" aria-hidden="true">
          <label htmlFor={honeypotId}>Bu alanı boş bırakın</label>
          <input
            id={honeypotId}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className="text-sm font-medium text-foreground">
              Ad Soyad
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.name ? "border-danger" : "border-border"
              }`}
            />
            {errors.name && (
              <p id={`${nameId}-error`} className="mt-2 text-sm text-danger">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={subjectId} className="text-sm font-medium text-foreground">
              Konu
            </label>
            <select
              id={subjectId}
              value={subject}
              onChange={(event) => setSubject(event.target.value as ContactMessageSubject | "")}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? `${subjectId}-error` : undefined}
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.subject ? "border-danger" : "border-border"
              }`}
            >
              <option value="">Seçiniz</option>
              {CONTACT_MESSAGE_SUBJECT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.subject && (
              <p id={`${subjectId}-error`} className="mt-2 text-sm text-danger">
                {errors.subject}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={emailId} className="text-sm font-medium text-foreground">
              E-posta <span className="font-normal text-muted-foreground">(ikisinden en az biri zorunlu)</span>
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${emailId}-error` : undefined}
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.email ? "border-danger" : "border-border"
              }`}
            />
            {errors.email && (
              <p id={`${emailId}-error`} className="mt-2 text-sm text-danger">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={phoneId} className="text-sm font-medium text-foreground">
              Telefon Numarası <span className="font-normal text-muted-foreground">(ikisinden en az biri zorunlu)</span>
            </label>
            <input
              id={phoneId}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="05XX XXX XX XX"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? `${phoneId}-error` : undefined}
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.phone ? "border-danger" : "border-border"
              }`}
            />
            {errors.phone && (
              <p id={`${phoneId}-error`} className="mt-2 text-sm text-danger">
                {errors.phone}
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={messageId} className="text-sm font-medium text-foreground">
              Mesaj
            </label>
            <span className="text-xs text-muted-foreground">
              {message.trim().length} / {CONTACT_MESSAGE_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id={messageId}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={CONTACT_MESSAGE_MAX_LENGTH}
            rows={5}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={errors.message ? `${messageId}-error` : undefined}
            placeholder="Mesajınızı buraya yazın..."
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.message ? "border-danger" : "border-border"
            }`}
          />
          {errors.message && (
            <p id={`${messageId}-error`} className="mt-2 text-sm text-danger">
              {errors.message}
            </p>
          )}
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}
        {successInfo && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            {SUCCESS_MESSAGE}
            {successInfo.referenceNumber && ` Kayıt numaranız: ${successInfo.referenceNumber}.`}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting || cooldownActive}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Gönderiliyor..." : "Gönder"}
          </button>
        </div>
      </form>
    </>
  );
}
