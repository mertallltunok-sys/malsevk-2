// Header'daki (yalnızca Hizmet Alan oturumunda görünen) "Hizmet Talebi
// Oluştur" CTA'sının kaldırıldığını, buna karşın ana sayfa Hero'daki ve
// panel'deki AYNI isimli butonların ETKİLENMEDİĞİNİ doğrular. Masaüstü,
// tablet, mobil (320/375/390/414/768/1024/1280px) + logo/sağ-aksiyon
// konumu + konsol hatası kontrolleriyle.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280];

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function login(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
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
    console.log("\n=== Hizmet Alan (Zeynep): header CTA tüm genişliklerde kaldırılmış mı ===");
    const context = await browser.newContext();
    const page = await context.newPage();
    attachDiagnostics(page);
    await login(page, ZEYNEP, "/panel");

    const header = page.locator("header").first();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);

      const headerCtaCount = await header.getByRole("link", { name: "Hizmet Talebi Oluştur" }).count();
      check(`[${width}px] header'da "Hizmet Talebi Oluştur" yok`, headerCtaCount === 0, `bulunan: ${headerCtaCount}`);

      const navCount = await header.locator("nav").count();
      check(`[${width}px] header'ın orta bölümünde hiçbir <nav> yok`, navCount === 0, `bulunan: ${navCount}`);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      check(`[${width}px] yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

      const containerBox = await header.locator("> div").first().boundingBox();
      const logoBox = await header.getByRole("link", { name: /MALSEVK\.COM/ }).first().boundingBox();
      const leftPad = logoBox.x - containerBox.x;
      check(`[${width}px] logo sol kenara hizalı (kaymamış)`, leftPad >= 12 && leftPad <= 36, `dolgu=${leftPad.toFixed(1)}`);

      if (width >= 768) {
        const rightAnchor = header.getByRole("button", { name: /Hizmet Alan/ }).first();
        const rightBox = await rightAnchor.boundingBox();
        const rightPad = containerBox.x + containerBox.width - (rightBox.x + rightBox.width);
        check(`[${width}px] bildirim+profil sağ kenara hizalı (kaymamış)`, rightPad >= 12 && rightPad <= 36, `dolgu=${rightPad.toFixed(1)}`);
      } else {
        const hamburger = header.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
        check(`[${width}px] mobilde hamburger + bildirim zili görünür`, await hamburger.isVisible(), "");
      }
    }
    check("Hizmet Alan: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    console.log("\n=== Ana sayfa Hero'daki 'Hizmet Talebi Oluştur' butonuna DOKUNULMADI mı (Hizmet Alan) ===");
    const heroContext = await browser.newContext();
    const heroPage = await heroContext.newPage();
    attachDiagnostics(heroPage);
    await login(heroPage, ZEYNEP, "/");
    const heroCta = heroPage.locator("main").getByRole("link", { name: "Hizmet Talebi Oluştur" }).first();
    check("Hero'da 'Hizmet Talebi Oluştur' hâlâ mevcut", await heroCta.isVisible(), "");
    check("Hero'daki CTA: konsol hatası yok", heroPage.jsProblems.length === 0, heroPage.jsProblems.join(" | "));
    await heroContext.close();

    console.log("\n=== Panel'deki 'Hizmet Talebi Oluştur' seçeneklerine DOKUNULMADI mı (Hizmet Alan) ===");
    const panelContext = await browser.newContext();
    const panelPage = await panelContext.newPage();
    attachDiagnostics(panelPage);
    await login(panelPage, ZEYNEP, "/panel");
    const panelCtaCount = await panelPage.locator("main").getByRole("link", { name: /Hizmet Talebi Oluştur/ }).count();
    check("Panel içeriğinde en az bir 'Hizmet Talebi Oluştur' seçeneği hâlâ var", panelCtaCount > 0, `bulunan: ${panelCtaCount}`);
    check("Panel: konsol hatası yok", panelPage.jsProblems.length === 0, panelPage.jsProblems.join(" | "));
    await panelContext.close();

    console.log("\n=== Hizmet Veren (Mert): header hâlâ boş, hiç etkilenmemiş ===");
    const merContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mertPage = await merContext.newPage();
    attachDiagnostics(mertPage);
    await login(mertPage, MERT, "/panel");
    const mertNavCount = await mertPage.locator("header").locator("nav").count();
    check("Hizmet Veren header'ında hâlâ hiçbir <nav> yok (etkilenmemiş)", mertNavCount === 0, `bulunan: ${mertNavCount}`);
    check("Hizmet Veren: konsol hatası yok", mertPage.jsProblems.length === 0, mertPage.jsProblems.join(" | "));
    await merContext.close();

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
