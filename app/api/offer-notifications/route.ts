import { NextResponse } from "next/server";
import { Resend } from "resend";
import { buildNewOfferEmail, buildOfferAcceptedEmail } from "../../_lib/offer-email-templates";
import { createSupabaseServerClient } from "../../_lib/supabase/server-client";

// Resend'in Node SDK'sını kullanır; Edge runtime yerine Node gerektirir
// (job-photos/process ile AYNI gerekçe düzeni: burada sharp değil, Resend
// SDK'sının kendi bağımlılıkları için).
export const runtime = "nodejs";

const DEFAULT_EMAIL_FROM = "MALSEVK <noreply@malsevk.com>";
const DEFAULT_APP_BASE_URL = "http://localhost:3000";

type NotifyBody = { offerId?: unknown; event?: unknown };

/**
 * "Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-postalarının TEK sunucu
 * uç noktası — `app/_lib/offer-email-notifications.ts` (istemci) tarafından,
 * ilgili Supabase RPC'si (create_offer/accept_offer) ZATEN başarıyla
 * tamamlandıktan SONRA çağrılır. İstemci yalnızca `{offerId, event}` gönderir
 * — alıcı e-postası, isim, ilan başlığı, tutar HİÇBİRİ istemciden alınmaz;
 * hepsi `claim_offer_email_notification` RPC'si (migration 0085) tarafından
 * ÇAĞIRANIN GERÇEK Supabase oturumundan ve public.offers/jobs/profiles'ın
 * GERÇEK durumundan sunucu tarafında doğrulanır/bulunur. Bu RPC aynı zamanda
 * (offer_id, event_type) benzersizliğiyle atomik idempotency claim'i yapar —
 * `claimed: false` dönerse (zaten gönderilmiş/eşzamanlı gönderiliyor) burada
 * HİÇBİR e-posta gönderilmez, bu tekrarlı çağrıların güvenle (mükerrer
 * gönderim olmadan) retry edilebilmesinin veritabanı seviyesindeki garantisi.
 *
 * Bu route BAŞARISIZ olsa da (Resend hatası, eksik env var, ...) çağıran
 * teklif/kabul işlemi ZATEN tamamlanmıştır — bu route'un tek sorumluluğu
 * bildirim e-postasıdır, asla ana işlemi geri almaz/bloke etmez (bkz.
 * app/_lib/offer-email-notifications.ts'in kendi dokümanı).
 */
export async function POST(request: Request) {
  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const offerId = typeof body.offerId === "string" ? body.offerId : null;
  const event = body.event === "new_offer" || body.event === "offer_accepted" ? body.event : null;
  if (!offerId || !event) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const { data: claimRows, error: claimError } = await supabase.rpc("claim_offer_email_notification", {
    p_offer_id: offerId,
    p_event: event,
  });
  if (claimError) {
    // ML182-185: çağıran bu olayın gerçek tarafı değil ya da teklifin gerçek
    // durumu bu olayla tutarsız — istemciden gelen olay iddiasına asla
    // güvenilmediğinin kanıtı. ML181: teklif/ilan bulunamadı.
    console.error("[offer-notifications] claim RPC hatası", { event, code: claimError.code ?? null });
    return NextResponse.json({ ok: false, reason: "claim_failed" }, { status: 403 });
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim || !claim.claimed) {
    // Zaten gönderilmiş ya da eşzamanlı başka bir istek gönderiyor — mükerrer
    // gönderim YOK, çağırana başarı döner (yeniden denemek güvenlidir).
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const appBaseUrl = (process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/+$/, "");
  const emailContext = {
    recipientDisplayName: claim.recipient_display_name,
    jobTitle: claim.job_title,
    jobId: claim.job_id,
    offerAmount: Number(claim.offer_amount),
    offerCurrency: claim.offer_currency,
    offerCommercialDirection: claim.offer_commercial_direction,
    appBaseUrl,
  };

  // "Kabul-öncesi kimlik anonimleştirme" (job-requests.ts#isOfferProviderIdentityRevealed)
  // ile TUTARLI: "yeni teklif" e-postasında teklif verenin adı/firması
  // BİLEREK kullanılmaz — RPC bunu döner ama yalnızca "offer_accepted"
  // dalında okunur.
  const built =
    event === "new_offer"
      ? buildNewOfferEmail(emailContext)
      : buildOfferAcceptedEmail({ ...emailContext, actorDisplayName: claim.actor_display_name });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    await supabase.rpc("mark_offer_email_delivery", {
      p_delivery_id: claim.delivery_id,
      p_status: "failed",
      p_error_message: "RESEND_API_KEY tanımlı değil",
    });
    console.error("[offer-notifications] RESEND_API_KEY tanımlı değil, e-posta gönderilemedi", {
      deliveryId: claim.delivery_id,
      event,
    });
    return NextResponse.json({ ok: false, reason: "resend_not_configured" }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;

  try {
    const send = await resend.emails.send({
      from,
      to: claim.recipient_email,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    if (send.error) {
      throw new Error(send.error.message);
    }
    await supabase.rpc("mark_offer_email_delivery", {
      p_delivery_id: claim.delivery_id,
      p_status: "sent",
      p_resend_message_id: send.data?.id ?? null,
    });
    return NextResponse.json({ ok: true, sent: true });
  } catch (error) {
    // Hata mesajının TAM metni yalnızca (kilitli, client'a hiç açılmayan)
    // email_deliveries.error_message'a yazılır — konsola asla alıcı e-postası/
    // API anahtarı sızdırabilecek ham metin basılmaz, yalnızca genel bir işaret.
    const message = error instanceof Error ? error.message : "unknown error";
    await supabase.rpc("mark_offer_email_delivery", {
      p_delivery_id: claim.delivery_id,
      p_status: "failed",
      p_error_message: message,
    });
    console.error("[offer-notifications] Resend gönderimi başarısız", { deliveryId: claim.delivery_id, event });
    return NextResponse.json({ ok: false, reason: "send_failed" }, { status: 502 });
  }
}
