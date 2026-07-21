const READ_NOTIFICATIONS_KEY_PREFIX = "malsevk_read_notifications_";

/**
 * Okunan bildirim id'leri kullanıcıya özel bir localStorage anahtarında
 * kalıcı tutulur (`malsevk_read_notifications_${userId}`) — e-posta değil,
 * değişmeyen kullanıcı id'si kullanılır. Bu, oturum (session.ts) gibi
 * ayrı bir anahtardır; `clearSession()` yalnızca oturum anahtarını siler,
 * bu listeye dokunmaz, bu yüzden çıkış/tekrar giriş okunma durumunu
 * bozmaz.
 */
function storageKey(userId: string): string {
  return `${READ_NOTIFICATIONS_KEY_PREFIX}${userId}`;
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

export function getReadNotificationIds(userId: string): string[] {
  return readIdsSnapshot(userId);
}

/** Bozuk/silinmiş bir kayda referans veren id de sorunsuz eklenebilir — bu liste yalnızca id string'leri tutar, ilan/teklif kaydını doğrulamaz. */
export function markNotificationRead(userId: string, notificationId: string): void {
  const current = readIdsSnapshot(userId);
  if (current.includes(notificationId)) return;
  writeIds(userId, [...current, notificationId]);
}

export function subscribeToNotificationReads(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
