"use client";

import { useEffect, useRef, useState } from "react";
import { ENGAGED_OFFER_STATUSES } from "./job-requests";
import { findJobByIdWithRemoteFallback } from "./jobs-lookup";
import { fetchOfferContactFromSupabase } from "./supabase-contact-reveal";
import { requiresBackendOfferSync } from "./supabase-offer-sync";
import type { Job, Offer, Session } from "./types";
import { findUserById, upsertSupabaseUserMirror } from "./users";

/**
 * "İletişim Bilgilerinin Görünürlüğü" görevi — contact-access.ts#
 * getRevealedContactForOffer'ı KASITLI OLARAK DEĞİŞTİRMEZ (senkron kalır,
 * her iki çağıranı — incoming-offer-card.tsx/my-offers-panel.tsx — bozmadan,
 * bkz. görev tanımının "senkron çalışan bir fonksiyonu kontrolsüz şekilde
 * async yaparak ekranları bozma" uyarısı). Bunun yerine, PANEL seviyesinde
 * (incoming-offers-panel.tsx/my-offers-panel.tsx, kart seviyesinde DEĞİL —
 * my-offers-panel.tsx'in kendi teklif listesi bir `.map()` içinde, hook
 * kuralları gereği orada çağrılamaz) BİR KEZ çağrılır: bu tarayıcının
 * `StoredUser` aynasında (users.ts) eksik olan karşı taraf profillerini
 * (`get_offer_contact` RPC'si, migration 0078) arka planda hidratlar —
 * böylece `getRevealedContactForOffer`in KENDİ değişmemiş `findUserById`
 * çağrısı bir SONRAKİ render'da veriyi yerelde bulur.
 *
 * Yalnızca "meşgul" (ENGAGED_OFFER_STATUSES) teklifler için dener — RPC'nin
 * kendi `can_view_offer_contact` yetkilendirmesi zaten tek doğruluk kaynağı,
 * bu hook onu tekrarlamaz; yetkisiz bir deneme sunucuda sessizce boş satır
 * döner (zararsız).
 */
export function useHydrateOfferContacts(offers: readonly Offer[], jobs: readonly Job[], session: Session | null): void {
  const attemptedRef = useRef<Set<string>>(new Set());
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!session || !requiresBackendOfferSync()) return;
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    const candidates = offers.filter((offer) => {
      if (!ENGAGED_OFFER_STATUSES.includes(offer.status)) return false;
      if (!offer.supabaseOfferId) return false;
      if (attemptedRef.current.has(offer.id)) return false;
      const counterpartyId =
        session.id === offer.providerId ? jobById.get(offer.jobId)?.requesterId : offer.providerId;
      if (!counterpartyId) return false;
      return !findUserById(counterpartyId);
    });
    if (candidates.length === 0) return;

    let cancelled = false;
    (async () => {
      let hydratedAny = false;
      for (const offer of candidates) {
        // DÜZELTME: `attemptedRef` işareti eskiden İŞ BAŞLAMADAN ÖNCE
        // (senkron, döngünün en başında) konuyordu — `useAllJobs()`/
        // `useAllOffers()` her render'da YENİ bir dizi referansı ürettiği
        // için (memoize edilmemiş), bu effect'in KENDİSİ çok sık yeniden
        // çalışıyor ve her yeniden çalışma bir öncekini `cancelled = true`
        // ile İPTAL EDİYORDU — henüz RPC/yazma hiç TAMAMLANMADAN. İşaret
        // erken konduğu için iptal edilen bir deneme bile "denenmiş"
        // sayılıyor, bu teklif bir daha ASLA yeniden denenmiyordu (gerçek
        // hidratasyon hiç tamamlanmamış olsa bile). Artık işaret yalnızca
        // GERÇEKTEN tamamlanmış (iptal edilmemiş) bir denemeden SONRA
        // konuyor — iptal edilen bir deneme candidates listesinde kalmaya
        // devam eder, bir SONRAKİ (daha kararlı) render'da yeniden dener.
        // `jobs` (useAllJobs()) genelde zaten çözülmüş olur — yalnızca
        // eksikse (nadir yarış durumu) uzak geri dönüşe düşülür.
        const job = jobById.get(offer.jobId) ?? (await findJobByIdWithRemoteFallback(offer.jobId));
        if (cancelled) break;
        if (!job) {
          attemptedRef.current.add(offer.id);
          continue;
        }
        const contact = await fetchOfferContactFromSupabase(offer.supabaseOfferId!);
        if (cancelled) break;
        attemptedRef.current.add(offer.id);
        if (!contact) continue;

        if (offer.providerId !== session.id && contact.providerEmail) {
          upsertSupabaseUserMirror({
            id: offer.providerId,
            name: contact.providerName,
            email: contact.providerEmail,
            phone: contact.providerPhone ?? "",
            role: "hizmet-veren",
          });
          hydratedAny = true;
        }
        if (job.requesterId && job.requesterId !== session.id && contact.requesterEmail) {
          upsertSupabaseUserMirror({
            id: job.requesterId,
            name: contact.requesterName,
            email: contact.requesterEmail,
            phone: contact.requesterPhone ?? "",
            role: "hizmet-alan",
          });
          hydratedAny = true;
        }
      }
      // `upsertSupabaseUserMirror`ın kendi `usersStore`'u bu ekranların
      // İKİSİ tarafından da reaktif olarak abone OLUNMADIĞI için (bkz. görev
      // dokümanı — findUserById hâlâ düz/non-reaktif bir okuma), bu hook
      // KENDİ yeniden render'ını tetikler — panel yeniden render olunca
      // altındaki kartlar da (aynı render ağacı) yeni yerel veriyle render
      // olur.
      if (!cancelled && hydratedAny) forceRerender((n) => n + 1);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `offers`/`jobs` referansı her render'da değişebilir; `attemptedRef` zaten aynı teklifi tekrar denemeyi engeller.
  }, [offers, jobs, session?.id]);
}
