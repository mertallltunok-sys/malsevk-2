"use client";

import { useSyncExternalStore } from "react";
import { sessionLoadingStore, sessionStore } from "./session";
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

/**
 * "Yavaş Ağda Yanlış CTA" düzeltme görevi — `useSession() === null` hem
 * "ziyaretçi" hem "oturum henüz çözülmedi" anlamına geldiği için, rol bazlı
 * bir CTA alanının bu ikisini ayırt etmesi gerektiğinde bu YENİ, tamamen
 * isteğe bağlı hook kullanılır (bkz. `session.ts#hasResolvedOnce`'ın kendi
 * dokümanı). Sayfa yüklemesinde İLK gerçek Supabase kontrolü tamamlanana
 * kadar `true`, ardından KALICI olarak `false` — `useSession()`in kendisi
 * DEĞİŞMEDİ, bu yalnızca EKLENEN bir kanaldır.
 */
export function useIsSessionLoading(): boolean {
  return useSyncExternalStore(
    sessionLoadingStore.subscribe,
    sessionLoadingStore.getSnapshot,
    sessionLoadingStore.getServerSnapshot,
  );
}
