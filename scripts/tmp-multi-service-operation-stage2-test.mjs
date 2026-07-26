// node scripts/tmp-multi-service-operation-stage2-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 2 (job-request-form.tsx'teki çoklu hizmet
// kartı arayüzü + tek/çoklu ilan gönderim yolları + "Hizmet Taleplerim"
// başarı banner'ı) doğrulama testi. Aşama 1'in aksine burada GERÇEK render
// edilmiş formla (Playwright, gerçek Chromium) etkileşilir — esbuild
// derlemesi gerekmez, çünkü test edilen şey React bileşeninin kendisidir.
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

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

/** Kocaeli/Dilovası/Beldeport — bilinen-iyi bir katalog tesisi (bkz. tmp-kocaeli-form-simplification-test.mjs). */
async function selectDilovasiBeldeport(page) {
  await selectFromSearchable(page, "İlçe", "Dilovası");
  await selectFromSearchable(page, "Bölge / Tesis", "Beldeport", { exact: false });
}

/**
 * Aşama 2.2 itibarıyla başlık/açıklama/lokasyon artık ORTAK değil, hizmet
 * BAŞINA (bkz. job-request-form.tsx#ServiceEntry) — bu yüzden yalnızca
 * ANA (index 0) kart için başlık/açıklama/lokasyon doldurur, ek kartlar
 * varsayılan olarak "Ana hizmetle aynı lokasyon" kullanır (işaretini
 * kaldırmaz). Yalnızca `Operasyon Detayları` gerçekten hâlâ ortaktır.
 */
async function fillMainServiceSharedishFields(page, { titleSuffix }) {
  await page.getByLabel("İlan Başlığı").first().fill(`COKLU-HIZMET-AS2-${titleSuffix}-${Date.now()}`);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("Bu, yalnızca Çoklu Hizmet Operasyonu Aşama 2 testleri için oluşturulmuş bir açıklama metnidir.");
  await selectDilovasiBeldeport(page);
  await page.getByLabel("Açık Adres").first().fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Aşama 2 testi için operasyon detayı, en az on karakter.");
}

/** Ek (index>0) bir kartın başlık/açıklamasını doldurur — lokasyonu VARSAYILAN olarak ana hizmetle aynıdır (işaret kaldırılmaz). */
async function fillAdditionalTitleAndDescription(page, index, { title, description }) {
  await page.getByLabel("İlan Başlığı").nth(index).fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").nth(index).fill(description);
}

/**
 * Aşama 2.3: form artık iki adımlı — "İlanı Yayınla" (form) yalnızca
 * doğrular ve Operasyon Önizleme'yi açar; gerçek oluşturma önizlemenin
 * KENDİ Yayınla butonundan olur. Bu yardımcı ikisini art arda tıklar.
 */
async function submitFormAndPublishFromPreview(page, expectedPublishButtonName) {
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: expectedPublishButtonName, exact: true }).click();
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
  // Gönder butonu yalnızca fotoğraf işleme bitince (photosProcessing=false) etkinleşir.
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

async function fillServiceCard(page, index, { category, startDate, endDate }) {
  if (category !== undefined) await categorySelect(page, index).selectOption(category);
  if (startDate !== undefined) await startDateInput(page, index).fill(startDate);
  if (endDate !== undefined) await endDateInput(page, index).fill(endDate);
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
  // GRUP A — Hizmet kartı arayüzü mekaniği (Test 1-9), tek bir sayfa oturumu
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    // Test 1: yalnızca bir zorunlu (Ana Hizmet) kart var, "Kaldır" yok, "Ek hizmet ekle" henüz görünmüyor.
    assert.equal(await categorySelect(page, 0).count(), 1);
    assert.equal(await page.getByText("Ana Hizmet", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Bu hizmeti kaldır" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Ek hizmet ekle" }).count(), 0);
    ok("Form ilk açıldığında yalnızca bir zorunlu hizmet kartı bulunur, kaldırma butonu yok (Test 1)");

    // "Ek hizmet ekle" yalnızca ana hizmet seçildikten sonra görünür.
    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-05" });
    await assert.doesNotReject(
      page.getByRole("button", { name: "Ek hizmet ekle" }).waitFor({ state: "visible", timeout: 5000 }),
    );

    // Test 2: Ek hizmet ekle -> ikinci kart.
    await clickAddService(page);
    assert.equal(await categorySelect(page, 1).count(), 1);
    assert.equal(await page.getByText("Ek Hizmet", { exact: true }).count(), 1);
    ok("Ek hizmet ekle ile ikinci hizmet kartı oluşur (Test 2)");

    // Test 3: birden fazla ek hizmet eklenebilir.
    await clickAddService(page);
    assert.equal(await categorySelect(page, 2).count(), 1);
    assert.equal(await page.getByText("Ek Hizmet", { exact: true }).count(), 2);
    ok("Birden fazla ek hizmet eklenebilir (Test 3)");

    // Kart 1 ve 2'yi doldur, sonra kart 1'i sil, kart 2'nin verisinin korunduğunu doğrula.
    await fillServiceCard(page, 1, { category: "unlashing", startDate: "2026-08-10", endDate: "2026-08-11" });
    await fillServiceCard(page, 2, { category: "konteyner-dolum", startDate: "2026-08-20", endDate: "2026-08-21" });

    // Test 5: Ana Hizmet kartının kaldırma butonu YOK (toplam kart - 1 kadar buton olmalı).
    assert.equal(await page.getByRole("button", { name: "Bu hizmeti kaldır" }).count(), 2);
    ok("Ana hizmet kartı silinemez (kaldırma butonu yalnızca ek kartlarda var) (Test 5)");

    // Test 4: bir ek kart silinebilir, diğerinin verisi değişmez.
    await page.getByRole("button", { name: "Bu hizmeti kaldır" }).nth(0).click(); // 1. index'teki (unlashing) kartı kaldırır
    assert.equal(await categorySelect(page, 1).count(), 1);
    assert.equal(await categorySelect(page, 1).inputValue(), "konteyner-dolum");
    assert.equal(await startDateInput(page, 1).inputValue(), "2026-08-20");
    assert.equal(await endDateInput(page, 1).inputValue(), "2026-08-21");
    ok("Ek hizmet kartı silinebilir; kalan diğer kartın seçim/tarihleri DEĞİŞMEDEN korunur (Test 4)");

    // Test 6: aynı hizmet iki kartta seçilemez (diğer kartta devre dışı bırakılır).
    const secondCardLashingOption = categorySelect(page, 1).locator('option[value="lashing"]');
    assert.notEqual(await secondCardLashingOption.getAttribute("disabled"), null);
    const firstCardLashingOption = categorySelect(page, 0).locator('option[value="lashing"]');
    assert.equal(await firstCardLashingOption.getAttribute("disabled"), null);
    ok("Ana kartta seçilen hizmet, diğer kartlarda devre dışı bırakılır (yinelenen seçim önlenir) (Test 6)");

    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
    await context.close();
  }

  // =====================================================================
  // GRUP B — Tarih doğrulaması (Test 7, 8, 9), taze bir sayfa
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    await fillServiceCard(page, 0, { category: "lashing" }); // tarihler BOŞ bırakılıyor
    await fillMainServiceSharedishFields(page, { titleSuffix: "tarih-bos" });
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();

    await assert.doesNotReject(
      page.getByText("Başlangıç tarihini seçiniz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    await assert.doesNotReject(
      page.getByText("Bitiş tarihini seçiniz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Her hizmet için başlangıç ve bitiş tarihi zorunludur (Test 7)");

    // Test 8: bitiş < başlangıç -> engellenir.
    await startDateInput(page, 0).fill("2026-08-10");
    await endDateInput(page, 0).fill("2026-08-01");
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await assert.doesNotReject(
      page
        .getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true })
        .waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Bitiş tarihi başlangıçtan önceyse gönderim engellenir (Test 8)");

    // Test 9: aynı gün başlangıç/bitiş kabul edilir (bu hatayı temizler).
    await endDateInput(page, 0).fill("2026-08-10");
    await assert.rejects(
      page.getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true }).waitFor({ state: "visible", timeout: 1500 }),
    );
    ok("Aynı gün başlangıç ve bitiş kabul edilir (Test 9)");

    await context.close();
  }

  // =====================================================================
  // GRUP C — Tek hizmet gönderimi (Test 10, 11, 13, 22)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    const before = await getStoredJobs(page);
    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-02" });
    await fillMainServiceSharedishFields(page, { titleSuffix: "tek-hizmet" });
    await uploadOnePhoto(page);
    await submitFormAndPublishFromPreview(page, "İlanı Yayınla");
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });

    const after = await getStoredJobs(page);
    assert.equal(after.length, before.length + 1);
    ok("Tek hizmetle gönderimde yalnızca bir ilan oluşur (Test 10)");
    ok("Mevcut tek ilan oluşturma akışı (createJob, /ilanlar/[id] yönlendirmesi) bozulmadan çalışır (Test 22)");

    const newJobId = page.url().split("/ilanlar/")[1];
    const newJob = after.find((job) => job.id === newJobId);
    assert.equal(newJob.operationId, undefined);
    assert.equal(newJob.category, "lashing");
    assert.equal(newJob.workDate, "2026-08-01");
    assert.equal(newJob.workEndDate, "2026-08-02");
    ok("Tek hizmet ilanında operationId oluşmaz; kategori/tarihler doğru yazılır (Test 11, 13)");

    await context.close();
  }

  // =====================================================================
  // GRUP D — Çoklu hizmet gönderimi (Test 12, 14, 15, 16, 20, 21)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    const before = await getStoredJobs(page);
    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-15" });
    await clickAddService(page);
    await fillServiceCard(page, 1, { category: "unlashing", startDate: "2026-08-03", endDate: "2026-08-04" });
    await fillAdditionalTitleAndDescription(page, 1, {
      title: "İkinci Hizmet Başlığı AS2",
      description: "İkinci hizmete özel açıklama, en az yirmi karakter içerir.",
    });
    await clickAddService(page);
    await fillServiceCard(page, 2, { category: "konteyner-dolum", startDate: "2026-08-03", endDate: "2026-08-03" });
    await fillAdditionalTitleAndDescription(page, 2, {
      title: "Üçüncü Hizmet Başlığı AS2",
      description: "Üçüncü hizmete özel açıklama, en az yirmi karakter içerir.",
    });
    await fillMainServiceSharedishFields(page, { titleSuffix: "coklu-hizmet" });
    await uploadOnePhoto(page);
    await submitFormAndPublishFromPreview(page, "3 Hizmet İlanını Yayınla");

    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=3/, { timeout: 15000 });
    ok("Üç hizmetle gönderimde üç bağımsız ilan oluşur ve doğru query-param ile yönlendirilir (Test 13/20)");

    await assert.doesNotReject(
      page
        .getByText("3 hizmet ilanı başarıyla oluşturuldu.", { exact: true })
        .waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("Çoklu oluşturma başarılı olduğunda doğru başarı mesajı gösterilir (Test 20)");

    const after = await getStoredJobs(page);
    assert.equal(after.length, before.length + 3);
    ok("İki/üç hizmetle gönderimde beklenen sayıda bağımsız ilan oluşur (Test 12/13)");

    const createdJobs = after.filter((job) => !before.some((b) => b.id === job.id));
    assert.equal(createdJobs.length, 3);

    const operationIds = new Set(createdJobs.map((job) => job.operationId));
    assert.equal(operationIds.size, 1);
    assert.ok([...operationIds][0]);
    ok("Çoklu ilanların operationId değerleri aynıdır (Test 14)");

    const byCategory = Object.fromEntries(createdJobs.map((job) => [job.category, job]));
    assert.equal(byCategory["lashing"].workDate, "2026-08-01");
    assert.equal(byCategory["lashing"].workEndDate, "2026-08-15");
    assert.equal(byCategory["unlashing"].workDate, "2026-08-03");
    assert.equal(byCategory["unlashing"].workEndDate, "2026-08-04");
    assert.equal(byCategory["konteyner-dolum"].workDate, "2026-08-03");
    assert.equal(byCategory["konteyner-dolum"].workEndDate, "2026-08-03");
    ok("Her ilanın kategori ve tarihleri doğru hizmet kartından gelir (Test 15)");

    assert.notEqual(byCategory["lashing"].workDate, byCategory["unlashing"].workDate);
    ok("Kardeş ilanların tarihleri birbirinden farklı olabilir (Test 16)");

    for (const job of createdJobs) {
      assert.equal(job.district, "Dilovası");
      assert.equal(job.addressText, "Test Mahallesi, Test Caddesi No:1, Dilovası");
      assert.equal(job.operationDetails, "Aşama 2 testi için operasyon detayı, en az on karakter.");
      assert.equal(job.photos.length, 1);
    }
    ok("Fotoğraf ve ortak alanlar (ilçe/adres/operasyon detayı) tüm ilanlarda doğru kalır (Test 21)");

    await context.close();
  }

  // =====================================================================
  // GRUP E — Kartlar arası hata izolasyonu (Test 18)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-02" });
    await clickAddService(page);
    // 2. kart BİLEREK hatalı (bitiş < başlangıç).
    await fillServiceCard(page, 1, { category: "unlashing", startDate: "2026-08-10", endDate: "2026-08-01" });
    await fillAdditionalTitleAndDescription(page, 1, {
      title: "Hatalı Kart Başlığı",
      description: "Hatalı kartın açıklaması, en az yirmi karakter içerir.",
    });
    await clickAddService(page);
    await fillServiceCard(page, 2, { category: "konteyner-dolum", startDate: "2026-08-20", endDate: "2026-08-21" });
    await fillAdditionalTitleAndDescription(page, 2, {
      title: "Üçüncü Kart Başlığı",
      description: "Üçüncü kartın açıklaması, en az yirmi karakter içerir.",
    });
    await fillMainServiceSharedishFields(page, { titleSuffix: "hata-izolasyon" });
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();

    await assert.doesNotReject(
      page
        .getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true })
        .waitFor({ state: "visible", timeout: 5000 }),
    );
    // 1. ve 3. kartların değerleri SİLİNMEMİŞ olmalı.
    assert.equal(await categorySelect(page, 0).inputValue(), "lashing");
    assert.equal(await startDateInput(page, 0).inputValue(), "2026-08-01");
    assert.equal(await endDateInput(page, 0).inputValue(), "2026-08-02");
    assert.equal(await categorySelect(page, 2).inputValue(), "konteyner-dolum");
    assert.equal(await startDateInput(page, 2).inputValue(), "2026-08-20");
    assert.equal(await endDateInput(page, 2).inputValue(), "2026-08-21");
    ok("Bir karttaki tarih hatası diğer kartların değerlerini silmez (Test 18)");

    await context.close();
  }

  // =====================================================================
  // GRUP F — Çift tıklama koruması (Test 19)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    const before = await getStoredJobs(page);
    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-02" });
    await clickAddService(page);
    await fillServiceCard(page, 1, { category: "unlashing", startDate: "2026-08-03", endDate: "2026-08-04" });
    await fillAdditionalTitleAndDescription(page, 1, {
      title: "İkinci Hizmet Çift Tıklama",
      description: "Çift tıklama testi ikinci hizmet açıklaması, en az yirmi karakter.",
    });
    await fillMainServiceSharedishFields(page, { titleSuffix: "cift-tiklama" });
    await uploadOnePhoto(page);

    // Aşama 2.3: gerçek oluşturma artık Operasyon Önizleme'nin KENDİ Yayınla
    // butonundan olur — formun butonu yalnızca önizlemeyi açar. Çift
    // tıklama koruması burada ÖNİZLEMENİN butonu üzerinde denenir (React'in
    // submitting=true render'ı arayı KAPATMADAN, senkron submitLockRef'in
    // test ettiği tam senaryo, art arda tetiklenir).
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const publishButton = buttons.find((b) => b.textContent.includes("İlanını Yayınla"));
      publishButton.click();
      publishButton.click();
    });

    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=2/, { timeout: 15000 });
    const after = await getStoredJobs(page);
    assert.equal(after.length, before.length + 2, "Çift tıklama İKİ KEZ 2'şer ilan (4 toplam) değil, yalnızca 2 ilan oluşturmalı");
    ok("Önizlemenin Yayınla butonuna çift tıklama aynı operasyonu iki kez oluşturmaz (Test 19)");

    await context.close();
  }

  // =====================================================================
  // GRUP G — Mobil görünümde yatay taşma yok (Test 23)
  // =====================================================================
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() sunucu anlık görüntüsünde her zaman null döner (bkz.
    // CLAUDE.md "No real backend") — bu yüzden gerçek form yalnızca
    // hydration'dan SONRA (localStorage'daki oturum okunduğunda) görünür;
    // `page.goto` sonrası hemen sorgulamak yerine bunu bekler.
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await fillServiceCard(page, 0, { category: "lashing", startDate: "2026-08-01", endDate: "2026-08-02" });
    await clickAddService(page);
    await fillServiceCard(page, 1, { category: "unlashing", startDate: "2026-08-03", endDate: "2026-08-04" });

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(hasHorizontalOverflow, false, "Mobil genişlikte (375px) yatay taşma OLMAMALI");
    ok("Mobil görünümde (375px, 2 hizmet kartı ile) yatay taşma oluşmaz (Test 23)");

    await context.close();
  }

  await browser.close();

  console.log(
    "\n[tmp-multi-service-operation-stage2-test] Not: Test 17 (yinelenen/geçersiz hizmette ilan oluşmaz) " +
      "arayüz düzeyinde Test 6'daki 'devre dışı seçenek' önlemesiyle karşılanır; veri katmanındaki asıl " +
      "reddetme (createJobsForOperation) tmp-multi-service-operation-stage1-test.mjs'de (Test 7 + 'geçersiz " +
      "kategori' ek kontrolü) zaten ayrıntılı doğrulanmıştır — burada tekrar edilmedi. Test 24 (Aşama 1 " +
      "testleri) o betik ayrıca çalıştırılarak doğrulanmıştır (bkz. rapor).",
  );
  console.log(`\n[tmp-multi-service-operation-stage2-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
