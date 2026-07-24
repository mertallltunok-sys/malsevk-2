// Yeni "baska_hizmet_verenle_anlasildi" bildirimini doğrular
// (app/_lib/notifications.ts#siblingClosedNotifications): aynı ilana teklif
// veren B kabul edilip işe başladığında, hâlâ "pending" kalan kardeş C
// teklifi "Kapanan Teklifler"e düşer VE C'nin hesabına ayrıca bir bildirim
// gelir. Gerçek üç kullanıcılı akış (Zeynep=Hizmet Alan, Mert=B,
// Mehmet Demir=C): teklif -> kabul (henüz bildirim YOK) -> İşe Başlandı
// (bildirim OLUŞUR, tam olarak 1 kez) -> tıklama (Kapanan Teklifler açılır)
// -> yenileme sonrası kaybolmaz -> silinince geri gelmez.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" }; // B
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" }; // C
const STAMP = Date.now();
const JOB_ID = `sibling-notif-job-${STAMP}`;
const JOB_TITLE = `KARDES-BILDIRIM-${STAMP}`;
const EXPECTED_TITLE = "Başka Bir Hizmet Verenle Anlaşıldı";
const EXPECTED_MESSAGE = "Teklif verdiğiniz ilan için başka bir Hizmet Verenle işe başlandı.";
const EXPECTED_HREF = "/panel/tekliflerim?durum=kapanan-teklifler";

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
        description: "Kardeş teklif bildirimi testi için oluşturulan ilan.",
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
async function submitOffer(page, jobId, amount) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(String(amount));
  await page.getByLabel("Tahmini Hizmet Süresi").fill("3 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Kardeş teklif bildirimi testi için verilen teklif, yirmi karakterden uzun bir açıklama.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: A ilanına B ve C teklif verir ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await seedJob(page, JOB_ID, JOB_TITLE, zeynepId);
    check("[1] Test ilanı oluşturuldu", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    await submitOffer(page, JOB_ID, 6000);
    check("[1] B (Mert) gerçek teklif verdi", true);
    await logout(page);

    await loginAs(page, MEHMET, "/panel");
    await submitOffer(page, JOB_ID, 5500);
    check("[1] C (Mehmet Demir) gerçek teklif verdi", true);
    await logout(page);

    // === [2] B kabul edilir ===
    console.log("\n=== Senaryo 2: B kabul edilir ===");
    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    const bCard = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mert" }).filter({ hasNotText: "Mehmet" });
    await bCard.getByRole("button", { name: "Kabul Et" }).click();
    await bCard.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
    check("[2] Hizmet Alan (Zeynep) B'nin teklifini kabul etti", true);
    await logout(page);

    // === [3] Bu aşamada C'ye bildirim gelmemeli ===
    console.log("\n=== Senaryo 3: C'ye henüz bildirim gelmemeli (yalnızca kabul, iş başlamadı) ===");
    await loginAs(page, MEHMET, "/panel/bildirimler");
    let mehmetBody = await page.locator("main").innerText();
    check(
      "[3] C'nin bildirimlerinde 'Başka Bir Hizmet Verenle Anlaşıldı' YOK",
      !mehmetBody.includes(EXPECTED_TITLE) && !mehmetBody.includes(EXPECTED_MESSAGE),
    );
    await logout(page);

    // === [4] B için İşe Başlandı yapılır ===
    console.log("\n=== Senaryo 4: B için 'İşe Başlandı' yapılır ===");
    await loginAs(page, ZEYNEP, "/panel/gelen-teklifler");
    const bCardAfterAccept = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mert" }).filter({ hasNotText: "Mehmet" });
    await bCardAfterAccept.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(400);
    check("[4] B'nin teklifi işe başladı (in_progress)", true);
    await logout(page);

    // === [5] C'nin teklifi Kapanan Teklifler'e düşer ===
    console.log("\n=== Senaryo 5: C'nin teklifi 'Kapanan Teklifler'e düşer ===");
    await loginAs(page, MEHMET, "/panel/tekliflerim");
    let mehmetTekliflerimBody = await page.locator("main").innerText();
    check("[5] C'nin teklifi ARTIK 'Aktif'te YOK", !mehmetTekliflerimBody.includes(JOB_TITLE));
    await page.getByRole("tab", { name: "Kapanan Teklifler" }).click();
    await page.waitForURL(/durum=kapanan-teklifler/, { timeout: 5000 });
    mehmetTekliflerimBody = await page.locator("main").innerText();
    check("[5] C'nin teklifi 'Kapanan Teklifler'de görünüyor", mehmetTekliflerimBody.includes(JOB_TITLE));
    check(
      "[5] Kart 'Başka Bir Hizmet Verenle Anlaşıldı' rozetiyle görünüyor",
      mehmetTekliflerimBody.includes("Başka Bir Hizmet Verenle Anlaşıldı"),
    );

    // === [6] C hesabında yalnızca 1 adet bildirim ===
    console.log("\n=== Senaryo 6: C hesabında yalnızca 1 adet bildirim ===");
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const notificationRows = page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE });
    await assert.doesNotReject(notificationRows.first().waitFor({ state: "visible", timeout: 10000 }));
    const notificationCount = await notificationRows.count();
    check("[6] Tam olarak 1 adet 'Başka Bir Hizmet Verenle Anlaşıldı' bildirimi var", notificationCount === 1, `count=${notificationCount}`);
    const rowText = await notificationRows.first().innerText();
    check("[6] Başlık DOĞRU: 'Başka Bir Hizmet Verenle Anlaşıldı'", rowText.includes(EXPECTED_TITLE));
    check("[6] Mesaj DOĞRU: 'Teklif verdiğiniz ilan için başka bir Hizmet Verenle işe başlandı.'", rowText.includes(EXPECTED_MESSAGE));

    const unreadBefore = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[9-öncesi] Tıklamadan önce en az 1 okunmamış bildirim var", unreadBefore >= 1, `unreadBefore=${unreadBefore}`);

    // === [7] Bildirime tıklanınca Kapanan Teklifler açılır ===
    console.log("\n=== Senaryo 7: Bildirime tıklanınca 'Kapanan Teklifler' açılır ===");
    const notifLink = notificationRows.first().locator("a");
    const notifHref = await notifLink.getAttribute("href");
    check(`[Rota] href tam olarak ${EXPECTED_HREF}`, notifHref === EXPECTED_HREF, `href="${notifHref}"`);
    await notifLink.click();
    await page.waitForURL(`${BASE_URL}${EXPECTED_HREF}`, { timeout: 10000 });
    check("[7] URL doğrudan 'Verdiğim Teklifler > Kapanan Teklifler'", page.url() === `${BASE_URL}${EXPECTED_HREF}`, page.url());
    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    const activeTab = await page.getByRole("tab", { selected: true }).innerText();
    check("[7] 'Kapanan Teklifler' sekmesi otomatik aktif", activeTab === "Kapanan Teklifler", `seçili: ${activeTab}`);

    const unreadAfter = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[9] Tıklama sonrası okunmamış sayısı azaldı", unreadAfter < unreadBefore, `önce=${unreadBefore} sonra=${unreadAfter}`);

    // === [8] Sayfa yenilenince bildirim kaybolmaz ===
    console.log("\n=== Senaryo 8: Sayfa yenilenince bildirim kaybolmaz ===");
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    await assert.doesNotReject(
      page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE }).first().waitFor({ state: "visible", timeout: 10000 }),
    );
    await page.reload();
    await assert.doesNotReject(
      page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE }).first().waitFor({ state: "visible", timeout: 10000 }),
    );
    check("[8] Sayfa yenilendikten sonra bildirim hâlâ görünüyor (kaybolmadı)", true);
    const unreadAfterReload = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[8] Okundu durumu yenileme sonrası da kalıcı", unreadAfterReload === unreadAfter, `sonra=${unreadAfterReload}`);

    // === [9] Bildirim silinirse tekrar geri gelmez ===
    console.log("\n=== Senaryo 9: Bildirim silinirse tekrar geri gelmez ===");
    const rowToDelete = page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE }).first();
    await rowToDelete.getByRole("button", { name: "Bildirimi sil" }).click();
    await page.waitForTimeout(500);
    const stillThereAfterDelete = await page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE }).count();
    check("[9] Silme sonrası bildirim listeden kalktı", stillThereAfterDelete === 0);
    await page.reload();
    await page.waitForTimeout(500);
    const backAfterReload = await page.locator("main ul li").filter({ hasText: EXPECTED_MESSAGE }).count();
    check("[9] Sayfa yenilendikten SONRA da bildirim geri gelmiyor", backAfterReload === 0);
    // Bağımsız kanal (bell) ile de teyit -- aynı dismissal deposu.
    await page.goto(`${BASE_URL}/panel`);
    await page.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellHasIt = await bellMenu.getByRole("menuitem").filter({ hasText: EXPECTED_MESSAGE }).count();
    check("[9] Bell menüsünde de bildirim yok (aynı dismissal deposu)", bellHasIt === 0);

    check("Genel: konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    // storageState ile taşınıyor -- aksi halde bu senaryoya ait job/offer/
    // kullanıcı kayıtları taze context'te (temiz localStorage) hiç bulunmaz
    // (bkz. tmp-kapanan-teklifler-test.mjs'teki aynı desen/not).
    const storageState = await context.storageState();
    await context.close();

    // === Responsive: 375px ===
    console.log("\n=== Responsive: 375px ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, storageState });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    // storageState taşınan oturum Zeynep'e ait (Senaryo 9'un son adımı) --
    // burada C'nin (Mehmet) görünümü test edildiği için önce oturum
    // temizlenip yeniden C olarak giriş yapılır.
    await mobilePage.goto(BASE_URL);
    await mobilePage.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await loginAs(mobilePage, MEHMET, "/panel/tekliflerim?durum=kapanan-teklifler");
    await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const mobileBodyText = await mobilePage.locator("main").innerText();
    check("[Responsive] 375px'te kapanan teklif + rozet görünüyor", mobileBodyText.includes(JOB_TITLE) && mobileBodyText.includes("Başka Bir Hizmet Verenle Anlaşıldı"));
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("[Responsive] 375px'te yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    check("[Responsive] Mobilde konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
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
