"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  authorizedServicesStore,
  refreshAuthorizedServiceCategoryIds,
} from "./supabase-provider-service-authorizations";

/**
 * `supabase-provider-service-authorizations.ts`in REAKTİF hâli —
 * use-provider-services.ts#useProviderServiceCategoryIds ile AYNI
 * `useSyncExternalStore` iskeleti, ama GERÇEK bir Supabase fetch'i tetikler
 * (localStorage'ı okumaz, bkz. o modülün kendi "cross-device" dokümantasyonu).
 * Mount olduğunda (ya da `providerId` değiştiğinde) bir kez fetch eder —
 * görev bölüm 32/34'ün kendi ifadesiyle "provider REFRESH sonrası" görür,
 * yani senkronizasyon tetikleyicisi sayfa yenileme/yeniden mount'tur, canlı
 * bir WebSocket/subscription DEĞİLDİR (bu proje kapsamında gereksiz bir
 * karmaşıklık olurdu).
 */
export function useAuthorizedServiceCategoryIds(providerId: string | undefined): string[] {
  const state = useSyncExternalStore(
    authorizedServicesStore.subscribe,
    authorizedServicesStore.getSnapshot,
    authorizedServicesStore.getServerSnapshot,
  );

  useEffect(() => {
    if (!providerId) return;
    void refreshAuthorizedServiceCategoryIds(providerId);
  }, [providerId]);

  if (!providerId || state?.providerId !== providerId) return [];
  return state.serviceCategoryIds;
}
