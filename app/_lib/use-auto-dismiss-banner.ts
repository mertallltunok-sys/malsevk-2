"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./prefers-reduced-motion";

/** Banner'ın tam opaklıkla görünür kaldığı süre (ms), fade-out başlamadan önce. */
export const AUTO_DISMISS_VISIBLE_MS = 3000;
/** Fade-out geçişinin süresi (ms) — banner bu sürede opaklığı 1'den 0'a iner. */
export const AUTO_DISMISS_FADE_MS = 250;

/**
 * Geçici bir başarı banner'ının ("İlan başarıyla silindi." gibi) "N ms tam
 * görünür kal, sonra yumuşak bir fade-out ile DOM'dan tamamen kalk"
 * davranışını yönetir. `use-dismiss-animation.ts`in (bildirim listesi
 * satırları için manuel/tıklamayla tetiklenen slide+collapse) kasıtlı
 * olarak AYRI bir hook'udur — burada tetikleme SÜRE tabanlıdır (kullanıcı
 * eylemi değil) ve görsel geçiş yalnızca fade'dir (slide/collapse yok),
 * tek bir standalone banner için; iki farklı kullanım biçimini tek hook'a
 * sıkıştırmak yerine ayrı tutulur.
 *
 * `trigger()` HER çağrıldığında (banner zaten görünürken bile — art arda
 * silme senaryosu) önce mevcut timer'lar temizlenir, sonra süre SIFIRDAN
 * başlar; bu yüzden state bir boolean değil, `trigger`'ın kendisi her
 * zaman yeniden çalışır (React "aynı değere setState" bailout'una takılan
 * bir `justDeleted: boolean` deseninin aksine). `prefers-reduced-motion`
 * açıkken fade hiç oynatılmaz, süre sonunda banner anında kaybolur —
 * `use-dismiss-animation.ts` ile aynı kural. Unmount'ta tüm timer'lar
 * temizlenir (memory leak yok).
 */
export function useAutoDismissBanner() {
  const [visible, setVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  function clearTimers() {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  function trigger() {
    clearTimers();
    setFadingOut(false);
    setVisible(true);

    if (prefersReducedMotion()) {
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        hideTimerRef.current = null;
      }, AUTO_DISMISS_VISIBLE_MS);
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setFadingOut(true);
      fadeTimerRef.current = window.setTimeout(() => {
        fadeTimerRef.current = null;
        setVisible(false);
        setFadingOut(false);
      }, AUTO_DISMISS_FADE_MS);
    }, AUTO_DISMISS_VISIBLE_MS);
  }

  useEffect(() => clearTimers, []);

  return { visible, fadingOut, trigger };
}
