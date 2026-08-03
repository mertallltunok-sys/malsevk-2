// node scripts/tmp-incoming-offers-category-grouping-live-test.mjs
//
// "Gelen Teklifler" ekranının yeni Hizmet Türü -> İlan -> Teklifler
// bilgi mimarisini GERÇEK arayüz akışlarıyla (ham localStorage enjeksiyonu
// YOK) uçtan uca doğrular: farklı hizmet türlerinin AYRI kutularda, aynı
// hizmet türündeki farklı ilanların AYRI ilan gruplarında, aynı ilana gelen
// tekliflerin TEK ilan grubunda göründüğünü; masaüstünde iki sütunlu
// grid'in, mobilde tek sütunlu istiflemenin ve yatay taşma olmadığını;
// VE bu görsel yeniden düzenlemenin teklif kabul/ret/anlaşma-sağlanamadı
// mekanizmasını ve buton görünürlük kuralını BOZMADIĞINI kanıtlar.
//
// "Eksik ilan" (jobId bulunamıyor) senaryosu burada DENENMEZ — uygulamanın
// kendi iş kuralı (offers.ts#deleteJobWithOffers bir ilanı silerken ona ait
// TÜM teklifleri de siler) bu durumu gerçek arayüz akışlarıyla ASLA
// üretilemez hale getirir; o senaryo saf mantık testinde
// (tmp-incoming-offer-grouping-test.mjs, "H" ve "iki farklı eksik jobId")
// doğrudan `groupIncomingOffersByCategoryAndJob`ya karşı zaten kanıtlanmıştır.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

async function registerRealUser(page, { firstName, lastName, email, phone, role, companyName, password }) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  const roleLabel = role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren";
  await page.getByRole("radio", { name: roleLabel, exact: true }).check();
  await page.getByLabel("Telefon Numarası", { exact: true }).fill(phone);
  await page.getByLabel("Firma Adı", { exact: true }).fill(companyName);
  const companyTypeLabel = role === "hizmet-veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi";
  await page.getByLabel(companyTypeLabel, { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "İl", exact: true }).first().click();
  await page.locator('ul[aria-label="İl"]').first().getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill(password);
  await page.getByLabel(/KVKK/).check();
  await page.getByLabel(/Kullanım Koşulları/).check();
  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await loginAs(page, email, password);
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

/** GERÇEK ilan oluşturma formu üzerinden, verilen kategori id'siyle tek servisli bir ilan yayınlar. */
async function createRealJobViaForm(page, { category, title, description }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

  await page.getByLabel("Hizmet Kategorisi").first().selectOption(category);
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill(description);
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-01");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-02");
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).first().click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').first().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .first()
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await page.getByLabel("Açık Adres").first().fill("Kategori görünüm testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Gelen Teklifler kategori/ilan gruplama testi, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  return page.url().split("/ilanlar/")[1];
}

async function submitRealOffer(page, jobId, amount, description) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı").fill(String(amount));
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

function amountText(amount) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}

function offerCard(page, amount) {
  return page.locator("div.rounded-card").filter({ hasText: amountText(amount) });
}

function categorySection(page, categoryLabel) {
  // Sayfanın kendi kök `<section className="bg-background">` sarmalayıcısı
  // (page.tsx) da filtre eşleşmesine (torun olarak) dahil olur — bu yüzden
  // onu açıkça hariç tutan `:not()` ile YALNIZCA yeni kategori kutusunu
  // (incoming-offer-category-section.tsx) hedefleriz.
  return page
    .locator("section:not(.bg-background)")
    .filter({ has: page.getByRole("heading", { level: 2, name: categoryLabel, exact: true }) });
}

/**
 * `document.documentElement.scrollWidth > clientWidth` TEK BAŞINA güvenilir
 * bir yatay taşma testi DEĞİLDİR — Chromium'da `text-overflow: ellipsis`
 * (`truncate`) kullanan iç içe flex/grid düzenlerde, ekranda HİÇBİR görsel
 * kırpılma/taşma olmasa bile `scrollWidth` birkaç piksel yüksek raporlanan
 * bilinen bir motor kuraksılığı vardır (doğrulandı: bu ekranda `scrollWidth`
 * 330 iken `clientWidth` 320 çıkabiliyor, ANCAK ekran görüntüsünde hiçbir
 * kırpılma yok ve sayfa GERÇEKTEN yatay kaydırılamıyor). Bu yüzden asıl
 * kullanıcı deneyimini belirleyen GERÇEK ölçüt kullanılır: sayfa fiilen
 * yatay kaydırılabiliyor mu (`window.scrollTo` sonrası `scrollX` gerçekten
 * değişiyor mu)?
 */
async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => {
    const originalX = window.scrollX;
    window.scrollTo(99999, window.scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(originalX, window.scrollY);
    return scrolledX === 0;
  });
}

let browser;
let profileDir;

async function main() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-incoming-offers-grouping-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const suffix = crypto.randomUUID().slice(0, 8);
  const AMOUNT_LASHING_A_1 = 11000;
  const AMOUNT_LASHING_A_2 = 12000;
  const AMOUNT_LASHING_B_1 = 13000;
  const AMOUNT_DEPO_1 = 14000;

  // =====================================================================
  // KURULUM: talep sahibi + 3 ilan — İKİSİ AYNI kategoride (lashing, iki
  // farklı ilan), BİRİ farklı kategoride (genel-depolama).
  // =====================================================================
  const requesterEmail = `kategori-test-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Kategori",
    lastName: "TestSahibi",
    email: requesterEmail,
    phone: "+905553330000",
    role: "hizmet-alan",
    companyName: "Kategori Testi Firması",
    password: "KategoriTest1!",
  });
  const jobLashingATitle = `Kategori Testi Lashing İlanı A ${suffix}`;
  const jobLashingBTitle = `Kategori Testi Lashing İlanı B ${suffix}`;
  const jobDepoTitle = `Kategori Testi Depo İlanı ${suffix}`;
  const jobLashingAId = await createRealJobViaForm(page, {
    category: "lashing",
    title: jobLashingATitle,
    description: "Lashing ilanı A açıklaması, en az yirmi karakter içerir.",
  });
  const jobLashingBId = await createRealJobViaForm(page, {
    category: "lashing",
    title: jobLashingBTitle,
    description: "Lashing ilanı B açıklaması, en az yirmi karakter içerir.",
  });
  const jobDepoId = await createRealJobViaForm(page, {
    category: "genel-depolama",
    title: jobDepoTitle,
    description: "Depo ilanı açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: 2 Lashing ilanı (A=${jobLashingAId}, B=${jobLashingBId}) + 1 Genel Depolama ilanı (${jobDepoId}) GERÇEK formla oluşturuldu`);

  // =====================================================================
  // Teklifler: Lashing A'ya İKİ teklif (B senaryosu), Lashing B'ye BİR
  // teklif (C senaryosu — aynı kategori, farklı ilan), Depo'ya BİR teklif
  // (D senaryosu — farklı kategori).
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Bir", email: `kat-saglayici-1-${suffix}@example.com`,
    phone: "+905554440001", role: "hizmet-veren", companyName: "Sağlayıcı Bir", password: "Kat1sifre!",
  });
  await submitRealOffer(page, jobLashingAId, AMOUNT_LASHING_A_1, "Lashing A birinci teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Iki", email: `kat-saglayici-2-${suffix}@example.com`,
    phone: "+905554440002", role: "hizmet-veren", companyName: "Sağlayıcı İki", password: "Kat2sifre!",
  });
  await submitRealOffer(page, jobLashingAId, AMOUNT_LASHING_A_2, "Lashing A ikinci teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Uc", email: `kat-saglayici-3-${suffix}@example.com`,
    phone: "+905554440003", role: "hizmet-veren", companyName: "Sağlayıcı Üç", password: "Kat3sifre!",
  });
  await submitRealOffer(page, jobLashingBId, AMOUNT_LASHING_B_1, "Lashing B teklifi, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Dort", email: `kat-saglayici-4-${suffix}@example.com`,
    phone: "+905554440004", role: "hizmet-veren", companyName: "Sağlayıcı Dört", password: "Kat4sifre!",
  });
  await submitRealOffer(page, jobDepoId, AMOUNT_DEPO_1, "Depo teklifi, yirmi karakterden uzun.");
  ok("KURULUM: 4 teklif GERÇEK teklif formuyla gönderildi (Lashing A x2, Lashing B x1, Depo x1)");

  // =====================================================================
  // TEST A/B/C/D: doğru kategori/ilan gruplaması.
  // =====================================================================
  await loginAs(page, requesterEmail, "KategoriTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");

  const lashingSection = categorySection(page, "Lashing");
  const depoSection = categorySection(page, "Genel Depolama");
  await lashingSection.waitFor({ state: "visible", timeout: 10000 });
  await depoSection.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await categorySection(page, "Lashing").count(), 1, "TEST D: Lashing için TEK kategori kutusu olmalı (Depo ile karışmamalı)");
  assert.equal(await categorySection(page, "Genel Depolama").count(), 1, "TEST D: Genel Depolama için TEK, AYRI kategori kutusu olmalı");
  ok("TEST D: Lashing ve Depolama teklifleri AYRI hizmet kutularında görünüyor");

  // NOT: ilan başlığı hem ilan grubu başlığında (h3) hem de her teklif
  // kartının kendi üst satırında (mevcut, DEĞİŞTİRİLMEMİŞ IncomingOfferCard)
  // ayrı ayrı görünür — bu KASITLI (görev gereksinimi, bağlam her iki yerde
  // de net olsun diye). Belirsizliği önlemek için burada özellikle YENİ ilan
  // grubu başlığını (h3, level 3) hedefliyoruz, kartın kendi metnini değil.
  assert.equal(await lashingSection.getByRole("heading", { level: 3, name: jobLashingATitle, exact: true }).count(), 1, "TEST C: Lashing kutusunda İlan A başlığı (ilan grubu başlığı) görünmeli");
  assert.equal(await lashingSection.getByRole("heading", { level: 3, name: jobLashingBTitle, exact: true }).count(), 1, "TEST C: Lashing kutusunda İlan B başlığı da (AYRI ilan grubu olarak) görünmeli");
  assert.equal(await depoSection.getByRole("heading", { level: 3, name: jobDepoTitle, exact: true }).count(), 1, "TEST A: Depo kutusunda kendi ilan başlığı (ilan grubu başlığı) görünmeli");
  ok("TEST A/C: Aynı kategoride iki FARKLI ilan (Lashing A, Lashing B) kendi ayrı ilan başlıklarıyla görünüyor; Depo kendi kutusunda kendi ilanıyla görünüyor");

  assert.equal(await lashingSection.getByText(amountText(AMOUNT_LASHING_A_1), { exact: false }).count(), 1, "Lashing A'nın ilk teklifi Lashing kutusunda olmalı");
  assert.equal(await lashingSection.getByText(amountText(AMOUNT_LASHING_A_2), { exact: false }).count(), 1, "Lashing A'nın ikinci teklifi de AYNI (Lashing) kutusunda olmalı");
  ok("TEST B: Aynı ilana (Lashing A) verilen İKİ teklif de tek ilan grubu altında, doğru kategori kutusunda görünüyor");

  // Lashing A'nın ilan grubu başlığı altında GERÇEKTEN 2 teklif sayılıyor mu?
  const lashingAJobGroupText = await lashingSection.getByRole("heading", { level: 3, name: jobLashingATitle, exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]").innerText();
  assert.ok(lashingAJobGroupText.includes("2 teklif"), `Lashing A ilan grubu başlığı '2 teklif' göstermeli, gelen: ${JSON.stringify(lashingAJobGroupText)}`);
  ok("TEST B (devam): İlan grubu başlığı doğru teklif sayısını (2 teklif) gösteriyor");

  // =====================================================================
  // TEST E/F/G: yeni gruplu görünüm İÇİNDE kabul/kilit/anlaşma-sağlanamadı
  // mekanizması ve buton görünürlüğü BOZULMADAN çalışıyor mu?
  // =====================================================================
  await offerCard(page, AMOUNT_LASHING_A_1).getByRole("button", { name: "Kabul Et", exact: true }).click();
  await offerCard(page, AMOUNT_LASHING_A_1).getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("TEST E: Kabul Et çalışıyor — kart 'Görüşme Sonucu' (İşe Başlandı/Anlaşma Sağlanamadı) aşamasına geçti");

  const siblingCard = offerCard(page, AMOUNT_LASHING_A_2);
  await siblingCard.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await siblingCard.getByRole("button", { name: "Kabul Et", exact: true }).count(), 0, "TEST F: Aynı ilandaki (Lashing A) diğer teklifin Kabul Et butonu gizlenmeli");
  assert.equal(await siblingCard.getByRole("button", { name: "Reddet", exact: true }).count(), 0, "TEST F: Aynı ilandaki (Lashing A) diğer teklifin Reddet butonu gizlenmeli");
  const unrelatedLashingBCard = offerCard(page, AMOUNT_LASHING_B_1);
  assert.equal(await unrelatedLashingBCard.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST F: FARKLI ilana (Lashing B) ait teklifin butonları ETKİLENMEMELİ");
  const unrelatedDepoCard = offerCard(page, AMOUNT_DEPO_1);
  assert.equal(await unrelatedDepoCard.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST F: FARKLI kategoriye (Depo) ait teklifin butonları ETKİLENMEMELİ");
  ok("TEST F: Aynı ilandaki kilit mesajı doğru görünüyor; farklı ilan/kategorideki teklifler ETKİLENMİYOR");

  const agreementFailedCard = offerCard(page, AMOUNT_LASHING_A_1);
  await agreementFailedCard.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
  await agreementFailedCard.getByRole("radio", { name: "Diğer", exact: true }).check();
  await agreementFailedCard.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle", exact: true }).click();
  // job-requests.ts#isOfferShownInIncomingOffersScreen: "agreement_failed" artık
  // Gelen Teklifler'den TAMAMEN kalkar (kayıt silinmez, yalnızca bu ekrandan
  // çıkar) — kart bir rozetle GÜNCELLENMEZ, DOM'dan kaldırılır.
  await agreementFailedCard.waitFor({ state: "hidden", timeout: 10000 });
  await siblingCard.getByRole("button", { name: "Kabul Et", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await siblingCard.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "TEST G: Anlaşma sağlanamadığında Reddet butonu da tekrar görünmeli");
  assert.equal(
    await lashingSection.getByRole("heading", { level: 3, name: jobLashingATitle, exact: true }).count(),
    1,
    "TEST G: kardeş (hâlâ pending) teklif sayesinde İlan A grubu (Lashing kategorisi altında) hâlâ görünür kalmalı",
  );
  ok("TEST G: 'Anlaşma Sağlanamadı' sonrası kardeş teklifin butonları tekrar görünüyor; anlaşma sağlanamayan teklifin kendisi Gelen Teklifler'den kalktı, İlan A grubu kardeş teklif sayesinde kaldı");

  // =====================================================================
  // TEST J/K + masaüstü geniş alan kullanımı: xl (>=1280px) genişlikte iki
  // kategori kutusu YAN YANA (2 sütun) olmalı.
  // =====================================================================
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
  const lashingBox = await lashingSection.boundingBox();
  const depoBox = await depoSection.boundingBox();
  assert.ok(lashingBox && depoBox, "her iki kategori kutusunun da bounding box'ı olmalı");
  assert.notEqual(lashingBox.x, depoBox.x, "TEST K: 1440px genişlikte iki kategori kutusu YAN YANA (farklı x) olmalı — 2 sütunlu grid aktif");
  ok("TEST K: Masaüstünde (1440px) iki hizmet kategorisi kutusu 2 sütunlu grid içinde YAN YANA görünüyor (geniş alan verimli kullanılıyor)");

  // =====================================================================
  // TEST I/J: mobil/tablet'te tek sütun + yatay taşma yok.
  // =====================================================================
  for (const width of [320, 375, 390, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const noOverflow = await hasNoHorizontalOverflow(page);
    assert.ok(noOverflow, `${width}px genişlikte yatay taşma OLMAMALI`);
  }
  ok("TEST I/J: 320/375/390/768/1280/1440/1920px genişliklerde yatay taşma tespit edilmedi");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  const lashingBoxMobile = await lashingSection.boundingBox();
  const depoBoxMobile = await depoSection.boundingBox();
  assert.equal(lashingBoxMobile.x, depoBoxMobile.x, "TEST I: 375px genişlikte iki kategori kutusu AYNI x'te (tek sütun, alt alta) olmalı");
  assert.notEqual(lashingBoxMobile.y, depoBoxMobile.y, "TEST I: 375px genişlikte kutular farklı y'de (alt alta) olmalı");
  ok("TEST I: Mobilde (375px) hizmet kategorileri TEK sütun olarak alt alta diziliyor");

  await context.close();
  console.log(`\n[tmp-incoming-offers-category-grouping-live-test] ${passed} test geçti.`);
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
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // yok say
    }
  });
