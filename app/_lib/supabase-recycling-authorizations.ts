"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi —
 * `supabase-storage-risk-authorizations.ts#authorizedStorageRiskGroupsStore`
 * İLE AYNI "düz senkron önbellek + reaktif fetch" deseni, İKİ eksene birden
 * bakar (migration 0069): provider_service_authorizations.recycling_activities
 * (faaliyet ekseni, "geri-donusum-atik-tahliye" kategori satırının üzerinde)
 * VE provider_recycling_waste_code_authorizations (atık kodu ekseni, ayrı
 * tablo). İKİNCİ bir mimari İCAT EDİLMEDİ — tek modül, tek reaktif hook, iki
 * ayrı Supabase sorgusu.
 *
 * FAIL-CLOSED (0068'in storage risk gruplarındaki AYNI ilke, storage_
 * activity_scopes/imo_class_codes'un "null=SINIRSIZ" varsayımından FARKLI):
 * önbellek boşsa ya da provider hiç yetki taşımıyorsa `[]` döner —
 * job-visibility.ts#resolveVisibility bunu "yetkili değil" olarak okur.
 */

type RecyclingAuthState = { providerId: string; activityIds: string[]; wasteCodes: string[] } | null;

let cache: RecyclingAuthState = null;
let inFlightProviderId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export const authorizedRecyclingScopesStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): RecyclingAuthState {
    return cache;
  },
  getServerSnapshot(): RecyclingAuthState {
    return null;
  },
};

/** Senkron/anlık okuma — `getAuthorizedStorageRiskGroupIdsSync` İLE AYNI "fail closed" ilkesi. */
export function getAuthorizedRecyclingActivityIdsSync(providerId: string | undefined): string[] {
  if (!providerId || cache?.providerId !== providerId) return [];
  return cache.activityIds;
}

export function getAuthorizedRecyclingWasteCodesSync(providerId: string | undefined): string[] {
  if (!providerId || cache?.providerId !== providerId) return [];
  return cache.wasteCodes;
}

/** GERÇEK Supabase fetch'i — provider'ın KENDİ oturumundan, RLS `provider_id = auth.uid() or is_admin()` ile sınırlı, iki sorgu paralel. */
export async function refreshAuthorizedRecyclingScopes(
  providerId: string,
): Promise<{ activityIds: string[]; wasteCodes: string[] }> {
  if (inFlightProviderId === providerId) {
    return cache?.providerId === providerId
      ? { activityIds: cache.activityIds, wasteCodes: cache.wasteCodes }
      : { activityIds: [], wasteCodes: [] };
  }
  inFlightProviderId = providerId;
  try {
    const supabase = createSupabaseBrowserClient();
    const [activityResult, wasteCodeResult] = await Promise.all([
      supabase
        .from("provider_service_authorizations")
        .select("recycling_activities")
        .eq("provider_id", providerId)
        .eq("service_category_id", "geri-donusum-atik-tahliye")
        .is("revoked_at", null)
        .maybeSingle(),
      supabase.from("provider_recycling_waste_code_authorizations").select("waste_code").eq("provider_id", providerId).is("revoked_at", null),
    ]);

    if (activityResult.error) {
      console.error("refreshAuthorizedRecyclingScopes: faaliyet sorgusu başarısız:", activityResult.error.message, activityResult.error.code);
    }
    if (wasteCodeResult.error) {
      console.error("refreshAuthorizedRecyclingScopes: atık kodu sorgusu başarısız:", wasteCodeResult.error.message, wasteCodeResult.error.code);
    }

    const activityIds =
      activityResult.error || !activityResult.data ? [] : ((activityResult.data.recycling_activities as string[] | null) ?? []);
    const wasteCodes =
      wasteCodeResult.error || !wasteCodeResult.data ? [] : (wasteCodeResult.data as { waste_code: string }[]).map((row) => row.waste_code);

    cache = { providerId, activityIds, wasteCodes };
    notify();
    return { activityIds, wasteCodes };
  } finally {
    inFlightProviderId = null;
  }
}
