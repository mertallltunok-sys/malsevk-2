// node scripts/tmp-product-info-fields-test.mjs
//
// "Ürün Bilgileri" (Ürün Adedi/Tonaj/Ürün Cinsi) özelliğinin uçtan uca
// doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium).
//
// Kapsanan senaryolar:
//  A. Kategoriye göre alanların görünürlüğü: ilgisiz kategoride gizli;
//     Liman Hizmetleri eşlemesindeki (Lashing/Gözetim/Forklift/Depolama)
//     her kategoride görünür ve Tonaj isteğe bağlı; Nakliye'de görünür ve
//     Tonaj zorunlu.
//  B. Ürün Cinsi combobox: yazarken filtreleme, listeden seçim, listede
//     olmayan serbest bir değerin de kabul edilmesi.
//  C. Tek hizmetli ilan oluşturma: ürün bilgisiyle birlikte yayınlama, ilan
//     detay sayfasında "Ürün Bilgileri" kartının doğru gösterimi.
//  D. Hizmet Veren tarafı: Aktif İlanlar listesinde kompakt gösterim,
//     Teklif Ver panelinde ürün bilgisi gösterimi.
//  E. Gelen Teklifler ekranında ürün bilgisi satırı.
//  F. İlan düzenleme: mevcut değerlerin doğru ön-doldurulması ve güncelleme.
//  G. Çoklu Hizmet Operasyonu: her hizmetin kendi ürün bilgisini bağımsız
//     saklaması (bir hizmette var, diğerinde yok).
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

async function productFieldsVisible(page, index = 0) {
  return page.getByLabel("Ürün Adedi").nth(index).isVisible().catch(() => false);
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function fillMainServiceLocation(page, index = 0) {
  await page.getByRole("button", { name: "İlçe", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="İlçe"]').nth(index).waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').nth(index).getByRole("option", { name: "Dilovası", exact: true }).click();
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

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  console.log("=== A. Kategoriye göre görünürlük ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);

  await categorySelect(page, 0).selectOption("vinc-operatoru");
  assert.equal(await productFieldsVisible(page), false, "vinc-operatoru: ürün alanları gizli olmalı");
  ok("İlgisiz kategoride (Vinç Operatörü) ürün bilgisi alanları gizli");

  const limanCases = [
    ["lashing", "Lashing"],
    ["yukleme-gozetimi", "Gözetim (Yükleme Gözetimi)"],
    ["bosaltma-gozetimi", "Gözetim (Boşaltma Gözetimi)"],
    ["forklift", "Forklift (İş Makinesi)"],
    ["forklift-operatoru", "Forklift (Operatör)"],
    ["konteyner-dolum", "Konteyner Dolum"],
    ["konteyner-bosaltim", "Konteyner Boşaltım"],
    ["genel-depolama", "Depolama (Genel Depolama)"],
    ["soguk-hava-depolama", "Depolama (Soğuk Hava Depolama)"],
  ];
  for (const [categoryId, label] of limanCases) {
    await categorySelect(page, 0).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), true, `${label}: ürün alanları görünür olmalı`);
    const tonnageLabel = await page.getByText("Tonaj", { exact: false }).first().textContent();
    assert.ok(tonnageLabel.includes("isteğe bağlı"), `${label}: Tonaj isteğe bağlı etiketi görünmeli`);
    ok(`${label}: ürün bilgisi alanları görünür, Tonaj isteğe bağlı`);
  }

  await categorySelect(page, 0).selectOption("nakliye");
  assert.equal(await productFieldsVisible(page), true, "nakliye: ürün alanları görünür olmalı");
  const nakliyeTonnageLabel = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(!nakliyeTonnageLabel.includes("isteğe bağlı"), "Nakliye: Tonaj ZORUNLU olmalı (isteğe bağlı etiketi olmamalı)");
  ok("Nakliye: ürün bilgisi alanları görünür, Tonaj zorunlu");

  console.log("\n=== B. Ürün Cinsi combobox ===");
  await categorySelect(page, 0).selectOption("lashing");
  const productTypeInput = page.getByLabel("Ürün Cinsi").first();
  await productTypeInput.click();
  await productTypeInput.fill("Rulo");
  await page.locator('ul[role="listbox"]').first().waitFor({ state: "visible" });
  const ruloOption = page.locator('ul[role="listbox"]').first().getByRole("option", { name: "Rulo Sac", exact: true });
  await ruloOption.waitFor({ state: "visible", timeout: 5000 });
  await ruloOption.click();
  assert.equal(await productTypeInput.inputValue(), "Rulo Sac");
  ok("Listeden filtreleyip seçim çalışıyor (Rulo Sac)");

  await productTypeInput.fill("");
  await productTypeInput.fill("Özel Test Ürünü XYZ");
  await page.keyboard.press("Escape");
  assert.equal(await productTypeInput.inputValue(), "Özel Test Ürünü XYZ");
  ok("Listede olmayan serbest bir değer de kabul ediliyor");

  console.log("\n=== C. Tek hizmetli ilan oluşturma + detay sayfası ===");
  await categorySelect(page, 0).selectOption("lashing");
  await page.getByLabel("İlan Başlığı").first().fill("Ürün Bilgisi Test İlanı");
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Bu ilan ürün bilgisi testinin bir parçasıdır, en az yirmi karakter.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-10");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-10");
  await page.getByLabel("Ürün Adedi").first().fill("120");
  await page.getByLabel("Tonaj", { exact: false }).first().fill("8,5");
  await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Test operasyon detaylari, en az on karakter olmali.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  assert.ok((await page.getByText("120 adet").first().textContent()).length > 0, "Önizlemede ürün adedi görünmeli");
  ok("Önizleme ekranında ürün bilgileri doğru gösteriliyor");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });

  const jobUrl = page.url();
  const jobId = jobUrl.split("/").pop();
  await page.getByRole("heading", { name: "Ürün Bilgileri" }).waitFor({ state: "visible", timeout: 10000 });
  const detailCardText = await page.locator("text=Ürün Bilgileri").locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]").first().textContent();
  assert.ok(detailCardText.includes("120 adet"), "Detay sayfasında ürün adedi görünmeli");
  assert.ok(detailCardText.includes("ton"), "Detay sayfasında tonaj görünmeli");
  assert.ok(detailCardText.includes("Rulo Sac"), "Detay sayfasında ürün cinsi görünmeli");
  ok("İlan detay sayfasında 'Ürün Bilgileri' kartı doğru gösteriliyor");

  const jobsAfterCreate = await getStoredJobs(page);
  const createdJob = jobsAfterCreate.find((job) => job.id === jobId);
  assert.equal(createdJob.productQuantity, 120);
  assert.equal(createdJob.productTonnage, 8.5);
  assert.equal(createdJob.productType, "Rulo Sac");
  ok("localStorage kaydında productQuantity/productTonnage/productType doğru");

  console.log("\n=== D. Hizmet Veren: liste + Teklif Ver paneli ===");
  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByText("Ürün Bilgisi Test İlanı").first().waitFor({ state: "visible", timeout: 10000 });
  const listingRowText = await page
    .getByText("Ürün Bilgisi Test İlanı")
    .first()
    .locator("xpath=ancestor::tr[1] | ancestor::li[1]")
    .first()
    .textContent();
  assert.ok(listingRowText.includes("120 adet"), "Aktif İlanlar listesinde ürün bilgisi kompakt olarak görünmeli");
  ok("Aktif İlanlar listesinde ürün bilgisi kompakt satırı görünüyor");

  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  const offerPanelText = await page.locator("text=Teklif Fiyatı").locator("xpath=ancestor::div[contains(@class,'flex flex-col gap-4')][1]").first().textContent().catch(() => "");
  const offerSectionText = await page.locator("main, body").first().textContent();
  assert.ok(offerSectionText.includes("120 adet") && offerSectionText.includes("Rulo Sac"), "Teklif Ver panelinde ürün bilgisi görünmeli");
  ok("Teklif Ver panelinde ürün bilgisi gösteriliyor");

  await page.getByLabel("Teklif Fiyatı").fill("15000");
  await page.getByLabel("Teklif Açıklaması").fill("Test teklifi - urun bilgisi dogrulamasi icin gonderildi.");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("1 iş günü");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
  ok("Teklif başarıyla gönderildi");

  console.log("\n=== E. Gelen Teklifler ekranı ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByText("Ürün Bilgisi Test İlanı").first().waitFor({ state: "visible", timeout: 10000 });
  const incomingOfferSectionText = await page.locator("main, body").first().textContent();
  assert.ok(incomingOfferSectionText.includes("120 adet"), "Gelen Teklifler ekranında ürün bilgisi satırı görünmeli");
  ok("Gelen Teklifler ekranında ürün bilgisi satırı görünüyor");

  console.log("\n=== F. İlan düzenleme ===");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${jobId}/duzenle`);
  await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByLabel("Ürün Adedi").first().inputValue(), "120");
  assert.equal(await page.getByLabel("Ürün Cinsi").first().inputValue(), "Rulo Sac");
  const tonnageValueInEdit = await page.getByLabel("Tonaj", { exact: false }).first().inputValue();
  assert.ok(tonnageValueInEdit === "8.5" || tonnageValueInEdit === "8,5", `Tonaj ön-doldurulmalı, gelen: ${tonnageValueInEdit}`);
  ok("Düzenleme ekranında mevcut ürün bilgileri doğru ön-dolduruluyor");

  await page.getByLabel("Ürün Adedi").first().fill("200");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
  const jobsAfterEdit = await getStoredJobs(page);
  const editedJob = jobsAfterEdit.find((job) => job.id === jobId);
  assert.equal(editedJob.productQuantity, 200);
  ok("Ürün adedi düzenleme sonrası güncellendi (200)");

  console.log("\n=== G. Çoklu Hizmet Operasyonu: bağımsız ürün bilgisi ===");
  await gotoCreateForm(page);
  await categorySelect(page, 0).selectOption("lashing");
  await page.getByLabel("İlan Başlığı").first().fill("Operasyon Ana Hizmet");
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Ana hizmet aciklamasi, en az yirmi karakter olmali burada.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-12");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-12");
  await page.getByLabel("Ürün Adedi").first().fill("50");
  await page.getByLabel("Ürün Cinsi").first().fill("Boru");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await categorySelect(page, 1).selectOption("vinc-operatoru");
  await page.getByLabel("İlan Başlığı").nth(1).fill("Operasyon Ek Hizmet");
  await page.getByLabel("Hizmete Özel Açıklama").nth(1).fill("Ek hizmet aciklamasi, en az yirmi karakter olmali burada da.");
  await page.getByLabel("Başlangıç Tarihi").nth(1).fill("2026-08-12");
  await page.getByLabel("Bitiş Tarihi").nth(1).fill("2026-08-12");
  assert.equal(await productFieldsVisible(page, 1), false, "Ek hizmet (Vinç Operatörü) ürün alanları göstermemeli");
  ok("Ek hizmette (ilgisiz kategori) ürün bilgisi alanları hiç görünmüyor");

  await page.getByLabel("Operasyon Detayları").fill("Coklu operasyon detaylari, en az on karakter burada.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Hizmet İlanını Yayınla/ }).click();
  await page.waitForURL(/operasyonIlanSayisi=2/, { timeout: 15000 });

  const jobsAfterOperation = await getStoredJobs(page);
  const mainService = jobsAfterOperation.find((job) => job.title === "Operasyon Ana Hizmet");
  const extraService = jobsAfterOperation.find((job) => job.title === "Operasyon Ek Hizmet");
  assert.ok(mainService, "Ana hizmet ilanı oluşturulmalı");
  assert.ok(extraService, "Ek hizmet ilanı oluşturulmalı");
  assert.equal(mainService.productQuantity, 50);
  assert.equal(mainService.productType, "Boru");
  assert.equal(extraService.productQuantity, undefined);
  assert.equal(extraService.productType, undefined);
  assert.equal(mainService.operationId, extraService.operationId);
  ok("Operasyondaki her hizmet kendi ürün bilgisini bağımsız saklıyor (biri var, diğeri yok)");

  console.log(`\n[tmp-product-info-fields-test] ${passed} test geçti.`);
  await browser.close();
}

main().catch(async (error) => {
  console.error("[tmp-product-info-fields-test] HATA:", error);
  process.exitCode = 1;
});
