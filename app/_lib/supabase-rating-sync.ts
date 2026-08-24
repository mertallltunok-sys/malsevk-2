"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * "Puanlamanın Sunucuya Kaydı" görevi — `ratings.ts#submitRating`in kendi
 * `submit_rating(p_offer_id uuid, p_stars integer, p_comment text default null)`
 * RPC'sini (migration 0015/0022, `public.ratings` döner) sarmalar.
 * `supabase-offer-sync.ts`in AYNI ilkesi: `ratings.ts`, YEREL yazımdan ÖNCE
 * bunu çağırır ve sonucu (başarı/hata) yerel yazımı BLOKE ETMEK için kullanır
 * — best-effort/sessiz bir yol YOKTUR. RPC kendi yetki (`hizmet-alan` +
 * ilanın sahibi), durum ("completed" olmalı), mükerrer-puan ve otomatik-
 * tamamlanma penceresi kontrollerini KENDİSİ yapar — bu modül onları
 * TEKRARLAMAZ, yalnızca çağırır ve hatayı Türkçeleştirir.
 *
 * İDEMPOTENT/TEKRAR-DENEME GÜVENLİĞİ: `supabase-offer-sync.ts`in AYNI deseni
 * — "istek sunucuda BAŞARILI oldu ama yanıt tarayıcıya hiç ulaşmadı"
 * senaryosunu RPC'nin kendi "zaten puanlanmış" hata kodunu (MLK74) yakalayıp
 * gerçek durumu tekrar okuyarak ayırt eder; bu durumda ikinci bir puan kaydı
 * asla İNŞA EDİLMEZ.
 *
 * `p_offer_id` parametresi YEREL `Offer.id` DEĞİL, `Offer.supabaseOfferId`dir
 * (RLS `ratings_*` politikaları `public.offers`in gerçek sunucu kimliğine
 * göre çalışır) — supabase-offer-sync.ts'teki TÜM fonksiyonlarla AYNI kural.
 */

export type RatingSyncResult = { ok: true } | { ok: false; error: string };

const ALREADY_RATED_CODE = "MLK74";

function isErrorCode(error: { message?: string; code?: string } | null, code: string): boolean {
  if (!error) return false;
  return error.code === code || Boolean(error.message?.includes(code));
}

function friendlyError(error: { message?: string } | null): string {
  const raw = error?.message ?? "";
  if (raw.includes("MLK50")) return "Yalnızca Hizmet Alan hesapları puan verebilir.";
  if (raw.includes("MLK56")) return "Bu iş üzerinde işlem yapma yetkiniz yok.";
  if (raw.includes("MLK72")) return "Bu iş otomatik tamamlandığı için değerlendirme süresi dolmuştur.";
  if (raw.includes("MLK73")) return "Yalnızca tamamlanmış işler puanlanabilir.";
  if (raw.includes("MLK74")) return "Bu iş için zaten bir değerlendirme yaptınız.";
  if (raw.includes("ML125") || raw.includes("ML126")) return "Oturumunuz doğrulanamadı, lütfen tekrar giriş yapın.";
  if (raw.includes("ML127")) return "Hesabınız askıya alınmış.";
  return "Sunucu ile senkronizasyon başarısız oldu. Lütfen tekrar deneyin.";
}

/** `submitRating` içinde, YEREL yazımdan ÖNCE çağrılır. */
export async function submitRatingOnSupabase(supabaseOfferId: string, stars: number): Promise<RatingSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("submit_rating", {
    p_offer_id: supabaseOfferId,
    p_stars: stars,
    p_comment: null,
  });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_RATED_CODE)) {
    const { data: existing } = await supabase
      .from("ratings")
      .select("id")
      .eq("offer_id", supabaseOfferId)
      .maybeSingle();
    if (existing) return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}
