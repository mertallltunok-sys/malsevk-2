// node scripts/tmp-nakliye-measurement-info-test.mjs
//
// "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevinin uçtan uca
// doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı, migration
// 0062/0063 sonrası.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 500) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const idSuffix = stamp.toString(36);

async function newActorClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
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
    const debugPath = path.join(os.tmpdir(), `nakliye-measurement-login-debug-${Date.now()}-${attempt}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    console.error(`loginAs(${email}) deneme ${attempt} başarısız. url=${page.url()} ekran=${debugPath}`);
  }
  throw new Error(`loginAs(${email}) failed after 4 attempts`);
}

async function publishJob(page) {
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  try {
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  } catch (waitError) {
    const debugPath = path.join(os.tmpdir(), `nakliye-measurement-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error("publishJob: önizlemeye geçilemedi. Ekran görüntüsü:", debugPath);
    console.error("publishJob: görünür .text-danger metinleri:", JSON.stringify(dangerTexts));
    throw waitError;
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
}

// Nakliye de (Depo Hizmetleri grubuyla AYNI) en az 4 fotoğraf ister — bkz.
// photo-validation.ts#requiresWiderPhotoRange. Yinelenen içerik SHA-256 ile
// reddedildiği için her fotoğraf GERÇEKTEN farklı piksellerle üretilir.
async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 40, g: 150, b: 90 } } })
    .jpeg()
    .toBuffer();
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  const files = [];
  for (let i = 0; i < 4; i++) {
    files.push({ name: `test-fixture-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  }
  await fileInput.setInputFiles(files);
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function fillNakliyePickupLocation(page) {
  await selectSearchable(page, "İlçe", 0, "Dilovası");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
  await page.getByLabel("Açık Adres").nth(0).fill("Test Yükleme Açık Adresi, Dilovası");
  await selectSearchable(page, "İl", 1, "İstanbul");
  await selectSearchable(page, "İlçe", 1, "Kartal");
  await selectSearchable(page, "Liman / Sanayi / OSB", 1, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
  await page.getByLabel("Açık Adres").nth(1).fill("Test Teslim Açık Adresi, Kartal");
}

async function getJobFromSupabase(jobId, attempts = 3) {
  // NOT: bkz. admin hesabı yükseltme kısmındaki AYNI service_role platform
  // sınırlaması notu — admin.from("jobs").select(...) burada da çalışmaz.
  const { execSync } = await import("node:child_process");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const output = execSync(
        `npx supabase db query --linked "select id, moderation_status, nakliye_load_preparation_type, nakliye_load_preparation_custom_text, nakliye_loading_method, nakliye_measurement_info, updated_at from public.jobs where id = '${jobId}';"`,
        { cwd: "c:\\Users\\merta\\malsevk-2", stdio: "pipe" },
      ).toString();
      const rows = JSON.parse(output).rows ?? [];
      return rows[0] ?? null;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`getJobFromSupabase: deneme ${attempt} başarısız, tekrar deneniyor...`);
    }
  }
  return null;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `naklmeasure-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklMeasureTest Requester",
    companyName: "NaklMeasureTest Firma",
  });
  record("Kurulum: Hizmet Alan hesabı oluşturuldu", true);

  const adminAccount = await createAccount({
    email: `naklmeasure-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklMeasureTest Admin",
    companyName: "NaklMeasureTest Admin Firma",
  });
  {
    // NOT: `service_role` bu hosted Development projesinde `public` şemasındaki
    // hiçbir tabloya REST/PostgREST erişimine sahip değil (bkz. CLAUDE.md'nin
    // belgelediği, kasıtlı olarak yamalanmamış platform sınırlaması) — bu
    // yüzden admin.from("profiles").update(...) yerine CLI'ın Management API
    // üzerinden çalışan `supabase db query --linked` komutu kullanılır.
    const { execSync } = await import("node:child_process");
    execSync(`npx supabase db query --linked "update public.profiles set role = 'admin' where id = '${adminAccount.id}';"`, {
      cwd: "c:\\Users\\merta\\malsevk-2",
      stdio: "pipe",
    });
  }
  record("Kurulum: admin hesabı oluşturuldu ve yükseltildi", true);

  const browser = await chromium.launch();
  let jobId = null;

  try {
    // ============================================================
    // 1. Nakliye ilanı oluştur — Paletli + Euro Palet (otomatik dolum) +
    //    Üst üste istiflenebilir (istif katı açılır) + Yükleme Yöntemi.
    // ============================================================
    console.log("\n=== 1. Nakliye ilanı oluştur: Paletli + Euro Palet ===");
    const { page: reqPage } = await newActorPage(browser);
    await loginAs(reqPage, requester.email);

    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");

    // Kaldırılan alanlar hiç görünmesin.
    for (const removedLabel of ["Taşıma Şekli", "Sevkiyat Yapısı", "Boşaltma Yöntemi", "Sıcaklık Kontrollü", "Gabari Dışı"]) {
      const visible = await reqPage.getByText(removedLabel, { exact: false }).first().isVisible().catch(() => false);
      record(`Kaldırılan alan görünmüyor: ${removedLabel}`, !visible);
    }

    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklMeasure Test ${idSuffix}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Ölçü ve yerleşim bilgileri testi için oluşturulan otomatik ilan açıklaması.");
    await fillNakliyePickupLocation(reqPage);

    const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await reqPage.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await reqPage.locator('input[type="date"]').nth(1).fill(todayPlus7);

    // NOT: "Konteyner", "Konteyner Ürün/Yük Cinsi Kaldırma" göreviyle Nakliye'nin
    // Ürün/Yük Cinsi ÖNERİ listesinden çıkarıldı (serbest metin olarak hâlâ
    // yazılabilir ama artık bir öneri değil) — bu script'in ölçü/yerleşim
    // testleriyle ilgisiz olduğu için nötr bir metin kullanılır.
    await fillAndVerify(reqPage.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
    await selectSearchable(reqPage, "Yükün Hazırlanış Biçimi", 0, "Paletli");

    // "Ölçü ve Yerleşim Bilgileri" alt kartı açıldı mı?
    const measurementCardVisible = await reqPage.getByText("Ölçü ve Yerleşim Bilgileri", { exact: false }).first().isVisible().catch(() => false);
    record("Paletli seçilince 'Ölçü ve Yerleşim Bilgileri' alt kartı açıldı", measurementCardVisible);

    // Euro Palet seç -> En/Boy otomatik dolsun.
    await selectSearchable(reqPage, "Palet Ölçüsü", 0, "Euro Palet — 80 × 120 cm", { exact: false });
    await reqPage.waitForTimeout(300);
    const widthAfterEuro = await reqPage.getByLabel("En (cm)").first().inputValue();
    const lengthAfterEuro = await reqPage.getByLabel("Boy (cm)").first().inputValue();
    record("Euro Palet seçilince En=80 otomatik doldu", widthAfterEuro === "80", `got=${widthAfterEuro}`);
    record("Euro Palet seçilince Boy=120 otomatik doldu", lengthAfterEuro === "120", `got=${lengthAfterEuro}`);

    await fillAndVerify(reqPage.getByLabel("Yükseklik (cm)").first(), "150");

    // Yerleşim: Üst üste istiflenebilir -> istif katı açılmalı.
    await selectSearchable(reqPage, "Araçta Yerleşim Biçimi", 0, "Üst üste istiflenebilir");
    const stackFieldVisibleAfterUstUste = await reqPage.getByLabel("En Fazla İstif Katı").first().isVisible().catch(() => false);
    record("'Üst üste istiflenebilir' seçilince 'En Fazla İstif Katı' açıldı", stackFieldVisibleAfterUstUste);
    if (stackFieldVisibleAfterUstUste) {
      await fillAndVerify(reqPage.getByLabel("En Fazla İstif Katı").first(), "2");
    }

    // Başka yerleşime geç -> istif katı gizlenmeli.
    await selectSearchable(reqPage, "Araçta Yerleşim Biçimi", 0, "Yerleşim fark etmez");
    const stackFieldVisibleAfterFarketmez = await reqPage.getByLabel("En Fazla İstif Katı").first().isVisible().catch(() => false);
    record("Başka yerleşim seçilince 'En Fazla İstif Katı' gizlendi", !stackFieldVisibleAfterFarketmez);
    // Geri "Üst üste istiflenebilir"e dön (asıl senaryo için).
    await selectSearchable(reqPage, "Araçta Yerleşim Biçimi", 0, "Üst üste istiflenebilir");
    await fillAndVerify(reqPage.getByLabel("En Fazla İstif Katı").first(), "2");

    // NOT: "Dinamik Ürün Adedi" göreviyle bu alanın etiketi artık Yükün
    // Hazırlanış Biçimi'ne göre değişir (burada "Palet Adedi") — literal
    // "Ürün Adedi" metniyle aranamaz, id'ye göre bulunur (job-request-form.tsx#
    // serviceFieldId "productQuantity" metnini içerir).
    await fillAndVerify(reqPage.locator('input[id*="productQuantity"]').first(), "20");
    await fillAndVerify(reqPage.getByLabel("Toplam Ağırlık", { exact: false }).first(), "8,5");

    // Yükleme Yöntemi (Yükleme ve Teslimat bölümü).
    await selectSearchable(reqPage, "Yükleme Yöntemi", 0, "Forklift ile");

    // Araç Tercihi zorunlu (nakliyeci önersin) — kapsam dışı ama form geçerliliği için gerekli.
    await reqPage.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();

    await uploadOnePhoto(reqPage);
    await publishJob(reqPage);
    const jobUrl = reqPage.url();
    jobId = jobUrl.split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("İlan yayımlandı ve id alındı", Boolean(jobId), jobUrl);

    // ============================================================
    // 11. İlan detayında değerler doğru gösteriliyor mu?
    // ============================================================
    console.log("\n=== 11. İlan detay sayfası ===");
    await reqPage.goto(jobUrl, { waitUntil: "domcontentloaded" });
    // `useJobById` istemci tarafında (localStorage'dan, hidrasyon sonrası)
    // okunur — hidrasyon tamamlanmadan `isVisible()` geçici "İlan bulunamadı"
    // yanıp-sönmesini yakalayabilir, bu yüzden gerçek içerik beklenir.
    await reqPage.getByText("Paletli", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const detailHazirlanis = await reqPage.getByText("Paletli", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında 'Paletli' (Hazırlanış) gösteriliyor", detailHazirlanis);
    const detailOlcu = await reqPage.getByText("80 × 120 × 150 cm", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında birim ölçüsü '80 × 120 × 150 cm' gösteriliyor", detailOlcu);
    const detailYerlesim = await reqPage.getByText("Üst üste istiflenebilir", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında yerleşim 'Üst üste istiflenebilir' gösteriliyor", detailYerlesim);
    const detailIstif = await reqPage.getByText("2 kat", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında 'En fazla istif: 2 kat' gösteriliyor", detailIstif);
    const detailYukleme = await reqPage.getByText("Forklift ile", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında yükleme yöntemi 'Forklift ile' gösteriliyor", detailYukleme);

    // ============================================================
    // Supabase satırı doğrudan kontrol (senkron gerçekten oldu mu).
    // ============================================================
    console.log("\n=== Supabase satır kontrolü ===");
    let jobRow = await getJobFromSupabase(jobId);
    record("Supabase satırı bulundu", Boolean(jobRow));
    if (jobRow) {
      record("nakliye_load_preparation_type = paletli", jobRow.nakliye_load_preparation_type === "paletli", jobRow.nakliye_load_preparation_type);
      record("nakliye_loading_method = forklift", jobRow.nakliye_loading_method === "forklift", jobRow.nakliye_loading_method);
      record(
        "nakliye_measurement_info doğru (widthCm=80, placementType=ust-uste, maxStackCount=2)",
        jobRow.nakliye_measurement_info?.widthCm === 80 &&
          jobRow.nakliye_measurement_info?.placementType === "ust-uste" &&
          jobRow.nakliye_measurement_info?.maxStackCount === 2,
        JSON.stringify(jobRow.nakliye_measurement_info),
      );
    }

    // ============================================================
    // 12. Hizmet Alan ilan düzenleme — Rulo/Bobin'e değiştir, eski
    //     Paletli verisinin payload'a gitmediğini doğrula.
    // ============================================================
    console.log("\n=== 12. Hizmet Alan ilan düzenleme: Paletli -> Rulo/Bobin ===");
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`, { waitUntil: "domcontentloaded" });
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId}/duzenle`, { waitUntil: "domcontentloaded" });
    await reqPage.getByText("Yükün Hazırlanış Biçimi", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });

    const editPrefillType = await reqPage.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).first();
    const editPrefillText = await editPrefillType.innerText().catch(() => "");
    record("Düzenleme ekranı 'Paletli' değeriyle açıldı", editPrefillText.includes("Paletli"), editPrefillText);

    await selectSearchable(reqPage, "Yükün Hazırlanış Biçimi", 0, "Rulo / Bobin", { exact: false });
    await reqPage.waitForTimeout(200);
    const outerDiameterVisible = await reqPage.getByLabel("Dış Çap (cm)").first().isVisible().catch(() => false);
    record("Rulo/Bobin seçilince Dış Çap alanı açıldı", outerDiameterVisible);
    await fillAndVerify(reqPage.getByLabel("Dış Çap (cm)").first(), "60");
    await fillAndVerify(reqPage.getByLabel("İç Çap (cm)").first(), "10");
    await fillAndVerify(reqPage.getByLabel("Rulo/Bobin Genişliği (cm)").first(), "120");
    await selectSearchable(reqPage, "Araçta Yerleşim Biçimi", 0, "Dikey taşınmalı");

    await reqPage.getByRole("button", { name: "Kaydet" }).click();
    await reqPage.waitForURL((url) => url.pathname.includes(`/ilanlar/${jobId}`), { timeout: 20000 }).catch(async () => {
      await reqPage.waitForTimeout(1500);
    });

    await reqPage.waitForTimeout(1500);
    jobRow = await getJobFromSupabase(jobId);
    if (jobRow) {
      const info = jobRow.nakliye_measurement_info;
      record(
        "Düzenleme sonrası eski Paletli alanları (palletType/widthCm=80) payload'da YOK",
        info?.palletType === undefined && info?.widthCm !== 80,
        JSON.stringify(info),
      );
      record(
        "Düzenleme sonrası yeni Rulo/Bobin alanları doğru (outerDiameterCm=60, placementType=dikey)",
        info?.outerDiameterCm === 60 && info?.placementType === "dikey",
        JSON.stringify(info),
      );
      record("nakliye_load_preparation_type = rulo-bobin", jobRow.nakliye_load_preparation_type === "rulo-bobin", jobRow.nakliye_load_preparation_type);
    }

    // Düzenleme ekranını yeniden aç -> değerler korunmuş mu?
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId}/duzenle`, { waitUntil: "domcontentloaded" });
    await reqPage.getByText("Yükün Hazırlanış Biçimi", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    const reopenType = await reqPage.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).first().innerText();
    record("Yeniden açılan düzenleme ekranı 'Rulo / Bobin' gösteriyor", reopenType.includes("Rulo"), reopenType);
    const reopenOuterDiameter = await reqPage.getByLabel("Dış Çap (cm)").first().inputValue();
    record("Yeniden açılan düzenleme ekranı Dış Çap=60 gösteriyor", reopenOuterDiameter === "60", reopenOuterDiameter);

    // ============================================================
    // 13+14. Admin panelinde değerlerin görünüp değiştirilebildiğini ve
    //         onaydan sonra kaybolmadığını doğrula.
    // ============================================================
    console.log("\n=== 13+14. Admin panelinde görüntüleme/düzenleme/onay ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("Yükün Hazırlanış Biçimi", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const adminSeesLoadPrep = await adminPage.getByText("Rulo / Bobin", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında 'Rulo / Bobin' görünüyor", adminSeesLoadPrep);
    const adminSeesLoadingMethod = await adminPage.getByText("Forklift ile", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında 'Forklift ile' görünüyor", adminSeesLoadingMethod);
    const adminSeesMeasurement = await adminPage.getByText("Dikey taşınmalı", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında 'Dikey taşınmalı' (yerleşim) görünüyor", adminSeesMeasurement);

    // Admin edit formunu aç, değiştir.
    const editButton = adminPage.getByRole("button", { name: /Düzenle/i }).first();
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await adminPage.waitForTimeout(500);
      const adminFormLoadPrepValue = await adminPage.locator("select").filter({ hasText: /Rulo|Paletli|Big Bag/ }).first().inputValue().catch(() => null);
      record("Admin düzenleme formu Yükün Hazırlanış Biçimi=rulo-bobin ile açıldı", adminFormLoadPrepValue === "rulo-bobin", adminFormLoadPrepValue);
      const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await adminPage.waitForTimeout(1000);
      }
    }

    // Onayla.
    const approveButton = adminPage.getByRole("button", { name: /Onayla/i }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await adminPage.waitForTimeout(1000);
      record("Admin ilanı onayladı", true);
    } else {
      record("Admin ilanı onayladı", false, "Onayla butonu bulunamadı");
    }

    jobRow = await getJobFromSupabase(jobId);
    record("Admin onayı sonrası moderation_status=approved", jobRow?.moderation_status === "approved", jobRow?.moderation_status);
    record(
      "Admin onayı sonrası nakliye alanları KAYBOLMADI",
      jobRow?.nakliye_load_preparation_type === "rulo-bobin" && jobRow?.nakliye_measurement_info?.outerDiameterCm === 60,
      JSON.stringify({ type: jobRow?.nakliye_load_preparation_type, info: jobRow?.nakliye_measurement_info }),
    );

    // Yayımlanan ilan detayında (herkese açık) değerler hâlâ doğru mu?
    await reqPage.goto(jobUrl, { waitUntil: "domcontentloaded" });
    const publishedShowsRoll = await reqPage.getByText("Rulo / Bobin", { exact: false }).first().isVisible().catch(() => false);
    record("Onay sonrası yayımlanan ilan detayında 'Rulo / Bobin' gösteriliyor", publishedShowsRoll);

    // ============================================================
    // 5. "Ölçüleri bilmiyorum" seçilince ilan engellenmiyor mu? (yeni ilan)
    // ============================================================
    console.log("\n=== 5. 'Ölçüleri bilmiyorum' ile ilan oluşturma ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklMeasure Bilmiyorum ${idSuffix}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Ölçüleri bilmiyorum senaryosu için otomatik ilan açıklaması metni.");
    await fillNakliyePickupLocation(reqPage);
    await reqPage.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await reqPage.locator('input[type="date"]').nth(1).fill(todayPlus7);
    await fillAndVerify(reqPage.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
    await selectSearchable(reqPage, "Yükün Hazırlanış Biçimi", 0, "Big Bag");
    await reqPage.getByText("Ölçüleri bilmiyorum", { exact: false }).first().click();
    const fieldsHiddenAfterUnknown = await reqPage.getByLabel("En (cm)").first().isVisible().catch(() => false);
    record("'Ölçüleri bilmiyorum' işaretlenince ölçü alanları gizlendi", !fieldsHiddenAfterUnknown);
    await fillAndVerify(reqPage.locator('input[id*="productQuantity"]').first(), "5");
    await fillAndVerify(reqPage.getByLabel("Toplam Ağırlık", { exact: false }).first(), "3");
    await reqPage.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
    await uploadOnePhoto(reqPage);
    let publishBlocked = false;
    try {
      await publishJob(reqPage);
    } catch {
      publishBlocked = true;
    }
    record("'Ölçüleri bilmiyorum' ilan oluşturmayı ENGELLEMEDİ", !publishBlocked);

    // ============================================================
    // 9. Konteyner İçinde -> bilgilendirme mesajı, alan tekrarı yok.
    // ============================================================
    console.log("\n=== 9. Konteyner İçinde -> bilgilendirme, alan tekrarı yok ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await selectSearchable(reqPage, "Yükün Hazırlanış Biçimi", 0, "Konteyner İçinde", { exact: false });
    const containerInfoVisible = await reqPage.getByText("Özel Taşıma Koşulları", { exact: false }).first().isVisible().catch(() => false);
    record("Konteyner İçinde seçilince bilgilendirme mesajı gösteriliyor", containerInfoVisible);
    const containerHasNoWidthField = await reqPage.getByLabel("En (cm)").first().isVisible().catch(() => false);
    record("Konteyner İçinde için ölçü alanları TEKRARLANMADI", !containerHasNoWidthField);

    // ============================================================
    // 8. Dökme -> yalnız hacim.
    // ============================================================
    console.log("\n=== 8. Dökme -> yalnız hacim alanı ===");
    await selectSearchable(reqPage, "Yükün Hazırlanış Biçimi", 0, "Dökme");
    const bulkVolumeVisible = await reqPage.getByLabel("Yaklaşık Hacim (m³)").first().isVisible().catch(() => false);
    record("Dökme seçilince Hacim alanı açıldı", bulkVolumeVisible);
    const bulkWidthVisible = await reqPage.getByLabel("En (cm)").first().isVisible().catch(() => false);
    record("Dökme seçilince istif/ölçü alanları GÖSTERİLMEDİ", !bulkWidthVisible);

    // ============================================================
    // 16. Regresyon: Liman Hizmetleri (Nakliye DIŞI) etkilenmedi mi?
    // ============================================================
    console.log("\n=== 16. Regresyon: Liman Hizmetleri etkilenmedi ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("lashing-unlashing");
    const limanHasMeasurementCard = await reqPage.getByText("Ölçü ve Yerleşim Bilgileri", { exact: false }).first().isVisible().catch(() => false);
    record("Liman Hizmetleri kartında 'Ölçü ve Yerleşim Bilgileri' hiç YOK (regresyon)", !limanHasMeasurementCard);
    const limanHasLoadPrep = await reqPage.getByText("Yükün Hazırlanış Biçimi", { exact: false }).first().isVisible().catch(() => false);
    record("Liman Hizmetleri kartında 'Yükün Hazırlanış Biçimi' hiç YOK (regresyon)", !limanHasLoadPrep);
  } finally {
    await browser.close();
  }

  console.log("\n=== SONUÇ ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length > 0) {
    console.log("BAŞARISIZ TESTLER:");
    for (const f of failed) console.log(` - ${f.name} :: ${f.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("SCRIPT HATASI:", err);
  process.exitCode = 1;
});
