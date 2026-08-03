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

  // 1) İlan listeleme sayfası: oturum açılmamışsa artık giriş-gerekli kartı
  // gösterir (bkz. guest-access-card.tsx) — "İş İlanlarını İncele" CTA'ları
  // artık modal değil, doğrudan bu sayfaya yönlendirir. Gerçek listelemenin
  // hâlâ çalıştığı adım 3'ten sonra (Hizmet Veren girişiyle) doğrulanır.
  await page.goto(`${BASE_URL}/ilanlar`);
  await assert.doesNotReject(
    page.getByText("İlanları görüntülemek için giriş yapmalısınız.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("İlan listeleme sayfası (/ilanlar) oturumsuz kullanıcıda giriş-gerekli kartı gösteriyor");

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

  // "Tamamlanması Taahhüt Edilen Gün" artık yalnızca Nakliye kategorisindeki
  // ilanlarda gösteriliyor (bkz. CLAUDE.md/görev tanımı) — ilan-001 kategorisi
  // Lashing olduğu için bu alan artık BİLEREK render edilmiyor, bu yüzden
  // burada hiç doldurulmaz/aranmaz.
  await page.getByLabel("Teklif Fiyatı").fill("2500");
  await assert.rejects(
    page.getByLabel("Tamamlanması Taahhüt Edilen Gün").waitFor({ state: "visible", timeout: 2000 }),
  );
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Bu teklif otomatik regresyon testi tarafından oluşturulmuştur, en az yirmi karakter içerir.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await assert.doesNotReject(
    page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("Hizmet Veren, sabit bir ilana teklif verebiliyor (teklif akışı bozulmamış)");

  // 3b) Oturum açıkken /ilanlar hâlâ gerçek listelemeyi gösteriyor (gate değil).
  // "Konteyner Sahasında Lashing Operasyonu" (ilan-001) DEĞİL — o İzmir'de,
  // İl filtresi artık Türkiye geneli serbestçe seçilebilir olsa da varsayılan
  // başlangıç değeri hâlâ Kocaeli'dir (bkz. job-listing-filters.ts)
  // ve bu test filtreyi hiç değiştirmez — bu yüzden Aktif İlanlar listesinde
  // hâlâ görünmez. Kocaeli'deki sabit örnek ilanı (ilan-002) kontrol edilir.
  await page.goto(`${BASE_URL}/ilanlar`);
  await assert.doesNotReject(
    page.getByText("Fabrika Sahasında Forklift Operatörü İhtiyacı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("Oturum açık Hizmet Veren için /ilanlar gerçek listelemeyi gösteriyor (varsayılan Kocaeli filtreli)");

  // 4) Rol yetkisi: Hizmet Veren ilan oluşturma formunu göremez (fotoğraf öncesi de böyleydi)
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await assert.doesNotReject(
    page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({ state: "visible" }),
  );
  ok("Rol yetkisi: Hizmet Veren hâlâ ilan oluşturamıyor");

  // 5) Lokasyon seçimi: Hizmet Alan olarak giriş yap, İl/İlçe/Liman-Sanayi-OSB
  // seçimi çalışıyor (2026-07-25: "İşin Yapılacağı Yer Türü" ayrı adımı
  // kaldırıldı, tek bir "Liman / Sanayi / OSB" seçiciyle birleştirildi).
  // Türkiye Geneli İl/İlçe: İl artık Nakliye DIŞINDAKİ hizmetlerde de gerçek
  // bir SearchableSelect'tir, Kocaeli yalnızca başlangıç varsayılanıdır (bkz.
  // job-request-form.tsx) — bu adım İl'in seçilebilir olduğunu VE varsayılan
  // olarak Kocaeli geldiğini doğrular, İlçe -> Liman / Sanayi / OSB akışı
  // değişmeden devam eder.
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
  const provinceButton = page.getByRole("button", { name: "İl", exact: true }).first();
  await assert.doesNotReject(provinceButton.waitFor({ state: "visible", timeout: 5000 }));
  const provinceButtonText = await provinceButton.innerText();
  assert.match(provinceButtonText, /Kocaeli/);
  ok("İl artık seçilebilir bir SearchableSelect, varsayılan olarak Kocaeli geliyor (kilitli/readonly değil)");
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
  await assert.doesNotReject(
    page
      .locator('ul[aria-label="Liman / Sanayi / OSB"]')
      .getByRole("option", { name: "Beldeport", exact: false })
      .waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("Lokasyon seçimi (İl seçilebilir/varsayılan Kocaeli, İlçe -> Liman / Sanayi / OSB, Beldeport dahil) hâlâ doğru çalışıyor");

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
