// node scripts/tmp-incoming-offers-rejected-priority-order-live-test.mjs
//
// "Gelen Teklifler kart sıralaması" görevini GERÇEK arayüz akışlarıyla (ham
// localStorage enjeksiyonu YOK) uçtan uca doğrular:
//   1) Hizmet türü başlığı (ör. "Unlashing") kalın (font-weight >= 700)
//      render ediliyor.
//   2) Aynı ilana (şablona) ait bir teklif "Reddedildi" olduğunda: (a) kart
//      SİLİNMİYOR/başka bir sayfaya taşınmıyor — AYNI ilan grubunda kalıyor;
//      (b) otomatik olarak o ilan grubunun EN ALTINA iniyor; (c) diğer
//      (hâlâ bekleyen) tekliflerin kendi Kabul Et/Reddet aksiyonları
//      ETKİLENMİYOR (bu, ayrı bir teklif olduğu ve reddin "kilit" mantığını
//      (isOfferPendingActionBlocked) hiç TETİKLEMEDİĞİ için zaten beklenen
//      bir iş kuralıdır — bu script YENİ bir kural İCAT ETMEZ, yalnızca
//      bunun sayfa yenilemeden de GÖRSEL olarak doğru yansıdığını kanıtlar).
//   3) Reddedilen tekliften SONRA gelen bir "accepted" teklif de kendi
//      kademesine (Reddedildi'nin ÜSTÜNE) yerleşiyor — tam öncelik sırası.
//   4) Farklı bir ilana (job B) ait teklif hiç etkilenmiyor.
//   5) Sayfa yenilendikten sonra da sıra korunuyor.
//
// Bu script, job-requests.ts#sortIncomingOffersForDisplay'in "rejected"
// davranışının saf mantık kanıtını (bkz.
// tmp-incoming-offers-sort-agreement-failed-test.mjs) DEĞİL, bu fonksiyonun
// GERÇEKTEN bağlı olduğu bileşenlerin (incoming-offers-panel.tsx,
// incoming-offer-category-section.tsx) gerçek DOM çıktısını doğrular.
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
  await page.getByLabel("Açık Adres").first().fill("Reddedilmiş teklif sıralaması testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Reddedilmiş teklif sıralaması testi operasyon detayı, en az on karakter.");
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
  return page
    .locator("section:not(.bg-background)")
    .filter({ has: page.getByRole("heading", { level: 2, name: categoryLabel, exact: true }) });
}

/** Bir bölümdeki TÜM teklif kartlarını DOM sırasıyla tarayıp bilinen fiyat metinlerinden hangisini içerdiklerini eşleştirir. */
async function readOfferOrderByAmounts(section, amounts) {
  const knownTexts = amounts.map(amountText);
  const cards = section.locator("div.rounded-card");
  const count = await cards.count();
  const order = [];
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).innerText();
    const matchIndex = knownTexts.findIndex((needle) => text.includes(needle));
    if (matchIndex !== -1) order.push(amounts[matchIndex]);
  }
  return order;
}

let browser;
let profileDir;

async function main() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-incoming-offers-rejected-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const suffix = crypto.randomUUID().slice(0, 8);
  const AMOUNT_PENDING = 21000; // job A, reddedilmeyecek, hâlâ bekleyecek
  const AMOUNT_REJECTED = 22000; // job A, reddedilecek — en eski createdAt (normal recency'de EN ÜSTTE olurdu)
  const AMOUNT_ACCEPTED = 23000; // job A, reddedilenden SONRA gönderilir, kabul edilecek
  const AMOUNT_OTHER_JOB = 24000; // job B, hiç dokunulmayacak (izolasyon kontrolü)

  // =====================================================================
  // KURULUM: talep sahibi + "Unlashing" kategorisinde bir ilan (job A) +
  // izolasyon kontrolü için farklı bir ilan (job B, farklı kategori).
  // =====================================================================
  const requesterEmail = `reddedilmis-test-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Reddedilmis",
    lastName: "TestSahibi",
    email: requesterEmail,
    phone: "+905556660000",
    role: "hizmet-alan",
    companyName: "Reddedilmiş Teklif Testi Firması",
    password: "ReddTest1!",
  });
  const jobATitle = `Reddedilmiş Teklif Testi İlan A ${suffix}`;
  const jobBTitle = `Reddedilmiş Teklif Testi İlan B ${suffix}`;
  const jobAId = await createRealJobViaForm(page, {
    category: "unlashing",
    title: jobATitle,
    description: "İlan A (Unlashing) açıklaması, en az yirmi karakter içerir.",
  });
  const jobBId = await createRealJobViaForm(page, {
    category: "forklift",
    title: jobBTitle,
    description: "İlan B (Forklift, farklı kategori) açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: Unlashing ilanı (A=${jobAId}) + farklı kategoride izolasyon ilanı (B=${jobBId}) GERÇEK formla oluşturuldu`);

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Bir", email: `redd-saglayici-1-${suffix}@example.com`,
    phone: "+905557770001", role: "hizmet-veren", companyName: "Sağlayıcı Bir", password: "ReddSag1!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_PENDING, "Bekleyen teklif, hiç dokunulmayacak, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Iki", email: `redd-saglayici-2-${suffix}@example.com`,
    phone: "+905557770002", role: "hizmet-veren", companyName: "Sağlayıcı İki", password: "ReddSag2!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_REJECTED, "Reddedilecek teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Uc", email: `redd-saglayici-3-${suffix}@example.com`,
    phone: "+905557770003", role: "hizmet-veren", companyName: "Sağlayıcı Üç", password: "ReddSag3!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_ACCEPTED, "Kabul edilecek teklif, reddedilenden SONRA gönderilir, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Dort", email: `redd-saglayici-4-${suffix}@example.com`,
    phone: "+905557770004", role: "hizmet-veren", companyName: "Sağlayıcı Dört", password: "ReddSag4!",
  });
  await submitRealOffer(page, jobBId, AMOUNT_OTHER_JOB, "Farklı ilana (job B) ait teklif, izolasyon kontrolü, yirmi karakterden uzun.");
  ok("KURULUM: job A'ya 3 teklif (bekleyen, reddedilecek, kabul edilecek) + job B'ye 1 izolasyon teklifi GERÇEK formla gönderildi");

  // =====================================================================
  // TEST 1: hizmet türü başlığı ("Unlashing") kalın (bold, >=700) render ediliyor.
  // =====================================================================
  await loginAs(page, requesterEmail, "ReddTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  const unlashingSection = categorySection(page, "Unlashing");
  await unlashingSection.waitFor({ state: "visible", timeout: 10000 });
  const categoryHeading = unlashingSection.getByRole("heading", { level: 2, name: "Unlashing", exact: true });
  const fontWeight = await categoryHeading.evaluate((el) => Number(window.getComputedStyle(el).fontWeight));
  assert.ok(fontWeight >= 700, `Hizmet türü başlığının font-weight'i >= 700 olmalı (bulunan: ${fontWeight})`);
  ok(`TEST 1: 'Unlashing' hizmet türü başlığı kalın render ediliyor (font-weight: ${fontWeight})`);

  // =====================================================================
  // TEST 2: reddetmeden ÖNCE taban çizgisi — üç teklif de job A'nın grubunda,
  // recency sırasıyla (en yeni ilk): kabul edilecek, reddedilecek, bekleyen.
  // =====================================================================
  let order = await readOfferOrderByAmounts(unlashingSection, [AMOUNT_PENDING, AMOUNT_REJECTED, AMOUNT_ACCEPTED]);
  assert.deepEqual(order, [AMOUNT_ACCEPTED, AMOUNT_REJECTED, AMOUNT_PENDING], "Reddetmeden ÖNCE: üçü de aynı (pending) kademede, saf recency sırasıyla görünmeli");
  ok("TEST 2 (taban çizgisi): reddetmeden önce üç teklif de recency sırasıyla görünüyor");

  // =====================================================================
  // TEST 3: "reddedilecek" teklifi Reddet — SAYFA YENİLEMEDEN:
  // (a) kart SİLİNMİYOR, aynı (Unlashing / İlan A) grubunda kalıyor;
  // (b) en alta iniyor; (c) bekleyen teklifin kendi butonları etkilenmiyor.
  // =====================================================================
  await offerCard(page, AMOUNT_REJECTED).getByRole("button", { name: "Reddet", exact: true }).click();
  await offerCard(page, AMOUNT_REJECTED).getByText("Reddedildi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  assert.equal(
    await unlashingSection.getByRole("heading", { level: 3, name: jobATitle, exact: true }).count(),
    1,
    "TEST 3: Reddedilen teklif hâlâ AYNI (Unlashing) kategori + İlan A grubunda kalmalı — başka bir sayfaya/sekmeye taşınmamalı",
  );
  const pendingCardAfterReject = offerCard(page, AMOUNT_PENDING);
  assert.equal(await pendingCardAfterReject.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST 3: Bekleyen teklifin (AMOUNT_PENDING) Kabul Et butonu reddetmeden ETKİLENMEMELİ");
  assert.equal(await pendingCardAfterReject.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "TEST 3: Bekleyen teklifin (AMOUNT_PENDING) Reddet butonu reddetmeden ETKİLENMEMELİ");
  ok("TEST 3: Reddedilen teklif kartı SİLİNMEDİ/taşınmadı, aynı ilan grubunda kaldı; kardeş bekleyen teklifin butonları etkilenmedi");

  order = await readOfferOrderByAmounts(unlashingSection, [AMOUNT_PENDING, AMOUNT_REJECTED, AMOUNT_ACCEPTED]);
  assert.deepEqual(
    order,
    [AMOUNT_ACCEPTED, AMOUNT_PENDING, AMOUNT_REJECTED],
    "TEST 3 (canlı, yenilemeden): reddedilen teklif SAYFA YENİLEMEDEN en alta inmeli; pending/accepted kendi aralarındaki recency sırasını korumalı",
  );
  ok("TEST 3 (devam): reddedilen teklif SAYFA YENİLEMEDEN otomatik olarak en alta indi");

  // =====================================================================
  // TEST 4: "kabul edilecek" teklifi Kabul Et — tam öncelik sırası:
  // accepted, pending'in bile üstüne (Kabul Edildi, Beklemede'nin bir üst
  // kademesi DEĞİL, görev sırasına göre Beklemede > Kabul Edildi'dir, bu
  // yüzden pending hâlâ EN üstte kalmalı) — reddedilen ise hep en altta.
  // =====================================================================
  await offerCard(page, AMOUNT_ACCEPTED).getByRole("button", { name: "Kabul Et", exact: true }).click();
  await offerCard(page, AMOUNT_ACCEPTED).getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).waitFor({ state: "visible", timeout: 10000 });

  order = await readOfferOrderByAmounts(unlashingSection, [AMOUNT_PENDING, AMOUNT_REJECTED, AMOUNT_ACCEPTED]);
  assert.deepEqual(
    order,
    [AMOUNT_PENDING, AMOUNT_ACCEPTED, AMOUNT_REJECTED],
    "TEST 4: Beklemede (AMOUNT_PENDING) EN üstte, Kabul Edildi (AMOUNT_ACCEPTED) ortada, Reddedildi (AMOUNT_REJECTED) HER ZAMAN en altta olmalı",
  );
  ok("TEST 4: Tam öncelik sırası doğrulandı — Beklemede > Kabul Edildi > Reddedildi");

  // =====================================================================
  // TEST 5: farklı ilana (job B) ait teklif hiç etkilenmedi.
  // =====================================================================
  const otherCard = offerCard(page, AMOUNT_OTHER_JOB);
  assert.equal(await otherCard.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST 5: Farklı ilana (job B) ait teklifin Kabul Et butonu ETKİLENMEMELİ");
  assert.equal(await otherCard.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "TEST 5: Farklı ilana (job B) ait teklifin Reddet butonu ETKİLENMEMELİ");
  ok("TEST 5: Farklı ilana (job B) ait teklif tamamen etkilenmeden kaldı");

  // =====================================================================
  // TEST 6: sayfa yenilendikten sonra da sıra korunuyor.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  const unlashingSectionAfterReload = categorySection(page, "Unlashing");
  order = await readOfferOrderByAmounts(unlashingSectionAfterReload, [AMOUNT_PENDING, AMOUNT_REJECTED, AMOUNT_ACCEPTED]);
  assert.deepEqual(order, [AMOUNT_PENDING, AMOUNT_ACCEPTED, AMOUNT_REJECTED], "TEST 6: Sayfa yenilendikten SONRA da sıra [Beklemede, Kabul Edildi, Reddedildi] korunmalı");
  ok("TEST 6: Sayfa yenilemesinden sonra da sıralama korundu");

  await context.close();
  console.log(`\n[tmp-incoming-offers-rejected-priority-order-live-test] ${passed} test geçti.`);
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
