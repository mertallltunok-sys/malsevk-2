"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi —
 * `supabase-provider-service-authorizations.ts#authorizedContainerScopesStore`
 * İLE AYNI "düz senkron önbellek + reaktif fetch" deseni, provider_storage_
 * risk_authorizations (migration 0068) tablosuna karşı. İKİNCİ bir mimari
 * İCAT EDİLMEDİ — yalnızca risk-grubu id listesi düz bir string dizisi
 * olduğu için ContainerStorageAuthorization gibi bir scopes/imoClasses
 * nesnesi yerine `authorized-service-category-ids` store'uyla AYNI şekle
 * (`string[]`) sahip.
 *
 * FAIL-CLOSED (storage_activity_scopes/imo_class_codes'un "null=SINIRSIZ"
 * varsayılanından KASITLI OLARAK FARKLI, bkz. migration 0068'in kendi
 * başlık dokümanı): önbellek boşsa ya da provider hiç risk-grubu yetkisi
 * taşımıyorsa `[]` döner — job-visibility.ts#resolveVisibility bunu "hiçbir
 * risk grubunda yetkili değil" olarak okur, asla "sınırsız" değil.
 */

type RiskGroupsState = { providerId: string; riskGroupIds: string[] } | null;

let cache: RiskGroupsState = null;
let inFlightProviderId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export const authorizedStorageRiskGroupsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): RiskGroupsState {
    return cache;
  },
  getServerSnapshot(): RiskGroupsState {
    return null;
  },
};

/** Senkron/anlık okuma — `getAuthorizedServiceCategoryIdsSync` İLE AYNI "fail closed" ilkesi. */
export function getAuthorizedStorageRiskGroupIdsSync(providerId: string | undefined): string[] {
  if (!providerId || cache?.providerId !== providerId) return [];
  return cache.riskGroupIds;
}

/** GERÇEK Supabase fetch'i — provider'ın KENDİ oturumundan, RLS `provider_id = auth.uid() or is_admin()` ile sınırlı. */
export async function refreshAuthorizedStorageRiskGroupIds(providerId: string): Promise<string[]> {
  if (inFlightProviderId === providerId) {
    return cache?.providerId === providerId ? cache.riskGroupIds : [];
  }
  inFlightProviderId = providerId;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("provider_storage_risk_authorizations")
      .select("risk_group_id")
      .eq("provider_id", providerId)
      .is("revoked_at", null);
    if (error) {
      console.error("refreshAuthorizedStorageRiskGroupIds: Supabase sorgusu başarısız:", error.message, error.code);
    }
    const ids = error || !data ? [] : (data as { risk_group_id: string }[]).map((row) => row.risk_group_id);
    cache = { providerId, riskGroupIds: ids };
    notify();
    return ids;
  } finally {
    inFlightProviderId = null;
  }
}
