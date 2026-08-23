// Real browser test against the running dev server (localhost:3000, pointed
// at the real Development Supabase project per .env.local) — verifies the
// admin "Firmalar" suspend/reinstate UI flow end-to-end, and that a provider
// already logged in (session cached before suspension) is rejected from the
// app the moment the backend/session is re-checked, without any re-login.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const [, , adminEmail, providerEmail, password, providerId] = process.argv;
if (!adminEmail || !providerEmail || !password || !providerId) {
  console.error("usage: node tmp-suspend-enforcement-browser-test.mjs <adminEmail> <providerEmail> <password> <providerId>");
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? " -- " + extra : ""}`); }
}

const browser = await chromium.launch();

// Provider logs in FIRST and stays on a protected page (session cached before suspension).
const providerCtx = await browser.newContext();
const providerPage = await providerCtx.newPage();
await providerPage.goto(`${BASE_URL}/giris-yap`);
await providerPage.locator('input[type="email"]').fill(providerEmail);
await providerPage.locator('input[type="password"]').fill(password);
await providerPage.getByRole("button", { name: "Giriş Yap" }).click();
await providerPage.waitForTimeout(2500);
await providerPage.goto(`${BASE_URL}/panel`);
await providerPage.waitForTimeout(1500);
check("Provider gerçek tarayıcı ile giriş yapıp /panel'e ulaşabiliyor (askıdan ÖNCE)", providerPage.url().includes("/panel"), providerPage.url());

// Admin logs in, goes to Firmalar, finds the provider, suspends them.
const adminCtx = await browser.newContext();
const adminPage = await adminCtx.newPage();
await adminPage.goto(`${BASE_URL}/giris-yap`);
await adminPage.locator('input[type="email"]').fill(adminEmail);
await adminPage.locator('input[type="password"]').fill(password);
await adminPage.getByRole("button", { name: "Giriş Yap" }).click();
await adminPage.waitForTimeout(2000);

await adminPage.goto(`${BASE_URL}/admin/firmalar/${providerId}`);
await adminPage.waitForTimeout(2000);
check("Admin firma detay sayfasına ulaştı", adminPage.url().includes(`/admin/firmalar/${providerId}`), adminPage.url());

const initialBadge = await adminPage.locator("text=Aktif").first().isVisible().catch(() => false);
check("Firma başlangıçta 'Aktif' rozetini gösteriyor", initialBadge);

await adminPage.getByRole("button", { name: "Askıya Al" }).click();
await adminPage.waitForTimeout(500);
await adminPage.locator("#admin-company-suspend-reason").fill("0042 tarayıcı testi — gerçek gerekçe");
await adminPage.getByRole("button", { name: "Onayla" }).click();
await adminPage.waitForTimeout(2500);
const suspendedBadge = await adminPage.locator("text=Askıya Alınmış").first().isVisible().catch(() => false);
check("Admin UI üzerinden Askıya Al -> rozet 'Askıya Alınmış' oldu", suspendedBadge);

// Provider tab: NO logout, NO re-login. Just navigate (a real user re-visiting a page).
await providerPage.goto(`${BASE_URL}/panel`);
await providerPage.waitForTimeout(2500);
const providerUrlAfterSuspend = providerPage.url();
const bodyTextAfterSuspend = await providerPage.locator("body").innerText();
const stillShowsRealPanelContent = /Hesap Ayarları|Hoş Geldin|Profilim/.test(bodyTextAfterSuspend);
const redirectedToLogin = providerUrlAfterSuspend.includes("/giris-yap");
console.log("    [debug] URL:", providerUrlAfterSuspend);
console.log("    [debug] body text (first 300 chars):", bodyTextAfterSuspend.slice(0, 300).replace(/\n+/g, " | "));
check(
  "Askıya alınmış provider (aynı oturum, re-login YOK): /panel gerçek panel içeriğini GÖSTERMİYOR (redirect VEYA inline gate)",
  redirectedToLogin || !stillShowsRealPanelContent,
  `url=${providerUrlAfterSuspend} showsRealContent=${stillShowsRealPanelContent}`
);

// Reinstate via admin UI, confirm provider can use the app again.
await adminPage.getByRole("button", { name: "Askıyı Kaldır" }).click();
await adminPage.waitForTimeout(500);
await adminPage.getByRole("button", { name: "Evet, Askıyı Kaldır" }).click();
await adminPage.waitForTimeout(2500);
const reinstatedBadge = await adminPage.locator("text=Aktif").first().isVisible().catch(() => false);
check("Admin UI üzerinden Askıyı Kaldır -> rozet tekrar 'Aktif' oldu", reinstatedBadge);

await providerPage.goto(`${BASE_URL}/giris-yap`);
await providerPage.locator('input[type="email"]').fill(providerEmail);
await providerPage.locator('input[type="password"]').fill(password);
await providerPage.getByRole("button", { name: "Giriş Yap" }).click();
await providerPage.waitForTimeout(2500);
await providerPage.goto(`${BASE_URL}/panel`);
await providerPage.waitForTimeout(1500);
const bodyTextAfterReinstate = await providerPage.locator("body").innerText();
check(
  "Reinstate SONRASI provider tekrar giriş yapıp GERÇEK panel içeriğini görebiliyor",
  providerPage.url().includes("/panel") && /Hesap Ayarları|Hoş Geldin|Profilim/.test(bodyTextAfterReinstate),
  `url=${providerPage.url()}`
);

await browser.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
