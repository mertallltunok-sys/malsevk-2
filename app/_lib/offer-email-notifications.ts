"use client";

/**
 * `offers.ts#createOffer`/`updateOfferStatus` tarafından, GERÇEK Supabase
 * teklif oluşturma/kabul RPC'si ZATEN başarıyla tamamlandıktan SONRA çağrılır
 * — `/api/offer-notifications` route'unun (app/api/offer-notifications/
 * route.ts) TEK istemci tetikleyicisidir. Bilerek `await` EDİLİR (Playwright
 * ile bu oturumun kendi HEIC testinde doğrudan gözlemlenen `ERR_ABORTED`
 * davranışı — sayfa navigasyonu, tamamlanmamış arka plan isteklerini iptal
 * edebiliyor; teklif/kabul sonrası genellikle hemen bir yönlendirme olur, bu
 * yüzden gerçekten "fire and forget" bırakmak isteği sessizce hiç
 * tamamlanmadan iptal edebilirdi) ama sonucu ÇAĞIRANA ASLA yansıtılmaz —
 * bu fonksiyon hiçbir zaman reject/throw ETMEZ, e-posta başarısız olsa da
 * teklif/kabul işleminin kendisi başarılı sayılmaya devam eder (görev
 * talimatı: "E-posta gönderimi başarısız olursa ana teklif işlemi başarılı
 * kalmalı"). Sunucu tarafı zaten idempotent (migration 0085) olduğu için bu
 * çağrı hiçbir zaman "en fazla bir kez" garantisi taşımak ZORUNDA değildir —
 * ağ hatası/timeout durumunda basitçe hiç denenmemiş gibi bırakılır, sonraki
 * bir teklif/kabul eylemi asla ikinci bir gönderim TETİKLEMEZ (her olay kendi
 * offer_id+event_type'ına kilitlidir).
 */

const NOTIFY_TIMEOUT_MS = 10_000;

async function notify(offerId: string, event: "new_offer" | "offer_accepted"): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    await fetch("/api/offer-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId, event }),
      signal: controller.signal,
    });
  } catch (error) {
    // Bilerek yutulur — bkz. dosya başlığı. Yalnızca teşhis amaçlı loglanır,
    // hiçbir hassas veri (e-posta adresi, API anahtarı) burada YOKTUR.
    console.error("[offer-email-notifications] bildirim isteği başarısız", { event, error: String(error) });
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyNewOfferByEmail(supabaseOfferId: string): Promise<void> {
  await notify(supabaseOfferId, "new_offer");
}

export async function notifyOfferAcceptedByEmail(supabaseOfferId: string): Promise<void> {
  await notify(supabaseOfferId, "offer_accepted");
}
