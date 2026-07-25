"use client";

import { useCallback, useSyncExternalStore } from "react";

function getServerSnapshot(): boolean {
  return false;
}

/**
 * `window.matchMedia` tabanlı, canlı güncellenen medya sorgusu okuma —
 * useSyncExternalStore ile (useEffect+setState DEĞİL, bu projenin genel
 * deseniyle tutarlı). Yalnızca oturuma bağlı, dolayısıyla sunucuda hiç
 * render edilmeyen ağaçlarda (bkz. use-session.ts'in SSR-güvenli null
 * dönüşü — provider-job-listing.tsx yalnızca oturum çözüldükten SONRA
 * mount edilir) güvenle kullanılabilir; bu koşulda hydration uyuşmazlığı
 * riski yoktur. `getServerSnapshot`in `false` dönmesi yalnızca tip
 * güvenliği içindir, hiçbir zaman gerçekten kullanılmaz.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onStoreChange);
      return () => mediaQueryList.removeEventListener("change", onStoreChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
