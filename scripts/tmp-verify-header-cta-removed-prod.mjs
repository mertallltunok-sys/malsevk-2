// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde header'daki
// "Hizmet Talebi Oluştur" CTA'sının Hizmet Alan oturumunda kaldırıldığını,
// Hero ve panel'deki aynı isimli butonların etkilenmediğini doğrular.
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod CTA Requester", email: `prod-cta-req-${STAMP}@test.com`, phone: "0532 111 22 33", password: "Requester1!", role: "hizmet-alan" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.type(text);
}

async function registerAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=${encodeURIComponent(redirect)}`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await typeInto(page, page.getByLabel("Ad Soyad"), account.name);
  await typeInto(page, page.getByLabel("E-posta"), account.email);
  await typeInto(page, page.getByLabel("Telefon Numarası"), account.phone);
  await typeInto(page, page.getByLabel("Şifre", { exact: true }), account.password);
  await typeInto(page, page.getByLabel("Şifre Tekrar"), account.password);
  await page.getByRole("radio", { name: "Hizmet Alan" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
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
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    await registerAs(page, REQUESTER);
    const header = page.locator("header").first();

    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const ctaCount = await header.getByRole("link", { name: "Hizmet Talebi Oluştur" }).count();
      check(`[${width}px] header'da CTA yok (PRODUCTION)`, ctaCount === 0, `bulunan: ${ctaCount}`);
      const navCount = await header.locator("nav").count();
      check(`[${width}px] header ortası boş (nav yok, PRODUCTION)`, navCount === 0, `bulunan: ${navCount}`);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      check(`[${width}px] yatay taşma yok`, scrollWidth <= clientWidth + 1, "");
    }

    await page.goto(`${BASE_URL}/`);
    const heroCta = page.locator("main").getByRole("link", { name: "Hizmet Talebi Oluştur" }).first();
    check("Hero'daki CTA hâlâ mevcut (PRODUCTION, dokunulmadı)", await heroCta.isVisible(), "");

    await page.goto(`${BASE_URL}/panel`);
    const panelCtaCount = await page.locator("main").getByRole("link", { name: /Hizmet Talebi Oluştur/ }).count();
    check("Panel'deki CTA(lar) hâlâ mevcut (PRODUCTION, dokunulmadı)", panelCtaCount > 0, `bulunan: ${panelCtaCount}`);

    check("Konsol hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ (PRODUCTION)." : "\nSONUÇ: TÜM KONTROLLER PRODUCTION'DA DA GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify-prod] GENEL HATA:", error);
  process.exitCode = 1;
});
