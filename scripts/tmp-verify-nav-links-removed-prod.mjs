// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde "Hizmetler"
// ve "İlanlar" üst navigasyon bağlantılarının kaldırılmasını, anonim +
// Hizmet Alan + Hizmet Veren görünümlerinde ve mobil menüde yeniden
// doğrular. Prod'da DEV_ACCOUNTS seed edilmediği için taze hesaplar
// kaydedilir (bkz. tmp-verify-menu-gallery-prod.mjs'teki aynı desen).
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Nav Requester", email: `prod-nav-req-${STAMP}@test.com`, phone: "0532 111 22 33", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Nav Provider", email: `prod-nav-prov-${STAMP}@test.com`, phone: "0533 444 55 66", password: "Provider1!", role: "hizmet-veren" };
const WIDTHS = [375, 1280];
const REMOVED_LABELS = ["Hizmetler", "İlanlar"];

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
  await page.getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" }).check();
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

async function checkHeader(page, label) {
  const header = page.locator("header").first();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const headerText = await header.innerText();
    for (const removed of REMOVED_LABELS) {
      check(`[${label} @ ${width}px] "${removed}" header'da yok`, !headerText.includes(removed), headerText.includes(removed) ? "BULUNDU!" : "");
    }
    // "Nasıl Çalışır" masaüstü <nav>'ı yalnızca md+ genişlikte (md:flex)
    // görünür — mobil genişlikte nav'ın kendisi (tasarım gereği, bu
    // görevden bağımsız olarak) gizlidir, bu yüzden yalnızca masaüstü nav
    // görünürken kontrol edilir.
    const isDesktopNav = await header.getByRole("navigation", { name: "Ana menü" }).isVisible().catch(() => false);
    if (isDesktopNav) {
      check(`[${label} @ ${width}px] "Nasıl Çalışır" hâlâ mevcut`, headerText.includes("Nasıl Çalışır"), "");
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    check(`[${label} @ ${width}px] yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
  }
}

async function checkMobileMenu(page, label) {
  await page.setViewportSize({ width: 375, height: 812 });
  const hamburger = page.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
  await hamburger.click();
  await page.waitForTimeout(300);
  check(`[${label}] mobil menü açılıyor`, (await hamburger.getAttribute("aria-expanded")) === "true", "");
  const panel = page.locator("#mobil-menu-panel");
  for (const removed of REMOVED_LABELS) {
    const count = await panel.getByRole("link", { name: removed, exact: true }).count();
    check(`[${label}] mobil menüde "${removed}" (tam eşleşme) yok`, count === 0, `bulunan: ${count}`);
  }
  await hamburger.click();
  await page.waitForTimeout(300);
  check(`[${label}] mobil menü kapanıyor`, (await hamburger.getAttribute("aria-expanded")) === "false", "");
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);

    console.log("\n=== Anonim (PRODUCTION) ===");
    const anonContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const anonPage = await anonContext.newPage();
    attachDiagnostics(anonPage);
    await anonPage.goto(BASE_URL);
    await checkHeader(anonPage, "Anonim ana sayfa");
    await anonPage.goto(`${BASE_URL}/giris-yap`);
    await checkHeader(anonPage, "Giriş sayfası");
    await anonPage.goto(`${BASE_URL}/giris-yap?mode=kayit`);
    await checkHeader(anonPage, "Kayıt sayfası");
    await checkMobileMenu(anonPage, "Anonim");
    check("Anonim: konsol hatası yok", anonPage.jsProblems.length === 0, anonPage.jsProblems.join(" | "));
    await anonContext.close();

    console.log("\n=== Hizmet Alan (PRODUCTION, taze hesap) ===");
    const reqContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const reqPage = await reqContext.newPage();
    attachDiagnostics(reqPage);
    await registerAs(reqPage, REQUESTER);
    await checkHeader(reqPage, "Hizmet Alan /panel");
    await checkMobileMenu(reqPage, "Hizmet Alan");
    check("Hizmet Alan: konsol hatası yok", reqPage.jsProblems.length === 0, reqPage.jsProblems.join(" | "));
    await reqContext.close();

    console.log("\n=== Hizmet Veren (PRODUCTION, taze hesap) ===");
    const provContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const provPage = await provContext.newPage();
    attachDiagnostics(provPage);
    await registerAs(provPage, PROVIDER);
    await checkHeader(provPage, "Hizmet Veren /panel");
    await checkMobileMenu(provPage, "Hizmet Veren");
    check("Hizmet Veren: konsol hatası yok", provPage.jsProblems.length === 0, provPage.jsProblems.join(" | "));
    await provContext.close();

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
