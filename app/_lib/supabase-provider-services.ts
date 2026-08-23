import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * PROFİL/PROVIDER GEÇİŞİ: `provider-services.ts` (localStorage, hâlâ
 * job-visibility.ts'in Nakliye/Gümrük izolasyon kuralı dahil TÜM mevcut
 * ilan/teklif kodunun okuduğu TEK kaynak — bu görev "İlan sistemini
 * Supabase'e geçirme"yi açıkça yasaklıyor) ile GERÇEK `provider_services`
 * tablosu arasındaki köprü. `set_provider_service_categories(text[])` RPC'si
 * (0014) kaynağın `setProviderServiceCategoryIds`iyle BİREBİR aynı "tam
 * değiştirme" (delete-then-insert, geçersiz id'leri sessizce eleme, tek
 * transaction) semantiğine sahiptir — bu yüzden burada ayrı bir doğrulama
 * katmanı İCAT EDİLMEZ, RPC'nin kendi (`current_user_role() = 'hizmet-veren'`
 * kontrolü dahil) davranışına güvenilir.
 *
 * Çağıranlar (service-info-editor.tsx) BUNU localStorage yazımının YANINA
 * ekler (dual-write) — localStorage hâlâ TEK doğruluk kaynağı olarak kalır
 * (job-visibility.ts vb. hiç değişmedi), Supabase yazımı GERÇEK ama şimdilik
 * yalnızca "aynı zamanda gerçek veritabanına da yansıt" rolündedir.
 */
export type SetProviderServiceCategoriesRemoteResult = { ok: true } | { ok: false; error: string };

export async function setMyProviderServiceCategoriesRemote(
  categoryIds: string[],
): Promise<SetProviderServiceCategoriesRemoteResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_provider_service_categories", { p_category_ids: categoryIds });
  if (error) {
    return { ok: false, error: getAccountStatusErrorMessage(error.code) ?? "Hizmet kategorileri merkezi veritabanına yansıtılamadı. Lütfen tekrar deneyin." };
  }
  return { ok: true };
}

export type RemoteProviderServiceRow = { service_category_id: string };

/** Gerçek `provider_services` tablosundan, oturumdaki kullanıcının KENDİ seçimlerini okur (RLS: yalnızca kendi satırları). */
export async function getMyProviderServiceCategoryIdsRemote(): Promise<string[]> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("provider_services")
    .select("service_category_id")
    .eq("provider_id", user.id)
    .returns<RemoteProviderServiceRow[]>();

  return (data ?? []).map((row) => row.service_category_id);
}
