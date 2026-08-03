// node scripts/tmp-product-info-scope-fix-test.mjs
//
// "Ürün Bilgileri" özelliğinin kapsam düzeltmesinin doğrulaması:
//  1. Hizmet Veren ilan detayında mükerrer "Ürün Bilgileri" kartı gösterimi
//     giderildi (yalnızca sol taraftaki bağımsız kart kalır, Teklif Ver
//     panelindeki ikinci kart tamamen kaldırıldı).
//  2. Ürün bilgisi kapsamı KESİN olarak altı gerçek liman hizmetiyle
//     sınırlandırıldı (Lashing, Unlashing, Yükleme/Boşaltma Gözetimi,
//     Konteyner Dolum/Boşaltım) — Depolama/Forklift/Nakliye ve diğer tüm
//     kategoriler artık kapsam DIŞI (product-catalog.ts#PORT_SERVICE_CATEGORY_IDS).
//
// Kapsanan senaryolar (görev tanımındaki 1-11 ile eşleşir):
//  1-2. Lashing ilanında ürün bilgileri yalnızca sol tarafta, tek kart.
//  3-5. Yükleme Gözetimi / Boşaltma Gözetimi / Konteyner Dolum / Konteyner
//       Boşaltım ilanlarında ürün bilgileri görünür.
//  6-8. Forklift / Depolama / Nakliye ilanlarında ürün bilgileri görünmez.
//  9.   Çoklu operasyonda ürün bilgileri yalnızca liman hizmeti olan kardeş
//       ilana yazılır.
//  10.  İlan düzenlenirken liman hizmetinden liman dışı hizmete geçilirse
//       ürün bilgileri temizlenir, doğrulama kalkar.
//  11.  Mobil ve masaüstünde mükerrer gösterim oluşmaz.
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

async function createSingleJob(page, { category, title, quantity }) {
  await gotoCreateForm(page);
  await categorySelect(page, 0).selectOption(category);
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Kapsam duzeltme testi icin aciklama, yirmi karakterden uzun.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-15");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-15");
  if (quantity !== undefined) {
    await page.getByLabel("Ürün Adedi").first().fill(String(quantity));
    await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
  }
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Kapsam duzeltme operasyon detaylari, on karakterden uzun.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  return page.url().split("/").pop();
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  console.log("=== Kapsam: form alanı görünürlüğü ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);

  const inScope = [
    ["lashing", "Lashing"],
    ["unlashing", "Unlashing"],
    ["yukleme-gozetimi", "Yükleme Gözetimi"],
    ["bosaltma-gozetimi", "Boşaltma Gözetimi"],
    ["konteyner-dolum", "Konteyner Dolum"],
    ["konteyner-bosaltim", "Konteyner Boşaltım"],
  ];
  for (const [categoryId, label] of inScope) {
    await categorySelect(page, 0).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), true, `${label}: ürün alanları görünür olmalı`);
    ok(`${label}: kapsamda, ürün bilgisi alanları görünür (senaryo 3-5)`);
  }

  const outOfScope = [
    ["forklift", "Forklift (İş Makinesi)"],
    ["forklift-operatoru", "Forklift (Operatör)"],
    ["genel-depolama", "Depolama (Genel Depolama)"],
    ["nakliye", "Nakliye"],
    ["vinc-operatoru", "Vinç Operatörü"],
    ["liman-personeli", "Liman Personeli (grupta ama listede YOK)"],
  ];
  for (const [categoryId, label] of outOfScope) {
    await categorySelect(page, 0).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), false, `${label}: ürün alanları GİZLİ olmalı`);
    ok(`${label}: kapsam dışı, ürün bilgisi alanları görünmez (senaryo 6-8)`);
  }

  console.log("\n=== Lashing ilanı oluştur + mükerrer gösterim kontrolü ===");
  const lashingJobId = await createSingleJob(page, { category: "lashing", title: "Kapsam Test Lashing", quantity: 75 });
  ok("Lashing ilanı ürün bilgisiyle oluşturuldu");

  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  await page.goto(`${BASE_URL}/ilanlar/${lashingJobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  let productHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(productHeadingCount, 1, `Masaüstünde tam olarak 1 "Ürün Bilgileri" kartı olmalı, bulunan: ${productHeadingCount}`);
  ok('Masaüstünde "Ürün Bilgileri" yalnızca BİR kez görünüyor (senaryo 1-2)');

  const offerFormText = await page.locator("main, body").first().textContent();
  assert.ok(offerFormText.includes("Teklif Fiyatı") && offerFormText.includes("Teklif Açıklaması") && offerFormText.includes("Tahmini Hizmet Süresi"), "Teklif formu alanları değişmemiş olmalı");
  ok("Teklif Ver formunun kendi alanları (fiyat/açıklama/süre) değişmedi");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  productHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(productHeadingCount, 1, `Mobilde tam olarak 1 "Ürün Bilgileri" kartı olmalı, bulunan: ${productHeadingCount}`);
  ok('Mobil görünümde de "Ürün Bilgileri" yalnızca BİR kez görünüyor (senaryo 11)');
  await page.setViewportSize({ width: 1440, height: 1000 });

  console.log("\n=== Kapsam dışı ilanlarda hiç kart görünmemeli ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  const forkliftJobId = await createSingleJob(page, { category: "forklift", title: "Kapsam Test Forklift" });
  const depolamaJobId = await createSingleJob(page, { category: "genel-depolama", title: "Kapsam Test Depolama" });
  const nakliyeJobId = await createSingleJob(page, { category: "nakliye", title: "Kapsam Test Nakliye" });

  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  for (const [jobId, label] of [
    [forkliftJobId, "Forklift"],
    [depolamaJobId, "Depolama"],
    [nakliyeJobId, "Nakliye"],
  ]) {
    await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
    await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
    const count = await page.getByText("Ürün Bilgileri", { exact: true }).count();
    assert.equal(count, 0, `${label}: hiç "Ürün Bilgileri" kartı görünmemeli, bulunan: ${count}`);
    ok(`${label} ilanında ürün bilgileri hiç görünmüyor (senaryo 6-8)`);
  }

  const jobsAfterOutOfScope = await getStoredJobs(page);
  const forkliftJob = jobsAfterOutOfScope.find((job) => job.id === forkliftJobId);
  const depolamaJob = jobsAfterOutOfScope.find((job) => job.id === depolamaJobId);
  const nakliyeJob = jobsAfterOutOfScope.find((job) => job.id === nakliyeJobId);
  for (const [job, label] of [[forkliftJob, "Forklift"], [depolamaJob, "Depolama"], [nakliyeJob, "Nakliye"]]) {
    assert.equal(job.productQuantity, undefined, `${label}: productQuantity kaydedilmemiş olmalı`);
    assert.equal(job.productType, undefined, `${label}: productType kaydedilmemiş olmalı`);
  }
  ok("Kapsam dışı kategorilerde ürün bilgisi kaydedilen iş nesnesine hiç yazılmadı");

  console.log("\n=== Çoklu Hizmet Operasyonu: bağımsız kapsam ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  await categorySelect(page, 0).selectOption("lashing");
  await page.getByLabel("İlan Başlığı").first().fill("Kapsam Operasyon Lashing");
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Lashing hizmeti aciklamasi, yirmi karakterden uzun olmali.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-16");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-16");
  await page.getByLabel("Ürün Adedi").first().fill("30");
  await page.getByLabel("Ürün Cinsi").first().fill("Profil");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await categorySelect(page, 1).selectOption("forklift");
  await page.getByLabel("İlan Başlığı").nth(1).fill("Kapsam Operasyon Forklift");
  await page.getByLabel("Hizmete Özel Açıklama").nth(1).fill("Forklift hizmeti aciklamasi, yirmi karakterden uzun olmali da.");
  await page.getByLabel("Başlangıç Tarihi").nth(1).fill("2026-08-16");
  await page.getByLabel("Bitiş Tarihi").nth(1).fill("2026-08-16");
  assert.equal(await productFieldsVisible(page, 1), false, "Forklift kardeş hizmette ürün alanları görünmemeli");

  await page.getByLabel("Operasyon Detayları").fill("Kapsam operasyon detaylari, on karakterden uzun olmali.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Hizmet İlanını Yayınla/ }).click();
  await page.waitForURL(/operasyonIlanSayisi=2/, { timeout: 15000 });

  const jobsAfterOp = await getStoredJobs(page);
  const opLashing = jobsAfterOp.find((job) => job.title === "Kapsam Operasyon Lashing");
  const opForklift = jobsAfterOp.find((job) => job.title === "Kapsam Operasyon Forklift");
  assert.equal(opLashing.productQuantity, 30);
  assert.equal(opLashing.productType, "Profil");
  assert.equal(opForklift.productQuantity, undefined);
  assert.equal(opForklift.productType, undefined);
  assert.equal(opLashing.operationId, opForklift.operationId);
  ok("Operasyonda ürün bilgisi yalnızca liman hizmeti olan kardeş ilana yazıldı (senaryo 9)");

  console.log("\n=== İlan düzenleme: liman hizmetinden liman dışına geçiş ===");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${lashingJobId}/duzenle`);
  await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByLabel("Ürün Adedi").first().inputValue(), "75");
  await page.getByLabel("Hizmet Kategorisi").selectOption("vinc-operatoru");
  assert.equal(await page.getByLabel("Ürün Adedi").first().isVisible().catch(() => false), false, "Kategori değişince ürün alanları hemen kaybolmalı");
  ok("Düzenlemede kategori liman dışına çevrilince ürün bilgisi alanları hemen kayboluyor");

  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
  const jobsAfterScopeChange = await getStoredJobs(page);
  const changedJob = jobsAfterScopeChange.find((job) => job.id === lashingJobId);
  assert.equal(changedJob.category, "vinc-operatoru");
  assert.equal(changedJob.productQuantity, undefined);
  assert.equal(changedJob.productTonnage, undefined);
  assert.equal(changedJob.productType, undefined);
  ok("Kaydetme başarılı oldu (doğrulama engellemedi) VE eski ürün bilgisi tamamen temizlendi (senaryo 10)");

  console.log(`\n[tmp-product-info-scope-fix-test] ${passed} test geçti.`);
  await browser.close();
}

main().catch(async (error) => {
  console.error("[tmp-product-info-scope-fix-test] HATA:", error);
  process.exitCode = 1;
});
