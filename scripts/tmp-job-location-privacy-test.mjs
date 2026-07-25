// node scripts/tmp-job-location-privacy-test.mjs
//
// Merkezi lokasyon sisteminin (2026-07-25) yeni parçalarını doğrular:
//   1) Job.companyOrFactoryName / Job.facilityId(ad eşleşmesi) / Job.addressText
//      doğru render ediliyor (ilan detayı, Hizmet Taleplerim).
//   2) Açık Adres gizlilik kapısı (job-requests.ts#canViewJobAddress):
//      ilan sahibi HER ZAMAN görür; başka bir Hizmet Veren yalnızca kendi
//      teklifi "meşgul" (accepted/in_progress/...) durumundaysa görür —
//      "pending" bir teklifte GÖRMEZ.
//   3) Kısa lokasyon satırı (formatJobLocationLine) Gelen Teklifler
//      (incoming-offer-card.tsx) ve Verdiğim Teklifler (my-offers-panel.tsx)
//      ekranlarında görünüyor.
//   4) Eski (companyOrFactoryName/addressText/facilityId'den önce
//      oluşturulmuş) statik örnek ilan (jobs.ts#ilan-002) hatasız açılıyor,
//      "undefined" göstermiyor, adres satırı hiç render etmiyor.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const STAMP = Date.now();

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

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

const JOB_ID = `location-privacy-job-${STAMP}`;
const OFFER_ID = `location-privacy-offer-${STAMP}`;
const COMPANY_NAME = `Gizlilik Test Firma ${STAMP} A.Ş.`;
const ADDRESS_TEXT = `Gizli Adres Test Sokak No:${STAMP}, Dilovası/Kocaeli`;

async function seedScenario(page, { zeynepId, mertId }) {
  return page.evaluate(
    ({ zeynepId, mertId, jobId, offerId, companyName, addressText, now }) => {
      const job = {
        id: jobId,
        title: `LOCATION-PRIVACY-${now}`,
        category: "depo-personeli",
        province: "Kocaeli",
        district: "Dilovası",
        workLocationType: "Beldeport",
        companyOrFactoryName: companyName,
        addressText,
        workDate: "2026-12-20",
        description: "Açık adres gizlilik testinin ilanı, en az yirmi karakter içerir.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
      };
      const offer = {
        id: offerId,
        jobId,
        providerId: mertId,
        amount: 5000,
        currency: "TRY",
        description: "Gizlilik testi için oluşturulmuş teklif, yirmi karakterden uzun.",
        estimatedDuration: "3 gün",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const existingJobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const existingOffers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existingJobs, job]));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existingOffers, offer]));
    },
    { zeynepId, mertId, jobId: JOB_ID, offerId: OFFER_ID, companyName: COMPANY_NAME, addressText: ADDRESS_TEXT, now: STAMP },
  );
}

function acceptOfferDirectly(page) {
  return page.evaluate(
    ({ offerId }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      const next = offers.map((offer) =>
        offer.id === offerId ? { ...offer, status: "accepted", updatedAt: new Date().toISOString() } : offer,
      );
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
    },
    { offerId: OFFER_ID },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: 1 ilan (Kocaeli/Dilovası/Beldeport, firma+adres) + 1 pending teklif ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await seedScenario(page, { zeynepId, mertId });
    check("[kurulum] Test ilanı + pending teklif oluşturuldu", true);

    console.log("\n=== Senaryo 1: Mert (pending teklif) — firma/tesis/konum görünür, AÇIK ADRES görünmez ===");
    await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
    await page.getByRole("heading", { name: `LOCATION-PRIVACY-${STAMP}` }).waitFor({ state: "visible", timeout: 10000 });
    let bodyText = await page.locator("main").innerText();
    check("[pending] Firma/fabrika adı görünüyor", bodyText.includes(COMPANY_NAME));
    check("[pending] Bölge/Tesis adı (Beldeport) görünüyor", bodyText.includes("Beldeport"));
    check("[pending] İlçe/İl (Dilovası / Kocaeli) görünüyor", bodyText.includes("Dilovası / Kocaeli"));
    check("[pending] Açık adres GÖRÜNMÜYOR (teklif henüz kabul edilmedi)", !bodyText.includes(ADDRESS_TEXT));

    console.log("\n=== Senaryo 2: Zeynep (ilan sahibi) — açık adresi HER ZAMAN görür ===");
    await clearSession(page);
    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
    await page.getByRole("heading", { name: `LOCATION-PRIVACY-${STAMP}` }).waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[sahip-detay] İlan sahibi açık adresi ilan detayında görüyor", bodyText.includes(ADDRESS_TEXT));

    // NOT: <h1>Hizmet Taleplerim</h1> sayfa seviyesinde HER ZAMAN (oturum
    // durumundan bağımsız) render edilir — yalnızca alttaki JobRequestsPanel
    // useSession()'a bağlıdır ve ilk hidrasyon anında bir tık gecikmeli
    // gerçek oturumu yansıtır. Bu yüzden başlığı beklemek tek başına
    // yetmez; Senaryo 3/5'teki AYNI 500ms hidrasyon beklemesi burada da
    // gerekli (aksi halde localStorage'daki gerçek session'ı henüz
    // okumamış "giriş yapmalısınız" an'lık karesi yakalanabilir).
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await page.getByRole("heading", { name: "Hizmet Taleplerim" }).waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    bodyText = await page.locator("main").innerText();
    check("[sahip-talepler] İlan sahibi açık adresi Hizmet Taleplerim'de görüyor", bodyText.includes(ADDRESS_TEXT));

    console.log("\n=== Senaryo 3: Gelen Teklifler'de kısa lokasyon satırı görünüyor ===");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.waitForTimeout(500);
    bodyText = await page.locator("main").innerText();
    check(
      "[gelen-teklifler] Kısa lokasyon satırı (Beldeport • Dilovası / Kocaeli) görünüyor",
      bodyText.includes("Beldeport") && bodyText.includes("Dilovası / Kocaeli"),
    );

    console.log("\n=== Senaryo 4: Teklif kabul edilince Mert artık açık adresi görebiliyor ===");
    await acceptOfferDirectly(page);
    await clearSession(page);
    await loginAs(page, MERT, "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
    await page.getByRole("heading", { name: `LOCATION-PRIVACY-${STAMP}` }).waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[accepted] Teklifi kabul edilen Hizmet Veren artık açık adresi görüyor", bodyText.includes(ADDRESS_TEXT));

    console.log("\n=== Senaryo 5: Verdiğim Teklifler'de kısa lokasyon satırı görünüyor ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    await page.waitForTimeout(500);
    bodyText = await page.locator("main").innerText();
    check(
      "[verdiğim-teklifler] Kısa lokasyon satırı (Beldeport • Dilovası / Kocaeli) görünüyor",
      bodyText.includes("Beldeport") && bodyText.includes("Dilovası / Kocaeli"),
    );

    console.log("\n=== Senaryo 6: Eski statik ilan (ilan-002) hatasız açılıyor, adres/company göstermiyor ===");
    await clearSession(page);
    await page.goto(`${BASE_URL}/ilanlar/ilan-002`);
    await page.getByRole("heading", { name: "Fabrika Sahasında Forklift Operatörü İhtiyacı" }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    bodyText = await page.locator("main").innerText();
    check("[legacy] Eski ilan sayfası çökmeden açılıyor", bodyText.length > 0);
    check("[legacy] Sayfada 'undefined' metni yok", !bodyText.includes("undefined"));
    check("[legacy] Bölge/Tesis eski workLocationType'a (Fabrika) düşüyor", bodyText.includes("Fabrika"));
    check("[legacy] İlçe/İl (Gebze / Kocaeli) doğru görünüyor", bodyText.includes("Gebze / Kocaeli"));

    check("Genel: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-job-location-privacy-test] GENEL HATA:", error);
  process.exitCode = 1;
});
