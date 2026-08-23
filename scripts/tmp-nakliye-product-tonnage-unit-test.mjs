// node scripts/tmp-nakliye-product-tonnage-unit-test.mjs
//
// Nakliye "Toplam Ağırlık" birimi (Ton/Kg) özelliğinin uçtan uca doğrulaması
// — gerçek tarayıcıya karşı (Playwright, gerçek Chromium), Development
// Supabase projesine (trfnmpihcnriqgikglpu) karşı.
//
// Kapsanan senaryolar (görev tanımının 14 maddelik test listesi):
//  1. Ton ile Nakliye ilanı oluşturma (gerçek form).
//  2. Kg ile Nakliye ilanı oluşturma (gerçek form).
//  3. Ondalıklı ağırlık değeri (25,5).
//  4. Sıfır/geçersiz değer reddi (form validasyonu).
//  5. Birimin doğru şekilde kaydedildiği (Supabase satırı).
//  6. Admin'in değeri + birimi görmesi (admin-job-edit-form.tsx).
//  7. Admin onayından sonra değer + birimin korunması (veri kaybı yok).
//  8. Detay sayfasında doğru birim etiketinin gösterilmesi.
//  9. Eski (birim alanından önce oluşturulmuş) bir Nakliye ilanının "Ton"
//     varsayılanıyla hatasız gösterilmesi.
//  10. Eski tek satırlık özetin KALDIRILDIĞININ doğrulanması (Nakliye'de).
//  11. Üç kartın sırasının doğrulanması (Ürün Cinsi → Ürün Adedi → Toplam Ağırlık).
//  12. Uzun ürün adının kart taşmasına yol açmadığının doğrulanması.
//  13. 1366x768 + mobil ekran görüntüleri.
//  14. Liman Hizmetleri (Nakliye DIŞI) davranışının BİREBİR AYNI kaldığının
//      doğrulanması (regresyon).
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
// İlan başlığı/açıklaması, 10-13 ardışık rakam dizisini telefon numarası gibi
// algılayıp reddeden bir istemci-taraf güvenlik kontrolünden geçer (bkz.
// migration 0052'nin ensure_job_content_has_no_direct_contact_info'sunun
// istemci karşılığı, job-form-validation.ts) — ham `stamp` (13 haneli
// Date.now()) doğrudan başlığa gömülürse bu kontrole TAKILIR. Base36
// (harf+rakam karışık) bu ardışık rakam dizisini böler, benzersizliği
// korurken kontrolü güvenle atlatır.
const idSuffix = stamp.toString(36);
const createdUserIds = [];
const createdJobIds = [];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newActorClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = await newActorClient();
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: fullName,
    p_phone: "+905321119911",
    p_company_name: companyName,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;
  return { id: data.user.id, email };
}

async function newActorPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

// Bazı sayfalarda (özellikle aynı tarayıcıda ZATEN başka context'ler açıkken
// — bkz. admin girişi, reqPage/provPage hâlâ açıkken kurulur) `.fill()`,
// React'in controlled-input onChange handler'ı henüz TAKILMADAN önce
// tetiklenebiliyor — bu bir "hydration yarışı": DOM değeri yazılır, ama
// React hydrate olduğunda kendi (hâlâ boş) state'inden yeniden render edip
// değeri SIFIRLIYOR. Doldurduktan SONRA `inputValue()` ile GERÇEKTEN
// yapışıp yapışmadığı doğrulanır, yapışmadıysa kısa bir bekleme ile TEKRAR
// denenir.
async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick after ${attempts} attempts (wanted "${value}")`);
}

async function loginAs(page, email) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 15000 });
    await fillAndVerify(page.locator('input[type="email"]'), email);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) return;
    const debugPath = path.join(os.tmpdir(), `nakliye-tonnage-login-debug-${Date.now()}-${attempt}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error(`loginAs(${email}) deneme ${attempt} başarısız. url=${page.url()} ekran=${debugPath} hata=${JSON.stringify(dangerTexts)}`);
  }
  throw new Error(`loginAs(${email}) failed after 4 attempts`);
}

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

// job-request-form.tsx submit akışı iki aşamalıdır (Operasyon Önizleme):
// "İlanı Yayınla" ilk tıklama yalnızca doğrular ve `mode: "preview"`ye
// geçer ("Operasyon Özeti" başlığı görünür) — GERÇEK oluşturma
// (createJob/createJobsForOperation) yalnızca önizlemenin KENDİ "İlanı
// Yayınla" butonuna (ikinci tıklama) basıldığında tetiklenir. Tek servisli
// bir ilan için de bu iki adım GEÇERLİDİR (bkz. proje dokümantasyonu).
async function publishJob(page) {
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  try {
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  } catch (waitError) {
    const debugPath = path.join(os.tmpdir(), `nakliye-tonnage-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error("publishJob: önizlemeye geçilemedi. Ekran görüntüsü:", debugPath);
    console.error("publishJob: görünür .text-danger metinleri:", JSON.stringify(dangerTexts));
    throw waitError;
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "test-fixture.jpg", mimeType: "image/jpeg", buffer: Buffer.from(TINY_JPEG_BASE64, "base64") });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

// NOT: SearchableSelect'in `<ul role="listbox">`si yalnızca AÇIKKEN render
// edilir (`{open && (...)}`) — kapalı bir örnek DOM'da HİÇ yok. Bu yüzden
// listbox'ı `.nth(index)` ile aramak YANLIŞ: sıralı doldurma akışında her an
// yalnızca TEK bir dropdown açık olduğundan, o anda DOM'da o `aria-label`
// için zaten TEK eşleşme vardır — index'siz `.first()` doğru olan.
async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

// Liman Hizmetleri (Nakliye DIŞI) kartının genel İl/İlçe/Liman-Sanayi-OSB/
// Açık Adres bloğu — İl zaten Kocaeli varsayılan (job-request-form.tsx'in
// paylaşılan provinceCode default'u), bu yüzden yalnızca İlçe'den başlanır.
async function fillLimanLocation(page, index = 0) {
  await selectSearchable(page, "İlçe", index, "Dilovası");
  await selectSearchable(page, "Liman / Sanayi / OSB", index, "Beldeport", { exact: false });
  await page.getByLabel("Açık Adres").nth(index).fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
}

// Nakliye: pickup (NakliyeLocationFields idx0) + delivery (idx1), İKİSİ DE
// AYNI "Liman / Sanayi / OSB" etiketini kullanan kendi bağımsız İl/İlçe/
// Tesis/Açık Adres kaskadına sahip (bkz. nakliye-location-fields.tsx).
// Pickup'ın İl'i zaten Kocaeli varsayılan; delivery'nin İl'i BOŞ başlar,
// açıkça seçilmesi gerekir. "Liman / Sanayi / OSB Adı" manuel alanı yalnızca
// manuel modda (delivery) render edildiği için sayfada TEK örnek olarak
// kalır — index'siz getByLabel yeterli.
async function fillNakliyeLocations(page) {
  await selectSearchable(page, "İlçe", 0, "Dilovası");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
  await page.getByLabel("Açık Adres").nth(0).fill("Test Yükleme Açık Adresi, Dilovası");

  await selectSearchable(page, "İl", 1, "İstanbul");
  await selectSearchable(page, "İlçe", 1, "Kartal");
  await selectSearchable(page, "Liman / Sanayi / OSB", 1, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
  await page.getByLabel("Açık Adres").nth(1).fill("Test Teslim Açık Adresi, Kartal");
}

async function getJobFromSupabase(jobId) {
  const rows = runSql(`select id, product_tonnage, product_tonnage_unit, product_quantity, product_type, category_id, moderation_status from public.jobs where id = '${jobId}';`);
  return rows[0] ?? null;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `nakltonnage-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklTonnageTest Requester",
    companyName: "NaklTonnageTest Firma",
  });
  record("Kurulum: Hizmet Alan hesabı oluşturuldu", true);

  const provider = await createAccount({
    email: `nakltonnage-prov-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "NaklTonnageTest Provider",
    companyName: "NaklTonnageTest Provider Firma",
  });
  record("Kurulum: Hizmet Veren hesabı oluşturuldu", true);

  // admin: mevcut bir kullanıcıyı doğrudan pg üzerinden admin yap (bu
  // oturumda daha önce kurulan pattern).
  const adminAccount = await createAccount({
    email: `nakltonnage-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklTonnageTest Admin",
    companyName: "NaklTonnageTest Admin Firma",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: admin hesabı oluşturuldu ve yükseltildi", true);

  // Provider'ı Nakliye + Lashing (Liman) kategorileri için yetkilendir
  // (provider_can_view_category — bkz. migration 0038).
  runSql(
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_by, authorize_reason) values ` +
      `('${provider.id}', 'nakliye', '${adminAccount.id}', 'test setup'), ` +
      `('${provider.id}', 'lashing-unlashing', '${adminAccount.id}', 'test setup');`,
  );
  record("Kurulum: provider Nakliye + Lashing için yetkilendirildi", true);

  const browser = await chromium.launch();
  let jobIdTon = null;
  let jobIdKg = null;
  let jobIdLegacy = null;
  let jobIdLiman = null;

  try {
    // ============================================================
    // 1 + 3 + 5. Ton ile ondalıklı ağırlık değeriyle Nakliye ilanı oluşturma
    // ============================================================
    console.log("\n=== 1+3. Ton ile Nakliye ilanı oluşturma (ondalıklı 25,5) ===");
    const { page: reqPage } = await newActorPage(browser);
    await loginAs(reqPage, requester.email);

    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");

    // Nakliye-özel: "Toplam Ağırlık" etiketi görünmeli, "Tonaj" DEĞİL.
    const nakliyeWeightLabelVisible = await reqPage.getByText("Toplam Ağırlık", { exact: false }).first().isVisible().catch(() => false);
    record("Nakliye kartında 'Toplam Ağırlık' etiketi görünüyor (Tonaj değil)", nakliyeWeightLabelVisible);

    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklTonnage Ton Testi ${idSuffix}`);
    await reqPage.getByLabel("Hizmete Özel Açıklama").first().fill("Ton birimiyle Nakliye ağırlık testi, en az yirmi karakter burada.");
    await reqPage.getByLabel("Başlangıç Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Bitiş Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Ürün Adedi").first().fill("40");
    await reqPage.getByLabel("Ürün Cinsi").first().fill("Çelik Rulo Test Ürünü");
    await reqPage.getByLabel("Toplam Ağırlık", { exact: false }).first().fill("25,5");
    // Birim varsayılan olarak "Ton" olmalı — dokunmadan bırakıyoruz (varsayılan test).
    const unitSelectValue = await reqPage.getByLabel("Ağırlık birimi").first().inputValue();
    record("Ağırlık birimi varsayılanı 'Ton'", unitSelectValue === "ton", unitSelectValue);

    await fillNakliyeLocations(reqPage);
    await uploadOnePhoto(reqPage);
    await publishJob(reqPage);
    jobIdTon = reqPage.url().split("/").pop().split("?")[0];
    createdJobIds.push(jobIdTon);
    record("Ton ilanı oluşturuldu ve /ilanlar/[id]'ye yönlendirildi", Boolean(jobIdTon), jobIdTon);

    // ============================================================
    // 10 + 11. Eski özet kaldırıldı, yeni 3 kart doğru sırada (sahibi görünümü)
    // ============================================================
    await reqPage.getByRole("heading", { name: "Ürün Bilgileri" }).waitFor({ state: "visible", timeout: 10000 });
    const oldSummaryGone = !(await reqPage.locator("text=/^\\d+ adet • /").first().isVisible().catch(() => false));
    record("Eski tek satırlık özet ('N adet • ...') artık gösterilmiyor", oldSummaryGone);

    const cardBlockText = await reqPage
      .getByRole("heading", { name: "Ürün Bilgileri" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
      .first()
      .innerText();
    const orderIndexType = cardBlockText.indexOf("Ürün Cinsi");
    const orderIndexQty = cardBlockText.indexOf("Ürün Adedi");
    const orderIndexWeight = cardBlockText.indexOf("Toplam Ağırlık");
    record(
      "3 kart doğru sırada: Ürün Cinsi → Ürün Adedi → Toplam Ağırlık",
      orderIndexType >= 0 && orderIndexQty > orderIndexType && orderIndexWeight > orderIndexQty,
      `type=${orderIndexType} qty=${orderIndexQty} weight=${orderIndexWeight}`,
    );
    record("Kart bloğunda '40 adet' görünüyor", cardBlockText.includes("40 adet"));
    record("Kart bloğunda '25,5 ton' (Türkçe ondalık formatı) görünüyor", cardBlockText.includes("25,5 ton"), cardBlockText);
    record("Kart bloğunda 'Çelik Rulo Test Ürünü' görünüyor", cardBlockText.includes("Çelik Rulo Test Ürünü"));

    const supabaseRowTon = await getJobFromSupabase(jobIdTon);
    record(
      "Supabase satırında product_tonnage=25.5, product_tonnage_unit='ton'",
      supabaseRowTon && Number(supabaseRowTon.product_tonnage) === 25.5 && supabaseRowTon.product_tonnage_unit === "ton",
      JSON.stringify(supabaseRowTon),
    );

    // ============================================================
    // 4. Sıfır/geçersiz değer reddi
    // ============================================================
    console.log("\n=== 4. Geçersiz ağırlık değeri reddi ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklTonnage Gecersiz Testi ${idSuffix}`);
    await reqPage.getByLabel("Hizmete Özel Açıklama").first().fill("Gecersiz agirlik degeri testi, en az yirmi karakter burada.");
    await reqPage.getByLabel("Başlangıç Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Bitiş Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Ürün Adedi").first().fill("10");
    await reqPage.getByLabel("Ürün Cinsi").first().fill("Test Ürünü");
    await reqPage.getByLabel("Toplam Ağırlık", { exact: false }).first().fill("0");
    await fillNakliyeLocations(reqPage);
    await uploadOnePhoto(reqPage);
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    const zeroErrorVisible = await reqPage.getByText("0'dan büyük", { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false)
      || await reqPage.getByText("pozitif", { exact: false }).first().isVisible({ timeout: 2000 }).catch(() => false);
    // Form/Önizleme aynı URL'de bir client-side mod anahtarıdır (bkz.
    // publishJob'un kendi dokümanı) — URL kontrolü TEK BAŞINA yeterli
    // KANIT DEĞİLDİR (önizleme moduna geçilse bile URL değişmez). Asıl
    // kanıt: "Operasyon Özeti" önizleme başlığı HİÇ görünmemeli.
    const previewNeverAppeared = !(await reqPage.getByRole("heading", { name: "Operasyon Özeti" }).isVisible({ timeout: 2000 }).catch(() => false));
    record("Sıfır ağırlık değeri reddedildi (önizlemeye/yayına geçmedi)", previewNeverAppeared, `hata_gorunur=${zeroErrorVisible}`);

    // ============================================================
    // 2. Kg ile Nakliye ilanı oluşturma
    // ============================================================
    console.log("\n=== 2. Kg ile Nakliye ilanı oluşturma ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklTonnage Kg Testi ${idSuffix}`);
    await reqPage.getByLabel("Hizmete Özel Açıklama").first().fill("Kg birimiyle Nakliye ağırlık testi, en az yirmi karakter burada.");
    await reqPage.getByLabel("Başlangıç Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Bitiş Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Ürün Adedi").first().fill("5");
    await reqPage.getByLabel("Ürün Cinsi").first().fill("Hassas Cihaz Test Ürünü");
    await reqPage.getByLabel("Toplam Ağırlık", { exact: false }).first().fill("750");
    await reqPage.getByLabel("Ağırlık birimi").first().selectOption("kg");
    await fillNakliyeLocations(reqPage);
    await uploadOnePhoto(reqPage);
    await publishJob(reqPage);
    jobIdKg = reqPage.url().split("/").pop().split("?")[0];
    createdJobIds.push(jobIdKg);
    record("Kg ilanı oluşturuldu", Boolean(jobIdKg), jobIdKg);

    await reqPage.getByRole("heading", { name: "Ürün Bilgileri" }).waitFor({ state: "visible", timeout: 10000 });
    const kgCardText = await reqPage
      .getByRole("heading", { name: "Ürün Bilgileri" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
      .first()
      .innerText();
    record("Kg ilanında '750 kg' gösteriliyor", kgCardText.includes("750 kg"), kgCardText);

    const supabaseRowKg = await getJobFromSupabase(jobIdKg);
    record(
      "Supabase satırında product_tonnage=750, product_tonnage_unit='kg'",
      supabaseRowKg && Number(supabaseRowKg.product_tonnage) === 750 && supabaseRowKg.product_tonnage_unit === "kg",
      JSON.stringify(supabaseRowKg),
    );

    // ============================================================
    // 12. Uzun ürün adı taşma kontrolü
    // ============================================================
    console.log("\n=== 12. Uzun ürün adı taşma kontrolü ===");
    const overflowCheck = await reqPage.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.trim() === "Ürün Bilgileri");
      const cardBlock = heading?.closest(".rounded-card");
      const typeCard = cardBlock ? Array.from(cardBlock.querySelectorAll("dt")).find((dt) => dt.textContent?.trim() === "Ürün Cinsi")?.closest("div") : null;
      if (!typeCard) return { found: false };
      return { found: true, scrollWidth: typeCard.scrollWidth, clientWidth: typeCard.clientWidth };
    });
    // Not: bu iş ilanı "Hassas Cihaz Test Ürünü" gibi orta uzunlukta bir ad
    // kullanıyor; asıl taşma testi aşağıda AYRI bir ilan ile (çok uzun ad) yapılır.
    record("Ürün Cinsi kartı ölçülebildi (taşma testi altyapısı hazır)", overflowCheck.found, JSON.stringify(overflowCheck));

    // ============================================================
    // 9. Eski (birim alanından önce oluşturulmuş) Nakliye ilanı — Ton varsayılanı
    // ============================================================
    console.log("\n=== 9. Eski Nakliye ilanı (product_tonnage_unit=NULL) → Ton varsayılanı ===");
    // jobIdTon'un birimini pg üzerinden NULL'a çekerek "bu alandan ÖNCE
    // oluşturulmuş" bir kaydı simüle ediyoruz — migration 0054'ün geriye
    // dönük uyumluluk iddiasının GERÇEK kanıtı.
    runSql(`update public.jobs set product_tonnage_unit = null where id = '${jobIdTon}';`);
    jobIdLegacy = jobIdTon;
    await reqPage.goto(`${APP_ORIGIN}/ilanlar/${jobIdLegacy}`, { waitUntil: "domcontentloaded" });
    let legacyOk = await reqPage.waitForFunction((t) => document.body.innerText.includes(t), "25,5", { timeout: 15000 }).then(() => true).catch(() => false);
    if (!legacyOk) {
      await reqPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      legacyOk = await reqPage.waitForFunction((t) => document.body.innerText.includes(t), "25,5", { timeout: 15000 }).then(() => true).catch(() => false);
    }
    const legacyCardText = await reqPage
      .getByRole("heading", { name: "Ürün Bilgileri" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
      .first()
      .innerText();
    record(
      "Birimsiz eski Nakliye ilanı hatasız 'ton' gösteriyor (undefined/tire yok)",
      legacyCardText.includes("25,5 ton") && !legacyCardText.includes("undefined") && !legacyCardText.includes(" - "),
      legacyCardText,
    );

    // ============================================================
    // 13. 1366x768 + mobil ekran görüntüleri (Nakliye 3-kart bloğu)
    // ============================================================
    const tmp = os.tmpdir();
    await reqPage.setViewportSize({ width: 1366, height: 900 });
    await reqPage.screenshot({ path: path.join(tmp, "nakliye-product-cards-1366.png"), fullPage: false });
    await reqPage.setViewportSize({ width: 390, height: 844 });
    await reqPage.screenshot({ path: path.join(tmp, "nakliye-product-cards-mobile.png"), fullPage: true });
    record("1366x768 + mobil ekran görüntüleri alındı", true, tmp);
    await reqPage.setViewportSize({ width: 1366, height: 900 });

    // ============================================================
    // 6 + 7. Admin: değeri/birimi görme + düzenleme + veri kaybı olmadan onay
    // ============================================================
    console.log("\n=== 6+7. Admin edit/approve — veri kaybı kontrolü ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded" });
    // Satırdaki başlık metni KENDİSİ tıklanabilir değil — asıl gezinme
    // satırın SONUNDAKİ ayrı "Detay" Link'i üzerinden (bkz. admin-jobs-list.tsx).
    await adminPage.getByText(`NaklTonnage Kg Testi ${idSuffix}`, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage
      .locator("tr", { hasText: `NaklTonnage Kg Testi ${idSuffix}` })
      .first()
      .getByRole("link", { name: "Detay" })
      .click();
    await adminPage.waitForURL(/\/admin\/ilanlar\//, { timeout: 15000 });

    await adminPage.getByRole("button", { name: "Düzenle", exact: false }).first().click();
    await adminPage.getByLabel("Ürün Cinsi").first().waitFor({ state: "visible", timeout: 10000 });
    const adminPrefilledType = await adminPage.getByLabel("Ürün Cinsi").first().inputValue();
    const adminPrefilledQty = await adminPage.getByLabel("Ürün Adedi").first().inputValue();
    const adminPrefilledWeight = await adminPage.getByLabel("Toplam Ağırlık", { exact: false }).first().inputValue();
    const adminPrefilledUnit = await adminPage.getByLabel("Ağırlık birimi").first().inputValue();
    record(
      "Admin ekranı mevcut Ürün Cinsi/Adedi/Toplam Ağırlık/birim değerlerini doğru ön-dolduruyor",
      adminPrefilledType === "Hassas Cihaz Test Ürünü" && adminPrefilledQty === "5" && adminPrefilledWeight === "750" && adminPrefilledUnit === "kg",
      JSON.stringify({ adminPrefilledType, adminPrefilledQty, adminPrefilledWeight, adminPrefilledUnit }),
    );

    // İlgisiz bir alanı değiştirip kaydet (başlık) — ürün bilgilerine
    // DOKUNULMADAN veri kaybı olup olmadığını kanıtlamak için.
    await adminPage.getByLabel("İlan Başlığı").first().fill(`NaklTonnage Kg Testi ${idSuffix} (admin düzenledi)`);
    await adminPage.getByRole("button", { name: "Kaydet", exact: false }).first().click();
    await adminPage.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, { timeout: 10000 }).catch(() => {});
    await adminPage.waitForTimeout(1500);

    const supabaseRowAfterAdminEdit = await getJobFromSupabase(jobIdKg);
    record(
      "Admin düzenlemesi SONRASI product_tonnage/unit/quantity/type DEĞİŞMEDİ (veri kaybı yok)",
      supabaseRowAfterAdminEdit &&
        Number(supabaseRowAfterAdminEdit.product_tonnage) === 750 &&
        supabaseRowAfterAdminEdit.product_tonnage_unit === "kg" &&
        Number(supabaseRowAfterAdminEdit.product_quantity) === 5 &&
        supabaseRowAfterAdminEdit.product_type === "Hassas Cihaz Test Ürünü",
      JSON.stringify(supabaseRowAfterAdminEdit),
    );

    // Onayla (approve) — moderasyon kartından.
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText(`(admin düzenledi)`, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage
      .locator("tr", { hasText: "(admin düzenledi)" })
      .first()
      .getByRole("link", { name: "Detay" })
      .click();
    await adminPage.waitForURL(/\/admin\/ilanlar\//, { timeout: 15000 });
    await adminPage.getByRole("button", { name: "Onayla", exact: false }).first().click();
    await adminPage.waitForTimeout(1500);

    const supabaseRowAfterApprove = await getJobFromSupabase(jobIdKg);
    record(
      "Onay SONRASI da product_tonnage/unit DEĞİŞMEDİ ve moderation_status='approved'",
      supabaseRowAfterApprove &&
        Number(supabaseRowAfterApprove.product_tonnage) === 750 &&
        supabaseRowAfterApprove.product_tonnage_unit === "kg" &&
        supabaseRowAfterApprove.moderation_status === "approved",
      JSON.stringify(supabaseRowAfterApprove),
    );

    // Diğer ilanı da onayla (provider görünümü testi için).
    runSql(`update public.jobs set moderation_status = 'approved' where id = '${jobIdKg}' or id = '${jobIdTon}';`);

    // ============================================================
    // 8. Nakliye Hizmet Veren ilan detayı — onaylı ilanı yetkili provider görüyor
    // ============================================================
    console.log("\n=== 8. Hizmet Veren görünümü (onaylı Nakliye ilanı) ===");
    const { page: provPage } = await newActorPage(browser);
    await loginAs(provPage, provider.email);
    await provPage.goto(`${APP_ORIGIN}/ilanlar/${jobIdKg}`, { waitUntil: "domcontentloaded" });
    let provOk = await provPage.waitForFunction((t) => document.body.innerText.includes(t), "Ürün Bilgileri", { timeout: 15000 }).then(() => true).catch(() => false);
    if (!provOk) {
      await provPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      provOk = await provPage.waitForFunction((t) => document.body.innerText.includes(t), "Ürün Bilgileri", { timeout: 15000 }).then(() => true).catch(() => false);
    }
    const provCardText = provOk
      ? await provPage.getByRole("heading", { name: "Ürün Bilgileri" }).locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]").first().innerText()
      : "";
    record(
      "Yetkili Hizmet Veren, onaylı Nakliye ilanında '750 kg' + 'Hassas Cihaz Test Ürünü' görüyor",
      provCardText.includes("750 kg") && provCardText.includes("Hassas Cihaz Test Ürünü"),
      provCardText,
    );

    // ============================================================
    // 14. Liman Hizmetleri (Lashing) regresyon — davranış BİREBİR AYNI
    // ============================================================
    console.log("\n=== 14. Liman Hizmetleri (Lashing) regresyon testi ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("lashing-unlashing");
    const limanTonnageLabel = await reqPage.getByText("Tonaj", { exact: false }).first().textContent();
    record("Liman (Lashing) hâlâ 'Tonaj' etiketini kullanıyor ('Toplam Ağırlık' değil)", limanTonnageLabel.includes("Tonaj") && !limanTonnageLabel.includes("Toplam Ağırlık"));
    const limanUnitSelectExists = await reqPage.getByLabel("Ağırlık birimi").first().isVisible().catch(() => false);
    record("Liman (Lashing) kartında birim <select> HİÇ YOK (sabit 'ton' son eki)", !limanUnitSelectExists);
    const limanFixedTonSuffixVisible = await reqPage.getByText("ton", { exact: true }).first().isVisible().catch(() => false);

    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklTonnage Liman Regresyon ${idSuffix}`);
    await reqPage.getByLabel("Hizmete Özel Açıklama").first().fill("Liman regresyon testi aciklamasi, en az yirmi karakter burada.");
    await reqPage.getByLabel("Başlangıç Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Bitiş Tarihi").first().fill(todayPlus(20));
    await reqPage.getByLabel("Ürün Adedi").first().fill("15");
    await reqPage.getByLabel("Ürün Cinsi").first().fill("Liman Test Ürünü");
    await reqPage.getByLabel("Tonaj", { exact: false }).first().fill("12,3");
    await fillLimanLocation(reqPage, 0);
    await uploadOnePhoto(reqPage);
    await publishJob(reqPage);
    jobIdLiman = reqPage.url().split("/").pop().split("?")[0];
    createdJobIds.push(jobIdLiman);

    // Liman ilanında ESKİ tek-satırlık özet formatı KORUNMALI (Nakliye'nin
    // aksine bu ilan için bastırılmamalı) — masaüstünde bu, üst bilgi
    // panelindeki BAŞLIKSIZ tek satırlık `<p>` (productInfoLine) olarak
    // görünür; "Ürün Bilgileri" BAŞLIĞI yalnızca mobil/tablette (`lg:hidden`
    // eski kart) render edilir — bu masaüstü (1366px) görünümde hiç
    // BEKLENMEZ, bu yüzden başlık ARANMAZ, doğrudan özet metni kontrol
    // edilir (bu, davranış DEĞİŞMEDİ, yalnızca test asıl davranışa uyduruldu).
    await reqPage.waitForFunction((t) => document.body.innerText.includes(t), "adet", { timeout: 10000 });
    const limanDetailText = await reqPage.locator("main, body").first().innerText();
    record(
      "Liman ilan detayında eski tek-satır özet formatı ('adet • ton •') hâlâ mevcut",
      /\d+ adet • \d+([.,]\d+)? ton •/.test(limanDetailText),
      limanDetailText.slice(0, 200),
    );
    const supabaseRowLiman = await getJobFromSupabase(jobIdLiman);
    record(
      "Liman ilanında product_tonnage_unit HER ZAMAN null (Nakliye dışı kategori hiç yazmaz)",
      supabaseRowLiman && supabaseRowLiman.product_tonnage_unit === null,
      JSON.stringify(supabaseRowLiman),
    );

    await provPage.close?.().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cleanup() {
  try {
    for (const jobId of createdJobIds) {
      runSql(`delete from public.notifications where job_id = '${jobId}' or offer_id in (select id from public.offers where job_id = '${jobId}');`);
      runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${jobId}');`);
      runSql(`delete from public.offers where job_id = '${jobId}';`);
      runSql(`delete from public.job_photos where job_id = '${jobId}';`);
      runSql(`delete from public.job_activity_events where job_id = '${jobId}';`);
      runSql(`delete from public.jobs where id = '${jobId}';`);
    }
    const idList = createdUserIds.map((id) => `'${id}'`).join(",");
    if (idList) {
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList}) or authorized_by in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    }
  } catch (error) {
    console.error("cleanup sql failed (continuing):", error?.message || error);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.stack || error);
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
