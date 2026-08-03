// node scripts/tmp-product-info-nakliye-expansion-test.mjs
//
// "Ürün Bilgileri" kapsamının Nakliye'yi de içerecek şekilde genişletilmesinin
// doğrulaması — product-catalog.ts artık `isPortServiceCategory` (6 liman
// kategorisi) ve `isTransportationCategory` (Nakliye) olmak üzere İKİ ayrı
// kontrolü `requiresProductInfo` (birleşim) ve `isTonnageRequired` (yalnızca
// Nakliye) üzerinden birleştiriyor.
//
// Kapsanan senaryolar (görev tanımındaki 1-11 ile eşleşir):
//  1-2. Lashing ilanında ürün bilgileri tek kart, tonaj boş bırakılabilir.
//  3-5. Nakliye ilanında ürün bilgileri tek kart; tonaj/adet/cins boşsa
//       yayınlanamaz.
//  6-7. Yükleme/Boşaltma Gözetimi, Konteyner Dolum/Boşaltım'da görünür.
//  8.   Forklift ve Depolama'da görünmez.
//  9.   Teklif Ver formunda ikinci kart oluşmaz.
//  10.  Çoklu operasyonda (Lashing + Nakliye + Forklift) bilgiler yalnızca
//       ilgili ilanlara, kendi kurallarıyla kaydedilir.
//  11.  Mobil/masaüstünde mükerrer gösterim yok.
// + Hizmet değişikliği (Liman<->Nakliye tonaj zorunluluğu, kapsam dışına
//   geçişte temizlenme) ve eski Nakliye kaydında tonaj eksikliğinin hata
//   vermemesi.
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

async function fillCommonSingleFields(page, title) {
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Nakliye genisletme testi icin aciklama, yirmi karakterden uzun.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-20");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-20");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Nakliye genisletme operasyon detaylari, on karakterden uzun.");
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  console.log("=== Kapsam: form alanı görünürlüğü (senaryo 6-8) ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);

  for (const [categoryId, label] of [
    ["yukleme-gozetimi", "Yükleme Gözetimi"],
    ["bosaltma-gozetimi", "Boşaltma Gözetimi"],
    ["konteyner-dolum", "Konteyner Dolum"],
    ["konteyner-bosaltim", "Konteyner Boşaltım"],
    ["nakliye", "Nakliye"],
  ]) {
    await categorySelect(page, 0).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), true, `${label}: ürün alanları görünür olmalı`);
    ok(`${label}: ürün bilgisi alanları görünür (senaryo 6-7 / Nakliye kapsama girdi)`);
  }

  for (const [categoryId, label] of [
    ["forklift", "Forklift"],
    ["genel-depolama", "Depolama"],
  ]) {
    await categorySelect(page, 0).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), false, `${label}: ürün alanları GİZLİ olmalı`);
    ok(`${label}: ürün bilgisi alanları görünmez (senaryo 8)`);
  }

  console.log("\n=== Nakliye: tonaj etiketi ZORUNLU görünmeli ===");
  await categorySelect(page, 0).selectOption("nakliye");
  const nakliyeTonnageLabelText = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(!nakliyeTonnageLabelText.includes("isteğe bağlı"), "Nakliye: Tonaj etiketi ZORUNLU görünmeli (isteğe bağlı yazmamalı)");
  ok("Nakliye kategorisinde Tonaj etiketi zorunlu olarak gösteriliyor");

  await categorySelect(page, 0).selectOption("lashing");
  const lashingTonnageLabelText = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(lashingTonnageLabelText.includes("isteğe bağlı"), "Lashing: Tonaj etiketi isteğe bağlı görünmeli");
  ok("Lashing kategorisinde Tonaj etiketi isteğe bağlı olarak gösteriliyor");

  console.log("\n=== Senaryo 4-5: Nakliye ilanı eksik zorunlu alanla yayınlanamaz ===");
  await categorySelect(page, 0).selectOption("nakliye");
  await fillCommonSingleFields(page, "Nakliye Eksik Alan Testi");
  await page.getByLabel("Ürün Adedi").first().fill("10");
  // Tonaj VE Ürün Cinsi BİLEREK boş bırakıldı.
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  const stillOnFormAfterMissingTonnage = await page.getByRole("heading", { name: "Operasyon Özeti" }).isVisible().catch(() => false);
  assert.equal(stillOnFormAfterMissingTonnage, false, "Tonaj/Ürün Cinsi eksikken önizlemeye geçilmemeli");
  const tonnageErrorVisible = await page.getByText("Tonaj bilgisini giriniz.").first().isVisible().catch(() => false);
  assert.equal(tonnageErrorVisible, true, "Tonaj zorunlu hata mesajı görünmeli");
  ok("Nakliye ilanında tonaj boşken yayınlama engelleniyor, hata mesajı gösteriliyor (senaryo 4)");

  await page.getByLabel("Tonaj", { exact: false }).first().fill("12,5");
  // Ürün Cinsi hâlâ boş.
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  const stillOnFormAfterMissingType = await page.getByRole("heading", { name: "Operasyon Özeti" }).isVisible().catch(() => false);
  assert.equal(stillOnFormAfterMissingType, false, "Ürün Cinsi eksikken önizlemeye geçilmemeli");
  ok("Nakliye ilanında ürün adedi/cinsi eksikken de yayınlama engelleniyor (senaryo 5)");

  console.log("\n=== Nakliye ilanını eksiksiz oluştur + mükerrer gösterim kontrolü (senaryo 3, 9) ===");
  await page.getByLabel("Ürün Cinsi").first().fill("Konteyner Yükü");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  const nakliyeJobId = page.url().split("/").pop();
  ok("Nakliye ilanı ürün adedi + tonaj + ürün cinsiyle başarıyla yayınlandı");

  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  let productHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(productHeadingCount, 1, `Nakliye ilanında masaüstünde tam 1 "Ürün Bilgileri" kartı olmalı, bulunan: ${productHeadingCount}`);
  ok('Nakliye ilanında "Ürün Bilgileri" masaüstünde yalnızca BİR kez görünüyor (senaryo 3, 9)');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  productHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(productHeadingCount, 1, `Mobilde tam 1 "Ürün Bilgileri" kartı olmalı, bulunan: ${productHeadingCount}`);
  ok('Nakliye ilanında mobilde de yalnızca BİR kez görünüyor (senaryo 11)');
  await page.setViewportSize({ width: 1440, height: 1000 });

  console.log("\n=== Senaryo 1-2: Lashing ilanı, tonaj boş bırakılabilir, tek kart ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  await categorySelect(page, 0).selectOption("lashing");
  await fillCommonSingleFields(page, "Lashing Genisletme Testi");
  await page.getByLabel("Ürün Adedi").first().fill("40");
  await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
  // Tonaj BİLEREK boş bırakıldı.
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  const lashingJobId = page.url().split("/").pop();
  ok("Lashing ilanı tonaj boşken başarıyla yayınlandı (senaryo 2)");

  const jobsAfterLashing = await getStoredJobs(page);
  const lashingJob = jobsAfterLashing.find((job) => job.id === lashingJobId);
  assert.equal(lashingJob.productTonnage, undefined);
  ok("Lashing kaydında productTonnage undefined (kaydedilmedi)");

  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  await page.goto(`${BASE_URL}/ilanlar/${lashingJobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  const lashingHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(lashingHeadingCount, 1, `Lashing ilanında tam 1 kart olmalı, bulunan: ${lashingHeadingCount}`);
  ok('Lashing ilanında "Ürün Bilgileri" yalnızca BİR kez görünüyor (senaryo 1)');

  console.log("\n=== Senaryo 10: Çoklu operasyon (Lashing + Nakliye + Forklift) ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  await categorySelect(page, 0).selectOption("lashing");
  await page.getByLabel("İlan Başlığı").first().fill("Genisletme Op Lashing");
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Lashing hizmeti aciklamasi, yirmi karakterden uzun olmali.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-21");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-21");
  await page.getByLabel("Ürün Adedi").first().fill("15");
  await page.getByLabel("Ürün Cinsi").first().fill("Boru");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await categorySelect(page, 1).selectOption("nakliye");
  await page.getByLabel("İlan Başlığı").nth(1).fill("Genisletme Op Nakliye");
  await page.getByLabel("Hizmete Özel Açıklama").nth(1).fill("Nakliye hizmeti aciklamasi, yirmi karakterden uzun olmali da.");
  await page.getByLabel("Başlangıç Tarihi").nth(1).fill("2026-08-21");
  await page.getByLabel("Bitiş Tarihi").nth(1).fill("2026-08-21");
  await page.getByLabel("Ürün Adedi").nth(1).fill("5");
  await page.getByLabel("Tonaj", { exact: false }).nth(1).fill("22");
  await page.getByLabel("Ürün Cinsi").nth(1).fill("Big Bag");

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await categorySelect(page, 2).selectOption("forklift");
  await page.getByLabel("İlan Başlığı").nth(2).fill("Genisletme Op Forklift");
  await page.getByLabel("Hizmete Özel Açıklama").nth(2).fill("Forklift hizmeti aciklamasi, yirmi karakterden uzun olmali de.");
  await page.getByLabel("Başlangıç Tarihi").nth(2).fill("2026-08-21");
  await page.getByLabel("Bitiş Tarihi").nth(2).fill("2026-08-21");
  assert.equal(await productFieldsVisible(page, 2), false, "Forklift kardeş hizmette ürün alanları görünmemeli");

  await page.getByLabel("Operasyon Detayları").fill("Genisletme operasyon detaylari, on karakterden uzun.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Hizmet İlanını Yayınla/ }).click();
  await page.waitForURL(/operasyonIlanSayisi=3/, { timeout: 15000 });

  const jobsAfterOp = await getStoredJobs(page);
  const opLashing = jobsAfterOp.find((job) => job.title === "Genisletme Op Lashing");
  const opNakliye = jobsAfterOp.find((job) => job.title === "Genisletme Op Nakliye");
  const opForklift = jobsAfterOp.find((job) => job.title === "Genisletme Op Forklift");
  assert.equal(opLashing.productQuantity, 15);
  assert.equal(opLashing.productType, "Boru");
  assert.equal(opLashing.productTonnage, undefined);
  assert.equal(opNakliye.productQuantity, 5);
  assert.equal(opNakliye.productTonnage, 22);
  assert.equal(opNakliye.productType, "Big Bag");
  assert.equal(opForklift.productQuantity, undefined);
  assert.equal(opForklift.productType, undefined);
  assert.equal(opLashing.operationId, opNakliye.operationId);
  assert.equal(opNakliye.operationId, opForklift.operationId);
  ok("Operasyonda Lashing (tonajsız) + Nakliye (tonajlı) + Forklift (bilgisiz) her biri kendi kuralıyla bağımsız kaydedildi (senaryo 10)");

  console.log("\n=== Hizmet değişikliği: düzenlemede Liman<->Nakliye tonaj zorunluluğu ===");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${lashingJobId}/duzenle`);
  await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
  let tonnageLabelInEdit = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(tonnageLabelInEdit.includes("isteğe bağlı"), "Lashing düzenlemede Tonaj isteğe bağlı görünmeli");

  await page.getByLabel("Hizmet Kategorisi").selectOption("nakliye");
  tonnageLabelInEdit = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(!tonnageLabelInEdit.includes("isteğe bağlı"), "Liman'dan Nakliye'ye geçince Tonaj ZORUNLU görünmeli");
  ok("Düzenlemede Liman -> Nakliye geçişinde Tonaj zorunlu hale geliyor");

  await page.getByRole("button", { name: "Kaydet" }).click();
  const blockedBySwitchToNakliye = await page.getByText("Tonaj bilgisini giriniz.").first().isVisible().catch(() => false);
  assert.equal(blockedBySwitchToNakliye, true, "Tonaj boşken Nakliye'ye geçen kayıt engellenmeli");
  ok("Kategori Nakliye'ye çevrilip tonaj doldurulmadan kaydetmek engelleniyor");

  await page.getByLabel("Tonaj", { exact: false }).first().fill("18");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
  const jobsAfterSwitchToNakliye = await getStoredJobs(page);
  const switchedJob = jobsAfterSwitchToNakliye.find((job) => job.id === lashingJobId);
  assert.equal(switchedJob.category, "nakliye");
  assert.equal(switchedJob.productTonnage, 18);
  ok("Liman -> Nakliye geçişi tonaj doldurulunca başarıyla kaydedildi");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${lashingJobId}/duzenle`);
  await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").selectOption("lashing");
  tonnageLabelInEdit = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(tonnageLabelInEdit.includes("isteğe bağlı"), "Nakliye'den Liman'a geçince Tonaj tekrar isteğe bağlı görünmeli");
  ok("Düzenlemede Nakliye -> Liman geçişinde Tonaj tekrar isteğe bağlı oluyor");

  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
  ok("Nakliye -> Liman geçişi tonaj boşken de (isteğe bağlı olduğu için) başarıyla kaydedildi");

  console.log("\n=== Hizmet değişikliği: kapsam dışına geçişte temizlenme ===");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${nakliyeJobId}/duzenle`);
  await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").selectOption("genel-depolama");
  assert.equal(await page.getByLabel("Ürün Adedi").first().isVisible().catch(() => false), false, "Depolama'ya geçince ürün alanları kaybolmalı");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
  const jobsAfterNakliyeToDepolama = await getStoredJobs(page);
  const clearedNakliyeJob = jobsAfterNakliyeToDepolama.find((job) => job.id === nakliyeJobId);
  assert.equal(clearedNakliyeJob.category, "genel-depolama");
  assert.equal(clearedNakliyeJob.productQuantity, undefined);
  assert.equal(clearedNakliyeJob.productTonnage, undefined);
  assert.equal(clearedNakliyeJob.productType, undefined);
  ok("Nakliye -> Depolama (kapsam dışı) geçişinde ürün bilgileri tamamen temizlendi");

  console.log("\n=== Mevcut veri: eski Nakliye kaydında tonaj yoksa hata vermemeli ===");
  await page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    jobs.push({
      id: "legacy-nakliye-no-tonnage",
      title: "Eski Nakliye Kaydi (Tonajsiz)",
      category: "nakliye",
      province: "Kocaeli",
      district: "Dilovası",
      workLocationType: "Test Tesis",
      addressText: "Eski kayit adres metni, on karakterden uzun.",
      workDate: new Date().toISOString().slice(0, 10),
      description: "Eski Nakliye kaydi, tonaj alani hic yazilmamis, migrasyon senaryosu.",
      operationDetails: "Eski kayit operasyon detaylari.",
      status: "yayinda",
      requesterId: JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]").find((u) => u.email === "zeynep@test.com")?.id ?? null,
      photos: [],
      productQuantity: 8,
      productType: "Proje Yükü",
    });
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  });
  await page.goto(`${BASE_URL}/ilanlar/legacy-nakliye-no-tonnage`);
  await page.getByRole("heading", { name: "Ürün Bilgileri" }).waitFor({ state: "visible", timeout: 10000 });
  const legacyCardText = await page
    .locator("text=Ürün Bilgileri")
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
    .first()
    .textContent();
  assert.ok(legacyCardText.includes("8 adet"));
  assert.ok(legacyCardText.includes("Proje Yükü"));
  assert.ok(!legacyCardText.includes("ton "), "Tonaj hiç girilmediği için satır hiç gösterilmemeli");
  ok("Eski (tonajsız) Nakliye kaydı hatasız açılıyor, mevcut alanlar doğru gösteriliyor, eksik tonaj sorun yaratmıyor");

  console.log(`\n[tmp-product-info-nakliye-expansion-test] ${passed} test geçti.`);
  await browser.close();
}

main().catch(async (error) => {
  console.error("[tmp-product-info-nakliye-expansion-test] HATA:", error);
  process.exitCode = 1;
});
