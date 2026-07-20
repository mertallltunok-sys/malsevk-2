"use client";

import { useSyncExternalStore } from "react";
import { sessionStore } from "./session";
import type { Session } from "./types";

/**
 * Oturum localStorage'da tutulduğu için sunucuda bilinemez.
 * useSyncExternalStore, sunucu snapshot'ı (null) ile hidrasyonu eşleştirir
 * ve mount sonrası otomatik olarak gerçek değere geçer — manuel state/effect
 * gerekmez.
 */
export function useSession(): Session | null {
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
}
