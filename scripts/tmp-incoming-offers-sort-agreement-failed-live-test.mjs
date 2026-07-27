// node scripts/tmp-incoming-offers-sort-agreement-failed-live-test.mjs
//
// "Gelen Teklifler" (incoming-offers-panel.tsx) ekranındaki yeni sıralama
// kuralını GERÇEK arayüz akışlarıyla (ham localStorage enjeksiyonu YOK) uçtan
// uca doğrular: "agreement_failed" durumundaki bir teklif AYNI ilana ait
// diğer tekliflerin altına iner; FARKLI bir ilana ait tekliflerin sırası/
// konumu bundan hiç etkilenmez. Bu script, saf mantık testinin
// (tmp-incoming-offers-sort-agreement-failed-test.mjs) doğruladığı
// `job-requests.ts#sortIncomingOffersForDisplay` fonksiyonunun GERÇEKTEN
// bağlı olduğu bileşenin (incoming-offers-panel.tsx) gerçek DOM çıktısını,
// gerçek hesap/ilan/teklif akışlarıyla ve gerçek zamanlama (createdAt) ile
// doğrular — ayrıca aynı akış üzerinden "Kabul edildi -> diğer butonlar
// gizlenir -> Anlaşma Sağlanamadı -> butonlar tekrar görünür" iş kuralını ve
// 320/375/768px + masaüstü mobil uyumluluğunu (yatay taşma yok) da kapsar.
//
// GÜNCELLEME NOTU (Hizmet Türü -> İlan -> Teklifler gruplama görevi
// sonrası): bu script YAZILDIĞINDA "Gelen Teklifler" DÜZ (gruplanmamış) tek
// bir liste olarak render ediliyordu — bu yüzden DOM sırası doğrudan
// `sortIncomingOffersForDisplay`'in GLOBAL/düz çıktısıyla birebir aynıydı.
// Artık teklifler ÖNCE hizmet türüne, SONRA ilana göre gruplanıyor (bkz.
// incoming-offer-grouping.ts#groupIncomingOffersByCategoryAndJob) — bu,
// AYNI ilana ait teklifleri HER ZAMAN bitişik gösterir (bu görevin asıl
// amacı). Sonuç olarak, temel `sortIncomingOffersForDisplay` sırası HÂLÂ
// aynı algoritmadan (değişmedi) gelse de, DOM'daki NİHAİ sıra artık "bir
// ilan grubunun İLK teklifinin akışta göründüğü konum" tarafından belirlenir
// — bu grup, o konumdan itibaren TÜM kendi tekliflerini yanına toplar.
// Aşağıdaki beklenen sıralar bu YENİ (ve doğru/kasıtlı) gruplama davranışına
// göre güncellenmiştir; alttaki asıl doğrulama (agreement_failed aynı ilan
// içinde en altta, farklı ilan asla karışmaz, buton görünürlüğü kuralı)
// DEĞİŞMEMİŞTİR.
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

/** GERÇEK Kayıt Ol formu üzerinden (ham localStorage enjeksiyonu YOK) bir hesap oluşturur. */
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

/** GERÇEK ilan oluşturma formu üzerinden (ham localStorage enjeksiyonu YOK) tek servisli bir ilan yayınlar. */
async function createRealJobViaForm(page, { title, description }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

  await page.getByLabel("Hizmet Kategorisi").first().selectOption("lashing");
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
  await page.getByLabel("Açık Adres").first().fill("Sıralama testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Gelen Teklifler sıralama testi operasyon detayı, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  return page.url().split("/ilanlar/")[1];
}

/** GERÇEK teklif formu üzerinden (OfferPanel), fiyatı SONRADAN o teklifi DOM'da tanımak için kullanılacak şekilde ayarlanmış bir teklif gönderir. */
async function submitRealOffer(page, jobId, amount, description) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı").fill(String(amount));
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

/** `amount`in formatMoney çıktısıyla (tr-TR, "15.000 TL" gibi) BİREBİR aynı metnini üretir — para birimi TL sabit varsayılır (test tekliflerinin hepsi TRY). */
function amountText(amount) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}

/** Verilen fiyat metnini İÇEREN TEK kart kökünü (IncomingOfferCard'ın `rounded-card` kök div'i) döndürür. */
function offerCard(page, amount) {
  return page.locator("div.rounded-card").filter({ hasText: amountText(amount) });
}

/** "Gelen Teklifler" panelindeki TÜM kartları DOM sırasıyla tarar, bilinen fiyat metinlerinden hangisini içerdiklerini eşleştirip sıralı bir liste döndürür. */
async function readOfferOrderByAmounts(page, amounts) {
  const knownTexts = amounts.map(amountText);
  const cards = page.locator("div.rounded-card");
  const count = await cards.count();
  const order = [];
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).innerText();
    const matchIndex = knownTexts.findIndex((needle) => text.includes(needle));
    if (matchIndex !== -1) order.push(amounts[matchIndex]);
  }
  return order;
}

async function acceptOffer(page, amount) {
  const card = offerCard(page, amount);
  await card.getByRole("button", { name: "Kabul Et", exact: true }).click();
  await card.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

async function markAgreementFailed(page, amount) {
  const card = offerCard(page, amount);
  await card.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
  await card.getByRole("radio", { name: "Diğer", exact: true }).check();
  await card.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle", exact: true }).click();
  // Diyalog kapanana ve kart yeniden render olana kadar bekle.
  await card.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).waitFor({ state: "hidden", timeout: 10000 });
}

/**
 * `document.documentElement.scrollWidth > clientWidth` TEK BAŞINA güvenilir
 * bir yatay taşma testi DEĞİLDİR — Chromium'da `text-overflow: ellipsis`
 * (`truncate`) kullanan iç içe flex/grid düzenlerde, ekranda HİÇBİR görsel
 * kırpılma/taşma olmasa bile `scrollWidth` birkaç piksel yüksek raporlanan
 * bilinen bir motor kuraksılığı vardır (bkz. tmp-incoming-offers-category-
 * grouping-live-test.mjs'teki AYNI notun kanıtı). Bu yüzden asıl kullanıcı
 * deneyimini belirleyen GERÇEK ölçüt kullanılır: sayfa fiilen yatay
 * kaydırılabiliyor mu (`window.scrollTo` sonrası `scrollX` gerçekten
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
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-incoming-offers-sort-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const suffix = crypto.randomUUID().slice(0, 8);
  const jobATitle = `Sıralama Testi İlan A ${suffix}`;
  const jobBTitle = `Sıralama Testi İlan B ${suffix}`;
  const AMOUNT_O1 = 15000; // job A, en eski
  const AMOUNT_O2 = 26000; // job B
  const AMOUNT_O3 = 37000; // job A, en yeni (kabul edilip sonra anlaşma sağlanamadı olacak)
  const AMOUNT_O4 = 48000; // job A, O3'ten sonra gönderilir (kabul edilip o da anlaşma sağlanamadı olacak)

  // =====================================================================
  // KURULUM: talep sahibi + 2 bağımsız ilan (A, B)
  // =====================================================================
  const requesterEmail = `gelen-teklif-talep-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Sıralama",
    lastName: "TalepSahibi",
    email: requesterEmail,
    phone: "+905551110000",
    role: "hizmet-alan",
    companyName: "Sıralama Testi Firması",
    password: "SiralamaTest1!",
  });
  const jobAId = await createRealJobViaForm(page, {
    title: jobATitle,
    description: "İlan A açıklaması, en az yirmi karakter içerir.",
  });
  const jobBId = await createRealJobViaForm(page, {
    title: jobBTitle,
    description: "İlan B açıklaması, en az yirmi karakter içerir.",
  });
  ok(`KURULUM: talep sahibi + 2 bağımsız ilan (A=${jobAId}, B=${jobBId}) GERÇEK formla oluşturuldu`);

  // =====================================================================
  // O1 (job A, en eski) -> O2 (job B) -> O3 (job A, en yeni) sırasıyla
  // gönderilir — createdAt bu sırayla artar, bu da temel recency dizisinde
  // iki ilanın İÇ İÇE GEÇMESİNİ garanti eder: O3(A) > O2(B) > O1(A).
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı",
    lastName: "Bir",
    email: `saglayici-1-${suffix}@example.com`,
    phone: "+905552220001",
    role: "hizmet-veren",
    companyName: "Sağlayıcı Bir Firması",
    password: "Saglayici1!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_O1, "O1 teklifi, job A, en eski teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı",
    lastName: "Iki",
    email: `saglayici-2-${suffix}@example.com`,
    phone: "+905552220002",
    role: "hizmet-veren",
    companyName: "Sağlayıcı İki Firması",
    password: "Saglayici2!",
  });
  await submitRealOffer(page, jobBId, AMOUNT_O2, "O2 teklifi, job B, tek teklif, yirmi karakterden uzun.");

  await registerRealUser(page, {
    firstName: "Sağlayıcı",
    lastName: "Uc",
    email: `saglayici-3-${suffix}@example.com`,
    phone: "+905552220003",
    role: "hizmet-veren",
    companyName: "Sağlayıcı Üç Firması",
    password: "Saglayici3!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_O3, "O3 teklifi, job A, en yeni teklif, yirmi karakterden uzun.");
  ok("KURULUM: O1(job A) -> O2(job B) -> O3(job A) sırasıyla GERÇEK teklif formuyla gönderildi (iki ilan iç içe geçmiş recency)");

  // =====================================================================
  // TEST 1-2: talep sahibi Gelen Teklifler'i açar. Temel (durum
  // değişikliğinden önceki) `sortIncomingOffersForDisplay` çıktısı hâlâ saf
  // recency'dir: O3, O2, O1 — AMA artık gruplama (job A'nın ilk teklifi O3
  // akışta göründüğü an, job A'nın TÜM tekliflerini yanına toplar) DOM
  // sırasını [O3, O1, O2] yapar: job A (O3, O1) bitişik, job B'nin (O2) tek
  // teklifi kendi ayrı ilan grubunda. Bu, "aynı ilana ait teklifler aynı
  // ilan grubu altında gösterilir" gereksiniminin TAM OLARAK beklenen
  // sonucudur.
  // =====================================================================
  await loginAs(page, requesterEmail, "SiralamaTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  let order = await readOfferOrderByAmounts(page, [AMOUNT_O1, AMOUNT_O2, AMOUNT_O3]);
  assert.deepEqual(order, [AMOUNT_O3, AMOUNT_O1, AMOUNT_O2], "Durum değişikliğinden önce: job A'nın iki teklifi (O3, O1) bitişik gösterilmeli, job B'nin O2'si ayrı ilan grubunda");
  ok("TEST baseline: job A'nın teklifleri (O3, O1) bitişik gösteriliyor, job B'nin O2'si kendi ayrı ilan grubunda — DOM sırası [O3, O1, O2]");

  // =====================================================================
  // TEST 5: O3'ü kabul et — job A'nın diğer bekleyen teklifi (O1) artık
  // Kabul Et/Reddet göstermemeli; job B'nin O2'si (FARKLI ilan) ETKİLENMEMELİ.
  // =====================================================================
  await acceptOffer(page, AMOUNT_O3);
  const o1CardBeforeFail = offerCard(page, AMOUNT_O1);
  await o1CardBeforeFail.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await o1CardBeforeFail.getByRole("button", { name: "Kabul Et", exact: true }).count(), 0, "O3 kabul edildiğinde O1'in (aynı ilan, bekleyen) Kabul Et butonu GİZLENMELİ");
  assert.equal(await o1CardBeforeFail.getByRole("button", { name: "Reddet", exact: true }).count(), 0, "O3 kabul edildiğinde O1'in (aynı ilan, bekleyen) Reddet butonu GİZLENMELİ");
  const o2CardDuringAccept = offerCard(page, AMOUNT_O2);
  assert.equal(await o2CardDuringAccept.getByRole("button", { name: "Kabul Et", exact: true }).count(), 1, "O3 (job A) kabul edilse de O2'nin (FARKLI ilan, job B) Kabul Et butonu GÖRÜNÜR kalmalı");
  assert.equal(await o2CardDuringAccept.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "O3 (job A) kabul edilse de O2'nin (FARKLI ilan, job B) Reddet butonu GÖRÜNÜR kalmalı");
  ok("TEST 5: O3 kabul edildiğinde AYNI ilandaki O1'in butonları gizlendi; FARKLI ilandaki O2'nin butonları etkilenmedi");

  // =====================================================================
  // TEST 1 + TEST 6 + canlı yeniden sıralama: O3'ü "Anlaşma Sağlanamadı"
  // yap — SAYFA YENİLEMEDEN: (a) O1'in butonları TEKRAR görünmeli, (b) job
  // A'nın kendi iki teklifi (artık O1 önce, O3 sonra) HÂLÂ bitişik gösterilir
  // — ama job A'nın ilk teklifi artık O1 olduğu için (O3 agreement_failed
  // olup en düşük önceliğe düştüğünden `sortIncomingOffersForDisplay`
  // çıktısında O1 öne geçer), job A'nın grubu akışta O1'in konumundan
  // itibaren başlar; job B'nin O2'si kendi ayrı ilan grubunda, HİÇ
  // dokunulmadan kalır.
  // =====================================================================
  await markAgreementFailed(page, AMOUNT_O3);
  const o1CardAfterFail = offerCard(page, AMOUNT_O1);
  await o1CardAfterFail.getByRole("button", { name: "Kabul Et", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await o1CardAfterFail.getByRole("button", { name: "Reddet", exact: true }).count(), 1, "Anlaşma Sağlanamadı sonrası O1'in Reddet butonu da tekrar görünmeli");
  ok("TEST 6: O3 'Anlaşma Sağlanamadı' olunca AYNI ilandaki O1'in Kabul Et/Reddet butonları SAYFA YENİLEMEDEN tekrar göründü");

  order = await readOfferOrderByAmounts(page, [AMOUNT_O1, AMOUNT_O2, AMOUNT_O3]);
  assert.deepEqual(order, [AMOUNT_O1, AMOUNT_O3, AMOUNT_O2], "CANLI (yenilemeden): job A'nın iki teklifi (O1 önce, O3 en altta) bitişik kalmalı; job B'nin O2'si ayrı ilan grubunda etkilenmemeli");
  ok("TEST 1 (canlı): O3 (agreement_failed) SAYFA YENİLEMEDEN AYNI ilan grubunda O1'in altına indi — job A bitişik [O1, O3], job B (O2) ayrı grupta");

  // =====================================================================
  // TEST 4: sayfa yenilemede aynı sıra korunmalı.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  order = await readOfferOrderByAmounts(page, [AMOUNT_O1, AMOUNT_O2, AMOUNT_O3]);
  assert.deepEqual(order, [AMOUNT_O1, AMOUNT_O3, AMOUNT_O2], "Sayfa yenilendikten SONRA da sıra [O1, O3, O2] olarak korunmalı");
  ok("TEST 4: Sayfa yenilemesinden sonra sıralama AYNI kaldı ([O1, O3, O2])");

  // =====================================================================
  // TEST 3: ikinci bir "Anlaşma Sağlanamadı" (O4, job A, O3'ten SONRA
  // gönderilir — en yeni). `sortIncomingOffersForDisplay`in temel (gruplama
  // ÖNCESİ) çıktısı [O1, O4, O2, O3]tür (O1 bekleyen en önde, O4/O3 job A'nın
  // kendi tarih sırasıyla en sonda, O2 hâlâ kendi orijinal slotunda) — bkz.
  // tmp-incoming-offers-sort-agreement-failed-test.mjs'teki AYNI senaryonun
  // saf mantık kanıtı. Gruplama bunun ÜZERİNE eklenir: job A'nın İLK teklifi
  // bu akışta O1 (konum 0) olduğu için, job A'nın TÜM teklifleri (O1, O4, O3)
  // bitişik toplanır ve job B'nin (O2, akışta job A'dan SONRA ilk görünen)
  // grubu bunların HEPSİNİN ardına düşer — NİHAİ DOM sırası [O1, O4, O3, O2]
  // olur. "Birden fazla anlaşma sağlanamadı" + "farklı ilan asla karışmaz"
  // kuralları BİRLİKTE doğrulanır: O2 (job B) hiçbir zaman job A'nın iki
  // agreement_failed teklifinin (O4, O3) arasına karışmaz.
  // =====================================================================
  await registerRealUser(page, {
    firstName: "Sağlayıcı",
    lastName: "Dort",
    email: `saglayici-4-${suffix}@example.com`,
    phone: "+905552220004",
    role: "hizmet-veren",
    companyName: "Sağlayıcı Dört Firması",
    password: "Saglayici4!",
  });
  await submitRealOffer(page, jobAId, AMOUNT_O4, "O4 teklifi, job A, O3'ten sonra gönderilir, yirmi karakterden uzun.");

  await loginAs(page, requesterEmail, "SiralamaTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  await acceptOffer(page, AMOUNT_O4);
  await markAgreementFailed(page, AMOUNT_O4);

  order = await readOfferOrderByAmounts(page, [AMOUNT_O1, AMOUNT_O2, AMOUNT_O3, AMOUNT_O4]);
  assert.deepEqual(
    order,
    [AMOUNT_O1, AMOUNT_O4, AMOUNT_O3, AMOUNT_O2],
    "İkinci agreement_failed (O4) sonrası nihai sıra: job A'nın ÜÇ teklifi (O1 bekleyen en üstte, sonra O4/O3 kendi aralarındaki tarih sırasıyla) bitişik gösterilmeli; job B'nin O2'si bunların HİÇBİRİNİN arasına karışmadan en sonda, kendi ayrı ilan grubunda kalmalı",
  );
  ok("TEST 3: Birden fazla 'Anlaşma Sağlanamadı' (O3, O4) job A'nın bekleyeninin (O1) altında, KENDİ ARALARINDA tarih sırasını (O4 önce, O3 sonra) koruyor; job B'nin O2'si job A'nın tekliflerinin arasına hiç karışmadan ayrı ilan grubunda kaldı");

  // =====================================================================
  // TEST 7: mobil (320/375/768px) ve masaüstü genişliklerinde yatay taşma
  // olmamalı.
  // =====================================================================
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const noOverflow = await hasNoHorizontalOverflow(page);
    assert.ok(noOverflow, `${width}px genişlikte yatay taşma OLMAMALI`);
  }
  ok("TEST 7: 320px, 375px, 768px ve 1280px (masaüstü) genişliklerde yatay taşma tespit edilmedi");

  await context.close();
  console.log(`\n[tmp-incoming-offers-sort-agreement-failed-live-test] ${passed} test geçti.`);
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
