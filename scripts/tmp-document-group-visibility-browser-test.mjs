// Real Development project + real browser (localhost:3000), ONE shared
// browser context throughout (job DATA is localStorage, shared per-browser —
// bkz. CLAUDE.md "No real backend" / "Admin panel modularization" notu:
// bir ilan farklı rollerin canlı ekranına ancak AYNI origin/localStorage'ı
// paylaşıyorlarsa yansır). TEST A (Depo Hizmetleri) ve TEST B (Operatör/İş
// Makinesi) — gerçek job-request-form.tsx üzerinden gerçek ilan oluşturma,
// gerçek admin onayı (İlan Yönetimi UI), gerçek belge yükleme+onay (RPC,
// zaten ayrıca kapsamlıca test edildi), ve gerçek /ilanlar görünürlüğü.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SUPA_URL = "https://trfnmpihcnriqgikglpu.supabase.co";
const SUPA_ANON = "sb_publishable_fRjAnKgqDtDsxR5au68D2Q_0WYDsYvX";
const BASE_URL = "http://localhost:3000";
const PASSWORD = "TestSifre2026!Dev";

let c = 0;
function sql(query) {
  const file = path.join(tmpdir(), `malsevk-0044-vistest2-${process.pid}-${c++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).rows;
  } finally { try { unlinkSync(file); } catch {} }
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}
const client = () => createClient(SUPA_URL, SUPA_ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

// UI dropdown'ı tıklamak yerine (kırılgan — sayfa düzenine göre farklı
// menüler/tetikleyiciler olabilir) doğrudan auth çerezini temizliyoruz —
// @supabase/ssr oturumu localStorage'a DEĞİL çereze yazar (bkz. app/_lib/
// supabase/browser-client.ts), bu yüzden bu, localStorage'daki (paylaşılan)
// ilan verisine HİÇ dokunmadan gerçek bir çıkışla AYNI etkiyi yaratır.
async function logout(context) {
  await context.clearCookies();
}

async function createJobViaForm(page, { categoryId, title, needsLocation }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption(categoryId);
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill(`${title} — 0044 görünürlük testi açıklaması, en az yirmi karakter.`);
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-15");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-15");
  // İlçe (bir SearchableSelect, native <select> DEĞİL) her kategoride
  // gösterilir — yalnızca Bölge/Tesis + Açık Adres, sadeleştirilmiş konum
  // kategorilerinde (Kapalı/Açık Saha Depolama, Gümrük Müşavirliği) hiç
  // render edilmez (bkz. isSimplifiedLocationCategory).
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  if (needsLocation) {
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
    await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().waitFor({ state: "visible" });
    await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().getByRole("option", { name: "Beldeport", exact: false }).first().click();
    await page.getByLabel("Açık Adres").first().fill("Test Mahallesi, Test Caddesi No:1, Dilovası, en az yirmi karakter.");
  }
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "test-fixture.jpg", mimeType: "image/jpeg", buffer: Buffer.from(TINY_JPEG_BASE64, "base64") });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[type="submit"]');
    return button && !button.disabled;
  }, { timeout: 15000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("button", { name: "İlanı Yayınla" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  const jobId = page.url().split("/ilanlar/")[1]?.split("?")[0];
  return jobId;
}

async function approveJobViaAdminUI(page, title) {
  await page.goto(`${BASE_URL}/admin/ilanlar`);
  await page.locator('input[type="search"]').waitFor({ state: "visible", timeout: 10000 });
  await page.locator('input[type="search"]').fill(title);
  await page.waitForTimeout(1000);
  await page.locator("tr", { hasText: title }).first().getByRole("link", { name: "Detay" }).click();
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).click();
  await page.waitForTimeout(2000);
}

const stamp = Date.now();
const adminEmail = `malsevk-test-visadm-${stamp}@mailinator.com`;
const requesterEmail = `malsevk-test-visreq-${stamp}@mailinator.com`;
const providerAEmail = `malsevk-test-visprovA-${stamp}@mailinator.com`;
const providerBEmail = `malsevk-test-visprovB-${stamp}@mailinator.com`;
let adminId, requesterId, providerAId, providerBId;
let browser;

try {
  const ac = client(); adminId = (await ac.auth.signUp({ email: adminEmail, password: PASSWORD })).data.user.id;
  const rc = client(); requesterId = (await rc.auth.signUp({ email: requesterEmail, password: PASSWORD })).data.user.id;
  const pac = client(); providerAId = (await pac.auth.signUp({ email: providerAEmail, password: PASSWORD })).data.user.id;
  const pbc = client(); providerBId = (await pbc.auth.signUp({ email: providerBEmail, password: PASSWORD })).data.user.id;
  sql(`update auth.users set email_confirmed_at = now() where id in ('${adminId}','${requesterId}','${providerAId}','${providerBId}');`);
  await ac.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
  await rc.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });
  await pac.auth.signInWithPassword({ email: providerAEmail, password: PASSWORD });
  await pbc.auth.signInWithPassword({ email: providerBEmail, password: PASSWORD });
  record("4 test hesabı oluşturuldu (admin/requester/providerA/providerB)", true);

  await ac.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Vis2 Test Admin Owner", p_phone: "+905321119301", p_company_name: "Vis2 Test Admin Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
  sql(`update public.profiles set role='admin', onboarding_completed=true where id='${adminId}';`);
  await rc.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Vis2 Test Requester", p_phone: "+905321119302", p_company_name: "Vis2 Test Requester Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
  await pac.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Vis2 Test Provider A", p_phone: "+905321119303", p_company_name: "Vis2 Test Provider A Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze" });
  await pbc.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Vis2 Test Provider B", p_phone: "+905321119304", p_company_name: "Vis2 Test Provider B Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Darıca" });

  // Group document upload + approval — RPC (authorization mekanizması zaten
  // ayrıca kapsamlıca doğrulandı, burada yalnızca UI görünürlüğünü beslemek
  // için gerekli).
  const { data: depoDoc, error: depoErr } = await pac.rpc("create_provider_document", { p_document_type: "depo-hizmetleri-belgesi", p_storage_path: `${providerAId}/depo.pdf`, p_original_file_name: "depo.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 111 });
  if (depoErr) throw depoErr;
  const { error: depoApproveErr } = await ac.rpc("review_provider_document", { p_document_id: depoDoc.id, p_status: "approved" });
  if (depoApproveErr) throw depoApproveErr;
  const { data: opDoc, error: opErr } = await pbc.rpc("create_provider_document", { p_document_type: "operator-is-makinesi-belgesi", p_storage_path: `${providerBId}/operator.pdf`, p_original_file_name: "operator.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 111 });
  if (opErr) throw opErr;
  const { error: opApproveErr } = await ac.rpc("review_provider_document", { p_document_id: opDoc.id, p_status: "approved" });
  if (opApproveErr) throw opApproveErr;
  record("Provider A depo + Provider B operatör belgesi yüklendi ve onaylandı (RPC)", true);

  browser = await chromium.launch();
  const page = await browser.newPage();

  // ===== Gerçek UI: requester 3 ilan oluşturuyor =====
  await loginAs(page, requesterEmail, PASSWORD, "/panel");
  const titleGenelDepo = `TESTVIS2-${stamp} Genel Depolama`;
  const titleKapaliDepo = `TESTVIS2-${stamp} Kapali Depolama`;
  const titleForklift = `TESTVIS2-${stamp} Forklift`;
  await createJobViaForm(page, { categoryId: "genel-depolama", title: titleGenelDepo, needsLocation: true });
  record("Requester (gerçek form) Genel Depolama ilanı yayınladı", true);
  await createJobViaForm(page, { categoryId: "kapali-depolama", title: titleKapaliDepo, needsLocation: false });
  record("Requester (gerçek form) Kapalı Depolama ilanı yayınladı (sadeleştirilmiş konum)", true);
  await createJobViaForm(page, { categoryId: "forklift", title: titleForklift, needsLocation: true });
  record("Requester (gerçek form) Forklift ilanı yayınladı", true);
  await logout(page.context());

  // ===== Gerçek UI: admin her 3 ilanı da onaylıyor =====
  await loginAs(page, adminEmail, PASSWORD, "/admin");
  await approveJobViaAdminUI(page, titleGenelDepo);
  await approveJobViaAdminUI(page, titleKapaliDepo);
  await approveJobViaAdminUI(page, titleForklift);
  record("Admin (gerçek İlan Yönetimi ekranı) her 3 ilanı da onayladı", true);
  await logout(page.context());

  // ===== Gerçek UI: Provider A (Depo onaylı) /ilanlar =====
  await loginAs(page, providerAEmail, PASSWORD, "/panel");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForTimeout(2500);
  const bodyA = await page.locator("body").innerText();
  record("TEST A) Provider A — Genel Depolama ilanı GÖRÜNÜYOR", bodyA.includes(titleGenelDepo));
  record("TEST A) Provider A — Kapalı Depolama ilanı GÖRÜNÜYOR", bodyA.includes(titleKapaliDepo));
  record("TEST A) Provider A — Forklift ilanı GÖRÜNMÜYOR", !bodyA.includes(titleForklift));
  await logout(page.context());

  // ===== Gerçek UI: Provider B (Operatör/İş Mak. onaylı) /ilanlar =====
  await loginAs(page, providerBEmail, PASSWORD, "/panel");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForTimeout(2500);
  const bodyB = await page.locator("body").innerText();
  record("TEST B) Provider B — Forklift ilanı GÖRÜNÜYOR", bodyB.includes(titleForklift));
  record("TEST B) Provider B — Genel Depolama ilanı GÖRÜNMÜYOR", !bodyB.includes(titleGenelDepo));
  record("TEST B) Provider B — Kapalı Depolama ilanı GÖRÜNMÜYOR", !bodyB.includes(titleKapaliDepo));
  await logout(page.context());

  await browser.close();
} catch (e) {
  record("BEKLENMEYEN İSTİSNA", false, e?.message || String(e));
  try { await browser?.close(); } catch {}
} finally {
  for (const id of [adminId, requesterId, providerAId, providerBId].filter(Boolean)) {
    try {
      sql(`delete from public.provider_service_authorizations where provider_id = '${id}' or authorized_by = '${id}';
           delete from public.provider_document_reviews where provider_id = '${id}' or admin_id = '${id}';
           delete from public.notifications where actor_id = '${id}' or recipient_id = '${id}';
           delete from public.job_activity_events where actor_id = '${id}' or job_id in (select id from public.jobs where requester_id = '${id}');
           delete from public.offer_status_history where changed_by = '${id}';
           delete from public.offers where provider_id = '${id}' or job_id in (select id from public.jobs where requester_id = '${id}');
           delete from public.provider_documents where provider_id = '${id}';
           delete from public.job_photos where job_id in (select id from public.jobs where requester_id = '${id}');
           delete from public.jobs where requester_id = '${id}';
           delete from public.operations where requester_id = '${id}';
           delete from public.provider_services where provider_id = '${id}';
           delete from public.profiles where id = '${id}';
           delete from auth.users where id = '${id}';`);
    } catch (e) { record(`Cleanup ${id}`, false, e.message); }
  }
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
