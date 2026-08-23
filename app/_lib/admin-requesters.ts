import { normalizePhoneNumber } from "./phone";
import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Admin "Hizmet Alanlar" modülü — yalnızca `role = 'hizmet-alan'` profiller.
 * `admin-companies.ts` ("Firmalar", role='hizmet-veren') ile AYNI desen:
 * tamamı mevcut `profiles` tablosundan (0003), admin RLS dalı (`is_admin()`,
 * bkz. 0013_rls_policies.sql) üzerinden okunur — service_role/RLS bypass
 * yok. Hizmet Alan hesaplarının `provider_profiles`/`provider_services`/
 * `provider_documents`/`provider_badges` satırı hiç yok, bu yüzden
 * `admin-companies.ts`'in aksine yalnızca `profiles`e bakar, ek join yok.
 *
 * Askıya alma/geri açma zaten var olan `suspend_user`/`reinstate_user`
 * RPC'lerini (0016) çağırır — bu modülden önce hiçbir UI onları kullanmıyordu
 * (yalnızca admin-dashboard-data.ts'in audit-log etiket haritasında isim
 * olarak geçiyorlardı). Buradaki hata haritalama, `admin-badges.ts#
 * mapRevokeBadgeError`'ın AYNI deseni.
 */

export type AdminRequesterListItem = {
  id: string;
  fullName: string | null;
  companyName: string | null;
  companyType: string | null;
  phone: string | null;
  province: string | null;
  district: string | null;
  accountStatus: "active" | "suspended" | "banned";
  createdAt: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  company_type: string | null;
  phone: string | null;
  province: string | null;
  district: string | null;
  account_status: "active" | "suspended" | "banned";
  created_at: string;
};

export async function listRequestersForAdmin(): Promise<AdminRequesterListItem[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, company_name, company_type, phone, province, district, account_status, created_at")
    .eq("role", "hizmet-alan")
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  return (data as ProfileRow[]).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    companyName: row.company_name,
    companyType: row.company_type,
    phone: row.phone,
    province: row.province,
    district: row.district,
    accountStatus: row.account_status,
    createdAt: row.created_at,
  }));
}

export async function getRequesterDetailForAdmin(userId: string): Promise<AdminRequesterListItem | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, company_name, company_type, phone, province, district, account_status, created_at, role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data || data.role !== "hizmet-alan") return null;

  const row = data as ProfileRow & { role: string };
  return {
    id: row.id,
    fullName: row.full_name,
    companyName: row.company_name,
    companyType: row.company_type,
    phone: row.phone,
    province: row.province,
    district: row.district,
    accountStatus: row.account_status,
    createdAt: row.created_at,
  };
}

export type RequesterActionResult = { ok: true } | { ok: false; error: string };

function mapUserStatusError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK82":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK76":
      return "Kullanıcı bulunamadı.";
    case "MLK91":
      return "Sistemdeki son aktif yönetici hesabı askıya alınamaz.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

/** suspend_user (0016) — admin-only, gerekçe UI'da zorunlu tutulur (RPC'nin kendisi boş string'i reddetmez, ama denetim kaydının anlamlı olması için burada zorunlu kılınır). */
export async function suspendRequesterRemote(userId: string, reason: string): Promise<RequesterActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("suspend_user", { p_user_id: userId, p_reason: reason.trim() });
  if (error) return { ok: false, error: mapUserStatusError(error) };
  return { ok: true };
}

/** reinstate_user (0016) — admin-only, gerekçe parametresi yok (RPC imzasında hiç yok). */
export async function reinstateRequesterRemote(userId: string): Promise<RequesterActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("reinstate_user", { p_user_id: userId });
  if (error) return { ok: false, error: mapUserStatusError(error) };
  return { ok: true };
}

export type AdminProfileEditInput = {
  fullName: string;
  phone: string;
  companyName: string;
  companyType: string;
  province: string;
  district: string;
};

/** `admin-companies.ts#mapProfileEditError`'ın AYNI deseni — `update_profile_as_admin` (0036) her iki modülde de aynı hata kodu setini döner. */
function mapProfileEditError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "ML119":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "ML120":
      return "Kullanıcı bulunamadı.";
    case "ML102":
      return "Ad Soyad, firma adı, il ve ilçe alanlarının tümü zorunludur.";
    case "ML121":
      return "Telefon numarası +905XXXXXXXXX biçiminde olmalıdır.";
    case "ML122":
      return "Firma adı en fazla 150 karakter olabilir.";
    case "ML123":
      return "Geçersiz firma türü.";
    default:
      return error.message || "Profil güncellenemedi. Lütfen tekrar deneyin.";
  }
}

/** update_profile_as_admin (0036) — admin-only; profiles_update_own RLS politikası (id = auth.uid()) yalnızca bu SECURITY DEFINER RPC ile aşılabilir. Telefon, supabase-profile-update.ts#updateMyProfileRemote ile AYNI şekilde `normalizePhoneNumber` ile istemci tarafında normalize edilir. */
export async function updateRequesterProfileAsAdmin(userId: string, input: AdminProfileEditInput): Promise<RequesterActionResult> {
  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.ok) return { ok: false, error: phoneResult.error };

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_profile_as_admin", {
    p_user_id: userId,
    p_full_name: input.fullName,
    p_phone: phoneResult.value,
    p_company_name: input.companyName,
    p_company_type: input.companyType,
    p_province: input.province,
    p_district: input.district,
  });
  if (error) return { ok: false, error: mapProfileEditError(error) };
  return { ok: true };
}
