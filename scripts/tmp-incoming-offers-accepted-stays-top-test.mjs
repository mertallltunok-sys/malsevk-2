// node scripts/tmp-incoming-offers-accepted-stays-top-test.mjs
//
// "Kabul edilen teklif aşağı düşmesin" düzeltmesini GERÇEK arayüz akışlarıyla
// (ham localStorage enjeksiyonu YOK) uçtan uca doğrular — job-requests.ts#
// incomingOfferSortWeight'in artık "accepted"ı "pending"in ÜSTÜNE koyduğu
// (eskiden tam tersiydi) kuralın hem sıralama hem görünürlük tarafını kapsar:
//
//   1) Baseline: aynı ilana verilmiş iki bekleyen teklif kendi aralarında
//      SAF recency sırasıyla (en yeni üstte) görünür.
//   2) En ESKİ (dolayısıyla normalde EN ALTTAKİ) teklif Kabul Et ile kabul
//      edilince: SAYFA YENİLEMEDEN kendi ilan grubunun EN ÜSTÜNE zıplar —
//      "aşağı düşmüyor" değil, doğrudan "yukarı çıkıyor" kanıtlanır. Kardeş
//      (hâlâ bekleyen, daha yeni) teklif onun ALTINA iner.
//   3) Sayfa yenilendikten sonra da bu sıra korunur.
//   4) Kabul edilen teklif varken ilan grubu ve hizmet türü kutusu (şablon)
//      AÇIK kalır — aksiyon kilidi (isOfferPendingActionBlocked) kardeş
//      bekleyen teklifte hâlâ doğru çalışır (mevcut kural, DEĞİŞMEDİ).
//   5) Kabul edilen teklifin kendisi "Anlaşma Sağlanamadı" olunca: Gelen
//      Teklifler'den kalkar (mevcut kural, DEĞİŞMEDİ); ilan yeniden teklife
//      açıldığı için bekleyen kardeşin kilidi kalkar (mevcut kural,
//      DEĞİŞMEDİ) — bekleyen kardeş hâlâ görünür olduğundan şablon bu kez
//      YALNIZCA "Beklemede" sayesinde AÇIK kalır (md. 4'te yalnızca
//      "accepted" sayesinde açıktı; burada tam tersi kombinasyon da
//      doğrulanır). NOT: bekleyen kardeşi aynı ilanda bir teklif "accepted"
//      İKEN doğrudan Reddet ile kaldırmak GERÇEK arayüzde mümkün değildir —
//      isOfferPendingActionBlocked o durumda Kabul Et/Reddet'in İKİSİNİ DE
//      kilitler; bu yüzden önce anlaşmanın bozulması gerekir.
//   6) Artık tekrar aktif olan bekleyen kardeş Reddedilince: Gelen
//      Teklifler'den kalkar; hiç görüntülenecek teklif kalmadığı için ilan
//      grubu VE hizmet türü kutusunun TAMAMI kalkar.
//   7) Aynı ilana yeni bir teklif gelince hizmet türü kutusu otomatik
//      yeniden belirir.
//   8) Responsive (320/375/768/1280px) yatay taşma yok, konsol hatası yok.
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
  await page.getByLabel("Açık Adres").first().fill("Kabul edilen teklif sıralaması testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Kabul edilen teklif sıralaması testi operasyon detayı, en az on karakter.");
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
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-accepted-stays-top-"));
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
  const AMOUNT_OLDER = 41000; // en ESKİ createdAt — normalde EN ALTTA olurdu, kabul edilince EN ÜSTE zıplamalı
  const AMOUNT_NEWER = 42000; // en YENİ createdAt, bekleyen kalacak — kabul edilenin ALTINA inmeli
  const AMOUNT_NEW_LATER = 43000; // şablon yeniden belirsin diye daha SONRA gönderilen teklif

  // =====================================================================
  // KURULUM: talep sahibi + tek ilan (job A), iki bekleyen teklif.
  // =====================================================================
  const requesterEmail = `kabul-ust-test-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "KabulUst", lastName: "TestSahibi", email: requesterEmail,
    phone: "+905556662222", role: "hizmet-alan", companyName: "Kabul Üst Testi Firması", password: "KabulUst1!",
  });
  const jobTitle = `Kabul Üst Testi İlan ${suffix}`;
  const jobId = await createRealJobViaForm(page, {
    category: "unlashing", title: jobTitle,
    description: "Kabul edilen teklifin üstte kalması testi için ilan, en az yirmi karakter.",
  });

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Eski", email: `kabul-ust-eski-${suffix}@example.com`,
    phone: "+905557775555", role: "hizmet-veren", companyName: "Sağlayıcı Eski", password: "KabulSag1!",
  });
  await submitRealOffer(page, jobId, AMOUNT_OLDER, "En eski teklif, kabul edilince üste zıplayacak, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Yeni", email: `kabul-ust-yeni-${suffix}@example.com`,
    phone: "+905557776666", role: "hizmet-veren", companyName: "Sağlayıcı Yeni", password: "KabulSag2!",
  });
  await submitRealOffer(page, jobId, AMOUNT_NEWER, "En yeni teklif, bekleyen kalacak, yirmi karakterden uzun.");
  ok(`KURULUM: İlan (${jobId}) + 2 bekleyen teklif (eski + yeni) GERÇEK formla oluşturuldu`);

  // =====================================================================
  // TEST 1: baseline — iki bekleyen teklif SAF recency sırasıyla (yeni üstte).
  // =====================================================================
  await loginAs(page, requesterEmail, "KabulUst1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  let section = categorySection(page, "Unlashing");
  await section.waitFor({ state: "visible", timeout: 10000 });
  let order = await readOfferOrderByAmounts(section, [AMOUNT_OLDER, AMOUNT_NEWER]);
  assert.deepEqual(order, [AMOUNT_NEWER, AMOUNT_OLDER], "TEST 1: iki bekleyen teklif recency sırasıyla (yeni üstte) görünmeli");
  ok("TEST 1 (baseline): iki bekleyen teklif recency sırasıyla görünüyor (yeni üstte, eski altta)");

  // =====================================================================
  // TEST 2: EN ESKİ (en alttaki) teklifi Kabul Et — SAYFA YENİLEMEDEN
  // kendi grubunun EN ÜSTÜNE zıplamalı; yeni/bekleyen kardeş altına inmeli.
  // =====================================================================
  await offerCard(page, AMOUNT_OLDER).getByRole("button", { name: "Kabul Et", exact: true }).click();
  await offerCard(page, AMOUNT_OLDER).getByText("Görüşme Sonucu", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("TEST 2: en eski (normalde en alttaki) teklif kabul edildi");

  order = await readOfferOrderByAmounts(section, [AMOUNT_OLDER, AMOUNT_NEWER]);
  assert.deepEqual(
    order,
    [AMOUNT_OLDER, AMOUNT_NEWER],
    "TEST 2 (devam): kabul edilen teklif (AMOUNT_OLDER) SAYFA YENİLEMEDEN EN ÜSTE zıplamalı — kronolojik olarak daha eski olmasına rağmen",
  );
  ok("TEST 2 (devam): kabul edilen teklif ÜSTE zıpladı, aşağı DÜŞMEDİ — bekleyen kardeş altına indi");

  // =====================================================================
  // TEST 3: sayfa yenilendikten sonra da bu sıra korunuyor.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  section = categorySection(page, "Unlashing");
  order = await readOfferOrderByAmounts(section, [AMOUNT_OLDER, AMOUNT_NEWER]);
  assert.deepEqual(order, [AMOUNT_OLDER, AMOUNT_NEWER], "TEST 3: sayfa yenilendikten sonra da kabul edilen teklif üstte kalmalı");
  ok("TEST 3: sayfa yenilemesinden sonra da sıralama korundu (kabul edilen hâlâ üstte)");

  // =====================================================================
  // TEST 4: kabul edilen teklif VARKEN şablon (ilan grubu + kategori kutusu)
  // AÇIK kalıyor; bekleyen kardeşin aksiyon butonları kilitli (mevcut kural).
  // =====================================================================
  assert.equal(await page.getByRole("heading", { level: 2, name: "Unlashing", exact: true }).count(), 1, "TEST 4: kategori kutusu açık kalmalı");
  assert.equal(await section.getByRole("heading", { level: 3, name: jobTitle, exact: true }).count(), 1, "TEST 4: ilan grubu açık kalmalı");
  const newerCard = offerCard(page, AMOUNT_NEWER);
  await newerCard.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await newerCard.getByRole("button", { name: "Kabul Et", exact: true }).count(), 0, "TEST 4: bekleyen kardeşin Kabul Et butonu kilitli olmalı (mevcut kural)");
  ok("TEST 4: kabul edilen teklif varken şablon açık kaldı; bekleyen kardeşin aksiyon butonları hâlâ kilitli (mevcut kural, değişmedi)");

  // =====================================================================
  // TEST 5: kabul edilen teklifin kendisi "Anlaşma Sağlanamadı" olunca:
  // kalkar (mevcut kural); İLAN YENİDEN TEKLİFE AÇILDIĞI İÇİN bekleyen
  // kardeşin kilidi kalkar (mevcut kural, DEĞİŞMEDİ) — bekleyen kardeş HÂLÂ
  // görünür olduğundan şablon bu kez YALNIZCA "Beklemede" sayesinde AÇIK
  // kalmalı (TEST 4'te "yalnızca accepted" sayesinde açıktı; burada tam
  // tersi kombinasyon doğrulanır).
  //
  // NOT: bekleyen kardeşi DOĞRUDAN Reddet ile kaldırmak burada MÜMKÜN
  // DEĞİLDİR — aynı ilanda bir teklif "accepted" iken diğer TÜM bekleyen
  // tekliflerin Kabul Et/Reddet butonlarının İKİSİ DE kilitlenir (yalnızca
  // Kabul Et değil, bkz. incoming-offer-card.tsx#isOfferPendingActionBlocked)
  // — bu yüzden gerçek arayüzde önce anlaşmanın bozulması (job'un yeniden
  // teklife açılması) gerekir.
  // =====================================================================
  const acceptedCard = offerCard(page, AMOUNT_OLDER);
  await acceptedCard.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
  await acceptedCard.getByRole("radio").first().check();
  await acceptedCard.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle", exact: true }).click();
  await acceptedCard.waitFor({ state: "hidden", timeout: 10000 });
  ok("TEST 5: kabul edilen teklif 'Anlaşma Sağlanamadı' olunca Gelen Teklifler'den kalktı");

  await newerCard.getByRole("button", { name: "Kabul Et", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await newerCard.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "TEST 5: anlaşma bozulunca bekleyen kardeşin Reddet butonu da tekrar görünmeli");
  assert.equal(await page.getByRole("heading", { level: 2, name: "Unlashing", exact: true }).count(), 1, "TEST 5: bekleyen kardeş hâlâ görünür olduğu için şablon (yalnızca 'Beklemede' sayesinde) AÇIK kalmalı");
  ok("TEST 5 (devam): bekleyen kardeşin kilidi kalktı; şablon bu kez yalnızca 'Beklemede' sayesinde açık kaldı");

  // =====================================================================
  // TEST 6: artık tekrar aktif olan bekleyen kardeşi Reddet — Gelen
  // Teklifler'den kalkar (mevcut kural); hiç görüntülenecek teklif
  // kalmadığı için şablon TAMAMEN kalkar.
  // =====================================================================
  await newerCard.getByRole("button", { name: "Reddet", exact: true }).click();
  await newerCard.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await page.getByRole("heading", { level: 2, name: "Unlashing", exact: true }).count(), 0, "TEST 6: hiç görüntülenecek teklif kalmayınca kategori kutusu TAMAMEN kalkmalı");
  ok("TEST 6: son kalan teklif de reddedilince şablon boşluk bırakmadan tamamen kalktı");

  // =====================================================================
  // TEST 7: yeni bir teklif gelince şablon otomatik yeniden belirir.
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Sonraki", email: `kabul-ust-sonraki-${suffix}@example.com`,
    phone: "+905557777777", role: "hizmet-veren", companyName: "Sağlayıcı Sonraki", password: "KabulSag3!",
  });
  await submitRealOffer(page, jobId, AMOUNT_NEW_LATER, "Sablon yeniden belirsin diye gonderilen yeni teklif, yirmi karakterden uzun.");

  await loginAs(page, requesterEmail, "KabulUst1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  const sectionReborn = categorySection(page, "Unlashing");
  await sectionReborn.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await offerCard(page, AMOUNT_NEW_LATER).count(), 1, "TEST 7: yeni teklif görünmeli");
  assert.equal(await offerCard(page, AMOUNT_OLDER).count(), 0, "TEST 7: eski (agreement_failed) teklif geri gelmemeli");
  ok("TEST 7: yeni teklif gelince şablon otomatik yeniden belirdi; eski gizlenmiş teklif geri gelmedi");

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
  console.log(`\n[tmp-incoming-offers-accepted-stays-top-test] ${passed} test geçti.`);
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
