// Real browser test against localhost:3000 (real Development project) —
// Admin "Hizmet Alanlar" module: list, detail, suspend, mutation-blocked
// (verified at the RPC level with the requester's own live browser session
// token, since job creation itself is localStorage-authoritative and would
// not visibly surface a backend rejection), reinstate, mutation-works again.
// Also asserts zero console/network errors throughout.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";
const [, , adminEmail, requesterEmail, password, requesterId, requesterFullName] = process.argv;
if (!adminEmail || !requesterEmail || !password || !requesterId) {
  console.error("usage: node tmp-hizmet-alanlar-e2e-browser-test.mjs <adminEmail> <requesterEmail> <password> <requesterId> <requesterFullName>");
  process.exit(1);
}

const SUPA_URL = "https://trfnmpihcnriqgikglpu.supabase.co";
const SUPA_ANON = "sb_publishable_fRjAnKgqDtDsxR5au68D2Q_0WYDsYvX";

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? " -- " + extra : ""}`); }
}

const consoleErrors = [];
const networkErrors = [];
function attachMonitors(page, label) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${label}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 500) networkErrors.push(`[${label}] ${res.status()} ${res.url()}`);
  });
}

const browser = await chromium.launch();

const adminCtx = await browser.newContext();
const adminPage = await adminCtx.newPage();
attachMonitors(adminPage, "admin");

await adminPage.goto(`${BASE_URL}/giris-yap`);
await adminPage.locator('input[type="email"]').fill(adminEmail);
await adminPage.locator('input[type="password"]').fill(password);
await adminPage.getByRole("button", { name: "Giriş Yap" }).click();
await adminPage.waitForTimeout(2000);

// 1) LIST
await adminPage.goto(`${BASE_URL}/admin/hizmet-alanlar`);
await adminPage.waitForTimeout(2000);
check("Admin 'Hizmet Alanlar' listesine ulaştı", adminPage.url().includes("/admin/hizmet-alanlar"), adminPage.url());
const searchBox = adminPage.locator('input[type="search"], input[placeholder*="Ara" i], input[placeholder*="isim" i]').first();
const hasSearch = await searchBox.isVisible().catch(() => false);
if (hasSearch) {
  await searchBox.fill(requesterFullName || "Hizmet Alanlar Test Requester");
  await adminPage.waitForTimeout(1200);
}
const listShowsRequester = await adminPage.locator(`text=${requesterFullName || "Hizmet Alanlar Test Requester"}`).first().isVisible().catch(() => false);
check("Liste, gerçek test requester'ını gösteriyor (arama ile bulundu)", listShowsRequester);

// 2) DETAIL
await adminPage.goto(`${BASE_URL}/admin/hizmet-alanlar/${requesterId}`);
await adminPage.waitForTimeout(2000);
check("Admin detay sayfasına ulaştı", adminPage.url().includes(`/admin/hizmet-alanlar/${requesterId}`), adminPage.url());
const initialActive = await adminPage.locator("text=Aktif").first().isVisible().catch(() => false);
check("Detay başlangıçta 'Aktif' gösteriyor", initialActive);

// Requester logs in with their OWN browser context (separate, real session) BEFORE suspension.
const reqCtx = await browser.newContext();
const reqPage = await reqCtx.newPage();
attachMonitors(reqPage, "requester");
await reqPage.goto(`${BASE_URL}/giris-yap`);
await reqPage.locator('input[type="email"]').fill(requesterEmail);
await reqPage.locator('input[type="password"]').fill(password);
await reqPage.getByRole("button", { name: "Giriş Yap" }).click();
await reqPage.waitForTimeout(2000);
await reqPage.goto(`${BASE_URL}/panel`);
await reqPage.waitForTimeout(1200);
check("Requester (askıdan önce) gerçek panel içeriğine ulaşabiliyor", /Hesap Ayarları|Profilim|Hoş geldiniz/.test(await reqPage.locator("body").innerText()));

// Capture the requester's own live session from the real auth cookie
// (@supabase/ssr's createBrowserClient stores it in a cookie, not localStorage
// — bkz. app/_lib/supabase/browser-client.ts) to prove backend rejection
// directly: job creation itself is localStorage-authoritative in the app's
// own UI, so a UI click wouldn't visibly show a backend block — but this
// access token IS the exact credential the browser would attach to any real
// Supabase-backed mutation, so testing it directly is equivalent, stronger
// evidence of the actual security boundary.
async function readSessionFromCookie(ctx) {
  const cookies = await ctx.cookies();
  const authCookie = cookies.find((c) => c.name.includes("-auth-token"));
  if (!authCookie) return null;
  let val = decodeURIComponent(authCookie.value);
  if (!val.startsWith("base64-")) return null;
  const parsed = JSON.parse(Buffer.from(val.slice(7), "base64").toString("utf8"));
  return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
}
const sessionBefore = await readSessionFromCookie(reqCtx);
check("Requester'ın gerçek tarayıcı session'ı (cookie) okunabildi", !!sessionBefore?.access_token);

// 3) SUSPEND via real admin UI
await adminPage.getByRole("button", { name: "Askıya Al" }).click();
await adminPage.waitForTimeout(500);
await adminPage.locator("#admin-requester-suspend-reason").fill("0043 Hizmet Alanlar E2E testi — gerçek gerekçe");
await adminPage.getByRole("button", { name: "Onayla" }).click();
await adminPage.waitForTimeout(2500);
check("Admin 'Askıya Al' -> rozet 'Askıya Alınmış' oldu", await adminPage.locator("text=Askıya Alınmış").first().isVisible().catch(() => false));

// 4) MUTATION BLOCKED — direct RPC using the SAME live session captured above (no re-login).
if (sessionBefore) {
  const raw = createClient(SUPA_URL, SUPA_ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await raw.auth.setSession(sessionBefore).catch(() => {});
  const { error } = await raw.rpc("create_job", {
    p_category_id: "kapali-depolama", p_title: "0043 hizmet alanlar suspended test", p_description: "0043 hizmet alanlar suspended test description, yirmi karakter.",
    p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
    p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
    p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 1, width: 1, height: 1 }],
    p_address_text: "Test adres, en az yirmi karakter uzunlukta.",
  });
  check("Askıya alınmış requester'ın GERÇEK tarayıcı token'ı ile create_job -> ML127 FAIL", !!error && error.message.includes("ML127"), error?.message);
}
// Also confirm the requester's OWN open tab (no re-login) loses panel access.
await reqPage.goto(`${BASE_URL}/panel`);
await reqPage.waitForTimeout(1500);
const bodyAfterSuspend = await reqPage.locator("body").innerText();
check("Askıya alınmış requester (aynı sekme, re-login YOK) /panel'de gerçek içerik göremiyor", !/Hesap Ayarları|Profilim/.test(bodyAfterSuspend));

// 5) REINSTATE via real admin UI
await adminPage.getByRole("button", { name: "Askıyı Kaldır" }).click();
await adminPage.waitForTimeout(500);
await adminPage.getByRole("button", { name: "Evet, Askıyı Kaldır" }).click();
await adminPage.waitForTimeout(2500);
check("Admin 'Askıyı Kaldır' -> rozet tekrar 'Aktif' oldu", await adminPage.locator("text=Aktif").first().isVisible().catch(() => false));

// 6) MUTATION WORKS AGAIN — same live session, no re-login.
if (sessionBefore) {
  const raw2 = createClient(SUPA_URL, SUPA_ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await raw2.auth.setSession(sessionBefore).catch(() => {});
  const { data, error } = await raw2.rpc("create_job", {
    p_category_id: "kapali-depolama", p_title: "0043 hizmet alanlar reinstated test", p_description: "0043 hizmet alanlar reinstated test description, yirmi karakter.",
    p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
    p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
    p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 1, width: 1, height: 1 }],
    p_address_text: "Test adres, en az yirmi karakter uzunlukta.",
  });
  check("REINSTATE sonrası aynı token ile create_job tekrar PASS", !error && !!data?.id, error?.message);
}

check("Console'da hiçbir gerçek hata YOK (React/uygulama hatası)", consoleErrors.length === 0, JSON.stringify(consoleErrors));
check("Network'te hiçbir 5xx hatası YOK", networkErrors.length === 0, JSON.stringify(networkErrors));

await browser.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
