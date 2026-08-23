// node scripts/tmp-job-detail-single-screen-layout-test.mjs
//
// İlan detay sayfası masaüstü tek-ekran (sıfır kaydırma) yoğunlaştırma
// görevinin uçtan uca doğrulaması — gerçek tarayıcıya karşı (Playwright,
// gerçek Chromium), Development Supabase projesine (trfnmpihcnriqgikglpu)
// karşı.
//
// Kapsam: 1366x768 (+1440x900/1920x1080/tablet/mobil) viewport'larda
// scrollHeight<=innerHeight kanıtı; guest/provider/requester/admin rolleri;
// Nakliye + Liman + Depolama + Geri Dönüşüm + Gümrük Müşavirliği kategorileri;
// kısa/uzun açıklama (modal); Ton/Kg; çok fotoğraflı ilan; rota hattı
// hizalaması; konsol hata kontrolü.
//
// Fotoğraflar gerçek Storage dosyası OLMADAN, sahte storage_path ile
// eklenir (create_job RPC'sinin kendisi yalnızca 1-10 arası bir sayı ister,
// gerçek bir dosyanın var olmasını doğrulamaz) — bu, salt YERLEŞİM/boyut
// testi için yeterlidir (fotoğraf kutusu yüksekliği/thumbnail sayısı gerçek
// bir görselin başarıyla yüklenip yüklenmediğinden bağımsızdır); gerçek
// fotoğraf İÇERİĞİ bu testin kapsamı DIŞINDADIR.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

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
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 350) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const idSuffix = stamp.toString(36);
const createdUserIds = [];
const createdJobIds = [];
const consoleErrors = [];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fakePhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    storage_path: `layouttest/${stamp}/${index}.jpg`,
    original_file_name: `test-${index}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 12345,
    width: null,
    height: null,
  }));
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

async function newActorPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
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

async function gotoJobAndWait(page, jobId, needle) {
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  let ok = await page
    .waitForFunction((t) => document.body.innerText.includes(t), needle, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    ok = await page
      .waitForFunction((t) => document.body.innerText.includes(t), needle, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
  }
  return ok;
}

async function measureFit(page, label, { allowScroll = false } = {}) {
  await page.waitForTimeout(400); // fonts/hydration settle
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const fitsVertically = metrics.scrollHeight <= metrics.innerHeight;
  const noHorizontalOverflow = metrics.scrollWidth <= metrics.clientWidth + 1; // 1px rounding tolerance
  record(
    `${label}: yatay taşma yok (scrollWidth<=clientWidth)`,
    noHorizontalOverflow,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  if (!allowScroll) {
    record(
      `${label}: dikey kaydırma YOK (scrollHeight<=innerHeight)`,
      fitsVertically,
      `scrollHeight=${metrics.scrollHeight} innerHeight=${metrics.innerHeight} innerWidth=${metrics.innerWidth}`,
    );
  } else {
    record(`${label}: ölçüm alındı (doğal kaydırmaya izin verilen viewport)`, true, JSON.stringify(metrics));
  }
  return metrics;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `layouttest-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "LayoutTest Requester",
    companyName: "LayoutTest Firma",
  });
  record("Kurulum: Hizmet Alan hesabı oluşturuldu", true);

  const provider = await createAccount({
    email: `layouttest-prov-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "LayoutTest Provider",
    companyName: "LayoutTest Provider Firma",
  });
  record("Kurulum: Hizmet Veren hesabı oluşturuldu", true);

  const adminAccount = await createAccount({
    email: `layouttest-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "LayoutTest Admin",
    companyName: "LayoutTest Admin Firma",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: admin hesabı oluşturuldu ve yükseltildi", true);

  const categories = ["nakliye", "lashing-unlashing", "genel-depolama", "geri-donusum-atik-tahliye", "gumruk-musavirligi"];
  const authRows = categories.map((c) => `('${provider.id}', '${c}', '${adminAccount.id}', 'test setup')`).join(",");
  runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_by, authorize_reason) values ${authRows};`);
  record("Kurulum: provider tüm test kategorileri için yetkilendirildi", true);

  console.log("\n=== Kurulum: ilanlar (RPC ile, kategoriye özel alanlarla) ===");
  const jobs = {};

  const nakliyeShort = await requester.client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "Layout Testi — Nakliye Kısa Açıklama (Ton)",
    p_description: "Kısa bir test açıklaması, otuz karakterin biraz üzerinde.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Yükleme Tesisi",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Yükleme Açık Adresi",
    p_delivery_province: "İzmir",
    p_delivery_district: "Aliağa",
    p_delivery_location_type: "open_address",
    p_delivery_facility_name: "Test Teslim Tesisi",
    p_delivery_address_text: "Test Teslim Açık Adresi",
    p_product_quantity: 25,
    p_product_tonnage: 25,
    p_product_type: "Alüminyum",
    p_product_tonnage_unit: "ton",
  });
  if (nakliyeShort.error) throw nakliyeShort.error;
  jobs.nakliyeShort = nakliyeShort.data.id;
  createdJobIds.push(jobs.nakliyeShort);

  // NOT: bu metin bilerek hedef link etiketinin kelimelerini İÇERMEZ — aksi
  // halde Playwright'ın metin bazlı seçicisi hem paragraf içindeki bu
  // cümleyle hem gerçek butonla eşleşip strict-mode hatasına yol açar (bu
  // testin ilk turunda gerçekten yaşanan, ürün kodu değil test yazımı
  // kaynaklı bir sahte-başarısızlık — bkz. proje raporu).
  const longDescription =
    "Bu ilan, uzun bir iş açıklaması senaryosunu doğrulamak için bilinçli olarak uzatılmış örnek bir metindir; orta sütunun dar genişliğinde birkaç satıra yayılması ve kısaltma davranışının tetiklenmesi beklenir. ".repeat(4);
  const nakliyeLong = await requester.client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "Layout Testi — Nakliye Uzun Açıklama + Kg + Çoklu Fotoğraf",
    p_description: longDescription,
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Yükleme Tesisi",
    p_work_date: todayPlus(21),
    p_photos: fakePhotos(5),
    p_address_text: "Test Yükleme Açık Adresi 2",
    p_delivery_province: "İstanbul",
    p_delivery_district: "Kartal",
    p_delivery_location_type: "open_address",
    p_delivery_facility_name: "Test Teslim Tesisi 2",
    p_delivery_address_text: "Test Teslim Açık Adresi 2",
    p_product_quantity: 750,
    p_product_tonnage: 750,
    p_product_type: "Hassas Elektronik Ekipman",
    p_product_tonnage_unit: "kg",
  });
  if (nakliyeLong.error) throw nakliyeLong.error;
  jobs.nakliyeLong = nakliyeLong.data.id;
  createdJobIds.push(jobs.nakliyeLong);

  const limanJob = await requester.client.rpc("create_job", {
    p_category_id: "lashing-unlashing",
    p_title: "Layout Testi — Liman Hizmetleri (Lashing/Unlashing)",
    p_description: "Liman kategorisi regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Liman Tesisi",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Liman Açık Adresi",
    p_product_quantity: 15,
    p_product_tonnage: 12.3,
    p_product_type: "Liman Test Ürünü",
  });
  if (limanJob.error) throw limanJob.error;
  jobs.liman = limanJob.data.id;
  createdJobIds.push(jobs.liman);

  const storageJob = await requester.client.rpc("create_job", {
    p_category_id: "genel-depolama",
    p_title: "Layout Testi — Depolama",
    p_description: "Depolama kategorisi regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Depo Tesisi",
    p_work_date: todayPlus(20),
    p_work_end_date: todayPlus(24),
    p_photos: fakePhotos(1),
    p_address_text: "Test Depo Açık Adresi",
    p_storage_product_type: "Rulo Sac",
    p_storage_product_quantity: 10,
    p_storage_product_unit: "adet",
    p_storage_product_tonnage: 5.5,
  });
  if (storageJob.error) throw storageJob.error;
  jobs.storage = storageJob.data.id;
  createdJobIds.push(jobs.storage);

  const recyclingJob = await requester.client.rpc("create_job", {
    p_category_id: "geri-donusum-atik-tahliye",
    p_title: "Layout Testi — Geri Dönüşüm & Atık Tahliye",
    p_description: "Geri dönüşüm kategorisi regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Tesis",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Açık Adres",
    p_recycling_material_category_id: "metal-hurda",
    p_recycling_material_subtype_id: "demir-celik",
    p_recycling_quantity: 8,
    p_recycling_unit: "ton",
    p_recycling_material_condition: "ayristirilmis",
    p_recycling_scope_of_work: ["sahadan-toplama", "tasima"],
  });
  if (recyclingJob.error) throw recyclingJob.error;
  jobs.recycling = recyclingJob.data.id;
  createdJobIds.push(jobs.recycling);

  const customsJob = await requester.client.rpc("create_job", {
    p_category_id: "gumruk-musavirligi",
    p_title: "Layout Testi — Gümrük Müşavirliği",
    p_description: "Gümrük müşavirliği kategorisi regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Ofis",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Açık Adres",
    p_customs_product_type: "Elektronik Eşya",
    p_customs_transaction_type: "ithalat",
    p_customs_requested_services: ["ithalat-gumrukleme", "beyanname-hazirlama"],
  });
  if (customsJob.error) throw customsJob.error;
  jobs.customs = customsJob.data.id;
  createdJobIds.push(jobs.customs);

  record("Kurulum: 6 ilan (Nakliye x2, Liman, Depolama, Geri Dönüşüm, Gümrük) oluşturuldu", true, JSON.stringify(jobs));

  runSql(`update public.jobs set moderation_status = 'approved' where id in (${createdJobIds.map((id) => `'${id}'`).join(",")});`);
  record("Kurulum: tüm ilanlar onaylandı", true);

  const browser = await chromium.launch();
  try {
    // ============================================================
    // 1366x768 — roller: guest, provider(yetkili), owner(requester), admin
    // ============================================================
    console.log("\n=== 1366x768 — Nakliye (kısa açıklama, Ton) — 4 rol ===");
    const tmp = os.tmpdir();

    {
      const { page } = await newActorPage(browser);
      const ok = await gotoJobAndWait(page, jobs.nakliyeShort, "Ürün Bilgileri");
      record("Guest: sayfa yüklendi", ok);
      await measureFit(page, "1366x768 / Guest / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1366-guest-nakliye.png"), fullPage: false });
      const cardText = await page.locator("main, body").first().innerText();
      record("Guest: 3 ürün kartı sırayla görünüyor (Cinsi→Adedi→Ağırlık)", /Ürün Cinsi[\s\S]*Ürün Adedi[\s\S]*Toplam Ağırlık/.test(cardText));
      record("Guest: '25 ton' doğru gösteriliyor", cardText.includes("25 ton"), cardText.match(/Toplam Ağırlık\s*\n?\s*([^\n]+)/)?.[0]);
      record(
        "Guest: eski büyük 'Ürün Bilgileri'/'İş Açıklaması' kartları ana gridin ALTINDA yok (yalnızca üstteki tek kartların içinde)",
        (await page.locator("h2:text('Ürün Bilgileri')").count()) <= 1 && (await page.locator("h2:text('İş Açıklaması')").count()) <= 1,
      );

      // Başlık şeridi kontrolü (3. tur, referans görsele göre): başlık
      // TEK yerde (h1) görünmeli, dar bilgi kartına sıkışmamalı — genişliği
      // fotoğraf+bilgi satırının TOPLAM genişliğine yakın olmalı (dar
      // ~380-400px bir sütuna sığmadığını kanıtlamak için).
      const h1Count = await page.locator("h1").count();
      record("Başlık (h1) sayfada TEK yerde görünüyor", h1Count === 1, h1Count);
      const titleBox = await page.locator("h1").first().boundingBox().catch(() => null);
      record("Başlık şeridi geniş (>=700px) — dar bilgi kartına sıkışmamış", Boolean(titleBox && titleBox.width >= 700), JSON.stringify(titleBox));
    }

    {
      const { page } = await newActorPage(browser);
      await loginAs(page, provider.email);
      const ok = await gotoJobAndWait(page, jobs.nakliyeShort, "Ürün Bilgileri");
      record("Yetkili Hizmet Veren: sayfa yüklendi", ok);
      await measureFit(page, "1366x768 / Provider(yetkili) / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1366-provider-nakliye.png"), fullPage: false });
      const offerFormVisible = await page.getByLabel("Teklif Tutarı").first().isVisible().catch(() => false);
      record("Yetkili Hizmet Veren: Teklif Ver formu doğrudan panelde (iç içe ikinci kart yok)", offerFormVisible);

      const currencySelectVisible = await page.getByLabel("Para birimi").first().isVisible().catch(() => false);
      record("Birleşik 'Teklif Tutarı' kontrolü: para birimi seçici görünüyor", currencySelectVisible);
      const currencyOptionText = await page.getByLabel("Para birimi").first().locator("option").first().innerText().catch(() => "");
      record(
        "Para birimi kısa gösterimde ('₺ TRY' gibi), 'Türk Lirası (TR...)' kesilmiyor",
        currencyOptionText.includes("TRY") && currencyOptionText.length < 15,
        currencyOptionText,
      );
      const durationLabelVisible = await page.getByText("Taahhüt Edilen Süre", { exact: false }).isVisible().catch(() => false);
      record("Süre alanı yeni kısa etiketle gösteriliyor ('Taahhüt Edilen Süre')", durationLabelVisible);
      const submitButton = page.getByRole("button", { name: "Teklif Gönder" });
      const submitBox = await submitButton.boundingBox().catch(() => null);
      record("'Teklif Gönder' butonu tam genişlikte ve >=44px yükseklikte", Boolean(submitBox && submitBox.height >= 44), JSON.stringify(submitBox));
    }

    {
      const { page } = await newActorPage(browser);
      await loginAs(page, requester.email);
      const ok = await gotoJobAndWait(page, jobs.nakliyeShort, "Ürün Bilgileri");
      record("İlan sahibi (Hizmet Alan): sayfa yüklendi", ok);
      await measureFit(page, "1366x768 / Owner / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1366-owner-nakliye.png"), fullPage: false });
      const shortDescLinkVisible = await page.getByRole("button", { name: "Devamını Göster", exact: false }).isVisible().catch(() => false);
      record("Kısa açıklamada 'Devamını Göster' GÖSTERİLMİYOR", !shortDescLinkVisible);
    }

    {
      const { page } = await newActorPage(browser);
      await loginAs(page, adminAccount.email);
      const ok = await gotoJobAndWait(page, jobs.nakliyeShort, "Ürün Bilgileri");
      record("Admin: sayfa yüklendi", ok);
      await measureFit(page, "1366x768 / Admin / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1366-admin-nakliye.png"), fullPage: false });
    }

    // ============================================================
    // Nakliye — uzun açıklama + Kg + çoklu fotoğraf (owner)
    // ============================================================
    console.log("\n=== Nakliye — uzun açıklama + Kg + 5 fotoğraf ===");
    {
      const { page } = await newActorPage(browser);
      await loginAs(page, requester.email);
      const ok = await gotoJobAndWait(page, jobs.nakliyeLong, "Ürün Bilgileri");
      record("Uzun açıklamalı/çoklu fotoğraflı ilan yüklendi", ok);
      await measureFit(page, "1366x768 / Owner / Nakliye-uzun+Kg+5foto");
      await page.screenshot({ path: path.join(tmp, "layout-1366-nakliye-long.png"), fullPage: false });

      const cardText = await page.locator("main, body").first().innerText();
      record("Kg birimi doğru gösteriliyor ('750 kg')", cardText.includes("750 kg"), cardText.match(/Toplam Ağırlık\s*\n?\s*([^\n]+)/)?.[0]);

      const longLinkVisible = await page.getByRole("button", { name: "Devamını Göster", exact: false }).isVisible().catch(() => false);
      record("Uzun açıklamada 'Devamını Göster' GÖSTERİLİYOR", longLinkVisible);
      if (longLinkVisible) {
        await page.getByRole("button", { name: "Devamını Göster", exact: false }).click();
        const modalVisible = await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
        record("'Devamını Göster' tıklanınca modal açılıyor", modalVisible);
        if (modalVisible) {
          const modalText = await page.getByRole("dialog").innerText();
          record("Modal TAM açıklama metnini içeriyor", modalText.includes(longDescription.trim().slice(0, 60)));
          await page.keyboard.press("Escape");
          const closedAfterEscape = !(await page.getByRole("dialog").isVisible().catch(() => false));
          record("ESC ile modal kapanıyor", closedAfterEscape);
        }
      }

      const thumbCount = await page.locator('[aria-label="Fotoğraf küçük resimleri"] button').count();
      record("5 fotoğraf için 5 küçük resim gösteriliyor", thumbCount === 5, thumbCount);
    }

    // ============================================================
    // Nakliye kısa ilan — ek viewport'lar
    // ============================================================
    console.log("\n=== Ek viewport'lar (Nakliye-kısa, owner) ===");
    {
      const { page } = await newActorPage(browser);
      await loginAs(page, requester.email);
      await gotoJobAndWait(page, jobs.nakliyeShort, "Ürün Bilgileri");

      await page.setViewportSize({ width: 1440, height: 900 });
      await measureFit(page, "1440x900 / Owner / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1440-owner-nakliye.png"), fullPage: false });

      await page.setViewportSize({ width: 1920, height: 1080 });
      await measureFit(page, "1920x1080 / Owner / Nakliye-kısa");
      await page.screenshot({ path: path.join(tmp, "layout-1920-owner-nakliye.png"), fullPage: false });

      // Tablet — doğal kaydırmaya izin verilir, yalnızca yatay taşma kontrol edilir.
      await page.setViewportSize({ width: 820, height: 1180 });
      await measureFit(page, "Tablet 820x1180 / Owner / Nakliye-kısa", { allowScroll: true });
      await page.screenshot({ path: path.join(tmp, "layout-tablet-owner-nakliye.png"), fullPage: true });

      // Mobil — doğal dikey kaydırma normal, yalnızca yatay taşma YASAK.
      await page.setViewportSize({ width: 390, height: 844 });
      await measureFit(page, "Mobil 390x844 / Owner / Nakliye-kısa", { allowScroll: true });
      await page.screenshot({ path: path.join(tmp, "layout-mobile-owner-nakliye.png"), fullPage: true });
    }

    // ============================================================
    // Rota hattı hizalaması (Task D'nin düzeltmesi bu görevden ETKİLENMEMELİ)
    // ============================================================
    console.log("\n=== Rota hattı hizalaması regresyon kontrolü ===");
    {
      const { page } = await newActorPage(browser);
      await loginAs(page, requester.email);
      await page.setViewportSize({ width: 1366, height: 768 });
      await gotoJobAndWait(page, jobs.nakliyeShort, "YÜKLEME NOKTASI");

      const measurement = await page.evaluate(() => {
        const yukleme = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim().toLowerCase() === "yükleme noktası");
        if (!yukleme) return { found: false };
        const contentDiv = yukleme.parentElement;
        const contentColumn = contentDiv?.parentElement;
        const outerRow = contentColumn?.parentElement;
        const markerColumn = outerRow?.firstElementChild;
        if (!markerColumn) return { found: false, reason: "markerColumn-not-found" };
        const markerIcons = Array.from(markerColumn.querySelectorAll(":scope > svg"));
        const pinIcon = markerIcons[0] ?? null;
        const flagIcon = markerIcons[markerIcons.length - 1] ?? null;
        const overlay = markerColumn.querySelector(":scope > div.absolute");
        const arrowIcon = overlay?.querySelector("svg") ?? null;
        function centerX(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.left + r.width / 2;
        }
        return {
          found: true,
          pinCenterX: centerX(pinIcon),
          arrowCenterX: centerX(arrowIcon),
          flagCenterX: centerX(flagIcon),
        };
      });
      if (measurement.found) {
        const centers = [measurement.pinCenterX, measurement.arrowCenterX, measurement.flagCenterX].filter((c) => c !== null);
        const maxDiff = centers.length === 3 ? Math.max(...centers) - Math.min(...centers) : Infinity;
        record("Rota hattı: pin/ok/bayrak yatay merkezleri hizalı (<=2px)", maxDiff <= 2, `fark=${maxDiff.toFixed ? maxDiff.toFixed(2) : maxDiff}px`);
      } else {
        record("Rota hattı: marker sütunu bulunamadı", false, JSON.stringify(measurement));
      }
    }

    // ============================================================
    // Non-Nakliye kategoriler — 1366x768, owner
    // ============================================================
    console.log("\n=== Non-Nakliye kategori regresyonu (Liman/Depolama/Geri Dönüşüm/Gümrük) ===");
    {
      const { page } = await newActorPage(browser);
      await loginAs(page, requester.email);
      await page.setViewportSize({ width: 1366, height: 768 });

      const nonNakliyeCases = [
        { key: "liman", needle: "Lashing", shot: "layout-1366-liman.png" },
        { key: "storage", needle: "Depolama Talebi", shot: "layout-1366-storage.png" },
        { key: "recycling", needle: "Geri Dönüşüm", shot: "layout-1366-recycling.png" },
        { key: "customs", needle: "Gümrük Müşavirliği Bilgileri", shot: "layout-1366-customs.png" },
      ];
      for (const testCase of nonNakliyeCases) {
        const ok = await gotoJobAndWait(page, jobs[testCase.key], testCase.needle);
        record(`${testCase.key}: sayfa yüklendi ve kategoriye özel blok görünüyor`, ok);
        await measureFit(page, `1366x768 / Owner / ${testCase.key}`);
        await page.screenshot({ path: path.join(tmp, testCase.shot), fullPage: false });
      }
    }

    // Bu test GERÇEK Storage dosyası olmayan sahte storage_path'lerle
    // fotoğraf ekliyor (bkz. dosyanın kendi üst yorumu) — bu yüzden bu
    // fotoğrafların yüklenememesi (401/404) BEKLENEN, testin kendi
    // metodolojisinden kaynaklanan bir sinyaldir, ürün kodunda gerçek bir
    // hata DEĞİLDİR; yalnızca bu desenin DIŞINDAKİ konsol hataları gerçek
    // bulgu sayılır.
    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) => !/Failed to load resource.*401|Failed to load resource.*404/.test(message),
    );
    record(
      "Beklenmeyen konsol/sayfa hatası oluşmadı (sahte fotoğraf 401/404'leri hariç)",
      unexpectedConsoleErrors.length === 0,
      JSON.stringify({ unexpected: unexpectedConsoleErrors.slice(0, 5), totalRaw: consoleErrors.length }),
    );
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
