"use client";

import { useState } from "react";
import { getInitials } from "../_lib/profile";
import { submitRating } from "../_lib/ratings";
import type { Offer, Session } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { findUserById } from "../_lib/users";
import { DialogShell } from "./dialog-shell";
import { StarRatingInput } from "./star-rating-input";

const STARS_REQUIRED_MESSAGE = "Lütfen bir yıldız seçin.";

/**
 * "Tamamlandığını Onayla" onay modalıyla (bkz. offer-outcome-panel.tsx
 * #SimpleConfirmDialog) birebir aynı tasarım dilini (DialogShell, başlık
 * stili, buton boyutu/rengi) kullanan tek, paylaşılan değerlendirme modalı.
 * İki farklı çağrı noktasından açılır — ikisi de bu bileşeni kullanır, ayrı
 * bir modal yoktur:
 *  - Tamamlama onayından hemen sonra (bkz. incoming-offer-card.tsx /
 *    job-requests-panel.tsx'teki `onCompleted` kablosu).
 *  - "Hizmet Taleplerim > Tamamlanan" sekmesinde "Hizmeti Değerlendir"
 *    butonuyla (bkz. job-rating-widget.tsx).
 * `onClose(submitted)`: `submitted=true` yalnızca puan gerçekten
 * kaydedildiğinde; "Daha Sonra"/ESC/dış tıklama hepsi aynı `handleClose`'u
 * (dolayısıyla `submitted=false`'u) tetikler — DialogShell'in tek `onClose`
 * prop'u üzerinden bilerek aynı davranış.
 *
 * Başlığın altında, DEĞERLENDİRİLEN Hizmet Veren'in kimliği (logo varsa
 * logo, yoksa profile.ts#getInitials ile AYNI mevcut baş-harf-avatar deseni
 * — bkz. profile-info-card.tsx/panel-welcome-card.tsx; firma adı varsa o,
 * yoksa kullanıcı adı) gösterilir — `offer.providerId`den okunur, başka
 * hiçbir teklifin/sağlayıcının bilgisi bu bileşene hiç girmez (bkz. altta
 * `provider` değişkeninin yanındaki not).
 */
export function JobRatingModal({
  offer,
  session,
  onClose,
}: {
  offer: Offer;
  session: Session;
  onClose: (submitted: boolean) => void;
}) {
  const [selectedStars, setSelectedStars] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `offer` bu modala HER ZAMAN yalnızca teklifi kabul edilmiş VE işi
  // tamamlanmış tekli Hizmet Veren'in teklifi olarak gelir (bkz. iki çağıran
  // — job-requests-panel.tsx'in `getCompletedOfferForJob` sonucu ve
  // incoming-offer-card.tsx/offer-outcome-panel.tsx'in `onCompleted`
  // kablosu, ikisi de aynı, tek "accepted -> ... -> completed" teklifi
  // taşır) — bu yüzden burada AYRICA bir "kabul edilmiş mi" kontrolüne ya da
  // başka tekliflerin filtrelenmesine gerek yoktur; başka hiçbir teklif
  // sahibinin bilgisi bu bileşenin kapsamına hiç girmez.
  const provider = findUserById(offer.providerId);
  const providerProfile = provider?.providerProfile;
  const logoUrl = useJobPhotoUrl(providerProfile?.logoStorageKey ?? null);
  const providerDisplayName = providerProfile?.companyName?.trim() || (provider ? provider.name : "Hizmet Veren");

  function handleClose() {
    if (submitting) return;
    onClose(false);
  }

  function handleSubmit() {
    if (submitting) return;
    if (selectedStars === 0) {
      setError(STARS_REQUIRED_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = submitRating(session, offer.id, selectedStars);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose(true);
  }

  return (
    <DialogShell labelledBy="hizmeti-degerlendir-baslik" onClose={handleClose}>
      <h2 id="hizmeti-degerlendir-baslik" className="text-lg font-bold tracking-heading leading-tight text-foreground">
        Hizmeti Değerlendir
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- IndexedDB blob object URL, next/image optimize edemez
            <img src={logoUrl} alt={`${providerDisplayName} logosu`} className="h-full w-full object-cover" />
          ) : (
            getInitials(providerDisplayName)
          )}
        </span>
        <p className="min-w-0 truncate text-sm font-bold tracking-heading leading-tight text-foreground">{providerDisplayName}</p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Aldığınız hizmetten ne derece memnun kaldınız?
      </p>
      <div className="mt-4">
        <StarRatingInput
          value={selectedStars}
          onChange={(stars) => {
            setSelectedStars(stars);
            setError(null);
          }}
          disabled={submitting}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Daha Sonra
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Gönderiliyor..." : "Değerlendirmeyi Gönder"}
        </button>
      </div>
    </DialogShell>
  );
}
