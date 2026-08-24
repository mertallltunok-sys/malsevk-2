// node scripts/tmp-sync-gaps-and-regression-test.mjs
//
// "Senkronizasyon Açıklarını Kapat" görevinin gerçek, farklı-cihaz kanıtı:
// GÖREV 2 (puanlama sunucuya kaydı), GÖREV 3 (ilan kapatma/silme backend'e
// yansıması), GÖREV 4 (iletişim bilgisi görünürlüğü) + genel regresyon
// (birden fazla hizmet kategorisi + İş Makinesi/Operatör ortak görünürlük).
// YENİ ADMİN HESABI OLUŞTURULMADI — mevcut, önceki görevlerde oluşturulmuş
// admin hesabı yeniden kullanılır.
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
const ADMIN_EMAIL = "malsevk-crossdev-admin-1787520260451@gmail.com";

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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-syncgaps-"));
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

async function pollSql(sql, isReady, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = runSql(sql)[0];
    if (isReady(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-syncgaps-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Sync Gaps ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Sync Gaps Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
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
  return sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 90, g: 60, b: 160 } } }).jpeg().toBuffer();
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

async function createJobViaRealForm(page, categoryValue, titleSuffix) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption(categoryValue);
  await page.waitForTimeout(500);
  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);
  await page.getByLabel("İlan Başlığı").first().fill(`Senkron testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu senkronizasyon testi icin gercek form uzerinden olusturulan bir ilan aciklamasidir.");
  await selectSearchable(page, "İlçe", 0, "Gebze");
  const facilityButtons = page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true });
  if ((await facilityButtons.count()) > 0) {
    await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Listede yok, kendim gireceğim");
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill(`Test Tesisi ${titleSuffix}`);
  }
  await page.getByLabel("Açık Adres").first().fill("Test acik adres, Gebze / Kocaeli.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 });
  const match = page.url().match(/\/ilanlar\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

async function approveJobAsAdmin(browser, jobId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
  const onaylaButton = page.getByRole("button", { name: /^Onayla/ });
  let approved = false;
  try {
    await onaylaButton.waitFor({ state: "visible", timeout: 15000 });
    await onaylaButton.click();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
      if (row?.moderation_status === "approved") {
        approved = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    console.error(`approveJobAsAdmin(${jobId}) HATA: ${error.message}`);
  }
  await ctx.close();
  return approved;
}

async function submitOfferAsProvider(browser, providerEmail, jobId, description) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, providerEmail);
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
  let visible = false;
  try {
    await page.locator("textarea").first().waitFor({ state: "visible", timeout: 15000 });
    visible = true;
    await page.locator("textarea").first().fill(description);
    await page.locator('select[aria-label="Para birimi"]').selectOption("TRY").catch(() => {});
    const amountInputs = page.locator('input[inputmode="decimal"]');
    if ((await amountInputs.count()) > 0) await amountInputs.first().fill("12000");
    await page.getByRole("button", { name: /Teklif (Gönder|Ver)/ }).first().click();
    await page.waitForTimeout(2000);
  } catch {
    // ilan bulunamadı / teklif formu görünmedi — çağıran bunu kendi record()'unda değerlendirir.
  }
  await ctx.close();
  return visible;
}

function offerCardByText(page, descriptionSubstring) {
  return page.locator("div.rounded-card").filter({ hasText: descriptionSubstring }).first();
}

async function selectJobChipByTitle(page, titleSubstring) {
  const chip = page.locator(`button[title*="${titleSubstring}"]`).first();
  await chip.waitFor({ state: "visible", timeout: 15000 });
  await chip.click();
}

async function clickSingleClickAction(card, buttonName) {
  const button = card.getByRole("button", { name: buttonName, exact: true });
  const visible = (await button.count()) > 0 && (await button.isVisible().catch(() => false));
  if (visible) await button.click();
  return visible;
}

async function clickCardDialogAction(card, triggerName, confirmName, { fillTextarea, checkRadio } = {}) {
  const trigger = card.getByRole("button", { name: triggerName, exact: true });
  const triggerVisible = (await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false));
  if (!triggerVisible) return false;
  await trigger.click();
  const dialog = card.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  if (checkRadio) await dialog.locator('input[type="radio"]').first().check();
  if (fillTextarea) await dialog.locator("textarea").first().fill(fillTextarea);
  const confirmButton = dialog.getByRole("button", { name: confirmName, exact: true });
  await confirmButton.waitFor({ state: "visible", timeout: 5000 });
  await confirmButton.click();
  return true;
}

async function clickCardThenPageDialogAction(page, card, triggerName, confirmName) {
  const trigger = card.getByRole("button", { name: triggerName, exact: true });
  const triggerVisible = (await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false));
  if (!triggerVisible) return false;
  await trigger.click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const confirmButton = dialog.getByRole("button", { name: confirmName, exact: true });
  await confirmButton.waitFor({ state: "visible", timeout: 5000 });
  await confirmButton.click();
  return true;
}

async function acceptOfferCleanSession(browser, requesterEmail, jobTitleSubstring, offerDescriptionSubstring, offerId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, requesterEmail);
  await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
  await selectJobChipByTitle(page, jobTitleSubstring);
  const card = offerCardByText(page, offerDescriptionSubstring);
  await card.waitFor({ state: "visible", timeout: 10000 });
  const clicked = await clickSingleClickAction(card, "Kabul Et");
  const verified = clicked ? await pollSql(`select status from public.offers where id = '${offerId}';`, (r) => r?.status === "accepted") : undefined;
  await ctx.close();
  return { clicked, verified: verified?.status === "accepted" };
}

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Kullanicilar olusturuluyor (admin MEVCUT olan yeniden kullaniliyor) ---");
    const reqA = await createUser("reqA", "hizmet-alan");
    const reqB = await createUser("reqB", "hizmet-alan"); // GÖREV 3 yetkisiz-kapatma testi için
    const provRating = await createUser("provRating", "hizmet-veren");
    const provOther = await createUser("provOther", "hizmet-veren"); // GÖREV 4 yetkisiz-goruntuleme testi için
    const provDepolama = await createUser("provDepolama", "hizmet-veren");
    const provLashing = await createUser("provLashing", "hizmet-veren");
    const provGozetim = await createUser("provGozetim", "hizmet-veren");
    const provNakliye = await createUser("provNakliye", "hizmet-veren");
    const provForkliftOnly = await createUser("provForkliftOnly", "hizmet-veren"); // İş Makinesi/Operatör ortak görünürlük testi
    console.log(`reqA=${reqA.email} reqB=${reqB.email} admin(MEVCUT)=${ADMIN_EMAIL}`);

    for (const [p, cat] of [
      [provRating, "forklift"],
      [provOther, "forklift"],
      [provDepolama, "kapali-depolama"],
      [provLashing, "lashing-unlashing"],
      [provGozetim, "gozetim-hizmetleri"],
      [provNakliye, "nakliye"],
      [provForkliftOnly, "forklift"],
    ]) {
      runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${p.id}', '${cat}', now()) on conflict do nothing;`);
    }

    // ============ GÖREV 2 — Puanlamanın Sunucuya Kaydı (tam akış -> puan) ============
    const ctxJobRating = await browser.newContext();
    const pageJobRating = await ctxJobRating.newPage();
    await loginAs(pageJobRating, reqA.email);
    const jobRating = await createJobViaRealForm(pageJobRating, "forklift", "J-RATING");
    await ctxJobRating.close();
    await approveJobAsAdmin(browser, jobRating);
    await submitOfferAsProvider(browser, provRating.email, jobRating, "Puanlama akisi testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerRating = runSql(`select id, status from public.offers where job_id = '${jobRating}' and provider_id = '${provRating.id}' order by created_at desc limit 1;`)[0];
    record("G2-0) Puanlama testi ilanı+teklifi oluşturuldu", offerRating?.status === "pending", JSON.stringify(offerRating));

    const acc1 = await acceptOfferCleanSession(browser, reqA.email, "J-RATING", "Puanlama akisi testi", offerRating.id);
    record("G2-1) Teklif temiz oturumda kabul edildi", acc1.verified, JSON.stringify(acc1));

    // ============ GÖREV 4 — İletişim Bilgilerinin Görünürlüğü ============
    // ÖNEMLİ SIRALAMA NOTU: contact-access.ts'in ENGAGED_OFFER_STATUSES'ı
    // "completed"i BİLEREK dışarıda bırakır — iş tamamlandığında iletişim
    // bilgisi TEKRAR gizlenir. Bu yüzden GÖREV 4 testleri, teklif hâlâ
    // "accepted" (ENGAGED) durumundayken, iş akışı "tamamlandı"ya
    // İLERLEMEDEN ÖNCE burada çalıştırılır — aksi halde ilan zaten Gelen
    // Teklifler'den düşmüş (tamamlandi filtresi) ve iletişim bilgisi de
    // kasıtlı olarak yeniden gizlenmiş olurdu.
    const ctxContactRequester = await browser.newContext();
    const pageContactRequester = await ctxContactRequester.newPage();
    await loginAs(pageContactRequester, reqA.email);
    await pageContactRequester.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageContactRequester, "J-RATING");
    // Sabit uyku yerine GERÇEK sonucu bekle — useHydrateOfferContacts'ın arka
    // plan hidratasyonu (RPC + yerel yazım + forceRerender) birkaç ardışık
    // async adımdır, tek bir sabit süre her zaman yetmeyebilir.
    const contactLinkRequester = pageContactRequester.locator('a[href^="tel:"], a[href^="mailto:"]').first();
    let providerContactVisibleToRequester = false;
    try {
      // Development ortamı bu oturum boyunca biriken çok sayıda eski test
      // ilanı/teklifi taşıyor (temizlik bu görevin SON aşamasında yapılacak)
      // — useAllJobs()'un uzak getirme round-trip'i bu yükle daha uzun
      // sürebilir, bu yüzden daha geniş bir zaman aşımı kullanılıyor.
      await contactLinkRequester.waitFor({ state: "visible", timeout: 25000 });
      providerContactVisibleToRequester = true;
    } catch {
      providerContactVisibleToRequester = false;
    }
    record(
      "G4-1) Kabul edilmiş iş sonrası Hizmet Alan, Hizmet Veren'in iletişim bilgisini temiz oturumda görebiliyor",
      providerContactVisibleToRequester,
      `contact_link_gorundu=${providerContactVisibleToRequester}`,
    );
    await ctxContactRequester.close();

    const ctxContactProvider = await browser.newContext();
    const pageContactProvider = await ctxContactProvider.newPage();
    await loginAs(pageContactProvider, provRating.email);
    await pageContactProvider.goto(`${APP_ORIGIN}/panel/tekliflerim`);
    await pageContactProvider.waitForTimeout(2500);
    const requesterContactVisibleToProvider = (await pageContactProvider.locator('a[href^="tel:"], a[href^="mailto:"]').count()) > 0;
    record(
      "G4-2) Aynı işte Hizmet Veren, Hizmet Alan'ın iletişim bilgisini temiz oturumda görebiliyor",
      requesterContactVisibleToProvider,
      `contact_link_gorundu=${requesterContactVisibleToProvider}`,
    );
    await ctxContactProvider.close();

    // Yetkisiz görüntüleme: bu işin tarafı olmayan başka bir hizmet veren RPC ile iletişim bilgisi çekemiyor.
    const provOtherClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await provOtherClient.auth.signInWithPassword({ email: provOther.email, password: PASSWORD });
    const { data: unauthorizedContactData, error: unauthorizedContactError } = await provOtherClient
      .rpc("get_offer_contact", { p_offer_id: offerRating.id })
      .maybeSingle();
    record(
      "G4-3) Yetkisiz (işin tarafı olmayan) Hizmet Veren iletişim bilgisini RPC ile hiç göremiyor",
      !unauthorizedContactData && !unauthorizedContactError,
      `data=${JSON.stringify(unauthorizedContactData)}, error=${unauthorizedContactError?.message}`,
    );

    // Askıya alınmış hesap iletişim bilgisi göremesin.
    const provSuspended = await createUser("provSuspended", "hizmet-veren");
    runSql(`update public.profiles set account_status = 'suspended' where id = '${provSuspended.id}';`);
    const provSuspendedClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await provSuspendedClient.auth.signInWithPassword({ email: provSuspended.email, password: PASSWORD });
    const { data: suspendedContactData } = await provSuspendedClient.rpc("get_offer_contact", { p_offer_id: offerRating.id }).maybeSingle();
    record("G4-4) Askıya alınmış hesap iletişim bilgisini göremiyor", !suspendedContactData, `data=${JSON.stringify(suspendedContactData)}`);
    runSql(`update public.profiles set account_status = 'active' where id = '${provSuspended.id}';`);

    const ctxStart = await browser.newContext();
    const pageStart = await ctxStart.newPage();
    await loginAs(pageStart, reqA.email);
    await pageStart.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageStart, "J-RATING");
    const startCard = offerCardByText(pageStart, "Puanlama akisi testi");
    await startCard.waitFor({ state: "visible", timeout: 10000 });
    await clickCardDialogAction(startCard, "İşe Başlandı", "Evet, İşi Başlat");
    await pollSql(`select status from public.offers where id = '${offerRating.id}';`, (r) => r?.status === "in_progress");
    await ctxStart.close();

    const ctxReqCompletion = await browser.newContext();
    const pageReqCompletion = await ctxReqCompletion.newPage();
    await loginAs(pageReqCompletion, provRating.email);
    await pageReqCompletion.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    const reqCompletionCard = offerCardByText(pageReqCompletion, "Puanlama akisi testi");
    await reqCompletionCard.waitFor({ state: "visible", timeout: 10000 });
    await clickCardThenPageDialogAction(pageReqCompletion, reqCompletionCard, "Tamamlandı Olarak İşaretle", "Evet, Tamamlandı Olarak İşaretle");
    await pollSql(`select status from public.offers where id = '${offerRating.id}';`, (r) => r?.status === "completion_requested");
    await ctxReqCompletion.close();

    const ctxConfirm = await browser.newContext();
    const pageConfirm = await ctxConfirm.newPage();
    await loginAs(pageConfirm, reqA.email);
    await pageConfirm.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageConfirm, "J-RATING");
    const confirmCard = offerCardByText(pageConfirm, "Puanlama akisi testi");
    await confirmCard.waitFor({ state: "visible", timeout: 10000 });
    await clickCardDialogAction(confirmCard, "Tamamlandığını Onayla", "Evet, Onaylıyorum");
    const completedRow = await pollSql(`select status from public.offers where id = '${offerRating.id}';`, (r) => r?.status === "completed");
    record("G2-2) Teklif temiz oturumda tamamlandı (backend'e yansıdı)", completedRow?.status === "completed", JSON.stringify(completedRow));

    const ratingDialog = pageConfirm.locator('[role="dialog"]').filter({ hasText: "Hizmeti Değerlendir" });
    let ratingUiSubmitted = false;
    try {
      await ratingDialog.waitFor({ state: "visible", timeout: 8000 });
      await ratingDialog.getByRole("radio", { name: "5 yıldız" }).click();
      await ratingDialog.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
      await ratingDialog.waitFor({ state: "hidden", timeout: 8000 });
      ratingUiSubmitted = true;
    } catch {
      ratingUiSubmitted = false;
    }
    await ctxConfirm.close();

    const ratingRow = await pollSql(`select id, stars, rater_id, provider_id from public.ratings where offer_id = '${offerRating.id}';`, (r) => Boolean(r));
    record("G2-3) Puan gerçekten public.ratings'e yazıldı (backend kanıtı)", Boolean(ratingRow), `ui_gonderildi=${ratingUiSubmitted}, ${JSON.stringify(ratingRow)}`);

    // GÖREV 2 test 8: temiz/bağımsız İKİNCİ tarayıcı oturumunda puanın görüldüğünü doğrula.
    const ctxRatingCheck = await browser.newContext();
    const pageRatingCheck = await ctxRatingCheck.newPage();
    await loginAs(pageRatingCheck, reqA.email);
    await pageRatingCheck.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim?durum=tamamlandi`);
    // job-rating-widget.tsx "Tamamlandı" sekmesinde "Verdiğiniz puan" + "5 / 5" render eder (salt-okunur özet).
    // Sabit uyku yerine GERÇEK sonucu bekle (useAllRatings'in kendi uzak
    // hidratasyon round-trip'i birkaç saniye sürebilir).
    let ratingVisibleInCleanSession = false;
    try {
      await pageRatingCheck.getByText("Verdiğiniz puan").first().waitFor({ state: "visible", timeout: 10000 });
      ratingVisibleInCleanSession = true;
    } catch {
      ratingVisibleInCleanSession = false;
    }
    record(
      "G2-4) Temiz/bağımsız 2. tarayıcı oturumunda puan görüldü",
      ratingVisibleInCleanSession,
      `dogrudan_backend_kaniti_zaten_var (G2-3), UI_gorunurlugu=${ratingVisibleInCleanSession}`,
    );
    await ctxRatingCheck.close();

    // Yetkisiz/tekrar puanlama regresyonu — doğrudan RPC.
    const otherReqClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await otherReqClient.auth.signInWithPassword({ email: reqB.email, password: PASSWORD });
    const { error: unauthorizedRatingError } = await otherReqClient.rpc("submit_rating", {
      p_offer_id: offerRating.id,
      p_stars: 3,
      p_comment: null,
    });
    record("G2-5) Başkasının işini puanlama RPC ile reddediliyor", !!unauthorizedRatingError, unauthorizedRatingError?.message);

    const providerRatingClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await providerRatingClient.auth.signInWithPassword({ email: provRating.email, password: PASSWORD });
    const { error: providerCannotRateError } = await providerRatingClient.rpc("submit_rating", {
      p_offer_id: offerRating.id,
      p_stars: 5,
      p_comment: null,
    });
    record("G2-6) Hizmet Veren kendi işini puanlayamıyor (yalnızca Hizmet Alan)", !!providerCannotRateError, providerCannotRateError?.message);

    const reqAClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await reqAClient.auth.signInWithPassword({ email: reqA.email, password: PASSWORD });
    const { error: duplicateRatingError } = await reqAClient.rpc("submit_rating", {
      p_offer_id: offerRating.id,
      p_stars: 2,
      p_comment: null,
    });
    record("G2-7) Aynı iş tekrar puanlanamıyor", !!duplicateRatingError, duplicateRatingError?.message);

    // ============ GÖREV 3 — İlan Kapatma ve Silme (backend'e gerçekten yansıması) ============
    const ctxJobClose = await browser.newContext();
    const pageJobClose = await ctxJobClose.newPage();
    await loginAs(pageJobClose, reqA.email);
    const jobClose = await createJobViaRealForm(pageJobClose, "forklift", "J-CLOSE");
    await ctxJobClose.close();
    await approveJobAsAdmin(browser, jobClose);

    // Yetkisiz kapatma: reqB (ilanın sahibi DEĞİL) RPC ile kapatmayı deneyemez.
    const reqBClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await reqBClient.auth.signInWithPassword({ email: reqB.email, password: PASSWORD });
    const { error: unauthorizedCloseError } = await reqBClient.rpc("close_job", {
      p_job_id: jobClose,
      p_reason: "hizmete-ihtiyac-kalmadi",
    });
    record("G3-1) Başkasının ilanını kapatma RPC ile reddediliyor", !!unauthorizedCloseError, unauthorizedCloseError?.message);

    // Gerçek kapatma: reqA, TEMİZ/izole bir oturumda kendi ilanını kapatır.
    const ctxCloseAction = await browser.newContext();
    const pageCloseAction = await ctxCloseAction.newPage();
    await loginAs(pageCloseAction, reqA.email);
    await pageCloseAction.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
    await pageCloseAction.waitForTimeout(1500);
    const closeJobCard = pageCloseAction.locator("div").filter({ hasText: "J-CLOSE" }).last();
    const closeTrigger = pageCloseAction.getByRole("button", { name: /İlanı Kapat/ }).first();
    let closeButtonVisible = false;
    try {
      await closeTrigger.waitFor({ state: "visible", timeout: 10000 });
      closeButtonVisible = true;
      await closeTrigger.click();
      const closeDialog = pageCloseAction.locator('[role="dialog"]');
      await closeDialog.waitFor({ state: "visible", timeout: 5000 });
      const reasonOption = closeDialog.locator('input[type="radio"]').first();
      if ((await reasonOption.count()) > 0) await reasonOption.check();
      const confirmClose = closeDialog.getByRole("button", { name: /İlanı Kapat/ }).last();
      await confirmClose.click();
    } catch (error) {
      console.error(`G3 kapatma UI hatası: ${error.message}`);
    }
    void closeJobCard;
    const closedRow = await pollSql(`select closed_at from public.jobs where id = '${jobClose}';`, (r) => Boolean(r?.closed_at));
    record("G3-2) İlan temiz/izole oturumda kapatıldı, backend'e (public.jobs.closed_at) yansıdı", Boolean(closedRow?.closed_at), `buton_gorundu=${closeButtonVisible}, ${JSON.stringify(closedRow)}`);
    await ctxCloseAction.close();

    // Kapatılan ilana artık teklif verilemiyor mu (farklı cihaz/hesap, gerçek RPC).
    const provDepolamaClient1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await provDepolamaClient1.auth.signInWithPassword({ email: provRating.email, password: PASSWORD });
    const { error: offerOnClosedJobError } = await provDepolamaClient1.rpc("create_offer", {
      p_job_id: jobClose,
      p_amount: 1000,
      p_currency: "TRY",
      p_description: "Kapatilmis ilana teklif deneme aciklamasi yeterli uzunlukta.",
    });
    record("G3-3) Kapatılan ilana farklı hesaptan/cihazdan yeni teklif RPC ile reddediliyor", !!offerOnClosedJobError, offerOnClosedJobError?.message);

    // ============ GÖREV 3 — İlan Silme ============
    const ctxJobDelete = await browser.newContext();
    const pageJobDelete = await ctxJobDelete.newPage();
    await loginAs(pageJobDelete, reqA.email);
    const jobDelete = await createJobViaRealForm(pageJobDelete, "forklift", "J-DELETE");
    await ctxJobDelete.close();
    await approveJobAsAdmin(browser, jobDelete);

    const { error: unauthorizedDeleteError } = await reqBClient.rpc("delete_job", { p_job_id: jobDelete });
    record("G3-4) Başkasının ilanını silme RPC ile reddediliyor", !!unauthorizedDeleteError, unauthorizedDeleteError?.message);

    const ctxDeleteAction = await browser.newContext();
    const pageDeleteAction = await ctxDeleteAction.newPage();
    await loginAs(pageDeleteAction, reqA.email);
    await pageDeleteAction.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
    await pageDeleteAction.waitForTimeout(1500);
    const deleteTrigger = pageDeleteAction.getByRole("button", { name: /İlanı Sil/ }).first();
    let deleteButtonVisible = false;
    try {
      await deleteTrigger.waitFor({ state: "visible", timeout: 10000 });
      deleteButtonVisible = true;
      await deleteTrigger.click();
      const deleteDialog = pageDeleteAction.locator('[role="dialog"]');
      await deleteDialog.waitFor({ state: "visible", timeout: 5000 });
      const confirmDelete = deleteDialog.getByRole("button", { name: /Evet|Sil/ }).last();
      await confirmDelete.click();
    } catch (error) {
      console.error(`G3 silme UI hatası: ${error.message}`);
    }
    const deletedRow = await pollSql(`select deleted_at from public.jobs where id = '${jobDelete}';`, (r) => Boolean(r?.deleted_at));
    record("G3-5) İlan temiz/izole oturumda silindi, backend'e (public.jobs.deleted_at) yansıdı", Boolean(deletedRow?.deleted_at), `buton_gorundu=${deleteButtonVisible}, ${JSON.stringify(deletedRow)}`);
    await ctxDeleteAction.close();

    const [{ visible_after_delete: visibleAfterDelete }] = runSql(
      `select exists(select 1 from public.get_visible_jobs() g where g.id = '${jobDelete}') as visible_after_delete;`,
    );
    record("G3-6) Silinen ilan get_visible_jobs()'ta artık hiç dönmüyor (farklı cihaz için de kalıcı)", visibleAfterDelete === false, `visible=${visibleAfterDelete}`);

    // ============ GENEL REGRESYON — Birden fazla hizmet kategorisi ============
    const wdReg = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const categoryChecks = [
      { label: "Depolama", categoryId: "kapali-depolama", authorizedProvider: provDepolama },
      { label: "Lashing/Unlashing", categoryId: "lashing-unlashing", authorizedProvider: provLashing },
      { label: "Gözetim", categoryId: "gozetim-hizmetleri", authorizedProvider: provGozetim },
      { label: "Nakliye", categoryId: "nakliye", authorizedProvider: provNakliye },
    ];
    for (const check of categoryChecks) {
      const regJobId = randomUUID();
      runSql(
        `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
         values ('${regJobId}', '${reqA.id}', '${check.categoryId}', 'Regresyon ${check.label}', 'Bu genel regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wdReg}', 'approved');`,
      );

      const authorizedClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await authorizedClient.auth.signInWithPassword({ email: check.authorizedProvider.email, password: PASSWORD });
      const { error: authorizedOfferError } = await authorizedClient.rpc("create_offer", {
        p_job_id: regJobId,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: `Regresyon ${check.label} icin gercek bir teklif aciklamasi yeterli uzunlukta.`,
        // Nakliye kategorisi zorunlu kılıyor (MLK66); diğer kategoriler için zararsız/yok sayılır.
        ...(check.categoryId === "nakliye" ? { p_estimated_duration: 5 } : {}),
      });
      record(`GR-${check.label}-1) Yetkili Hizmet Veren bu kategoriye gerçekten teklif verebiliyor`, !authorizedOfferError, authorizedOfferError?.message ?? "teklif oluşturuldu");

      const unauthorizedClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await unauthorizedClient.auth.signInWithPassword({ email: provRating.email, password: PASSWORD }); // yalnızca forklift yetkili
      const { error: unauthorizedOfferError2 } = await unauthorizedClient.rpc("create_offer", {
        p_job_id: regJobId,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: `Yetkisiz regresyon teklifi aciklamasi yeterli uzunlukta.`,
      });
      record(`GR-${check.label}-2) Yetkisiz Hizmet Veren bu kategoriye teklif veremiyor`, !!unauthorizedOfferError2, unauthorizedOfferError2?.message);

      const unapprovedRegJobId = randomUUID();
      runSql(
        `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
         values ('${unapprovedRegJobId}', '${reqA.id}', '${check.categoryId}', 'Regresyon Onaysiz ${check.label}', 'Bu genel regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wdReg}', 'pending_review');`,
      );
      const { error: unapprovedOfferError2 } = await authorizedClient.rpc("create_offer", {
        p_job_id: unapprovedRegJobId,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: `Onaysiz ilana regresyon teklifi aciklamasi yeterli uzunlukta.`,
      });
      record(`GR-${check.label}-3) Admin onayından geçmemiş ilana teklif verilemiyor`, !!unapprovedOfferError2, unapprovedOfferError2?.message);
    }

    // İş Makinesi/Operatör ortak görünürlük — migration 0076/0077'nin
    // bozulmadığını yeniden doğrula (Aşama 9'daki AYNI test, bu görevdeki
    // geniş kapsamlı offers.ts değişikliklerinden SONRA tekrarlanıyor).
    const sharedVisJobId = randomUUID();
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${sharedVisJobId}', '${reqA.id}', 'vinc-operatoru', 'Regresyon ortak gorunurluk', 'Bu regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wdReg}', 'approved');`,
    );
    const [{ can_view: sharedCanView }] = runSql(
      `select public.provider_can_view_job_for_listing('${provForkliftOnly.id}', 'vinc-operatoru', null, null, null, null, null, null) as can_view;`,
    );
    const forkliftOnlyClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await forkliftOnlyClient.auth.signInWithPassword({ email: provForkliftOnly.email, password: PASSWORD });
    const { error: sharedVisOfferError } = await forkliftOnlyClient.rpc("create_offer", {
      p_job_id: sharedVisJobId,
      p_amount: 1000,
      p_currency: "TRY",
      p_description: "Ortak gorunurluk regresyon testi icin gercek bir teklif aciklamasi.",
    });
    record(
      "GR-IsMakinesi) Görünürlük hâlâ ortak (görüyor), teklif yetkisi hâlâ ayrı (veremiyor) — migration 0076/0077 bu görevdeki değişikliklerden sonra da bozulmadı",
      sharedCanView === true && !!sharedVisOfferError,
      `can_view=${sharedCanView}, offer_error=${sharedVisOfferError?.message}`,
    );

    // Askıya alınmış hesap — genel regresyon (kategori bağımsız).
    const provSuspendedReg = await createUser("provSuspendedReg", "hizmet-veren");
    runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provSuspendedReg.id}', 'forklift', now()) on conflict do nothing;`);
    runSql(`update public.profiles set account_status = 'suspended' where id = '${provSuspendedReg.id}';`);
    const provSuspendedRegClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await provSuspendedRegClient.auth.signInWithPassword({ email: provSuspendedReg.email, password: PASSWORD });
    const { error: suspendedRegError } = await provSuspendedRegClient.rpc("create_offer", {
      p_job_id: jobRating,
      p_amount: 1000,
      p_currency: "TRY",
      p_description: "Askiya alinmis hesap regresyon teklifi aciklamasi yeterli uzunlukta.",
    });
    record("GR-Suspended) Askıya alınmış hesap hiçbir kategoride teklif oluşturamıyor", !!suspendedRegError, suspendedRegError?.message);
    runSql(`update public.profiles set account_status = 'active' where id = '${provSuspendedReg.id}';`);

    console.log("");
    console.log(`=== GÖREV 2/4 SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
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
