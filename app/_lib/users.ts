import { readJson, writeJson } from "./local-storage";
import { deletePhotoBlob, putPhotoBlob } from "./photo-blob-store";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";
import { validateProviderProfileForm } from "./provider-profile";
import type { ProviderProfile, Session, UserRole } from "./types";

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
    (user.role === "hizmet-alan" || user.role === "hizmet-veren")
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
    (profile.logoStorageKey === undefined || typeof profile.logoStorageKey === "string")
  );
}

/**
 * `createdAt`/`providerProfile` bu özelliklerden önce oluşturulmuş
 * kayıtlarda hiç yoktur. Geriye dönük uyumluluk için ikisi de opsiyonel
 * kabul edilir ve eksik/bozuksa sessizce `undefined`a normalize edilir —
 * kayıt yine de geçerli sayılır (job-store.ts#normalizeStoredJob'daki
 * "photos" alanıyla aynı desen); tek başına bu iki alanın eksikliği bir
 * kullanıcı kaydının tamamen kaybolmasına (filtrelenip silinmesine) asla
 * yol açmaz.
 */
function normalizeStoredUser(value: unknown): StoredUser | null {
  if (!isStoredUserCore(value)) return null;
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : undefined;
  const providerProfile = isValidProviderProfile(value.providerProfile) ? value.providerProfile : undefined;
  return { ...(value as Omit<StoredUser, "createdAt" | "providerProfile">), createdAt, providerProfile };
}

function readUsers(): StoredUser[] {
  const raw = readJson<unknown[]>(USERS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeStoredUser).filter((user): user is StoredUser => user !== null);
}

function writeUsers(users: StoredUser[]): void {
  writeJson(USERS_STORAGE_KEY, users);
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
  };

  writeUsers([...readUsers(), user]);
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
      typeof existing.createdAt === "string";
    if (alreadyUpToDate) return;

    const updated: StoredUser = {
      ...existing,
      name: account.name,
      phone: phoneResult.value,
      passwordHash,
      role: account.role,
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
 */
export async function seedDevAccountsIfNeeded(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  if (typeof window === "undefined") return;

  for (const account of DEV_ACCOUNTS) {
    await upsertDevAccount(account);
  }
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
  }

  const profile: ProviderProfile = {
    companyName: input.companyName.trim(),
    bio: input.bio.trim(),
    foundedYear: input.foundedYear ?? undefined,
    regions: input.regions,
    expertise: input.expertise,
    logoStorageKey,
  };

  const updated: StoredUser = { ...existing, providerProfile: profile };
  writeUsers(readUsers().map((user) => (user.id === existing.id ? updated : user)));

  if (previousLogoStorageKey && previousLogoStorageKey !== logoStorageKey) {
    await deletePhotoBlob(previousLogoStorageKey);
  }

  return { ok: true, profile };
}
