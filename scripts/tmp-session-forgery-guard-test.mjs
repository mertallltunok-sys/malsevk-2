// K1 / Y2 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden (düzeltme öncesi): session.ts#isValidSession yalnızca
// `{id, name, role}`in TİPİNİ kontrol ediyordu — `id`nin gerçek bir
// `StoredUser`a karşılık geldiğini ya da `role`ün o kullanıcının GERÇEK
// rolüyle eşleştiğini hiç doğrulamıyordu. Tarayıcı konsolunda
// `localStorage["malsevk.session.v1"]`i elle `{"id":"x","name":"x","role":
// "admin"}` yapan HERHANGİ bir kullanıcı `/admin`e erişebiliyordu. Ayrıca
// users.ts#updateProviderProfile/updateProviderServiceInfo, gerçek kayıt
// yerine (sahtelenebilir) `session.role`ü kontrol ediyordu.
//
// Düzeltme:
//  - session.ts#readSessionSnapshot artık `id`yi gerçek kullanıcılar
//    arasında arıyor; bulunamazsa oturum TAMAMEN geçersiz (null) sayılıyor,
//    bulunursa `name`/`role` SAHTE session nesnesinden değil doğrudan gerçek
//    `StoredUser` kaydından türetiliyor.
//  - users.ts#updateProviderProfile/updateProviderServiceInfo artık
//    `session.role` yerine `findUserById(session.id)`den okunan gerçek
//    `existing.role`ü kontrol ediyor (savunma katmanı, session.ts'in
//    kendisi bir gün değişse/atlansa bile).
//
// ÖNEMLİ SINIR (bu testin de doğruladığı gibi, session.ts'in kendi kod
// yorumunda da belirtilmiştir): bu yalnızca istemci tarafında mümkün olan
// bir sıkılaştırmadır, üretim seviyesinde tam bir güvenlik sınırı DEĞİLDİR
// — StoredUser kaydının kendisi de aynı localStorage'da değiştirilebilir.
// Gerçek sınır yalnızca sunucu tarafında doğrulanan bir oturumdur (bkz.
// docs/database/ taslak RLS + SECURITY DEFINER RPC tasarımı).
//
// Kapsanan senaryolar (görev tanımındaki 5 madde ile birebir eşleşir):
//  1. Var olmayan id + admin rolü -> reddedilir (oturum geçersiz sayılır).
//  2. Hizmet-alan (Zeynep) kendi session.role'ünü elle "hizmet-veren"
//     yapsa bile, uygulamanın HİÇBİR yerinde (Hesap Ayarları > Firma
//     Profili, Panel > Profilim > Hizmet Bilgilerim) artık hizmet-veren'e
//     özel bir düzenleme yüzeyi görmüyor — dolayısıyla provider profili
//     güncelleyemiyor (users.ts#updateProviderProfile'ın kendisinin de
//     artık gerçek kayıttan doğruladığı, doğrudan kaynak koddan ayrıca
//     doğrulanmıştır — bkz. users.ts:788-796/958-961).
//  3. Gerçek admin (admin@test.com) normal girişle /admin'e erişebiliyor.
//  4. Gerçek hizmet-veren (Mert) kendi profilini normal şekilde
//     güncelleyebiliyor (düzeltmenin gerçek akışı bozmadığının kanıtı).
//  5. Bozuk (geçersiz JSON / eksik alan) bir session değeri, uygulamayı
//     çökertmeden "oturum yok" gibi ele alınıyor.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SESSION_KEY = "malsevk.session.v1";
const ADMIN_HEADING = "Hizmet Veren Belge Kontrolü";

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsErrors = [];
  page.on("pageerror", (err) => page.jsErrors.push(String(err)));
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 10000 });
}

async function setRawSession(page, value) {
  await page.evaluate(
    ({ key, value }) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    { key: SESSION_KEY, value },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    // === Senaryo 1: Var olmayan id + admin rolü -> reddedilir ===
    console.log("\n=== Senaryo 1: Var olmayan id + admin rolü reddedilir ===");
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    attachDiagnostics(page1);
    // Önce herhangi bir sayfaya gidip localStorage'a erişilebilir hale getir.
    await page1.goto(`${BASE_URL}/`);
    await setRawSession(page1, JSON.stringify({ id: "nonexistent-id-xyz", name: "Sahte Admin", role: "admin" }));
    await page1.goto(`${BASE_URL}/admin`);
    const headingCount1 = await page1.getByRole("heading", { name: ADMIN_HEADING }).count();
    check("1a. Sahte (var olmayan id'li) admin oturumu /admin'e erişemiyor", headingCount1 === 0, `başlık sayısı=${headingCount1}`);
    const loginPromptCount1 = await page1.getByText("Bu sayfayı görüntülemek için yönetici girişi yapmalısınız.").count();
    check("1b. Oturum tamamen geçersiz sayılıp 'giriş yapmalısınız' mesajı gösteriliyor", loginPromptCount1 > 0, `adet=${loginPromptCount1}`);
    check("1c. Konsol/sayfa hatası oluşmadı", page1.jsErrors.length === 0, page1.jsErrors.join(" | "));
    await ctx1.close();

    // === Senaryo 2: Zeynep (hizmet-alan) session.role'ünü elle "hizmet-veren" yapıyor ===
    console.log("\n=== Senaryo 2: Sahte role='hizmet-veren' -> provider yüzeyleri hâlâ kapalı ===");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    attachDiagnostics(page2);
    await loginAs(page2, "zeynep@test.com", "Zeynep1!", "/panel");
    const rawBefore = await page2.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
    const sessionBefore = JSON.parse(rawBefore);
    assert.equal(sessionBefore.role, "hizmet-alan", "Ön koşul: Zeynep gerçekten hizmet-alan olmalı");
    const forged = JSON.stringify({ ...sessionBefore, role: "hizmet-veren" });
    await setRawSession(page2, forged);

    await page2.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    const providerEditorCount = await page2.getByText("Firma Profili").count();
    check(
      "2a. Sahte role='hizmet-veren' ile Hesap Ayarları'nda 'Firma Profili' (provider-only) bölümü GÖRÜNMÜYOR",
      providerEditorCount === 0,
      `adet=${providerEditorCount}`,
    );

    await page2.goto(`${BASE_URL}/panel/profil`);
    const authGateCount = await page2
      .getByText("Profilinizi görüntülemek için giriş yapmalısınız.")
      .count();
    // Zeynep zaten giriş yapmış durumda; burada asıl kontrol ettiğimiz
    // Hizmet Bilgilerim (ServiceInfoEditor) bölümünün YİNE görünmemesi.
    const serviceInfoCount = await page2.getByText("Hizmet Bilgilerim").count();
    check(
      "2b. Sahte role='hizmet-veren' ile Panel > Profilim'de 'Hizmet Bilgilerim' (provider-only) bölümü GÖRÜNMÜYOR",
      serviceInfoCount === 0,
      `adet=${serviceInfoCount}, authGate=${authGateCount}`,
    );
    check("2c. Konsol/sayfa hatası oluşmadı", page2.jsErrors.length === 0, page2.jsErrors.join(" | "));
    await ctx2.close();

    // === Senaryo 3: Gerçek admin normal girişle erişebiliyor ===
    console.log("\n=== Senaryo 3: Gerçek admin erişebiliyor (regresyon) ===");
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    attachDiagnostics(page3);
    await loginAs(page3, "admin@test.com", "Admin123!", "/panel");
    await page3.goto(`${BASE_URL}/admin`);
    await assert.doesNotReject(
      page3.getByRole("heading", { name: ADMIN_HEADING }).waitFor({ state: "visible", timeout: 10000 }),
    );
    check("3. Gerçek admin /admin'e erişebiliyor", true);
    check("3b. Konsol/sayfa hatası oluşmadı", page3.jsErrors.length === 0, page3.jsErrors.join(" | "));
    await ctx3.close();

    // === Senaryo 4: Gerçek hizmet-veren (Mert) kendi profilini güncelleyebiliyor ===
    console.log("\n=== Senaryo 4: Gerçek hizmet-veren kendi profilini güncelleyebiliyor (regresyon) ===");
    const ctx4 = await browser.newContext();
    const page4 = await ctx4.newPage();
    attachDiagnostics(page4);
    await loginAs(page4, "mert@test.com", "Mert123!", "/panel");
    await page4.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    await assert.doesNotReject(
      page4.getByText("Firma Profili").first().waitFor({ state: "visible", timeout: 10000 }),
    );
    const bioField = page4.getByLabel("Kısa Firma Tanıtımı");
    const bioText = `K1/Y2 regresyon testi bio metni - gerçek hizmet veren profilini güncelleyebilmeli, en az elli karakter uzunlugunda olmali. ${Date.now()}`;
    await bioField.fill(bioText);
    await page4.getByLabel("Firma Adı").fill(`K1Y2 Test Firma ${Date.now()}`);
    await page4.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await assert.doesNotReject(
      page4.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 }),
    );
    check("4. Gerçek hizmet-veren firma profilini başarıyla güncelleyebildi", true);
    check("4b. Konsol/sayfa hatası oluşmadı", page4.jsErrors.length === 0, page4.jsErrors.join(" | "));
    await ctx4.close();

    // === Senaryo 5: Bozuk session -> çökmeden "oturum yok" gibi ele alınıyor ===
    console.log("\n=== Senaryo 5: Bozuk session değeri çökmeden geçersiz sayılıyor ===");
    const ctx5 = await browser.newContext();
    const page5 = await ctx5.newPage();
    attachDiagnostics(page5);
    await page5.goto(`${BASE_URL}/`);
    await setRawSession(page5, "{ bu gecerli JSON degil");
    await page5.goto(`${BASE_URL}/panel`);
    const authGateAfterCorrupt = await page5.getByText(/giriş yapmalısınız/i).count();
    check(
      "5a. Geçersiz JSON session -> panel 'giriş yapmalısınız' gösteriyor, çökmüyor",
      authGateAfterCorrupt > 0,
      `adet=${authGateAfterCorrupt}`,
    );
    check("5b. Konsol/sayfa hatası oluşmadı (geçersiz JSON çökmeye yol açmadı)", page5.jsErrors.length === 0, page5.jsErrors.join(" | "));

    // Eksik alanlı (role yok) bir session da aynı şekilde geçersiz sayılmalı.
    await setRawSession(page5, JSON.stringify({ id: "some-id" }));
    await page5.goto(`${BASE_URL}/panel`);
    const authGateAfterMissingFields = await page5.getByText(/giriş yapmalısınız/i).count();
    check(
      "5c. Eksik alanlı session (role yok) -> yine 'giriş yapmalısınız' gösteriyor",
      authGateAfterMissingFields > 0,
      `adet=${authGateAfterMissingFields}`,
    );
    check("5d. Konsol/sayfa hatası oluşmadı", page5.jsErrors.length === 0, page5.jsErrors.join(" | "));
    await ctx5.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[session-forgery-guard-test] GENEL HATA:", error);
  process.exitCode = 1;
});
