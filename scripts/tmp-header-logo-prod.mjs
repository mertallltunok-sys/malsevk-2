// node scripts/tmp-header-logo-prod.mjs
//
// Header logosunun (public/logo/ms-logo.svg) gerçek bir production
// derlemesinde (npm run build && npm start -- -p 3100) de doğru
// çalıştığını doğrular: site-wide şifre kapısının arkasında statik
// dosya yolu (/logo/ms-logo.svg) düzgün servis ediliyor mu, <img>
// gerçekten yükleniyor mu, masaüstü + mobil. Aynı desen: diğer
// tmp-*-prod.mjs script'leri (MALSEVK_SITE_PASSWORD .env.local'da
// TestSifre2026! ile eşleşiyor olmalı).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3100";
const TEST_PASSWORD = "TestSifre2026!";
let passed = 0;

function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const logoResponses = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("response", (res) => {
    if (res.url().includes("ms-logo.svg")) logoResponses.push(res);
  });

  // 1) Şifresiz istek kapıya yönleniyor (statik dosyalar dahil sayfa isteği).
  await page.goto(`${BASE_URL}/`);
  await page.waitForURL(`${BASE_URL}/site-erisim?next=%2F`);
  ok("[1] Şifresiz istek /site-erisim'e yönleniyor");

  // 2) Doğru şifre ile kapı geçiliyor.
  await page.getByLabel("Şifre").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
  ok("[2] Doğru şifre ile ana sayfaya erişildi");

  // 3) Masaüstü: logo statik dosyası gerçekten yükleniyor (200, doğru content-type).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const img = page.locator('header a[href="/"] img').first();
  await assert.doesNotReject(img.waitFor({ state: "visible", timeout: 10000 }));
  const naturalWidth = await img.evaluate((el) => el.naturalWidth);
  assert.ok(naturalWidth > 0, "prod modda logo <img> yüklenmedi (naturalWidth 0)");
  assert.ok(logoResponses.length > 0, "/logo/ms-logo.svg için hiç network isteği yakalanmadı");
  const lastLogoResponse = logoResponses[logoResponses.length - 1];
  assert.equal(lastLogoResponse.status(), 200);
  const contentType = lastLogoResponse.headers()["content-type"] || "";
  assert.ok(contentType.includes("svg"), `beklenmeyen content-type: ${contentType}`);
  const desktopBrandText = (await page.locator('header a[href="/"] span').first().innerText()).trim();
  assert.equal(desktopBrandText, "MALSEVK.com", `masaüstünde marka metni "MALSEVK.com" değil: "${desktopBrandText}"`);
  ok(`[3] Masaüstü: /logo/ms-logo.svg 200 (content-type: ${contentType}), <img> naturalWidth=${naturalWidth}, "MALSEVK.com" tam görünüyor`);

  // 4) Mobil: aynı kontrol + "MALSEVK.com" metninin tam ve kırpılmadan
  // göründüğü doğrulanır (en dar yaygın genişlik olan 320px'te de).
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await assert.doesNotReject(img.waitFor({ state: "visible", timeout: 10000 }));
    const mobileNaturalWidth = await img.evaluate((el) => el.naturalWidth);
    assert.ok(mobileNaturalWidth > 0, `prod modda ${width}px'te logo <img> yüklenmedi`);

    const brandSpan = page.locator('header a[href="/"] span').first();
    const brandText = (await brandSpan.innerText()).trim();
    assert.equal(brandText, "MALSEVK.com", `${width}px'te marka metni "MALSEVK.com" değil: "${brandText}"`);
    const overflowInfo = await brandSpan.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      width: el.getBoundingClientRect().width,
    }));
    assert.ok(
      overflowInfo.width >= overflowInfo.scrollWidth - 1,
      `${width}px'te "MALSEVK.com" kırpılmış olabilir: ${JSON.stringify(overflowInfo)}`,
    );
    ok(`[4] Mobil (${width}px): logo prod modda yükleniyor, "MALSEVK.com" tam ve kırpılmadan görünüyor`);
  }

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-header-logo-prod] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-header-logo-prod] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[tmp-header-logo-prod] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-header-logo-prod] HATA:", error);
  process.exitCode = 1;
});
