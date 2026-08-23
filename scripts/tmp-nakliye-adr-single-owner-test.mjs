// node scripts/tmp-nakliye-adr-single-owner-test.mjs
//
// "Dolu Konteyner Bilgileri İçindeki ADR Kontrolünün Kaldırılması" görevinin
// uçtan uca doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek
// Chromium), Development Supabase projesine (trfnmpihcnriqgikglpu) karşı.
//
// Doğrulanan: "Dolu Konteyner Bilgileri" alt kartında ARTIK "Tehlikeli
// Madde / ADR var mı?" kontrolü YOK (ilan oluşturma VE Hizmet Alan
// düzenleme); Konteyner içindeki yük "Kimyasal Ürün"/"Atık / Geri Dönüşüm
// Malzemesi" seçilse bile ADR durumu OTOMATİK değişmiyor; ADR verisi
// yalnızca 4 numaralı bağımsız bölümden geliyor; admin düzenleme formunda
// da aynı kontrol yok; kayıt payload'ında (Supabase) nakliye_hazmat yalnız
// bağımsız bölümden gelen değeri taşıyor.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
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
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
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
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
    await fillAndVerify(page.locator('input[type="email"]'), email);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.waitForTimeout(300);
    if ((await page.locator('input[type="email"]').inputValue()) !== email) {
      await fillAndVerify(page.locator('input[type="email"]'), email);
    }
    if ((await page.locator('input[type="password"]').inputValue()) !== PASSWORD) {
      await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    }
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 20000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) return;
    console.error(`loginAs(${email}) deneme ${attempt} başarısız. url=${page.url()}`);
  }
  throw new Error(`loginAs(${email}) failed after ${maxAttempts} attempts`);
}

async function publishJob(page) {
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  try {
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  } catch (waitError) {
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error("publishJob: önizlemeye geçilemedi. Görünür .text-danger metinleri:", JSON.stringify(dangerTexts));
    throw waitError;
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
}

async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 40, g: 150, b: 90 } } }).jpeg().toBuffer();
}

async function uploadOnePhoto(page) {
  const files = [];
  for (let i = 0; i < 4; i++) files.push({ name: `f-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  }, { timeout: 15000 });
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function setToggle(page, toggleTitle, optionLabel) {
  const group = page.getByRole("radiogroup", { name: toggleTitle }).first();
  await group.waitFor({ state: "visible", timeout: 10000 });
  await group.getByRole("radio", { name: optionLabel }).click();
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

async function fillBasics(page, title) {
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("ADR tek sahip testi için otomatik oluşturulan ilan açıklaması.");
  await fillNakliyePickupLocation(page);
  const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(0).fill(todayPlus7);
  await page.locator('input[type="date"]').nth(1).fill(todayPlus7);
  await fillAndVerify(page.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
  await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
  await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "20");
  await fillAndVerify(page.getByLabel("Toplam Ağırlık", { exact: false }).first(), "8,5");
  await selectSearchable(page, "Yükleme Yöntemi", 0, "Forklift ile");
  await page.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
}

async function dbQuery(sql) {
  const { execSync } = await import("node:child_process");
  const output = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, {
    cwd: "c:\\Users\\merta\\malsevk-2",
    stdio: "pipe",
  }).toString();
  return JSON.parse(output).rows ?? [];
}

async function getJobFromSupabase(jobId) {
  const rows = await dbQuery(
    `select id, moderation_status, nakliye_hazmat, nakliye_container_transport from public.jobs where id = '${jobId}';`,
  );
  return rows[0] ?? null;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `naklsingleadr-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklSingleAdr Requester",
    companyName: "NaklSingleAdr Firma",
  });
  const adminAccount = await createAccount({
    email: `naklsingleadr-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklSingleAdr Admin",
    companyName: "NaklSingleAdr Admin Firma",
  });
  await dbQuery(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: hesaplar oluşturuldu", true);

  const browser = await chromium.launch();
  let jobId = null;

  try {
    const { page } = await newActorPage(browser);
    await loginAs(page, requester.email);

    // ============================================================
    // 1. İlan oluşturma: Konteyner Evet + Dolu -> Dolu Konteyner Bilgileri
    //    alt kartında ADR kontrolü YOK.
    // ============================================================
    console.log("\n=== 1. İlan oluşturma: Dolu Konteyner Bilgileri'nde ADR kontrolü yok ===");
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await fillBasics(page, `NaklSingleAdr Test ${idSuffix}`);

    await setToggle(page, "Yük konteyner olarak mı taşınacak?", "Evet");
    await selectSearchable(page, "Konteyner Tipi", 0, "40' High Cube");
    await selectSearchable(page, "Dolu / Boş", 0, "Dolu");
    await page.getByText("Dolu Konteyner Bilgileri", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });

    const adrRadiogroupInsideDoluCard = await page
      .getByRole("radiogroup", { name: "Tehlikeli Madde / ADR var mı?" })
      .count();
    record("Dolu Konteyner Bilgileri kartı içinde ADR radiogroup'u HİÇ YOK", adrRadiogroupInsideDoluCard === 0, adrRadiogroupInsideDoluCard);
    const adrTextInsideAnywhere = await page.getByText("Tehlikeli Madde / ADR var mı?", { exact: false }).count();
    record("'Tehlikeli Madde / ADR var mı?' metni sayfada HİÇ YOK", adrTextInsideAnywhere === 0, adrTextInsideAnywhere);

    // Dolu Konteyner Bilgileri artık YALNIZCA üç alan içermeli.
    await selectSearchable(page, "Konteyner İçindeki Yük", 0, "Kimyasal Ürün");
    await fillAndVerify(page.getByLabel("Konteyner Adedi").first(), "2");
    await fillAndVerify(page.getByLabel("Yük Açıklaması", { exact: false }).first(), "Test yük açıklaması.");

    // Bölüm 4 (bağımsız ADR) hâlâ orada ve dokunulmadıkça boş/seçilmemiş.
    const section4Group = page.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" }).first();
    await section4Group.waitFor({ state: "visible", timeout: 10000 });
    const section4EvetChecked = await section4Group.getByRole("radio", { name: "Evet", exact: true }).getAttribute("aria-checked");
    const section4HayirChecked = await section4Group.getByRole("radio", { name: "Hayır", exact: true }).getAttribute("aria-checked");
    record(
      "'Kimyasal Ürün' seçilince Bölüm 4 (ADR) OTOMATİK Evet'e geçmedi",
      section4EvetChecked !== "true",
      JSON.stringify({ evet: section4EvetChecked, hayir: section4HayirChecked }),
    );

    // Atık / Geri Dönüşüm Malzemesi de aynı şekilde test edilsin.
    await selectSearchable(page, "Konteyner İçindeki Yük", 0, "Atık / Geri Dönüşüm Malzemesi", { exact: false });
    await page.waitForTimeout(300);
    const section4EvetCheckedAfterAtik = await section4Group.getByRole("radio", { name: "Evet", exact: true }).getAttribute("aria-checked");
    record(
      "'Atık / Geri Dönüşüm Malzemesi' seçilince Bölüm 4 (ADR) OTOMATİK Evet'e geçmedi",
      section4EvetCheckedAfterAtik !== "true",
      section4EvetCheckedAfterAtik,
    );

    // Şimdi requester Bölüm 4'ten GERÇEKTEN Evet seçsin ve UN girsin.
    await setToggle(page, "Yük tehlikeli madde / ADR kapsamında mı?", "Evet");
    const unInput = page.getByLabel("UN Numarası").first();
    await unInput.fill("UN1789");
    await unInput.blur();
    await page.waitForTimeout(300);
    const psnValue = await page.getByLabel("Resmî Taşımacılık Adı").first().inputValue();
    record("Bölüm 4'ten UN1789 girilince PSN otomatik doldu (HİDROKLORİK ASİT)", psnValue.includes("HİDROKLORİK"), psnValue);

    await uploadOnePhoto(page);
    await publishJob(page);
    const jobUrl = page.url();
    jobId = jobUrl.split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("İlan yayımlandı", Boolean(jobId), jobUrl);

    let jobRow = await getJobFromSupabase(jobId);
    record("Supabase satırı bulundu", Boolean(jobRow));
    if (jobRow) {
      record(
        "nakliye_hazmat YALNIZCA Bölüm 4'ten girilen veriyi taşıyor (UN1789, ADR Sınıf 8)",
        jobRow.nakliye_hazmat?.status === "evet" && jobRow.nakliye_hazmat?.unNumber === "UN1789" && jobRow.nakliye_hazmat?.adrClass === "8",
        JSON.stringify(jobRow.nakliye_hazmat),
      );
      record(
        "nakliye_container_transport içinde hiçbir hazmat/ADR alanı YOK (bağımsız veri modeli)",
        !("hazmatStatus" in (jobRow.nakliye_container_transport ?? {})) && !("hazmat" in (jobRow.nakliye_container_transport ?? {})),
        JSON.stringify(jobRow.nakliye_container_transport),
      );
      record(
        "nakliye_container_transport içeriği YALNIZCA content/contentCustomText/contentDescription/gross/quantity/type alanlarını içeriyor",
        Object.keys(jobRow.nakliye_container_transport ?? {}).every((k) =>
          ["status", "containerType", "containerTypeCustomText", "loadStatus", "quantity", "grossWeightTon", "content", "contentCustomText", "contentDescription"].includes(k),
        ),
        JSON.stringify(Object.keys(jobRow.nakliye_container_transport ?? {})),
      );
    }

    // ============================================================
    // 2. Hizmet Alan ilan düzenleme — aynı kontrol orada da yok.
    // ============================================================
    console.log("\n=== 2. Hizmet Alan ilan düzenleme: aynı kontrol orada da yok ===");
    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId}/duzenle`, { waitUntil: "domcontentloaded" });
    await page.getByText("Dolu Konteyner Bilgileri", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    const editAdrRadiogroupCount = await page.getByRole("radiogroup", { name: "Tehlikeli Madde / ADR var mı?" }).count();
    record("Düzenleme ekranında Dolu Konteyner Bilgileri içinde ADR kontrolü YOK", editAdrRadiogroupCount === 0, editAdrRadiogroupCount);
    const editUnPrefill = await page.getByLabel("UN Numarası").first().inputValue();
    record("Düzenleme ekranı UN Numarası=UN1789 ile (yalnızca Bölüm 4'ten) prefill edildi", editUnPrefill === "UN1789", editUnPrefill);

    // ============================================================
    // 3. Admin düzenleme formunda da aynı kontrol yok.
    // ============================================================
    console.log("\n=== 3. Admin düzenleme formunda ADR kontrolü yok ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    const editButton = adminPage.getByRole("button", { name: /Düzenle/i }).first();
    await editButton.waitFor({ state: "visible", timeout: 15000 });
    await editButton.click();
    await adminPage.getByText("Konteyner İçindeki Yük", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const adminAdrLabelCount = await adminPage.getByText("Tehlikeli Madde / ADR var mı?", { exact: true }).count();
    record("Admin düzenleme formunda Konteyner fieldset'i içinde 'Tehlikeli Madde / ADR var mı?' YOK", adminAdrLabelCount === 0, adminAdrLabelCount);
    // Bağımsız ADR fieldset'i hâlâ var ve UN1789 ile prefill.
    const adminUnValue = await adminPage.getByLabel("UN Numarası").first().inputValue();
    record("Admin düzenleme formunun bağımsız ADR fieldset'i UN1789 ile prefill edildi", adminUnValue === "UN1789", adminUnValue);

    // Admin ilanı onaylasın, kayıt bozulmasın.
    const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
      await adminPage.waitForTimeout(1000);
    }
    const approveButton = adminPage.getByRole("button", { name: /Onayla/i }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await adminPage.waitForTimeout(1000);
    }
    jobRow = await getJobFromSupabase(jobId);
    record(
      "Admin kaydetme/onay sonrası nakliye_hazmat hâlâ doğru (UN1789)",
      jobRow?.nakliye_hazmat?.unNumber === "UN1789",
      JSON.stringify(jobRow?.nakliye_hazmat),
    );

    // ============================================================
    // 4. Kullanıcı ve admin ilan detayında ADR verisi doğru gösteriliyor,
    //    "Konteyner İçindeki Yük" satırı ADR ile karışmıyor.
    // ============================================================
    console.log("\n=== 4. İlan detay sayfaları ===");
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("Tehlikeli Madde / ADR", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const detailShowsAdr = await page.getByText("UN1789", { exact: false }).first().isVisible().catch(() => false);
    record("Kullanıcı ilan detayında ADR (UN1789) gösteriliyor", detailShowsAdr);
    const detailShowsContent = await page.getByText("Atık", { exact: false }).first().isVisible().catch(() => false);
    record("Kullanıcı ilan detayında Konteyner İçindeki Yük ('Atık...') gösteriliyor", detailShowsContent);

    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("UN1789", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const adminDetailShowsAdr = await adminPage.getByText("UN1789", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında ADR (UN1789) gösteriliyor", adminDetailShowsAdr);
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
