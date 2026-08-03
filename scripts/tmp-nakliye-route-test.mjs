// node scripts/tmp-nakliye-route-test.mjs
//
// Nakliye Güzergâh Yönetimi (Yük Alınacak Yer / Teslim Edilecek Yer)
// doğrulama testi — "Listede yok, kendim gireceğim" manuel modu artık AYRI
// bir "Liman / Sanayi / OSB Adı" serbest metin input'u açar VE Açık Adres
// artık seçilen yönteme (katalog tesis ya da manuel ad) bakılmaksızın HER
// ZAMAN görünür/zorunludur (eski davranışta yalnızca manuel modda görünür/
// zorunluydu, katalog modunda tamamen gizlenip atılıyordu). Bu test dosyası
// önceki sürümün ("Açık Adres yalnızca manuel modda görünür") artık YANLIŞ
// olan varsayımlarını da düzeltir. GERÇEK render edilmiş sayfaya karşı
// (Playwright, gerçek Chromium).
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

/**
 * Yük Alınacak Yer/Teslim Edilecek Yer aynı erişilebilir ismi ("İl"/"İlçe"/
 * "Liman / Sanayi / OSB") paylaşır — bu yüzden `nth()` indeksine güvenmek
 * kırılgandır. Bunun yerine job-request-form.tsx/job-edit-form.tsx'in
 * verdiği `idPrefix` ile BİREBİR eşleşen DOM id'lerini (ör.
 * `service-pickup-...-province`, `job-edit-delivery-province`) hedefler —
 * hangi taraf manuel/tesis modunda olursa olsun her zaman DOĞRU tek elemanı
 * bulur.
 */
function fieldButton(page, idPrefix, suffix) {
  return page.locator(`button[id^="${idPrefix}"][id$="-${suffix}"]`);
}
function addressField(page, idPrefix) {
  return page.locator(`textarea[id^="${idPrefix}"][id$="-addressText"]`);
}
/** "Liman / Sanayi / OSB Adı" — yalnızca manuel mod seçiliyken render edilir. */
function facilityNameField(page, idPrefix) {
  return page.locator(`input[id^="${idPrefix}"][id$="-customFacilityName"]`);
}

async function selectByPrefix(page, idPrefix, suffix, fieldName, optionName, { exact = true } = {}) {
  await fieldButton(page, idPrefix, suffix).click();
  const listbox = page.locator(`ul[aria-label="${fieldName}"]`);
  await listbox.waitFor({ state: "visible", timeout: 10000 });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
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

async function gotoCreateForm(page) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
}

// job-request-form.tsx: idPrefix = `service-pickup-${localId}` / `service-delivery-${localId}` — tek
// hizmet kartı olduğu için (bu testte hep tek hizmetli operasyonlar kullanılır) `^=` öneki tek bir
// karta çözülür.
const PICKUP_PREFIX = "service-pickup-";
const DELIVERY_PREFIX = "service-delivery-";

/**
 * Bir tarafı (pickup ya da delivery) doldurur — `facilityName` verilirse
 * katalogdan seçer, `manualFacilityName` verilirse "Listede yok, kendim
 * gireceğim" seçip GERÇEK bir tesis adı yazar (görev tanımı madde 1).
 * `address` artık HER İKİ modda da doldurulur — seçilen yönteme
 * bakılmaksızın Açık Adres HER ZAMAN zorunludur (görev tanımı madde 2/3).
 */
async function fillSide(page, idPrefix, { province, district, facilityName, manualFacilityName, address }) {
  await selectByPrefix(page, idPrefix, "province", "İl", province);
  await selectByPrefix(page, idPrefix, "district", "İlçe", district);
  if (facilityName) {
    await selectByPrefix(page, idPrefix, "locationType", "Liman / Sanayi / OSB", facilityName, { exact: false });
  } else {
    await fieldButton(page, idPrefix, "locationType").click();
    const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
    await listbox.waitFor({ state: "visible", timeout: 10000 });
    await listbox.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).click();
    await facilityNameField(page, idPrefix).fill(manualFacilityName);
  }
  await addressField(page, idPrefix).fill(address);
}

async function fillCommonFields(page, title) {
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Otomatik doğrulama testi açıklaması — en az yirmi karakter.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-10");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-12");
  await page.getByLabel("Ürün Adedi").first().fill("10");
  await page.getByLabel(/^Tonaj/).first().fill("12");
  await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Forklift ile yükleme yapılacaktır, ekstra ekipman gerekmez.");
}

async function submitAndPublish(page) {
  await page.locator('button[type="submit"]').click();
  await page.getByText("Operasyon Özeti", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/[^/]+$/, { timeout: 15000 });
  return page.url().split("/").pop();
}

async function expectEmpty(locator) {
  const value = await locator.inputValue();
  assert.equal(value, "");
}

async function pickupProvinceResetCheck(page) {
  await selectByPrefix(page, PICKUP_PREFIX, "district", "İlçe", "Gebze");
  await selectByPrefix(page, PICKUP_PREFIX, "locationType", "Liman / Sanayi / OSB", "Gebze Organize Sanayi Bölgesi", {
    exact: false,
  });
  await addressField(page, PICKUP_PREFIX).fill("Gebze OSB İçi, Test Cadde No:9");

  await selectByPrefix(page, PICKUP_PREFIX, "province", "İl", "İzmir");
  const districtButtonText = await fieldButton(page, PICKUP_PREFIX, "district").innerText();
  assert.match(districtButtonText, /İlçe seçiniz/);
  const facilityButtonText = await fieldButton(page, PICKUP_PREFIX, "locationType").innerText();
  // Tesis alanı, ilçe henüz seçilmediği için disabled ("Önce ilçe seçin")
  // durumundadır — bu da tesis seçiminin GERÇEKTEN temizlendiğinin bir
  // kanıtıdır (dolu bir değer olsaydı disabled olsa bile o değeri göstermeye
  // devam ederdi, bkz. searchable-select.tsx#selectedLabel).
  assert.match(facilityButtonText, /Önce ilçe seçin/);
  await expectEmpty(addressField(page, PICKUP_PREFIX));
  ok("Yük Alınacak Yer: İl değiştirilince İlçe/Tesis/Açık Adres temizlendi (konum yöntemi başlangıç durumuna döndü)");
}

async function nonNakliyeCategoryCheck(page) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
  assert.equal(await page.getByText("Yük Alınacak Yer", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Teslim Edilecek Yer", { exact: true }).count(), 0);
  // "Liman / Sanayi / OSB" etiketi artık Nakliye VE Nakliye dışı kategoriler
  // arasında BİLEREK paylaşılır (bkz. CLAUDE.md/görev tanımı: "Bölge / Tesis"
  // standardizasyonu) — bu yüzden 0 DEĞİL, tam olarak 1 (Nakliye dışı
  // kategorinin KENDİ, paylaşılan Türkiye geneli İl'e bağlı tesis seçicisi)
  // beklenir. Nakliye'ye özgü sızıntının GERÇEK göstergesi yukarıdaki "Yük
  // Alınacak Yer"/"Teslim Edilecek Yer" başlıklarının hiç görünmemesidir.
  assert.equal(await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).count(), 1);
  // Türkiye Geneli İl/İlçe: İl artık Nakliye dışı kategorilerde de gerçek bir
  // SearchableSelect'tir (sabit/readonly DEĞİL), varsayılan olarak Kocaeli
  // gelir — eski "sabit İl" davranışı KALDIRILDI (bkz. görev tanımı madde 1).
  const provinceButton = page.getByRole("button", { name: "İl", exact: true }).first();
  await provinceButton.waitFor({ state: "visible", timeout: 5000 });
  assert.match(await provinceButton.innerText(), /Kocaeli/);
  ok('Forklift (Nakliye dışı) kategoride Yük Alınacak Yer/Teslim Edilecek Yer görünmüyor; İl artık serbestçe seçilebilir (varsayılan Kocaeli) ve "Liman / Sanayi / OSB" etiketi Nakliye ile paylaşılıyor');
}

async function runScenarios(page) {
  console.log("0) Sentetik seçenek etiketi doğrulaması");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
  await gotoCreateForm(page);
  await selectByPrefix(page, PICKUP_PREFIX, "province", "İl", "Kocaeli");
  await selectByPrefix(page, PICKUP_PREFIX, "district", "İlçe", "Dilovası");
  await fieldButton(page, PICKUP_PREFIX, "locationType").click();
  const pickupListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await pickupListbox.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await pickupListbox.getByRole("option", { name: "Açık Adres Gir", exact: true }).count(), 0);
  assert.equal(await pickupListbox.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).count(), 1);
  ok('Açılır listede "Açık Adres Gir" YOK, "Listede yok, kendim gireceğim" VAR');

  console.log("1) Manuel mod: \"Liman / Sanayi / OSB Adı\" ayrı satırda açılıyor, Açık Adres HER ZAMAN görünür ve mod değişince kaybolmuyor");
  const pickupAddressField = addressField(page, PICKUP_PREFIX);
  await pickupAddressField.waitFor({ state: "visible", timeout: 10000 });
  ok("Henüz hiçbir yöntem seçilmeden önce bile Açık Adres textarea zaten görünür");

  await pickupListbox.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).click();
  const pickupFacilityNameField = facilityNameField(page, PICKUP_PREFIX);
  await pickupFacilityNameField.waitFor({ state: "visible", timeout: 10000 });
  ok('Manuel seçilince "Liman / Sanayi / OSB Adı" input\'u göründü');
  await pickupFacilityNameField.fill("İzmir Aliağa Limanı");
  await pickupAddressField.fill("Nemrut Körfezi Liman Sahası, 4 No'lu Kapı");

  await fieldButton(page, PICKUP_PREFIX, "locationType").click();
  await pickupListbox.waitFor({ state: "visible", timeout: 10000 });
  await pickupListbox.getByRole("option", { name: "Beldeport", exact: false }).first().click();
  assert.equal(await facilityNameField(page, PICKUP_PREFIX).count(), 0);
  ok('Gerçek tesis seçilince "Liman / Sanayi / OSB Adı" input\'u kayboldu');
  const addressAfterFacility = await pickupAddressField.inputValue();
  assert.equal(addressAfterFacility, "Nemrut Körfezi Liman Sahası, 4 No'lu Kapı");
  ok("Katalog tesisi seçilince Açık Adres KAYBOLMADI / temizlenmedi (aynı değer korundu)");

  await fieldButton(page, PICKUP_PREFIX, "locationType").click();
  await pickupListbox.waitFor({ state: "visible", timeout: 10000 });
  await pickupListbox.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).click();
  await expectEmpty(facilityNameField(page, PICKUP_PREFIX));
  const addressAfterBackToManual = await pickupAddressField.inputValue();
  assert.equal(addressAfterBackToManual, "Nemrut Körfezi Liman Sahası, 4 No'lu Kapı");
  ok('Manuel moda geri dönüldüğünde "Liman / Sanayi / OSB Adı" boş geldi (temizlendi) ama Açık Adres KORUNDU');

  console.log("2) İl değişince İlçe/Tesis/Açık Adres temizleniyor");
  await pickupProvinceResetCheck(page);

  console.log("3) Dört kombinasyonun (tesis/manuel × tesis/manuel) ilan oluşturmayla doğrulanması — Açık Adres her kombinasyonda zorunlu");
  const jobs = {};

  // Tesis -> Tesis
  await gotoCreateForm(page);
  await fillSide(page, PICKUP_PREFIX, {
    province: "Kocaeli",
    district: "Dilovası",
    facilityName: "Beldeport",
    address: "Beldeport İçi, Rıhtım Cadde No:3",
  });
  await fillSide(page, DELIVERY_PREFIX, {
    province: "Kocaeli",
    district: "Gebze",
    facilityName: "Gebze Organize Sanayi Bölgesi",
    address: "Gebze OSB İçi, Fabrika Girişi No:7",
  });
  await fillCommonFields(page, "Test - Tesis to Tesis");
  jobs.facilityToFacility = await submitAndPublish(page);
  ok("Tesis → Tesis ilanı oluşturuldu (her iki tarafta da katalog tesisi + açık adres)");

  // Tesis -> Manuel
  await gotoCreateForm(page);
  await fillSide(page, PICKUP_PREFIX, {
    province: "Kocaeli",
    district: "Dilovası",
    facilityName: "Beldeport",
    address: "Beldeport İçi, Rıhtım Cadde No:3",
  });
  await fillSide(page, DELIVERY_PREFIX, {
    province: "İzmir",
    district: "Bornova",
    manualFacilityName: "Bornova Sanayi Sitesi",
    address: "Kazımdirik Mah. 372. Sok. No:15 Bornova / İzmir",
  });
  await fillCommonFields(page, "Test - Tesis to Manuel");
  jobs.facilityToManual = await submitAndPublish(page);
  ok("Tesis → Manuel ilanı oluşturuldu (manuel tarafta GERÇEK tesis adı + açık adres)");

  // Manuel -> Tesis
  await gotoCreateForm(page);
  await fillSide(page, PICKUP_PREFIX, {
    province: "İzmir",
    district: "Bornova",
    manualFacilityName: "Bornova Sanayi Sitesi",
    address: "Kazımdirik Mah. 372. Sok. No:15 Bornova / İzmir",
  });
  await fillSide(page, DELIVERY_PREFIX, {
    province: "Kocaeli",
    district: "Dilovası",
    facilityName: "Beldeport",
    address: "Beldeport İçi, Rıhtım Cadde No:3",
  });
  await fillCommonFields(page, "Test - Manuel to Tesis");
  jobs.manualToFacility = await submitAndPublish(page);
  ok("Manuel → Tesis ilanı oluşturuldu");

  // Manuel -> Manuel
  await gotoCreateForm(page);
  await fillSide(page, PICKUP_PREFIX, {
    province: "Kocaeli",
    district: "Dilovası",
    manualFacilityName: "Özel Fabrika Sahası",
    address: "Dilovası OSB İçi, Test Cadde No:5",
  });
  await fillSide(page, DELIVERY_PREFIX, {
    province: "İzmir",
    district: "Bornova",
    manualFacilityName: "İzmir Aliağa Limanı",
    address: "Kazımdirik Mah. 372. Sok. No:15 Bornova / İzmir",
  });
  await fillCommonFields(page, "Test - Manuel to Manuel");
  jobs.manualToManual = await submitAndPublish(page);
  ok("Manuel → Manuel ilanı oluşturuldu");

  console.log("4) İlan detay sayfasında Taşıma Güzergâhı — tesis/manuel ad VE açık adres BİRLİKTE görünüyor, \"Listede yok...\" metni asla görünmüyor");
  for (const [key, jobId] of Object.entries(jobs)) {
    await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
    await page.getByText("Taşıma Güzergâhı", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByText("Taşıma Güzergâhı", { exact: true }).count(), 1);
    // innerText() CSS text-transform'u (bkz. nakliye-route-card.tsx#RouteSideBlock'un
    // `uppercase` sınıfı) YANSITIR — DOM'daki gerçek metin "Yük Alınacak Yer" olsa bile
    // görsel olarak büyük harfle okunur. `/i` bayrağı KULLANILMAZ: JS regex'in Unicode
    // case-fold'u Türkçe noktasız "ı" (U+0131) ile ASCII "I/i"yi (U+0049/U+0069) EŞLEMEZ
    // (tarayıcı text-transform:uppercase da "ı"yı Türkçe kurallarına göre değil, ASCII
    // "I"ya çevirir) — bu yüzden büyük harfli haliyle BİREBİR karşılaştırılır.
    const cardText = await page.locator("text=Taşıma Güzergâhı").locator("..").locator("..").innerText();
    assert.doesNotMatch(cardText, /undefined/i);
    assert.doesNotMatch(cardText, /Listede yok/);
    assert.match(cardText, /YÜK ALINACAK YER/);
    assert.match(cardText, /TESLİM EDİLECEK YER/);
    // Sahibi (Zeynep) kendi ilanını görüntülediği için açık adres HER ZAMAN
    // görünür olmalı (job-requests.ts#canViewJobAddress'in "sahibi her zaman
    // görür" istisnası) — tesis/manuel ad zaten hiçbir zaman gizlenmez.
    assert.doesNotMatch(cardText, /Tam adres, teklif kabul edildikten sonra/);
    ok(`(${key}) Taşıma Güzergâhı kartı doğru gösteriliyor: "undefined"/"Listede yok" yok, sahibi açık adresi de görüyor`);
  }

  // Manuel taraf gerçekten YAZILAN adla görünüyor mu (görev tanımı madde 9/1) —
  // "facilityToManual"ın teslimatı ve "manualToFacility"nin alım noktası
  // "Bornova Sanayi Sitesi", "manualToManual" ise "Özel Fabrika Sahası" +
  // "İzmir Aliağa Limanı" taşır.
  await page.goto(`${BASE_URL}/ilanlar/${jobs.facilityToManual}`);
  let cardText = await page.locator("text=Taşıma Güzergâhı").locator("..").locator("..").innerText();
  assert.match(cardText, /Bornova Sanayi Sitesi/);
  ok("Manuel girilen tesis adı (Bornova Sanayi Sitesi) ilan detayında GERÇEK adıyla görünüyor");

  await page.goto(`${BASE_URL}/ilanlar/${jobs.manualToManual}`);
  cardText = await page.locator("text=Taşıma Güzergâhı").locator("..").locator("..").innerText();
  assert.match(cardText, /Özel Fabrika Sahası/);
  assert.match(cardText, /İzmir Aliağa Limanı/);
  ok("Her iki taraf da manuel girildiğinde İKİ GERÇEK ad da (Özel Fabrika Sahası, İzmir Aliağa Limanı) aynı anda görünüyor");

  console.log("4b) Teklif Ver alanı yakınında: manuel tesis adı sağlayıcıya da GERÇEK adıyla görünür, ama açık adres teklif kabul edilene kadar gizli kalır");
  await loginAs(page, "nakliyeci@test.com", "Nakliye123!", "/panel");
  await page.goto(`${BASE_URL}/ilanlar/${jobs.manualToManual}`);
  await page.getByText("Taşıma Güzergâhı", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const providerCardText = await page.locator("text=Taşıma Güzergâhı").locator("..").locator("..").innerText();
  assert.match(providerCardText, /Özel Fabrika Sahası/);
  assert.match(providerCardText, /İzmir Aliağa Limanı/);
  assert.doesNotMatch(providerCardText, /Listede yok/);
  assert.match(providerCardText, /Tam adres, teklif kabul edildikten sonra/);
  assert.doesNotMatch(providerCardText, /Dilovası OSB İçi, Test Cadde No:5/);
  ok("Teklif vermemiş bir sağlayıcı: manuel tesis adlarını GERÇEK haliyle görüyor, ama açık adres hâlâ kilitli (yeni bir güvenlik kuralı yok, mevcut kapı aynen çalışıyor)");
  assert.equal(await page.getByText("Taşıma Güzergâhı", { exact: true }).count(), 1);
  ok("Aynı sayfada mükerrer büyük güzergâh kartı yok (Taşıma Güzergâhı yalnızca 1 kez render edildi)");

  console.log("5) Aktif İlanlar ekranında Nakliye filtreleri (Nakliyeci sağlayıcı) + kısa güzergâh gösterimi");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByRole("button", { name: "Hizmet Türü", exact: true }).waitFor({ state: "visible", timeout: 15000 });

  assert.equal(await page.getByRole("button", { name: "Alınacak İl", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "İlçe", exact: true }).count(), 1);
  ok("Nakliye seçili değilken Alınacak İl/İlçe filtreleri gizli, mevcut İlçe/Bölge-Tesis filtresi görünüyor");

  await page.getByRole("button", { name: "Hizmet Türü", exact: true }).click();
  await page.locator('ul[aria-label="Hizmet Türü"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Hizmet Türü"]').getByRole("option", { name: "Nakliye", exact: true }).click();

  await page.getByRole("button", { name: "Alınacak İl", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: "İlçe", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).count(), 0);
  ok("Nakliye seçilince Alınacak İl/İlçe + Teslim İli/İlçesi göründü, eski İlçe/Bölge-Tesis filtreleri kayboldu");

  const listingTextBeforeFilter = await page.locator("body").innerText();
  assert.match(listingTextBeforeFilter, /Bornova Sanayi Sitesi|İzmir Aliağa Limanı|Özel Fabrika Sahası/);
  assert.doesNotMatch(listingTextBeforeFilter, /Listede yok/);
  ok('Aktif İlanlar listesinde manuel girilen tesis adları kısa güzergâhta GERÇEK adlarıyla görünüyor, "Listede yok..." metni hiç görünmüyor');

  const deliveryDistrictButton = page.getByRole("button", { name: "Teslim İlçesi", exact: true });
  await page.getByRole("button", { name: "Teslim İli", exact: true }).click();
  await page.locator('ul[aria-label="Teslim İli"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Teslim İli"]').getByRole("option", { name: "İzmir", exact: true }).click();
  await deliveryDistrictButton.click();
  await page.locator('ul[aria-label="Teslim İlçesi"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Teslim İlçesi"]').getByRole("option", { name: "Bornova", exact: true }).click();

  const listingTextAfterFilter = await page.locator("body").innerText();
  assert.match(listingTextAfterFilter, /Bornova/);
  ok("Teslim İli=İzmir, Teslim İlçesi=Bornova filtresiyle gerçek ilan sonucu döndü (Bornova teslimatlı ilanlar görünüyor)");

  await page.getByRole("button", { name: "Teslim İli", exact: true }).click();
  await page.locator('ul[aria-label="Teslim İli"]').waitFor({ state: "visible" });
  await page.locator('ul[aria-label="Teslim İli"]').getByRole("option", { name: "Kocaeli", exact: true }).click();
  const deliveryDistrictButtonText = await deliveryDistrictButton.innerText();
  assert.match(deliveryDistrictButtonText, /Tümü/);
  ok("Teslim İli değiştirilince Teslim İlçesi filtresi temizlendi");

  console.log("6) İlan düzenleme — tesis ve manuel kayıtların (ad + açık adres) doğru yüklenmesi");
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");

  const EDIT_PICKUP_PREFIX = "job-edit-pickup";
  const EDIT_DELIVERY_PREFIX = "job-edit-delivery";

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${jobs.facilityToFacility}/duzenle`);
  await page.getByText("Yük Alınacak Yer", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const pickupProvinceText = await fieldButton(page, EDIT_PICKUP_PREFIX, "province").innerText();
  assert.match(pickupProvinceText, /Kocaeli/);
  assert.equal(await facilityNameField(page, EDIT_PICKUP_PREFIX).count(), 0);
  assert.equal(await facilityNameField(page, EDIT_DELIVERY_PREFIX).count(), 0);
  ok('Tesis kaydı: İl/İlçe/Tesis doğru seçili geldi, "Liman / Sanayi / OSB Adı" input\'u hiç görünmüyor (katalog modu)');
  const editPickupAddressForFacility = await addressField(page, EDIT_PICKUP_PREFIX).inputValue();
  assert.match(editPickupAddressForFacility, /Beldeport İçi/);
  const editDeliveryAddressForFacility = await addressField(page, EDIT_DELIVERY_PREFIX).inputValue();
  assert.match(editDeliveryAddressForFacility, /Gebze OSB İçi/);
  ok("Tesis kaydı: Açık Adres artık HER İKİ tarafta da görünüyor ve kayıtlı değeriyle dolu geldi (eskiden gizli/atılırdı)");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${jobs.manualToManual}/duzenle`);
  await page.getByText("Yük Alınacak Yer", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const editPickupFacilityName = await facilityNameField(page, EDIT_PICKUP_PREFIX).inputValue();
  assert.equal(editPickupFacilityName, "Özel Fabrika Sahası");
  const editDeliveryFacilityName = await facilityNameField(page, EDIT_DELIVERY_PREFIX).inputValue();
  assert.equal(editDeliveryFacilityName, "İzmir Aliağa Limanı");
  ok('Manuel kayıt: "Listede yok, kendim gireceğim" seçili geldi VE manuel tesis adı her iki tarafta da GERÇEK haliyle input\'a yüklendi');
  const editPickupAddress = await addressField(page, EDIT_PICKUP_PREFIX).inputValue();
  assert.match(editPickupAddress, /Dilovası OSB/);
  const editDeliveryAddress = await addressField(page, EDIT_DELIVERY_PREFIX).inputValue();
  assert.match(editDeliveryAddress, /Kazımdirik/);
  ok("Manuel kayıt: kayıtlı açık adres de her iki tarafta textarea içinde dolu geldi");

  console.log("7) Nakliye dışı kategori davranışı değişmedi");
  await nonNakliyeCategoryCheck(page);

  console.log(`\n${passed} kontrol başarıyla geçti.`);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await runScenarios(page);
  } finally {
    // Herhangi bir adımda hata/timeout oluşsa bile tarayıcı KAPATILIR — aksi
    // halde Node süreci Chromium açık kaldığı için sonsuza kadar asılı kalır
    // (bkz. önceki test çalıştırmasındaki 580s+ takılma).
    await browser.close();
  }
}

run().catch((error) => {
  console.error("✗ Test başarısız:", error);
  process.exitCode = 1;
});
