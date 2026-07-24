// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde
// "Verdiğim Teklifler" kart aksiyon alanı (İlan detayına git + Tekliften
// Vazgeç) düzeninin canlıda da doğru çalıştığını doğrular. Prod'da
// DEV_ACCOUNTS seed edilmediği için (NODE_ENV==="development" gated) gerçek
// kayıt formuyla TAZE hesaplar oluşturulur.
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Aksiyon Requester", email: `prod-aksiyon-req-${STAMP}@test.com`, phone: "0532 111 22 33", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Aksiyon Provider", email: `prod-aksiyon-prov-${STAMP}@test.com`, phone: "0533 444 55 66", password: "Provider1!", role: "hizmet-veren" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.type(text);
}

async function registerAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=${encodeURIComponent(redirect)}`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await typeInto(page, page.getByLabel("Ad Soyad"), account.name);
  await typeInto(page, page.getByLabel("E-posta"), account.email);
  await typeInto(page, page.getByLabel("Telefon Numarası"), account.phone);
  await typeInto(page, page.getByLabel("Şifre", { exact: true }), account.password);
  await typeInto(page, page.getByLabel("Şifre Tekrar"), account.password);
  await page.getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function injectJob(page, { jobId, title, requesterId }) {
  await page.evaluate(
    ({ jobId, title, requesterId }) => {
      const job = {
        id: jobId,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: `${title} - production aksiyon alanı doğrulaması için oluşturulan test ilanı.`,
        operationDetails: "Test.",
        status: "yayinda",
        requesterId,
        photos: [],
      };
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId, title, requesterId },
  );
}

async function submitOffer(page, jobId, note) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await typeInto(page, page.getByLabel("Teklif Fiyatı"), "4000");
  await typeInto(page, page.getByLabel("Tahmini Hizmet Süresi"), "1 gün");
  await typeInto(page, page.getByLabel("Teklif Açıklaması"), `${note}, yirmi karakterden uzun açıklama metni.`);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 });
}

async function verifyLayout(page, viewportLabel) {
  console.log(`\n[${viewportLabel}] /panel/tekliflerim kart aksiyon alanı (PRODUCTION)`);
  await page.goto(`${BASE_URL}/panel/tekliflerim`);

  const card = page.locator("div.rounded-card").filter({ hasText: "Prod Aksiyon Testi" }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });

  const link = card.getByRole("link", { name: "İlan detayına git" });
  const withdrawBtn = card.getByRole("button", { name: "Tekliften Vazgeç" });
  await link.waitFor({ state: "visible" });
  await withdrawBtn.waitFor({ state: "visible" });

  const cardBox = await card.boundingBox();
  const linkBox = await link.boundingBox();
  const btnBox = await withdrawBtn.boundingBox();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check("sayfada yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  const sameRow = linkBox.y < btnBox.y + btnBox.height && btnBox.y < linkBox.y + linkBox.height;
  console.log(
    `    [bilgi] link: x=${linkBox.x.toFixed(1)}-${(linkBox.x + linkBox.width).toFixed(1)} y=${linkBox.y.toFixed(1)}, buton: x=${btnBox.x.toFixed(1)}-${(btnBox.x + btnBox.width).toFixed(1)} y=${btnBox.y.toFixed(1)}, kart genişlik=${cardBox.width.toFixed(1)}`,
  );

  if (sameRow) {
    const leftPad = linkBox.x - cardBox.x;
    const rightPad = cardBox.x + cardBox.width - (btnBox.x + btnBox.width);
    check("sol/sağ iç boşluk eşit", Math.abs(leftPad - rightPad) < 2, `sol=${leftPad.toFixed(1)}, sağ=${rightPad.toFixed(1)}`);
    check("buton kartın sağ iç kenarına hizalı", rightPad >= 20 && rightPad <= 28, `sağ boşluk=${rightPad.toFixed(1)}`);
    const gap = btnBox.x - (linkBox.x + linkBox.width);
    check("link ile buton arasında geniş boşluk var (>=80px)", gap >= 80, `boşluk=${gap.toFixed(1)}px`);
  } else {
    check("mobilde link üstte, buton altta", linkBox.y < btnBox.y, `link.y=${linkBox.y.toFixed(1)}, buton.y=${btnBox.y.toFixed(1)}`);
    const vGap = btnBox.y - (linkBox.y + linkBox.height);
    check("mobilde link/buton dikeyde çakışmıyor", vGap >= 8, `dikey boşluk=${vGap.toFixed(1)}px`);
    const leftPad = btnBox.x - cardBox.x;
    const rightPad = cardBox.x + cardBox.width - (btnBox.x + btnBox.width);
    check("mobilde buton tam genişlik", Math.abs(leftPad - rightPad) < 2 && btnBox.width > cardBox.width * 0.85, `buton genişliği=${btnBox.width.toFixed(1)}, kart genişliği=${cardBox.width.toFixed(1)}`);
  }

  await withdrawBtn.click();
  const dialog = page.getByRole("dialog", { name: "Tekliften Vazgeç" });
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  check("butona tıklayınca diyalog açılıyor (işlev korunmuş, PRODUCTION)", await dialog.isVisible(), "");
  await page.keyboard.press("Escape");
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    console.log(`Hedef: ${BASE_URL}`);
    console.log("=== Kurulum: production'da taze hesaplarla 'pending' teklif oluşturuluyor ===");
    await registerAs(page, REQUESTER, "/hizmet-talebi-olustur");
    const requesterId = await getUserId(page, REQUESTER.email);
    const jobId = `prod-verify-offer-card-${STAMP}`;
    await injectJob(page, { jobId, title: "Prod Aksiyon Testi", requesterId });
    await clearSession(page);

    await registerAs(page, PROVIDER);
    await submitOffer(page, jobId, "Prod Aksiyon Testi");

    await page.setViewportSize({ width: 1280, height: 800 });
    await verifyLayout(page, "Masaüstü 1280x800");

    await page.setViewportSize({ width: 375, height: 812 });
    await verifyLayout(page, "Mobil 375x812");

    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ (PRODUCTION)." : "\nSONUÇ: TÜM KONTROLLER PRODUCTION'DA DA GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify-prod] GENEL HATA:", error);
  process.exitCode = 1;
});
