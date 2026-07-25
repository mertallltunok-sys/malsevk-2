const RECENTLY_VIEWED_KEY_PREFIX = "malsevk_recently_viewed_jobs_";

/** Bir kullanıcı için tutulacak en fazla son görüntülenen ilan sayısı — sınırsız büyümeyi engeller. */
export const RECENTLY_VIEWED_LIMIT = 15;

/**
 * Son görüntülenen ilan id'leri kullanıcıya özel bir localStorage
 * anahtarında (`malsevk_recently_viewed_jobs_${userId}`) kalıcı tutulur —
 * job-favorites.ts/notification-reads.ts ile BİREBİR aynı desen.
 */
function storageKey(userId: string): string {
  return `${RECENTLY_VIEWED_KEY_PREFIX}${userId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const listeners = new Set<() => void>();
let cachedKey: string | null = null;
let cachedRaw: string | null = null;
let cachedIds: string[] = [];

const EMPTY_IDS: string[] = [];

function readIdsSnapshot(userId: string): string[] {
  if (typeof window === "undefined") return EMPTY_IDS;

  const key = storageKey(userId);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }

  if (cachedKey === key && raw === cachedRaw) return cachedIds;

  let parsed: string[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (isStringArray(value)) parsed = value;
    } catch {
      parsed = [];
    }
  }

  cachedKey = key;
  cachedRaw = raw;
  cachedIds = parsed;
  return parsed;
}

function writeIds(userId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(ids));
  cachedKey = null;
  for (const listener of listeners) listener();
}

export function getRecentlyViewedJobIds(userId: string): string[] {
  return readIdsSnapshot(userId);
}

/**
 * Bir ilan görüntülendiğinde çağrılır (bkz. provider-job-listing.tsx — satır
 * linkine tıklanınca). Zaten listede varsa önce çıkarılıp en başa taşınır
 * (tekrar görüntüleme = "en son" sayılır), liste RECENTLY_VIEWED_LIMIT ile
 * sınırlanır.
 */
export function recordJobViewed(userId: string, jobId: string): void {
  const current = readIdsSnapshot(userId);
  const next = [jobId, ...current.filter((id) => id !== jobId)].slice(0, RECENTLY_VIEWED_LIMIT);
  writeIds(userId, next);
}

export function subscribeToRecentlyViewedJobs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
