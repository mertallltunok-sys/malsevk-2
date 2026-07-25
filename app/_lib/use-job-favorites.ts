"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getFavoriteJobIds, subscribeToFavoriteJobs } from "./job-favorites";

const EMPTY_IDS: string[] = [];

function getServerFavoriteIdsSnapshot(): string[] {
  return EMPTY_IDS;
}

/**
 * Favori ilan id listesi kullanıcıya özeldir, bu yüzden getSnapshot `userId`ye
 * göre kapanır (closure) — use-notification-reads.ts ile aynı desen. Alttaki
 * `getFavoriteJobIds` kendi önbelleğini tuttuğu için ham metin değişmediği
 * sürece aynı dizi referansını döndürür.
 */
export function useFavoriteJobIds(userId: string): string[] {
  const getSnapshot = useCallback(() => getFavoriteJobIds(userId), [userId]);
  return useSyncExternalStore(subscribeToFavoriteJobs, getSnapshot, getServerFavoriteIdsSnapshot);
}
