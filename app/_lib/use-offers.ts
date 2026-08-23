"use client";

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { applyExpiredCompletionAutoApprovals, hydrateMissingOffersFromRemote, offersStore } from "./offers";
import { fetchVisibleOffersFromSupabase } from "./supabase-offer-reads";
import { isSupabaseJobSyncEnabled } from "./supabase-job-sync";
import type { Offer } from "./types";

export function useAllOffers(): Offer[] {
  const offers = useSyncExternalStore(
    offersStore.subscribe,
    offersStore.getSnapshot,
    offersStore.getServerSnapshot,
  );

  // "completion_requested" durumunda 7 gün dolan teklifleri gecikmeli
  // (lazy) olarak otomatik "completed" yapar (bkz. offers.ts). Herhangi bir
  // React state güncellemesi yapmaz — yalnızca localStorage'ı güncelleyip
  // notify() çağırır, bu da bu hook'un kendisini (useSyncExternalStore
  // aracılığıyla) güncel veriyle yeniden render eder.
  useEffect(() => {
    applyExpiredCompletionAutoApprovals();
  }, []);

  // GENEL GÜVENLİK/VERİ DOĞRULAMA görevi §14 — cihazlar arası görünürlük:
  // bu tarayıcının localStorage'ında hiç bulunmayan (başka bir cihaz/hesapta
  // oluşturulmuş) ama RLS'in bu oturuma GÖSTERMESİNE izin verdiği teklifleri
  // bir kez (mount'ta) çeker ve depoya yazar — job-store.ts'in
  // `useRemoteJobsFallback`ıyla AYNI "mount'ta bir kez, canlı abonelik değil"
  // ilkesi. `writeAllOffers` zaten `notify()` çağırdığı için bu, yukarıdaki
  // `useSyncExternalStore`ı otomatik olarak yeniden render eder.
  useEffect(() => {
    if (!isSupabaseJobSyncEnabled()) return;
    let cancelled = false;
    void fetchVisibleOffersFromSupabase().then((remoteOffers) => {
      if (cancelled) return;
      hydrateMissingOffersFromRemote(remoteOffers);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return offers;
}
