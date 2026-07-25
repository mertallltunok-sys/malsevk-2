"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getRecentlyViewedJobIds, subscribeToRecentlyViewedJobs } from "./recently-viewed-jobs";

const EMPTY_IDS: string[] = [];

function getServerRecentlyViewedIdsSnapshot(): string[] {
  return EMPTY_IDS;
}

/** use-job-favorites.ts ile aynı desen: getSnapshot `userId`ye göre kapanır. */
export function useRecentlyViewedJobIds(userId: string): string[] {
  const getSnapshot = useCallback(() => getRecentlyViewedJobIds(userId), [userId]);
  return useSyncExternalStore(
    subscribeToRecentlyViewedJobs,
    getSnapshot,
    getServerRecentlyViewedIdsSnapshot,
  );
}
