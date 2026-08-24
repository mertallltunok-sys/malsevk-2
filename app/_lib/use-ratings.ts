"use client";

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { hydrateMissingRatingsFromRemote, ratingsStore } from "./ratings";
import { fetchAllRatingsFromSupabase } from "./supabase-rating-reads";
import { requiresBackendOfferSync } from "./supabase-offer-sync";
import type { Rating } from "./types";

export function useAllRatings(): Rating[] {
  const ratings = useSyncExternalStore(
    ratingsStore.subscribe,
    ratingsStore.getSnapshot,
    ratingsStore.getServerSnapshot,
  );

  // "Puanlamanın Sunucuya Kaydı" görevi — cihazlar arası görünürlük:
  // use-offers.ts#useAllOffers'ın AYNI "mount'ta bir kez, canlı abonelik
  // değil" ilkesi.
  useEffect(() => {
    if (!requiresBackendOfferSync()) return;
    let cancelled = false;
    void fetchAllRatingsFromSupabase().then((remoteRatings) => {
      if (cancelled) return;
      hydrateMissingRatingsFromRemote(remoteRatings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ratings;
}
