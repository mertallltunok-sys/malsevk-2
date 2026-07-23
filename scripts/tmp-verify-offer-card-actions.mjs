// "Verdiğim Teklifler" (my-offers-panel.tsx) kart alt aksiyon alanının
// ("İlan detayına git" + "Tekliften Vazgeç") yeniden düzenlenmesini doğrular:
// masaüstünde iki uçlu (space-between) hizalama + yeterli boşluk, mobilde
// alt alta + tam genişlik buton, hiçbir ekran boyutunda taşma/çakışma yok.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
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
        description: `${title} - aksiyon alanı doğrulaması için oluşturulan test ilanı.`,
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
  await page.getByLabel("Teklif Fiyatı").fill("4000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("1 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill(`${note}, yirmi karakterden uzun açıklama metni.`);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

/**
 * İş/teklif yalnızca localStorage'da var olur (gerçek backend yok) — bu
 * yüzden oluşturma ve doğrulama AYNI browser context'inde (aynı
 * localStorage) yapılmalı; ayrı bir context tamamen izole/boş bir
 * localStorage doğurur (bkz. tmp-verify-menu-gallery.mjs'teki aynı not).
 */
async function setupPendingOffer(page) {
  await login(page, ZEYNEP, "/panel");
  const zeynepId = await getUserId(page, ZEYNEP.email);
  const jobId = `verify-offer-card-${Date.now()}`;
  await injectJob(page, { jobId, title: "Aksiyon Alanı Testi", requesterId: zeynepId });
  await clearSession(page);

  await login(page, MERT, "/panel");
  await submitOffer(page, jobId, "Aksiyon Alanı Testi");
  return jobId;
}

async function verifyLayout(page, viewportLabel) {
  console.log(`\n[${viewportLabel}] /panel/tekliflerim kart aksiyon alanı`);
  await page.goto(`${BASE_URL}/panel/tekliflerim`);

  const card = page.locator("div.rounded-card").filter({ hasText: "Aksiyon Alanı Testi" }).first();
  await card.waitFor({ state: "visible", timeout: 10000 });

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

  // Aynı satırda mı: dikey merkezleme nedeniyle üst kenarları (y) tam eşit
  // olmayabilir (buton dolgu nedeniyle daha yüksek, link daha kısa metin
  // kutusu) — asıl kriter, iki kutunun dikeyde ÇAKIŞIP çakışmadığıdır.
  const sameRow = linkBox.y < btnBox.y + btnBox.height && btnBox.y < linkBox.y + linkBox.height;
  console.log(
    `    [bilgi] link: x=${linkBox.x.toFixed(1)}-${(linkBox.x + linkBox.width).toFixed(1)} y=${linkBox.y.toFixed(1)}, buton: x=${btnBox.x.toFixed(1)}-${(btnBox.x + btnBox.width).toFixed(1)} y=${btnBox.y.toFixed(1)}, kart: x=${cardBox.x.toFixed(1)}-${(cardBox.x + cardBox.width).toFixed(1)} genişlik=${cardBox.width.toFixed(1)}`,
  );

  if (sameRow) {
    // Masaüstü/tablet: aynı satırda, iki uçlu.
    const leftPad = linkBox.x - cardBox.x;
    const rightPad = cardBox.x + cardBox.width - (btnBox.x + btnBox.width);
    check("sol/sağ iç boşluk eşit (kart padding korunmuş)", Math.abs(leftPad - rightPad) < 2, `sol=${leftPad.toFixed(1)}, sağ=${rightPad.toFixed(1)}`);
    check("buton kartın sağ iç kenarına hizalı", rightPad >= 20 && rightPad <= 28, `sağ boşluk=${rightPad.toFixed(1)}`);
    const gap = btnBox.x - (linkBox.x + linkBox.width);
    check("link ile buton arasında geniş boşluk var (>=80px)", gap >= 80, `boşluk=${gap.toFixed(1)}px`);
  } else {
    // Mobil: alt alta, buton tam genişlik.
    check("mobilde link üstte, buton altta", linkBox.y < btnBox.y, `link.y=${linkBox.y.toFixed(1)}, buton.y=${btnBox.y.toFixed(1)}`);
    const vGap = btnBox.y - (linkBox.y + linkBox.height);
    check("mobilde link ve buton dikeyde çakışmıyor, aralarında boşluk var", vGap >= 8, `dikey boşluk=${vGap.toFixed(1)}px`);
    const leftPad = btnBox.x - cardBox.x;
    const rightPad = cardBox.x + cardBox.width - (btnBox.x + btnBox.width);
    check("mobilde buton kart genişliğine yayılıyor (tam genişlik)", Math.abs(leftPad - rightPad) < 2 && btnBox.width > cardBox.width * 0.85, `sol=${leftPad.toFixed(1)}, sağ=${rightPad.toFixed(1)}, buton genişliği=${btnBox.width.toFixed(1)}, kart genişliği=${cardBox.width.toFixed(1)}`);
  }

  // İşlevsellik: buton hâlâ diyaloğu açıyor mu (mevcut davranış korunmuş mu).
  await withdrawBtn.click();
  const dialog = page.getByRole("dialog", { name: "Tekliften Vazgeç" });
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  check("butona tıklayınca 'Tekliften Vazgeç' diyaloğu açılıyor (işlev korunmuş)", await dialog.isVisible(), "");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });

  // Link hâlâ doğru sayfaya gidiyor mu.
  await link.click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 5000 });
  check("linke tıklayınca ilan detayına gidiliyor (işlev korunmuş)", page.url().includes("/ilanlar/"), page.url());
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    console.log("=== Kurulum: Mert için 'pending' bir teklif oluşturuluyor ===");
    await setupPendingOffer(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await verifyLayout(page, "Masaüstü 1280x800");

    await page.setViewportSize({ width: 820, height: 1180 });
    await verifyLayout(page, "Tablet 820x1180");

    await page.setViewportSize({ width: 375, height: 812 });
    await verifyLayout(page, "Mobil 375x812");

    await context.close();

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
