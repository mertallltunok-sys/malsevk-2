// "is_iptal_edildi" bildiriminin ("Hizmet Alan, itiraz edilen işi iptal
// olarak sonuçlandırdı.") ve "cancelled" durumundaki teklifin artık doğru
// yere yönlendiğini/göründüğünü doğrular. Kök neden:
// job-requests.ts#getProviderOfferFilter, "cancelled" durumu için hiç
// branch içermiyordu ve varsayılan olarak "aktif"e düşüyordu; bildirim
// (zaten getProviderOfferNotificationHref kullanıyordu) bu yüzden yanlış
// sekmeye yönlendiriyordu. Gerçek iki kullanıcılı akış: teklif -> kabul ->
// işe başlama -> tamamlandı bildirimi -> itiraz -> "İşi İptal Et" ->
// bildirim -> tıklama -> "Kapanan Teklifler" sekmesi + doğru kart metni +
// diğer üç sekmede GÖRÜNMEME + kartta hiç aksiyon butonu olmaması.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const STAMP = Date.now();
const JOB_ID = `cancelled-route-job-${STAMP}`;
const JOB_TITLE = `IPTAL-ROTA-${STAMP}`;
const EXPECTED_HREF = "/panel/tekliflerim?durum=kapanan-teklifler";
const NOTIFICATION_MESSAGE = "Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı.";
const CARD_INFO_TEXT = "İtiraz sonrası iş iptal edildi.";

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
        description: "İptal bildirim yönlendirme testi için oluşturulan ilan.",
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
  await page.getByLabel("Teklif Fiyatı").fill("8000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("4 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("İptal bildirim yönlendirme testi için verilen teklif, yirmi karakterden uzun bir açıklama.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: teklif -> kabul -> işe başlama -> tamamlandı bildirimi -> itiraz -> iptal ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await seedJob(page, JOB_ID, JOB_TITLE, zeynepId);
    check("[Kurulum] Test ilanı oluşturuldu", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    await submitOffer(page, JOB_ID);
    check("[Kurulum] Hizmet Veren (Mert) gerçek teklif verdi", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(400);
    check("[Kurulum] İşe başlandı (offer -> in_progress)", true);
    await logout(page);

    await loginAs(page, MERT, "/panel/tekliflerim?durum=devam-eden");
    await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
    await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
    await page.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 10000 });
    check("[Kurulum] Tamamlanma talebi gönderildi (offer -> completion_requested)", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "İtiraz Et", exact: true }).click();
    const disputeDialog = page.getByRole("dialog");
    await disputeDialog.locator("#itiraz-not").fill("İş yerinde hiç kimse yoktu, teslim alınamadı ve iletişime geçilemedi.");
    await disputeDialog.getByRole("button", { name: "İtiraz Et", exact: true }).click();
    await page.waitForTimeout(400);
    check("[Kurulum] İtiraz edildi (offer -> completion_disputed)", true);

    await page.getByRole("button", { name: "İşi İptal Et", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Evet, İşi İptal Et" }).click();
    await page.waitForTimeout(400);
    check("[Kurulum] İtiraz, 'İptal Olarak Sonuçlandır' ile kapatıldı (offer -> cancelled)", true);
    await logout(page);

    // === Bildirim: masaüstü (bell) kanalı ===
    console.log("\n=== Bildirim: masaüstü (bell) kanalı ===");
    await loginAs(page, MERT, "/panel");

    const unreadBefore = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[Ön koşul] Tıklamadan önce en az 1 okunmamış bildirim var", unreadBefore >= 1, `unreadBefore=${unreadBefore}`);

    await page.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellRow = bellMenu.getByRole("menuitem").filter({ hasText: NOTIFICATION_MESSAGE });
    await assert.doesNotReject(bellRow.waitFor({ state: "visible", timeout: 10000 }));
    const bellHref = await bellRow.getAttribute("href");
    check("[Bildirim] Metin DEĞİŞMEMİŞ ve Bell'de görünüyor", Boolean(bellHref));
    check(`[Rota] href tam olarak ${EXPECTED_HREF}`, bellHref === EXPECTED_HREF, `href="${bellHref}"`);

    await bellRow.click();
    await page.waitForURL(`${BASE_URL}${EXPECTED_HREF}`, { timeout: 10000 });
    check("[Yönlendirme] URL doğrudan 'Verdiğim Teklifler > Kapanan Teklifler'", page.url() === `${BASE_URL}${EXPECTED_HREF}`, page.url());

    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    const activeTab = await page.getByRole("tab", { selected: true }).innerText();
    check("[Sekme] 'Kapanan Teklifler' otomatik aktif", activeTab === "Kapanan Teklifler", `seçili: ${activeTab}`);

    const offerCard = page.locator(".rounded-card", { hasText: JOB_TITLE });
    await offerCard.waitFor({ state: "visible", timeout: 10000 });
    const cardText = await offerCard.innerText();
    check("[Kart] 'İptal Edildi' rozeti görünüyor", cardText.includes("İptal Edildi"));
    check(`[Kart] '${CARD_INFO_TEXT}' bilgi satırı görünüyor`, cardText.includes(CARD_INFO_TEXT));
    check("[Kart] Hiç aksiyon butonu yok", (await offerCard.locator("button").count()) === 0);

    const unreadAfter = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[Okunma] Tıklama sonrası okunmamış sayısı azaldı", unreadAfter < unreadBefore, `önce=${unreadBefore} sonra=${unreadAfter}`);

    // === Diğer üç sekmede GÖRÜNMEME ===
    console.log("\n=== Diğer sekmelerde görünmeme kontrolü ===");
    for (const tabName of ["Aktif", "Devam Eden", "Tamamlanan"]) {
      await page.getByRole("tab", { name: tabName }).click();
      await page.waitForTimeout(200);
      const body = await page.locator("main").innerText();
      check(`['${tabName}'] Teklif BURADA GÖRÜNMÜYOR`, !body.includes(JOB_TITLE));
    }

    check("Genel: konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    // storageState ile taşınıyor -- aksi halde bu senaryoya ait job/offer/
    // kullanıcı kayıtları taze context'te (temiz localStorage) hiç bulunmaz.
    // Son oturum zaten Mert olduğu için yeniden login gerekmez.
    const storageState = await context.storageState();
    await context.close();

    // === Responsive: 375px ===
    console.log("\n=== Responsive: 375px ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, storageState });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await mobilePage.goto(`${BASE_URL}/panel/tekliflerim?durum=kapanan-teklifler`);
    await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const mobileBody = await mobilePage.locator("main").innerText();
    check("[Responsive] 375px'te kart + bilgi satırı görünüyor", mobileBody.includes(JOB_TITLE) && mobileBody.includes(CARD_INFO_TEXT));
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
