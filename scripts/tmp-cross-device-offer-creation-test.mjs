// node scripts/tmp-cross-device-offer-creation-test.mjs
//
// "localStorage Bağımlılığını Kaldır" görevinin gerçek, uçtan uca kanıtı.
// jobs-lookup.ts#findJobByIdWithRemoteFallback + offers.ts#createOffer'daki
// düzeltmeden ÖNCE bu senaryo çalışmıyordu (bkz. tmp-general-security-
// hardening-test.mjs'in A0/A0b bloğunun kendi dokümanı — o script BİLEREK
// TEK paylaşılan bir tarayıcı context'i kullanıyordu, çünkü ayrı bir context
// job'u asla yerel olarak "göremiyordu"). Bu script BİLEREK ÜÇ TAMAMEN
// İZOLE browser context'i kullanır (requester/admin/provider) — hiçbiri
// diğerinin localStorage/cookie'sini paylaşmaz, gerçek "farklı cihaz"
// senaryosunu taklit eder.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";
// Aşama 9 SENARYO 11 yeniden-doğrulaması — "yeni admin OLUŞTURULMAYACAK"
// kısıtı gereği, bu betiğin kendi orijinal `createUser("admin","admin")`
// çağrısı yerine ÖNCEKİ görevde (aynı oturumda) zaten oluşturulmuş GERÇEK,
// MEVCUT admin hesabı yeniden kullanılıyor.
const REUSE_ADMIN_EMAIL = "malsevk-crossdev-admin-1787520260451@gmail.com";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-crossdevice-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-crossdev-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role === "admin" ? "hizmet-alan" : role,
    p_full_name: `Cross Device ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Cross Device Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  if (role === "admin") runSql(`update public.profiles set role = 'admin' where id = '${userId}';`);
  return { id: userId, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    try {
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 10000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginAs(${email}) failed after retry`);
      await page.waitForTimeout(500);
    }
  }
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function makeTestJpeg() {
  return sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "test-fixture.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg() });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function createJobViaRealForm(page, titleSuffix) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
  await page.waitForTimeout(500);

  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);

  await page.getByLabel("İlan Başlığı").first().fill(`Capraz cihaz testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu capraz cihaz testi icin gercek form uzerinden olusturulan bir ilan aciklamasidir.");

  await selectSearchable(page, "İlçe", 0, "Gebze");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill(`Test Tesisi ${titleSuffix}`);
  await page.getByLabel("Açık Adres").first().fill("Test acik adres, Gebze / Kocaeli.");

  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 });
  const match = page.url().match(/\/ilanlar\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

async function submitOfferViaRealForm(page, description) {
  await page.locator("textarea").first().fill(description);
  await page.locator('select[aria-label="Para birimi"]').selectOption("TRY").catch(() => {});
  const amountInputs = page.locator('input[inputmode="decimal"]');
  if ((await amountInputs.count()) > 0) await amountInputs.first().fill("15000");
  const submitButton = page.getByRole("button", { name: /Teklif (Gönder|Ver)/ }).first();
  await submitButton.click();
}

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Test kullanicilari olusturuluyor (izole hesaplar, admin MEVCUT olan yeniden kullanılıyor) ---");
    const requester = await createUser("req", "hizmet-alan");
    const admin = { email: REUSE_ADMIN_EMAIL };
    const provider = await createUser("prov", "hizmet-veren");
    console.log(`requester=${requester.email} admin (MEVCUT, yeniden kullanılıyor)=${admin.email} provider=${provider.email}`);

    // Provider'i forklift icin GERCEKTEN yetkilendir (admin onayini simule
    // eder - ayni RPC'nin uretecegi satirla ayni sekilde).
    runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provider.id}', 'forklift', now()) on conflict do nothing;`);

    // ================= CONTEXT 1: Hizmet Alan (kendi "cihazi") =================
    const ctxRequester = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pageRequester = await ctxRequester.newPage();
    await loginAs(pageRequester, requester.email);
    const jobId = await createJobViaRealForm(pageRequester, "X1");
    record("1) İlan GERÇEK formla, Hizmet Alan'ın kendi izole context'inde oluşturuldu", Boolean(jobId), jobId);
    await ctxRequester.close();

    // ================= CONTEXT 2: Admin (TAMAMEN AYRI, hiç ilişkisi olmayan "cihaz") =================
    const ctxAdmin = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pageAdmin = await ctxAdmin.newPage();
    await loginAs(pageAdmin, admin.email);
    await pageAdmin.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
    const onaylaButton = pageAdmin.getByRole("button", { name: /^Onayla/ });
    // Sabit uyku yerine GERÇEK görünürlüğü/sonucu bekle — Development ortamı
    // bu oturum boyunca biriken çok sayıda eski test kaydı taşıyor (temizlik
    // bu görevin SON aşamasında yapılacak).
    let onaylaVisible = false;
    try {
      await onaylaButton.waitFor({ state: "visible", timeout: 20000 });
      onaylaVisible = true;
      await onaylaButton.click();
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
        if (row?.moderation_status === "approved") break;
        await pageAdmin.waitForTimeout(1000);
      }
    } catch {
      onaylaVisible = false;
    }
    const moderationRow = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
    record(
      "2) Admin, İZOLE bir context'te (Hizmet Alan'ın ilanını hiç 'görmemiş' bir tarayıcıda) ilanı bulup onaylayabildi",
      moderationRow?.moderation_status === "approved",
      `onayla_butonu_gorundu=${onaylaVisible}, moderation_status=${moderationRow?.moderation_status}`,
    );
    await ctxAdmin.close();

    // ================= CONTEXT 3: Hizmet Veren — GENUINELY yeni/temiz "cihaz" =================
    // Bu context ne requester'ın ne admin'in localStorage'ını görüyor — bu
    // ilana dair YEREL sıfır bilgiyle başlıyor. DOĞRUDAN ilan detay
    // sayfasına gidiliyor (listeden tıklanmıyor) — TEST 3'ün de kapsamı.
    const beforeCount = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}' and job_id = '${jobId}';`)[0].c;
    const ctxProvider = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pageProvider = await ctxProvider.newPage();
    await loginAs(pageProvider, provider.email);

    // localStorage'da bu job'a dair GERÇEKTEN hiçbir şey olmadığını kanıtla.
    const localJobBefore = await pageProvider.evaluate(() => {
      try {
        const raw = localStorage.getItem("malsevk.jobs.v1") || localStorage.getItem("malsevk_user_created_jobs");
        return raw ?? null;
      } catch {
        return null;
      }
    });

    await pageProvider.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await pageProvider.waitForTimeout(1200);
    const notFoundText = await pageProvider.getByText("İlan bulunamadı", { exact: false }).count();
    record(
      "3) Doğrudan ilan detay URL'sine GENUINELY temiz/izole tarayıcıdan gidildiğinde ilan GERÇEKTEN yükleniyor ('İlan bulunamadı' YOK)",
      notFoundText === 0,
      `localJobBefore=${localJobBefore ? "vardı (BEKLENMİYORDU)" : "yoktu (beklenen)"}, not_found_gorundu=${notFoundText > 0}`,
    );

    await submitOfferViaRealForm(pageProvider, "Bu capraz cihaz testi icin gercek bir teklif aciklamasi yaziyorum simdi burada.");
    await pageProvider.waitForTimeout(2000);

    const afterCount = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}' and job_id = '${jobId}';`)[0].c;
    record("4) TEST 1 — Farklı cihaz: gerçek teklif public.offers'a GERÇEKTEN yazıldı", afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`);

    const offerRow = runSql(`select id, job_id, provider_id, status from public.offers where job_id = '${jobId}' and provider_id = '${provider.id}' order by created_at desc limit 1;`)[0];
    record("5) Yazılan teklif kaydı doğru job_id/provider_id/status taşıyor", offerRow?.status === "pending", JSON.stringify(offerRow));

    // ================= TEST 2 — Temiz oturum: localStorage'ı GERÇEKTEN temizleyip tekrar dene =================
    const jobId2Requester = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page2 = await jobId2Requester.newPage();
    await loginAs(page2, requester.email);
    const jobId2 = await createJobViaRealForm(page2, "X2");
    await jobId2Requester.close();

    const ctxAdmin2 = await browser.newContext();
    const pageAdmin2 = await ctxAdmin2.newPage();
    await loginAs(pageAdmin2, admin.email);
    await pageAdmin2.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId2}`);
    const onaylaButton2 = pageAdmin2.getByRole("button", { name: /^Onayla/ });
    try {
      await onaylaButton2.waitFor({ state: "visible", timeout: 20000 });
      await onaylaButton2.click();
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const row = runSql(`select moderation_status from public.jobs where id = '${jobId2}';`)[0];
        if (row?.moderation_status === "approved") break;
        await pageAdmin2.waitForTimeout(1000);
      }
    } catch {
      // Onayla butonu görünmedi — aşağıdaki assertion bunu zaten yansıtacak.
    }
    await ctxAdmin2.close();

    // Aynı provider context'inde (Context 3), localStorage'ı GERÇEKTEN temizle.
    await pageProvider.evaluate(() => localStorage.clear());
    await pageProvider.reload();
    await pageProvider.waitForTimeout(500);
    // Oturum Supabase Auth cookie'siyle korunuyor (localStorage'a bağlı
    // DEĞİL), bu yüzden reload sonrası hâlâ giriş yapılmış olmalı.
    const stillLoggedIn = !pageProvider.url().includes("/giris-yap");

    const beforeCount2 = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}' and job_id = '${jobId2}';`)[0].c;
    await pageProvider.goto(`${APP_ORIGIN}/ilanlar/${jobId2}`);
    await pageProvider.waitForTimeout(1200);
    await submitOfferViaRealForm(pageProvider, "localStorage temizlendikten sonra gercek bir teklif aciklamasi yaziyorum simdi burada.");
    await pageProvider.waitForTimeout(2000);
    const afterCount2 = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}' and job_id = '${jobId2}';`)[0].c;
    record(
      "6) TEST 2 — localStorage GERÇEKTEN temizlendikten sonra teklif yine oluşturulabiliyor",
      stillLoggedIn && afterCount2 === beforeCount2 + 1,
      `stillLoggedIn=${stillLoggedIn}, ${beforeCount2} -> ${afterCount2}`,
    );

    // ================= TEST 8 — var olmayan ilan =================
    await pageProvider.goto(`${APP_ORIGIN}/ilanlar/${randomUUID()}`);
    await pageProvider.waitForTimeout(1000);
    const pageContentForMissing = await pageProvider.content();
    const looksLikeMissing = /bulunamadı|kaldırılmış|mevcut değil/i.test(pageContentForMissing);
    record("7) TEST 8 — Var olmayan ilan kimliği güvenli/anlaşılır şekilde ele alınıyor", looksLikeMissing, looksLikeMissing ? "beklenen mesaj görüldü" : "beklenmeyen sayfa içeriği");

    await ctxProvider.close();

    // ================= TEST 9 — Regresyon: Hizmet Alan kendi ekranında teklifi görebiliyor mu =================
    const ctxRequesterCheck = await browser.newContext();
    const pageRequesterCheck = await ctxRequesterCheck.newPage();
    await loginAs(pageRequesterCheck, requester.email);
    await pageRequesterCheck.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    // Sabit uyku yerine GERÇEK sonucu bekle — Development ortamı bu oturum
    // boyunca biriken çok sayıda eski test kaydı taşıyor (temizlik bu görevin
    // SON aşamasında yapılacak), useAllJobs()/useAllOffers()'ın uzak getirme
    // round-trip'i sabit 1500ms'den daha uzun sürebilir.
    let offerVisibleToRequester = false;
    try {
      await pageRequesterCheck.getByText(/15\.000|15000/).first().waitFor({ state: "visible", timeout: 20000 });
      offerVisibleToRequester = true;
    } catch {
      offerVisibleToRequester =
        (await pageRequesterCheck.getByText("Capraz cihaz testi", { exact: false }).count()) > 0;
    }
    record("8) TEST 9 — Regresyon: teklif, ilan sahibinin 'Gelen Teklifler' ekranında görünüyor", offerVisibleToRequester);
    await ctxRequesterCheck.close();

    // ================= TEST 4/6/7 — yetkisiz kategori / onaysız ilan / mükerrer teklif hâlâ engelli mi =================
    const unauthorizedJobId = randomUUID();
    const workDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${unauthorizedJobId}', '${requester.id}', 'kimyasal-depolama', 'Yetkisiz kategori test ilani', 'Bu test icin olusturulan bir ilan aciklamasidir yeterli uzunlukta gercekten.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${workDate}', 'approved');`,
    );
    const providerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await providerClient.auth.signInWithPassword({ email: provider.email, password: PASSWORD });
    const { error: unauthorizedOfferError } = await providerClient.rpc("create_offer", {
      p_job_id: unauthorizedJobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Bu bir test teklif aciklamasidir yeterli uzunlukta gercekten burada.",
    });
    record("9) TEST 4 — Yetkisiz kategoriye (Kimyasal Depolama) GERÇEK RPC ile teklif hâlâ reddediliyor", !!unauthorizedOfferError, unauthorizedOfferError?.message);

    const unapprovedJobId = randomUUID();
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${unapprovedJobId}', '${requester.id}', 'forklift', 'Onaysiz test ilani', 'Bu test icin olusturulan bir ilan aciklamasidir yeterli uzunlukta gercekten.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${workDate}', 'pending_review');`,
    );
    const { error: unapprovedOfferError } = await providerClient.rpc("create_offer", {
      p_job_id: unapprovedJobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Bu bir test teklif aciklamasidir yeterli uzunlukta gercekten burada.",
    });
    record("10) TEST 6 — Admin onayı olmayan ilana GERÇEK RPC ile teklif hâlâ reddediliyor", !!unapprovedOfferError, unapprovedOfferError?.message);

    const { error: duplicateOfferError } = await providerClient.rpc("create_offer", {
      p_job_id: jobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Bu ikinci bir teklif aciklamasidir yeterli uzunlukta gercekten burada da.",
    });
    record("11) TEST 13 — Aynı ilana mükerrer teklif GERÇEK RPC ile hâlâ reddediliyor", !!duplicateOfferError, duplicateOfferError?.message);

    console.log("");
    console.log(`=== SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
    if (results.some((r) => !r.pass)) {
      console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
