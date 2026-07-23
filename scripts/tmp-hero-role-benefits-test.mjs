// Hero CTA altindaki rol bazli avantaj alanini (eski yesil-tik listesinin
// yerini alan ikon+baslik+aciklama satirlari) dogrulayan tek seferlik script:
// - Anonim: eski yesil-tik listesi DEGISMEDEN duruyor
// - Hizmet Alan: 4 yeni ozellik satiri, dogru baslik/aciklama/ikon sayisi
// - Hizmet Veren: 3 yeni ozellik satiri, dogru baslik/aciklama/ikon sayisi
// - Belirtilen genisliklerde yatay tasma / ikon ezilmesi / metin tasmasi yok
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

function heroFeatureList(page) {
  // Hero, sayfadaki ilk <section>; icindeki 2. <ul> avantaj alani (1.
  // <ul> CTA butonlarinin sarildigi <div>, ondan sonraki ilk <ul>).
  return page.locator("section").first().locator("ul").first();
}

async function verifyAnonymousUnchanged(page) {
  console.log("\n[avantaj alani] Anonim — eski yesil-tik listesi degismemis");
  await page.goto(BASE_URL);
  await page.waitForTimeout(300);
  const list = heroFeatureList(page);
  const items = await list.locator("li").allTextContents();
  check(
    "anonimde eski 3 madde aynen duruyor",
    items.map((t) => t.trim()).join("|") ===
      ["Profesyonel hizmet verenler", "Türkiye genelinde hizmet", "Kolay teklif karşılaştırma"].join("|"),
    JSON.stringify(items),
  );
  const checkIcons = await list.locator("li svg").count();
  check("anonimde 3 tik ikonu var", checkIcons === 3, `bulunan: ${checkIcons}`);
}

async function verifyRoleFeatures(page, roleLabel, expectedFeatures) {
  console.log(`\n[avantaj alani] ${roleLabel}`);
  await page.waitForTimeout(300);
  const list = heroFeatureList(page);
  const items = await list.locator("li").all();
  check(`${roleLabel}: dogru satir sayisi`, items.length === expectedFeatures.length, `bulunan: ${items.length}`);

  for (let i = 0; i < expectedFeatures.length; i++) {
    const li = items[i];
    const title = await li.locator("p").first().textContent();
    const description = await li.locator("p").nth(1).textContent();
    check(`${roleLabel}: satir ${i + 1} baslik dogru`, title?.trim() === expectedFeatures[i].title, title);
    check(
      `${roleLabel}: satir ${i + 1} aciklama dogru`,
      description?.trim() === expectedFeatures[i].description,
      description,
    );
    const iconCount = await li.locator("span svg").count();
    check(`${roleLabel}: satir ${i + 1} ikon mevcut`, iconCount === 1, `bulunan: ${iconCount}`);
  }

  // Karsi role ait icerik hic gorunmemeli.
  const allText = (await list.textContent()) ?? "";
  check(
    `${roleLabel}: eski yesil-tik metinlerinden hicbiri yok`,
    !allText.includes("Profesyonel hizmet verenler") &&
      !allText.includes("Türkiye genelinde hizmet") &&
      !allText.includes("Kolay teklif karşılaştırma"),
    allText,
  );

  check(`${roleLabel}: konsolda JS hatasi yok`, page.jsProblems.length === 0, JSON.stringify(page.jsProblems));
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

    const list = heroFeatureList(page);
    const icons = await list.locator("li > span").all();
    for (let i = 0; i < icons.length; i++) {
      const box = await icons[i].boundingBox();
      if (!box) continue;
      check(
        `${roleLabel} @ ${width}px: ikon ${i + 1} ezilmemis (~44x44)`,
        Math.abs(box.width - 44) < 2 && Math.abs(box.height - 44) < 2,
        `w=${box.width.toFixed(1)}, h=${box.height.toFixed(1)}`,
      );
      check(
        `${roleLabel} @ ${width}px: ikon ${i + 1} viewport icinde`,
        box.x >= 0 && box.x + box.width <= width + 1,
        `x=${box.x.toFixed(1)}`,
      );
    }

    const paragraphs = await list.locator("li p").all();
    for (let i = 0; i < paragraphs.length; i++) {
      const box = await paragraphs[i].boundingBox();
      if (!box) continue;
      check(
        `${roleLabel} @ ${width}px: metin ${i + 1} tasmiyor`,
        box.x >= 0 && box.x + box.width <= width + 1,
        `x=${box.x.toFixed(1)}, width=${box.width.toFixed(1)}`,
      );
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await verifyAnonymousUnchanged(page);
      await verifyResponsive(page, "Anonim");
    }

    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, ZEYNEP);
      page.jsProblems = [];
      await verifyRoleFeatures(page, "Hizmet Alan (Zeynep)", [
        { title: "İhtiyacınıza Uygun Hizmet", description: "Hizmet ihtiyacınızı tanımlayın ve uygun firmalardan teklif alın." },
        { title: "Teklifleri Karşılaştırın", description: "Gelen teklifleri fiyat, süre ve firma bilgilerine göre değerlendirin." },
        { title: "Güvenli ve Şeffaf Süreç", description: "Tekliften iş tamamlanana kadar süreci tek platformdan takip edin." },
        { title: "Zamandan Tasarruf Edin", description: "Doğru hizmet verene hızlıca ulaşarak operasyonunuzu aksatmayın." },
      ]);
      await verifyResponsive(page, "Hizmet Alan (Zeynep)");
      await context.close();
    }

    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await login(page, MERT);
      page.jsProblems = [];
      await verifyRoleFeatures(page, "Hizmet Veren (Mert)", [
        { title: "Güvenilir İş Fırsatları", description: "Uygun lojistik hizmet ilanlarını inceleyin ve güvenle teklif verin." },
        { title: "Türkiye Genelinde İlanlar", description: "Farklı şehirlerdeki iş fırsatlarına tek platformdan ulaşın." },
        { title: "İşinizi Büyütün", description: "Yeni müşterilere ulaşın, düzenli iş alın ve operasyon hacminizi artırın." },
      ]);
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
