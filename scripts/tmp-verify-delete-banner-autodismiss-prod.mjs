// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde "İlan
// başarıyla silindi." banner'ının artık ~3sn sonra fade-out ile DOM'dan
// kalktığını, taze kayıtlı bir hesapla doğrular.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Banner Test", email: `prod-banner-${STAMP}@test.com`, phone: "0532 111 22 66", password: "Requester1!", role: "hizmet-alan" };
const BANNER_TEXT = "İlan başarıyla silindi.";

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
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
  await page.getByRole("radio", { name: "Hizmet Alan" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    await registerAs(page, REQUESTER, "/panel");
    const requesterId = await page.evaluate(
      ({ email }) => {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        return users.find((u) => u.email === email)?.id;
      },
      { email: REQUESTER.email },
    );

    const JOB_ID = `prod-banner-job-${STAMP}`;
    const JOB_TITLE = `PRODBANNER-${STAMP}`;
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
          description: "Prod banner testi için oluşturulan ilan.",
          operationDetails: "Test operasyon detayı.",
          status: "yayinda",
          requesterId,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      },
      { jobId: JOB_ID, title: JOB_TITLE, requesterId },
    );

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const jobVisible = await page.getByText(JOB_TITLE).first().isVisible().catch(() => false);
    check("[kurulum] test ilanı listede görünüyor (PRODUCTION)", jobVisible);

    const card = page.locator("li", { hasText: JOB_TITLE });
    await card.getByRole("button", { name: "İlanı Sil" }).click();
    await page.getByRole("button", { name: "Evet, İlanı Sil" }).click();

    const banner = page.getByText(BANNER_TEXT);
    await assert.doesNotReject(banner.waitFor({ state: "visible", timeout: 10000 }));
    check("[1] Silme sonrası banner hemen görünüyor (PRODUCTION)", true);

    await page.waitForTimeout(2500);
    const stillVisible = await banner.isVisible().catch(() => false);
    check("[2] ~2.5sn'de hâlâ görünür (PRODUCTION)", stillVisible);

    await page.waitForTimeout(900);
    const countAfterFade = await page.getByText(BANNER_TEXT).count();
    check("[3] ~3.4sn sonra DOM'dan tamamen kaldırıldı (PRODUCTION)", countAfterFade === 0, `adet=${countAfterFade}`);

    await page.reload();
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const countAfterReload = await page.getByText(BANNER_TEXT).count();
    check("[4] Sayfa yenilendiğinde banner tekrar görünmüyor (PRODUCTION)", countAfterReload === 0, `adet=${countAfterReload}`);

    check("Genel: konsol/hydration hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
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
