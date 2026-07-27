// node scripts/tmp-demo-data-reset-fix-test.mjs
//
// Demo hesaplara (bkz. users.ts#DEV_ACCOUNT_EMAILS) bağlı test verilerinin
// (ilan, operasyon, teklif, değerlendirme, bildirim, fotoğraf, son
// görüntülenen/yardımcı kayıtlar) temizlenmesini doğrular — demo HESAPLARIN
// KENDİSİ (giriş bilgileri, profil) hiç silinmeden.
//
// KAPSAM DOĞRULAMASI (kod incelemesiyle önceden doğrulandı, burada da
// tekrar kontrol edilir): `seedDevAccountsIfNeeded` yalnızca HESAPLARI
// idempotent şekilde senkronlar — hiçbir Job/Offer/Rating/bildirim kaydı
// ÜRETMEZ. Bu yüzden demo ilan/teklif/bildirim verisi uygulama yeniden
// açıldığında/tekrar girişte KENDİLİĞİNDEN YENİDEN OLUŞMAZ — ayrıca bir
// "seed'i devre dışı bırakma" adımına gerek yoktur (bu script bunu da
// ampirik olarak doğrular, bkz. son bölüm).
//
// GERÇEK KULLANICI İZOLASYONU: gerçek (demo olmayan) bir kullanıcının kendi
// ilanı VE o ilana demo OLMAYAN bir sağlayıcının verdiği teklif/değerlendirme
// dokunulmadan kalmalı — yalnızca demo bir sağlayıcının O GERÇEK ilana
// verdiği teklif silinmeli (ilan ve diğer teklifler korunarak).
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function getStoredUsers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
}
async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}
async function getStoredOffers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
}
async function getStoredRatings(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]"));
}
async function getLocalStorageValue(page, key) {
  return page.evaluate((key) => localStorage.getItem(key), key);
}

async function injectJob(page, { id, title, category = "lashing", workDate = "2026-09-01", requesterId, operationId, photos = [] }) {
  await page.evaluate(
    ({ id, title, category, workDate, requesterId, operationId, photos }) => {
      const KEY = "malsevk.jobs.v1";
      const jobs = JSON.parse(localStorage.getItem(KEY) || "[]");
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Dilovası",
        workLocationType: "Demo Veri Temizliği Testi Tesisi",
        workDate,
        description: "Demo veri temizliği testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Demo veri temizliği testi operasyon detayı, en az on karakter.",
        status: "yayinda",
        requesterId,
        operationId,
        photos,
      });
      localStorage.setItem(KEY, JSON.stringify(jobs));
    },
    { id, title, category, workDate, requesterId, operationId, photos },
  );
}

async function injectOffer(page, { id, jobId, providerId, status }) {
  await page.evaluate(
    ({ id, jobId, providerId, status }) => {
      const KEY = "malsevk.offers.v1";
      const offers = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = new Date().toISOString();
      offers.push({
        id,
        jobId,
        providerId,
        amount: 1000,
        currency: "TRY",
        description: "Demo veri temizliği testi teklifi",
        estimatedDuration: "1 gün",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem(KEY, JSON.stringify(offers));
    },
    { id, jobId, providerId, status },
  );
}

async function injectRating(page, { id, offerId, jobId, providerId, raterId, stars }) {
  await page.evaluate(
    ({ id, offerId, jobId, providerId, raterId, stars }) => {
      const KEY = "malsevk.ratings.v1";
      const ratings = JSON.parse(localStorage.getItem(KEY) || "[]");
      ratings.push({ id, offerId, jobId, providerId, raterId, stars, createdAt: new Date().toISOString() });
      localStorage.setItem(KEY, JSON.stringify(ratings));
    },
    { id, offerId, jobId, providerId, raterId, stars },
  );
}

async function injectHelperRecords(page, { userId, readIds, dismissedIds, recentlyViewedIds }) {
  await page.evaluate(
    ({ userId, readIds, dismissedIds, recentlyViewedIds }) => {
      localStorage.setItem(`malsevk_read_notifications_${userId}`, JSON.stringify(readIds));
      localStorage.setItem(`malsevk_dismissed_notifications_${userId}`, JSON.stringify(dismissedIds));
      localStorage.setItem(`malsevk_recently_viewed_jobs_${userId}`, JSON.stringify(recentlyViewedIds));
    },
    { userId, readIds, dismissedIds, recentlyViewedIds },
  );
}

function countsTable(page, title) {
  return page.getByRole("heading", { name: title, exact: true }).locator("xpath=..");
}
// `hasText` yapar CASE-INSENSITIVE SUBSTRING eşleşmesi — "İlanlar" örneğin
// "...demo ilanlarına bağlı" satırıyla da eşleşir. Bu yüzden burada satırı
// TAM (exact) etiket metniyle, `getByText(..., {exact:true})` ile buluyoruz.
async function readCountsRow(page, title, exactRowLabel) {
  const row = countsTable(page, title)
    .locator("tr")
    .filter({ has: page.getByText(exactRowLabel, { exact: true }) });
  const cells = await row.locator("td").allInnerTexts();
  return { total: Number(cells[1]), demo: Number(cells[2]) };
}

let browser;

async function main() {
  browser = await chromium.launch();
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  let zeynepId, mertId, mehmetId;
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    let users = await getStoredUsers(page);
    zeynepId = users.find((u) => u.email === "zeynep@test.com").id;
    await loginAs(page, "mert@test.com", "Mert123!");
    users = await getStoredUsers(page);
    mertId = users.find((u) => u.email === "mert@test.com").id;
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
    users = await getStoredUsers(page);
    mehmetId = users.find((u) => u.email === "mehmet.demir.demo@malsevk.com").id;
    await page.close();
    ok("Kurulum: 3 demo hesap (zeynep/mert/mehmet) mevcut, id'leri alındı");
  }

  const realUserId = "real-user-" + crypto.randomUUID();
  const realProviderId = "real-provider-" + crypto.randomUUID();
  const operationId = "demo-reset-op-" + crypto.randomUUID();

  const jobDemoA = { id: crypto.randomUUID(), title: "Demo Temizlik Servis A" };
  const jobDemoB = { id: crypto.randomUUID(), title: "Demo Temizlik Servis B" };
  const jobReal = { id: crypto.randomUUID(), title: "Gerçek Kullanici Ilani" };

  const offer1 = { id: crypto.randomUUID() }; // jobDemoA, mert(demo), pending
  const offer2 = { id: crypto.randomUUID() }; // jobDemoB, mehmet(demo), completed
  const offer3 = { id: crypto.randomUUID() }; // jobReal, mert(demo), pending -- demo SAĞLAYICI gerçek ilana teklif verdi
  const offer4 = { id: crypto.randomUUID() }; // jobReal, gerçek sağlayıcı, pending -- TAMAMEN GERÇEK, dokunulmamalı

  const ratingDemo = { id: crypto.randomUUID() }; // offer2 için, demo
  const ratingReal = { id: crypto.randomUUID() }; // offer4 için, tamamen gerçek

  // =====================================================================
  // KURULUM — demo hesaplara bağlı test verisi + izolasyon kontrolü için
  // tamamen gerçek (demo olmayan) bir ilan/teklif/değerlendirme seti.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");

    await injectJob(page, {
      id: jobDemoA.id,
      title: jobDemoA.title,
      requesterId: zeynepId,
      operationId,
      photos: [{ id: crypto.randomUUID(), order: 0, fileName: "test.jpg", fileSize: 1000, mimeType: "image/jpeg", storageKey: "demo-photo-key-1" }],
    });
    await injectJob(page, { id: jobDemoB.id, title: jobDemoB.title, requesterId: zeynepId, operationId, category: "unlashing" });
    await injectJob(page, { id: jobReal.id, title: jobReal.title, requesterId: realUserId, category: "forklift" });

    await injectOffer(page, { id: offer1.id, jobId: jobDemoA.id, providerId: mertId, status: "pending" });
    await injectOffer(page, { id: offer2.id, jobId: jobDemoB.id, providerId: mehmetId, status: "completed" });
    await injectOffer(page, { id: offer3.id, jobId: jobReal.id, providerId: mertId, status: "pending" });
    await injectOffer(page, { id: offer4.id, jobId: jobReal.id, providerId: realProviderId, status: "pending" });

    await injectRating(page, { id: ratingDemo.id, offerId: offer2.id, jobId: jobDemoB.id, providerId: mehmetId, raterId: zeynepId, stars: 5 });
    await injectRating(page, { id: ratingReal.id, offerId: offer4.id, jobId: jobReal.id, providerId: realProviderId, raterId: realUserId, stars: 4 });

    await injectHelperRecords(page, {
      userId: zeynepId,
      readIds: ["offer-received-" + offer1.id],
      dismissedIds: ["offer-received-" + offer2.id],
      recentlyViewedIds: [jobDemoA.id, jobDemoB.id],
    });
    await injectHelperRecords(page, {
      userId: mertId,
      readIds: ["teklif-kabul-" + offer1.id],
      dismissedIds: [],
      recentlyViewedIds: [jobReal.id],
    });

    ok("Kurulum: 2 demo ilan (operasyon paylaşımlı) + 1 gerçek ilan, 4 teklif (3 demo-ilişkili + 1 tamamen gerçek), 2 değerlendirme, bildirim/son-görüntülenen kayıtları oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // DRY-RUN — /gelistirme/demo-veri-sifirla üzerinden ("Şu anki durum")
  // =====================================================================
  const page = await sharedContext.newPage();
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/gelistirme/demo-veri-sifirla`);
  await page.getByRole("button", { name: "Planı Hesapla (Dry-Run)", exact: true }).click();
  await countsTable(page, "Şu anki durum").waitFor({ state: "visible", timeout: 10000 });

  const before = {
    jobs: await readCountsRow(page, "Şu anki durum", "İlanlar"),
    offers: await readCountsRow(page, "Şu anki durum", "Teklifler"),
    ratings: await readCountsRow(page, "Şu anki durum", "Değerlendirmeler"),
    photos: await readCountsRow(page, "Şu anki durum", "İlan fotoğrafları (yalnızca demo ilanlarına bağlı)"),
    notifications: await readCountsRow(page, "Şu anki durum", "Bildirimler (türetilen, demo hesaplar için)"),
  };

  assert.equal(before.jobs.total, 3, "Toplam ilan sayısı 3 olmalı (2 demo + 1 gerçek)");
  assert.equal(before.jobs.demo, 2, "Demo ilan sayısı 2 olmalı");
  assert.equal(before.offers.total, 4, "Toplam teklif sayısı 4 olmalı");
  assert.equal(before.offers.demo, 3, "Demo ile ilişkili teklif sayısı 3 olmalı (offer1/offer2/offer3 — offer4 HARİÇ)");
  assert.equal(before.ratings.total, 2, "Toplam değerlendirme sayısı 2 olmalı");
  assert.equal(before.ratings.demo, 1, "Demo ile ilişkili değerlendirme sayısı 1 olmalı");
  assert.equal(before.photos.demo, 1, "Demo ilana bağlı fotoğraf sayısı 1 olmalı");
  assert.ok(before.notifications.demo > 0, "Demo hesaplar için türetilen bildirim sayısı 0'dan büyük olmalı");
  ok(`DRY-RUN doğru: ${before.jobs.demo} demo ilan, ${before.offers.demo} demo teklif, ${before.ratings.demo} demo değerlendirme, ${before.photos.demo} demo fotoğraf, ${before.notifications.demo} türetilen bildirim tespit edildi`);

  // =====================================================================
  // UYGULA
  // =====================================================================
  await page.getByRole("button", { name: "Temizliği Uygula", exact: true }).click();
  await page.getByText("Temizlik tamamlandı.", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  ok("'Temizliği Uygula' çalıştırıldı, 'Temizlik tamamlandı.' onayı görüldü");

  const after = {
    jobs: await readCountsRow(page, "Temizlik sonrası durum", "İlanlar"),
    offers: await readCountsRow(page, "Temizlik sonrası durum", "Teklifler"),
    ratings: await readCountsRow(page, "Temizlik sonrası durum", "Değerlendirmeler"),
    photos: await readCountsRow(page, "Temizlik sonrası durum", "İlan fotoğrafları (yalnızca demo ilanlarına bağlı)"),
    notifications: await readCountsRow(page, "Temizlik sonrası durum", "Bildirimler (türetilen, demo hesaplar için)"),
  };
  assert.equal(after.jobs.demo, 0, "Temizlik sonrası demo ilan sayısı 0 olmalı");
  assert.equal(after.jobs.total, 1, "Temizlik sonrası TOPLAM ilan sayısı 1 olmalı (yalnızca gerçek ilan kaldı)");
  assert.equal(after.offers.demo, 0, "Temizlik sonrası demo teklif sayısı 0 olmalı");
  assert.equal(after.offers.total, 1, "Temizlik sonrası TOPLAM teklif sayısı 1 olmalı (yalnızca offer4 kaldı)");
  assert.equal(after.ratings.demo, 0, "Temizlik sonrası demo değerlendirme sayısı 0 olmalı");
  assert.equal(after.ratings.total, 1, "Temizlik sonrası TOPLAM değerlendirme sayısı 1 olmalı (yalnızca ratingReal kaldı)");
  assert.equal(after.photos.demo, 0, "Temizlik sonrası demo fotoğraf sayısı 0 olmalı");
  assert.equal(after.notifications.demo, 0, "Temizlik sonrası türetilen bildirim sayısı 0 olmalı");
  ok("TEMİZLİK SONRASI: demo ilan/teklif/değerlendirme/fotoğraf/bildirim sayıları TAM 0 — gerçek ilan/teklif/değerlendirme (yalnızca 1'er) KORUNDU");

  // =====================================================================
  // GERÇEK VERİ İZOLASYONU — doğrudan localStorage'dan doğrulama
  // =====================================================================
  {
    const jobs = await getStoredJobs(page);
    const offers = await getStoredOffers(page);
    const ratings = await getStoredRatings(page);
    assert.ok(jobs.some((j) => j.id === jobReal.id), "Gerçek ilan (jobReal) hâlâ mevcut olmalı");
    assert.ok(!jobs.some((j) => j.id === jobDemoA.id || j.id === jobDemoB.id), "Demo ilanlar (operasyon dahil) tamamen kalkmış olmalı");
    assert.ok(offers.some((o) => o.id === offer4.id), "Gerçek sağlayıcının gerçek ilana verdiği teklif (offer4) hâlâ mevcut olmalı");
    assert.ok(!offers.some((o) => [offer1.id, offer2.id, offer3.id].includes(o.id)), "offer1/offer2/offer3 (demo ilişkili) tamamen kalkmış olmalı — offer3 GERÇEK ilana ait olsa bile demo sağlayıcıya ait olduğu için kalkmalı");
    assert.ok(ratings.some((r) => r.id === ratingReal.id), "Gerçek değerlendirme (ratingReal) hâlâ mevcut olmalı");
    assert.ok(!ratings.some((r) => r.id === ratingDemo.id), "Demo değerlendirme (ratingDemo) kalkmış olmalı");
    ok("KRİTİK İZOLASYON: gerçek ilan (jobReal) VE ona gerçek sağlayıcının verdiği teklif/değerlendirme (offer4/ratingReal) dokunulmadan kaldı; yalnızca demo sağlayıcının AYNI gerçek ilana verdiği teklif (offer3) silindi");

    const zeynepRead = await getLocalStorageValue(page, `malsevk_read_notifications_${zeynepId}`);
    const zeynepDismissed = await getLocalStorageValue(page, `malsevk_dismissed_notifications_${zeynepId}`);
    const zeynepRecent = await getLocalStorageValue(page, `malsevk_recently_viewed_jobs_${zeynepId}`);
    const mertRead = await getLocalStorageValue(page, `malsevk_read_notifications_${mertId}`);
    const mertRecent = await getLocalStorageValue(page, `malsevk_recently_viewed_jobs_${mertId}`);
    assert.equal(zeynepRead, null, "zeynep'in bildirim okunma kaydı tamamen silinmeli");
    assert.equal(zeynepDismissed, null, "zeynep'in bildirim gizleme kaydı tamamen silinmeli");
    assert.equal(zeynepRecent, null, "zeynep'in son görüntülenen ilan kaydı tamamen silinmeli");
    assert.equal(mertRead, null, "mert'in bildirim okunma kaydı tamamen silinmeli");
    assert.equal(mertRecent, null, "mert'in son görüntülenen ilan kaydı tamamen silinmeli");
    ok("Demo hesapların bildirim okunma/gizleme VE son görüntülenen ilan kayıtları (yardımcı kayıtlar) tamamen temizlendi — yetim id kalmadı");

    const users = await getStoredUsers(page);
    const zeynepUser = users.find((u) => u.email === "zeynep@test.com");
    const mertUser = users.find((u) => u.email === "mert@test.com");
    const mehmetUser = users.find((u) => u.email === "mehmet.demir.demo@malsevk.com");
    assert.ok(zeynepUser && mertUser && mehmetUser, "3 demo hesap da (kullanıcı kaydı) hâlâ mevcut olmalı");
    assert.equal(zeynepUser.id, zeynepId, "zeynep'in kullanıcı id'si değişmemiş olmalı");
    ok("Demo HESAPLARIN kendisi (users.ts kaydı, id, giriş bilgileri) hiç değişmeden korundu");
  }

  await page.close();

  // =====================================================================
  // TEMİZLİK SONRASI: demo hesaplarla yeniden giriş + boş panel kontrolü
  // =====================================================================
  {
    const zPage = await sharedContext.newPage();
    await loginAs(zPage, "zeynep@test.com", "Zeynep1!");
    await zPage.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await zPage.waitForLoadState("networkidle");
    const bodyText = await zPage.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes(jobDemoA.title), false, "Hizmet Taleplerim'de artık silinmiş demo ilan (Servis A) görünmemeli");
    assert.equal(bodyText.includes(jobDemoB.title), false, "Hizmet Taleplerim'de artık silinmiş demo ilan (Servis B) görünmemeli");
    ok("zeynep ile yeniden giriş yapılabildi; 'Hizmet Taleplerim' paneli silinen demo ilanları GÖSTERMİYOR (boş başlıyor)");

    const bPage = await sharedContext.newPage();
    await loginAs(bPage, "zeynep@test.com", "Zeynep1!", "/panel/bildirimler");
    await bPage.waitForLoadState("networkidle");
    const notifText = await bPage.evaluate(() => document.body.innerText);
    assert.equal(notifText.includes(jobDemoA.title) || notifText.includes(jobDemoB.title), false, "Bildirimler panelinde silinen demo ilanlara ait hiçbir bildirim görünmemeli");
    ok("zeynep'in 'Bildirimler' paneli silinen demo verilerine ait hiçbir bildirim GÖSTERMİYOR (boş başlıyor)");

    await zPage.close();
    await bPage.close();
  }

  {
    const mPage = await sharedContext.newPage();
    await loginAs(mPage, "mert@test.com", "Mert123!", "/panel/tekliflerim");
    await mPage.waitForLoadState("networkidle");
    const offersText = await mPage.evaluate(() => document.body.innerText);
    assert.equal(offersText.includes(jobDemoA.title), false, "mert'in 'Verdiğim Teklifler' paneli silinen demo ilana ait teklifi GÖSTERMEMELİ");
    ok("mert ile yeniden giriş yapılabildi; 'Verdiğim Teklifler' paneli silinen demo teklifi GÖSTERMİYOR (boş başlıyor)");
    await mPage.close();
  }

  // =====================================================================
  // YENİDEN-SEED KONTROLÜ — uygulama yeniden açıldığında (yeni sekme, yeni
  // login) demo ilan/teklif/bildirim verisi KENDİLİĞİNDEN GERİ GELMEMELİ.
  // seedDevAccountsIfNeeded yalnızca HESAPLARI senkronlar, veri üretmez.
  // =====================================================================
  {
    const rPage = await sharedContext.newPage();
    await loginAs(rPage, "zeynep@test.com", "Zeynep1!");
    await loginAs(rPage, "mert@test.com", "Mert123!");
    await loginAs(rPage, "mehmet.demir.demo@malsevk.com", "Demo123!");
    const jobsAfterReLogin = await getStoredJobs(rPage);
    const offersAfterReLogin = await getStoredOffers(rPage);
    const demoJobsAfterReLogin = jobsAfterReLogin.filter(
      (j) => j.requesterId === zeynepId || j.requesterId === mertId || j.requesterId === mehmetId,
    );
    const demoOffersAfterReLogin = offersAfterReLogin.filter(
      (o) => o.providerId === mertId || o.providerId === mehmetId,
    );
    assert.equal(demoJobsAfterReLogin.length, 0, "3 demo hesapla art arda yeniden giriş sonrası HİÇBİR demo ilan yeniden oluşmamalı");
    assert.equal(demoOffersAfterReLogin.length, 0, "3 demo hesapla art arda yeniden giriş sonrası HİÇBİR demo teklif yeniden oluşmamalı");
    ok("YENİDEN-SEED KONTROLÜ: 3 demo hesapla art arda yeniden giriş sonrası hiçbir demo ilan/teklif kendiliğinden geri gelmedi — yalnızca hesap seed'i (seedDevAccountsIfNeeded) çalışıyor, veri seed'i YOK, devre dışı bırakılacak bir şey de yok");
    await rPage.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-demo-data-reset-fix-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
