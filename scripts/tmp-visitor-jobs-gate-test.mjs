// Oturum acilmamis ziyaretcide ana sayfadaki 3 ayri "Is Ilanlarini Incele"
// CTA'sinin (Hero, RoleCardsSection Hizmet Veren karti, alt lacivert CTA)
// dogrudan /ilanlar'a gitmek yerine giris-gerekli modalini actigini,
// Hizmet Alan/Hizmet Veren rol davranisinin bozulmadigini ve responsive/
// erisilebilirlik kurallarinin korundugunu dogrulayan tek seferlik script.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280];

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function login(page, account) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent("/")}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

async function verifyModal(page, label, triggerLocator) {
  const before = page.url();

  // Art arda tetikleme: ayni DOM elemanina, React henuz re-render/kapatma
  // overlay'i cizmeden ONCE, iki gercek click event'i art arda gonderilir
  // (elementHandle uzerinde native .click() x2, ayni senkron cagri icinde) —
  // boylece modal acildiktan SONRA overlay'in orijinal butonu kaplamasi
  // yuzunden ikinci Playwright click'inin yanlislikla backdrop'a inmesi
  // (ve modali kapatmasi) riski olmadan gercek "cift tiklama" senaryosu
  // dogru simule edilir.
  const handle = await triggerLocator.elementHandle();
  await handle.evaluate((el) => {
    el.click();
    el.click();
  });
  await page.waitForTimeout(250);

  const dialog = page.getByRole("dialog");
  check(`${label}: modal acildi`, (await dialog.count()) === 1, "");
  check(`${label}: URL degismedi (navigasyon olmadi)`, page.url() === before, page.url());

  const heading = dialog.getByText("İlanları görüntülemek için giriş yapmalısınız.");
  check(`${label}: ana mesaj dogru`, (await heading.count()) === 1, "");
  const desc = dialog.getByText("İş ilanlarını incelemek ve teklif vermek için hesabınıza giriş yapın veya yeni hesap oluşturun.");
  check(`${label}: alt aciklama dogru`, (await desc.count()) === 1, "");

  const loginLink = dialog.getByRole("link", { name: "Giriş Yap", exact: true });
  const registerLink = dialog.getByRole("link", { name: "Kayıt Ol", exact: true });
  check(`${label}: "Giriş Yap" var`, (await loginLink.count()) === 1, "");
  check(`${label}: "Kayıt Ol" var`, (await registerLink.count()) === 1, "");
  check(`${label}: Giriş Yap href dogru (/ilanlar redirect)`, (await loginLink.getAttribute("href")) === "/giris-yap?redirect=%2Filanlar", await loginLink.getAttribute("href"));
  check(`${label}: Kayıt Ol href dogru (/ilanlar redirect)`, (await registerLink.getAttribute("href")) === "/giris-yap?mode=kayit&redirect=%2Filanlar", await registerLink.getAttribute("href"));
  check(`${label}: iki hizli tiklama sonrasi hala TEK modal var (render hatasi yok)`, (await page.getByRole("dialog").count()) === 1, "");

  // Escape ile kapanma.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(`${label}: Escape ile modal kapaniyor`, (await page.getByRole("dialog").count()) === 0, "");
  check(`${label}: kapaninca URL hala anasayfada`, page.url() === before, page.url());

  // Tekrar ac, bu sefer backdrop'a tiklayarak kapat.
  await triggerLocator.click();
  await page.waitForTimeout(200);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(200);
  check(`${label}: backdrop tiklamasiyla kapaniyor`, (await page.getByRole("dialog").count()) === 0, "");
}

async function main() {
  const browser = await chromium.launch();
  try {
    // --- Anonim: 3 CTA konumu ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await page.goto(BASE_URL);

      console.log("\n[1] Hero 'İş İlanlarını İncele' butonu");
      await verifyModal(page, "Hero", page.locator("section").first().getByRole("button", { name: "İş İlanlarını İncele" }));

      console.log("\n[2] RoleCardsSection Hizmet Veren kartı");
      const roleCardsSection = page.locator("section", { has: page.getByRole("heading", { name: "Size uygun başlangıcı seçin" }) });
      await verifyModal(page, "RoleCards", roleCardsSection.getByRole("button", { name: /İş ilanlarını incele/ }));

      console.log("\n[3] Alt lacivert CTA");
      const finalCtaSection = page.locator("section", { has: page.getByRole("heading", { name: "Lojistik hizmet ihtiyacınızı bugün oluşturun" }) });
      await verifyModal(page, "FinalCta", finalCtaSection.getByRole("button", { name: "İş İlanlarını İncele" }));

      // "Hizmet Talebi Oluştur" davranışı bozulmamış mı (hâlâ normal navigasyon + hedef sayfada kendi gate'i).
      console.log("\n[4] 'Hizmet Talebi Oluştur' bozulmadı mı");
      await page.goto(BASE_URL);
      await page.locator("section").first().getByRole("link", { name: "Hizmet Talebi Oluştur" }).click();
      await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
      check("Hizmet Talebi Oluştur: normal navigasyon çalışıyor", page.url() === `${BASE_URL}/hizmet-talebi-olustur`, page.url());
      const inlineGate = page.getByText("İlan oluşturmak için giriş yapmalısınız.");
      check("Hizmet Talebi Oluştur: hedef sayfada kendi (satır içi) gate'i hâlâ çalışıyor", (await inlineGate.count()) === 1, "");

      check("Anonim: konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));

      // Responsive.
      console.log("\n[5] Responsive (modal açıkken)");
      await page.goto(BASE_URL);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(120);
        await page.locator("section").first().getByRole("button", { name: "İş İlanlarını İncele" }).click();
        await page.waitForTimeout(200);
        const dialogBox = await page.getByRole("dialog").locator("> div").boundingBox();
        check(`@ ${width}px: modal viewport içinde`, dialogBox !== null && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= width + 1, dialogBox ? `x=${dialogBox.x.toFixed(1)}, width=${dialogBox.width.toFixed(1)}` : "yok");
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        check(`@ ${width}px: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(120);
      }

      await context.close();
    }

    // --- Hizmet Alan: rol bazlı Hero bozulmamış mı ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, ZEYNEP);
      page.jsProblems = [];
      await page.waitForTimeout(300);
      const heading = await page.locator("section").first().locator("h1").textContent();
      check("Hizmet Alan: Hero başlığı bozulmadı", heading?.trim() === "Lojistik hizmet ihtiyacınızı kolayca karşılayın", heading);
      const hasJobsButton = await page.locator("section").first().getByRole("link", { name: "İş İlanlarını İncele" }).count();
      check("Hizmet Alan: Hero'da 'İş İlanlarını İncele' yok", hasJobsButton === 0, `bulunan: ${hasJobsButton}`);
      const roleCardsGone = await page.getByRole("heading", { name: "Size uygun başlangıcı seçin" }).count();
      check("Hizmet Alan: RoleCardsSection hâlâ gizli", roleCardsGone === 0, "");
      check("Hizmet Alan: konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
      await context.close();
    }

    // --- Hizmet Veren: "İş İlanlarını İncele" normal navigasyon yapmalı ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, MERT);
      page.jsProblems = [];
      await page.waitForTimeout(300);
      const heading = await page.locator("section").first().locator("h1").textContent();
      check("Hizmet Veren: Hero başlığı bozulmadı", heading?.trim() === "Uzmanlığınıza uygun iş fırsatlarını keşfedin", heading);

      await page.locator("section").first().getByRole("link", { name: "İş İlanlarını İncele" }).click();
      await page.waitForURL(`${BASE_URL}/ilanlar`);
      check("Hizmet Veren: 'İş İlanlarını İncele' doğrudan /ilanlar'a gidiyor (modal yok)", page.url() === `${BASE_URL}/ilanlar`, page.url());
      check("Hizmet Veren: konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(anyFail ? "\nSONUC: EN AZ BIR KONTROL BASARISIZ." : "\nSONUC: TUM KONTROLLER GECTI.");
  if (anyFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
