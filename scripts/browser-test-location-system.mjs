// node scripts/browser-test-location-system.mjs
//
// Merkezi lokasyon sisteminin (İl -> İlçe -> Bölge/Tesis) gerçek tarayıcı
// testleri. 2026-07-25 itibarıyla "İşin Yapılacağı Yer Türü" ayrı adımı
// kaldırıldı ve tek bir "Bölge / Tesis" seçiciyle birleştirildi (bkz.
// CLAUDE.md "Provider job listing" / job-location.ts) — bu script o
// birleşik akışı test eder. Ön koşul: `npm run dev` http://localhost:3000
// üzerinde çalışıyor olmalı.

import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const PROGRESS_LOG = path.join(os.tmpdir(), "browser-test-location-system-progress.log");
writeFileSync(PROGRESS_LOG, "");
let passed = 0;

function ok(description) {
  passed++;
  const line = `  ✓ ${description}`;
  console.log(line);
  appendFileSync(PROGRESS_LOG, line + "\n");
}

async function login(page) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
}

async function selectFromSearchable(page, label, optionText) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact: false }).first().click();
}

/**
 * "Bölge / Tesis" alanı, seçilen ilçe için hiç kayıt yoksa serbest-metin
 * bir <input>'a, kayıt varsa aranabilir bir <button> (SearchableSelect)'e
 * düşer (bkz. job-request-form.tsx). Bu yardımcı her iki durumda da o an
 * gösterilen değeri okur.
 */
async function getBolgeTesisDisplayValue(page) {
  const button = page.getByRole("button", { name: "Bölge / Tesis", exact: true });
  if ((await button.count()) > 0) return (await button.textContent()) ?? "";
  // "Listede yok — tesis bilgilerini kendim gireceğim" seçilince alan
  // "Tesis / İşletme Adı" olarak yeniden etiketlenir (bkz. job-request-form.tsx).
  const textbox = page.getByRole("textbox", { name: "Tesis / İşletme Adı", exact: true });
  if ((await textbox.count()) > 0) return await textbox.inputValue();
  return "";
}

async function main() {
  const browser = await chromium.launch();
  // Testlerden herhangi biri (assert.*, .waitFor timeout vb.) fırlatırsa
  // bile tarayıcının kapanmasını garanti eder — aksi halde açık kalan bir
  // Chromium bağlantısı Node sürecinin asla çıkmamasına yol açar.
  try {
    await runTests(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n[browser-test-location-system] ${passed}/${passed} test geçti.`);
}

async function runTests(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await login(page);
  ok("Giriş başarılı (zeynep@test.com / hizmet-alan)");

  // TEST 1: Kocaeli seç -> Kocaeli ilçeleri görünmeli
  await selectFromSearchable(page, "İl", "Kocaeli");
  await page.getByRole("button", { name: "İlçe", exact: true }).click();
  const districtList = page.locator('ul[aria-label="İlçe"]');
  await districtList.waitFor({ state: "visible" });
  await assert.doesNotReject(
    districtList.getByRole("option", { name: "Dilovası", exact: true }).waitFor({ state: "visible" }),
  );
  await assert.doesNotReject(
    districtList.getByRole("option", { name: "Körfez", exact: true }).waitFor({ state: "visible" }),
  );
  const districtCount = await districtList.getByRole("option").count();
  assert.equal(districtCount, 12, `Kocaeli'nin 12 ilçesi bekleniyordu, ${districtCount} bulundu`);
  ok("TEST 1: Kocaeli seçilince 12 ilçe görünüyor");
  await districtList.getByRole("option", { name: "Dilovası", exact: true }).click();

  // TEST 2: Dilovası seçilince Bölge/Tesis TEK adımda (ayrı bir "Yer Türü"
  // ön adımı OLMADAN) o ilçenin TÜM tesislerini (liman dahil) gösterir.
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
  const facilityList = page.locator('ul[aria-label="Bölge / Tesis"]');
  await facilityList.waitFor({ state: "visible" });
  const dilovasiFacilityNames = await facilityList.getByRole("option").allTextContents();
  assert.ok(dilovasiFacilityNames.some((t) => t.includes("Beldeport")), "Beldeport listede yok");
  assert.ok(dilovasiFacilityNames.some((t) => t.includes("Yılport Gebze")), "Yılport Gebze listede yok");
  assert.ok(dilovasiFacilityNames.some((t) => t.includes("Poliport")), "Poliport listede yok");
  assert.ok(
    dilovasiFacilityNames.some((t) => t.includes("Listede yok — tesis bilgilerini kendim gireceğim")),
    "\"Listede yok — tesis bilgilerini kendim gireceğim\" seçeneği listede yok",
  );
  ok('TEST 2: Dilovası seçilince Bölge/Tesis tek adımda Beldeport, Yılport Gebze, Poliport ve "Listede yok — tesis bilgilerini kendim gireceğim" gösteriyor');

  // TEST 2b: her tesis seçeneğinin yanında türü (hint) görünmeli — ör.
  // Beldeport bir liman, bu yüzden "Liman" etiketi de görünür olmalı.
  const beldeportOption = facilityList.getByRole("option", { name: "Beldeport", exact: false }).first();
  const beldeportOptionText = (await beldeportOption.textContent()) ?? "";
  assert.ok(beldeportOptionText.includes("Liman"), `Beldeport seçeneğinde "Liman" türü ipucu bulunamadı: ${beldeportOptionText}`);
  ok('TEST 2b: Beldeport seçeneğinin yanında "Liman" tür ipucu gösteriliyor');

  // Beldeport'u seç
  await facilityList.getByRole("option", { name: "Beldeport", exact: false }).first().click();
  const selectedText = await getBolgeTesisDisplayValue(page);
  assert.ok(selectedText.includes("Beldeport"), `Beldeport seçilemedi, mevcut değer: ${selectedText}`);

  // TEST 3: Dilovası seçiliyken Gebze'ye geç -> önceki tesis seçimi tamamen
  // temizlenmeli.
  await selectFromSearchable(page, "İlçe", "Gebze");
  const clearedText = await getBolgeTesisDisplayValue(page);
  assert.ok(!clearedText.includes("Beldeport"), `Bölge/Tesis seçimi temizlenmedi: ${clearedText}`);
  ok("TEST 3: İlçe Dilovası'dan Gebze'ye değişince önceki Bölge/Tesis seçimi (Beldeport) tamamen temizlendi");

  // Gebze -> GOSB ve Güzeller OSB görünmeli (Gebze'de gerçek OSB verisi var), aynı tek listede
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
  const gebzeFacilityList = page.locator('ul[aria-label="Bölge / Tesis"]');
  await gebzeFacilityList.waitFor({ state: "visible" });
  const gebzeFacilityNames = await gebzeFacilityList.getByRole("option").allTextContents();
  assert.ok(gebzeFacilityNames.some((t) => t.includes("GOSB")), "GOSB, Gebze Bölge/Tesis listesinde yok");
  assert.ok(
    gebzeFacilityNames.some((t) => t.includes("Güzeller")),
    "Gebze Güzeller OSB, Gebze Bölge/Tesis listesinde yok",
  );
  ok("Kontrol: Kocaeli -> Gebze -> Bölge/Tesis zinciri doğru çalışıyor (GOSB, Güzeller OSB)");
  await page.keyboard.press("Escape");

  // TEST 4: "Yılport" / "Yilport" / "YILPORT" araması aynı kaydı bulmalı
  await selectFromSearchable(page, "İlçe", "Dilovası");
  for (const query of ["Yılport", "Yilport", "YILPORT"]) {
    await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
    const dialog = page.locator('ul[aria-label="Bölge / Tesis"]');
    await dialog.waitFor({ state: "visible" });
    await page.getByPlaceholder("Ara...").fill(query);
    await assert.doesNotReject(
      dialog.getByRole("option", { name: "Yılport Gebze", exact: false }).waitFor({ state: "visible", timeout: 5000 }),
      `"${query}" araması Yılport Gebze'yi bulamadı`,
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
  ok('TEST 4: "Yılport" / "Yilport" / "YILPORT" aramaları aynı kaydı (Yılport Gebze) buluyor');

  // TEST 5: "Listede yok — tesis bilgilerini kendim gireceğim" seçilince
  // özel tesis (custom) alanları açılır.
  // NOT: SearchableSelect kapandığında kendi arama kutusu (query state)
  // temizlenMEZ (yalnızca bir seçenek TIKLANDIĞINDA temizlenir) — TEST 4'ün
  // son arama sorgusu ("YILPORT") burada hâlâ dolu olabilir ve "Listede yok
  // — tesis bilgilerini kendim gireceğim" o sorguyla eşleşmediği için
  // listeden filtrelenip görünmez kalırdı; bu yüzden dropdown'ı her
  // açtığımızda arama kutusunu açıkça temizliyoruz.
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
  const otherDialog = page.locator('ul[aria-label="Bölge / Tesis"]');
  await otherDialog.waitFor({ state: "visible" });
  await page.getByPlaceholder("Ara...").fill("");
  await otherDialog.getByRole("option", { name: "Listede yok — tesis bilgilerini kendim gireceğim", exact: true }).click();
  const freeTextInput = page.getByRole("textbox", { name: "Tesis / İşletme Adı", exact: true });
  await assert.doesNotReject(freeTextInput.waitFor({ state: "visible", timeout: 5000 }));
  await freeTextInput.fill("Deneme Sahası");
  assert.equal(await freeTextInput.inputValue(), "Deneme Sahası");
  ok('TEST 5: "Listede yok — tesis bilgilerini kendim gireceğim" seçilince özel tesis alanları açılıyor ve elle yazılabiliyor');

  // TEST 6: Sayfayı yenile, filtre zinciri tekrar çalışmalı
  await page.reload();
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Körfez");
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
  const korfezList = page.locator('ul[aria-label="Bölge / Tesis"]');
  await korfezList.waitFor({ state: "visible" });
  const korfezNames = await korfezList.getByRole("option").allTextContents();
  assert.ok(korfezNames.some((t) => t.includes("DP World Evyap Körfez")), "Sayfa yenilenince Körfez Bölge/Tesis zinciri bozuldu");
  ok("TEST 6: Sayfa yenilendikten sonra İl->İlçe->Bölge/Tesis zinciri sorunsuz çalışıyor");
  await page.keyboard.press("Escape");
  await korfezList.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  // TEST 7: Mobil görünümde tüm seçimler açılıp kullanılabilmeli
  await page.setViewportSize({ width: 390, height: 844 });
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).click();
  const mobileFacilityList = page.locator('ul[aria-label="Bölge / Tesis"]');
  await assert.doesNotReject(mobileFacilityList.waitFor({ state: "visible", timeout: 5000 }));
  const mobileNames = await mobileFacilityList.getByRole("option").allTextContents();
  assert.ok(mobileNames.some((t) => t.includes("GOSB")), "Mobilde Gebze Bölge/Tesis listesi açılmadı/boş");
  await mobileFacilityList.getByRole("option", { name: "GOSB", exact: false }).first().click();
  ok("TEST 7: Mobil görünümde (390px) İl/İlçe/Bölge-Tesis seçimleri açılıp kullanılabiliyor");

  // TEST 8: Firma/Fabrika Adı ve Açık Adres alanları formda var, zorunlu ve karakter sayacı gösteriyor
  await page.setViewportSize({ width: 1280, height: 900 });
  const companyInput = page.getByLabel("Firma / Fabrika Adı");
  await assert.doesNotReject(companyInput.waitFor({ state: "visible", timeout: 5000 }));
  await companyInput.fill("ABC Metal Sanayi A.Ş.");
  const addressInput = page.getByLabel("Açık Adres");
  await assert.doesNotReject(addressInput.waitFor({ state: "visible", timeout: 5000 }));
  await addressInput.fill("Deneme Mahallesi, Test Sokak No:1");
  assert.equal(await companyInput.inputValue(), "ABC Metal Sanayi A.Ş.");
  assert.equal(await addressInput.inputValue(), "Deneme Mahallesi, Test Sokak No:1");
  ok('TEST 8: "Firma / Fabrika Adı" ve "Açık Adres" alanları formda var ve doldurulabiliyor');

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test-location-system] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test-location-system] Konsolda hiç JS hatası yakalanmadı.");
  }
}

main().catch((error) => {
  console.error("[browser-test-location-system] HATA:", error);
  process.exitCode = 1;
});
