// Rol bazli Hero degisikligini dogrulayan tek seferlik script:
// - Anonim / Hizmet Alan (Zeynep) / Hizmet Veren (Mert) icin dogru baslik,
//   aciklama ve tek/cift buton kombinasyonu
// - Rakip role ait metin/buton hic gorunmuyor
// - RoleCardsSection sadece anonimde gorunuyor
// - Belirtilen genisliklerde yatay tasma / console hatasi yok
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

async function verifyHero(page, roleLabel, expected) {
  console.log(`\n[hero] ${roleLabel}`);
  await page.waitForTimeout(300); // useSyncExternalStore hidrasyon sonrasi gercek role gecsin

  // Hero, sayfadaki ILK <section>'dur — "Hizmet Talebi Oluştur" /
  // "İş İlanlarını İncele" metinleri RoleCardsSection/FinalCtaSection'da da
  // gectigi icin buton kontrolleri sayfa geneli degil, yalnizca Hero
  // section'i icinde yapilmali.
  const hero = page.locator("section").first();

  const h1Text = await hero.locator("h1").first().textContent();
  check(`${roleLabel}: baslik dogru`, h1Text?.trim() === expected.title, h1Text);

  const description = await hero
    .locator("h1")
    .first()
    .locator("xpath=following-sibling::p[1]")
    .textContent();
  check(`${roleLabel}: aciklama dogru`, description?.trim() === expected.description, description);

  const heroButtons = hero.getByRole("link");
  const heroButtonCount = await heroButtons.count();
  check(
    `${roleLabel}: Hero'da tam olarak ${expected.buttonsPresent.length} buton var`,
    heroButtonCount === expected.buttonsPresent.length,
    `bulunan: ${heroButtonCount}`,
  );

  for (const label of expected.buttonsPresent) {
    const count = await hero.getByRole("link", { name: label, exact: true }).count();
    check(`${roleLabel}: Hero'da "${label}" butonu gorunuyor`, count === 1, `bulunan: ${count}`);
  }
  for (const label of expected.buttonsAbsent) {
    const count = await hero.getByRole("link", { name: label, exact: true }).count();
    check(`${roleLabel}: Hero'da "${label}" butonu gorunmuyor`, count === 0, `bulunan: ${count}`);
  }

  const roleCardsHeading = await page.getByRole("heading", { name: "Size uygun başlangıcı seçin" }).count();
  check(
    `${roleLabel}: "Size uygun başlangıcı seçin" bölümü ${expected.roleCardsVisible ? "görünüyor" : "görünmüyor"}`,
    roleCardsHeading === (expected.roleCardsVisible ? 1 : 0),
    `bulunan: ${roleCardsHeading}`,
  );

  check(`${roleLabel}: konsolda JS hatasi yok`, page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
}

/**
 * Sert reload (tam SSR + hidrasyon dongusu) — giris sonrasi client-side
 * router.push ile gelen sayfa yerine, oturumun localStorage'dan okunup
 * dogru rol icerigine gectigi en hassas senaryo budur (hydration mismatch
 * riski en yuksek an).
 */
async function verifyHardReloadNoHydrationError(page, roleLabel, expectedTitle) {
  page.jsProblems = [];
  await page.reload();
  await page.waitForTimeout(400);
  const h1Text = await page.locator("section").first().locator("h1").first().textContent();
  check(`${roleLabel}: sert reload sonrasi dogru baslik`, h1Text?.trim() === expectedTitle, h1Text);
  const hydrationRelated = page.jsProblems.filter((p) => /hydrat/i.test(p));
  check(
    `${roleLabel}: sert reload sonrasi hydration hatasi yok`,
    hydrationRelated.length === 0,
    JSON.stringify(page.jsProblems),
  );
  check(
    `${roleLabel}: sert reload sonrasi genel konsol hatasi yok`,
    page.jsProblems.length === 0,
    JSON.stringify(page.jsProblems),
  );
}

async function verifyResponsive(page, roleLabel) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    check(
      `${roleLabel} @ ${width}px: yatay tasma yok`,
      scrollWidth <= clientWidth + 1,
      `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`,
    );

    const h1Box = await page.locator("h1").first().boundingBox();
    check(
      `${roleLabel} @ ${width}px: baslik viewport icinde`,
      h1Box !== null && h1Box.x >= 0 && h1Box.x + h1Box.width <= width + 1,
      h1Box ? `x=${h1Box.x.toFixed(1)}, width=${h1Box.width.toFixed(1)}` : "bulunamadi",
    );

    const buttons = page.locator("section").first().getByRole("link");
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      check(
        `${roleLabel} @ ${width}px: buton ${i + 1} tasmiyor`,
        box.x >= 0 && box.x + box.width <= width + 1,
        `x=${box.x.toFixed(1)}, width=${box.width.toFixed(1)}`,
      );
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    // --- Anonim ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await page.goto(BASE_URL);
      await verifyHero(page, "Anonim", {
        title: "Yükünüzü güvenle taşıyacak doğru ekibi bulun",
        description:
          "MALSEVK, hizmet alan firmalar ile uzman hizmet verenleri güvenli, hızlı ve kolay şekilde buluşturur.",
        buttonsPresent: ["Hizmet Talebi Oluştur", "İş İlanlarını İncele"],
        buttonsAbsent: ["Panelime Git"],
        roleCardsVisible: true,
      });
      await verifyResponsive(page, "Anonim");
      await context.close();
    }

    // --- Hizmet Alan (Zeynep) ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, ZEYNEP);
      page.jsProblems = [];
      await verifyHero(page, "Hizmet Alan (Zeynep)", {
        title: "Lojistik hizmet ihtiyacınızı kolayca karşılayın",
        description:
          "İhtiyacınıza uygun hizmet talebi oluşturun, gelen teklifleri karşılaştırın ve doğru hizmet vereni seçin.",
        buttonsPresent: ["Hizmet Talebi Oluştur"],
        buttonsAbsent: ["İş İlanlarını İncele", "Panelime Git"],
        roleCardsVisible: false,
      });
      await verifyResponsive(page, "Hizmet Alan (Zeynep)");
      await verifyHardReloadNoHydrationError(
        page,
        "Hizmet Alan (Zeynep)",
        "Lojistik hizmet ihtiyacınızı kolayca karşılayın",
      );
      await context.close();
    }

    // --- Hizmet Veren (Mert) ---
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, MERT);
      page.jsProblems = [];
      await verifyHero(page, "Hizmet Veren (Mert)", {
        title: "Uzmanlığınıza uygun iş fırsatlarını keşfedin",
        description:
          "Size uygun lojistik hizmet ilanlarını inceleyin, teklif verin ve yeni müşterilere ulaşın.",
        buttonsPresent: ["İş İlanlarını İncele"],
        buttonsAbsent: ["Hizmet Talebi Oluştur", "Panelime Git"],
        roleCardsVisible: false,
      });
      await verifyResponsive(page, "Hizmet Veren (Mert)");
      await verifyHardReloadNoHydrationError(
        page,
        "Hizmet Veren (Mert)",
        "Uzmanlığınıza uygun iş fırsatlarını keşfedin",
      );
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
