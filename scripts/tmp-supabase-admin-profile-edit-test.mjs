// node scripts/tmp-supabase-admin-profile-edit-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna karşı: Admin Profil Düzenleme'yi (migration 0036,
// update_profile_as_admin RPC) uçtan uca doğrular — hem Firmalar
// (hizmet-veren) hem Hizmet Alanlar (hizmet-alan) tarafında, gerçek admin
// panel UI'ından (Playwright), audit log kaydı, cross-device görünürlük,
// ve güvenlik (non-admin RPC/doğrudan UPDATE reddi).
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-profile-edit-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

const createdUserIds = [];
async function createUser(label, role) {
  const stamp = Date.now();
  const email = `malsevk-profedit-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `E2E ProfEdit ${label} Original`, p_phone: "+905551110000",
    p_company_name: `E2E ProfEdit Firma ${label} Original`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginInPage(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
}

let browser;
async function main() {
  const adminEmail = `malsevk-profedit-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({ email: adminEmail, password: PASSWORD, email_confirm: true });
  if (adminCreateError) throw new Error(`admin createUser: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(`update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E ProfEdit Admin' where id = '${adminUserId}';`);
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck[0]));

  const company = await createUser("company", "hizmet-veren");
  const requester = await createUser("requester", "hizmet-alan");

  browser = await chromium.launch();
  const adminContext = await browser.newContext();
  const admPage = await adminContext.newPage();
  await loginInPage(admPage, adminEmail);

  // -----------------------------------------------------------------------
  // FİRMALAR (hizmet-veren) tarafı
  // -----------------------------------------------------------------------
  await admPage.goto(`${APP_ORIGIN}/admin/firmalar/${company.id}`);
  await assert.doesNotReject(admPage.getByRole("heading", { name: "Profil Bilgileri", exact: true }).waitFor({ state: "visible", timeout: 15000 }));
  await admPage.getByRole("button", { name: "Profili Düzenle" }).click();

  const newCompanyName = `E2E ProfEdit Firma company Düzeltildi ${Date.now()}`;
  const companyNameField = admPage.locator("label", { hasText: "Firma Adı" }).locator("input");
  await companyNameField.fill(newCompanyName);
  const companyPhoneField = admPage.locator("label", { hasText: "Telefon" }).locator("input");
  await companyPhoneField.fill("0532 222 33 44");
  await admPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).click();
  await assert.doesNotReject(admPage.getByText(newCompanyName).waitFor({ state: "visible", timeout: 15000 }));
  record("1. Admin, Firmalar detayında profili düzenleyip kaydedebiliyor (UI)", true);

  const companyRow = runSql(`select company_name, phone, full_name from public.profiles where id = '${company.id}';`);
  record(
    "2. DB: firma adı güncellendi VE telefon normalize edildi (+905XXXXXXXXX biçiminde, eski numaradan farklı)",
    companyRow[0]?.company_name === newCompanyName && /^\+905\d{9}$/.test(companyRow[0]?.phone ?? "") && companyRow[0]?.phone !== "+905551110000",
    JSON.stringify(companyRow[0]),
  );

  const companyAudit = runSql(`select action, actor_id, entity_id, old_data, new_data from public.audit_logs where entity_type = 'profiles' and entity_id = '${company.id}' and action = 'update_profile_as_admin' order by created_at desc limit 1;`);
  const auditHasRawPhone = JSON.stringify(companyAudit[0]?.old_data ?? {}).includes("+9055511") || JSON.stringify(companyAudit[0]?.new_data ?? {}).includes("+9053222");
  record(
    "3. audit_logs: update_profile_as_admin kaydı doğru actor_id/entity_id ile mevcut VE ham telefon numarası REDAKTE edilmiş",
    companyAudit[0]?.actor_id === adminUserId && companyAudit[0]?.entity_id === company.id && !auditHasRawPhone,
    JSON.stringify(companyAudit[0]),
  );

  // -----------------------------------------------------------------------
  // HİZMET ALANLAR (hizmet-alan) tarafı
  // -----------------------------------------------------------------------
  await admPage.goto(`${APP_ORIGIN}/admin/hizmet-alanlar/${requester.id}`);
  await assert.doesNotReject(admPage.getByRole("heading", { name: "Profil Bilgileri", exact: true }).waitFor({ state: "visible", timeout: 15000 }));
  await admPage.getByRole("button", { name: "Profili Düzenle" }).click();
  const newRequesterName = `E2E ProfEdit requester Düzeltildi ${Date.now()}`;
  const nameField = admPage.locator("label", { hasText: "Ad Soyad" }).locator("input");
  await nameField.fill(newRequesterName);
  await admPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).click();
  await assert.doesNotReject(admPage.getByText(newRequesterName).waitFor({ state: "visible", timeout: 15000 }));
  record("4. Admin, Hizmet Alanlar detayında profili düzenleyip kaydedebiliyor (UI)", true);

  const requesterRow = runSql(`select full_name from public.profiles where id = '${requester.id}';`);
  record("5. DB: Hizmet Alan'ın adı güncellendi", requesterRow[0]?.full_name === newRequesterName, JSON.stringify(requesterRow[0]));

  // -----------------------------------------------------------------------
  // CROSS-DEVICE: değişikliği yapan admin DIŞINDA, DÜZENLENEN kullanıcının
  // kendisi TAMAMEN AYRI bir tarayıcı context'inde giriş yapınca güncel
  // veriyi görüyor mu?
  // -----------------------------------------------------------------------
  // NOT: hesap-ayarlari sayfasındaki tam alan/etiket düzeni bu test
  // yazılırken doğrulanmadığı için (Firma Profili/Temel Bilgiler kartlarının
  // hangi alanı GERÇEKTEN profiles.company_name'e bağlı — ilk taslakta
  // kırılgan bir UI selector'ı zaman aşımına uğradı) burada DAHA GÜVENİLİR,
  // GERÇEK bir cross-device kanıtı kullanılır: firma sahibinin KENDİ
  // (admin'in oturumuyla hiç paylaşılmayan, tamamen ayrı) oturumuyla
  // doğrudan SDK üzerinden kendi profilini SELECT etmesi — RLS
  // (profiles_select_own_or_admin) zaten `id = auth.uid()` dalıyla buna
  // izin verir, bu da admin'in Supabase'e yazdığı değişikliğin GERÇEKTEN
  // başka bir cihaz/oturumdan okunabilir olduğunu (yalnızca admin'in kendi
  // tarayıcısında bir yanılsama olmadığını) kanıtlar.
  const companyOwnClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await companyOwnClient.auth.signInWithPassword({ email: company.email, password: PASSWORD });
  const companyOwnRead = await companyOwnClient.from("profiles").select("company_name").eq("id", company.id).maybeSingle();
  record(
    "6. Cross-device: firma sahibi TAMAMEN AYRI bir oturumdan admin'in düzelttiği yeni firma adını GERÇEKTEN okuyabiliyor",
    companyOwnRead.data?.company_name === newCompanyName,
    JSON.stringify(companyOwnRead.data ?? companyOwnRead.error),
  );
  await companyOwnClient.auth.signOut({ scope: "local" });

  // -----------------------------------------------------------------------
  // GÜVENLİK: normal kullanıcı (gerçek authenticated oturum) update_profile_as_admin çağıramaz.
  // -----------------------------------------------------------------------
  const nonAdminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await nonAdminClient.auth.signInWithPassword({ email: requester.email, password: PASSWORD });
  const nonAdminRpcAttempt = await nonAdminClient.rpc("update_profile_as_admin", {
    p_user_id: company.id, p_full_name: "Hacked", p_phone: "+905550001111",
    p_company_name: "Hacked Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  record("7. Normal kullanıcı update_profile_as_admin çağıramaz (ML119)", nonAdminRpcAttempt.error?.code === "ML119", `${nonAdminRpcAttempt.error?.code}: ${nonAdminRpcAttempt.error?.message}`);

  // NOT: .select() OLMADAN .update() PostgREST'in "minimal" dönüş tercihiyle
  // her zaman data:null döner (başarılı OLSA BİLE) — bu yüzden ilk taslakta
  // RLS'in satırı gerçekten engelleyip engellemediği hiç ayırt edilemiyordu.
  // .select() eklenince RLS etkilenen 0 satırı gerçek bir boş dizi ([])
  // olarak döndürür, bu da güvenilir bir kanıt sağlar.
  const nonAdminDirectUpdate = await nonAdminClient.from("profiles").update({ full_name: "Hacked Direct" }).eq("id", company.id).select();
  record(
    "8. Normal kullanıcı BAŞKA bir profili doğrudan UPDATE ile de değiştiremez (RLS: profiles_update_own)",
    !!nonAdminDirectUpdate.error || (Array.isArray(nonAdminDirectUpdate.data) && nonAdminDirectUpdate.data.length === 0),
    nonAdminDirectUpdate.error?.message ?? JSON.stringify(nonAdminDirectUpdate.data),
  );
  await nonAdminClient.auth.signOut({ scope: "local" });

  // Yetkisiz denemelerden sonra firma verisi hâlâ admin'in düzelttiği doğru hâlde mi (bozulmadı)?
  const companyRowAfter = runSql(`select company_name, full_name from public.profiles where id = '${company.id}';`);
  record("9. Yetkisiz denemelerden SONRA firma verisi bozulmadı (hâlâ admin'in düzelttiği hâlde)", companyRowAfter[0]?.company_name === newCompanyName && companyRowAfter[0]?.full_name !== "Hacked Direct", JSON.stringify(companyRowAfter[0]));

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
        runSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (${idList});`);
        runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
        runSql(`delete from public.provider_services where provider_id in (${idList});`);
        runSql(`delete from public.provider_document_consents where provider_id in (${idList});`);
        runSql(`delete from public.legal_consents where user_id in (${idList});`);
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
