// Hizmet Veren "Panel Özeti" istatistik kartlarındaki "YAKINDA" etiketlerinin
// kaldırılıp gerçek route'lara bağlandığını doğrular: tüm kart tıklanabilir,
// "Görüntüle" alt bağlantısı kartla aynı route'a gidiyor, 404 yok, mobil/
// masaüstü hover ve responsive davranışı bozulmamış.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const MERT = { email: "mert@test.com", password: "Mert123!" };

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

const CARDS = [
  { label: "Kabul Edilen Teklifler", expectedUrlPattern: /durum=kabul-edildi/ },
  { label: "Devam Eden İşler", expectedUrlPattern: /durum=devam-eden/ },
  { label: "Tamamlanan İşler", expectedUrlPattern: /durum=tamamlandi/ },
];

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);
    await login(page, MERT, "/panel");

    console.log("\n=== 'YAKINDA' rozeti kontrolü ===");
    const mainText = await page.locator("main").innerText();
    check('"Yakında" metni panelde artık hiç yok', !mainText.includes("Yakında"));

    for (const { label, expectedUrlPattern } of CARDS) {
      console.log(`\n=== '${label}' kartı ===`);
      await page.goto(`${BASE_URL}/panel`);

      const card = page.getByRole("link").filter({ hasText: label }).first();
      await card.waitFor({ state: "visible" });

      const cardHref = await card.getAttribute("href");
      check("kart href gerçek bir route (# / boş / javascript: değil)", Boolean(cardHref) && cardHref !== "#" && !cardHref.startsWith("javascript:"), `href="${cardHref}"`);

      // Kartın tamamı tıklanabilir mi: en üstteki ikon alanına tıklamak da
      // (metin/link değil) aynı navigasyonu tetiklemeli.
      const cardBox = await card.boundingBox();
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 15);
      const cursorAtTop = await page.evaluate(() => getComputedStyle(document.elementFromPoint(window.__x ?? 0, window.__y ?? 0) ?? document.body).cursor);
      void cursorAtTop;

      await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + 15);
      await page.waitForURL(expectedUrlPattern, { timeout: 5000 }).catch(() => {});
      check("kartın ÜST kısmına (ikon alanı) tıklamak doğru sayfaya götürüyor", expectedUrlPattern.test(page.url()), `url=${page.url()}`);
      check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

      // Geri dön, bu sefer alttaki "Görüntüle" bağlantısına tıkla — aynı route'a gitmeli.
      await page.goto(`${BASE_URL}/panel`);
      const card2 = page.getByRole("link").filter({ hasText: label }).first();
      await card2.getByText("Görüntüle").click();
      await page.waitForURL(expectedUrlPattern, { timeout: 5000 }).catch(() => {});
      check("'Görüntüle' bağlantısı da aynı route'a gidiyor", expectedUrlPattern.test(page.url()), `url=${page.url()}`);
    }

    // Hover tutarlılığı: kartın herhangi bir noktasına hover yapınca border/shadow class'ı (group-hover tetiklenmesi) DOM'da var mı.
    console.log("\n=== Hover tutarlılığı ===");
    await page.goto(`${BASE_URL}/panel`);
    const kabulCard = page.getByRole("link").filter({ hasText: "Kabul Edilen Teklifler" }).first();
    const classAttr = await kabulCard.getAttribute("class");
    check("kart hover class'ları (hover:border-primary/40 hover:shadow-md) mevcut", (classAttr ?? "").includes("hover:border-primary/40") && (classAttr ?? "").includes("hover:shadow-md"), classAttr ?? "");

    check("Masaüstü: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    // Mobil
    console.log("\n=== Mobil (375px) ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await login(mobilePage, MERT, "/panel");
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("mobilde yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

    const mobileCard = mobilePage.getByRole("link").filter({ hasText: "Devam Eden İşler" }).first();
    await mobileCard.waitFor({ state: "visible" });
    await mobileCard.click();
    await mobilePage.waitForURL(/durum=devam-eden/, { timeout: 5000 }).catch(() => {});
    check("mobilde kart tıklanabiliyor", /durum=devam-eden/.test(mobilePage.url()), `url=${mobilePage.url()}`);
    check("mobilde konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

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
