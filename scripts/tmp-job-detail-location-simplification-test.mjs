// node scripts/tmp-job-detail-location-simplification-test.mjs
//
// İlan detay sayfası "Hizmet Konumu" görünümünün ortak iç-kart sarmalayıcısını
// (sol koyu çizgi + gri arka plan + border + radius) kaldıran sadeleştirme
// görevinin uçtan uca doğrulaması — gerçek tarayıcıya karşı (Playwright),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı.
//
// Kapsam: Nakliye rota görünümünün BİREBİR aynı kaldığı; Depolama/Gümrük
// Müşavirliği/Liman/Forklift/Forklift Operatörü/Geri Dönüşüm kategorilerinde
// eski sarmalayıcı sınıflarının (border-l-primary, bg-accent-soft,
// rounded-[10px]) artık HİÇ bulunmadığı; Depolama Talebi kartında "Tercih
// Edilen Konum" tekrarının kalktığı; masaüstü/tablet/mobilde yatay taşma
// olmadığı; teklif kabul edilmeden önce açık adresin hâlâ GİZLİ kaldığı;
// konsolda yeni hata çıkmadığı.
//
// Fotoğraflar gerçek Storage dosyası OLMADAN, sahte storage_path ile eklenir
// (yalnızca sunum/yerleşim testi — tmp-job-detail-single-screen-layout-test.mjs
// ile AYNI, kanıtlanmış desen).
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

function fakePhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    storage_path: `loctest/${stamp}/${index}.jpg`,
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

async function newActorPage(browser, viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return { context, page, errors };
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

async function gotoJobAndWait(page, jobId) {
  // Nakliye "Hizmet Konumu" DEĞİL, "Yükleme Noktası"/"Teslim Noktası"
  // render eder (bkz. service-location-panel.tsx'in iki noktalı rota dalı)
  // — bu yüzden ikisinden HANGİSİ önce görünürse ona göre beklenir.
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
  const locator = page.getByText("Hizmet Konumu", { exact: false }).first().or(page.getByText("Yükleme Noktası", { exact: false }).first());
  const ok = await locator
    .waitFor({ state: "visible", timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await locator.waitFor({ state: "visible", timeout: 15000 });
  }
}

// Konum etiketinin (Yükleme/Teslim Noktası ya da Hizmet Konumu) bulunduğu en
// yakın atalar zincirinde eski sarmalayıcı sınıflarının (border-l-primary /
// bg-accent-soft / rounded-[10px]) İZİ kalıp kalmadığını kontrol eder — asıl
// bilgi panelinin (rounded-card border-border bg-surface) kendisi hariç.
async function checkNoLegacyWrapper(page, labelText) {
  return page.evaluate((label) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let target = null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.trim() === label) {
        target = node.parentElement;
        break;
      }
    }
    if (!target) return { found: false };
    let el = target;
    const classesSeen = [];
    for (let i = 0; i < 6 && el; i++) {
      classesSeen.push(el.className || "");
      el = el.parentElement;
    }
    const joined = classesSeen.join(" ");
    return {
      found: true,
      hasLegacyBorderL: joined.includes("border-l-primary") || joined.includes("border-l-2"),
      hasLegacyBg: joined.includes("bg-accent-soft"),
      hasLegacyRounded10: joined.includes("rounded-[10px]"),
      classesSeen,
    };
  }, labelText);
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `loctest-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "LocTest Requester",
    companyName: "LocTest Firma",
  });
  const provider = await createAccount({
    email: `loctest-prov-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "LocTest Provider",
    companyName: "LocTest Provider Firma",
  });
  const adminAccount = await createAccount({
    email: `loctest-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "LocTest Admin",
    companyName: "LocTest Admin Firma",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: hesaplar oluşturuldu (requester/provider/admin)", true);

  const categories = [
    "nakliye",
    "genel-depolama",
    "gumruk-musavirligi",
    "lashing-unlashing",
    "gozetim-hizmetleri",
    "forklift",
    "forklift-operatoru",
    "geri-donusum-atik-tahliye",
  ];
  const authRows = categories.map((c) => `('${provider.id}', '${c}', '${adminAccount.id}', 'test setup')`).join(",");
  runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_by, authorize_reason) values ${authRows};`);
  record("Kurulum: provider tüm test kategorileri için yetkilendirildi", true);

  console.log("\n=== Kurulum: ilanlar (RPC ile) ===");
  const jobs = {};

  const nakliye = await requester.client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "KonumTest — Nakliye",
    p_description: "Nakliye rota-değişmezliği regresyon testi açıklaması.",
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
  if (nakliye.error) throw nakliye.error;
  jobs.nakliye = nakliye.data.id;

  const storage = await requester.client.rpc("create_job", {
    p_category_id: "genel-depolama",
    p_title: "KonumTest — Depolama",
    p_description: "Depolama konum-tekrarı regresyon testi açıklaması.",
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
  });
  if (storage.error) throw storage.error;
  jobs.storage = storage.data.id;

  const customs = await requester.client.rpc("create_job", {
    p_category_id: "gumruk-musavirligi",
    p_title: "KonumTest — Gümrük Müşavirliği",
    p_description: "Gümrük müşavirliği kategori regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Ofis",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Açık Adres",
    p_customs_product_type: "Elektronik Eşya",
    p_customs_transaction_type: "ithalat",
    p_customs_requested_services: ["ithalat-gumrukleme"],
  });
  if (customs.error) throw customs.error;
  jobs.customs = customs.data.id;

  const liman = await requester.client.rpc("create_job", {
    p_category_id: "lashing-unlashing",
    p_title: "KonumTest — Liman (Lashing/Unlashing)",
    p_description: "Liman hizmetleri kategori regresyon testi açıklaması.",
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
  if (liman.error) throw liman.error;
  jobs.liman = liman.data.id;

  const forklift = await requester.client.rpc("create_job", {
    p_category_id: "forklift",
    p_title: "KonumTest — Forklift",
    p_description: "İş makinesi (Forklift) kategori regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Fabrika",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Fabrika Açık Adresi",
  });
  if (forklift.error) throw forklift.error;
  jobs.forklift = forklift.data.id;

  const forkliftOperator = await requester.client.rpc("create_job", {
    p_category_id: "forklift-operatoru",
    p_title: "KonumTest — Forklift Operatörü",
    p_description: "Operatör hizmetleri kategori regresyon testi açıklaması.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Dilovası",
    p_work_location_type: "Test Fabrika 2",
    p_work_date: todayPlus(20),
    p_photos: fakePhotos(1),
    p_address_text: "Test Fabrika 2 Açık Adresi",
  });
  if (forkliftOperator.error) throw forkliftOperator.error;
  jobs.forkliftOperator = forkliftOperator.data.id;

  const recycling = await requester.client.rpc("create_job", {
    p_category_id: "geri-donusum-atik-tahliye",
    p_title: "KonumTest — Geri Dönüşüm & Atık Tahliye",
    p_description: "Geri dönüşüm kategori regresyon testi açıklaması.",
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
    p_recycling_scope_of_work: ["sahadan-toplama"],
  });
  if (recycling.error) throw recycling.error;
  jobs.recycling = recycling.data.id;

  createdJobIds.push(...Object.values(jobs));
  runSql(`update public.jobs set moderation_status = 'approved' where id in (${createdJobIds.map((id) => `'${id}'`).join(",")});`);
  record("Kurulum: 7 ilan oluşturuldu ve onaylandı (Nakliye/Depolama/Gümrük/Liman/Forklift/Operatör/Geri Dönüşüm)", true, JSON.stringify(jobs));

  const browser = await chromium.launch();
  try {
    // ============================================================
    // 1. Nakliye rota görünümü DEĞİŞMEDİ
    // ============================================================
    console.log("\n=== 1. Nakliye rota görünümü değişmezliği ===");
    const { page: nakliyePage, errors: nakliyeErrors } = await newActorPage(browser);
    await loginAs(nakliyePage, requester.email);
    await gotoJobAndWait(nakliyePage, jobs.nakliye);
    const pickupVisible = await nakliyePage.getByText("Yükleme Noktası", { exact: false }).first().isVisible().catch(() => false);
    const deliveryVisible = await nakliyePage.getByText("Teslim Noktası", { exact: false }).first().isVisible().catch(() => false);
    record("Nakliye: Yükleme Noktası + Teslim Noktası ikisi de görünüyor", pickupVisible && deliveryVisible);
    const routeLineMetrics = await nakliyePage.evaluate(() => {
      const dashedLines = document.querySelectorAll(".border-dashed.border-muted-foreground\\/40");
      const arrowSvg = document.querySelector("svg.text-success");
      return { dashedLineCount: dashedLines.length, hasArrow: Boolean(arrowSvg) };
    });
    record(
      "Nakliye: kesikli rota çizgisi (2 segment) + yön oku hâlâ mevcut",
      routeLineMetrics.dashedLineCount === 2 && routeLineMetrics.hasArrow,
      JSON.stringify(routeLineMetrics),
    );
    const nakliyeNoNewWrapper = await checkNoLegacyWrapper(nakliyePage, "Yükleme Noktası");
    record(
      "Nakliye: Yükleme Noktası'na YENİ bir bordered/gri kart eklenmedi (zaten hiç olmamıştı)",
      nakliyeNoNewWrapper.found && !nakliyeNoNewWrapper.hasLegacyBg && !nakliyeNoNewWrapper.hasLegacyRounded10,
      JSON.stringify(nakliyeNoNewWrapper),
    );

    // ============================================================
    // 2+3+4+5. Depolama: eski sarmalayıcı yok + konum tekrarı yok
    // ============================================================
    console.log("\n=== 2-5. Depolama ===");
    await gotoJobAndWait(nakliyePage, jobs.storage);
    const storageWrapperCheck = await checkNoLegacyWrapper(nakliyePage, "Hizmet Konumu");
    record(
      "Depolama: sol koyu çizgi (border-l-primary) YOK",
      storageWrapperCheck.found && !storageWrapperCheck.hasLegacyBorderL,
      JSON.stringify(storageWrapperCheck),
    );
    record("Depolama: gri iç arka plan (bg-accent-soft) YOK", storageWrapperCheck.found && !storageWrapperCheck.hasLegacyBg);
    record("Depolama: eski rounded-[10px] iç kart YOK", storageWrapperCheck.found && !storageWrapperCheck.hasLegacyRounded10);
    const storageLocationVisible = await nakliyePage.getByText("Hizmet Konumu", { exact: false }).first().isVisible();
    record("Depolama: Hizmet Konumu ana panelde görünüyor", storageLocationVisible);
    const storageBodyText = await nakliyePage.locator("main, body").first().innerText();
    const preferredLocationCount = (storageBodyText.match(/Tercih Edilen Konum/g) || []).length;
    record("Depolama: 'Tercih Edilen Konum' tekrarı Depolama Talebi'nden kaldırılmış (0 kez geçiyor)", preferredLocationCount === 0, `count=${preferredLocationCount}`);
    const storageRequestHeadingVisible = await nakliyePage.getByRole("heading", { name: "Depolama Talebi" }).isVisible().catch(() => false);
    record("Depolama: 'Depolama Talebi' bölümü hâlâ mevcut (yalnız konum tekrarı kaldırıldı)", storageRequestHeadingVisible);
    const districtProvinceOnceInPanel = (storageBodyText.match(/Dilovası \/ Kocaeli/g) || []).length;
    record("Depolama: 'Dilovası / Kocaeli' sayfada YALNIZ 1 kez geçiyor (konum tekrarı gerçekten kalktı)", districtProvinceOnceInPanel === 1, `count=${districtProvinceOnceInPanel}`);

    // ============================================================
    // 6-11. Diğer tek-konumlu kategoriler
    // ============================================================
    console.log("\n=== 6-11. Diğer kategoriler ===");
    const otherCategoryChecks = [
      ["customs", "Gümrük Müşavirliği"],
      ["liman", "Liman Hizmetleri"],
      ["forklift", "Forklift"],
      ["forkliftOperator", "Forklift Operatörü"],
      ["recycling", "Geri Dönüşüm & Atık Tahliye"],
    ];
    // Kilit mesajı yalnız isRevealed=false iken görünür — ilan SAHİBİ
    // (nakliyePage, requester ile giriş yapılmış) canViewJobAddress'in
    // "sahip her zaman görür" istisnası gereği HER ZAMAN gerçek adresi
    // görür, kilit mesajını asla göremez. Bu yüzden kilit mesajı kontrolü
    // ayrı, yetkili-ama-teklifi-kabul-EDİLMEMİŞ bir Hizmet Veren
    // (provLoopPage) ile yapılır — sarmalayıcı-sınıf kontrolü ise sahip
    // sayfasında kalabilir (yalnız DOM/CSS denetimi, gizlilik durumundan
    // bağımsız).
    const { page: provLoopPage } = await newActorPage(browser);
    await loginAs(provLoopPage, provider.email);
    for (const [key, name] of otherCategoryChecks) {
      await gotoJobAndWait(nakliyePage, jobs[key]);
      const check = await checkNoLegacyWrapper(nakliyePage, "Hizmet Konumu");
      record(
        `${name}: eski sarmalayıcı (border-l/bg-accent-soft/rounded-[10px]) tamamen kaldırılmış`,
        check.found && !check.hasLegacyBorderL && !check.hasLegacyBg && !check.hasLegacyRounded10,
        JSON.stringify(check),
      );
      await gotoJobAndWait(provLoopPage, jobs[key]);
      const lockMessageVisible = await provLoopPage.getByText("Tesis ve açık adres, teklifiniz kabul edildiğinde paylaşılır.", { exact: false }).first().isVisible().catch(() => false);
      record(`${name}: yetkili ama teklifi kabul edilmemiş Hizmet Veren için gizlilik kilit mesajı görünüyor`, lockMessageVisible);
    }

    // ============================================================
    // 12+13. Responsive: tablet + mobil, en az iki kategori
    // ============================================================
    console.log("\n=== 12-13. Responsive (tablet + mobil) ===");
    for (const viewport of [
      { name: "tablet", width: 834, height: 1112 },
      { name: "mobil", width: 390, height: 844 },
    ]) {
      const { page: rpage, errors: rerrors } = await newActorPage(browser, viewport);
      await loginAs(rpage, requester.email);
      for (const key of ["storage", "liman"]) {
        await gotoJobAndWait(rpage, jobs[key]);
        const metrics = await rpage.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        record(
          `${viewport.name}/${key}: yatay taşma yok (scrollWidth<=clientWidth)`,
          metrics.scrollWidth <= metrics.clientWidth + 1,
          JSON.stringify(metrics),
        );
        const iconTextOverlap = await rpage.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (node.textContent && node.textContent.trim() === "Hizmet Konumu") {
              const rect = node.parentElement.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.height < 100;
            }
          }
          return false;
        });
        record(`${viewport.name}/${key}: ikon/metin üst üste binmiyor (makul satır yüksekliği)`, iconTextOverlap);
      }
      if (rerrors.length > 0) record(`${viewport.name}: konsolda yeni hata yok`, false, rerrors.join(" | "));
      else record(`${viewport.name}: konsolda yeni hata yok`, true);
    }

    // ============================================================
    // 14. Gizlilik regresyonu: teklif kabulünden ÖNCE açık adres GİZLİ
    // ============================================================
    console.log("\n=== 14. Gizlilik regresyonu ===");
    const { page: provPage } = await newActorPage(browser);
    await loginAs(provPage, provider.email);
    await gotoJobAndWait(provPage, jobs.storage);
    const providerBodyText = await provPage.locator("main, body").first().innerText();
    record(
      "Yetkili ama teklifi kabul EDİLMEMİŞ Hizmet Veren: gerçek açık adres metni GÖRÜNMÜYOR",
      !providerBodyText.includes("Test Depo Açık Adresi"),
    );
    record(
      "Yetkili ama teklifi kabul EDİLMEMİŞ Hizmet Veren: kilit mesajı GÖRÜNÜYOR",
      providerBodyText.includes("Tesis ve açık adres, teklifiniz kabul edildiğinde paylaşılır."),
    );
    // İlan sahibi kendi ilanında HER ZAMAN adresi görür (canViewJobAddress'in
    // "sahip her zaman görür" istisnası) — bu da DEĞİŞMEDİ mi diye kontrol.
    await gotoJobAndWait(nakliyePage, jobs.storage);
    const ownerBodyText = await nakliyePage.locator("main, body").first().innerText();
    record("İlan sahibi (requester) kendi ilanında açık adresi GÖRÜYOR (değişmedi)", ownerBodyText.includes("Test Depo Açık Adresi"));

    // ============================================================
    // 15. Konsol hata kontrolü (ana akış boyunca)
    // ============================================================
    console.log("\n=== 15. Konsol hata kontrolü (ana sayfa) ===");
    if (nakliyeErrors.length > 0) record("Ana test sayfasında konsolda yeni hata yok", false, nakliyeErrors.join(" | "));
    else record("Ana test sayfasında konsolda yeni hata yok", true);
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
