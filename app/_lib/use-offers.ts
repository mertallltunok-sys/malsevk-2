"use client";

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { applyExpiredCompletionAutoApprovals, offersStore } from "./offers";
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

  return offers;
}
