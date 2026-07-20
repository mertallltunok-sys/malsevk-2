// node scripts/browser-test-regression.mjs
//
// Fotoğraf yükleme özelliği eklendikten sonra, dokunulmaması istenen
// mevcut sistemlerin (giriş/kayıt, rol yetkileri, lokasyon seçimi, ilan
// listeleme, teklif verme, eski/fotoğrafız ilan detay sayfası) hala doğru
// çalıştığını doğrular. Ön koşul: `npm run dev` çalışıyor olmalı.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;

function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
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

  // 1) İlan listeleme sayfası hâlâ çalışıyor
  await page.goto(`${BASE_URL}/ilanlar`);
  await assert.doesNotReject(
    page.getByText("Konteyner Sahasında Lashing Operasyonu").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("İlan listeleme sayfası (/ilanlar) sabit örnek ilanları gösteriyor");

  // 2) Eski/fotoğrafsız bir ilanın detay sayfası çökmeden açılıyor, boş durum gösteriyor
  await page.goto(`${BASE_URL}/ilanlar/ilan-001`);
  await assert.doesNotReject(
    page.getByText("Konteyner Sahasında Lashing Operasyonu").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText("Bu ilan için fotoğraf eklenmemiş.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("Fotoğrafsız eski ilan (ilan-001) detay sayfası çökmeden açılıyor, güvenli boş durum gösteriliyor");

  // 3) Giriş/kayıt: Hizmet Veren olarak giriş yap, teklif ver
  await page.goto(`${BASE_URL}/giris-yap?redirect=/ilanlar/ilan-001`);
  await page.locator('input[type="email"]').fill("mert@test.com");
  await page.locator('input[type="password"]').fill("Mert123!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/ilanlar/ilan-001`);
  ok("Hizmet Veren (mert@test.com) girişi çalışıyor");

  await page.getByLabel("Teklif Fiyatı").fill("2500");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Bu teklif otomatik regresyon testi tarafından oluşturulmuştur, en az yirmi karakter içerir.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await assert.doesNotReject(
    page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("Hizmet Veren, sabit bir ilana teklif verebiliyor (teklif akışı bozulmamış)");

  // 4) Rol yetkisi: Hizmet Veren ilan oluşturma formunu göremez (fotoğraf öncesi de böyleydi)
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await assert.doesNotReject(
    page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({ state: "visible" }),
  );
  ok("Rol yetkisi: Hizmet Veren hâlâ ilan oluşturamıyor");

  // 5) Lokasyon seçimi: Hizmet Alan olarak giriş yap, İl/İlçe/Yer seçimi çalışıyor
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByRole("button", { name: "İl", exact: true }).click();
  await page.locator('ul[aria-label="İl"]').getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.getByRole("button", { name: "İlçe", exact: true }).click();
  await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
  await page.getByRole("button", { name: "Tesis", exact: true }).click();
  await assert.doesNotReject(
    page
      .locator('ul[aria-label="Tesis"]')
      .getByRole("option", { name: "Beldeport" })
      .waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("Lokasyon seçimi (İl -> İlçe -> Yer Türü -> Tesis, Beldeport dahil) hâlâ doğru çalışıyor");

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test-regression] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test-regression] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[browser-test-regression] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[browser-test-regression] HATA:", error);
  process.exitCode = 1;
});
