// Development Supabase projesine VE gerçek dev sunucusuna (localhost:3000)
// karşı — Nakliye ilan detay sayfasındaki rota görünümü YENİDEN TASARIMININ
// (service-location-panel.tsx) gerçek kullanıcı doğrulaması:
//   1) Teklifi kabul edilmemiş Hizmet Veren yalnız İl/İlçe + kilit mesajı görür.
//   2) Teklifi kabul edilen Hizmet Veren tesis/adresi (değişmeden) görür.
//   3) İlan sahibi HER ZAMAN tam detayı görür.
//   4) Admin HER ZAMAN tam detayı görür.
//   5) Görsel: dış kart izi (border/rounded/background) YOK, pin->kesikli
//      çizgi->yeşil ok->kesikli çizgi->bayrak yapısı DOM'da var.
//   6) En az 2 farklı (Nakliye DIŞI) GERÇEK ilanın konum paneli DEĞİŞMEDİ
//      (hâlâ eski kart izini taşıyor).
// Kurulum (hesap/ilan/teklif) RPC ile yapılır — asıl doğrulama gerçek
// Chromium ile DOM/computed style okunarak yapılır.
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

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY .env.local'da olmalı.");
  process.exit(1);
}

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 300) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
let createdJobId = null;
let createdOfferId = null;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(15);

function fakePhotos(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    storage_path: `nakltest/${stamp}/${index}.jpg`,
    original_file_name: `test-${index}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 12345,
    width: null,
    height: null,
  }));
}

async function createUser(label, role) {
  const email = `naklroutetest-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `NaklRouteTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `NaklRouteTest Firma ${label}`,
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

async function newActorPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("requestfailed", (req) => console.error("REQUEST FAILED:", req.url(), req.failure()?.errorText));
  page.on("response", (res) => {
    if (res.status() >= 400) console.error("HTTP ERROR:", res.status(), res.url());
  });
  return { context, page };
}

/** İlan detayına gidip başlık görünene kadar bekler (async veri çekme gecikmesi için) — bir kez de yeniden yükleyerek dener (geçici bir fetch gecikmesi/yarışını ayırt etmek için). */
async function gotoJobDetailAndWait(page, jobId, expectedText) {
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  let ok = await page
    .waitForFunction((t) => document.body.innerText.includes(t), expectedText, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.error(`DEBUG — "${expectedText}" 30s içinde görünmedi, sayfa yeniden yükleniyor ve tekrar deneniyor...`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    ok = await page
      .waitForFunction((t) => document.body.innerText.includes(t), expectedText, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      const bodyText = await page.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — yeniden yükleme sonrası da görünmedi. Sayfa metni (ilk 400):", bodyText.slice(0, 400));
    }
  }
  await page.waitForTimeout(500);
}

/** service-location-panel.tsx'in Nakliye dalının render ettiği DOM yapısını canlı olarak inceler. */
async function inspectRoutePanel(page) {
  return page.evaluate(() => {
    // NOT: etiket DOM'da "Yükleme Noktası" (karışık büyük/küçük) olarak durur —
    // görünen BÜYÜK HARF hâli yalnızca CSS `uppercase` sınıfının görsel
    // dönüşümüdür, textContent'i DEĞİŞTİRMEZ. Bu yüzden küçük harfe çevirip
    // karşılaştırıyoruz (innerText DEĞİL, textContent — CSS transform'dan
    // etkilenmeyen ham DOM metnini istiyoruz).
    const yukleme = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent?.trim().toLowerCase() === "yükleme noktası",
    );
    if (!yukleme) return { found: false };
    // Panelin dış çerçevesi: YÜKLEME NOKTASI etiketinin en yakın "rota kapsayıcısı" atası —
    // pin ikonunu İÇEREN satırın bir üst seviyesi (flex flex-col ya da eski border'lı kutu).
    const label = yukleme;
    const pointRow = label.closest("div")?.parentElement; // <div class="flex items-start gap-2.5">
    const outer = pointRow?.parentElement; // eski: border'lı kutu; yeni: sade flex-col
    const outerStyle = outer ? getComputedStyle(outer) : null;
    const dashedSegments = outer ? outer.querySelectorAll('span[class*="border-dashed"]').length : 0;
    const svgIcons = outer ? Array.from(outer.querySelectorAll("svg")) : [];
    const arrowSvg = svgIcons.find((svg) => svg.getAttribute("class")?.includes("text-success"));
    const arrowComputedColor = arrowSvg ? getComputedStyle(arrowSvg).color : null;
    return {
      found: true,
      outerClassName: outer?.getAttribute("class") ?? null,
      outerBorderWidth: outerStyle?.borderWidth ?? null,
      outerBorderRadius: outerStyle?.borderRadius ?? null,
      outerBoxShadow: outerStyle?.boxShadow ?? null,
      outerBackgroundColor: outerStyle?.backgroundColor ?? null,
      dashedSegmentCount: dashedSegments,
      hasGreenArrow: Boolean(arrowSvg),
      arrowComputedColor,
      outerHtmlSnippet: outer?.outerHTML.slice(0, 1200) ?? null,
    };
  });
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  const promoteRows = runSql(
    `update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}' returning id, role;`,
  );
  record("Kurulum: 3 test hesabı oluşturuldu, biri admin'e yükseltildi", promoteRows[0]?.role === "admin", JSON.stringify(promoteRows));

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });
  const { error: authError } = await adminClient.rpc("authorize_provider_service", {
    p_provider_id: provider.id,
    p_service_category_id: "nakliye",
    p_reason: "NaklRouteTest otomasyonu",
  });
  record("Kurulum: Hizmet Veren, Nakliye için yetkilendirildi", !authError, authError?.message);

  // ---------------------------------------------------------------------
  // Gerçek bir Nakliye ilanı — RPC ile (bu görev yalnızca DETAY sayfasını
  // hedeflediği için, oluşturma formunu tekrar sürmeye gerek yok).
  // ---------------------------------------------------------------------
  const { data: job, error: jobError } = await requester.client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "NaklRouteTest — Gebze-Kartal Nakliye",
    p_description: "Rota görünümü testi için otomasyonla oluşturulan ilan.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Yükleme Tesisi",
    p_work_date: WORK_DATE,
    p_photos: fakePhotos(),
    p_address_text: "Test Yükleme Açık Adresi, Gebze",
    p_delivery_province: "İstanbul",
    p_delivery_district: "Kartal",
    p_delivery_location_type: "open_address",
    p_delivery_facility_name: "Test Teslim Tesisi",
    p_delivery_address_text: "Test Teslim Açık Adresi, Kartal",
  });
  record("Kurulum: Nakliye ilanı create_job ile oluşturuldu", !jobError, jobError?.message);
  createdJobId = job?.id;

  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: createdJobId });
  record("Kurulum: Admin ilanı onayladı", !approveError, approveError?.message);

  const browser = await chromium.launch();
  try {
    await runVerification(browser, { requester, provider, adminUser, adminClient });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runVerification(browser, { requester, provider, adminUser, adminClient }) {
  const tmp = os.tmpdir();

  // =========================================================================
  // 1) Teklifi kabul edilmemiş Hizmet Veren — yalnız İl/İlçe + kilit mesajı.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, provider.email, PASSWORD);
    await gotoJobDetailAndWait(page, createdJobId, "NaklRouteTest");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    record("1a. Teklifsiz Hizmet Veren: 'YÜKLEME NOKTASI' görünüyor", bodyText.includes("YÜKLEME NOKTASI"));
    record("1b. Teklifsiz Hizmet Veren: 'TESLİM NOKTASI' görünüyor", bodyText.includes("TESLİM NOKTASI"));
    record("1c. Teklifsiz Hizmet Veren: Yükleme İlçe/İl (Gebze / Kocaeli) görünüyor", /Gebze\s*\/\s*Kocaeli/.test(bodyText));
    record("1d. Teklifsiz Hizmet Veren: Teslim İlçe/İl (Kartal / İstanbul) görünüyor", /Kartal\s*\/\s*İstanbul/.test(bodyText));
    record(
      "1e. Teklifsiz Hizmet Veren: gizlilik mesajı görünüyor, tesis/adres GİZLİ",
      bodyText.includes("Tesis ve açık adres, teklifiniz kabul edildiğinde paylaşılır.") &&
        !bodyText.includes("Test Yükleme Tesisi") &&
        !bodyText.includes("Test Yükleme Açık Adresi") &&
        !bodyText.includes("Test Teslim Tesisi") &&
        !bodyText.includes("Test Teslim Açık Adresi"),
    );

    const panel = await inspectRoutePanel(page);
    record("1f. Panel DOM'da bulundu", panel.found);
    record(
      "1g. Dış çerçevede kart izi YOK (border yok/0px, radius yok/0px, gölge yok, farklı arka plan yok)",
      panel.found &&
        (!panel.outerBorderWidth || panel.outerBorderWidth === "0px") &&
        (!panel.outerBorderRadius || panel.outerBorderRadius === "0px") &&
        (panel.outerBoxShadow === "none" || !panel.outerBoxShadow) &&
        !panel.outerClassName?.includes("border") &&
        !panel.outerClassName?.includes("rounded") &&
        !panel.outerClassName?.includes("bg-accent-soft"),
      JSON.stringify({ cls: panel.outerClassName, bw: panel.outerBorderWidth, br: panel.outerBorderRadius, shadow: panel.outerBoxShadow }),
    );
    record("1h. İki kesikli çizgi segmenti (pin->ok, ok->bayrak) DOM'da var", panel.dashedSegmentCount === 2, panel.dashedSegmentCount);
    record("1i. Yeşil (text-success) aşağı ok ikonu var", panel.hasGreenArrow, panel.arrowComputedColor);

    await page.screenshot({ path: path.join(tmp, "nakliye-route-unauthorized.png"), fullPage: true }).catch(() => {});

    // 1366x768 masaüstü görünümde taşma kontrolü.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    record("6a. 1366x768'de yatay taşma YOK", !desktopOverflow);
    await page.screenshot({ path: path.join(tmp, "nakliye-route-desktop-1366.png"), fullPage: false }).catch(() => {});

    // Mobil görünüm.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    record("6b. Mobil (390px) görünümde yatay taşma YOK", !mobileOverflow);
    const mobilePanel = await inspectRoutePanel(page);
    record("6c. Mobilde de kesikli çizgi + ok yapısı korunuyor", mobilePanel.dashedSegmentCount === 2 && mobilePanel.hasGreenArrow);
    await page.screenshot({ path: path.join(tmp, "nakliye-route-mobile.png"), fullPage: true }).catch(() => {});

    await context.close();
  }

  // =========================================================================
  // 2) Teklif ver, ilan sahibi kabul etsin, artık kabul edilmiş Hizmet Veren
  //    olarak tekrar bak — tesis/adres artık GÖRÜNMELİ (davranış BOZULMADI).
  // =========================================================================
  const { data: offer, error: offerError } = await provider.client.rpc("create_offer", {
    p_job_id: createdJobId,
    p_amount: 18500,
    p_currency: "TRY",
    p_description: "Bu nakliyeyi 18.500 TL'ye gerçekleştiririm, aracımız müsait.",
    // MLK66: Nakliye ilanlarında zorunlu ("Tamamlanması Taahhüt Edilen Gün").
    p_estimated_duration: 3,
  });
  record("2a. Hizmet Veren teklif verdi", !offerError, offerError?.message);
  createdOfferId = offer?.id;

  let acceptError = null;
  if (createdOfferId) {
    ({ error: acceptError } = await requester.client.rpc("accept_offer", { p_offer_id: createdOfferId }));
  } else {
    acceptError = { message: "createdOfferId yok (2a başarısız oldu), accept_offer çağrılmadı" };
  }
  record("2b. İlan sahibi teklifi kabul etti", !acceptError, acceptError?.message);

  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, provider.email, PASSWORD);
    await gotoJobDetailAndWait(page, createdJobId, "NaklRouteTest");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    record(
      "2c. Kabul edilen Hizmet Veren artık tesis/adresi GÖRÜYOR (davranış bozulmadı)",
      bodyText.includes("Test Yükleme Tesisi") &&
        bodyText.includes("Test Yükleme Açık Adresi") &&
        bodyText.includes("Test Teslim Tesisi") &&
        bodyText.includes("Test Teslim Açık Adresi") &&
        !bodyText.includes("Tesis ve açık adres, teklifiniz kabul edildiğinde paylaşılır."),
    );
    const panel = await inspectRoutePanel(page);
    record(
      "2d. Kabul edilen Hizmet Veren görünümünde de kart izi YOK, kesikli çizgi+ok yapısı AYNI",
      panel.found && panel.dashedSegmentCount === 2 && panel.hasGreenArrow && !panel.outerClassName?.includes("border"),
      JSON.stringify(panel.outerClassName),
    );
    await page.screenshot({ path: path.join(tmp, "nakliye-route-accepted-provider.png"), fullPage: true }).catch(() => {});
    await context.close();
  }

  // =========================================================================
  // 3) İlan sahibi — HER ZAMAN tam detay.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, requester.email, PASSWORD);
    await gotoJobDetailAndWait(page, createdJobId, "NaklRouteTest");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    record(
      "3a. İlan sahibi tam tesis/adres detayını görüyor",
      bodyText.includes("Test Yükleme Tesisi") && bodyText.includes("Test Teslim Tesisi"),
    );
    const panel = await inspectRoutePanel(page);
    record("3b. İlan sahibi görünümünde de kart izi YOK", panel.found && !panel.outerClassName?.includes("border"));
    await context.close();
  }

  // =========================================================================
  // 4) Admin — HER ZAMAN tam detay.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, adminUser.email, PASSWORD);
    await gotoJobDetailAndWait(page, createdJobId, "NaklRouteTest");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    record(
      "4a. Admin tam tesis/adres detayını görüyor",
      bodyText.includes("Test Yükleme Tesisi") && bodyText.includes("Test Teslim Tesisi"),
    );
    await context.close();
  }

  // =========================================================================
  // 7) Nakliye DIŞI en az 2 GERÇEK ilan — konum paneli DEĞİŞMEMİŞ olmalı.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, adminUser.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    const rows = await page.locator('a[href^="/admin/ilanlar/"]').all();
    const ids = [];
    for (const row of rows) {
      const href = await row.getAttribute("href");
      const id = href?.replace("/admin/ilanlar/", "");
      if (id && id !== createdJobId) ids.push(id);
      if (ids.length >= 8) break;
    }
    record("7a. Nakliye dışı adaylar için admin ilan listesinden id toplandı", ids.length > 0, ids.length);

    let checkedNonNakliye = 0;
    for (const id of ids) {
      if (checkedNonNakliye >= 2) break;
      await page.goto(`${APP_ORIGIN}/admin/ilanlar/${id}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const categoryText = await page.locator("body").innerText().catch(() => "");
      if (categoryText.includes("Nakliye")) continue; // yalnızca Nakliye DIŞI ilanları say.
      // Admin ilan DETAY sayfası bu paneli göstermiyor (bkz. admin-job-detail.tsx,
      // ayrı bir görüntüleme yolu) — bu yüzden GERÇEK Hizmet Veren/sahip
      // görünümünü, halka açık /ilanlar/[id] sayfası üzerinden kontrol ederiz.
      await page.goto(`${APP_ORIGIN}/ilanlar/${id}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const panel = await inspectRoutePanel(page);
      if (!panel.found) continue;
      checkedNonNakliye++;
      record(
        `7b.${checkedNonNakliye}. Nakliye DIŞI gerçek ilan (${id}) konum paneli DEĞİŞMEMİŞ (hâlâ kart izi var)`,
        Boolean(panel.outerClassName?.includes("border") && panel.outerClassName?.includes("rounded")),
        panel.outerClassName,
      );
    }
    record("7c. En az 2 Nakliye-dışı gerçek ilan kontrol edildi", checkedNonNakliye >= 2, checkedNonNakliye);
    await context.close();
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      if (createdJobId) {
        runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${createdJobId}');`);
        runSql(`delete from public.offers where job_id = '${createdJobId}';`);
        runSql(`delete from public.job_photos where job_id = '${createdJobId}';`);
        runSql(`delete from public.job_activity_events where job_id = '${createdJobId}';`);
        runSql(`delete from public.jobs where id = '${createdJobId}';`);
      }
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    } catch (error) {
      console.error("cleanup sql failed (continuing):", error?.message || error);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
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
