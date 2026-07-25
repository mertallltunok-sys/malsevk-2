"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  computeSiteAccessToken,
  isSafeNextPath,
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_COOKIE_OPTIONS,
  timingSafeStringsEqual,
} from "../_lib/site-access";

export type SiteAccessFormState = {
  error?: string;
};

/**
 * Kaba kuvvet (brute-force) azaltma: her denemede sabit ~1sn gecikme +
 * IP başına best-effort, bellek-içi bir sayaç. Vercel serverless
 * fonksiyonları çoklu/geçici instance'larda çalışabildiği için bu sayaç
 * DAĞITIK (distributed) bir garanti DEĞİLDİR — yalnızca aynı sıcak (warm)
 * instance üzerinde ardışık denemeleri yavaşlatır. Kalıcı/dağıtık bir
 * rate-limit (ör. Vercel KV, ya da mevcut db.ts'in gerçek bir tabloya
 * bağlanması) bu görevin kapsamı dışında bırakıldı — bkz. rapor "Kalan
 * riskler". Sabit gecikme (her ikisi de aynı süre bekler) tek başına zaten
 * asıl mitigasyon katmanıdır ve instance'tan bağımsız her zaman çalışır.
 */
const attemptsByIp = new Map<string, { count: number; windowResetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const FIXED_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function isRateLimited(ip: string): boolean {
  const record = attemptsByIp.get(ip);
  if (!record) return false;
  if (record.windowResetAt <= Date.now()) return false;
  return record.count >= RATE_LIMIT_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = attemptsByIp.get(ip);
  if (record && record.windowResetAt > now) {
    record.count += 1;
  } else {
    attemptsByIp.set(ip, { count: 1, windowResetAt: now + RATE_LIMIT_WINDOW_MS });
  }
}

export async function verifySiteAccess(
  _prevState: SiteAccessFormState,
  formData: FormData,
): Promise<SiteAccessFormState> {
  await sleep(FIXED_DELAY_MS);

  const ip = await resolveClientIp();
  if (isRateLimited(ip)) {
    return { error: "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin." };
  }

  const submittedPassword = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "/");
  const expectedPassword = process.env.MALSEVK_SITE_PASSWORD ?? "";

  const isCorrect = expectedPassword.length > 0 && timingSafeStringsEqual(submittedPassword, expectedPassword);

  if (!isCorrect) {
    recordFailedAttempt(ip);
    return { error: "Şifre hatalı." };
  }

  attemptsByIp.delete(ip);

  const cookieStore = await cookies();
  cookieStore.set(SITE_ACCESS_COOKIE, computeSiteAccessToken(expectedPassword), SITE_ACCESS_COOKIE_OPTIONS);

  redirect(isSafeNextPath(nextParam) ? nextParam : "/");
}

export async function clearSiteAccess(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SITE_ACCESS_COOKIE);
  redirect("/site-erisim");
}
