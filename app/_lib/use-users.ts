"use client";

import { useSyncExternalStore } from "react";
import { usersStore, type StoredUser } from "./users";

/**
 * Kullanıcı tablosunun reaktif okuma hook'u — job-store.ts/offers.ts/
 * ratings.ts ile AYNI useSyncExternalStore deseni (bkz. users.ts#usersStore).
 * DÜZELTME (Y3, veritabanı geçişi öncesi denetim): bu tablonun daha önce
 * hiçbir reaktif tüketicisi yoktu (her ekran findUserById'i doğrudan,
 * render anında çağırıyordu) — bu yüzden bir sekmede yapılan bir değişiklik
 * (ör. profil/iletişim görünürlüğü güncellemesi) başka açık bir sekmeye asla
 * yansımıyordu. `useUserById`, bu boşluğu dolduran ilk somut tüketicidir
 * (bkz. account-settings-content.tsx).
 */
export function useAllUsers(): StoredUser[] {
  return useSyncExternalStore(usersStore.subscribe, usersStore.getSnapshot, usersStore.getServerSnapshot);
}

export function useUserById(id: string | null): StoredUser | null {
  const users = useAllUsers();
  if (!id) return null;
  return users.find((user) => user.id === id) ?? null;
}
