// node scripts/tmp-legal-document-modal-mode-test.mjs
//
// legal-document-modal.tsx'e eklenen `mode: "readonly" | "consent"` prop'unu
// GERÇEK arayüz akışlarıyla doğrular: footer'dan açılan modal artık salt
// okunur (onay kutusu/"Onaylıyorum" YOK, yalnızca "Kapat" var ve hiçbir kabul
// kaydı üretmiyor), kayıt formundan açılan modal ise eski davranışı birebir
// koruyor (onay kutusu + "Onaylıyorum", kabul kaydı üretiyor). Aynı belge
// içeriğinin (LegalDocumentContent) her iki modda da değişmeden render
// edildiğini de kontrol eder.
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

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();

  // =====================================================================
  // TEST A: footer'dan açılan modal (mode="readonly") — onay kutusu ve
  // "Onaylıyorum" hiç RENDER edilmiyor, yalnızca "Kapat" var.
  // =====================================================================
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle");
  const privacyLink = page.getByRole("link", { name: "Gizlilik Politikası", exact: true });
  await privacyLink.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await dialog.getByRole("heading", { name: "Gizlilik Politikası", exact: true }).count(), 1, "TEST A: modal doğru belge başlığını göstermeli (içerik değişmemiş)");
  assert.equal(await dialog.getByText("Sürüm", { exact: true }).count(), 1, "TEST A: modal sürüm alanını göstermeye devam etmeli (içerik değişmemiş)");
  assert.equal(await dialog.getByRole("checkbox").count(), 0, "TEST A: footer modalında 'Okudum, anladım.' checkbox'ı HİÇ olmamalı");
  assert.equal(await dialog.getByText("Okudum, anladım.", { exact: true }).count(), 0, "TEST A: footer modalında 'Okudum, anladım.' metni HİÇ olmamalı");
  assert.equal(await dialog.getByRole("button", { name: "Onaylıyorum", exact: true }).count(), 0, "TEST A: footer modalında 'Onaylıyorum' butonu HİÇ olmamalı");
  const closeButton = dialog.getByRole("button", { name: "Kapat", exact: true });
  assert.equal(await closeButton.count(), 1, "TEST A: footer modalında yalnızca 'Kapat' butonu olmalı");
  ok("TEST A: footer'dan açılan modal salt okunur — onay kutusu/'Onaylıyorum' render edilmiyor, yalnızca 'Kapat' var");

  // =====================================================================
  // TEST B: 'Kapat' modalı kapatır ve HİÇBİR kabul kaydı üretmez.
  // =====================================================================
  const consentsBefore = await readLegalConsents(page);
  await closeButton.click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  const consentsAfterClose = await readLegalConsents(page);
  assert.equal(consentsAfterClose.length, consentsBefore.length, "TEST B: readonly modda 'Kapat' hiçbir kabul kaydı ÜRETMEMELİ");
  ok("TEST B: readonly moddaki 'Kapat' modalı kapattı ve hiçbir kabul kaydı üretmedi");

  // =====================================================================
  // TEST C: oturum açıkken de (Hesap Ayarları'na değil, doğrudan ana
  // sayfadaki footer'a giden anonim ziyaretçi akışıyla) aynı readonly
  // davranış geçerli — mode footer çağrısında sabit "readonly", oturuma
  // bağlı değil. (Anonim ziyaretçi zaten en yaygın footer senaryosu.)
  // =====================================================================
  await page.getByRole("link", { name: "Kullanım Koşulları", exact: true }).click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await dialog.getByRole("button", { name: "Onaylıyorum", exact: true }).count(), 0, "TEST C: Kullanım Koşulları için de footer modalı 'Onaylıyorum' göstermemeli");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  ok("TEST C: footer'daki diğer belge (Kullanım Koşulları) de aynı şekilde readonly açılıyor");

  // =====================================================================
  // TEST D: kayıt formundan açılan modal (mode="consent") — ESKİ davranış
  // birebir korunuyor: onay kutusu + "Onaylıyorum", kutu işaretlenmeden
  // buton pasif, işaretlenince aktif, tıklanınca kabul kaydı düşüyor.
  // =====================================================================
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  await page.getByRole("button", { name: "KVKK Aydınlatma Metni", exact: true }).click();
  const registerDialog = page.getByRole("dialog");
  await registerDialog.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await registerDialog.getByRole("heading", { name: "KVKK Aydınlatma Metni", exact: true }).count(), 1, "TEST D: kayıt formundan doğru belge (KVKK) açılmalı");
  const registerAcceptButton = registerDialog.getByRole("button", { name: "Onaylıyorum", exact: true });
  assert.equal(await registerAcceptButton.count(), 1, "TEST D: kayıt formu modalında 'Onaylıyorum' butonu OLMALI (consent modu)");
  assert.equal(await registerAcceptButton.isDisabled(), true, "TEST D: 'Okudum, anladım.' işaretlenmeden 'Onaylıyorum' pasif olmalı");
  await registerDialog.getByRole("checkbox", { name: "Okudum, anladım.", exact: true }).check();
  assert.equal(await registerAcceptButton.isDisabled(), false, "TEST D: işaretlenince 'Onaylıyorum' aktif olmalı");
  const consentsBeforeAccept = await readLegalConsents(page);
  await registerAcceptButton.click();
  await registerDialog.waitFor({ state: "hidden", timeout: 5000 });
  const consentsAfterAccept = await readLegalConsents(page);
  assert.equal(consentsAfterAccept.length, consentsBeforeAccept.length + 1, "TEST D: consent modunda 'Onaylıyorum' TAM OLARAK bir kabul kaydı üretmeli");
  assert.equal(consentsAfterAccept[consentsAfterAccept.length - 1].documentId, "kvkk", "TEST D: kayıt doğru belge id'siyle (kvkk) düşmeli");
  ok("TEST D: kayıt formundan açılan modal eski davranışı koruyor — onay kutusu + 'Onaylıyorum', doğru kabul kaydı üretiyor");

  // =====================================================================
  // TEST E: kayıt formunun kendi birleşik onay kutusu ve zorunlu-onay kuralı
  // (bu değişiklikten ETKİLENMEMESİ gereken kayıt akışı) hâlâ çalışıyor.
  // =====================================================================
  assert.equal(
    await page.getByText("Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni okudum, anladım ve kabul ediyorum.", { exact: false }).count(),
    1,
    "TEST E: kayıt formunun TEK birleşik onay cümlesi hâlâ görünmeli",
  );
  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page
    .getByText("Devam etmek için Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.", { exact: true })
    .waitFor({ state: "visible", timeout: 5000 });
  ok("TEST E: kayıt akışının zorunlu-onay kuralı bu değişiklikten etkilenmeden çalışmaya devam ediyor");

  await context.close();
  console.log(`\n[tmp-legal-document-modal-mode-test] ${passed} test geçti.`);
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
