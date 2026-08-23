"use client";

import { useSyncExternalStore } from "react";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function subscribe(): () => void {
  // Hostname never changes mid-session — no event to subscribe to.
  return () => {};
}

function getSnapshot(): boolean {
  return LOCAL_HOSTNAMES.has(window.location.hostname);
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Development giriş ekranının "Demo Hesaplar" paneli için ikinci doğrulama
 * katmanı — `use-media-query.ts`in AYNI `useSyncExternalStore` deseni
 * (`useEffect`+`setState` DEĞİL, bu projenin genel kuralı). Görev
 * gereksinimi `NODE_ENV` kontrolünü TEK BAŞINA yeterli saymıyor (bir
 * geliştirici `next dev`i herkese açık bir adreste çalıştırabilir) — bu hook
 * yalnızca gerçek tarayıcı `window.location.hostname`i `localhost`/
 * `127.0.0.1` olduğunda `true` döner. Sunucu anlık görüntüsü her zaman
 * `false` (panel SSR'da hiç render edilmez) — hydration uyuşmazlığı riski
 * yok, çünkü giriş ekranı bu değere göre farklı ilk-render markup'ı
 * üretmez (panel yalnızca `false` → `true` geçişinde İLK KEZ görünür,
 * `use-focus-on-become-true.ts`in aynı false→true idiomuyla tutarlı).
 */
export function useIsLocalDevHost(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
