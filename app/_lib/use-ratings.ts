"use client";

import { useSyncExternalStore } from "react";
import { ratingsStore } from "./ratings";
import type { Rating } from "./types";

export function useAllRatings(): Rating[] {
  return useSyncExternalStore(
    ratingsStore.subscribe,
    ratingsStore.getSnapshot,
    ratingsStore.getServerSnapshot,
  );
}
