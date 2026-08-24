"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Rating } from "./types";

/**
 * "Puanlamanın Sunucuya Kaydı" görevi — YAZMA tarafı (submit_rating RPC)
 * artık senkronken, OKUMA tarafında da AYNI boşluk vardı: `ratings.ts`in
 * hiçbir uzak okuma/hidratasyon mekanizması yoktu, bu yüzden yazma sunucuya
 * ulaşsa bile TEMİZ/farklı bir cihaz o puanı asla GÖREMİYORDU.
 * `public.ratings`in kendi RLS politikası (`ratings_select_relevant_or_public_summary`,
 * migration 0013) zaten `authenticated`/`anon`e `deleted_at is null` olan
 * HER satırı açık bırakıyor ("bireysel puanlar gönderildikten sonra
 * KAMUYA AÇIK sayılır") — bu yüzden burada YENİ bir RPC/politika GEREKMEZ,
 * `use-jobs.ts#useRemoteJobsFallback`/`use-offers.ts`in AYNI "mount'ta bir
 * kez çek, depoya yaz" desenini uygulayan düz bir tablo okuması yeterlidir.
 */
export async function fetchAllRatingsFromSupabase(): Promise<Rating[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ratings")
    .select("id, offer_id, job_id, provider_id, rater_id, stars, created_at")
    .is("deleted_at", null);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    offerId: row.offer_id as string,
    jobId: row.job_id as string,
    providerId: row.provider_id as string,
    raterId: row.rater_id as string,
    stars: row.stars as number,
    createdAt: row.created_at as string,
  }));
}
