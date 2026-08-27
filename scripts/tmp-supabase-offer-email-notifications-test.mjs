// node scripts/tmp-supabase-offer-email-notifications-test.mjs
//
// "Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-posta bildirimlerinin
// GERÇEK UI üzerinden (offers.ts'e gömülü tetikleyiciler, manuel çağrı
// DEĞİL) uçtan uca doğrulanması: gerçek hesaplar, gerçek ilan/teklif/kabul,
// gerçek /api/offer-notifications route'u, gerçek email_deliveries
// idempotency kaydı. RESEND_API_KEY bu ortamda TANIMLI DEĞİLSE (bkz.
// .env.local) gerçek Resend gönderimi hiç denenmez — bu beklenen ve
// TASARLANMIŞ bir davranıştır (route "resend_not_configured" ile başarısız
// olur, delivery kaydı 'failed' olur, teklif/kabul işleminin kendisi ETKİLENMEZ).
// Bu script bu durumda "e-posta gönderildi" DEMEZ — yalnızca mimarinin
// (idempotency, yetkilendirme, hata dayanıklılığı) doğru çalıştığını kanıtlar.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";
const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const uniqueTag = stamp.toString(36);
const createdUserIds = [];
const uploadedStoragePaths = [];

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` -- ${extra}` : ""));
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

async function runSql(sql) {
  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const sqlPath = path.join(tmpdir(), `email-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(sqlPath, sql);
  const out = execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" }).toString();
  return JSON.parse(out).rows ?? [];
}

async function makeRealAccount(label, role) {
  const email = `malsevk-emailtest-${label}-${stamp}@gmail.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  createdUserIds.push(created.data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  const reg = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Test ${label}`, p_phone: "+905551239900",
    p_company_name: `Test ${label} Firma`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (reg.error) throw new Error(`${label} complete_registration: ${reg.error.message}`);
  return { email, id: created.data.user.id };
}

async function loginAs(page, email, redirect = "/panel") {
  await page.goto(`${APP_ORIGIN}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${APP_ORIGIN}${redirect}`, { timeout: 15000 });
  await page.getByRole("banner").getByText(/Hizmet Alan|Hizmet Veren/).waitFor({ state: "visible", timeout: 15000 });
}

async function uploadOnePhoto(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

async function approveJobInLocalStorage(page, jobId) {
  return page.evaluate((id) => {
    const KEY = "malsevk.jobs.v1";
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const jobs = JSON.parse(raw);
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    jobs[idx].moderationStatus = "approved";
    window.localStorage.setItem(KEY, JSON.stringify(jobs));
    return true;
  }, jobId);
}

async function approveJobInSupabase(jobId) {
  const rows = await runSql(
    `update public.jobs set moderation_status = 'approved' where id = '${jobId}';` +
      `select moderation_status from public.jobs where id = '${jobId}';`,
  );
  return rows.some((r) => r.moderation_status === "approved");
}

async function authorizeProviderForCategory(providerId, categoryId) {
  await runSql(
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorize_reason) values ('${providerId}', '${categoryId}', 'e2e e-posta testi kurulumu');`,
  );
}

/** Sayfanın KENDİ oturum çerezleriyle (Playwright fetch DEĞİL) route'u çağırır — gerçek tarayıcı fetch'i. */
async function callNotifyRouteAsPage(page, offerId, event) {
  return page.evaluate(
    async ({ offerId, event }) => {
      const res = await fetch("/api/offer-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, event }),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    { offerId, event },
  );
}

let jobId = null;
let supabaseOfferId = null;

async function main() {
  console.log("=== Kurulum: requester + provider + ilgisiz üçüncü hesap ===");
  const requester = await makeRealAccount("req", "hizmet-alan");
  const provider = await makeRealAccount("prov", "hizmet-veren");
  const outsider = await makeRealAccount("outsider", "hizmet-veren");
  check("setup: 3 gerçek hesap oluşturuldu", !!requester.id && !!provider.id && !!outsider.id);
  await authorizeProviderForCategory(provider.id, "forklift");
  check("setup: provider 'forklift' için yetkilendirildi", true);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();

    console.log("\n=== 1) Requester GERÇEK UI ile bir Forklift ilanı oluşturuyor ===");
    const jobTitle = `E2E Eposta Testi ${uniqueTag}`;
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Forklift" });
    await page.getByLabel("İlan Başlığı").fill(jobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("E-posta bildirimi uçtan uca testi için oluşturuldu.");
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await selectFromSearchable(page, "Liman / Sanayi / OSB", "Listede yok", { exact: false });
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Forklift Sahası");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No 1, Gebze");
    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-10");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-11");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    const reachedPreview = await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    check("1a. Operasyon Önizlemesine ulaşıldı", reachedPreview);
    if (!reachedPreview) throw new Error("Form doğrulanamadı.");
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    jobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("1b. İlan oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()));

    await approveJobInLocalStorage(page, jobId);
    await page.waitForTimeout(2500);
    const approved = await approveJobInSupabase(jobId);
    check("1c. İlan (yerel + Supabase) moderasyon onayı aldı", approved);

    console.log("\n=== 2) Provider AYNI ilana GERÇEK UI'dan teklif veriyor (createOffer -> otomatik e-posta tetikleyici) ===");
    await loginAs(page, provider.email);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.getByLabel("Teklif Tutarı").fill("7500");
    await page.getByLabel("Teklif Açıklaması").fill("E-posta bildirimi testi için oluşturulan gerçek teklif, en az yirmi karakter.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    const offerSubmitted = await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    check("2a. Teklif GERÇEK UI'dan başarıyla gönderildi (offers.ts'in otomatik e-posta tetikleyicisi bu adımda ZATEN çalıştı)", offerSubmitted);
    if (!offerSubmitted) throw new Error("Teklif gönderilemedi.");

    // Supabase'deki gerçek offer id'sini bul (email_deliveries.offer_id ile eşleşen).
    const offerRows = await runSql(`select id from public.offers where job_id = '${jobId}' and provider_id = '${provider.id}' order by created_at desc limit 1;`);
    supabaseOfferId = offerRows[0]?.id ?? null;
    check("2b. Teklif GERÇEKTEN public.offers'ta oluştu", !!supabaseOfferId, supabaseOfferId);

    console.log("\n=== 3) 'new_offer' e-posta delivery kaydı gerçekten oluştu mu (otomatik tetikleyici) ===");
    const delivery1 = await runSql(`select id, status, attempt_count, recipient_user_id, actor_user_id, error_message from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("3a. email_deliveries'ta TAM OLARAK 1 kayıt var (yeni_teklif)", delivery1.length === 1, JSON.stringify(delivery1.map((d) => d.status)));
    check("3b. Kayıt gerçekten job sahibine (requester) hedefleniyor", delivery1[0]?.recipient_user_id === requester.id);
    check("3c. Kayıt gerçekten teklifi veren (provider) tarafından tetiklenmiş", delivery1[0]?.actor_user_id === provider.id);
    const resendConfigured = !(delivery1[0]?.status === "failed" && (delivery1[0]?.error_message ?? "").includes("RESEND_API_KEY"));
    if (!resendConfigured) {
      console.log("BİLGİ: RESEND_API_KEY tanımlı değil -> delivery 'failed', gerçek gönderim denenmedi (beklenen/tasarlanan davranış).");
    } else {
      check("3d. Delivery durumu 'sent' (RESEND_API_KEY tanımlıydı)", delivery1[0]?.status === "sent", delivery1[0]?.status);
    }

    console.log("\n=== 4) Aynı olay tekrar tetiklenirse mükerrer kayıt OLUŞMUYOR mu (retry güvenliği) ===");
    const beforeAttempt = delivery1[0]?.attempt_count ?? 0;
    const retryResult = await callNotifyRouteAsPage(page, supabaseOfferId, "new_offer");
    const delivery1b = await runSql(`select id, status, attempt_count from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("4a. Retry sonrası HÂLÂ tam olarak 1 kayıt var (mükerrer satır yok)", delivery1b.length === 1, JSON.stringify(delivery1b));
    if (!resendConfigured) {
      // RESEND_API_KEY tanımsız olduğu sürece retry de GERÇEKTEN 503
      // "resend_not_configured" dönmelidir (sahte bir 200/başarı DEĞİL) —
      // route'un kendi tasarımı gereği (bkz. route.ts). Bu FAIL bir önceki
      // koşuda test script'inin kendi YANLIŞ varsayımıydı (2xx bekliyordu),
      // gerçek bir app hatası DEĞİLDİ.
      check("4b. Retry, RESEND_API_KEY eksikken GERÇEKTEN 503/resend_not_configured döndü (sahte başarı YOK)", retryResult.status === 503 && retryResult.body?.reason === "resend_not_configured", JSON.stringify(retryResult));
      check("4c. Retry, 'failed' kaydı yeniden denedi (attempt_count arttı)", (delivery1b[0]?.attempt_count ?? 0) > beforeAttempt, `${beforeAttempt} -> ${delivery1b[0]?.attempt_count}`);
    } else {
      check("4b. Retry route'u 2xx döndü (idempotent, hata fırlatmadı)", retryResult.status === 200, JSON.stringify(retryResult));
      check("4c. Retry, zaten 'sent' olduğu için no-op oldu (alreadyProcessed)", retryResult.body?.alreadyProcessed === true, JSON.stringify(retryResult.body));
    }

    console.log("\n=== 5) Yetkisiz kullanıcı (ilana/teklife hiç dahil olmayan üçüncü hesap) e-posta TETİKLEYEMİYOR mu ===");
    const outsiderPage = await context.newPage();
    await loginAs(outsiderPage, outsider.email);
    const beforeOutsider = await runSql(`select attempt_count, status from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    const outsiderResult = await callNotifyRouteAsPage(outsiderPage, supabaseOfferId, "new_offer");
    const afterOutsider = await runSql(`select attempt_count, status from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("5a. Yetkisiz çağrı 2xx DEĞİL (reddedildi)", outsiderResult.status !== 200, JSON.stringify(outsiderResult));
    check("5b. Yetkisiz çağrı mevcut delivery kaydını HİÇ değiştirmedi", JSON.stringify(beforeOutsider) === JSON.stringify(afterOutsider), `${JSON.stringify(beforeOutsider)} vs ${JSON.stringify(afterOutsider)}`);
    await outsiderPage.close();

    console.log("\n=== 6) Requester teklifi kabul ediyor (updateOfferStatus -> otomatik 'kabul edildi' e-posta tetikleyicisi) ===");
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(1500);

    const offerAfterAccept = await runSql(`select status from public.offers where id = '${supabaseOfferId}';`);
    check("6a. Teklif GERÇEKTEN Supabase'de 'accepted' oldu", offerAfterAccept[0]?.status === "accepted", offerAfterAccept[0]?.status);

    console.log("\n=== 7) 'offer_accepted' e-posta delivery kaydı gerçekten oluştu mu (otomatik tetikleyici) ===");
    const delivery2 = await runSql(`select id, status, attempt_count, recipient_user_id, actor_user_id, error_message from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'offer_accepted';`);
    check("7a. email_deliveries'ta TAM OLARAK 1 kayıt var (teklif_kabul_edildi)", delivery2.length === 1, JSON.stringify(delivery2.map((d) => d.status)));
    check("7b. Kayıt gerçekten teklifi veren (provider) hedefleniyor", delivery2[0]?.recipient_user_id === provider.id);
    check("7c. Kayıt gerçekten kabul eden (requester) tarafından tetiklenmiş", delivery2[0]?.actor_user_id === requester.id);
    const resendConfigured2 = !(delivery2[0]?.status === "failed" && (delivery2[0]?.error_message ?? "").includes("RESEND_API_KEY"));
    if (!resendConfigured2) {
      console.log("BİLGİ: RESEND_API_KEY tanımlı değil -> delivery 'failed', gerçek gönderim denenmedi (beklenen/tasarlanan davranış).");
    } else {
      check("7d. Delivery durumu 'sent' (RESEND_API_KEY tanımlıydı)", delivery2[0]?.status === "sent", delivery2[0]?.status);
    }

    console.log("\n=== 8) 'red' (rejected) için e-posta HİÇ tetiklenmemeli (görev kapsamı dışı) ===");
    const rejectedDelivery = await runSql(`select count(*)::int as c from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type not in ('new_offer','offer_accepted');`);
    check("8a. email_deliveries yalnızca beklenen 2 olay türünü içeriyor", (rejectedDelivery[0]?.c ?? -1) === 0);

    console.log("\n=== 9) E-posta hatası, ana teklif/kabul işlemini BOZMADI mı ===");
    check("9. Kabul işlemi (adım 6) GERÇEKTEN başarılı tamamlandı, e-posta durumundan BAĞIMSIZ olarak", offerAfterAccept[0]?.status === "accepted");
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  if (jobId) {
    for (const uid of createdUserIds) {
      const { data } = await admin.storage.from("job-photos").list(`${uid}/${jobId}`);
      for (const obj of data ?? []) uploadedStoragePaths.push(`${uid}/${jobId}/${obj.name}`);
    }
  }
  if (uploadedStoragePaths.length > 0) {
    const { error } = await admin.storage.from("job-photos").remove(uploadedStoragePaths);
    console.log(`Storage temizliği: ${uploadedStoragePaths.length} nesne ${error ? "BAŞARISIZ: " + error.message : "silindi"}`);
  }

  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      // SIRA: notifications (offer_id FK) -> ratings -> provider_service_authorizations
      // -> job_photos -> offer_status_history -> job_activity_events -> offers
      // (email_deliveries offer_id ON DELETE CASCADE ile burada otomatik silinir)
      // -> audit_logs -> jobs.
      await runSql(
        `delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList}) or offer_id in (select id from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList})));` +
          `delete from public.ratings where provider_id in (${idList}) or rater_id in (${idList});` +
          `delete from public.provider_service_authorizations where provider_id in (${idList});` +
          `delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.offer_status_history where offer_id in (select id from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList})));` +
          `delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.jobs where requester_id in (${idList});`,
      );
    } catch (e) {
      console.error("SQL cleanup failed:", e.message);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch((e) => console.error(`deleteUser(${id}) failed:`, e.message));
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
    console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) {
      console.log("Başarısız testler:");
      for (const f of failures) console.log(` - ${f}`);
      process.exitCode = 1;
    }
  });
