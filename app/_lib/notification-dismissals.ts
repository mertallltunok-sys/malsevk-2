const DISMISSED_NOTIFICATIONS_KEY_PREFIX = "malsevk_dismissed_notifications_";

/**
 * Bildirimler ayrı bir tabloda tutulmadığı için (bkz. notifications.ts —
 * Offer/Job'tan türetilir) "silme" bir kaydı yok etmek anlamına gelmez;
 * yalnızca bu bildirim id'sini kullanıcıya özel bir localStorage
 * anahtarında (`malsevk_dismissed_notifications_${userId}`) kalıcı olarak
 * gizlenmiş işaretler — notification-reads.ts'teki "okundu" izleme deseninin
 * birebir aynısı. Böylece: sayfa yenilenince geri gelmez, yalnızca bu
 * kullanıcıyı etkiler, altındaki Job/Offer kaydına hiç dokunulmaz.
 */
function storageKey(userId: string): string {
  return `${DISMISSED_NOTIFICATIONS_KEY_PREFIX}${userId}`;
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

export function getDismissedNotificationIds(userId: string): string[] {
  return readIdsSnapshot(userId);
}

/** Bir bildirimi bu kullanıcı için kalıcı olarak gizler — altındaki Job/Offer kaydına dokunmaz. */
export function dismissNotification(userId: string, notificationId: string): void {
  const current = readIdsSnapshot(userId);
  if (current.includes(notificationId)) return;
  writeIds(userId, [...current, notificationId]);
}

/**
 * Bir kullanıcının bildirim gizleme kaydını tamamen temizler — yalnızca
 * dev-only demo veri sıfırlama aracı (bkz. reset-demo-data.ts) için vardır,
 * notification-reads.ts#clearReadNotifications ile aynı desen.
 */
export function clearDismissedNotifications(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // yok say
  }
  cachedKey = null;
  for (const listener of listeners) listener();
}

export function subscribeToNotificationDismissals(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
