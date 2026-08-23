// "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevinin GERÇEK
// KULLANICI testi. Development Supabase projesine (NEXT_PUBLIC_SUPABASE_URL)
// VE gerçek dev sunucusuna (localhost:3000) karşı çalışır — migration
// 0069/0070'in TÜM istemci tarafı (form/belge yükleme/admin onay/eşleştirme
// arayüzü) katmanını, önceden SQL seviyesinde ayrı ayrı doğrulanmış RPC/
// backend katmanının ÜZERİNE, gerçek tarayıcı etkileşimiyle kapsar.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\12aad247-0f29-4d51-b91b-ce0b220f1157\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
function envVar(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : process.env[name];
}

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Gerekli env değişkenleri .env.local'da bulunamadı.");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
const createdJobIds = [];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `recycle-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `RecycleTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `RecycleTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) break;
  }
  await page.waitForTimeout(1000);
}

/** offers.ts/job-store.ts TEK PAYLAŞILAN localStorage anahtarı kullanır — "Hizmet Veren teklif verir, Hizmet Alan görür" akışını GERÇEKTEN test etmek için AYNI browser context/localStorage İÇİNDE gerçek çıkış+giriş yapılır (bkz. tmp-supabase-storage-hazard-risk-groups-test.mjs'in AYNI, önceden kanıtlanmış gerekçesi). */
async function logout(page) {
  await page.getByRole("button", { name: /Hizmet Veren|Hizmet Alan|Admin/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).or(page.getByRole("menu").getByText("Çıkış Yap")).first().click({ timeout: 10000 });
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function newActorPage(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : undefined);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

async function fillPhotos(page) {
  const tmp = os.tmpdir();
  const photoFiles = [1, 2, 3, 4].map((i) => path.join(tmp, `fixture-valid-${i}.jpg`));
  for (const f of photoFiles) readFileSync(f);
  await page.locator('input[type="file"]').setInputFiles(photoFiles);
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      const m = t.match(/(\d+)\s*\/\s*\d+\s*fotoğraf yüklendi/);
      return m && Number(m[1]) === 4;
    },
    { timeout: 60000 },
  );
}

/** İl->İlçe->Liman/Sanayi/OSB (özel/"Listede yok" modu)->Açık Adres — Geri Dönüşüm & Atık Tahliye job-location.ts#isSimplifiedLocationCategory KAPSAMINDA DEĞİLDİR (yalnızca Depo Hizmetleri/Gümrük Müşavirliği), bu yüzden TAM konum akışı gerekir. */
async function fillLocation(page) {
  await page.locator('[id^="service-province-"]').first().click({ timeout: 10000 });
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('[id^="service-district-"]').first().click({ timeout: 10000 });
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Liman / Sanayi / OSB").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByText("Listede yok, kendim gireceğim", { exact: false }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel("Liman / Sanayi / OSB Adı").first().fill("Test Geri Dönüşüm Tesisi");
  await page.getByLabel("Açık Adres").first().fill("Test OSB, 5. Cadde No: 12, Gebze");
}

/** RecyclingFields'ın TÜMÜNÜ doldurur — Talep Edilen İşlem, Atık Türü, Atık Kodu (arama ile), [tehlike özelliği varsa], Miktar/Birim, Malzeme Durumu, Hizmet Kapsamı ("Tüm Süreç" tek tıkla). `wasteCodeQuery` null ise "Atık kodunu bilmiyorum" seçilir. */
async function fillRecyclingFields(page, { operationLabel, wasteCodeQuery, hazardPropertyLabel }) {
  await page.getByLabel("Talep Edilen İşlem").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: operationLabel, exact: true }).click();
  await page.waitForTimeout(200);

  await page.getByLabel("Atık Türü").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: "Kâğıt / Karton", exact: true }).click();
  await page.waitForTimeout(200);

  await page.getByLabel("Atık Kodu").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  if (wasteCodeQuery === null) {
    await page.getByRole("option", { name: "Atık kodunu bilmiyorum", exact: true }).click();
  } else {
    await page.getByLabel("Atık Kodu içinde ara").fill(wasteCodeQuery);
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: new RegExp("^" + wasteCodeQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  }
  await page.waitForTimeout(300);

  if (hazardPropertyLabel) {
    await page.getByRole("button", { name: hazardPropertyLabel, exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(150);
  }

  await page.locator('[id$="-recyclingQuantity"]').first().fill("500");
  await page.getByLabel("Birim").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: "kg", exact: true }).click();
  await page.waitForTimeout(200);

  await page.getByLabel("Malzeme Durumu").first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: "Ayrıştırılmış", exact: false }).first().click();
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: "Tüm Süreç" }).first().click({ timeout: 5000 });
  await page.waitForTimeout(200);
}

/** İki aşamalı akış: form gönderimi YALNIZCA doğrular ve "Operasyon Özeti" önizlemesine geçer — GERÇEK createJob önizlemenin AYNI-metinli Yayınla butonundan (handlePublish) yapılır. */
async function publishJob(page) {
  const submitBtn = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await submitBtn.click();
  await page.waitForFunction(() => document.body.innerText.includes("Operasyon Özeti"), { timeout: 15000 }).catch(() => {});
  if (!(await page.locator("body").innerText()).includes("Operasyon Özeti")) {
    console.error("DEBUG publishJob — önizlemeye geçemedi, form hataları:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  const publishBtn = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishBtn.click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const jobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1] ?? null;
  if (!jobId) {
    console.error("DEBUG publishJob — yayınlanamadı:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  if (jobId) createdJobIds.push(jobId);
  return jobId;
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const providerTasima = await createUser("tasima", "hizmet-veren");
  const providerFull = await createUser("full", "hizmet-veren");
  const providerBertaraf = await createUser("bertaraf", "hizmet-veren");
  const providerWrongCategory = await createUser("nakliyeci", "hizmet-veren");
  const providerStorageOnly = await createUser("depocu", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  const promoteRows = runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}' returning id, role;`);
  record("Kurulum: 7 test hesabı oluşturuldu, biri admin'e yükseltildi", promoteRows[0]?.role === "admin", JSON.stringify(promoteRows));

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  const browser = await chromium.launch();
  try {
    await runFlow(browser, { requester, providerTasima, providerFull, providerBertaraf, providerWrongCategory, providerStorageOnly, adminUser, adminClient });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runFlow(browser, { requester, providerTasima, providerFull, providerBertaraf, providerWrongCategory, providerStorageOnly, adminUser, adminClient }) {
  let jobHazardous = null; // "Tahliye + Geri Kazanım", tehlikeli kod 15 01 10*, providerTasima hedefli
  let jobFull = null; // "Atık Tahliyesi / Taşıma", tehlikesiz kod 15 01 01, providerFull hedefli
  let jobBertaraf = null; // "Bertaraf", tehlikesiz kod 16 01 03, providerBertaraf hedefli
  let jobUnknown = null; // "Atık kodunu bilmiyorum"

  // =========================================================================
  // A) REGRESYON — Nakliye ilan oluşturma bu görevden ETKİLENMEDİ (mevcut
  //    sistemi koruma, görev bölüm 10).
  // =========================================================================
  {
    const { error } = await requester.client.rpc("create_job", {
      p_category_id: "nakliye",
      p_title: "RecycleTest — Regresyon Nakliye",
      p_description: "Regresyon kontrolü, yirmi karakterden uzun açıklama metni.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Fabrika",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
      p_delivery_province: "Kocaeli",
      p_delivery_district: "Darıca",
      p_delivery_location_type: "open_address",
      p_delivery_address_text: "Test teslim adresi",
    });
    record("A1. Nakliye create_job (recycling alanları olmadan) HÂLÂ hatasız çalışıyor (regresyon yok)", !error, error?.message);
  }

  // =========================================================================
  // B) REGRESYON (RPC seviyesinde) — Çoklu Hizmet Operasyonu yapısı hâlâ
  //    çalışıyor: Geri Dönüşüm & Atık Tahliye + başka bir kategori TEK
  //    operasyonda birlikte oluşturulabiliyor.
  // =========================================================================
  {
    const { data, error } = await requester.client.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli",
      p_operation_details: "Çoklu hizmet regresyon testi",
      p_services: [
        {
          category_id: "geri-donusum-atik-tahliye",
          title: "RecycleTest — Operasyon İçi Geri Dönüşüm",
          description: "Operasyon regresyon kontrolü, yirmi karakterden uzun.",
          work_date: WORK_DATE,
          district: "Gebze",
          work_location_type: "Test OSB",
          address_text: "Operasyon test adresi",
          location_mode: "custom",
          recycling_requested_operation: "bertaraf",
          recycling_waste_code: "16 01 03",
          recycling_waste_code_unknown: false,
          recycling_scope_of_work: ["sahadan-toplama"],
        },
        {
          category_id: "genel-depolama",
          title: "RecycleTest — Operasyon İçi Genel Depolama",
          description: "Operasyon regresyon kontrolü, yirmi karakterden uzun.",
          work_date: WORK_DATE,
          district: "Gebze",
          work_location_type: "Test Depo",
          address_text: "Operasyon test adresi 2",
          location_mode: "custom",
          storage_product_type: "Test Ürün",
          storage_product_quantity: "10",
          storage_product_unit: "ton",
        },
      ],
      p_photos_by_service_index: {
        "0": [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
        "1": [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
      },
    });
    record("B1. create_operation_with_jobs (Geri Dönüşüm + Genel Depolama BİR ARADA) hatasız çalıştı", !error, error?.message);
    if (data?.job_ids) createdJobIds.push(...data.job_ids);
    const { data: opJobs } = await adminClient
      .from("jobs")
      .select("category_id, recycling_hazardous, recycling_waste_code")
      .eq("operation_id", data?.operation_id ?? "00000000-0000-0000-0000-000000000000");
    const recyclingRow = (opJobs ?? []).find((j) => j.category_id === "geri-donusum-atik-tahliye");
    record(
      "B2. Operasyondaki Geri Dönüşüm hizmeti kendi recycling_hazardous'ını (kod 16 01 03 tehlikesiz -> false) SUNUCU TARAFINDA doğru türetti",
      recyclingRow?.recycling_hazardous === false && recyclingRow?.recycling_waste_code === "16 01 03",
      JSON.stringify(recyclingRow),
    );
  }

  // =========================================================================
  // C) HİZMET ALAN — GERÇEK TARAYICI: tehlikeli kod (15 01 10*), "Tahliye +
  //    Geri Kazanım" işlemi, tehlike özelliği seçimi, iki aşamalı yayın.
  //
  //    KASITLI OLARAK BU BÖLÜMÜN context/page'İ KAPATILMAZ — F/K/L bölümleri
  //    (admin onayı, providerTasima teklifi, requester'ın Gelen Teklifler
  //    görüntülemesi) AYNI context'i, tmp-supabase-storage-hazard-risk-
  //    groups-test.mjs'in KENDİ page2 deseniyle BİREBİR AYNI gerekçeyle
  //    (gerçek çalıştırmada bulunan bir durum: job-detail-content.tsx'in
  //    useJobById'si (use-jobs.ts, useAllJobs'un remote-fallback birleşimi
  //    ÜZERİNDEN) BAŞKA bir tarayıcı/context'ten önceden hiç görülmemiş bir
  //    ilanı DA doğru gösterebiliyor, AMA job-visibility.ts'in reaktif
  //    yetki önbelleği (useAuthorizedRecyclingScopes vb.) İLK render'da BOŞ
  //    başlayıp asenkron dolduğu için, offer-panel.tsx'in ebeveyni olan
  //    job-detail-content.tsx'in "sayfayı hiç render etme" seviyesindeki
  //    useIsJobVisibleToSession kapısı YENİ AÇILAN bir context'te güvenilir
  //    şekilde zamanında dolmuyor — AYNI context'in KENDİ önceki
  //    ziyaretlerinden (ör. admin onayı) sonra yeniden kullanılması bu
  //    yarış durumunu ortadan kaldırıyor) devralır — role-switching çıkış+
  //    giriş (logout/loginAs) ile yapılır, YENİ bir context AÇILMAZ.
  // =========================================================================
  const { context: sharedHazardCtx, page: sharedHazardPage } = await newActorPage(browser);
  {
    const page = sharedHazardPage;
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Geri Dönüşüm & Atık Tahliye" });
    await page.waitForTimeout(500);

    await page.getByLabel("İlan Başlığı").nth(0).fill("RecycleTest — Tehlikeli Atık Tahliye+Geri Kazanım");
    await page.locator("textarea").first().fill("Geri dönüşüm uçtan uca test ilanı, yirmi karakterden uzun açıklama.");
    await page.locator('input[type="date"]').nth(0).fill(WORK_DATE);
    await page.locator('input[type="date"]').nth(1).fill(todayPlus(25));
    await fillLocation(page);
    await fillRecyclingFields(page, { operationLabel: "Tahliye + Geri Kazanım", wasteCodeQuery: "15 01 10" });

    const bodyAfterCode = await page.locator("body").innerText();
    record("C1. Yıldızlı (tehlikeli) kod seçilince 'Atık Durumu: Tehlikeli Atık' OTOMATİK gösteriliyor", bodyAfterCode.includes("Tehlikeli Atık"));
    record("C2. Kullanıcının tehlike durumunu MANUEL değiştirebileceği bir kontrol YOK (salt metin, dropdown/checkbox değil)", !bodyAfterCode.includes("Tehlikesiz olarak işaretle"));

    await page.getByRole("button", { name: "Yanıcı", exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(200);

    await fillPhotos(page);
    jobHazardous = await publishJob(page);
    record("C3. Tehlikeli atık ilanı GERÇEKTEN yayınlandı (detay sayfasına yönlendirildi)", Boolean(jobHazardous), page.url());

    await new Promise((r) => setTimeout(r, 1500));
    const { data: dbJob } = await requester.client
      .from("jobs")
      .select("recycling_requested_operation, recycling_waste_code, recycling_hazardous, recycling_hazard_properties, moderation_status")
      .eq("id", jobHazardous)
      .maybeSingle();
    record(
      "C4. Supabase'de recycling_requested_operation='tahliye-geri-kazanim', waste_code='15 01 10', hazardous=true, hazard_properties dolu, moderation_status='pending_review' kaydedildi",
      dbJob?.recycling_requested_operation === "tahliye-geri-kazanim" &&
        dbJob?.recycling_waste_code === "15 01 10" &&
        dbJob?.recycling_hazardous === true &&
        Array.isArray(dbJob?.recycling_hazard_properties) &&
        dbJob.recycling_hazard_properties.length > 0 &&
        dbJob?.moderation_status === "pending_review",
      JSON.stringify(dbJob),
    );

    const detailText = await page.locator("body").innerText().catch(() => "");
    record(
      "C5. İlan detay sayfasında Talep Edilen İşlem/Atık Kodu/Tehlike Durumu/Tehlike Özelliği KAYIPSIZ gösteriliyor",
      detailText.includes("Tahliye + Geri Kazanım") && detailText.includes("15 01 10") && detailText.includes("Tehlikeli") && detailText.includes("Yanıcı"),
      detailText.slice(0, 300),
    );
  }

  // =========================================================================
  // D) HİZMET ALAN — GERÇEK TARAYICI: "Atık kodunu bilmiyorum" akışı; kod
  //    girilmeden de ilan gönderilebiliyor, ama sistem HİÇBİR kod TAHMİN
  //    ETMİYOR.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Geri Dönüşüm & Atık Tahliye" });
    await page.waitForTimeout(500);
    await page.getByLabel("İlan Başlığı").nth(0).fill("RecycleTest — Bilinmeyen Atık Kodu");
    await page.locator("textarea").first().fill("Bilinmeyen atık kodu test ilanı, yirmi karakterden uzun açıklama.");
    await page.locator('input[type="date"]').nth(0).fill(WORK_DATE);
    await page.locator('input[type="date"]').nth(1).fill(todayPlus(25));
    await fillLocation(page);
    await fillRecyclingFields(page, { operationLabel: "Atık Tahliyesi / Taşıma", wasteCodeQuery: null });

    const bodyAfterUnknown = await page.locator("body").innerText();
    record("D1. 'Atık kodunu bilmiyorum' seçildiğinde Tehlike Durumu/Ek Bilgi alanı GÖRÜNMÜYOR (kod yok, tahmin edilmiyor)", !bodyAfterUnknown.includes("Atık Durumu:"));

    await fillPhotos(page);
    jobUnknown = await publishJob(page);
    record("D2. Kod bilinmeden de ilan GÖNDERİLEBİLDİ (zorunlu değil, admin incelemesine düşer)", Boolean(jobUnknown), page.url());

    await new Promise((r) => setTimeout(r, 1500));
    const { data: dbJob } = await requester.client
      .from("jobs")
      .select("recycling_waste_code, recycling_waste_code_unknown, recycling_hazardous")
      .eq("id", jobUnknown)
      .maybeSingle();
    record(
      "D3. Supabase'de recycling_waste_code=NULL, recycling_waste_code_unknown=true, recycling_hazardous=NULL (asla tahmin edilmiyor)",
      dbJob?.recycling_waste_code === null && dbJob?.recycling_waste_code_unknown === true && dbJob?.recycling_hazardous === null,
      JSON.stringify(dbJob),
    );
    await context.close();
  }

  // =========================================================================
  // E) BACKEND FAIL-CLOSED — kod bilinmeyen bir ilan admin tarafından
  //    onaylansa BİLE HİÇBİR depocuya eşleşmez (görev bölüm 1.C: "hiçbir
  //    şekilde otomatik eşleştirme açılmaz").
  // =========================================================================
  {
    const { error: approveErr } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobUnknown });
    record("E1. Admin, kodu bilinmeyen ilanı da onaylayabiliyor (sistem admin'i engellemiyor, ama eşleşme açılmıyor)", !approveErr, approveErr?.message);

    const { data: canView } = await adminClient.rpc("provider_can_view_job", {
      p_provider_id: providerFull.id,
      p_category_id: "geri-donusum-atik-tahliye",
      p_storage_container_groups: null,
      p_recycling_requested_operation: "atik-tahliyesi-tasima",
      p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: true,
    });
    record("E2. Onaylanmış bile olsa, kodu bilinmeyen ilan HİÇBİR (varsayımsal tam yetkili) depocuya provider_can_view_job ile eşleşmiyor (fail-closed)", canView === false, String(canView));
  }

  // =========================================================================
  // F) ADMIN — GERÇEK TARAYICI: inceleme kuyruğunda görünüyor, onaylıyor,
  //    düzenleme formu TÜM alanları kayıpsız gösteriyor/koruyor. sharedHazardCtx
  //    devam eder (bkz. C)'nin üstündeki gerekçe) — yalnızca rol değişir.
  // =========================================================================
  {
    const page = sharedHazardPage;
    await logout(page);
    await loginAs(page, adminUser.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), "RecycleTest — Tehlikeli Atık Tahliye+Geri Kazanım", { timeout: 45000 }).catch(() => {});
    const listText = await page.locator("body").innerText().catch(() => "");
    record("F1. Admin 'İlan Yönetimi' kuyruğunda tehlikeli atık ilanı GÖRÜNÜYOR", listText.includes("RecycleTest — Tehlikeli Atık Tahliye+Geri Kazanım"));

    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobHazardous}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), "Tahliye + Geri Kazanım", { timeout: 45000 }).catch(() => {});
    const detailText = await page.locator("body").innerText().catch(() => "");
    record(
      "F2. Admin ilan detayında Talep Edilen İşlem/Atık Kodu/Tehlike Durumu/Özelliği GÖRÜNÜYOR",
      detailText.includes("Tahliye + Geri Kazanım") && detailText.includes("15 01 10") && detailText.includes("Tehlikeli") && detailText.includes("Yanıcı"),
    );

    await page.getByRole("button", { name: /Düzenle/ }).first().click();
    await page.waitForTimeout(800);
    const editFormText = await page.locator("body").innerText().catch(() => "");
    record("F3. Admin düzenleme formu Atık Türü/Kodu/Miktar ÖNCEDEN DOLU geliyor (kayıp yok)", editFormText.includes("15 01 10") || editFormText.includes("Kâğıt"));
    await page.getByRole("button", { name: "Değişiklikleri Kaydet" }).first().click();
    await page.waitForTimeout(1200);

    const { data: afterEditRow } = await requester.client
      .from("jobs")
      .select("recycling_requested_operation, recycling_waste_code, recycling_hazardous, recycling_hazard_properties")
      .eq("id", jobHazardous)
      .maybeSingle();
    record(
      "F4. Admin düzenleme SONRASI TÜM Geri Dönüşüm alanları KAYIPSIZ (dokunmadan kaydetme hiçbir şeyi sıfırlamadı)",
      afterEditRow?.recycling_requested_operation === "tahliye-geri-kazanim" &&
        afterEditRow?.recycling_waste_code === "15 01 10" &&
        afterEditRow?.recycling_hazardous === true &&
        (afterEditRow?.recycling_hazard_properties ?? []).length > 0,
      JSON.stringify(afterEditRow),
    );

    await page.getByRole("button", { name: "Onayla ve Yayınla" }).click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const afterApproveText = await page.locator("body").innerText().catch(() => "");
    record("F5. Tehlikeli atık ilanı GERÇEK admin panelinden onaylandı", !afterApproveText.includes("Onayla ve Yayınla"));
  }

  // =========================================================================
  // G) YETKİSİZ FİRMALAR — hiçbiri ilanı GÖREMEZ/teklif VEREMEZ (UI + backend).
  // =========================================================================
  {
    const { error: err1 } = await providerTasima.client.rpc("create_offer", {
      p_job_id: jobHazardous, p_amount: 5000, p_currency: "TRY",
      p_description: "Hiçbir yetkisi olmadan doğrudan RPC çağrısı — reddedilmeli.",
      p_commercial_direction: "hizmet-bedeli",
    });
    record("G1. Hiç yetkisi olmayan providerTasima DOĞRUDAN backend/RPC ile ENGELLENDİ (MLK60)", err1?.code === "MLK60" || /MLK60/.test(err1?.message ?? ""), err1?.message);

    const { context, page } = await newActorPage(browser);
    await loginAs(page, providerTasima.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/ilanlar`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const listingText = await page.locator("body").innerText().catch(() => "");
    record("G2. Yetkisiz providerTasima Aktif İlanlar'da bu ilanı GÖRMÜYOR (UI)", !listingText.includes("Tehlikeli Atık Tahliye+Geri Kazanım"));
    await context.close();
  }

  // =========================================================================
  // H) HİZMET VEREN — GERÇEK TARAYICI: belge yükleme, TALEP EDİLEN faaliyet
  //    + atık kodu (yalnızca taşıma + 15 01 10) — kategori seçimi otomatik
  //    yetki VERMİYOR.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, providerTasima.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/belge-yukleme`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Geri Dönüşüm & Atık Tahliye", exact: true }).click({ timeout: 15000 });
    await page.waitForTimeout(800);
    const uploadFormText = await page.locator("body").innerText().catch(() => "");
    record("H1. Geri Dönüşüm belge yükleme formunda 'Faaliyetler' ve 'Atık Kodları' seçicileri GÖRÜNÜYOR (opsiyonel)", uploadFormText.includes("Faaliyetler") && uploadFormText.includes("Atık Kodları"));

    await page.getByRole("button", { name: "Atık Taşıma / Tahliye", exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(150);
    await page.getByLabel("Atık Kodları (opsiyonel) içinde ara").fill("15 01 10");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^15 01 10/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(150);

    const tmp = os.tmpdir();
    const docFile = path.join(tmp, `fixture-valid-1.jpg`);
    readFileSync(docFile);
    await page.locator('input[type="file"]').setInputFiles([docFile]);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Belgeyi Gönder" }).click({ timeout: 15000 });
    await page.waitForTimeout(2500);
    const afterUploadText = await page.locator("body").innerText().catch(() => "");
    record("H2. Belge yükleme (yalnız taşıma faaliyeti + tek kod talebiyle) tamamlandı", afterUploadText.includes("belgeniz yüklendi") || afterUploadText.includes("Admin onayı bekliyor"));
    await context.close();
  }

  await new Promise((r) => setTimeout(r, 1500));
  const docRows = runSql(`select id, requested_recycling_activities, requested_recycling_waste_codes from public.provider_documents where provider_id = '${providerTasima.id}' and service_category_id = 'geri-donusum-atik-tahliye' order by uploaded_at desc limit 1;`);
  const tasimaDocRow = docRows?.[0];
  record(
    "H3. Yüklenen belgede TALEP EDİLEN (henüz onaylanmamış) faaliyet ve kod kaydedildi — seçim OTOMATİK YETKİ VERMEDİ",
    (tasimaDocRow?.requested_recycling_activities ?? []).includes("tasima") && (tasimaDocRow?.requested_recycling_waste_codes ?? []).includes("15 01 10"),
    JSON.stringify(tasimaDocRow),
  );
  {
    const { data: canViewBeforeApproval } = await adminClient.rpc("provider_can_view_job", {
      p_provider_id: providerTasima.id, p_category_id: "geri-donusum-atik-tahliye", p_storage_container_groups: null,
      p_recycling_requested_operation: "atik-tahliyesi-tasima", p_recycling_waste_code: "15 01 10", p_recycling_waste_code_unknown: false,
    });
    record("H4. Belge SADECE yüklendi, ADMİN HENÜZ ONAYLAMADI — hâlâ eşleşmiyor (talep = yetki DEĞİL)", canViewBeforeApproval === false, String(canViewBeforeApproval));
  }

  // =========================================================================
  // I) ADMIN — GERÇEK TARAYICI: talep edilen faaliyet+kodu AYRI AYRI onaylar
  //    (bağımsız onay — görev bölüm 3).
  // =========================================================================
  if (tasimaDocRow) {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, adminUser.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/admin/firma-belgeleri/${tasimaDocRow.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("15 01 10"), { timeout: 20000 }).catch(() => {});
    const reviewText = await page.locator("body").innerText().catch(() => "");
    record("I1. Admin belge inceleme ekranında talep edilen faaliyet VE atık kodu GÖRÜNÜYOR", reviewText.includes("Atık Taşıma") && reviewText.includes("15 01 10"), reviewText.slice(0, 500));

    await page.getByRole("button", { name: "Onayla" }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await context.close();
  }

  const { data: afterReviewActivity } = await adminClient
    .from("provider_service_authorizations")
    .select("recycling_activities, revoked_at")
    .eq("provider_id", providerTasima.id)
    .eq("service_category_id", "geri-donusum-atik-tahliye")
    .is("revoked_at", null)
    .maybeSingle();
  record(
    "I2. Admin onayı SONUCU: providerTasima ARTIK 'tasima' faaliyeti için yetkili (provider_service_authorizations.recycling_activities)",
    (afterReviewActivity?.recycling_activities ?? []).includes("tasima"),
    JSON.stringify(afterReviewActivity),
  );
  const wasteCodeAuthRows = runSql(`select waste_code, revoked_at from public.provider_recycling_waste_code_authorizations where provider_id = '${providerTasima.id}';`);
  record(
    "I3. Admin onayı SONUCU: providerTasima ARTIK '15 01 10' atık kodu için AYRI yetkili (provider_recycling_waste_code_authorizations)",
    (wasteCodeAuthRows ?? []).some((r) => r.waste_code === "15 01 10" && !r.revoked_at),
    JSON.stringify(wasteCodeAuthRows),
  );

  // =========================================================================
  // J) YALNIZCA TAŞIMA YETKİLİ — "Tahliye + Geri Kazanım" (taşıma+geri
  //    kazanım gerektiren) ilana HÂLÂ teklif VEREMİYOR (yalnız BİRİ yetmez,
  //    görev bölüm 4 örnek B).
  // =========================================================================
  {
    const { error } = await providerTasima.client.rpc("create_offer", {
      p_job_id: jobHazardous, p_amount: 5000, p_currency: "TRY",
      p_description: "Yalnız taşıma yetkisiyle Tahliye+Geri Kazanım ilanına teklif — reddedilmeli.",
      p_commercial_direction: "hizmet-bedeli",
    });
    record("J1. Yalnız 'tasima' yetkili firma 'Tahliye + Geri Kazanım' (taşıma+geri kazanım gerektiren) ilana HÂLÂ teklif VEREMİYOR (MLK60)", error?.code === "MLK60" || /MLK60/.test(error?.message ?? ""), error?.message);
  }

  // =========================================================================
  // K) TAM YETKİ TAMAMLANDI — geri-kazanım faaliyeti de admin tarafından
  //    (doğrudan RPC ile, akışın ikinci bir belge yükleme turunu tekrar
  //    sürmemesi için) eklenir; ARTIK GERÇEK TARAYICI ÜZERİNDEN teklif
  //    verebiliyor (Ticari Yön: "Atık Satın Alma Teklifi").
  // =========================================================================
  {
    const { error } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerTasima.id, p_service_category_id: "geri-donusum-atik-tahliye",
      p_reason: "RecycleTest — geri kazanım faaliyeti de eklendi", p_recycling_activities: ["tasima", "geri-kazanim"],
    });
    record("K1. Admin 'geri-kazanim' faaliyetini de EKLEDİ (mevcut 'tasima' korunarak, tek satır güncellendi)", !error, error?.message);
  }
  {
    const { data: canViewNow } = await adminClient.rpc("provider_can_view_job", {
      p_provider_id: providerTasima.id, p_category_id: "geri-donusum-atik-tahliye", p_storage_container_groups: null,
      p_recycling_requested_operation: "tahliye-geri-kazanim", p_recycling_waste_code: "15 01 10", p_recycling_waste_code_unknown: false,
    });
    record("K2. Backend: HER İKİ faaliyet + kod onaylı ARTIK provider_can_view_job=true", canViewNow === true, String(canViewNow));
  }
  {
    // TEŞHİS — GERÇEK tarayıcının kullandığı AYNI yol: providerTasima'nın
    // KENDİ oturumundan (admin değil) get_visible_jobs() çağrısı, jobHazardous
    // sonuç kümesinde mi diye bakar. RLS/provider_can_view_job'ın KENDİSİ mi
    // yoksa istemci tarafı React state'i mi sorunlu, bunu ayırt eder.
    const { data: visibleJobsForTasima, error: visErr } = await providerTasima.client.rpc("get_visible_jobs");
    const found = (visibleJobsForTasima ?? []).find((j) => j.id === jobHazardous);
    record(
      "K2b. TEŞHİS: providerTasima'nın KENDİ oturumundan get_visible_jobs() jobHazardous'ı İÇERİYOR mu",
      Boolean(found),
      visErr?.message || JSON.stringify({ count: (visibleJobsForTasima ?? []).length, found: Boolean(found) }),
    );
  }
  {
    const page = sharedHazardPage;
    await logout(page);
    await loginAs(page, providerTasima.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobHazardous}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), "Tahliye + Geri Kazanım", { timeout: 45000 }).catch(() => {});
    await page.waitForFunction(() => document.body.innerText.includes("Teklifin Ticari Yönü"), { timeout: 30000 }).catch(() => {});
    const jobPageText = await page.locator("body").innerText().catch(() => "");
    record("K3. Tam yetkili firma ilanı GÖREBİLİYOR (Teklif Ver formu render edildi)", jobPageText.includes("Teklifin Ticari Yönü"), jobPageText.slice(0, 500));

    await page.getByLabel("Teklifin Ticari Yönü").first().selectOption({ label: "Atık Satın Alma Teklifi" }, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.locator('input[placeholder="0,00"]').first().fill("12000");
    await page.locator("textarea").first().fill("Geri Dönüşüm için GERÇEK tarayıcı teklifi, yeterli uzunlukta bir açıklama metni.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click({ timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("Teklifiniz başarıyla gönderildi"), { timeout: 15000 }).catch(() => {});
    const afterOfferText = await page.locator("body").innerText().catch(() => "");
    if (!afterOfferText.includes("Teklifiniz başarıyla gönderildi")) {
      console.error("DEBUG K4 — teklif gönderilemedi:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
    }
    record("K4. GERÇEK teklif formu üzerinden 'Atık Satın Alma Teklifi' YÖNÜYLE teklif GÖNDERİLDİ", afterOfferText.includes("Teklifiniz başarıyla gönderildi"), afterOfferText.slice(0, 300));
  }

  // =========================================================================
  // L) HİZMET ALAN — GERÇEK TARAYICI: Gelen Teklifler'de uygunluk rozeti +
  //    diskalimer + doğru ticari yön etiketi ("Atık Satın Alma Teklifi: ...").
  //    Bu rozet KESİNLİKLE Hizmet Veren'in KENDİ teklif formunda YOK (K3'te
  //    zaten "Teklifin Ticari Yönü" formu görüldü, uygunluk rozeti orada
  //    HİÇ render edilmedi — görev bölüm 6'nın kesin kuralı).
  // =========================================================================
  {
    const page = sharedHazardPage;
    await logout(page);
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("Geri Dönüşüm Yetkisi Uygun"), { timeout: 20000 }).catch(() => {});
    const incomingText = await page.locator("body").innerText().catch(() => "");
    record("L1. Gelen Teklifler'de 'Geri Dönüşüm Yetkisi Uygun' rozeti GÖRÜNÜYOR", incomingText.includes("Geri Dönüşüm Yetkisi Uygun"), incomingText.slice(0, 800));
    record("L2. Diskalimer metni ('yasal taşıma süreçleri ... ayrıca teyit edilmelidir') GÖSTERİLİYOR", incomingText.includes("yasal taşıma süreçleri") && incomingText.includes("ayrıca teyit edilmelidir"));
    record("L3. Ticari yön etiketi 'Atık Satın Alma Teklifi: 12.000' DOĞRU GÖRÜNÜYOR (tutar dahil)", /Atık Satın Alma Teklifi.*12[.,]?000/.test(incomingText));
    await sharedHazardCtx.close();
  }

  // =========================================================================
  // M) STORAGE-YETKİLİ AMA GERİ DÖNÜŞÜM-YETKİSİZ — depolama risk grubu
  //    yetkisi Geri Dönüşüm yetkisi YERİNE geçmiyor (görev bölüm 4 örnek C,
  //    "iki eksen TAMAMEN AYRI").
  // =========================================================================
  {
    const { error: grantErr } = await adminClient.rpc("authorize_provider_storage_risk_group", {
      p_provider_id: providerStorageOnly.id, p_risk_group_id: "yanici-parlayici-sivilar", p_reason: "RecycleTest — yalnız depolama yetkisi",
    });
    record("M1. providerStorageOnly YALNIZ bir depolama risk grubu için yetkilendirildi (Geri Dönüşüm için HİÇ)", !grantErr, grantErr?.message);

    const { error: offerErr } = await providerStorageOnly.client.rpc("create_offer", {
      p_job_id: jobHazardous, p_amount: 5000, p_currency: "TRY",
      p_description: "Yalnız depolama yetkisiyle Geri Dönüşüm ilanına teklif — reddedilmeli.",
      p_commercial_direction: "hizmet-bedeli",
    });
    record("M2. Yalnız depolama risk grubu yetkili firma Geri Dönüşüm ilanına HÂLÂ teklif VEREMİYOR (iki eksen bağımsız)", offerErr?.code === "MLK60" || /MLK60/.test(offerErr?.message ?? ""), offerErr?.message);
  }

  // =========================================================================
  // N) BAŞKA KATEGORİDE YETKİLİ (Nakliye) — Geri Dönüşüm kategorisinin
  //    kendisi için HİÇ yetkisi yok, ilanı GÖREMİYOR/teklif VEREMİYOR.
  // =========================================================================
  {
    const { error: grantErr } = await adminClient.rpc("authorize_provider_service", { p_provider_id: providerWrongCategory.id, p_service_category_id: "nakliye", p_reason: "RecycleTest — yalnız Nakliye" });
    record("N1. providerWrongCategory YALNIZ Nakliye kategorisi için yetkilendirildi", !grantErr, grantErr?.message);
    const { error: offerErr } = await providerWrongCategory.client.rpc("create_offer", {
      p_job_id: jobHazardous, p_amount: 5000, p_currency: "TRY",
      p_description: "Yalnız Nakliye yetkisiyle Geri Dönüşüm ilanına teklif — reddedilmeli.",
      p_commercial_direction: "hizmet-bedeli",
    });
    record("N2. Yalnız Nakliye yetkili firma Geri Dönüşüm ilanına teklif VEREMİYOR (kategori düzeyinde zaten engellendi)", offerErr?.code === "MLK60" || /MLK60/.test(offerErr?.message ?? ""), offerErr?.message);
  }

  // =========================================================================
  // O) İKİNCİ VE ÜÇÜNCÜ GERÇEK TEKLİF — üç FARKLI ticari yön etiketinin
  //    (Hizmet Bedeli/Atık Satın Alma Teklifi -zaten K/L'de görüldü-/
  //    Ücretsiz Alım) birbirinden AYRIŞTIĞINI, karışmadığını doğrular.
  //    providerFull tehlikesiz, tek-faaliyetli (yalnız taşıma) bir ilana
  //    ÜCRETSİZ ALIM teklifi verir (amount=0); providerBertaraf farklı bir
  //    ilana varsayılan HİZMET BEDELİ teklifi verir.
  // =========================================================================
  const { context: sharedFullCtx, page: sharedFullPage } = await newActorPage(browser);
  {
    const page = sharedFullPage;
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Geri Dönüşüm & Atık Tahliye" });
    await page.waitForTimeout(500);
    await page.getByLabel("İlan Başlığı").nth(0).fill("RecycleTest — Ücretsiz Alım İlanı");
    await page.locator("textarea").first().fill("Ücretsiz alım ticari yön testi, yirmi karakterden uzun açıklama.");
    await page.locator('input[type="date"]').nth(0).fill(WORK_DATE);
    await page.locator('input[type="date"]').nth(1).fill(todayPlus(25));
    await fillLocation(page);
    await fillRecyclingFields(page, { operationLabel: "Atık Tahliyesi / Taşıma", wasteCodeQuery: "15 01 01" });
    await fillPhotos(page);
    jobFull = await publishJob(page);
    record("O1. İkinci ilan (tehlikesiz, yalnız taşıma) yayınlandı", Boolean(jobFull), page.url());
  }
  {
    // NOT (K)'nin AYNI dersi — job-store.ts/offers.ts#createOffer'ın job
    // aramasi SENKRON/yalnızca-YEREL'dir (bkz. jobs-lookup.ts), Supabase'ten
    // gelen "uzak ilan" birleşimini KULLANMAZ. Admin onayı BAŞKA bir
    // context'ten (adminClient, plain RPC) yapılırsa admin-jobs.ts#
    // approveJobAsAdmin'in "best-effort YEREL yama"sı hiç ÇALIŞMAZ — bu
    // durumda sharedFullPage'in KENDİ localStorage'ındaki jobFull kopyası
    // sonsuza dek "pending_review" olarak KALIR (sayfa GÖRÜNTÜLEME'si
    // useAllJobs()'un reaktif uzak-birleşimi sayesinde DOĞRU görünür, ama
    // TEKLİF GÖNDERİMİ bu yerel/eski kopyayı kullanıp reddeder — GERÇEK
    // çalıştırmada bulunan bir test hatasıydı). Bu yüzden onay da AYNI
    // context'te, GERÇEK admin panelinden yapılır (F'nin AYNI deseni).
    const page = sharedFullPage;
    await logout(page);
    await loginAs(page, adminUser.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobFull}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), "RecycleTest — Ücretsiz Alım İlanı", { timeout: 45000 }).catch(() => {});
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const afterApproveText = await page.locator("body").innerText().catch(() => "");
    const { error: activityErr } = await adminClient.rpc("authorize_provider_service", { p_provider_id: providerFull.id, p_service_category_id: "geri-donusum-atik-tahliye", p_reason: "RecycleTest — providerFull taşıma", p_recycling_activities: ["tasima"] });
    const { error: codeErr } = await adminClient.rpc("authorize_provider_recycling_waste_code", { p_provider_id: providerFull.id, p_waste_code: "15 01 01", p_reason: "RecycleTest — providerFull kod yetkisi" });
    record(
      "O2. jobFull GERÇEK admin panelinden onaylandı VE providerFull faaliyet+kod için yetkilendirildi",
      !afterApproveText.includes("Onayla ve Yayınla") && !activityErr && !codeErr,
      [activityErr, codeErr].filter(Boolean).map((e) => e.message).join(" | "),
    );

    await logout(page);
    await loginAs(page, providerFull.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobFull}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("Teklifin Ticari Yönü"), { timeout: 30000 }).catch(() => {});
    await page.getByLabel("Teklifin Ticari Yönü").first().selectOption({ label: "Ücretsiz Alım" }, { timeout: 10000 });
    await page.waitForTimeout(300);
    const bodyAfterFree = await page.locator("body").innerText();
    record("O3. 'Ücretsiz Alım' seçilince Teklif Tutarı alanı GİZLENİYOR (amount her zaman 0)", !bodyAfterFree.includes("Teklif Tutarı"));
    await page.locator("textarea").first().fill("Ücretsiz alım GERÇEK tarayıcı teklifi, yeterli uzunlukta bir açıklama metni.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click({ timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("Teklifiniz başarıyla gönderildi"), { timeout: 15000 }).catch(() => {});
    const afterOfferText = await page.locator("body").innerText().catch(() => "");
    record("O4. GERÇEK teklif formu üzerinden 'Ücretsiz Alım' teklifi (amount=0) GÖNDERİLDİ", afterOfferText.includes("Teklifiniz başarıyla gönderildi"), afterOfferText.slice(0, 300));
  }
  {
    const page = sharedFullPage;
    await logout(page);
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("Ücretsiz Alım"), { timeout: 20000 }).catch(() => {});
    // NOT: offers.ts salt localStorage'dır (jobs.ts'in aksine remote-fallback
    // birleşimi YOK, bkz. use-jobs.ts#useRemoteJobsFallback'ın offers.ts'te
    // KARŞILIĞI olmaması) — bu context (sharedFullCtx) hiç ziyaret etmediği
    // sharedHazardCtx'in "Atık Satın Alma Teklifi" teklifini KENDİ yerel
    // deposunda GÖREMEZ (gerçek çalıştırmada bulunan bir mimari sınır, ayrı
    // bir bug değil) — bu yüzden yalnızca BU context'in kendi ürettiği
    // etiket burada doğrulanır; "Atık Satın Alma Teklifi" zaten L3'te (AYNI
    // context içinde) doğrulandı.
    const incomingText = await page.locator("body").innerText().catch(() => "");
    record("O5. Gelen Teklifler'de 'Ücretsiz Alım' etiketi DOĞRU/KARIŞMADAN görünüyor", incomingText.includes("Ücretsiz Alım"), incomingText.slice(0, 1500));
    await sharedFullCtx.close();
  }

  // =========================================================================
  // P) ÜÇÜNCÜ ETİKET — "Hizmet Bedeli" yönü, K/O'da zaten kanıtlanan AYNI
  //    form/RPC yolundan üçüncü bağımsız context ile üretilir (üç etiketin
  //    de birbirinden AYRI, karışmadan doğru göründüğünü kanıtlamak için).
  // =========================================================================
  const { context: sharedBertarafCtx, page: sharedBertarafPage } = await newActorPage(browser);
  {
    const page = sharedBertarafPage;
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Geri Dönüşüm & Atık Tahliye" });
    await page.waitForTimeout(500);
    await page.getByLabel("İlan Başlığı").nth(0).fill("RecycleTest — Hizmet Bedeli İlanı");
    await page.locator("textarea").first().fill("Hizmet bedeli ticari yön testi, yirmi karakterden uzun açıklama.");
    await page.locator('input[type="date"]').nth(0).fill(WORK_DATE);
    await page.locator('input[type="date"]').nth(1).fill(todayPlus(25));
    await fillLocation(page);
    await fillRecyclingFields(page, { operationLabel: "Bertaraf", wasteCodeQuery: "16 01 03" });
    await fillPhotos(page);
    jobBertaraf = await publishJob(page);
    record("P1. Üçüncü ilan (Bertaraf, tehlikesiz) yayınlandı", Boolean(jobBertaraf), page.url());
  }
  {
    // O2'nin AYNI dersi — admin onayı BU AYNI context'in (sharedBertarafPage)
    // GERÇEK admin panelinden yapılmalı, yoksa offers.ts#createOffer'ın
    // yerel-yalnız job aramasi bu ilanı hâlâ "pending_review" görüp
    // reddeder.
    const page = sharedBertarafPage;
    await logout(page);
    await loginAs(page, adminUser.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobBertaraf}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), "RecycleTest — Hizmet Bedeli İlanı", { timeout: 45000 }).catch(() => {});
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const afterApproveText = await page.locator("body").innerText().catch(() => "");
    const { error: activityErr } = await adminClient.rpc("authorize_provider_service", { p_provider_id: providerBertaraf.id, p_service_category_id: "geri-donusum-atik-tahliye", p_reason: "RecycleTest — providerBertaraf", p_recycling_activities: ["bertaraf"] });
    const { error: codeErr } = await adminClient.rpc("authorize_provider_recycling_waste_code", { p_provider_id: providerBertaraf.id, p_waste_code: "16 01 03", p_reason: "RecycleTest — providerBertaraf kod" });
    record(
      "P2. jobBertaraf GERÇEK admin panelinden onaylandı VE providerBertaraf yetkilendirildi",
      !afterApproveText.includes("Onayla ve Yayınla") && !activityErr && !codeErr,
      [activityErr, codeErr].filter(Boolean).map((e) => e.message).join(" | "),
    );

    await logout(page);
    await loginAs(page, providerBertaraf.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobBertaraf}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("Teklifin Ticari Yönü"), { timeout: 30000 }).catch(() => {});
    // DÜZELTME (test hatası, uygulama hatası DEĞİL): offer-form.tsx'in native
    // <select>'i `useState<RecyclingCommercialDirection | "">("")` ile başlar
    // — GERÇEK varsayılan seçili değer boş "Seçiniz" placeholder'ıdır, "Hizmet
    // Bedeli" DEĞİL (yalnızca LİSTEDEKİ İLK GERÇEK seçenektir). "Hizmet
    // Bedeli"nin de AÇIKÇA seçilmesi gerekir, yoksa createOffer'ın kendi
    // "commercialDirection zorunlu" doğrulaması gönderimi reddeder.
    await page.getByLabel("Teklifin Ticari Yönü").first().selectOption({ label: "Hizmet Bedeli" }, { timeout: 10000 });
    await page.waitForTimeout(200);
    await page.locator('input[placeholder="0,00"]').first().fill("8000");
    await page.locator("textarea").first().fill("Hizmet bedeli GERÇEK tarayıcı teklifi, yeterli uzunlukta bir açıklama metni.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click({ timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("Teklifiniz başarıyla gönderildi"), { timeout: 15000 }).catch(() => {});
    const afterOfferText = await page.locator("body").innerText().catch(() => "");
    record("P3. GERÇEK teklif formu üzerinden 'Hizmet Bedeli' yönüyle teklif GÖNDERİLDİ", afterOfferText.includes("Teklifiniz başarıyla gönderildi"), afterOfferText.slice(0, 300));
  }
  {
    const page = sharedBertarafPage;
    await logout(page);
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => /Hizmet Bedeli.*8[.,]?000/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
    const incomingText = await page.locator("body").innerText().catch(() => "");
    record("P4. ÜÇÜNCÜ etiket 'Hizmet Bedeli: 8.000' DOĞRU/AYRI görünüyor (üç bağımsız context'te üç farklı etiket doğrulandı: L3/O5/P4)", /Hizmet Bedeli.*8[.,]?000/.test(incomingText));
    await sharedBertarafCtx.close();
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  const jobIdList = createdJobIds.map((id) => `'${id}'`).join(",");
  try {
    if (idList) {
      runSql(`delete from public.provider_recycling_waste_code_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_storage_risk_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_document_reviews where provider_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
      const jobFilter = jobIdList ? `job_id in (${jobIdList}) or job_id in (select id from public.jobs where requester_id in (${idList}))` : `job_id in (select id from public.jobs where requester_id in (${idList}))`;
      runSql(`delete from public.job_activity_events where ${jobFilter.replace(/job_id/g, "job_id")};`);
      runSql(`delete from public.notifications where recipient_id in (${idList}) or offer_id in (select id from public.offers where ${jobFilter});`);
      runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where ${jobFilter});`);
      runSql(`delete from public.offers where ${jobFilter};`);
      runSql(`delete from public.job_photos where ${jobFilter};`);
      if (jobIdList) runSql(`delete from public.jobs where id in (${jobIdList});`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.operations where requester_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
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
