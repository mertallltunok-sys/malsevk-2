// "Aktif İlanlar" ekranının istenen genişliklerde (320/375/390/414/768/1024/1440)
// yatay scroll oluşturmadığını, 1024px altında kart / üstünde tablo
// görünümüne geçtiğini doğrular.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1440];

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/ilanlar") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);
    await loginAs(page, MERT, "/ilanlar");
    const storageState = await context.storageState();
    await context.close();

    for (const width of WIDTHS) {
      const rContext = await browser.newContext({ viewport: { width, height: 900 }, storageState });
      const rPage = await rContext.newPage();
      attachDiagnostics(rPage);
      await rPage.goto(`${BASE_URL}/ilanlar`);
      await rPage.getByRole("heading", { name: "Aktif İlanlar" }).waitFor({ state: "visible", timeout: 10000 });

      const scrollWidth = await rPage.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await rPage.evaluate(() => document.documentElement.clientWidth);
      check(`${width}px: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

      const tableVisible = await rPage.locator("table").isVisible().catch(() => false);
      const cardsVisible = await rPage.locator('ul[role="list"]').first().isVisible().catch(() => false);
      if (width >= 1024) {
        check(`${width}px: masaüstü tablo görünümü aktif`, tableVisible);
        check(`${width}px: mobil kart görünümü PASİF`, !cardsVisible);
      } else {
        check(`${width}px: mobil kart görünümü aktif`, cardsVisible);
        check(`${width}px: masaüstü tablo görünümü PASİF`, !tableVisible);
      }

      check(`${width}px: konsol hatası yok`, rPage.jsProblems.length === 0, rPage.jsProblems.join(" | "));
      await rContext.close();
    }

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
