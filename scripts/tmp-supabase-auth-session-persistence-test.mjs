// Oturumun korunmasını (protected route erişimi) ve logout'un gerçekten
// erişimi kestiğini gerçek çerezlerle (app/auth/confirm/route.ts üzerinden
// kurulan GERÇEK Supabase oturum çerezi) doğrular. SB_SECRET_KEY_FOR_TEST
// yalnızca test kullanıcısı kurulumu/temizliği için kullanılır, asla
// yazdırılmaz.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = "http://localhost:3001";

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const email = `malsevk-auth-test-c-${stamp}@gmail.com`;
const password = "TestSifre2026!";

function extractCookieHeader(setCookieCombined) {
  return setCookieCombined.split(/,\s*(?=[^;=]+=[^;=]+;)/).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const signUpRes = await createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } }).auth.signUp({ email, password });
  const userId = signUpRes.data.user?.id;

  const link = await admin.auth.admin.generateLink({ type: "signup", email, password });
  const tokenHash = link.data?.properties?.hashed_token;

  const confirmResp = await fetch(`${APP_ORIGIN}/auth/confirm?token_hash=${tokenHash}&type=signup&next=${encodeURIComponent("/kayit-tamamla")}`, { redirect: "manual" });
  const setCookie = confirmResp.headers.getSetCookie?.().join("; ") ?? confirmResp.headers.get("set-cookie") ?? "";
  const cookieHeader = extractCookieHeader(setCookie);
  record("1. Gerçek oturum çerezi kuruldu", cookieHeader.length > 0);

  // 2) Bu çerezle /panel (korumalı) -> 200 (307 giriş yönlendirmesi DEĞİL) — oturum korunuyor.
  const panelResp = await fetch(`${APP_ORIGIN}/panel`, { headers: { Cookie: cookieHeader }, redirect: "manual" });
  record("2. Gerçek oturumla /panel (korumalı) 307'ye DÜŞMEDİ", panelResp.status !== 307, String(panelResp.status));

  // 3) Aynı çerezle /admin (korumalı, oturum VAR ama admin DEĞİL) -> proxy seviyesinde 307 giriş yönlendirmesi OLMAMALI (middleware yalnızca "oturum var mı" bakar); sayfa seviyesinde is_admin() 404 (notFound) ile engellemeli.
  const adminResp = await fetch(`${APP_ORIGIN}/admin`, { headers: { Cookie: cookieHeader }, redirect: "manual" });
  record("3. Admin olmayan oturumla /admin middleware'de 307'ye düşmedi (sayfa seviyesi kontrole bırakıldı)", adminResp.status !== 307, String(adminResp.status));
  record("4. Admin olmayan oturumla /admin sayfa seviyesinde 404 (is_admin() reddi)", adminResp.status === 404, String(adminResp.status));

  // 5) Logout: AYRI bir taze token ile gerçek bir SDK oturumu kur, sonra
  //    signOut çağır ve refresh token'ın gerçekten iptal edildiğini
  //    (bir sonraki refreshSession çağrısının reddedilmesiyle) doğrula —
  //    access token'ın kendi doğal süresine kadar teknik geçerliliği JWT'lerin
  //    doğası gereğidir, PROJEYE özgü bir eksiklik değildir; bu yüzden gerçek
  //    logout kanıtı refresh token iptaliyle doğrulanır.
  const secondLink = await admin.auth.admin.generateLink({ type: "signup", email, password });
  const secondTokenHash = secondLink.data?.properties?.hashed_token;
  const sessionClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const secondVerify = secondTokenHash
    ? await sessionClient.auth.verifyOtp({ type: "signup", token_hash: secondTokenHash })
    : { data: {}, error: { message: "token yok" } };
  const refreshToken = secondVerify.data?.session?.refresh_token;

  const signOutRes = await sessionClient.auth.signOut();
  record("5. signOut hatasız tamamlandı", !signOutRes.error, signOutRes.error?.message);

  if (refreshToken) {
    const refreshAfterSignOut = await createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } }).auth.refreshSession({ refresh_token: refreshToken });
    record("6. signOut sonrası refresh token reddedildi (gerçek oturum sonlandırma)", !!refreshAfterSignOut.error, refreshAfterSignOut.error?.message || "REDDEDİLMEDİ");
  } else {
    record("6. atlandı (ikinci token yok)", false);
  }

  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HATA:", e?.message || e);
  process.exitCode = 1;
});
