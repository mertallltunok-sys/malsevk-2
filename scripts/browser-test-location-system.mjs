// node scripts/browser-test-location-system.mjs
//
// Yeniden kurulan lokasyon sistemi (İl -> İlçe -> Yer Türü -> Tesis) için
// gerçek tarayıcı testleri (TEST 1-7). Ön koşul: `npm run dev`
// http://localhost:3000 üzerinde çalışıyor olmalı.

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
 * "Tesis" alanı, seçilen ilçe+yer türü için hiç kayıt yoksa serbest-metin
 * bir <input>'a, kayıt varsa aranabilir bir <button> (SearchableSelect)'e
 * düşer (bkz. job-request-form.tsx). Bu yardımcı her iki durumda da o an
 * gösterilen değeri okur.
 */
async function getTesisDisplayValue(page) {
  const button = page.getByRole("button", { name: "Tesis", exact: true });
  if ((await button.count()) > 0) return (await button.textContent()) ?? "";
  const textbox = page.getByRole("textbox", { name: "Tesis", exact: true });
  if ((await textbox.count()) > 0) return await textbox.inputValue();
  return "";
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

  // TEST 2: Dilovası + Liman -> Dilovası'na bağlı limanlar görünmeli
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  const facilityList = page.locator('ul[aria-label="Tesis"]');
  await facilityList.waitFor({ state: "visible" });
  const dilovasiLimanNames = await facilityList.getByRole("option").allTextContents();
  assert.ok(dilovasiLimanNames.some((t) => t.includes("Beldeport")), "Beldeport listede yok");
  assert.ok(dilovasiLimanNames.some((t) => t.includes("Yılport Gebze")), "Yılport Gebze listede yok");
  assert.ok(dilovasiLimanNames.some((t) => t.includes("Poliport")), "Poliport listede yok");
  ok("TEST 2: Dilovası + Liman -> Beldeport, Yılport Gebze, Poliport görünüyor");

  // TEST 5 (aynı liste üzerinde): başka ilçeye bağlı liman görünmemeli
  assert.ok(
    !dilovasiLimanNames.some((t) => t.includes("DP World Evyapport") || t.includes("Marmara Tersanesi")),
    "Körfez'e ait bir liman Dilovası listesine sızdı",
  );
  ok("TEST 5: Dilovası seçiliyken başka ilçeye bağlı liman (Körfez) görünmüyor");

  // Beldeport'u seç
  await facilityList.getByRole("option", { name: "Beldeport", exact: false }).first().click();
  const selectedText = await getTesisDisplayValue(page);
  assert.ok(selectedText.includes("Beldeport"), `Beldeport seçilemedi, mevcut değer: ${selectedText}`);

  // TEST 3: Dilovası seçiliyken Gebze'ye geç -> önceki tesis seçimi tamamen
  // temizlenmeli. NOT: Gebze ilçesinde "Liman" türünde hiç kayıt yok, bu
  // yüzden Tesis alanı serbest-metin girişine düşer (bkz. job-request-form.tsx
  // "hazır tesis listesi henüz eklenmedi" dalı) — bu, TEMEL KURAL'ın
  // (yalnızca doğru il+ilçe+tür eşleşen tesis gösterilir) beklenen, doğru
  // sonucudur; getTesisDisplayValue() bu iki gösterimi de ele alır.
  await selectFromSearchable(page, "İlçe", "Gebze");
  const clearedText = await getTesisDisplayValue(page);
  assert.ok(!clearedText.includes("Beldeport"), `Tesis seçimi temizlenmedi: ${clearedText}`);
  ok("TEST 3: İlçe Dilovası'dan Gebze'ye değişince önceki tesis seçimi (Beldeport) tamamen temizlendi");

  // Yer türü (Liman) korunmuş olmalı (yalnızca ilçe değişiminde temizlenmemesi gerekiyordu)
  const facilityTypeValue = await page.getByLabel("İşin Yapılacağı Yer Türü").inputValue();
  assert.equal(facilityTypeValue, "LIMAN", "İlçe değişince yer türü de temizlenmiş (beklenmiyordu)");
  ok("Kontrol: ilçe değişince yer türü (Liman) korundu, yalnızca tesis temizlendi");

  // Gebze + OSB -> GOSB ve Güzeller OSB görünmeli (Gebze'de gerçek OSB verisi var)
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "OSB" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  const gebzeOsbList = page.locator('ul[aria-label="Tesis"]');
  await gebzeOsbList.waitFor({ state: "visible" });
  const gebzeOsbNames = await gebzeOsbList.getByRole("option").allTextContents();
  assert.ok(gebzeOsbNames.some((t) => t.includes("GOSB")), "GOSB, Gebze->OSB listesinde yok");
  assert.ok(
    gebzeOsbNames.some((t) => t.includes("Güzeller")),
    "Gebze Güzeller OSB, Gebze->OSB listesinde yok",
  );
  ok("Kontrol: Kocaeli -> Gebze -> OSB zinciri doğru çalışıyor (GOSB, Güzeller OSB)");
  await page.keyboard.press("Escape");

  // TEST 4: "Yılport" / "Yilport" / "YILPORT" araması aynı kaydı bulmalı
  await selectFromSearchable(page, "İlçe", "Dilovası");
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
  for (const query of ["Yılport", "Yilport", "YILPORT"]) {
    await page.getByRole("button", { name: "Tesis", exact: true }).click();
    const dialog = page.locator('ul[aria-label="Tesis"]');
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

  // TEST 6: Sayfayı yenile, filtre zinciri tekrar çalışmalı
  await page.reload();
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Körfez");
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  const korfezList = page.locator('ul[aria-label="Tesis"]');
  await korfezList.waitFor({ state: "visible" });
  const korfezNames = await korfezList.getByRole("option").allTextContents();
  assert.ok(korfezNames.some((t) => t.includes("DP World Evyapport")), "Sayfa yenilenince Körfez->Liman zinciri bozuldu");
  ok("TEST 6: Sayfa yenilendikten sonra İl->İlçe->Yer Türü->Tesis zinciri sorunsuz çalışıyor");
  await page.keyboard.press("Escape");
  await korfezList.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  // TEST 7: Mobil görünümde tüm seçimler açılıp kullanılabilmeli
  await page.setViewportSize({ width: 390, height: 844 });
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "OSB" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  const mobileFacilityList = page.locator('ul[aria-label="Tesis"]');
  await assert.doesNotReject(mobileFacilityList.waitFor({ state: "visible", timeout: 5000 }));
  const mobileNames = await mobileFacilityList.getByRole("option").allTextContents();
  assert.ok(mobileNames.some((t) => t.includes("GOSB")), "Mobilde Gebze->OSB listesi açılmadı/boş");
  await mobileFacilityList.getByRole("option", { name: "GOSB", exact: false }).first().click();
  ok("TEST 7: Mobil görünümde (390px) İl/İlçe/Yer Türü/Tesis seçimleri açılıp kullanılabiliyor");

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test-location-system] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test-location-system] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[browser-test-location-system] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[browser-test-location-system] HATA:", error);
  process.exitCode = 1;
});
