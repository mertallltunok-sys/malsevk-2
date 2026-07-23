// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde Hizmet Veren
// bildirim yönlendirme düzeltmesini (is_basladi -> Devam Eden,
// tamamlanma_onaylandi -> Tamamlanan) taze kayıtlı hesaplarla, gerçek iki
// kullanıcılı akışla doğrular.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Notif Requester", email: `prod-notif-req-${STAMP}@test.com`, phone: "0532 111 22 55", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Notif Provider", email: `prod-notif-prov-${STAMP}@test.com`, phone: "0533 444 55 88", password: "Provider1!", role: "hizmet-veren" };

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

async function loginAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function submitOffer(page, jobId) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("6500");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("4 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Prod bildirim yönlendirme testi için verilen teklif açıklaması, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: taze hesaplar + gerçek iş ilanı (PRODUCTION) ===");
    await registerAs(page, REQUESTER, "/hizmet-talebi-olustur");
    // Gerçek "Hizmet Talebi Oluştur" formu yerine, requester hesabıyla
    // oturum açıkken doğrudan localStorage'a ilan yazıyoruz (job oluşturma
    // formunun kendisi bu görevin kapsamı dışında; asıl test edilen teklif
    // -> kabul -> işe başlama -> tamamlanma zinciri gerçek UI ile yapılıyor).
    const JOB_ID = `prod-notif-job-${STAMP}`;
    const JOB_TITLE = `PRODBILDIRIMROTA-${STAMP}`;
    const requesterId = await page.evaluate(
      ({ email }) => {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        return users.find((u) => u.email === email)?.id;
      },
      { email: REQUESTER.email },
    );
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
          description: "Prod bildirim yönlendirme testi için oluşturulan ilan.",
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
    check("[kurulum] test ilanı oluşturuldu (PRODUCTION)", true);
    await logout(page);

    await registerAs(page, PROVIDER);
    await submitOffer(page, JOB_ID);
    check("[kurulum] Hizmet Veren gerçek teklif verdi (PRODUCTION)", true);
    await logout(page);

    await loginAs(page, REQUESTER, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 15000 });
    check("[kurulum] Hizmet Alan teklifi kabul etti (PRODUCTION)", true);

    await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(500);
    check("[kurulum] Hizmet Alan işin başladığını onayladı (PRODUCTION, offer -> in_progress)", true);
    await logout(page);

    // === FAZ A: is_basladi -> Devam Eden ===
    console.log("\n=== FAZ A: is_basladi bildirimi -> 'Devam Eden' (PRODUCTION) ===");
    await loginAs(page, PROVIDER, "/panel");
    const STARTED_MESSAGE = "Hizmet Alan, işin başladığını onayladı.";

    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const pageStartedRow = page.locator("main ul li").filter({ hasText: STARTED_MESSAGE });
    await assert.doesNotReject(pageStartedRow.first().waitFor({ state: "visible", timeout: 15000 }));
    const pageStartedHref = await pageStartedRow.first().locator("a").getAttribute("href");
    check(
      "[A1] Bildirimler sayfasında href tam olarak /panel/tekliflerim?durum=devam-eden",
      pageStartedHref === "/panel/tekliflerim?durum=devam-eden",
      `href="${pageStartedHref}"`,
    );

    await page.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellStartedRow = bellMenu.getByRole("menuitem").filter({ hasText: STARTED_MESSAGE });
    const bellStartedHref = await bellStartedRow.getAttribute("href");
    check("[A1] Bell href, Bildirimler sayfasıyla birebir aynı", bellStartedHref === pageStartedHref, `bell="${bellStartedHref}"`);

    await bellStartedRow.click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`, { timeout: 15000 });
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const activeTabA = await page.getByRole("tab", { selected: true }).innerText();
    check("[A2] 'Devam Eden' sekmesi aktif/seçili açıldı (PRODUCTION)", activeTabA === "Devam Eden", `seçili: ${activeTabA}`);
    const bodyTextA = await page.locator("main").innerText();
    check("[A2] İlgili iş listede görünüyor (PRODUCTION)", bodyTextA.includes(JOB_TITLE));
    check("[A2] 404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    await page.reload();
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const activeTabAReload = await page.getByRole("tab", { selected: true }).innerText();
    check("[A3] Yenileme sonrası 'Devam Eden' sekmesi korunuyor (PRODUCTION)", activeTabAReload === "Devam Eden", `seçili: ${activeTabAReload}`);

    check("[FAZ A] konsol/hydration hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    page.jsProblems = [];
    await logout(page);

    // === FAZ B: tamamlanma_onaylandi -> Tamamlanan ===
    console.log("\n=== FAZ B: tamamlanma_onaylandi bildirimi -> 'Tamamlanan' (PRODUCTION) ===");
    await loginAs(page, PROVIDER, "/panel/tekliflerim?durum=devam-eden");
    await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
    await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
    await page.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 15000 });
    check("[kurulum] Hizmet Veren tamamlanma talebi gönderdi (PRODUCTION)", true);
    await logout(page);

    await loginAs(page, REQUESTER, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
    await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
    await page.waitForTimeout(500);
    check("[kurulum] Hizmet Alan tamamlanmayı onayladı (PRODUCTION, offer -> completed)", true);
    await logout(page);

    await loginAs(page, PROVIDER, "/panel");
    const COMPLETED_MESSAGE = "Hizmet Alan işin tamamlandığını onayladı.";

    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const pageCompletedRow = page.locator("main ul li").filter({ hasText: COMPLETED_MESSAGE });
    await assert.doesNotReject(pageCompletedRow.first().waitFor({ state: "visible", timeout: 15000 }));
    const pageCompletedHref = await pageCompletedRow.first().locator("a").getAttribute("href");
    check(
      "[B1] href tam olarak /panel/tekliflerim?durum=tamamlandi (PRODUCTION)",
      pageCompletedHref === "/panel/tekliflerim?durum=tamamlandi",
      `href="${pageCompletedHref}"`,
    );

    await pageCompletedRow.first().locator("a").click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`, { timeout: 15000 });
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const activeTabB = await page.getByRole("tab", { selected: true }).innerText();
    check("[B2] 'Tamamlanan' sekmesi aktif/seçili açıldı (PRODUCTION)", activeTabB === "Tamamlanan", `seçili: ${activeTabB}`);
    const bodyTextB = await page.locator("main").innerText();
    check("[B2] İlgili iş listede görünüyor (PRODUCTION)", bodyTextB.includes(JOB_TITLE));
    check("[B2] 404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    check("[FAZ B] konsol/hydration hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    const storageState = await context.storageState();
    await context.close();

    // === FAZ C: Mobil (320px, PRODUCTION) ===
    console.log("\n=== FAZ C: Mobil 320px (PRODUCTION) ===");
    const mobileContext = await browser.newContext({ viewport: { width: 320, height: 812 }, storageState });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await mobilePage.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
    await mobilePage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 15000 });
    const mobileTabs = await mobilePage.getByRole("tab").allInnerTexts();
    check("320px: üç sekme render ediliyor (PRODUCTION)", mobileTabs.length === 3, `[${mobileTabs.join(", ")}]`);
    const mobileSelected = await mobilePage.getByRole("tab", { selected: true }).innerText();
    check("320px: 'Devam Eden' sekmesi aktif açıldı (PRODUCTION)", mobileSelected === "Devam Eden", `seçili: ${mobileSelected}`);
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("320px: yatay taşma yok (PRODUCTION)", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    check("320px: konsol hatası yok (PRODUCTION)", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
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
