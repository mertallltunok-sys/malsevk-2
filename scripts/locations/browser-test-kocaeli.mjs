// Kocaeli lokasyon sistemi için gerçek tarayıcı testleri (TEST 1-8).
// Playwright + Chromium ile app/hizmet-talebi-olustur formundaki
// İl -> İlçe -> İşin Yapılacağı Yer cascading select'ini gerçekten sürer.
//
// Ön koşul: `npm run dev` ayrı bir süreçte http://localhost:3000 üzerinde
// çalışıyor olmalı. Çalıştırma: node scripts/locations/browser-test-kocaeli.mjs

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;

function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

// Not: "İşin Yapılacağı Yer" seçeneklerinin erişilebilir adı, görünen etiket
// metniyle facility.category ipucu metninin (ör. "Liman") birleşimidir
// (bkz. searchable-select.tsx'teki <span>{label}</span><span>{hint}</span>).
// Bu yüzden seçenek eşleşmesi varsayılan olarak TAM (exact) değil, İÇEREN
// (substring) olmalı; "İl"/"İlçe" seçeneklerinde ipucu olmadığı için bu
// ayrım sonucu etkilemez.
async function selectFromSearchable(page, label, optionText, { exact = false } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  const option = dialog.getByRole("option", { name: optionText, exact });
  await option.click();
}

async function openDropdown(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function closeDropdown(page, label) {
  // Aynı butona tekrar basmak yerine Escape ile kapat; buton metnini bozmaz.
  await page.keyboard.press("Escape");
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "hidden" }).catch(() => {});
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  globalThis.__lastPage = page;
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  console.log("[browser-test] Giriş yapılıyor (zeynep@test.com / hizmet-alan)...");
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
  ok("Giriş başarılı, ilan formuna yönlendirildi");

  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Dilovası");

  // TEST 1: Dilovası -> Beldeport listede görünmeli
  let dropdown = await openDropdown(page, "İşin Yapılacağı Yer");
  await assert.doesNotReject(dropdown.getByRole("option", { name: "Beldeport" }).waitFor({ state: "visible" }));
  ok("TEST 1: İl=Kocaeli, İlçe=Dilovası -> Beldeport listede görünüyor");

  // TEST 2: Derince/Körfez'e özgü limanlar Dilovası listesinde görünmemeli
  const dilovasiOptionTexts = await dropdown.getByRole("option").allTextContents();
  assert.ok(!dilovasiOptionTexts.some((t) => t.includes("TCDD Derince Limanı")));
  assert.ok(!dilovasiOptionTexts.some((t) => t.includes("DP World Evyapport")));
  assert.ok(!dilovasiOptionTexts.some((t) => t.includes("Marmara Tersanesi")));
  ok("TEST 2: Derince/Körfez limanları Dilovası listesinde görünmüyor");
  await closeDropdown(page, "İşin Yapılacağı Yer");

  // TEST 3: İlçe = Körfez -> yalnızca Körfez'e ait doğrulanmış kayıtlar
  await selectFromSearchable(page, "İlçe", "Körfez");
  dropdown = await openDropdown(page, "İşin Yapılacağı Yer");
  const korfezOptionTexts = await dropdown.getByRole("option").allTextContents();
  assert.ok(korfezOptionTexts.some((t) => t.includes("DP World Evyapport")));
  assert.ok(korfezOptionTexts.some((t) => t.includes("Marmara Tersanesi")));
  assert.ok(!korfezOptionTexts.some((t) => t.includes("Beldeport")));
  assert.ok(!korfezOptionTexts.some((t) => t.includes("TCDD Derince Limanı")));
  ok("TEST 3: İl=Kocaeli, İlçe=Körfez -> yalnızca Körfez'e ait doğrulanmış kayıtlar görünüyor");
  await closeDropdown(page, "İşin Yapılacağı Yer");

  // TEST 4: İlçe = Derince -> yalnızca Derince'ye ait doğrulanmış kayıtlar
  await selectFromSearchable(page, "İlçe", "Derince");
  dropdown = await openDropdown(page, "İşin Yapılacağı Yer");
  const derinceOptionTexts = await dropdown.getByRole("option").allTextContents();
  assert.ok(derinceOptionTexts.some((t) => t.includes("TCDD Derince Limanı")));
  assert.ok(!derinceOptionTexts.some((t) => t.includes("Beldeport")));
  assert.ok(!derinceOptionTexts.some((t) => t.includes("DP World Evyapport")));
  ok("TEST 4: İl=Kocaeli, İlçe=Derince -> yalnızca Derince'ye ait doğrulanmış kayıtlar görünüyor");
  await closeDropdown(page, "İşin Yapılacağı Yer");

  // TEST 5: Dilovası'nda bir yer seç, sonra ilçeyi Körfez yap -> eski seçim tamamen temizlenmeli
  await selectFromSearchable(page, "İlçe", "Dilovası");
  await selectFromSearchable(page, "İşin Yapılacağı Yer", "Beldeport");
  const workLocationButton = page.getByRole("button", { name: "İşin Yapılacağı Yer", exact: true });
  await assert.doesNotReject(
    (async () => {
      const text = await workLocationButton.textContent();
      assert.ok(text?.includes("Beldeport"));
    })(),
  );
  await selectFromSearchable(page, "İlçe", "Körfez");
  const clearedText = await workLocationButton.textContent();
  assert.ok(!clearedText?.includes("Beldeport"), `Beklenmedik: buton hâlâ 'Beldeport' gösteriyor (${clearedText})`);
  assert.ok(clearedText?.includes("Yer seçiniz"), `Buton placeholder'a dönmedi (${clearedText})`);
  ok("TEST 5: İlçe Dilovası'dan Körfez'e değişince önceki seçim (Beldeport) tamamen temizlendi");

  // TEST 6: Arama kutusuna "Belde" yazınca Beldeport bulunmalı (Dilovası'nda)
  await selectFromSearchable(page, "İlçe", "Dilovası");
  await page.getByRole("button", { name: "İşin Yapılacağı Yer", exact: true }).click();
  const searchDialog = page.locator('ul[aria-label="İşin Yapılacağı Yer"]');
  await searchDialog.waitFor({ state: "visible" });
  await page.getByPlaceholder("Ara...").fill("Belde");
  await assert.doesNotReject(
    searchDialog.getByRole("option", { name: "Beldeport" }).waitFor({ state: "visible" }),
  );
  const searchResultTexts = await searchDialog.getByRole("option").allTextContents();
  assert.equal(searchResultTexts.length, 1, `"Belde" araması birden fazla sonuç döndürdü: ${searchResultTexts.join(", ")}`);
  ok('TEST 6: "Belde" araması, Dilovası seçiliyken Beldeport\'u buluyor');
  await closeDropdown(page, "İşin Yapılacağı Yer");

  // TEST 7: Görünen listede aynı isimli/aynı fiziksel tesis birden fazla kez çıkmıyor
  dropdown = await openDropdown(page, "İşin Yapılacağı Yer");
  const finalTexts = (await dropdown.getByRole("option").allTextContents()).map((t) => t.trim());
  const uniqueTexts = new Set(finalTexts);
  assert.equal(finalTexts.length, uniqueTexts.size, `Dilovası listesinde mükerrer görünüm var: ${finalTexts.join(", ")}`);
  ok("TEST 7: Dilovası listesinde aynı isim birden fazla kez görünmüyor (mükerrer yok)");
  await closeDropdown(page, "İşin Yapılacağı Yer");

  // TEST 8: Form serbest-metin fallback'ine DEĞİL, doğrulanmış veri setine düşüyor
  const freeTextFallback = page.getByPlaceholder("Örnek: Liman Sahası");
  assert.equal(await freeTextFallback.count(), 0, "Form hâlâ serbest-metin fallback'ini gösteriyor; doğrulanmış veri okunmuyor olabilir");
  ok("TEST 8: Form, eski sabit/fallback listesini değil yeni doğrulanmış Kocaeli veri setini okuyor");

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[browser-test] ${passed}/8 test geçti.`);
}

main().catch(async (error) => {
  console.error("[browser-test] HATA:", error.message ?? error);
  if (globalThis.__lastPage) {
    try {
      const buttonText = await globalThis.__lastPage
        .getByRole("button", { name: "İşin Yapılacağı Yer", exact: true })
        .textContent();
      console.error(`[browser-test] Debug: 'İşin Yapılacağı Yer' butonu şu anda: "${buttonText}"`);
      const districtText = await globalThis.__lastPage
        .getByRole("button", { name: "İlçe", exact: true })
        .textContent();
      console.error(`[browser-test] Debug: 'İlçe' butonu şu anda: "${districtText}"`);
      const openLists = await globalThis.__lastPage.locator("ul[role='listbox']").all();
      console.error(`[browser-test] Debug: açık listbox sayısı: ${openLists.length}`);
      for (const list of openLists) {
        const label = await list.getAttribute("aria-label");
        const texts = await list.getByRole("option").allTextContents();
        console.error(`[browser-test] Debug: listbox "${label}" seçenekleri: ${JSON.stringify(texts)}`);
      }
      await globalThis.__lastPage.screenshot({ path: "scripts/locations/browser-test-failure.png" });
      console.error("[browser-test] Ekran görüntüsü: scripts/locations/browser-test-failure.png");
    } catch (debugError) {
      console.error("[browser-test] Debug bilgisi alınamadı:", debugError.message);
    }
  }
  process.exitCode = 1;
});
