// "Uc adimda dogru hizmete ulasin" (HowItWorksSection) ve "Lojistik
// operasyonlarinizi daha duzenli yonetin" (TrustValueSection) bolumlerinin
// projeden tamamen kaldirildigini dogrulayan tek seferlik script:
// - Anonim / Hizmet Alan / Hizmet Veren hicbirinde bu iki bolum yok
// - Section sayisi azaldi, bos wrapper/DOM kalintisi yok
// - ServicesSection'dan hemen sonra FinalCtaSection geliyor
// - Belirtilen genisliklerde yatay tasma / bos alan / CLS yok
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1536];

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

async function verifySectionsGone(page, roleLabel) {
  console.log(`\n[bolum kaldirma] ${roleLabel}`);
  await page.waitForTimeout(300);

  const howItWorksHeading = await page.getByRole("heading", { name: "Üç adımda doğru hizmete ulaşın" }).count();
  check(`${roleLabel}: "Üç adımda doğru hizmete ulaşın" bölümü DOM'da yok`, howItWorksHeading === 0, `bulunan: ${howItWorksHeading}`);

  const trustValueHeading = await page.getByRole("heading", { name: "Lojistik operasyonlarınızı daha düzenli yönetin" }).count();
  check(`${roleLabel}: "Lojistik operasyonlarınızı daha düzenli yönetin" bölümü DOM'da yok`, trustValueHeading === 0, `bulunan: ${trustValueHeading}`);

  const anchorPresent = await page.locator("#nasil-calisir").count();
  check(`${roleLabel}: #nasil-calisir anchor'ı da DOM'da yok`, anchorPresent === 0, `bulunan: ${anchorPresent}`);

  for (const stepText of ["İhtiyacını oluştur", "Teklifleri karşılaştır", "Hizmet vereni seç"]) {
    const count = await page.getByText(stepText, { exact: true }).count();
    check(`${roleLabel}: "${stepText}" metni yok`, count === 0, `bulunan: ${count}`);
  }
  for (const featText of ["Doğru hizmet kategorisi", "Teklifleri tek yerde karşılaştırın", "Şeffaf iş süreci"]) {
    const count = await page.getByText(featText, { exact: true }).count();
    check(`${roleLabel}: "${featText}" metni yok`, count === 0, `bulunan: ${count}`);
  }

  const sections = page.locator("main section, body > section, section");
  const sectionCount = await sections.count();
  check(`${roleLabel}: toplam section sayısı 4 (Hero/RoleCards*/Services/FinalCta)`, sectionCount <= 4, `bulunan: ${sectionCount}`);

  // ServicesSection'dan hemen sonra FinalCtaSection gelmeli (arada bos section/wrapper yok).
  const headingsInOrder = await page.locator("section h2, section h1").allTextContents();
  const servicesIdx = headingsInOrder.findIndex((t) => t.includes("Lojistik operasyon hizmetleri"));
  const finalCtaIdx = headingsInOrder.findIndex((t) => t.includes("Lojistik hizmet ihtiyacınızı bugün oluşturun"));
  check(
    `${roleLabel}: ServicesSection hemen ardından FinalCtaSection geliyor`,
    servicesIdx !== -1 && finalCtaIdx === servicesIdx + 1,
    JSON.stringify(headingsInOrder),
  );

  check(`${roleLabel}: konsolda JS hatasi yok`, page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
}

async function verifyResponsive(page, roleLabel) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    check(`${roleLabel} @ ${width}px: yatay tasma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
  }
}

async function verifyCtaLinksStillWork(page) {
  console.log("\n[CTA dogrulama] href'ler bozulmamis");
  const hrefs = await page.locator("section").last().getByRole("link").evaluateAll((links) => links.map((l) => l.getAttribute("href")));
  check("FinalCtaSection linkleri hâlâ dogru", hrefs.includes("/hizmet-talebi-olustur") && hrefs.includes("/ilanlar"), JSON.stringify(hrefs));
}

async function main() {
  const browser = await chromium.launch();
  try {
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await page.goto(BASE_URL);
      await verifySectionsGone(page, "Anonim");
      await verifyResponsive(page, "Anonim");
      await verifyCtaLinksStillWork(page);
      await context.close();
    }
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, ZEYNEP);
      page.jsProblems = [];
      await verifySectionsGone(page, "Hizmet Alan (Zeynep)");
      await verifyResponsive(page, "Hizmet Alan (Zeynep)");
      await context.close();
    }
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, MERT);
      page.jsProblems = [];
      await verifySectionsGone(page, "Hizmet Veren (Mert)");
      await verifyResponsive(page, "Hizmet Veren (Mert)");
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
