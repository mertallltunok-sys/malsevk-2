// "Is Ilanlarini Incele" akisinin artik modal ACMADIGINI, bunun yerine
// /ilanlar sayfasinin "Hizmet Talebi Olustur" ile ayni tasarim sistemini
// (PageCardShell + AuthGateNotice, GuestAccessCard) paylasan tam sayfa
// giris-gerekli karti gosterdigini dogrulayan tek seferlik script.
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

async function verifyNoModalDirectNavigation(page, label, triggerLocator, expectUrl) {
  await triggerLocator.click();
  await page.waitForURL(expectUrl);
  check(`${label}: modal yok, dogrudan navigasyon oldu`, page.url() === expectUrl, page.url());
  const dialogCount = await page.getByRole("dialog").count();
  check(`${label}: sayfada acik modal yok`, dialogCount === 0, `bulunan: ${dialogCount}`);
  // NOT: mobile-menu.tsx kendi (her zaman DOM'da duran, yalnizca opacity-0
  // ile gizlenen) bg-black/50 perdesini tasir — bu yuzden DOM'da var olup
  // olmamasi degil, GORUNUR (opacity>0) olup olmamasi kontrol edilir.
  const visibleBackdrop = await page.locator(".bg-black\\/50").evaluateAll((els) =>
    els.filter((el) => getComputedStyle(el).opacity !== "0").length,
  );
  check(`${label}: arka plan kararma katmani görünmüyor`, visibleBackdrop === 0, `bulunan: ${visibleBackdrop}`);
}

async function verifyGuestGatePage(page, label) {
  console.log(`\n[${label}] /ilanlar giris-gerekli sayfasi`);
  const h1 = await page.locator("h1").first().textContent();
  check(`${label}: sayfa basligi dogru`, h1?.trim() === "İş İlanlarını İncele", h1);
  const pageDesc = await page.getByText("Uzmanlık alanınıza uygun lojistik hizmet taleplerini inceleyin ve uygun işlere teklif verin.").count();
  check(`${label}: sayfa aciklamasi dogru`, pageDesc === 1, "");
  const cardTitle = await page.getByText("İlanları görüntülemek için giriş yapmalısınız.").count();
  check(`${label}: kart basligi dogru`, cardTitle === 1, "");
  const cardDesc = await page.getByText("İş ilanlarını incelemek ve hizmet taleplerine teklif verebilmek için hesabınıza giriş yapın veya yeni bir hesap oluşturun.").count();
  check(`${label}: kart aciklamasi dogru`, cardDesc === 1, "");
  const lockIcon = await page.locator("svg.lucide-lock").count();
  check(`${label}: kilit ikonu var`, lockIcon === 1, "");
  const main = page.locator("main");
  const loginLink = main.getByRole("link", { name: "Giriş Yap", exact: true });
  const registerLink = main.getByRole("link", { name: "Kayıt Ol", exact: true });
  check(`${label}: "Giriş Yap" var`, (await loginLink.count()) === 1, "");
  check(`${label}: "Kayıt Ol" var`, (await registerLink.count()) === 1, "");
  check(`${label}: Giriş Yap href /ilanlar redirect`, (await loginLink.getAttribute("href")) === "/giris-yap?redirect=%2Filanlar", await loginLink.getAttribute("href"));
  check(`${label}: Kayıt Ol href /ilanlar redirect`, (await registerLink.getAttribute("href")) === "/giris-yap?mode=kayit&redirect=%2Filanlar", await registerLink.getAttribute("href"));

  const header = await page.locator("header").count();
  const footer = await page.locator("footer").count();
  check(`${label}: Header mevcut`, header === 1, "");
  check(`${label}: Footer mevcut`, footer === 1, "");

  const outerCard = page.locator("div.rounded-card.border.bg-surface.p-6.sm\\:p-8").first();
  check(`${label}: dış kart mevcut`, (await outerCard.count()) >= 1, "");
}

async function main() {
  const browser = await chromium.launch();
  try {
    // --- Anonim: 3 CTA konumunda artik MODAL yok, dogrudan /ilanlar'a gidiyor ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await page.goto(BASE_URL);
      console.log("\n[1] Hero 'İş İlanlarını İncele'");
      await verifyNoModalDirectNavigation(page, "Hero", page.locator("section").first().getByRole("link", { name: "İş İlanlarını İncele" }), `${BASE_URL}/ilanlar`);
      await verifyGuestGatePage(page, "Hero -> /ilanlar");

      await page.goto(BASE_URL);
      console.log("\n[2] RoleCardsSection Hizmet Veren kartı");
      const roleCardsSection = page.locator("section", { has: page.getByRole("heading", { name: "Size uygun başlangıcı seçin" }) });
      await verifyNoModalDirectNavigation(page, "RoleCards", roleCardsSection.getByRole("link", { name: /İş ilanlarını incele/ }), `${BASE_URL}/ilanlar`);

      await page.goto(BASE_URL);
      console.log("\n[3] Alt lacivert CTA");
      const finalCtaSection = page.locator("section", { has: page.getByRole("heading", { name: "Lojistik hizmet ihtiyacınızı bugün oluşturun" }) });
      await verifyNoModalDirectNavigation(page, "FinalCta", finalCtaSection.getByRole("link", { name: "İş İlanlarını İncele" }), `${BASE_URL}/ilanlar`);

      console.log("\n[4] Doğrudan /ilanlar ziyareti (ör. Header linki)");
      await page.goto(`${BASE_URL}/ilanlar`);
      await verifyGuestGatePage(page, "Doğrudan /ilanlar");

      console.log("\n[5] 'Hizmet Talebi Oluştur' ile aynı tasarım sistemi");
      await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
      const jobReqH1 = await page.locator("h1").first().textContent();
      check("Hizmet Talebi Oluştur: başlık bozulmadı", jobReqH1?.trim() === "Hizmet Talebi Oluştur", jobReqH1);
      const jobReqCardTitle = await page.getByText("İlan oluşturmak için giriş yapmalısınız.").count();
      check("Hizmet Talebi Oluştur: kart başlığı bozulmadı", jobReqCardTitle === 1, "");
      const jobReqDesc = await page.getByText("Hizmet talebi oluşturmak ve uzman hizmet verenlerden teklif alabilmek için hesabınıza giriş yapın veya yeni bir hesap oluşturun.").count();
      check("Hizmet Talebi Oluştur: kart açıklaması güncellendi (Kayıt Ol dahil)", jobReqDesc === 1, "");
      const jobReqRegister = await page.locator("main").getByRole("link", { name: "Kayıt Ol", exact: true }).count();
      check("Hizmet Talebi Oluştur: 'Kayıt Ol' artık var", jobReqRegister === 1, "");

      check("Anonim: konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));

      console.log("\n[6] Responsive (giriş-gerekli sayfada)");
      for (const width of WIDTHS) {
        await page.goto(`${BASE_URL}/ilanlar`);
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        check(`@ ${width}px: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
        const cardBox = await page.locator("div.rounded-card.border.bg-surface.p-6.sm\\:p-8").first().boundingBox();
        check(`@ ${width}px: kart viewport içinde`, cardBox !== null && cardBox.x >= 0 && cardBox.x + cardBox.width <= width + 1, cardBox ? `x=${cardBox.x.toFixed(1)}, width=${cardBox.width.toFixed(1)}` : "yok");
        const footerVisible = await page.locator("footer").count();
        check(`@ ${width}px: footer mevcut`, footerVisible === 1, "");
      }

      await context.close();
    }

    // --- Hizmet Alan: normal davranış korunmalı ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, ZEYNEP);
      page.jsProblems = [];

      await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
      await page.waitForTimeout(300);
      const formVisible = await page.getByLabel("Hizmet Kategorisi").count();
      check("Hizmet Alan: Hizmet Talebi Oluştur formu normal görünüyor", formVisible === 1, "");

      await page.goto(`${BASE_URL}/ilanlar`);
      await page.waitForTimeout(300);
      const h1 = await page.locator("h1").first().textContent();
      check("Hizmet Alan: /ilanlar normal listeleme görünüyor (gate değil)", h1?.trim() === "İş İlanları", h1);
      const jobCard = await page.getByText("Konteyner Sahasında Lashing Operasyonu").count();
      check("Hizmet Alan: sabit örnek ilan görünüyor", jobCard === 1, "");

      check("Hizmet Alan: konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
      await context.close();
    }

    // --- Hizmet Veren: normal davranış korunmalı ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, MERT);
      page.jsProblems = [];

      await page.goto(`${BASE_URL}/ilanlar`);
      await page.waitForTimeout(300);
      const h1 = await page.locator("h1").first().textContent();
      check("Hizmet Veren: /ilanlar normal (Aktif İlanlar) görünüyor", h1?.trim() === "Aktif İlanlar", h1);
      const openHeading = await page.getByRole("heading", { name: /Teklife Açık İlanlar/ }).count();
      check("Hizmet Veren: Teklife Açık/Kapalı bölünmüş görünüm çalışıyor", openHeading === 1, "");

      await page.goto(BASE_URL);
      await page.waitForTimeout(300);
      await page.locator("section").first().getByRole("link", { name: "İş İlanlarını İncele" }).click();
      await page.waitForURL(`${BASE_URL}/ilanlar`);
      check("Hizmet Veren: Hero'dan /ilanlar'a normal navigasyon", page.url() === `${BASE_URL}/ilanlar`, page.url());

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
