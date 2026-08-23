"use client";

import { useSyncExternalStore } from "react";
import { sessionProfileDetailsStore, type SessionProfileDetails } from "./session";

/**
 * `use-session.ts#useSession()` ile AYNI `useSyncExternalStore` deseni,
 * yalnızca daha zengin bir anlık görüntü döner (kendi `profiles` satırının
 * TAMAMI + Supabase Auth e-postası) — bkz. session.ts'in kendi
 * dokümantasyonu. Sunucuda her zaman `null` (SSR güvenli); mount sonrası
 * gerçek Supabase verisine geçer.
 */
export function useSessionProfileDetails(): SessionProfileDetails | null {
  return useSyncExternalStore(
    sessionProfileDetailsStore.subscribe,
    sessionProfileDetailsStore.getSnapshot,
    sessionProfileDetailsStore.getServerSnapshot,
  );
}
