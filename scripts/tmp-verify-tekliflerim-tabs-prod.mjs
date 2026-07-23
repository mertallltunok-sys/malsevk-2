// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde "Verdiğim
// Teklifler" sayfasındaki sekme sadeleştirmesini (Kabul Edilen sekmesinin
// kaldırılıp Aktif'e birleştirilmesi) taze kayıtlı hesaplarla doğrular.
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Tab Requester", email: `prod-tab-req-${STAMP}@test.com`, phone: "0532 111 22 44", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Tab Provider", email: `prod-tab-prov-${STAMP}@test.com`, phone: "0533 444 55 77", password: "Provider1!", role: "hizmet-veren" };

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
  return page.evaluate(
    ({ requesterId, providerId }) => {
      const STAMP2 = Date.now();
      const jobBase = {
        category: "Depolama", province: "Kocaeli", district: "Gebze",
        workLocationType: "Test Tesis", workDate: "2026-12-01",
        description: "Prod sekme doğrulaması için oluşturulan test ilanı.",
        operationDetails: "Test.", status: "yayinda", requesterId, photos: [],
      };
      const offerBase = {
        providerId, amount: 5000, currency: "TRY",
        description: "Prod sekme doğrulaması için oluşturulan test teklifi metni.",
        estimatedDuration: "2 gün",
      };
      const now = new Date().toISOString();
      const scenarios = [
        { key: "pending", jobTitle: `PRODSADE-BEKLEMEDE-${STAMP2}`, offerStatus: "pending" },
        { key: "accepted", jobTitle: `PRODSADE-KABUL-${STAMP2}`, offerStatus: "accepted" },
        { key: "in_progress", jobTitle: `PRODSADE-DEVAMEDEN-${STAMP2}`, offerStatus: "in_progress" },
        { key: "completed", jobTitle: `PRODSADE-TAMAMLANDI-${STAMP2}`, offerStatus: "completed" },
        { key: "rejected", jobTitle: `PRODSADE-REDDEDILDI-${STAMP2}`, offerStatus: "rejected" },
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
      window.__PRODSADE_STAMP__ = STAMP2;
      return STAMP2;
    },
    { requesterId, providerId },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: taze hesaplar + test senaryoları (PRODUCTION) ===");
    await registerAs(page, REQUESTER, "/hizmet-talebi-olustur");
    const requesterId = await getUserId(page, REQUESTER.email);
    await page.goto(`${BASE_URL}/`);
    await registerAs(page, PROVIDER);
    const providerId = await getUserId(page, PROVIDER.email);
    const stamp = await seedScenario(page, requesterId, providerId);
    console.log(`    [bilgi] STAMP=${stamp}`);

    console.log("\n=== Sekme listesi (PRODUCTION) ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 15000 });
    const tabTexts = await tablist.getByRole("tab").allInnerTexts();
    check("tam olarak 3 sekme render ediliyor", tabTexts.length === 3, `[${tabTexts.join(", ")}]`);
    check("sekmeler tam olarak Aktif/Devam Eden/Tamamlanan",
      JSON.stringify(tabTexts) === JSON.stringify(["Aktif", "Devam Eden", "Tamamlanan"]),
      `[${tabTexts.join(", ")}]`);
    check("'Kabul Edilen' sekmesi yok", !tabTexts.includes("Kabul Edilen"));

    console.log("\n=== 'Aktif' sekmesi (PRODUCTION) ===");
    let bodyText = await page.locator("main").innerText();
    check("BEKLEMEDE (pending) görünüyor", bodyText.includes(`PRODSADE-BEKLEMEDE-${stamp}`));
    check("KABUL (accepted) artık BURADA görünüyor", bodyText.includes(`PRODSADE-KABUL-${stamp}`));
    check("REDDEDILDI (rejected) görünüyor", bodyText.includes(`PRODSADE-REDDEDILDI-${stamp}`));
    check("DEVAMEDEN (in_progress) BURADA YOK", !bodyText.includes(`PRODSADE-DEVAMEDEN-${stamp}`));
    check("TAMAMLANDI (completed) BURADA YOK", !bodyText.includes(`PRODSADE-TAMAMLANDI-${stamp}`));

    console.log("\n=== 'Devam Eden' sekmesi (PRODUCTION) ===");
    await page.getByRole("tab", { name: "Devam Eden" }).click();
    await page.waitForURL(/durum=devam-eden/, { timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("DEVAMEDEN (in_progress) görünüyor", bodyText.includes(`PRODSADE-DEVAMEDEN-${stamp}`));
    check("KABUL (accepted) BURADA YOK", !bodyText.includes(`PRODSADE-KABUL-${stamp}`));

    console.log("\n=== 'Tamamlanan' sekmesi (PRODUCTION) ===");
    await page.getByRole("tab", { name: "Tamamlanan" }).click();
    await page.waitForURL(/durum=tamamlandi/, { timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("TAMAMLANDI (completed) görünüyor", bodyText.includes(`PRODSADE-TAMAMLANDI-${stamp}`));
    check("KABUL (accepted) BURADA YOK", !bodyText.includes(`PRODSADE-KABUL-${stamp}`));

    console.log("\n=== Eski '?durum=kabul-edildi' linki (profil menüsü, bu görevde değiştirilmedi) ===");
    const hamburgerOrProfile = page.getByRole("button", { name: /Prod Tab Provider/ }).first();
    await hamburgerOrProfile.click();
    const kabulLink = page.getByRole("menuitem", { name: "Kabul Edilen Teklifler" });
    const kabulHref = await kabulLink.getAttribute("href");
    check("link hâlâ mevcut", kabulHref === "/panel/tekliflerim?durum=kabul-edildi", `href="${kabulHref}"`);
    await kabulLink.click();
    await page.waitForURL(/durum=kabul-edildi/, { timeout: 10000 });
    check("404 değil", !(await page.locator("text=404").isVisible().catch(() => false)));
    const fallbackActiveTab = await page.getByRole("tab", { selected: true }).innerText();
    check("bilinmeyen durum parametresiyle 'Aktif'e düşülüyor", fallbackActiveTab === "Aktif", `seçili: ${fallbackActiveTab}`);
    bodyText = await page.locator("main").innerText();
    check("KABUL (accepted) burada da görünüyor", bodyText.includes(`PRODSADE-KABUL-${stamp}`));

    check("Genel: konsol hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    // localStorage yalnızca aynı context içinde paylaşılır (bkz. kurulum
    // adımındaki not) — mobil doğrulama için oturum/veriyi yeni context'e
    // storageState ile taşıyoruz, aksi halde taze context'te ne kayıtlı
    // hesap ne de seed edilmiş teklif verisi bulunur.
    const storageState = await context.storageState();
    await context.close();

    console.log("\n=== Mobil (320px, PRODUCTION) ===");
    const mobileContext = await browser.newContext({ viewport: { width: 320, height: 812 }, storageState });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await mobilePage.goto(`${BASE_URL}/panel/tekliflerim`);
    await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const mobileTabTexts = await mobilePage.getByRole("tab").allInnerTexts();
    check("320px: üç sekme render ediliyor", mobileTabTexts.length === 3, `[${mobileTabTexts.join(", ")}]`);
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("320px: yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    check("320px: konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

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
