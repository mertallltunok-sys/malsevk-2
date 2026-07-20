"use client";

import { useSyncExternalStore } from "react";
import { offersStore } from "./offers";
import type { Offer } from "./types";

export function useAllOffers(): Offer[] {
  return useSyncExternalStore(
    offersStore.subscribe,
    offersStore.getSnapshot,
    offersStore.getServerSnapshot,
  );
}
