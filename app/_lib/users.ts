import { isCompanyType, type CompanyType } from "./company-type";
import { STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { deletePhotoBlob, putPhotoBlob } from "./photo-blob-store";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";
import { validateProviderProfileForm } from "./provider-profile";
import { isExperienceRange, isServiceFeature } from "./service-catalog";
import type { ExperienceRange, ProviderProfile, ServiceFeature, Session, UserRole } from "./types";

const USERS_STORAGE_KEY = "malsevk.users.v1";

/**
 * GÜVENLİK NOTU: Şifreler burada SHA-256 özeti olarak saklanır (düz metin
 * değil), ancak tuzsuz (unsalted) ve tamamen istemci tarafında, gerçek bir
 * kimlik doğrulama sunucusu olmadan çalışır. Bu, yalnızca bu geliştirme
 * ortamı için geçici bir yapıdır — production'da gerçek bir backend,
 * tuzlanmış/adaptif bir hash (ör. bcrypt/argon2) ve sunucu tarafı oturum
 * yönetimi ile değiştirilmelidir.
 */

export type StoredUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  /**
   * Bu alandan önce oluşturulmuş kayıtlarda (eski kullanıcılar, demo
   * hesapların ilk sürümü) hiç yoktur — geriye dönük olarak sahte bir
   * tarih ÜRETİLMEZ, eksikse arayüzde "—" gösterilir (bkz.
   * provider-profile.ts). Yalnızca `registerUser` ile oluşturulan yeni
   * kayıtlarda ve bir sonraki `upsertDevAccount` senkronunda eklenir.
   */
  createdAt?: string;
  /**
   * Kayıt formunda toplanan, her iki rol için de ortak "Firma Adı" alanı.
   * `providerProfile.companyName`'den KASITLI OLARAK AYRIDIR: bu, kayıt
   * anında bir kerelik girilen ham değerdir; `providerProfile` ise yalnızca
   * hizmet-veren'in Hesap Ayarları'ndan sonradan düzenlediği, bio/logo/
   * uzmanlık içeren daha zengin ve tamamen opsiyonel profildir. Bu alandan
   * önce oluşturulmuş kayıtlarda (ör. demo hesaplar) hiç yoktur.
   */
  companyName?: string;
  /** Kayıt formundaki "Kullanıcı Tipi" / "Hizmet Veren Tipi" seçimi (bkz. company-type.ts). Bu alandan önce oluşturulmuş kayıtlarda hiç yoktur. */
  companyType?: CompanyType;
  /** Kayıt formunda seçilen il adı. Bu alandan önce oluşturulmuş kayıtlarda hiç yoktur. */
  province?: string;
  /** Kayıt formunda seçilen ilçe adı. Bu alandan önce oluşturulmuş kayıtlarda hiç yoktur. */
  district?: string;
  /** Yalnızca hizmet-veren kullanıcılarda anlamlıdır; opsiyoneldir (bkz. normalizeStoredUser). */
  providerProfile?: ProviderProfile;
  /**
   * "İletişim Bilgisi Görünürlüğü" (Hesap Ayarları) — bu kullanıcının
   * e-postasının, bir teklif kabul edildikten sonra karşı tarafa gösterilip
   * gösterilmeyeceği (bkz. contact-access.ts, zamanlama kapısı DEĞİŞMEDİ,
   * yalnızca bunun ÜZERİNE eklenen bir tercih katmanı). `undefined` = kullanıcı
   * henüz bir tercih belirlemedi — bu, bu alandan ÖNCEKİ (özelliğin var
   * olmadığı dönemdeki) davranışla AYNI sonucu (görünür) vermek için `true`
   * gibi ele alınır, böylece mevcut kullanıcıların iletişim akışı beklenmedik
   * şekilde bozulmaz. Hem hizmet-alan hem hizmet-veren kullanabilir — role
   * göre kısıtlanmaz. Bu alandan önce oluşturulmuş kayıtlarda hiç yoktur.
   */
  showEmailAfterAgreement?: boolean;
  /** Bkz. showEmailAfterAgreement üstündeki doküman — AYNI kural, telefon numarası için. */
  showPhoneAfterAgreement?: boolean;
};

function isStoredUserCore(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    typeof user.phone === "string" &&
    typeof user.passwordHash === "string" &&
    (user.role === "hizmet-alan" || user.role === "hizmet-veren" || user.role === "admin")
  );
}

function isValidProviderProfile(value: unknown): value is ProviderProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.companyName === "string" &&
    typeof profile.bio === "string" &&
    Array.isArray(profile.regions) &&
    profile.regions.every((region) => typeof region === "string") &&
    Array.isArray(profile.expertise) &&
    profile.expertise.every((item) => typeof item === "string") &&
    (profile.foundedYear === undefined || typeof profile.foundedYear === "number") &&
    (profile.logoStorageKey === undefined || typeof profile.logoStorageKey === "string") &&
    (profile.serviceCategories === undefined ||
      (Array.isArray(profile.serviceCategories) &&
        profile.serviceCategories.every((item) => typeof item === "string"))) &&
    (profile.serviceFeatures === undefined ||
      (Array.isArray(profile.serviceFeatures) && profile.serviceFeatures.every((item) => isServiceFeature(item)))) &&
    (profile.experienceRange === undefined || isExperienceRange(profile.experienceRange)) &&
    (profile.recyclingMaterialSpecialties === undefined ||
      (Array.isArray(profile.recyclingMaterialSpecialties) &&
        profile.recyclingMaterialSpecialties.every((item) => typeof item === "string")))
  );
}

/**
 * `createdAt`/`providerProfile`/`companyName`/`companyType`/`province`/
 * `district`/`showEmailAfterAgreement`/`showPhoneAfterAgreement` bu
 * özelliklerden önce oluşturulmuş kayıtlarda hiç yoktur. Geriye dönük
 * uyumluluk için hepsi opsiyonel kabul edilir ve eksik/bozuksa sessizce
 * `undefined`a normalize edilir — kayıt yine de geçerli sayılır
 * (job-store.ts#normalizeStoredJob'daki "photos" alanıyla aynı desen); tek
 * başına bu alanların eksikliği bir kullanıcı kaydının tamamen
 * kaybolmasına (filtrelenip silinmesine) asla yol açmaz.
 */
function normalizeStoredUser(value: unknown): StoredUser | null {
  if (!isStoredUserCore(value)) return null;
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : undefined;
  const providerProfile = isValidProviderProfile(value.providerProfile) ? value.providerProfile : undefined;
  const companyName = typeof value.companyName === "string" ? value.companyName : undefined;
  const companyType = isCompanyType(value.companyType) ? value.companyType : undefined;
  const province = typeof value.province === "string" ? value.province : undefined;
  const district = typeof value.district === "string" ? value.district : undefined;
  let showEmailAfterAgreement =
    typeof value.showEmailAfterAgreement === "boolean" ? value.showEmailAfterAgreement : undefined;
  let showPhoneAfterAgreement =
    typeof value.showPhoneAfterAgreement === "boolean" ? value.showPhoneAfterAgreement : undefined;
  // Güvenli veri migrasyonu: en az biri her zaman açık kalmalı kuralından
  // ÖNCE yazılmış bir kayıt ikisini de `false` olarak sakladıysa (artık
  // updateContactVisibility bunu asla üretmez, bkz. CONTACT_VISIBILITY_MIN_ONE_MESSAGE),
  // okuma anında her ikisi de `true`ya onarılır — job-store.ts#normalizeStoredJob'daki
  // "bozuk alanı sessizce düzelt" desenin AYNISI, storage'a geri YAZILMAZ,
  // yalnızca her okuyuşta yeniden uygulanır. Kullanıcının başka hiçbir alanına
  // dokunulmaz.
  if (showEmailAfterAgreement === false && showPhoneAfterAgreement === false) {
    showEmailAfterAgreement = true;
    showPhoneAfterAgreement = true;
  }
  return {
    ...(value as Omit<
      StoredUser,
      | "createdAt"
      | "providerProfile"
      | "companyName"
      | "companyType"
      | "province"
      | "district"
      | "showEmailAfterAgreement"
      | "showPhoneAfterAgreement"
    >),
    createdAt,
    providerProfile,
    companyName,
    companyType,
    province,
    district,
    showEmailAfterAgreement,
    showPhoneAfterAgreement,
  };
}

// DÜZELTME (Y3, veritabanı geçişi öncesi denetim): eskiden bu tabloda hiçbir
// modül önbelleği/storage-event dinleyicisi yoktu (job-store.ts/offers.ts/
// ratings.ts/... tablolarının AKSİNE) — bir sekmede profil/iletişim-
// görünürlüğü değişikliği yapıldığında başka açık bir sekme bunu HİÇBİR
// ZAMAN görmüyordu. Aşağıdaki `listeners`/`cachedRaw`/`notify`/`usersStore`
// bloğu, diğer tüm tablolarla BİREBİR aynı deseni uygular (bkz. ratings.ts).
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedUsers: StoredUser[] = [];
let hasCached = false;

function readUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(USERS_STORAGE_KEY);
  } catch {
    raw = null;
  }

  // useSyncExternalStore, getSnapshot'ın değişmediğinde aynı referansı
  // döndürmesini bekler; bu yüzden ham metin değişmediyse önbelleklenmiş
  // dizi döndürülür (session.ts/job-store.ts ile AYNI gerekçe).
  if (hasCached && raw === cachedRaw) return cachedUsers;

  let parsed: StoredUser[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.map(normalizeStoredUser).filter((user): user is StoredUser => user !== null);
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedUsers = parsed;
  hasCached = true;
  return parsed;
}

function writeUsers(users: StoredUser[]): boolean {
  if (!writeJson(USERS_STORAGE_KEY, users)) return false;
  cachedRaw = null;
  hasCached = false;
  notify();
  return true;
}

const EMPTY_USERS: StoredUser[] = [];
function getServerUsersSnapshot(): StoredUser[] {
  return EMPTY_USERS;
}

function subscribeToUsers(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** use-users.ts#useAllUsers/useUserById'ın useSyncExternalStore ile bağlandığı reaktif kaynak. */
export const usersStore = {
  subscribe: subscribeToUsers,
  getSnapshot: readUsers,
  getServerSnapshot: getServerUsersSnapshot,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(email: string): StoredUser | null {
  const normalized = normalizeEmail(email);
  return readUsers().find((user) => user.email === normalized) ?? null;
}

/** `phone` zaten normalize edilmiş (+905XXXXXXXXX) biçimde olmalıdır. */
export function findUserByPhone(phone: string): StoredUser | null {
  return readUsers().find((user) => user.phone === phone) ?? null;
}

export function findUserById(id: string): StoredUser | null {
  return readUsers().find((user) => user.id === id) ?? null;
}

/** Tüm kullanıcıları döndürür — yalnızca sayım/rapor amaçlı araçlar için (bkz. reset-demo-data.ts). */
export function getAllUsers(): StoredUser[] {
  return readUsers();
}

/**
 * Bir kullanıcı kaydını KALICI olarak siler. Genel bir "hesap sil" özelliği
 * DEĞİLDİR — tek çağıranı provider-registration.ts'in kayıt geri alma
 * (rollback) senaryosudur: Hizmet Veren kaydı sırasında hizmet/belge/beyan
 * yazımlarından biri başarısız olursa, az önce oluşturulmuş yarım kullanıcı
 * kaydının kendisi de geri alınır. Kayıt tamamlanmış (gerçek) bir kullanıcı
 * için ASLA çağrılmamalıdır.
 */
export function deleteUserById(userId: string): boolean {
  return writeUsers(readUsers().filter((user) => user.id !== userId));
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type RegisterInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  /** Bkz. StoredUser.companyName — opsiyonel, yalnızca kayıt formu doldurursa gönderilir. */
  companyName?: string;
  companyType?: CompanyType;
  province?: string;
  district?: string;
};

export type RegisterResult =
  | { ok: true; user: StoredUser }
  | { ok: false; error: string };

/**
 * Kayıt iş kuralları arayüzden bağımsız burada da uygulanır (yalnızca
 * arayüz doğrulamasına güvenilmez): e-posta/telefon tekilliği ve şifre
 * gücü burada tekrar kontrol edilir.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(email)) {
    return { ok: false, error: "Bu e-posta adresiyle daha önce hesap oluşturulmuş." };
  }

  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.ok) {
    return { ok: false, error: phoneResult.error };
  }
  if (findUserByPhone(phoneResult.value)) {
    return { ok: false, error: "Bu telefon numarasıyla daha önce hesap oluşturulmuş." };
  }

  if (!isPasswordValid(input.password)) {
    return { ok: false, error: "Şifre güvenlik kurallarını karşılamıyor." };
  }

  const passwordHash = await hashPassword(input.password);
  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email,
    phone: phoneResult.value,
    passwordHash,
    role: input.role,
    createdAt: new Date().toISOString(),
    companyName: input.companyName?.trim() || undefined,
    companyType: input.companyType,
    province: input.province?.trim() || undefined,
    district: input.district?.trim() || undefined,
    // Yeni kayıtta her iki iletişim görünürlüğü de varsayılan olarak açık
    // (bkz. görev tanımı) — `?? true` geriye dönük okuma fallback'iyle zaten
    // aynı sonucu verir, ama burada AÇIKÇA yazılır ki kural niyeti (varsayılan
    // "açık", "henüz tercih yok" değil) veride de görünür olsun.
    showEmailAfterAgreement: true,
    showPhoneAfterAgreement: true,
  };

  if (!writeUsers([...readUsers(), user])) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, user };
}

export type LoginResult =
  | { ok: true; user: StoredUser }
  | { ok: false; error: string };

export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const user = findUserByEmail(email);
  if (!user) {
    return { ok: false, error: "E-posta veya şifre hatalı." };
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    // E-posta bulunamadı ile şifre yanlış aynı mesajı paylaşır; hangi
    // e-postanın kayıtlı olduğunu dışarıya sızdırmamak için kasıtlıdır.
    return { ok: false, error: "E-posta veya şifre hatalı." };
  }

  return { ok: true, user };
}

export type SupabaseUserMirrorInput = {
  /** Supabase Auth'ın gerçek `auth.users.id`si (uuid) — bu fonksiyonun TEK, zorunlu kimlik kaynağıdır, asla üretilmez. */
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  companyName?: string;
  companyType?: CompanyType;
  province?: string;
  district?: string;
  /**
   * İLETİŞİM GİZLİLİĞİ GÖREVİ: opsiyonel — verilmezse davranış DEĞİŞMEZ
   * (`existing?.x ?? true`e düşer, aşağıya bkz.). İki farklı çağıran BUNU
   * FARKLI anlamda doldurur: (1) `hydrate-provider-mirror.ts` kendi
   * SESSION SAHİBİNİN gerçek `profiles.show_*_after_agreement` ham
   * değerini geçirir; (2) `use-hydrate-offer-contacts.ts` KARŞI TARAFIN
   * ham tercihini hiç bilmez — bunun yerine `get_offer_contact`in (0079)
   * o alanı zaten null döndürüp döndürmediğini (yani "bu görüntüleyici bu
   * alanı görebildi mi") geçirir, ki `applyContactVisibility`nin ihtiyaç
   * duyduğu şey tam olarak budur (bkz. o dosyanın kendi dokümanı).
   */
  showEmailAfterAgreement?: boolean;
  showPhoneAfterAgreement?: boolean;
};

/**
 * Hiçbir kod artık bir gerçek şifreyle karşılaştırmaz (`verifyLogin` yeni
 * Supabase Auth akışında hiç çağrılmaz) — `upsertSupabaseUserMirror`ın
 * yazdığı satırlarda bu, yalnızca `StoredUser.passwordHash`ın (zorunlu
 * string) tip sözleşmesini karşılamak için var olan, işlevsiz bir işaretçidir.
 */
export const SUPABASE_MANAGED_PASSWORD_MARKER = "supabase-auth-managed";

/**
 * SUPABASE AUTH GEÇİŞİ: gerçek hesap artık Supabase Auth'ta (signUp +
 * complete_registration RPC'si, bkz. complete-registration.ts) oluşturulduktan
 * SONRA, o hesabın AYNI id'siyle bu localStorage StoredUser dizinine bir
 * "ayna" (mirror) satırı yazar/günceller. `registerUser`den (üstte) KASITLI
 * OLARAK AYRIDIR: o fonksiyon kendi id'sini `crypto.randomUUID()` ile ÜRETİR
 * ve bir şifreyi doğrulayıp hashler (yalnızca artık orphan olan
 * provider-registration.ts tarafından hâlâ çağrılıyor — bkz. "Supabase Auth
 * migration"); bu fonksiyon HİÇBİR şifre almaz
 * (gerçek kimlik doğrulama artık tamamen Supabase Auth'ta) ve id'yi HER ZAMAN
 * dışarıdan alır.
 *
 * Bu, contact-access.ts/ratings.ts/provider profil ekranları/my-offers-panel
 * gibi jobs/offers DIŞINDAKİ (bu görevin kapsamı dışında bırakılan, bkz. görev
 * tanımı) her ekranın `findUserById`/`getAllUsers` üzerinden değişmeden
 * çalışmaya devam etmesini sağlayan TEK mekanizmadır.
 *
 * Idempotenttir: aynı id ile tekrar çağrılırsa (ör. `/kayit-tamamla`
 * formunun ikinci bir denemesi, ya da `complete_registration`in kendisi
 * ML101 ile reddettiği bir tekrar) var olan satırı alanlarıyla GÜNCELLER,
 * asla çoğaltmaz — `providerProfile`/`showEmailAfterAgreement`/
 * `showPhoneAfterAgreement` gibi bu fonksiyonun bilmediği alanlar var olan
 * satırdan olduğu gibi korunur.
 */
export function upsertSupabaseUserMirror(input: SupabaseUserMirrorInput): boolean {
  const phoneResult = normalizePhoneNumber(input.phone);
  const phone = phoneResult.ok ? phoneResult.value : input.phone;

  const existing = findUserById(input.id);
  const mirrored: StoredUser = {
    id: input.id,
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    phone,
    passwordHash: SUPABASE_MANAGED_PASSWORD_MARKER,
    role: input.role,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    companyName: input.companyName?.trim() || undefined,
    companyType: input.companyType,
    province: input.province?.trim() || undefined,
    district: input.district?.trim() || undefined,
    providerProfile: existing?.providerProfile,
    showEmailAfterAgreement: input.showEmailAfterAgreement ?? existing?.showEmailAfterAgreement ?? true,
    showPhoneAfterAgreement: input.showPhoneAfterAgreement ?? existing?.showPhoneAfterAgreement ?? true,
  };

  if (existing) {
    return writeUsers(readUsers().map((user) => (user.id === input.id ? mirrored : user)));
  }
  return writeUsers([...readUsers(), mirrored]);
}

export type HydrateProviderProfileInput = {
  /** Sadece BOŞ bir yerel `providerProfile.companyName` için yedek — bkz. aşağıdaki kullanım notu. */
  companyNameFallback?: string;
  bio?: string;
  foundedYear?: number;
  regions?: string[];
  serviceFeatures?: ServiceFeature[];
  experienceRange?: ExperienceRange;
  logoStorageKey?: string;
};

/**
 * DÜZELTME (uçtan uca doğrulama görevi — "hâlâ yalnızca localStorage/
 * IndexedDB'den okuyan ekranlar"): `upsertSupabaseUserMirror` yalnızca
 * `StoredUser`in TEMEL alanlarını (ad/e-posta/telefon/rol/firma) yazar —
 * `providerProfile` (bio/kuruluş yılı/bölgeler/hizmet özellikleri/deneyim/
 * logo) hiç dokunulmadan `existing?.providerProfile`den (yani bu tarayıcıda
 * daha önce hiç yoksa `undefined`) geçirilir. Gerçek (yeni) bir tarayıcıda
 * giriş yapan bir Hizmet Veren için bu, `ProviderProfileEditor`/
 * `ServiceInfoEditor`in (ikisi de yalnızca `user.providerProfile`den okur)
 * GERÇEKTE dolu olan verisini BOŞ göstermesi demekti — veri kaybı değil,
 * yalnızca yerel aynanın henüz bu tarayıcıda hiç doldurulmamış olması
 * (bkz. app/_lib/hydrate-provider-mirror.ts, bu fonksiyonun TEK çağıranı).
 * Yalnızca GERÇEK uzak veriden (`RemoteProviderProfile`) gelen alanları
 * birleştirir — `companyName`/`expertise` (provider_profiles'ta hiç
 * karşılığı olmayan, bkz. o dosyanın kendi notu) var olan yerel değerini
 * korur, asla sıfırlamaz.
 */
export function hydrateProviderProfileFromRemote(userId: string, fields: HydrateProviderProfileInput): boolean {
  const existing = findUserById(userId);
  if (!existing) return false;

  const merged: ProviderProfile = {
    // DÜZELTME (canlı Supabase testinde bulunan gerçek blokaj): `||` BİLEREK
    // kullanılır (`??` DEĞİL) — `companyName` `validateProviderProfileForm`
    // tarafından ZORUNLU kılındığı için gerçek/kaydedilmiş bir satırda asla
    // meşru şekilde boş string OLAMAZ; bu yüzden boş string de "yok" sayılıp
    // `companyNameFallback`e (StoredUser'ın üst seviye `companyName`si —
    // kayıt formundan, HER ZAMAN güvenilir şekilde hidrate edilir) düşülür.
    // Bu olmadan (yalnızca `??`), bu fonksiyonun kendisinin YAZDIĞI boş
    // string ("" ilk hidrasyonda), sonraki bir `ProviderProfileEditor`
    // kaydında "Firma adı zorunludur" hatasıyla GERÇEKTEN engelliyordu.
    companyName: existing.providerProfile?.companyName || fields.companyNameFallback || "",
    bio: fields.bio ?? existing.providerProfile?.bio ?? "",
    foundedYear: fields.foundedYear ?? existing.providerProfile?.foundedYear,
    regions: fields.regions ?? existing.providerProfile?.regions ?? [],
    expertise: existing.providerProfile?.expertise ?? [],
    serviceFeatures: fields.serviceFeatures ?? existing.providerProfile?.serviceFeatures,
    experienceRange: fields.experienceRange ?? existing.providerProfile?.experienceRange,
    logoStorageKey: fields.logoStorageKey ?? existing.providerProfile?.logoStorageKey,
    // recyclingMaterialSpecialties'in hiçbir uzak (Supabase) karşılığı yok —
    // expertise/companyName ile AYNI gerekçe (bkz. bu fonksiyonun kendi
    // başlığı): var olan yerel değeri olduğu gibi korur.
    recyclingMaterialSpecialties: existing.providerProfile?.recyclingMaterialSpecialties,
  };

  return writeUsers(readUsers().map((user) => (user.id === userId ? { ...user, providerProfile: merged } : user)));
}

/**
 * "Kritik İlan Senkronizasyonu" görevi bölüm 8 — bu dosya (users.ts)
 * localStorage tablosu okuyan/yazan onlarca "use client" bileşen tarafından
 * içe aktarıldığı için client bundle'ına dahil olur. Eskiden burada
 * `DEV_ACCOUNTS` adında, her hesap için ŞİFRESİNİ DÜZ METİN olarak taşıyan bir
 * modül-seviyesi dizi vardı — bu dizi yalnızca (ve bu yorum da dahil hiçbir
 * yerde gerçek şifre değerleri artık tekrar yazılmaz, çünkü kaynak haritaları
 * (`.js.map`) yorum metnini de derlenmiş çıktıya taşır)
 * `seedDevAccountsIfNeeded()` (aşağıda TAMAMEN kaldırıldı; SUPABASE AUTH
 * GEÇİŞİ'nden beri hiçbir çağıranı yoktu, bkz. CLAUDE.md "No real backend")
 * tarafından kullanılıyordu, ama `DEV_ACCOUNT_EMAILS`in (aşağıda, gerçekten
 * kullanılan tek parça — reset-demo-data.ts) `DEV_ACCOUNTS.map(...)` ile ondan
 * türetilmesi, bu şifre dizisinin build zamanında STATİK olarak referans
 * edilmesine ve bu yüzden `NODE_ENV` denetiminden BAĞIMSIZ olarak Production
 * dahil HER derlemede modül kapsamında inşa edilmesine (ve dolayısıyla
 * client bundle'ına gömülmesine) neden oluyordu. Düzeltme: kullanılmayan tüm
 * seed mekanizması (DEV_ACCOUNTS dizisi, upsertDevAccount,
 * seedNakliyeciProviderProfileIfNeeded, seedGumrukMusaviriProviderProfileIfNeeded,
 * seedDevAccountsIfNeeded) SİLİNDİ — hiçbiri artık çağrılmıyordu, "kaldır"
 * seçeneği "yalnızca sunucu tarafında yükle" seçeneğine göre daha az risklidir
 * (ölü kod, korunacak bir davranışı yok). `DEV_ACCOUNT_EMAILS` yalnızca
 * e-postaları (sır DEĞİL) taşıyan, ayrı ve şifresiz bir listeden türetilerek
 * korunur — `reset-demo-data.ts`nin davranışı BİREBİR aynı kalır. Bu 6 hesabın
 * kendisi Development ortamında hâlâ var olabilir (daha önceki bir oturumda
 * elle/farklı bir yoldan oluşturulmuş olabilir) — yalnızca bu dosyanın onları
 * ARTIK OTOMATİK OLARAK OLUŞTURMADIĞI/GÜNCELLEMEDİĞİ değişti. Yerel Demo
 * Hesaplar paneli (`demo-accounts-panel.tsx`, 16 belgesiz demo Hizmet Veren
 * hesabı + Demo İlan Veren) bu değişiklikten ETKİLENMEZ — o TAMAMEN AYRI bir
 * mekanizma, kendi şifresini zaten `NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD`
 * ortam değişkeninden okur, hiçbir zaman burada hardcode edilmemişti.
 */
const DEV_ACCOUNT_EMAIL_LIST: readonly string[] = [
  "zeynep@test.com",
  "mert@test.com",
  "mehmet.demir.demo@malsevk.com",
  "nakliyeci@test.com",
  "gumrukdemo@malsevk.demo",
  "admin@test.com",
];

/**
 * Demo/seed hesaplarının e-posta adresleri — yalnızca demo kullanıcıları
 * e-posta üzerinden kesin olarak tespit etmesi gereken araçlar (bkz.
 * reset-demo-data.ts) için dışa açılır. ŞİFRE TAŞIMAZ (bkz. yukarıdaki not).
 */
export const DEV_ACCOUNT_EMAILS: readonly string[] = DEV_ACCOUNT_EMAIL_LIST.map((email) =>
  email.trim().toLowerCase(),
);

export type UpdateProviderProfileInput = {
  companyName: string;
  bio: string;
  foundedYear: number | null;
  regions: string[];
  /** undefined = logoyu değiştirme, null = mevcut logoyu kaldır, Blob = yeni logo ile değiştir. */
  logo?: Blob | null;
};

export type UpdateProviderProfileResult =
  | { ok: true; profile: ProviderProfile }
  | { ok: false; error: string };

/**
 * Firma profilini günceller — arayüzden bağımsız kurallar (rol kontrolü +
 * provider-profile.ts#validateProviderProfileForm) burada da uygulanır.
 * Logo, ilan fotoğraflarıyla aynı IndexedDB blob deposunu (photo-blob-store.ts)
 * paylaşır: yalnızca tek bir anahtar (`logoStorageKey`) StoredUser'da tutulur,
 * asıl dosya kullanıcı kaydının dışında durur. Kayıt önce (yeni logo varsa)
 * yazılır, eski logo blob'u ancak yeni kayıt/silme başarılı olursa temizlenir
 * — job-store.ts#updateJob'daki "önce yaz, sonra eskiyi sil" sırasıyla aynı
 * mantık, arada bir hata olsa bile kullanıcı eski logosuna erişebilsin diye.
 */
export async function updateProviderProfile(
  session: Session | null,
  input: UpdateProviderProfileInput,
): Promise<UpdateProviderProfileResult> {
  if (!session) {
    return { ok: false, error: "Profilinizi güncellemek için giriş yapmalısınız." };
  }

  const existing = findUserById(session.id);
  if (!existing) {
    return { ok: false, error: "Kullanıcı bulunamadı." };
  }
  // DÜZELTME (Y2, veritabanı geçişi öncesi denetim): eskiden `session.role`
  // (tarayıcı localStorage'ında sahtelenebilir) kontrol ediliyordu — bir
  // hizmet-alan kendi `session.role`ünü tarayıcıda elle "hizmet-veren" yapıp
  // gerçek hesabı hâlâ hizmet-alan olduğu hâlde bu fonksiyonu çağırabiliyordu.
  // Artık gerçek kayıttan (`existing`, yukarıda zaten okundu) doğrulanıyor.
  if (existing.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar firma profili düzenleyebilir." };
  }

  const errors = validateProviderProfileForm(input);
  const firstError = Object.values(errors)[0];
  if (firstError) {
    return { ok: false, error: firstError };
  }

  const previousLogoStorageKey = existing.providerProfile?.logoStorageKey;
  let logoStorageKey = previousLogoStorageKey;
  let newlyPersistedLogoKey: string | undefined;

  if (input.logo === null) {
    logoStorageKey = undefined;
  } else if (input.logo instanceof Blob) {
    const newKey = crypto.randomUUID();
    try {
      await putPhotoBlob(newKey, input.logo);
    } catch {
      return { ok: false, error: "Logo kaydedilemedi. Lütfen tekrar deneyin." };
    }
    logoStorageKey = newKey;
    newlyPersistedLogoKey = newKey;
  }

  const profile: ProviderProfile = {
    companyName: input.companyName.trim(),
    bio: input.bio.trim(),
    foundedYear: input.foundedYear ?? undefined,
    regions: input.regions,
    // DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi): bu form
    // artık "Uzmanlık Alanları"nı hiç düzenlemez (görevin kendi kuralı:
    // "Hizmet Veren kendi profilinden hizmet veya uzmanlık alanı
    // seçemez") — var olan `expertise` değeri olduğu gibi taşınır, asla
    // boş diziyle EZİLMEZ. Alan tamamen SİLİNMEDİ (eski veriler hâlâ
    // `service-catalog.ts#migrateLegacyExpertiseToServiceCategoryIds`
    // tarafından okunabilir kalsın diye) — yalnızca bu formdan artık
    // yazılabilir değil.
    expertise: existing.providerProfile?.expertise ?? [],
    logoStorageKey,
    // Bu form (Hesap Ayarları > Firma Profili) serviceFeatures/
    // experienceRange'i hiç düzenlemez (bkz. Panel > Profilim > Hizmet
    // Bilgilerim, updateProviderServiceInfo aşağıda) — var olan değerleri
    // olduğu gibi taşımazsak bu form kaydedildiğinde diğer ekranda girilmiş
    // veriler sessizce silinmiş olurdu. Hizmet seçimleri artık
    // provider-services.ts'te tutulur, bu profil nesnesinde hiç yoktur.
    serviceFeatures: existing.providerProfile?.serviceFeatures,
    experienceRange: existing.providerProfile?.experienceRange,
    // Bkz. serviceFeatures/experienceRange üstündeki AYNI gerekçe — bu form
    // recyclingMaterialSpecialties'i de hiç düzenlemez (bkz. Panel >
    // Profilim > Hizmet Bilgilerim, updateProviderServiceInfo aşağıda).
    recyclingMaterialSpecialties: existing.providerProfile?.recyclingMaterialSpecialties,
  };

  const updated: StoredUser = { ...existing, providerProfile: profile };
  if (!writeUsers(readUsers().map((user) => (user.id === existing.id ? updated : user)))) {
    // Kayıt yazılamadıysa, bu çağrıda yeni yüklenmiş logo blob'u hiçbir
    // kullanıcı kaydına bağlanmadan sahipsiz kalmasın diye geri alınır —
    // job-store.ts#persistPhotosOrRollback ile aynı gerekçe.
    if (newlyPersistedLogoKey) {
      await deletePhotoBlob(newlyPersistedLogoKey);
    }
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  if (previousLogoStorageKey && previousLogoStorageKey !== logoStorageKey) {
    await deletePhotoBlob(previousLogoStorageKey);
  }

  return { ok: true, profile };
}

export type UpdateContactVisibilityInput = {
  showEmailAfterAgreement: boolean;
  showPhoneAfterAgreement: boolean;
};

export type UpdateContactVisibilityResult = { ok: true } | { ok: false; error: string };

/**
 * Telefon/e-posta görünürlüğünden EN AZ birinin her zaman açık kalması
 * gereken kuralın TEK, paylaşılan uyarı metni — hem arayüz
 * (contact-visibility-settings.tsx, ikinci seçeneği de kapatmaya
 * çalışırken) hem `supabase-contact-visibility.ts#updateMyContactVisibilityRemote`
 * (arayüze güvenmeyen, atlanamaz asıl doğrulama) AYNI metni gösterir,
 * hiçbiri kendi versiyonunu icat etmez.
 *
 * İLETİŞİM GİZLİLİĞİ GÖREVİ: bu tercihin YAZMA yolu artık burada değil —
 * `basic-profile-editor.tsx`/`updateMyProfileRemote` ile AYNI gerekçeyle
 * (asıl kaynak Supabase olmalı, localStorage yalnızca en-iyi-çaba bir ayna)
 * `supabase-contact-visibility.ts#updateMyContactVisibilityRemote`e
 * taşındı — o modül GERÇEK `profiles.show_email_after_agreement`/
 * `show_phone_after_agreement` sütunlarına yazar, sonra bu tarayıcının
 * `StoredUser` aynasını en-iyi-çaba günceller. Eski, yalnızca-localStorage
 * yazan `updateContactVisibility` fonksiyonu KALDIRILDI (ikinci bir yazma
 * yolu icat etmemek için, bkz. görev tanımı "aynı işi yapan ikinci bir
 * sistem kurma").
 */
export const CONTACT_VISIBILITY_MIN_ONE_MESSAGE =
  "Teklif kabul edildiğinde iletişim kurulabilmesi için telefon veya e-posta bilgilerinden en az biri görünür olmalıdır.";

export type UpdateProviderServiceInfoInput = {
  regions: string[];
  experienceRange: ExperienceRange | null;
};

export type UpdateProviderServiceInfoResult =
  | { ok: true; profile: ProviderProfile }
  | { ok: false; error: string };

/**
 * "Hizmet Bilgilerim" (Panel > Profilim) formunu kaydeder —
 * `updateProviderProfile`den (Hesap Ayarları > Firma Profili) KASITLI
 * OLARAK AYRI bir fonksiyondur: o form companyName/bio'yu ZORUNLU kılar
 * (bkz. provider-profile.ts#validateProviderProfileForm, 50-500 karakter
 * bio), ama "Hizmet Bilgilerim" bir tamamlama akışıdır — kullanıcı Firma
 * Profili'ni hiç doldurmamış olsa bile yalnızca bölge/deneyim bilgisini
 * kaydedebilmelidir. Bu yüzden companyName/bio/foundedYear/logoStorageKey/
 * expertise (bu formun sahibi olmadığı alanlar) var olan profilden olduğu
 * gibi taşınır, hiç doğrulanmaz/değiştirilmez; profil daha önce hiç
 * oluşturulmamışsa boş companyName/bio ile başlar (ekranlar bunu zaten
 * "Belirtilmemiş" gibi gösterip sahte veri üretmeden ele alır, bkz.
 * incoming-offer-card.tsx). `regions` de bilerek burada düzenlenebilir —
 * Hesap Ayarları'ndaki aynı alanla aynı veriyi paylaşır, iki farklı
 * ekrandan aynı tek doğruluk kaynağına yazılır.
 *
 * DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi): bu form
 * artık `serviceCategories`/`serviceFeatures`/`recyclingMaterialSpecialties`
 * hiçbirini KABUL ETMİYOR/YAZMIYOR — "Hizmet Veren kendi profilinden
 * hizmet veya uzmanlık alanı seçemez" kuralı gereği. Önemli: bu, eskiden
 * burada yapılan `setProviderServiceCategoryIds` çağrısının TAMAMEN
 * KALDIRILDIĞI anlamına gelir — provider-services.ts tablosu (hâlâ
 * `/panel/belge-yukleme`nin gerçek yazım yolu, admin yetkilendirme
 * akışının veri kaynağı) bu fonksiyondan asla dokunulmaz/sıfırlanmaz.
 * `serviceFeatures`/`recyclingMaterialSpecialties` de aynı şekilde var
 * olan değerinden değişmeden taşınır (expertise'in zaten yaptığı gibi) —
 * hiçbiri boş diziyle EZİLMEZ.
 */
export async function updateProviderServiceInfo(
  session: Session | null,
  input: UpdateProviderServiceInfoInput,
): Promise<UpdateProviderServiceInfoResult> {
  if (!session) {
    return { ok: false, error: "Hizmet bilgilerinizi güncellemek için giriş yapmalısınız." };
  }

  const existing = findUserById(session.id);
  if (!existing) {
    return { ok: false, error: "Kullanıcı bulunamadı." };
  }
  // DÜZELTME (Y2, veritabanı geçişi öncesi denetim) — updateProviderProfile
  // ile AYNI gerekçe: session.role yerine gerçek kayıttan (existing) doğrulanır.
  if (existing.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar hizmet bilgilerini düzenleyebilir." };
  }

  const currentProfile = existing.providerProfile;
  const profile: ProviderProfile = {
    companyName: currentProfile?.companyName ?? "",
    bio: currentProfile?.bio ?? "",
    foundedYear: currentProfile?.foundedYear,
    logoStorageKey: currentProfile?.logoStorageKey,
    expertise: currentProfile?.expertise ?? [],
    regions: input.regions,
    serviceFeatures: currentProfile?.serviceFeatures,
    experienceRange: input.experienceRange ?? undefined,
    recyclingMaterialSpecialties: currentProfile?.recyclingMaterialSpecialties,
  };

  const updated: StoredUser = { ...existing, providerProfile: profile };
  if (!writeUsers(readUsers().map((user) => (user.id === existing.id ? updated : user)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, profile };
}
