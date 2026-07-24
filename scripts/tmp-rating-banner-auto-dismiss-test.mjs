// "Hizmet Taleplerim" ekranındaki kalıcı "Değerlendirmeniz için teşekkür
// ederiz." banner'ının artık use-auto-dismiss-banner.ts ile otomatik
// kaybolduğunu doğrular: 3sn tam görünür + ~250ms fade + DOM'dan kalkma,
// art arda iki tetiklemede timer'ın sıfırlanması, yenileme/geri tuşunda
// tekrar görünmemesi ve prefers-reduced-motion davranışı.
// Ön koşul: `npm run dev`.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function seedData(page, { requesterId, providerId }) {
  await page.evaluate(
    ({ reqId, provId }) => {
      const nowIso = new Date().toISOString();
      const baseJob = {
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-09-01",
        description: "Banner testi icin olusturulan ilan aciklamasi, en az yirmi karakter.",
        operationDetails: "Banner testi operasyon detaylari, en az on karakter.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      };
      const jobs = [
        { ...baseJob, id: "banner-job-a", title: "Banner Test İlanı A", category: "lashing" },
        { ...baseJob, id: "banner-job-b", title: "Banner Test İlanı B", category: "lashing" },
        { ...baseJob, id: "banner-job-widget", title: "Banner Test İlanı Widget", category: "lashing" },
      ];
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));

      const baseOffer = {
        providerId: provId,
        amount: 5000,
        currency: "TRY",
        description: "Banner testi icin teklif aciklamasi, en az yirmi karakter uzunlugunda.",
        estimatedDuration: "2 gün",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const offers = [
        {
          ...baseOffer,
          id: "banner-offer-a",
          jobId: "banner-job-a",
          status: "completion_requested",
          completionRequestedByUserId: provId,
          completionRequestedAt: nowIso,
        },
        {
          ...baseOffer,
          id: "banner-offer-b",
          jobId: "banner-job-b",
          status: "completion_requested",
          completionRequestedByUserId: provId,
          completionRequestedAt: nowIso,
        },
        {
          ...baseOffer,
          id: "banner-offer-widget",
          jobId: "banner-job-widget",
          status: "completed",
        },
      ];
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      localStorage.removeItem("malsevk.ratings.v1");
    },
    { reqId: requesterId, provId: providerId },
  );
}

async function confirmCompletionAndRate(page, jobTitle, stars) {
  const card = page.locator("li").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });
  const dialog = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
  await dialog.getByRole("radio", { name: `${stars} yıldız` }).click();
  await dialog.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "hidden", timeout: 10000 });
}

const bannerLocator = (page) => page.getByText("Değerlendirmeniz için teşekkür ederiz.");

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  const mertId = await getUserId(page, "mert@test.com");
  await seedData(page, { requesterId: zeynepId, providerId: mertId });
  ok("Kurulum: 2 adet 'tamamlandı onayı bekleyen' + 1 adet 'tamamlanmış puansız' iş oluşturuldu");

  // ---- [TEST 1/2/3/6] Sayfa üstü banner: art arda 2 değerlendirme, timer sıfırlanıyor mu ----
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.getByText("Banner Test İlanı A").waitFor({ state: "visible", timeout: 10000 });

  await confirmCompletionAndRate(page, "Banner Test İlanı A", 5);
  const t1 = Date.now();
  await bannerLocator(page).waitFor({ state: "visible", timeout: 3000 });
  ok("[1] İş A değerlendirildikten sonra 'Değerlendirmeniz için teşekkür ederiz.' banner'ı görünüyor");

  // A'nın 3sn'lik süresi dolmadan (ama test zamanlamasına güvenilir bir boşluk
  // bırakmak için) kısa bir bekleme sonrası B'yi değerlendir -- gerçek UI
  // etkileşim süresi (tıklama/render) makine hızına göre değişebileceğinden,
  // t2-t1 farkının ölçüme güvenilir bir pay bırakması için kontrollü bir
  // gecikme ekleniyor.
  await page.waitForTimeout(1200);
  await confirmCompletionAndRate(page, "Banner Test İlanı B", 4);
  const t2 = Date.now();
  ok("[6] İkinci değerlendirme (İş B) art arda gönderildi (banner hâlâ görünürken)");

  // t1+3000'den az bir süre sonrası, ama t2+3000'den önce: banner hâlâ TAM opak olmalı (timer sıfırlanmış).
  const checkPoint = t1 + 3150;
  assert.ok(checkPoint < t2 + 2900, "Test zamanlaması için yeterli boşluk yok, senaryo tekrar gözden geçirilmeli");
  const waitUntilCheckpoint = checkPoint - Date.now();
  if (waitUntilCheckpoint > 0) await page.waitForTimeout(waitUntilCheckpoint);
  const opacityAtCheckpoint = await bannerLocator(page).evaluate((el) => getComputedStyle(el.closest("p")).opacity);
  assert.equal(opacityAtCheckpoint, "1", "İş A'dan 3sn+ geçmesine rağmen banner hâlâ tam opak olmalı (İş B ile timer sıfırlandı)");
  await assert.doesNotReject(bannerLocator(page).waitFor({ state: "visible", timeout: 100 }));
  ok("[6] İş A'nın süresi dolmasına rağmen banner hâlâ tam görünür — İş B'nin tetiklemesi timer'ı doğru sıfırladı");

  // t2+3000 civarı: fade-out başlamış olmalı (opacity 1'den 0'a GEÇİŞ
  // halinde, CSS transition sürüyorken) -- tam olarak "0" beklemek yerine
  // yalnızca 1'den KESİN olarak düştüğünü doğrula (CSS transition'ın hangi
  // anında örneklendiği değişebildiği için tam "0" beklemek gereksiz kırılgan olur).
  const fadeCheckpoint = t2 + 3090;
  const waitUntilFade = fadeCheckpoint - Date.now();
  if (waitUntilFade > 0) await page.waitForTimeout(waitUntilFade);
  const opacityDuringFade = Number(
    await bannerLocator(page).evaluate((el) => getComputedStyle(el.closest("p")).opacity),
  );
  assert.ok(opacityDuringFade < 0.9, `3sn sonunda fade-out başlamış (opacity 1'den düşmüş) olmalı, ölçülen: ${opacityDuringFade}`);
  await assert.doesNotReject(bannerLocator(page).waitFor({ state: "visible", timeout: 100 }));
  ok(`[2] İş B'nin tetiklemesinden ~3sn sonra fade-out başlıyor (opacity ${opacityDuringFade.toFixed(2)}), banner hâlâ DOM'da`);

  // Fade süresi (~250ms) sonrası: DOM'dan tamamen kalkmış olmalı.
  await bannerLocator(page).waitFor({ state: "detached", timeout: 1000 });
  ok("[3] Fade-out tamamlandıktan sonra banner DOM'dan tamamen kaldırılıyor");

  // ---- [TEST 4] Sayfa yenilenince geri gelmiyor ----
  await page.reload();
  await page.waitForTimeout(500);
  const bannerAfterReload = await bannerLocator(page).count();
  assert.equal(bannerAfterReload, 0, "Sayfa yenilenince banner tekrar görünmemeli");
  ok("[4] Sayfa yenilenince banner tekrar görünmüyor");

  // ---- [TEST 5] Geri tuşunda tekrar görünmüyor ----
  // Yeni bir değerlendirme tetikleyip (İş widget üzerinden), başka sayfaya
  // gidip geri dönünce banner'ın tekrar görünmediğini doğrula.
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.getByText("Banner Test İlanı Widget").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
  await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });
  const widgetDialog = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
  await widgetDialog.getByRole("radio", { name: "5 yıldız" }).click();
  await widgetDialog.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await bannerLocator(page).waitFor({ state: "visible", timeout: 5000 });
  ok("Widget (Tamamlanan sekmesi) üzerinden değerlendirme sonrası banner görünüyor");

  await page.goto(`${BASE_URL}/panel`);
  await page.goBack();
  await page.waitForTimeout(500);
  const bannerAfterBack = await bannerLocator(page).count();
  assert.equal(bannerAfterBack, 0, "Geri tuşunda banner tekrar görünmemeli");
  ok("[5] Geri tuşuyla dönüldüğünde banner tekrar görünmüyor");

  // ---- [TEST 7] Mobilde aynı davranış ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.getByText("Banner Test İlanı Widget").waitFor({ state: "visible", timeout: 10000 });
  // Widget zaten puanlanmış durumda ("Verdiğiniz puan" görünür); mobilde de
  // widget'ın kendisi ve genel sayfa düzeni sorunsuz render oluyor mu kontrol et.
  await page.getByText("Verdiğiniz puan").first().waitFor({ state: "visible", timeout: 10000 });
  const noOverflowMobile = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  assert.ok(noOverflowMobile, "Mobilde (390px) sayfa yatay taşma yapmamalı");
  ok("[7] Mobilde (390px) sayfa doğru render oluyor, yatay taşma yok");
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- [TEST 8] prefers-reduced-motion: fade atlanıp süre sonunda doğrudan kaldırılıyor ----
  await context.close();
  const reducedContext = await browser.newContext();
  await reducedContext.addCookies([]);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.emulateMedia({ reducedMotion: "reduce" });
  const reducedConsoleErrors = [];
  reducedPage.on("console", (msg) => {
    if (msg.type() === "error") reducedConsoleErrors.push(msg.text());
  });
  reducedPage.on("pageerror", (err) => reducedConsoleErrors.push(String(err)));

  await loginAs(reducedPage, "zeynep@test.com", "Zeynep1!");
  // Bu YENİ (izole depolamalı) context'te kullanıcılar yeniden tohumlanır,
  // bu yüzden id'ler ilk context'tekiyle AYNI DEĞİLDİR -- bu context'e özgü
  // gerçek id'leri burada yeniden okumak gerekir.
  const reducedZeynepId = await getUserId(reducedPage, "zeynep@test.com");
  const reducedMertId = await getUserId(reducedPage, "mert@test.com");
  await seedData(reducedPage, { requesterId: reducedZeynepId, providerId: reducedMertId });
  await reducedPage.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await reducedPage.getByText("Banner Test İlanı A").waitFor({ state: "visible", timeout: 10000 });
  await confirmCompletionAndRate(reducedPage, "Banner Test İlanı A", 3);
  const tReduced = Date.now();
  await bannerLocator(reducedPage).waitFor({ state: "visible", timeout: 2000 });
  ok("[8] prefers-reduced-motion açıkken banner yine görünüyor");

  // 3sn'den az önce hâlâ görünür olmalı (fade beklenmez, direkt kaybolma).
  const beforeExpiry = tReduced + 2700 - Date.now();
  if (beforeExpiry > 0) await reducedPage.waitForTimeout(beforeExpiry);
  await assert.doesNotReject(bannerLocator(reducedPage).waitFor({ state: "visible", timeout: 100 }));

  // 3sn + küçük pay sonrası: fade ARA DURUMU olmadan doğrudan DOM'dan kalkmış olmalı.
  const afterExpiry = tReduced + 3150 - Date.now();
  if (afterExpiry > 0) await reducedPage.waitForTimeout(afterExpiry);
  const reducedCount = await bannerLocator(reducedPage).count();
  assert.equal(reducedCount, 0, "prefers-reduced-motion açıkken banner, 3sn sonunda fade beklenmeden doğrudan kalkmalı");
  ok("[8] prefers-reduced-motion açıkken fade atlanıyor, ~3sn sonunda banner doğrudan (ara geçiş olmadan) DOM'dan kalkıyor");

  if (reducedConsoleErrors.length > 0) {
    console.log("\n[rating-banner-test] UYARI (reduced-motion context): Konsolda hata yakalandı:");
    for (const err of reducedConsoleErrors) console.log(`  ! ${err}`);
  }
  // Temizlik (reduced-motion context)
  await reducedPage.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter(
      (j) => !["banner-job-a", "banner-job-b", "banner-job-widget"].includes(j.id),
    );
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter(
      (o) => !["banner-offer-a", "banner-offer-b", "banner-offer-widget"].includes(o.id),
    );
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  });
  await reducedContext.close();

  // ---- [TEST 9] Konsol hatası kontrolü (ilk context) ----
  if (consoleErrors.length > 0) {
    console.log("\n[rating-banner-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    throw new Error("Konsolda beklenmeyen hata bulundu");
  }
  ok("[9] İlk context boyunca konsolda hiç JS hatası yakalanmadı");

  console.log(`\n[rating-banner-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[rating-banner-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
