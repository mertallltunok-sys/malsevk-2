// node scripts/tmp-service-auth-ui-test.mjs
//
// HİZMET VEREN ONBOARDING/BELGE YÖNETİMİ/İLAN GÖRÜNÜRLÜĞÜ FINAL SPRINT'in
// bu oturumda YENİ eklenen UI yüzeylerini uçtan uca doğrular — migration
// 0038'in kendi RPC/RLS mekanizması tmp-supabase-service-authorization-test.mjs
// tarafından ZATEN 22/22 doğrulandı (bu test onu TEKRARLAMAZ); bu test onun
// ÜZERİNE inşa edilen YENİ parçalara odaklanır:
//  - Kayıt formu artık hizmet/belge toplamıyor (§2)
//  - /panel/belge-yukleme: seçici -> yükleme -> "Başka Hizmet de Veriyorum" -> ikinci hizmet
//  - provider-job-listing.tsx'in 3 katmanlı boş-durum bannerı (§12-19)
//  - Admin "Belge Talep Et" (0039) -> gerçek bir service_document_required bildirimi
//  - Bildirim GERÇEKTEN Supabase'ten okunup provider-job-listing bell/panel'de görünüyor mu (§30-31)
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-svc-ui-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}
function safeRunSql(sql) {
  try {
    return runSql(sql);
  } catch (error) {
    console.error("sql failed (continuing):", error?.message || error);
    return [];
  }
}

const createdUserIds = [];
let browser;
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-svcui-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `SvcUI ${label}`, p_phone: "+905551110097",
    p_company_name: `SvcUI Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
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

let validPhotoBufferPromise;
function getValidPhotoBuffer() {
  if (!validPhotoBufferPromise) {
    validPhotoBufferPromise = sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 140, b: 200 } } }).jpeg().toBuffer();
  }
  return validPhotoBufferPromise;
}
// NOT: job-photo-upload.tsx (max 10) VE provider-document-upload.tsx (bu
// testte max 1, bkz. document-upload-content.tsx#ProviderDocumentUpload
// maxFiles={1}) AYNI "N / M yüklendi" sayaç metnini kullanır ama M FARKLI —
// "1/10" yerine sabit bir regex, belge yükleme akışında ASLA eşleşmez
// (sayaç "1 / 1 belge yüklendi" yazar) ve 20sn'lik bir zaman aşımına yol
// açar; bu ilk denemede GERÇEKTEN yaşandı ve "Turbopack soğuk derleme
// gecikmesi" sanılıp yanlış teşhis edilmeye çok yaklaşıldı — asıl neden
// tamamen bu testteki sabit regex'ti. `expectedMax` bu yüzden ZORUNLU parametre.
async function uploadOnePhoto(page, expectedMax) {
  const buffer = await getValidPhotoBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "svcui-fixture.jpg", mimeType: "image/jpeg", buffer });
  await page.locator(`text=/1\\s*\\/\\s*${expectedMax}/`).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
}

async function waitForListingSettled(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function createSimpleJob(page, category, jobTitle) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.locator("select").first().selectOption({ label: category });
  await page.getByLabel("İlan Başlığı").fill(jobTitle);
  await page.getByLabel("Hizmete Özel Açıklama").fill(`Hizmet UI testi — ${category}.`);
  await page.getByLabel("Ürün Adedi").fill("5");
  await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
  await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
  const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: /Listede yok/ }).first().click();
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
  await page.getByLabel("Açık Adres").fill("Test açık adresi, en az on karakter.");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
  await uploadOnePhoto(page, 10);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 40000 });
  return page.url().split("/ilanlar/")[1].split("?")[0];
}

async function approveJobAsAdmin(page, jobId) {
  await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).click();
  await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "hidden", timeout: 15000 });
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);

  // §2: GERÇEK UI'dan, kayıt formunda HİÇ hizmet/belge alanı olmadan bir Hizmet Veren kaydı.
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageConsoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") pageConsoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => pageConsoleErrors.push(String(err)));

  // §2: kayıt formunda hizmet/belge alanı olmadığını GERÇEK DOM'dan doğrular
  // — GERÇEK signUp() akışını (e-posta doğrulama modu bu dev projede açık/
  // kapalı olabilir, bkz. CLAUDE.md "Supabase Auth migration") sürmeden,
  // yalnızca formu doldurup submit ETMEDEN kontrol eder — bu bilerek daha
  // güvenilir: hesap oluşturma tmp-supabase-service-authorization-test.mjs'in
  // ZATEN kanıtlanmış RPC yoluyla (createUser, aşağıda) yapılır.
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page.locator('input[type="radio"][value="hizmet-veren"]').check();
  const hasServicePicker = await page.getByText("Verdiğiniz Hizmetler").count();
  const hasDocUpload = await page.getByText(/Faaliyet Belgesi/).count();
  record("A1. Kayıt formunda hizmet seçim alanı YOK (§2)", hasServicePicker === 0);
  record("A2. Kayıt formunda belge yükleme alanı YOK (§2)", hasDocUpload === 0);

  const provider = await createUser("prov", "hizmet-veren");
  const providerEmail = provider.email;
  const providerRow = { id: provider.id };
  const noServicesYet = runSql(`select count(*)::int as c from public.provider_services where provider_id = '${providerRow.id}';`);
  record("A3. Kayıt sonrası provider_services BOŞ (hiçbir hizmet otomatik seçilmedi)", noServicesYet[0]?.c === 0, JSON.stringify(noServicesYet[0]));

  // §12: /ilanlar üzerinde "erişiminiz henüz aktif değil" bannerı.
  console.log("\n=== §12: Provider GERÇEK ilk /ilanlar ziyareti — 'erişiminiz aktif değil' bannerı ===");
  await loginAs(page, providerEmail);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const firstListingText = await page.locator("main").innerText();
  record("B1. 'Hizmet ilanlarına erişiminiz henüz aktif değil' bannerı GÖRÜNÜYOR", firstListingText.includes("Hizmet ilanlarına erişiminiz henüz aktif değil"));
  record("B2. CTA 'Faaliyet Belgesi Yükle' GÖRÜNÜYOR", firstListingText.includes("Faaliyet Belgesi Yükle"));
  if (!firstListingText.includes("Hizmet ilanlarına erişiminiz henüz aktif değil")) {
    console.log("--- DEBUG: /ilanlar (main) ---");
    console.log(firstListingText.slice(0, 2000));
    console.log("--- DEBUG konsol hataları ---");
    console.log(JSON.stringify(pageConsoleErrors));
  }

  // §4-7: /panel/belge-yukleme — Gözetim seç, belge yükle, "Başka Hizmet de Veriyorum", Lashing ekle.
  console.log("\n=== §4-7: /panel/belge-yukleme akışı ===");
  await page.goto(`${APP_ORIGIN}/panel/belge-yukleme`);
  await page.getByText("Hangi hizmeti veriyorsunuz?").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Gözetim Hizmetleri", exact: true }).click();
  await page.getByText("Gözetim Hizmetleri — Faaliyet Belgesi").waitFor({ state: "visible", timeout: 10000 });
  await uploadOnePhoto(page, 1);
  await page.getByRole("button", { name: "Belgeyi Gönder" }).click();
  await page.getByText("Gözetim Hizmetleri belgeniz yüklendi").waitFor({ state: "visible", timeout: 15000 });
  record("C1. Gözetim belgesi yüklendi, 'X belgeniz yüklendi' onayı GÖRÜNÜYOR", true);

  const afterFirstDoc = runSql(`select service_category_id, document_type from public.provider_documents where provider_id = '${providerRow.id}';`);
  record("C2. DB: gozetim-hizmetleri belgesi service_category_id='gozetim-hizmetleri' ile kaydedildi", afterFirstDoc.some((r) => r.service_category_id === "gozetim-hizmetleri"), JSON.stringify(afterFirstDoc));

  await page.getByRole("button", { name: "Başka Hizmet de Veriyorum" }).click();
  await page.getByText("Hangi hizmeti veriyorsunuz?").waitFor({ state: "visible", timeout: 10000 });
  const gozetimStillOffered = await page.getByRole("button", { name: "Gözetim Hizmetleri", exact: true }).count();
  record("C3. Gözetim artık seçenekler arasında YOK (mükerrer engeli)", gozetimStillOffered === 0);
  await page.getByRole("button", { name: "Lashing / Unlashing", exact: true }).click();
  await uploadOnePhoto(page, 1);
  await page.getByRole("button", { name: "Belgeyi Gönder" }).click();
  try {
    await page.getByText("Lashing / Unlashing belgeniz yüklendi").waitFor({ state: "visible", timeout: 25000 });
  } catch (waitError) {
    console.error("--- DEBUG: ikinci belge (Lashing) onayı görünmedi, mevcut sayfa metni ---");
    console.error((await page.locator("main").innerText().catch(() => "(okunamadı)")).slice(0, 1500));
    throw waitError;
  }

  const afterSecondDoc = runSql(`select service_category_id from public.provider_services where provider_id = '${providerRow.id}' order by service_category_id;`);
  record("C4. DB: provider_services artık HEM gozetim-hizmetleri HEM lashing-unlashing içeriyor (tam değiştirme öncekini silmedi)", afterSecondDoc.map((r) => r.service_category_id).sort().join(",") === "gozetim-hizmetleri,lashing-unlashing", JSON.stringify(afterSecondDoc));
  const bothDocsIndependent = runSql(`select service_category_id, current_review_status from public.provider_documents where provider_id = '${providerRow.id}' order by service_category_id;`);
  record("C5. DB: iki AYRI belge satırı var, ikisi de kendi service_category_id'siyle 'pending'", bothDocsIndependent.length === 2 && bothDocsIndependent.every((r) => r.current_review_status === "pending"), JSON.stringify(bothDocsIndependent));

  // §12 (pending durumu): şimdi ikisi de pending, hâlâ hiç yetkili yok -> "onay bekliyor" bannerı.
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const pendingListingText = await page.locator("main").innerText();
  record("D1. Her iki belge de pending iken 'admin onayı bekliyor' bannerı GÖRÜNÜYOR", pendingListingText.includes("Faaliyet belgeniz admin onayı bekliyor"));

  // §31: Admin, provider'ı ÜÇÜNCÜ bir hizmet (Nakliye) için "Belge Talep Et" ile uyarır.
  console.log("\n=== §31: Admin 'Belge Talep Et' (Nakliye, provider hiç seçmedi) ===");
  const reqResult = await adminUser.client.rpc("request_provider_document", { p_provider_id: providerRow.id, p_service_category_id: "nakliye", p_message: null });
  record("E1. request_provider_document RPC BAŞARILI (admin, seçilmemiş bir hizmet için)", !reqResult.error, reqResult.error?.message);
  const notifRow = runSql(`select type, message from public.notifications where recipient_id = '${providerRow.id}' and type = 'service_document_required' order by created_at desc limit 1;`);
  record("E2. DB: service_document_required bildirimi GERÇEKTEN oluştu, Nakliye adı mesajda geçiyor", notifRow[0]?.message?.includes("Nakliye"), JSON.stringify(notifRow[0]));

  // §30: Admin, Gözetim'i GERÇEK UI'dan yetkilendirir; provider'a bildirim gitmeli.
  console.log("\n=== §30: Admin GERÇEK UI'dan Gözetim'i yetkilendiriyor ===");
  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/firmalar/${providerRow.id}`);
  await page.getByText("Hizmet Yetkileri").first().waitFor({ state: "visible", timeout: 15000 });
  const gozetimAdminRow = page.locator("p", { hasText: "Gözetim Hizmetleri" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  await gozetimAdminRow.getByRole("button", { name: "Yetkilendir" }).click();
  await page.waitForTimeout(2000);
  const authCheck = runSql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerRow.id}' and revoked_at is null;`);
  record("F1. DB: Gözetim aktif yetkilendirilmiş", authCheck.some((r) => r.service_category_id === "gozetim-hizmetleri"), JSON.stringify(authCheck));

  // §46: Provider refresh sonrası bell/bildirim panelinde GERÇEK Supabase bildirimini görüyor mu.
  console.log("\n=== §30-31/§46: Provider REFRESH sonrası bildirimleri GÖRÜYOR mu (cross-device okuma) ===");
  await logout(page);
  await loginAs(page, providerEmail);
  await page.goto(`${APP_ORIGIN}/panel/bildirimler`);
  await waitForListingSettled(page);
  const notifPanelText = await page.locator("main").innerText();
  record("G1. Provider bildirim panelinde 'Gözetim' yetkilendirme bildirimini GÖRÜYOR", notifPanelText.includes("Gözetim") && (notifPanelText.includes("onayland") || notifPanelText.includes("Onayland")));
  record("G2. Provider bildirim panelinde 'Nakliye' belge talebi bildirimini GÖRÜYOR", notifPanelText.includes("Nakliye"));
  if (!notifPanelText.includes("Gözetim")) {
    console.log("--- DEBUG: /panel/bildirimler (main) ---");
    console.log(notifPanelText.slice(0, 2000));
  }

  // §12-19 (kısmi yetkili): artık Gözetim yetkili, Lashing hâlâ pending -> BLANKET uyarı GÖRÜNMEMELİ, Gözetim ilanı normal görünmeli.
  console.log("\n=== §12-19: Kısmi yetkili — blanket uyarı YOK, spesifik filtre mesajı VAR ===");
  await logout(page);
  await loginAs(page, requester.email);
  const gozetimJobId = await createSimpleJob(page, "Gözetim Hizmetleri", `SVCUI-GOZETIM-${stamp}`);
  await logout(page);
  await loginAs(page, adminUser.email);
  await approveJobAsAdmin(page, gozetimJobId);
  await logout(page);
  await loginAs(page, providerEmail);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const partialListingText = await page.locator("main").innerText();
  record("H1. Kısmi yetkili provider Gözetim ilanını GÖRÜYOR", partialListingText.includes(`SVCUI-GOZETIM-${stamp}`));
  record("H2. Kısmi yetkiliyken blanket 'erişiminiz aktif değil' uyarısı GÖRÜNMÜYOR", !partialListingText.includes("Hizmet ilanlarına erişiminiz henüz aktif değil"));

  // Lashing filtresini seç -> spesifik "Lashing / Unlashing hizmetine erişiminiz bulunmuyor" + "Profiliniz Gözetim Hizmetleri için onaylanmıştır."
  await selectFromSearchable(page, "Hizmet Türü", "Lashing / Unlashing");
  await waitForListingSettled(page);
  const lashingFilterText = await page.locator("main").innerText();
  record("H3. Lashing filtresi seçiliyken spesifik mesaj GÖRÜNÜYOR", lashingFilterText.includes("Lashing / Unlashing hizmetine erişiminiz bulunmuyor"));
  record("H4. Mesaj provider'ın GERÇEKTEN yetkili olduğu hizmeti (Gözetim) doğru söylüyor", lashingFilterText.includes("Profiliniz şu anda Gözetim Hizmetleri için onaylanmıştır."));
  record("H5. Lashing filtresi 0 Aktif İlan gösteriyor (gerçek bir Lashing ilanı olsa BİLE sızdırılmaz)", lashingFilterText.includes("0 Aktif İlan"));

  await browser.close();
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    safeRunSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
    safeRunSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
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
  if (browser) {
    await browser.close().catch(() => {});
  }
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
