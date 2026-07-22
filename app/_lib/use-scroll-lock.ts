"use client";

import { useEffect, useRef } from "react";

/**
 * Bir panel/menü açıkken arka sayfanın kaymasını engeller. Yalnızca body'ye
 * `overflow: hidden` vermek iOS Safari'de dokunmatik kaydırmayı tam
 * engellemez (arka plan yine de "rubber-band" kayabilir) — bu yüzden iOS ve
 * Android'de yaygın kullanılan teknik uygulanır: body `position: fixed`
 * yapılır ve mevcut scroll konumu negatif bir `top` ile telafi edilir. Kilit
 * kalkınca önceki inline stiller geri yüklenir ve sayfa ANINDA (CSS
 * `scroll-behavior: smooth` devredışı bırakılarak, animasyonsuz) kaydığı
 * yere döner.
 */
export function useScrollLock(locked: boolean) {
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!locked) return;

    const { body } = document;
    scrollYRef.current = window.scrollY;

    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollYRef.current}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      window.scrollTo({ top: scrollYRef.current, left: 0, behavior: "instant" });
    };
  }, [locked]);
}
