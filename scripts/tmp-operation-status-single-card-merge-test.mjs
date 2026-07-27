// node scripts/tmp-operation-status-single-card-merge-test.mjs
//
// "Önceki operasyon sadeleştirme değişikliğinin düzeltilmesi" görevinin canlı
// regresyon kapısı — GERÇEK render edilmiş sayfaya karşı (Playwright, gerçek
// Chromium). Önceki uygulama yalnızca satır METNİNİ birleştirmişti ama "Bu
// Operasyondaki Diğer Hizmetler"/"Operasyondaki Hizmetler"/"Operasyon Durumu"
// hâlâ ÜÇ AYRI kart olarak duruyordu. Bu script, artık sayfada operasyon
// hizmetlerinin gösterildiği TEK yerin "Operasyon Durumu" olduğunu — diğer iki
// başlığın sayfanın HİÇBİR yerinde bulunmadığını — ve o tek kartın eski iki
// kartın sahip olduğu TÜM veri/durum/aksiyon/yönlendirme davranışını
// (operation-status-card.tsx, offers.ts#getOperationServiceCardStatus)
// kaybetmeden devraldığını doğrular.
//
// Bu script scripts/tmp-operation-service-card-status-consolidation-test.mjs
// (üç-kart varsayımına dayandığı için artık süpersede — bkz. o dosyanın
// başlığı) yerine kullanılmalıdır.
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

async function loginAsSyntheticProvider(page, { id, name }) {
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.evaluate(
    ({ id, name }) => {
      localStorage.setItem("malsevk.session.v1", JSON.stringify({ id, name, role: "hizmet-veren" }));
    },
    { id, name },
  );
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
        workLocationType: "Birleşik Kart Testi Tesisi",
        workDate,
        description: "Operasyon Durumu birleşik kart testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Operasyon Durumu birleşik kart testi operasyon detayı, en az on karakter.",
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
        description: "Birleşik kart testi teklifi",
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

function statusCard(page) {
  return page.getByRole("heading", { name: "Operasyon Durumu" }).locator("xpath=..");
}

// `exact: false` — mevcut ilanın satırı aynı <p> içinde " (Bu ilan)" ekini de
// taşır, bu yüzden tam eşleşme yalnızca o satırda başarısız olurdu. Test
// başlıklarının hiçbiri birbirinin alt dizesi olmadığı için (bkz. KURULUM)
// bu güvenlidir.
function rowByTitleIn(card, page, title) {
  return card.locator("li", { has: page.getByText(title, { exact: false }) });
}

async function assertRowLabel(card, page, title, label, { context }) {
  await assert.doesNotReject(
    rowByTitleIn(card, page, title).getByText(label, { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    `${context}: "${title}" satırında "${label}" görünmeli`,
  );
}

async function assertRowOfferButtonVisible(card, page, title, { context }) {
  await assert.doesNotReject(
    rowByTitleIn(card, page, title).getByText("Teklif Ver", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    `${context}: "${title}" satırında "Teklif Ver" görünmeli`,
  );
}

async function assertRowOfferButtonHidden(card, page, title, { context }) {
  assert.equal(
    await rowByTitleIn(card, page, title).getByText("Teklif Ver", { exact: true }).count(),
    0,
    `${context}: "${title}" satırında "Teklif Ver" GÖRÜNMEMELİ`,
  );
}

async function assertOldSectionsGone(page) {
  assert.equal(
    await page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).count(),
    0,
    "'Bu Operasyondaki Diğer Hizmetler' başlığı sayfanın HİÇBİR yerinde bulunmamalı",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).count(),
    0,
    "'Operasyondaki Hizmetler' başlığı sayfanın HİÇBİR yerinde bulunmamalı",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Operasyon Durumu" }).count(),
    1,
    "'Operasyon Durumu' başlığı sayfada TAM OLARAK bir kez görünmeli (tekrar eden liste yok)",
  );
}

let browser;

async function main() {
  browser = await chromium.launch();
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

  let zeynepId, mertId;
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    let users = await getStoredUsers(page);
    zeynepId = users.find((u) => u.email === "zeynep@test.com").id;
    await loginAs(page, "mert@test.com", "Mert123!");
    users = await getStoredUsers(page);
    mertId = users.find((u) => u.email === "mert@test.com").id;
    await page.close();
  }

  const operationId = "single-card-merge-test-" + crypto.randomUUID();
  const jobs = {
    main: { id: crypto.randomUUID(), title: "Birlesik Kart Ana Sayfa Servisi" },
    open: { id: crypto.randomUUID(), title: "Birlesik Kart Acik Servis" },
    pending: { id: crypto.randomUUID(), title: "Birlesik Kart Beklemede Servis" },
    inProgress: { id: crypto.randomUUID(), title: "Birlesik Kart Devam Eden Servis" },
    completed: { id: crypto.randomUUID(), title: "Birlesik Kart Tamamlanmis Servis" },
  };

  // =====================================================================
  // KURULUM — 5 kardeş ilanlı tek operasyon (ana sayfa + 4 farklı senaryo).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    for (const [, job] of Object.entries(jobs)) {
      await injectJob(page, { id: job.id, title: job.title, requesterId: zeynepId, operationId });
    }
    await injectOffer(page, { jobId: jobs.pending.id, providerId: mertId, status: "pending" });
    await injectOffer(page, { jobId: jobs.inProgress.id, providerId: mertId, status: "in_progress" });
    await injectOffer(page, { jobId: jobs.completed.id, providerId: mertId, status: "completed" });
    ok("Kurulum: 5 kardeş ilanlı operasyon (ana sayfa + acik/pending/in_progress/completed) oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // SENARYO 1 & 12 — Üç (fazlasıyla, burada 5) hizmet yalnızca "Operasyon
  // Durumu" alanında görünür; eski iki bölüm sayfanın hiçbir yerinde yok;
  // sayfada tekrar eden operasyon/hizmet listesi kalmaz.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertOldSectionsGone(page);
    for (const job of Object.values(jobs)) {
      // `exact: false` — mevcut ilanın (jobs.main) satırı aynı <p> içinde
      // " (Bu ilan)" ekini de taşır, bu yüzden tam eşleşme yalnızca o satırda
      // başarısız olur; burada yalnızca satırın VAR OLDUĞU doğrulanıyor.
      await assert.doesNotReject(
        statusCard(page).getByText(job.title, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }),
        `"${job.title}" satırı 'Operasyon Durumu' içinde görünmeli`,
      );
    }
    ok("SENARYO 1/2/12: Operasyona ait TÜM hizmetler (5/5) yalnızca 'Operasyon Durumu' alanında görünür; eski iki bölüm hiçbir yerde yok, tekrar eden liste yok");
    await page.close();
  }

  // =====================================================================
  // SENARYO 3 — Mevcut ilan "Bu ilan" olarak işaretlenir, "Teklif Ver"
  // göstermez, doğru durumu ("Teklife Açık") gösterir.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });

    const mainRow = rowByTitleIn(statusCard(page), page, jobs.main.title);
    await assert.doesNotReject(
      mainRow.getByText("(Bu ilan)", { exact: false }).waitFor({ state: "visible", timeout: 5000 }),
      "Mevcut ilanın satırı '(Bu ilan)' ibaresini taşımalı",
    );
    assert.equal(await mainRow.getByText("Teklif Ver", { exact: true }).count(), 0, "Mevcut ilanın kendi satırında 'Teklif Ver' GÖRÜNMEMELİ");
    await assert.doesNotReject(
      mainRow.getByText("Teklife Açık", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      "Mevcut ilanın satırı doğru durumu ('Teklife Açık') göstermeli",
    );
    ok("SENARYO 3: Mevcut ilan '(Bu ilan)' ile işaretlenir, kendi satırında 'Teklif Ver' göstermez, doğru durumu ('Teklife Açık') gösterir");
    await page.close();
  }

  // =====================================================================
  // SENARYO 4/6/7 — Teklif vermemiş Hizmet Veren (mehmet) açık hizmette
  // "Teklif Ver" görür; teklif vermiş Hizmet Veren (mert) ikinci kez
  // "Teklif Ver" görmez, kendi durumunu ("Teklif Bekliyor") görür; mehmet
  // mert'in durumunu görmez.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowOfferButtonVisible(statusCard(page), page, jobs.open.title, { context: "mehmet (hiç teklif vermemiş)" });
    assert.equal(
      await rowByTitleIn(statusCard(page), page, jobs.pending.title).getByText("Teklif Bekliyor", { exact: true }).count(),
      0,
      "mehmet, mert'e ait 'Teklif Bekliyor' durumunu KESİNLİKLE görmemeli",
    );
    await assertRowOfferButtonVisible(statusCard(page), page, jobs.pending.title, { context: "mehmet, mert'in pending verdiği ilanda (ilan hâlâ açık)" });
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowOfferButtonHidden(statusCard(page), page, jobs.pending.title, { context: "mert (kendi pending teklifi)" });
    await assertRowLabel(statusCard(page), page, jobs.pending.title, "Teklif Bekliyor", { context: "mert" });
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes("Teklifiniz:"), false, "'Teklifiniz:' ön eki hiç görünmemeli");
    ok("SENARYO 4/6/7: Teklif vermemiş Hizmet Veren (mehmet) açık hizmette 'Teklif Ver' görür; teklif vermiş (mert) ikinci kez görmez, 'Teklif Bekliyor' görür; mehmet mert'in durumunu görmez");
    await page.close();
  }

  // =====================================================================
  // SENARYO 5 — "Teklif Ver" tıklandığında mevcut teklif ekranı (gerçek
  // /ilanlar/[id] sayfasındaki OfferPanel) açılır.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });

    const link = rowByTitleIn(statusCard(page), page, jobs.open.title);
    await link.click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${jobs.open.id}`, { timeout: 10000 });
    await page.getByRole("heading", { name: "Teklif Ver", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByLabel("Teklif Fiyatı").count(), 1, "Hedef ilanın kendi sayfasında gerçek teklif formu (OfferPanel) render edilmeli");
    ok("SENARYO 5: 'Teklif Ver' (satır linki) tıklandığında hedef ilanın kendi sayfasındaki mevcut OfferPanel açılır");
    await page.close();
  }

  // =====================================================================
  // SENARYO 8 — İşe başlanmış hizmette "Teklif Ver" hiçbir kullanıcıda
  // görünmez (kendi teklifi olmayan, hiç görmemiş sentetik bir Hizmet Veren
  // dahil); kapasite/buton görünürlük kuralı bozulmadı.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAsSyntheticProvider(page, { id: "never-seen-" + crypto.randomUUID(), name: "Hiç Görmemiş Sağlayıcı" });
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowOfferButtonHidden(statusCard(page), page, jobs.inProgress.title, { context: "hiç görmemiş sentetik Hizmet Veren" });
    await assertRowLabel(statusCard(page), page, jobs.inProgress.title, "Başka Hizmet Verenle Anlaşıldı", { context: "hiç görmemiş sentetik Hizmet Veren" });
    ok("SENARYO 8: İşe başlanmış hizmette hiçbir kullanıcı (hiç görmemiş bile) 'Teklif Ver' göremez");
    await page.close();
  }

  // =====================================================================
  // SENARYO 9 — Tamamlanmış hizmet yalnızca "Tamamlandı" gösterir, işlem
  // butonu yok, 'Teklifiniz: Tamamlandı' YOK.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(statusCard(page), page, jobs.completed.title, "Tamamlandı", { context: "mert" });
    await assertRowOfferButtonHidden(statusCard(page), page, jobs.completed.title, { context: "mert, tamamlanmış hizmette" });
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes("Teklifiniz: Tamamlandı"), false, "'Teklifiniz: Tamamlandı' KESİNLİKLE görünmemeli");
    ok("SENARYO 9: Tamamlanmış hizmet yalnızca 'Tamamlandı' gösterir, işlem butonu yok");
    await page.close();
  }

  // =====================================================================
  // SENARYO 10 — Operasyondaki farklı hizmetlerin durumları birbirine
  // karışmaz (aynı sayfada, aynı anda, mert'in görünümünde).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(statusCard(page), page, jobs.pending.title, "Teklif Bekliyor", { context: "mert, aynı sayfada" });
    await assertRowLabel(statusCard(page), page, jobs.inProgress.title, "Devam Ediyor", { context: "mert, aynı sayfada" });
    await assertRowLabel(statusCard(page), page, jobs.completed.title, "Tamamlandı", { context: "mert, aynı sayfada" });
    await assertRowOfferButtonVisible(statusCard(page), page, jobs.open.title, { context: "mert, aynı sayfada (bu ilana hiç teklif vermedi)" });
    ok("SENARYO 10: Aynı operasyondaki farklı hizmetlerin durumları (mert'in görünümünde) birbirinden bağımsız, doğru şekilde ayrışır");
    await page.close();
  }

  // =====================================================================
  // SENARYO 11 — Masaüstü ve mobil görünüm taşmaz.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth + 1, `Masaüstünde yatay taşma olmamalı (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`);
    }

    await page.setViewportSize({ width: 375, height: 1200 });
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await statusCard(page).waitFor({ state: "visible", timeout: 10000 });
    {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth + 1, `Mobilde (375px) yatay taşma olmamalı (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`);
    }
    ok("SENARYO 11: Masaüstü ve mobil (375px) görünümde 'Operasyon Durumu' kartı taşmıyor");
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-operation-status-single-card-merge-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
