// node scripts/tmp-multi-service-operation-stage2-3-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 2.3 (Operasyon Önizleme ekranı) doğrulama
// testi, GERÇEK render edilmiş forma karşı (Playwright, gerçek Chromium).
// Aşama 2.2 (her hizmetin kendi başlığı/açıklaması/konumu, "Ana hizmetle
// aynı lokasyon" seçeneği) bu betikte önizlemenin doğru veri gösterdiğini
// kanıtlamak için ayrıca örtük olarak da doğrulanır.
//
// Akış artık İKİ ADIMLI: formun "İlanı Yayınla" butonu (hâlâ bu metinle)
// artık createJob/createJobsForOperation'ı DOĞRUDAN çağırmaz — yalnızca
// doğrular ve geçerliyse Operasyon Önizleme ekranına geçer. Gerçek
// oluşturma yalnızca önizlemenin KENDİ "İlanı Yayınla"/"N Hizmet İlanını
// Yayınla" butonundan olur.
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
  // useSession() sunucu anlık görüntüsünde her zaman null döner — gerçek
  // form yalnızca hydration'dan SONRA görünür.
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

/** Ana hizmet (index 0) için tam bir kart doldurur — kendi lokasyonunu seçer (Dilovası / Beldeport). */
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

/** Ek hizmet kartı (index>0), "Ana hizmetle aynı lokasyon" İŞARETLİ bırakılır (varsayılan) — yalnızca kategori/başlık/açıklama/tarih doldurulur. */
async function fillAdditionalServiceCardWithMainLocation(page, index, { category, title, description, startDate, endDate }) {
  await categorySelect(page, index).selectOption(category);
  await titleInput(page, index).fill(title);
  await descriptionInput(page, index).fill(description);
  await startDateInput(page, index).fill(startDate);
  await endDateInput(page, index).fill(endDate);
}

/** Ek hizmet kartında "Ana hizmetle aynı lokasyon" işaretini KALDIRIR ve KENDİ (farklı) ilçe/tesis/adresini seçer. */
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
  // "Açık Adres" yalnızca "Ana hizmetle aynı lokasyon" işaretsiz kartlarda
  // render edilir — bu yüzden `index`e göre değil (ana hizmetle aynı
  // lokasyonu kullanan kartlarda hiç görünmediğinden index kayar), DOM'daki
  // EN SON (bu az önce açılan) örneğe göre hedeflenir.
  await page.getByLabel("Açık Adres").last().fill("Farklı Mahalle, Farklı Cadde No:9, Gebze");
}

async function clickAddService(page) {
  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
}

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}

let browser;

async function main() {
  browser = await chromium.launch();

  // =====================================================================
  // GRUP A — Tek hizmette önizleme + yayınlama (Test: tek hizmet önizleme,
  // tarihler/lokasyon/başlık-açıklama doğru, fotoğraf önizlemesi, önizleme
  // hiçbir ilan oluşturmaz, yayınlandıktan sonra doğru oluşur, tek ilan
  // akışı bozulmaz)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Tek Hizmet Önizleme Testi",
      description: "Bu, yalnızca Aşama 2.3 önizleme testinin tek hizmet senaryosu için oluşturulmuş açıklamadır.",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    await page.getByLabel("Operasyon Detayları").fill("Aşama 2.3 tek hizmet testi operasyon detayı, en az on karakter.");
    await uploadOnePhoto(page);

    // "İlanı Yayınla" (form) -> henüz hiçbir ilan oluşmaz, önizleme açılır.
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();

    await assert.doesNotReject(
      page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 }),
    );
    await assert.doesNotReject(
      page.getByText("1 Hizmet İlanı Yayınlanacak", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Tek hizmette önizleme doğru görünür (Operasyon Özeti + '1 Hizmet İlanı Yayınlanacak')");

    await assert.doesNotReject(
      page.getByText("Tek Hizmet Önizleme Testi", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    await assert.doesNotReject(
      page
        .getByText("Bu, yalnızca Aşama 2.3 önizleme testinin tek hizmet senaryosu için oluşturulmuş açıklamadır.", { exact: true })
        .waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Başlık ve hizmete özel açıklama önizlemede doğru görünür");

    await assert.doesNotReject(page.getByText("01 Ağustos 2026", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(page.getByText("05 Ağustos 2026", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    ok("Başlangıç/bitiş tarihleri önizlemede doğru (tr-TR biçiminde) görünür");

    await assert.doesNotReject(page.getByText("Dilovası", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(page.getByText("Beldeport", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(
      page.getByText("Test Mahallesi, Test Caddesi No:1, Dilovası", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Lokasyon (İlçe / Tesis / Adres) önizlemede doğru görünür");

    const thumbnail = page.locator("img[src^='blob:']");
    await assert.doesNotReject(thumbnail.first().waitFor({ state: "visible", timeout: 5000 }));
    ok("Fotoğraf önizlemesi (ilk fotoğrafın thumbnail'i) çalışır");

    // Önizleme ekranı hiçbir ilan oluşturmadı.
    const afterPreview = await getStoredJobs(page);
    assert.equal(afterPreview.length, before.length, "Önizleme ekranı GÖRÜNTÜLENDİĞİNDE hiçbir ilan oluşmamalı");
    ok("Önizleme ekranı hiçbir ilan oluşturmaz (yalnızca görüntülendiğinde)");

    // Şimdi gerçekten yayınla.
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const afterPublish = await getStoredJobs(page);
    assert.equal(afterPublish.length, before.length + 1, "Yayınla'dan SONRA tam olarak 1 ilan oluşmalı");
    const newJobId = page.url().split("/ilanlar/")[1];
    const newJob = afterPublish.find((job) => job.id === newJobId);
    assert.equal(newJob.operationId, undefined);
    assert.equal(newJob.title, "Tek Hizmet Önizleme Testi");
    ok("Yayınla butonundan sonra ilan doğru oluşur; mevcut tek ilan akışı (createJob, /ilanlar/[id]) bozulmadan çalışır");

    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
    await context.close();
  }

  // =====================================================================
  // GRUP B — Çoklu hizmette önizleme: tüm kartlar, sıra, farklı lokasyon
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Ana Hizmet Başlığı",
      description: "Ana hizmete özel açıklama, en az yirmi karakter içerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-15",
    });

    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "İkinci Hizmet Başlığı",
      description: "İkinci hizmete özel açıklama, en az yirmi karakter içerir.",
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    // Bu kart ana hizmetle AYNI lokasyonu kullanacak (varsayılan, işaret kaldırılmadı).

    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 2, {
      category: "konteyner-dolum",
      title: "Üçüncü Hizmet Başlığı",
      description: "Üçüncü hizmete özel açıklama, en az yirmi karakter içerir.",
      startDate: "2026-08-05",
      endDate: "2026-08-05",
    });
    // Üçüncü kart KENDİ (farklı) lokasyonunu kullanacak.
    await applyOwnLocationForAdditionalServiceCard(page, 2);

    await page.getByLabel("Operasyon Detayları").fill("Aşama 2.3 çoklu hizmet testi operasyon detayı, en az on karakter.");
    await uploadOnePhoto(page);

    const before = await getStoredJobs(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await assert.doesNotReject(
      page.getByText("3 Hizmet İlanı Yayınlanacak", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("Çoklu hizmette önizleme açılır, doğru toplam sayı gösterilir");

    const mainHeadingCount = await page.getByText("Ana Hizmet", { exact: true }).count();
    const additionalHeadingCount = await page.getByText("Ek Hizmet", { exact: true }).count();
    assert.equal(mainHeadingCount, 1);
    assert.equal(additionalHeadingCount, 2);
    ok("Çoklu hizmette tüm kartlar görünür (1 Ana Hizmet + 2 Ek Hizmet)");

    // Kart sırası: DOM'daki başlıkların sırası eklenme sırasıyla aynı olmalı.
    const titleTexts = await page.locator("h3").allTextContents();
    const orderedTitles = titleTexts.filter((t) =>
      ["Ana Hizmet Başlığı", "İkinci Hizmet Başlığı", "Üçüncü Hizmet Başlığı"].includes(t),
    );
    assert.deepEqual(orderedTitles, ["Ana Hizmet Başlığı", "İkinci Hizmet Başlığı", "Üçüncü Hizmet Başlığı"]);
    ok("Kart sıraları, kullanıcının hizmetleri eklediği sırayla AYNI korunur");

    // Ana hizmet ve ikinci hizmet AYNI lokasyonu (Dilovası/Beldeport) gösterir; üçüncü FARKLI (Gebze/Kendi Fabrikamız) gösterir.
    const dilovasiCount = await page.getByText("Dilovası", { exact: true }).count();
    assert.ok(dilovasiCount >= 2, "Ana hizmet VE ikinci hizmet (aynı lokasyon) Dilovası göstermeli");
    await assert.doesNotReject(page.getByText("Gebze", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }));
    await assert.doesNotReject(page.getByText("Kendi Fabrikamız", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }));
    ok("'Ana hizmetle aynı lokasyon' seçilince o kartta da GERÇEK lokasyon (Dilovası/Beldeport) gösterilir; farklı seçilen kartta kendi (Gebze/Kendi Fabrikamız) lokasyonu gösterilir");

    const afterPreview = await getStoredJobs(page);
    assert.equal(afterPreview.length, before.length, "Çoklu hizmette de önizleme hiçbir ilan oluşturmamalı");

    await page.getByRole("button", { name: "3 Hizmet İlanını Yayınla", exact: true }).click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=3/, { timeout: 15000 });
    const afterPublish = await getStoredJobs(page);
    assert.equal(afterPublish.length, before.length + 3);
    const createdJobs = afterPublish.filter((job) => !before.some((b) => b.id === job.id));
    const byTitle = Object.fromEntries(createdJobs.map((job) => [job.title, job]));
    assert.equal(byTitle["Ana Hizmet Başlığı"].district, "Dilovası");
    assert.equal(byTitle["İkinci Hizmet Başlığı"].district, "Dilovası");
    assert.equal(byTitle["Üçüncü Hizmet Başlığı"].district, "Gebze");
    assert.equal(byTitle["Üçüncü Hizmet Başlığı"].workLocationType, "Kendi Fabrikamız");
    const operationIds = new Set(createdJobs.map((job) => job.operationId));
    assert.equal(operationIds.size, 1);
    ok("Yayınla butonundan sonra üç ilan da doğru (kendi başlık/açıklama/lokasyon/tarihleriyle) oluşur, aynı operationId'yi taşır");

    await context.close();
  }

  // =====================================================================
  // GRUP C — Düzenlemeye dön: form state kaybolmaz
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Düzenlemeye Dön Testi",
      description: "Bu ilan, düzenlemeye dön butonunun form state'ini korumasını test eder.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Düzenlemeye dön testi operasyon detayı, en az on karakter.");
    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });

    await page.getByRole("button", { name: "Düzenlemeye Dön", exact: true }).click();
    await assert.doesNotReject(categorySelect(page, 0).waitFor({ state: "visible", timeout: 5000 }));

    assert.equal(await categorySelect(page, 0).inputValue(), "lashing");
    assert.equal(await titleInput(page, 0).inputValue(), "Düzenlemeye Dön Testi");
    assert.equal(
      await descriptionInput(page, 0).inputValue(),
      "Bu ilan, düzenlemeye dön butonunun form state'ini korumasını test eder.",
    );
    assert.equal(await startDateInput(page, 0).inputValue(), "2026-08-01");
    assert.equal(await endDateInput(page, 0).inputValue(), "2026-08-02");
    assert.equal(
      await page.getByLabel("Operasyon Detayları").inputValue(),
      "Düzenlemeye dön testi operasyon detayı, en az on karakter.",
    );
    // Fotoğraf hâlâ yüklü (yeniden yüklemeye gerek yok) — gönder butonu hâlâ etkin.
    assert.equal(
      await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).isDisabled(),
      false,
    );
    ok("'Düzenlemeye Dön' butonu formu, hiçbir alan/fotoğraf kaybolmadan aynı şekilde geri getirir");

    await context.close();
  }

  // =====================================================================
  // GRUP D — Yayınla butonu iki kez çalışmaz (önizlemenin KENDİ butonu)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);
    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Cift Tiklama Onizleme Testi",
      description: "Onizleme ekranindaki yayinla butonunun cift tiklamaya karsi korumasini test eder.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Cift tiklama testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const publishButton = buttons.find((b) => b.textContent.includes("İlanı Yayınla"));
      publishButton.click();
      publishButton.click();
    });

    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const after = await getStoredJobs(page);
    assert.equal(after.length, before.length + 1, "Önizlemenin Yayınla butonuna çift tıklama İKİ ilan değil, yalnızca 1 ilan oluşturmalı");
    ok("Önizlemenin Yayınla butonu çift tıklamada iki kez çalışmaz");

    await context.close();
  }

  // =====================================================================
  // GRUP E — Mobil görünümde yatay taşma yok (önizleme ekranı)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Mobil Onizleme Testi",
      description: "Mobil genislikte onizleme ekraninin yatay tasma olusturmadigini test eder.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "Mobil Ek Hizmet",
      description: "Mobil ek hizmet aciklamasi, en az yirmi karakter icerir.",
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    await page.getByLabel("Operasyon Detayları").fill("Mobil onizleme testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) önizleme ekranında yatay taşma OLMAMALI");
    ok("Mobil görünümde (375px) Operasyon Önizleme ekranı yatay taşma oluşturmaz");

    await context.close();
  }

  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage2-3-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
