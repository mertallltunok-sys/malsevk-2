import { readJson, writeJson } from "./local-storage";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";
import type { UserRole } from "./types";

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
};

function isStoredUser(value: unknown): value is StoredUser {
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

function readUsers(): StoredUser[] {
  const raw = readJson<unknown[]>(USERS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredUser);
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
];

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
      existing.role === account.role;
    if (alreadyUpToDate) return;

    const updated: StoredUser = {
      ...existing,
      name: account.name,
      phone: phoneResult.value,
      passwordHash,
      role: account.role,
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
  };
  writeUsers([...readUsers(), user]);
}

/**
 * Bilinçli olarak NODE_ENV'e göre kısıtlanmamıştır: gerçek bir backend/veritabanı
 * olmadığından (localStorage her origin'de — localhost, Vercel preview/production —
 * boş başlar), demo hesapların yalnızca `next dev` altında oluşup canlıda hiç
 * oluşmaması login'i orada tamamen kırar. Bu yüzden her ortamda çalışır.
 * Idempotenttir — tekrar tekrar çağrılsa da hesapları yinelemez, yalnızca
 * güncel olmayan alanları senkronlar; mevcut kullanıcı kayıtlarına dokunmaz.
 */
export async function seedDevAccountsIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const account of DEV_ACCOUNTS) {
    await upsertDevAccount(account);
  }
}
