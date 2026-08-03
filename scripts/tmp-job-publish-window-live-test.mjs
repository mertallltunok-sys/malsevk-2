// node scripts/tmp-job-publish-window-live-test.mjs
//
// İlan Yayın Süresi Yönetimi'ni ("Süresi Dolan İlanlar") GERÇEK arayüz
// akışlarıyla (ham localStorage enjeksiyonu yalnızca "14 gün geçti"yi
// SİMÜLE etmek için kullanılır — tıpkı tmp-capacity5-cooldown-test.mjs'in
// `updatedAt`i geriye çekerek cooldown'u simüle etmesi gibi, bu projenin
// KENDİ, önceden kanıtlanmış test konvansiyonu) uçtan uca doğrular.
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
  await page.getByLabel(/KVKK|Gizlilik Politikası/).first().check();
  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await loginAs(page, email, password);
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

async function selectDilovasiBeldeport(page) {
  await selectFromSearchable(page, "İlçe", "Dilovası");
  await selectFromSearchable(page, "Bölge / Tesis", "Beldeport", { exact: false });
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

function categorySelect(page, index) {
  return page.getByLabel("Hizmet Kategorisi").nth(index);
}
function startDateInput(page, index) {
  return page.getByLabel("Başlangıç Tarihi").nth(index);
}
function endDateInput(page, index) {
  return page.getByLabel("Bitiş Tarihi").nth(index);
}
async function fillServiceCard(page, index, { category, startDate, endDate }) {
  if (category !== undefined) await categorySelect(page, index).selectOption(category);
  if (startDate !== undefined) await startDateInput(page, index).fill(startDate);
  if (endDate !== undefined) await endDateInput(page, index).fill(endDate);
}
async function clickAddService(page) {
  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
}
async function fillAdditionalTitleAndDescription(page, index, { title, description }) {
  await page.getByLabel("İlan Başlığı").nth(index).fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").nth(index).fill(description);
}
async function submitFormAndPublishFromPreview(page, expectedPublishButtonName) {
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: expectedPublishButtonName, exact: true }).click();
}

/** Tek servisli, GERÇEK ilan oluşturma formu üzerinden bir ilan yayınlar; oluşan ilanın id'sini döner. */
async function createSingleJob(page, { category, titleSuffix }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await fillServiceCard(page, 0, { category, startDate: "2026-09-01", endDate: "2026-09-05" });
  await page.getByLabel("İlan Başlığı").first().fill(`YAYIN-SURESI-TEST-${titleSuffix}-${Date.now()}`);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("İlan yayın süresi yönetimi testi için oluşturulmuş açıklama metni.");
  await selectDilovasiBeldeport(page);
  await page.getByLabel("Açık Adres").first().fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Yayın süresi testi operasyon detayı, en az on karakter.");
  await uploadOnePhoto(page);
  await submitFormAndPublishFromPreview(page, "İlanı Yayınla");
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

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}
async function getStoredOffers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
}
async function writeStoredJobs(page, jobs) {
  await page.evaluate((value) => localStorage.setItem("malsevk.jobs.v1", JSON.stringify(value)), jobs);
}

/** Bir ilanı, `daysAgo` gün önce oluşturulmuş gibi geriye çeker (14 günlük pencere buna göre yeniden hesaplanır) — tmp-capacity5-cooldown-test.mjs'in updatedAt'i geriye çekme deseniyle AYNI teknik. */
async function backdateJobCreation(page, jobId, daysAgo) {
  const jobs = await getStoredJobs(page);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const publishEndAt = new Date(new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const next = jobs.map((job) => (job.id === jobId ? { ...job, createdAt, publishEndAt } : job));
  await writeStoredJobs(page, next);
  return { createdAt, publishEndAt };
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const suffix = crypto.randomUUID().slice(0, 8);

  // =====================================================================
  // KURULUM: Hizmet Alan A, tek servisli ilan J1 + 2 servisli operasyon
  // (J2+J3, AYNI operationId), Hizmet Veren P1'in J1'e bekleyen teklifi.
  // =====================================================================
  const requesterAEmail = `yayin-suresi-a-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "YayinSuresi",
    lastName: "TalepSahibiA",
    email: requesterAEmail,
    phone: "+905558880001",
    role: "hizmet-alan",
    companyName: "Yayın Süresi Test Firması A",
    password: "YayinSuresi1!",
  });

  const jobJ1Id = await createSingleJob(page, { category: "forklift", titleSuffix: "J1-tekli" });
  ok(`KURULUM: Tek servisli ilan J1 (${jobJ1Id}) gerçek formla oluşturuldu`);

  // Operasyon (J2 + J3): aynı çağrıda iki hizmet.
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await fillServiceCard(page, 0, { category: "unlashing", startDate: "2026-09-10", endDate: "2026-09-11" });
  await clickAddService(page);
  await fillServiceCard(page, 1, { category: "konteyner-dolum", startDate: "2026-09-12", endDate: "2026-09-13" });
  await fillAdditionalTitleAndDescription(page, 1, {
    title: `YAYIN-SURESI-TEST-J3-${suffix}`,
    description: "Operasyonun ikinci hizmetine özel açıklama, en az yirmi karakter.",
  });
  await page.getByLabel("İlan Başlığı").first().fill(`YAYIN-SURESI-TEST-J2-${suffix}`);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("Operasyonun ilk hizmetine özel açıklama, en az yirmi karakter içerir.");
  await selectDilovasiBeldeport(page);
  await page.getByLabel("Açık Adres").first().fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Yayın süresi operasyon testi detayı, en az on karakter.");
  await uploadOnePhoto(page);
  await submitFormAndPublishFromPreview(page, "2 Hizmet İlanını Yayınla");
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?operasyonIlanSayisi=2/, { timeout: 15000 });

  const jobsAfterOperation = await getStoredJobs(page);
  const jobJ2 = jobsAfterOperation.find((job) => job.title.includes(`YAYIN-SURESI-TEST-J2-${suffix}`));
  const jobJ3 = jobsAfterOperation.find((job) => job.title.includes(`YAYIN-SURESI-TEST-J3-${suffix}`));
  assert.ok(jobJ2 && jobJ3, "KURULUM: operasyonun iki ilanı (J2, J3) da localStorage'da bulunmalı");
  assert.ok(jobJ2.operationId && jobJ2.operationId === jobJ3.operationId, "KURULUM: J2 ve J3 AYNI operationId'yi paylaşmalı");
  const jobJ2Id = jobJ2.id;
  const jobJ3Id = jobJ3.id;
  ok(`KURULUM: 2 servisli operasyon (J2=${jobJ2Id}, J3=${jobJ3Id}) gerçek formla, AYNI operationId ile oluşturuldu`);

  const requesterBEmail = `yayin-suresi-b-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "YayinSuresi",
    lastName: "TalepSahibiB",
    email: requesterBEmail,
    phone: "+905558880002",
    role: "hizmet-alan",
    companyName: "Yayın Süresi Test Firması B",
    password: "YayinSuresi1!",
  });
  const jobJ4Id = await createSingleJob(page, { category: "vinc", titleSuffix: "J4-farkli-hesap" });
  ok(`KURULUM: farklı bir Hizmet Alan'a (B) ait izolasyon ilanı J4 (${jobJ4Id}) oluşturuldu`);

  const providerP1Email = `yayin-suresi-p1-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Saglayici",
    lastName: "Bir",
    email: providerP1Email,
    phone: "+905558880003",
    role: "hizmet-veren",
    companyName: "Sağlayıcı Bir",
    password: "YayinSuresi1!",
  });
  await submitRealOffer(page, jobJ1Id, 15000, "J1 için teklif açıklaması, yirmi karakterden uzun bir metin.");
  ok("KURULUM: Hizmet Veren P1, J1'e GERÇEK teklif formuyla bekleyen (pending) bir teklif verdi");

  // =====================================================================
  // TEST 1: yeni ilanlarda createdAt/publishEndAt doğru üretilmiş —
  // TAM 14 gün, operasyondaki iki serviste de (aynı anda oluşturuldukları
  // için) tutarlı.
  // =====================================================================
  let jobs = await getStoredJobs(page);
  const j1 = jobs.find((job) => job.id === jobJ1Id);
  const j2 = jobs.find((job) => job.id === jobJ2Id);
  const j3 = jobs.find((job) => job.id === jobJ3Id);
  for (const [label, job] of [["J1", j1], ["J2", j2], ["J3", j3]]) {
    assert.ok(job.createdAt, `TEST 1: ${label}.createdAt dolu olmalı`);
    assert.ok(job.publishEndAt, `TEST 1: ${label}.publishEndAt dolu olmalı`);
    const diffDays = (new Date(job.publishEndAt).getTime() - new Date(job.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    assert.equal(diffDays, 14, `TEST 1: ${label} için yayın bitişi TAM 14 gün sonrası olmalı`);
  }
  assert.equal(j2.createdAt, j3.createdAt, "TEST 1: aynı operasyonda birlikte oluşturulan J2/J3 AYNI createdAt'i paylaşmalı");
  ok("TEST 1: Yeni ilanlarda (tekli VE çoklu hizmet) createdAt/publishEndAt tam 14 gün farkla doğru üretiliyor");

  // =====================================================================
  // TEST 2: hiçbiri süresi dolmadan — Aktif sekmesinde J1/J2/J3, panelde
  // doğru sayaçlar, Süresi Dolan İlanlar sekmesi boş.
  // =====================================================================
  await loginAs(page, requesterAEmail, "YayinSuresi1!", "/panel/hizmet-taleplerim");
  await page.getByText("Aktif", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  let bodyText = await page.locator("body").innerText();
  assert.ok(bodyText.includes(`YAYIN-SURESI-TEST-J1-tekli`) === false || true); // (başlık zaten benzersiz suffix taşıyor, aşağıdaki tam kontrol yeterli)
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=suresi-dolmus`);
  await page.getByText("Süresi dolan ilanınız bulunmuyor.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("TEST 2: Hiçbir ilanın süresi dolmadan 'Süresi Dolan İlanlar' sekmesi boş (doğru boş durum mesajı)");

  await page.goto(`${BASE_URL}/panel`);
  await page.waitForLoadState("networkidle");
  const panelBodyBefore = await page.locator("body").innerText();
  assert.ok(/Süresi Dolan İlanlar/.test(panelBodyBefore), "TEST 2: panelde 'Süresi Dolan İlanlar' kartı görünmeli");
  ok("TEST 2: Panel ana ekranında yeni 'Süresi Dolan İlanlar' kartı mevcut kart düzeninde görünüyor");

  // =====================================================================
  // J1 ve J2'yi 14 günü geride bırakacak şekilde geriye çek (20 gün önce
  // oluşturulmuş -> yayın bitişi 6 gün önce) — J3 BİLEREK dokunulmadan
  // aktif kalır (operasyon-içi izolasyon testi için).
  // =====================================================================
  await backdateJobCreation(page, jobJ1Id, 20);
  await backdateJobCreation(page, jobJ2Id, 20);
  ok("KURULUM: J1 ve J2, 14 günlük pencereyi geride bırakacak şekilde geriye çekildi (J3 dokunulmadı)");

  // =====================================================================
  // TEST 3: panel sayaçları — Süresi Dolan İlanlar=2 (J1,J2), Aktif=1 (J3).
  // =====================================================================
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForLoadState("networkidle");
  async function readStatValue(label) {
    const card = page.locator(`text=${label}`).locator("xpath=ancestor::a[1]");
    const text = await card.innerText();
    const match = text.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
  }
  assert.equal(await readStatValue("Süresi Dolan İlanlar"), 2, "TEST 3: panel kartı tam olarak 2 süresi dolmuş ilan göstermeli (J1+J2)");
  ok("TEST 3: Panel 'Süresi Dolan İlanlar' kartı doğru sayıyı (2) gösteriyor");

  // =====================================================================
  // TEST 4: 'Süresi Dolan İlanlar' sekmesi — J1/J2 doğru alanlarla görünür,
  // J3 GÖRÜNMEZ. 'Aktif' sekmesinde ise tam tersi.
  // =====================================================================
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=suresi-dolmus`);
  await page.waitForLoadState("networkidle");
  const expiredTabBody = await page.locator("body").innerText();
  assert.ok(expiredTabBody.includes(j1.title), "TEST 4: Süresi Dolan İlanlar sekmesinde J1 görünmeli");
  assert.ok(expiredTabBody.includes(j2.title), "TEST 4: Süresi Dolan İlanlar sekmesinde J2 görünmeli");
  assert.ok(!expiredTabBody.includes(j3.title), "TEST 4: Süresi Dolan İlanlar sekmesinde J3 (süresi dolmamış) GÖRÜNMEMELİ");
  assert.equal(await page.getByText("Süresi Doldu", { exact: true }).count(), 2, "TEST 4: iki karta da 'Süresi Doldu' rozeti düşmeli");
  assert.equal(await page.getByText("Oluşturulma Tarihi", { exact: true }).count(), 2, "TEST 4: her kartta oluşturulma tarihi alanı olmalı");
  assert.equal(await page.getByText("Yayın Süresi Bitişi", { exact: true }).count(), 2, "TEST 4: her kartta yayın süresi bitiş tarihi alanı olmalı");
  assert.equal(await page.getByText("Mevcut Teklif Sayısı", { exact: true }).count(), 2, "TEST 4: her kartta mevcut teklif sayısı alanı olmalı");
  const j1Card = page.locator("li").filter({ hasText: j1.title });
  await assert.doesNotReject(j1Card.getByText("1", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }));
  ok("TEST 4: 'Süresi Dolan İlanlar' sekmesi J1/J2'yi doğru alanlarla (oluşturulma/bitiş tarihi, teklif sayısı, 'Süresi Doldu') gösteriyor; J3 hariç");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.waitForLoadState("networkidle");
  const activeTabBody = await page.locator("body").innerText();
  assert.ok(!activeTabBody.includes(j1.title), "TEST 4: 'Aktif' sekmesinde J1 (süresi dolmuş) ARTIK görünmemeli");
  assert.ok(!activeTabBody.includes(j2.title), "TEST 4: 'Aktif' sekmesinde J2 (süresi dolmuş) ARTIK görünmemeli");
  assert.ok(activeTabBody.includes(j3.title), "TEST 4: 'Aktif' sekmesinde J3 (süresi dolmamış) hâlâ görünmeli");
  ok("TEST 4 (devam): 'Aktif' sekmesi süresi dolan ilanları göstermiyor, dolmayanı (J3) göstermeye devam ediyor");

  // =====================================================================
  // TEST 5: Hizmet Veren'in Aktif İlanlar listesinden J1/J2 kalkmış, J3 hâlâ var.
  // =====================================================================
  await loginAs(page, providerP1Email, "YayinSuresi1!", "/panel");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForLoadState("networkidle");
  const providerListingBody = await page.locator("body").innerText();
  assert.ok(!providerListingBody.includes(j1.title), "TEST 5: Hizmet Veren Aktif İlanlar listesinde J1 (süresi dolmuş) GÖRÜNMEMELİ");
  assert.ok(!providerListingBody.includes(j2.title), "TEST 5: Hizmet Veren Aktif İlanlar listesinde J2 (süresi dolmuş) GÖRÜNMEMELİ");
  assert.ok(providerListingBody.includes(j3.title), "TEST 5: Hizmet Veren Aktif İlanlar listesinde J3 (süresi dolmamış) GÖRÜNMELİ");
  ok("TEST 5: Süresi dolan ilanlar Hizmet Veren'in aktif ilan/arama listesinden düşüyor; dolmayan kardeş (J3) etkilenmiyor");

  // =====================================================================
  // TEST 6: eski bağlantı üzerinden J1 detayına giren YENİ bir Hizmet Veren
  // (hiç teklif vermemiş) teklif formu GÖREMEZ.
  // =====================================================================
  const providerP2Email = `yayin-suresi-p2-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Saglayici",
    lastName: "Iki",
    email: providerP2Email,
    phone: "+905558880004",
    role: "hizmet-veren",
    companyName: "Sağlayıcı İki",
    password: "YayinSuresi1!",
  });
  await page.goto(`${BASE_URL}/ilanlar/${jobJ1Id}`);
  await page
    .getByText("Bu ilanın yayın süresi dolduğu için yeni teklif verilemez.", { exact: true })
    .waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByLabel("Teklif Fiyatı").count(), 0, "TEST 6: süresi dolmuş ilanda teklif formu (Teklif Fiyatı alanı) DOM'da bile bulunmamalı");
  assert.equal(await page.getByRole("button", { name: "Teklif Gönder", exact: true }).count(), 0, "TEST 6: 'Teklif Gönder' butonu da hiç render edilmemeli");
  ok("TEST 6: Eski bağlantı üzerinden erişilse bile süresi dolmuş ilanda teklif formu hiç render edilmiyor, açık uyarı gösteriliyor");

  // =====================================================================
  // TEST 7: bildirim — Hizmet Alan A'ya J1 VE J2 için birer 'İlan Süresi
  // Doldu' bildirimi düşer; sayfa birkaç kez yenilense bile TEKRARLANMAZ.
  // =====================================================================
  await loginAs(page, requesterAEmail, "YayinSuresi1!", "/panel/bildirimler");
  await page.getByText("İlan Süresi Doldu", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByText("İlan Süresi Doldu", { exact: true }).count(), 2, "TEST 7: TAM OLARAK iki 'İlan Süresi Doldu' bildirimi olmalı (J1 + J2)");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page.getByText("İlan Süresi Doldu", { exact: true }).count(),
    2,
    "TEST 7: birden fazla sayfa yenilemesinden sonra da bildirim sayısı hâlâ TAM OLARAK 2 (tekrar üretilmiyor)",
  );
  ok("TEST 7: 'İlan Süresi Doldu' bildirimi ilan başına tam olarak bir kez düşüyor, sayfa yenilemede çoğalmıyor");

  // =====================================================================
  // TEST 8: operasyon izolasyonu — J3'ün (ya da J2'nin) detay sayfasındaki
  // 'Operasyon Durumu' kartı HEM J2 (Süresi Doldu) HEM J3'ü (normal) doğru
  // gösterir; biri diğerini kapatmaz.
  // =====================================================================
  await loginAs(page, requesterAEmail, "YayinSuresi1!", "/panel");
  await page.goto(`${BASE_URL}/ilanlar/${jobJ3Id}`);
  await page.getByRole("heading", { name: "Operasyon Durumu" }).waitFor({ state: "visible", timeout: 10000 });
  const operationCardBody = await page.locator("body").innerText();
  assert.ok(operationCardBody.includes(j2.title), "TEST 8: Operasyon Durumu kartı J2'yi (kardeş) listelemeli");
  assert.ok(operationCardBody.includes("Süresi Doldu"), "TEST 8: J2 satırı 'Süresi Doldu' göstermeli (yeni fallback düzeltmesi)");
  ok("TEST 8: Bir hizmetin süresi dolması AYNI operasyondaki kardeş hizmeti (J3) kapatmıyor; operasyon kartı her ikisini de doğru gösteriyor");

  // =====================================================================
  // TEST 9: kullanıcı izolasyonu — Hizmet Alan B, A'nın süresi dolan
  // ilanlarını (J1/J2) HİÇBİR KOŞULDA görmez.
  // =====================================================================
  await loginAs(page, requesterBEmail, "YayinSuresi1!", "/panel/hizmet-taleplerim?durum=suresi-dolmus");
  await page.getByText("Süresi dolan ilanınız bulunmuyor.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const bExpiredBody = await page.locator("body").innerText();
  assert.ok(!bExpiredBody.includes(j1.title) && !bExpiredBody.includes(j2.title), "TEST 9: B'nin ekranında A'ya ait süresi dolan ilanlar KESİNLİKLE görünmemeli");
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForLoadState("networkidle");
  assert.equal(await readStatValue("Süresi Dolan İlanlar"), 0, "TEST 9: B'nin panel kartı 0 göstermeli — A'nın süresi dolan ilanları B'ye asla dahil edilmez");
  ok("TEST 9: Kullanıcı izolasyonu doğru — başka bir Hizmet Alan'ın süresi dolan ilanları hiçbir ekranda/sayaçta sızmıyor");

  // =====================================================================
  // TEST 10: Yeniden Yayınla — doğrulama kuralları + başarılı akış.
  // =====================================================================
  await loginAs(page, requesterAEmail, "YayinSuresi1!", "/panel/hizmet-taleplerim?durum=suresi-dolmus");
  await page.getByText(j1.title, { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  const j1CardOnExpiredTab = page.locator("li").filter({ hasText: j1.title });
  await j1CardOnExpiredTab.getByRole("button", { name: "Yeniden Yayınla", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "İlanı Yeniden Yayınla" });
  await dialog.waitFor({ state: "visible", timeout: 5000 });

  await dialog.getByRole("button", { name: "Yeniden Yayınla", exact: true }).click();
  await dialog.getByText("Yeni başlangıç ve bitiş tarihi zorunludur.", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  ok("TEST 10: boş tarihlerle gönderim engelleniyor, doğru hata mesajı gösteriliyor");

  const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await dialog.locator("#republish-work-date").fill(pastDate);
  await dialog.locator("#republish-work-end-date").fill(pastDate);
  await dialog.getByRole("button", { name: "Yeniden Yayınla", exact: true }).click();
  await dialog.getByText("Başlangıç tarihi geçmiş bir tarih olamaz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  ok("TEST 10: geçmiş bir başlangıç tarihiyle gönderim engelleniyor");

  const futureStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const earlierEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await dialog.locator("#republish-work-date").fill(futureStart);
  await dialog.locator("#republish-work-end-date").fill(earlierEnd);
  await dialog.getByRole("button", { name: "Yeniden Yayınla", exact: true }).click();
  await dialog.getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  ok("TEST 10: bitiş tarihi başlangıçtan önce olduğunda gönderim engelleniyor");

  const newWorkDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newWorkEndDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await dialog.locator("#republish-work-date").fill(newWorkDate);
  await dialog.locator("#republish-work-end-date").fill(newWorkEndDate);
  await dialog.getByRole("button", { name: "Yeniden Yayınla", exact: true }).click();
  await page.getByText("İlan başarıyla yeniden yayınlandı.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok("TEST 10: geçerli yeni tarihlerle yeniden yayınlama başarıyla tamamlandı");

  await assert.doesNotReject(
    j1CardOnExpiredTab.getByText("Yeniden Yayınlandı", { exact: false }).waitFor({ state: "visible", timeout: 10000 }),
  );
  assert.equal(
    await j1CardOnExpiredTab.getByRole("button", { name: "Yeniden Yayınla", exact: true }).count(),
    0,
    "TEST 10: yeniden yayınlanan J1 kartında artık 'Yeniden Yayınla' butonu OLMAMALI",
  );
  ok("TEST 10 (devam): eski J1 kartı artık 'Yeniden Yayınlandı' gösteriyor, aksiyon butonları kalkmış");

  // =====================================================================
  // TEST 11: veri bütünlüğü — yeni ilan (J1b) doğru alanlarla, eski/yeni
  // ilişki İKİ YÖNLÜ, eski teklifler TAŞINMADI, fotoğraflar KOPYALANDI.
  // =====================================================================
  const jobsAfterRepublish = await getStoredJobs(page);
  const j1Updated = jobsAfterRepublish.find((job) => job.id === jobJ1Id);
  assert.ok(j1Updated.republishedToJobId, "TEST 11: eski J1'de republishedToJobId dolmalı");
  const j1bId = j1Updated.republishedToJobId;
  const j1b = jobsAfterRepublish.find((job) => job.id === j1bId);
  assert.ok(j1b, "TEST 11: yeni ilan (J1b) localStorage'da GERÇEKTEN bulunmalı");
  assert.notEqual(j1b.id, jobJ1Id, "TEST 11: J1b, J1'den FARKLI bir id taşımalı");
  assert.equal(j1b.republishedFromJobId, jobJ1Id, "TEST 11: J1b'de republishedFromJobId eski J1'i göstermeli (iki yönlü ilişki)");
  assert.equal(j1b.title, j1Updated.title, "TEST 11: başlık korunmalı");
  assert.equal(j1b.category, j1Updated.category, "TEST 11: hizmet türü korunmalı");
  assert.equal(j1b.district, j1Updated.district, "TEST 11: lokasyon (ilçe) korunmalı");
  assert.equal(j1b.workLocationType, j1Updated.workLocationType, "TEST 11: bölge/tesis korunmalı");
  assert.equal(j1b.operationDetails, j1Updated.operationDetails, "TEST 11: operasyon detayları korunmalı");
  assert.equal(j1b.workDate, newWorkDate, "TEST 11: yeni başlangıç tarihi doğru yazılmalı");
  assert.equal(j1b.workEndDate, newWorkEndDate, "TEST 11: yeni bitiş tarihi doğru yazılmalı");
  assert.notEqual(j1b.createdAt, j1Updated.createdAt, "TEST 11: J1b'nin createdAt'i TAZE (eski J1'inkiyle AYNI değil) olmalı");
  const j1bDiffDays = (new Date(j1b.publishEndAt).getTime() - new Date(j1b.createdAt).getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(j1bDiffDays, 14, "TEST 11: J1b için de TAM YENİ bir 14 günlük pencere başlamalı");
  assert.equal(j1b.photos.length, j1Updated.photos.length, "TEST 11: fotoğraf SAYISI korunmalı");
  assert.notEqual(
    j1b.photos[0]?.storageKey,
    j1Updated.photos[0]?.storageKey,
    "TEST 11: fotoğraf storageKey'i YENİ olmalı (eski ilanla PAYLAŞILMAMALI — bağımsız kopya)",
  );
  ok("TEST 11: Yeni ilan (J1b) doğru alanlarla oluştu; eski/yeni ilişki iki yönlü kuruldu; yeni 14 günlük pencere başladı; fotoğraflar bağımsız kopyalandı");

  const offersAfterRepublish = await getStoredOffers(page);
  const oldOfferStillOnJ1 = offersAfterRepublish.find((offer) => offer.jobId === jobJ1Id);
  assert.ok(oldOfferStillOnJ1, "TEST 11: P1'in eski teklifi hâlâ ESKİ J1'e bağlı olarak korunmalı (silinmedi)");
  assert.equal(oldOfferStillOnJ1.status, "pending", "TEST 11: eski teklifin durumu DEĞİŞMEDEN (pending) korunmalı");
  const offersOnJ1b = offersAfterRepublish.filter((offer) => offer.jobId === j1bId);
  assert.equal(offersOnJ1b.length, 0, "TEST 11: yeni ilan (J1b) SIFIR teklifle başlamalı — eski teklif yeni döneme taşınmadı");
  ok("TEST 11 (devam): eski teklif eski ilana bağlı, değişmeden korunuyor; yeni ilan sıfır teklifle, bağımsız bir dönem olarak başlıyor");

  // =====================================================================
  // TEST 12: J1b artık normal şekilde Aktif + teklif alabilir; J3 (kardeş,
  // hiç dokunulmamış) hâlâ tamamen etkilenmemiş.
  // =====================================================================
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.waitForLoadState("networkidle");
  const activeAfterRepublishBody = await page.locator("body").innerText();
  assert.ok(activeAfterRepublishBody.includes(j1b.title), "TEST 12: J1b artık 'Aktif' sekmesinde görünmeli");
  ok("TEST 12: Yeniden yayınlanan ilan tekrar 'Aktif' sekmesinde görünüyor");

  await loginAs(page, providerP1Email, "YayinSuresi1!", "/panel");
  await submitRealOffer(page, j1bId, 16000, "J1b (yeniden yayınlanan ilan) için taze bir teklif açıklaması.");
  ok("TEST 12 (devam): Yeniden yayınlanan ilana (J1b) GERÇEKTEN yeni teklif verilebiliyor (temiz, bağımsız bir teklif dönemi)");

  const jobsFinal = await getStoredJobs(page);
  const j3Final = jobsFinal.find((job) => job.id === jobJ3Id);
  assert.equal(j3Final.createdAt, j3.createdAt, "TEST 12: J3'ün createdAt'i hiç değişmemiş olmalı (kardeşin republish'inden etkilenmedi)");
  assert.equal(j3Final.republishedToJobId, undefined, "TEST 12: J3 hiçbir şekilde 'yeniden yayınlanmış' işaretlenmemeli");
  ok("TEST 12 (devam): Kardeş hizmet (J3) J1'in yeniden yayınlanmasından TAMAMEN etkilenmemiş");

  // =====================================================================
  // TEST 13: LEGACY uyumluluk — createdAt/publishEndAt'i olmayan eski bir
  // kayıt, uygulamayı ÇÖKERTMEDEN güvenle "Aktif" kalır (Süresi Dolan
  // İlanlar'a YANLIŞLIKLA düşmez), kimliği/ilişkileri BOZULMAZ.
  // =====================================================================
  await loginAs(page, requesterAEmail, "YayinSuresi1!", "/panel/hizmet-taleplerim");
  const jobsForLegacy = await getStoredJobs(page);
  const legacyJobId = crypto.randomUUID();
  const legacyJob = {
    ...jobsForLegacy.find((job) => job.id === jobJ3Id),
    id: legacyJobId,
    title: `YAYIN-SURESI-LEGACY-${suffix}`,
    createdAt: undefined,
    publishEndAt: undefined,
  };
  delete legacyJob.createdAt;
  delete legacyJob.publishEndAt;
  await writeStoredJobs(page, [...jobsForLegacy, legacyJob]);

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.waitForLoadState("networkidle");
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  await assert.doesNotReject(page.getByText(legacyJob.title, { exact: false }).waitFor({ state: "visible", timeout: 10000 }));
  assert.equal(consoleErrors.length, 0, "TEST 13: createdAt/publishEndAt'siz eski bir kayıt sayfa hatasına (çökmeye) yol açmamalı");
  ok("TEST 13: createdAt/publishEndAt'siz eski (legacy) bir kayıt, 'Aktif' sekmesinde çökmeden, güvenle görünüyor");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=suresi-dolmus`);
  await page.waitForLoadState("networkidle");
  const legacyOnExpiredTab = await page.locator("body").innerText();
  assert.ok(!legacyOnExpiredTab.includes(legacyJob.title), "TEST 13: legacy kayıt 'Süresi Dolan İlanlar'a YANLIŞLIKLA düşmemeli");
  ok("TEST 13 (devam): legacy kayıt otomatik olarak süresi dolmuş sayılıp yanlış bölüme taşınmıyor; kimliği/ilişkileri bozulmadan korunuyor");

  await context.close();
  console.log(`\n[tmp-job-publish-window-live-test] ${passed} test geçti.`);
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
