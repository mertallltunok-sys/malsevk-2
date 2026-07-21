import type { StoredUser } from "./users";
import type { UserRole } from "./types";

export type ProfileInfo = {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
};

/**
 * StoredUser'dan yalnızca ekranda gösterilmesi güvenli alanları seçer.
 * Bilinçli olarak açık bir alan listesi kullanılır (nesneyi spread edip
 * passwordHash'i çıkarmak yerine) — StoredUser'a ileride yeni bir hassas
 * alan eklenirse bile buradan kazara sızmaz.
 */
export function getProfileInfo(user: StoredUser): ProfileInfo {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

export function getUserRoleLabel(role: UserRole): string {
  return role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan";
}

/** Boş/eksik bir alan için "Belirtilmemiş" gösterir; sahte veri üretmez. */
export function formatProfileField(value: string): string {
  return value.trim().length > 0 ? value : "Belirtilmemiş";
}

/** Ad Soyad'dan sade bir avatar kısaltması üretir (ör. "Ahmet Yılmaz" -> "AY"). */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
