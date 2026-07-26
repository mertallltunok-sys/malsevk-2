// node scripts/tmp-multi-service-operation-stage3-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 3 (İlan detayında "Bu Operasyondaki Diğer
// Hizmetler" kartı) doğrulama testi, GERÇEK render edilmiş sayfaya karşı
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
        description: "Aşama 3 test teklifi",
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

  // =====================================================================
  // Ortak hazırlık: hizmet-veren hesabını bir kez oturum açtırıp gerçek id'sini
  // localStorage'dan okuyoruz (DEV_ACCOUNTS id'leri crypto.randomUUID() ile
  // üretilir, sabit değildir).
  // =====================================================================
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

  // =====================================================================
  // GRUP A — Tek hizmetli (operationId'siz) ilanda bölüm HİÇ görünmez
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama 3 Tek Hizmet Testi",
      description: "Bu ilan operationId TASIMAZ, bolum hic gorunmemeli.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Asama 3 tek hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });

    const heading = page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" });
    assert.equal(await heading.count(), 0, "operationId'si olmayan bir ilanda bölüm HİÇ render edilmemeli");
    ok("operationId olmayan ilanda 'Bu Operasyondaki Diğer Hizmetler' bölümü görünmez (tek hizmet sistemi bozulmadı)");

    // Teklif sistemi bozulmadı: "Teklif Ver" bölümü hâlâ orada.
    await assert.doesNotReject(page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Tek ilan detayında 'Teklif Ver' bölümü (teklif sistemi) değişmeden çalışmaya devam eder");

    await context.close();
  }

  // =====================================================================
  // GRUP B, C, D, E — TEK bir paylaşılan context/localStorage üzerinden
  // devam eder (Playwright context'leri birbirinden izole localStorage'a
  // sahiptir; Grup B'de oluşturulan ilanların sonraki gruplarda da
  // görünebilmesi için aynı context boyunca farklı kullanıcılarla
  // (loginAs ile) oturum değiştirilir, context yalnızca en sonda kapatılır).
  // =====================================================================
  let operationJobIds = {};
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  // ---- GRUP B ----
  {
    const context = sharedContext;
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Asama 3 Ana Hizmet",
      description: "Ana hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-15",
    });

    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "Asama 3 Ikinci Hizmet",
      description: "Ikinci hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });

    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 2, {
      category: "konteyner-dolum",
      title: "Asama 3 Ucuncu Hizmet",
      description: "Ucuncu hizmete ozel aciklama, en az yirmi karakter icerir.",
      startDate: "2026-08-05",
      endDate: "2026-08-06",
    });
    await applyOwnLocationForAdditionalServiceCard(page, 2);

    await page.getByLabel("Operasyon Detayları").fill("Asama 3 coklu hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "3 Hizmet İlanını Yayınla", exact: true }).click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=3/, { timeout: 15000 });

    const after = await getStoredJobs(page);
    const created = after.filter((job) => !before.some((b) => b.id === job.id));
    assert.equal(created.length, 3);
    const operationId = created[0].operationId;
    assert.ok(operationId);
    assert.ok(created.every((j) => j.operationId === operationId));
    ok("Çoklu hizmet oluşturma sistemi bozulmadı: 3 ilan aynı operationId ile oluştu");

    const byTitle = Object.fromEntries(created.map((j) => [j.title, j]));
    operationJobIds = {
      main: byTitle["Asama 3 Ana Hizmet"].id,
      second: byTitle["Asama 3 Ikinci Hizmet"].id,
      third: byTitle["Asama 3 Ucuncu Hizmet"].id,
      operationId,
    };

    // ---- Ana hizmetin detay sayfasını ziyaret et ----
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    const sectionHeading = page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" });
    await sectionHeading.waitFor({ state: "visible", timeout: 10000 });
    ok("operationId olan ilanda 'Bu Operasyondaki Diğer Hizmetler' bölümü görünür");
    // Kart konteynerine bölümün başlığından yukarı doğru (xpath ile) ulaşılır —
    // sonraki tüm satır/sıra iddiaları bu bölümle sınırlı kalsın, sayfanın
    // başka yerindeki benzer elemanlarla (ör. fotoğraf galerisi <li>'leri)
    // yanlışlıkla eşleşmesin diye.
    const card = sectionHeading.locator("xpath=..");

    await assert.doesNotReject(
      card.getByText("Bu operasyon kapsamında toplam 3 hizmet ilanı bulunmaktadır.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Toplam hizmet sayısı doğru gösterilir (3)");

    // Sıra: DOM'daki satır başlıklarının sırası, oluşturma sırasıyla aynı olmalı.
    const rowTitles = await card.locator("li p.font-semibold").allTextContents();
    const orderedRelevant = rowTitles.filter((t) => t.includes("Asama 3"));
    assert.ok(orderedRelevant[0].includes("Asama 3 Ana Hizmet"));
    assert.ok(orderedRelevant[1].includes("Asama 3 Ikinci Hizmet"));
    assert.ok(orderedRelevant[2].includes("Asama 3 Ucuncu Hizmet"));
    ok("Kardeş ilanların sırası, kullanıcının oluşturduğu sıra ile AYNI korunur");

    // Mevcut ilan "(Bu ilan)" olarak işaretlenir ve tıklanamaz (Link değil).
    // `card` ile sınırlı — Aşama 5, aynı sayfaya AYRICA kendi "Teklif Ver"
    // linklerini eklediği için (bkz. operation-service-offers-card.tsx),
    // sayfa-geneli bir arama artık bu href'lerle birden fazla eşleşir; bu,
    // Aşama 3'ün KENDİ kartının hâlâ tek bir link ürettiğini doğrulamak için
    // kapsamı bu karta daraltır.
    const currentRow = card.locator('li[aria-current="true"]');
    await assert.doesNotReject(currentRow.getByText("(Bu ilan)").waitFor({ state: "visible", timeout: 5000 }));
    assert.equal(await currentRow.locator("a").count(), 0, "Mevcut ilan satırı hiçbir <a> (link) içermemeli");
    const currentRowTag = await currentRow.evaluate((el) => el.tagName);
    assert.equal(currentRowTag, "LI");
    ok("Mevcut ilan '(Bu ilan)' etiketi taşır ve tıklanabilir (Link) değildir");

    // Diğer kardeş ilanlar tıklanabilir (gerçek <a href> ile /ilanlar/[id]).
    const secondLink = card.locator(`a[href="/ilanlar/${operationJobIds.second}"]`);
    const thirdLink = card.locator(`a[href="/ilanlar/${operationJobIds.third}"]`);
    assert.equal(await secondLink.count(), 1);
    assert.equal(await thirdLink.count(), 1);
    ok("Diğer kardeş ilanlar gerçek <a href='/ilanlar/[id]'> linkleriyle tıklanabilir");

    // Hizmet adı / ilan başlığı / ilçe / başlangıç tarihi doğru.
    await assert.doesNotReject(secondLink.getByText("Unlashing", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(secondLink.getByText("Asama 3 Ikinci Hizmet", { exact: false }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(secondLink.getByText("Dilovası", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(secondLink.getByText("03 Ağustos 2026", { exact: false }).waitFor({ state: "visible", timeout: 5000 }));
    ok("İkinci hizmet satırında hizmet adı/başlık/ilçe/başlangıç tarihi doğru görünür");

    await assert.doesNotReject(thirdLink.getByText("Konteyner Dolum", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(thirdLink.getByText("Gebze", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(thirdLink.getByText("05 Ağustos 2026", { exact: false }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Üçüncü hizmet satırında (farklı lokasyonlu) hizmet adı/ilçe/başlangıç tarihi doğru görünür");

    // Varsayılan durum rozeti: hiç teklif yokken hepsi "Aktif".
    await assert.doesNotReject(currentRow.getByText("Aktif", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(secondLink.getByText("Aktif", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Hiç teklif yokken durum rozeti mevcut sistemle 'Aktif' gösterir");

    // Geçiş: ikinci hizmete tıklayınca kendi mevcut detay route'una gider.
    await secondLink.click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${operationJobIds.second}`, { timeout: 10000 });
    await assert.doesNotReject(
      page.getByRole("heading", { name: "Asama 3 Ikinci Hizmet", exact: false }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Diğer hizmete tıklama, mevcut ilan detay route'u (/ilanlar/[id]) ile doğru sayfaya geçer");

    // Bu sayfada da bölüm görünür ve şimdi İKİNCİ hizmet "(Bu ilan)" olarak işaretli.
    await page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });
    const currentRow2 = page.locator('li[aria-current="true"]');
    await assert.doesNotReject(currentRow2.getByText("Asama 3 Ikinci Hizmet", { exact: false }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Geçiş sonrası yeni sayfada kendi ilanı '(Bu ilan)' olarak doğru işaretlenir");

    // operationId/UUID hiçbir yerde (HTML kaynağında) görünmemeli.
    const html = await page.content();
    assert.equal(html.includes(operationJobIds.operationId), false, "operationId sayfa HTML kaynağında görünmemeli");
    ok("operationId/UUID hiçbir metin/link/aria-label/data attribute içinde kullanıcıya sızmaz");

    await page.close();
  }

  // =====================================================================
  // GRUP C — Durum rozeti: mevcut teklif-durumu sistemiyle doğru hesaplanır
  // =====================================================================
  {
    const context = sharedContext;
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");

    // İkinci hizmete "accepted", üçüncü hizmete "in_progress" teklifi enjekte et.
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    await injectOffer(page, { jobId: operationJobIds.second, providerId, status: "accepted" });
    await injectOffer(page, { jobId: operationJobIds.third, providerId, status: "in_progress" });
    await page.reload();
    await page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });

    const secondLink = page.locator(`a[href="/ilanlar/${operationJobIds.second}"]`);
    const thirdLink = page.locator(`a[href="/ilanlar/${operationJobIds.third}"]`);
    await assert.doesNotReject(secondLink.getByText("Teklif Kabul Edildi", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(thirdLink.getByText("Devam Ediyor", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Durum rozeti mevcut getJobRequestFilter sistemiyle doğru hesaplanır ('Teklif Kabul Edildi'/'Devam Ediyor')");

    // Ana ilan (hâlâ teklifsiz) yine "Aktif" kalmalı.
    const currentRow = page.locator('li[aria-current="true"]');
    await assert.doesNotReject(currentRow.getByText("Aktif", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Kendi teklifi olmayan kardeş ilan 'Aktif' rozetini korur (yeni bir durum sistemi icat edilmedi)");

    await page.close();
  }

  // =====================================================================
  // GRUP D — Bağımsızlık: Hizmet Veren yalnızca bulunduğu ilana teklif verir
  // =====================================================================
  {
    const context = sharedContext;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);

    await page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });
    await assert.doesNotReject(page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Hizmet Veren perspektifinden de bölüm görünür ve 'Teklif Ver' (teklif sistemi) bozulmadan çalışır");
    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);

    await page.close();
  }

  // =====================================================================
  // GRUP E — Mobil görünümde yatay taşma yok (ilan detay + yeni kart)
  // =====================================================================
  {
    // Ayrı bir context (izole localStorage) yerine, aynı sharedContext'te
    // yeni bir sayfa açıp yalnızca viewport'unu mobil boyuta küçültüyoruz —
    // aksi halde Grup B'de oluşturulan ilanlara bu sayfadan erişilemezdi.
    const context = sharedContext;
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 900 });
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${operationJobIds.main}`);
    await page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) ilan detay sayfasında yatay taşma OLMAMALI");
    ok("Mobil görünümde (375px) yeni kart yatay taşma oluşturmaz");

    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage3-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
