"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getReadNotificationIds, subscribeToNotificationReads } from "./notification-reads";

const EMPTY_IDS: string[] = [];

function getServerReadIdsSnapshot(): string[] {
  return EMPTY_IDS;
}

/**
 * Okunan bildirim id listesi kullanıcıya özeldir, bu yüzden getSnapshot
 * `userId`'ye göre kapanır (closure). Alttaki `getReadNotificationIds`
 * kendi önbelleğini tuttuğu için (bkz. notification-reads.ts) ham metin
 * değişmediği sürece aynı dizi referansını döndürür — useSyncExternalStore
 * için gereken kararlılık böylece korunur.
 */
export function useReadNotificationIds(userId: string): string[] {
  const getSnapshot = useCallback(() => getReadNotificationIds(userId), [userId]);
  return useSyncExternalStore(subscribeToNotificationReads, getSnapshot, getServerReadIdsSnapshot);
}
