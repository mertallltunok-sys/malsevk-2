"use client";

import { useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "./prefers-reduced-motion";

/** Bildirim silme animasyonunun süresi (ms) — kart bu sürede sola kayıp opaklığı azalarak kaybolur. */
export const DISMISS_ANIMATION_MS = 250;

/**
 * Bir bildirim satırının "sola kayıp solarak kaybolma, ardından
 * yüksekliğinin/boşluğunun çökmesiyle alttaki kartların yumuşakça yukarı
 * kayması" animasyonunu yönetir. `trigger()` çağrıldığında satırın o anki
 * yüksekliği ölçülüp sabitlenir (CSS geçişi "auto"tan animasyonlanamadığı
 * için), bir sonraki frame'de hedef değerlere (opaklık 0, sola transform,
 * yükseklik/alt-boşluk 0) geçilir; süre sonunda gerçek silme (`onDismiss` —
 * localStorage güncellemesi) tetiklenir. `removingRef`, React state
 * güncellemesi ekrana yansımadan önce aynı satıra ikinci kez basılmasını
 * (hızlı çift dokunuş) senkron biçimde engeller — bu yüzden `removing`
 * state'i değil, ayrı bir ref kullanılır. `prefers-reduced-motion` açıkken
 * animasyon hiç oynatılmaz, silme anında gerçekleşir.
 */
export function useDismissAnimation(onDismiss: () => void) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const removingRef = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [heightPx, setHeightPx] = useState<number | null>(null);

  function trigger() {
    if (removingRef.current) return;
    removingRef.current = true;

    if (prefersReducedMotion()) {
      onDismiss();
      return;
    }

    setHeightPx(rowRef.current?.getBoundingClientRect().height ?? null);
    requestAnimationFrame(() => setRemoving(true));
    window.setTimeout(onDismiss, DISMISS_ANIMATION_MS);
  }

  const style: CSSProperties = {
    overflow: "hidden",
    transition:
      `max-height ${DISMISS_ANIMATION_MS}ms ease-out, ` +
      `opacity ${DISMISS_ANIMATION_MS}ms ease-out, ` +
      `transform ${DISMISS_ANIMATION_MS}ms ease-out, ` +
      `margin-bottom ${DISMISS_ANIMATION_MS}ms ease-out`,
    maxHeight: heightPx !== null ? (removing ? 0 : heightPx) : undefined,
    opacity: removing ? 0 : undefined,
    transform: removing ? "translateX(-100%)" : undefined,
    marginBottom: removing ? 0 : undefined,
    pointerEvents: removing ? "none" : undefined,
  };

  return { rowRef, removing, style, trigger };
}
