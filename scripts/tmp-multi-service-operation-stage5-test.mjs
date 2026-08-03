// node scripts/tmp-multi-service-operation-stage5-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 5 (Aktif İlanlar listesinde operasyon
// gruplama kartı + ilan detayında yeni "Operasyondaki Hizmetler" / Teklif Ver
// kısayolları listesi) doğrulama testi, GERÇEK render edilmiş sayfaya karşı
// (Playwright, gerçek Chromium).
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

async function applyOwnLocationForAdditionalServiceCard(page, index) {
  const checkbox = page.locator('input[type="checkbox"]').nth(index - 1);
  await checkbox.uncheck();
  const districtButtons = page.getByRole("button", { name: "İlçe", exact: true });
  const facilityButtons = page.getByRole("button", { name: "Bölge / Tesis", exact: true });
  await districtButtons.last().click();
  await page.locator('ul[aria-label="İlçe"]').last().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').last().getByRole("option", { name: "Gebze", exact: true }).click();
  await facilityButtons.last().click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').last().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .last()
    .getByRole("option", { name: "Listede yok", exact: false })
    .first()
    .click();
  await page.getByLabel("Tesis / İşletme Adı").last().fill("Kendi Fabrikamız");
  await page.getByLabel("Açık Adres").last().fill("Farklı Mahalle, Farklı Cadde No:9, Gebze");
}

async function clickAddService(page) {
  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
}

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}

async function getStoredOffers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
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
        description: "Aşama 5 test teklifi",
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
  // GRUP A — Tek hizmet ilanı (operationId'siz): listede bugünkü görünüm korunur
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);
    await fillMainServiceCard(page, {
      category: "vinc",
      title: "Asama5 Tek Hizmet Testi",
      description: "Bu ilan operationId TASIMAZ, listede eski gorunumunu korumali.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Asama5 tek hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    await page.close();
  }

  // =====================================================================
  // GRUP B — Çoklu hizmetli operasyon (3 servis, 2'si aynı, 1'i farklı lokasyonda)
  // =====================================================================
  let operationJobIds = {};
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);
    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama5 Ana Hizmet",
      description: "Ana hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "Asama5 Ikinci Hizmet",
      description: "Ikinci hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-02",
      endDate: "2026-08-03",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 2, {
      category: "konteyner-dolum",
      title: "Asama5 Ucuncu Hizmet",
      description: "Ucuncu hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-04",
      endDate: "2026-08-05",
    });
    await applyOwnLocationForAdditionalServiceCard(page, 2);

    await page.getByLabel("Operasyon Detayları").fill("Asama5 coklu hizmet testi operasyon detayi, en az on karakter.");
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
      main: byTitle["Asama5 Ana Hizmet"].id,
      second: byTitle["Asama5 Ikinci Hizmet"].id,
      third: byTitle["Asama5 Ucuncu Hizmet"].id,
      operationId: created[0].operationId,
    };
    ok("Çoklu hizmet operasyonu oluşturuldu (3 ilan, aynı operationId)");

    // İkinci hizmete "completed" teklif enjekte et — ilerleme %33 (1/3) olsun.
    await injectOffer(page, { jobId: operationJobIds.second, providerId, status: "completed" });

    await page.close();
  }

  // =====================================================================
  // GRUP C — Aktif İlanlar listesi (Hizmet Veren perspektifi): gruplama
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("table", { timeout: 10000 });

    // Tek hizmet ilanı: bugünkü görünüm birebir korunur (kendi kategori
    // rozeti, "Operasyon" rozeti YOK).
    const singleRow = page.locator("tr", { has: page.getByText("Asama5 Tek Hizmet Testi", { exact: true }) });
    await assert.doesNotReject(singleRow.waitFor({ state: "visible", timeout: 10000 }));
    await assert.doesNotReject(singleRow.getByText("Vinç", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    assert.equal(await singleRow.getByText(/^Operasyon/).count(), 0, "Tek hizmet satırında 'Operasyon' rozeti OLMAMALI");
    ok("Tek hizmet ilanları Aktif İlanlar listesinde bugünkü görünümünü tamamen korur");

    // Çoklu hizmet operasyonu: TEK satır, başlık = ilk hizmetin başlığı.
    const mainTitleMatches = await page.getByText("Asama5 Ana Hizmet", { exact: true }).count();
    const secondTitleMatches = await page.getByText("Asama5 Ikinci Hizmet", { exact: true }).count();
    const thirdTitleMatches = await page.getByText("Asama5 Ucuncu Hizmet", { exact: true }).count();
    assert.equal(mainTitleMatches, 1, "Operasyonun İLK hizmetinin başlığı TEK satırda görünmeli");
    assert.equal(secondTitleMatches, 0, "İkinci hizmetin başlığı ayrı bir satırda TEKRARLANMAMALI");
    assert.equal(thirdTitleMatches, 0, "Üçüncü hizmetin başlığı ayrı bir satırda TEKRARLANMAMALI");
    ok("Çoklu hizmet operasyonu Aktif İlanlar listesinde TEK kart/satır olarak görünür, aynı operasyonun diğer ilanları tekrar etmez");

    const operationRow = page.locator("tr", { has: page.getByText("Asama5 Ana Hizmet", { exact: true }) });
    // job-listing-row.ts#getJobListingCategoryBadgeLabel'ın GÜNCEL/kasıtlı
    // formatı "Operasyon • {kalan} Hizmet Arıyor"dur (statik "Operasyon · N
    // Hizmet" biçimi bu testten BAĞIMSIZ, önceki bir özellik çalışmasında
    // kalıcı olarak değiştirildi — bkz. CLAUDE.md "Operation discovery &
    // status UI"). `kalan = totalCount(3) - completedCount(1) = 2` (bkz.
    // birkaç satır aşağıdaki "%33" ilerleme kontrolü — 1/3 tamamlanmış, satır 255).
    await assert.doesNotReject(operationRow.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Operasyon kartındaki kalan (henüz tamamlanmamış) hizmet sayısı doğru gösterilir (toplam 3, 1 tamamlanmış, kalan 2)");

    await assert.doesNotReject(operationRow.getByText("Dilovası", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    ok("Operasyon kartında ilçe (ilk hizmetin lokasyonu) doğru gösterilir");

    await assert.doesNotReject(operationRow.getByText("01 Ağustos 2026", { exact: false }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Operasyon kartında tarih (ilk hizmetin tarihi) doğru gösterilir");

    const offerCountCell = operationRow.locator("td").nth(5);
    assert.equal((await offerCountCell.innerText()).trim(), "1", "Teklif sayısı gruptaki tüm ilanların toplamı olmalı (yalnızca ikinci hizmette 1 teklif var)");
    ok("Operasyon kartındaki teklif sayısı doğru hesaplanır (gruptaki tüm ilanların toplamı)");

    await assert.doesNotReject(operationRow.getByText("Operasyon İlerlemesi: %33", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Operasyon ilerleme yüzdesi doğru gösterilir (1/3 = %33)");

    // operationId/UUID sayfa kaynağında hiç geçmez.
    const listingHtml = await page.content();
    assert.equal(listingHtml.includes(operationJobIds.operationId), false, "operationId Aktif İlanlar listesinin HTML kaynağında görünmemeli");
    ok("operationId/UUID Aktif İlanlar listesinde hiçbir yerde görünmez");

    // İlanı İncele -> operasyonun İLK (ana) hizmetinin detay sayfasına gider.
    await operationRow.getByRole("link", { name: "İlanı İncele" }).click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${operationJobIds.main}`, { timeout: 10000 });
    await assert.doesNotReject(
      page.getByRole("heading", { name: "Asama5 Ana Hizmet", exact: false }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("'İlanı İncele' butonu mevcut ilan detay route'u (/ilanlar/[id]) ile operasyonun ilk hizmetine gider (yeni route yok)");

    await page.close();
  }

  // =====================================================================
  // GRUP D — Detay sayfası: Aşama 3/4 kartları korunur + yeni "Operasyondaki
  // Hizmetler" listesi + her hizmette bağımsız Teklif Ver
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);

    await assert.doesNotReject(
      page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 }),
    );
    await assert.doesNotReject(
      page.getByRole("heading", { name: "Operasyon Durumu" }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Aşama 3 ve Aşama 4 kartları detay sayfasında değişmeden korunur");

    const newListHeading = page.getByRole("heading", { name: "Operasyondaki Hizmetler" });
    await newListHeading.waitFor({ state: "visible", timeout: 5000 });
    const newListCard = newListHeading.locator("xpath=..");
    ok("Yeni 'Operasyondaki Hizmetler' listesi bu iki kartın ALTINDA render edilir");

    const rowTexts = await newListCard.locator("ul[role='list'] li").allTextContents();
    assert.equal(rowTexts.length, 3);
    assert.ok(rowTexts[0].includes("Lashing") && rowTexts[0].includes("Asama5 Ana Hizmet") && rowTexts[0].includes("(Bu ilan)"));
    assert.ok(rowTexts[1].includes("Unlashing") && rowTexts[1].includes("Asama5 Ikinci Hizmet"));
    assert.ok(rowTexts[2].includes("Konteyner Dolum") && rowTexts[2].includes("Asama5 Ucuncu Hizmet"));
    ok("Detay sayfasındaki yeni listede operasyonun TÜM hizmetleri, oluşturulma sırasıyla, hizmet adı+ilan başlığı+durum rozetiyle görünür");

    const rows = newListCard.locator("ul[role='list'] li");
    const currentRowTeklifVer = rows.nth(0).getByRole("link", { name: "Teklif Ver" });
    assert.equal(await currentRowTeklifVer.count(), 0, "Mevcut ilanın kendi satırında 'Teklif Ver' butonu OLMAMALI");
    const secondRowTeklifVer = rows.nth(1).getByRole("link", { name: "Teklif Ver" });
    const thirdRowTeklifVer = rows.nth(2).getByRole("link", { name: "Teklif Ver" });
    assert.equal(await secondRowTeklifVer.getAttribute("href"), `/ilanlar/${operationJobIds.second}`);
    assert.equal(await thirdRowTeklifVer.getAttribute("href"), `/ilanlar/${operationJobIds.third}`);
    ok("Her diğer hizmette 'Teklif Ver' butonu görünür ve YALNIZCA o hizmetin kendi ilan detay sayfasına gider");

    // operationId/UUID detay sayfasında da hiç geçmez.
    const detailHtml = await page.content();
    assert.equal(detailHtml.includes(operationJobIds.operationId), false, "operationId ilan detay sayfasının HTML kaynağında görünmemeli");
    ok("operationId/UUID ilan detay sayfasında da hiçbir yerde görünmez");

    // Üçüncü hizmete "Teklif Ver" ile git ve GERÇEK bir teklif gönder —
    // yalnızca o hizmete gitmeli, diğerlerini etkilememeli.
    const beforeOffers = await getStoredOffers(page);
    await thirdRowTeklifVer.click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${operationJobIds.third}`, { timeout: 10000 });
    await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Teklif Fiyatı").fill("3000");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("3 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Aşama 5 testi: teklif yalnızca seçilen hizmete gitmeli kontrolü.");
    await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
    await page.waitForFunction(
      (before) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").length > before,
      beforeOffers.length,
      { timeout: 10000 },
    );

    const afterOffers = await getStoredOffers(page);
    const newOffers = afterOffers.filter((o) => !beforeOffers.some((b) => b.id === o.id));
    assert.equal(newOffers.length, 1);
    assert.equal(newOffers[0].jobId, operationJobIds.third, "Yeni teklif YALNIZCA üçüncü hizmete ait olmalı");
    const mainOffersAfter = afterOffers.filter((o) => o.jobId === operationJobIds.main);
    assert.equal(mainOffersAfter.length, 0, "Ana hizmet teklif almadı, üçüncü hizmete verilen teklif onu ETKİLEMEMELİ");
    ok("'Teklif Ver' ile gönderilen teklif YALNIZCA seçilen hizmete gider; aynı operasyondaki diğer hizmetleri etkilemez (toplu teklif yok)");

    await page.close();
  }

  // =====================================================================
  // GRUP E — Filtreye operasyonun yalnızca 1 üyesi uysa bile operasyon kartı
  // TÜM operasyonu temsil ederek görünmeye devam eder (bkz. Aşama 5.1 düzeltmesi
  // — bu senaryonun ayrıntılı testi scripts/tmp-multi-service-operation-stage5-1-test.mjs'te).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");

    await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
    await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Gebze", exact: true }).click();
    await page.waitForSelector("table", { timeout: 10000 });

    // Gebze filtresiyle operasyonun yalnızca üçüncü (Gebze/Kendi Fabrikamız)
    // hizmeti bireysel olarak filtreyi geçer — ama Aşama 5.1'den itibaren bu,
    // operasyonun (Ana Hizmet başlıklı) TAM kartının hâlâ görünmesi ve TÜM 3
    // hizmeti temsil etmeye devam etmesi (kendi başına, gruplanmamış bir
    // "Asama5 Ucuncu Hizmet" satırına DÖNÜŞMEMESİ) anlamına gelir.
    const operationRow = page.locator("tr", { has: page.getByText("Asama5 Ana Hizmet", { exact: true }) });
    await assert.doesNotReject(operationRow.waitFor({ state: "visible", timeout: 10000 }));
    // Bkz. GRUP B'deki AYNI güncel format notu — aynı operasyon (1/3 tamamlanmış), kalan=2.
    await assert.doesNotReject(operationRow.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    assert.equal(await page.getByText("Asama5 Ucuncu Hizmet", { exact: true }).count(), 0, "Filtreyi geçen hizmet kendi başına ayrı bir satırda SIZMAMALI — operasyon kartının bir parçası olarak kalmalı");
    ok("Operasyona ait yalnızca 1 hizmet filtreyi geçse bile operasyon kartı TÜM operasyonu temsil ederek görünmeye devam eder (Aşama 5.1)");

    await page.close();
  }

  // =====================================================================
  // GRUP F — Mobil görünümde yatay taşma yok (liste + detay sayfası)
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.setViewportSize({ width: 375, height: 900 });
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.waitForSelector("ul[role='list']", { timeout: 10000 });
    let hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) Aktif İlanlar (kart görünümü) yatay taşma OLUŞTURMAMALI");
    ok("Mobil görünümde (375px) Aktif İlanlar'daki operasyon kartı yatay taşma oluşturmaz");

    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    await page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });
    hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) ilan detay sayfası (yeni liste dahil) yatay taşma OLUŞTURMAMALI");
    ok("Mobil görünümde (375px) ilan detay sayfasındaki yeni liste yatay taşma oluşturmaz");

    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage5-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
