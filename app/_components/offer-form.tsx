"use client";

import { Loader2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { validateOfferForm, type OfferFormErrors } from "../_lib/offer-form-validation";
import { createOffer, MAX_COMMITTED_DAYS, MIN_COMMITTED_DAYS } from "../_lib/offers";
import { isTransportationCategory } from "../_lib/product-catalog";
import { isRecyclingCategory, RECYCLING_COMMERCIAL_DIRECTION_OPTIONS, type RecyclingCommercialDirection } from "../_lib/recycling-catalog";
import type { Currency, Job, Offer, Session } from "../_lib/types";

const DESCRIPTION_MAX_LENGTH = 1000;

/**
 * İlan detay sayfası masaüstü tek-ekran yoğunlaştırma görevi (3. tur) —
 * ayrı "Para Birimi" + "Teklif Fiyatı" alanları eşit genişlikte yan yana
 * dururken uzun seçenek metinleri ("Türk Lirası (TRY)") kesiliyordu. Tek
 * başlık ("Teklif Tutarı") altında birleşik bir kontrol: sabit dar bir para
 * birimi `<select>` (kısa "₺ TRY" biçiminde — money.ts#getCurrencyLabel'ın
 * KENDİSİ DEĞİL, o fonksiyon `"12.500,50 TL"` gibi biçimlendirilmiş tutarlar
 * için "TL" tarzı bir SON EK üretir; burada amaç farklı — SEÇİM listesinde
 * sembol+kod birlikte kısa gösterim — bu yüzden ayrı, yalnızca bu dosyaya
 * özel küçük bir eşleme kullanılır, money.ts'in kendisi DEĞİŞMEDİ) + kalan
 * genişliği kullanan fiyat input'u. Doğrulama/gönderim mantığı (validateOfferForm,
 * createOffer) BİREBİR AYNI — yalnızca sunum birleşti.
 */
const CURRENCY_SELECT_LABELS: Record<Currency, string> = { TRY: "₺ TRY", USD: "$ USD", EUR: "€ EUR" };

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
  const commercialDirectionId = useId();

  const [currency, setCurrency] = useState<Currency>("TRY");
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState<number | "">("");
  const [commercialDirection, setCommercialDirection] = useState<RecyclingCommercialDirection | "">("");
  const [errors, setErrors] = useState<OfferFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Genel Güvenlik görevi §15 — çift-gönderim koruması: React state
  // (submitting) tek başına aynı JS event-loop turundaki art arda iki
  // tıklama/Enter'ı durduramaz (state commit edilmeden önce ikinci çağrı da
  // handleSubmit'e ulaşabilir) — job-request-form.tsx#handlePublish'teki
  // submitLockRef İLE AYNI, senkron, render'dan bağımsız kilit deseni.
  const submitLockRef = useRef(false);

  const dayOptions = useMemo(
    () => Array.from({ length: MAX_COMMITTED_DAYS - MIN_COMMITTED_DAYS + 1 }, (_, index) => MIN_COMMITTED_DAYS + index),
    [],
  );

  function handleAmountChange(event: React.ChangeEvent<HTMLInputElement>) {
    // Yalnızca rakam, nokta ve virgüle izin ver; başka hiçbir karakteri
    // kabul etme. Değeri yeniden biçimlendirme veya yuvarlama yapılmaz —
    // fiyat kaydedilirken (gönderim anında) ayrıştırılır.
    const filtered = event.target.value.replace(/[^0-9.,]/g, "");
    setAmountInput(filtered);
  }

  const requiresEstimatedDuration = isTransportationCategory(job.category);
  const requiresCommercialDirection = isRecyclingCategory(job.category);
  const isFreePickup = requiresCommercialDirection && commercialDirection === "ucretsiz-alim";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitLockRef.current) return;

    const { errors: fieldErrors, amount } = validateOfferForm({
      currency,
      amountInput,
      description,
      estimatedDuration,
      category: job.category,
      commercialDirection,
    });

    setErrors(fieldErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0 || amount === null || (requiresEstimatedDuration && estimatedDuration === "")) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const result = await createOffer(session, {
        jobId: job.id,
        amount,
        currency,
        description,
        estimatedDuration: requiresEstimatedDuration && estimatedDuration !== "" ? estimatedDuration : undefined,
        commercialDirection: requiresCommercialDirection && commercialDirection !== "" ? commercialDirection : undefined,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      onSuccess(result.offer);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {requiresCommercialDirection && (
        <div>
          <label htmlFor={commercialDirectionId} className="text-sm font-medium text-foreground">
            Teklifin Ticari Yönü
          </label>
          <select
            id={commercialDirectionId}
            value={commercialDirection}
            onChange={(event) => setCommercialDirection(event.target.value as RecyclingCommercialDirection | "")}
            aria-invalid={errors.commercialDirection ? true : undefined}
            aria-describedby={errors.commercialDirection ? `${commercialDirectionId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Seçiniz</option>
            {RECYCLING_COMMERCIAL_DIRECTION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {commercialDirection && (
            <p className="mt-2 text-xs text-muted-foreground">
              {RECYCLING_COMMERCIAL_DIRECTION_OPTIONS.find((option) => option.id === commercialDirection)?.description}
            </p>
          )}
          {errors.commercialDirection && (
            <p id={`${commercialDirectionId}-error`} className="mt-2 text-sm text-danger">
              {errors.commercialDirection}
            </p>
          )}
        </div>
      )}

      {!isFreePickup && (
        <div>
          <label htmlFor={amountId} className="text-sm font-medium text-foreground">
            {requiresCommercialDirection && commercialDirection === "atik-satin-alma" ? "Teklif Ettiğiniz Bedel" : "Teklif Tutarı"}
          </label>
          <div className="mt-2 flex gap-2">
            <select
              id={currencyId}
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              aria-label="Para birimi"
              aria-invalid={errors.currency ? true : undefined}
              aria-describedby={errors.currency ? `${currencyId}-error` : undefined}
              className="h-[52px] w-[96px] shrink-0 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {(Object.keys(CURRENCY_SELECT_LABELS) as Currency[]).map((value) => (
                <option key={value} value={value}>
                  {CURRENCY_SELECT_LABELS[value]}
                </option>
              ))}
            </select>
            <input
              id={amountId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountInput}
              onChange={handleAmountChange}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? `${amountId}-error` : undefined}
              placeholder="0,00"
              className="h-[52px] min-w-0 flex-1 rounded-md border border-border bg-surface px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          {errors.currency && (
            <p id={`${currencyId}-error`} className="mt-2 text-sm text-danger">
              {errors.currency}
            </p>
          )}
          {errors.amount && (
            <p id={`${amountId}-error`} className="mt-2 text-sm text-danger">
              {errors.amount}
            </p>
          )}
        </div>
      )}

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

      {requiresEstimatedDuration && (
        <div>
          <label htmlFor={durationId} className="text-sm font-medium text-foreground">
            Taahhüt Edilen Süre
          </label>
          <select
            id={durationId}
            value={estimatedDuration}
            onChange={(event) => setEstimatedDuration(event.target.value === "" ? "" : Number(event.target.value))}
            aria-invalid={errors.estimatedDuration ? true : undefined}
            aria-describedby={errors.estimatedDuration ? `${durationId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Gün seçiniz</option>
            {dayOptions.map((day) => (
              <option key={day} value={day}>
                {day} gün
              </option>
            ))}
          </select>
          {errors.estimatedDuration && (
            <p id={`${durationId}-error`} className="mt-2 text-sm text-danger">
              {errors.estimatedDuration}
            </p>
          )}
        </div>
      )}

      {submitError && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-disabled={submitting}
        className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting && (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {submitting ? "Teklif gönderiliyor..." : "Teklif Gönder"}
      </button>
    </form>
  );
}
