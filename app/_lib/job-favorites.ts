const FAVORITE_JOBS_KEY_PREFIX = "malsevk_favorite_jobs_";

/**
 * Favori ilan id'leri kullanıcıya özel bir localStorage anahtarında kalıcı
 * tutulur (`malsevk_favorite_jobs_${userId}`) — notification-reads.ts ile
 * BİREBİR aynı desen (kullanıcıya özel anahtar, cache, listener seti).
 * `clearSession()` bu anahtara dokunmaz, bu yüzden çıkış/tekrar giriş
 * favorileri bozmaz.
 */
function storageKey(userId: string): string {
  return `${FAVORITE_JOBS_KEY_PREFIX}${userId}`;
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

export function getFavoriteJobIds(userId: string): string[] {
  return readIdsSnapshot(userId);
}

export function isJobFavorited(userId: string, jobId: string): boolean {
  return readIdsSnapshot(userId).includes(jobId);
}

/** Favori değilse ekler, favoriyse çıkarır — arayüzdeki tek kalp/yıldız butonunun karşılığı. */
export function toggleFavoriteJob(userId: string, jobId: string): void {
  const current = readIdsSnapshot(userId);
  const next = current.includes(jobId)
    ? current.filter((id) => id !== jobId)
    : [...current, jobId];
  writeIds(userId, next);
}

export function subscribeToFavoriteJobs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
