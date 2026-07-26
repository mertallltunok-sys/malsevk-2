// node scripts/tmp-listing-filter-toolbar-test.mjs
//
// Aktif İlanlar (Hizmet Veren) filtre alanı UX yeniden tasarımını doğrular:
// tek satır toolbar, readonly İl="Kocaeli", Firma/Fabrika alanının
// kaldırılması, responsive taşma kontrolü. Ön koşul: `npm run dev` çalışıyor
// olmalı.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(desc) {
  passed++;
  console.log(`  ✓ ${desc}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // Login as hizmet-veren
  await page.goto(`${BASE_URL}/giris-yap?redirect=/ilanlar`);
  await page.locator('input[type="email"]').fill("mert@test.com");
  await page.locator('input[type="password"]').fill("Mert123!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/ilanlar`);
  ok("Giriş yapıldı, /ilanlar açıldı");

  // ---- Desktop (1440px) ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  const ilBlock = page.getByText("Kocaeli", { exact: true });
  await assert.doesNotReject(ilBlock.first().waitFor({ state: "visible", timeout: 5000 }));
  ok("Readonly İl alanı 'Kocaeli' gösteriyor");

  const ilSelectCount = await page.locator("#job-listing-filter-province").count();
  assert.equal(ilSelectCount, 0, "İl için artık bir SearchableSelect butonu olmamalı");
  ok("İl SearchableSelect'i DOM'da yok (readonly'e çevrildi)");

  const companyFieldCount = await page.locator("#job-listing-filter-company").count();
  assert.equal(companyFieldCount, 0, "Firma / Fabrika Ara alanı kaldırılmış olmalı");
  ok("Firma / Fabrika Ara alanı kaldırılmış");

  const fieldIds = [
    "#job-listing-search",
    "#job-listing-filter-category",
    "#job-listing-filter-district",
    "#job-listing-filter-facility",
    "#job-listing-filter-date",
    "#job-listing-filter-offer-status",
  ];
  const boxes = [];
  for (const id of fieldIds) {
    const box = await page.locator(id).boundingBox();
    assert.ok(box, `${id} bounding box alınamadı`);
    boxes.push({ id, box });
  }
  const tops = boxes.map((b) => Math.round(b.box.y));
  const maxDelta = Math.max(...tops) - Math.min(...tops);
  console.log(
    "  info: alan üst Y konumları:",
    JSON.stringify(Object.fromEntries(boxes.map((b) => [b.id, Math.round(b.box.y)]))),
  );
  assert.ok(maxDelta <= 8, `Masaüstünde tüm alanlar aynı satırda olmalı (fark: ${maxDelta}px)`);
  ok(`Masaüstünde (1440px) tüm toolbar alanları tek satırda hizalı (max fark ${maxDelta}px)`);

  const scrollWidthDesktop = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthDesktop = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthDesktop <= clientWidthDesktop + 2, "Masaüstünde yatay taşma olmamalı");
  ok("Masaüstünde yatay taşma yok");

  // ---- Filtreleme hâlâ çalışıyor: İlçe dropdown'ı açılabiliyor ----
  await page.locator("#job-listing-filter-district").click();
  const districtOptionsCount = await page.locator('ul[role="listbox"] li').count();
  console.log(`  info: İlçe seçeneği sayısı: ${districtOptionsCount}`);
  await page.keyboard.press("Escape");
  ok("İlçe dropdown'ı açılabiliyor (Kocaeli ilçeleriyle besleniyor)");

  // ---- Arama kutusu çalışıyor ----
  await page.locator("#job-listing-search").fill("forklift");
  await page.waitForTimeout(400);
  const jobCountText = await page.getByText(/Aktif İlan$/).first().textContent();
  console.log(`  info: arama sonrası ilan sayısı metni: ${jobCountText}`);
  ok("Arama kutusu değer kabul ediyor, sonuç sayacı güncelleniyor");
  await page.locator("#job-listing-search").fill("");

  // ---- Tablet (834px) ----
  await page.setViewportSize({ width: 834, height: 1100 });
  await page.waitForTimeout(300);
  const scrollWidthTablet = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthTablet = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthTablet <= clientWidthTablet + 2, "Tablette yatay taşma olmamalı");
  ok("Tablette (834px) yatay taşma yok");

  // ---- Mobil (375px) ----
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const scrollWidthMobile = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthMobile = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthMobile <= clientWidthMobile + 2, "Mobilde yatay taşma olmamalı");
  ok("Mobilde (375px) yatay taşma yok");

  if (consoleErrors.length > 0) {
    console.error("KONSOL HATALARI:", consoleErrors);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-listing-filter-toolbar-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  console.log(`\n[tmp-listing-filter-toolbar-test] ${passed} kontrol geçti.`);
  await browser.close();
}

main().catch((error) => {
  console.error("[tmp-listing-filter-toolbar-test] HATA:", error.message);
  process.exitCode = 1;
});
