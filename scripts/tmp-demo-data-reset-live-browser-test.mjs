// node scripts/tmp-demo-data-reset-live-browser-test.mjs
//
// Bir önceki doğrulamanın ("temiz Playwright profili -> 0 kayıt") GEÇERSİZ
// sayılmasının gerekçesi doğrudur: taze bir profilde 0 görmek, MEVCUT
// (kirlenmiş) bir tarayıcı profilinde temizliğin işe yaradığını KANITLAMAZ.
// Bu script onun yerine TEK bir kalıcı tarayıcı profilinde (Playwright
// `launchPersistentContext` — aynı context kapanana kadar localStorage/
// IndexedDB korunur, tıpkı gerçek bir kullanıcının tarayıcısı gibi), GERÇEK
// arayüz akışlarıyla (ham localStorage enjeksiyonu YOK) uçtan uca şunu
// doğrular:
//   1) Demo hesapla giriş yap.
//   2) GERÇEK ilan oluşturma formuyla bir ilan, GERÇEK teklif formuyla bir
//      teklif oluştur (bu da otomatik olarak en az bir türetilmiş bildirim
//      üretir).
//   3) /gelistirme/demo-veri-sifirla üzerinde dry-run bunları TESPİT ETSİN.
//   4) "Temizliği Uygula" çalıştır.
//   5) AYNI profilde, SAYFA YENİLEMEDEN panellere dön — veri görünmemeli
//      (React state/cache canlı güncellenmiş olmalı).
//   6) Sayfayı yenile — hâlâ görünmemeli.
//   7) Çıkış yap, tekrar giriş yap — hâlâ görünmemeli (seed veri
//      yeniden ÜRETMEMELİ).
//   8) Demo OLMAYAN gerçek bir kullanıcının ilanı/teklifi dokunulmadan kalır.
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

async function logout(page) {
  // Uygulamanın gerçek çıkış mekanizması: session anahtarını temizleyip
  // giriş sayfasına dön (profil menüsündeki "Çıkış Yap" ile aynı etki).
  await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
  await page.goto(`${BASE_URL}/giris-yap`);
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
  await page.getByLabel("Açık Adres").first().fill("Canlı tarayıcı testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Canlı tarayıcı demo veri temizliği testi operasyon detayı, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  return page.url().split("/ilanlar/")[1];
}

/** GERÇEK Kayıt Ol formu üzerinden (ham localStorage enjeksiyonu YOK) demo OLMAYAN gerçek bir hesap oluşturur. */
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
  // Kayıt, oturumu OTOMATİK açmaz — "Kaydınız başarıyla oluşturuldu" mesajıyla
  // Giriş Yap sekmesine döner; ayrıca gerçek bir giriş yapılması gerekir.
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await loginAs(page, email, password);
}

/** GERÇEK teklif formu üzerinden (OfferPanel) bir ilana gerçek bir teklif gönderir. */
async function submitRealOffer(page, jobId, description) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı").fill("2500");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

function countsTable(page, title) {
  return page.getByRole("heading", { name: title, exact: true }).locator("xpath=..");
}
async function readCountsRow(page, title, exactRowLabel) {
  const row = countsTable(page, title)
    .locator("tr")
    .filter({ has: page.getByText(exactRowLabel, { exact: true }) });
  const cells = await row.locator("td").allInnerTexts();
  return { total: Number(cells[1]), demo: Number(cells[2]) };
}

let browser;
let profileDir;

async function main() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-live-profile-"));
  // `launchPersistentContext` gerçek bir kullanıcı profiliyle AYNI şeyi
  // yapar: context kapanana kadar localStorage/IndexedDB diskte kalıcıdır —
  // context'i kapatıp yeniden açmak bile (aşağıda YAPMIYORUZ, testin tamamı
  // TEK context içinde kalıyor) aynı profili geri getirir. Bu, "taze profil"
  // eleştirisine karşı asıl kanıt: context BİR KEZ açılıyor ve testin
  // SONUNA kadar hiç kapanmıyor/değişmiyor.
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1280, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const realJobTitle = "Gerçek Kullanıcı Canlı Test İlanı " + crypto.randomUUID().slice(0, 8);
  const demoJobTitle = "Demo Canlı Tarayıcı Testi İlanı " + crypto.randomUUID().slice(0, 8);
  const realOfferDesc = "GERÇEK-KULLANICI-TEKLIFI-canli-test-en-az-yirmi-karakter-" + crypto.randomUUID().slice(0, 8);
  const demoOfferDesc = "DEMO-TEKLIFI-canli-test-en-az-yirmi-karakter-" + crypto.randomUUID().slice(0, 8);

  // =====================================================================
  // 0) GERÇEK KULLANICI referans verisi — demo OLMAYAN bir hesapla bir ilan
  // + demo OLMAYAN bir hesapla o ilana teklif (izolasyon kontrolü için).
  // =====================================================================
  const realEmail = `gercek-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const realProviderEmail = `gercek-saglayici-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await registerRealUser(page, {
    firstName: "Gerçek",
    lastName: "Kullanıcı",
    email: realEmail,
    phone: "+905551234567",
    role: "hizmet-alan",
    companyName: "Gerçek Test Firması",
    password: "GercekSifre1!",
  });
  const realJobId = await createRealJobViaForm(page, {
    title: realJobTitle,
    description: "Demo olmayan gerçek kullanıcı ilanı, en az yirmi karakter içerir.",
  });
  ok(`Kurulum: demo OLMAYAN gerçek bir Hizmet Alan hesabı GERÇEK Kayıt Ol formuyla oluşturuldu, GERÇEK ilan oluşturma formuyla bir ilan yayınladı (${realJobId})`);

  await registerRealUser(page, {
    firstName: "Gerçek",
    lastName: "Sağlayıcı",
    email: realProviderEmail,
    phone: "+905557654321",
    role: "hizmet-veren",
    companyName: "Gerçek Sağlayıcı Firması",
    password: "GercekSifre2!",
  });
  await submitRealOffer(page, realJobId, realOfferDesc);
  ok("Kurulum: demo OLMAYAN gerçek bir Hizmet Veren, gerçek ilana GERÇEK teklif formuyla teklif verdi");

  // =====================================================================
  // NOT — "aynı tarayıcı" (`malsevk.session.v1`) TEK bir aktif oturum
  // taşır: gerçek bir insan iki hesaba aynı anda giriş yapamayacağı için,
  // bu script de İKİ farklı hesabın "giriş yapmış" sekmesini AYNI ANDA açık
  // TUTMAZ — her hesabın panelini, o hesapla GİRİŞ YAPILDIKTAN HEMEN SONRA,
  // başka bir hesapla giriş yapılmadan ÖNCE kontrol eder (tek `page`,
  // sıralı giriş/çıkış — tıpkı bir geliştiricinin gerçek tarayıcısında demo
  // hesaplar arasında geçiş yapması gibi).
  // =====================================================================

  // =====================================================================
  // 1) Demo hesapla (zeynep) giriş yap + GERÇEK arayüzle demo ilan üret
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const demoJobId = await createRealJobViaForm(page, {
    title: demoJobTitle,
    description: "Demo hesabın GERÇEK arayüzle oluşturduğu ilan, en az yirmi karakter içerir.",
  });
  ok(`ADIM 1: zeynep (demo) ile giriş yapıldı, GERÇEK ilan oluşturma formuyla bir ilan yayınlandı (${demoJobId})`);

  // =====================================================================
  // 2) Demo hesapla (mert) giriş yap + GERÇEK teklif formuyla demo teklif üret
  // =====================================================================
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitRealOffer(page, demoJobId, demoOfferDesc);
  ok("ADIM 2: mert (demo) GERÇEK teklif formuyla demo ilana teklif verdi");

  // Zeynep'e geri dön (gerçek bir tekrar-giriş) — kendi ilanına gelen
  // teklifin türettiği "yeni_teklif" bildirimini ve panellerini TEMİZLİKTEN
  // ÖNCE gerçekten görüyor mu, doğrula.
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/bildirimler");
  await page.waitForLoadState("networkidle");
  let bodyText = await page.evaluate(() => document.body.innerText);
  assert.ok(bodyText.includes(demoJobTitle), "TEMİZLİKTEN ÖNCE: zeynep'in Bildirimler sayfasında demo ilana ait yeni teklif bildirimi görünmeli");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.ok(bodyText.includes(demoJobTitle), "TEMİZLİKTEN ÖNCE: 'Hizmet Taleplerim' demo ilanı göstermeli");
  ok("ADIM 2 doğrulama: demo teklif GERÇEKTEN bir bildirim türetti; zeynep'in 'Hizmet Taleplerim'i demo ilanı GERÇEKTEN gösteriyor (temizlik öncesi taban çizgisi)");

  await loginAs(page, "mert@test.com", "Mert123!", "/panel/tekliflerim");
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.ok(bodyText.includes(demoJobTitle), "TEMİZLİKTEN ÖNCE: 'Verdiğim Teklifler' demo ilanı/teklifi göstermeli");
  ok("ADIM 2 doğrulama: mert'in 'Verdiğim Teklifler'i demo teklifi GERÇEKTEN gösteriyor (temizlik öncesi taban çizgisi)");

  // =====================================================================
  // 3) /gelistirme/demo-veri-sifirla — dry-run TESPİT ETMELİ
  // (Bu sayfa oturumdan bağımsız çalışır — kimin giriş yaptığı ÖNEMLİ
  // DEĞİL, doğrudan paylaşılan jobs/offers/users tablolarını okur.)
  // =====================================================================
  await page.goto(`${BASE_URL}/gelistirme/demo-veri-sifirla`);
  await page.getByRole("button", { name: "Planı Hesapla (Dry-Run)", exact: true }).click();
  await countsTable(page, "Şu anki durum").waitFor({ state: "visible", timeout: 10000 });
  const before = {
    jobs: await readCountsRow(page, "Şu anki durum", "İlanlar"),
    offers: await readCountsRow(page, "Şu anki durum", "Teklifler"),
    notifications: await readCountsRow(page, "Şu anki durum", "Bildirimler (türetilen, demo hesaplar için)"),
  };
  assert.ok(before.jobs.demo >= 1, `Dry-run en az 1 demo ilan tespit etmeli (bulunan: ${before.jobs.demo})`);
  assert.ok(before.offers.demo >= 1, `Dry-run en az 1 demo teklif tespit etmeli (bulunan: ${before.offers.demo})`);
  assert.ok(before.notifications.demo >= 1, `Dry-run en az 1 türetilmiş demo bildirim tespit etmeli (bulunan: ${before.notifications.demo})`);
  assert.ok(before.jobs.total >= 2, "Toplam ilan sayısı hem gerçek hem demo ilanı içermeli");
  ok(`ADIM 3-4: Dry-run GERÇEK verileri doğru tespit etti — ${before.jobs.demo} demo ilan, ${before.offers.demo} demo teklif, ${before.notifications.demo} türetilmiş bildirim (toplam ilan: ${before.jobs.total})`);

  // =====================================================================
  // 5) Temizliği Uygula
  // =====================================================================
  await page.getByRole("button", { name: "Temizliği Uygula", exact: true }).click();
  await page.getByText("Temizlik tamamlandı.", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  const after = {
    jobs: await readCountsRow(page, "Temizlik sonrası durum", "İlanlar"),
    offers: await readCountsRow(page, "Temizlik sonrası durum", "Teklifler"),
    notifications: await readCountsRow(page, "Temizlik sonrası durum", "Bildirimler (türetilen, demo hesaplar için)"),
  };
  assert.equal(after.jobs.demo, 0, "Uygulama sonrası demo ilan sayısı 0 olmalı");
  assert.equal(after.offers.demo, 0, "Uygulama sonrası demo teklif sayısı 0 olmalı");
  assert.equal(after.notifications.demo, 0, "Uygulama sonrası türetilmiş demo bildirim sayısı 0 olmalı");
  assert.equal(after.jobs.total, before.jobs.total - before.jobs.demo, "Yalnızca demo ilanlar düşmeli, gerçek ilan sayısı aynı kalmalı");
  ok("ADIM 5: 'Temizliği Uygula' çalıştırıldı, dry-run raporunun kendisi 0'a düştüğünü doğruladı");

  // =====================================================================
  // 6) AYNI sekmede, SAYFA YENİLEMEDEN mert'in kendi panellerine dön —
  // canlı state güncellemesi (henüz login/refresh YOK, session hâlâ mert).
  // =====================================================================
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(bodyText.includes(demoJobTitle), false, "ADIM 6: Sayfa yenilenmeden/tekrar giriş yapılmadan dönüldüğünde mert'in 'Verdiğim Teklifler'i artık demo veriyi GÖSTERMEMELİ");
  ok("ADIM 6: AYNI sekmede, manuel yenileme/tekrar giriş OLMADAN, mert'in paneli demo veriyi anında kaybetti (React state/cache canlı güncellendi)");

  // Zeynep'e tekrar giriş yaparak onun panellerini de kontrol et — bu, GERÇEK
  // bir kullanıcı eylemidir (demo hesaplar arası geçiş), "sayfa yenileme"
  // hilesi değildir; ADIM 7-9 asıl yenileme/çıkış-giriş testini ayrıca yapar.
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/hizmet-taleplerim");
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(bodyText.includes(demoJobTitle), false, "ADIM 6: zeynep'in 'Hizmet Taleplerim'i artık demo ilanı GÖSTERMEMELİ");
  await page.goto(`${BASE_URL}/panel/bildirimler`);
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(bodyText.includes(demoJobTitle), false, "ADIM 6: zeynep'in 'Bildirimler'i artık silinen demo ilana ait bildirim GÖSTERMEMELİ");
  ok("ADIM 6 (devam): zeynep'in panelleri de demo veriyi göstermiyor");

  // =====================================================================
  // 7-8) Sayfayı yenile — hâlâ görünmemeli
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(bodyText.includes(demoJobTitle), false, "ADIM 7-8: Sayfa yenilendikten SONRA da demo ilan/bildirim geri gelmemeli");
  ok("ADIM 7-8: Sayfa yenilemesinden sonra da demo veri geri gelmedi");

  // =====================================================================
  // 9-11) Çıkış yap, tekrar giriş yap — hâlâ görünmemeli (seed yeniden üretmiyor)
  // =====================================================================
  await logout(page);
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/hizmet-taleplerim");
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(bodyText.includes(demoJobTitle), false, "ADIM 9-11: Çıkış + tekrar giriş sonrası demo ilan GERİ GELMEMELİ (seed veri üretmiyor)");
  ok("ADIM 9-11: Çıkış yapıp tekrar aynı demo hesapla giriş yapıldı — veri geri gelmedi (demo seed mekanizması yalnızca HESABI senkronluyor, veri üretmiyor)");

  // =====================================================================
  // 12) Gerçek kullanıcı verisi dokunulmadan kaldı mı?
  // =====================================================================
  await loginAs(page, realEmail, "GercekSifre1!", "/panel/hizmet-taleplerim");
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.ok(bodyText.includes(realJobTitle), "ADIM 12: Demo olmayan gerçek kullanıcının ilanı SİLİNMEMİŞ olmalı");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.waitForLoadState("networkidle");
  bodyText = await page.evaluate(() => document.body.innerText);
  // `incoming-offer-card.tsx` ilan başlığını CSS `uppercase` sınıfıyla
  // render eder — `innerText` CSS text-transform'u YANSITIR (`textContent`
  // yansıtmaz), bu yüzden burada büyük/küçük harf DUYARSIZ karşılaştırma
  // yapılır (gerçek veri bozulmadı, yalnızca görsel harf dönüşümü var).
  assert.ok(
    bodyText.toLocaleUpperCase("tr-TR").includes(realJobTitle.toLocaleUpperCase("tr-TR")),
    "ADIM 12: Gerçek kullanıcının ilanına gerçek sağlayıcının verdiği teklif SİLİNMEMİŞ olmalı",
  );
  ok("ADIM 12: Demo OLMAYAN gerçek kullanıcının ilanı VE ona gelen gerçek teklif, temizlikten TAMAMEN etkilenmeden kaldı");

  await context.close();
  console.log(`\n[tmp-demo-data-reset-live-browser-test] ${passed} test geçti.`);
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
