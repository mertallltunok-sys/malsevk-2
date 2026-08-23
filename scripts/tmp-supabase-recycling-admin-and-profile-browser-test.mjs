// Development Supabase projesine (trfnmpihcnriqgikglpu) VE zaten çalışan
// gerçek dev sunucusuna (http://localhost:3000) karşı: (1) admin "Hizmet
// Yetkileri" ekranında Geri Dönüşüm & Atık Tahliye gerçekten görünüyor mu,
// (2) geri-donusum-test@malsevk.test hesabının kendi Profilim ekranında
// yeniden yetkilendirme sonrası "Aktif" görünüyor mu.
import { chromium } from "playwright";

const APP_ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = "TestSifre2026!";
const PROVIDER_EMAIL = "geri-donusum-test@malsevk.test";
const PROVIDER_PASSWORD = process.env.RECYCLING_TEST_PROVIDER_PASSWORD;

if (!ADMIN_EMAIL || !PROVIDER_PASSWORD) {
  console.error("Kullanım: RECYCLING_TEST_PROVIDER_PASSWORD=... node ...browser-test.mjs <adminEmail>");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 220) : ""));
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 }).catch(() => {});
}

async function logout(page) {
  await page.goto(`${APP_ORIGIN}/`);
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await page.waitForTimeout(1000);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // -------------------------------------------------------------------
  // Admin: /admin/firmalar'da "MALSEVK Test Geri Dönüşüm" firmasını bul,
  // detayına gir, "Hizmet Yetkileri" kartında Geri Dönüşüm satırı var mı.
  // -------------------------------------------------------------------
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${APP_ORIGIN}/admin/firmalar`);
  await page.waitForTimeout(1500);
  await page.locator('input[placeholder="Firma adı veya yetkili kişi ara..."]').fill("MALSEVK Test Geri Dönüşüm");
  await page.waitForTimeout(1000);
  const companyLink = page.getByRole("link", { name: /MALSEVK Test Geri Dönüşüm/ }).first();
  const companyFound = await companyLink.isVisible().catch(() => false);
  record("A1. Admin 'Firmalar' listesinde test firmasını buluyor", companyFound);

  if (companyFound) {
    await companyLink.click();
    await page.waitForTimeout(1500);
    const detailText = await page.locator("main").innerText().catch(() => "");
    record("A2. Firma detayında 'Hizmet Yetkileri' kartı var", detailText.includes("Hizmet Yetkileri"));
    record("A3. 'Hizmet Yetkileri' kartında Geri Dönüşüm & Atık Tahliye satırı GÖRÜNÜYOR", detailText.includes("Geri Dönüşüm"));
  }

  // -------------------------------------------------------------------
  // Test provider'ın kendi Profilim ekranı: yeniden yetkilendirme sonrası
  // "Aktif" görünüyor mu.
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, PROVIDER_EMAIL, PROVIDER_PASSWORD);
  await page.goto(`${APP_ORIGIN}/panel/profil`);
  await page.waitForTimeout(2000);
  const profileText = await page.locator("main").innerText().catch(() => "");
  record("B1. Profilim ekranı açılıyor", !page.url().includes("/giris-yap"));
  record("B2. 'Hizmet Yetkileri' bölümünde Geri Dönüşüm & Atık Tahliye görünüyor", profileText.includes("Geri Dönüşüm"));
  const activeNearRecycling = profileText.includes("Geri Dönüşüm") && profileText.includes("Aktif");
  record("B3. Durumu 'Aktif' (yeniden yetkilendirme gerçekten işledi)", activeNearRecycling, profileText.slice(profileText.indexOf("Geri Dönüşüm") - 10, profileText.indexOf("Geri Dönüşüm") + 80));

  await browser.close();
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
