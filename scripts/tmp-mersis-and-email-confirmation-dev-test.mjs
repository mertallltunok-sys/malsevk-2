// node scripts/tmp-mersis-and-email-confirmation-dev-test.mjs
//
// "Production Kabul Testini Durdur" görevinin Development doğrulaması.
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve gerçek dev
// sunucusuna (npm run dev, http://localhost:3000) karşı, iki değişikliği
// uçtan uca doğrular:
//  1) MERSİS numarası artık HİÇBİR company_type için kayıt sırasında
//     zorunlu/görünür DEĞİL (migration 0089 + register-form-validation.ts/
//     login-form.tsx/complete-registration-form.tsx düzeltmeleri) — hem
//     Hizmet Alan hem Hizmet Veren, hem ilk adımda (login-form.tsx) hem
//     ikinci adımda (/kayit-tamamla) test edilir.
//  2) mailer_autoconfirm artık Development'ta KAPALI — signUp() ANINDA
//     oturum DÖNMÜYOR, "E-postanızı Kontrol Edin" ekranı GÖRÜNÜYOR, ve
//     GERÇEK bir GoTrue onay linki (admin.generateLink ile üretilir — bu,
//     gerçek Supabase Auth mekanizmasının ürettiği AYNI link biçimidir)
//     tıklanınca /auth/confirm üzerinden akış tamamlanıp normal girişe
//     izin veriyor.
//  3) Hizmet Alan'ın kayıt/kayıt-sonrası hiçbir adımda belge yükleme
//     alanıyla karşılaşmadığı (regresyon kilidi — bu davranış zaten
//     mevcuttu, DEĞİŞTİRİLMEDİ, yalnızca doğrulanıyor).
//
// Bu script SB_SECRET_KEY_FOR_TEST (Development service-role) gerektirir,
// invocation-time env var olarak (dev-mersis-email-test-runner.ps1 tarafından
// maskeli girdiden set edilir, hiçbir yere yazılmaz).
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni (.env.local + SB_SECRET_KEY_FOR_TEST)");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + String(detail).slice(0, 200) : ""}`);
}

async function selectSearchable(page, label, optionText) {
  await page.getByLabel(label, { exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

const createdUserIds = [];
let browser;

async function main() {
  browser = await chromium.launch();
  const stamp = Date.now();

  // =========================================================================
  // 1) Hizmet Alan — "Limited Şirket" (bireysel DEĞİL) seçilerek kayıt.
  //    MERSİS alanı hiç görünmemeli, hiç istenmemeli.
  // =========================================================================
  const requesterEmail = `malsevk-mersistest-req-${stamp}@gmail.com`;
  const context1 = await browser.newContext();
  const page1 = await context1.newPage();

  await page1.goto(`${APP_ORIGIN}/giris-yap`);
  await page1.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page1.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page1.getByLabel("Ad", { exact: true }).fill("MersisTest");
  await page1.getByLabel("Soyad", { exact: true }).fill("Requester");
  await page1.getByLabel("E-posta", { exact: true }).fill(requesterEmail);
  await page1.getByLabel("Telefon Numarası", { exact: true }).fill("+905551110010");
  await page1.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Firma Adı", { exact: true }).fill("MersisTest Requester Ltd. Şti.");
  await page1.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ label: "Limited Şirket" });
  await selectSearchable(page1, "İl", "Kocaeli");
  await selectSearchable(page1, "İlçe", "Gebze");

  record(
    "1. Hizmet Alan (Limited Şirket seçili): 'MERSİS' metni sayfada HİÇ yok",
    (await page1.getByText(/MERSİS/i).count()) === 0,
  );
  record(
    "2. Hizmet Alan: belge yükleme alanı (input[type=file]) sayfada HİÇ yok",
    (await page1.locator('input[type="file"]').count()) === 0,
  );

  const legalCheckbox1 = page1.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox1.check();
  await page1.getByRole("button", { name: "Hesap Oluştur" }).click();

  // KRİTİK: artık autoconfirm KAPALI olduğu için bu ekran GÖRÜNMELİ.
  const sawEmailWaitScreen = await page1
    .getByText("E-postanızı Kontrol Edin")
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  record("3. Hizmet Alan: 'E-postanızı Kontrol Edin' ekranı GÖRÜNDÜ (mailer_autoconfirm kapalı, gerçek doğrulama gerekiyor)", sawEmailWaitScreen);

  const reqUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const reqUser = reqUsers.data?.users.find((u) => u.email === requesterEmail);
  if (reqUser) createdUserIds.push(reqUser.id);
  record("4. Hizmet Alan: Supabase Auth kullanıcısı oluştu", Boolean(reqUser));
  record("5. Hizmet Alan: email_confirmed_at HENÜZ BOŞ (gerçekten onay bekliyor)", reqUser && !reqUser.email_confirmed_at);

  // panel/kayit-tamamla'ya oturumsuz erişilemez (henüz onaylanmadı) — /panel'e
  // gitmeye çalışırsa /giris-yap'e düşmeli.
  await page1.goto(`${APP_ORIGIN}/panel`);
  await page1.waitForTimeout(1000);
  record("6. Hizmet Alan: onaylanmadan /panel'e erişemiyor", new URL(page1.url()).pathname === "/giris-yap");
  await context1.close();

  // Gerçek GoTrue onay linkini üret (admin API - gerçek mekanizmanın ürettiği
  // AYNI biçim) ve gerçek tarayıcıda tıkla.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "signup",
    email: requesterEmail,
    password: PASSWORD,
  });
  // NOT: linkData.properties.action_link admin-generateLink'in KENDİ
  // varsayılan (implicit/hash-token) akışını kullanır - bu, gerçek bir
  // e-posta linkinin ASLA üretmeyeceği bir biçimdir (gerçek signUp()
  // emailRedirectTo ile PKCE code/token_hash üretir, bkz. login-form.tsx).
  // Bu yüzden action_link'i DOĞRUDAN ziyaret ETMİYORUZ - onun yerine
  // properties.hashed_token + properties.verification_type kullanarak
  // /auth/confirm/route.ts'in GERÇEKTEN desteklediği token_hash+type
  // biçimini kendimiz kuruyoruz (route'un belgelenmiş iki biçiminden biri,
  // bkz. CLAUDE.md "İki-adımlı kayıt" bölümü) - böylece test, gerçek e-posta
  // linkinin izleyeceği AYNI kod yolunu (verifyOtp) egzersiz eder.
  const hashedToken = linkData?.properties?.hashed_token;
  const verificationType = linkData?.properties?.verification_type;
  record(
    "7. Hizmet Alan: gerçek onay linki (token_hash+type) üretildi",
    !linkError && Boolean(hashedToken) && Boolean(verificationType),
    linkError?.message || `type=${verificationType}`,
  );

  if (hashedToken && verificationType) {
    const realConfirmUrl = `${APP_ORIGIN}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(verificationType)}&next=${encodeURIComponent("/kayit-tamamla")}`;
    const context1c = await browser.newContext();
    const page1c = await context1c.newPage();
    await page1c.goto(realConfirmUrl);
    await page1c
      .waitForURL((url) => url.pathname === "/kayit-tamamla" || url.pathname === "/panel", { timeout: 15000 })
      .catch(() => {});
    // /kayit-tamamla kendi useEffect'inde önce getUser()+profiles sorgusu
    // yapıp "checking" durumundan "form"a geçiyor (asenkron) - form gerçekten
    // render olana kadar bekle, sabit bir kısa timeout YETMEZ.
    if (new URL(page1c.url()).pathname === "/kayit-tamamla") {
      await page1c
        .getByRole("button", { name: "Kaydı Tamamla" })
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => {});
    }
    const afterConfirmUrl = page1c.url();
    record(
      "8. Hizmet Alan: onay linki tıklandıktan sonra uygulamaya (localhost:3000) döndü",
      afterConfirmUrl.startsWith(APP_ORIGIN),
      afterConfirmUrl,
    );

    const reqUserAfter = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data?.users.find((u) => u.email === requesterEmail);
    record("9. Hizmet Alan: email_confirmed_at ARTIK DOLU (gerçekten onaylandı)", Boolean(reqUserAfter?.email_confirmed_at));

    // /kayit-tamamla ekranında da MERSİS/belge alanı olmamalı.
    const onKayitTamamla = afterConfirmUrl.includes("/kayit-tamamla");
    record("10. Onay sonrası /kayit-tamamla'ya yönlendirildi", onKayitTamamla, afterConfirmUrl);
    if (onKayitTamamla) {
      record("11. /kayit-tamamla: 'MERSİS' metni sayfada HİÇ yok", (await page1c.getByText(/MERSİS/i).count()) === 0);
      record("12. /kayit-tamamla: belge yükleme alanı HİÇ yok", (await page1c.locator('input[type="file"]').count()) === 0);
      // İl/İlçe zaten user_metadata'dan ön-dolu gelir; yalnız KVKK onayı+submit yeterli.
      const legalCheckbox1c = page1c.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
      if ((await legalCheckbox1c.count()) > 0) {
        const isChecked = await legalCheckbox1c.isChecked();
        if (!isChecked) await legalCheckbox1c.check();
        const provinceFieldText = await page1c.getByLabel("İl", { exact: true }).innerText().catch(() => "OKUNAMADI");
        const districtFieldText = await page1c.getByLabel("İlçe", { exact: true }).innerText().catch(() => "OKUNAMADI");
        const submitBtn = page1c.getByRole("button", { name: /Kaydı Tamamla|Devam Et|Hesap Oluştur/ });
        await submitBtn.click();
        await page1c.waitForTimeout(2500);
        const formErrorText = await page1c
          .locator('[class*="danger"], [role="alert"]')
          .first()
          .textContent()
          .catch(() => null);
        record(
          "12b. /kayit-tamamla formu gönderildikten sonra başka bir sayfaya geçti (kayıt tamamlandı)",
          new URL(page1c.url()).pathname !== "/kayit-tamamla",
          `url=${page1c.url()} il_onceden_dolu=${provinceFieldText} ilce_onceden_dolu=${districtFieldText} form_hatasi=${formErrorText}`,
        );
      } else {
        record("12b. /kayit-tamamla: legal consent checkbox BULUNAMADI", false, await page1c.content().then((h) => h.slice(0, 300)));
      }
    }
    await context1c.close();
  }

  // Normal girişin artık çalıştığını doğrula (onaylandıktan + kayıt
  // tamamlandıktan sonra).
  const context1d = await browser.newContext();
  const page1d = await context1d.newPage();
  await page1d.goto(`${APP_ORIGIN}/giris-yap`);
  await page1d.getByLabel("E-posta").fill(requesterEmail);
  await page1d.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page1d.getByRole("button", { name: "Giriş Yap" }).click();
  const loggedIn = await page1d
    .waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  record(
    "13. Hizmet Alan: onay + kayıt tamamlama sonrası normal giriş, gerçek panele iniyor (/kayit-tamamla'ya geri düşmüyor)",
    loggedIn && new URL(page1d.url()).pathname !== "/kayit-tamamla",
    page1d.url(),
  );
  await context1d.close();

  // =========================================================================
  // 2) Hizmet Veren — "Anonim Şirket" (bireysel DEĞİL) seçilerek kayıt.
  //    MERSİS istenmemeli; belge yükleme alanı da kayıt formunda olmamalı
  //    (regresyon — zaten kaldırılmıştı).
  // =========================================================================
  const providerEmail = `malsevk-mersistest-prov-${stamp}@gmail.com`;
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto(`${APP_ORIGIN}/giris-yap`);
  await page2.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page2.getByRole("radio", { name: "Hizmet Veren", exact: true }).check();
  await page2.getByLabel("Ad", { exact: true }).fill("MersisTest");
  await page2.getByLabel("Soyad", { exact: true }).fill("Provider");
  await page2.getByLabel("E-posta", { exact: true }).fill(providerEmail);
  await page2.getByLabel("Telefon Numarası", { exact: true }).fill("+905551110011");
  await page2.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page2.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page2.getByLabel("Firma Adı", { exact: true }).fill("MersisTest Provider A.Ş.");
  await page2.getByLabel("Hizmet Veren Tipi", { exact: true }).selectOption({ label: "Anonim Şirket" });
  await selectSearchable(page2, "İl", "Kocaeli");
  await selectSearchable(page2, "İlçe", "Gebze");

  record("14. Hizmet Veren (Anonim Şirket seçili): 'MERSİS' metni sayfada HİÇ yok", (await page2.getByText(/MERSİS/i).count()) === 0);
  record("15. Hizmet Veren: kayıt formunda belge yükleme alanı HİÇ yok", (await page2.locator('input[type="file"]').count()) === 0);
  record(
    "16. Hizmet Veren: hizmet kategorisi seçim alanı HİÇ yok (onboarding sadeleştirmesi rejresyonu)",
    (await page2.getByText("Verdiğiniz Hizmetler").count()) === 0,
  );

  const legalCheckbox2 = page2.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox2.check();
  await page2.getByRole("button", { name: "Hesap Oluştur" }).click();
  const sawEmailWaitScreen2 = await page2
    .getByText("E-postanızı Kontrol Edin")
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  record("17. Hizmet Veren: 'E-postanızı Kontrol Edin' ekranı GÖRÜNDÜ", sawEmailWaitScreen2);

  const provUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const provUser = provUsers.data?.users.find((u) => u.email === providerEmail);
  if (provUser) createdUserIds.push(provUser.id);
  record("18. Hizmet Veren: Supabase Auth kullanıcısı oluştu, henüz onaysız", Boolean(provUser) && !provUser?.email_confirmed_at);
  await context2.close();
}

async function cleanup() {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  if (browser) await browser.close();
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
