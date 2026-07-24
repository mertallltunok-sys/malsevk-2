import type { UserRole } from "./types";

/**
 * Kayıt formunda "Kullanıcı Tipi" (Hizmet Alan) / "Hizmet Veren Tipi"
 * (Hizmet Veren) olarak sorulan işletme türü — her iki rol için de aynı
 * değer kümesi, yalnızca "bireysel" seçeneğinin görünen adı role göre
 * değişir (bkz. getCompanyTypeOptions). StoredUser.companyType (users.ts)
 * bu tipi kullanır.
 */
export type CompanyType =
  | "bireysel"
  | "sahis-isletmesi"
  | "limited-sirket"
  | "anonim-sirket"
  | "diger";

const COMPANY_TYPE_VALUES: readonly CompanyType[] = [
  "bireysel",
  "sahis-isletmesi",
  "limited-sirket",
  "anonim-sirket",
  "diger",
];

export function isCompanyType(value: unknown): value is CompanyType {
  return typeof value === "string" && (COMPANY_TYPE_VALUES as readonly string[]).includes(value);
}

/** Kayıt formundaki alan etiketi — role göre değişir. */
export function getCompanyTypeFieldLabel(role: UserRole): string {
  return role === "hizmet-veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi";
}

/**
 * Seçenek listesi — dört değerin (şahıs işletmesi/limited/anonim/diğer)
 * etiketi her iki rolde de aynıdır; yalnızca "bireysel" seçeneğinin görünen
 * adı role göre değişir ("Bireysel" / "Bireysel Hizmet Veren") — bu yüzden
 * role başına ayrı bir seçenek dizisi tutulmaz, tek kaynaktan üretilir.
 */
export function getCompanyTypeOptions(role: UserRole): { value: CompanyType; label: string }[] {
  return [
    { value: "bireysel", label: role === "hizmet-veren" ? "Bireysel Hizmet Veren" : "Bireysel" },
    { value: "sahis-isletmesi", label: "Şahıs İşletmesi" },
    { value: "limited-sirket", label: "Limited Şirket" },
    { value: "anonim-sirket", label: "Anonim Şirket" },
    { value: "diger", label: "Diğer" },
  ];
}
