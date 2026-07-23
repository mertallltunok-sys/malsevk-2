// "Nasıl Çalışır" üst navigasyon bağlantısının site-header.tsx'ten tamamen
// kaldırılmasını (yalnızca "Hizmetler"/"İlanlar" değil, üçünün de artık
// görünmediğini) doğrular: anonim, Hizmet Alan, Hizmet Veren, mobil menü,
// 7 genişlikte (320/375/390/414/768/1024/1280) taşma/hizalama/header-
// yüksekliği/logo-sağ-aksiyon konumu ve konsol hatası kontrolleriyle.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280];
const REMOVED_LABELS = ["Nasıl Çalışır", "Hizmetler", "İlanlar"];

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

async function checkAtWidth(page, width, { baseline, expectCta, isLoggedIn }) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(150);

  const header = page.locator("header").first();
  const container = header.locator("> div").first();
  const headerBox = await header.boundingBox();
  if (baseline.height === null) baseline.height = headerBox.height;
  check(`[${width}px] header yüksekliği sabit`, Math.abs(headerBox.height - baseline.height) < 1, `yükseklik=${headerBox.height}, taban=${baseline.height}`);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`[${width}px] yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  const headerText = await header.innerText();
  for (const label of REMOVED_LABELS) {
    check(`[${width}px] "${label}" header'da hiç yok`, !headerText.includes(label), headerText.includes(label) ? "BULUNDU!" : "");
  }

  const containerBox = await container.boundingBox();
  const logo = header.getByRole("link", { name: /MALSEVK\.COM/ }).first();
  const logoBox = await logo.boundingBox();
  // Kapsayıcının kendi yatay dolgusu (px-4/sm:px-6/lg:px-8 = 16/24/32px)
  // genişliğe göre değişir — bu her zaman böyleydi, bu görevle ilgisiz.
  // Asıl kontrol: logo kapsayıcının dolgusu kadar içeride, daha fazla değil.
  const leftPad = logoBox.x - containerBox.x;
  check(`[${width}px] logo sol kenara hizalı (kaymamış)`, leftPad >= 12 && leftPad <= 36, `logo.x=${logoBox.x.toFixed(1)}, container.x=${containerBox.x.toFixed(1)}, dolgu=${leftPad.toFixed(1)}`);

  const isDesktop = width >= 768;
  if (isDesktop) {
    const navCount = await header.getByRole("navigation", { name: "Ana menü" }).count();
    if (expectCta) {
      check(`[${width}px] "Hizmet Talebi Oluştur" CTA hâlâ görünür`, await header.getByRole("link", { name: "Hizmet Talebi Oluştur" }).isVisible(), "");
      check(`[${width}px] boş nav yerine yalnızca CTA'lı nav var (tam 1 adet)`, navCount === 1, `bulunan: ${navCount}`);
    } else {
      check(`[${width}px] orta navigasyon kapsayıcısı DOM'dan tamamen kaldırılmış (boş kalmıyor)`, navCount === 0, `bulunan <nav> sayısı: ${navCount}`);
    }

    // Sağ uçtaki GERÇEK en sağdaki eleman ("Kayıt Ol" ya da profil menüsü
    // tetikleyicisi — "Giriş Yap"/bildirim zili çiftin SOLDAKİ üyesi, en
    // sağdaki değil) kapsayıcının sağ iç kenarına hizalı mı.
    const rightAnchor = isLoggedIn
      ? header.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).first()
      : header.getByRole("link", { name: "Kayıt Ol" }).first();
    const rightVisible = await rightAnchor.isVisible().catch(() => false);
    if (rightVisible) {
      const rightBox = await rightAnchor.boundingBox();
      const rightPad = containerBox.x + containerBox.width - (rightBox.x + rightBox.width);
      check(`[${width}px] sağ aksiyon kapsayıcının sağ iç kenarına yakın (kaymamış)`, rightPad >= 12 && rightPad <= 36, `sağ boşluk=${rightPad.toFixed(1)}`);
    }
  } else {
    const hamburger = header.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
    check(`[${width}px] hamburger butonu görünür (mobil)`, await hamburger.isVisible(), "");
  }
}

async function testScenario(browser, { name, setup, expectCta, isLoggedIn }) {
  console.log(`\n=== ${name} ===`);
  const context = await browser.newContext();
  const page = await context.newPage();
  attachDiagnostics(page);
  await setup(page);

  const baseline = { height: null };
  for (const width of WIDTHS) {
    await checkAtWidth(page, width, { baseline, expectCta, isLoggedIn });
  }

  check(`${name}: konsolda hata/pageerror yok`, page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await context.close();
}

async function testMobileMenu(browser, { name, setup }) {
  console.log(`\n=== Mobil menü: ${name} ===`);
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  attachDiagnostics(page);
  await setup(page);

  const hamburger = page.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
  await hamburger.click();
  await page.waitForTimeout(300);
  check("menü açılıyor (aria-expanded=true)", (await hamburger.getAttribute("aria-expanded")) === "true", "");

  const panel = page.locator("#mobil-menu-panel");
  for (const label of REMOVED_LABELS) {
    const count = await panel.getByRole("link", { name: label, exact: true }).count();
    check(`mobil menüde "${label}" (tam eşleşme) kesinlikle yok`, count === 0, `bulunan: ${count}`);
  }

  await hamburger.click();
  await page.waitForTimeout(300);
  check("menü kapanıyor (aria-expanded=false)", (await hamburger.getAttribute("aria-expanded")) === "false", "");

  check(`${name}: mobil menüde konsol hatası yok`, page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await testScenario(browser, { name: "Oturum açılmamış ana sayfa (/)", setup: (page) => page.goto(BASE_URL), expectCta: false, isLoggedIn: false });
    await testScenario(browser, { name: "Giriş yapma sayfası (/giris-yap)", setup: (page) => page.goto(`${BASE_URL}/giris-yap`), expectCta: false, isLoggedIn: false });
    await testScenario(browser, { name: "Kayıt olma sayfası (/giris-yap?mode=kayit)", setup: (page) => page.goto(`${BASE_URL}/giris-yap?mode=kayit`), expectCta: false, isLoggedIn: false });
    await testScenario(browser, { name: "Hizmet Alan oturumu (Zeynep) — /panel", setup: (page) => login(page, ZEYNEP, "/panel"), expectCta: true, isLoggedIn: true });
    await testScenario(browser, { name: "Hizmet Veren oturumu (Mert) — /panel", setup: (page) => login(page, MERT, "/panel"), expectCta: false, isLoggedIn: true });

    await testMobileMenu(browser, { name: "oturum açılmamış", setup: (page) => page.goto(BASE_URL) });
    await testMobileMenu(browser, { name: "Hizmet Alan (Zeynep)", setup: (page) => login(page, ZEYNEP, "/panel") });
    await testMobileMenu(browser, { name: "Hizmet Veren (Mert)", setup: (page) => login(page, MERT, "/panel") });

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
