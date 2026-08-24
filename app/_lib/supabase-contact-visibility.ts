import { refreshSession } from "./session";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { UserRole } from "./types";
import { CONTACT_VISIBILITY_MIN_ONE_MESSAGE, upsertSupabaseUserMirror } from "./users";

/**
 * İLETİŞİM GİZLİLİĞİ GÖREVİ — `supabase-profile-update.ts#updateMyProfileRemote`
 * ile BİREBİR AYNI kalıp (dar sütun listesi, `id` asla parametre alınmaz,
 * satır her zaman gerçek oturumdaki `auth.uid()` ile kilitlenir): "İletişim
 * Bilgisi Görünürlüğü" tercihi artık GERÇEK `profiles.show_email_after_
 * agreement`/`show_phone_after_agreement` sütunlarına yazılır (migration
 * 0079) — localStorage (`StoredUser.showEmailAfterAgreement`/
 * `showPhoneAfterAgreement`) artık yalnızca en-iyi-çaba bir ayna, asıl
 * kaynak burasıdır.
 *
 * İkisi birden `false` olan bir istek burada da (arayüzün ön-uyarısına
 * GÜVENMEDEN) reddedilir — `get_offer_contact` (0079) sunucu tarafında bu
 * kuralı zorlamaz (yalnızca ayrı ayrı iki sütunu okur), bu yüzden atlanamaz
 * kontrol İSTEMCİ tarafında kalır; bu, veritabanı şemasına yeni bir CHECK
 * kısıtı eklemeden mevcut UX kuralını korur.
 */
export type UpdateMyContactVisibilityInput = {
  showEmailAfterAgreement: boolean;
  showPhoneAfterAgreement: boolean;
  /** Yalnızca localStorage aynasını doğru rolle yazmak için gereklidir — `profiles.role` bu çağrıyla ASLA değiştirilmez/gönderilmez. */
  currentRole: UserRole;
  /** Yalnızca localStorage aynasını (StoredUser.name/email/phone) doğru doldurmak için gereklidir — bu alanlar bu çağrıyla ASLA güncellenmez. */
  currentName: string;
  currentEmail: string;
  currentPhone: string;
};

export type UpdateMyContactVisibilityResult = { ok: true } | { ok: false; error: string };

export async function updateMyContactVisibilityRemote(
  input: UpdateMyContactVisibilityInput,
): Promise<UpdateMyContactVisibilityResult> {
  if (!input.showEmailAfterAgreement && !input.showPhoneAfterAgreement) {
    return { ok: false, error: CONTACT_VISIBILITY_MIN_ONE_MESSAGE };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Bu işlem için giriş yapmalısınız." };

  const { error } = await supabase
    .from("profiles")
    .update({
      show_email_after_agreement: input.showEmailAfterAgreement,
      show_phone_after_agreement: input.showPhoneAfterAgreement,
    })
    .eq("id", user.id);

  if (error) {
    return { ok: false, error: "Tercih güncellenemedi. Lütfen tekrar deneyin." };
  }

  // Kendi bu-oturumdaki önbelleği (useSessionProfileDetails) HEMEN yeniler —
  // bkz. supabase-profile-update.ts'in AYNI adımı.
  await refreshSession();

  // Geçiş dönemi aynası: contact-access.ts#applyContactVisibility hâlâ
  // localStorage StoredUser'dan okuyor (bkz. o dosyanın dokümanı) — tek
  // doğruluk kaynağı ARTIK yukarıdaki gerçek Supabase yazımıdır, bu yalnızca
  // en iyi çaba bir kopyadır (başarısız olsa bile genel sonucu ETKİLEMEZ).
  upsertSupabaseUserMirror({
    id: user.id,
    name: input.currentName,
    email: input.currentEmail,
    phone: input.currentPhone,
    role: input.currentRole,
    showEmailAfterAgreement: input.showEmailAfterAgreement,
    showPhoneAfterAgreement: input.showPhoneAfterAgreement,
  });

  return { ok: true };
}
