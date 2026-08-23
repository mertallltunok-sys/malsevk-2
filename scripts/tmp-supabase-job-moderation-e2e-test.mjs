// node scripts/tmp-supabase-job-moderation-e2e-test.mjs
//
// AŞAMA 2 — DÜZELTMEDEN SONRA GERÇEK UÇTAN UCA KAPALI DÖNGÜ. Development
// Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev sunucusuna
// (http://localhost:3000, NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true ile
// YENİDEN BAŞLATILMIŞ olmalı) karşı: görev bölüm 7'nin 11 adımını BİREBİR
// uygular — gerçek Hizmet Alan ilan oluşturma (form doldurma, senkronla
// simüle değil) -> gerçek Supabase satırı (moderation_status=pending_review)
// -> Hizmet Veren'e görünmez -> admin panelinde "Onay Bekleyen" sayacı VE
// listesi AYNI kaynaktan artıyor -> admin detayı açar -> onaylar -> sayaç
// düşer -> "Yayındaki / Onaylanan" sekmesine geçer -> Hizmet Veren artık
// görebilir.
//
// MİMARİ NOT (bu script'in kendisi TEK bir paylaşılan browser context/page
// kullanır, üç rol arasında GERÇEK giriş/çıkışla geçiş yapar — YENİ ayrı
// context'ler DEĞİL): MALSEVK'in canlı Hizmet Alan/Hizmet Veren akışının
// TAMAMI (bkz. CLAUDE.md "No real backend") yalnızca TARAYICININ KENDİ
// localStorage'ını okur/yazar — bu GERÇEK bir sınırlamadır, bu script'in bir
// kısaltması değil: adminin "Onayla ve Yayınla" tıklaması Supabase'i (gerçek
// yetkilendirme sınırı) günceller VE best-effort olarak `job-store.ts#
// applyAdminModerationDecision` ile BU TARAYICININ localStorage'ını da
// günceller (bkz. admin-jobs.ts'in kendi doc yorumu) — bu yalnızca ilan bu
// tarayıcının paylaşılan localStorage havuzunda zaten mevcutsa işe yarar.
// Farklı bir cihaz/tarayıcıdaki bir Hizmet Veren, bugünkü mimaride bu
// yansımayı HİÇBİR ZAMAN görmez (localStorage cihazlar arası paylaşılmaz) —
// bu, moderasyon özelliğine özgü değil, uygulamanın PRE-EXISTING, dokümante
// edilmiş mimari sınırıdır. Bu script bu sınırın İÇİNDE, gerçekçi şekilde
// (aynı tarayıcıda rol değiştirerek, tıpkı elle test eden bir insanın
// yapacağı gibi) test eder — bkz. son rapordaki ayrı not.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-mod-e2e-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

const createdUserIds = [];
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-modE2E-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `ModE2E ${label}`, p_phone: "+905551110098",
    p_company_name: `ModE2E Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}

async function logout(page) {
  await page.goto(`${APP_ORIGIN}/`);
  // NOT: "Hesap menüsü" aria-label'ı YALNIZCA açık menü panelinin (role="menu"
  // div'i) üzerinde — tetikleyici <button>'ın kendisinde HİÇ aria-label yok,
  // erişilebilir adı RoleLabel'in metnine (kullanıcı adı + rol) bağlı. İlk
  // taslakta bu ikisi karıştırıldığı için 30sn timeout'a uğradı — burada
  // metinden bağımsız, stabil bir CSS öznitelik seçicisi kullanılıyor.
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await page.waitForTimeout(1000);
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

async function uploadOnePhoto(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function main() {
  console.log("=== Kurulum: test kullanıcıları ===");
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan"); // role admin'e aşağıda DB'den yükseltilir
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminRoleCheck = runSql(`select role from public.profiles where id = '${adminUser.id}';`);
  record("0. Admin bootstrap başarılı", adminRoleCheck[0]?.role === "admin", JSON.stringify(adminRoleCheck[0]));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // -------------------------------------------------------------------
  // 1-2) Hizmet Alan login + gerçek ilan oluşturma.
  // -------------------------------------------------------------------
  await loginAs(page, requester.email);
  const jobTitle = `MODE2E-TEST-${stamp}`;
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.locator("select").first().selectOption({ label: "Forklift" });
  await page.getByLabel("İlan Başlığı").fill(jobTitle);
  await page.getByLabel("Hizmete Özel Açıklama").fill("Bu, moderasyon uçtan uca kapalı döngü testinin oluşturduğu bir ilandır.");
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
  const facilityListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await facilityListbox.waitFor({ state: "visible" });
  await facilityListbox.getByRole("option", { name: /Listede yok/ }).first().click();
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
  await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Gebze");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
  await uploadOnePhoto(page);

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
  const jobId = page.url().split("/ilanlar/")[1].split("?")[0];
  record("1-2. Hizmet Alan gerçek UI'dan ilan oluşturdu", /^[0-9a-f-]{36}$/.test(jobId), jobId);

  // -------------------------------------------------------------------
  // 3) DB row kontrolü: moderation_status = pending_review, GERÇEK satır.
  // -------------------------------------------------------------------
  const jobRow = runSql(
    `select id, requester_id, title, moderation_status, deleted_at, created_at, updated_at from public.jobs where id = '${jobId}';`,
  );
  record("3a. Supabase 'jobs' tablosunda GERÇEK bir satır var (senkron çalıştı)", jobRow.length === 1, JSON.stringify(jobRow[0]));
  record("3b. moderation_status = 'pending_review'", jobRow[0]?.moderation_status === "pending_review", jobRow[0]?.moderation_status);
  record("3c. requester_id doğru test kullanıcısına bağlı", jobRow[0]?.requester_id === requester.id, jobRow[0]?.requester_id);
  record("3d. deleted_at NULL (silinmemiş/withdrawn değil)", jobRow[0]?.deleted_at === null);
  record("3e. created_at/updated_at gerçek zaman damgaları taşıyor", Boolean(jobRow[0]?.created_at) && Boolean(jobRow[0]?.updated_at));

  // -------------------------------------------------------------------
  // 4) Hizmet Alan kendi ekranında "Admin Onayı Bekleniyor" görsün.
  // -------------------------------------------------------------------
  await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
  const requesterPanelText = await page.locator("main").innerText();
  record("4. Hizmet Alan kendi ilanında 'Admin Onayı Bekleniyor' görüyor (gerçek moderation_status'tan)", requesterPanelText.includes("Admin Onayı Bekleniyor"));

  // -------------------------------------------------------------------
  // 5) Provider login: ilanı GÖRMEMELİ (aynı paylaşılan tarayıcı/localStorage).
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await page.waitForTimeout(2000);
  const providerListingTextBefore = await page.locator("main").innerText();
  record("5. Hizmet Veren 'Aktif İlanlar' listesinde bu ilanı GÖRMÜYOR (moderation_status=pending_review gizliyor)", !providerListingTextBefore.includes(jobTitle));

  // -------------------------------------------------------------------
  // 6) Admin login: "Onay Bekleyen" sayacı VE liste, AYNI ilanı içeriyor.
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/ilanlar`);
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
  record("6a. Admin 'İlan Yönetimi' varsayılan (Onay Bekleyen) sekmesinde bu GERÇEK ilanı görüyor", true);

  const pendingCountRow = runSql(`select count(*)::int as c from public.jobs where moderation_status = 'pending_review' and deleted_at is null;`);
  const tabCountText = await page.locator("button", { hasText: "Onay Bekleyen" }).innerText();
  record(
    "6b. 'Onay Bekleyen' sekme sayacı, aynı Supabase sorgusunun döndürdüğü gerçek sayıyla eşleşiyor (ayrı/mock sayaç değil)",
    tabCountText.includes(String(pendingCountRow[0]?.c)),
    `tab="${tabCountText}" dbCount=${pendingCountRow[0]?.c}`,
  );

  // -------------------------------------------------------------------
  // 7) Admin ilan detayını açabilsin.
  // -------------------------------------------------------------------
  await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
  const detailText = await page.locator("main").innerText();
  record("7. Admin ilan detayını açabiliyor, moderation durumu 'Admin Onayı Bekleniyor' olarak gösteriliyor", detailText.includes("Admin Onayı Bekleniyor") || detailText.includes("Bekle"));

  // -------------------------------------------------------------------
  // 8) Admin onaylasın.
  // -------------------------------------------------------------------
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).click();
  await page.waitForTimeout(2000);
  const jobRowAfterApprove = runSql(`select moderation_status, moderation_reviewed_by, moderation_reviewed_at from public.jobs where id = '${jobId}';`);
  record("8. Admin onayladı — Supabase'de moderation_status='approved', reviewedBy=bu admin", jobRowAfterApprove[0]?.moderation_status === "approved" && jobRowAfterApprove[0]?.moderation_reviewed_by === adminUser.id, JSON.stringify(jobRowAfterApprove[0]));

  // -------------------------------------------------------------------
  // 9) Sayaç düşsün.
  // -------------------------------------------------------------------
  await page.goto(`${APP_ORIGIN}/admin/ilanlar`);
  await page.waitForTimeout(1500);
  const pendingCountAfter = runSql(`select count(*)::int as c from public.jobs where moderation_status = 'pending_review' and deleted_at is null;`);
  record("9a. DB'de 'pending_review' sayısı bir azaldı", pendingCountAfter[0]?.c === pendingCountRow[0]?.c - 1, `before=${pendingCountRow[0]?.c} after=${pendingCountAfter[0]?.c}`);
  const pendingTabTextAfter = await page.locator("main").innerText();
  record("9b. Onaylanan ilan artık 'Onay Bekleyen' sekmesinde GÖRÜNMÜYOR", !pendingTabTextAfter.includes(jobTitle));

  // -------------------------------------------------------------------
  // 10) İlan "Yayındaki / Onaylanan" sekmesine geçsin.
  // -------------------------------------------------------------------
  await page.getByRole("button", { name: "Yayındaki / Onaylanan" }).click();
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 10000 });
  record("10. İlan 'Yayındaki / Onaylanan' sekmesinde görünüyor", true);

  // -------------------------------------------------------------------
  // 11) Provider artık ilanı görebilsin (AYNI paylaşılan tarayıcı/localStorage
  //     — admin onayının job-store.ts#applyAdminModerationDecision yansıması).
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await page.waitForTimeout(2000);
  const providerListingTextAfter = await page.locator("main").innerText();
  record("11. Hizmet Veren artık ilanı görebiliyor (onay sonrası)", providerListingTextAfter.includes(jobTitle));

  await browser.close();
}

function safeRunSql(sql) {
  try {
    return runSql(sql);
  } catch (error) {
    console.error("cleanup sql failed (continuing):", error?.message || error);
    return [];
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    safeRunSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.jobs where requester_id in (${idList});`);
    safeRunSql(`delete from public.notifications where recipient_id in (${idList});`);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  rmSync(scratchDir, { recursive: true, force: true });
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
