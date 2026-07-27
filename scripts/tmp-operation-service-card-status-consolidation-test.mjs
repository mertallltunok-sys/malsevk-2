// node scripts/tmp-operation-service-card-status-consolidation-test.mjs
//
// SÜPERSEDE EDİLDİ — bkz. scripts/tmp-operation-status-single-card-merge-test.mjs.
// Bu script, o zaman doğru sanılan bir ARA durumu doğruluyordu: satırların
// METNİNİ (global rozet + "Teklifiniz: ..." notu yerine tek etiket) birleştirdi,
// ama "Bu Operasyondaki Diğer Hizmetler"/"Operasyondaki Hizmetler"/"Operasyon
// Durumu" hâlâ ÜÇ AYRI kart olarak duruyordu — kök nedeni yalnızca KISMEN
// çözmüştü. Sonraki görev bunu düzeltti: artık sayfada operasyon hizmetlerinin
// gösterildiği TEK yer "Operasyon Durumu" — diğer iki kart (ve bu script'in
// aradığı "Bu Operasyondaki Diğer Hizmetler"/"Operasyondaki Hizmetler"
// başlıkları) SİLİNDİ. Bu yüzden bu script artık İLK adımda (`offersCard`/
// `siblingCard` başlıklarını `waitFor` ile ararken) KASITLI OLARAK timeout ile
// başarısız olacaktır. Bu script BİLEREK değiştirilmedi (bkz. CLAUDE.md
// "tmp-*.mjs" script konvansiyonu) — canlı regresyon kapısı olarak
// tmp-operation-status-single-card-merge-test.mjs kullanılmalıdır.
//
// --- Aşağıdaki orijinal açıklama (artık geçersiz — üç kart varsayımına dayanır) ---
// "Operasyon içindeki hizmet kartlarının sadeleştirilmesi" görevinin canlı
// regresyon kapısı — GERÇEK render edilmiş sayfaya karşı (Playwright, gerçek
// Chromium). Bu script, `offers.ts#getOperationServiceCardStatus`in üç
// kartta da (operation-sibling-jobs-card.tsx/operation-service-offers-card.tsx/
// operation-status-card.tsx) TEK, çelişkisiz bir durum/aksiyon alanı ürettiğini
// doğrular — eskiden ayrı ayrı render edilen [GLOBAL ana rozet] + [izleyiciye
// özel "Teklifiniz: ..." ikincil notu] artık YOK; her satırda TEK bir metin
// (ya da "Teklif Ver" butonu/kısayolu) var.
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
        workLocationType: "Sadeleştirme Testi Tesisi",
        workDate,
        description: "Operasyon kart sadeleştirmesi testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Operasyon kart sadeleştirmesi testi operasyon detayı, en az on karakter.",
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

async function injectOffer(page, { jobId, providerId, status, completionRequestedByUserId }) {
  await page.evaluate(
    ({ jobId, providerId, status, completionRequestedByUserId }) => {
      const KEY = "malsevk.offers.v1";
      const offers = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = new Date().toISOString();
      const offer = {
        id: crypto.randomUUID(),
        jobId,
        providerId,
        amount: 1000,
        currency: "TRY",
        description: "Sadeleştirme testi teklifi",
        estimatedDuration: "1 gün",
        status,
        createdAt: now,
        updatedAt: now,
      };
      if (completionRequestedByUserId) {
        offer.completionRequestedByUserId = completionRequestedByUserId;
        offer.completionRequestedAt = now;
      }
      offers.push(offer);
      localStorage.setItem(KEY, JSON.stringify(offers));
    },
    { jobId, providerId, status, completionRequestedByUserId },
  );
}

function siblingCard(page) {
  return page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).locator("xpath=..");
}
function offersCard(page) {
  return page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
}
function statusCard(page) {
  return page.getByRole("heading", { name: "Operasyon Durumu" }).locator("xpath=..");
}

function rowByTitleIn(card, page, title) {
  return card.locator("li", { has: page.getByText(title, { exact: true }) });
}

// "Operasyon Durumu" kartının satırları başlık değil kategori adı gösterir
// (bkz. operation-status-card.tsx) — bu yüzden statusCard'daki bir satırı
// hedeflemek için ayrı bir seçici gerekir.
function rowByCategoryIn(card, page, categoryLabel) {
  return card.locator("li", { has: page.getByText(categoryLabel, { exact: true }) });
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

  const operationId = "status-consolidation-test-" + crypto.randomUUID();
  const jobs = {
    main: { id: crypto.randomUUID(), title: "Konsolidasyon Ana Sayfa Servisi" },
    open: { id: crypto.randomUUID(), title: "Konsolidasyon Acik Servis" },
    pending: { id: crypto.randomUUID(), title: "Konsolidasyon Beklemede Servis" },
    accepted: { id: crypto.randomUUID(), title: "Konsolidasyon Kabul Edilmis Servis" },
    inProgress: { id: crypto.randomUUID(), title: "Konsolidasyon Devam Eden Servis" },
    completionRequested: { id: crypto.randomUUID(), title: "Konsolidasyon Tamamlama Bekleyen Servis" },
    disputed: { id: crypto.randomUUID(), title: "Konsolidasyon Itirazli Servis" },
    completed: { id: crypto.randomUUID(), title: "Konsolidasyon Tamamlanmis Servis" },
    rejected: { id: crypto.randomUUID(), title: "Konsolidasyon Reddedilmis Servis" },
    jobCancelled: { id: crypto.randomUUID(), title: "Konsolidasyon Iptal Ilan Servisi" },
  };

  // =====================================================================
  // KURULUM
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");

    // "Operasyon Durumu" kartı satırları başlık değil kategori adı gösterir
    // (bkz. operation-status-card.tsx) — jobs.inProgress/jobs.completed'e
    // benzersiz bir kategori verilir ki o kartta da bu iki satır özel olarak
    // hedeflenebilsin (diğer tüm işler varsayılan "lashing" kategorisinde kalır).
    for (const [key, job] of Object.entries(jobs)) {
      const status = key === "jobCancelled" ? "iptal" : "yayinda";
      const category = key === "inProgress" ? "forklift" : key === "completed" ? "unlashing" : undefined;
      await injectJob(page, { id: job.id, title: job.title, requesterId: zeynepId, operationId, status, ...(category ? { category } : {}) });
    }

    await injectOffer(page, { jobId: jobs.pending.id, providerId: mertId, status: "pending" });
    await injectOffer(page, { jobId: jobs.accepted.id, providerId: mertId, status: "accepted" });
    await injectOffer(page, { jobId: jobs.inProgress.id, providerId: mertId, status: "in_progress" });
    // mehmet'in bu ilana verdiği pending teklif, mert'in in_progress'e
    // geçmesiyle artık anlamsız kalmış olmalı ("Başka Hizmet Verenle Anlaşıldı").
    await injectOffer(page, { jobId: jobs.inProgress.id, providerId: mehmetId, status: "pending" });
    await injectOffer(page, {
      jobId: jobs.completionRequested.id,
      providerId: mertId,
      status: "completion_requested",
      completionRequestedByUserId: mertId,
    });
    await injectOffer(page, { jobId: jobs.disputed.id, providerId: mertId, status: "completion_disputed" });
    await injectOffer(page, { jobId: jobs.completed.id, providerId: mertId, status: "completed" });
    await injectOffer(page, { jobId: jobs.rejected.id, providerId: mertId, status: "rejected" });

    ok("Kurulum: 10 kardeş ilanlı operasyon, her biri farklı bir gerçek durum kombinasyonuyla oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // SENARYO 1 — Hiç teklif vermemiş ve teklif verebilen Hizmet Veren
  // (mehmet, jobs.open'da hiç teklifi yok): yalnızca "Teklif Ver" görür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertRowOfferButtonVisible(offersCard(page), page, jobs.open.title, { context: "Operasyondaki Hizmetler" });
    await assertRowOfferButtonVisible(siblingCard(page), page, jobs.open.title, { context: "Bu Operasyondaki Diğer Hizmetler" });
    assert.equal(
      await rowByTitleIn(offersCard(page), page, jobs.open.title).getByText("Teklife Açık", { exact: true }).count(),
      0,
      "Teklif verilebilen satırda ayrıca 'Teklife Açık' rozeti GÖRÜNMEMELİ — yalnızca Teklif Ver butonu",
    );
    ok("SENARYO 1: Hiç teklif vermemiş ve teklif verebilen Hizmet Veren (mehmet) → yalnızca 'Teklif Ver' görür (her iki kartta da)");
    await page.close();
  }

  // =====================================================================
  // SENARYO 2 — Aynı ilana daha önce teklif vermiş Hizmet Veren (mert,
  // jobs.pending): ikinci kez "Teklif Ver" görmez, doğru durumu ("Teklif
  // Bekliyor") görür. Aynı ilana teklif vermemiş farklı Hizmet Veren
  // (mehmet): mert'in durumunu görmez, ilan hâlâ açık olduğu için
  // "Teklif Ver" görür (kabul henüz yok, ilan başka tekliflere kapanmadı).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertRowLabel(offersCard(page), page, jobs.pending.title, "Teklif Bekliyor", { context: "mert (kendi pending teklifi)" });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.pending.title, { context: "mert (kendi pending teklifi)" });
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes("Teklifiniz:"), false, "'Teklifiniz:' ön eki hiçbir operasyon hizmet kartında görünmemeli");
    assert.equal(bodyText.includes("Teklifiniz beklemede"), false, "Eski 'Teklifiniz beklemede' alt metni artık görünmemeli");
    ok("SENARYO 2a: Aynı ilana daha önce teklif vermiş Hizmet Veren (mert) → 'Teklif Ver' görmez, yalnızca 'Teklif Bekliyor' görür, 'Teklifiniz:' ön eki hiç yok");
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    await assertRowOfferButtonVisible(offersCard(page), page, jobs.pending.title, { context: "mehmet (farklı Hizmet Veren)" });
    assert.equal(
      await rowByTitleIn(offersCard(page), page, jobs.pending.title).getByText("Teklif Bekliyor", { exact: true }).count(),
      0,
      "mehmet, mert'e ait 'Teklif Bekliyor' durumunu KESİNLİKLE görmemeli",
    );
    ok("SENARYO 2b: Aynı ilana teklif vermemiş farklı Hizmet Veren (mehmet) → mert'in durumunu görmez, ilan açık olduğu için 'Teklif Ver' görür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 3 — Teklifi kabul edilmiş ancak işe başlanmamış Hizmet Veren
  // (mert, jobs.accepted): "Teklif Kabul Edildi" görür; ilan başka Hizmet
  // Verenlerden teklif almaya DEVAM eder (mehmet hâlâ "Teklif Ver" görür).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.accepted.title, "Teklif Kabul Edildi", { context: "mert (kabul edilmiş teklifi)" });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.accepted.title, { context: "mert (kabul edilmiş teklifi)" });
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowOfferButtonVisible(offersCard(page), page, jobs.accepted.title, { context: "mehmet, kabul edilmiş ama başlanmamış ilanda" });
    ok("SENARYO 3: Kabul edilmiş ama işe başlanmamış teklifin sahibi (mert) 'Teklif Kabul Edildi' görür; ilan başka Hizmet Verenlere (mehmet) açık kalır");
    await page.close();
  }

  // =====================================================================
  // SENARYO 4 — İşe başlanmış ilan (jobs.inProgress, mert=in_progress):
  // "Devam Ediyor" görünür; hiçbir kullanıcı (mehmet dahil, hatta hiç
  // görmemiş sentetik bir Hizmet Veren dahil) "Teklif Ver" göremez; mehmet'in
  // artık anlamsız kalmış pending teklifi "Başka Hizmet Verenle Anlaşıldı"
  // olarak görünür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.inProgress.title, "Devam Ediyor", { context: "mert (işe başlanmış kendi teklifi)" });
    await assertRowLabel(siblingCard(page), page, jobs.inProgress.title, "Devam Ediyor", { context: "mert, Bu Operasyondaki Diğer Hizmetler" });
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.inProgress.title, "Başka Hizmet Verenle Anlaşıldı", { context: "mehmet (kardeş ilerlemesiyle kapanmış pending teklifi)" });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.inProgress.title, { context: "mehmet, işe başlanmış ilanda" });
    await assert.doesNotReject(
      rowByCategoryIn(statusCard(page), page, "Forklift").getByText("Başka Hizmet Verenle Anlaşıldı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      "mehmet: 'Operasyon Durumu' kartındaki satırda da (aynı merkezi fonksiyon) 'Başka Hizmet Verenle Anlaşıldı' görünmeli",
    );
    ok("SENARYO 4a: İşe başlanmış ilanda (jobs.inProgress) → teklif sahibi 'Devam Ediyor', kardeşi kapanmış bekleyen teklif sahibi 'Başka Hizmet Verenle Anlaşıldı' görür (Operasyon Durumu kartında da tutarlı), 'Teklif Ver' hiçbir yerde yok");
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAsSyntheticProvider(page, { id: "never-seen-" + crypto.randomUUID(), name: "Hiç Görmemiş Sağlayıcı" });
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.inProgress.title, { context: "hiç görmemiş sentetik Hizmet Veren" });
    await assertRowLabel(offersCard(page), page, jobs.inProgress.title, "Başka Hizmet Verenle Anlaşıldı", { context: "hiç görmemiş sentetik Hizmet Veren" });
    ok("SENARYO 4b: İşe başlanmış ilana hiç teklif vermemiş (ve hiç görmemiş) bir Hizmet Veren bile 'Teklif Ver' göremez, 'Başka Hizmet Verenle Anlaşıldı' görür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 5 — Tamamlama onayı bekleyen ilan: doğru durum metni ("Tamamlama
  // Onayı Bekleniyor") hem teklif sahibi Hizmet Veren'de hem ilan sahibi
  // Hizmet Alan'da (job-geneli aynı gerçek durum) görünür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.completionRequested.title, "Tamamlama Onayı Bekleniyor", { context: "mert" });
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.completionRequested.title, "Tamamlama Onayı Bekleniyor", { context: "zeynep (ilan sahibi)" });
    ok("SENARYO 5: Tamamlama onayı bekleyen ilan → hem teklif sahibi (mert) hem ilan sahibi (zeynep) 'Tamamlama Onayı Bekleniyor' görür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 6 — İtirazdaki ilan: "İtiraz Sürecinde" görünür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.disputed.title, "İtiraz Sürecinde", { context: "zeynep (ilan sahibi)" });
    await page.close();
  }
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.disputed.title, "İtiraz Sürecinde", { context: "mert" });
    ok("SENARYO 6: İtirazdaki ilan → hem ilan sahibi hem Hizmet Veren 'İtiraz Sürecinde' görür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 7 — Tamamlanan ilan: yalnızca "Tamamlandı" görünür, "Teklifiniz:
  // Tamamlandı" GÖRÜNMEZ, işlem butonu (Teklif Ver dahil) yok.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.completed.title, "Tamamlandı", { context: "mert" });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.completed.title, { context: "mert, tamamlanmış hizmette" });
    await assert.doesNotReject(
      rowByCategoryIn(statusCard(page), page, "Unlashing").getByText("Tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      "mert: 'Operasyon Durumu' kartındaki satırda da 'Tamamlandı' görünmeli",
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes("Teklifiniz: Tamamlandı"), false, "'Teklifiniz: Tamamlandı' KESİNLİKLE görünmemeli");
    ok("SENARYO 7: Tamamlanan hizmet → yalnızca 'Tamamlandı' görünür (Operasyon Durumu kartında da tutarlı), 'Teklifiniz: Tamamlandı' yok, işlem butonu yok");
    await page.close();
  }

  // =====================================================================
  // SENARYO 8 — İptal edilmiş ilan (Job.status === 'iptal'): "İptal Edildi" görünür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.jobCancelled.title, "İptal Edildi", { context: "mehmet" });
    await assertRowOfferButtonHidden(offersCard(page), page, jobs.jobCancelled.title, { context: "mehmet, iptal edilmiş ilanda" });
    ok("SENARYO 8: İptal edilmiş ilan → 'İptal Edildi' görünür, 'Teklif Ver' yok");
    await page.close();
  }

  // =====================================================================
  // SENARYO 9 (ek) — Reddedilmiş teklif: 'Teklifiniz:' ön eki OLMADAN
  // yalnızca 'Reddedildi' görünür (getOfferStatusLabel'in ham metni).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.rejected.title, "Reddedildi", { context: "mert (reddedilmiş teklifi)" });
    ok("SENARYO 9: Reddedilmiş teklif → 'Teklifiniz:' ön eki olmadan yalnızca 'Reddedildi' görünür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 10 — Hiç teklif olmayan ilanda ilan sahibi 'Teklife Açık' görür;
  // pending teklifi olan ilanda ilan sahibi 'İşe Başlama Onayı Bekleniyor' görür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.open.title, "Teklife Açık", { context: "zeynep, hiç teklifi olmayan ilanda" });
    await assertRowLabel(offersCard(page), page, jobs.pending.title, "İşe Başlama Onayı Bekleniyor", { context: "zeynep, pending teklifi olan ilanda" });
    ok("SENARYO 10: İlan sahibi → teklifsiz ilanda 'Teklife Açık', pending teklifi olan ilanda 'İşe Başlama Onayı Bekleniyor' görür");
    await page.close();
  }

  // =====================================================================
  // SENARYO 11 — Aynı operasyonda birden çok hizmet: her biri kendi
  // bağımsız durumunu gösterir, biri diğerine karışmaz (aynı sayfada aynı
  // anda tüm satırlar farklı olmalı).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertRowLabel(offersCard(page), page, jobs.accepted.title, "Teklif Kabul Edildi", { context: "mert, aynı sayfada" });
    await assertRowLabel(offersCard(page), page, jobs.inProgress.title, "Devam Ediyor", { context: "mert, aynı sayfada" });
    await assertRowLabel(offersCard(page), page, jobs.completed.title, "Tamamlandı", { context: "mert, aynı sayfada" });
    await assertRowLabel(offersCard(page), page, jobs.rejected.title, "Reddedildi", { context: "mert, aynı sayfada" });
    ok("SENARYO 11: Aynı operasyondaki farklı hizmetler (mert'in görünümünde) birbirinden bağımsız, doğru kendi durumunu gösterir");
    await page.close();
  }

  // =====================================================================
  // SENARYO 12 — Masaüstü ve mobil: kartlar taşmaz, sağ alan okunabilir kalır.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.setViewportSize({ width: 375, height: 900 });
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await siblingCard(page).waitFor({ state: "visible", timeout: 10000 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(scrollWidth <= clientWidth + 1, `Mobil görünümde yatay taşma olmamalı (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`);

    // "Bu Operasyondaki Diğer Hizmetler" kartında satırın tamamı bir <a>
    // olduğu için "Teklif Ver" statik bir <span> olarak render edilir —
    // içinde GEÇERSİZ iç içe bir <a>/<button> OLMAMALI.
    const nestedInteractiveCount = await siblingCard(page)
      .locator("li a a, li a button")
      .count();
    assert.equal(nestedInteractiveCount, 0, "'Bu Operasyondaki Diğer Hizmetler' satırlarında iç içe geçersiz interaktif eleman olmamalı");

    ok("SENARYO 12: Mobil görünümde (375px) her iki kart da taşmıyor, iç içe geçersiz interaktif eleman yok");
    await page.close();
  }

  // =====================================================================
  // SENARYO 13 (ek) — "Teklif Ver" linkinin (Operasyondaki Hizmetler) hedefi
  // doğru ilana gidiyor — mevcut teklif verme davranışı (aynı /ilanlar/[id]
  // sayfası, aynı OfferPanel) korunuyor.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobs.main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });

    const link = rowByTitleIn(offersCard(page), page, jobs.open.title).getByRole("link", { name: "Teklif Ver", exact: true });
    const href = await link.getAttribute("href");
    assert.equal(href, `/ilanlar/${jobs.open.id}`, "'Teklif Ver' linki doğru ilana (kendi /ilanlar/[id] sayfasına) gitmeli");

    await link.click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${jobs.open.id}`, { timeout: 10000 });
    await page.getByRole("heading", { name: "Teklif Ver", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByLabel("Teklif Fiyatı").count(), 1, "Hedef ilanın kendi sayfasında gerçek teklif formu (OfferPanel) render edilmeli");
    ok("SENARYO 13: 'Teklif Ver' linki doğru ilana gidiyor, orada mevcut OfferPanel (gerçek teklif formu) değişmeden çalışıyor");
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-operation-service-card-status-consolidation-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
