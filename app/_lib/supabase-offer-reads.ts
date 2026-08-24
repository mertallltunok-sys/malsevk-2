"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Currency, DisagreementReason, Offer, OfferStatus } from "./types";

/**
 * GENEL GÜVENLİK/VERİ DOĞRULAMA görevi §14 — kanıtlanmış kök neden: `offers.ts`
 * (create/accept/reject/withdraw/agreement-failure) `supabase-offer-sync.ts`
 * üzerinden ZATEN gerçek, bloklayan bir Supabase yazımı yapıyordu — ama HİÇBİR
 * yerde bunun tersi (Supabase'ten OKUMA) yoktu. Sonuç: bir teklif `public.
 * offers`a doğru şekilde yazılıyordu, ama SADECE onu YAZAN tarayıcının kendi
 * localStorage'ında görünüyordu — karşı taraf (farklı cihaz/tarayıcı) o
 * teklifi asla göremiyordu ve üzerinde asla işlem yapamıyordu (`updateOfferStatus`/
 * `withdrawOffer` yalnızca YEREL diziden `offerId` arar). Bu dosya o eksik
 * okuma tarafını kapatır — YENİ bir tablo/RPC YOK, yalnızca RLS'in zaten
 * izin verdiği (`offers_select_parties_or_admin`, 0013) satırları okur.
 *
 * `use-offers.ts#useAllOffers` bu fonksiyonu mount'ta bir kez çağırıp
 * `reconcileOffersFromRemote()` (offers.ts) ile eksik olanları YEREL depoya
 * YAZAR — böylece bir SONRAKİ `updateOfferStatus`/`withdrawOffer` çağrısı
 * onu sıradan bir yerel teklif gibi bulur, mutasyon fonksiyonlarının kendisi
 * HİÇ değiştirilmeden. TEKLİF DURUMLARINI SUPABASE İLE UZLAŞTIRMA GÖREVİ:
 * `reconcileOffersFromRemote` artık var olan bir yerel kaydın üzerine de
 * yazabilir — ama YALNIZCA sunucu satırının `updated_at`i yerelinkinden
 * gerçekten daha yeniyse (bkz. o fonksiyonun kendi dokümanı); bu tarayıcının
 * kendi, henüz sunucuya ulaşmamış bir değişikliği asla geri alınmaz.
 */

type OfferRow = {
  id: string;
  job_id: string;
  provider_id: string;
  amount: number;
  currency: string;
  description: string;
  estimated_duration: number | null;
  commercial_direction: string | null;
  status: string;
  disagreement_reason: string | null;
  disagreement_note: string | null;
  completion_dispute_note: string | null;
  completion_requested_by: string | null;
  completion_requested_at: string | null;
  auto_completed: boolean;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS =
  "id, job_id, provider_id, amount, currency, description, estimated_duration, commercial_direction, status, disagreement_reason, disagreement_note, completion_dispute_note, completion_requested_by, completion_requested_at, auto_completed, created_at, updated_at";

function mapRow(row: OfferRow): Offer {
  return {
    // Bu tarayıcının HİÇ görmediği bir teklif için yerel id, sunucu id'siyle
    // AYNI seçilir (iki ayrı UUID uzayını eşlemeye gerek kalmaz) — bu satır
    // zaten hiçbir yerel kayıtla eşleşmiyorsa (bkz. reconcileOffersFromRemote)
    // bu güvenlidir; eşleşiyorsa bu `id` hiç kullanılmaz (yerel `id` korunur).
    id: row.id,
    jobId: row.job_id,
    providerId: row.provider_id,
    amount: row.amount,
    currency: row.currency as Currency,
    description: row.description,
    estimatedDuration: row.estimated_duration ?? undefined,
    commercialDirection: (row.commercial_direction as Offer["commercialDirection"]) ?? undefined,
    status: row.status as OfferStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disagreementReason: (row.disagreement_reason as DisagreementReason) ?? undefined,
    disagreementNote: row.disagreement_note ?? undefined,
    completionDisputeNote: row.completion_dispute_note ?? undefined,
    completionRequestedByUserId: row.completion_requested_by ?? undefined,
    completionRequestedAt: row.completion_requested_at ?? undefined,
    autoCompleted: row.auto_completed || undefined,
    supabaseOfferId: row.id,
  };
}

/**
 * Çağıranın (RLS aracılığıyla) görebildiği HER teklifi döner — kendi verdiği
 * teklifler (provider_id = auth.uid()) VEYA kendi ilanlarına gelen teklifler
 * (jobs.requester_id = auth.uid(), RLS içinde join). Hata durumunda sessizce
 * boş dizi döner (mevcut yerel akış hiç bozulmasın diye) — bu, "teklif
 * oluşturulamadı" gibi bloklayan bir hata DEĞİL, yalnızca ek bir cihazlar-
 * arası görünürlük katmanıdır.
 */
export async function fetchVisibleOffersFromSupabase(): Promise<Offer[]> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase.from("offers").select(SELECT_COLUMNS).is("deleted_at", null);
    if (error || !data) return [];
    return (data as OfferRow[]).map(mapRow);
  } catch {
    return [];
  }
}
