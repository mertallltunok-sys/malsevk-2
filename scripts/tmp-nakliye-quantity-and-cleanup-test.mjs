// node scripts/tmp-nakliye-quantity-and-cleanup-test.mjs
//
// "MALSEVK Nakliye Yük Bilgileri — Dinamik Ürün Adedi, Konteyner Ürün/Yük
// Cinsi Kaldırma, Ek Yükleme/Teslimat Koşulları Kaldırma" görevlerinin uçtan
// uca doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı, migration
// 0062/0063 sonrası (bu görev için YENİ bir migration yazılmadı — bkz. görev
// tanımının "gerekliyse migration" şartı, tüm alanlar zaten mevcut).
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı, NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execSync } from "node:child_process";
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
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 600) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();

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

// `service_role` bu hosted Development projesinde `public` şemasındaki
// hiçbir tabloya REST/PostgREST erişimine sahip değil (bkz. CLAUDE.md'nin
// belgelediği, kasıtlı olarak yamalanmamış platform sınırlaması — bir GRANT
// ile "düzeltilmemesi" gerekiyor). Bunun yerine, CLI'ın Management API
// üzerinden çalışan `supabase db query --linked` komutu admin-only SQL için
// kullanılır (bu görev sırasında keşfedilip doğrulanan çalışan yöntem).
function runSql(sql, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const output = execSync(`npx supabase db query --linked "${sql}"`, { cwd: "c:\\Users\\merta\\malsevk-2", stdio: "pipe" }).toString();
      const parsed = JSON.parse(output);
      return parsed.rows ?? [];
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`runSql: deneme ${attempt} başarısız, tekrar deneniyor...`);
    }
  }
  return [];
}

function promoteToAdmin(userId) {
  runSql(`update public.profiles set role = 'admin' where id = '${userId}';`);
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

// Job detay/düzenleme sayfaları `useJobById`/`useSyncExternalStore` ile
// localStorage'dan istemci tarafında hidrasyon sonrası okunur (`getServerSnapshot`
// her zaman `null` döner — bkz. CLAUDE.md "No real backend"). `domcontentloaded`
// hidrasyon TAMAMLANMADAN ateşlenebilir; bu anda body metnini okumak geçici
// "İlan bulunamadı." yanıp-sönmesini yakalayabilir. Bu yüzden gerçek okumadan
// ÖNCE bu geçici durumun geçmesini bekleriz.
async function waitForHydratedJobContent(page, timeout = 10000) {
  await page
    .waitForFunction(() => !document.body.innerText.includes("İlan bulunamadı"), { timeout })
    .catch(() => {});
  await page.waitForTimeout(300);
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
    const debugPath = path.join(os.tmpdir(), `nakliye-quantity-login-debug-${Date.now()}-${attempt}.png`);
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
    const debugPath = path.join(os.tmpdir(), `nakliye-quantity-preview-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error("publishJob: önizlemeye geçilemedi. Ekran görüntüsü:", debugPath);
    console.error("publishJob: görünür .text-danger metinleri:", JSON.stringify(dangerTexts));
    throw waitError;
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
}

// Nakliye kategorisi de (Depo Hizmetleri grubuyla AYNI) en az 4 fotoğraf
// ister — bkz. photo-validation.ts#requiresWiderPhotoRange. Yinelenen içerik
// SHA-256 ile reddedildiği için (photo-validation.ts) her fotoğraf GERÇEKTEN
// farklı piksellerle üretilir.
async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 40, g: 100, b: 200 } } })
    .jpeg()
    .toBuffer();
}

async function uploadPhotos(page, count) {
  const fileInput = page.locator('input[type="file"]');
  const files = [];
  for (let i = 0; i < count; i++) {
    files.push({ name: `test-fixture-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  }
  await fileInput.setInputFiles(files);
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 20000 },
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

function getJobFromSupabase(jobId) {
  const rows = runSql(
    `select id, product_type, product_quantity, nakliye_load_preparation_type, nakliye_measurement_info, moderation_status from public.jobs where id = '${jobId}';`,
  );
  return rows[0] ?? null;
}

async function readLocalJob(page, jobId) {
  return page.evaluate((id) => {
    const raw = window.localStorage.getItem("malsevk.jobs.v1");
    if (!raw) return null;
    const jobs = JSON.parse(raw);
    return jobs.find((j) => j.id === id) ?? null;
  }, jobId);
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ortam değişkenlerinde tanımlı olmalı.");
  }

  const requester = await createAccount({
    email: `nq-requester-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "Test Requester NQ",
    companyName: "Test Requester Şirketi NQ",
  });
  const adminAcc = await createAccount({
    email: `nq-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "Test Admin NQ",
    companyName: "Test Admin Şirketi NQ",
  });
  promoteToAdmin(adminAcc.id);
  console.log("Hesaplar oluşturuldu:", requester.email, adminAcc.email);

  const browser = await chromium.launch();
  try {
    const { page } = await newActorPage(browser);
    await loginAs(page, requester.email);

    // ============================================================
    // TEST GRUBU A — Dinamik Ürün Adedi (Paletli) + Ek Koşullar Kaldırma
    // ============================================================
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption({ label: "Nakliye" });
    await page.getByLabel("İlan Başlığı").fill("NQ Test — Paletli Adet Testi");
    await page.getByLabel("Hizmete Özel Açıklama").fill("Dinamik ürün adedi testleri için oluşturulan test ilanı — en az yirmi karakter.");

    // "+ Ek yükleme koşulları" / "+ Ek teslimat koşulları" TAMAMEN kaldırıldı mı?
    const bodyText = await page.locator("body").innerText();
    record(
      "A1: '+ Ek yükleme koşulları' / '+ Ek teslimat koşulları' formda YOK",
      !bodyText.includes("Ek yükleme koşulları") && !bodyText.includes("Ek teslimat koşulları"),
    );

    // Ürün/Yük Cinsi önerilerinde "Konteyner" YOK (Nakliye'ye özel filtrelenmiş liste).
    const productTypeInput = page.getByRole("combobox", { name: "Ürün/Yük Cinsi" });
    await productTypeInput.click();
    const productTypeListbox = page.locator('ul[aria-label="Ürün/Yük Cinsi"]').first();
    await productTypeListbox.waitFor({ state: "visible" });
    const suggestionTexts = await productTypeListbox.getByRole("option").allInnerTexts();
    record(
      "B1: Nakliye 'Ürün/Yük Cinsi' önerilerinde 'Konteyner' YOK",
      !suggestionTexts.some((t) => t.trim() === "Konteyner"),
      JSON.stringify(suggestionTexts),
    );
    await page.keyboard.press("Escape").catch(() => {});
    await fillAndVerify(productTypeInput, "Çelik Rulo Test");

    // Yükün Hazırlanış Biçimi = Paletli → dinamik etiket "Palet Adedi" / "palet".
    await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
    const quantityLabelA = await page.locator('label[for*="productQuantity"], label:has-text("Palet Adedi")').first().innerText().catch(() => "");
    record("A2: Paletli seçilince etiket 'Palet Adedi' oldu", quantityLabelA.includes("Palet Adedi"), quantityLabelA);
    const unitSuffixA = await page
      .locator('span[aria-hidden="true"]')
      .filter({ hasText: /^palet$/ })
      .first()
      .innerText()
      .catch(() => "");
    record("A3: Paletli seçilince birim 'palet' gösteriliyor", unitSuffixA.trim() === "palet", unitSuffixA);

    // Ürün Adedi = 20 (artık "Palet Adedi" olarak render ediliyor, aynı input).
    await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "20");
    await page.getByLabel("Toplam Ağırlık").first().fill("8,5");

    await fillNakliyePickupLocation(page);

    const today = new Date();
    const workDate = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const workEndDate = new Date(today.getTime() + 4 * 86400000).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').nth(0).fill(workDate);
    await page.locator('input[type="date"]').nth(1).fill(workEndDate);

    // Ölçü ve Yerleşim — Euro Palet auto-fill.
    await selectSearchable(page, "Palet Ölçüsü", 0, "Euro Palet — 80 × 120 cm", { exact: false });
    const widthValue = await page.getByLabel("En (cm)").first().inputValue();
    record("A4: Euro Palet seçilince En otomatik dolduruldu (80)", widthValue === "80", widthValue);

    await selectSearchable(page, "Yükleme Yöntemi", 0, "Forklift ile");
    await page.getByText("Nakliyeci uygun aracı önersin").click();

    await uploadPhotos(page, 4);
    await publishJob(page);

    const jobIdA = page.url().split("/ilanlar/")[1];
    console.log("Job A (Paletli) oluşturuldu:", jobIdA);

    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page);
    const detailTextA = await page.locator("body").innerText();
    if (!detailTextA.includes("Ürün Bilgileri")) {
      console.log("--- DEBUG: 'Ürün Bilgileri' bulunamadı, TAM body metni ---");
      console.log(detailTextA);
      console.log("--- DEBUG SONU ---");
    }
    record("A5: Detay sayfasında 'Palet Adedi: 20 palet' görünüyor", detailTextA.includes("Palet Adedi") && detailTextA.includes("20 palet"), detailTextA.match(/Palet Adedi[^\n]*/)?.[0]);
    record("A6: Detay sayfasında düz 'Ürün Adedi: 20 adet' YOK", !detailTextA.includes("Ürün Adedi: 20 adet"));

    const supabaseJobA = await getJobFromSupabase(jobIdA);
    record("A7: Supabase'e product_quantity=20 senkronlandı", supabaseJobA?.product_quantity === 20, JSON.stringify(supabaseJobA));

    // ============================================================
    // TEST GRUBU D — Requester edit: Paletli → Dökme geçişi (yerel davranış)
    // ============================================================
    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobIdA}/duzenle`, { waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page);
    await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Dökme");
    const bodyAfterDokme = await page.locator("body").innerText();
    record("D1: Dökme seçilince 'Palet Adedi' etiketi kayboldu", !bodyAfterDokme.includes("Palet Adedi"));
    record("D2: Dökme seçilince 'Yaklaşık Hacim' alanı göründü", bodyAfterDokme.includes("Yaklaşık Hacim"));
    // Ölçü ve Yerleşim alt kartında hacim TEKRAR gösterilmiyor (dedup notu var).
    record(
      "D3: Ölçü ve Yerleşim alt kartı hacmi TEKRARLAMIYOR (yönlendirici not var)",
      bodyAfterDokme.includes("Yaklaşık hacim bilgisini yukarıdaki"),
    );
    // job-edit-form.tsx `useId()` kullanır (job-request-form.tsx'in
    // serviceFieldId'inin aksine, id'de "productQuantity" metni GEÇMEZ) —
    // bu yüzden burada dinamik etiket metniyle (substring eşleşme) bulunur.
    await fillAndVerify(page.getByLabel("Yaklaşık Hacim").first(), "35");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForURL(/\/ilanlar\//, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const localJobAfterDokme = await readLocalJob(page, jobIdA);
    record(
      "D4: Yerel kayıtta productQuantity temizlendi, volumeM3=35 yazıldı",
      localJobAfterDokme?.productQuantity === undefined && localJobAfterDokme?.nakliyeDetails?.measurementInfo?.volumeM3 === 35,
      JSON.stringify({ productQuantity: localJobAfterDokme?.productQuantity, volumeM3: localJobAfterDokme?.nakliyeDetails?.measurementInfo?.volumeM3 }),
    );

    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobIdA}/duzenle`, { waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page);
    await page.getByLabel("Yaklaşık Hacim").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const bodyReopen = await page.locator("body").innerText();
    record("D5: Edit ekranı yeniden açılınca hacim=35 kalıcı", bodyReopen.includes("Yaklaşık Hacim"));
    const volumeInputReopen = await page.getByLabel("Yaklaşık Hacim").first().inputValue();
    record("D5b: Hacim input değeri 35", volumeInputReopen === "35", volumeInputReopen);

    // ============================================================
    // TEST GRUBU E — Yeni ilan: Konteyner İçinde + dedup + regresyon
    // ============================================================
    const { page: page2 } = await newActorPage(browser);
    await loginAs(page2, requester.email);
    await page2.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page2.getByLabel("Hizmet Kategorisi").first().selectOption({ label: "Nakliye" });
    await page2.getByLabel("İlan Başlığı").fill("NQ Test — Konteyner Adedi Dedup");
    await page2.getByLabel("Hizmete Özel Açıklama").fill("Konteyner adedi tekrar sorulmasın testleri için oluşturulan test ilanı.");
    await fillAndVerify(page2.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo Test");
    await selectSearchable(page2, "Yükün Hazırlanış Biçimi", 0, "Konteyner İçinde");

    const quantityLabelE = await page2.locator('label:has-text("Konteyner Adedi")').first().innerText().catch(() => "");
    record("E1: Konteyner İçinde seçilince etiket 'Konteyner Adedi' oldu", quantityLabelE.includes("Konteyner Adedi"), quantityLabelE);
    await fillAndVerify(page2.locator('input[id*="productQuantity"]').first(), "3");
    await page2.getByLabel("Toplam Ağırlık").first().fill("12");

    await fillNakliyePickupLocation(page2);
    await page2.locator('input[type="date"]').nth(0).fill(workDate);
    await page2.locator('input[type="date"]').nth(1).fill(workEndDate);
    await selectSearchable(page2, "Yükleme Yöntemi", 0, "Forklift ile");
    await page2.getByText("Nakliyeci uygun aracı önersin").click();

    // Özel Taşıma Koşulları > Konteyner Taşıması aç (radiogroup'un "Evet" seçeneği) —
    // kendi "Konteyner Adedi" ALANI OLMAMALI (dedup notu olmalı).
    await page2.locator('[role="radiogroup"][aria-label="Konteyner Taşıması"]').getByRole("radio", { name: "Evet" }).click();
    await page2.waitForTimeout(300);
    const bodyContainerOpen = await page2.locator("body").innerText();
    record(
      "E2: Konteyner Taşıması açılınca kendi 'Konteyner Adedi' alanı YOK (dedup notu var)",
      bodyContainerOpen.includes("Yük Bilgileri bölümünde") && bodyContainerOpen.includes("zaten alınıyor"),
    );
    // Konteyner Taşıması açıldığında kendi zorunlu alanları (Konteyner Tipi/Dolu-Boş) doldurulmalı.
    await selectSearchable(page2, "Konteyner Tipi", 0, "20 DC");
    await selectSearchable(page2, "Dolu/Boş", 0, "Dolu");

    await uploadPhotos(page2, 4);
    await publishJob(page2);
    const jobIdE = page2.url().split("/ilanlar/")[1];
    console.log("Job E (Konteyner İçinde) oluşturuldu:", jobIdE);

    await page2.waitForTimeout(1200);
    await page2.reload({ waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page2);
    const detailTextE = await page2.locator("body").innerText();
    record("E3: Detay sayfasında 'Konteyner Adedi: 3 konteyner' görünüyor", detailTextE.includes("Konteyner Adedi") && detailTextE.includes("3 konteyner"), detailTextE.match(/Konteyner Adedi[^\n]*/)?.[0]);

    const localJobE = await readLocalJob(page2, jobIdE);
    record(
      "E4: Yerel containerTransport.quantity dedup üzerinden 3 olarak yazıldı",
      localJobE?.nakliyeDetails?.containerTransport?.quantity === 3,
      JSON.stringify(localJobE?.nakliyeDetails?.containerTransport),
    );

    // Regresyon — Depolama kategorisinde "Konteyner" Ürün Cinsi'nde HALA var mı?
    await page2.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page2.getByLabel("Hizmet Kategorisi").first().selectOption({ label: "Kapalı Depolama" });
    const storageProductTypeField = page2.getByLabel("Depolanacak Ürün Cinsi").or(page2.getByLabel("Ürün Cinsi"));
    if (await storageProductTypeField.first().isVisible().catch(() => false)) {
      await storageProductTypeField.first().click();
      const storageListbox = page2.locator("ul[role='listbox']").first();
      await storageListbox.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      const storageSuggestions = await storageListbox.getByRole("option").allInnerTexts().catch(() => []);
      record(
        "F1: Depolama kategorisinde 'Konteyner' hâlâ öneriler arasında (regresyon yok)",
        storageSuggestions.some((t) => t.trim() === "Konteyner"),
        JSON.stringify(storageSuggestions),
      );
    } else {
      record("F1: Depolama kategorisinde Ürün Cinsi alanı bulunamadı (regresyon kontrolü atlandı)", false, "field not found");
    }

    // ============================================================
    // TEST GRUBU G — Eski kayıt: productType="Konteyner" geriye dönük uyum
    // ============================================================
    await page2.goto(`${APP_ORIGIN}/ilanlar/${jobIdE}`, { waitUntil: "domcontentloaded" });
    await page2.evaluate((id) => {
      const raw = window.localStorage.getItem("malsevk.jobs.v1");
      const jobs = JSON.parse(raw);
      const idx = jobs.findIndex((j) => j.id === id);
      jobs[idx] = { ...jobs[idx], productType: "Konteyner" };
      window.localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    }, jobIdE);
    await page2.reload({ waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page2);
    const legacyDetailText = await page2.locator("body").innerText().catch(() => "__CRASH__");
    record("G1: Eski 'Konteyner' değerli ilan detay sayfası ÇÖKMÜYOR", legacyDetailText !== "__CRASH__" && legacyDetailText.length > 0);

    await page2.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobIdE}/duzenle`, { waitUntil: "domcontentloaded" });
    await waitForHydratedJobContent(page2);
    await page2.getByLabel("Ürün Cinsi").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const editBodyLegacy = await page2.locator("body").innerText();
    record(
      "G2: Edit ekranında TAM UYARI METNİ görünüyor",
      editBodyLegacy.includes("Bu eski değer artık yük cinsi olarak kullanılamıyor. Lütfen gerçek yük cinsini seçin."),
    );
    record("G3: Edit ekranında eski değer 'Eski kayıtlı değer: Konteyner' olarak ayrıca gösteriliyor", editBodyLegacy.includes("Eski kayıtlı değer: Konteyner"));
    const productTypeValueLegacy = await page2.getByLabel("Ürün Cinsi").first().inputValue().catch(() => "");
    record("G4: Ürün Cinsi input'u BOŞ başlıyor (Konteyner önceden doldurulmuyor)", productTypeValueLegacy === "", productTypeValueLegacy);

    // Kaydetmeyi dene — boşken engellenmeli (buton disabled ya da hata).
    const saveButtonLegacy = page2.getByRole("button", { name: "Kaydet" });
    await saveButtonLegacy.click().catch(() => {});
    await page2.waitForTimeout(500);
    const stillOnEditPage = page2.url().includes("/duzenle");
    record("G5: Ürün Cinsi boşken kayıt ENGELLENDİ (hâlâ düzenleme ekranında)", stillOnEditPage);

    await fillAndVerify(page2.getByLabel("Ürün Cinsi").first(), "Gerçek Ürün Cinsi Test");
    await saveButtonLegacy.click();
    await page2.waitForURL(/\/ilanlar\//, { timeout: 20000 }).catch(() => {});
    const localJobAfterFix = await readLocalJob(page2, jobIdE);
    record("G6: Gerçek değer girilince kayıt BAŞARILI, productType güncellendi", localJobAfterFix?.productType === "Gerçek Ürün Cinsi Test", localJobAfterFix?.productType);

    // ============================================================
    // TEST GRUBU H — Admin onay akışı: dinamik etiket admin ekranlarında da doğru
    // ============================================================
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAcc.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobIdA}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "İlanı Düzenle" }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const adminBodyDokme = await adminPage.locator("body").innerText().catch(() => "__CRASH__");
    record("H1: Admin detay sayfası (Dökme ilan) ÇÖKMÜYOR", adminBodyDokme !== "__CRASH__");
    record("H2: Admin detay sayfasında 'Yaklaşık Hacim' gösteriliyor (Dökme)", adminBodyDokme.includes("Yaklaşık Hacim"));
    record("H3: Admin detay sayfasında düz 'Ürün Adedi' satırı YOK (Dökme)", !/Ürün Adedi/.test(adminBodyDokme));

    const approveButtonA = adminPage.getByRole("button", { name: "Onayla ve Yayınla" });
    if (await approveButtonA.isVisible().catch(() => false)) {
      await approveButtonA.click();
      await adminPage.waitForTimeout(1000);
    }

    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobIdE}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "İlanı Düzenle" }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const adminBodyKonteyner = await adminPage.locator("body").innerText().catch(() => "__CRASH__");
    record("H4: Admin detay sayfası (Konteyner İçinde ilan) ÇÖKMÜYOR", adminBodyKonteyner !== "__CRASH__");
    record("H5: Admin detay sayfasında 'Konteyner Adedi: 3 konteyner' gösteriliyor", adminBodyKonteyner.includes("Konteyner Adedi") && adminBodyKonteyner.includes("3 konteyner"));

    // Admin edit ekranını aç, Dökme swap'ın admin formunda da çalıştığını doğrula.
    const editButtonE = adminPage.getByRole("button", { name: "İlanı Düzenle" });
    if (await editButtonE.isVisible().catch(() => false)) {
      await editButtonE.click();
      await adminPage.waitForTimeout(500);
      const adminEditBody = await adminPage.locator("body").innerText();
      record("H6: Admin düzenleme formunda 'Konteyner Adedi' etiketi gösteriliyor", adminEditBody.includes("Konteyner Adedi"));
    }

    const approveButtonE = adminPage.getByRole("button", { name: "Onayla ve Yayınla" });
    if (await approveButtonE.isVisible().catch(() => false)) {
      await approveButtonE.click();
      await adminPage.waitForTimeout(1000);
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== ÖZET ===");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`${passCount}/${results.length} test geçti.`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log("\nBAŞARISIZ TESTLER:");
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail ?? ""}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("SCRIPT HATASI:", error);
  process.exitCode = 1;
});
