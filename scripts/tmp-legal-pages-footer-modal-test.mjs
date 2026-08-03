// node scripts/tmp-legal-pages-footer-modal-test.mjs
//
// "Footer > Yasal" bölümünün tamamen aktifleştirilmesini (Gizlilik
// Politikası/Kullanım Koşulları/KVKK Aydınlatma Metni), ortak modal
// bileşenini (legal-document-modal.tsx), üç bağımsız sayfayı (app/gizlilik-
// politikasi vb.) ve kayıt formundaki TEK birleşik onay kutusu + satır içi
// tıklanabilir başlıklar entegrasyonunu GERÇEK arayüz akışlarıyla (ham
// localStorage enjeksiyonu YOK) uçtan uca doğrular.
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

async function readLegalConsents(page) {
  return page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("malsevk.legal_consents.v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
}

async function findUserIdByEmail(page, email) {
  return page.evaluate((targetEmail) => {
    try {
      const raw = window.localStorage.getItem("malsevk.users.v1");
      const users = raw ? JSON.parse(raw) : [];
      const user = users.find((u) => u.email === targetEmail);
      return user ? user.id : null;
    } catch {
      return null;
    }
  }, email);
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const suffix = crypto.randomUUID().slice(0, 8);

  // =====================================================================
  // TEST A: footer'daki "Yasal" bölümünde artık "Yakında" YOK, üç bağlantı
  // da gerçek, tıklanabilir birer <a>.
  // =====================================================================
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByText("Yakında", { exact: true }).count(), 0, "TEST A: footer'da 'Yakında' etiketi hiç KALMAMALI");
  const privacyLink = page.getByRole("link", { name: "Gizlilik Politikası", exact: true });
  const termsLink = page.getByRole("link", { name: "Kullanım Koşulları", exact: true });
  const kvkkLink = page.getByRole("link", { name: "KVKK Aydınlatma Metni", exact: true });
  assert.equal(await privacyLink.getAttribute("href"), "/gizlilik-politikasi", "TEST A: Gizlilik Politikası bağlantısı gerçek bir href taşımalı");
  assert.equal(await termsLink.getAttribute("href"), "/kullanim-kosullari", "TEST A: Kullanım Koşulları bağlantısı gerçek bir href taşımalı");
  assert.equal(await kvkkLink.getAttribute("href"), "/kvkk-aydinlatma-metni", "TEST A: KVKK Aydınlatma Metni bağlantısı gerçek bir href taşımalı");
  ok("TEST A: Footer > Yasal bölümünde 'Yakında' etiketi kalmadı, üç bağlantı da gerçek href taşıyor");

  // =====================================================================
  // TEST B: normal (sol tık) footer tıklaması SAYFA DEĞİŞTİRMEZ, modal açar.
  // =====================================================================
  const urlBeforeClick = page.url();
  await privacyLink.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(page.url(), urlBeforeClick, "TEST B: footer bağlantısına tıklamak sayfa navigasyonu YAPMAMALI");
  assert.equal(await dialog.getByRole("heading", { name: "Gizlilik Politikası", exact: true }).count(), 1, "TEST B: modal doğru başlığı göstermeli");
  assert.equal(await dialog.getByText("Sürüm", { exact: true }).count(), 1, "TEST B: modal sürüm alanını göstermeli");
  assert.equal(await dialog.getByText("1.0", { exact: true }).count(), 1, "TEST B: modal güncel sürüm numarasını (1.0) göstermeli");
  assert.equal(await dialog.getByText("Yürürlük Tarihi", { exact: true }).count(), 1, "TEST B: modal yürürlük tarihi alanını göstermeli");
  assert.equal(await dialog.getByText("Son Güncelleme", { exact: true }).count(), 1, "TEST B: modal son güncelleme tarihi alanını göstermeli");
  ok("TEST B: footer'daki normal tıklama sayfa değiştirmeden ortada büyük bir modal açtı (başlık/sürüm/tarihler doğru)");

  // =====================================================================
  // TEST C: "Okudum, anladım." işaretlenmeden "Onaylıyorum" pasif;
  // işaretlenince aktifleşir; tıklanınca modal kapanır VE kabul kaydı düşer.
  // =====================================================================
  const acceptButton = dialog.getByRole("button", { name: "Onaylıyorum", exact: true });
  assert.equal(await acceptButton.isDisabled(), true, "TEST C: kutu işaretlenmeden 'Onaylıyorum' PASİF olmalı");
  await dialog.getByRole("checkbox", { name: "Okudum, anladım.", exact: true }).check();
  assert.equal(await acceptButton.isDisabled(), false, "TEST C: kutu işaretlenince 'Onaylıyorum' AKTİF olmalı");
  const consentsBefore = await readLegalConsents(page);
  await acceptButton.click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  const consentsAfterAccept = await readLegalConsents(page);
  assert.equal(consentsAfterAccept.length, consentsBefore.length + 1, "TEST C: 'Onaylıyorum' tam olarak BİR yeni kabul kaydı üretmeli");
  const newRecord = consentsAfterAccept[consentsAfterAccept.length - 1];
  assert.equal(newRecord.documentId, "privacy_policy", "TEST C: kayıt doğru belge id'siyle (privacy_policy) düşmeli");
  assert.equal(newRecord.version, "1.0", "TEST C: kayıt GÜNCEL sürümle (1.0) düşmeli");
  assert.equal(newRecord.userId, null, "TEST C: oturum açık olmadığından userId placeholder (null) olmalı");
  assert.equal(newRecord.ipAddress, null, "TEST C: ipAddress henüz placeholder (null) olmalı");
  assert.equal(newRecord.deviceInfo, null, "TEST C: deviceInfo henüz placeholder (null) olmalı");
  ok("TEST C: Onay kutusu 'Onaylıyorum'u doğru şekilde kilitliyor/açıyor; onay verilince modal kapandı ve localStorage'a doğru şemalı TEK kayıt düştü");

  // =====================================================================
  // TEST D: ESC ve dış tıklama HİÇBİR kayıt üretmeden kapatır ("Kapat" ile
  // aynı davranış).
  // =====================================================================
  await termsLink.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  let consents = await readLegalConsents(page);
  assert.equal(consents.filter((c) => c.documentId === "terms_of_service").length, 0, "TEST D: ESC ile kapatma kabul kaydı ÜRETMEMELİ");
  ok("TEST D: ESC ile kapatma herhangi bir kabul kaydı üretmedi");

  await kvkkLink.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.mouse.click(10, 10);
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  consents = await readLegalConsents(page);
  assert.equal(consents.filter((c) => c.documentId === "kvkk").length, 0, "TEST D: dış tıklama kabul kaydı ÜRETMEMELİ");
  ok("TEST D: dış (arka plan) tıklaması herhangi bir kabul kaydı üretmedi");

  await termsLink.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.getByRole("button", { name: "Kapat", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  consents = await readLegalConsents(page);
  assert.equal(consents.filter((c) => c.documentId === "terms_of_service").length, 0, "TEST D: 'Kapat' butonu da kabul kaydı ÜRETMEMELİ");
  ok("TEST D: 'Kapat' butonu da hiçbir kabul kaydı üretmeden modalı kapattı");

  // =====================================================================
  // TEST E: üç bağımsız sayfa da doğrudan URL ile gerçekten var (404 yok),
  // AYNI kurumsal tasarım dilini (kart/başlık/tarih bloğu) kullanıyor.
  // =====================================================================
  for (const [path, title] of [
    ["/gizlilik-politikasi", "Gizlilik Politikası"],
    ["/kullanim-kosullari", "Kullanım Koşulları"],
    ["/kvkk-aydinlatma-metni", "KVKK Aydınlatma Metni"],
  ]) {
    const response = await page.goto(`${BASE_URL}${path}`);
    assert.equal(response.status(), 200, `TEST E: ${path} 200 dönmeli (404 YOK)`);
    assert.equal(await page.getByRole("heading", { level: 1, name: title, exact: true }).count(), 1, `TEST E: ${path} doğru <h1> başlığını göstermeli`);
    assert.equal(await page.getByText("Ana Sayfaya Dön", { exact: false }).count(), 1, `TEST E: ${path} geri dönüş bağlantısı içermeli (boş/kırık sayfa değil)`);
  }
  ok("TEST E: Üç hukuki metin de doğrudan URL ile (footer/modal DIŞINDA) 404 vermeden, doğru başlıkla erişilebiliyor");

  // =====================================================================
  // TEST F: kayıt formu — TEK birleşik onay kutusu, satır içi üç tıklanabilir
  // başlık, işaretlenmeden kayıt engellenmesi.
  // =====================================================================
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  assert.equal(await page.getByLabel("KVKK Aydınlatma Metni'ni okudum ve kabul ediyorum.").count(), 0, "TEST F: eski AYRI KVKK checkbox'ı ARTIK olmamalı");
  assert.equal(await page.getByLabel("Kullanım Koşulları'nı kabul ediyorum.").count(), 0, "TEST F: eski AYRI Kullanım Koşulları checkbox'ı ARTIK olmamalı");
  assert.equal(
    await page.getByText("Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni okudum, anladım ve kabul ediyorum.", { exact: false }).count(),
    1,
    "TEST F: yeni TEK birleşik onay cümlesi görünmeli",
  );

  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page
    .getByText("Devam etmek için Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.", { exact: true })
    .waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.getByText("KVKK Aydınlatma Metni'ni kabul etmelisiniz.", { exact: true }).count(), 0, "TEST F: eski AYRI KVKK hata metni artık hiç üretilmemeli");
  assert.equal(await page.getByText("Kullanım Koşulları'nı kabul etmelisiniz.", { exact: true }).count(), 0, "TEST F: eski AYRI Kullanım Koşulları hata metni artık hiç üretilmemeli");
  ok("TEST F: kayıt formunda eski iki ayrı checkbox/hata metni kalkmış, TEK birleşik onay cümlesi ve TEK birleşik hata mesajı doğru çalışıyor");

  // =====================================================================
  // TEST G: cümle içindeki üç başlık AYRI AYRI tıklanabilir, kendi modalını
  // açar VE bunu yaparken dış checkbox'ı YANLIŞLIKLA işaretlemez.
  // =====================================================================
  // `<form>` İÇİNE kasıtlı olarak scope edilir: legal-document-modal.tsx
  // kendi "Okudum, anladım." checkbox'ını <form> DIŞINDA (login-form.tsx'te
  // </form> kapanışından SONRA, kardeş bir eleman olarak) render eder — bu
  // yüzden modal AÇIKKEN bile bu seçici yalnızca kayıt formunun KENDİ
  // birleşik onay kutusuyla eşleşir, modalın checkbox'ıyla karışmaz.
  const formConsentCheckbox = page.locator('form input[type="checkbox"]');
  await page.getByRole("button", { name: "KVKK Aydınlatma Metni", exact: true }).click();
  const inlineDialog = page.getByRole("dialog");
  await inlineDialog.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await inlineDialog.getByRole("heading", { name: "KVKK Aydınlatma Metni", exact: true }).count(), 1, "TEST G: satır içi başlığa tıklamak DOĞRU modalı (KVKK) açmalı");
  assert.equal(await formConsentCheckbox.isChecked(), false, "TEST G: modal açmak dış onay kutusunu YANLIŞLIKLA işaretlememeli");
  await inlineDialog.getByRole("button", { name: "Kapat", exact: true }).click();
  await inlineDialog.waitFor({ state: "hidden", timeout: 5000 });
  ok("TEST G: kayıt formundaki satır içi 'KVKK Aydınlatma Metni' başlığı kendi modalını açtı, dış onay kutusunu etkilemedi");

  // =====================================================================
  // TEST H: kayıt formu — birleşik kutu işaretlenip TÜM alanlar doldurulunca
  // kayıt GERÇEKTEN tamamlanıyor VE localStorage'a üç AYRI kabul kaydı düşüyor.
  // =====================================================================
  const email = `legal-kayit-${suffix}@example.com`;
  await page.getByLabel("Ad", { exact: true }).fill("Hukuki");
  await page.getByLabel("Soyad", { exact: true }).fill(`Test${suffix}`);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page.getByLabel("Telefon Numarası", { exact: true }).fill("+905557770000");
  await page.getByLabel("Firma Adı", { exact: true }).fill("Hukuki Test Firması");
  await page.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ index: 1 });
  const provinceFieldId = await page.getByLabel("İl", { exact: true }).getAttribute("id");
  await selectSearchable(page, provinceFieldId, "Kocaeli");
  const districtFieldId = await page.getByLabel("İlçe", { exact: true }).getAttribute("id");
  await selectSearchable(page, districtFieldId, "Dilovası");
  await page.getByLabel("Şifre", { exact: true }).fill("GucluSifre1!");
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill("GucluSifre1!");
  await formConsentCheckbox.check();
  assert.equal(await formConsentCheckbox.isChecked(), true, "TEST H: birleşik onay kutusu işaretlenebilmeli");

  const consentsBeforeRegister = await readLegalConsents(page);
  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  ok("TEST H: TEK birleşik onay kutusu işaretlenip tüm alanlar doldurulunca kayıt başarıyla tamamlandı");

  const newUserId = await findUserIdByEmail(page, email);
  assert.ok(newUserId, "TEST H: yeni kullanıcı localStorage'da (malsevk.users.v1) bulunmalı");
  const consentsAfterRegister = await readLegalConsents(page);
  const newConsents = consentsAfterRegister.slice(consentsBeforeRegister.length);
  assert.equal(newConsents.length, 3, "TEST H: kayıt TAM OLARAK üç yeni kabul kaydı üretmeli (privacy_policy + terms_of_service + kvkk)");
  for (const documentId of ["privacy_policy", "terms_of_service", "kvkk"]) {
    const record = newConsents.find((c) => c.documentId === documentId);
    assert.ok(record, `TEST H: ${documentId} için bir kabul kaydı olmalı`);
    assert.equal(record.userId, newUserId, `TEST H: ${documentId} kaydı YENİ kullanıcının id'siyle ilişkilendirilmeli`);
    assert.equal(record.version, "1.0", `TEST H: ${documentId} kaydı güncel sürümle (1.0) düşmeli`);
  }
  ok("TEST H: kayıt sonrası localStorage'da üç belgenin de AYRI, doğru kullanıcı id'sine bağlı kabul kaydı oluştu");

  // =====================================================================
  // TEST I: mobil genişlikte modal — yatay taşma yok, modal hâlâ ortada ve
  // kullanılabilir.
  // =====================================================================
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  await page.getByRole("link", { name: "Gizlilik Politikası", exact: true }).click();
  const mobileDialog = page.getByRole("dialog");
  await mobileDialog.waitFor({ state: "visible", timeout: 5000 });
  const noOverflow = await page.evaluate(() => {
    const originalX = window.scrollX;
    window.scrollTo(9999, window.scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(originalX, window.scrollY);
    return scrolledX === 0;
  });
  assert.ok(noOverflow, "TEST I: 375px genişlikte modal açıkken yatay taşma OLMAMALI");
  const mobileBox = await mobileDialog.boundingBox();
  assert.ok(mobileBox && mobileBox.width <= 375, "TEST I: modal mobil viewport genişliğini AŞMAMALI");
  await page.keyboard.press("Escape");
  await mobileDialog.waitFor({ state: "hidden", timeout: 5000 });
  ok("TEST I: Mobilde (375px) modal yatay taşma olmadan, viewport'a sığan şekilde açılıp ESC ile kapanıyor");

  await context.close();
  console.log(`\n[tmp-legal-pages-footer-modal-test] ${passed} test geçti.`);
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
