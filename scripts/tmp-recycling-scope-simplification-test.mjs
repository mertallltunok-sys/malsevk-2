// node scripts/tmp-recycling-scope-simplification-test.mjs
//
// Geri Dönüşüm & Atık Tahliye "Hizmet Kapsamı" sadeleştirmesinin uçtan uca
// doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı.
//
// Kapsam: yalnız "Sahadan Toplama" ile ilan; "Araca Yükleme + Taşıma" ile
// ilan; 4 işlemi tek tek seçince "Tüm Süreç"in otomatik aktifleşmesi; "Tüm
// Süreç" ile toplu seç/kaldır; hiç seçim yapmadan yayımlama denemesi (hata +
// odak); admin görüntüleme/düzenleme/onay sonrası kapsamın korunması; ilan
// detayında yalnız seçili rozetlerin görünmesi; yetkili Hizmet Veren
// görünümü/kategori izolasyonu; Taşıma+ayrı Nakliye bilgilendirmesi (ikinci
// bir Nakliye ilanı OLUŞTURMADIĞININ kanıtı); eski "yukleme" id'li bir
// ilanın hâlâ doğru ("Araca Yükleme") gösterilmesi; mobilde yatay taşma
// kontrolü.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

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
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 350) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const idSuffix = stamp.toString(36);
const createdUserIds = [];
const createdJobIds = [];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
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
  return { id: data.user.id, email, client };
}

async function newActorPage(browser, viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("BROWSER CONSOLE ERROR:", msg.text());
  });
  return { context, page };
}

async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick (wanted "${value}")`);
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
  }
  throw new Error(`loginAs(${email}) failed after 4 attempts`);
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function publishJob(page) {
  // Tek servis: buton metni "İlanı Yayınla". 2+ servisli operasyonda ise
  // "{N} Hizmet İlanını Yayınla" (bkz. job-request-form.tsx:1428-1429) —
  // önizleme adımındaki ikinci tıklama bu yüzden regex ile HER İKİSİNİ de
  // eşleştirir.
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /İlanı Yayınla$|Hizmet İlanını Yayınla$/ }).click();
  await page.waitForURL(/\/(ilanlar\/|panel\/hizmet-taleplerim)/, { timeout: 20000 });
}

async function uploadOnePhoto(page) {
  const TINY_JPEG_BASE64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";
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

async function fillBaseRecyclingFields(page, title, description) {
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("geri-donusum-atik-tahliye");
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill(description);
  await page.getByLabel("Başlangıç Tarihi").first().fill(todayPlus(20));
  await page.getByLabel("Bitiş Tarihi").first().fill(todayPlus(20));
  await selectSearchable(page, "İlçe", 0, "Dilovası");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
  await page.getByLabel("Açık Adres").nth(0).fill("Test Açık Adres");
  await selectSearchable(page, "Malzeme Kategorisi", 0, "Metal Hurda");
  await selectSearchable(page, "Alt Tür", 0, "Demir / Çelik");
  await page.getByLabel("Tahmini Miktar").first().fill("8");
  await selectSearchable(page, "Birim", 0, "ton");
  await selectSearchable(page, "Malzeme Durumu", 0, "Ayrıştırılmış");
  await uploadOnePhoto(page);
}

async function getJobFromSupabase(jobId) {
  const rows = runSql(`select id, recycling_scope_of_work, category_id, moderation_status from public.jobs where id = '${jobId}';`);
  return rows[0] ?? null;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `recyscope-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "RecyScope Requester",
    companyName: "RecyScope Firma",
  });
  record("Kurulum: Hizmet Alan hesabı oluşturuldu", true);

  const provider = await createAccount({
    email: `recyscope-prov-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "RecyScope Provider",
    companyName: "RecyScope Provider Firma",
  });
  record("Kurulum: Hizmet Veren hesabı oluşturuldu", true);

  const adminAccount = await createAccount({
    email: `recyscope-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "RecyScope Admin",
    companyName: "RecyScope Admin Firma",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: admin hesabı oluşturuldu ve yükseltildi", true);

  runSql(
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_by, authorize_reason) values ('${provider.id}', 'geri-donusum-atik-tahliye', '${adminAccount.id}', 'test setup');`,
  );
  record("Kurulum: provider Geri Dönüşüm için yetkilendirildi", true);

  const browser = await chromium.launch();
  try {
    // ============================================================
    // 1. Yalnız "Sahadan Toplama" ile ilan
    // ============================================================
    console.log("\n=== 1. Yalnız Sahadan Toplama ===");
    const { page: reqPage } = await newActorPage(browser);
    await loginAs(reqPage, requester.email);
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    await fillBaseRecyclingFields(reqPage, `RecyScope Tek İşlem ${idSuffix}`, "Yalnız sahadan toplama testi açıklaması yirmi karakterden uzun.");

    const newLabel = "Hangi işlemler hizmete dahil olsun?";
    const labelVisible = await reqPage.getByText(newLabel, { exact: false }).first().isVisible().catch(() => false);
    record("Yeni başlık gösteriliyor: 'Hangi işlemler hizmete dahil olsun?'", labelVisible);
    const oldTesisOptionVisible = await reqPage.getByRole("button", { name: "Tesisten tahliye", exact: false }).isVisible().catch(() => false);
    record("Eski 'Tesisten tahliye' seçeneği YENİ ilanlarda gösterilmiyor", !oldTesisOptionVisible);

    await reqPage.getByRole("button", { name: "Sahadan Toplama", exact: true }).click();
    await publishJob(reqPage);
    const jobSingle = reqPage.url().split("/").pop().split("?")[0];
    createdJobIds.push(jobSingle);
    const rowSingle = await getJobFromSupabase(jobSingle);
    record(
      "Supabase: yalnız ['sahadan-toplama'] kaydedildi",
      rowSingle && JSON.stringify(rowSingle.recycling_scope_of_work) === JSON.stringify(["sahadan-toplama"]),
      JSON.stringify(rowSingle),
    );

    // ============================================================
    // 2. "Araca Yükleme + Taşıma"
    // ============================================================
    console.log("\n=== 2. Araca Yükleme + Taşıma ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await fillBaseRecyclingFields(reqPage, `RecyScope İki İşlem ${idSuffix}`, "Araca yükleme ve taşıma testi açıklaması yirmi karakterden uzun.");
    await reqPage.getByRole("button", { name: "Araca Yükleme", exact: true }).click();
    await reqPage.getByRole("button", { name: "Taşıma", exact: true }).click();
    const tumSurecPartial = await reqPage.getByRole("button", { name: "Tüm Süreç", exact: true }).getAttribute("aria-pressed");
    record("2/4 seçiliyken 'Tüm Süreç' aktif GÖRÜNMÜYOR", tumSurecPartial === "false", tumSurecPartial);
    await publishJob(reqPage);
    const jobTwo = reqPage.url().split("/").pop().split("?")[0];
    createdJobIds.push(jobTwo);
    const rowTwo = await getJobFromSupabase(jobTwo);
    record(
      "Supabase: ['araca-yukleme','tasima'] kaydedildi (tum-surec YOK)",
      rowTwo &&
        rowTwo.recycling_scope_of_work.length === 2 &&
        rowTwo.recycling_scope_of_work.includes("araca-yukleme") &&
        rowTwo.recycling_scope_of_work.includes("tasima") &&
        !rowTwo.recycling_scope_of_work.includes("tum-surec"),
      JSON.stringify(rowTwo),
    );

    // ============================================================
    // 3+4+5. Tüm Süreç davranışı: tek tek seçince otomatik aktif, tıklayınca toplu seç/kaldır
    // ============================================================
    console.log("\n=== 3+4+5. Tüm Süreç davranışı ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("geri-donusum-atik-tahliye");

    for (const label of ["Sahadan Toplama", "Araca Yükleme", "Taşıma", "Tesise Teslim"]) {
      await reqPage.getByRole("button", { name: label, exact: true }).click();
    }
    const tumSurecAfterManualAll = await reqPage.getByRole("button", { name: "Tüm Süreç", exact: true }).getAttribute("aria-pressed");
    record("4/4 tek tek seçilince 'Tüm Süreç' OTOMATİK aktif görünüyor", tumSurecAfterManualAll === "true", tumSurecAfterManualAll);

    await reqPage.getByRole("button", { name: "Sahadan Toplama", exact: true }).click(); // deselect one
    const tumSurecAfterOneRemoved = await reqPage.getByRole("button", { name: "Tüm Süreç", exact: true }).getAttribute("aria-pressed");
    record("Bir seçim kaldırılınca 'Tüm Süreç' aktiflikten ÇIKIYOR", tumSurecAfterOneRemoved === "false", tumSurecAfterOneRemoved);

    await reqPage.getByRole("button", { name: "Tüm Süreç", exact: true }).click(); // click while partial -> selects all 4
    const allFourAfterClick = await Promise.all(
      ["Sahadan Toplama", "Araca Yükleme", "Taşıma", "Tesise Teslim"].map((label) =>
        reqPage.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"),
      ),
    );
    record("'Tüm Süreç' tıklanınca (kısmi seçimken) 4 işlem birden SEÇİLİYOR", allFourAfterClick.every((v) => v === "true"), JSON.stringify(allFourAfterClick));

    await reqPage.getByRole("button", { name: "Tüm Süreç", exact: true }).click(); // click while all 4 -> clears all
    const allFourAfterSecondClick = await Promise.all(
      ["Sahadan Toplama", "Araca Yükleme", "Taşıma", "Tesise Teslim"].map((label) =>
        reqPage.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"),
      ),
    );
    record(
      "'Tüm Süreç' tekrar tıklanınca (4/4 iken) 4 işlem birden KALDIRILIYOR",
      allFourAfterSecondClick.every((v) => v === "false"),
      JSON.stringify(allFourAfterSecondClick),
    );

    // ============================================================
    // 6. Hiç seçim yapmadan yayımlama denemesi
    // ============================================================
    console.log("\n=== 6. Hiç seçim yapmadan yayımlama denemesi ===");
    await fillBaseRecyclingFields(reqPage, `RecyScope Hatali ${idSuffix}`, "Hicbir islem secmeden yayinlama denemesi testi.");
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    const errorVisible = await reqPage.getByText("En az bir işlem seçmelisiniz.", { exact: false }).isVisible({ timeout: 5000 }).catch(() => false);
    record("Hata mesajı 'En az bir işlem seçmelisiniz.' gösteriliyor", errorVisible);
    const stillOnForm = !(await reqPage.getByRole("heading", { name: "Operasyon Özeti" }).isVisible({ timeout: 2000 }).catch(() => false));
    record("Yayımlama engellendi (önizlemeye geçmedi)", stillOnForm);
    const scopeGroupFocused = await reqPage.evaluate(() => {
      // Odak hedefi, MultiSelectChips'in DIŞ (id'li) div'idir — `role="group"`
      // ise onun İÇİNDEKİ bir alt eleman, bu yüzden `.closest()` (yukarı
      // arama) DEĞİL `.querySelector()` (aşağı arama) ile kontrol edilir.
      const active = document.activeElement;
      if (!active) return false;
      const group = active.matches('[role="group"]') ? active : active.querySelector('[role="group"]');
      return group?.getAttribute("aria-label") === "Hangi işlemler hizmete dahil olsun?";
    });
    record("Hata sonrası odak kapsam alanına gitti", scopeGroupFocused);

    // ============================================================
    // 12. Taşıma + ayrı Nakliye hizmeti bilgilendirmesi (çoklu hizmet operasyonu)
    // ============================================================
    console.log("\n=== 12. Taşıma + ayrı Nakliye bilgilendirmesi ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await fillBaseRecyclingFields(reqPage, `RecyScope Operasyon Ana ${idSuffix}`, "Operasyon ana hizmet aciklamasi yirmi karakterden uzun olmali.");
    await reqPage.getByRole("button", { name: "Taşıma", exact: true }).click();

    const noticeBeforeAdd = await reqPage.getByText("Taşıma işlemi bu hizmetin kapsamına zaten dahil.", { exact: false }).isVisible().catch(() => false);
    record("Yalnız 1 kart varken (Nakliye eklenmeden) bilgilendirme GÖRÜNMÜYOR", !noticeBeforeAdd);

    await reqPage.getByRole("button", { name: "Ek hizmet ekle", exact: false }).click();
    await reqPage.getByLabel("Hizmet Kategorisi").nth(1).selectOption("nakliye");
    const noticeAfterAdd = await reqPage.getByText("Taşıma işlemi bu hizmetin kapsamına zaten dahil.", { exact: false }).isVisible().catch(() => false);
    record("Taşıma seçiliyken ayrı Nakliye kartı eklenince bilgilendirme GÖRÜNÜYOR", noticeAfterAdd);

    await reqPage.getByLabel("İlan Başlığı").nth(1).fill(`RecyScope Operasyon Nakliye ${idSuffix}`);
    await reqPage.getByLabel("Hizmete Özel Açıklama").nth(1).fill("Ek Nakliye hizmeti aciklamasi yirmi karakterden uzun olmali.");
    await reqPage.getByLabel("Başlangıç Tarihi").nth(1).fill(todayPlus(20));
    await reqPage.getByLabel("Bitiş Tarihi").nth(1).fill(todayPlus(20));
    // "Ana hizmetle aynı lokasyon" varsayılan işaretli (index>0 servisler
    // için) — işaret kaldırılmadan Nakliye kartının kendi Yük Alınacak
    // Yer (pickup) alanları HİÇ render edilmez, yalnız Teslim Edilecek Yer
    // bloğu görünür. Bu yüzden önce bu kutuyu kaldırmak gerekiyor.
    await reqPage.getByLabel("Ana hizmetle aynı lokasyon").uncheck();
    // Pickup (Yük Alınacak Yer) İl'i "Kocaeli" varsayılanıyla zaten dolu
    // geliyor (bkz. job-request-form.tsx'in paylaşılan varsayılan ili) —
    // yalnızca İlçe/Tesis/Açık Adres seçilmesi yeterli. "İl" nth(1) burada
    // KASTEN tıklanmıyor — tıklanırsa pickup'ın kendi il'ini değiştirip
    // az önce seçilen ilçe/tesisi sıfırlar (bkz. NakliyeLocationFields'ın
    // "il/ilçe değişince facilityId/addressText temizlenir" kuralı).
    await selectSearchable(reqPage, "İlçe", 1, "Dilovası");
    await selectSearchable(reqPage, "Liman / Sanayi / OSB", 1, "Beldeport", { exact: false });
    await reqPage.getByLabel("Açık Adres").nth(1).fill("Test Nakliye Yükleme Adresi");
    // Teslim Edilecek Yer (delivery) kendi İl/İlçe çiftine sahip — sayfada
    // 3. "İl" ve 3. "İlçe" düğmesi (nth(2)), pickup'tan AYRI ve varsayılan
    // olarak BOŞ (delivery province hiçbir zaman Kocaeli'ye ön-dolmaz) —
    // bu yüzden İlçe seçilebilmesi için önce burada İl SEÇİLMEK ZORUNDA.
    await selectSearchable(reqPage, "İl", 2, "İstanbul");
    await selectSearchable(reqPage, "İlçe", 2, "Kartal");
    await selectSearchable(reqPage, "Liman / Sanayi / OSB", 2, "Listede yok, kendim gireceğim");
    await reqPage.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
    await reqPage.getByLabel("Açık Adres").nth(2).fill("Test Nakliye Teslim Adresi");
    // Yalnız Nakliye kartı "Ürün Adedi"/"Ürün Cinsi"/"Toplam Ağırlık" render
    // eder — Geri Dönüşüm kartı (service 0) bunun yerine kendi "Tahmini
    // Miktar" alanını kullanır, bu yüzden sayfada bu 3 etiketten yalnızca
    // BİRER tane var (nth(0), nth(1) DEĞİL).
    await reqPage.getByLabel("Ürün Adedi").nth(0).fill("5");
    await reqPage.getByLabel("Ürün Cinsi").nth(0).fill("Test Ürün");
    await reqPage.getByLabel("Toplam Ağırlık", { exact: false }).nth(0).fill("5");
    await uploadOnePhoto(reqPage);

    await publishJob(reqPage);
    record("Çoklu hizmet operasyonu başarıyla yayınlandı (bilgilendirme engellemedi)", reqPage.url().includes("/panel/hizmet-taleplerim") || reqPage.url().includes("/ilanlar/"), reqPage.url());
    const operationJobsRows = runSql(
      `select id, category_id, recycling_scope_of_work from public.jobs where title in ('RecyScope Operasyon Ana ${idSuffix}', 'RecyScope Operasyon Nakliye ${idSuffix}');`,
    );
    for (const row of operationJobsRows) createdJobIds.push(row.id);
    record(
      "Tam olarak 2 ilan oluştu (otomatik 3. bir Nakliye ilanı OLUŞMADI)",
      operationJobsRows.length === 2,
      JSON.stringify(operationJobsRows.map((r) => r.category_id)),
    );

    // ============================================================
    // 7+8+9. Admin görüntüleme/düzenleme/onay
    // ============================================================
    console.log("\n=== 7+8+9. Admin görüntüleme/düzenleme/onay ===");
    runSql(`update public.jobs set moderation_status = 'approved' where id in (${createdJobIds.map((id) => `'${id}'`).join(",")});`);

    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded" });
    // Varsayılan sekme "Onay Bekleyen" — jobTwo'yu SQL ile önceden
    // "approved" yaptığımız için o sekmede GÖRÜNMEZ, "Tümü" sekmesine
    // geçmek gerekiyor.
    await adminPage.getByRole("button", { name: /^Tümü/ }).click();
    await adminPage.getByText(`RecyScope İki İşlem ${idSuffix}`, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage
      .locator("tr", { hasText: `RecyScope İki İşlem ${idSuffix}` })
      .first()
      .getByRole("link", { name: "Detay" })
      .click();
    await adminPage.waitForURL(/\/admin\/ilanlar\//, { timeout: 15000 });
    await adminPage.getByRole("button", { name: "İlanı Düzenle", exact: false }).first().click();
    await adminPage.getByText("Hizmet Kapsamı", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const arocaCheckedInAdmin = await adminPage.locator('label:has-text("Araca Yükleme") input[type="checkbox"]').isChecked().catch(() => false);
    const tasimaCheckedInAdmin = await adminPage.locator('label:has-text("Taşıma") input[type="checkbox"]').isChecked().catch(() => false);
    record("Admin düzenleme ekranında mevcut seçimler doğru ön-dolduruluyor (Araca Yükleme+Taşıma)", arocaCheckedInAdmin && tasimaCheckedInAdmin);

    await adminPage.getByRole("button", { name: "Değişiklikleri Kaydet", exact: false }).click();
    await adminPage.waitForTimeout(1500);
    const rowAfterAdminSave = await getJobFromSupabase(jobTwo);
    record(
      "Admin kaydettikten SONRA kapsam DEĞİŞMEDİ (veri kaybı yok)",
      rowAfterAdminSave &&
        rowAfterAdminSave.recycling_scope_of_work.length === 2 &&
        rowAfterAdminSave.recycling_scope_of_work.includes("araca-yukleme") &&
        rowAfterAdminSave.recycling_scope_of_work.includes("tasima"),
      JSON.stringify(rowAfterAdminSave),
    );

    // ============================================================
    // 10. İlan detayında yalnız seçili rozetler
    // ============================================================
    console.log("\n=== 10. İlan detayı rozetleri ===");
    const { page: detailPage } = await newActorPage(browser);
    await loginAs(detailPage, requester.email);
    await detailPage.goto(`${APP_ORIGIN}/ilanlar/${jobTwo}`, { waitUntil: "domcontentloaded" });
    await detailPage.waitForFunction((t) => document.body.innerText.includes(t), "Hizmet Kapsamı", { timeout: 15000 }).catch(() => {});
    const detailText = await detailPage.locator("main, body").first().innerText();
    record(
      "Detayda 'Araca Yükleme' ve 'Taşıma' rozetleri var, diğer 2 YOK",
      detailText.includes("Araca Yükleme") &&
        detailText.includes("Taşıma") &&
        !detailText.includes("Sahadan Toplama") &&
        !detailText.includes("Tesise Teslim") &&
        !detailText.includes("Tüm Süreç"),
      detailText.match(/Hizmet Kapsamı[\s\S]{0,120}/)?.[0],
    );

    // ============================================================
    // 11. Yetkili Hizmet Veren görünümü + kategori izolasyonu
    // ============================================================
    console.log("\n=== 11. Yetkili Hizmet Veren görünümü ===");
    const { page: provPage } = await newActorPage(browser);
    await loginAs(provPage, provider.email);
    await provPage.goto(`${APP_ORIGIN}/ilanlar/${jobTwo}`, { waitUntil: "domcontentloaded" });
    await provPage.waitForTimeout(1500); // uzak (Supabase) ilan listesi fallback fetch'inin oturması için
    const offerFormVisible = await provPage.getByLabel("Teklif Tutarı", { exact: false }).first().isVisible({ timeout: 10000 }).catch(() => false);
    if (!offerFormVisible) {
      const diag = await provPage.locator("main, body").first().innerText().catch(() => "(okunamadı)");
      console.log("TEŞHİS (scenario 11 offer panel bölgesi):", diag.slice(0, 800));
    }
    record("Yetkili Hizmet Veren teklif formunu görebiliyor (kategori izolasyonu bozulmadı)", offerFormVisible);

    // ============================================================
    // 14. Eski "yukleme" id'li ilan hâlâ doğru gösteriliyor
    // ============================================================
    console.log("\n=== 14. Eski 'yukleme' id'li ilan uyumluluğu ===");
    runSql(`update public.jobs set recycling_scope_of_work = array['sahadan-toplama','yukleme'] where id = '${jobSingle}';`);
    await detailPage.goto(`${APP_ORIGIN}/ilanlar/${jobSingle}`, { waitUntil: "domcontentloaded" });
    await detailPage.waitForFunction((t) => document.body.innerText.includes(t), "Hizmet Kapsamı", { timeout: 15000 }).catch(() => {});
    const legacyDetailText = await detailPage.locator("main, body").first().innerText();
    record(
      "Eski 'yukleme' id'si detayda 'Araca Yükleme' olarak gösteriliyor (undefined/boş değil)",
      legacyDetailText.includes("Sahadan Toplama") && legacyDetailText.includes("Araca Yükleme") && !legacyDetailText.includes("undefined"),
      legacyDetailText.match(/Hizmet Kapsamı[\s\S]{0,120}/)?.[0],
    );

    // Admin düzenleme ekranı da eski id'yi doğru checkbox'a eşlemeli.
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: /^Tümü/ }).click();
    await adminPage.getByText(`RecyScope Tek İşlem ${idSuffix}`, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage
      .locator("tr", { hasText: `RecyScope Tek İşlem ${idSuffix}` })
      .first()
      .getByRole("link", { name: "Detay" })
      .click();
    await adminPage.waitForURL(/\/admin\/ilanlar\//, { timeout: 15000 });
    await adminPage.getByRole("button", { name: "İlanı Düzenle", exact: false }).first().click();
    await adminPage.getByText("Hizmet Kapsamı", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const legacyArocaCheckedInAdmin = await adminPage.locator('label:has-text("Araca Yükleme") input[type="checkbox"]').isChecked().catch(() => false);
    record("Admin düzenleme ekranı da eski 'yukleme' id'sini 'Araca Yükleme' olarak DOĞRU işaretliyor", legacyArocaCheckedInAdmin);

    // ============================================================
    // 13. Mobilde yatay taşma kontrolü
    // ============================================================
    console.log("\n=== 13. Mobil yatay taşma kontrolü ===");
    const { page: mobilePage } = await newActorPage(browser, { width: 390, height: 844 });
    await loginAs(mobilePage, requester.email);
    await mobilePage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await mobilePage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await mobilePage.getByLabel("Hizmet Kategorisi").first().selectOption("geri-donusum-atik-tahliye");
    await mobilePage.getByText("Hangi işlemler hizmete dahil olsun?", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const mobileMetrics = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    record("Mobilde yatay taşma yok (scrollWidth<=clientWidth)", mobileMetrics.scrollWidth <= mobileMetrics.clientWidth + 1, JSON.stringify(mobileMetrics));
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
