// node scripts/tmp-operation-offer-button-visibility-fix-test.mjs
//
// "Operasyondaki Hizmetler" kartındaki (operation-service-offers-card.tsx)
// "Teklif Ver" butonu görünürlüğü düzeltmesini doğrular — GERÇEK render
// edilmiş sayfaya karşı (Playwright, gerçek Chromium).
//
// KÖK NEDEN: buton eskiden yalnızca `!isCurrent` kontrol ediyordu — izleyen
// kullanıcının rolünden, bu ilana zaten verdiği tekliften, ilanın gerçekten
// teklife açık olup olmadığından veya kapasiteden bağımsız olarak
// gösteriliyordu. Düzeltme: buton artık `offers.ts#canProviderSubmitNewOffer`
// (offer-panel.tsx'in gerçek teklif formu kapı bekçisiyle AYNI kaynak) ile
// hesaplanıyor.
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

async function injectJob(page, { id, title, category = "lashing", workDate = "2026-09-01", status = "yayinda", requesterId, operationId }) {
  await page.evaluate(
    ({ id, title, category, workDate, status, requesterId, operationId }) => {
      const KEY = "malsevk.jobs.v1";
      const jobs = JSON.parse(localStorage.getItem(KEY) || "[]");
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Dilovası",
        workLocationType: "Buton Görünürlüğü Test Tesisi",
        workDate,
        description: "Buton görünürlüğü düzeltmesi testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Buton görünürlüğü düzeltmesi testi operasyon detayı, en az on karakter.",
        status,
        requesterId,
        operationId,
        photos: [],
      });
      localStorage.setItem(KEY, JSON.stringify(jobs));
    },
    { id, title, category, workDate, status, requesterId, operationId },
  );
}

async function injectOffer(page, { jobId, providerId, status }) {
  await page.evaluate(
    ({ jobId, providerId, status }) => {
      const KEY = "malsevk.offers.v1";
      const offers = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = new Date().toISOString();
      offers.push({
        id: crypto.randomUUID(),
        jobId,
        providerId,
        amount: 1000,
        currency: "TRY",
        description: "Buton görünürlüğü düzeltmesi test teklifi",
        estimatedDuration: "1 gün",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem(KEY, JSON.stringify(offers));
    },
    { jobId, providerId, status },
  );
}

function offersCard(page) {
  return page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
}

function rowFor(page, title) {
  return offersCard(page).locator("li", { has: page.getByText(title, { exact: true }) });
}

async function assertOfferButtonVisible(page, title) {
  await assert.doesNotReject(
    rowFor(page, title).getByRole("link", { name: "Teklif Ver", exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
}

async function assertOfferButtonHidden(page, title) {
  assert.equal(
    await rowFor(page, title).getByRole("link", { name: "Teklif Ver", exact: true }).count(),
    0,
    `"${title}" satırında Teklif Ver butonu GÖRÜNMEMELİ`,
  );
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
  }

  const operationId = "btn-vis-test-" + crypto.randomUUID();
  const jobs = {
    main: { id: crypto.randomUUID(), title: "Buton Testi Ana Hizmet" },
    pending: { id: crypto.randomUUID(), title: "Buton Testi Beklemede Servis" },
    accepted: { id: crypto.randomUUID(), title: "Buton Testi Kabul Edilmis Servis" },
    completedOffer: { id: crypto.randomUUID(), title: "Buton Testi Tamamlanmis Teklif Servis" },
    openNoOffer: { id: crypto.randomUUID(), title: "Buton Testi Acik Teklifsiz Servis" },
    jobCompleted: { id: crypto.randomUUID(), title: "Buton Testi Ilan Tamamlandi Servis" },
    jobCancelled: { id: crypto.randomUUID(), title: "Buton Testi Ilan Iptal Servis" },
  };

  // =====================================================================
  // KURULUM — tek operasyon altında, her senaryo için ayrı bir kardeş ilan.
  // Doğrudan localStorage'a Job/Offer enjekte edilir (gerçek çok-hizmetli
  // formu tekrar tekrar sürmek yerine) — Operasyondaki Hizmetler kartı
  // yalnızca job-store.ts'in okuduğu localStorage kayıtlarına bakar, bu
  // yüzden bu enjeksiyon gerçek oluşturma akışıyla birebir eşdeğerdir.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");

    for (const [key, job] of Object.entries(jobs)) {
      const status = key === "jobCompleted" ? "tamamlandi" : key === "jobCancelled" ? "iptal" : "yayinda";
      await injectJob(page, { id: job.id, title: job.title, requesterId: zeynepId, operationId, status });
    }

    await injectOffer(page, { jobId: jobs.pending.id, providerId: mertId, status: "pending" });
    await injectOffer(page, { jobId: jobs.accepted.id, providerId: mertId, status: "accepted" });
    await injectOffer(page, { jobId: jobs.completedOffer.id, providerId: mertId, status: "completed" });

    ok("Kurulum: 7 kardeş ilanlı operasyon + mert için pending/accepted/completed teklifler oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // TEST 1 — Kendi pending teklifi olan kullanıcı: "Beklemede" görünür,
  // "Teklif Ver" görünmez.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assert.doesNotReject(
      rowFor(page, jobs.pending.title).getByText("Beklemede", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    await assertOfferButtonHidden(page, jobs.pending.title);
    ok("TEST 1: Kendi pending teklifi olan kullanıcı (mert) → 'Beklemede' görünür, 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 2 — Kendi accepted teklifi olan kullanıcı: "Teklifiniz Kabul
  // Edildi" görünür, "Teklif Ver" görünmez.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assert.doesNotReject(
      rowFor(page, jobs.accepted.title).getByText("Teklifiniz Kabul Edildi", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    await assertOfferButtonHidden(page, jobs.accepted.title);
    ok("TEST 2: Kendi accepted teklifi olan kullanıcı (mert) → 'Teklifiniz Kabul Edildi' görünür, 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 3 — Kendi completed işi olan kullanıcı: "Tamamlandı" görünür,
  // "Teklif Ver" görünmez.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assert.doesNotReject(
      rowFor(page, jobs.completedOffer.title).getByText("Tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    await assertOfferButtonHidden(page, jobs.completedOffer.title);
    ok("TEST 3: Kendi completed işi olan kullanıcı (mert) → 'Tamamlandı' görünür, 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 4 — Hiç teklif vermemiş kullanıcı + gerçekten aktif/açık ilan:
  // "Teklif Ver" görünür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertOfferButtonVisible(page, jobs.openNoOffer.title);
    ok("TEST 4: Hiç teklif vermemiş kullanıcı (mehmet) + gerçekten aktif/açık ilan → 'Teklif Ver' görünür");
    await page.close();
  }

  // =====================================================================
  // TEST 5 — Tamamlanmış ilan (job.status === 'tamamlandi'): hiçbir
  // sağlayıcıda "Teklif Ver" görünmez (hiç teklifi olmayan mehmet dahil).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertOfferButtonHidden(page, jobs.jobCompleted.title);
    ok("TEST 5: Tamamlanmış ilan → hiç teklifi olmayan sağlayıcıda (mehmet) bile 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 5b — İptal edilmiş ilan (job.status === 'iptal'): aynı şekilde
  // "Teklif Ver" görünmez.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertOfferButtonHidden(page, jobs.jobCancelled.title);
    ok("TEST 5b: İptal edilmiş ilan → 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 6 — Hizmet Alan (zeynep, ilan sahibi) ve misafir: hiçbir satırda
  // "Teklif Ver" görünmez (rol koşulu sağlanmıyor).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    const anyOfferButton = offersCard(page).getByRole("link", { name: "Teklif Ver", exact: true });
    assert.equal(await anyOfferButton.count(), 0, "Hizmet Alan hiçbir satırda 'Teklif Ver' görmemeli");
    ok("TEST 6a: Hizmet Alan (zeynep, ilan sahibi) → hiçbir satırda 'Teklif Ver' görünmez");

    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await anyOfferButton.count(), 0, "Misafir hiçbir satırda 'Teklif Ver' görmemeli");
    ok("TEST 6b: Misafir (oturumsuz) → hiçbir satırda 'Teklif Ver' görünmez");

    await page.close();
  }

  // =====================================================================
  // TEST 7 — Kapasitesi dolu sağlayıcı: hiç teklif vermediği, gerçekten
  // açık bir ilanda bile "Teklif Ver" görünmez.
  // Önce (kapasite dolmadan ÖNCE) mehmet için TEST 4'ün hâlâ geçerli
  // olduğu doğrulanmıştı; şimdi mehmet'in kapasitesini MAX_ACTIVE_JOBS (5)
  // ayrı ilana "accepted" teklifle doldurup AYNI ilanı tekrar kontrol ediyoruz.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    for (let i = 0; i < 5; i++) {
      const capJobId = crypto.randomUUID();
      await injectJob(page, {
        id: capJobId,
        title: `Buton Testi Kapasite Dolum ${i + 1}`,
        requesterId: zeynepId,
      });
      await injectOffer(page, { jobId: capJobId, providerId: mehmetId, status: "accepted" });
    }
    ok("Kurulum: mehmet için 5 ayrı ilana 'accepted' teklifle aktif iş kapasitesi dolduruldu");
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertOfferButtonHidden(page, jobs.openNoOffer.title);
    ok("TEST 7: Kapasitesi dolu sağlayıcı (mehmet) → hiç teklif vermediği açık bir ilanda bile 'Teklif Ver' görünmez");
    await page.close();
  }

  // =====================================================================
  // TEST 8 — Teklif verme route'una doğrudan gidildiğinde mevcut korumalar
  // değişmeden çalışır: mert kendi accepted teklifinin OLDUĞU ilanın
  // KENDİ detay sayfasına gidince (kart üzerinden değil) OfferPanel hâlâ
  // "Bu ilana daha önce teklif verdiniz" özetini gösterir, formu değil.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.accepted.id}`);
    await page.getByText("Bu ilana daha önce teklif verdiniz.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByLabel("Teklif Fiyatı").count(), 0, "Zaten teklif verilmiş ilanda teklif formu render edilmemeli");
    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
    ok("TEST 8: Teklif verme route'una doğrudan gidildiğinde mevcut korumalar (OfferPanel) değişmeden çalışır");
    await page.close();
  }

  // =====================================================================
  // TEST 9 — Mobil görünümde taşma oluşmaz.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.setViewportSize({ width: 375, height: 800 });
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(scrollWidth <= clientWidth + 1, `Mobil görünümde yatay taşma olmamalı (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`);
    ok("TEST 9: Mobil görünümde (375px) 'Operasyondaki Hizmetler' kartında yatay taşma oluşmaz");
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-operation-offer-button-visibility-fix-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
