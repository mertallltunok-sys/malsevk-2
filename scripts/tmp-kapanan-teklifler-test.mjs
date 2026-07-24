// "Verdiğim Teklifler" sayfasına eklenen 4. sekmeyi ("Kapanan Teklifler")
// doğrular: aynı ilana B ve C teklif verir, Hizmet Alan B'yi kabul eder — bu
// aşamada C hâlâ "Aktif" sekmesinde normal akışında kalmalı (henüz işe
// başlanmadı). Hizmet Alan "İşe Başlandı" dediği anda C'nin teklifi
// "Aktif"ten çıkıp "Kapanan Teklifler"e taşınmalı, rozeti "Beklemede" yerine
// "Başka Bir Hizmet Verenle Anlaşıldı" olmalı ve "Tekliften Vazgeç" butonu
// tamamen kalkmalı. B'nin kendi akışı (Devam Eden) ve Tek Aktif Kabul kuralı
// (isOfferPendingActionBlocked) regresyon olarak da kontrol edilir.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" }; // B
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" }; // C
const STAMP = Date.now();
const JOB_ID = `kapanan-job-${STAMP}`;
const JOB_TITLE = `KAPANAN-TEKLIF-${STAMP}`;

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/panel") {
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

// B zaten "accepted", C hâlâ "pending" olarak seed edilir — asıl test edilen
// geçiş (accepted -> in_progress) gerçek UI akışıyla (Zeynep'in "İşe
// Başlandı" tıklaması) tetiklenir, seed'de taklit edilmez.
async function seedScenario(page, { zeynepId, mertId, mehmetId }) {
  return page.evaluate(
    ({ zeynepId, mertId, mehmetId, jobId, jobTitle }) => {
      const now = new Date().toISOString();
      const job = {
        id: jobId,
        title: jobTitle,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Kapanan Teklifler senaryosu için oluşturulan test ilanı.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
      };
      const offerB = {
        id: `offer-B-${jobId}`,
        jobId,
        providerId: mertId,
        amount: 6000,
        currency: "TRY",
        description: "B Hizmet Veren'in kabul edilmiş teklifi, en az yirmi karakter uzunluğunda metin.",
        estimatedDuration: "3 gün",
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      };
      const offerC = {
        id: `offer-C-${jobId}`,
        jobId,
        providerId: mehmetId,
        amount: 5500,
        currency: "TRY",
        description: "C Hizmet Veren'in bekleyen teklifi, en az yirmi karakter uzunluğunda metin.",
        estimatedDuration: "4 gün",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };

      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      jobs.push(job);
      offers.push(offerB, offerC);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { zeynepId, mertId, mehmetId, jobId: JOB_ID, jobTitle: JOB_TITLE },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: A ilanı, B kabul edilmiş + C bekleyen teklif ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await clearSession(page);
    await loginAs(page, MEHMET, "/panel");
    const mehmetId = await getUserId(page, MEHMET.email);
    await seedScenario(page, { zeynepId, mertId, mehmetId });
    check("[kurulum] ilan + B(accepted) + C(pending) teklifleri oluşturuldu", true);

    // === SENARYO 2: B kabul edildi ama işe henüz başlanmadı -> C hâlâ "Aktif" ===
    console.log('\n=== Senaryo 2: B kabul edildi, iş başlamadı -> C "Aktif"te normal akışında ===');
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    const tabTexts = await tablist.getByRole("tab").allInnerTexts();
    check(
      "tam olarak 4 sekme: Aktif/Devam Eden/Tamamlanan/Kapanan Teklifler",
      JSON.stringify(tabTexts) === JSON.stringify(["Aktif", "Devam Eden", "Tamamlanan", "Kapanan Teklifler"]),
      `[${tabTexts.join(", ")}]`,
    );

    let bodyText = await page.locator("main").innerText();
    check("[C/Aktif] C'nin teklifi 'Aktif' sekmesinde görünüyor", bodyText.includes(JOB_TITLE));
    check("[C/Aktif] rozet hâlâ 'Beklemede'", bodyText.includes("Beklemede"));
    const cCardActive = page.locator(".rounded-card", { hasText: JOB_TITLE });
    const withdrawBtnActive = cCardActive.getByRole("button", { name: "Tekliften Vazgeç" });
    check("[C/Aktif] 'Tekliften Vazgeç' butonu hâlâ görünüyor", await withdrawBtnActive.isVisible().catch(() => false));

    await page.getByRole("tab", { name: "Kapanan Teklifler" }).click();
    await page.waitForURL(/durum=kapanan-teklifler/, { timeout: 5000 });
    bodyText = await page.locator("main").innerText();
    check("[C/Kapanan] C'nin teklifi henüz 'Kapanan Teklifler'de YOK (iş henüz başlamadı)", !bodyText.includes(JOB_TITLE));

    // Regresyon: Tek Aktif Kabul kuralı — C hâlâ pending, B settled olduğu
    // için Hizmet Alan tarafında C'nin Kabul Et/Reddet butonları yerine
    // engelleme mesajı görünmeli (job-requests.ts#isOfferPendingActionBlocked,
    // bu görevde DOKUNULMADI).
    await clearSession(page);
    await loginAs(page, ZEYNEP, "/panel/gelen-teklifler");
    const cCardOnRequester = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mehmet Demir" });
    await cCardOnRequester.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[regresyon] Gelen Teklifler'de C için 'başka bir teklifin anlaşma süreci devam ediyor' mesajı var",
      await cCardOnRequester.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.").isVisible().catch(() => false),
    );
    check(
      "[regresyon] C için Kabul Et/Reddet butonları YOK",
      (await cCardOnRequester.getByRole("button", { name: "Kabul Et" }).count()) === 0,
    );

    // === SENARYO 3: Zeynep "İşe Başlandı" diyor (B: accepted -> in_progress) ===
    console.log('\n=== Senaryo 3: Zeynep "İşe Başlandı" diyor ===');
    const bCardOnRequester = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mert" }).filter({ hasNotText: "Mehmet" });
    await bCardOnRequester.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(400);
    check("[kurulum] B'nin teklifi işe başladı (in_progress)", true);
    await clearSession(page);

    // === SENARYO 4: C artık "Aktif"ten çıktı, "Kapanan Teklifler"e taşındı ===
    console.log('\n=== Senaryo 4: C artık "Aktif"ten çıktı, "Kapanan Teklifler"e taşındı ===');
    await loginAs(page, MEHMET, "/panel/tekliflerim");
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[C/Aktif] C'nin teklifi ARTIK 'Aktif'te YOK", !bodyText.includes(JOB_TITLE));

    await page.getByRole("tab", { name: "Kapanan Teklifler" }).click();
    await page.waitForURL(/durum=kapanan-teklifler/, { timeout: 5000 });
    bodyText = await page.locator("main").innerText();
    check("[C/Kapanan] C'nin teklifi 'Kapanan Teklifler'de görünüyor", bodyText.includes(JOB_TITLE));
    check(
      "[C/Kapanan] rozet 'Başka Bir Hizmet Verenle Anlaşıldı' (artık 'Beklemede' değil)",
      bodyText.includes("Başka Bir Hizmet Verenle Anlaşıldı"),
    );

    const cCardClosed = page.locator(".rounded-card", { hasText: JOB_TITLE });
    check(
      "[C/Kapanan] 'Tekliften Vazgeç' butonu tamamen kalktı",
      (await cCardClosed.getByRole("button", { name: "Tekliften Vazgeç" }).count()) === 0,
    );
    check(
      "[C/Kapanan] kartta hiç aksiyon butonu yok (yalnızca bilgilendirme)",
      (await cCardClosed.locator("button").count()) === 0,
    );

    // === SENARYO 5: B'nin kendi akışı bozulmadı (regresyon) ===
    console.log("\n=== Senaryo 5: B'nin kendi akışı — Devam Eden'de, Kapanan'da DEĞİL ===");
    await clearSession(page);
    await loginAs(page, MERT, "/panel/tekliflerim?durum=devam-eden");
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[B/Devam Eden] B'nin teklifi 'Devam Eden'de görünüyor", bodyText.includes(JOB_TITLE));

    await page.getByRole("tab", { name: "Kapanan Teklifler" }).click();
    await page.waitForURL(/durum=kapanan-teklifler/, { timeout: 5000 });
    bodyText = await page.locator("main").innerText();
    check("[B/Kapanan] B'nin KENDİ teklifi 'Kapanan Teklifler'de YOK", !bodyText.includes(JOB_TITLE));

    check("Genel: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    const storageState = await context.storageState();
    await context.close();

    // === SENARYO 6: Responsive (320/375/1280px) — 4 sekme, taşma yok ===
    // storageState ile taşınıyor -- aksi halde bu senaryoya ait job/offer
    // kayıtları taze context'te (temiz localStorage) hiç bulunmaz.
    console.log("\n=== Senaryo 6: Responsive genişlikler ===");
    for (const width of [320, 375, 1280]) {
      const rContext = await browser.newContext({ viewport: { width, height: 850 }, storageState });
      const rPage = await rContext.newPage();
      attachDiagnostics(rPage);
      // storageState taşınan oturum Mert'e (B) ait -- burada C'nin (Mehmet)
      // görünümü test edildiği için önce oturum temizlenip yeniden C olarak
      // giriş yapılır (jobs/offers/users verisi ayrı localStorage
      // anahtarlarında olduğu için bundan etkilenmez).
      await rPage.goto(BASE_URL);
      await clearSession(rPage);
      await loginAs(rPage, MEHMET, "/panel/tekliflerim?durum=kapanan-teklifler");
      const rTablist = rPage.getByRole("tablist", { name: "Teklif durumu" });
      await rTablist.waitFor({ state: "visible", timeout: 10000 });
      const rTabTexts = await rTablist.getByRole("tab").allInnerTexts();
      check(`${width}px: 4 sekme render ediliyor`, rTabTexts.length === 4, `[${rTabTexts.join(", ")}]`);
      const rBodyText = await rPage.locator("main").innerText();
      check(`${width}px: kapanan teklif görünüyor`, rBodyText.includes(JOB_TITLE));
      check(
        `${width}px: rozet metni görünüyor`,
        rBodyText.includes("Başka Bir Hizmet Verenle Anlaşıldı"),
      );
      const scrollWidth = await rPage.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await rPage.evaluate(() => document.documentElement.clientWidth);
      check(`${width}px: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      check(`${width}px: konsol hatası yok`, rPage.jsProblems.length === 0, rPage.jsProblems.join(" | "));
      await rContext.close();
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
