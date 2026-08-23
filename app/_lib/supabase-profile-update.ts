import { isCompanyType, type CompanyType } from "./company-type";
import { normalizePhoneNumber } from "./phone";
import { refreshSession } from "./session";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { UserRole } from "./types";
import { upsertSupabaseUserMirror } from "./users";

/**
 * PROFİL/PROVIDER GEÇİŞİ — `profiles` tablosunun GERÇEK, çalışan sütun
 * seviyeli UPDATE yetkisini kullanır (bkz. supabase/migrations/
 * 0003_profiles_and_provider_catalog.sql satır 97-98: `grant update
 * (full_name, phone, company_name, company_type, province, district) on
 * public.profiles to authenticated` — `role`/`account_status`/
 * `onboarding_completed` bu listede YOKTUR ve PostgreSQL bunları içeren
 * TEK bir istekte TÜM güncellemeyi reddeder, kısmi uygulama YAPMAZ; bu
 * gerçek Supabase'e karşı doğrulanmıştır, bkz. son rapor madde 4). Bu
 * yüzden bu fonksiyon KASITLI OLARAK açık bir alan listesi gönderir —
 * çağıranın `role`/`id` gibi bir alanı kazara eklemesi mümkün değildir
 * (tip düzeyinde de yoktur).
 *
 * `id` HİÇBİR ZAMAN parametre olarak alınmaz — satır her zaman gerçek
 * oturumdaki `auth.uid()` ile kilitlenir (`.eq("id", user.id)` + RLS'in
 * kendi `profiles_update_own` politikası, çift katman).
 */
export type UpdateMyProfileInput = {
  fullName: string;
  phone: string;
  companyName: string;
  companyType: CompanyType;
  province: string;
  district: string;
  /** Yalnızca localStorage aynasını (StoredUser.role) doğru yazmak için gereklidir — `profiles.role` bu çağrıyla ASLA değiştirilmez/gönderilmez. */
  currentRole: UserRole;
};

export type UpdateMyProfileResult = { ok: true } | { ok: false; error: string };

export async function updateMyProfileRemote(input: UpdateMyProfileInput): Promise<UpdateMyProfileResult> {
  const fullName = input.fullName.trim();
  if (fullName.length === 0) return { ok: false, error: "Ad Soyad zorunludur." };

  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.ok) return { ok: false, error: phoneResult.error };

  if (!isCompanyType(input.companyType)) return { ok: false, error: "Firma tipi zorunludur." };

  const companyName = input.companyName.trim();
  const province = input.province.trim();
  const district = input.district.trim();
  if (companyName.length === 0) return { ok: false, error: "Firma adı zorunludur." };
  if (province.length === 0 || district.length === 0) return { ok: false, error: "İl ve ilçe zorunludur." };

  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Bu işlem için giriş yapmalısınız." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phoneResult.value,
      company_name: companyName,
      company_type: input.companyType,
      province,
      district,
    })
    .eq("id", user.id);

  if (error) {
    return { ok: false, error: "Profil güncellenemedi. Lütfen tekrar deneyin." };
  }

  // Kendi bu-oturumdaki önbelleği (useSessionProfileDetails) HEMEN yeniler —
  // bkz. session.ts'in kendi dokümantasyonu.
  await refreshSession();

  // Geçiş dönemi aynası: localStorage StoredUser dizini de güncellenir
  // (contact-access.ts/ratings.ts/my-offers-panel gibi bu görevin kapsamı
  // dışındaki ekranlar hâlâ bunu okuyor) — tek doğruluk kaynağı ARTIK
  // yukarıdaki gerçek Supabase yazımıdır, bu yalnızca en iyi çaba bir
  // kopyadır (başarısız olsa bile genel sonucu ETKİLEMEZ).
  upsertSupabaseUserMirror({
    id: user.id,
    name: fullName,
    email: user.email ?? "",
    phone: phoneResult.value,
    role: input.currentRole,
    companyName,
    companyType: input.companyType,
    province,
    district,
  });

  return { ok: true };
}
