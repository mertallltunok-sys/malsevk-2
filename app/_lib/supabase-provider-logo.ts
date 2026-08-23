import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { setMyProviderProfileLogoPathRemote } from "./supabase-provider-profile";

/**
 * PROFİL/PROVIDER GEÇİŞİ — GERÇEK Supabase Storage entegrasyonu
 * (`provider-logos` bucket, bkz. supabase/migrations/0019_storage_policies.sql).
 *
 * TASARIM NOTU (tur 3 güncellemesi): `provider_profiles.logo_path`e artık
 * GERÇEK bir yazma yolu var (bkz. supabase/migrations/0023_provider_profile_
 * and_document_write_paths.sql#set_provider_profile_logo_path) — bu modül
 * hem o kolonu yazar HEM DE Storage'ın kendi durumunu (sabit
 * `provider-logos/{auth.uid()}/logo.{ext}` yolu + `list()`) tek doğruluk
 * kaynağı olarak kullanmaya devam eder: `logo_path` yalnızca GÖRÜNTÜLEME
 * kolaylığı (ör. ileride bir liste/arama ekranının provider_profiles'ı tek
 * sorguda okuyabilmesi) içindir, bu modülün KENDİ "var mı" sorgusu (`getMy
 * ProviderLogoUrlRemote`) hâlâ doğrudan Storage'a bakar — iki kaynağın
 * (Storage + logo_path) senkron kalması bu modülün sorumluluğundadır (her
 * upload/delete ikisini de günceller). `list()` RLS'i (`provider_logos_
 * bucket_read_public`, herkese açık okuma) o an hangi dosyanın (varsa) var
 * olduğunu bulur; yeni bir yükleme ESKİ dosyayı (farklı uzantı olabileceği
 * için ADIYLA değil, KLASÖRDEKİ HER ŞEYİ silerek) önce temizler, sonra yeni
 * dosyayı yazar — orphan/çift dosya kalmaz.
 */
const BUCKET = "provider-logos";
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024; // Bucket'ın kendi file_size_limit'iyle (0019) birebir.

function getExtensionFromFile(file: File): string {
  const dotIndex = file.name.lastIndexOf(".");
  return dotIndex === -1 ? "" : file.name.slice(dotIndex + 1).toLowerCase();
}

export type UploadProviderLogoResult = { ok: true; publicUrl: string } | { ok: false; error: string };

export async function uploadMyProviderLogoRemote(file: File): Promise<UploadProviderLogoResult> {
  const extension = getExtensionFromFile(file);
  if (!ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])) {
    return { ok: false, error: "Logo için yalnızca JPG, PNG veya WEBP yükleyebilirsiniz." };
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: "Logo için yalnızca JPG, PNG veya WEBP yükleyebilirsiniz." };
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return { ok: false, error: `Logo boyutu ${Math.round(MAX_LOGO_SIZE_BYTES / (1024 * 1024))} MB'ı geçemez.` };
  }
  if (file.size === 0) {
    return { ok: false, error: "Dosya boş veya bozuk." };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Logo yüklemek için giriş yapmalısınız." };
  }

  // Kendi klasöründeki HER ŞEYİ önce sil (farklı uzantılı eski bir logo
  // orphan kalmasın — bkz. modülün üstündeki dokümantasyon).
  await deleteMyProviderLogoRemote();

  const path = `${user.id}/logo.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) {
    return { ok: false, error: "Logo yüklenemedi. Lütfen tekrar deneyin." };
  }

  // Storage yazımı zaten başarılı — provider_profiles.logo_path'in
  // güncellenememesi (ör. henüz hiç provider_profiles satırı yoksa bile
  // RPC kendi satırını UPSERT ile açar, bkz. 0023) bu fonksiyonu
  // BAŞARISIZ SAYMAZ; logo zaten Storage'da tek doğruluk kaynağı olarak var
  // ve görüntülenebilir (bkz. modülün üstündeki dokümantasyon).
  const logoPathResult = await setMyProviderProfileLogoPathRemote(path);
  if (!logoPathResult.ok) {
    console.error("set_provider_profile_logo_path başarısız:", logoPathResult.error);
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, publicUrl: publicUrlData.publicUrl };
}

/** Kullanıcının güncel logosunun genel (public) URL'ini döner — hiç yüklenmemişse `null`. */
export async function getMyProviderLogoUrlRemote(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: files } = await supabase.storage.from(BUCKET).list(user.id, { limit: 1 });
  if (!files || files.length === 0) return null;

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(`${user.id}/${files[0].name}`);
  return publicUrlData.publicUrl;
}

export async function deleteMyProviderLogoRemote(): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: files } = await supabase.storage.from(BUCKET).list(user.id, { limit: 100 });
  if (!files || files.length === 0) return true;

  const paths = files.map((file) => `${user.id}/${file.name}`);
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (!error) {
    const logoPathResult = await setMyProviderProfileLogoPathRemote(null);
    if (!logoPathResult.ok) {
      console.error("set_provider_profile_logo_path (temizleme) başarısız:", logoPathResult.error);
    }
  }
  return !error;
}
