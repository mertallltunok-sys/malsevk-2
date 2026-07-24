// "anlasma_saglanamadi" bildiriminin ("Teklifinizin kabul edildiği ilan için
// anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.") artık sabit
// bir /ilanlar/:id href'i DEĞİL, job-requests.ts#getProviderOfferNotificationHref
// üzerinden "Verdiğim Teklifler > Kapanan Teklifler" sekmesine
// (/panel/tekliflerim?durum=kapanan-teklifler) yönlendirdiğini doğrular.
// Gerçek iki kullanıcılı akış: teklif -> kabul -> "Anlaşma Sağlanamadı" ->
// bildirim -> tıklama -> doğru sekme + doğru rozet ("Anlaşma Sağlanamadı",
// "Beklemede" DEĞİL) + kartta hiç aksiyon butonu yok + okunma durumu +
// sayfa yenileme/geri tuşu + masaüstü (bell) ve mobil menü (Bildirimler
// sayfası) kanallarının ikisi de + responsive taşma kontrolü.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const STAMP = Date.now();
const JOB_ID = `agreement-failed-route-job-${STAMP}`;
const JOB_TITLE = `ANLASMA-SAGLANAMADI-ROTA-${STAMP}`;
const EXPECTED_HREF = "/panel/tekliflerim?durum=kapanan-teklifler";
const NOTIFICATION_MESSAGE =
  "Teklifinizin kabul edildiği ilan için anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.";

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
async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
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
function get404(page) {
  return page.locator("text=404").isVisible().catch(() => false);
}
function getUnreadCount(page) {
  return page.evaluate(() => {
    const el = document.querySelector('button[aria-label*="okunmamış"]');
    const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
    return match ? Number(match[1]) : 0;
  });
}
async function seedJob(page, jobId, title, requesterId) {
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
        description: "Anlaşma sağlanamadı bildirim yönlendirme testi için oluşturulan ilan.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId,
        photos: [],
      };
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId, title, requesterId },
  );
}
async function submitOffer(page, jobId) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("7000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("5 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Anlaşma sağlanamadı bildirim yönlendirme testi için verilen teklif, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: teklif -> kabul -> Anlaşma Sağlanamadı ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await seedJob(page, JOB_ID, JOB_TITLE, zeynepId);
    check("[1] Test ilanı oluşturuldu", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    await submitOffer(page, JOB_ID);
    check("[1] Hizmet Veren (Mert) gerçek teklif verdi", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
    check("[1] Hizmet Alan (Zeynep) teklifi kabul etti", true);

    await page.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
    await page.locator('label:has-text("Fiyatta anlaşamadık")').click();
    await page.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle" }).click();
    await page.waitForTimeout(400);
    check("[2] Hizmet Alan 'Anlaşma Sağlanamadı' işlemini uyguladı (offer -> agreement_failed)", true);
    await logout(page);

    // === [3]+[4] Bildirim oluştu, masaüstünde (bell) tıklanıyor ===
    console.log("\n=== [3-4] Bildirim: masaüstü (bell) kanalı ===");
    await loginAs(page, MERT, "/panel");

    const unreadBefore = await getUnreadCount(page);
    check("[3] Tıklamadan önce en az 1 okunmamış bildirim var", unreadBefore >= 1, `unreadBefore=${unreadBefore}`);

    await page.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellRow = bellMenu.getByRole("menuitem").filter({ hasText: NOTIFICATION_MESSAGE });
    await assert.doesNotReject(bellRow.waitFor({ state: "visible", timeout: 10000 }));
    const bellHref = await bellRow.getAttribute("href");
    check("[3] Bildirim metni DEĞİŞMEMİŞ ve Bell'de görünüyor", Boolean(bellHref));
    check(
      `[Rota] href tam olarak ${EXPECTED_HREF}`,
      bellHref === EXPECTED_HREF,
      `href="${bellHref}"`,
    );

    await bellRow.click();
    await page.waitForURL(`${BASE_URL}${EXPECTED_HREF}`, { timeout: 10000 });
    check("[4-5] Tıklama sonrası URL doğrudan 'Verdiğim Teklifler > Kapanan Teklifler'", page.url() === `${BASE_URL}${EXPECTED_HREF}`, page.url());
    check("[404 yok]", !(await get404(page)));

    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    const activeTab = await page.getByRole("tab", { selected: true }).innerText();
    check("[6] 'Kapanan Teklifler' sekmesi otomatik aktif", activeTab === "Kapanan Teklifler", `seçili: ${activeTab}`);

    const offerCard = page.locator(".rounded-card", { hasText: JOB_TITLE });
    await offerCard.waitFor({ state: "visible", timeout: 10000 });
    const cardText = await offerCard.innerText();
    check("[7] Kart 'Anlaşma Sağlanamadı' etiketiyle görünüyor", cardText.includes("Anlaşma Sağlanamadı"));
    check("[7] Kart 'Beklemede' YAZMIYOR (kardeş-teklif etiketiyle karıştırılmamış)", !cardText.includes("Beklemede"));
    check("[7] Kart 'Başka Bir Hizmet Verenle Anlaşıldı' YAZMIYOR (yalnızca kardeş pending teklifler için)", !cardText.includes("Başka Bir Hizmet Verenle Anlaşıldı"));
    check("[8] Kartta hiç buton yok (yalnızca bilgilendirme)", (await offerCard.locator("button").count()) === 0);

    const unreadAfter = await getUnreadCount(page);
    check("[9] Tıklama sonrası okunmamış sayısı azaldı", unreadAfter < unreadBefore, `önce=${unreadBefore} sonra=${unreadAfter}`);

    // Sayfa yenileme: sekme + okunma durumu korunuyor mu
    await page.reload();
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const activeTabAfterReload = await page.getByRole("tab", { selected: true }).innerText();
    check("[Yenileme] 'Kapanan Teklifler' sekmesi query param'dan korunuyor", activeTabAfterReload === "Kapanan Teklifler", `seçili: ${activeTabAfterReload}`);
    const unreadAfterReload = await getUnreadCount(page);
    check("[Yenileme] Okundu durumu kalıcı", unreadAfterReload === unreadAfter, `sonra=${unreadAfterReload}`);

    // Geri tuşu
    await page.goto(`${BASE_URL}/panel`);
    await page.goto(`${BASE_URL}${EXPECTED_HREF}`);
    await page.goBack();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("[Geri tuşu] Doğru çalışıyor", page.url() === `${BASE_URL}/panel`, page.url());

    check("[Masaüstü] Konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    const storageState = await context.storageState();
    await context.close();

    // === Mobil menü kanalı: Profil menüsü > Bildirimler sayfası ===
    console.log("\n=== Mobil menü kanalı (375px, /panel/bildirimler) ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, storageState });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);

    await mobilePage.goto(`${BASE_URL}/panel/bildirimler`);
    const mobileRow = mobilePage.locator("main ul li").filter({ hasText: NOTIFICATION_MESSAGE });
    await assert.doesNotReject(mobileRow.first().waitFor({ state: "visible", timeout: 10000 }));
    const mobileHref = await mobileRow.first().locator("a").getAttribute("href");
    check(
      "[Mobil menü] Bildirimler sayfasındaki href, Bell ile birebir aynı",
      mobileHref === EXPECTED_HREF,
      `href="${mobileHref}"`,
    );
    await mobileRow.first().locator("a").click();
    await mobilePage.waitForURL(`${BASE_URL}${EXPECTED_HREF}`, { timeout: 10000 });
    await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const mobileActiveTab = await mobilePage.getByRole("tab", { selected: true }).innerText();
    check("[Mobil menü] 'Kapanan Teklifler' sekmesi mobilde de otomatik aktif", mobileActiveTab === "Kapanan Teklifler", `seçili: ${mobileActiveTab}`);
    check("[Mobil menü] 404 yok", !(await get404(mobilePage)));

    const mobileTabTexts = await mobilePage.getByRole("tab").allInnerTexts();
    check("[Responsive] 375px'te 4 sekme render ediliyor", mobileTabTexts.length === 4, `[${mobileTabTexts.join(", ")}]`);
    const mobileScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const mobileClientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check(
      "[Responsive] 375px'te yatay taşma yok",
      mobileScrollWidth <= mobileClientWidth + 1,
      `scrollWidth=${mobileScrollWidth}, clientWidth=${mobileClientWidth}`,
    );
    const mobileOfferCard = mobilePage.locator(".rounded-card", { hasText: JOB_TITLE });
    await mobileOfferCard.waitFor({ state: "visible", timeout: 10000 });
    check("[Responsive] Mobilde de kartta hiç buton yok", (await mobileOfferCard.locator("button").count()) === 0);
    check("[Mobil] Konsol/hydration hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

    // === Regresyon: diğer bildirim tipleri (Hizmet Alan tarafı) etkilenmedi mi ===
    console.log("\n=== Regresyon: Hizmet Alan bildirimi (ilan_yeniden_yayinda) ===");
    const dContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState });
    const dPage = await dContext.newPage();
    attachDiagnostics(dPage);
    await loginAs(dPage, ZEYNEP, "/panel/bildirimler");
    const REOPENED_MESSAGE = "Anlaşma sağlanamadığı için ilanınız yeniden yayına alındı ve yeni teklifler almaya hazır.";
    const reopenedRow = dPage.locator("main ul li").filter({ hasText: REOPENED_MESSAGE });
    await assert.doesNotReject(reopenedRow.first().waitFor({ state: "visible", timeout: 10000 }));
    const reopenedHref = await reopenedRow.first().locator("a").getAttribute("href");
    check(
      "[Regresyon] Hizmet Alan'ın 'ilan_yeniden_yayinda' bildirimi bu değişiklikten etkilenmedi",
      reopenedHref === `/ilanlar/${JOB_ID}`,
      `href="${reopenedHref}"`,
    );
    check("[Regresyon] Hizmet Alan tarafında konsol hatası yok", dPage.jsProblems.length === 0, dPage.jsProblems.join(" | "));
    await dContext.close();

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
