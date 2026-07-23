// "Verdiğim Teklifler" sayfasındaki sekme sadeleştirmesini doğrular:
// "Kabul Edilen" sekmesi tamamen kaldırıldı, kabul edilmiş ama iş henüz
// başlamamış teklifler artık "Aktif" sekmesinde gösteriliyor. Yalnızca üç
// sekme (Aktif/Devam Eden/Tamamlanan) render ediliyor, hiçbir teklif iki
// sekmede birden görünmüyor, reddedilen/iptal edilen teklifler hâlâ güvenli
// şekilde "Aktif"e düşüyor, mobilde (320px) taşma yok. "withdrawn" (geri
// çekilmiş) teklifler BURADA KASITLI OLARAK "Aktif"e düşmez — sonraki bir
// görevde (bkz. job-requests.ts#isOfferVisibleInNormalLists,
// tmp-verify-withdrawn-offer-removal.mjs) tüm normal listelerden tamamen
// kaldırıldı; bu dosyadaki VAZGECILDI kontrolü o değişikliği yansıtacak
// şekilde güncellenmiştir.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
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

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
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

async function seedScenario(page, zeynepId, mertId) {
  return page.evaluate(
    ({ zeynepId, mertId }) => {
      const STAMP = Date.now();
      const jobBase = {
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Sekme sadeleştirme senaryosu için oluşturulan test ilanı.",
        operationDetails: "Test.",
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
      };
      const offerBase = {
        providerId: mertId,
        amount: 5000,
        currency: "TRY",
        description: "Sekme sadeleştirme senaryosu için oluşturulan test teklifi metni.",
        estimatedDuration: "2 gün",
      };
      const now = new Date().toISOString();

      const scenarios = [
        { key: "pending", jobTitle: `SADE-BEKLEMEDE-${STAMP}`, offerStatus: "pending" },
        { key: "accepted", jobTitle: `SADE-KABUL-${STAMP}`, offerStatus: "accepted" },
        { key: "in_progress", jobTitle: `SADE-DEVAMEDEN-${STAMP}`, offerStatus: "in_progress" },
        {
          key: "completion_requested",
          jobTitle: `SADE-ONAYBEKLIYOR-${STAMP}`,
          offerStatus: "completion_requested",
          extra: { completionRequestedByUserId: mertId, completionRequestedAt: now },
        },
        {
          key: "completion_disputed",
          jobTitle: `SADE-ITIRAZ-${STAMP}`,
          offerStatus: "completion_disputed",
          extra: {
            completionRequestedByUserId: mertId,
            completionRequestedAt: now,
            completionDisputeNote: "Test itiraz notu, en az on karakter.",
          },
        },
        { key: "completed", jobTitle: `SADE-TAMAMLANDI-${STAMP}`, offerStatus: "completed" },
        { key: "cancelled", jobTitle: `SADE-IPTAL-${STAMP}`, offerStatus: "cancelled" },
        { key: "rejected", jobTitle: `SADE-REDDEDILDI-${STAMP}`, offerStatus: "rejected" },
        { key: "withdrawn", jobTitle: `SADE-VAZGECILDI-${STAMP}`, offerStatus: "withdrawn" },
        { key: "agreement_failed", jobTitle: `SADE-ANLASMAOLMADI-${STAMP}`, offerStatus: "agreement_failed" },
      ];

      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");

      for (const scenario of scenarios) {
        const jobId = `job-${scenario.key}-${STAMP}`;
        const offerId = `offer-${scenario.key}-${STAMP}`;
        jobs.push({ id: jobId, title: scenario.jobTitle, ...jobBase });
        offers.push({
          id: offerId,
          jobId,
          status: scenario.offerStatus,
          createdAt: now,
          updatedAt: now,
          ...offerBase,
          ...(scenario.extra ?? {}),
        });
      }

      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      window.__SADE_STAMP__ = STAMP;
      return STAMP;
    },
    { zeynepId, mertId },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: test senaryoları localStorage'a yazılıyor ===");
    await login(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await login(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    const stamp = await seedScenario(page, zeynepId, mertId);
    console.log(`    [bilgi] STAMP=${stamp}`);

    // --- 1) Sekme listesi: yalnızca üç sekme, "Kabul Edilen" yok ---
    console.log("\n=== Sekme listesi ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    const tabTexts = await tablist.getByRole("tab").allInnerTexts();
    check("tam olarak 3 sekme render ediliyor", tabTexts.length === 3, `[${tabTexts.join(", ")}]`);
    check("sekmeler tam olarak Aktif/Devam Eden/Tamamlanan",
      JSON.stringify(tabTexts) === JSON.stringify(["Aktif", "Devam Eden", "Tamamlanan"]),
      `[${tabTexts.join(", ")}]`);
    check("'Kabul Edilen' sekmesi yok", !tabTexts.includes("Kabul Edilen"));

    // --- 2) Aktif sekmesi: pending + accepted + rejected/cancelled/withdrawn/agreement_failed ---
    console.log("\n=== 'Aktif' sekmesi ===");
    let bodyText = await page.locator("main").innerText();
    check("BEKLEMEDE (pending) görünüyor", bodyText.includes(`SADE-BEKLEMEDE-${stamp}`));
    check("KABUL (accepted) artık BURADA görünüyor (Kabul Edilen sekmesi kaldırıldı)", bodyText.includes(`SADE-KABUL-${stamp}`));
    check("REDDEDILDI (rejected) görünüyor", bodyText.includes(`SADE-REDDEDILDI-${stamp}`));
    check("IPTAL (cancelled) görünüyor", bodyText.includes(`SADE-IPTAL-${stamp}`));
    check("VAZGECILDI (withdrawn) BURADA YOK (tüm normal listelerden kaldırıldı)", !bodyText.includes(`SADE-VAZGECILDI-${stamp}`));
    check("ANLASMAOLMADI (agreement_failed) görünüyor", bodyText.includes(`SADE-ANLASMAOLMADI-${stamp}`));
    check("DEVAMEDEN (in_progress) BURADA YOK", !bodyText.includes(`SADE-DEVAMEDEN-${stamp}`));
    check("ONAYBEKLIYOR (completion_requested) BURADA YOK", !bodyText.includes(`SADE-ONAYBEKLIYOR-${stamp}`));
    check("ITIRAZ (completion_disputed) BURADA YOK", !bodyText.includes(`SADE-ITIRAZ-${stamp}`));
    check("TAMAMLANDI (completed) BURADA YOK", !bodyText.includes(`SADE-TAMAMLANDI-${stamp}`));

    // --- 2b) "Tekliften Vazgeç" işlevi (regresyon) — bekleyen teklif Aktif'te ---
    console.log("\n=== 'Tekliften Vazgeç' işlevi (regresyon) ===");
    const pendingHeading = page.getByRole("heading", { name: /SADE-BEKLEMEDE/ });
    const pendingCard = pendingHeading.locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
    const withdrawButton = pendingCard.getByRole("button", { name: "Tekliften Vazgeç" });
    check("'Tekliften Vazgeç' butonu bekleyen teklifte (Aktif sekmesi) görünüyor", await withdrawButton.isVisible().catch(() => false));

    // --- 3) Devam Eden sekmesi ---
    console.log("\n=== 'Devam Eden' sekmesi ===");
    await page.getByRole("tab", { name: "Devam Eden" }).click();
    await page.waitForURL(/durum=devam-eden/, { timeout: 5000 });
    bodyText = await page.locator("main").innerText();
    check("DEVAMEDEN (in_progress) görünüyor", bodyText.includes(`SADE-DEVAMEDEN-${stamp}`));
    check("ONAYBEKLIYOR (completion_requested) görünüyor", bodyText.includes(`SADE-ONAYBEKLIYOR-${stamp}`));
    check("ITIRAZ (completion_disputed) görünüyor", bodyText.includes(`SADE-ITIRAZ-${stamp}`));
    check("KABUL (accepted) BURADA YOK", !bodyText.includes(`SADE-KABUL-${stamp}`));
    check("TAMAMLANDI (completed) BURADA YOK", !bodyText.includes(`SADE-TAMAMLANDI-${stamp}`));
    check("BEKLEMEDE (pending) BURADA YOK", !bodyText.includes(`SADE-BEKLEMEDE-${stamp}`));

    // --- 4) Tamamlanan sekmesi ---
    console.log("\n=== 'Tamamlanan' sekmesi ===");
    await page.getByRole("tab", { name: "Tamamlanan" }).click();
    await page.waitForURL(/durum=tamamlandi/, { timeout: 5000 });
    bodyText = await page.locator("main").innerText();
    check("TAMAMLANDI (completed) görünüyor", bodyText.includes(`SADE-TAMAMLANDI-${stamp}`));
    check("KABUL (accepted) BURADA YOK", !bodyText.includes(`SADE-KABUL-${stamp}`));
    check("DEVAMEDEN (in_progress) BURADA YOK", !bodyText.includes(`SADE-DEVAMEDEN-${stamp}`));
    check("IPTAL (cancelled) BURADA YOK", !bodyText.includes(`SADE-IPTAL-${stamp}`));
    check("REDDEDILDI (rejected) BURADA YOK", !bodyText.includes(`SADE-REDDEDILDI-${stamp}`));

    // --- 5) Eski "?durum=kabul-edildi" linki artık kırılmıyor, Aktif'e düşüyor ---
    console.log("\n=== Eski '?durum=kabul-edildi' query param'ı (geriye dönük uyumluluk) ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=kabul-edildi`);
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const fallbackActiveTab = await page.getByRole("tab", { selected: true }).innerText();
    check("bilinmeyen durum parametresiyle 'Aktif' sekmesine düşülüyor", fallbackActiveTab === "Aktif", `seçili: ${fallbackActiveTab}`);
    bodyText = await page.locator("main").innerText();
    check("KABUL (accepted) burada da görünüyor (artık Aktif'in parçası)", bodyText.includes(`SADE-KABUL-${stamp}`));
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    // --- 6) Profil menüsündeki "Kabul Edilen Teklifler" linkine dokunulmadı, hâlâ çalışıyor ---
    console.log("\n=== Profil menüsü 'Kabul Edilen Teklifler' linki (bu görev kapsamında değiştirilmedi) ===");
    await page.goto(`${BASE_URL}/panel`);
    const hamburgerOrProfile = page.getByRole("button", { name: /Mert/ }).first();
    await hamburgerOrProfile.click();
    const kabulLink = page.getByRole("menuitem", { name: "Kabul Edilen Teklifler" });
    const kabulHref = await kabulLink.getAttribute("href");
    check("link hâlâ mevcut ve /panel/tekliflerim?durum=kabul-edildi'ye gidiyor", kabulHref === "/panel/tekliflerim?durum=kabul-edildi", `href="${kabulHref}"`);
    await kabulLink.click();
    await page.waitForURL(/durum=kabul-edildi/, { timeout: 5000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    check("Genel: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    // --- 7) Mobil (375px) ve dar (320px): taşma yok, üç sekme sığıyor ---
    console.log("\n=== Mobil görünüm ===");
    for (const width of [320, 375]) {
      const mobileContext = await browser.newContext({ viewport: { width, height: 812 } });
      const mobilePage = await mobileContext.newPage();
      attachDiagnostics(mobilePage);
      await login(mobilePage, MERT, "/panel/tekliflerim");
      await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
      const mobileTabTexts = await mobilePage.getByRole("tab").allInnerTexts();
      check(`${width}px: üç sekme render ediliyor`, mobileTabTexts.length === 3, `[${mobileTabTexts.join(", ")}]`);
      const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
      check(`${width}px: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      check(`${width}px: konsol hatası yok`, mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
      await mobileContext.close();
    }

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
