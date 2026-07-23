// "Hizmetler" ve "İlanlar" üst navigasyon bağlantılarının site-header.tsx'in
// navLinks dizisinden tamamen kaldırılmasını doğrular: anonim ana sayfa,
// giriş/kayıt sayfası, Hizmet Alan/Hizmet Veren oturumu, masaüstü + mobil
// menü, 7 farklı genişlikte (320/375/390/414/768/1024/1280) yatay taşma,
// logo/CTA sıkışması, header yüksekliği ve konsol hatası kontrolleriyle.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 375, 390, 414, 768, 1024, 1280];
const REMOVED_LABELS = ["Hizmetler", "İlanlar"];

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

async function checkAtWidth(page, width, { desktopAuthRightSelectors, isAnonHeader, baseline }) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(150);

  const header = page.locator("header").first();
  const headerBox = await header.boundingBox();
  if (baseline.height === null) {
    baseline.height = headerBox.height;
    console.log(`    [bilgi] [${width}px] taban header yüksekliği ölçüldü: ${headerBox.height}px (border dahil)`);
  }
  check(`[${width}px] header yüksekliği sabit (genişlikler arası değişmiyor)`, Math.abs(headerBox.height - baseline.height) < 1, `yükseklik=${headerBox.height}, taban=${baseline.height}`);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`[${width}px] yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  const headerText = await header.innerText();
  for (const label of REMOVED_LABELS) {
    check(`[${width}px] "${label}" header'da görünmüyor`, !headerText.includes(label), headerText.includes(label) ? "BULUNDU!" : "");
  }

  const logo = header.getByRole("link", { name: /MALSEVK\.COM/ }).first();
  const logoBox = await logo.boundingBox();
  check(`[${width}px] logo sıkışmıyor (genişlik>0, yükseklik makul)`, logoBox.width > 0 && logoBox.height > 0 && logoBox.height <= 64, `${logoBox.width.toFixed(0)}x${logoBox.height.toFixed(0)}`);

  const isDesktopNav = await header.getByRole("navigation", { name: "Ana menü" }).isVisible().catch(() => false);

  if (isDesktopNav) {
    const nasilCalisirLink = header.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Nasıl Çalışır" });
    check(`[${width}px] "Nasıl Çalışır" hâlâ mevcut (masaüstü nav)`, await nasilCalisirLink.isVisible(), "");
    const nccBox = await nasilCalisirLink.boundingBox();
    check(`[${width}px] "Nasıl Çalışır" metni taşmıyor (tek satır yüksekliğinde)`, nccBox.height < 40, `yükseklik=${nccBox.height.toFixed(1)}`);

    if (isAnonHeader) {
      const loginBtn = header.getByRole("link", { name: "Giriş Yap" }).first();
      const registerBtn = header.getByRole("link", { name: "Kayıt Ol" }).first();
      const loginBox = await loginBtn.boundingBox();
      const registerBox = await registerBtn.boundingBox();
      const overlap = loginBox.x < registerBox.x + registerBox.width && registerBox.x < loginBox.x + loginBox.width;
      check(`[${width}px] Giriş Yap / Kayıt Ol üst üste binmiyor`, !overlap, `giriş=${loginBox.x.toFixed(0)}-${(loginBox.x + loginBox.width).toFixed(0)}, kayıt=${registerBox.x.toFixed(0)}-${(registerBox.x + registerBox.width).toFixed(0)}`);
    } else if (desktopAuthRightSelectors) {
      for (const { locator, name } of desktopAuthRightSelectors(page)) {
        const visible = await locator.isVisible().catch(() => false);
        check(`[${width}px] ${name} görünür ve kaymamış`, visible, "");
      }
    }
  } else {
    const hamburger = header.getByRole("button", { name: /Menüyü aç|Menüyü kapat/ });
    check(`[${width}px] hamburger butonu görünür (mobil)`, await hamburger.isVisible(), "");
  }
}

async function testScenario(browser, { name, setup, isAnonHeader, desktopAuthRightSelectors }) {
  console.log(`\n=== ${name} ===`);
  const context = await browser.newContext();
  const page = await context.newPage();
  attachDiagnostics(page);

  await setup(page);

  const baseline = { height: null };
  for (const width of WIDTHS) {
    await checkAtWidth(page, width, { desktopAuthRightSelectors, isAnonHeader, baseline });
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

  // Tam eşleşme aranır (substring değil): "Uygun İlanlar" gibi profil
  // menüsündeki (kapsam dışı, dokunulmayan) meşru linkler "İlanlar" alt
  // dizesini içerir ama kaldırılan üst-nav linkiyle aynı şey değildir.
  const panel = page.locator("#mobil-menu-panel");
  for (const label of REMOVED_LABELS) {
    const exactMatchCount = await panel.getByRole("link", { name: label, exact: true }).count();
    check(`mobil menüde "${label}" (tam eşleşme) kesinlikle yok`, exactMatchCount === 0, `bulunan: ${exactMatchCount}`);
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
    await testScenario(browser, {
      name: "Oturum açılmamış ana sayfa (/)",
      setup: (page) => page.goto(BASE_URL),
      isAnonHeader: true,
    });

    await testScenario(browser, {
      name: "Giriş yapma sayfası (/giris-yap)",
      setup: (page) => page.goto(`${BASE_URL}/giris-yap`),
      isAnonHeader: true,
    });

    await testScenario(browser, {
      name: "Kayıt olma sayfası (/giris-yap?mode=kayit)",
      setup: (page) => page.goto(`${BASE_URL}/giris-yap?mode=kayit`),
      isAnonHeader: true,
    });

    await testScenario(browser, {
      name: "Hizmet Alan oturumu (Zeynep) — /panel",
      setup: (page) => login(page, ZEYNEP, "/panel"),
      isAnonHeader: false,
      desktopAuthRightSelectors: (page) => [
        { locator: page.getByRole("button", { name: /Bildirimler/ }).first(), name: "bildirim zili" },
        { locator: page.getByRole("button", { name: /Zeynep|Hesap/ }).first(), name: "profil menüsü tetikleyici" },
      ],
    });

    await testScenario(browser, {
      name: "Hizmet Veren oturumu (Mert) — /panel",
      setup: (page) => login(page, MERT, "/panel"),
      isAnonHeader: false,
      desktopAuthRightSelectors: (page) => [
        { locator: page.getByRole("button", { name: /Bildirimler/ }).first(), name: "bildirim zili" },
        { locator: page.getByRole("button", { name: /Mert|Hesap/ }).first(), name: "profil menüsü tetikleyici" },
      ],
    });

    await testMobileMenu(browser, {
      name: "oturum açılmamış",
      setup: (page) => page.goto(BASE_URL),
    });

    await testMobileMenu(browser, {
      name: "Hizmet Alan (Zeynep)",
      setup: (page) => login(page, ZEYNEP, "/panel"),
    });

    await testMobileMenu(browser, {
      name: "Hizmet Veren (Mert)",
      setup: (page) => login(page, MERT, "/panel"),
    });

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
