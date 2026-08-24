import { isCompanyType } from "./company-type";
import { hydrateLocalUserMirrorIfMissing } from "./hydrate-provider-mirror";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Session, UserRole } from "./types";

/**
 * SUPABASE AUTH GEÇİŞİ: bu dosya artık `localStorage["malsevk.session.v1"]`
 * DEĞİL, gerçek Supabase Auth oturumunu (+ `profiles.role`/`full_name`/
 * `account_status`) tek doğruluk kaynağı olarak kullanır. Dışa aktarılan
 * sözleşme (`Session`, `useSession()`'ın dayandığı `sessionStore`,
 * `getSession()`) BİLEREK DEĞİŞMEDİ — `useSession()`i çağıran 20+ bileşenin
 * hiçbiri bu geçişle değişmedi (bkz. görev kapsamı: "yalnızca Auth ve
 * kullanıcı oturumu entegrasyonu").
 *
 * `setSession()`/`clearSession()` (eski imperatif yazma API'si) KALDIRILDI —
 * artık gerçek giriş/çıkış `supabase.auth.signInWithPassword`/`signOut`
 * üzerinden olur (bkz. login-form.tsx/profile-menu.tsx) ve bu modül
 * `onAuthStateChange` ile OTOMATİK olarak senkronlanır; elle bir "oturumu
 * yaz" çağrısına artık hiçbir zaman gerek yoktur/olmamalıdır.
 *
 * `profiles.role` NULL ise (Supabase hesabı var ama kayıt formu — bkz.
 * complete_registration RPC'si — henüz tamamlanmamış) `useSession()`
 * KASITLI OLARAK `null` döner: `Session.role` tipi (`types.ts`) hâlâ
 * zorunlu/non-nullable'dır ve 20+ mevcut çağıran zaten "oturum yoksa giriş
 * ekranına yönlendir" desenini kullanıyor — bu, tamamlanmamış bir kaydı da
 * doğru şekilde ele alır (rol gerektiren hiçbir ekran açılamaz). Kayıt
 * tamamlama akışının kendisi (`app/kayit-tamamla`) bu paylaşılan önbelleğe
 * değil, doğrudan kendi Supabase sorgusuna bakar (bkz. o sayfa).
 *
 * `account_status !== 'active'` durumunda da AYNI şekilde `null` döner —
 * ÖNEMLİ SINIR: bu yalnızca istemci tarafı, en iyi çaba bir kapıdır. Faz
 * 1'in hiçbir RLS politikası/RPC'si `account_status`u okuyup gerçekten
 * engellemiyor (bkz. docs/database/schema-reference.md "Açık Kararlar" #6) —
 * askıya alınmış bir kullanıcının JWT'si teknik olarak hâlâ geçerlidir ve
 * doğrudan bir RPC çağrısı bu istemci taraflı kontrolü atlayabilir. Gerçek
 * bir sunucu tarafı sınır, ileride bu bayrağı okuyan RLS/RPC değişiklikleri
 * gerektirir (bu görevin kapsamı dışı — bkz. görev tanımı "KESİNLİKLE YAPMA:
 * Yeni migration oluşturma").
 */

type ProfileSnapshot = {
  role: UserRole | null;
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  company_type: string | null;
  province: string | null;
  district: string | null;
  account_status: string | null;
  onboarding_completed: boolean | null;
  show_email_after_agreement: boolean | null;
  show_phone_after_agreement: boolean | null;
};

/**
 * PROFİL/PROVIDER GEÇİŞİ (bu görev): `Session`in yanına, `profiles` satırının
 * TAMAMINI (+ Supabase Auth'ın kendi `email`i — `profiles`de hiç yok, bkz.
 * 0003'ün "Maps StoredUser minus passwordHash/email" yorumu) taşıyan AYRI,
 * genişletilmiş bir önbellek. `Session` tipi (types.ts, 20+ mevcut çağıran)
 * BİLEREK dokunulmadı — bu, yalnızca "kendi profilimi görüntüle" ekranlarının
 * (profile-page-content.tsx/account-settings-content.tsx) kullandığı YENİ,
 * isteğe bağlı bir zenginleştirme katmanıdır. `account_status !== 'active'`
 * durumunda bile (Session `null` olsa da) bu önbellek doldurulur — "hesabınız
 * askıya alınmış" gibi anlaşılır bir mesaj gösterebilmek için gerçek veriye
 * ihtiyaç var, yalnızca sessizce "giriş yapmamışsın gibi" davranmak yeterli
 * değil.
 */
export type SessionProfileDetails = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  companyName: string | null;
  companyType: string | null;
  province: string | null;
  district: string | null;
  role: UserRole | null;
  accountStatus: string;
  onboardingCompleted: boolean;
  /** İLETİŞİM GİZLİLİĞİ GÖREVİ — bkz. profiles.show_email_after_agreement/show_phone_after_agreement (migration 0079). Hesap Ayarları'ndaki "İletişim Bilgisi Görünürlüğü" kartının GERÇEK, cihazlar arası tutarlı başlangıç değeridir (localStorage aynası DEĞİL). */
  showEmailAfterAgreement: boolean;
  showPhoneAfterAgreement: boolean;
};

const listeners = new Set<() => void>();
const profileDetailsListeners = new Set<() => void>();
let cachedSession: Session | null = null;
let cachedProfileDetails: SessionProfileDetails | null = null;
let initialized = false;
let browserClient: ReturnType<typeof createSupabaseBrowserClient> | null = null;

function getBrowserClient() {
  if (!browserClient) browserClient = createSupabaseBrowserClient();
  return browserClient;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function notifyProfileDetails(): void {
  for (const listener of profileDetailsListeners) listener();
}

/** Yalnızca içerik gerçekten değiştiyse yeni referans üretir — useSyncExternalStore'un gereksiz re-render'ını önler. */
function setCachedSession(next: Session | null): void {
  const changed =
    (cachedSession === null) !== (next === null) ||
    (cachedSession !== null &&
      next !== null &&
      (cachedSession.id !== next.id || cachedSession.name !== next.name || cachedSession.role !== next.role));
  if (!changed) return;
  cachedSession = next;
  notify();
}

function setCachedProfileDetails(next: SessionProfileDetails | null): void {
  const changed = JSON.stringify(cachedProfileDetails) !== JSON.stringify(next);
  if (!changed) return;
  cachedProfileDetails = next;
  notifyProfileDetails();
}

async function refreshSessionCache(): Promise<void> {
  const supabase = getBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    setCachedSession(null);
    setCachedProfileDetails(null);
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "role, full_name, phone, company_name, company_type, province, district, account_status, onboarding_completed, show_email_after_agreement, show_phone_after_agreement",
    )
    .eq("id", user.id)
    .maybeSingle<ProfileSnapshot>();

  if (!profile) {
    setCachedSession(null);
    setCachedProfileDetails(null);
    return;
  }

  setCachedProfileDetails({
    id: user.id,
    email: user.email ?? "",
    fullName: profile.full_name ?? "",
    phone: profile.phone,
    companyName: profile.company_name,
    companyType: profile.company_type,
    province: profile.province,
    district: profile.district,
    role: profile.role,
    accountStatus: profile.account_status ?? "active",
    onboardingCompleted: profile.onboarding_completed ?? false,
    showEmailAfterAgreement: profile.show_email_after_agreement ?? true,
    showPhoneAfterAgreement: profile.show_phone_after_agreement ?? true,
  });

  if (!profile.role || profile.account_status !== "active") {
    setCachedSession(null);
    return;
  }

  setCachedSession({ id: user.id, name: profile.full_name ?? "", role: profile.role });

  // DÜZELTME (uçtan uca doğrulama görevi): bu tarayıcı bu kullanıcıyı daha
  // önce hiç görmediyse (ör. gizli sekme/farklı cihazdan giriş — normal bir
  // girişte `upsertSupabaseUserMirror` yalnızca KAYIT sırasında çağrılır),
  // `findUserById`e bağımlı ekranlar (ProviderProfileEditor/ServiceInfoEditor/
  // ContactVisibilitySettings) `user`in `null` olması nedeniyle hiç render
  // edilmezdi. `hydrateLocalUserMirrorIfMissing` kendi içinde zaten "var mı"
  // kontrolü yapar (var olan bir yerel kayda ASLA dokunmaz) — bkz. o
  // dosyanın kendi dokümantasyonu. Fire-and-forget: oturumun kendisi zaten
  // yukarıda GERÇEK profile verisinden kuruldu, bu yalnızca localStorage
  // aynasını arkaplanda tamamlar.
  hydrateLocalUserMirrorIfMissing({
    id: user.id,
    name: profile.full_name ?? "",
    email: user.email ?? "",
    phone: profile.phone ?? "",
    role: profile.role,
    companyName: profile.company_name ?? undefined,
    companyType: isCompanyType(profile.company_type) ? profile.company_type : undefined,
    province: profile.province ?? undefined,
    district: profile.district ?? undefined,
    showEmailAfterAgreement: profile.show_email_after_agreement ?? true,
    showPhoneAfterAgreement: profile.show_phone_after_agreement ?? true,
  });
}

/**
 * Bir mutasyon (ör. `complete_registration`, `set_provider_service_categories`
 * RPC'leri) sonrası önbelleği HEMEN yeniler — `onAuthStateChange` yalnızca
 * gerçek Auth olaylarında (giriş/çıkış/token yenileme) tetiklenir, salt veri
 * değişikliklerinde DEĞİL; bu fonksiyon olmadan kullanıcı, kaydettiği
 * değişikliği görmek için sayfa yenilemek zorunda kalırdı.
 */
export async function refreshSession(): Promise<void> {
  await refreshSessionCache();
}

/**
 * DÜZELTME (Supabase Auth geçişi, bir kerelik temizlik): bu geçişten önceki
 * tarayıcılarda hâlâ `malsevk.session.v1` yazılı olabilir — artık hiçbir
 * kod bunu okumuyor, ama karışıklığı önlemek için (ör. devtools'ta incelenen
 * eski/yanıltıcı bir değer) fırsat bulunduğunda sessizce silinir. Diğer HİÇBİR
 * localStorage anahtarına (jobs/offers/notifications/users/...) dokunulmaz.
 */
function clearLegacySessionKey(): void {
  try {
    window.localStorage.removeItem("malsevk.session.v1");
  } catch {
    // Yalnızca en iyi çaba temizlik — başarısız olursa sessizce yok sayılır.
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  clearLegacySessionKey();

  const supabase = getBrowserClient();
  supabase.auth.onAuthStateChange(() => {
    void refreshSessionCache();
  });
  void refreshSessionCache();
}

function readSessionSnapshot(): Session | null {
  ensureInitialized();
  return cachedSession;
}

function getServerSessionSnapshot(): Session | null {
  return null;
}

function subscribeToSession(onStoreChange: () => void): () => void {
  ensureInitialized();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getSession(): Session | null {
  return readSessionSnapshot();
}

export const sessionStore = {
  subscribe: subscribeToSession,
  getSnapshot: readSessionSnapshot,
  getServerSnapshot: getServerSessionSnapshot,
};

function readProfileDetailsSnapshot(): SessionProfileDetails | null {
  ensureInitialized();
  return cachedProfileDetails;
}

function getServerProfileDetailsSnapshot(): SessionProfileDetails | null {
  return null;
}

function subscribeToProfileDetails(onStoreChange: () => void): () => void {
  ensureInitialized();
  profileDetailsListeners.add(onStoreChange);
  return () => {
    profileDetailsListeners.delete(onStoreChange);
  };
}

/** use-session-profile.ts#useSessionProfileDetails'in bağlandığı store — `sessionStore` ile AYNI sözleşme, ayrı bir kanal. */
export const sessionProfileDetailsStore = {
  subscribe: subscribeToProfileDetails,
  getSnapshot: readProfileDetailsSnapshot,
  getServerSnapshot: getServerProfileDetailsSnapshot,
};
