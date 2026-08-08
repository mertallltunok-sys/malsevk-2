import { isCompanyType } from "./company-type";
import type { PendingRegistrationDraft } from "./pending-registration-draft";

/**
 * SUPABASE AUTH GEÇİŞİ — `pending-registration-draft.ts`in (sessionStorage,
 * yalnızca AYNI SEKME) belgelediği "bilinçli sınırlama"yı kapatan İKİNCİ,
 * sunucu-taraflı bir taşıma yolu: `signUp()` çağrılırken AYNI hassas-olmayan
 * alanlar `options.data` (Supabase `auth.users.raw_user_meta_data`,
 * `user.user_metadata` olarak okunur) üzerinden de gönderilir. Bu veri
 * Supabase'in kendisinde saklanır — tarayıcı sekmesinden/cihazından TAMAMEN
 * BAĞIMSIZDIR, bu yüzden doğrulama linki farklı bir sekmede veya farklı bir
 * cihazda açılsa bile `/kayit-tamamla` (complete-registration-form.tsx) bu
 * alanları ÖN-DOLDURMA için okuyabilir. `readPendingRegistrationDraft()`
 * (sessionStorage) hâlâ ÖNCELİKLİDİR ve BULUNURSA formu hiç göstermeden
 * otomatik tamamlar (aynı sekme, en hızlı yol) — bu modül yalnızca o
 * bulunamadığında devreye giren, GÖZDEN GEÇİRİLMESİ gereken bir ön-doldurma
 * kaynağıdır (kullanıcı "Kaydı Tamamla"ya kendisi basar, otomatik gönderim
 * YAPILMAZ — görev hedefi).
 *
 * GÜVENLİK SINIRI (BİLEREK KORUNUYOR — CLAUDE.md'nin "role Supabase'in
 * `user_metadata`'sına BİLEREK yazılmaz" ilkesiyle AYNI ruh): buradaki `role`
 * alanı SADECE ön-doldurma/görüntüleme amaçlıdır. Hiçbir kod yolu bunu
 * `complete_registration` RPC'sinin `p_role` parametresi olarak DOĞRUDAN
 * kullanmaz — RPC'ye giden gerçek değer HER ZAMAN formun kullanıcı
 * tarafından görülen/onaylanabilir state'inden gelir (complete-registration-
 * form.tsx#handleSubmit, değişmedi); ön-doldurma yalnızca o state'in
 * BAŞLANGIÇ değerini belirler. Şifre/e-posta buraya ASLA yazılmaz —
 * signUp()'ın kendi zorunlu parametreleri (email/password) ayrı taşınır, bu
 * modül onlara hiç dokunmaz/erişmez.
 *
 * Belgeler (`providerDocuments`/`customsLicenseDocument`) KASITLI OLARAK
 * `PendingRegistrationDraft`den çıkarılmıştır (bkz. `Omit` aşağıda):
 * IndexedDB blob referansları GERÇEKTEN farklı bir cihazda/tarayıcıda
 * anlamsızdır (dosyanın kendisi orada yok) ve Supabase `user_metadata`
 * dosya içeriği taşımak için tasarlanmamıştır (küçük anahtar-değer verisi
 * içindir, boyut sınırı vardır). Aynı tarayıcının farklı bir sekmesinde
 * IndexedDB zaten paylaşılır (origin-seviyeli depolama, `sessionStorage`'ın
 * aksine sekmeye özel DEĞİLDİR) — bu yüzden belgeler yalnızca GERÇEKTEN
 * farklı bir cihaz/tarayıcıda kaybolur; o durumda kullanıcı zaten yeniden
 * yüklemesi gereken yedek formu görür (bu görevin kapsamı dışı, hiç
 * değiştirilmedi).
 */
export type RegistrationMetadataFields = Omit<PendingRegistrationDraft, "providerDocuments" | "customsLicenseDocument">;

export function isValidRegistrationMetadata(value: unknown): value is RegistrationMetadataFields {
  if (typeof value !== "object" || value === null) return false;
  const meta = value as Record<string, unknown>;
  return (
    (meta.role === "hizmet-alan" || meta.role === "hizmet-veren") &&
    typeof meta.firstName === "string" &&
    typeof meta.lastName === "string" &&
    typeof meta.phone === "string" &&
    typeof meta.companyName === "string" &&
    isCompanyType(meta.companyType) &&
    typeof meta.province === "string" &&
    typeof meta.district === "string" &&
    Array.isArray(meta.providerServiceCategoryIds) &&
    meta.providerServiceCategoryIds.every((id) => typeof id === "string") &&
    typeof meta.documentDeclarationAccepted === "boolean" &&
    typeof meta.customsLicenseDeclarationAccepted === "boolean" &&
    typeof meta.legalConsentAccepted === "boolean"
  );
}
