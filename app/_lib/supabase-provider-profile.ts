import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { ExperienceRange, ServiceFeature } from "./types";

/**
 * 0043 (hata mesajı denetimi) — bu dosya daha önce `error.message`'ı (ham
 * Postgres/RPC metni) doğrudan `provider-profile-editor.tsx`/`service-info-
 * editor.tsx`'in `remoteSyncWarning` banner'ına aktarıyordu — kullanıcı
 * gerçekten "ML127: account is suspended" gibi bir dize görebilirdi. Artık
 * ÖNCE `getAccountStatusErrorMessage` kontrol edilir, o da eşleşmezse teknik
 * detaysız bir genel mesaja düşülür — hiçbir kod/mesaj çağıran bileşene ham
 * olarak sızmaz.
 */
function mapProviderProfileRpcError(error: { code?: string; message: string }): string {
  return getAccountStatusErrorMessage(error.code) ?? "Değişiklikler merkezi veritabanına yansıtılamadı. Lütfen tekrar deneyin.";
}

/**
 * PROFİL/PROVIDER GEÇİŞİ (tur 3) — `provider_profiles` artık GERÇEK bir
 * yazma yoluna sahip (bkz. supabase/migrations/0023_provider_profile_and_
 * document_write_paths.sql, `upsert_provider_profile`/
 * `set_provider_profile_logo_path` RPC'leri). `provider-profile-editor.tsx`
 * bunu localStorage yazımının YANINA ekler (dual-write) — localStorage hâlâ
 * bloklamayan/ana yol (görev: "localStorage/IndexedDB mirror yapısını
 * şimdilik kaldırma").
 *
 * KISMİ GÜNCELLEME (görev gereksinimi, kaynağın kendi deseniyle AYNI):
 * `upsert_provider_profile` RPC'si HER ZAMAN 5 sütunun TAMAMINI yazar (tam
 * UPSERT, kısmi PATCH değil) — ama kaynak uygulamada bu 5 alan İKİ AYRI,
 * BİRBİRİNDEN BAĞIMSIZ ekrana bölünmüştür (`ProviderProfileEditor`:
 * bio/foundedYear/regions; `ServiceInfoEditor`: regions/serviceFeatures/
 * experienceRange — `regions` her ikisinin de düzenleyebildiği TEK ortak
 * alan, bkz. CLAUDE.md'nin "iki editör yüzeyi" notu). Bu fonksiyon, `users.ts#
 * updateProviderProfile`/`updateProviderServiceInfo`'nun localStorage'da
 * ZATEN yaptığı "önce var olanı oku, yalnızca kendi alanlarını değiştir,
 * DİĞERLERİNİ olduğu gibi taşı" desenini BİREBİR REMOTE tarafta da uygular
 * — çağıran yalnızca KENDİ sorumlu olduğu alanları geçirir (`Partial`),
 * eksik bırakılanlar var olan uzak satırdan okunup değişmeden yazılır.
 */
export type UpsertProviderProfileInput = Partial<{
  bio: string;
  foundedYear: number | null;
  experienceRange: ExperienceRange | null;
  regions: string[];
  serviceFeatures: ServiceFeature[];
}>;

export type UpsertProviderProfileResult = { ok: true } | { ok: false; error: string };

type RemoteProviderProfileRow = {
  bio: string | null;
  founded_year: number | null;
  experience_range: ExperienceRange | null;
  regions: string[] | null;
  service_features: ServiceFeature[] | null;
};

export async function upsertMyProviderProfileRemote(
  input: UpsertProviderProfileInput,
): Promise<UpsertProviderProfileResult> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Bu işlem için giriş yapmalısınız." };

  const { data: existing } = await supabase
    .from("provider_profiles")
    .select("bio, founded_year, experience_range, regions, service_features")
    .eq("user_id", user.id)
    .maybeSingle<RemoteProviderProfileRow>();

  const bio = "bio" in input ? (input.bio ?? "").trim() : (existing?.bio ?? "");

  const { error } = await supabase.rpc("upsert_provider_profile", {
    p_bio: bio.length > 0 ? bio : null,
    p_founded_year: "foundedYear" in input ? input.foundedYear : (existing?.founded_year ?? null),
    p_experience_range: "experienceRange" in input ? input.experienceRange : (existing?.experience_range ?? null),
    p_regions: "regions" in input ? (input.regions ?? []) : (existing?.regions ?? []),
    p_service_features: "serviceFeatures" in input ? (input.serviceFeatures ?? []) : (existing?.service_features ?? []),
  });
  if (error) {
    return { ok: false, error: mapProviderProfileRpcError(error) };
  }
  return { ok: true };
}

export type RemoteProviderProfile = {
  bio: string | null;
  foundedYear: number | null;
  experienceRange: ExperienceRange | null;
  regions: string[] | null;
  serviceFeatures: ServiceFeature[] | null;
};

/**
 * Oturumdaki kullanıcının KENDİ `provider_profiles` satırını okur (RLS:
 * yalnızca kendi satırı) — `getMyProviderServiceCategoryIdsRemote`
 * (supabase-provider-services.ts) ve `getMyProviderLogoUrlRemote`
 * (supabase-provider-logo.ts) ile AYNI "gerçek veriyi doğrudan oku" ailesi.
 * Hiç satır yoksa (provider henüz Firma Profili/Hizmet Bilgilerim'i hiç
 * doldurmamış) `null` döner — bu bir hata değildir.
 */
export async function getMyProviderProfileRemote(): Promise<RemoteProviderProfile | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("provider_profiles")
    .select("bio, founded_year, experience_range, regions, service_features")
    .eq("user_id", user.id)
    .maybeSingle<RemoteProviderProfileRow>();
  if (!data) return null;

  return {
    bio: data.bio,
    foundedYear: data.founded_year,
    experienceRange: data.experience_range,
    regions: data.regions,
    serviceFeatures: data.service_features,
  };
}

export type SetProviderProfileLogoPathResult = { ok: true } | { ok: false; error: string };

/** `p_logo_path: null` logoyu Supabase tarafında da kaldırır. */
export async function setMyProviderProfileLogoPathRemote(
  logoPath: string | null,
): Promise<SetProviderProfileLogoPathResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_provider_profile_logo_path", { p_logo_path: logoPath });
  if (error) {
    return { ok: false, error: mapProviderProfileRpcError(error) };
  }
  return { ok: true };
}
