"use client";

import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "../_lib/prefers-reduced-motion";

/**
 * Hero'daki tam genişlik panoramik video — statik kamyon görselinin yerini
 * alır. Kaynak: `public/videos/malsevk-operasyon-akisi-neon.mp4` (1920x346,
 * 10sn, 30fps, H.264, sessiz — `ffprobe` ile doğrulandı, bkz. görev raporu) —
 * 9 hizmet kategorisini (Nakliye→Geri Dönüşüm) dolaşan "neon" ikon-zaman
 * çizelgesi animasyonu; önceki gece-vardiyası sahnesinin (`malsevk-operasyon-
 * akisi.mp4`) yerini aldı. Poster: `public/images/malsevk-operasyon-akisi-
 * neon-poster.png` — videonun KENDİSİNDEN (t=0, yeniden kodlama YAPILMADAN)
 * çıkarılmış gerçek bir kare, eski gece görseli DEĞİL.
 *
 * `prefers-reduced-motion` ele alışı BİLEREK yeni bir global sistem
 * KURMUYOR — mevcut `prefers-reduced-motion.ts#prefersReducedMotion()`
 * (services-section.tsx'in akordeon animasyonunda zaten kullanılan AYNI
 * fonksiyon) yeniden kullanılıyor. Hydration uyuşmazlığı riskini önlemek
 * için `<video>` her zaman AYNI, tam `autoPlay`/`loop` işaretlemesiyle
 * render edilir (sunucu ve istemcinin İLK render'ı birebir aynı DOM'u
 * üretir) — yalnızca mount SONRASI, boyamadan ÖNCE çalışan bir
 * `useLayoutEffect` (aynı "boya öncesi düzelt" deseni `services-section.tsx#
 * useAccordionPanelHeight`de de kullanılıyor), kullanıcı gerçekten azaltılmış
 * hareket tercih ediyorsa videoyu görünür bir hareket karesi OLUŞMADAN
 * duraklatır (poster kare olduğu gibi kalır).
 */
export function HeroMotionVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      videoRef.current?.pause();
    }
  }, []);

  return (
    // Kasıtlı olarak AYRI bir CSS `aspect-ratio` bildirilmiyor — bir önceki
    // sürüm bunu `border`lı bir sarmalayıcıda yapıyordu ve `border-box`
    // hesaplamasıyla `aspect-ratio` arasındaki alt-piksel etkileşimi 390px
    // genişlikte ölçülebilir bir oran sapmasına yol açtı (gerçek tarayıcıda
    // bulundu — bkz. görev raporu). Bunun yerine `<video>`nun KENDİ native
    // `width`/`height` HTML özniteliği (1920x346) + `h-auto` — tarayıcı oranı
    // doğrudan bu ikisinden türetir, hiçbir ayrı hesaplama/border etkileşimi
    // olmadan; `next/image`nin `fill` yerine intrinsic width/height kullanan
    // aynı ilkesi.
    // `bg-primary` (MALSEVK laciverti) — poster'ın YERİNE değil, ONUNLA
    // BİRLİKTE ek bir güvence: poster görseli her zaman kullanılır, bu yalnız
    // poster kendisi henüz gelmeden önceki milisaniyeler için bir arka plan.
    <div className="w-full overflow-hidden rounded-2xl bg-primary">
      <video
        ref={videoRef}
        width={1920}
        height={346}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/images/malsevk-operasyon-akisi-neon-poster.png"
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback"
        aria-hidden="true"
        tabIndex={-1}
        className="block h-auto w-full"
      >
        <source src="/videos/malsevk-operasyon-akisi-neon.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
