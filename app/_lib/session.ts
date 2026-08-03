import type { Session } from "./types";
import { findUserById } from "./users";

const SESSION_STORAGE_KEY = "malsevk.session.v1";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;
let hasCached = false;

/** Yalnızca ham şekli (tip) kontrol eder — bkz. readSessionSnapshot'taki gerçek kullanıcı doğrulaması. */
function hasValidSessionShape(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.role === "hizmet-alan" || candidate.role === "hizmet-veren" || candidate.role === "admin")
  );
}

/**
 * DÜZELTME (K1, veritabanı geçişi öncesi denetim): eskiden `isValidSession`
 * yalnızca `{id, name, role}`in TİPİNİ kontrol ediyordu — `id`nin gerçek bir
 * `StoredUser`a karşılık geldiğini veya `role`ün o kullanıcının GERÇEK
 * rolüyle eşleştiğini hiç doğrulamıyordu. Tarayıcı konsolunda
 * `localStorage["malsevk.session.v1"]`i elle `{"id":"x","name":"x","role":
 * "admin"}` yapan HERHANGİ bir kullanıcı `/admin`e ve `getAllProviderDocuments
 * /getAllUsers` üzerinden tüm kullanıcıların iletişim bilgilerine erişebiliyordu.
 *
 * Artık `id` gerçek kullanıcılar arasında bulunamıyorsa oturum tamamen
 * GEÇERSİZ sayılır (null döner, sanki hiç oturum açılmamış gibi); bulunuyorsa
 * `name`/`role` sahte session nesnesinden DEĞİL, doğrudan gerçek `StoredUser`
 * kaydından türetilir — böylece `session.role`ü tarayıcıda elle değiştirmek
 * artık hiçbir etkili yetki değişikliği üretmez.
 *
 * ÖNEMLİ SINIR (kod incelemesi/denetim notu): bu, yalnızca istemci tarafında
 * mümkün olan bir sıkılaştırmadır — `StoredUser` kaydının kendisi de aynı
 * localStorage'da, aynı kullanıcı tarafından değiştirilebilir durumdadır (ör.
 * kendi `role` alanını doğrudan `malsevk.users.v1`de değiştirip GERÇEK bir
 * kayıt gibi göstermek hâlâ mümkündür). Gerçek bir yetkilendirme sınırı,
 * yalnızca sunucu tarafında doğrulanan bir oturum/roldür (bkz. docs/database/
 * taslak RLS + SECURITY DEFINER RPC tasarımı) — bu düzeltme yalnızca "en az
 * çabayla, en sık karşılaşılacak" sahtecilik yolunu (yalnızca session
 * nesnesini değiştirmek) kapatır, üretim seviyesinde tam bir güvenlik sınırı
 * DEĞİLDİR.
 */
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
      if (hasValidSessionShape(value)) {
        const realUser = findUserById(value.id);
        if (realUser) {
          parsed = { id: realUser.id, name: realUser.name, role: realUser.role };
        }
      }
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
