// PRODUCTION doğrulaması: https://malsevk-2.vercel.app Panel Özeti'ndeki
// "Kabul Edilen Teklifler / Devam Eden İşler / Tamamlanan İşler" kartlarının
// "Yakında" etiketi olmadan, tamamen tıklanabilir şekilde çalıştığını
// doğrular.
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const PROVIDER = { name: "Prod Stat Provider", email: `prod-stat-prov-${STAMP}@test.com`, phone: "0533 444 55 66", password: "Provider1!", role: "hizmet-veren" };

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
  await page.getByRole("radio", { name: "Hizmet Veren" }).check();
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

const CARDS = [
  { label: "Kabul Edilen Teklifler", expectedUrlPattern: /durum=kabul-edildi/ },
  { label: "Devam Eden İşler", expectedUrlPattern: /durum=devam-eden/ },
  { label: "Tamamlanan İşler", expectedUrlPattern: /durum=tamamlandi/ },
];

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);
    await registerAs(page, PROVIDER);

    const mainText = await page.locator("main").innerText();
    check('"Yakında" metni panelde yok (PRODUCTION)', !mainText.includes("Yakında"));

    for (const { label, expectedUrlPattern } of CARDS) {
      console.log(`\n=== '${label}' kartı (PRODUCTION) ===`);
      await page.goto(`${BASE_URL}/panel`);
      const card = page.getByRole("link").filter({ hasText: label }).first();
      await card.waitFor({ state: "visible" });
      const cardHref = await card.getAttribute("href");
      check("href gerçek route", Boolean(cardHref) && cardHref !== "#" && !cardHref.startsWith("javascript:"), `href="${cardHref}"`);
      await card.click();
      await page.waitForURL(expectedUrlPattern, { timeout: 10000 }).catch(() => {});
      check("doğru route'a gitti", expectedUrlPattern.test(page.url()), `url=${page.url()}`);
      check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    }

    check("Genel: konsol hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
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
