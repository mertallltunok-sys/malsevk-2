"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  authorizedStorageRiskGroupsStore,
  refreshAuthorizedStorageRiskGroupIds,
} from "./supabase-storage-risk-authorizations";

/**
 * `supabase-storage-risk-authorizations.ts#authorizedStorageRiskGroupsStore`in
 * REAKTİF hâli — use-authorized-container-scopes.ts#useAuthorizedContainerScopes
 * İLE AYNI `useSyncExternalStore` iskeleti. `providerId` yoksa (Hizmet
 * Alan/admin/misafir) ya da önbellek henüz doldurulmadıysa `[]` döner.
 */
export function useAuthorizedStorageRiskGroupIds(providerId: string | undefined): string[] {
  const state = useSyncExternalStore(
    authorizedStorageRiskGroupsStore.subscribe,
    authorizedStorageRiskGroupsStore.getSnapshot,
    authorizedStorageRiskGroupsStore.getServerSnapshot,
  );

  useEffect(() => {
    if (!providerId) return;
    void refreshAuthorizedStorageRiskGroupIds(providerId);
  }, [providerId]);

  if (!providerId || state?.providerId !== providerId) return [];
  return state.riskGroupIds;
}
