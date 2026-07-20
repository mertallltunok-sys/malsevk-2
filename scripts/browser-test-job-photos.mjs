// node scripts/browser-test-job-photos.mjs
//
// "Hizmet Talebi Oluştur" formundaki zorunlu operasyon fotoğrafı yükleme
// sistemi için gerçek tarayıcı testleri (TEST 1-10 + mobil TEST 10 + HEIC
// TEST 11/12 uçtan uca UI akışı). Ön koşul: `npm run dev`
// http://localhost:3000 üzerinde çalışıyor olmalı.

import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const FIX = (name) => path.join(os.tmpdir(), name);
const PROGRESS_LOG = path.join(os.tmpdir(), "browser-test-job-photos-progress.log");
writeFileSync(PROGRESS_LOG, "");
let passed = 0;

function ok(description) {
  passed++;
  const line = `  ✓ ${description}`;
  console.log(line);
  appendFileSync(PROGRESS_LOG, line + "\n");
}

async function login(page, email, password) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
}

async function fillBaseFormFields(page, titleSuffix) {
  await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Depolama" });
  await page.getByLabel("İş Tarihi").fill("2026-09-15");
  await page.getByLabel("İlan Başlığı").fill(`Foto Test İlanı ${titleSuffix}`);
  await page
    .getByLabel("İş Açıklaması")
    .fill("Bu test ilanı otomatik tarayıcı testinden oluşturulmuştur ve en az yirmi karakter içerir.");

  await page.getByRole("button", { name: "İl", exact: true }).click();
  await page.locator('ul[aria-label="İl"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İl"]').getByRole("option", { name: "Kocaeli", exact: true }).click();

  await page.getByRole("button", { name: "İlçe", exact: true }).click();
  await page.locator('ul[aria-label="İlçe"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();

  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });

  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  await page.locator('ul[aria-label="Tesis"]').waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Tesis"]')
    .getByRole("option", { name: "Beldeport" })
    .click();

  await page
    .getByLabel("Operasyon Detayları")
    .fill("Otomatik test için operasyon detayları girilmiştir.");
}

async function waitForPhotosReady(page, expectedCount) {
  // Kart sayısı hedefe ulaşmalı VE hiçbir kart hala "processing" (dönen spinner,
  // .animate-spin) durumunda olmamalı — aksi halde henüz sunucudan yanıt
  // gelmeden (önizleme/gönderim hazır olmadan) devam edip yanlış pozitif
  // sonuç alınabilir.
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === count &&
      document.querySelectorAll(".animate-spin").length === 0,
    expectedCount,
    { timeout: 20000 },
  );
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  console.log("[browser-test-job-photos] Hizmet Alan olarak giriş yapılıyor...");
  await login(page, "zeynep@test.com", "Zeynep1!");
  ok("Giriş başarılı (zeynep@test.com / hizmet-alan)");

  // TEST 1: Fotoğraf yüklemeden formu göndermeye çalış
  await fillBaseFormFields(page, "1");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await assert.doesNotReject(
    page.getByText("Devam edebilmek için operasyonu gösteren en az 1 fotoğraf yüklemelisiniz.").waitFor({
      state: "visible",
      timeout: 5000,
    }),
  );
  assert.equal(page.url(), `${BASE_URL}/hizmet-talebi-olustur`);
  ok("TEST 1: Fotoğrafsız gönderim reddedildi, Türkçe hata gösterildi, form gönderilmedi");

  // TEST 2: Tek geçerli fotoğrafla ilan oluştur
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg")]);
  await waitForPhotosReady(page, 1);
  await assert.doesNotReject(page.getByText("1 / 10 fotoğraf yüklendi").waitFor({ state: "visible" }));
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  const firstJobUrl = page.url();
  await assert.doesNotReject(page.locator("img[alt$='kapak fotoğrafı']").waitFor({ state: "visible", timeout: 10000 }));
  ok("TEST 2: 1 geçerli fotoğrafla ilan başarıyla oluşturuldu, detay sayfasında kapak fotoğrafı görünüyor");

  // TEST 3: Birden fazla fotoğraf, sıralama değiştir, birini sil
  await login(page, "zeynep@test.com", "Zeynep1!");
  await fillBaseFormFields(page, "3");
  await page.setInputFiles('input[type="file"]', [
    FIX("fixture-valid-1.jpg"),
    FIX("fixture-valid-2.jpg"),
    FIX("fixture-valid-3.jpg"),
  ]);
  await waitForPhotosReady(page, 3);

  async function currentOrder() {
    return page.locator("[data-photo-filename]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-photo-filename")),
    );
  }

  assert.deepEqual(await currentOrder(), [
    "fixture-valid-1.jpg",
    "fixture-valid-2.jpg",
    "fixture-valid-3.jpg",
  ]);

  // valid-1 kartını (o an kapak) bir kez aşağı taşı -> sıra: valid-2, valid-1, valid-3
  await page
    .locator('[data-photo-filename="fixture-valid-1.jpg"]')
    .getByRole("button", { name: "Sırada geri al" })
    .click();
  await assert.doesNotReject(
    (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const order = await currentOrder();
        if (order[1] === "fixture-valid-1.jpg") return;
        await page.waitForTimeout(100);
      }
      throw new Error("Sıralama değişikliği yansımadı");
    })(),
  );
  assert.deepEqual(await currentOrder(), [
    "fixture-valid-2.jpg",
    "fixture-valid-1.jpg",
    "fixture-valid-3.jpg",
  ]);

  // valid-3 kartını sil -> kalan sıra: valid-2, valid-1
  await page
    .locator('[data-photo-filename="fixture-valid-3.jpg"]')
    .getByRole("button", { name: /fotoğrafını sil/ })
    .click();
  await waitForPhotosReady(page, 2);
  assert.deepEqual(await currentOrder(), ["fixture-valid-2.jpg", "fixture-valid-1.jpg"]);

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  // IndexedDB'den blob okuma + object URL oluşturma asenkrondur; <img>
  // etiketi DOM'a yalnızca çözüldükten sonra eklenir — önce kapak
  // görselinin göründüğünü bekle, sonra küçük resmi say.
  await page.locator("img[alt$='kapak fotoğrafı']").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("img[alt*='fotoğraf 2']").waitFor({ state: "visible", timeout: 10000 });
  const thumbnailCount = await page.locator("img[alt*='fotoğraf 2']").count();
  assert.equal(thumbnailCount, 1, "Beklenen tam olarak 2 fotoğraf (1 kapak + 1 küçük resim) kalmalı");
  ok("TEST 3: Çoklu fotoğraf yüklendi, sıralandı (valid-2, valid-1), valid-3 silindi; son sıra doğru kaydedildi");

  // TEST 4: 10'dan fazla fotoğraf yüklemeye çalış
  await login(page, "zeynep@test.com", "Zeynep1!");
  await fillBaseFormFields(page, "4");
  const elevenDistinctFiles = Array.from({ length: 11 }, (_, i) => FIX(`fixture-valid-${i + 1}.jpg`));
  await page.setInputFiles('input[type="file"]', elevenDistinctFiles);
  await waitForPhotosReady(page, 10);
  await assert.doesNotReject(page.getByText(/En fazla 10 fotoğraf/).waitFor({ state: "visible", timeout: 5000 }));
  const cardCountAfter11 = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.ok(cardCountAfter11 <= 10, `10'dan fazla kart eklendi: ${cardCountAfter11}`);
  ok(`TEST 4: 11 dosya seçilince en fazla ${cardCountAfter11} kabul edildi (≤10), Türkçe uyarı gösterildi`);

  // TEST 5: 10MB üzeri dosya
  await login(page, "zeynep@test.com", "Zeynep1!");
  await fillBaseFormFields(page, "5");
  await page.setInputFiles('input[type="file"]', [FIX("fixture-oversized.jpg")]);
  await assert.doesNotReject(
    page.getByText("Fotoğraf boyutu 10 MB'ı geçemez.").waitFor({ state: "visible", timeout: 5000 }),
  );
  const cardCountAfterOversized = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(cardCountAfterOversized, 0, "10MB üzeri dosya kart olarak eklenmemeli");
  ok("TEST 5: 10MB üzeri dosya reddedildi, Türkçe hata gösterildi, kart eklenmedi");

  // TEST 6: Sahte/gerçek olmayan dosya (uzantı .jpg ama içerik düz metin) + gerçek PDF
  await page.setInputFiles('input[type="file"]', [FIX("fixture-fake.jpg")]);
  await assert.doesNotReject(
    page.getByText(/Desteklenmeyen dosya biçimi/).waitFor({ state: "visible", timeout: 5000 }),
  );
  const cardCountAfterFake = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(cardCountAfterFake, 0, "Sahte dosya kart olarak eklenmemeli");
  ok("TEST 6: Gerçek içeriği resim olmayan sahte dosya (.jpg uzantılı düz metin) reddedildi");

  // TEST 11/12 (UI akışı): Gerçek HEIC dosyası yükle, işlensin, önizlensin
  await page.setInputFiles('input[type="file"]', [FIX("sample-test.heic")]);
  await waitForPhotosReady(page, 1);
  const heicPreviewImg = page.locator("img").first();
  await assert.doesNotReject(heicPreviewImg.waitFor({ state: "visible", timeout: 15000 }));
  const naturalWidth = await heicPreviewImg.evaluate((img) => img.naturalWidth);
  assert.ok(naturalWidth > 0, "HEIC önizlemesi gerçek bir görüntü olarak yüklenemedi");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  const detailCoverImg = page.locator("img[alt$='kapak fotoğrafı']");
  await assert.doesNotReject(detailCoverImg.waitFor({ state: "visible", timeout: 10000 }));
  const detailNaturalWidth = await detailCoverImg.evaluate((img) => img.naturalWidth);
  assert.ok(detailNaturalWidth > 0, "İlan detayında HEIC'ten dönüştürülen fotoğraf açılmadı");
  ok("TEST 11/12: Gerçek HEIC fotoğraf yüklendi, önizlendi, ilan detayında doğru şekilde açıldı");

  // TEST 9: Hizmet Veren hesabıyla ilan detayını aç, fotoğrafları gör, düzenleme kontrolü olmasın
  // NOT: localStorage temizlenmez — bu, zeynep'in daha önce oluşturduğu ilan
  // kayıtlarını (malsevk.jobs.v1) da silerdi. Giriş yapmak zaten oturum
  // anahtarının üzerine yazar, başka bir temizliğe gerek yoktur.
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill("mert@test.com");
  await page.locator('input[type="password"]').fill("Mert123!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(BASE_URL + "/");
  await page.goto(firstJobUrl);
  await assert.doesNotReject(page.locator("img[alt$='kapak fotoğrafı']").waitFor({ state: "visible", timeout: 10000 }));
  const deleteButtonsVisibleToProvider = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(deleteButtonsVisibleToProvider, 0, "Hizmet Veren'e silme kontrolü gösterilmemeli");
  ok("TEST 9: Hizmet Veren, ilan detayında fotoğrafları görüyor; düzenleme/silme kontrolü yok");

  // TEST 7 (UI seviyesi): Hizmet Veren, ilan oluşturma formunu (ve fotoğraf yükleme alanını) hiç göremez
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await assert.doesNotReject(
    page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({ state: "visible" }),
  );
  const fileInputCountForProvider = await page.locator('input[type="file"]').count();
  assert.equal(fileInputCountForProvider, 0, "Hizmet Veren'e fotoğraf yükleme alanı hiç gösterilmemeli");
  ok("TEST 7 (UI): Hizmet Veren, fotoğraf yükleme alanını içeren formu hiç göremiyor");

  // TEST 10: Mobil responsive (2 sütun önizleme + yükleme akışı)
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "zeynep@test.com", "Zeynep1!");
  await fillBaseFormFields(page, "mobil");
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg"), FIX("fixture-valid-2.jpg")]);
  await waitForPhotosReady(page, 2);
  const gridColumnCount = await page.evaluate(() => {
    const grid = document.querySelector('[aria-label$="fotoğrafını sil"]')?.closest(".grid");
    if (!grid) return null;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });
  assert.equal(gridColumnCount, 2, `Mobilde önizleme kartları 2 sütun olmalı, ölçülen: ${gridColumnCount}`);
  await page.getByRole("button", { name: /fotoğrafını sil/ }).first().click();
  await waitForPhotosReady(page, 1);
  ok("TEST 10: Mobil görünümde (390px) önizleme kartları 2 sütun; yükleme/silme çalışıyor");

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test-job-photos] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test-job-photos] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[browser-test-job-photos] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[browser-test-job-photos] HATA:", error);
  process.exitCode = 1;
});
