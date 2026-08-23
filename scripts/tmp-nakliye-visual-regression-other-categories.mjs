// node scripts/tmp-nakliye-visual-regression-other-categories.mjs
// Nakliye görsel düzeltmesinin diğer kategorilere (Depolama, Liman Hizmetleri)
// SIZMADIĞINI doğrular — eski tek-kart görünümü hâlâ AYNI olmalı.
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

function ok(msg) { console.log("  \u2713", msg); }
function fail(msg) { console.log("  \u2717 FAIL:", msg); process.exitCode = 1; }

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  page.on("pageerror", (err) => fail("Page error: " + err.message));

  await loginAs(page, "ilanveren@demo.test", "Demo123!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("kapali-depolama");
  await page.waitForTimeout(400);

  // Depolama kartında numaralı SectionCard YOK, eski tek dev kart hâlâ var olmalı
  const numberedSections = await page.locator("span", { hasText: /^[1-7]$/ }).count();
  if (numberedSections === 0) ok("Depolama'da yeni numaralı bölüm kartları YOK (regresyon yok)"); else fail(`Depolama'da ${numberedSections} numaralı bölüm bulundu — Nakliye görünümü sızmış olabilir`);

  const singleCard = await page.locator(".rounded-md.border.border-border.bg-surface.p-4").count();
  if (singleCard > 0) ok("Depolama hâlâ eski tek-kart (rounded-md border p-4) yapısını kullanıyor"); else fail("Depolama'nın eski tek-kart yapısı bulunamadı");

  await page.screenshot({ path: path.join(OUT_DIR, "regression-depolama.png"), fullPage: true });

  // Liman Hizmetleri (lashing-unlashing) de kontrol edelim
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("lashing-unlashing");
  await page.waitForTimeout(400);
  const limanNumbered = await page.locator("span", { hasText: /^[1-7]$/ }).count();
  if (limanNumbered === 0) ok("Liman Hizmetleri'nde (Lashing) yeni numaralı bölüm kartları YOK (regresyon yok)"); else fail(`Liman Hizmetleri'nde ${limanNumbered} numaralı bölüm bulundu`);
  await page.screenshot({ path: path.join(OUT_DIR, "regression-liman.png"), fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error("HATA:", err);
  process.exit(1);
});
