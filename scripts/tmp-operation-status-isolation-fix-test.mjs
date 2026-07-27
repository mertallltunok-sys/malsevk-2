// node scripts/tmp-operation-status-isolation-fix-test.mjs
//
// AŞAMA 5.2 İLE SÜPERSEDE EDİLDİ — bkz. scripts/tmp-operation-status-global-badge-fix-test.mjs.
// Bu script'in belgelediği "getViewerScopedJobStatus" yaklaşımı (ilana bakan
// HERKESTE ANA rozeti izleyenin kendi teklifine göre değiştirme) kök nedeni
// yanlış teşhis etmişti: GLOBAL iş durumunu (herkeste aynı olması gereken)
// İZLEYENE ÖZEL kişisel durumla karıştırıp ANA rozet olarak gösteriyordu —
// bu da aynı ilanın farklı hesaplarda farklı ANA rozetler göstermesine yol
// açan asıl hataydı (bkz. offers.ts#getViewerOfferStatusNote dokümantasyonu).
// Aşama 5.2 bunu düzeltti: ANA rozet artık HER ZAMAN global/tutarlı, kişisel
// bilgi yalnızca küçük bir İKİNCİL not. Bu script BİLEREK değiştirilmedi —
// Aşama 5.1'in o anki (o zaman doğru sanılan) davranışının tarihsel kaydı
// olarak kalır (bkz. CLAUDE.md "tmp-*.mjs" script konvansiyonu) — bu yüzden
// artık aşağıdaki "Kritik izolasyon" ve rozet-metni beklentileri KASITLI
// OLARAK geçmeyecektir; canlı regresyon kapısı olarak
// tmp-operation-status-global-badge-fix-test.mjs kullanılmalıdır.
//
// --- Aşağıdaki orijinal açıklama (artık kısmen geçersiz) ---
// Kritik kullanıcı izolasyonu düzeltmesi: OperationSiblingJobsCard,
// OperationStatusCard (özet sayıları DAHİL) ve OperationServiceOffersCard'ın
// durum rozetlerinin artık GÖSTEREN oturuma göre hesaplandığını, ilanın
// GERÇEK (job-geneli) durumunun ilgisiz hesaplara sızmadığını doğrular —
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
        description: "İzolasyon düzeltmesi test teklifi",
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
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  let mertId;
  let mehmetId;
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!");
    let users = await getStoredUsers(page);
    mertId = users.find((u) => u.email === "mert@test.com").id;
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
    users = await getStoredUsers(page);
    mehmetId = users.find((u) => u.email === "mehmet.demir.demo@malsevk.com").id;
    await page.close();
  }

  // =====================================================================
  // GRUP A — Hazırlık: 2 hizmetli operasyon + çapraz teklif senaryosu
  //   Servis A: mert = accepted, mehmet = pending (kabul EDİLMEMİŞ)
  //   Servis B: mehmet = accepted, mert = HİÇ teklif vermedi
  // Bu, tüm 4 senaryoyu (sahip/kabul edilen/rakip/hiç teklif vermeyen) TEK
  // operasyonda, çapraz doğrulamayla test etmeyi sağlar.
  // =====================================================================
  let jobIds = {};
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);

    const before = await getStoredJobs(page);
    await fillMainServiceCard(page, {
      category: "lashing",
      title: "Izolasyon Servis A",
      description: "Servis A ozel aciklamasi, en az yirmi karakter icerir.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await clickAddService(page);
    await fillAdditionalServiceCardWithMainLocation(page, 1, {
      category: "unlashing",
      title: "Izolasyon Servis B",
      description: "Servis B ozel aciklamasi, en az yirmi karakter icerir.",
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    await page.getByLabel("Operasyon Detayları").fill("Izolasyon duzeltmesi test operasyonu, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "2 Hizmet İlanını Yayınla", exact: true }).click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=2/, { timeout: 15000 });

    const after = await getStoredJobs(page);
    const created = after.filter((job) => !before.some((b) => b.id === job.id));
    assert.equal(created.length, 2);
    const byTitle = Object.fromEntries(created.map((j) => [j.title, j]));
    jobIds = { a: byTitle["Izolasyon Servis A"].id, b: byTitle["Izolasyon Servis B"].id };

    await injectOffer(page, { jobId: jobIds.a, providerId: mertId, status: "accepted" });
    await injectOffer(page, { jobId: jobIds.a, providerId: mehmetId, status: "pending" });
    await injectOffer(page, { jobId: jobIds.b, providerId: mehmetId, status: "accepted" });

    ok("Hazırlık: 2 hizmetli operasyon + çapraz teklif senaryosu (Servis A: mert kabul/mehmet beklemede, Servis B: mehmet kabul/mert teklifsiz) oluşturuldu");
    await page.close();
  }

  // =====================================================================
  // GRUP B — Hizmet Alan (ilan sahibi): GERÇEK durumu görmeye devam eder
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobIds.a}`);
    const statusHeading = page.getByRole("heading", { name: "Operasyon Durumu" });
    await statusHeading.waitFor({ state: "visible", timeout: 10000 });

    const summaryText = await statusHeading.locator("xpath=..").locator("dl").innerText();
    assert.ok(/Teklif Kabul Edildi[\s\S]*2/.test(summaryText), "İlan sahibi özet sayılarında GERÇEK toplamı (2 kabul edilmiş) görmeli");
    ok("Hizmet Alan (ilan sahibi): Operasyon Durumu özetinde GERÇEK durumu (Teklif Kabul Edildi: 2) görmeye devam eder");

    const bodyText = await page.evaluate(() => document.body.innerText);
    const genericAcceptedCount = (bodyText.match(/Teklif Kabul Edildi/g) || []).length;
    assert.ok(genericAcceptedCount >= 2, "İlan sahibi her iki hizmet için de GERÇEK 'Teklif Kabul Edildi' rozetini görmeli");
    assert.equal((bodyText.match(/Teklifiniz Kabul Edildi/g) || []).length, 0, "İlan sahibi kendisi teklif vermediği için kişiselleştirilmiş 'Teklifiniz Kabul Edildi' metnini GÖRMEMELİ");
    ok("Hizmet Alan (ilan sahibi): her iki hizmette de gerçek 'Teklif Kabul Edildi' rozetini (job-geneli, kişiselleştirilmemiş) görür");

    await page.close();
  }

  // =====================================================================
  // GRUP C — Teklifi kabul edilen Hizmet Veren (mert, Servis A): "Teklifiniz
  // Kabul Edildi" görür; kendi teklifi olmayan Servis B'de İSE kesinlikle
  // mehmet'in kabul bilgisini görmez (kritik izolasyon).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobIds.a}`);
    await page.getByRole("heading", { name: "Operasyon Durumu" }).waitFor({ state: "visible", timeout: 10000 });

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.ok(bodyText.includes("Teklifiniz Kabul Edildi"), "Teklifi kabul edilen Hizmet Veren 'Teklifiniz Kabul Edildi' metnini görmeli");
    ok("Teklifi kabul edilen Hizmet Veren (mert, Servis A): 'Teklifiniz Kabul Edildi' bilgisini görür");

    // Servis B: mert'in HİÇ teklifi yok — mehmet'in kabul edilmiş teklifi
    // KESİNLİKLE sızmamalı (ne rozet ne özet sayılarında).
    assert.equal(bodyText.includes("Izolasyon Servis B"), true, "Servis B satırı (Bu Operasyondaki Diğer Hizmetler / Operasyondaki Hizmetler listelerinde) görünmeli");
    // Genel "Teklif Kabul Edildi" sayısı yalnızca Servis A'dan (mert'in KENDİ
    // durumu "Teklifiniz Kabul Edildi" olarak ayrı sayıldığı için) gelmeli —
    // Servis B'nin gerçek (mehmet'e ait) kabul durumu asla "Teklif Kabul
    // Edildi" YA DA "Teklifiniz Kabul Edildi" olarak Servis B için görünmemeli.
    const summaryText = await page
      .getByRole("heading", { name: "Operasyon Durumu" })
      .locator("xpath=..")
      .locator("dl")
      .innerText();
    assert.ok(/Teklif Kabul Edildi[\s\S]*0/.test(summaryText), "mert'in özet sayılarında 'Teklif Kabul Edildi' 0 olmalı (kendi kabulü ayrı 'Teklifiniz Kabul Edildi' etiketiyle, farklı bucket'ta sayılır)");
    ok("Teklifi kabul edilen Hizmet Veren (mert): özet sayıları KENDİ görebildiği bilgiyle tutarlı, mehmet'in Servis B kabulünü saymaz");

    const serviceOffersCard = page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
    const servisBRow = serviceOffersCard.locator("li", { has: page.getByText("Izolasyon Servis B", { exact: true }) });
    await assert.doesNotReject(servisBRow.getByText("Aktif", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    assert.equal(await servisBRow.getByText("Teklif Kabul Edildi", { exact: true }).count(), 0, "mert, Servis B'de (kendi teklifi yok) 'Teklif Kabul Edildi' rozetini KESİNLİKLE görmemeli");
    assert.equal(await servisBRow.getByText("Teklifiniz Kabul Edildi", { exact: true }).count(), 0, "mert, Servis B'de (kendi teklifi yok) 'Teklifiniz Kabul Edildi' de görmemeli — bu bilgi mehmet'e ait");
    ok("Kritik izolasyon: mert, kendi teklifi olmayan Servis B'de mehmet'e ait kabul bilgisini (rozette) KESİNLİKLE görmez, nötr 'Aktif' görür");

    assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
    await page.close();
  }

  // =====================================================================
  // GRUP D — Aynı hizmete (Servis A) teklif vermiş ama KABUL EDİLMEMİŞ
  // Hizmet Veren (mehmet): "Teklif Kabul Edildi" rozetini görmez, kendi
  // teklif durumuna (Beklemede) uygun bilgi görür. Kendi kabul edilen
  // Servis B'sinde ise "Teklifiniz Kabul Edildi" görür.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobIds.a}`);
    await page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).waitFor({ state: "visible", timeout: 10000 });

    // Bu sayfa Servis A'nın KENDİ detay sayfası olduğu için, OperationServiceOffersCard'daki
    // kendi satırı "(Bu ilan)" ekiyle render edilir — bu yüzden `exact: false` (alt metin) kullanılır.
    const serviceOffersCard = page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
    const servisARow = serviceOffersCard.locator("li", { has: page.getByText("Izolasyon Servis A", { exact: false }) });
    assert.equal(await servisARow.getByText("Teklif Kabul Edildi", { exact: true }).count(), 0, "mehmet (kabul edilmemiş) Servis A'da 'Teklif Kabul Edildi' rozetini GÖRMEMELİ");
    assert.equal(await servisARow.getByText("Teklifiniz Kabul Edildi", { exact: true }).count(), 0, "mehmet (kabul edilmemiş) 'Teklifiniz Kabul Edildi' de GÖRMEMELİ (bu mert'e ait)");
    await assert.doesNotReject(servisARow.getByText("Beklemede", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Kabul edilmemiş rakip Hizmet Veren (mehmet, Servis A): 'Teklif Kabul Edildi' rozetini görmez, kendi teklif durumuna (Beklemede) uygun bilgi görür");

    const servisBRow = serviceOffersCard.locator("li", { has: page.getByText("Izolasyon Servis B", { exact: true }) });
    await assert.doesNotReject(servisBRow.getByText("Teklifiniz Kabul Edildi", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
    ok("Aynı Hizmet Veren (mehmet), KENDİ kabul edilen Servis B'sinde 'Teklifiniz Kabul Edildi' bilgisini doğru şekilde görür");

    await page.close();
  }

  // =====================================================================
  // GRUP E — Misafir (oturum yok): hiçbir rozette gerçek kabul bilgisi sızmaz
  //
  // NOT: "Operasyon Durumu" özet ızgarasında "Teklif Kabul Edildi" METNİ,
  // değeri 0 olsa bile SABİT bir kategori başlığı olarak HER ZAMAN görünür
  // (bkz. Aşama 4: "Gösterilecek sayı 0 olsa bile kart düzeni bozulmamalı")
  // — bu, tek başına bir sızıntı DEĞİLDİR. Asıl kontrol edilmesi gereken:
  // (a) o kategorinin SAYISI 0 olmalı, (b) hiçbir SATIR ROZETİ (StatusBadge)
  // "Teklif Kabul Edildi"/"Teklifiniz Kabul Edildi" metnini TAŞIMAMALI.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    // `sharedContext` job/teklif verilerini paylaşabilmek için tüm sayfalar
    // arasında AYNI localStorage'ı kullanıyor — bu yüzden Grup D'de giriş
    // yapılmış oturum (mehmet) burada da kalıcı olur. Gerçek bir "misafir"
    // (oturum yok) senaryosunu test etmek için önce session.ts'in kendi
    // anahtarını (malsevk.session.v1) TEMİZLİYORUZ — jobs/offers/users
    // verisine dokunmadan yalnızca oturumu kapatıyoruz.
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/ilanlar/${jobIds.a}`);
    const statusHeading = page.getByRole("heading", { name: "Operasyon Durumu" });
    await statusHeading.waitFor({ state: "visible", timeout: 10000 });

    const summaryText = await statusHeading.locator("xpath=..").locator("dl").innerText();
    assert.ok(/Teklif Kabul Edildi[\s\S]*0/.test(summaryText), "Misafirin özet sayılarında 'Teklif Kabul Edildi' 0 olmalı — gerçek kabul sayısı (2) hiç sızmamalı");

    const siblingCard = page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).locator("xpath=..");
    const statusCard = statusHeading.locator("xpath=..");
    const offersCard = page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
    // Yalnızca SATIR listelerine (ul[role='list'] li) bakılır — statusCard'ın
    // kendi `<dl>` özet ızgarası, değeri 0 olsa bile "Teklif Kabul Edildi"
    // kategori BAŞLIĞINI (bkz. yukarıdaki not) HER ZAMAN içerir; bu kasıtlı
    // ve güvenlidir, bu yüzden bilerek dışarıda tutulur.
    for (const card of [siblingCard, statusCard, offersCard]) {
      const rows = card.locator("ul[role='list'] li");
      assert.equal(await rows.getByText("Teklif Kabul Edildi", { exact: true }).count(), 0, "Misafir hiçbir satır rozetinde gerçek 'Teklif Kabul Edildi' metnini görmemeli");
      assert.equal(await rows.getByText("Teklifiniz Kabul Edildi", { exact: true }).count(), 0, "Misafirin kendi teklifi olamayacağı için 'Teklifiniz Kabul Edildi' de hiç görünmemeli");
    }
    ok("Misafir (oturumsuz) kullanıcı hiçbir satır rozetinde gerçek kabul bilgisini görmez, özet sayısı da 0'dır");

    await page.close();
  }

  // =====================================================================
  // GRUP F — Mevcut sistemler bozulmadı: teklif verme + tek hizmet ilanı
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await gotoCreateForm(page);
    await fillMainServiceCard(page, {
      category: "forklift",
      title: "Izolasyon Tek Hizmet Testi",
      description: "Bu ilan operationId TASIMAZ, teklif sistemi bozulmamali.",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await page.getByLabel("Operasyon Detayları").fill("Izolasyon tek hizmet testi operasyon detayi, en az on karakter.");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const singleJobId = page.url().split("/ilanlar/")[1];

    assert.equal(await page.getByRole("heading", { name: "Operasyon Durumu" }).count(), 0, "Tek hizmet ilanında operasyon kartları hiç görünmemeli");
    ok("Tek hizmetli ilan sistemi bozulmadı: operationId'siz ilanlarda operasyon kartları görünmez");

    const providerPage = await sharedContext.newPage();
    await loginAs(providerPage, "mert@test.com", "Mert123!", "/ilanlar");
    await providerPage.goto(`${BASE_URL}/ilanlar/${singleJobId}`);
    await providerPage.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 10000 });
    const beforeOffersCount = (await providerPage.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"))).length;
    await providerPage.getByLabel("Teklif Fiyatı").fill("2000");
    await providerPage.getByLabel("Tahmini Hizmet Süresi").fill("1 gün");
    await providerPage.getByLabel("Teklif Açıklaması").fill("İzolasyon düzeltmesi regresyon testi: teklif sistemi bozulmadı mı kontrolü.");
    await providerPage.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
    await providerPage.waitForFunction(
      (before) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").length > before,
      beforeOffersCount,
      { timeout: 10000 },
    );
    ok("Teklif verme sistemi bozulmadı: Hizmet Veren gerçek bir teklif gönderebiliyor");

    await providerPage.close();
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-operation-status-isolation-fix-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
