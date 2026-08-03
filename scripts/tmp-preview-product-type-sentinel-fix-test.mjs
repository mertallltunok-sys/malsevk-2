// Y1 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden: job-request-form.tsx'in Operasyon Önizlemesi'nde "Ürün Cinsi"
// için "Listede Yok, Kendim Gireceğim" seçilip özel bir metin girildiğinde,
// önizleme kartı `service.productType`'ı OLDUĞU GİBİ basıyordu — sentinel
// değer (`product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE`, "__ozel_urun_cinsi__")
// hiç çözümlenmeden kullanıcıya ham bir dahili kod olarak gösteriliyordu.
// Gümrük Müşavirliği bloğundaki eşdeğer alan aynı durumu doğru (ternary ile)
// çözüyordu — bu bir tutarsızlık/gözden kaçmaydı.
//
// Düzeltme: job-request-form.tsx'teki önizleme artık Gümrük Müşavirliği
// bloğüyle AYNI ternary desenini kullanıyor (`service.productType ===
// PRODUCT_TYPE_CUSTOM_VALUE ? service.productTypeCustomText : service.productType`).
// Gerçek kayıt (Job.productType) bu düzeltmeden ÖNCE de doğru çözümleniyordu
// (resolveProductInfoPayload, yalnızca handlePublish'ten çağrılır) — bu test
// hem önizlemeyi hem de kaydedilen veriyi doğrular.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SENTINEL_VALUE = "__ozel_urun_cinsi__";
const CUSTOM_PRODUCT_TEXT = "Y1 Regresyon Özel Ürün Cinsi";
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
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

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("lashing-unlashing");

    await page.getByLabel("İlan Başlığı").first().fill(`Y1 Sentinel Test İlanı ${STAMP}`);
    await page
      .getByLabel("Hizmete Özel Açıklama")
      .first()
      .fill("Bu ilan Y1 önizleme sentinel düzeltmesi testinin bir parçasıdır, en az yirmi karakter.");
    await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-10");
    await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-10");
    await page.getByLabel("Ürün Adedi").first().fill("42");

    // "Listede Yok, Kendim Gireceğim" seçilir -> combobox manuel input'a döner.
    const productTypeInput = page.getByLabel("Ürün Cinsi").first();
    await productTypeInput.click();
    await page.getByRole("option", { name: "Listede Yok, Kendim Gireceğim" }).first().click();
    const manualProductTypeInput = page.getByLabel("Ürün Cinsi").first();
    await manualProductTypeInput.fill(CUSTOM_PRODUCT_TEXT);

    await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
    await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
    await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().waitFor({ state: "visible" });
    await page
      .locator('ul[aria-label="Liman / Sanayi / OSB"]')
      .first()
      .getByRole("option", { name: "Beldeport", exact: false })
      .first()
      .click();
    await page.getByLabel("Açık Adres").first().fill("Test Mahallesi, Test Caddesi No:1, Dilovası");

    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });

    const previewBodyText = await page.locator("body").innerText();
    check(
      "1 (Y1 asıl regresyon): Önizlemede ham sentinel değer ('__ozel_urun_cinsi__') GÖRÜNMÜYOR",
      !previewBodyText.includes(SENTINEL_VALUE),
    );
    check(
      "2: Önizlemede girilen özel ürün cinsi metni doğru gösteriliyor",
      previewBodyText.includes(CUSTOM_PRODUCT_TEXT),
    );

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
    const jobId = page.url().split("/").pop();

    const createdJob = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((job) => job.id === id),
      jobId,
    );
    check(
      "3: Kaydedilen ilanda productType SENTINEL değil, gerçek özel metin (bu düzeltmeden bağımsız zaten doğruydu — regresyon kontrolü)",
      createdJob?.productType === CUSTOM_PRODUCT_TEXT,
      `productType="${createdJob?.productType}"`,
    );

    await page.getByRole("heading", { name: "Ürün Bilgileri" }).waitFor({ state: "visible", timeout: 10000 });
    const detailBodyText = await page.locator("body").innerText();
    check(
      "4: İlan detay sayfasında da özel ürün cinsi metni doğru gösteriliyor, sentinel görünmüyor",
      detailBodyText.includes(CUSTOM_PRODUCT_TEXT) && !detailBodyText.includes(SENTINEL_VALUE),
    );

    check("5: Hiçbir uncaught JS hatası oluşmadı", jsErrors.length === 0, jsErrors.join(" | "));

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[preview-product-type-sentinel-fix-test] GENEL HATA:", error);
  process.exitCode = 1;
});
