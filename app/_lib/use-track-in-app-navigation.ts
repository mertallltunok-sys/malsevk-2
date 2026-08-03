"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const STORAGE_KEY = "malsevk_has_navigated_in_app";

/**
 * `close-page-button.tsx#ClosePageButton`'ın "geçmiş var mı" kararını
 * `window.history.length`'e DEĞİL bu hook'un yazdığı bayrağa dayandırması
 * gerekir — `history.length` GÜVENİLMEZ: taze bir sekmede tek bir
 * `page.goto`/URL çubuğuna yazma sonrasında bile `about:blank` gibi
 * "hayalet" bir girdi yüzünden `> 1` görünebilir (Playwright'ta doğrulandı),
 * bu da "geçmiş var" sanıp `router.back()`i boş/kırık bir sayfaya (`about:blank`)
 * gönderir. Bu hook bunun yerine GERÇEK uygulama-içi gezinmeyi izler:
 * `app/layout.tsx`de KÖKTE bir kez mount edilir, `usePathname()` her
 * DEĞİŞTİĞİNDE (İLK render'da DEĞİL — `isFirstRun`, platformdaki
 * `use-focus-on-become-true.ts` ile AYNI desen) sekmeye özel
 * `sessionStorage` bayrağını yazar. Sekme yeni açıldığında/doğrudan bir
 * URL'ye gidildiğinde bayrak hiç YAZILMAZ (pathname hiç "değişmez", yalnızca
 * İLK değeriyle mount olur); kullanıcı en az bir kez uygulama-içi bir
 * bağlantıya tıkladığı AN kalıcı olarak yazılır — `sessionStorage` sekme
 * kapanana kadar kalıcıdır, bu yüzden "önceki sayfadan geldi" bilgisi
 * o sekmedeki sonraki her "Kapat" tıklaması için de doğru kalır.
 */
export function useTrackInAppNavigation() {
  const pathname = usePathname();
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // yok say — en kötü ihtimalle Kapat butonu ana sayfaya yönlendirir.
    }
  }, [pathname]);
}

/** Bkz. useTrackInAppNavigation'ın dokümanı — close-page-button.tsx bu bayrağı okur. */
export function hasNavigatedInApp(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
