"use client";

import { useEffect, useSyncExternalStore } from "react";
import { authorizedRecyclingScopesStore, refreshAuthorizedRecyclingScopes } from "./supabase-recycling-authorizations";

/**
 * `supabase-recycling-authorizations.ts#authorizedRecyclingScopesStore`in
 * REAKTİF hâli — `use-storage-risk-authorizations.ts#useAuthorizedStorageRiskGroupIds`
 * İLE AYNI `useSyncExternalStore` iskeleti. `providerId` yoksa (Hizmet
 * Alan/admin/misafir) ya da önbellek henüz doldurulmadıysa ikisi de `[]` döner.
 */
export function useAuthorizedRecyclingScopes(providerId: string | undefined): { activityIds: string[]; wasteCodes: string[] } {
  const state = useSyncExternalStore(
    authorizedRecyclingScopesStore.subscribe,
    authorizedRecyclingScopesStore.getSnapshot,
    authorizedRecyclingScopesStore.getServerSnapshot,
  );

  useEffect(() => {
    if (!providerId) return;
    void refreshAuthorizedRecyclingScopes(providerId);
  }, [providerId]);

  if (!providerId || state?.providerId !== providerId) return { activityIds: [], wasteCodes: [] };
  return { activityIds: state.activityIds, wasteCodes: state.wasteCodes };
}
