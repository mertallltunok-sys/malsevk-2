// node scripts/tmp-multi-service-operation-stage4-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 4 ("Operasyon Durumu" özet kartı: özet
// sayılar, ilerleme yüzdesi/çubuğu, hizmet durum listesi) doğrulama testi,
// GERÇEK render edilmiş sayfaya karşı (Playwright, gerçek Chromium).
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
        description: "Aşama 4 test teklifi",
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

/** Bir ilanın operationId'sini doğrudan localStorage'da yamalar (savunma amaçlı "grupta 1 ilan" senaryosu için). */
async function patchJobOperationId(page, jobId, operationId) {
  await page.evaluate(
    ({ jobId, operationId }) => {
      const KEY = "malsevk.jobs.v1";
      const jobs = JSON.parse(localStorage.getItem(KEY) || "[]");
      const updated = jobs.map((j) => (j.id === jobId ? { ...j, operationId } : j));
      localStorage.setItem(KEY, JSON.stringify(updated));
    },
    { jobId, operationId },
  );
}

/** İki sentetik ilanı (biri "iptal" durumunda) doğrudan localStorage'a yazar — gerçek üründe Job.status hiçbir akışta "iptal" olmadığı için (bkz. CLAUDE.md), İptal bucket'ının hesaplanmasını test etmenin tek yolu budur. */
async function injectSyntheticOperation(page, { operationId, requesterId }) {
  await page.evaluate(
    ({ operationId, requesterId }) => {
      const KEY = "malsevk.jobs.v1";
      const jobs = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = "2026-08-01";
      const common = {
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: now,
        operationDetails: "Sentetik operasyon detayı, en az on karakter.",
        requesterId,
        operationId,
        photos: [],
      };
      jobs.push(
        {
          id: crypto.randomUUID(),
          title: "Sentetik Aktif Hizmet",
          category: "forklift",
          description: "Sentetik aktif hizmet açıklaması.",
          status: "yayinda",
          ...common,
        },
        {
          id: crypto.randomUUID(),
          title: "Sentetik Iptal Hizmet",
          category: "vinc",
          description: "Sentetik iptal hizmet açıklaması.",
          status: "iptal",
          ...common,
        },
      );
      localStorage.setItem(KEY, JSON.stringify(jobs));
    },
    { operationId, requesterId },
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
    const provider = users.find((u) => u.email === "mert@test.com");
    assert.ok(provider, "hizmet-veren dev hesabı (mert@test.com) seed edilmiş olmalı");
    providerId = provider.id;
    await context.close();
  }

  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  // =====================================================================
  // GRUP A — Tek hizmetli (operationId'siz) ilanda kart HİÇ görünmez
  // =====================================================================
  let singleJobId;
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama4 Tek Hizmet Testi",
      description: "Bu ilan operationId TASIMAZ, Operasyon Durumu karti hic gorunmemeli.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Asama4 tek hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });

    singleJobId = page.url().split("/ilanlar/")[1];

    assert.equal(await page.getByRole("heading", { name: "Operasyon Durumu" }).count(), 0, "operationId'si olmayan ilanda kart HİÇ render edilmemeli");
    ok("operationId olmayan (tek hizmet) ilanda 'Operasyon Durumu' kartı görünmez");

    await assert.doesNotReject(page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Tek ilan detayında teklif sistemi (Teklif Ver) bozulmadan çalışmaya devam eder");

    await page.close();
  }

  // =====================================================================
  // GRUP B — Savunma: operationId var ama grupta yalnızca 1 ilan varsa kart görünmez
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    const orphanOperationId = "test-orphan-operation-id-should-not-leak";
    await page.goto(`${BASE_URL}/ilanlar/${singleJobId}`);
    await patchJobOperationId(page, singleJobId, orphanOperationId);
    await page.reload();

    await assert.doesNotReject(page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 }));
    ok("(bağlam) Aşama 3 kardeş kartı tek elemanlı grupta da (kendi kuralınca) görünür");

    assert.equal(await page.getByRole("heading", { name: "Operasyon Durumu" }).count(), 0, "operationId var ama grupta yalnızca 1 ilan varken 'Operasyon Durumu' kartı görünmemeli");
    ok("operationId bulunan fakat grupta yalnızca 1 ilan varsa 'Operasyon Durumu' kartı (savunma amaçlı) görünmez");

    await page.close();
  }

  // =====================================================================
  // GRUP C — Çoklu hizmetli operasyon (4 servis): özet sayılar + ilerleme + progressbar + hizmet listesi
  // =====================================================================
  let operationJobIds = {};
  let mainPage;
  {
    const page = await sharedContext.newPage();
    mainPage = page;
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama4 Ana Hizmet",
      description: "Ana hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "Asama4 Ikinci Hizmet",
      description: "Ikinci hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-02",
      endDate: "2026-08-03",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 2, {
      category: "konteyner-dolum",
      title: "Asama4 Ucuncu Hizmet",
      description: "Ucuncu hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-04",
      endDate: "2026-08-05",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 3, {
      category: "konteyner-bosaltim",
      title: "Asama4 Dorduncu Hizmet",
      description: "Dorduncu hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-06",
      endDate: "2026-08-07",
    });

    await page.getByLabel("Operasyon Detayları").fill("Asama4 coklu hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "4 Hizmet İlanını Yayınla", exact: true }).click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=4/, { timeout: 15000 });

    const after = await getStoredJobs(page);
    const created = after.filter((job) => !before.some((b) => b.id === job.id));
    assert.equal(created.length, 4);
    const byTitle = Object.fromEntries(created.map((j) => [j.title, j]));
    operationJobIds = {
      main: byTitle["Asama4 Ana Hizmet"].id,
      second: byTitle["Asama4 Ikinci Hizmet"].id,
      third: byTitle["Asama4 Ucuncu Hizmet"].id,
      fourth: byTitle["Asama4 Dorduncu Hizmet"].id,
      operationId: created[0].operationId,
    };
    ok("Çoklu hizmet oluşturma sistemi bozulmadı: 4 ilan aynı operationId ile oluştu");

    // İkinci: kabul edildi, Üçüncü: devam ediyor, Dördüncü: tamamlandı. Ana hizmet teklifsiz (aktif) kalır.
    await injectOffer(page, { jobId: operationJobIds.second, providerId, status: "accepted" });
    await injectOffer(page, { jobId: operationJobIds.third, providerId, status: "in_progress" });
    await injectOffer(page, { jobId: operationJobIds.fourth, providerId, status: "completed" });

    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    const statusHeading = page.getByRole("heading", { name: "Operasyon Durumu" });
    await statusHeading.waitFor({ state: "visible", timeout: 10000 });
    ok("Çoklu hizmet operasyonunda 'Operasyon Durumu' kartı görünür");

    await assert.doesNotReject(
      page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Aşama 3'ün kardeş ilan kartı, yeni kartla birlikte bozulmadan render edilmeye devam eder");

    const statusCard = statusHeading.locator("xpath=..");

    await assert.doesNotReject(statusCard.getByText("Operasyon İlerlemesi: %25", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(statusCard.getByText("1 / 4 hizmet tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("İlerleme yüzdesi (1/4 = %25) ve alt bilgi metni doğru gösterilir");

    const progressbar = statusCard.locator('[role="progressbar"]');
    assert.equal(await progressbar.getAttribute("aria-valuemin"), "0");
    assert.equal(await progressbar.getAttribute("aria-valuemax"), "100");
    assert.equal(await progressbar.getAttribute("aria-valuenow"), "25");
    const ariaLabel = await progressbar.getAttribute("aria-label");
    assert.ok(!ariaLabel.includes(operationJobIds.operationId), "progressbar aria-label operationId içermemeli");
    ok("Progress bar gerçek bir <div role='progressbar'> ile doğru aria-valuenow/min/max taşır, operationId sızdırmaz");

    // Gerçek dolgu genişliği (sahte metin çubuğu değil).
    const fillWidthStyle = await progressbar.locator("> div").first().getAttribute("style");
    assert.ok(fillWidthStyle.includes("width: 25%") || fillWidthStyle.includes("width:25%"), `Dolgu genişliği %25 olmalı, gelen: ${fillWidthStyle}`);
    ok("Progress bar gerçek CSS genişliği ile doluyor (metin karakterlerinden sahte çubuk değil)");

    // Özet sayıları.
    const summaryText = await statusCard.locator("dl").innerText();
    assert.ok(/Toplam Hizmet[\s\S]*4/.test(summaryText));
    assert.ok(/Aktif[\s\S]*1/.test(summaryText));
    assert.ok(/Teklif Kabul Edildi[\s\S]*1/.test(summaryText));
    assert.ok(/Devam Ediyor[\s\S]*1/.test(summaryText));
    assert.ok(/Tamamlandı[\s\S]*1/.test(summaryText));
    assert.ok(/İptal[\s\S]*0/.test(summaryText));
    ok("Özet sayıları doğru: Toplam Hizmet 4, Aktif 1, Teklif Kabul Edildi 1, Devam Ediyor 1, Tamamlandı 1, İptal 0");

    // Hizmet durum listesi: sıra korunur, başlık/ilçe/tarih TEKRAR edilmez, yalnızca hizmet adı + rozet + (Bu ilan).
    const rowsList = statusCard.locator("ul[role='list'] li");
    const rowTexts = await rowsList.allTextContents();
    assert.equal(rowTexts.length, 4);
    assert.ok(rowTexts[0].includes("Lashing") && rowTexts[0].includes("(Bu ilan)") && rowTexts[0].includes("Aktif"));
    assert.ok(rowTexts[1].includes("Unlashing") && rowTexts[1].includes("Teklif Kabul Edildi"));
    assert.ok(rowTexts[2].includes("Konteyner Dolum") && rowTexts[2].includes("Devam Ediyor"));
    assert.ok(rowTexts[3].includes("Konteyner Boşaltım") && rowTexts[3].includes("Tamamlandı"));
    assert.ok(!rowTexts[0].includes("Dilovası") && !rowTexts[0].includes("Ağustos"), "Hizmet durum listesi ilçe/tarih tekrar etmemeli");
    ok("Hizmet durum listesi: sıra korunur, yalnızca hizmet adı + durum rozeti + '(Bu ilan)' gösterilir (ilçe/tarih tekrar edilmez)");

    const currentStatusRow = rowsList.first();
    assert.equal(await currentStatusRow.locator("a").count(), 0, "Mevcut ilan satırı bu kartta da tıklanabilir (Link) olmamalı");
    ok("Mevcut ilan satırı bu kartta da tıklanabilir değildir");

    // operationId/UUID sayfa kaynağında hiç geçmez.
    const html = await page.content();
    assert.equal(html.includes(operationJobIds.operationId), false, "operationId sayfa HTML kaynağında görünmemeli");
    ok("operationId/UUID görünür HTML'de veya erişilebilir adlarda bulunmaz");
  }

  // =====================================================================
  // GRUP D — Canlı güncelleme: SAYFA YENİLENMEDEN özet otomatik güncellenir
  // (gerçek çapraz-sekme localStorage "storage" event mekanizması üzerinden —
  // job-store.ts/offers.ts'in ZATEN sahip olduğu subscribeToJobs/Offers
  // aboneliği, yeni bir event sistemi eklenmedi.)
  // =====================================================================
  {
    const statusHeading = mainPage.getByRole("heading", { name: "Operasyon Durumu" });
    const statusCard = statusHeading.locator("xpath=..");

    // İKİNCİ bir sekmede (aynı paylaşılan context/localStorage) ana hizmete
    // "completed" bir teklif enjekte ediyoruz — bu, mainPage'den FARKLI bir
    // browsing context olduğu için gerçek "storage" event'i mainPage'de
    // tetiklenir (aynı sekmede localStorage.setItem çağırmak bunu tetiklemez).
    const secondaryPage = await sharedContext.newPage();
    // localStorage yalnızca gerçek bir origin'de erişilebilir — taze bir
    // sekme varsayılan olarak about:blank'te açılır (opak origin, erişim
    // reddedilir), bu yüzden önce uygulamanın origin'ine gidiyoruz.
    await secondaryPage.goto(`${BASE_URL}/ilanlar`);
    await injectOffer(secondaryPage, { jobId: operationJobIds.main, providerId, status: "completed" });
    await secondaryPage.close();

    await assert.doesNotReject(
      statusCard.getByText("Operasyon İlerlemesi: %50", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
    );
    await assert.doesNotReject(
      statusCard.getByText("2 / 4 hizmet tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    const progressbar = statusCard.locator('[role="progressbar"]');
    await assert.doesNotReject(
      (async () => {
        await progressbar.evaluate(
          (el) =>
            new Promise((resolve, reject) => {
              const start = Date.now();
              const check = () => {
                if (el.getAttribute("aria-valuenow") === "50") return resolve(undefined);
                if (Date.now() - start > 8000) return reject(new Error("aria-valuenow 50 olmadı"));
                requestAnimationFrame(check);
              };
              check();
            }),
        );
      })(),
    );
    ok("Kardeş ilanlardan birinin durumu değişince (başka bir sekmeden) özet sayıları/ilerleme/progressbar SAYFA YENİLENMEDEN otomatik güncellenir");

    await mainPage.close();
  }

  // =====================================================================
  // GRUP E — İptal bucket'ı: gerçek üründe Job.status hiçbir akışta "iptal"
  // olmadığından (bkz. CLAUDE.md), sentetik bir 2-ilanlı operasyonla test edilir.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    const users = await getStoredUsers(page);
    const requesterId = users.find((u) => u.email === "zeynep@test.com").id;
    const syntheticOperationId = "test-synthetic-cancel-operation";

    await page.goto(`${BASE_URL}/panel`);
    await injectSyntheticOperation(page, { operationId: syntheticOperationId, requesterId });
    const jobs = await getStoredJobs(page);
    const syntheticJobs = jobs.filter((j) => j.operationId === syntheticOperationId);
    assert.equal(syntheticJobs.length, 2);
    const activeJob = syntheticJobs.find((j) => j.status === "yayinda");

    await page.goto(`${BASE_URL}/ilanlar/${activeJob.id}`);
    const statusHeading = page.getByRole("heading", { name: "Operasyon Durumu" });
    await statusHeading.waitFor({ state: "visible", timeout: 10000 });
    const statusCard = statusHeading.locator("xpath=..");

    await assert.doesNotReject(statusCard.getByText("Operasyon İlerlemesi: %0", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(statusCard.getByText("0 / 2 hizmet tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    const progressbar = statusCard.locator('[role="progressbar"]');
    assert.equal(await progressbar.getAttribute("aria-valuenow"), "0");
    ok("İptal edilen ilan tamamlanmış SAYILMAZ: %0 ilerleme (2 ilanın hiçbiri tamamlanmadı, biri iptal)");

    const summaryText = await statusCard.locator("dl").innerText();
    assert.ok(/İptal[\s\S]*1/.test(summaryText));
    assert.ok(/Tamamlandı[\s\S]*0/.test(summaryText));
    ok("İptal sayısı doğru hesaplanır (1) ve Tamamlandı sayısına dahil edilmez");

    await page.close();
  }

  // =====================================================================
  // GRUP F — Mobil görünümde yatay taşma yok
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.setViewportSize({ width: 375, height: 900 });
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    await page.getByRole("heading", { name: "Operasyon Durumu" }).waitFor({ state: "visible", timeout: 10000 });

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) 'Operasyon Durumu' kartı yatay taşma OLUŞTURMAMALI");
    ok("Mobil görünümde (375px) 'Operasyon Durumu' kartı yatay taşma oluşturmaz");

    await page.close();
  }

  // =====================================================================
  // GRUP G — Teklif ve bildirim sistemleri bozulmadı
  // =====================================================================
  {
    const providerPage = await sharedContext.newPage();
    const consoleErrors = [];
    providerPage.on("pageerror", (err) => consoleErrors.push(String(err)));
    await loginAs(providerPage, "mert@test.com", "Mert123!", "/ilanlar");
    // Operasyonun 4 ilanına da (main dahil, Grup D'de) zaten bu providerId'den
    // teklif enjekte edildi — createOffer aynı sağlayıcının aynı ilana
    // "completed"/"accepted"/"in_progress" sonrası KALICI olarak yeniden
    // teklif vermesini engeller (offers.ts#createOffer). Bu yüzden gerçek
    // teklif gönderme regresyonu, hiç dokunulmamış tek-hizmet ilanı
    // (singleJobId, Grup A) üzerinden test edilir.
    await providerPage.goto(`${BASE_URL}/ilanlar/${singleJobId}`);
    await providerPage.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 10000 });

    const beforeOffersCount = (
      await providerPage.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"))
    ).length;
    await providerPage.getByLabel("Teklif Fiyatı").fill("2500");
    await providerPage.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
    await providerPage.getByLabel("Teklif Açıklaması").fill("Aşama 4 regresyon testi: teklif sistemi bozulmadı mı kontrolü.");
    await providerPage.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
    await providerPage.waitForFunction(
      (before) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").length > before,
      beforeOffersCount,
      { timeout: 10000 },
    );
    ok("Teklif verme sistemi bozulmadı: Hizmet Veren gerçek bir teklif gönderebiliyor");

    await loginAs(providerPage, "zeynep@test.com", "Zeynep1!", "/panel/bildirimler");
    await providerPage.waitForLoadState("networkidle");
    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
    ok("Bildirimler sayfası (Hizmet Alan) hatasız yükleniyor: bildirim sistemi bozulmadı");

    await providerPage.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage4-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
