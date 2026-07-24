"use client";

import { useState } from "react";
import { AUTO_COMPLETED_RATING_WINDOW_DAYS } from "../_lib/ratings";
import { computeRemainingTime } from "../_lib/time-remaining";
import type { Offer, Session } from "../_lib/types";
import { AUTO_DISMISS_FADE_MS, useAutoDismissBanner } from "../_lib/use-auto-dismiss-banner";
import { useAllRatings } from "../_lib/use-ratings";
import { JobRatingModal } from "./job-rating-modal";
import { StarRatingInput } from "./star-rating-input";

const AUTO_COMPLETED_RATING_WINDOW_MS = AUTO_COMPLETED_RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Yalnızca "Hizmet Taleplerim > Tamamlanan" sekmesinde, tamamlanmış bir iş
 * için render edilir. Değerlendirme formunun kendisi burada DEĞİL —
 * "Hizmeti Değerlendir" butonu, tamamlama onayından hemen sonra açılanla
 * birebir aynı `JobRatingModal`'ı açar (iki farklı modal yok, bkz.
 * job-rating-modal.tsx). Zaten puanlanmışsa salt-okunur "Verdiğiniz puan"
 * özeti gösterilir (bkz. her iş yalnızca 1 kez puanlanabilir kuralı,
 * ratings.ts#submitRating). Otomatik tamamlanan işlerde
 * AUTO_COMPLETED_RATING_WINDOW_DAYS (30 gün) dolmuşsa widget hiç görünmez.
 * `useAllRatings()` reaktif hook'u kullanılır — puan gönderildiğinde
 * `submitRating` -> `notify()` bu bileşeni sayfa yenilenmeden günceller.
 */
export function JobRatingWidget({ offer, session }: { offer: Offer; session: Session }) {
  const [modalOpen, setModalOpen] = useState(false);
  const justRatedBanner = useAutoDismissBanner();

  const ratings = useAllRatings();
  const existingRating = ratings.find((rating) => rating.offerId === offer.id) ?? null;

  function handleModalClose(submitted: boolean) {
    setModalOpen(false);
    if (submitted) justRatedBanner.trigger();
  }

  if (existingRating) {
    return (
      <div className="mt-4 rounded-card border border-border bg-background p-4">
        {justRatedBanner.visible && (
          <p
            role="status"
            aria-live="polite"
            style={{
              transitionDuration: `${AUTO_DISMISS_FADE_MS}ms`,
              opacity: justRatedBanner.fadingOut ? 0 : 1,
            }}
            className="mb-2 text-sm font-medium text-success transition-opacity ease-out motion-reduce:transition-none"
          >
            Değerlendirmeniz için teşekkür ederiz.
          </p>
        )}
        <p className="text-sm font-semibold text-foreground">Verdiğiniz puan</p>
        <div className="mt-2 flex items-center gap-3">
          <StarRatingInput value={existingRating.stars} onChange={() => {}} disabled />
          <span className="text-sm font-medium text-muted-foreground">{existingRating.stars} / 5</span>
        </div>
      </div>
    );
  }

  if (offer.autoCompleted) {
    const windowEndsAtIso = new Date(
      new Date(offer.updatedAt).getTime() + AUTO_COMPLETED_RATING_WINDOW_MS,
    ).toISOString();
    if (computeRemainingTime(windowEndsAtIso).isExpired) return null;
  }

  return (
    <div className="mt-4 rounded-card border border-border bg-background p-4">
      <p className="text-sm font-semibold text-foreground">Bu hizmeti henüz değerlendirmediniz.</p>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        Hizmeti Değerlendir
      </button>

      {modalOpen && <JobRatingModal offer={offer} session={session} onClose={handleModalClose} />}
    </div>
  );
}
