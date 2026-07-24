// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde Hizmet Veren
// profil menüsündeki 4 gerçek bağlantıyı (Kabul Edilen Teklifler, Devam Eden
// İşler, Tamamlanan İşler, Bildirimler) taze kayıtlı hesaplarla doğrular.
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Menu Requester", email: `prod-menu-req-${STAMP}@test.com`, phone: "0532 111 22 33", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Menu Provider", email: `prod-menu-prov-${STAMP}@test.com`, phone: "0533 444 55 66", password: "Provider1!", role: "hizmet-veren" };

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
  await page.getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function seedScenario(page, requesterId, providerId) {
  await page.evaluate(
    ({ requesterId, providerId }) => {
      const STAMP2 = Date.now();
      const jobBase = {
        category: "Depolama", province: "Kocaeli", district: "Gebze",
        workLocationType: "Test Tesis", workDate: "2026-12-01",
        description: "Prod menü doğrulaması için oluşturulan test ilanı.",
        operationDetails: "Test.", status: "yayinda", requesterId, photos: [],
      };
      const offerBase = {
        providerId, amount: 5000, currency: "TRY",
        description: "Prod menü doğrulaması için oluşturulan test teklifi metni.",
        estimatedDuration: "2 gün",
      };
      const now = new Date().toISOString();
      const scenarios = [
        { key: "accepted", jobTitle: `PRODMENU-KABUL-${STAMP2}`, offerStatus: "accepted" },
        { key: "in_progress", jobTitle: `PRODMENU-DEVAMEDEN-${STAMP2}`, offerStatus: "in_progress" },
        { key: "completed", jobTitle: `PRODMENU-TAMAMLANDI-${STAMP2}`, offerStatus: "completed" },
      ];
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      for (const scenario of scenarios) {
        const jobId = `prodjob-${scenario.key}-${STAMP2}`;
        jobs.push({ id: jobId, title: scenario.jobTitle, ...jobBase });
        offers.push({ id: `prodoffer-${scenario.key}-${STAMP2}`, jobId, status: scenario.offerStatus, createdAt: now, updatedAt: now, ...offerBase });
      }
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      window.__PRODMENU_STAMP__ = STAMP2;
    },
    { requesterId, providerId },
  );
  return page.evaluate(() => window.__PRODMENU_STAMP__);
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: taze hesaplar + test senaryoları ===");
    await registerAs(page, REQUESTER, "/hizmet-talebi-olustur");
    const requesterId = await getUserId(page, REQUESTER.email);
    await page.goto(`${BASE_URL}/`);
    await registerAs(page, PROVIDER);
    const providerId = await getUserId(page, PROVIDER.email);
    const stamp = await seedScenario(page, requesterId, providerId);
    console.log(`    [bilgi] STAMP=${stamp}`);

    const hamburgerOrProfile = page.getByRole("button", { name: /Prod Menu Provider/ }).first();

    console.log("\n=== 'Kabul Edilen Teklifler' (PRODUCTION) ===");
    await hamburgerOrProfile.click();
    const kabulLink = page.getByRole("menuitem", { name: "Kabul Edilen Teklifler" });
    check("href gerçek route", (await kabulLink.getAttribute("href")) === "/panel/tekliflerim?durum=kabul-edildi");
    await kabulLink.click();
    await page.waitForURL(/durum=kabul-edildi/, { timeout: 10000 });
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    let bodyText = await page.locator("main").innerText();
    check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    check("KABUL ilanı görünüyor", bodyText.includes(`PRODMENU-KABUL-${stamp}`));
    check("DEVAMEDEN ilanı burada görünmüyor", !bodyText.includes(`PRODMENU-DEVAMEDEN-${stamp}`));

    console.log("\n=== 'Devam Eden İşler' (PRODUCTION) ===");
    await hamburgerOrProfile.click();
    const devamLink = page.getByRole("menuitem", { name: "Devam Eden İşler" });
    check("href gerçek route", (await devamLink.getAttribute("href")) === "/panel/tekliflerim?durum=devam-eden");
    await devamLink.click();
    await page.waitForURL(/durum=devam-eden/, { timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    check("DEVAMEDEN ilanı görünüyor", bodyText.includes(`PRODMENU-DEVAMEDEN-${stamp}`));
    check("KABUL ilanı burada görünmüyor", !bodyText.includes(`PRODMENU-KABUL-${stamp}`));

    console.log("\n=== 'Tamamlanan İşler' (PRODUCTION) ===");
    await hamburgerOrProfile.click();
    const tamamlananLink = page.getByRole("menuitem", { name: "Tamamlanan İşler" });
    check("href gerçek route", (await tamamlananLink.getAttribute("href")) === "/panel/tekliflerim?durum=tamamlandi");
    await tamamlananLink.click();
    await page.waitForURL(/durum=tamamlandi/, { timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    check("TAMAMLANDI ilanı görünüyor", bodyText.includes(`PRODMENU-TAMAMLANDI-${stamp}`));
    check("DEVAMEDEN ilanı burada görünmüyor", !bodyText.includes(`PRODMENU-DEVAMEDEN-${stamp}`));

    console.log("\n=== 'Bildirimler' (PRODUCTION) ===");
    await hamburgerOrProfile.click();
    const bildirimLink = page.getByRole("menuitem", { name: "Bildirimler" });
    check("href gerçek route", (await bildirimLink.getAttribute("href")) === "/panel/bildirimler");
    await bildirimLink.click();
    await page.waitForURL(/\/panel\/bildirimler/, { timeout: 10000 });
    check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    check(
      "'yalnızca Hizmet Alan' engeliyle karşılaşmıyor",
      !(await page.getByText("Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir.").isVisible().catch(() => false)),
    );

    check("Genel: konsol hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
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
