// node scripts/tmp-supabase-contact-messages-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna karşı: "Bize Ulaşın"ın Supabase'e tam cutover'ını uçtan uca
// doğrular — misafir gönderimi, oturumlu gönderim, admin panelinden
// durum/not güncelleme, cross-device (ayrı tarayıcı context'i) görünürlük,
// Dashboard'un "Açık Destek Mesajı" sayacının artık gerçekten dolu olması.
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
  console.error("FAIL: eksik ortam değişkeni");
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-contact-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

const createdUserIds = [];
let browser;

async function loginInPage(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
}

async function main() {
  const adminEmail = `malsevk-contactmsg-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({ email: adminEmail, password: PASSWORD, email_confirm: true });
  if (adminCreateError) throw new Error(`admin createUser: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(`update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Contact Admin' where id = '${adminUserId}';`);
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck[0]));

  // Başlangıç: bu admin'in "Açık Destek Mesajı" sayacı test öncesi kaç?
  // NOT: supabase-js'in { count: 'exact', head: true } seçeneği bu SDK
  // sürümünde/service-role bağlamında güvenilir bir sayı DÖNMEDİ (ilk
  // taslakta `null` geldi) — doğrudan SQL sayımı kullanılır (runSql zaten
  // diğer tüm doğrulamalarda "gerçek kaynak" olarak kullanılıyor).
  const before = Number(runSql(`select count(*) as c from public.contact_messages where status = 'yeni';`)[0]?.c ?? 0);

  browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // 1) MİSAFİR gönderimi — gerçek /bize-ulasin sayfası, oturum yok.
  // ---------------------------------------------------------------------
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const guestMessageText = `E2E misafir mesajı, en az on karakter uzunluğunda ${Date.now()}.`;
  await guestPage.goto(`${APP_ORIGIN}/bize-ulasin`);
  await guestPage.getByLabel("Ad Soyad", { exact: true }).fill("E2E Misafir Kullanıcı");
  await guestPage.getByLabel("Konu", { exact: true }).selectOption({ label: "Genel Bilgi" });
  await guestPage.getByLabel(/E-posta/).fill(`malsevk-contactmsg-guest-${Date.now()}@gmail.com`);
  await guestPage.getByLabel("Mesaj", { exact: true }).fill(guestMessageText);
  await guestPage.getByRole("button", { name: "Gönder" }).click();
  await assert.doesNotReject(guestPage.getByText("Mesajınız bize ulaştı.").waitFor({ state: "visible", timeout: 15000 }));
  record("1a. Misafir gönderimi UI'da başarı mesajı gösterdi", true);

  const guestRow = runSql(`select id, user_id, status from public.contact_messages where message = '${guestMessageText.replace(/'/g, "''")}';`);
  record("1b. DB: misafir mesajı gerçekten oluştu, user_id NULL, status='yeni'", guestRow.length === 1 && guestRow[0]?.user_id === null && guestRow[0]?.status === "yeni", JSON.stringify(guestRow[0]));
  await guestContext.close();

  // ---------------------------------------------------------------------
  // 2) OTURUMLU gönderim — gerçek hesap, admin bootstrap ile aynı yöntemle oluşturulup giriş yapılır.
  // ---------------------------------------------------------------------
  const requesterEmail = `malsevk-contactmsg-req-${Date.now()}@gmail.com`;
  const { data: reqCreate, error: reqCreateError } = await admin.auth.admin.createUser({ email: requesterEmail, password: PASSWORD, email_confirm: true });
  if (reqCreateError) throw new Error(`requester createUser: ${reqCreateError.message}`);
  createdUserIds.push(reqCreate.user.id);
  const reqClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await reqClient.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });
  await reqClient.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: "E2E Contact Requester", p_phone: "+905551234567",
    p_company_name: "E2E Contact Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  await reqClient.auth.signOut({ scope: "local" });

  const reqContext = await browser.newContext();
  const reqPage = await reqContext.newPage();
  await loginInPage(reqPage, requesterEmail);
  const reqMessageText = `E2E oturumlu mesaj, en az on karakter uzunluğunda ${Date.now()}.`;
  await reqPage.goto(`${APP_ORIGIN}/bize-ulasin`);
  // NOT: Ad Soyad/E-posta alanları oturumlu kullanıcı için profil'den ön-dolu
  // OLABİLİR, ama bu hidrasyon (hydrateLocalUserMirrorIfMissing) asenkrondur
  // ve garantili tamamlanmış olmayabilir (bkz. tmp-supabase-hizmet-veren-
  // onboarding-e2e-test.mjs'in AYNI konudaki 4 saniyelik bekleme notu) — bu
  // yüzden testin kendisi e-postayı AÇIKÇA doldurur, ön-dolgu zamanlamasına
  // güvenmez (ilk taslakta tam olarak bu yüzden "en az biri zorunlu" istemci
  // doğrulamasına takılıp zaman aşımına uğramıştı).
  await reqPage.getByLabel("Konu", { exact: true }).selectOption({ label: "Teknik Destek" });
  const nameField = reqPage.getByLabel("Ad Soyad", { exact: true });
  if (!(await nameField.inputValue())) await nameField.fill("E2E Contact Requester");
  const emailField = reqPage.getByLabel(/E-posta/);
  if (!(await emailField.inputValue())) await emailField.fill(requesterEmail);
  await reqPage.getByLabel("Mesaj", { exact: true }).fill(reqMessageText);
  await reqPage.getByRole("button", { name: "Gönder" }).click();
  await assert.doesNotReject(reqPage.getByText("Mesajınız bize ulaştı.").waitFor({ state: "visible", timeout: 15000 }));
  record("2a. Oturumlu gönderim UI'da başarı mesajı gösterdi", true);
  await reqContext.close();

  const reqRow = runSql(`select id, user_id, user_role, status from public.contact_messages where message = '${reqMessageText.replace(/'/g, "''")}';`);
  record(
    "2b. DB: oturumlu mesajın user_id/user_role'ü sunucu tarafında GERÇEK oturumdan geldi",
    reqRow.length === 1 && reqRow[0]?.user_id === reqCreate.user.id && reqRow[0]?.user_role === "hizmet-alan" && reqRow[0]?.status === "yeni",
    JSON.stringify(reqRow[0]),
  );

  // ---------------------------------------------------------------------
  // 3) CROSS-DEVICE: admin, TAMAMEN AYRI bir tarayıcı context'inde giriş yapıp her iki mesajı da görüyor mu?
  // ---------------------------------------------------------------------
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginInPage(adminPage, adminEmail);

  await adminPage.goto(`${APP_ORIGIN}/admin/iletisim-mesajlari`);
  await assert.doesNotReject(adminPage.getByText(guestMessageText).waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(adminPage.getByText(reqMessageText).waitFor({ state: "visible", timeout: 15000 }));
  record("3. Admin (AYRI tarayıcı context'i = cross-device eşdeğeri) her iki mesajı da görüyor", true);

  // 4) Dashboard'un "Açık Destek Mesajı" sayacı artık gerçekten artıyor mu?
  await adminPage.goto(`${APP_ORIGIN}/admin`);
  await assert.doesNotReject(adminPage.getByText("Açık Destek Mesajı").waitFor({ state: "visible", timeout: 15000 }));
  const dashCard = adminPage.locator("a", { has: adminPage.getByText("Açık Destek Mesajı") }).first();
  const dashCardHref = await dashCard.getAttribute("href");
  record("4a. Dashboard'daki 'Açık Destek Mesajı' kartı artık TIKLANABİLİR (Link)", dashCardHref === "/admin/iletisim-mesajlari", `href=${dashCardHref}`);
  const after = Number(runSql(`select count(*) as c from public.contact_messages where status = 'yeni';`)[0]?.c ?? 0);
  record("4b. DB: 'yeni' durumundaki mesaj sayısı en az 2 arttı (misafir + oturumlu)", after >= before + 2, `before=${before}, after=${after}`);
  await dashCard.click();
  await adminPage.waitForURL((url) => url.pathname === "/admin/iletisim-mesajlari", { timeout: 15000 });
  record("4c. Karta tıklamak gerçekten /admin/iletisim-mesajlari'e götürüyor", true);

  // 5) Admin durum + not güncelliyor — UI'dan.
  const guestCard = adminPage.locator("div.rounded-card", { has: adminPage.getByText(guestMessageText) }).first();
  await guestCard.locator("select").first().selectOption({ label: "İnceleniyor" });
  await guestCard.locator("textarea").fill("E2E test notu — yalnızca adminler görür.");
  await guestCard.getByRole("button", { name: "Kaydet" }).click();
  // NOT: düz getByText("İnceleniyor") hem render edilmiş StatusBadge span'ine
  // HEM DE <select> içindeki (aynı metne sahip) <option>'a eşleşir (strict-mode
  // ihlali, ilk taslakta bulundu) — yalnızca rozet span'ini hedefler.
  await assert.doesNotReject(guestCard.locator("span", { hasText: "İnceleniyor" }).waitFor({ state: "visible", timeout: 15000 }));
  record("5. Admin durum + not güncellemesi UI'da yansıdı", true);

  const guestRowAfter = runSql(`select status, admin_note, reviewed_by_admin_id from public.contact_messages where message = '${guestMessageText.replace(/'/g, "''")}';`);
  record(
    "5b. DB: status='inceleniyor', admin_note dolu, reviewed_by_admin_id=admin id",
    guestRowAfter[0]?.status === "inceleniyor" && !!guestRowAfter[0]?.admin_note && guestRowAfter[0]?.reviewed_by_admin_id === adminUserId,
    JSON.stringify(guestRowAfter[0]),
  );

  // 6) Non-admin review_contact_message çağıramaz — GERÇEKTEN authenticated
  // bir oturumla (reqClient bu noktada zaten signOut edilmişti, anon olarak
  // çağırmak MLK50'ye hiç ULAŞAMADAN ham bir Postgres izin hatası verirdi —
  // ilk taslakta tam olarak bu bulundu; ayrı, taze bir oturumla tekrar denenir).
  const nonAdminRecheckClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await nonAdminRecheckClient.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });
  const nonAdminAttempt = await nonAdminRecheckClient.rpc("review_contact_message", { p_id: reqRow[0]?.id, p_status: "cozuldu" });
  record("6. Normal kullanıcı review_contact_message çağıramaz (MLK50)", nonAdminAttempt.error?.code === "MLK50", `${nonAdminAttempt.error?.code}: ${nonAdminAttempt.error?.message}`);
  await nonAdminRecheckClient.auth.signOut({ scope: "local" });

  await adminContext.close();
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (browser) await browser.close();
    } catch {}
    try {
      const idList = createdUserIds.map((id) => `'${id}'`).join(", ");
      if (idList) {
        runSql(`delete from public.contact_messages where reviewed_by_admin_id in (${idList}) or user_id in (${idList}) or message like 'E2E %mesaj%';`);
        runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
        runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      }
    } catch (error) {
      console.warn("DB temizliği sırasında uyarı:", error?.message || error);
    }
    for (const id of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.warn(`Kullanıcı silinemedi (${id}): ${error.message}`);
    }
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {}

    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((f) => f.name).join(" | "));
      process.exitCode = 1;
    }
  });
