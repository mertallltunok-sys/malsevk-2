// node scripts/tmp-listing-toolbar-v2-test.mjs
//
// Hizmet Veren "Aktif İlanlar" ekranının ikinci UX geçişini doğrular: başlık/
// açıklama/Son Görüntülenenler/arama kutusunun kaldırılması, yeni filtre
// sırası, readonly İl, tüm 12 Kocaeli ilçesinin gelmesi, Hizmet Türü
// dropdown'ında uzun etiketlerin kesilmemesi, responsive taşma kontrolü. Ön
// koşul: `npm run dev` çalışıyor olmalı.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(desc) {
  passed++;
  console.log(`  ✓ ${desc}`);
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

  await page.goto(`${BASE_URL}/giris-yap?redirect=/ilanlar`);
  await page.locator('input[type="email"]').fill("mert@test.com");
  await page.locator('input[type="password"]').fill("Mert123!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/ilanlar`);
  ok("Giriş yapıldı, /ilanlar açıldı");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // 1) Başlık/açıklama/Son Görüntülenenler kaldırıldı (görsel olarak — DOM'da
  // erişilebilirlik için bir `sr-only` <h1> hâlâ var, bkz. provider-job-listing.tsx)
  const h1 = page.locator("h1");
  await assert.doesNotReject(h1.waitFor({ state: "attached", timeout: 5000 }));
  const h1Class = await h1.getAttribute("class");
  assert.ok(h1Class?.includes("sr-only"), `h1 sr-only olmalı, gelen class: '${h1Class}'`);
  const h1Box = await h1.boundingBox();
  assert.ok(h1Box && h1Box.width <= 2 && h1Box.height <= 2, `h1 görsel olarak gizli olmalı (1x1px), gelen boyut: ${JSON.stringify(h1Box)}`);
  ok("'Aktif İlanlar' başlığı görsel olarak kaldırılmış (yalnızca sr-only erişilebilirlik başlığı DOM'da, 1x1px)");

  const descCount = await page.getByText("Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin").count();
  assert.equal(descCount, 0, "Alt açıklama metni artık render edilmemeli");
  ok("Alt açıklama metni kaldırılmış");

  const recentCount = await page.getByText("Son Görüntülenenler").count();
  assert.equal(recentCount, 0, "'Son Görüntülenenler' bölümü artık render edilmemeli");
  ok("'Son Görüntülenenler' bölümü kaldırılmış");

  // 2) Arama kutusu tamamen kaldırıldı
  const searchCount = await page.locator("#job-listing-search").count();
  assert.equal(searchCount, 0, "Arama kutusu DOM'da olmamalı");
  const searchPlaceholderCount = await page.getByPlaceholder(/Başlık, açıklama/).count();
  assert.equal(searchPlaceholderCount, 0, "Arama placeholder'ı DOM'da olmamalı");
  ok("Arama kutusu tamamen kaldırılmış");

  // 3) Filtre sırası: Hizmet Türü, İl, İlçe, Bölge/Tesis, Tarih, Teklif Durumu
  const fieldIds = [
    "#job-listing-filter-category",
    "#job-listing-filter-district",
    "#job-listing-filter-facility",
    "#job-listing-filter-date",
    "#job-listing-filter-offer-status",
  ];
  for (const id of fieldIds) {
    const count = await page.locator(id).count();
    assert.equal(count, 1, `${id} tam olarak bir kez render edilmeli`);
  }
  const labelTexts = await page.locator(".rounded-\\[10px\\] label, .rounded-\\[10px\\] span.text-xs").allTextContents();
  console.log("  info: toolbar etiketleri:", JSON.stringify(labelTexts));
  const order = labelTexts.filter((t) => ["Hizmet Türü", "İl", "İlçe", "Bölge / Tesis", "Tarih", "Teklif Durumu"].includes(t));
  assert.deepEqual(order, ["Hizmet Türü", "İl", "İlçe", "Bölge / Tesis", "Tarih", "Teklif Durumu"], "Filtre sırası beklenenden farklı");
  ok("Filtre sırası doğru: Hizmet Türü, İl, İlçe, Bölge/Tesis, Tarih, Teklif Durumu");

  // 4) İl readonly "Kocaeli"
  const ilBlock = page.getByText("Kocaeli", { exact: true });
  await assert.doesNotReject(ilBlock.first().waitFor({ state: "visible", timeout: 5000 }));
  const ilSelectCount = await page.locator("#job-listing-filter-province").count();
  assert.equal(ilSelectCount, 0, "İl artık interaktif bir SearchableSelect olmamalı");
  ok("İl readonly 'Kocaeli' gösteriyor, interaktif değil");

  // 5) Masaüstünde tek satır hizalama
  const boxes = [];
  for (const id of ["#job-listing-filter-category", "#job-listing-filter-district", "#job-listing-filter-facility", "#job-listing-filter-date", "#job-listing-filter-offer-status"]) {
    const box = await page.locator(id).boundingBox();
    assert.ok(box, `${id} bounding box alınamadı`);
    boxes.push(Math.round(box.y));
  }
  const maxDelta = Math.max(...boxes) - Math.min(...boxes);
  assert.ok(maxDelta <= 8, `Masaüstünde tüm alanlar aynı satırda olmalı (fark: ${maxDelta}px)`);
  ok(`Masaüstünde (1440px) toolbar tek satırda hizalı (max fark ${maxDelta}px)`);

  const scrollWidthDesktop = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthDesktop = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthDesktop <= clientWidthDesktop + 2, "Masaüstünde yatay taşma olmamalı");
  ok("Masaüstünde yatay taşma yok");

  // 6) İlçe dropdown'ı Kocaeli'nin TÜM 12 ilçesini gösteriyor
  await page.locator("#job-listing-filter-district").click();
  const districtLabels = await page.locator('ul[role="listbox"] li').allTextContents();
  const expectedDistricts = [
    "Başiskele", "Çayırova", "Darıca", "Derince", "Dilovası", "Gebze",
    "Gölcük", "İzmit", "Kandıra", "Karamürsel", "Kartepe", "Körfez",
  ];
  for (const district of expectedDistricts) {
    assert.ok(
      districtLabels.some((label) => label.includes(district)),
      `İlçe listesinde '${district}' bulunamadı. Bulunanlar: ${JSON.stringify(districtLabels)}`,
    );
  }
  ok(`İlçe dropdown'ı Kocaeli'nin tüm 12 resmî ilçesini gösteriyor (${districtLabels.length} seçenek, "Tümü" dahil)`);
  await page.keyboard.press("Escape");

  // 7) Hizmet Türü dropdown'ında uzun etiketler kesilmiyor
  await page.locator("#job-listing-filter-category").click();
  const categoryPopup = page.locator('ul[role="listbox"][aria-label="Hizmet Türü"]');
  await categoryPopup.waitFor({ state: "visible" });
  const longLabelButton = page.locator('ul[role="listbox"][aria-label="Hizmet Türü"] button', { hasText: "Tehlikeli Madde Depolama" });
  await assert.doesNotReject(longLabelButton.waitFor({ state: "visible", timeout: 5000 }));
  const fullText = await longLabelButton.locator("span").first().textContent();
  assert.equal(fullText.trim(), "Tehlikeli Madde Depolama", `Etiket kesilmiş görünüyor: '${fullText}'`);
  const spanClass = await longLabelButton.locator("span").first().getAttribute("class");
  assert.ok(!spanClass.includes("truncate"), "Seçenek etiketi hâlâ 'truncate' class'ı taşıyor");
  ok("Hizmet Türü dropdown'ında 'Tehlikeli Madde Depolama' tam ve kesilmeden görünüyor (truncate yok)");
  await page.keyboard.press("Escape");

  // ---- Tablet (834px): düzenli 2 satır ----
  await page.setViewportSize({ width: 834, height: 1200 });
  await page.waitForTimeout(300);
  const scrollWidthTablet = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthTablet = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthTablet <= clientWidthTablet + 2, "Tablette yatay taşma olmamalı");
  ok("Tablette (834px) yatay taşma yok");

  // ---- Mobil (375px) ----
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const scrollWidthMobile = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidthMobile = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidthMobile <= clientWidthMobile + 2, "Mobilde yatay taşma olmamalı");
  ok("Mobilde (375px) yatay taşma yok");

  // İlk ilan kartının viewport içinde (fold altında çok derinde değil) görünüp görünmediğini kontrol et
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const firstJobLink = page.getByRole("link", { name: /İlanı İncele/ }).first();
  const firstJobBox = await firstJobLink.boundingBox();
  assert.ok(firstJobBox, "İlk ilan kartı bulunamadı");
  console.log(`  info: ilk ilan kartının Y konumu: ${Math.round(firstJobBox.y)}px (viewport: 900px)`);
  assert.ok(firstJobBox.y < 500, `İlk ilan kartı çok aşağıda kalıyor (Y=${Math.round(firstJobBox.y)}px)`);
  ok(`İlk ilan kartı katlanmadan (fold) önce görünüyor (Y=${Math.round(firstJobBox.y)}px)`);

  if (consoleErrors.length > 0) {
    console.error("KONSOL HATALARI:", consoleErrors);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-listing-toolbar-v2-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  console.log(`\n[tmp-listing-toolbar-v2-test] ${passed} kontrol geçti.`);
  await browser.close();
}

main().catch((error) => {
  console.error("[tmp-listing-toolbar-v2-test] HATA:", error.message);
  process.exitCode = 1;
});
