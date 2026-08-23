// node scripts/tmp-supabase-photo-upload-and-job-approval-e2e-test.mjs
//
// İKİ BUG'IN DÜZELTME SONRASI ZORUNLU TEST MATRİSİ (TEST 1-10, görev
// isteğinin birebir kendi numaralandırması) — gerçek development Supabase +
// gerçek browser.
//
// BUG 1 (fotoğraf yükleme): kök neden, bu script'in YAZILDIĞI anda,
// UYGULAMA KODUNDA DEĞİLDİ — Turbopack dev sunucusunun uzun süredir çalışan
// bir oturumda (birçok hot-reload sonrası) rota tablosunun bozulması, GERÇEK
// bir kod regresyonu değil. job-photo-upload.tsx/route.ts'te DEĞİŞİKLİK
// YOK; yalnızca hata mesajları ayrıştırıldı (bağlantı hatası / 401-403 /
// 413 / 5xx artık jenerik "bir sorun oluştu" yerine ayrı, doğru mesajlar
// gösteriyor — bkz. o dosyaların kendi dokümantasyonu).
//
// BUG 2 (belge onaylandı ama ilan görünmüyor): kök neden GERÇEK bir
// dağıtım eksikliğiydi — migration 0041 (belge onayını otomatik hizmet
// yetkilendirmesine bağlayan RPC değişikliği + geriye dönük backfill)
// YEREL dosya sisteminde YAZILMIŞTI ama development Supabase'e HİÇ
// PUSH EDİLMEMİŞTİ (`npx supabase db push` çalıştırılmamış). Bu script bu
// migration'ın GERÇEKTEN uygulandığını VE tüm akışın (belge yükle -> admin
// onaylar -> yetki OTOMATİK açılır -> ilan görünür) uçtan uca çalıştığını
// kanıtlar. `scripts/tmp-supabase-document-approval-authorization-gap-test.mjs`
// bu AYNI migration'ı TAMAMEN AYRI, izole bir Docker Supabase yığınına karşı
// doğrular (bkz. o dosyanın kendi başlığı) — bu script ise GERÇEK hosted
// development projesine karşı, GERÇEK admin UI'ından (RPC'yi doğrudan
// çağırmadan) çalışır; ikisi birbirini TAMAMLAR, birbirinin YERİNE geçmez.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

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
const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-matrix-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}
function safeRunSql(sql) {
  try { return runSql(sql); } catch (e) { console.error("sql failed:", e?.message || e); return []; }
}

const createdUserIds = [];
let browser;
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-matrix-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Matrix ${label}`, p_phone: "+905551110200",
    p_company_name: `Matrix Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}
async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}
async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.waitForTimeout(500);
}
async function selectFromSearchable(page, label, optionText, { exact = true, position = "first" } = {}) {
  await page.getByRole("button", { name: label, exact: true })[position]().click();
  const listbox = page.locator(`ul[aria-label="${label}"]`)[position]();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}
async function waitForListingSettled(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await loginAs(page, requester.email);
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  // TEST 1: Normal JPG yükle.
  console.log("\n=== TEST 1: Normal JPG yükle ===");
  const plainJpeg = await sharp({ create: { width: 1000, height: 750, channels: 3, background: { r: 60, g: 150, b: 90 } } }).jpeg().withExif({ IFD0: { Orientation: "6" } }).toBuffer();
  await page.locator('input[type="file"]').setInputFiles([{ name: "test1.jpg", mimeType: "image/jpeg", buffer: plainJpeg }]);
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 25000 });
  await page.waitForTimeout(1500);
  const hasPreview1 = (await page.locator("img[src^='blob:']").count()) > 0;
  record("TEST 1 — Normal JPG: preview görünüyor", hasPreview1);
  record("TEST 1 — Normal JPG: sayaç arttı, upload başarılı", true);

  // TEST 2: Birden fazla JPG yükle.
  console.log("\n=== TEST 2: Birden fazla JPG yükle ===");
  const jpeg2 = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 200 } } }).jpeg().toBuffer();
  const jpeg3 = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 10, b: 10 } } }).jpeg().toBuffer();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "test2a.jpg", mimeType: "image/jpeg", buffer: jpeg2 },
    { name: "test2b.jpg", mimeType: "image/jpeg", buffer: jpeg3 },
  ]);
  await page.locator("text=/3\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 25000 });
  await page.waitForTimeout(1500);
  const bodyText2 = await page.locator("main").innerText();
  record("TEST 2 — Birden fazla JPG: hepsi işlendi, hata yok", !bodyText2.includes("Fotoğraf işlenirken") && !bodyText2.includes("işlenemedi"));

  // TEST 3: PNG/WEBP dene.
  console.log("\n=== TEST 3: PNG/WEBP dene ===");
  const pngBuf = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
  const webpBuf = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 20, b: 200 } } }).webp().toBuffer();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "test3.png", mimeType: "image/png", buffer: pngBuf },
    { name: "test3.webp", mimeType: "image/webp", buffer: webpBuf },
  ]);
  await page.locator("text=/5\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 25000 });
  await page.waitForTimeout(1500);
  record("TEST 3 — PNG/WEBP kabul edildi", true);

  // TEST 4: 10 MB üstü dosya.
  console.log("\n=== TEST 4: 10 MB üstü dosya ===");
  const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024, 0x41)]);
  await page.locator('input[type="file"]').setInputFiles([{ name: "test4-buyuk.jpg", mimeType: "image/jpeg", buffer: oversized }]);
  await page.waitForTimeout(1000);
  const bodyText4 = await page.locator("main").innerText();
  const hasSizeMessage = bodyText4.includes("10 MB");
  record("TEST 4 — 10MB üstü dosya: anlaşılır validation mesajı", hasSizeMessage, hasSizeMessage ? "Mesaj doğru gösterildi" : "Mesaj bulunamadı");

  // TEST 5: İlan oluştur.
  console.log("\n=== TEST 5: İlan oluştur ===");
  await page.locator("select").first().selectOption({ label: "Gözetim Hizmetleri" });
  await page.getByLabel("İlan Başlığı").fill(`MATRIX-JOB-${stamp}`);
  await page.getByLabel("Hizmete Özel Açıklama").fill("Test matrisi ilan açıklaması, en az yirmi karakter.");
  await page.getByLabel("Ürün Adedi").fill("5");
  await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
  await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
  const listbox5 = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await listbox5.waitFor({ state: "visible" });
  await listbox5.getByRole("option", { name: /Listede yok/ }).first().click();
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
  await page.getByLabel("Açık Adres").fill("Test açık adresi, en az on karakter.");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 40000 });
  const jobId = page.url().split("/ilanlar/")[1].split("?")[0];

  await page.waitForTimeout(2000); // supabase-job-sync best-effort yazımı için kısa bekleme.
  const jobRow = runSql(`select id, moderation_status, requester_id from public.jobs where id = '${jobId}';`);
  record("TEST 5 — Supabase job GERÇEKTEN oluştu", jobRow.length === 1, JSON.stringify(jobRow[0]));
  record("TEST 5 — İlan admin onayına düştü (pending_review), DOĞRUDAN yayınlanmadı", jobRow[0]?.moderation_status === "pending_review", JSON.stringify(jobRow[0]));
  const jobPhotosRow = runSql(`select count(*)::int as c from public.job_photos where job_id = '${jobId}';`);
  record("TEST 5 — Fotoğraf path/URL kayıtları ilana doğru bağlandı", jobPhotosRow[0]?.c > 0, JSON.stringify(jobPhotosRow[0]));

  // TEST 6: Admin ilanı onayla.
  console.log("\n=== TEST 6: Admin ilanı onayla ===");
  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).click();
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "hidden", timeout: 15000 });
  const jobAfterApproval = runSql(`select moderation_status from public.jobs where id = '${jobId}';`);
  record("TEST 6 — Admin onayı sonrası status canonical approved'a geçti", jobAfterApproval[0]?.moderation_status === "approved", JSON.stringify(jobAfterApproval[0]));

  // TEST 7: Belgesi onaylanmamış Hizmet Veren — ilanları görememeli.
  console.log("\n=== TEST 7: Belgesiz Hizmet Veren ilanları göremiyor ===");
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const beforeAuthText = await page.locator("main").innerText();
  record("TEST 7 — Belgesiz/yetkisiz provider ilanı GÖRMÜYOR", !beforeAuthText.includes(`MATRIX-JOB-${stamp}`));

  // TEST 8: Belge yükle, admin onaylasın — EK bekleme olmadan yetki açılmalı.
  console.log("\n=== TEST 8: Belge onaylanan provider — ek bekleme olmadan yetki açılıyor ===");
  await page.goto(`${APP_ORIGIN}/panel/belge-yukleme`);
  await page.getByText("Hangi hizmeti veriyorsunuz?").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Gözetim Hizmetleri", exact: true }).click();
  await page.getByText("Gözetim Hizmetleri — Faaliyet Belgesi").waitFor({ state: "visible", timeout: 10000 });
  const docBuf = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 140, b: 200 } } }).jpeg().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "matrix-doc.jpg", mimeType: "image/jpeg", buffer: docBuf });
  await page.locator("text=/1\\s*\\/\\s*1/").first().waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: "Belgeyi Gönder" }).click();
  await page.getByText("Gözetim Hizmetleri belgeniz yüklendi").waitFor({ state: "visible", timeout: 20000 });
  const docRow = runSql(`select id from public.provider_documents where provider_id = '${provider.id}' order by uploaded_at desc limit 1;`);
  const documentId = docRow[0]?.id;

  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/firma-belgeleri/${documentId}`);
  await page.getByRole("button", { name: "Onayla" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Onayla" }).click();
  await page.waitForTimeout(2000);
  const authRow = runSql(`select service_category_id from public.provider_service_authorizations where provider_id = '${provider.id}' and revoked_at is null;`);
  record("TEST 8 — Belge onayı sonrası EK bir işlem olmadan yetki OTOMATİK oluştu", authRow.some((r) => r.service_category_id === "gozetim-hizmetleri"), JSON.stringify(authRow));

  // TEST 9: Onaylı Hizmet Veren + admin onaylı ilan -> /ilanlar'da görünmeli.
  console.log("\n=== TEST 9: Onaylı provider + onaylı ilan — /ilanlar'da GÖRÜNMELİ ===");
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const afterAuthText = await page.locator("main").innerText();
  record("TEST 9 — Onaylı provider admin-onaylı ilanı GÖRÜYOR", afterAuthText.includes(`MATRIX-JOB-${stamp}`));

  // TEST 10: Sayfayı yenile / çıkış-giriş yap — yetki ve görünürlük kalıcı olmalı.
  console.log("\n=== TEST 10: Refresh / çıkış-giriş sonrası kalıcılık ===");
  await page.reload();
  await waitForListingSettled(page);
  const afterReloadText = await page.locator("main").innerText();
  record("TEST 10a — Sayfa yenileme sonrası ilan HÂLÂ görünüyor", afterReloadText.includes(`MATRIX-JOB-${stamp}`));
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const afterReloginText = await page.locator("main").innerText();
  record("TEST 10b — Çıkış/tekrar giriş sonrası ilan HÂLÂ görünüyor", afterReloginText.includes(`MATRIX-JOB-${stamp}`));

  await browser.close();
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    safeRunSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
    safeRunSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
    safeRunSql(`delete from public.provider_document_reviews where admin_id in (${idList}) or provider_id in (${idList});`);
    safeRunSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.provider_service_authorizations where provider_id in (${idList})) or entity_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
    safeRunSql(`delete from public.provider_documents where provider_id in (${idList});`);
    safeRunSql(`delete from public.provider_services where provider_id in (${idList});`);
    safeRunSql(`delete from public.jobs where requester_id in (${idList});`);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  rmSync(scratchDir, { recursive: true, force: true });
  if (browser) await browser.close().catch(() => {});
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
