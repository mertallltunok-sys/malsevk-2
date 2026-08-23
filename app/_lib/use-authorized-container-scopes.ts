"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ContainerStorageAuthorization } from "./storage-container-catalog";
import {
  authorizedContainerScopesStore,
  refreshAuthorizedContainerScopes,
} from "./supabase-provider-service-authorizations";

/**
 * `supabase-provider-service-authorizations.ts#authorizedContainerScopesStore`in
 * REAKTİF hâli — use-authorized-services.ts#useAuthorizedServiceCategoryIds
 * İLE AYNI `useSyncExternalStore` iskeleti (ikinci bir mimari İCAT EDİLMEDİ).
 * `providerId` yoksa (Hizmet Alan/admin/misafir) ya da önbellek henüz bu
 * provider için doldurulmadıysa `null` döner — job-visibility.ts#
 * resolveVisibility bunu "hiç konteyner-depolama yetkisi yok" olarak okur.
 */
export function useAuthorizedContainerScopes(providerId: string | undefined): ContainerStorageAuthorization | null {
  const state = useSyncExternalStore(
    authorizedContainerScopesStore.subscribe,
    authorizedContainerScopesStore.getSnapshot,
    authorizedContainerScopesStore.getServerSnapshot,
  );

  useEffect(() => {
    if (!providerId) return;
    void refreshAuthorizedContainerScopes(providerId);
  }, [providerId]);

  if (!providerId || state?.providerId !== providerId) return null;
  return state.authorization;
}
