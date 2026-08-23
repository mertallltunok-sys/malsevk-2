import { putPhotoBlob } from "./photo-blob-store";
import { setProviderServiceCategoryIds } from "./provider-services";
import { getMyProviderLogoUrlRemote } from "./supabase-provider-logo";
import { getMyProviderProfileRemote } from "./supabase-provider-profile";
import { getMyProviderServiceCategoryIdsRemote } from "./supabase-provider-services";
import { findUserById, hydrateProviderProfileFromRemote, upsertSupabaseUserMirror, type SupabaseUserMirrorInput } from "./users";

/**
 * DÜZELTME (uçtan uca doğrulama görevi): gerçek bir tarayıcı oturumunda
 * (ör. gizli sekme, farklı bir cihaz) ilk kez `refreshSessionCache`
 * (session.ts) çalıştığında, bu kullanıcının BU TARAYICIDA hiç yerel
 * `StoredUser` aynası yoksa (`findUserById` `null` döner — normal bir
 * girişte `upsertSupabaseUserMirror` yalnızca KAYIT sırasında çağrılır,
 * sıradan bir sonraki girişte DEĞİL), tek yönlü olarak gerçek Supabase
 * verisinden (profiles + provider_profiles + provider_services + Storage
 * logo) yerel aynayı DOLDURUR. Var olan bir yerel kayıt varsa (bu tarayıcı
 * bu kullanıcıyı zaten tanıyor) BU FONKSİYON HİÇ ÇAĞRILMAZ (bkz.
 * `hydrateLocalUserMirrorIfMissing`) — kullanıcının bu tarayıcıda yaptığı
 * (ör. remote yazımı başarısız olmuş) hiçbir yerel veri asla ezilmez.
 *
 * Not: hidrasyon TAMAMEN bitene kadar (aşağıdaki fonksiyonun kendi "önemli
 * sıralama" notuna bkz.) yerel `StoredUser` satırı hiç yazılmaz — bu yüzden
 * `user`e bağımlı bileşenler `null`dan doğrudan "tam dolu" durumuna geçer,
 * asla "var ama eksik" bir ara duruma değil.
 *
 * Bu, "İlan sistemini Supabase'e taşıma" kapsamının DIŞINDADIR — yalnızca
 * `providerProfile`/`provider-services.ts`nin KENDİSİ zaten `job-store.ts`/
 * `offers.ts` tarafından okunan localStorage kayıtları olduğu için, bu
 * ekranların (Firma Profili, Hizmet Bilgilerim, admin'in Gelen Teklifler'de
 * gördüğü sağlayıcı bilgisi vb.) yeni bir tarayıcıda BOŞ görünmesini önler.
 */
export function hydrateLocalUserMirrorIfMissing(input: SupabaseUserMirrorInput): void {
  if (typeof window === "undefined") return;
  if (findUserById(input.id)) return;
  void hydrateLocalUserMirrorFromRemote(input);
}

async function hydrateLocalUserMirrorFromRemote(input: SupabaseUserMirrorInput): Promise<void> {
  if (input.role !== "hizmet-veren") {
    // Hizmet Alan'da providerProfile/provider-services kavramı hiç yok —
    // tek satır yeter, aşağıdaki ek sorgulara hiç gerek yok.
    upsertSupabaseUserMirror(input);
    return;
  }

  // ÖNEMLİ SIRALAMA: TÜM uzak okumalar (provider_profiles/provider_services/
  // logo) TAMAMLANANA kadar yerel `StoredUser` satırı HİÇ yazılmaz. Sebep:
  // `ServiceInfoEditor`/`ProviderProfileEditor`in `useState(existing?.x ?? ...)`
  // başlangıç değerleri yalnızca İLK mount'ta okunur — `findUserById` önce
  // "var ama providerProfile boş" durumuna, SONRA (bir ekran güncellemesi
  // arayla) "dolu" durumuna geçseydi ve bu iki geçiş arasında bileşen zaten
  // mount olmuşsa, boş başlangıç değerinde SIKIŞIP kalırdı (prop değişimi
  // useState'i yeniden başlatmaz). Aşağıdaki tüm yerel yazımlar (mirror +
  // providerProfile + provider-services) senkron olarak ARDIŞIK çalışır
  // (aralarında `await` YOK) — React 19'un otomatik toplu güncellemesi
  // (automatic batching) bunları TEK bir render'a indirger, bu yüzden `user`
  // hiçbir zaman "var ama eksik" ara durumunda GÖRÜNMEZ.
  const [profile, categoryIds, logoUrl] = await Promise.all([
    getMyProviderProfileRemote(),
    getMyProviderServiceCategoryIdsRemote(),
    getMyProviderLogoUrlRemote(),
  ]);

  let logoStorageKey: string | undefined;
  if (logoUrl) {
    try {
      const response = await fetch(logoUrl);
      if (response.ok) {
        const blob = await response.blob();
        const newKey = crypto.randomUUID();
        await putPhotoBlob(newKey, blob);
        logoStorageKey = newKey;
      }
    } catch {
      // En iyi çaba — logo indirilemezse hydration'ın geri kalanı yine de işe yarar.
    }
  }

  upsertSupabaseUserMirror(input);
  if (profile || logoStorageKey) {
    hydrateProviderProfileFromRemote(input.id, {
      // provider_profiles'ta `company_name` sütunu hiç yok — bu yüzden
      // ProviderProfileEditor'ın "Firma Adı" alanı için tek gerçek yedek,
      // kayıt formunda zaten girilmiş olan ÜST seviye `profiles.company_name`
      // (bkz. users.ts#hydrateProviderProfileFromRemote'un kendi notu).
      companyNameFallback: input.companyName,
      bio: profile?.bio ?? undefined,
      foundedYear: profile?.foundedYear ?? undefined,
      regions: profile?.regions ?? undefined,
      serviceFeatures: profile?.serviceFeatures ?? undefined,
      experienceRange: profile?.experienceRange ?? undefined,
      logoStorageKey,
    });
  }
  if (categoryIds.length > 0) {
    setProviderServiceCategoryIds(input.id, categoryIds);
  }
}
