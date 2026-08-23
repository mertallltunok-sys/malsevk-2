// node scripts/tmp-nakliye-visual-support-button-check.mjs
// Canlı destek butonunun gerçek scroll pozisyonlarında herhangi bir alanı
// örtüp örtmediğini (fullPage stitch artefaktı DEĞİL, gerçek viewport) kontrol eder.
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
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  await loginAs(page, "ilanveren@demo.test", "Demo123!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
  await page.waitForTimeout(500);

  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const y = Math.round((total / (steps - 1)) * i);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, `mobile-scroll-${i}.png`) });
  }

  // Support button bounding box vs. every visible interactive control's bounding box overlap check
  const overlaps = await page.evaluate(() => {
    const supportBtn = document.querySelector('a[href*="wa.me"]');
    if (!supportBtn) return { found: false };
    const sRect = supportBtn.getBoundingClientRect();
    const controls = Array.from(document.querySelectorAll("input, select, textarea, button"));
    const hits = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const overlap = !(r.right < sRect.left || r.left > sRect.right || r.bottom < sRect.top || r.top > sRect.bottom);
      if (overlap) hits.push(el.tagName + (el.id ? "#" + el.id : "") + (el.textContent ? ":" + el.textContent.trim().slice(0, 30) : ""));
    }
    return { found: true, rect: sRect, hits };
  });
  console.log("Canlı destek buton çakışma kontrolü:", JSON.stringify(overlaps, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error("HATA:", err);
  process.exit(1);
});
