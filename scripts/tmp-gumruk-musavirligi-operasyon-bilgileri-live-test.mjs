// node scripts/tmp-gumruk-musavirligi-operasyon-bilgileri-live-test.mjs
//
// Gümrük Müşavirliği'ne özel "Operasyon Bilgileri" (İşlem Türü/Gümrük
// Müdürlüğü/Talep Edilen Hizmetler/Ürün Bilgileri/Evrak) özelliğinin uçtan
// uca doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium).
//
// Kapsanan senaryolar (bkz. görev tanımı §11):
//  1. Alanlar yalnızca Gümrük Müşavirliği seçildiğinde görünür.
//  2. Diğer hizmetlerde (Forklift) görünmez.
//  3/4/5. İşlem Türü / Gümrük Müdürlüğü / Ürün Cinsi girilmeden ilan
//     oluşturulamaz.
//  6. İlan detayında tüm bilgiler doğru gösterilir.
//  7. Gümrük müşaviri (onaylı lisanslı demo hesap) teklif vermeden önce tüm
//     bilgileri görebilir.
//  8. Çoklu operasyonda bilgiler yalnızca Gümrük Müşavirliği ilanına aittir
//     (kardeş Forklift kartına hiç sızmaz).
//  9. Eski (bu özellikten önce oluşturulmuş) bir Gümrük Müşavirliği ilanı
//     hata vermeden açılır (detay + düzenleme).
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

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

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

function categorySelect(page, index) {
  return page.getByLabel("Hizmet Kategorisi").nth(index);
}

async function customsFieldsVisible(page, index = 0) {
  return page.getByLabel("İşlem Türü").nth(index).isVisible().catch(() => false);
}

async function selectSearchable(page, labelText, index, optionText, exact = true) {
  await page.getByRole("button", { name: labelText, exact: true }).nth(index).click();
  const list = page.locator(`ul[aria-label="${labelText}"]`).nth(index);
  await list.waitFor({ state: "visible" });
  await list.getByRole("option", { name: optionText, exact }).first().click();
}

async function fillMainServiceLocation(page, index = 0) {
  await selectSearchable(page, "İlçe", index, "Dilovası");
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').nth(index).waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .nth(index)
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await page.getByLabel("Açık Adres").nth(index).fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
}

async function uploadOnePhoto(page) {
  // BİLEREK `.last()`: Gümrük Müşavirliği seçiliyken sayfada İKİ ayrı
  // `input[type="file"]` bulunur (paylaşılan "Operasyon Fotoğrafları" +
  // hizmet kartının kendi "Destekleyici Evraklar" evrak yükleyicisi) — DOM
  // sırasında paylaşılan fotoğraf alanı her zaman SON gelir (tüm hizmet
  // kartlarından sonra render edilir), bu yüzden `.first()` yanlış girdiye
  // (evrak yükleyicisine) isabet edebilir.
  const fileInput = page.locator('input[type="file"]').last();
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
  // "Sırada öne al" yalnızca status === "ready" olan bir JobPhotoCard'da
  // render edilir (bkz. job-photo-card.tsx) — sunucu işleme turunun
  // gerçekten bittiğinin güvenilir işareti; submit butonunun disabled
  // olmaması yalnızca photosProcessing bayrağını yansıtır ve dosya
  // seçilmeden önce de zaten false'tur, bu yüzden güvenilir bir bekleme
  // koşulu DEĞİLDİR.
  await page.getByRole("button", { name: "Sırada öne al" }).first().waitFor({ state: "visible", timeout: 15000 });
}

async function fillGumrukServiceCard(page, index) {
  await categorySelect(page, index).selectOption("gumruk-musavirligi");
  await page.getByLabel("İlan Başlığı").nth(index).fill("Gümrük Müşavirliği Test İlanı");
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .nth(index)
    .fill("Bu ilan Gümrük Müşavirliği operasyon bilgileri testinin bir parçasıdır.");
  await page.getByLabel("Başlangıç Tarihi").nth(index).fill("2026-08-10");
  await page.getByLabel("Bitiş Tarihi").nth(index).fill("2026-08-12");
  await fillMainServiceLocation(page, index);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  console.log("=== Senaryo 1/2: Kategoriye göre alan görünürlüğü ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);

  await categorySelect(page, 0).selectOption("forklift");
  assert.equal(await customsFieldsVisible(page), false, "Forklift: Gümrük alanları gizli olmalı");
  ok("İlgisiz kategoride (Forklift) Gümrük Müşavirliği alanları gizli");

  await categorySelect(page, 0).selectOption("gumruk-musavirligi");
  assert.equal(await customsFieldsVisible(page), true, "Gümrük Müşavirliği: alanlar görünür olmalı");
  assert.ok(await page.getByLabel("Gümrük Müdürlüğü").first().isVisible());
  assert.ok(await page.getByText("Talep Edilen Hizmetler", { exact: false }).first().isVisible());
  assert.equal(
    await page.getByLabel("Ürün Adedi").first().isVisible().catch(() => false),
    false,
    "Liman/Nakliye'ye özel Ürün Adedi alanı Gümrük Müşavirliği'nde görünmemeli",
  );
  ok("Gümrük Müşavirliği seçilince İşlem Türü/Gümrük Müdürlüğü/Talep Edilen Hizmetler görünür, Liman/Nakliye ürün alanları görünmüyor");

  await categorySelect(page, 0).selectOption("forklift");
  assert.equal(await customsFieldsVisible(page), false, "Forklift'e geri dönünce Gümrük alanları tekrar gizlenmeli");
  ok("Kategori tekrar değiştirilince Gümrük Müşavirliği alanları yeniden gizleniyor");

  console.log("\n=== Senaryo 3/4/5: Zorunlu alan doğrulaması ===");
  await fillGumrukServiceCard(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları", { exact: true }).fill("Saha erişimi ve ekipman bilgileri.");
  await page.locator('button[type="submit"]').click();

  await page.getByText("İşlem türünü seçiniz.", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
  assert.ok(await page.getByText("Gümrük müdürlüğünü seçiniz.", { exact: false }).first().isVisible());
  assert.ok(await page.getByText("Ürün cinsini giriniz.", { exact: false }).first().isVisible());
  assert.equal(page.url(), `${BASE_URL}/hizmet-talebi-olustur`, "Zorunlu alanlar boşken önizlemeye geçilmemeli");
  ok("İşlem Türü/Gümrük Müdürlüğü/Ürün Cinsi boşken ilan oluşturulamıyor, önizlemeye geçilmiyor");

  console.log("\n=== Zorunlu alanları doldurup yayınlama ===");
  await selectSearchable(page, "İşlem Türü", 0, "İthalat");
  await selectSearchable(page, "Gümrük Müdürlüğü", 0, "Dilovası Gümrük Müdürlüğü");
  await page
    .locator('[role="group"][aria-label*="Talep Edilen Hizmetler"]')
    .getByRole("button", { name: "İthalat Gümrükleme" })
    .click();
  await page.getByLabel("Ürün Cinsi").first().fill("Elektronik Eşya");
  await page.getByLabel("GTİP Kodu", { exact: false }).first().fill("8517.12.00.00.00");
  await page.getByLabel("Tahmini Beyan Kalem Sayısı", { exact: false }).first().fill("5");
  await page.getByLabel("Konteyner Sayısı", { exact: false }).first().fill("2");

  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.body.textContent.includes("Operasyon Özeti"), { timeout: 10000 });
  assert.ok(await page.getByText("İthalat", { exact: true }).first().isVisible());
  assert.ok(await page.getByText("Dilovası Gümrük Müdürlüğü", { exact: false }).first().isVisible());
  ok("Zorunlu alanlar doldurulunca önizlemeye geçiliyor, İşlem Türü/Gümrük Müdürlüğü özeti doğru gösteriliyor");

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  const jobUrl = page.url();
  const jobId = jobUrl.split("/ilanlar/")[1];
  ok(`İlan başarıyla yayınlandı (id: ${jobId})`);

  console.log("\n=== Senaryo 6: İlan detayında Gümrük Müşavirliği Bilgileri kartı ===");
  await page.getByText("Gümrük Müşavirliği Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await page.getByText("İthalat", { exact: true }).first().isVisible());
  assert.ok(await page.getByText("Dilovası Gümrük Müdürlüğü", { exact: false }).first().isVisible());
  assert.ok(await page.getByText("Elektronik Eşya", { exact: false }).first().isVisible());
  assert.ok(await page.getByText("8517.12.00.00.00", { exact: false }).first().isVisible());
  ok("İlan detay sayfasında İşlem Türü/Gümrük Müdürlüğü/Ürün Cinsi/GTİP doğru gösteriliyor");

  console.log("\n=== Senaryo 7: Gümrük müşaviri teklif vermeden önce bilgileri görebiliyor ===");
  await loginAs(page, "gumrukdemo@malsevk.demo", "Demo1234!", "/panel");
  await page.goto(jobUrl);
  await page.getByText("Gümrük Müşavirliği Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await page.getByText("Elektronik Eşya", { exact: false }).first().isVisible());
  assert.ok(await page.getByText("Teklif Ver", { exact: true }).first().isVisible());
  ok("Onaylı Gümrük Müşaviri hesabı, teklif vermeden ÖNCE tüm işlem bilgilerini görebiliyor");

  console.log("\n=== Senaryo 8: Çoklu Hizmet Operasyonu — kardeş karta sızma yok ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  await fillGumrukServiceCard(page, 0);
  await selectSearchable(page, "İşlem Türü", 0, "İhracat");
  await selectSearchable(page, "Gümrük Müdürlüğü", 0, "Derince Gümrük Müdürlüğü");
  await page.getByLabel("Ürün Cinsi").first().fill("Tekstil Ürünü");

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await categorySelect(page, 1).selectOption("forklift");
  assert.equal(
    await page.getByLabel("İşlem Türü").nth(1).isVisible().catch(() => false),
    false,
    "İkinci (Forklift) kart Gümrük alanlarını hiç göstermemeli",
  );
  assert.equal(await customsFieldsVisible(page, 0), true, "Birinci (Gümrük) kart kendi alanlarını göstermeye devam etmeli");
  ok("Aynı formda ikinci bir (Forklift) hizmet kartı eklenince Gümrük Müşavirliği alanları yalnızca kendi kartında kalıyor, kardeşe hiç sızmıyor");

  console.log("\n=== Senaryo 9: Eski (özellik öncesi) bir Gümrük Müşavirliği ilanı hatasız açılıyor ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
  const legacyJobId = await page.evaluate(() => {
    const raw = localStorage.getItem("malsevk.jobs.v1");
    const jobs = raw ? JSON.parse(raw) : [];
    const session = JSON.parse(localStorage.getItem("malsevk.session.v1") || "null");
    const id = crypto.randomUUID();
    // Bu özellikten ÖNCE oluşturulmuş bir Gümrük Müşavirliği ilanını simüle
    // eder — customsTransactionType/customsOfficeId/customsProductType/vb.
    // yedi alanın HİÇBİRİ yok (normalizeStoredJob'ın "eksikliği hata sayma"
    // ilkesini gerçek bir eski kayıtla doğrular).
    jobs.push({
      id,
      title: "Eski Gümrük Müşavirliği İlanı",
      category: "gumruk-musavirligi",
      province: "Kocaeli",
      district: "Dilovası",
      workLocationType: "Eski Test Tesisi",
      addressText: "Eski adres bilgisi, test mahallesi.",
      workDate: "2026-01-10",
      description: "Bu özellik eklenmeden önce oluşturulmuş bir ilan.",
      operationDetails: "Eski operasyon detayları.",
      status: "yayinda",
      requesterId: session ? session.id : null,
      photos: [],
    });
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    return id;
  });

  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`${BASE_URL}/ilanlar/${legacyJobId}`);
  await page.getByRole("heading", { name: "Eski Gümrük Müşavirliği İlanı" }).waitFor({ state: "visible", timeout: 10000 });
  // Kategori hâlâ Gümrük Müşavirliği olduğu için kart render edilmeye devam
  // eder (hasProductInfo'nun aksine bir "veri var mı" ön-koşulu yok) — ama
  // eksik alanlar "-" ile güvenle gösterilir, çökme/`undefined` metni YOK.
  await page.getByText("Gümrük Müşavirliği Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  const cardText = await page
    .getByText("Gümrük Müşavirliği Bilgileri", { exact: true })
    .locator("..")
    .locator("..")
    .textContent();
  assert.ok(cardText.includes("-"), "Eksik alanlar '-' ile gösterilmeli");
  assert.ok(!cardText.includes("undefined"), "Eksik alanlar asla 'undefined' metni göstermemeli");
  ok("Eski ilanın detay sayfası hatasız açılıyor, eksik Gümrük alanları '-' ile gösteriliyor (undefined/çökme yok)");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${legacyJobId}/duzenle`);
  await page.getByLabel("İlan Başlığı").first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByLabel("İşlem Türü").first().inputValue().catch(() => ""), "");
  ok("Eski ilanın düzenleme formu hatasız açılıyor, Gümrük alanları boş (undefined) olarak ön dolduruluyor");

  assert.equal(consoleErrors.length, 0, `Beklenmeyen sayfa hataları: ${consoleErrors.join(", ")}`);
  ok("Konsolda beklenmeyen bir JS hatası oluşmadı");

  await browser.close();
  console.log(`\n${passed} kontrol PASSED.`);
}

main().catch((error) => {
  console.error("TEST FAILED:", error);
  process.exit(1);
});
