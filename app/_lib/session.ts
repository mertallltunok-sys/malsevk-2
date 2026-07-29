import type { Session } from "./types";

const SESSION_STORAGE_KEY = "malsevk.session.v1";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;
let hasCached = false;

function isValidSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.role === "hizmet-alan" || candidate.role === "hizmet-veren" || candidate.role === "admin")
  );
}

function readSessionSnapshot(): Session | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    raw = null;
  }

  // useSyncExternalStore, getSnapshot'ın değişmediğinde aynı referansı
  // döndürmesini bekler; bu yüzden ham metin değişmediyse önbelleklenmiş
  // nesne döndürülür.
  if (hasCached && raw === cachedRaw) return cachedSession;

  let parsed: Session | null = null;
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (isValidSession(value)) parsed = value;
    } catch {
      parsed = null;
    }
  }

  cachedRaw = raw;
  cachedSession = parsed;
  hasCached = true;
  return parsed;
}

function getServerSessionSnapshot(): Session | null {
  return null;
}

function subscribeToSession(onStoreChange: () => void): () => void {
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

export function getSession(): Session | null {
  return readSessionSnapshot();
}

/**
 * `localStorage.setItem` başarısız olursa (kota dolu, gizli sekme vb.)
 * `false` döner ve oturum ASLA yazılmamış sayılır — çağıran (login-form.tsx)
 * bu durumda yönlendirme yapmamalı/oturum açılmış gibi davranmamalıdır (bkz.
 * CLAUDE.md B1 düzeltmesi).
 */
export function setSession(session: Session): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("Oturum bilgisi kaydedilemedi:", error);
    return false;
  }
  notify();
  return true;
}

export function clearSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.error("Oturum bilgisi silinemedi:", error);
    return false;
  }
  notify();
  return true;
}

export const sessionStore = {
  subscribe: subscribeToSession,
  getSnapshot: readSessionSnapshot,
  getServerSnapshot: getServerSessionSnapshot,
};
