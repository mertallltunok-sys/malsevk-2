// node scripts/tmp-katalog-sadelestirme-test.mjs
//
// Hizmet kataloğu sadeleştirmesinin doğrulaması: 10 hizmetin kaldırılması,
// 3 çiftin birleştirilmesi, geriye dönük eşleme, Nakliye/Gümrük Müşavirliği
// sıralaması, ve merkezi ürün bilgisi kapsamının yeni birleşik id'lere göre
// çalışması (senaryo 1-10, 32-35).
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

async function getCategoryOptionTexts(page) {
  return page.getByLabel("Hizmet Kategorisi").first().locator("option").allTextContents();
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

function categorySelect(page, index = 0) {
  return page.getByLabel("Hizmet Kategorisi").nth(index);
}

async function productFieldsVisible(page, index = 0) {
  return page.getByLabel("Ürün Adedi").nth(index).isVisible().catch(() => false);
}

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}
async function setStoredJobs(page, jobs) {
  return page.evaluate((j) => localStorage.setItem("malsevk.jobs.v1", JSON.stringify(j)), jobs);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  console.log("=== Senaryo 1-3: Kaldırılan hizmetler hiçbir seçim alanında görünmüyor ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  const categoryOptionTexts = await getCategoryOptionTexts(page);
  const removedLabels = [
    "Liman Personeli",
    "Depo Personeli",
    "Depo Düzenleme",
    "Paletleme",
    "Etiketleme",
    "Sayım Hizmeti",
    "Paletli Ürün Depolama",
    "Ağır Yük Depolama",
    "Vardiyalı Çalışma",
    "Proje Yük",
  ];
  for (const label of removedLabels) {
    assert.ok(!categoryOptionTexts.includes(label), `"${label}" ilan oluşturma kategori listesinde GÖRÜNMEMELİ`);
  }
  ok("Kaldırılan 10 hizmetin hiçbiri ilan oluşturma kategori listesinde görünmüyor (senaryo 1-3)");

  console.log("\n=== Senaryo 4-6: Birleştirilmiş hizmetler tek giriş olarak görünüyor ===");
  const lashingCount = categoryOptionTexts.filter((text) => text.includes("Lashing")).length;
  assert.equal(lashingCount, 1, `Yalnızca "Lashing / Unlashing" tek bir kez görünmeli, bulunan: ${lashingCount}`);
  assert.ok(categoryOptionTexts.includes("Lashing / Unlashing"), 'Tam olarak "Lashing / Unlashing" etiketi görünmeli');
  ok('"Lashing" ve "Unlashing" yerine yalnızca "Lashing / Unlashing" görünüyor (senaryo 4)');

  assert.ok(categoryOptionTexts.includes("Konteyner Dolum / Boşaltım"), '"Konteyner Dolum / Boşaltım" görünmeli');
  assert.ok(!categoryOptionTexts.includes("Konteyner Dolum"), 'Eski "Konteyner Dolum" tekil etiketi görünmemeli');
  assert.ok(!categoryOptionTexts.includes("Konteyner Boşaltım"), 'Eski "Konteyner Boşaltım" tekil etiketi görünmemeli');
  ok('"Konteyner Dolum" ve "Konteyner Boşaltım" yerine yalnızca "Konteyner Dolum / Boşaltım" görünüyor (senaryo 5)');

  assert.ok(categoryOptionTexts.includes("Gözetim Hizmetleri"), '"Gözetim Hizmetleri" görünmeli');
  assert.ok(!categoryOptionTexts.includes("Yükleme Gözetimi"), 'Eski "Yükleme Gözetimi" görünmemeli');
  assert.ok(!categoryOptionTexts.includes("Boşaltma Gözetimi"), 'Eski "Boşaltma Gözetimi" görünmemeli');
  ok('"Yükleme Gözetimi" ve "Boşaltma Gözetimi" yerine yalnızca "Gözetim Hizmetleri" görünüyor (senaryo 6)');

  console.log("\n=== Senaryo 9-10: Nakliye ve Gümrük Müşavirliği daha üstte (masaüstü + mobil) ===");
  const nakliyeIndex = categoryOptionTexts.findIndex((text) => text === "Nakliye");
  const gumrukIndex = categoryOptionTexts.findIndex((text) => text === "Gümrük Müşavirliği");
  const forkliftIndex = categoryOptionTexts.findIndex((text) => text === "Forklift");
  const depolamaIndex = categoryOptionTexts.findIndex((text) => text === "Genel Depolama");
  assert.ok(nakliyeIndex >= 0 && nakliyeIndex < forkliftIndex, "Nakliye, Forklift'ten önce görünmeli");
  assert.ok(gumrukIndex >= 0 && gumrukIndex < forkliftIndex, "Gümrük Müşavirliği, Forklift'ten önce görünmeli");
  assert.ok(nakliyeIndex < depolamaIndex && gumrukIndex < depolamaIndex, "Nakliye/Gümrük, Depolama'dan önce görünmeli");
  ok("Kategori listesinde Nakliye ve Gümrük Müşavirliği, Forklift/Depolama'dan önce (masaüstü, senaryo 9)");

  await page.goto(`${BASE_URL}/`);
  const homepageCategoryOrder = await page.locator("#hizmetler h3").allTextContents();
  const homeNakliyeIdx = homepageCategoryOrder.findIndex((t) => t === "Nakliye");
  const homeGumrukIdx = homepageCategoryOrder.findIndex((t) => t === "Gümrük Müşavirliği");
  const homeForkliftIdx = homepageCategoryOrder.findIndex((t) => t === "Forklift");
  assert.ok(homeNakliyeIdx >= 0 && homeNakliyeIdx < homeForkliftIdx, "Ana sayfada Nakliye, Forklift'ten önce");
  assert.ok(homeGumrukIdx >= 0 && homeGumrukIdx < homeForkliftIdx, "Ana sayfada Gümrük Müşavirliği, Forklift'ten önce");
  ok("Ana sayfa hizmet kartlarında Nakliye/Gümrük Müşavirliği daha üstte (masaüstü, senaryo 9)");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileCategoryOrder = await page.locator("#hizmetler h3").allTextContents();
  assert.deepEqual(mobileCategoryOrder, homepageCategoryOrder, "Mobilde de aynı sıralama korunmalı");
  ok("Mobil görünümde sıralama bozulmuyor, masaüstüyle birebir aynı (senaryo 10)");
  await page.setViewportSize({ width: 1440, height: 1000 });

  console.log("\n=== Senaryo 7-8: Eski ilanlar yeni birleşik kategori altında okunuyor, silinmiyor ===");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  const beforeJobs = await getStoredJobs(page);
  const legacyJob = {
    id: "legacy-lashing-job",
    title: "Eski Lashing Kaydi",
    category: "lashing", // BİRLEŞTİRME ÖNCESİ ham id — artık kataloğun bir parçası DEĞİL.
    province: "Kocaeli",
    district: "Dilovası",
    workLocationType: "Test Tesis",
    addressText: "Eski kayit adres metni, on karakterden uzun olmali.",
    workDate: new Date().toISOString().slice(0, 10),
    description: "Eski, katalog birlesmeden once olusturulmus bir Lashing ilani.",
    operationDetails: "Eski kayit operasyon detaylari.",
    status: "yayinda",
    requesterId: zeynepId,
    photos: [],
  };
  const legacyRemovedJob = {
    ...legacyJob,
    id: "legacy-paletleme-job",
    title: "Eski Paletleme Kaydi",
    category: "paletleme", // TAMAMEN kaldırılmış bir kategori.
  };
  await setStoredJobs(page, [...beforeJobs, legacyJob, legacyRemovedJob]);

  await page.goto(`${BASE_URL}/ilanlar/legacy-lashing-job`);
  await page.getByText("Lashing / Unlashing").first().waitFor({ state: "visible", timeout: 10000 });
  ok('Eski "lashing" id\'li ilan detay sayfasında "Lashing / Unlashing" olarak okunuyor (senaryo 7)');

  await page.goto(`${BASE_URL}/ilanlar/legacy-paletleme-job`);
  await page.getByText("Artık Kullanılmayan Hizmet").first().waitFor({ state: "visible", timeout: 10000 });
  ok('Tamamen kaldırılmış "paletleme" kategorili eski ilan çökmeden "Artık Kullanılmayan Hizmet" gösteriyor');

  const afterJobs = await getStoredJobs(page);
  assert.equal(afterJobs.length, beforeJobs.length + 2, "Hiçbir eski ilan silinmemeli, ikisi de hâlâ kayıtlı olmalı");
  ok("Eski ilanlar silinmedi/mükerrer üretilmedi (senaryo 8)");

  console.log("\n=== Senaryo 32-35: Ürün bilgisi kapsamı yeni birleşik id'lerle çalışıyor ===");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
  await gotoCreateForm(page);
  for (const [categoryId, label] of [
    ["lashing-unlashing", "Lashing / Unlashing"],
    ["gozetim-hizmetleri", "Gözetim Hizmetleri"],
    ["konteyner-dolum-bosaltim", "Konteyner Dolum / Boşaltım"],
  ]) {
    await categorySelect(page).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), true, `${label}: ürün bilgisi alanları görünür olmalı`);
    ok(`${label}: ürün bilgisi alanları doğru çalışıyor (senaryo 32)`);
  }

  await categorySelect(page).selectOption("nakliye");
  assert.equal(await productFieldsVisible(page), true, "Nakliye: ürün bilgisi alanları görünür olmalı");
  const nakliyeTonnageLabel = await page.getByText("Tonaj", { exact: false }).first().textContent();
  assert.ok(!nakliyeTonnageLabel.includes("isteğe bağlı"), "Nakliye: Tonaj hâlâ ZORUNLU olmalı");
  ok("Nakliye hizmetinde tonaj hâlâ zorunlu kalıyor (senaryo 33)");

  for (const [categoryId, label] of [
    ["forklift", "Forklift"],
    ["genel-depolama", "Depolama"],
  ]) {
    await categorySelect(page).selectOption(categoryId);
    assert.equal(await productFieldsVisible(page), false, `${label}: ürün bilgisi alanları görünmemeli`);
  }
  ok("Forklift ve Depolama hizmetlerinde ürün bilgisi alanları görünmüyor (senaryo 34)");

  // Senaryo 35: Hizmet Veren ilan detayında mükerrer gösterim geri gelmedi mi?
  await categorySelect(page).selectOption("lashing-unlashing");
  await page.getByLabel("İlan Başlığı").first().fill("Katalog Test Lashing Unlashing");
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Katalog sadelestirme testi icin aciklama, yirmi karakterden uzun.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-25");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-25");
  await page.getByLabel("Ürün Adedi").first().fill("60");
  await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Katalog testi operasyon detaylari, on karakterden uzun.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  const newJobId = page.url().split("/").pop();

  await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
  await page.goto(`${BASE_URL}/ilanlar/${newJobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible" });
  const productHeadingCount = await page.getByText("Ürün Bilgileri", { exact: true }).count();
  assert.equal(productHeadingCount, 1, `Tam olarak 1 "Ürün Bilgileri" kartı olmalı, bulunan: ${productHeadingCount}`);
  ok('Birleşik "Lashing / Unlashing" ilanında da "Ürün Bilgileri" yalnızca bir kez görünüyor, mükerrer gösterim geri gelmedi (senaryo 35)');

  console.log(`\n[tmp-katalog-sadelestirme-test] ${passed} test geçti.`);
  await browser.close();
}

main().catch(async (error) => {
  console.error("[tmp-katalog-sadelestirme-test] HATA:", error);
  process.exitCode = 1;
});
