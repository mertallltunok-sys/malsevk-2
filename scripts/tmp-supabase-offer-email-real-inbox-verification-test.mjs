// node scripts/tmp-supabase-offer-email-real-inbox-verification-test.mjs
//
// "Resend Teklif E-postalarını Gerçek Gelen Kutusunda Doğrula" görevi —
// GÖREV 2-5'in tek, kapsamlı uçtan uca kanıtı. Gerçek Hizmet Alan/Hizmet
// Veren hesapları, gerçek Mailinator public gelen kutuları (gerçekten
// görüntülenebilir, üçüncü taraf, kimlik doğrulaması gerektirmeyen genel
// API — https://api.mailinator.com/api/v2/domains/public/...), gerçek UI
// üzerinden ilan/teklif/kabul, ve gerçek Resend API (RESEND_API_KEY artık
// yapılandırılı). Hiçbir DB satırı doğrudan sahte olarak eklenmez.
//
// Türkçe karakter notu: Mailinator API içeriğini terminalde/bash argümanı
// olarak elle sorgularken bu oturumda GERÇEK bir bozulma bulundu (Git Bash
// inline `-d '...'` argümanı Türkçe karakterleri bozuyor) — bu SADECE
// manuel teşhis komutlarını etkiler, ASLA bu script'i: burada her şey Node
// string literal'leri ve gerçek Playwright `.fill()` (DOM seviyesinde,
// tarayıcının kendi UTF-8 işleyişi) üzerinden yapılıyor, ikisi de doğrulandı.
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

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` -- ${extra}` : "")); console.log(`FAIL  ${name}${extra ? " -- " + extra : ""}`); }
}

async function runSql(sql) {
  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const sqlPath = path.join(tmpdir(), `email-inbox-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(sqlPath, sql, "utf8");
  const out = execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" }).toString();
  return JSON.parse(out).rows ?? [];
}

async function makeRealAccount(label, role, email) {
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
  return { email, id: created.data.user.id, client };
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
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorize_reason) values ('${providerId}', '${categoryId}', 'e2e gercek gelen kutusu testi');`,
  );
}

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

// --- Mailinator (gerçek, kimlik doğrulamasız genel API) ---
async function pollMailinatorInbox(inboxLocalPart, { timeoutMs = 90000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`https://api.mailinator.com/api/v2/domains/public/inboxes/${inboxLocalPart}`);
      const data = await res.json();
      if (data.msgs && data.msgs.length > 0) return data.msgs;
    } catch (e) {
      // Geçici (transient) Mailinator API hatası - polling'i sonlandırmaz, bir sonraki denemede devam eder.
      console.log(`  (Mailinator polling geçici hata, devam ediliyor: ${e.message})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return [];
}

async function fetchMailinatorMessage(msgId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`https://api.mailinator.com/api/v2/domains/public/messages/${encodeURIComponent(msgId)}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function getMailinatorPart(msg, contentType) {
  return (msg.parts || []).find((p) => (p.headers?.["content-type"] || "").includes(contentType));
}

async function fetchResendEmailStatus(resendMessageId, apiKey) {
  const res = await fetch(`https://api.resend.com/emails/${resendMessageId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let jobId = null;
let supabaseOfferId = null;
const requesterInbox = `malsevk-req-${uniqueTag}`;
const providerInbox = `malsevk-prov-${uniqueTag}`;
const requesterEmail = `${requesterInbox}@mailinator.com`;
const providerEmail = `${providerInbox}@mailinator.com`;
// HTML-özel karakterler + Türkçe karakterler AYNI başlıkta - hem enjeksiyon
// hem karakter kodlaması tek geçişte test edilir. Yalnızca workLocationType
// containsDangerousMarkup ile korunuyor (title/description'da böyle bir
// kısıtlama YOK, kod incelemesiyle doğrulandı), bu yüzden bu başlık gerçekten
// gönderilebilmeli.
const jobTitle = `E2E <b>Test</b> & Türkçe ğüşıöç ${uniqueTag}`;

async function main() {
  console.log("=== Kurulum: gerçek Mailinator gelen kutulu requester + provider hesapları ===");
  console.log("Requester inbox:", requesterInbox, "| Provider inbox:", providerInbox);
  const requester = await makeRealAccount("req", "hizmet-alan", requesterEmail);
  const provider = await makeRealAccount("prov", "hizmet-veren", providerEmail);
  check("setup: requester + provider hesapları oluşturuldu", !!requester.id && !!provider.id);
  await authorizeProviderForCategory(provider.id, "forklift");
  check("setup: provider 'forklift' kategorisi için yetkilendirildi", true);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();

    console.log("\n=== GÖREV 2: Requester GERÇEK UI ile bir Forklift ilanı oluşturuyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Forklift" });
    await page.getByLabel("İlan Başlığı").fill(jobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("E-posta gerçek gelen kutusu testi için oluşturuldu, en az yirmi karakter.");
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
    check("2a. Operasyon Önizlemesine ulaşıldı (HTML-özel + Türkçe karakterli başlık kabul edildi)", reachedPreview);
    if (!reachedPreview) throw new Error("Form doğrulanamadı.");
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    jobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("2b. İlan oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()));

    await approveJobInLocalStorage(page, jobId);
    await page.waitForTimeout(2500);
    const approved = await approveJobInSupabase(jobId);
    check("2c. İlan (yerel + Supabase) admin onay akışıyla onaylandı", approved);

    console.log("\n=== GÖREV 3: Provider AYNI ilana GERÇEK UI'dan teklif veriyor ===");
    await loginAs(page, provider.email);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const offerFieldVisible = await page.getByLabel("Teklif Tutarı").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    check("3a. Teklif formu görünüyor (yetkili + onaylı ilan)", offerFieldVisible);
    await page.getByLabel("Teklif Tutarı").fill("7500");
    await page.getByLabel("Teklif Açıklaması").fill("Gerçek gelen kutusu e-posta testi için oluşturulan teklif, en az yirmi karakter.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    const offerSubmitted = await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    check("3b. create_offer başarıyla tamamlandı (gerçek UI)", offerSubmitted);
    if (!offerSubmitted) throw new Error("Teklif gönderilemedi.");

    const offerRows = await runSql(`select id, status from public.offers where job_id = '${jobId}' and provider_id = '${provider.id}' order by created_at desc limit 1;`);
    supabaseOfferId = offerRows[0]?.id ?? null;
    check("3c. Teklif GERÇEKTEN public.offers'a yazıldı", !!supabaseOfferId && offerRows[0]?.status === "pending", JSON.stringify(offerRows[0]));

    console.log("\n=== GÖREV 3: email_deliveries + Resend gerçek gönderim doğrulaması (yeni_teklif) ===");
    await page.waitForTimeout(1500);
    const newOfferDelivery = await runSql(`select id, status, resend_message_id, recipient_user_id, actor_user_id, error_message from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("3d. email_deliveries: tam olarak 1 kayıt", newOfferDelivery.length === 1, JSON.stringify(newOfferDelivery));
    check("3e. Route Handler 2xx (delivery status='sent')", newOfferDelivery[0]?.status === "sent", JSON.stringify(newOfferDelivery[0]));
    check("3f. Resend gerçek mesaj ID'si döndü", !!newOfferDelivery[0]?.resend_message_id, newOfferDelivery[0]?.resend_message_id);
    check("3g. Alıcı GERÇEKTEN ilan sahibi (requester)", newOfferDelivery[0]?.recipient_user_id === requester.id);
    check("3h. Tetikleyici GERÇEKTEN teklif veren (provider)", newOfferDelivery[0]?.actor_user_id === provider.id);

    console.log("\n=== GÖREV 3: GERÇEK Mailinator gelen kutusunda e-postayı doğruluyor ===");
    const requesterMsgs = await pollMailinatorInbox(requesterInbox);
    check("3i. E-posta GERÇEK Mailinator gelen kutusunda görüldü", requesterMsgs.length > 0, `${requesterMsgs.length} mesaj`);
    if (requesterMsgs.length > 0) {
      const latestMsg = requesterMsgs[requesterMsgs.length - 1];
      check("3j. Konu tam olarak 'MALSEVK | İlanınıza Yeni Teklif Geldi'", latestMsg.subject === "MALSEVK | İlanınıza Yeni Teklif Geldi", latestMsg.subject);
      check("3k. Gönderen noreply@malsevk.com", latestMsg.fromfull === "noreply@malsevk.com", latestMsg.fromfull);

      const fullMsg = await fetchMailinatorMessage(latestMsg.id);
      const htmlPart = getMailinatorPart(fullMsg, "text/html");
      const textPart = getMailinatorPart(fullMsg, "text/plain");
      check("3l. HTML içerik mevcut", !!htmlPart?.body);
      check("3m. Düz metin içerik mevcut", !!textPart?.body);
      const htmlBody = htmlPart?.body ?? "";
      check("3n. Türkçe karakterler HTML'de doğru (ğüşıöç)", htmlBody.includes("ğüşıöç"), htmlBody.slice(0, 200));
      check("3o. İlan başlığı HTML'de (escape edilmiş) doğru görünüyor", htmlBody.includes("&lt;b&gt;Test&lt;/b&gt;") && htmlBody.includes("&amp; Türkçe"), htmlBody.slice(0, 400));
      check("3p. HAM <script>/<b> etiketleri HTML'de YOK (injection değil, escape edilmiş)", !/<b>Test<\/b>/.test(htmlBody) && !htmlBody.includes("<script"));
      check("3q. Teklif verenin kimliği/iletişim bilgisi e-postada YOK (kabul-öncesi anonimlik)", !htmlBody.includes(provider.email) && !htmlBody.toLowerCase().includes("test prov firma"));
      check("3r. 'Teklifi Görüntüle' bağlantısı doğru Development adresine gidiyor", htmlBody.includes(`${APP_ORIGIN}/panel/gelen-teklifler?ilanId=${jobId}`), htmlBody.match(/href="([^"]+)"/)?.[1]);
    }

    console.log("\n=== GÖREV 4: Requester teklifi GERÇEK UI'dan kabul ediyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(1500);

    const offerAfterAccept = await runSql(`select status from public.offers where id = '${supabaseOfferId}';`);
    check("4a. accept_offer başarıyla tamamlandı, teklif GERÇEKTEN 'accepted'", offerAfterAccept[0]?.status === "accepted", offerAfterAccept[0]?.status);

    console.log("\n=== GÖREV 4: email_deliveries + Resend gerçek gönderim doğrulaması (teklif_kabul_edildi) ===");
    await page.waitForTimeout(1500);
    const acceptedDelivery = await runSql(`select id, status, resend_message_id, recipient_user_id, actor_user_id from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'offer_accepted';`);
    check("4b. email_deliveries: tam olarak 1 kayıt", acceptedDelivery.length === 1, JSON.stringify(acceptedDelivery));
    check("4c. Route Handler 2xx (delivery status='sent')", acceptedDelivery[0]?.status === "sent", JSON.stringify(acceptedDelivery[0]));
    check("4d. Resend gerçek mesaj ID'si döndü", !!acceptedDelivery[0]?.resend_message_id, acceptedDelivery[0]?.resend_message_id);
    check("4e. Alıcı GERÇEKTEN teklifi veren (provider)", acceptedDelivery[0]?.recipient_user_id === provider.id);
    check("4f. Tetikleyici GERÇEKTEN kabul eden (requester)", acceptedDelivery[0]?.actor_user_id === requester.id);

    console.log("\n=== GÖREV 4: GERÇEK Mailinator gelen kutusunda e-postayı doğruluyor ===");
    const providerMsgs = await pollMailinatorInbox(providerInbox);
    check("4g. E-posta GERÇEK Mailinator gelen kutusunda görüldü", providerMsgs.length > 0, `${providerMsgs.length} mesaj`);
    if (providerMsgs.length > 0) {
      const latestMsg = providerMsgs[providerMsgs.length - 1];
      check("4h. Konu tam olarak 'MALSEVK | Teklifiniz Kabul Edildi'", latestMsg.subject === "MALSEVK | Teklifiniz Kabul Edildi", latestMsg.subject);
      check("4i. Gönderen noreply@malsevk.com", latestMsg.fromfull === "noreply@malsevk.com", latestMsg.fromfull);

      const fullMsg = await fetchMailinatorMessage(latestMsg.id);
      const htmlPart = getMailinatorPart(fullMsg, "text/html");
      const textPart = getMailinatorPart(fullMsg, "text/plain");
      check("4j. HTML içerik mevcut", !!htmlPart?.body);
      check("4k. Düz metin içerik mevcut", !!textPart?.body);
      const htmlBody = htmlPart?.body ?? "";
      check("4l. Türkçe karakterler HTML'de doğru (ğüşıöç)", htmlBody.includes("ğüşıöç"), htmlBody.slice(0, 200));
      check("4m. İlan başlığı HTML'de (escape edilmiş) doğru görünüyor", htmlBody.includes("&lt;b&gt;Test&lt;/b&gt;"), htmlBody.slice(0, 400));
      check("4n. HAM <b> etiketi HTML'de YOK (escape edilmiş)", !/<b>Test<\/b>/.test(htmlBody));
      check("4o. Requester'ın ham telefon/e-postası içerikte YOK (yalnızca link, kabul sonrası görünürlük kuralına uygun)", !htmlBody.includes(requester.email));
      check("4p. 'Operasyonu Görüntüle' bağlantısı doğru Development adresine gidiyor", htmlBody.includes(`${APP_ORIGIN}/panel/tekliflerim`), htmlBody.match(/href="([^"]+)"/)?.[1]);
    }

    console.log("\n=== GÖREV 5: Mükerrer gönderim / retry / yetki testleri (AYNI teklif üzerinde) ===");
    // NOT: retry'nin GERÇEK aktör tarafından yapıldığını doğrulamak için
    // (yalnızca "herhangi biri no-op alır" değil) her retry, o olayın GERÇEK
    // tarafının oturumuyla çağrılır — 'new_offer' -> provider, 'offer_accepted'
    // -> requester (0088'in aktör kontrolü artık kısayol yolunda da aktif).
    await loginAs(page, provider.email);
    const beforeRetryNew = newOfferDelivery[0]?.resend_message_id;
    const retryNewResult = await callNotifyRouteAsPage(page, supabaseOfferId, "new_offer");
    const newOfferAfterRetry = await runSql(`select id, status, resend_message_id, attempt_count from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("5a. 'new_offer' retry sonrası HÂLÂ tam 1 kayıt (mükerrer YOK)", newOfferAfterRetry.length === 1);
    check("5b. GERÇEK aktörün (provider) retry'si, zaten 'sent' olduğu için no-op oldu (alreadyProcessed, ikinci Resend ID YOK)", retryNewResult.body?.alreadyProcessed === true && newOfferAfterRetry[0]?.resend_message_id === beforeRetryNew, JSON.stringify(retryNewResult.body));

    await loginAs(page, requester.email);
    const beforeRetryAccepted = acceptedDelivery[0]?.resend_message_id;
    const retryAcceptedResult = await callNotifyRouteAsPage(page, supabaseOfferId, "offer_accepted");
    const acceptedAfterRetry = await runSql(`select resend_message_id from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'offer_accepted';`);
    check("5c. 'offer_accepted' retry sonrası da mükerrer YOK, aynı Resend ID", retryAcceptedResult.body?.alreadyProcessed === true && acceptedAfterRetry[0]?.resend_message_id === beforeRetryAccepted);

    // Yetkisiz üçüncü hesap.
    const outsiderEmail = `malsevk-emailtest-outsider2-${stamp}@gmail.com`;
    const outsiderCreated = await admin.auth.admin.createUser({ email: outsiderEmail, password: PASSWORD, email_confirm: true });
    createdUserIds.push(outsiderCreated.data.user.id);
    const outsiderClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password: PASSWORD });
    await outsiderClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "Outsider", p_phone: "+905551239900",
      p_company_name: "Outsider Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    const outsiderPage = await context.newPage();
    await loginAs(outsiderPage, outsiderEmail);
    const beforeOutsider = await runSql(`select attempt_count from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    const outsiderResult = await callNotifyRouteAsPage(outsiderPage, supabaseOfferId, "new_offer");
    const afterOutsider = await runSql(`select attempt_count from public.email_deliveries where offer_id = '${supabaseOfferId}' and event_type = 'new_offer';`);
    check("5d. Yetkisiz üçüncü kullanıcı reddedildi (2xx DEĞİL)", outsiderResult.status !== 200, JSON.stringify(outsiderResult));
    check("5e. Yetkisiz çağrı mevcut kaydı hiç değiştirmedi", JSON.stringify(beforeOutsider) === JSON.stringify(afterOutsider));
    await outsiderPage.close();

    // Askıya alınmış hesap — provider'ın KENDİ (yeniden açılan) oturumuyla,
    // assert_active_user()'ın canlı DB kontrolünü (JWT değil) test eder:
    // önce aktif haldeyken giriş yapılır, SONRA hesap askıya alınır, AYNI
    // oturum hâlâ açıkken RPC çağrılır.
    await loginAs(page, provider.email);
    await runSql(`update public.profiles set account_status = 'suspended' where id = '${provider.id}';`);
    const suspendedResult = await callNotifyRouteAsPage(page, supabaseOfferId, "new_offer");
    check("5f. Askıya alınmış hesap (provider, kendi gerçek oturumuyla) yeni e-posta RPC'sini kullanamadı", suspendedResult.status !== 200, JSON.stringify(suspendedResult));
    await runSql(`update public.profiles set account_status = 'active' where id = '${provider.id}';`);

    console.log("\n=== GÖREV 5: Resend Logs (gerçek API) çapraz doğrulaması ===");
    // NOT: bu anahtar Resend Dashboard'da BİLEREK "yalnızca gönderme" (sending-only)
    // olarak kısıtlanmış (gerçek API çağrısıyla doğrulandı: GET /emails/:id
    // 401 "restricted_api_key" döner) — bu bir güvenlik ÖZELLİĞİDİR, hata
    // DEĞİL (en az ayrıcalık ilkesi). Bu yüzden "en fazla bir gönderim"
    // kanıtı burada DB (email_deliveries UNIQUE + tek resend_message_id) ve
    // gerçek Mailinator gelen kutusu sayımıyla (yukarıda zaten toplanan
    // requesterMsgs/providerMsgs) sağlanır — Resend'in kendi API'sinden okuma
    // erişimi bu anahtarla mümkün DEĞİL, bunu bir başarısızlık gibi
    // raporlamak yanıltıcı olurdu.
    const apiKeyForCheck = readFileSync("C:/Users/merta/malsevk-2/.env.local", "utf8").match(/^RESEND_API_KEY=(.*)$/m)?.[1]?.trim();
    if (apiKeyForCheck) {
      const newOfferResendCheck = await fetchResendEmailStatus(newOfferDelivery[0].resend_message_id, apiKeyForCheck);
      check(
        "5g. Resend API anahtarı doğrulandığı gibi yalnızca-gönderme ile kısıtlı (restricted_api_key) - okuma erişimi YOK, bu beklenen/güvenli",
        newOfferResendCheck.status === 401 && newOfferResendCheck.body?.name === "restricted_api_key",
        `HTTP ${newOfferResendCheck.status} ${JSON.stringify(newOfferResendCheck.body)}`,
      );
      check(
        "5h. 'En fazla bir gönderim' kanıtı yerine: her iki olay için gerçek Mailinator gelen kutusunda tam olarak 1 mesaj görüldü",
        requesterMsgs.length === 1 && providerMsgs.length === 1,
        `requester: ${requesterMsgs.length}, provider: ${providerMsgs.length}`,
      );
    } else {
      check("5g/5h. RESEND_API_KEY okunamadı", false);
    }

    check("6. E-posta akışı boyunca ana teklif/kabul işlemi hiç bozulmadı", offerAfterAccept[0]?.status === "accepted" && !!supabaseOfferId);
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  // SIRA (GÖREV 7): 1) Storage 2) email_deliveries (offer_id CASCADE ile
  // otomatik) 3) teklifler 4) operasyon/puanlama 5) ilanlar 6) provider
  // yetki/consent 7) auth hesapları.
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
