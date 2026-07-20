"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { validateOfferForm, type OfferFormErrors } from "../_lib/offer-form-validation";
import { createOffer } from "../_lib/offers";
import type { Currency, Job, Offer, Session } from "../_lib/types";

const DESCRIPTION_MAX_LENGTH = 1000;

export function OfferForm({
  job,
  session,
  onSuccess,
}: {
  job: Job;
  session: Session;
  onSuccess: (offer: Offer) => void;
}) {
  const currencyId = useId();
  const amountId = useId();
  const descriptionId = useId();
  const durationId = useId();

  const [currency, setCurrency] = useState<Currency>("TRY");
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const [errors, setErrors] = useState<OfferFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleAmountChange(event: React.ChangeEvent<HTMLInputElement>) {
    // Yalnızca rakam, nokta ve virgüle izin ver; başka hiçbir karakteri
    // kabul etme. Değeri yeniden biçimlendirme veya yuvarlama yapılmaz —
    // fiyat kaydedilirken (gönderim anında) ayrıştırılır.
    const filtered = event.target.value.replace(/[^0-9.,]/g, "");
    setAmountInput(filtered);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const { errors: fieldErrors, amount } = validateOfferForm({
      currency,
      amountInput,
      description,
      estimatedDuration,
    });

    setErrors(fieldErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0 || amount === null) {
      return;
    }

    setSubmitting(true);
    const result = createOffer(session, {
      jobId: job.id,
      amount,
      currency,
      description,
      estimatedDuration,
    });
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    onSuccess(result.offer);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor={currencyId} className="text-sm font-medium text-foreground">
            Para Birimi
          </label>
          <select
            id={currencyId}
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            aria-invalid={errors.currency ? true : undefined}
            aria-describedby={errors.currency ? `${currencyId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="TRY">Türk Lirası (TRY)</option>
            <option value="USD">Amerikan Doları (USD)</option>
          </select>
          {errors.currency && (
            <p id={`${currencyId}-error`} className="mt-2 text-sm text-danger">
              {errors.currency}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={amountId} className="text-sm font-medium text-foreground">
            Teklif Fiyatı
          </label>
          <div className="relative mt-2">
            <input
              id={amountId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountInput}
              onChange={handleAmountChange}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? `${amountId}-error` : undefined}
              placeholder="Ör. 12500,50"
              className="w-full rounded-md border border-border bg-surface px-4 py-3 pr-12 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground"
            >
              {currency === "TRY" ? "TL" : "USD"}
            </span>
          </div>
          {errors.amount && (
            <p id={`${amountId}-error`} className="mt-2 text-sm text-danger">
              {errors.amount}
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={descriptionId} className="text-sm font-medium text-foreground">
            Teklif Açıklaması
          </label>
          <span className="text-xs text-muted-foreground">
            {description.trim().length} / {DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={DESCRIPTION_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
          placeholder="Hizmet kapsamınızı, ekip ve ekipman uygunluğunuzu açıklayın."
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.description && (
          <p id={`${descriptionId}-error`} className="mt-2 text-sm text-danger">
            {errors.description}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={durationId} className="text-sm font-medium text-foreground">
          Tahmini Hizmet Süresi
        </label>
        <input
          id={durationId}
          type="text"
          value={estimatedDuration}
          onChange={(event) => setEstimatedDuration(event.target.value)}
          maxLength={100}
          aria-invalid={errors.estimatedDuration ? true : undefined}
          aria-describedby={
            errors.estimatedDuration ? `${durationId}-error` : undefined
          }
          placeholder="Örnek: 1 iş günü"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.estimatedDuration && (
          <p id={`${durationId}-error`} className="mt-2 text-sm text-danger">
            {errors.estimatedDuration}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-disabled={submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting && (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {submitting ? "Teklif gönderiliyor..." : "Teklif Gönder"}
      </button>
    </form>
  );
}
