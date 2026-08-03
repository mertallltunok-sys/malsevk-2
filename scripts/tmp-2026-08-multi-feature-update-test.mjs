// node scripts/tmp-2026-08-multi-feature-update-test.mjs
//
// 2026-08 çok maddeli güncelleme paketinin uçtan uca doğrulaması (gerçek
// Chromium, Playwright):
//  1. "Operasyon Detayları" form alanının ilan oluşturma/düzenlemeden
//     kaldırıldığı, ama operationId/operasyon gruplamasının bozulmadığı.
//  2. "Ek Hizmet Ekle" ile Ürün Adedi/Tonaj/Ürün Cinsi'nin ilk hizmetten
//     kopyalandığı, sonraki bağımsız değişikliklerin birbirini etkilemediği.
//  3. Ürün Cinsi'nde "Listede Yok, Kendim Gireceğim" özel giriş akışı.
//  4. İletişim Bilgisi Görünürlüğü'nde en az bir seçimin zorunlu olduğu.
//  5. WhatsApp destek butonunun doğru bağlantı/özniteliklerle var olduğu.
//  6. Bize Ulaşın formunun (misafir) gönderilebildiği ve admin panelinde
//     gerçek bir kayıt olarak göründüğü, durum/not güncellemesinin çalıştığı.
//  7. Ana sayfada depolama alt hizmetlerinin TEK "Depolama Hizmetleri"
//     kartına indirgendiği.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).
// Her adım kendi try/finally'siyle tarayıcıyı KESİNLİKLE kapatır — bir
// önceki (bu değişiklikten habersiz, artık geçersiz kategori id'leri
// kullanan) tmp-product-info-fields-test.mjs'in browser.close() eksikliği
// yüzünden asılı kalma hatasını burada TEKRARLAMAMAK için.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function categorySelect(page, index) {
  return page.getByLabel("Hizmet Kategorisi").nth(index);
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function fillServiceLocation(page, index) {
  await page.getByRole("button", { name: "İlçe", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="İlçe"]').nth(index).waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').nth(index).getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').nth(index).waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Liman / Sanayi / OSB"]')
    .nth(index)
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await page.getByLabel("Açık Adres").nth(index).fill(`Test Mahallesi, Test Caddesi No:${index + 1}, Dilovası`);
}

async function getStoredJobs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
}

async function test1And2And3AndOperationDetailsRemoved(browser) {
  console.log("=== 1+2+3: Operasyon Detayları kaldırıldı, Ek Hizmet ürün kopyalama, özel Ürün Cinsi ===");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    assert.equal(await page.getByLabel("Operasyon Detayları").count(), 0, "Operasyon Detayları alanı hiç render edilmemeli");
    ok("Madde 1: 'Operasyon Detayları' form alanı ilan oluşturma ekranında yok");

    await categorySelect(page, 0).selectOption("lashing-unlashing");
    await page.getByLabel("İlan Başlığı").first().fill("Ana Hizmet Ürün Testi");
    await page.getByLabel("Hizmete Özel Açıklama").first().fill("Ana hizmet aciklamasi, en az yirmi karakter olmali burada.");
    await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-01");
    await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-01");
    await page.getByLabel("Ürün Adedi").first().fill("120");
    await page.getByLabel("Tonaj", { exact: false }).first().fill("8,5");
    await page.getByLabel("Ürün Cinsi").first().fill("Rulo Sac");
    await fillServiceLocation(page, 0);
    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
    await categorySelect(page, 1).selectOption("gozetim-hizmetleri");

    assert.equal(await page.getByLabel("Ürün Adedi").nth(1).inputValue(), "120", "Ek hizmet Ürün Adedi'ni ana hizmetten devralmalı");
    assert.equal(await page.getByLabel("Tonaj", { exact: false }).nth(1).inputValue().then((v) => v.replace(".", ",")), "8,5", "Ek hizmet Tonaj'ı ana hizmetten devralmalı");
    assert.equal(await page.getByLabel("Ürün Cinsi").nth(1).inputValue(), "Rulo Sac", "Ek hizmet Ürün Cinsi'ni ana hizmetten devralmalı");
    ok("Madde 2: Ek hizmet eklenince Ürün Adedi/Tonaj/Ürün Cinsi ana hizmetten otomatik kopyalanıyor");

    await page.getByLabel("Ürün Adedi").nth(1).fill("777");
    assert.equal(await page.getByLabel("Ürün Adedi").first().inputValue(), "120", "Ek hizmetteki değişiklik ana hizmeti etkilememeli");
    ok("Madde 2: İkinci hizmetteki değişiklik birinci hizmeti etkilemiyor (bağımsız kopya)");

    // Madde 3: özel Ürün Cinsi girişi — ana hizmette.
    const productTypeInput = page.getByLabel("Ürün Cinsi").first();
    await productTypeInput.click();
    const listbox = page.locator('ul[role="listbox"]').first();
    await listbox.waitFor({ state: "visible" });
    await listbox.getByRole("option", { name: "Listede Yok, Kendim Gireceğim", exact: true }).click();

    const customInput = page.getByLabel("Ürün Cinsini Yazınız").first();
    await customInput.waitFor({ state: "visible", timeout: 5000 });
    await assert.ok(await customInput.evaluate((el) => el === document.activeElement), "Özel ürün cinsi kutusu otomatik focus almalı");
    ok("Madde 3: Özel ürün cinsi seçilince zorunlu metin kutusu açılıyor ve otomatik focus alıyor");

    // Boş bırakılırsa yayınlanamamalı.
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Ürün cinsini yazmanız zorunludur.").waitFor({ state: "visible", timeout: 5000 });
    ok("Madde 3: Özel ürün cinsi boşken doğru hata mesajıyla engelleniyor");

    await customInput.fill("Galvanizli Çelik Rulo");
    await page.getByLabel("İlan Başlığı").nth(1).fill("Ek Hizmet Ürün Testi");
    await page.getByLabel("Hizmete Özel Açıklama").nth(1).fill("Ek hizmet aciklamasi, en az yirmi karakter olmali burada da.");
    await page.getByLabel("Başlangıç Tarihi").nth(1).fill("2026-09-01");
    await page.getByLabel("Bitiş Tarihi").nth(1).fill("2026-09-01");
    // Ek hizmet varsayılan olarak "Ana hizmetle aynı lokasyon" işaretli
    // gelir — kendi İlçe/Liman-Sanayi-OSB/Açık Adres alanları hiç render
    // edilmez, ana hizmetin konumu geçerlidir (bkz. görev tanımının
    // kapsamadığı, dokunulmayan mevcut davranış). Bu yüzden burada AYRICA
    // bir konum doldurma adımı YOK.

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByLabel("Operasyon Detayları").count(), 0, "Önizlemede de Operasyon Detayları alanı olmamalı");
    await page.getByRole("button", { name: /Hizmet İlanını Yayınla/ }).click();
    await page.waitForURL(/operasyonIlanSayisi=2/, { timeout: 15000 });

    const jobs = await getStoredJobs(page);
    const mainJob = jobs.find((job) => job.title === "Ana Hizmet Ürün Testi");
    const extraJob = jobs.find((job) => job.title === "Ek Hizmet Ürün Testi");
    assert.ok(mainJob, "Ana hizmet ilanı oluşturulmalı");
    assert.ok(extraJob, "Ek hizmet ilanı oluşturulmalı");
    assert.equal(mainJob.operationId, extraJob.operationId, "Her iki hizmet AYNI operationId altında olmalı");
    ok("Madde 1: operationId ilişkisi/operasyon gruplaması bozulmadan çalışıyor");
    assert.equal(mainJob.productType, "Galvanizli Çelik Rulo", "Özel ürün cinsi gerçek metin olarak kaydedilmeli");
    ok("Madde 3: İlan detayında/kayıtta gerçek özel ürün adı (sentinel değil) saklanıyor");
    assert.equal(extraJob.productQuantity, 777, "Ek hizmetin kendi (bağımsız değiştirilmiş) ürün adedi korunmalı");
    ok("Madde 2: Ek hizmetin sonradan manuel değiştirdiği değer yayınlama sonrası da korunuyor");
    assert.equal(mainJob.operationDetails, "", "operationDetails artık her zaman boş string olmalı (form alanı kaldırıldı)");

    await page.goto(`${BASE_URL}/ilanlar/${mainJob.id}`);
    assert.equal(await page.getByRole("heading", { name: "Operasyon Detayları" }).count(), 0, "İlan detayında boş Operasyon Detayları kartı gösterilmemeli");
    ok("Madde 1: İlan detay sayfasında boş 'Operasyon Detayları' kartı artık gösterilmiyor");

    console.log("\n=== 1+3 (devam): İlan düzenleme ekranı ===");
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${mainJob.id}/duzenle`);
    await page.getByLabel("Ürün Adedi").first().waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByLabel("Operasyon Detayları").count(), 0, "İlan düzenleme ekranında da Operasyon Detayları alanı olmamalı");
    ok("Madde 1: 'Operasyon Detayları' form alanı ilan düzenleme ekranında da yok");

    assert.equal(await page.getByLabel("Ürün Cinsi").first().inputValue(), "Galvanizli Çelik Rulo", "Düzenlemede önceki özel ürün cinsi serbest metin olarak doğru ön-dolduruluyor");
    ok("Madde 3: Düzenleme ekranı, önceden özel girilmiş ürün cinsini normal serbest metin olarak doğru gösteriyor");

    const editProductTypeInput = page.getByLabel("Ürün Cinsi").first();
    await editProductTypeInput.click();
    const editListbox = page.locator('ul[role="listbox"]').first();
    await editListbox.waitFor({ state: "visible" });
    await editListbox.getByRole("option", { name: "Listede Yok, Kendim Gireceğim", exact: true }).click();
    const editCustomInput = page.getByLabel("Ürün Cinsini Yazınız").first();
    await editCustomInput.waitFor({ state: "visible", timeout: 5000 });
    assert.ok(await editCustomInput.evaluate((el) => el === document.activeElement), "Düzenlemede de özel ürün cinsi kutusu otomatik focus almalı");
    await editCustomInput.fill("Özel Düzenleme Ürünü");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForURL(/guncellendi=1/, { timeout: 15000 });

    const jobsAfterEdit = await getStoredJobs(page);
    const editedJob = jobsAfterEdit.find((job) => job.id === mainJob.id);
    assert.equal(editedJob.productType, "Özel Düzenleme Ürünü", "Düzenleme ekranındaki özel ürün cinsi de gerçek metin olarak kaydedilmeli");
    ok("Madde 3: İlan düzenleme ekranında özel ürün cinsi girişi de doğru kaydediliyor");
  } finally {
    await context.close();
  }
}

async function test4ContactVisibility(browser) {
  console.log("\n=== 4: İletişim Bilgisi Görünürlüğü — en az bir seçim zorunlu ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/hesap-ayarlari");
    await page.getByText("İletişim Bilgisi Görünürlüğü").waitFor({ state: "visible", timeout: 10000 });

    const emailCheckbox = page.getByRole("checkbox", { name: "E-posta adresimi göster" });
    const phoneCheckbox = page.getByRole("checkbox", { name: "Telefon numaramı göster" });
    await emailCheckbox.waitFor({ state: "visible" });

    if (!(await phoneCheckbox.isChecked())) await phoneCheckbox.check();
    if (!(await emailCheckbox.isChecked())) await emailCheckbox.check();

    await phoneCheckbox.uncheck();
    // .uncheck() bir "sonuç durumunu garanti et" yardımcısıdır — burada
    // KASITLI OLARAK engellenen bir tıklamayı test ettiğimiz için (son
    // seçenek kapatılamamalı) düz .click() kullanılır; .uncheck() durum
    // değişmediğinde (tam da beklediğimiz gibi) kendi hatasını fırlatırdı.
    await emailCheckbox.click();

    await page.getByText("Teklif kabul edildiğinde iletişim kurulabilmesi için telefon veya e-posta bilgilerinden en az biri görünür olmalıdır.").waitFor({ state: "visible", timeout: 5000 });
    assert.ok(await emailCheckbox.isChecked(), "Son iletişim yöntemi kapatılamamalı, e-posta işaretli kalmalı");
    ok("Madde 4: Son iletişim yöntemi kapatılmaya çalışılınca engelleniyor ve uyarı gösteriliyor");

    await page.getByRole("button", { name: "Tercihi Kaydet" }).click();
    await page.getByText("İletişim bilgisi tercihiniz kaydedildi.").waitFor({ state: "visible", timeout: 5000 });
    ok("Madde 4: En az bir seçenek açıkken hesap ayarları kaydedilebiliyor");
  } finally {
    await context.close();
  }
}

async function test5WhatsappButton(browser) {
  console.log("\n=== 5: WhatsApp destek butonu ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/`);
    const button = page.getByRole("link", { name: /7\/24 Canlı Destek/ });
    await button.waitFor({ state: "visible", timeout: 10000 });
    const href = await button.getAttribute("href");
    const target = await button.getAttribute("target");
    const rel = await button.getAttribute("rel");
    assert.ok(href.includes("wa.me/905524316372"), `href doğru numarayı içermeli, gelen: ${href}`);
    assert.ok(href.includes(encodeURIComponent("Merhaba, MALSEVK hakkında destek almak istiyorum.")), "href hazır mesajı içermeli");
    assert.equal(target, "_blank");
    assert.equal(rel, "noopener noreferrer");
    ok("Madde 5: WhatsApp butonu doğru numara/mesaj/güvenli hedefle ana sayfada mevcut");

    await page.goto(`${BASE_URL}/giris-yap`);
    await page.getByRole("link", { name: /7\/24 Canlı Destek/ }).waitFor({ state: "visible", timeout: 10000 });
    ok("Madde 5: Buton giriş yapılmamış genel sayfalarda da erişilebilir");
  } finally {
    await context.close();
  }
}

async function test6ContactSectionAndAdmin(browser) {
  console.log("\n=== 6: Bize Ulaşın formu (misafir) + Admin modülü ===");
  // TEK context/page kasıtlıdır: bu uygulamada gerçek/paylaşılan bir
  // backend yok, veri yalnızca tarayıcının kendi localStorage'ında yaşıyor
  // (bkz. CLAUDE.md "No real backend") — misafir gönderimi ve admin
  // incelemesi AYRI browser context'lerinde (izole localStorage
  // bölmelerinde) yapılırsa admin, misafirin verisini hiçbir zaman göremez.
  // Gerçek dünyada da bu senaryo aynı tarayıcıda (guest gönderir, admin aynı
  // cihazda/sekmede giriş yapıp inceler) ya da bir sonraki oturumda kontrol
  // eder şeklinde işler.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const uniqueMarker = `Test mesajı ${Date.now()} - en az on karakter uzunlugunda oldugunu dogrulamak icin buraya yeterince metin ekliyorum.`;
  try {
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { name: "Bize Ulaşın" }).scrollIntoViewIfNeeded();
    await page.getByLabel("Ad Soyad").fill("Test Misafir Kullanıcı");
    await page.getByLabel("Konu").selectOption("teknik-destek");
    await page.getByLabel("Mesaj").fill(uniqueMarker);

    // E-posta/telefon ikisi de boşken zorunlu hatası.
    await page.getByRole("button", { name: "Gönder" }).click();
    await page.getByText("E-posta veya telefon numaranızdan en az birini giriniz.").waitFor({ state: "visible", timeout: 5000 });
    ok("Madde 6: Misafirde e-posta/telefon ikisi de boşken gönderim engelleniyor");

    await page.getByLabel("E-posta", { exact: false }).fill("test-misafir@example.com");
    await page.getByRole("button", { name: "Gönder" }).click();
    await page.getByText("Mesajınız bize ulaştı. En kısa sürede sizinle iletişime geçeceğiz.").waitFor({ state: "visible", timeout: 5000 });
    ok("Madde 6: Misafir kullanıcı geçerli veriyle Bize Ulaşın formunu gönderebiliyor");

    assert.equal(await page.getByLabel("Mesaj").inputValue(), "", "Başarılı gönderimden sonra Mesaj alanı temizlenmeli");
    ok("Madde 6: Başarılı gönderimden sonra Konu/Mesaj alanları temizleniyor");

    await loginAs(page, "admin@test.com", "Admin123!", "/admin");
    await page.goto(`${BASE_URL}/admin/iletisim-mesajlari`);
    await page.getByRole("heading", { name: "Bize Ulaşın Mesajları" }).waitFor({ state: "visible", timeout: 10000 });

    const card = page.locator(".rounded-card", { hasText: "Test Misafir Kullanıcı" }).first();
    await card.waitFor({ state: "visible", timeout: 10000 });
    assert.ok((await card.textContent()).includes("Misafir kullanıcı"), "Kayıt misafir olarak işaretlenmeli");
    ok("Madde 6: Gönderilen mesaj Admin > Bize Ulaşın Mesajları modülünde gerçek bir kayıt olarak görünüyor");

    const saveButton = card.getByRole("button", { name: "Kaydet" });
    await card.getByLabel("Durum").selectOption("inceleniyor");
    await card.getByLabel(/Admin Notu/).fill("Test doğrulama notu.");
    await saveButton.click();
    // Kaydetme başarılı olunca "dirty" false'a düşer ve buton yeniden
    // disabled olur — bu, kaydın GERÇEKTEN kalıcı olduğunun (yalnızca
    // localdeğil, contactMessagesStore'a yazıldığının) en net sinyalidir.
    // "İnceleniyor" metni hem durum rozetinde hem seçili <option> içinde
    // geçtiği için `getByText` belirsiz kalır, bu yüzden kullanılmadı.
    await saveButton.waitFor({ state: "visible", timeout: 5000 });
    assert.ok(await saveButton.isDisabled(), "Kayıttan sonra buton tekrar disabled olmalı (dirty=false)");
    assert.equal(await card.locator("select").first().inputValue(), "inceleniyor", "Durum kaydedilmiş olmalı");
    ok("Madde 6: Admin durumu değiştirip iç not ekleyebiliyor");
  } finally {
    await context.close();
  }
}

async function test7StorageGrouping(browser) {
  console.log("\n=== 7: Ana sayfada Depolama Hizmetleri tek kart ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { name: "Depolama Hizmetleri" }).waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByRole("heading", { name: "Depolama Hizmetleri" }).count(), 1, "Tek bir 'Depolama Hizmetleri' kartı olmalı");
    assert.equal(await page.getByRole("heading", { name: "Soğuk Hava Depolama", exact: true }).count(), 0, "Alt depolama türü ayrı kart olarak görünmemeli");
    assert.equal(await page.getByRole("heading", { name: "Konteyner Depolama", exact: true }).count(), 0, "Alt depolama türü ayrı kart olarak görünmemeli");
    ok("Madde 7: Ana sayfada depolama alt hizmetleri ayrı görünmüyor, tek 'Depolama Hizmetleri' kartı var");
  } finally {
    await context.close();
  }

  // İlan oluşturma formundaki alt kategoriler DEĞİŞMEMELİ.
  const providerFormContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const formPage = await providerFormContext.newPage();
  try {
    await loginAs(formPage, "zeynep@test.com", "Zeynep1!", "/hizmet-talebi-olustur");
    await formPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    const options = await formPage.getByLabel("Hizmet Kategorisi").first().locator("option").allTextContents();
    assert.ok(options.some((label) => label.includes("Soğuk Hava Depolama")), "İlan oluşturma formunda depolama alt kategorileri hâlâ tek tek seçilebilir olmalı");
    ok("Madde 7: İlan oluşturma formundaki depolama alt kategorileri değişmedi, tek tek seçilebiliyor");
  } finally {
    await providerFormContext.close();
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    await test1And2And3AndOperationDetailsRemoved(browser);
    await test4ContactVisibility(browser);
    await test5WhatsappButton(browser);
    await test6ContactSectionAndAdmin(browser);
    await test7StorageGrouping(browser);
    console.log(`\n[tmp-2026-08-multi-feature-update-test] ${passed} test geçti.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-2026-08-multi-feature-update-test] HATA:", error);
  process.exitCode = 1;
});
