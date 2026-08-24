"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * "İletişim Bilgilerinin Görünürlüğü" görevi — `get_offer_contact` RPC'sini
 * (migration 0078) sarmalar. `p_offer_id` YEREL `Offer.id` DEĞİL,
 * `Offer.supabaseOfferId`dir (supabase-offer-sync.ts'teki TÜM fonksiyonlarla
 * AYNI kural). RPC'nin kendi `can_view_offer_contact` yetkilendirmesi
 * (yalnızca meşgul/engaged bir teklifin gerçek tarafı) tek doğruluk
 * kaynağıdır — bu modül onu TEKRARLAMAZ.
 */

export type OfferContactRow = {
  providerName: string;
  providerPhone: string | null;
  providerEmail: string | null;
  requesterName: string;
  requesterPhone: string | null;
  requesterEmail: string | null;
};

export async function fetchOfferContactFromSupabase(supabaseOfferId: string): Promise<OfferContactRow | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("get_offer_contact", { p_offer_id: supabaseOfferId })
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    provider_name: string;
    provider_phone: string | null;
    provider_email: string | null;
    requester_name: string;
    requester_phone: string | null;
    requester_email: string | null;
  };
  return {
    providerName: row.provider_name,
    providerPhone: row.provider_phone,
    providerEmail: row.provider_email,
    requesterName: row.requester_name,
    requesterPhone: row.requester_phone,
    requesterEmail: row.requester_email,
  };
}
