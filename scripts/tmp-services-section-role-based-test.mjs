// node scripts/tmp-services-section-role-based-test.mjs
//
// "Lojistik Operasyon Hizmetleri" bölümünün rol bazlı davranışını GERÇEK
// arayüz akışlarıyla doğrular: Hizmet Alan (ve misafir) için tamamen
// tanıtım amaçlı/tıklanamaz kartlar, Hizmet Veren için service-catalog.ts'in
// merkezi id'siyle /ilanlar'a filtreli yönlendiren tıklanabilir kartlar.
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

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

/** Bir hizmet kartının başlığından, kartın gerçek sarmalayıcısına (a ya da div.rounded-card) çıkar. */
function cardWrapperFor(page, title) {
  return page
    .locator("#hizmetler h3", { hasText: title })
    .first()
    .locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
}

async function assertReadOnlyServicesSection(page, label) {
  await page.goto(`${BASE_URL}/`);
  await page.locator("#hizmetler").waitFor({ state: "visible", timeout: 10000 });

  const titles = await page.locator("#hizmetler h3").allTextContents();
  assert.equal(titles.length, 38, `${label}: tam olarak 38 hizmet kartı görünmeli (katalogdaki toplam kategori sayısı)`);
  assert.equal(new Set(titles).size, titles.length, `${label}: hiçbir hizmet iki kez listelenmemeli`);
  ok(`${label}: 38 benzersiz hizmet kartı, katalogdan (SERVICE_CATEGORY_GROUPS) türetilmiş şekilde görünüyor`);

  assert.equal(
    await page.locator("#hizmetler").getByText("İncele", { exact: true }).count(),
    0,
    `${label}: hiçbir kartta "İncele" metni/ok simgesi olmamalı`,
  );
  ok(`${label}: hiçbir kartta "İncele" metni yok`);

  const wrapper = cardWrapperFor(page, "Lashing");
  const tagName = await wrapper.evaluate((el) => el.tagName);
  assert.equal(tagName, "DIV", `${label}: kart bir <a> değil, düz bir <div> olmalı (tıklanamaz)`);
  assert.equal(await wrapper.getAttribute("href"), null, `${label}: kartta href olmamalı`);
  ok(`${label}: "Lashing" kartı düz bir <div> (link değil)`);

  await wrapper.click();
  await page.waitForTimeout(300);
  assert.equal(page.url(), `${BASE_URL}/`, `${label}: karta tıklanınca sayfa değişmemeli`);
  ok(`${label}: karta tıklamak hiçbir yönlendirme/aksiyon üretmiyor`);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();

  // =====================================================================
  // 1) Misafir (oturum yok) — tamamen tanıtım amaçlı.
  // =====================================================================
  await assertReadOnlyServicesSection(page, "Misafir");

  // =====================================================================
  // 2) Hizmet Alan (dev seed: zeynep@test.com) — tamamen tanıtım amaçlı.
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
  await assertReadOnlyServicesSection(page, "Hizmet Alan");

  // =====================================================================
  // 3) Hizmet Veren (dev seed: mert@test.com) — tıklanabilir + filtreli yönlendirme.
  // =====================================================================
  await loginAs(page, "mert@test.com", "Mert123!", "/panel");
  await page.goto(`${BASE_URL}/`);
  await page.locator("#hizmetler").waitFor({ state: "visible", timeout: 10000 });
  // Sunucu render'ı oturumu bilmediğinden (useSession -> null) bölüm ilk
  // boyamada HER ZAMAN salt-okunur görünür; hidrasyon tamamlanıp gerçek
  // (hizmet-veren) oturuma geçene kadar bekle — aksi halde aşağıdaki
  // tıklanabilirlik kontrolleri bir yarış koşuluyla yanlışlıkla geçer/kalır.
  await page.getByText("İncele", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });

  const providerTitles = await page.locator("#hizmetler h3").allTextContents();
  assert.equal(providerTitles.length, 38, "Hizmet Veren: aynı 38 hizmet gösterilmeli");
  assert.equal(new Set(providerTitles).size, 38, "Hizmet Veren: hiçbir hizmet iki kez listelenmemeli");
  ok("Hizmet Veren: Hizmet Alan ile AYNI 38 hizmet gösteriliyor");

  const forkliftWrapper = cardWrapperFor(page, "Forklift Operatörü");
  assert.equal(await forkliftWrapper.evaluate((el) => el.tagName), "A", "Hizmet Veren: kart bir <a> olmalı (tıklanabilir)");
  const href = await forkliftWrapper.getAttribute("href");
  assert.equal(href, "/ilanlar?kategori=forklift-operatoru", "Hizmet Veren: href, merkezi katalog id'sini (serviceId) taşımalı, hizmet adını DEĞİL");
  ok('Hizmet Veren: "Forklift Operatörü" kartı /ilanlar?kategori=forklift-operatoru adresine bağlı (isme değil id\'ye göre)');

  await forkliftWrapper.click();
  await page.waitForURL(/\/ilanlar\?kategori=forklift-operatoru/, { timeout: 10000 });
  ok("Hizmet Veren: karta tıklayınca doğrudan İş İlanları ekranına, filtreli olarak yönlendiriliyor");

  await page.locator("#job-listing-filter-category").waitFor({ state: "visible", timeout: 10000 });
  let selectedLabel = await page.locator("#job-listing-filter-category").innerText();
  assert.ok(selectedLabel.includes("Forklift Operatörü"), 'Sayfa açıldığında "Hizmet Türü" filtresi "Forklift Operatörü" olarak seçili görünmeli');
  ok('Sayfa açıldığında ilgili filtre ("Forklift Operatörü") seçili görünüyor');

  await page.waitForFunction(() => document.body.innerText.includes("Aktif İlan"), { timeout: 10000 });
  let bodyText = await page.locator("body").innerText();
  assert.ok(bodyText.includes("Fabrika Sahasında Forklift Operatörü İhtiyacı"), "Filtrelenmiş listede beklenen Kocaeli ilanı görünmeli");
  assert.ok(/^1 Aktif İlan/m.test(bodyText), "Yalnızca eşleşen 1 ilan sayılmalı");
  ok("İlgili kategoriye ait gerçek ilan (mevcut filtreleme altyapısıyla) doğru gösteriliyor");

  // Kullanıcı filtreyi temizleyebilmeli.
  await page.getByRole("button", { name: "Filtreleri Temizle" }).click();
  await page.waitForFunction(
    () => document.querySelector("#job-listing-filter-category")?.textContent?.includes("Tümü"),
    { timeout: 10000 },
  );
  ok('Kullanıcı "Filtreleri Temizle" ile seçili filtreyi temizleyebiliyor');

  // =====================================================================
  // 4) İlan bulunmayan bir kategori -> mevcut boş durum ekranı.
  // =====================================================================
  await page.goto(`${BASE_URL}/`);
  await page.locator("#hizmetler").waitFor({ state: "visible", timeout: 10000 });
  const manliftWrapper = cardWrapperFor(page, "Manlift Operatörü");
  await manliftWrapper.click();
  await page.waitForURL(/\/ilanlar\?kategori=manlift-operatoru/, { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes("Aktif İlan"), { timeout: 10000 });
  bodyText = await page.locator("body").innerText();
  assert.ok(/^0 Aktif İlan/m.test(bodyText), "İlansız bir kategoride 0 ilan sayılmalı");
  assert.ok(bodyText.includes("Filtre kriterlerinize uyan ilan bulunamadı."), "İlansız kategoride mevcut boş durum mesajı gösterilmeli");
  ok("İlan bulunmayan bir kategori için MEVCUT boş durum ekranı (yeni bir ekran icat edilmeden) gösteriliyor");

  // =====================================================================
  // 5) Geri/ileri navigasyon filtreyi bozmamalı.
  // =====================================================================
  await page.goBack();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
  ok("Geri navigasyon ana sayfaya dönüyor");

  await page.goForward();
  await page.waitForURL(/\/ilanlar\?kategori=manlift-operatoru/, { timeout: 10000 });
  await page.locator("#job-listing-filter-category").waitFor({ state: "visible", timeout: 10000 });
  selectedLabel = await page.locator("#job-listing-filter-category").innerText();
  assert.ok(selectedLabel.includes("Manlift Operatörü"), "İleri navigasyon sonrası filtre hâlâ doğru kategoriyi göstermeli");
  ok("İleri navigasyon sonrası filtre bozulmadan doğru kategoriyi gösteriyor");

  await context.close();
  console.log(`\n[tmp-services-section-role-based-test] ${passed} test geçti.`);
}

main()
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (browser) await browser.close();
    } catch {
      // yok say
    }
  });
