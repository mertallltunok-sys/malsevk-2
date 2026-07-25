import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Site-genelinde geçici geliştirme şifre kapısı — proxy.ts (kök dizin) ve
 * app/site-erisim/ burayı kullanır. Bu, uygulamanın kendi kullanıcı
 * giriş/hesap sistemiyle (users.ts/session.ts) İLGİSİZ, ondan ÖNCE çalışan
 * ayrı bir katmandır; hiçbir StoredUser/Session verisine dokunmaz.
 */
export const SITE_ACCESS_COOKIE = "malsevk_site_access";

/** Cookie 30 gün geçerli — sayfa yenilemede/tarayıcı yeniden açılışında şifre tekrar sorulmasın diye. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Kapı yalnızca `NODE_ENV === "production"`da etkindir — bkz. app/site-erisim/README niyetindeki page.tsx açıklaması. */
export function isSiteAccessGateActive(): boolean {
  return process.env.NODE_ENV === "production";
}

function sha256Hex(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Şifrenin kendisini asla cookie'ye yazmamak için: gerçek şifre + sabit bir
 * bağlam dizesinden tek yönlü, geri döndürülemez bir belirteç türetilir.
 * Ortam değişkeni değiştiğinde (şifre rotasyonu) önceden verilmiş TÜM
 * cookie'ler otomatik olarak geçersiz kalır — ayrı bir "sürüm"/iptal listesi
 * gerekmez.
 */
export function computeSiteAccessToken(password: string): string {
  return sha256Hex(`malsevk-site-access:v1:${password}`).toString("hex");
}

/**
 * Zamanlama saldırılarına karşı: her iki taraf da önce sabit uzunluklu bir
 * SHA-256 özetine indirgenir, ardından `timingSafeEqual` ile karşılaştırılır
 * — böylece karşılaştırma süresi ne girilen şifrenin uzunluğuna ne de kaç
 * karakterinin doğru olduğuna bağlı olarak sızdırılmaz.
 */
export function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufA = sha256Hex(a);
  const bufB = sha256Hex(b);
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bir cookie değerinin geçerli olup olmadığını doğrular. Ortam değişkeni
 * (MALSEVK_SITE_PASSWORD) tanımlı DEĞİLSE her zaman `false` döner — bu,
 * requirement 15'in "env var yoksa production'da fail-closed" davranışını
 * ayrı bir özel durum kodu yazmadan doğal olarak sağlar: doğrulanacak
 * hiçbir gerçek belirteç yoktur, o yüzden hiçbir cookie asla geçerli sayılmaz.
 */
export function isValidSiteAccessToken(token: string | undefined): boolean {
  const password = process.env.MALSEVK_SITE_PASSWORD;
  if (!token || !password) return false;
  const expected = computeSiteAccessToken(password);
  const a = Buffer.from(token, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SITE_ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

/** Açık yönlendirme (open redirect) önlemi — yalnızca site-içi, göreli bir yola izin verir. */
export function isSafeNextPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}
