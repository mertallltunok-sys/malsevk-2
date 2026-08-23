// node scripts/tmp-supabase-company-suspend-reinstate-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev server'a
// (http://localhost:3000, npm run dev zaten çalışıyor olmalı) karşı: yeni
// eklenen /admin/firmalar/[id] "Hesap İşlemleri" (askıya alma/geri açma)
// UI'ını uçtan uca doğrular. `admin-requester-detail.tsx`/`admin-requesters.ts`
// ("Hizmet Alanlar") ile AYNI, zaten var olan `suspend_user`/`reinstate_user`
// RPC'lerini (0016) kullanır — bu script YENİ bir RPC/migration/ikinci bir
// askıya alma sistemi VARSAYMAZ, yalnızca "Firmalar" (hizmet-veren) tarafında
// aynı akışın gerçekten çalıştığını kanıtlar.
//
// Gerekli ortam değişkenleri (shell tarafından export edilir, hiçbir zaman
// diske yazılmaz/loglanmaz): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST (yalnızca test kullanıcısı kurulumu/temizliği +
// admin bootstrap/DB doğrulaması için).
//
// `profiles.role='admin'` ataması hiçbir client-callable RPC/GRANT ile mümkün
// değildir (bkz. tmp-supabase-provider-document-review-test.mjs'in AYNI notu)
// — bu script bunu `npx supabase db query --linked --file` ile DOĞRUDAN DB
// erişimiyle yapar; supabase CLI'nin bu makinede `trfnmpihcnriqgikglpu`
// projesine `supabase link` ile bağlı olması ÖN KOŞULDUR (prod, pltjquhskyckrgtbvgog,
// bu makinede KASITLI OLARAK linked=false — `--linked` prod'a asla dokunamaz).
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
  console.error(`FAIL: NEXT_PUBLIC_SUPABASE_URL beklenen development projeyi (trfnmpihcnriqgikglpu) işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-company-suspend-"));

/** Doğrudan DB erişimi — yalnızca (a) admin bootstrap, (b) DB-seviyesi doğrulama, (c) temizlik için. */
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

async function createHizmetVeren(label) {
  const stamp = Date.now();
  const email = `malsevk-companysuspend-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-veren",
    p_full_name: `E2E Firma Yetkilisi ${label}`,
    p_phone: "+905551234567",
    p_company_name: `E2E Askı Testi Firma ${label}`,
    p_company_type: "limited-sirket",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  await client.auth.signOut();
  return { userId, email, client };
}

async function loginInNewContext(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
  return { context, page };
}

async function cookieHeaderFromContext(context) {
  const cookies = await context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const createdUserIds = [];
let browser;

async function main() {
  // ---------------------------------------------------------------------
  // KURULUM: admin + iki hizmet-veren ("Firmalar") hesabı.
  // ---------------------------------------------------------------------
  const adminEmail = `malsevk-companysuspend-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);

  runSql(
    `update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Test Admin' where id = '${adminUserId}';`,
  );
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap doğrudan DB erişimiyle başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck));

  const providerA = await createHizmetVeren("a"); // askıya alınıp geri açılacak firma
  createdUserIds.push(providerA.userId);
  const providerB = await createHizmetVeren("b"); // non-admin HTTP/RPC red testleri için
  createdUserIds.push(providerB.userId);

  // ---------------------------------------------------------------------
  // 1) Hizmet Veren başlangıçta active.
  // ---------------------------------------------------------------------
  const initialStatus = runSql(`select account_status from public.profiles where id = '${providerA.userId}';`);
  record("1. Hizmet Veren (Firma A) başlangıçta account_status='active'", initialStatus[0]?.account_status === "active", JSON.stringify(initialStatus[0]));

  // ---------------------------------------------------------------------
  // TARAYICI AKIŞI — gerçek /admin/firmalar/[id] UI'ı üzerinden.
  // ---------------------------------------------------------------------
  browser = await chromium.launch();
  const { context: adminContext, page: adminPage } = await loginInNewContext(browser, adminEmail);

  await adminPage.goto(`${APP_ORIGIN}/admin/firmalar/${providerA.userId}`);
  await assert.doesNotReject(adminPage.getByText("Hesap İşlemleri").waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(adminPage.getByText("Aktif", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }));
  record("UI-0. Firma detay sayfası 'Hesap İşlemleri' kartıyla ve 'Aktif' rozetiyle açılıyor", true);

  // 2) Admin suspend_user çağırıyor (UI: Askıya Al -> gerekçe -> Onayla).
  await adminPage.getByRole("button", { name: "Askıya Al" }).click();
  const suspendReasonInput = adminPage.locator("#admin-company-suspend-reason");
  await assert.doesNotReject(suspendReasonInput.waitFor({ state: "visible", timeout: 5000 }));
  await suspendReasonInput.fill("E2E test: firma sahte belge şüphesiyle askıya alındı.");
  await adminPage.getByRole("button", { name: "Onayla" }).click();

  // İşlem sonrası UI anında güncelleniyor mu? (refreshKey -> yeniden fetch, sayfa reload YOK)
  await assert.doesNotReject(adminPage.getByText("Askıya Alınmış").waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(adminPage.getByRole("button", { name: "Askıyı Kaldır" }).waitFor({ state: "visible", timeout: 10000 }));
  record("2-3. UI: Askıya Al sonrası rozet ANINDA 'Askıya Alınmış' oldu ve buton 'Askıyı Kaldır'a döndü (sayfa yenilenmeden)", true);

  // 3) account_status -> suspended (DB, gerçek kaynak).
  const suspendedStatus = runSql(`select account_status from public.profiles where id = '${providerA.userId}';`);
  record("3. DB: account_status='suspended'", suspendedStatus[0]?.account_status === "suspended", JSON.stringify(suspendedStatus[0]));

  // 4) Audit log kaydı oluşuyor (suspend_user).
  const suspendAudit = runSql(
    `select action, entity_type, entity_id, actor_id, new_data->>'reason' as reason from public.audit_logs where entity_type = 'profiles' and entity_id = '${providerA.userId}' and action = 'suspend_user' order by created_at desc limit 1;`,
  );
  record(
    "4. audit_logs: suspend_user kaydı doğru actor_id/entity_id/reason ile mevcut",
    suspendAudit[0]?.actor_id === adminUserId && suspendAudit[0]?.entity_id === providerA.userId && !!suspendAudit[0]?.reason,
    JSON.stringify(suspendAudit[0]),
  );

  // 5) Admin reinstate_user çağırıyor (UI: Askıyı Kaldır -> onay).
  await adminPage.getByRole("button", { name: "Askıyı Kaldır" }).click();
  await assert.doesNotReject(adminPage.getByText("Bu hesabın askısını kaldırıp").waitFor({ state: "visible", timeout: 5000 }));
  await adminPage.getByRole("button", { name: "Evet, Askıyı Kaldır" }).click();

  await assert.doesNotReject(adminPage.getByText("Aktif", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(adminPage.getByRole("button", { name: "Askıya Al" }).waitFor({ state: "visible", timeout: 10000 }));
  record("5. UI: Askıyı Kaldır sonrası rozet ANINDA 'Aktif' oldu ve buton 'Askıya Al'a döndü", true);

  // 6) account_status -> active.
  const reinstatedStatus = runSql(`select account_status from public.profiles where id = '${providerA.userId}';`);
  record("6. DB: account_status='active' (geri açıldı)", reinstatedStatus[0]?.account_status === "active", JSON.stringify(reinstatedStatus[0]));

  // 7) Audit log kaydı oluşuyor (reinstate_user).
  const reinstateAudit = runSql(
    `select action, entity_type, entity_id, actor_id from public.audit_logs where entity_type = 'profiles' and entity_id = '${providerA.userId}' and action = 'reinstate_user' order by created_at desc limit 1;`,
  );
  record(
    "7. audit_logs: reinstate_user kaydı doğru actor_id/entity_id ile mevcut",
    reinstateAudit[0]?.actor_id === adminUserId && reinstateAudit[0]?.entity_id === providerA.userId,
    JSON.stringify(reinstateAudit[0]),
  );

  const adminCookieHeader = await cookieHeaderFromContext(adminContext);
  await adminContext.close();

  // ---------------------------------------------------------------------
  // 8) Non-admin suspend/reinstate çağrısı reddediliyor (RPC seviyesi, UI değil).
  // ---------------------------------------------------------------------
  const nonAdminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await nonAdminClient.auth.signInWithPassword({ email: providerB.email, password: PASSWORD });
  const nonAdminSuspendAttempt = await nonAdminClient.rpc("suspend_user", { p_user_id: providerA.userId, p_reason: "yetkisiz deneme" });
  record(
    "8a. Admin olmayan hesap suspend_user çağıramaz (MLK82)",
    nonAdminSuspendAttempt.error?.code === "MLK82",
    `${nonAdminSuspendAttempt.error?.code}: ${nonAdminSuspendAttempt.error?.message}`,
  );
  const nonAdminReinstateAttempt = await nonAdminClient.rpc("reinstate_user", { p_user_id: providerA.userId });
  record(
    "8b. Admin olmayan hesap reinstate_user çağıramaz (MLK82)",
    nonAdminReinstateAttempt.error?.code === "MLK82",
    `${nonAdminReinstateAttempt.error?.code}: ${nonAdminReinstateAttempt.error?.message}`,
  );
  // Ek: RLS UPDATE de yok — admin olmayan hesap profiles.account_status'u doğrudan UPDATE ile de değiştiremez.
  const nonAdminDirectUpdate = await nonAdminClient.from("profiles").update({ account_status: "suspended" }).eq("id", providerA.userId);
  record(
    "8c. Admin olmayan hesap profiles.account_status'u DOĞRUDAN UPDATE ile de değiştiremez",
    !!nonAdminDirectUpdate.error || (Array.isArray(nonAdminDirectUpdate.data) && nonAdminDirectUpdate.data.length === 0),
    nonAdminDirectUpdate.error?.message ?? JSON.stringify(nonAdminDirectUpdate.data),
  );

  // account_status hâlâ 'active' olmalı (8a/8b'nin gerçek bir yan etkisi olmadı).
  const stillActiveStatus = runSql(`select account_status from public.profiles where id = '${providerA.userId}';`);
  record("8d. Yetkisiz denemelerden SONRA account_status hâlâ 'active'", stillActiveStatus[0]?.account_status === "active", JSON.stringify(stillActiveStatus[0]));

  const nonAdminCookieHeader = await (async () => {
    const { context } = await loginInNewContext(browser, providerB.email);
    const header = await cookieHeaderFromContext(context);
    await context.close();
    return header;
  })();
  // ÖNEMLİ: scope 'local' OLMADAN varsayılan signOut() GLOBAL'dir — bu kullanıcının
  // TÜM oturumlarını (bu SDK client'ınki dahil, ama AYRICA az önce cookieHeaderFromContext
  // için ayrı bir tarayıcı bağlamında açılan providerB oturumunu DA) iptal eder,
  // bu da aşağıdaki 9b/9c HTTP testlerini providerB'nin çerezi hâlâ geçerliyken
  // değil, zaten iptal edilmiş bir çerezle çalıştırırdı (gerçek bir uygulama
  // hatası DEĞİL, bu script'in ilk taslağında bulunan bir test hatasıydı).
  await nonAdminClient.auth.signOut({ scope: "local" });

  // ---------------------------------------------------------------------
  // 9) HTTP: admin -> 200, non-admin -> 404, oturumsuz -> 307.
  // ---------------------------------------------------------------------
  const targetPath = `/admin/firmalar/${providerA.userId}`;

  const adminResp = await fetch(`${APP_ORIGIN}${targetPath}`, { headers: { Cookie: adminCookieHeader }, redirect: "manual" });
  record("9a. Admin oturumuyla GET /admin/firmalar/[id] -> 200", adminResp.status === 200, String(adminResp.status));

  const nonAdminResp = await fetch(`${APP_ORIGIN}${targetPath}`, { headers: { Cookie: nonAdminCookieHeader }, redirect: "manual" });
  record("9b. Admin olmayan oturumla GET /admin/firmalar/[id] -> 404 (notFound, rota varlığı gizleniyor)", nonAdminResp.status === 404, String(nonAdminResp.status));

  const anonResp = await fetch(`${APP_ORIGIN}${targetPath}`, { redirect: "manual" });
  record("9c. Oturumsuz GET /admin/firmalar/[id] -> 307 (giriş yönlendirmesi)", anonResp.status === 307, String(anonResp.status));
  const anonLocation = anonResp.headers.get("location") || "";
  record("9d. Oturumsuz yönlendirme /giris-yap'a gidiyor", anonLocation.includes("/giris-yap"), anonLocation);
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {}

  try {
    const idList = createdUserIds.map((id) => `'${id}'`).join(", ");
    if (idList) {
      runSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
    }
  } catch (error) {
    console.warn("DB temizliği sırasında uyarı (auth kullanıcı silme yine de denenecek):", error?.message || error);
  }

  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`Kullanıcı silinemedi (${id}): ${error.message}`);
  }

  try {
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
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
      console.log("Başarısız:", failed.map((f) => f.name).join(" | "));
      process.exitCode = 1;
    }
  });
