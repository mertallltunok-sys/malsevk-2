// node scripts/tmp-operation-service-lifecycle-live-test.mjs
//
// "Operasyon Hizmet Kalemi Yaşam Döngüsü Senkronizasyonu" görevini GERÇEK
// arayüz akışlarıyla (ham localStorage enjeksiyonu YOK) uçtan uca doğrular:
//
//   SENARYO A — Hizmet kalemi manuel silinirse:
//     - o hizmet kalemine ait bekleyen teklif "temizlenir" (Gelen
//       Teklifler'den düşer, artık aksiyon alınamaz).
//     - AYNI operasyondaki DİĞER hizmet kalemi (Lashing) ETKİLENMEZ.
//     - teklif sahibine "İlan sahibi ilgili hizmet talebini yayından
//       kaldırdı" bildirimi gider, tıklanınca 404 OLMAZ.
//     - kategori kutusu (Depolama) Gelen Teklifler'den otomatik kalkar.
//
//   SENARYO B — Hizmet kalemi tamamlanınca:
//     - kazanan teklif tamamlanır, PUANLAMA MODALI ÇALIŞIR (kritik güvenlik
//       testi — bkz. incoming-offers-panel.tsx'teki state taşıma notu).
//     - AYNI ilana verilmiş diğer (kaybeden) teklif Gelen Teklifler'den
//       kalkar, "hayalet kayıt" bırakmaz.
//     - kaybeden teklifin sahibi (mevcut, DEĞİŞTİRİLMEMİŞ bildirim
//       sistemiyle) "başka bir Hizmet Verenle işe başlandı" bildirimini
//       ZATEN almıştı (regresyon doğrulaması).
//     - Lashing kategori kutusu artık aktif teklif almayacağı için Gelen
//       Teklifler'den kalkar.
//     - BAŞKA bir operasyondaki Lashing hizmet kalemi HİÇ ETKİLENMEZ.
//     - mobil/masaüstü yatay taşma yok.
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

/** GERÇEK ilan oluşturma formu üzerinden TEK servisli bir ilan yayınlar. */
async function createSingleServiceJob(page, { category, title, description }) {
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
  await page.locator('ul[aria-label="Bölge / Tesis"]').first().getByRole("option", { name: "Beldeport", exact: false }).first().click();
  await page.getByLabel("Açık Adres").first().fill("Yaşam döngüsü testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Yaşam döngüsü testi operasyon detayı, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  return page.url().split("/ilanlar/")[1];
}

/**
 * GERÇEK ilan oluşturma formu üzerinden, TEK operasyon içinde İKİ farklı
 * hizmet kalemi (Lashing + Depolama) yayınlar — "Ek hizmet ekle" ile ikinci
 * kart eklenir, "Ana hizmetle aynı lokasyon" varsayılan İŞARETLİ bırakılır
 * (bu yüzden ikinci kartın kendi İlçe/Bölge-Tesis/Açık Adres alanlarını
 * doldurmaya gerek YOK — mevcut form davranışı). İki ilan id'sini de,
 * yayınlanma sırasıyla döndürür.
 */
async function createTwoServiceOperation(page, { titleA, descA, titleB, descB }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

  // Ana hizmet (index 0): Lashing.
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption("lashing");
  await page.getByLabel("İlan Başlığı").nth(0).fill(titleA);
  await page.getByLabel("Hizmete Özel Açıklama").nth(0).fill(descA);
  await page.getByLabel("Başlangıç Tarihi").nth(0).fill("2026-09-01");
  await page.getByLabel("Bitiş Tarihi").nth(0).fill("2026-09-02");
  await page.getByRole("button", { name: "İlçe", exact: true }).nth(0).click();
  await page.locator('ul[aria-label="İlçe"]').nth(0).waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').nth(0).getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).nth(0).click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').nth(0).waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Bölge / Tesis"]').nth(0).getByRole("option", { name: "Beldeport", exact: false }).first().click();
  await page.getByLabel("Açık Adres").nth(0).fill("Ana hizmet mahallesi, cadde no:1, Dilovası");

  // Ek hizmet ekle -> ikinci kart (index 1): Depolama (genel-depolama).
  await page.getByRole("button", { name: "Ek hizmet ekle", exact: true }).click();
  await page.getByLabel("Hizmet Kategorisi").nth(1).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").nth(1).selectOption("genel-depolama");
  await page.getByLabel("İlan Başlığı").nth(1).fill(titleB);
  await page.getByLabel("Hizmete Özel Açıklama").nth(1).fill(descB);
  await page.getByLabel("Başlangıç Tarihi").nth(1).fill("2026-09-01");
  await page.getByLabel("Bitiş Tarihi").nth(1).fill("2026-09-02");
  // "Ana hizmetle aynı lokasyon" varsayılan işaretli bırakılıyor — ikinci
  // kartın kendi konum alanları hiç görünmüyor/doldurulmuyor (mevcut form
  // davranışı, bkz. job-request-form.tsx#getEffectiveLocation).

  await page.getByLabel("Operasyon Detayları").fill("İki hizmetli operasyon yaşam döngüsü testi, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "2 Hizmet İlanını Yayınla", exact: true }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim/, { timeout: 15000 });

  // Yayınlanan iki ilanın id'lerini "Hizmet Taleplerim" üzerinden, başlık
  // metniyle eşleştirerek buluyoruz (yayın sırası garantili ama route
  // parametresiyle geri dönmüyor).
  await page.waitForLoadState("networkidle");
  async function findJobIdByTitle(title) {
    const link = page.getByRole("link", { name: "İlan detayına git" }).locator("xpath=ancestor::li[1]").filter({ hasText: title }).getByRole("link", { name: "İlan detayına git" });
    const href = await link.getAttribute("href");
    return href.split("/ilanlar/")[1];
  }
  const jobAId = await findJobIdByTitle(titleA);
  const jobBId = await findJobIdByTitle(titleB);
  return { jobAId, jobBId };
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
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-operation-lifecycle-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const suffix = crypto.randomUUID().slice(0, 8);
  const AMOUNT_DEPO = 21000;
  const AMOUNT_LASHING_WINNER = 22000;
  const AMOUNT_LASHING_SIBLING = 23000;
  const AMOUNT_OTHER_OP_LASHING = 24000;

  // =====================================================================
  // KURULUM: Operasyon #1 (Lashing + Depolama, aynı operasyon) + Operasyon
  // #2 (yalnızca kendi Lashing hizmet kalemi, TAMAMEN AYRI operasyon).
  // =====================================================================
  const requesterEmail = `yasam-dongu-talep-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "YaşamDöngüsü", lastName: "TalepSahibi", email: requesterEmail,
    phone: "+905556660000", role: "hizmet-alan", companyName: "Yaşam Döngüsü Testi Firması", password: "YasamTest1!",
  });

  const lashingTitle = `Op1 Lashing Hizmet Kalemi ${suffix}`;
  const depoTitle = `Op1 Depolama Hizmet Kalemi ${suffix}`;
  const { jobAId: op1LashingId, jobBId: op1DepoId } = await createTwoServiceOperation(page, {
    titleA: lashingTitle, descA: "Operasyon 1 Lashing açıklaması, en az yirmi karakter içerir.",
    titleB: depoTitle, descB: "Operasyon 1 Depolama açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: Operasyon #1 — Lashing (${op1LashingId}) + Depolama (${op1DepoId}), AYNI operasyon, GERÇEK çoklu-hizmet formuyla oluşturuldu`);

  const otherOpLashingTitle = `Op2 Bağımsız Lashing Hizmet Kalemi ${suffix}`;
  const op2LashingId = await createSingleServiceJob(page, {
    category: "lashing", title: otherOpLashingTitle,
    description: "Operasyon 2 (tamamen ayrı) Lashing açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: Operasyon #2 — BAĞIMSIZ, tek servisli Lashing (${op2LashingId}) oluşturuldu`);

  // =====================================================================
  // Teklifler: Op1-Depolama'ya 1 teklif (P-Depo), Op1-Lashing'e 2 teklif
  // (P-Winner kazanacak, P-Sibling kaybedecek), Op2-Lashing'e 1 teklif
  // (P-Other — tamamen izole referans).
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Depo", email: `yd-saglayici-depo-${suffix}@example.com`,
    phone: "+905557770001", role: "hizmet-veren", companyName: "Sağlayıcı Depo Firması", password: "SagDepo1!",
  });
  await submitRealOffer(page, op1DepoId, AMOUNT_DEPO, "Depolama teklifi, yirmi karakterden uzun bir açıklama.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Kazanan", email: `yd-saglayici-kazanan-${suffix}@example.com`,
    phone: "+905557770002", role: "hizmet-veren", companyName: "Sağlayıcı Kazanan Firması", password: "SagKazanan1!",
  });
  await submitRealOffer(page, op1LashingId, AMOUNT_LASHING_WINNER, "Kazanan Lashing teklifi, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Kardes", email: `yd-saglayici-kardes-${suffix}@example.com`,
    phone: "+905557770003", role: "hizmet-veren", companyName: "Sağlayıcı Kardeş Firması", password: "SagKardes1!",
  });
  await submitRealOffer(page, op1LashingId, AMOUNT_LASHING_SIBLING, "Kaybeden (kardeş) Lashing teklifi, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı", lastName: "Digerop", email: `yd-saglayici-digerop-${suffix}@example.com`,
    phone: "+905557770004", role: "hizmet-veren", companyName: "Sağlayıcı Diğer Operasyon Firması", password: "SagDigerOp1!",
  });
  await submitRealOffer(page, op2LashingId, AMOUNT_OTHER_OP_LASHING, "Tamamen ayrı operasyon Lashing teklifi, yirmi karakterden uzun.");
  ok("KURULUM: 4 teklif GERÇEK teklif formuyla gönderildi (Op1-Depo x1, Op1-Lashing x2, Op2-Lashing x1)");

  // =====================================================================
  // BASELINE: talep sahibi Gelen Teklifler'i açar — 2 kategori (Lashing,
  // Genel Depolama) görünmeli, Lashing kutusunda 3 teklif (2 Op1 + 1 Op2 —
  // AYNI kategori adı paylaşılsa da farklı ilan gruplarında).
  // =====================================================================
  await loginAs(page, requesterEmail, "YasamTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  const lashingSection = categorySection(page, "Lashing");
  const depoSection = categorySection(page, "Genel Depolama");
  await lashingSection.waitFor({ state: "visible", timeout: 10000 });
  await depoSection.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await lashingSection.getByRole("heading", { level: 3, name: lashingTitle, exact: true }).count(), 1);
  assert.equal(await lashingSection.getByRole("heading", { level: 3, name: otherOpLashingTitle, exact: true }).count(), 1);
  assert.equal(await depoSection.getByRole("heading", { level: 3, name: depoTitle, exact: true }).count(), 1);
  ok("BASELINE: Lashing kutusunda İKİ AYRI operasyonun kendi ilan grupları (Op1, Op2) görünüyor; Genel Depolama kendi kutusunda");

  // =====================================================================
  // SENARYO A: Op1-Depolama hizmet kalemini manuel sil.
  // =====================================================================
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.waitForLoadState("networkidle");
  const depoJobItem = page.locator("li").filter({ hasText: depoTitle });
  await depoJobItem.getByRole("button", { name: "İlanı Sil", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İlanı Sil", exact: true }).click();
  await page.getByText(depoTitle, { exact: true }).waitFor({ state: "hidden", timeout: 10000 });
  ok("SENARYO A: Op1-Depolama hizmet kalemi GERÇEK 'İlanı Sil' akışıyla silindi");

  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.waitForLoadState("networkidle");
  assert.equal(await categorySection(page, "Genel Depolama").count(), 0, "SENARYO A + Madde 4: silinen tek Depolama hizmet kaleminden sonra 'Genel Depolama' kategori kutusu Gelen Teklifler'den TAMAMEN kalkmalı");
  assert.equal(await categorySection(page, "Lashing").getByRole("heading", { level: 3, name: lashingTitle, exact: true }).count(), 1, "SENARYO A + Madde 9: AYNI operasyondaki Lashing hizmet kalemi ETKİLENMEMELİ");
  assert.equal(await categorySection(page, "Lashing").getByRole("heading", { level: 3, name: otherOpLashingTitle, exact: true }).count(), 1, "SENARYO A + Madde 9: BAŞKA operasyondaki Lashing hizmet kalemi ETKİLENMEMELİ");
  ok("SENARYO A doğrulama: Depolama kategori kutusu kalktı; aynı VE başka operasyondaki Lashing hizmet kalemleri etkilenmedi");

  await loginAs(page, `yd-saglayici-depo-${suffix}@example.com`, "SagDepo1!", "/panel/tekliflerim");
  await page.waitForLoadState("networkidle");
  const bellButton = page.getByRole("button", { name: /bildirim/i }).first();
  await bellButton.click();
  const removedNotification = page.getByText("İlan sahibi ilgili hizmet talebini yayından kaldırdı.", { exact: false });
  await removedNotification.waitFor({ state: "visible", timeout: 10000 });
  ok("SENARYO A + Madde 2: teklif sahibi (Sağlayıcı Depo) 'İlan sahibi ilgili hizmet talebini yayından kaldırdı' bildirimini aldı");

  const consoleErrorsBeforeClick = [];
  page.on("pageerror", (err) => consoleErrorsBeforeClick.push(String(err)));
  await removedNotification.click();
  await page.waitForLoadState("networkidle");
  assert.equal(page.url().includes("/panel/tekliflerim"), true, "SENARYO A + Madde 3: bildirime tıklayınca GERÇEK, var olan bir route'a gitmeli (404 yok)");
  assert.equal(consoleErrorsBeforeClick.length, 0, "bildirime tıklarken konsol hatası OLMAMALI");
  ok("SENARYO A + Madde 3: bildirime tıklamak 404 üretmedi, güvenli mevcut sayfaya (Verdiğim Teklifler) gitti, konsol hatası yok");

  // =====================================================================
  // SENARYO B: Op1-Lashing'i tamamla (kazanan teklif kabul + işe başla +
  // tamamlama + puanlama), kaybeden kardeş teklifin de düştüğünü doğrula.
  // =====================================================================
  await loginAs(page, requesterEmail, "YasamTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  await offerCard(page, AMOUNT_LASHING_WINNER).getByRole("button", { name: "Kabul Et", exact: true }).click();
  await offerCard(page, AMOUNT_LASHING_WINNER).getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı", exact: true }).click();
  await page.getByText("İşe Başlandı", { exact: true }).first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  ok("SENARYO B kurulumu: kazanan teklif kabul edildi ve 'İşe Başlandı' onaylandı");

  // Kardeş sağlayıcı (Kardeş), işe başlama anında ZATEN "başka biriyle işe
  // başlandı" bildirimini alır (mevcut, DEĞİŞTİRİLMEMİŞ sistem) — bu, işin
  // TAMAMLANMASINDAN önce gerçekleşen, ayrı bir regresyon kontrolüdür.
  await loginAs(page, `yd-saglayici-kardes-${suffix}@example.com`, "SagKardes1!", "/panel/bildirimler");
  await page.waitForLoadState("networkidle");
  await page.getByText("başka bir Hizmet Verenle işe başlandı", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  ok("SENARYO B + Madde 7 (regresyon): kaybeden kardeş sağlayıcı, mevcut 'başka biriyle işe başlandı' bildirimini ZATEN almıştı");

  // Kazanan sağlayıcı tamamlanma talebinde bulunur.
  // "İşe Başlandı" sonrası teklif "in_progress" olur — Verdiğim Teklifler'in
  // varsayılan "Aktif" sekmesinde DEĞİL, "Devam Eden" sekmesinde görünür
  // (bkz. job-requests.ts#getProviderOfferFilter).
  await loginAs(page, `yd-saglayici-kazanan-${suffix}@example.com`, "SagKazanan1!", "/panel/tekliflerim?durum=devam-eden");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByText("Tamamlandı Olarak İşaretle", { exact: true }).first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  ok("SENARYO B kurulumu: kazanan sağlayıcı tamamlanma talebinde bulundu");

  // Talep sahibi onaylar — KRİTİK: puanlama modalı SAYFA/KART DEĞİŞSE BİLE açılmalı.
  await loginAs(page, requesterEmail, "YasamTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  await offerCard(page, AMOUNT_LASHING_WINNER).getByRole("button", { name: "Tamamlandığını Onayla", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum", exact: true }).click();
  await page.getByRole("heading", { name: "Hizmeti Değerlendir", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("SENARYO B + KRİTİK GÜVENLİK TESTİ: iş tamamlandığında (Lashing kutusu AYNI ANDA Gelen Teklifler'den kalksa bile) puanlama modalı AÇILDI — state taşıma düzeltmesi çalışıyor");

  await page.getByRole("radio", { name: "5 yıldız", exact: true }).click();
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder", exact: true }).click();
  await page.getByText("Değerlendirmeniz için teşekkür ederiz.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("SENARYO B: değerlendirme GERÇEKTEN gönderildi, teşekkür mesajı göründü");

  // Tamamlanma sonrası: Lashing kategori kutusu TAMAMEN kalkmalı (Madde 6+8),
  // ama Op2'nin bağımsız Lashing hizmet kalemi ETKİLENMEMELİ (Madde 9).
  await page.reload();
  await page.waitForLoadState("networkidle");
  const lashingSectionAfter = categorySection(page, "Lashing");
  assert.equal(await lashingSectionAfter.getByRole("heading", { level: 3, name: lashingTitle, exact: true }).count(), 0, "SENARYO B + Madde 8: tamamlanan Op1-Lashing hizmet kalemi Gelen Teklifler'den kalkmalı");
  assert.equal(await lashingSectionAfter.getByRole("heading", { level: 3, name: otherOpLashingTitle, exact: true }).count(), 1, "SENARYO B + Madde 9: BAŞKA operasyondaki (Op2) Lashing hizmet kalemi HÂLÂ görünmeli, etkilenmemeli");
  assert.equal(await page.getByText(amountText(AMOUNT_LASHING_SIBLING), { exact: false }).count(), 0, "SENARYO B + Madde 6: kaybeden kardeş teklif (hayalet kayıt) Gelen Teklifler'de HİÇ görünmemeli");
  ok("SENARYO B doğrulama: Lashing (Op1) kategori kutusu kalktı; Op2'nin bağımsız Lashing'i etkilenmedi; kaybeden kardeş teklif hayalet kayıt bırakmadı");

  // Tamamlanan kayıt, mevcut Hizmet Taleplerim > Tamamlandı sisteminde
  // AYNEN korunmalı (Madde 5).
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.waitForLoadState("networkidle");
  await page.getByText(lashingTitle, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("SENARYO B + Madde 5: tamamlanan hizmet kalemi mevcut 'Hizmet Taleplerim > Tamamlandı' sisteminde AYNEN korunuyor");

  // =====================================================================
  // Mobil/masaüstü yatay taşma kontrolü (Madde 12/13.F).
  // =====================================================================
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.waitForLoadState("networkidle");
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    assert.ok(await hasNoHorizontalOverflow(page), `${width}px genişlikte yatay taşma OLMAMALI`);
  }
  ok("Madde 12/13.F: 320/375/768/1280px genişliklerde yatay taşma tespit edilmedi");

  await context.close();
  console.log(`\n[tmp-operation-service-lifecycle-live-test] ${passed} test geçti.`);
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
