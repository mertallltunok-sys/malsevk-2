// Hizmet Veren bildirim yönlendirmesi düzeltmesinin doğrulaması: "İşin
// başladığını onayladı" (is_basladi) bildirimi artık doğrudan "Verdiğim
// Teklifler -> Devam Eden" sekmesine, "İşin tamamlandığını onayladı"
// (tamamlanma_onaylandi) bildirimi artık doğrudan "Verdiğim Teklifler ->
// Tamamlanan" sekmesine yönlendiriyor (bkz. job-requests.ts#
// getProviderOfferNotificationHref, notifications.ts). Gerçek iki
// kullanıcılı akış (teklif -> kabul -> işe başlama -> tamamlanma onayı),
// hem header zili hem Bildirimler sayfası, okunma durumu, silme butonunun
// yönlendirmeyi tetiklememesi, tarayıcı geri tuşu, sayfa yenileme sonrası
// sekme kalıcılığı, bilinmeyen durum parametresinde güvenli "Aktif"
// varsayılanı ve 320-1280px arası taşma kontrolü test edilir.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
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
        description: "Bildirim yönlendirme testi için oluşturulan ilan.",
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
  await page.getByLabel("Teklif Fiyatı").fill("6000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("3 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Bildirim yönlendirme testi için verilen teklif açıklaması, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    const JOB_ID = `notif-route-job-${STAMP}`;
    const JOB_TITLE = `BILDIRIMROTA-${STAMP}`;

    console.log("\n=== Kurulum: gerçek iki kullanıcı akışı ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await seedJob(page, JOB_ID, JOB_TITLE, zeynepId);
    check("[kurulum] test ilanı oluşturuldu", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    void mertId;
    await submitOffer(page, JOB_ID);
    check("[kurulum] Hizmet Veren (Mert) gerçek teklif verdi", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
    check("[kurulum] Hizmet Alan (Zeynep) teklifi kabul etti", true);

    await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(300);
    check("[kurulum] Hizmet Alan işin başladığını onayladı (offer -> in_progress)", true);
    await logout(page);

    // === FAZ A: "İşin başladığını onayladı" bildirimi -> Devam Eden ===
    console.log("\n=== FAZ A: is_basladi bildirimi -> 'Devam Eden' sekmesi ===");
    await loginAs(page, MERT, "/panel");

    const STARTED_MESSAGE = "Hizmet Alan, işin başladığını onayladı.";

    // A1: Bell ve Bildirimler sayfası aynı href'i üretiyor mu
    await page.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellStartedRow = bellMenu.getByRole("menuitem").filter({ hasText: STARTED_MESSAGE });
    await assert.doesNotReject(bellStartedRow.waitFor({ state: "visible", timeout: 10000 }));
    const bellHref = await bellStartedRow.getAttribute("href");
    check("[A1] Bell'de is_basladi bildirimi var ve doğru mesajla", Boolean(bellHref));
    check(
      "[A1] href tam olarak /panel/tekliflerim?durum=devam-eden",
      bellHref === "/panel/tekliflerim?durum=devam-eden",
      `href="${bellHref}"`,
    );
    await page.keyboard.press("Escape");
    await bellMenu.waitFor({ state: "hidden" });

    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const pageStartedRow = page.locator("main ul li").filter({ hasText: STARTED_MESSAGE });
    await assert.doesNotReject(pageStartedRow.first().waitFor({ state: "visible", timeout: 10000 }));
    const pageHref = await pageStartedRow.first().locator("a").getAttribute("href");
    check(
      "[A1] Bildirimler sayfasındaki href, Bell ile birebir aynı",
      pageHref === bellHref,
      `page="${pageHref}" bell="${bellHref}"`,
    );

    // A2: unread sayısı, tıklamadan önceki durum
    const unreadBefore = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[A2] tıklamadan önce en az 1 okunmamış bildirim var", unreadBefore >= 1, `unreadBefore=${unreadBefore}`);

    // A3: Bell üzerinden tıkla -> doğru sekme
    await page.goto(`${BASE_URL}/panel`);
    await page.getByRole("button", { name: /Bildirimler/ }).click();
    await bellMenu.waitFor({ state: "visible" });
    await bellMenu.getByRole("menuitem").filter({ hasText: STARTED_MESSAGE }).click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`, { timeout: 10000 });
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const activeTabA = await page.getByRole("tab", { selected: true }).innerText();
    check("[A3] URL doğrudan '?durum=devam-eden'", page.url() === `${BASE_URL}/panel/tekliflerim?durum=devam-eden`, page.url());
    check("[A3] 'Devam Eden' sekmesi aktif/seçili açıldı", activeTabA === "Devam Eden", `seçili: ${activeTabA}`);
    const bodyTextA = await page.locator("main").innerText();
    check("[A3] İlgili iş listede görünüyor", bodyTextA.includes(JOB_TITLE));
    check("[A3] 404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    // A4: unread sayısı azaldı mı (okundu kalıcı)
    const unreadAfter = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[A4] tıklama sonrası okunmamış sayısı azaldı", unreadAfter < unreadBefore, `önce=${unreadBefore} sonra=${unreadAfter}`);

    // A5: yenileme sonrası sekme korunuyor mu
    await page.reload();
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const activeTabAfterReload = await page.getByRole("tab", { selected: true }).innerText();
    check("[A5] Sayfa yenilendiğinde 'Devam Eden' sekmesi query param'dan korunuyor", activeTabAfterReload === "Devam Eden", `seçili: ${activeTabAfterReload}`);
    const unreadAfterReload = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      return el ? (el.getAttribute("aria-label")?.match(/(\d+) okunmamış/)?.[1] ?? "0") : "0";
    });
    check("[A5] Okundu durumu yenileme sonrası da kalıcı", Number(unreadAfterReload) === unreadAfter, `sonra=${unreadAfterReload}`);

    // A6: tarayıcı geri tuşu
    await page.goto(`${BASE_URL}/panel`);
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
    await page.goBack();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("[A6] Tarayıcı geri tuşu doğru çalışıyor", page.url() === `${BASE_URL}/panel`, page.url());

    // A7: Bildirimler sayfasından da tıklanınca aynı şekilde çalışıyor mu
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const pageStartedLink = page.locator("main ul li").filter({ hasText: STARTED_MESSAGE }).first().locator("a");
    await pageStartedLink.click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`, { timeout: 10000 });
    check("[A7] Bildirimler sayfasından tıklayınca da doğru sekmeye gidiliyor", page.url() === `${BASE_URL}/panel/tekliflerim?durum=devam-eden`);

    // A8: bilinmeyen durum parametresi güvenli varsayılan (Aktif)
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=gecersiz-deger-xyz`);
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const fallbackTab = await page.getByRole("tab", { selected: true }).innerText();
    check("[A8] Bilinmeyen 'durum' parametresinde güvenli varsayılan 'Aktif'", fallbackTab === "Aktif", `seçili: ${fallbackTab}`);
    check("[A8] 404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    // A9: silme butonu yönlendirme tetiklemiyor + doğru satırı siliyor
    await page.goto(`${BASE_URL}/panel`);
    await page.getByRole("button", { name: /Bildirimler/ }).click();
    await bellMenu.waitFor({ state: "visible" });
    const deleteRow = bellMenu.getByRole("menuitem").filter({ hasText: STARTED_MESSAGE }).locator("..");
    const deleteButton = deleteRow.getByRole("button", { name: "Bildirimi sil" });
    const urlBeforeDelete = page.url();
    await deleteButton.click();
    await page.waitForTimeout(500);
    check("[A9] Silme sonrası URL değişmedi (yönlendirme tetiklenmedi)", page.url() === urlBeforeDelete, page.url());
    const stillThere = await bellMenu.getByRole("menuitem").filter({ hasText: STARTED_MESSAGE }).count();
    check("[A9] Bildirim listeden kalktı", stillThere === 0);

    check("[FAZ A] konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    page.jsProblems = [];
    await logout(page);

    // === FAZ B: "İşin tamamlandığını onayladı" bildirimi -> Tamamlanan ===
    console.log("\n=== FAZ B: tamamlanma_onaylandi bildirimi -> 'Tamamlanan' sekmesi ===");
    await loginAs(page, MERT, "/panel/tekliflerim?durum=devam-eden");
    await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
    await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
    await page.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 10000 });
    check("[kurulum] Hizmet Veren tamamlanma talebini gönderdi (completion_requested)", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
    await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
    await page.waitForTimeout(500);
    check("[kurulum] Hizmet Alan işin tamamlandığını onayladı (offer -> completed)", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    const COMPLETED_MESSAGE = "Hizmet Alan işin tamamlandığını onayladı.";

    // B1: href doğrulaması (Bildirimler sayfası önce)
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const pageCompletedRow = page.locator("main ul li").filter({ hasText: COMPLETED_MESSAGE });
    await assert.doesNotReject(pageCompletedRow.first().waitFor({ state: "visible", timeout: 10000 }));
    const pageCompletedHref = await pageCompletedRow.first().locator("a").getAttribute("href");
    check(
      "[B1] Bildirimler sayfasında href tam olarak /panel/tekliflerim?durum=tamamlandi",
      pageCompletedHref === "/panel/tekliflerim?durum=tamamlandi",
      `href="${pageCompletedHref}"`,
    );

    await page.getByRole("button", { name: /Bildirimler/ }).click();
    await bellMenu.waitFor({ state: "visible" });
    const bellCompletedRow = bellMenu.getByRole("menuitem").filter({ hasText: COMPLETED_MESSAGE });
    const bellCompletedHref = await bellCompletedRow.getAttribute("href");
    check("[B1] Bell href, Bildirimler sayfasıyla birebir aynı", bellCompletedHref === pageCompletedHref, `bell="${bellCompletedHref}"`);
    await page.keyboard.press("Escape");

    // B2: Bildirimler sayfasından tıkla (kanalı FAZ A'nın tersine çevir)
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    // Hard navigation -> hidrasyon tamamlanana kadar rozet geçici olarak
    // "0 okunmamış" gösterebilir (bkz. session.ts/use-notifications.ts:
    // getServerSnapshot SSR güvenliği için her zaman null/[] döner) — satır
    // görünür olduğunda hidrasyon bitmiştir (bkz. tmp-verify-tekliflerim-tabs.mjs
    // aynı desen).
    await page.locator("main ul li").filter({ hasText: COMPLETED_MESSAGE }).first().waitFor({ state: "visible", timeout: 10000 });
    const unreadBeforeB = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    await page.locator("main ul li").filter({ hasText: COMPLETED_MESSAGE }).first().locator("a").click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`, { timeout: 10000 });
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const activeTabB = await page.getByRole("tab", { selected: true }).innerText();
    check("[B2] URL doğrudan '?durum=tamamlandi'", page.url() === `${BASE_URL}/panel/tekliflerim?durum=tamamlandi`);
    check("[B2] 'Tamamlanan' sekmesi aktif/seçili açıldı", activeTabB === "Tamamlanan", `seçili: ${activeTabB}`);
    const bodyTextB = await page.locator("main").innerText();
    check("[B2] İlgili iş listede görünüyor", bodyTextB.includes(JOB_TITLE));
    check("[B2] 404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));

    const unreadAfterB = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("[B2] tıklama sonrası okunmamış sayısı azaldı", unreadAfterB < unreadBeforeB, `önce=${unreadBeforeB} sonra=${unreadAfterB}`);

    // B3: yenileme sonrası sekme korunuyor
    await page.reload();
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const activeTabBReload = await page.getByRole("tab", { selected: true }).innerText();
    check("[B3] Sayfa yenilendiğinde 'Tamamlanan' sekmesi korunuyor", activeTabBReload === "Tamamlanan", `seçili: ${activeTabBReload}`);

    // B4: geri tuşu
    await page.goto(`${BASE_URL}/panel`);
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`);
    await page.goBack();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("[B4] Tarayıcı geri tuşu doğru çalışıyor", page.url() === `${BASE_URL}/panel`);

    // B5: Bell üzerinden de tıklanınca çalışıyor mu (kanal tersine test edildi)
    await page.getByRole("button", { name: /Bildirimler/ }).click();
    await bellMenu.waitFor({ state: "visible" });
    await bellMenu.getByRole("menuitem").filter({ hasText: COMPLETED_MESSAGE }).click();
    await page.waitForURL(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`, { timeout: 10000 });
    check("[B5] Bell'den tıklanınca da doğru sekmeye gidiliyor", page.url() === `${BASE_URL}/panel/tekliflerim?durum=tamamlandi`);

    check("[FAZ B] konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    const storageState = await context.storageState();
    await context.close();

    // === FAZ C: Responsive (320-1280px) ===
    console.log("\n=== FAZ C: Responsive genişlikler ===");
    const widths = [320, 375, 390, 414, 768, 1024, 1280];
    for (const width of widths) {
      const rContext = await browser.newContext({ viewport: { width, height: 850 }, storageState });
      const rPage = await rContext.newPage();
      attachDiagnostics(rPage);
      for (const durum of ["devam-eden", "tamamlandi"]) {
        await rPage.goto(`${BASE_URL}/panel/tekliflerim?durum=${durum}`);
        await rPage.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
        const tabTexts = await rPage.getByRole("tab").allInnerTexts();
        check(`${width}px [${durum}]: üç sekme render ediliyor`, tabTexts.length === 3, `[${tabTexts.join(", ")}]`);
        const selected = await rPage.getByRole("tab", { selected: true }).innerText();
        const expected = durum === "devam-eden" ? "Devam Eden" : "Tamamlanan";
        check(`${width}px [${durum}]: doğru sekme aktif açıldı`, selected === expected, `seçili: ${selected}`);
        const scrollWidth = await rPage.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await rPage.evaluate(() => document.documentElement.clientWidth);
        check(`${width}px [${durum}]: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      }
      check(`${width}px: konsol hatası yok`, rPage.jsProblems.length === 0, rPage.jsProblems.join(" | "));
      await rContext.close();
    }

    // === FAZ D: Hizmet Alan bildirim yönlendirmeleri bozulmadı mı (regresyon) ===
    console.log("\n=== FAZ D: Hizmet Alan bildirim yönlendirmesi (regresyon) ===");
    // storageState ile taşınıyor -- aksi halde bu test senaryosuna ait
    // job/offer kayıtları taze context'te bulunmaz (bkz. FAZ C'deki aynı not).
    const dContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState });
    const dPage = await dContext.newPage();
    attachDiagnostics(dPage);
    await loginAs(dPage, ZEYNEP, "/panel/bildirimler");
    const ZEYNEP_COMPLETED_MESSAGE = "İşin tamamlanmasını onayladınız. İş Tamamlanan İşler bölümüne taşındı.";
    const zeynepCompletedRow = dPage.locator("main ul li").filter({ hasText: ZEYNEP_COMPLETED_MESSAGE });
    await assert.doesNotReject(zeynepCompletedRow.first().waitFor({ state: "visible", timeout: 10000 }));
    const zeynepHref = await zeynepCompletedRow.first().locator("a").getAttribute("href");
    check(
      "[D] Hizmet Alan (is_tamamlandi) href'i bu değişiklikten etkilenmedi",
      zeynepHref === "/panel/hizmet-taleplerim?durum=tamamlandi",
      `href="${zeynepHref}"`,
    );
    check("[D] Hizmet Alan tarafında konsol hatası yok", dPage.jsProblems.length === 0, dPage.jsProblems.join(" | "));
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
