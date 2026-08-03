"use client";

import { useSyncExternalStore } from "react";
import { contactMessagesStore, type StoredContactMessage } from "./contact-messages";

/** use-offers.ts#useAllOffers ile AYNI useSyncExternalStore deseni — admin paneli, bir mesajın durumu değiştiğinde (aynı sekmede) sayfa yenilenmeden günceller. */
export function useAllContactMessages(): StoredContactMessage[] {
  return useSyncExternalStore(
    contactMessagesStore.subscribe,
    contactMessagesStore.getSnapshot,
    contactMessagesStore.getServerSnapshot,
  );
}
