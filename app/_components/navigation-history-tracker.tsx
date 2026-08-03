"use client";

import { useTrackInAppNavigation } from "../_lib/use-track-in-app-navigation";

/**
 * Görsel çıktısı YOKTUR (`null` render eder) — `whatsapp-support-button.tsx`
 * ile AYNI "kökte bir kez mount edilen, tek amaçlı" desen. Tek işi
 * `use-track-in-app-navigation.ts#useTrackInAppNavigation`i çağırmak:
 * `close-page-button.tsx`'in (Bize Ulaşın/yasal metin sayfaları) "geçmiş
 * var mı" kararı için gereken sekme-bazlı gezinme bayrağını yazar. Ayrı bir
 * bileşen olarak tutulur (ör. `site-header.tsx`e gömülmez) çünkü bu, o
 * bileşenin kendi sorumluluğuyla ilgisizdir — bkz. o hook'un dokümanı.
 */
export function NavigationHistoryTracker() {
  useTrackInAppNavigation();
  return null;
}
