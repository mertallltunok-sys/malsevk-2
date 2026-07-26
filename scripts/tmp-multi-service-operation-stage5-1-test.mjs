// node scripts/tmp-multi-service-operation-stage5-1-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 5.1 (Aşama 5'teki bir hatanın düzeltmesi):
// Aktif İlanlar listesinde bir operasyonun filtreyle yalnızca 1 hizmeti
// eşleştiğinde bile operasyon kartının TÜM operasyonu (doğru toplam/ilerleme/
// teklif sayısıyla) temsil etmeye devam ettiğini doğrular — GERÇEK render
// edilmiş sayfaya karşı (Playwright, gerçek Chromium).
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

async function gotoCreateForm(page) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

function categorySelect(page, index) {
  return page.getByLabel("Hizmet Kategorisi").nth(index);
}
function startDateInput(page, index) {
  return page.getByLabel("Başlangıç Tarihi").nth(index);
}
function endDateInput(page, index) {
  return page.getByLabel("Bitiş Tarihi").nth(index);
}
function titleInput(page, index) {
  return page.getByLabel("İlan Başlığı").nth(index);
}
function descriptionInput(page, index) {
  return page.getByLabel("Hizmete Özel Açıklama").nth(index);
}
function addressInput(page, index) {
  return page.getByLabel("Açık Adres").nth(index);
}

async function fillMainServiceCard(page, { category, title, description, startDate, endDate }) {
  await categorySelect(page, 0).selectOption(category);
  await titleInput(page, 0).fill(title);
  await descriptionInput(page, 0).fill(description);
  await startDateInput(page, 0).fill(startDate);
  await endDateInput(page, 0).fill(endDate);
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).first().click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').first().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .first()
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await addressInput(page, 0).fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
}

async function fillAdditionalServiceCardWithMainLocation(page, index, { category, title, description, startDate, endDate }) {
  await categorySelect(page, index).selectOption(category);
  await titleInput(page, index).fill(title);
  await descriptionInput(page, index).fill(description);
  await startDateInput(page, index).fill(startDate);
  await endDateInput(page, index).fill(endDate);
}

async function clickAddService(page) {
  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
}

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}

async function getStoredUsers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
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
        description: "Aşama 5.1 test teklifi",
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

/** Filtre çubuğunun "Hizmet Türü" SearchableSelect'inden bir kategori seçer. */
async function selectCategoryFilter(page, categoryLabel) {
  await page.getByRole("button", { name: "Hizmet Türü", exact: true }).click();
  await page.locator('ul[aria-label="Hizmet Türü"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Hizmet Türü"]').getByRole("option", { name: categoryLabel, exact: true }).click();
}

let browser;

async function main() {
  browser = await chromium.launch();

  let providerId;
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, "mert@test.com", "Mert123!");
    const users = await getStoredUsers(page);
    providerId = users.find((u) => u.email === "mert@test.com").id;
    await context.close();
  }

  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  // =====================================================================
  // GRUP A — Hazırlık: 3 hizmetli operasyon + tek hizmetli bir ilan
  // =====================================================================
  let operationJobIds = {};
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);
    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama51 Lashing",
      description: "Lashing hizmetine ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "yukleme-gozetimi",
      title: "Asama51 Gozetim",
      description: "Gozetim hizmetine ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-02",
      endDate: "2026-08-03",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 2, {
      category: "proje-yuku-depolama",
      title: "Asama51 Proje Yuku",
      description: "Proje yuku hizmetine ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-04",
      endDate: "2026-08-05",
    });

    await page.getByLabel("Operasyon Detayları").fill("Asama51 test operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "3 Hizmet İlanını Yayınla", exact: true }).click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=3/, { timeout: 15000 });

    const after = await getStoredJobs(page);
    const created = after.filter((job) => !before.some((b) => b.id === job.id));
    assert.equal(created.length, 3);
    const byTitle = Object.fromEntries(created.map((j) => [j.title, j]));
    operationJobIds = {
      lashing: byTitle["Asama51 Lashing"].id,
      gozetim: byTitle["Asama51 Gozetim"].id,
      projeYuku: byTitle["Asama51 Proje Yuku"].id,
      operationId: created[0].operationId,
    };

    // Gözetim: "completed" (ilerleme 1/3 = %33 olsun); Proje Yükü: "pending"
    // (teklif sayısı toplamının, filtreyi geçmeyen hizmetlerden de doğru
    // toplanabildiğini görmek için).
    await injectOffer(page, { jobId: operationJobIds.gozetim, providerId, status: "completed" });
    await injectOffer(page, { jobId: operationJobIds.projeYuku, providerId, status: "pending" });

    // Bağımsız, tek hizmetli bir ilan — filtreden eskisi gibi etkilenmeli.
    await gotoCreateForm(page);
    await fillMainServiceCard(page, {
      category: "forklift",
      title: "Asama51 Tek Hizmet Forklift",
      description: "Bu ilan operationId TASIMAZ, filtreden eskisi gibi etkilenmeli.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Asama51 tek hizmet operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });

    ok("Hazırlık: 3 hizmetli operasyon (Lashing/Gözetim/Proje Yükü, 2 teklif) + bağımsız tek hizmetli ilan oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // GRUP B — Filtreye yalnızca 1 hizmet uyduğunda operasyon kartı TAM haliyle görünür
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("table", { timeout: 10000 });

    await selectCategoryFilter(page, "Lashing");
    await page.waitForSelector("table", { timeout: 10000 });

    // Yalnızca "Asama51 Lashing" filtreyi geçiyor — ama operasyon kartı yine
    // de TÜM operasyonu temsil etmeli, kardeşleri (Gözetim/Proje Yükü) ayrı
    // birer satır olarak SIZMAMALI.
    assert.equal(await page.getByText("Asama51 Lashing", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Asama51 Gozetim", { exact: true }).count(), 0, "Filtreye uymayan kardeş kendi başına ayrı bir satırda SIZMAMALI");
    assert.equal(await page.getByText("Asama51 Proje Yuku", { exact: true }).count(), 0, "Filtreye uymayan kardeş kendi başına ayrı bir satırda SIZMAMALI");
    ok("Operasyonun yalnızca 1 hizmeti (Lashing) filtreyi geçtiğinde bile operasyon kartı görünür, kardeşleri ayrı satır olarak sızmaz");

    const operationRow = page.locator("tr", { has: page.getByText("Asama51 Lashing", { exact: true }) });
    await assert.doesNotReject(operationRow.getByText("Operasyon · 3 Hizmet", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Kart 'Operasyon · 3 Hizmet' gösterir (filtreyi geçen 1 değil, operasyonun GERÇEK toplamı)");

    await assert.doesNotReject(operationRow.getByText("Operasyon İlerlemesi: %33", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("İlerleme yüzdesi operasyonun TÜM 3 hizmeti üzerinden hesaplanır (1 tamamlanan / 3 toplam = %33), filtreyi geçen 1 hizmet üzerinden değil");

    const offerCountCell = operationRow.locator("td").nth(5);
    assert.equal((await offerCountCell.innerText()).trim(), "2", "Teklif sayısı operasyonun TÜM görünür tekliflerinin toplamı olmalı (Gözetim: 1 + Proje Yükü: 1 = 2), yalnızca filtreyi geçen Lashing'in (0 teklif) değil");
    ok("Teklif sayısı, operasyonun TÜM hizmetlerinin görünür tekliflerinin toplamıdır (filtreyi geçmeyen hizmetlerin teklifleri de dahil)");

    // İlanı İncele -> operasyonun ilk hizmetinin detay sayfası; orada Aşama 3
    // kartı hâlâ operasyonun TÜM 3 hizmetini gösterir (listedeki filtreden bağımsız).
    await operationRow.getByRole("link", { name: "İlanı İncele" }).click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${operationJobIds.lashing}`, { timeout: 10000 });
    await assert.doesNotReject(
      page.getByText("Bu operasyon kapsamında toplam 3 hizmet ilanı bulunmaktadır.", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
    );
    await assert.doesNotReject(page.getByText("Asama51 Gozetim", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(page.getByText("Asama51 Proje Yuku", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    ok("Detay sayfasında operasyonun BÜTÜN hizmetleri görünür (listedeki filtreden tamamen bağımsız)");

    await page.close();
  }

  // =====================================================================
  // GRUP C — Operasyonun HİÇBİR hizmeti filtreyi geçmiyorsa operasyon HİÇ görünmez
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("table", { timeout: 10000 });

    // "Manlift" operasyonun (Lashing/Yükleme Gözetimi/Proje Yükü Depolama)
    // hiçbir hizmetiyle eşleşmiyor VE hiçbir seed/test ilanıyla da eşleşmiyor
    // (bu filtreyle sonuç kümesi tamamen boşalır, tablo hiç render edilmez —
    // bkz. provider-job-listing.tsx'in "Filtre kriterlerinize uyan ilan
    // bulunamadı." boş durumu).
    await selectCategoryFilter(page, "Manlift");
    await page.getByText("Filtre kriterlerinize uyan ilan bulunamadı.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

    assert.equal(await page.getByText("Asama51", { exact: false }).count(), 0, "Operasyonun HİÇBİR hizmeti filtreyi geçmiyorsa operasyon (grup ya da kalıntı satır olarak) HİÇ görünmemeli");
    ok("Operasyonun hiçbir hizmeti filtreyi geçmediğinde operasyon listede hiç görünmez");

    await page.close();
  }

  // =====================================================================
  // GRUP D — Tek hizmetli ilan filtreden eskisi gibi (değişmeden) etkilenir
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("table", { timeout: 10000 });

    await selectCategoryFilter(page, "Forklift");
    await page.waitForSelector("table", { timeout: 10000 });
    assert.equal(await page.getByText("Asama51 Tek Hizmet Forklift", { exact: true }).count(), 1);
    ok("Tek hizmetli ilan, kendi kategorisiyle eşleşen filtrede eskisi gibi görünür");

    await selectCategoryFilter(page, "Lashing");
    await page.waitForSelector("table", { timeout: 10000 });
    assert.equal(await page.getByText("Asama51 Tek Hizmet Forklift", { exact: true }).count(), 0);
    ok("Tek hizmetli ilan, kendi kategorisiyle eşleşmeyen filtrede eskisi gibi görünmez");

    await page.close();
  }

  // =====================================================================
  // GRUP E — Mobil görünümde taşma yok (filtrelenmiş operasyon kartı)
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.setViewportSize({ width: 375, height: 900 });
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("ul[role='list']", { timeout: 10000 });

    await selectCategoryFilter(page, "Lashing");
    await assert.doesNotReject(page.getByText("Operasyon · 3 Hizmet", { exact: true }).waitFor({ state: "visible", timeout: 10000 }));

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) filtrelenmiş operasyon kartı yatay taşma OLUŞTURMAMALI");
    ok("Mobil görünümde (375px) filtreyle tek hizmeti eşleşen operasyon kartı yatay taşma oluşturmaz");

    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage5-1-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
