"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { hasNavigatedInApp } from "../_lib/use-track-in-app-navigation";

/**
 * "Bize Ulaşın" ve yasal metin sayfalarının (Gizlilik Politikası/Kullanım
 * Koşulları/KVKK Aydınlatma Metni) TEK ortak "Kapat" butonu. Bu sayfalar
 * modal/dialog/drawer DEĞİLDİR — gerçek rotalardır (bkz. görev tanımı:
 * önceki pop-up kararı iptal edildi) — bu yüzden "kapatma" bir
 * `onClose()` callback'i değil, GERÇEK bir gezinme kararıdır:
 *  - `hasNavigatedInApp()` `true` ise kullanıcı bu SEKME içinde en az bir
 *    kez uygulama-içi bir sayfaya geçmiş demektir — `router.back()`
 *    GERÇEKTEN geldiği sayfaya döner.
 *  - Değilse (sekme doğrudan bu URL ile açıldı — yeni sekme, e-posta
 *    linki, doğrudan URL yapıştırma vb. — bu sekmede henüz başka bir
 *    uygulama-içi gezinme YOK) ana sayfaya yönlendirir.
 * BİLEREK `window.history.length`e GÜVENİLMEZ — o değer taze bir sekmede
 * (`about:blank` gibi bir "hayalet" girdi yüzünden) `> 1` görünebilir,
 * bu da `router.back()`i boş/kırık bir sayfaya gönderirdi (Playwright'ta
 * doğrulanmış gerçek bir hata) — bkz. use-track-in-app-navigation.ts'in
 * kendi dokümanı, bunun yerine GERÇEK pathname değişikliklerini izler.
 * Tarayıcı sekmesini kapatmaya ASLA çalışmaz (`window.close()` YOK) —
 * yalnızca uygulama içi gezinme. Geri dönüş `router.back()`/`router.push`
 * üzerinden olduğu için form/oturum/sayfa durumuna dokunmaz.
 */
export function ClosePageButton() {
  const router = useRouter();

  function handleClose() {
    if (hasNavigatedInApp()) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClose}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <X className="h-4 w-4" aria-hidden="true" />
      Kapat
    </button>
  );
}
