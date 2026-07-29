import { isCompanyType, type CompanyType } from "./company-type";
import { readJson, STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { deletePhotoBlob, putPhotoBlob } from "./photo-blob-store";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";
import { recordProviderDocumentConsent, hasAcceptedProviderDocumentDeclaration } from "./provider-document-consents";
import { addProviderDocuments, getProviderDocumentsForUser, updateProviderDocumentReviewFields } from "./provider-documents";
import { getProviderServiceCategoryIds, setProviderServiceCategoryIds } from "./provider-services";
import { validateProviderProfileForm } from "./provider-profile";
import { NAKLIYE_SERVICE_CATEGORY_ID, isExperienceRange, isServiceFeature } from "./service-catalog";
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
    (profile.experienceRange === undefined || isExperienceRange(profile.experienceRange))
  );
}

/**
 * `createdAt`/`providerProfile`/`companyName`/`companyType`/`province`/
 * `district` bu özelliklerden önce oluşturulmuş kayıtlarda hiç yoktur.
 * Geriye dönük uyumluluk için hepsi opsiyonel kabul edilir ve eksik/bozuksa
 * sessizce `undefined`a normalize edilir — kayıt yine de geçerli sayılır
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
  return {
    ...(value as Omit<
      StoredUser,
      "createdAt" | "providerProfile" | "companyName" | "companyType" | "province" | "district"
    >),
    createdAt,
    providerProfile,
    companyName,
    companyType,
    province,
    district,
  };
}

function readUsers(): StoredUser[] {
  const raw = readJson<unknown[]>(USERS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeStoredUser).filter((user): user is StoredUser => user !== null);
}

function writeUsers(users: StoredUser[]): boolean {
  return writeJson(USERS_STORAGE_KEY, users);
}

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

const DEV_ACCOUNTS: RegisterInput[] = [
  {
    name: "Zeynep",
    email: "zeynep@test.com",
    phone: "+905551111111",
    password: "Zeynep1!",
    role: "hizmet-alan",
  },
  {
    name: "Mert",
    email: "mert@test.com",
    phone: "+905552222222",
    password: "Mert123!",
    role: "hizmet-veren",
  },
  {
    name: "Mehmet Demir",
    email: "mehmet.demir.demo@malsevk.com",
    phone: "+905553334455",
    password: "Demo123!",
    role: "hizmet-veren",
  },
  {
    // Nakliye izolasyon kuralını (bkz. job-visibility.ts) elle veri
    // hazırlamadan test edebilmek için — bu hesabın hizmet seçimi
    // (yalnızca Nakliye), belgesi ve beyanı `seedNakliyeciProviderProfileIfNeeded`
    // tarafından, bu döngü tamamlandıktan SONRA ayrıca kurulur (bkz. aşağıda);
    // burada yalnızca temel StoredUser alanları (login-form.tsx'teki gerçek
    // Hizmet Veren kaydıyla aynı şekle sahip: firma adı/tipi/il/ilçe) yer alır.
    // "Ad: Nakliye, Soyad: Demo" — registerUser'ın `name` alanını nasıl
    // ürettiğiyle (Ad+Soyad birleşimi) AYNI şekle uysun diye tek bir alanda
    // birleştirilmiştir; StoredUser.name zaten yalnızca birleşik adı tutar,
    // ayrı ad/soyad alanı yok (bkz. RegisterInput.name).
    name: "Nakliye Demo",
    email: "nakliyeci@test.com",
    phone: "+905556667788",
    password: "Nakliye123!",
    role: "hizmet-veren",
    companyName: "MALSEVK Nakliye Demo",
    companyType: "limited-sirket",
    province: "Kocaeli",
    district: "Gebze",
  },
  {
    // Yalnızca app/admin (Hizmet Veren Belge Kontrolü) panelini test etmek için —
    // kayıt formunda "admin" hiçbir zaman bir Hesap Türü seçeneği olarak sunulmaz
    // (bkz. types.ts#UserRole), bu rolün TEK oluşturulma yolu bu dev-seed'dir.
    name: "Admin Kullanıcı",
    email: "admin@test.com",
    phone: "+905554445566",
    password: "Admin123!",
    role: "admin",
  },
];

/**
 * Demo/seed hesaplarının e-posta adresleri — tek doğruluk kaynağı
 * DEV_ACCOUNTS'tur, burada tahmin edilmez/tekrar yazılmaz. Yalnızca demo
 * kullanıcıları e-posta üzerinden kesin olarak tespit etmesi gereken
 * araçlar (bkz. reset-demo-data.ts) için dışa açılır.
 */
export const DEV_ACCOUNT_EMAILS: readonly string[] = DEV_ACCOUNTS.map((account) =>
  account.email.trim().toLowerCase(),
);

/**
 * Var olan bir dev hesabını (id'sini koruyarak — ilan/teklif ilişkileri
 * bozulmasın diye) güncel ad/telefon/şifre/rol ile senkronlar; yoksa
 * oluşturur. Eski "123" şifreli kayıtlar bu şekilde güvenli biçimde
 * güncellenir, yinelenmez.
 */
async function upsertDevAccount(account: RegisterInput): Promise<void> {
  const phoneResult = normalizePhoneNumber(account.phone);
  if (!phoneResult.ok) return;

  const passwordHash = await hashPassword(account.password);
  const existing = findUserByEmail(account.email);

  if (existing) {
    const alreadyUpToDate =
      existing.name === account.name &&
      existing.phone === phoneResult.value &&
      existing.passwordHash === passwordHash &&
      existing.role === account.role &&
      existing.companyName === account.companyName &&
      existing.companyType === account.companyType &&
      existing.province === account.province &&
      existing.district === account.district &&
      typeof existing.createdAt === "string";
    if (alreadyUpToDate) return;

    const updated: StoredUser = {
      ...existing,
      name: account.name,
      phone: phoneResult.value,
      passwordHash,
      role: account.role,
      // companyName/companyType/province/district önceki DEV_ACCOUNTS
      // girdilerinde hiç kullanılmıyordu (hepsi undefined), Nakliyeci
      // hesabıyla birlikte ilk kez gerçek değerler taşıyorlar — RegisterInput
      // zaten bu alanları tanımlıyordu, yalnızca bu fonksiyon onları
      // StoredUser'a hiç KOPYALAMIYORDU; bu, o eksikliğin düzeltmesidir.
      companyName: account.companyName,
      companyType: account.companyType,
      province: account.province,
      district: account.district,
      // Zaten bir createdAt'i varsa dokunulmaz (demo hesap "katılım tarihi"
      // her senkronda ileri kaymasın diye) — yalnızca bu alandan önce
      // oluşturulmuş demo kayıtlarda bir kerelik eklenir.
      createdAt: existing.createdAt ?? new Date().toISOString(),
    };
    writeUsers(readUsers().map((user) => (user.id === existing.id ? updated : user)));
    return;
  }

  // Bu telefon numarası başka (gerçek) bir hesapta kayıtlıysa dev seed onu ezmesin.
  if (findUserByPhone(phoneResult.value)) return;

  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: account.name,
    email: normalizeEmail(account.email),
    phone: phoneResult.value,
    passwordHash,
    role: account.role,
    companyName: account.companyName,
    companyType: account.companyType,
    province: account.province,
    district: account.district,
    createdAt: new Date().toISOString(),
  };
  writeUsers([...readUsers(), user]);
}

/**
 * Yalnızca `next dev` altında (NODE_ENV==="development") çalışır — Vercel
 * preview/production dahil `next build`+`next start` ile çalışan HİÇBİR
 * ortamda demo hesap oluşturulmaz/güncellenmez (o ortamlarda NODE_ENV her
 * zaman "production"dur). Kasıtlı olarak "!== production" değil "===
 * development" (allow-list) kontrolü kullanılır: NODE_ENV beklenmedik bir
 * değer alırsa bile demo hesap oluşturma varsayılan olarak KAPALI kalır.
 * Idempotenttir — tekrar tekrar çağrılsa da hesapları yinelemez, yalnızca
 * güncel olmayan alanları senkronlar; mevcut kullanıcı kayıtlarına dokunmaz.
 *
 * `login-form.tsx` bu fonksiyonu HEM mount anındaki bir efektten (fire-and-
 * forget) HEM her giriş denemesinde (`await` ile) çağırır — bu iki çağrı
 * neredeyse aynı anda üst üste binebilir. `upsertDevAccount` "oku -> hashle
 * (await ile asenkron boşluk) -> yaz" şeklinde çalıştığı için, aynı anda
 * çalışan İKİ bağımsız döngü, birbirinin `writeUsers` yazımını (o yazımdan
 * ÖNCEKİ bir localStorage anlık görüntüsünden hareketle) ezerek en son
 * eklenen hesabı (dizideki SON hesap, DEV_ACCOUNTS'a yeni bir hesap
 * eklendikçe risk penceresi büyür) sessizce kaybedebilir — kalıcı, gözlenmiş
 * bir "lost update" yarışı. `inFlightSeeding` bunu, aynı anda yalnızca TEK
 * bir gerçek döngünün çalışmasını garanti ederek (ikinci çağıran, YENİ bir
 * döngü başlatmak yerine SÜREN döngünün aynı promise'ini bekler) ortadan
 * kaldırır.
 */
const NAKLIYECI_DEMO_EMAIL = "nakliyeci@test.com";
const ADMIN_DEMO_EMAIL = "admin@test.com";
const NAKLIYECI_DEMO_DOCUMENT: { originalFileName: string; mimeType: string; extension: string } = {
  originalFileName: "malsevk-nakliye-demo-faaliyet-belgesi.pdf",
  mimeType: "application/pdf",
  extension: "pdf",
};

/**
 * Nakliyeci demo hesabının (bkz. DEV_ACCOUNTS'taki "nakliyeci@test.com"
 * girdisi) provider-services.ts/provider-documents.ts/
 * provider-document-consents.ts kayıtlarını kurar — bu üç tablo `upsertDevAccount`'un
 * bilmediği, StoredUser'ın DIŞINDA duran ilişkisel veridir (bkz. o
 * modüllerin kendi dokümantasyonu), bu yüzden AYRI bir adımdır. Yalnızca
 * `nakliyeciEmail`in StoredUser'ı zaten varsa (yukarıdaki ana döngü onu
 * oluşturduktan/senkronladıktan SONRA) çalışır.
 *
 * Görev gereksinimi: "eski ProviderProfile.serviceCategories alanına
 * yazma" — provider-services.ts zaten TEK doğruluk kaynağı olduğu için
 * (bkz. o dosya) burada da başka hiçbir yere yazılmaz.
 *
 * İdempotentlik: hizmet kümesi `setProviderServiceCategoryIds` ile TAM
 * değiştirme (replace) olduğu için tekrar tekrar çağrılması çoğaltma
 * üretmez; belge/beyan yalnızca HİÇ yoksa (bkz. `hasDocuments`/
 * `hasAcceptedProviderDocumentDeclaration`) bir kez oluşturulur — kullanıcı
 * silinip yeniden oluşturulursa (yeni bir `user.id` ile) bu kontroller
 * doğal olarak "yok" bulur ve baştan kurar.
 */
async function seedNakliyeciProviderProfileIfNeeded(): Promise<void> {
  const user = findUserByEmail(NAKLIYECI_DEMO_EMAIL);
  if (!user) return;

  const currentServiceIds = getProviderServiceCategoryIds(user.id);
  if (currentServiceIds.length !== 1 || currentServiceIds[0] !== NAKLIYE_SERVICE_CATEGORY_ID) {
    setProviderServiceCategoryIds(user.id, [NAKLIYE_SERVICE_CATEGORY_ID]);
  }

  const hasDocuments = getProviderDocumentsForUser(user.id).length > 0;
  if (!hasDocuments) {
    const storageKey = crypto.randomUUID();
    const demoBlob = new Blob(
      ["MALSEVK Nakliye Demo - Faaliyet Belgesi (geliştirme ortamı demo hesabı için otomatik oluşturuldu)."],
      { type: NAKLIYECI_DEMO_DOCUMENT.mimeType },
    );
    try {
      await putPhotoBlob(storageKey, demoBlob);
    } catch {
      // IndexedDB bu ortamda kullanılamıyorsa (ör. bazı test/SSR bağlamları)
      // yarım bir belge metadata kaydı bırakmamak için burada durulur —
      // hizmet seçimi yine de yukarıda zaten kurulmuş olur.
      return;
    }

    if (
      !addProviderDocuments(user.id, [
        {
          originalFileName: NAKLIYECI_DEMO_DOCUMENT.originalFileName,
          mimeType: NAKLIYECI_DEMO_DOCUMENT.mimeType,
          extension: NAKLIYECI_DEMO_DOCUMENT.extension,
          size: demoBlob.size,
          indexedDbStorageKey: storageKey,
        },
      ])
    ) {
      await deletePhotoBlob(storageKey);
      return;
    }

    const created = getProviderDocumentsForUser(user.id).find(
      (doc) => doc.indexedDbStorageKey === storageKey,
    );
    if (created) {
      // Demo kullanımını hiçbir admin onayı beklemeden test edilebilir
      // kılmak için doğrudan "approved" olarak işaretlenir — reviewedByAdminId
      // aynı seed döngüsünde zaten oluşturulmuş/senkronlanmış demo admin
      // hesabına (bkz. ADMIN_DEMO_EMAIL) işaret eder; o hesap her nasılsa
      // yoksa (ör. dev seed'in yalnızca bir kısmı çalıştıysa) kendi id'sine
      // geri düşer — sahte bir kimlik uydurulmaz.
      const admin = findUserByEmail(ADMIN_DEMO_EMAIL);
      updateProviderDocumentReviewFields({
        documentId: created.id,
        status: "approved",
        adminId: admin?.id ?? user.id,
      });
    }
  }

  if (!hasAcceptedProviderDocumentDeclaration(user.id)) {
    recordProviderDocumentConsent(user.id);
  }
}

let inFlightSeeding: Promise<void> | null = null;

export function seedDevAccountsIfNeeded(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return Promise.resolve();
  if (typeof window === "undefined") return Promise.resolve();

  if (!inFlightSeeding) {
    inFlightSeeding = (async () => {
      for (const account of DEV_ACCOUNTS) {
        await upsertDevAccount(account);
      }
      await seedNakliyeciProviderProfileIfNeeded();
    })().finally(() => {
      inFlightSeeding = null;
    });
  }
  return inFlightSeeding;
}

export type UpdateProviderProfileInput = {
  companyName: string;
  bio: string;
  foundedYear: number | null;
  regions: string[];
  expertise: string[];
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
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar firma profili düzenleyebilir." };
  }

  const errors = validateProviderProfileForm(input);
  const firstError = Object.values(errors)[0];
  if (firstError) {
    return { ok: false, error: firstError };
  }

  const existing = findUserById(session.id);
  if (!existing) {
    return { ok: false, error: "Kullanıcı bulunamadı." };
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
    expertise: input.expertise,
    logoStorageKey,
    // Bu form (Hesap Ayarları > Firma Profili) serviceFeatures/
    // experienceRange'i hiç düzenlemez (bkz. Panel > Profilim > Hizmet
    // Bilgilerim, updateProviderServiceInfo aşağıda) — var olan değerleri
    // olduğu gibi taşımazsak bu form kaydedildiğinde diğer ekranda girilmiş
    // veriler sessizce silinmiş olurdu. Hizmet seçimleri artık
    // provider-services.ts'te tutulur, bu profil nesnesinde hiç yoktur.
    serviceFeatures: existing.providerProfile?.serviceFeatures,
    experienceRange: existing.providerProfile?.experienceRange,
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

export type UpdateProviderServiceInfoInput = {
  regions: string[];
  serviceCategories: string[];
  serviceFeatures: ServiceFeature[];
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
 * Profili'ni hiç doldurmamış olsa bile yalnızca hizmet/bölge/deneyim
 * bilgisini kaydedebilmelidir. Bu yüzden companyName/bio/foundedYear/
 * logoStorageKey/expertise (bu formun sahibi olmadığı alanlar) var olan
 * profilden olduğu gibi taşınır, hiç doğrulanmaz/değiştirilmez; profil
 * daha önce hiç oluşturulmamışsa boş companyName/bio ile başlar (ekranlar
 * bunu zaten "Belirtilmemiş" gibi gösterip sahte veri üretmeden ele alır,
 * bkz. incoming-offer-card.tsx). `regions` de bilerek burada
 * düzenlenebilir — Hesap Ayarları'ndaki aynı alanla aynı veriyi paylaşır,
 * iki farklı ekrandan aynı tek doğruluk kaynağına yazılır.
 */
export async function updateProviderServiceInfo(
  session: Session | null,
  input: UpdateProviderServiceInfoInput,
): Promise<UpdateProviderServiceInfoResult> {
  if (!session) {
    return { ok: false, error: "Hizmet bilgilerinizi güncellemek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar hizmet bilgilerini düzenleyebilir." };
  }

  const existing = findUserById(session.id);
  if (!existing) {
    return { ok: false, error: "Kullanıcı bulunamadı." };
  }

  // Hizmet seçimleri artık provider-services.ts (userId -> serviceCategoryId
  // ilişkisel tablosu) üzerinden yazılır — profile.serviceCategories'e BİR
  // DAHA YAZILMAZ (bkz. types.ts#ProviderProfile.serviceCategories'in
  // deprecated notu). Önce hizmet tablosu yazılır: bu adım başarısız olursa
  // aşağıdaki profil yazımı hiç denenmez, iki tablo arasında yarım/tutarsız
  // bir durum oluşmaz.
  if (!setProviderServiceCategoryIds(session.id, input.serviceCategories)) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  const currentProfile = existing.providerProfile;
  const profile: ProviderProfile = {
    companyName: currentProfile?.companyName ?? "",
    bio: currentProfile?.bio ?? "",
    foundedYear: currentProfile?.foundedYear,
    logoStorageKey: currentProfile?.logoStorageKey,
    expertise: currentProfile?.expertise ?? [],
    regions: input.regions,
    serviceFeatures: input.serviceFeatures,
    experienceRange: input.experienceRange ?? undefined,
  };

  const updated: StoredUser = { ...existing, providerProfile: profile };
  if (!writeUsers(readUsers().map((user) => (user.id === existing.id ? updated : user)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, profile };
}
