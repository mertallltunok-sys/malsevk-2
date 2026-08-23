// node scripts/tmp-supabase-email-confirmation-bypass-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna (npm run dev, http://localhost:3000) karşı: email confirmation
// bypass'ının (Management API üzerinden mailer_autoconfirm=true — bkz. bu
// migration'ın YANINDA HİÇBİR migration/kod değişikliği YOK, tamamen
// konfigürasyon seviyesi) gerçek `login-form.tsx` "Kayıt Ol" akışını
// BOZMADIĞINI uçtan uca doğrular:
//   - signUp() ANINDA bir Supabase oturumu döndürüyor (E-postanızı Kontrol
//     Edin ekranı hiç GÖSTERİLMİYOR)
//   - kullanıcı kayıt olur olmaz normal şekilde içeri alınıyor
//   - profiles satırı (complete_registration RPC üzerinden) doğru yazılıyor
//   - Hizmet Veren tarafında provider_services/provider_documents/
//     provider_document_consents/legal_consents da AYNI anlık akışta doğru
//     yazılıyor (belge yükleme + RLS/RPC zinciri bozulmamış)
//   - Supabase Auth GERÇEKTEN otomatik onaylamış (email_confirmed_at dolu)
//   - kayıt sonrası normal çıkış/giriş de sorunsuz çalışıyor
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SB_SECRET_KEY_FOR_TEST)");
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
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-email-bypass-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

function makePdf(fileName, text) {
  const filePath = path.join(scratchDir, fileName);
  const content = `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%% ${text}\n%%EOF`;
  writeFileSync(filePath, content, "utf8");
  return filePath;
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

  // ---------------------------------------------------------------------
  // 1) Hizmet Alan — gerçek `/giris-yap` "Kayıt Ol" akışı, uçtan uca.
  // ---------------------------------------------------------------------
  const stamp = Date.now();
  const requesterEmail = `malsevk-emailbypass-req-${stamp}@gmail.com`;
  const context1 = await browser.newContext();
  const page1 = await context1.newPage();

  await page1.goto(`${APP_ORIGIN}/giris-yap`);
  await page1.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page1.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page1.getByLabel("Ad", { exact: true }).fill("EmailBypass");
  await page1.getByLabel("Soyad", { exact: true }).fill("Requester");
  await page1.getByLabel("E-posta", { exact: true }).fill(requesterEmail);
  await page1.getByLabel("Telefon Numarası", { exact: true }).fill("+905551110000");
  await page1.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Firma Adı", { exact: true }).fill("EmailBypass Requester Firma");
  await page1.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ label: "Bireysel" });
  await selectSearchable(page1, "İl", "Kocaeli");
  await selectSearchable(page1, "İlçe", "Gebze");
  const legalCheckbox1 = page1.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox1.check();

  await page1.getByRole("button", { name: "Hesap Oluştur" }).click();

  // KRİTİK ASSERTION: e-posta bekleme ekranı HİÇ görünmemeli.
  const sawEmailWaitScreen = await page1
    .getByText("E-postanızı Kontrol Edin")
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  record("1. Hizmet Alan: 'E-postanızı Kontrol Edin' ekranı GÖRÜNMEDİ (anında oturum açıldı)", !sawEmailWaitScreen);

  const leftLoginPage = await page1
    .waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  record("2. Hizmet Alan: kayıt sonrası /giris-yap'tan başka bir sayfaya yönlendirildi (anında giriş)", leftLoginPage, page1.url());

  const requesterAuthUser = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const reqUser = requesterAuthUser.data?.users.find((u) => u.email === requesterEmail);
  if (reqUser) createdUserIds.push(reqUser.id);
  record("3. Hizmet Alan: Supabase Auth kullanıcısı email_confirmed_at DOLU (otomatik onaylandı)", Boolean(reqUser?.email_confirmed_at), reqUser?.email_confirmed_at ?? "yok");

  const reqProfileRows = reqUser ? runSql(`select role, full_name, company_name, onboarding_completed from public.profiles where id = '${reqUser.id}';`) : [];
  record(
    "4. Hizmet Alan: profiles satırı complete_registration ile doğru yazıldı (role=hizmet-alan, onboarding_completed=true)",
    reqProfileRows[0]?.role === "hizmet-alan" && reqProfileRows[0]?.onboarding_completed === true,
    JSON.stringify(reqProfileRows[0]),
  );

  // Çıkış + normal giriş — kayıt sonrası normal login akışı bozulmamış mı?
  await context1.close();

  const context1b = await browser.newContext();
  const page1b = await context1b.newPage();
  await page1b.goto(`${APP_ORIGIN}/giris-yap`);
  await page1b.locator('input[type="email"]').fill(requesterEmail);
  await page1b.locator('input[type="password"]').fill(PASSWORD);
  await page1b.getByRole("button", { name: "Giriş Yap" }).click();
  const reLoggedIn = await page1b
    .waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  record("5. Hizmet Alan: kayıt sonrası NORMAL giriş akışı da (şifreyle tekrar giriş) sorunsuz çalışıyor", reLoggedIn, page1b.url());
  await context1b.close();

  // ---------------------------------------------------------------------
  // 2) Hizmet Veren — aynı akış, ARTI hizmet kategorisi seçimi + belge
  //    yükleme + beyan onayı (bu anlık akışta HEPSİ tek seferde yazılmalı).
  // ---------------------------------------------------------------------
  const providerEmail = `malsevk-emailbypass-prov-${stamp}@gmail.com`;
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();

  await page2.goto(`${APP_ORIGIN}/giris-yap`);
  await page2.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page2.getByRole("radio", { name: "Hizmet Veren", exact: true }).check();
  await page2.getByLabel("Ad", { exact: true }).fill("EmailBypass");
  await page2.getByLabel("Soyad", { exact: true }).fill("Provider");
  await page2.getByLabel("E-posta", { exact: true }).fill(providerEmail);
  await page2.getByLabel("Telefon Numarası", { exact: true }).fill("+905551110001");
  await page2.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page2.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page2.getByLabel("Firma Adı", { exact: true }).fill("EmailBypass Provider Firma");
  await page2.getByLabel("Hizmet Veren Tipi", { exact: true }).selectOption({ label: "Bireysel Hizmet Veren" });
  await selectSearchable(page2, "İl", "Kocaeli");
  await selectSearchable(page2, "İlçe", "Gebze");

  await page2.getByRole("group", { name: "Depo Hizmetleri" }).getByRole("button", { name: "Kapalı Depolama", exact: true }).click();

  const generalDoc = makePdf("email-bypass-genel-belge.pdf", "genel faaliyet belgesi");
  await page2.locator('input[type="file"]').setInputFiles(generalDoc);
  await page2.waitForTimeout(500);
  const docDeclarationCheckbox = page2.locator("label", { hasText: "Yüklediğim belgelerin güncel" }).locator('input[type="checkbox"]');
  await docDeclarationCheckbox.check();

  const legalCheckbox2 = page2.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox2.check();

  const submitButton2 = page2.getByRole("button", { name: /Hesap Oluştur|Belgeler doğrulanıyor/ });
  await assert.doesNotReject(
    (async () => {
      for (let i = 0; i < 40; i++) {
        const enabled = await submitButton2.isEnabled();
        if (enabled) return;
        await page2.waitForTimeout(500);
      }
      throw new Error("submit button never became enabled");
    })(),
  );
  await submitButton2.click();

  const sawEmailWaitScreen2 = await page2
    .getByText("E-postanızı Kontrol Edin")
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  record("6. Hizmet Veren: 'E-postanızı Kontrol Edin' ekranı GÖRÜNMEDİ (anında oturum açıldı)", !sawEmailWaitScreen2);

  const leftLoginPage2 = await page2
    .waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  record("7. Hizmet Veren: kayıt sonrası /giris-yap'tan başka bir sayfaya yönlendirildi (anında giriş)", leftLoginPage2, page2.url());
  // KRİTİK: /kayit-tamamla'ya HİÇ uğramamalı — signUp() zaten oturum döndürdüğü için
  // finishSupabaseRegistration() aynı adımda tetiklenir (bkz. login-form.tsx handleSubmit).
  record("8. Hizmet Veren: /kayit-tamamla'ya HİÇ yönlendirilmedi (tek adımda tamamlandı)", page2.url().indexOf("/kayit-tamamla") === -1, page2.url());

  const providerAuthUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const provUser = providerAuthUsers.data?.users.find((u) => u.email === providerEmail);
  if (provUser) createdUserIds.push(provUser.id);
  record("9. Hizmet Veren: Supabase Auth kullanıcısı email_confirmed_at DOLU (otomatik onaylandı)", Boolean(provUser?.email_confirmed_at), provUser?.email_confirmed_at ?? "yok");

  if (provUser) {
    const provProfileRows = runSql(`select role, onboarding_completed from public.profiles where id = '${provUser.id}';`);
    record("10. Hizmet Veren: profiles satırı doğru (role=hizmet-veren, onboarding_completed=true)", provProfileRows[0]?.role === "hizmet-veren" && provProfileRows[0]?.onboarding_completed === true, JSON.stringify(provProfileRows[0]));

    const serviceRows = runSql(`select count(*)::int as c from public.provider_services where provider_id = '${provUser.id}';`);
    record("11. Hizmet Veren: provider_services satırı yazıldı (hizmet kategorisi seçimi kalıcı)", (serviceRows[0]?.c ?? 0) > 0, JSON.stringify(serviceRows[0]));

    const docRows = runSql(`select count(*)::int as c from public.provider_documents where provider_id = '${provUser.id}' and deleted_at is null;`);
    record("12. Hizmet Veren: provider_documents satırı yazıldı (belge yükleme kalıcı)", (docRows[0]?.c ?? 0) > 0, JSON.stringify(docRows[0]));

    const consentRows = runSql(`select count(*)::int as c from public.provider_document_consents where provider_id = '${provUser.id}';`);
    record("13. Hizmet Veren: provider_document_consents satırı yazıldı (beyan onayı kalıcı)", (consentRows[0]?.c ?? 0) > 0, JSON.stringify(consentRows[0]));

    const legalConsentRows = runSql(`select count(*)::int as c from public.legal_consents where user_id = '${provUser.id}';`);
    record("14. Hizmet Veren: legal_consents satırları yazıldı (3 belge onayı kalıcı)", (legalConsentRows[0]?.c ?? 0) === 3, JSON.stringify(legalConsentRows[0]));
  } else {
    record("10-14. Hizmet Veren profil/belge/onay kontrolleri", false, "provUser bulunamadı");
  }

  await context2.close();
}

async function cleanup() {
  if (createdUserIds.length > 0) {
    const idList = createdUserIds.map((id) => `'${id}'`).join(",");
    runSql(`delete from public.provider_document_reviews where document_id in (select id from public.provider_documents where provider_id in (${idList}));`);
    runSql(`delete from public.provider_documents where provider_id in (${idList});`);
    runSql(`delete from public.provider_document_consents where provider_id in (${idList});`);
    runSql(`delete from public.provider_services where provider_id in (${idList});`);
    runSql(`delete from public.legal_consents where user_id in (${idList});`);
    runSql(`delete from public.notifications where recipient_id in (${idList});`);
    runSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (${idList});`);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  rmSync(scratchDir, { recursive: true, force: true });
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
