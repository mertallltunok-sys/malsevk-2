// node scripts/tmp-nakliye-visual-redesign-screenshot.mjs
//
// "Nakliye Yeniden Tasarımı" görsel düzeltme turu — job-request-form.tsx'in
// Nakliye dalının yeni 7-numaralı-bölüm-kartı yerleşimini GERÇEK Chromium'da
// doğrulamak ve ekran görüntüsü almak için. Ön koşul: `npm run dev` çalışıyor
// olmalı (http://localhost:3000).

import { chromium } from "playwright";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const OUT_DIR = "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\screenshots";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [CONSOLE ERROR]", msg.text());
  });
  page.on("pageerror", (err) => console.log("  [PAGE ERROR]", err.message));

  console.log("Giriş yapılıyor (ilanveren@demo.test)...");
  await loginAs(page, "ilanveren@demo.test", "Demo123!");

  console.log("Hizmet talebi formuna gidiliyor, Nakliye seçiliyor...");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
  await page.waitForTimeout(500);

  console.log("Ekran görüntüsü 1: 1366x768 — formun üst kısmı (Bölüm 1-2)");
  await page.screenshot({ path: path.join(OUT_DIR, "1-top-1366.png") });

  console.log("Ürün/Yük Cinsi ve ambalaj biçimi seçiliyor (Bölüm 3 testi için)...");
  const productTypeInput = page.locator('input[id^="service-productType"]').first();
  if (await productTypeInput.count() > 0) {
    await productTypeInput.fill("Otomotiv Parçası");
  }
  // Paletli + Kasalı/Sandıklı seç
  const packagingTrigger = page.locator('div[id^="nakliye-packaging-"][id$="-types"]').first();
  await packagingTrigger.scrollIntoViewIfNeeded();

  console.log("Ekran görüntüsü 2: 1366x768 — Yük Bilgileri ve Araç Tercihi");
  const section3 = page.getByText("Yük Bilgileri", { exact: true }).first();
  await section3.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, "2-yuk-arac-1366.png") });

  console.log("Ekran görüntüsü 3: 1366x768 — Yükleme ve Teslimat (yan yana mı?)");
  const section5 = page.getByText("Yükleme ve Teslimat", { exact: true }).first();
  await section5.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, "3-yukleme-teslimat-1366.png") });

  console.log("Ekran görüntüsü 4: 1366x768 — tam sayfa");
  await page.screenshot({ path: path.join(OUT_DIR, "4-fullpage-1366.png"), fullPage: true });

  console.log("Mobil görünüme geçiliyor (375px)...");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  console.log("Ekran görüntüsü 5: 375px mobil tam sayfa");
  await page.screenshot({ path: path.join(OUT_DIR, "5-mobile-375-fullpage.png"), fullPage: true });

  // Yatay taşma kontrolü
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`Mobilde yatay taşma: ${hasHorizontalOverflow ? "VAR (SORUN)" : "yok (OK)"}`);

  await browser.close();
  console.log("\nTüm ekran görüntüleri kaydedildi:", OUT_DIR);
}

main().catch((err) => {
  console.error("HATA:", err);
  process.exit(1);
});
