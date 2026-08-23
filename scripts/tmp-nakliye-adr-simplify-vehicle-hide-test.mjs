// node scripts/tmp-nakliye-adr-simplify-vehicle-hide-test.mjs
//
// İki bağımsız sadeleştirme kararının uçtan uca doğrulaması — gerçek
// tarayıcıya karşı (Playwright, gerçek Chromium), Development Supabase
// projesine (trfnmpihcnriqgikglpu) karşı:
//   1. ADR kartı sadeleştirmesi: yalnızca ADR Sınıfı (+ "Sınıfını bilmiyorum"),
//      UN Numarası/Resmî Taşımacılık Adı/Ambalaj Grubu TAMAMEN kaldırıldı.
//   2. Dolu Konteyner Bilgileri'nden Yük Açıklaması kaldırıldı.
//   3. Konteyner Taşıması=Evet iken Araç Tercihi bölümü gizlenir, bölüm
//      numaraları boşluksuz kayar.
//
// Ayrıca: eski (bu görevden önce kaydedilmiş şekilli) hazmat verisinin bir
// düzenleme sırasında SİLİNMEDİĞİNİ (yalnızca gösterilmediğini) doğrular.
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
  await page.getByLabel("Açıklama", { exact: false }).first().fill("ADR sadeleştirme ve araç tercihi testi için otomatik oluşturulan ilan açıklaması.");
  await fillNakliyePickupLocation(page);
  const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(0).fill(todayPlus7);
  await page.locator('input[type="date"]').nth(1).fill(todayPlus7);
  await fillAndVerify(page.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
  await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
  await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "20");
  await fillAndVerify(page.getByLabel("Toplam Ağırlık", { exact: false }).first(), "8,5");
  await selectSearchable(page, "Yükleme Yöntemi", 0, "Forklift ile");
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

async function getSectionTitles(page) {
  const badgeRows = page.locator("div.rounded-\\[10px\\].border.border-border.bg-surface > div.flex.items-center.gap-2");
  const count = await badgeRows.count();
  const titles = [];
  const numbers = [];
  for (let i = 0; i < count; i++) {
    const row = badgeRows.nth(i);
    numbers.push((await row.locator("span").first().innerText()).trim());
    titles.push((await row.locator("p").first().innerText()).trim());
  }
  return { titles, numbers };
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `naklsimp-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklSimp Requester",
    companyName: "NaklSimp Firma",
  });
  const adminAccount = await createAccount({
    email: `naklsimp-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklSimp Admin",
    companyName: "NaklSimp Admin Firma",
  });
  await dbQuery(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: hesaplar oluşturuldu", true);

  const browser = await chromium.launch();
  let jobId = null;

  try {
    const { page } = await newActorPage(browser);
    await loginAs(page, requester.email);

    // ============================================================
    // 1. Yeni ilan — Konteyner Taşıması=Evet: Araç Tercihi gizlenir,
    //    numaralar boşluksuz kayar (1-7).
    // ============================================================
    console.log("\n=== 1. Konteyner=Evet: Araç Tercihi gizli, 1-7 numaralı ===");
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await fillBasics(page, `NaklSimp Evet ${idSuffix}`);

    // Konteyner=Evet öncesi: Araç Tercihi görünür olmalı (Hayır/başlangıç durumunda).
    const vehicleVisibleBeforeEvet = await page.getByText("Araç Tercihi", { exact: true }).first().isVisible().catch(() => false);
    record("Konteyner Evet seçilmeden ÖNCE Araç Tercihi görünür", vehicleVisibleBeforeEvet);

    await setToggle(page, "Yük konteyner olarak mı taşınacak?", "Evet");
    await selectSearchable(page, "Konteyner Tipi", 0, "40' High Cube");
    await selectSearchable(page, "Dolu / Boş", 0, "Boş");
    await fillAndVerify(page.getByLabel("Konteyner Adedi").first(), "2");

    const vehicleVisibleAfterEvet = await page.getByText("Araç Tercihi", { exact: true }).first().isVisible().catch(() => false);
    record("Konteyner=Evet SONRASI Araç Tercihi tamamen gizlendi", !vehicleVisibleAfterEvet);

    const { titles: titlesEvet, numbers: numbersEvet } = await getSectionTitles(page);
    record(
      "Konteyner=Evet iken bölüm sırası tam olarak 1-7 (Araç Tercihi atlanmış)",
      JSON.stringify(titlesEvet) ===
        JSON.stringify(["Temel Bilgiler", "Yük Bilgileri", "Konteyner Taşıması", "Tehlikeli Madde / ADR", "Taşıma Planı", "Yükleme ve Teslimat", "Fotoğraflar ve Belgeler"]),
      JSON.stringify(titlesEvet),
    );
    record(
      "Bölüm numaraları boşluksuz/atlamasız: 1,2,3,4,5,6,7",
      JSON.stringify(numbersEvet) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7"]),
      JSON.stringify(numbersEvet),
    );

    // ============================================================
    // 2. ADR: Evet -> yalnızca ADR Sınıfı açılır, UN/PSN/Ambalaj Grubu YOK.
    // ============================================================
    console.log("\n=== 2. ADR=Evet: yalnızca ADR Sınıfı ===");
    await setToggle(page, "Yük tehlikeli madde / ADR kapsamında mı?", "Evet");
    // NOT: `getByText("UN Numarası", {exact:false})` alt-metin araması,
    // BİREBİR gerekli disclaimer cümlesinin kendi içindeki (küçük harfli)
    // "UN numarası" ifadesiyle YANLIŞ POZİTİF veriyor — bu yüzden burada
    // gerçek bir FORM ALANI (label) arıyoruz, düz metin değil.
    const unFieldCount = await page.getByLabel("UN Numarası", { exact: true }).count();
    record("ADR=Evet iken 'UN Numarası' ALANI hiç YOK", unFieldCount === 0, unFieldCount);
    const psnFieldCount = await page.getByLabel("Resmî Taşımacılık Adı", { exact: true }).count();
    record("ADR=Evet iken 'Resmî Taşımacılık Adı' ALANI hiç YOK", psnFieldCount === 0, psnFieldCount);
    const packingFieldCount = await page.getByRole("button", { name: "Ambalaj Grubu", exact: true }).count();
    record("ADR=Evet iken 'Ambalaj Grubu' ALANI hiç YOK", packingFieldCount === 0, packingFieldCount);
    const adrClassVisible = await page.getByText("ADR Sınıfı", { exact: true }).first().isVisible().catch(() => false);
    record("ADR=Evet iken 'ADR Sınıfı' dropdown'ı gösteriliyor", adrClassVisible);

    // Disclaimer metni her zaman gösterilmeli.
    const disclaimerVisible = await page
      .getByText("ADR sınıfı ilan aşamasında ön bilgilendirme amacıyla alınır", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    record("ADR kartının altında gerekli bilgilendirme metni gösteriliyor", disclaimerVisible);

    // "Sınıfını bilmiyorum" seçeneği listenin sonunda gerçek bir seçenek olarak var mı?
    const classSelect = page.locator("select").filter({ hasText: "Sınıfını bilmiyorum" }).first();
    const unknownOptionExists = await classSelect.locator('option:has-text("Sınıfını bilmiyorum")').count();
    record("'Sınıfını bilmiyorum' ADR Sınıfı listesinde gerçek bir seçenek olarak var", unknownOptionExists > 0, unknownOptionExists);
    await classSelect.selectOption({ label: "Sınıfını bilmiyorum" });
    const selectedValue = await classSelect.inputValue();
    record("'Sınıfını bilmiyorum' seçilebiliyor", selectedValue === "bilinmiyor", selectedValue);
    // Gerçek bir sınıfa geç (yayın sonrası Supabase kontrolü için).
    await classSelect.selectOption({ label: "8 — Aşındırıcı maddeler" });

    // ============================================================
    // 3. Dolu Konteyner Bilgileri: Yük Açıklaması yok, içerik + manuel giriş çalışıyor.
    // ============================================================
    console.log("\n=== 3. Dolu Konteyner Bilgileri: Yük Açıklaması kaldırıldı ===");
    await selectSearchable(page, "Dolu / Boş", 0, "Dolu");
    await page.getByText("Dolu Konteyner Bilgileri", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const yukAciklamasiVisible = await page.getByText("Yük Açıklaması", { exact: false }).first().isVisible().catch(() => false);
    record("Dolu Konteyner Bilgileri içinde 'Yük Açıklaması' hiç YOK", !yukAciklamasiVisible);

    await page.getByRole("button", { name: "Konteyner İçindeki Yük", exact: true }).click();
    const contentListbox = page.locator('ul[aria-label="Konteyner İçindeki Yük"]').first();
    await contentListbox.waitFor({ state: "visible" });
    await contentListbox.getByRole("option", { name: "Listede yok", exact: false }).first().click();
    const manualNameFieldVisible = await page.getByLabel("Yük adını yazın").first().isVisible().catch(() => false);
    record("'Listede yok' seçilince 'Yük adını yazın' alanı hâlâ çalışıyor", manualNameFieldVisible);
    if (manualNameFieldVisible) await fillAndVerify(page.getByLabel("Yük adını yazın").first(), "Test Yükü");

    await uploadOnePhoto(page);
    await publishJob(page);
    const jobUrl = page.url();
    jobId = jobUrl.split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("İlan yayımlandı", Boolean(jobId), jobUrl);

    let jobRow = await getJobFromSupabase(jobId);
    record("Supabase satırı bulundu", Boolean(jobRow));
    if (jobRow) {
      record(
        "nakliye_hazmat YALNIZCA status+adrClass taşıyor (UN/PSN/Ambalaj Grubu YOK)",
        jobRow.nakliye_hazmat?.status === "evet" &&
          jobRow.nakliye_hazmat?.adrClass === "8" &&
          !("unNumber" in jobRow.nakliye_hazmat) &&
          !("properShippingName" in jobRow.nakliye_hazmat) &&
          !("packingGroup" in jobRow.nakliye_hazmat),
        JSON.stringify(jobRow.nakliye_hazmat),
      );
      record(
        "nakliye_container_transport içinde contentDescription YOK, vehiclePreference-ile-ilgisiz temiz",
        !("contentDescription" in jobRow.nakliye_container_transport),
        JSON.stringify(jobRow.nakliye_container_transport),
      );
    }

    // İlan detayında hiçbir kaldırılan alan görünmüyor mu?
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("Tehlikeli Madde / ADR", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    for (const removed of ["Resmî Taşımacılık Adı", "Ambalaj Grubu", "Yük Açıklaması"]) {
      const visible = await page.getByText(removed, { exact: false }).first().isVisible().catch(() => false);
      record(`Kullanıcı ilan detayında '${removed}' hiç görünmüyor`, !visible);
    }
    const unLabelCountOnDetail = await page.getByText("UN Numarası", { exact: true }).count();
    record("Kullanıcı ilan detayında 'UN Numarası' hiç görünmüyor", unLabelCountOnDetail === 0, unLabelCountOnDetail);

    // "Gizlenen araç değerlerinin payload'a gönderilmediğini doğrula" — Araç
    // Tercihi hiçbir Job.nakliyeDetails'te Supabase kolonuna hiç yazılmıyor
    // (vehiclePreference tamamen localStorage-only, bkz. CLAUDE.md), bu
    // yüzden GERÇEK doğrulama yeri tarayıcının kendi localStorage kopyası.
    const localVehiclePreference = await page.evaluate((id) => {
      const raw = window.localStorage.getItem("malsevk.jobs.v1");
      if (!raw) return "NO_STORAGE";
      const jobs = JSON.parse(raw);
      const job = jobs.find((j) => j.id === id);
      return job ? job.nakliyeDetails?.vehiclePreference : "NOT_FOUND";
    }, jobId);
    record(
      "Konteyner=Evet ilanının yerel kaydında vehiclePreference hiç YOK (gizlenen araç değerleri payload'a gönderilmedi)",
      localVehiclePreference === undefined,
      JSON.stringify(localVehiclePreference),
    );

    // ============================================================
    // 4. Admin düzenleme: eski (görev öncesi şekilli) hazmat verisi bir
    //    düzenlemede SİLİNMİYOR + admin görünümünde kaldırılan alanlar yok.
    //    (Requester bu ilanı bir daha DÜZENLEMEDEN önce çalıştırılır — aksi
    //    halde requester'ın kendi yerel/senkron yazımı bu Supabase enjeksiyonunu
    //    ezerdi.)
    // ============================================================
    console.log("\n=== 4. Admin düzenleme: eski hazmat verisi korunuyor ===");
    await dbQuery(
      `update public.jobs set nakliye_hazmat = '{"status":"evet","unNumber":"UN1203","properShippingName":"BENZİN","adrClass":"3","packingGroup":"II"}'::jsonb where id = '${jobId}';`,
    );
    let legacyRow = await getJobFromSupabase(jobId);
    record("Test için eski şekilli hazmat verisi Supabase'e enjekte edildi", legacyRow?.nakliye_hazmat?.unNumber === "UN1203");

    // Detay sayfası eski unNumber'ı GÖSTERMEMELİ (yalnız arayüzde gizli) —
    // bu requester'ın KENDİ tarayıcısı, yerel kopyası zaten var olduğu için
    // yerel yol üzerinden okunur (uzak enjeksiyonun UI'a hiç yansımaması,
    // "eski kayıtlar arayüzde gösterilmesin" kuralının farklı bir kanıtı).
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const legacyUnShownOnDetail = await page.getByText("UN1203", { exact: false }).first().isVisible().catch(() => false);
    record("Eski UN Numarası detay sayfasında GÖSTERİLMİYOR (veri silinmedi, sadece gizli)", !legacyUnShownOnDetail);

    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForTimeout(1000);
    for (const removed of ["Resmî Taşımacılık Adı", "Ambalaj Grubu", "Yük Açıklaması"]) {
      const visible = await adminPage.getByText(removed, { exact: false }).first().isVisible().catch(() => false);
      record(`Admin ilan detayında '${removed}' hiç görünmüyor`, !visible);
    }
    const adminUnLabelCountOnDetail = await adminPage.getByText("UN Numarası", { exact: true }).count();
    record("Admin ilan detayında 'UN Numarası' hiç görünmüyor", adminUnLabelCountOnDetail === 0, adminUnLabelCountOnDetail);

    const editButton = adminPage.getByRole("button", { name: /Düzenle/i }).first();
    await editButton.waitFor({ state: "visible", timeout: 15000 });
    await editButton.click();
    await adminPage.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    const adminUnFieldCount = await adminPage.getByLabel("UN Numarası", { exact: true }).count();
    record("Admin düzenleme formunda 'UN Numarası' ALANI hiç YOK", adminUnFieldCount === 0, adminUnFieldCount);
    const adminPackingVisible = await adminPage.getByText("Ambalaj Grubu", { exact: false }).first().isVisible().catch(() => false);
    record("Admin düzenleme formunda 'Ambalaj Grubu' hiç YOK", !adminPackingVisible);
    const adminYukAciklamasiVisible = await adminPage.getByText("Yük Açıklaması", { exact: false }).first().isVisible().catch(() => false);
    record("Admin düzenleme formunda 'Yük Açıklaması' hiç YOK", !adminYukAciklamasiVisible);
    const adminDisclaimerVisible = await adminPage
      .getByText("ADR sınıfı ilan aşamasında ön bilgilendirme amacıyla alınır", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    record("Admin düzenleme formunda da ADR bilgilendirme metni gösteriliyor", adminDisclaimerVisible);

    // Admin formu KAYDET (ADR'ye dokunmadan) — eski unNumber/PSN/packingGroup hâlâ korunmalı.
    const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
    await saveButton.waitFor({ state: "visible", timeout: 10000 });
    await saveButton.click();
    await adminPage.waitForTimeout(1000);
    legacyRow = await getJobFromSupabase(jobId);
    record(
      "Admin formu kaydettikten sonra da eski unNumber/properShippingName/packingGroup KORUNDU",
      legacyRow?.nakliye_hazmat?.unNumber === "UN1203" &&
        legacyRow?.nakliye_hazmat?.properShippingName === "BENZİN" &&
        legacyRow?.nakliye_hazmat?.packingGroup === "II",
      JSON.stringify(legacyRow?.nakliye_hazmat),
    );

    const approveButton = adminPage.getByRole("button", { name: /Onayla/i }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await adminPage.waitForTimeout(1000);
      record("Admin ilanı onayladı", true);
    } else {
      record("Admin ilanı onayladı", false, "Onayla butonu bulunamadı");
    }
    legacyRow = await getJobFromSupabase(jobId);
    record("Admin onayı sonrası moderation_status=approved", legacyRow?.moderation_status === "approved", legacyRow?.moderation_status);

    // Yayımlanan ilan detayında hâlâ hiçbir kaldırılan alan yok.
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const finalUnVisible = await page.getByText("UN1203", { exact: false }).first().isVisible().catch(() => false);
    record("Onay sonrası yayımlanan ilan detayında eski UN Numarası hâlâ GÖSTERİLMİYOR", !finalUnVisible);

    // ============================================================
    // 5. Hizmet Alan'ın KENDİ (yerel/localStorage) düzenleme yolu da eski
    //    hazmat verisini SİLMİYOR mu? — job-store.ts#mergeLegacyHazmatFields.
    //    NOT: bir Supabase enjeksiyonu bu YOLU test edemez (requester'ın kendi
    //    tarayıcısındaki `existing.nakliyeDetails`, job-store.ts#updateJob'un
    //    okuduğu KAYNAK, kendi localStorage'ıdır — Supabase'e YAZILAN değil,
    //    ONDAN OKUNAN da değil). Bu yüzden eski şekilli veri doğrudan bu
    //    tarayıcının localStorage'ına enjekte edilir.
    // ============================================================
    console.log("\n=== 5. Hizmet Alan'ın kendi düzenleme yolu: eski hazmat verisi korunuyor ===");
    await page.evaluate((id) => {
      const raw = window.localStorage.getItem("malsevk.jobs.v1");
      const jobs = JSON.parse(raw);
      const job = jobs.find((j) => j.id === id);
      job.nakliyeDetails.hazmat = { status: "evet", unNumber: "UN1830", properShippingName: "SÜLFÜRİK ASİT", adrClass: "8", packingGroup: "II" };
      window.localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    }, jobId);
    const localAfterInject = await page.evaluate((id) => {
      const jobs = JSON.parse(window.localStorage.getItem("malsevk.jobs.v1"));
      return jobs.find((j) => j.id === id)?.nakliyeDetails?.hazmat;
    }, jobId);
    record("Test için eski şekilli hazmat verisi requester'ın YEREL kopyasına enjekte edildi", localAfterInject?.unNumber === "UN1830", JSON.stringify(localAfterInject));

    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId}/duzenle`, { waitUntil: "domcontentloaded" });
    await page.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    // Düzenleme formu da Konteyner=Evet olduğu için Araç Tercihi'nin YOK olduğunu burada da doğrula.
    const editVehicleVisible = await page.getByText("Araç Tercihi", { exact: true }).first().isVisible().catch(() => false);
    record("Düzenleme ekranında da Konteyner=Evet iken Araç Tercihi gizli", !editVehicleVisible);
    // ADR ile İLGİSİZ bir alanı değiştir (Konteyner Adedi).
    await fillAndVerify(page.getByLabel("Konteyner Adedi").first(), "9");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForURL((url) => url.pathname.includes(`/ilanlar/${jobId}`), { timeout: 20000 }).catch(async () => {
      await page.waitForTimeout(1500);
    });
    await page.waitForTimeout(1000);

    const localAfterEdit = await page.evaluate((id) => {
      const jobs = JSON.parse(window.localStorage.getItem("malsevk.jobs.v1"));
      const job = jobs.find((j) => j.id === id);
      return { hazmat: job?.nakliyeDetails?.hazmat, containerQuantity: job?.nakliyeDetails?.containerTransport?.quantity };
    }, jobId);
    record(
      "Düzenleme sonrası (yerel kopyada) eski unNumber/properShippingName/packingGroup HÂLÂ VAR (silinmedi)",
      localAfterEdit.hazmat?.unNumber === "UN1830" &&
        localAfterEdit.hazmat?.properShippingName === "SÜLFÜRİK ASİT" &&
        localAfterEdit.hazmat?.packingGroup === "II",
      JSON.stringify(localAfterEdit.hazmat),
    );
    record(
      "Düzenleme sonrası Konteyner Adedi=9 olarak güncellendi (gerçek değişiklik uygulandı, ADR alanları etkilenmedi)",
      localAfterEdit.containerQuantity === 9,
      localAfterEdit.containerQuantity,
    );
    // Eski UN yine de arayüzde GÖSTERİLMEMELİ.
    await page.waitForTimeout(500);
    const localLegacyShownAfterEdit = await page.getByText("UN1830", { exact: false }).first().isVisible().catch(() => false);
    record("Düzenleme sonrası eski UN Numarası hâlâ arayüzde GÖSTERİLMİYOR", !localLegacyShownAfterEdit);

    // ============================================================
    // 6. Konteyner=Hayır -> Araç Tercihi yeniden açılır, boş/güvenli durumda.
    // ============================================================
    console.log("\n=== 6. Konteyner=Hayır: Araç Tercihi yeniden açılır (boş) ===");
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await fillBasics(page, `NaklSimp Hayir ${idSuffix}`);

    await setToggle(page, "Yük konteyner olarak mı taşınacak?", "Evet");
    await selectSearchable(page, "Konteyner Tipi", 0, "20' Standart");
    await selectSearchable(page, "Dolu / Boş", 0, "Boş");
    await fillAndVerify(page.getByLabel("Konteyner Adedi").first(), "1");
    const vehicleHiddenMidway = await page.getByText("Araç Tercihi", { exact: true }).first().isVisible().catch(() => false);
    record("Ara adımda (Evet iken) Araç Tercihi gizli", !vehicleHiddenMidway);

    await setToggle(page, "Yük konteyner olarak mı taşınacak?", "Hayır");
    const vehicleReopenedVisible = await page.getByText("Araç Tercihi", { exact: true }).first().isVisible().catch(() => false);
    record("Konteyner=Hayır'a dönülünce Araç Tercihi yeniden AÇILDI", vehicleReopenedVisible);

    const { titles: titlesHayir, numbers: numbersHayir } = await getSectionTitles(page);
    record(
      "Konteyner=Hayır iken bölüm sırası tam 8 kart (Araç Tercihi dahil)",
      JSON.stringify(titlesHayir) ===
        JSON.stringify([
          "Temel Bilgiler",
          "Yük Bilgileri",
          "Konteyner Taşıması",
          "Tehlikeli Madde / ADR",
          "Taşıma Planı",
          "Araç Tercihi",
          "Yükleme ve Teslimat",
          "Fotoğraflar ve Belgeler",
        ]),
      JSON.stringify(titlesHayir),
    );
    record(
      "Bölüm numaraları boşluksuz: 1..8",
      JSON.stringify(numbersHayir) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8"]),
      JSON.stringify(numbersHayir),
    );

    // Araç Tercihi'nin GERÇEKTEN boş/güvenli açıldığını doğrula (suggestByProvider işaretsiz, hiçbir tip seçili değil).
    const suggestCheckbox = page.getByRole("checkbox", { name: /uygun aracı önersin/i }).first();
    const suggestChecked = await suggestCheckbox.isChecked().catch(() => null);
    record("Yeniden açılan Araç Tercihi 'uygun aracı önersin' İŞARETSİZ (boş/güvenli başlangıç)", suggestChecked === false, suggestChecked);

    // Formu geçerli kılmak için nakliyeci önersin işaretle ve yayımla — payload'da vehiclePreference şimdi VAR olmalı.
    await suggestCheckbox.check();
    await setToggle(page, "Yük tehlikeli madde / ADR kapsamında mı?", "Hayır");
    await uploadOnePhoto(page);
    await publishJob(page);
    const jobUrl2 = page.url();
    const jobId2 = jobUrl2.split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("İkinci (Konteyner=Hayır) ilan yayımlandı", Boolean(jobId2), jobUrl2);
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
