// node scripts/tmp-incoming-offers-hide-settled-status-test.mjs
//
// "Gelen Teklifler ekranı yalnızca işlem bekleyen teklifleri gösterir" görevini
// GERÇEK arayüz akışlarıyla (ham localStorage enjeksiyonu YOK, yalnızca son
// doğrulama adımında kayıtların SİLİNMEDİĞİNİ kanıtlamak için okunur) uçtan
// uca doğrular — job-requests.ts#isOfferShownInIncomingOffersScreen'in tek
// kaynak olduğu kural: bir teklif "rejected" ya da "agreement_failed"
// olduğunda Gelen Teklifler ekranından TAMAMEN kalkar (kayıt SİLİNMEZ,
// yalnızca bu TEK ekranın render listesinden çıkar).
//
//   1) Baseline: iki farklı hizmet türünde (Unlashing/Forklift), iki farklı
//      ilanda, tüm teklifler görünür.
//   2) İlan A'daki bir teklif reddedilince: (a) o teklifin kartı SAYFA
//      YENİLEMEDEN kalkar; (b) AYNI ilandaki kardeş (hâlâ pending) teklif ve
//      onun butonları etkilenmez; (c) İlan A grubu ve Unlashing kategori
//      kutusu kardeş teklif sayesinde AYAKTA kalır; (d) FARKLI ilana/
//      kategoriye (İlan B, Forklift) ait teklif hiç etkilenmez.
//   3) Sayfa yenilendikten sonra da reddedilen teklif geri gelmez (kalıcı,
//      yalnızca iyimser/optimistic bir UI durumu değil).
//   4) İlan A'nın SON kalan (görüntülenecek) teklifi de "Anlaşma
//      Sağlanamadı" olunca: İlan A grubu VE Unlashing kategori kutusunun
//      TAMAMI Gelen Teklifler'den kalkar — boşluk bırakmadan, Forklift
//      kutusu hiç etkilenmeden kalır (görev md. 4/5).
//   5) Sayfa yenilendikten sonra da bu durum korunur.
//   6) Daha sonra İlan A'ya YENİ bir teklif gelince Unlashing kategori kutusu
//      ve İlan A grubu OTOMATİK olarak yeniden belirir — ama eski
//      reddedilen/anlaşma sağlanamayan teklifler bir daha ASLA görünmez
//      (görev md. 6).
//   7) Reddedilen/anlaşma sağlanamayan tekliflerin KAYITLARI (localStorage)
//      hiç silinmez, durumları olduğu gibi kalır — görev md. 3'ün "silme
//      değil, yalnızca bu ekrandan gizleme" ayrımının kanıtı.
//   8) Responsive (320/375/768/1280px) yatay taşma yok, konsol hatası yok.
//
// Bu script, incoming-offers-rejected-priority-order-live-test.mjs ve
// incoming-offers-sort-agreement-failed-live-test.mjs'in SÜPERSEDE ETTİĞİ
// canlı regresyon kapısıdır (bkz. o iki dosyanın kendi başlık notları) — bu
// ikisi artık "reddedilen/agreement_failed teklif görünmeye devam eder"
// varsayımını test ettiği için BİLEREK değiştirilmedi/geçmeyecek.
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
  await page.getByLabel("Açık Adres").first().fill("Gelen Teklifler görünürlük testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Gelen Teklifler görünürlük testi operasyon detayı, en az on karakter.");
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

async function readStoredOffers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
}

async function checkNoHorizontalOverflow(page, label) {
  const canActuallyScroll = await page.evaluate(() => {
    const originalX = window.scrollX;
    window.scrollTo(99999, window.scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(originalX, window.scrollY);
    return scrolledX !== 0;
  });
  assert.equal(canActuallyScroll, false, `${label}: sayfa yatay kaydırılabiliyor, taşma var`);
}

let browser;
let profileDir;

async function main() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-incoming-offers-hide-settled-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));

  const suffix = crypto.randomUUID().slice(0, 8);
  const AMOUNT_A_REJECTED = 31000; // İlan A, doğrudan reddedilecek
  const AMOUNT_A_AGREEMENT_FAILED = 32000; // İlan A, kabul edilip sonra "Anlaşma Sağlanamadı" olacak — bu ikisi de kalkınca İlan A'nın SON teklifi
  const AMOUNT_B_UNTOUCHED = 33000; // İlan B (farklı kategori), izolasyon kontrolü — hiç dokunulmayacak
  const AMOUNT_A_NEW = 34000; // İlan A'ya DAHA SONRA gelen yeni teklif — kategori yeniden belirsin diye

  // =====================================================================
  // KURULUM: talep sahibi + "Unlashing" kategorisinde İlan A (2 teklif) +
  // "Forklift" kategorisinde İlan B (1 teklif, izolasyon kontrolü).
  // =====================================================================
  const requesterEmail = `gizle-test-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Gizle", lastName: "TestSahibi", email: requesterEmail,
    phone: "+905556661111", role: "hizmet-alan", companyName: "Gizle Testi Firması", password: "GizleTest1!",
  });
  const jobATitle = `Gizle Testi İlan A ${suffix}`;
  const jobBTitle = `Gizle Testi İlan B ${suffix}`;
  const jobAId = await createRealJobViaForm(page, {
    category: "unlashing", title: jobATitle,
    description: "İlan A (Unlashing) açıklaması, en az yirmi karakter içerir.",
  });
  const jobBId = await createRealJobViaForm(page, {
    category: "forklift", title: jobBTitle,
    description: "İlan B (Forklift, farklı kategori) açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: Unlashing ilanı (A=${jobAId}) + farklı kategoride izolasyon ilanı (B=${jobBId}) GERÇEK formla oluşturuldu`);

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Bir", email: `gizle-saglayici-1-${suffix}@example.com`,
    phone: "+905557771111", role: "hizmet-veren", companyName: "Gizle Sağlayıcı Bir", password: "GizleSag1!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_A_REJECTED, "Reddedilecek teklif, yirmi karakterden uzun aciklama.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Iki", email: `gizle-saglayici-2-${suffix}@example.com`,
    phone: "+905557772222", role: "hizmet-veren", companyName: "Gizle Sağlayıcı İki", password: "GizleSag2!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_A_AGREEMENT_FAILED, "Kabul edilip sonra anlasma saglanamayacak teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Uc", email: `gizle-saglayici-3-${suffix}@example.com`,
    phone: "+905557773333", role: "hizmet-veren", companyName: "Gizle Sağlayıcı Üç", password: "GizleSag3!",
  });
  await submitRealOffer(page, jobBId, AMOUNT_B_UNTOUCHED, "Farkli ilana (Job B) ait, hic dokunulmayacak teklif, yirmi karakterden uzun.");
  ok("KURULUM: İlan A'ya 2 teklif (reddedilecek + anlaşma sağlanamayacak) + İlan B'ye 1 izolasyon teklifi GERÇEK formla gönderildi");

  // =====================================================================
  // TEST 1: baseline — her iki kategori kutusu da, her iki tekliften de
  // görünüyor.
  // =====================================================================
  await loginAs(page, requesterEmail, "GizleTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  let unlashingSection = categorySection(page, "Unlashing");
  let forkliftSection = categorySection(page, "Forklift");
  await unlashingSection.waitFor({ state: "visible", timeout: 10000 });
  await forkliftSection.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await offerCard(page, AMOUNT_A_REJECTED).count(), 1, "TEST 1: reddedilecek teklif başlangıçta görünmeli");
  assert.equal(await offerCard(page, AMOUNT_A_AGREEMENT_FAILED).count(), 1, "TEST 1: anlaşma sağlanamayacak teklif başlangıçta görünmeli");
  assert.equal(await offerCard(page, AMOUNT_B_UNTOUCHED).count(), 1, "TEST 1: İlan B'nin teklifi başlangıçta görünmeli");
  ok("TEST 1 (baseline): Unlashing (İlan A, 2 teklif) ve Forklift (İlan B, 1 teklif) kategori kutuları görünüyor");

  // =====================================================================
  // TEST 2: İlan A'daki bir teklifi Reddet — SAYFA YENİLEMEDEN kalkar;
  // kardeş teklif + İlan A grubu + Unlashing kutusu ayakta kalır; İlan B
  // hiç etkilenmez.
  // =====================================================================
  await offerCard(page, AMOUNT_A_REJECTED).getByRole("button", { name: "Reddet", exact: true }).click();
  await offerCard(page, AMOUNT_A_REJECTED).waitFor({ state: "hidden", timeout: 10000 });
  ok("TEST 2: Reddedilen teklifin kartı SAYFA YENİLEMEDEN Gelen Teklifler'den kalktı");

  const siblingOnA = offerCard(page, AMOUNT_A_AGREEMENT_FAILED);
  assert.equal(await siblingOnA.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST 2: aynı ilandaki kardeş teklifin Kabul Et butonu etkilenmemeli");
  assert.equal(await siblingOnA.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "TEST 2: aynı ilandaki kardeş teklifin Reddet butonu etkilenmemeli");
  assert.equal(await unlashingSection.getByRole("heading", { level: 3, name: jobATitle, exact: true }).count(), 1, "TEST 2: İlan A grubu, kardeş teklif sayesinde hâlâ görünmeli");
  ok("TEST 2 (devam): kardeş teklif etkilenmedi, İlan A grubu ve Unlashing kutusu ayakta kaldı");

  assert.equal(await offerCard(page, AMOUNT_B_UNTOUCHED).getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST 2: farklı ilana/kategoriye (İlan B) ait teklif hiç etkilenmemeli");
  assert.equal(await forkliftSection.getByRole("heading", { level: 3, name: jobBTitle, exact: true }).count(), 1, "TEST 2: Forklift kategori kutusu hiç etkilenmemeli");
  ok("TEST 2 (izolasyon): farklı ilana/kategoriye (İlan B, Forklift) ait teklif ve kategori kutusu tamamen etkilenmeden kaldı");

  // =====================================================================
  // TEST 3: sayfa yenilendikten sonra da reddedilen teklif geri gelmiyor.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.equal(await offerCard(page, AMOUNT_A_REJECTED).count(), 0, "TEST 3: sayfa yenilendikten sonra da reddedilen teklif GERİ GELMEMELİ");
  assert.equal(await offerCard(page, AMOUNT_A_AGREEMENT_FAILED).count(), 1, "TEST 3: kardeş teklif yenilemeden sonra da görünmeye devam etmeli");
  ok("TEST 3: sayfa yenilemesinden sonra da reddedilen teklif kalıcı olarak görünmüyor (yalnızca iyimser bir UI durumu değil)");

  // =====================================================================
  // TEST 4: İlan A'nın SON kalan teklifi de "Anlaşma Sağlanamadı" olunca:
  // İlan A grubu VE Unlashing kategori kutusunun TAMAMI kalkar; Forklift
  // kutusu hiç etkilenmeden kalır.
  // =====================================================================
  unlashingSection = categorySection(page, "Unlashing");
  const lastOfferOnA = offerCard(page, AMOUNT_A_AGREEMENT_FAILED);
  await lastOfferOnA.getByRole("button", { name: "Kabul Et", exact: true }).click();
  await lastOfferOnA.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await lastOfferOnA.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
  await lastOfferOnA.getByRole("radio").first().check();
  await lastOfferOnA.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle", exact: true }).click();
  await lastOfferOnA.waitFor({ state: "hidden", timeout: 10000 });
  ok("TEST 4: İlan A'nın SON teklifi 'Anlaşma Sağlanamadı' olunca SAYFA YENİLEMEDEN kalktı");

  assert.equal(await page.getByRole("heading", { level: 2, name: "Unlashing", exact: true }).count(), 0, "TEST 4: İlan A'nın hiç görüntülenecek teklifi kalmayınca Unlashing kategori kutusunun TAMAMI kalkmalı");
  assert.equal(await page.getByRole("heading", { level: 3, name: jobATitle, exact: true }).count(), 0, "TEST 4: İlan A grubu artık hiçbir yerde görünmemeli");
  ok("TEST 4 (devam): Unlashing kategori kutusu boşluk bırakmadan TAMAMEN kalktı");

  const forkliftSectionAfter = categorySection(page, "Forklift");
  await forkliftSectionAfter.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await offerCard(page, AMOUNT_B_UNTOUCHED).getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "TEST 4: Forklift/İlan B hâlâ tamamen etkilenmeden görünmeli");
  assert.equal(await page.getByText("Henüz gelen teklif yok.").count(), 0, "TEST 4: Forklift/İlan B hâlâ görünür olduğu için genel boş ekran mesajı GÖRÜNMEMELİ");
  ok("TEST 4 (izolasyon): Forklift kategori kutusu (İlan B) hiç etkilenmeden, boş-ekran mesajı olmadan kaldı");

  // =====================================================================
  // TEST 5: sayfa yenilendikten sonra da bu durum korunuyor.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByRole("heading", { level: 2, name: "Unlashing", exact: true }).count(), 0, "TEST 5: sayfa yenilendikten sonra da Unlashing kutusu GERİ GELMEMELİ");
  await categorySection(page, "Forklift").waitFor({ state: "visible", timeout: 10000 });
  ok("TEST 5: sayfa yenilemesinden sonra da Unlashing kutusunun kalkmış olması ve Forklift'in etkilenmemiş olması korundu");

  // =====================================================================
  // TEST 6: İlan A'ya YENİ bir teklif gelince Unlashing kategori kutusu ve
  // İlan A grubu OTOMATİK olarak yeniden belirir — eski reddedilen/anlaşma
  // sağlanamayan teklifler bir daha ASLA görünmez.
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Dort", email: `gizle-saglayici-4-${suffix}@example.com`,
    phone: "+905557774444", role: "hizmet-veren", companyName: "Gizle Sağlayıcı Dört", password: "GizleSag4!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_A_NEW, "Kategori yeniden belirsin diye gonderilen yeni teklif, yirmi karakterden uzun.");

  await loginAs(page, requesterEmail, "GizleTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  const unlashingSectionReborn = categorySection(page, "Unlashing");
  await unlashingSectionReborn.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await unlashingSectionReborn.getByRole("heading", { level: 3, name: jobATitle, exact: true }).count(), 1, "TEST 6: İlan A'ya yeni teklif gelince İlan A grubu OTOMATİK yeniden belirmeli");
  assert.equal(await offerCard(page, AMOUNT_A_NEW).count(), 1, "TEST 6: yeni teklif görünmeli");
  assert.equal(await offerCard(page, AMOUNT_A_REJECTED).count(), 0, "TEST 6: eski reddedilen teklif kategori yeniden belirse bile ASLA geri gelmemeli");
  assert.equal(await offerCard(page, AMOUNT_A_AGREEMENT_FAILED).count(), 0, "TEST 6: eski anlaşma sağlanamayan teklif kategori yeniden belirse bile ASLA geri gelmemeli");
  ok("TEST 6: yeni teklif gelince Unlashing kategori kutusu ve İlan A grubu otomatik yeniden belirdi; eski gizlenmiş teklifler geri gelmedi");

  // =====================================================================
  // TEST 7: kayıtlar SİLİNMEDİ — yalnızca bu ekrandan gizlendi.
  // =====================================================================
  const storedOffers = await readStoredOffers(page);
  const rejectedRecord = storedOffers.find((offer) => offer.amount === AMOUNT_A_REJECTED);
  const agreementFailedRecord = storedOffers.find((offer) => offer.amount === AMOUNT_A_AGREEMENT_FAILED);
  assert.ok(rejectedRecord, "TEST 7: reddedilen teklifin kaydı localStorage'da HÂLÂ mevcut olmalı (silinmedi)");
  assert.equal(rejectedRecord.status, "rejected", "TEST 7: reddedilen teklifin durumu 'rejected' olarak korunmalı");
  assert.ok(agreementFailedRecord, "TEST 7: anlaşma sağlanamayan teklifin kaydı localStorage'da HÂLÂ mevcut olmalı (silinmedi)");
  assert.equal(agreementFailedRecord.status, "agreement_failed", "TEST 7: anlaşma sağlanamayan teklifin durumu 'agreement_failed' olarak korunmalı");
  ok("TEST 7: her iki teklifin kaydı da (durumu, geçmişi) SİLİNMEDEN korundu — yalnızca Gelen Teklifler ekranından gizlendi");

  // =====================================================================
  // TEST 8: responsive + konsol hatası yok.
  // =====================================================================
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await checkNoHorizontalOverflow(page, `${width}px`);
  }
  ok("TEST 8: 320/375/768/1280px genişliklerde yatay taşma yok");
  assert.equal(page.jsProblems.length, 0, `Konsolda JS hatası var: ${page.jsProblems.join(" | ")}`);
  ok("TEST 8 (devam): konsolda hiç JS hatası yok");

  await context.close();
  console.log(`\n[tmp-incoming-offers-hide-settled-status-test] ${passed} test geçti.`);
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
