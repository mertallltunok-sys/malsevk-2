// Mobil menu (yukaridan-asagi perde) + ilan fotograf galerisi (buyuk ana foto +
// kucuk onizlemeler) degisikliklerini dogrulayan tek seferlik script.
import { chromium, webkit, devices } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const FIX = (name) => path.join(os.tmpdir(), name);
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
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

async function fillBaseFormFields(page, titleSuffix) {
  await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Depolama" });
  await page.getByLabel("İş Tarihi").fill("2026-09-15");
  await page.getByLabel("İlan Başlığı").fill(`Galeri Test İlanı ${titleSuffix}`);
  await page
    .getByLabel("İş Açıklaması")
    .fill("Bu test ilanı otomatik tarayıcı testinden oluşturulmuştur ve en az yirmi karakter içerir.");
  await page.getByRole("button", { name: "İl", exact: true }).click();
  await page.locator('ul[aria-label="İl"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İl"]').getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.getByRole("button", { name: "İlçe", exact: true }).click();
  await page.locator('ul[aria-label="İlçe"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  await page.locator('ul[aria-label="Tesis"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Tesis"]').getByRole("option", { name: "Beldeport" }).click();
  await page.getByLabel("Operasyon Detayları").fill("Otomatik test için operasyon detayları girilmiştir.");
}

async function waitForPhotosReady(page, expectedCount) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === count &&
      document.querySelectorAll(".animate-spin").length === 0,
    expectedCount,
    { timeout: 20000 },
  );
}

/**
 * Is (job) ve fotograflar yalnizca localStorage'da (gercek backend yok) var
 * olur — bu yuzden olusturma VE her iki rolun goruntulemesi AYNI browser
 * context'inde (ayni localStorage) yapilmali. Ayri bir `browser.launch()` +
 * `newContext()` cagirmak TAMAMEN izole, BOS bir localStorage doguerdu ve
 * ilan "bulunamadi" durumuna duserdi (bkz. ilk denemedeki `.aspect-video`
 * timeout'u) — bu pattern browser-test-job-photos.mjs'teki kanitlanmis
 * yontemle ayni: Mert'e gecerken localStorage temizlenmez, sadece oturum
 * (session) anahtarinin uzerine yazilir.
 */
async function setupJobAndVerifyGallery() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    attachDiagnostics(page);

    await login(page, ZEYNEP, "/hizmet-talebi-olustur");
    await fillBaseFormFields(page, Date.now());
    await page.setInputFiles('input[type="file"]', [
      FIX("fixture-valid-1.jpg"),
      FIX("fixture-valid-2.jpg"),
      FIX("fixture-portrait.jpg"),
      FIX("fixture-valid-3.jpg"),
      FIX("fixture-valid-4.jpg"),
      FIX("fixture-valid-5.jpg"),
    ]);
    await waitForPhotosReady(page, 6);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const jobUrl = page.url();
    check("ilan olusturma sirasinda konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
    console.log(`  ilan: ${jobUrl}`);

    page.jsProblems = [];
    await verifyGalleryOnPage(page, "Hizmet Alan (Zeynep, ilan sahibi)");

    await login(page, MERT, "/panel");
    await page.goto(jobUrl);
    page.jsProblems = [];
    await verifyGalleryOnPage(page, "Hizmet Veren (Mert)");
  } finally {
    await browser.close();
  }
}

async function verifyGalleryOnPage(page, roleLabel) {
  console.log(`\n[galeri] ${roleLabel} olarak goruntuleme`);
  const mainContainer = page.locator(".aspect-video").first();
  const mainImg = mainContainer.locator("img").first();
  const mainBox = await mainContainer.boundingBox();
  const ratio = mainBox.width / mainBox.height;
  check(`${roleLabel}: ana foto kutusu ~16:9 oranda`, Math.abs(ratio - 16 / 9) < 0.05, `oran: ${ratio.toFixed(3)}`);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`${roleLabel}: sayfada yatay tasma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  const thumbButtons = page.locator("[aria-label='Fotoğraf küçük resimleri'] button");
  const thumbCount = await thumbButtons.count();
  check("6 kucuk resim listeleniyor", thumbCount === 6, `bulunan: ${thumbCount}`);

  // ONEMLI: ana fotografa tiklamak HICBIR SEY yapmamali (lightbox/modal yok).
  const urlBeforeMainClick = page.url();
  const altBeforeMainClick = await mainImg.getAttribute("alt");
  await mainContainer.click();
  await page.waitForTimeout(200);
  const dialogCountAfterClick = await page.locator('[role="dialog"]').count();
  const altAfterMainClick = await mainImg.getAttribute("alt");
  check(
    "ana fotografa tiklayinca HICBIR SEY olmuyor (lightbox/modal acilmiyor, foto degismiyor, yonlendirme yok)",
    dialogCountAfterClick === 0 && altAfterMainClick === altBeforeMainClick && page.url() === urlBeforeMainClick,
    `dialog: ${dialogCountAfterClick}, alt once/sonra ayni mi: ${altAfterMainClick === altBeforeMainClick}, url ayni mi: ${page.url() === urlBeforeMainClick}`,
  );

  const mainAltBefore = await mainImg.getAttribute("alt");
  await thumbButtons.nth(2).click(); // portre fotograf (3. sirada, index 2)
  await page.waitForTimeout(200);
  const mainAltAfter = await mainImg.getAttribute("alt");
  check("kucuk resme tiklayinca ana foto degisiyor", mainAltAfter !== mainAltBefore && mainAltAfter.endsWith("fotoğraf 3"), mainAltAfter);

  const portraitBoxAfterClick = await mainContainer.boundingBox();
  const ratioAfter = portraitBoxAfterClick.width / portraitBoxAfterClick.height;
  check("portre foto aktifken de kutu hala ~16:9 (letterbox, kutu bozulmuyor)", Math.abs(ratioAfter - 16 / 9) < 0.05, `oran: ${ratioAfter.toFixed(3)}`);

  const hasExactClass = (classString, token) => (classString ?? "").split(/\s+/).includes(token);
  const activeThumbClass = await thumbButtons.nth(2).getAttribute("class");
  check("secili kucuk resim belirgin cerceveyle (border-primary) gosteriliyor", hasExactClass(activeThumbClass, "border-primary"), activeThumbClass ?? "");
  const inactiveThumbClass = await thumbButtons.nth(0).getAttribute("class");
  check("secili olmayan kucuk resimde border-primary yok", !hasExactClass(inactiveThumbClass, "border-primary"), inactiveThumbClass ?? "");

  // klavye ile secim: ilk kucuk resme odaklan, Enter'a bas
  await thumbButtons.nth(0).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const mainAltAfterKeyboard = await mainImg.getAttribute("alt");
  check("klavyeyle (Tab+Enter) kucuk resim secilebiliyor", mainAltAfterKeyboard.endsWith("fotoğraf 1"), mainAltAfterKeyboard);

  check(`${roleLabel}: konsolda JS hatasi yok`, page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
}

async function verifyMobileMenu(engine, engineLabel) {
  console.log(`\n[mobil menu] ${engineLabel} + mobil viewport`);
  const browser = await engine.launch();
  try {
  const context = await browser.newContext({ ...devices["iPhone 12"], hasTouch: true });
  const page = await context.newPage();
  attachDiagnostics(page);
  await page.goto(BASE_URL);
  await page.waitForTimeout(300);

  const hamburger = page.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
  check("hamburger butonu mobilde gorunur", await hamburger.isVisible(), "");

  const desktopNav = page.getByRole("navigation", { name: "Ana menü" });
  const desktopNavVisible = await desktopNav.isVisible().catch(() => false);
  check("masaustu nav mobilde gizli", !desktopNavVisible, "");

  await hamburger.click();
  await page.waitForTimeout(300);
  check("aria-expanded=true (acik)", (await hamburger.getAttribute("aria-expanded")) === "true", "");

  const panel = page.locator("#mobil-menu-panel");
  const panelBox = await panel.boundingBox();
  const viewportWidth = page.viewportSize().width;
  check("panel ekran genisligini kapliyor (yandan acilan drawer degil)", Math.abs(panelBox.width - viewportWidth) < 2, `panel genisligi: ${panelBox.width}, viewport: ${viewportWidth}`);
  check("panel header'in hemen altindan basliyor (y~64)", Math.abs(panelBox.y - 64) < 2, `y: ${panelBox.y}`);
  check("panel x=0'dan basliyor (sagdan/soldan degil, tam genislik)", Math.abs(panelBox.x) < 2, `x: ${panelBox.x}`);

  const bodyPosition = await page.evaluate(() => document.body.style.position);
  check("body scroll kilidi aktif (position: fixed)", bodyPosition === "fixed", `body.style.position: "${bodyPosition}"`);

  await hamburger.click();
  await page.waitForTimeout(300);
  check("aria-expanded=false (kapali)", (await hamburger.getAttribute("aria-expanded")) === "false", "");
  const bodyPositionAfterClose = await page.evaluate(() => document.body.style.position);
  check("kapaninca body kilidi kalkiyor", bodyPositionAfterClose !== "fixed", `body.style.position: "${bodyPositionAfterClose}"`);

  // Scroll konumu geri yukleme testi.
  // NOT: Playwright'in locator.click()'i, hedefi "gorunur" kilmak icin
  // otomatik scrollIntoViewIfNeeded cagirir — sticky header'da gereksiz
  // olsa da Playwright yine de calistirir ve bu da GERCEK scroll konumunu
  // click'ten ONCE sifirlayarak testi bozar (gercek bir parmak dokunusunda
  // bu olmaz). Bu yuzden burada native DOM click kullanilir.
  // NOT: sayfada `scroll-behavior: smooth` (globals.css) aktif oldugu icin
  // behavior belirtilmeden yapilan scrollTo animasyonlu olur - "instant"
  // ile zorlanmazsa, hemen ardindan okunan scrollY animasyon bitmeden
  // ANLIK/ARA bir deger doner (bu, ilk denemede test hatasina yol acti).
  await page.evaluate(() => window.scrollTo({ top: 400, left: 0, behavior: "instant" }));
  await page.waitForTimeout(100);
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await hamburger.evaluate((el) => el.click());
  await page.waitForTimeout(300);
  const bodyTopWhileLocked = await page.evaluate(() => document.body.style.top);
  check(
    "kilit acildigi andaki gercek scroll konumunu dogru yakaliyor (body.style.top)",
    bodyTopWhileLocked === `-${scrollYBefore}px`,
    `beklenen: -${scrollYBefore}px, gercek: "${bodyTopWhileLocked}"`,
  );
  await page.waitForTimeout(150);
  const bodyTopStillLocked = await page.evaluate(() => document.body.style.top);
  check(
    "kilit degeri zaman icinde SABIT kaliyor (sayfa kaymiyor)",
    bodyTopStillLocked === bodyTopWhileLocked,
    `once: "${bodyTopWhileLocked}", sonra: "${bodyTopStillLocked}"`,
  );

  // Karartilmis alana (backdrop) tiklayinca kapanmali
  await page.mouse.click(viewportWidth - 5, 700);
  await page.waitForTimeout(300);
  const openAfterBackdropClick = await hamburger.getAttribute("aria-expanded");
  check("karartilmis alana tiklayinca menu kapaniyor", openAfterBackdropClick === "false", "");
  const scrollYAfterClose = await page.evaluate(() => window.scrollY);
  check("kapaninca eski scroll konumuna donuyor", scrollYAfterClose === scrollYBefore, `once: ${scrollYBefore}, sonra: ${scrollYAfterClose}`);

  // Linke tiklayinca kapanmali
  await hamburger.click();
  await page.waitForTimeout(300);
  await page.locator("#mobil-menu-panel").getByRole("link", { name: "İlanlar" }).click();
  await page.waitForURL(/\/ilanlar/, { timeout: 5000 });
  const openAfterLinkClick = await hamburger.getAttribute("aria-expanded");
  check("linke tiklayinca menu kapaniyor + yonlendiriyor", openAfterLinkClick === "false" && page.url().includes("/ilanlar"), page.url());

  // Escape ile kapanma
  await page.goto(BASE_URL);
  await page.waitForTimeout(200);
  await hamburger.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const openAfterEscape = await hamburger.getAttribute("aria-expanded");
  check("Escape ile menu kapaniyor", openAfterEscape === "false", "");

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check("mobilde yatay tasma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  check(`${engineLabel}: konsolda JS hatasi yok`, page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
  } finally {
    await browser.close();
  }
}

async function verifyDesktopUnaffected() {
  console.log("\n[masaustu] menu/nav bozulmadi mi");
  const browser = await chromium.launch();
  try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  attachDiagnostics(page);
  await page.goto(BASE_URL);
  await page.waitForTimeout(200);

  const hamburgerCount = await page.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ }).count();
  const hamburgerVisible = hamburgerCount > 0 ? await page.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ }).first().isVisible() : false;
  check("masaustunde hamburger gizli", !hamburgerVisible, `count: ${hamburgerCount}`);

  const desktopNavVisible = await page.getByRole("navigation", { name: "Ana menü" }).isVisible();
  check("masaustunde ana nav gorunur", desktopNavVisible, "");

  check("masaustunde konsolda JS hatasi yok", page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== Kurulum: 6 fotografli (1 portre dahil) test ilani olusturuluyor + galeri kontrolleri ===");
  await setupJobAndVerifyGallery();

  await verifyMobileMenu(chromium, "Chromium");
  await verifyMobileMenu(webkit, "WebKit (Safari motoru)");
  await verifyDesktopUnaffected();

  console.log(anyFail ? "\nSONUC: EN AZ BIR KONTROL BASARISIZ." : "\nSONUC: TUM KONTROLLER GECTI.");
  if (anyFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
