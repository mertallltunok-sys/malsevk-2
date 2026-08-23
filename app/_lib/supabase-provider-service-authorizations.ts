"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { STORAGE_CONTAINER_CATEGORY_ID, type ContainerStorageAuthorization } from "./storage-container-catalog";

/**
 * HİZMET BAZLI PROVIDER YETKİLENDİRMESİ — canlı okuma katmanı.
 *
 * KRİTİK MİMARİ KARAR (bkz. proje raporu): bu modül, projedeki HER diğer
 * canlı Hizmet Veren/Hizmet Alan verisinin aksine (bkz. CLAUDE.md "No real
 * backend"), localStorage'ı DEĞİL, DOĞRUDAN Supabase'i (provider_service_
 * authorizations, RLS: `provider_id = auth.uid() or is_admin()`) okur —
 * bilinçli bir istisna, kaçırılmış bir tutarsızlık DEĞİL. Gerekçe: görev
 * gereksinimi "cross-device" — bir admin PC-A'da bir hizmeti yetkilendirdiğinde,
 * provider PC-B'de (FARKLI bir tarayıcı/cihaz, dolayısıyla FARKLI bir
 * localStorage) sayfayı yenilediğinde bunu görmelidir. localStorage cihazlar
 * arası PAYLAŞILAMAZ (web platformunun kendi sınırı) — bu yüzden "admin
 * kararını best-effort olarak bu tarayıcının localStorage'ına da yansıt"
 * deseni (bkz. job-store.ts#applyAdminModerationDecision) burada YETERSİZ
 * kalırdı, çünkü admin ve provider farklı tarayıcılardaysa o yansıma asla
 * provider'ın tarayıcısına ulaşmaz. Gerçek kaynak (source of truth) bu
 * yüzden HER ZAMAN doğrudan Supabase'tir.
 *
 * job-visibility.ts'in kendi deseniyle AYNI "düz + reaktif çift" ayrımı
 * burada da geçerlidir: `getAuthorizedServiceCategoryIdsSync` senkron/anlık
 * bir okuma (bileşen dışı, tek seferlik kontroller için — offers.ts#
 * createOffer/canProviderSubmitNewOffer ZATEN localStorage senkron olduğu
 * için async'e ÇEVRİLMEDİ, bunun yerine bu modülün ÖNCEDEN doldurulmuş
 * önbelleğini okur); `useAuthorizedServiceCategoryIds` (use-authorized-
 * services.ts) REAKTİF hâli, mount olduğunda GERÇEK bir Supabase fetch'i
 * tetikler. Süzme EN ERKEN noktada (bir sayfanın kendi üst bileşeninde)
 * yapılmalıdır — job-visibility.ts'in kendi "süzme en erken noktada"
 * ilkesiyle AYNI.
 */

type AuthorizedServicesState = { providerId: string; serviceCategoryIds: string[] } | null;

let cache: AuthorizedServicesState = null;
let inFlightProviderId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export const authorizedServicesStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): AuthorizedServicesState {
    return cache;
  },
  getServerSnapshot(): AuthorizedServicesState {
    return null;
  },
};

/**
 * Senkron/anlık okuma — yalnızca ÖNCEDEN `refreshAuthorizedServiceCategoryIds`
 * (ya da onu tetikleyen `useAuthorizedServiceCategoryIds` hook'u) ile
 * doldurulmuş önbelleği okur, kendisi HİÇBİR ağ isteği yapmaz. Önbellek bu
 * `providerId` için henüz doldurulmadıysa (sayfa yeni açıldı, fetch hâlâ
 * sürüyor) BİLEREK boş dizi döner — "fail closed": bir hizmet yetkisi
 * doğrulanana kadar hiçbir ilan/teklif yetkisi VARSAYILMAZ, yükleme anında
 * kısa bir an için (gerçekte yetkili olsa bile) hiçbir şey göstermemek,
 * yetkisiz bir ilanı yanlışlıkla göstermekten HER ZAMAN daha güvenlidir.
 */
export function getAuthorizedServiceCategoryIdsSync(providerId: string | undefined): string[] {
  if (!providerId || cache?.providerId !== providerId) return [];
  return cache.serviceCategoryIds;
}

/** GERÇEK Supabase fetch'i — provider'ın KENDİ oturumundan, RLS `provider_id = auth.uid()` ile sınırlı. */
export async function refreshAuthorizedServiceCategoryIds(providerId: string): Promise<string[]> {
  if (inFlightProviderId === providerId) {
    // Aynı provider için zaten sürmekte olan bir fetch varken ikinci bir
    // eşzamanlı isteği önler (ör. aynı render'da hem üst bileşen hem alt
    // bileşen hook'u mount olursa) — sonucu bekleyen ikinci çağıran, ilk
    // çağıranın notify()'ıyla zaten güncellenmiş önbelleği görecektir.
    return cache?.providerId === providerId ? cache.serviceCategoryIds : [];
  }
  inFlightProviderId = providerId;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("provider_service_authorizations")
      .select("service_category_id")
      .eq("provider_id", providerId)
      .is("revoked_at", null);
    if (error) {
      console.error("refreshAuthorizedServiceCategoryIds: Supabase sorgusu başarısız:", error.message, error.code);
    }
    const ids = error || !data ? [] : (data as { service_category_id: string }[]).map((row) => row.service_category_id);
    cache = { providerId, serviceCategoryIds: ids };
    notify();
    return ids;
  } finally {
    inFlightProviderId = null;
  }
}

/**
 * "Depocu Faaliyet Alanları" — Konteyner Depolama yetkisinin İNCE TANELİ
 * ayrıntısı (bkz. storage-container-catalog.ts#ContainerStorageAuthorization,
 * migration 0059). Yukarıdaki kategori-seviyesi store'un TAM AYNI "düz
 * senkron önbellek + reaktif fetch" deseni — ikinci bir mimari İCAT
 * EDİLMEDİ, yalnızca Konteyner Depolama'ya özel ek bir okuma. `scopes`/
 * `imoClasses` `null` ise "SINIRSIZ" (bkz. o tipin kendi dokümanı) — bu
 * ayrım DB'den GELDİĞİ GİBİ korunur, burada asla `[]`e normalize edilmez.
 */
type ContainerScopesState = { providerId: string; authorization: ContainerStorageAuthorization | null } | null;

let containerScopesCache: ContainerScopesState = null;
let containerScopesInFlightProviderId: string | null = null;
const containerScopesListeners = new Set<() => void>();

function notifyContainerScopes() {
  for (const listener of containerScopesListeners) listener();
}

export const authorizedContainerScopesStore = {
  subscribe(listener: () => void): () => void {
    containerScopesListeners.add(listener);
    return () => containerScopesListeners.delete(listener);
  },
  getSnapshot(): ContainerScopesState {
    return containerScopesCache;
  },
  getServerSnapshot(): ContainerScopesState {
    return null;
  },
};

/** Senkron/anlık okuma — `getAuthorizedServiceCategoryIdsSync` İLE AYNI "fail closed" ilkesi: önbellek bu provider için henüz doldurulmadıysa `null` döner (bkz. isProviderEligibleForContainerJob'un `null` = "hiç yetkisi yok" yorumu). */
export function getAuthorizedContainerScopesSync(providerId: string | undefined): ContainerStorageAuthorization | null {
  if (!providerId || containerScopesCache?.providerId !== providerId) return null;
  return containerScopesCache.authorization;
}

/** GERÇEK Supabase fetch'i — provider'ın KENDİ oturumundan, RLS `provider_id = auth.uid()` ile sınırlı. Aktif (revoked_at is null) konteyner-depolama yetkilendirme satırı yoksa `authorization: null` döner (hiç yetkisi yok, bkz. isProviderEligibleForContainerJob). */
export async function refreshAuthorizedContainerScopes(providerId: string): Promise<ContainerStorageAuthorization | null> {
  if (containerScopesInFlightProviderId === providerId) {
    return containerScopesCache?.providerId === providerId ? containerScopesCache.authorization : null;
  }
  containerScopesInFlightProviderId = providerId;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("provider_service_authorizations")
      .select("storage_activity_scopes, imo_class_codes")
      .eq("provider_id", providerId)
      .eq("service_category_id", STORAGE_CONTAINER_CATEGORY_ID)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      console.error("refreshAuthorizedContainerScopes: Supabase sorgusu başarısız:", error.message, error.code);
    }
    const authorization: ContainerStorageAuthorization | null =
      error || !data ? null : { scopes: data.storage_activity_scopes, imoClasses: data.imo_class_codes };
    containerScopesCache = { providerId, authorization };
    notifyContainerScopes();
    return authorization;
  } finally {
    containerScopesInFlightProviderId = null;
  }
}
