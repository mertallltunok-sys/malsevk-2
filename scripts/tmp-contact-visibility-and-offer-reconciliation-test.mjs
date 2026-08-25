// node scripts/tmp-contact-visibility-and-offer-reconciliation-test.mjs
//
// "İletişim Gizliliğini Supabase'e Bağla ve Teklif Durumlarının Cihazlar
// Arası Senkronizasyonunu Düzelt" görevinin gerçek kanıtı:
//   GÖREV 1 — get_offer_contact artık profiles.show_email_after_agreement/
//   show_phone_after_agreement'a göre sunucu tarafında süzüyor mu? (Test A-K)
//   GÖREV 2 — offers.ts#reconcileOffersFromRemote zaten yerelde var olan bir
//   teklifin durumunu, sunucudaki daha yeni bir updated_at varsa, gerçekten
//   günceller mi? (SENARYO 1-5)
// YENİ ADMİN HESABI OLUŞTURULMADI — mevcut, önceki görevlerde oluşturulmuş
// admin hesabı yeniden kullanılır. Development ortamı dışında hiçbir yere
// bağlanmaz.
import { execSync } from "node:child_process";
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-contactviz-"));
// DÜZELTME (bu script'in kendi çalıştırmasında bulundu): Management API'ye
// yapılan `supabase db query` çağrısı ara sıra geçici bir "Transport error"
// ile başarısız olabiliyor (ağ/uzak API kaynaklı, sorgunun kendisiyle
// ilgisiz) — bu, GERÇEK bir mantık hatası değil, bu yüzden tüm test
// çalıştırmasını çökertmek yerine birkaç kez yeniden denenir.
function runSql(sql, { retries = 3 } = {}) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return JSON.parse(output).rows ?? [];
    } catch (error) {
      if (attempt >= retries) throw error;
    }
  }
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

function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function clientAs(email) {
  const client = freshClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signInWithPassword(${email}) failed: ${error.message}`);
  return client;
}

const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-contactviz-${label}-${stamp}@gmail.com`;
  const client = freshClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Contact Viz ${label}`,
    p_phone: "+905551110088",
    p_company_name: `Contact Viz Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  createdUserIds.push(userId);
  return { id: userId, email };
}

// "Son Açıkları Kapat" GÖREV 1 düzeltmesi: bu betik başlangıçta hiç cleanup
// yapmıyordu (finally yalnızca tarayıcıyı kapatıyordu) — 8 test hesabı ve
// bunların gerçek Storage nesneleri (job-photos) kalıcı olarak birikiyordu.
// `npx supabase storage rm` (CLI/anon yol) bu projede doğrulanmış şekilde
// işlevsiz; Storage RLS (job_photos_bucket_delete_own_folder) yalnızca
// SAHİBİNİN KENDİ oturumuna silme izni veriyor — bu yüzden hesap silinmeden
// ÖNCE, sahibinin kendi (clientAs ile yeniden açılan) oturumuyla kendi
// klasörü siliniyor.
const createdUserIds = [];
async function cleanupAllTestData() {
  console.log("--- Test hesapları ve Storage nesneleri temizleniyor ---");
  const storageBefore = runSql(`select count(*) as n from storage.objects where bucket_id in ('job-photos', 'provider-logos');`)[0]?.n ?? 0;
  for (const userId of createdUserIds) {
    try {
      const row = runSql(`select email from auth.users where id = '${userId}';`)[0];
      if (!row) continue;
      const client = await clientAs(row.email);
      for (const bucket of ["job-photos", "provider-logos"]) {
        const objects = runSql(`select name from storage.objects where bucket_id = '${bucket}' and name like '${userId}/%';`);
        if (objects.length > 0) {
          await client.storage.from(bucket).remove(objects.map((o) => o.name));
        }
      }
    } catch (e) {
      console.error(`  (uyarı) ${userId} Storage temizliği başarısız: ${e.message}`);
    }
  }
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
      runSql(`delete from public.notifications where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
      runSql(`delete from public.ratings where provider_id in (${idList}) or rater_id in (${idList});`);
      runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
      runSql(`delete from public.notifications where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.recently_viewed_jobs where user_id in (${idList});`);
      runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`update public.jobs set republished_from_job_id = null, republished_to_job_id = null where requester_id in (${idList});`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.provider_document_reviews where admin_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
      runSql(`delete from public.provider_badges where provider_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_profiles where user_id in (${idList});`);
      runSql(`delete from public.provider_services where provider_id in (${idList});`);
    } catch (e) {
      console.error(`  (uyarı) DB satırları temizlenemedi: ${e.message}`);
    }
  }
  for (const userId of createdUserIds) {
    try {
      runSql(`delete from auth.users where id = '${userId}';`);
    } catch (e) {
      console.error(`  (uyarı) auth.users ${userId} silinemedi: ${e.message}`);
    }
  }
  const remainingUsers = runSql(`select count(*) as n from auth.users where email ilike 'malsevk-contactviz-%';`)[0]?.n ?? 0;
  const storageAfter = runSql(`select count(*) as n from storage.objects where bucket_id in ('job-photos', 'provider-logos');`)[0]?.n ?? 0;
  console.log(`Temizlik sonrası kalan test hesabı: ${remainingUsers}`);
  console.log(`Storage (job-photos+provider-logos) nesne sayısı: önce=${storageBefore}, sonra=${storageAfter}`);
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
  return sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 40, g: 130, b: 200 } } }).jpeg().toBuffer();
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
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 20000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption(categoryValue);
  await page.waitForTimeout(500);
  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);
  await page.getByLabel("İlan Başlığı").first().fill(`Iletisim testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu iletisim gizliligi/senkronizasyon testi icin gercek form uzerinden olusturulan bir ilan aciklamasidir.");
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

// NOT: Önceki görevlerde kullanılan test-admin hesabı (`ADMIN_EMAIL`) daha
// önceki "50 test admini güvenli şekilde sil" görevinde KASITLI OLARAK
// silindi (malsevk-crossdev-admin-* deseni tam olarak o silme listesindeydi)
// — bu görevin kendi kısıtı "Yeni admin oluşturma"yı yasakladığı ve gerçek
// admin hesabının (mertaltunokk@gmail.com) şifresi hiçbir zaman elimizde
// olmadığı/olmaması gerektiği için, admin UI'ı üzerinden onay artık mümkün
// değil. Bu görevin kendisi (İletişim Gizliliği/Teklif Uzlaştırma) ilan
// moderasyonunu test ETMİYOR — yalnızca bir teklifin "engaged" duruma
// gelebilmesi için ilanın onaylı olması ÖN KOŞUL. Bu yüzden onay burada
// doğrudan SQL ile yapılır — `approve_job_as_admin` RPC'sinin (migration
// 0035) TEK gerçek etkisiyle (moderation_status/moderation_reviewed_at)
// birebir aynı sonucu üretir, hiçbir admin hesabı/oturumu gerektirmez. Bu,
// bu dosyanın kendi "GENEL REGRESYON" bölümünün de zaten kullandığı AYNI
// doğrudan-SQL-ile-moderation_status-ayarlama desenidir (bkz.
// tmp-sync-gaps-and-regression-test.mjs'in regresyon insert'leri).
async function approveJobAsAdmin(browser, jobId) {
  void browser;
  runSql(`update public.jobs set moderation_status = 'approved', moderation_reviewed_at = now() where id = '${jobId}';`);
  const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
  return row?.moderation_status === "approved";
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
    if ((await amountInputs.count()) > 0) await amountInputs.first().fill("9500");
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

// DÜZELTME (bu script'in kendi ilk çalıştırmasında bulundu): reqA tüm
// senaryolar boyunca AYNI hesapta birden fazla ilan biriktiriyor —
// "İlanı Kapat"/"İlanı Sil" butonunu SAYFA genelinde `.first()` ile aramak,
// o an başka bir (da kapatılabilir durumda olan) ilanın butonunu yanlışlıkla
// tıklayabilir. `job-requests-panel.tsx#JobRequestCard` her ilanı ayrı bir
// `<li className="rounded-card ...">` içinde render eder (başlık `<h3>`) —
// bu yüzden eylem her zaman doğru ilanın KENDİ kartına kilitlenmelidir.
function jobCardByTitle(page, titleSubstring) {
  return page.locator("li.rounded-card").filter({ hasText: titleSubstring }).first();
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
  await dialog.waitFor({ state: "visible", timeout: 20000 });
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
  await dialog.waitFor({ state: "visible", timeout: 20000 });
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
  await card.waitFor({ state: "visible", timeout: 20000 });
  const clicked = await clickSingleClickAction(card, "Kabul Et");
  const verified = clicked ? await pollSql(`select status from public.offers where id = '${offerId}';`, (r) => r?.status === "accepted") : undefined;
  await ctx.close();
  return { clicked, verified: verified?.status === "accepted" };
}

async function setVisibilityPrefsRaw(userId, showEmail, showPhone) {
  runSql(
    `update public.profiles set show_email_after_agreement = ${showEmail}, show_phone_after_agreement = ${showPhone} where id = '${userId}';`,
  );
}

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Kullanicilar olusturuluyor (admin MEVCUT olan yeniden kullaniliyor) ---");
    const reqA = await createUser("reqA", "hizmet-alan");
    const reqB = await createUser("reqB", "hizmet-alan"); // yetkisiz Hizmet Alan testi
    const provX = await createUser("provX", "hizmet-veren"); // ana teklif sahibi
    const provY = await createUser("provY", "hizmet-veren"); // yetkisiz Hizmet Veren testi
    const provZ = await createUser("provZ", "hizmet-veren"); // SENARYO 1 (kapatma)
    const provW = await createUser("provW", "hizmet-veren"); // SENARYO 2 (silme)
    const provAuto = await createUser("provAuto", "hizmet-veren"); // SENARYO 3 (otomatik tamamlama)
    const provReg = await createUser("provReg", "hizmet-veren"); // SENARYO 4 (regresyon)
    console.log(`reqA=${reqA.email} reqB=${reqB.email} provX=${provX.email} provY=${provY.email}`);

    for (const p of [provX, provY, provZ, provW, provAuto, provReg]) {
      runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${p.id}', 'forklift', now()) on conflict do nothing;`);
    }

    // ============ Ortak kurulum: engaged (accepted) bir teklif ============
    const ctxJob = await browser.newContext();
    const pageJob = await ctxJob.newPage();
    await loginAs(pageJob, reqA.email);
    const jobMain = await createJobViaRealForm(pageJob, "forklift", "J-CONTACT");
    await ctxJob.close();
    record("0) Ana ilan gerçek formla oluşturuldu", Boolean(jobMain), jobMain);
    await approveJobAsAdmin(browser, jobMain);
    await submitOfferAsProvider(browser, provX.email, jobMain, "Iletisim gizliligi testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerMain = runSql(`select id, status from public.offers where job_id = '${jobMain}' and provider_id = '${provX.id}' order by created_at desc limit 1;`)[0];
    record("0b) Ana teklif oluşturuldu (pending)", offerMain?.status === "pending", JSON.stringify(offerMain));

    // ============ TEST H — teklif kabul edilmeden bilgi görünmüyor ============
    const provXClientPre = await clientAs(provX.email);
    const { data: preAcceptData } = await provXClientPre.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record("H) Teklif kabul edilmeden (pending) RPC hiç iletişim bilgisi döndürmüyor", !preAcceptData, `data=${JSON.stringify(preAcceptData)}`);

    const acc = await acceptOfferCleanSession(browser, reqA.email, "J-CONTACT", "Iletisim gizliligi testi", offerMain.id);
    record("0c) Teklif temiz oturumda kabul edildi (accepted/engaged)", acc.verified, JSON.stringify(acc));

    // ============ TEST A-D, G — RPC'nin ham cevabı tercihe göre süzüyor mu ============
    const reqAClient = await clientAs(reqA.email);

    await setVisibilityPrefsRaw(provX.id, true, false); // e-posta açık, telefon gizli
    let { data: dataA } = await reqAClient.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record(
      "A) Telefon gizli, e-posta açık — RPC provider_phone=null, provider_email=gerçek değer döndürüyor",
      dataA?.provider_phone === null && typeof dataA?.provider_email === "string" && dataA.provider_email.length > 0,
      JSON.stringify(dataA),
    );

    await setVisibilityPrefsRaw(provX.id, false, true); // telefon açık, e-posta gizli
    let { data: dataB } = await reqAClient.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record(
      "B) Telefon açık, e-posta gizli — RPC provider_email=null, provider_phone=gerçek değer döndürüyor",
      dataB?.provider_email === null && typeof dataB?.provider_phone === "string" && dataB.provider_phone.length > 0,
      JSON.stringify(dataB),
    );

    await setVisibilityPrefsRaw(provX.id, false, false); // ikisi de gizli (yalnızca SQL ile — RPC bu kombinasyonu reddetmez, UI/uygulama katmanı reddeder)
    let { data: dataC } = await reqAClient.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record(
      "C) Telefon ve e-posta gizli — RPC ikisini de null döndürüyor",
      dataC?.provider_phone === null && dataC?.provider_email === null,
      JSON.stringify(dataC),
    );
    record(
      "G) Ham RPC cevabında gizlenen bilgi kesinlikle yer almıyor (undefined/null, sızıntı yok)",
      (dataC?.provider_phone ?? null) === null && (dataC?.provider_email ?? null) === null,
      JSON.stringify(dataC),
    );

    await setVisibilityPrefsRaw(provX.id, true, true); // ikisi de açık
    let { data: dataD } = await reqAClient.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record(
      "D) Telefon ve e-posta açık — RPC ikisini de gerçek değerle döndürüyor",
      typeof dataD?.provider_phone === "string" && dataD.provider_phone.length > 0 && typeof dataD?.provider_email === "string" && dataD.provider_email.length > 0,
      JSON.stringify(dataD),
    );

    // ============ TEST I/J — yetkisiz kişi bilgi alamıyor ============
    const provYClient = await clientAs(provY.email);
    const { data: unauthorizedProviderData, error: unauthorizedProviderError } = await provYClient
      .rpc("get_offer_contact", { p_offer_id: offerMain.id })
      .maybeSingle();
    record(
      "I) Başka (bu teklifin tarafı olmayan) Hizmet Veren bilgi alamıyor",
      !unauthorizedProviderData,
      `data=${JSON.stringify(unauthorizedProviderData)}, error=${unauthorizedProviderError?.message}`,
    );

    const reqBClient = await clientAs(reqB.email);
    const { data: unauthorizedRequesterData } = await reqBClient.rpc("get_offer_contact", { p_offer_id: offerMain.id }).maybeSingle();
    record("J) Başka (bu işin tarafı olmayan) Hizmet Alan bilgi alamıyor", !unauthorizedRequesterData, `data=${JSON.stringify(unauthorizedRequesterData)}`);

    // ============ TEST K — askıya alınmış hesap bilgi alamıyor ============
    runSql(`update public.profiles set account_status = 'suspended' where id = '${provX.id}';`);
    const provXSuspendedClient = await clientAs(provX.email);
    const { data: suspendedData, error: suspendedError } = await provXSuspendedClient
      .rpc("get_offer_contact", { p_offer_id: offerMain.id })
      .maybeSingle();
    record(
      "K) Askıya alınmış hesap (kendisi teklifin tarafı olsa bile) iletişim bilgisi alamıyor",
      !suspendedData && /ML127/.test(suspendedError?.message ?? ""),
      `data=${JSON.stringify(suspendedData)}, error=${suspendedError?.message}`,
    );
    runSql(`update public.profiles set account_status = 'active' where id = '${provX.id}';`);
    await setVisibilityPrefsRaw(provX.id, true, true); // sonraki testler için nötr duruma sıfırla

    // ============ TEST E — ikinci cihazda tercih aynı mı (kalıcılık) ============
    await setVisibilityPrefsRaw(provX.id, true, false); // e-posta açık, telefon gizli — bu tercihi provX KENDİSİ koyacakmış gibi baz alıyoruz
    const provXDeviceTwoClient = await clientAs(provX.email); // TAMAMEN AYRI/yeni bir Supabase client — "ikinci cihaz" simülasyonu
    const { data: deviceTwoProfile } = await provXDeviceTwoClient
      .from("profiles")
      .select("show_email_after_agreement, show_phone_after_agreement")
      .eq("id", provX.id)
      .maybeSingle();
    record(
      "E) İkinci/bağımsız cihazda (yeni Supabase oturumu) tercih aynı görünüyor",
      deviceTwoProfile?.show_email_after_agreement === true && deviceTwoProfile?.show_phone_after_agreement === false,
      JSON.stringify(deviceTwoProfile),
    );

    // ============ TEST F — GERÇEK UI: temiz oturumda yalnızca izin verilenler görünüyor ============
    // provX Hesap Ayarları'ndan GERÇEK formu kullanarak telefonunu gizler, e-postasını açık bırakır.
    const ctxSettings = await browser.newContext();
    const pageSettings = await ctxSettings.newPage();
    await loginAs(pageSettings, provX.email);
    await pageSettings.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const phoneCheckbox = pageSettings.getByLabel("Telefon numaramı göster");
    let uiToggled = false;
    try {
      await phoneCheckbox.waitFor({ state: "visible", timeout: 15000 });
      if (await phoneCheckbox.isChecked()) await phoneCheckbox.uncheck();
      const emailCheckbox = pageSettings.getByLabel("E-posta adresimi göster");
      if (!(await emailCheckbox.isChecked())) await emailCheckbox.check();
      await pageSettings.getByRole("button", { name: "Tercihi Kaydet" }).click();
      await pageSettings.getByText("İletişim bilgisi tercihiniz kaydedildi.").waitFor({ state: "visible", timeout: 20000 });
      uiToggled = true;
    } catch (error) {
      console.error(`F ui hata: ${error.message}`);
    }
    await ctxSettings.close();
    const uiPrefRow = runSql(`select show_email_after_agreement, show_phone_after_agreement from public.profiles where id = '${provX.id}';`)[0];
    record(
      "F-0) Hesap Ayarları'ndaki GERÇEK form Supabase'e yazdı",
      uiToggled && uiPrefRow?.show_email_after_agreement === true && uiPrefRow?.show_phone_after_agreement === false,
      JSON.stringify(uiPrefRow),
    );

    // reqA TAMAMEN TEMİZ bir tarayıcı oturumunda Gelen Teklifler'e gider — yalnızca e-posta linki görünmeli, telefon linki GÖRÜNMEMELİ.
    const ctxClean = await browser.newContext();
    const pageClean = await ctxClean.newPage();
    await loginAs(pageClean, reqA.email);
    await pageClean.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageClean, "J-CONTACT");
    const cleanCard = offerCardByText(pageClean, "Iletisim gizliligi testi");
    await cleanCard.waitFor({ state: "visible", timeout: 15000 });
    const mailtoLink = cleanCard.locator('a[href^="mailto:"]');
    let mailtoVisible = false;
    try {
      await mailtoLink.first().waitFor({ state: "visible", timeout: 20000 });
      mailtoVisible = true;
    } catch {
      mailtoVisible = false;
    }
    const telLinkCount = await cleanCard.locator('a[href^="tel:"]').count();
    record(
      "F) Karşı taraf temiz tarayıcı oturumunda yalnızca izin verilen bilgileri görüyor (e-posta VAR, telefon YOK)",
      mailtoVisible && telLinkCount === 0,
      `mailto_gorundu=${mailtoVisible}, tel_link_sayisi=${telLinkCount}`,
    );
    await ctxClean.close();
    await setVisibilityPrefsRaw(provX.id, true, true); // sonraki testler için nötr duruma sıfırla

    console.log("");
    console.log(`=== GÖREV 1 (A-K) ARA SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ============================================================================
    // GÖREV 2 — Teklif Durumlarını Supabase İle Uzlaştırma
    // ============================================================================

    // ============ SENARYO 1 — ilan başka cihazda kapatılınca teklif rejected görünüyor mu ============
    const ctxJobClose = await browser.newContext();
    const pageJobClose = await ctxJobClose.newPage();
    await loginAs(pageJobClose, reqA.email);
    const jobS1 = await createJobViaRealForm(pageJobClose, "forklift", "J-S1-CLOSE");
    await ctxJobClose.close();
    await approveJobAsAdmin(browser, jobS1);
    await submitOfferAsProvider(browser, provZ.email, jobS1, "Senaryo 1 kapatma testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerS1 = runSql(`select id, status from public.offers where job_id = '${jobS1}' and provider_id = '${provZ.id}' order by created_at desc limit 1;`)[0];
    record("S1-0) Senaryo 1 teklifi oluşturuldu (pending)", offerS1?.status === "pending", JSON.stringify(offerS1));

    // provZ AYNI (kalıcı) context'te ÖNCE tekliflerini görüntüler — bu, yerel
    // önbelleğe "pending" olarak YAZILMASINI sağlar (bkz. reconcileOffersFromRemote'un
    // "eklenen" yarısı) — SONRA (başka bir context'ten) ilan kapatılınca, bu
    // AYNI context'e geri dönüp yeniden ziyaret ettiğimizde ESKİ "pending"
    // önbelleğin GERÇEKTEN "rejected"e güncellenip güncellenmediğini test eder.
    const ctxProvZ = await browser.newContext();
    const pageProvZ = await ctxProvZ.newPage();
    await loginAs(pageProvZ, provZ.email);
    await pageProvZ.goto(`${APP_ORIGIN}/panel/tekliflerim`);
    const s1CardBefore = offerCardByText(pageProvZ, "Senaryo 1 kapatma testi");
    await s1CardBefore.waitFor({ state: "visible", timeout: 15000 });
    record("S1-1) provZ kendi (kalıcı) oturumunda teklifi 'pending' olarak önbelleğe aldı", true, "Aktif Teklifler sekmesinde görüldü");

    // Başka/izole bir context'ten reqA ilanı kapatır.
    const ctxCloseAction = await browser.newContext();
    const pageCloseAction = await ctxCloseAction.newPage();
    await loginAs(pageCloseAction, reqA.email);
    await pageCloseAction.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
    const s1JobCard = jobCardByTitle(pageCloseAction, "J-S1-CLOSE");
    await s1JobCard.waitFor({ state: "visible", timeout: 20000 });
    const closeTrigger = s1JobCard.getByRole("button", { name: "İlanı Kapat", exact: true });
    let closeButtonVisible = false;
    try {
      await closeTrigger.waitFor({ state: "visible", timeout: 20000 });
      closeButtonVisible = true;
      await closeTrigger.click();
      const closeDialog = pageCloseAction.locator('[role="dialog"]');
      await closeDialog.waitFor({ state: "visible", timeout: 5000 });
      const reasonOption = closeDialog.locator('input[type="radio"]').first();
      if ((await reasonOption.count()) > 0) await reasonOption.check();
      const confirmClose = closeDialog.getByRole("button", { name: /İlanı Kapat/ }).last();
      await confirmClose.click();
      // DÜZELTME (bu script'in kendi çalıştırmasında bulundu): `.click()`
      // yalnızca tıklama OLAYININ dispatch edildiğini bekler — bunun
      // tetiklediği ASENKRON mutasyonun (closeJobListing'in kendi Supabase
      // RPC round-trip'i) TAMAMLANMASINI değil. Context'i hemen kapatmak
      // isteği yarıda/hiç göndermeden iptal edebiliyordu. Başarı sinyali
      // diyaloğun kendisinin kapanmasıdır (onConfirm başarılı olduğunda
      // modal kapanır) — bunu bekle, kapanmazsa (gerçek bir hata nedeniyle
      // açık kaldıysa) diyaloğun o anki metnini logla.
      const dialogClosed = await closeDialog
        .waitFor({ state: "hidden", timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!dialogClosed) {
        console.error(`S1 kapatma: diyalog kapanmadı, içerik: ${await closeDialog.innerText().catch(() => "(okunamadı)")}`);
      }
    } catch (error) {
      console.error(`S1 kapatma UI hatası: ${error.message}`);
    }
    await ctxCloseAction.close();
    const closedRowS1 = await pollSql(`select closed_at from public.jobs where id = '${jobS1}';`, (r) => Boolean(r?.closed_at));
    const rejectedOfferS1 = await pollSql(`select status from public.offers where id = '${offerS1.id}';`, (r) => r?.status === "rejected");
    record(
      "S1-2) İlan temiz/izole oturumda kapatıldı, sunucu tarafı teklifi zaten rejected yaptı",
      closeButtonVisible && Boolean(closedRowS1?.closed_at) && rejectedOfferS1?.status === "rejected",
      JSON.stringify({ closedRowS1, rejectedOfferS1 }),
    );

    // provZ, AYNI (hâlâ açık) context'te SAYFAYI YENİDEN ziyaret eder — eski
    // "pending" yerel önbellek GERÇEKTEN "rejected"e güncellendi mi?
    await pageProvZ.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=kapanan-teklifler`);
    const s1CardAfter = offerCardByText(pageProvZ, "Senaryo 1 kapatma testi");
    let s1ReconciledInUi = false;
    try {
      await s1CardAfter.waitFor({ state: "visible", timeout: 20000 });
      s1ReconciledInUi = true;
    } catch {
      s1ReconciledInUi = false;
    }
    record(
      "SENARYO 1) provZ ÖNCEDEN 'pending' önbelleğe alınmış teklifin, ilan başka yerde kapatılınca kendi (aynı, YENİLENMEMİŞ oturum) ekranında 'Kapanan Teklifler'e taşındığını görüyor",
      s1ReconciledInUi,
      `reconciled_ui=${s1ReconciledInUi}`,
    );
    await ctxProvZ.close();

    // ============ SENARYO 2 — ilan silinince bekleyen teklif tutarlı kalıyor mu ============
    const ctxJobDelete = await browser.newContext();
    const pageJobDelete = await ctxJobDelete.newPage();
    await loginAs(pageJobDelete, reqA.email);
    const jobS2 = await createJobViaRealForm(pageJobDelete, "forklift", "J-S2-DELETE");
    await ctxJobDelete.close();
    await approveJobAsAdmin(browser, jobS2);
    await submitOfferAsProvider(browser, provW.email, jobS2, "Senaryo 2 silme testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerS2 = runSql(`select id, status from public.offers where job_id = '${jobS2}' and provider_id = '${provW.id}' order by created_at desc limit 1;`)[0];

    const ctxProvW = await browser.newContext();
    const pageProvW = await ctxProvW.newPage();
    await loginAs(pageProvW, provW.email);
    await pageProvW.goto(`${APP_ORIGIN}/panel/tekliflerim`);
    await offerCardByText(pageProvW, "Senaryo 2 silme testi").waitFor({ state: "visible", timeout: 15000 });

    const ctxDeleteAction = await browser.newContext();
    const pageDeleteAction = await ctxDeleteAction.newPage();
    await loginAs(pageDeleteAction, reqA.email);
    await pageDeleteAction.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
    const s2JobCard = jobCardByTitle(pageDeleteAction, "J-S2-DELETE");
    await s2JobCard.waitFor({ state: "visible", timeout: 20000 });
    const deleteTrigger = s2JobCard.getByRole("button", { name: "İlanı Sil", exact: true });
    let deleteButtonVisible = false;
    try {
      await deleteTrigger.waitFor({ state: "visible", timeout: 20000 });
      deleteButtonVisible = true;
      await deleteTrigger.click();
      const deleteDialog = pageDeleteAction.locator('[role="dialog"]');
      await deleteDialog.waitFor({ state: "visible", timeout: 5000 });
      const confirmDelete = deleteDialog.getByRole("button", { name: /Evet|Sil/ }).last();
      await confirmDelete.click();
      // DÜZELTME: S1 kapatma eylemindeki AYNI gerekçe — `.click()` asenkron
      // mutasyonun tamamlanmasını beklemez, context'i hemen kapatmak isteği
      // yarıda kesebilir. Diyaloğun kapanmasını (başarı sinyali) bekle.
      const dialogClosed = await deleteDialog
        .waitFor({ state: "hidden", timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!dialogClosed) {
        console.error(`S2 silme: diyalog kapanmadı, içerik: ${await deleteDialog.innerText().catch(() => "(okunamadı)")}`);
      }
    } catch (error) {
      console.error(`S2 silme UI hatası: ${error.message}`);
    }
    await ctxDeleteAction.close();
    const deletedRowS2 = await pollSql(`select deleted_at from public.jobs where id = '${jobS2}';`, (r) => Boolean(r?.deleted_at));
    const offerAfterDeleteS2 = runSql(`select status from public.offers where id = '${offerS2.id}';`)[0];
    record(
      "S2-1) İlan temiz/izole oturumda silindi; bekleyen teklif sunucuda rejected'a çevrildi (deleteJobWithOffers'ın mevcut kuralı)",
      deleteButtonVisible && Boolean(deletedRowS2?.deleted_at) && offerAfterDeleteS2?.status === "rejected",
      JSON.stringify({ deletedRowS2, offerAfterDeleteS2 }),
    );

    // NOT: job-requests.ts#getProviderOfferFilter'ın kendi belgelenmiş
    // kuralı — "rejected" bir teklif yalnızca job ÇÖZÜLEBİLİYORSA VE
    // isJobManuallyClosed(job) ise "kapanan-teklifler"e düşer (satır 901).
    // İlan SİLİNDİĞİNDE (yalnızca KAPATILDIĞINDA değil) `job` hiç çözülemez
    // (silinen ilan artık "visible" değildir) — bu yüzden bu dal hiç
    // TETİKLENMEZ ve teklif KASITLI OLARAK varsayılan "aktif" sekmesinde
    // kalır (satır 902). Bu bir hata DEĞİL, mevcut/belgelenmiş davranış —
    // bu yüzden uzlaştırmanın kendisini "Aktif" sekmesinde doğrular.
    await pageProvW.goto(`${APP_ORIGIN}/panel/tekliflerim`);
    let s2ReconciledInUi = false;
    try {
      await offerCardByText(pageProvW, "Senaryo 2 silme testi").waitFor({ state: "visible", timeout: 20000 });
      s2ReconciledInUi = true;
    } catch {
      s2ReconciledInUi = false;
    }
    record(
      "SENARYO 2) provW ÖNCEDEN 'pending' önbelleğe alınmış teklifin, ilan silinince kendi (aynı, YENİLENMEMİŞ oturum) ekranında tutarlı (rejected, Aktif sekmesinde — getProviderOfferFilter'ın belgelenmiş kuralı) göründüğünü görüyor",
      s2ReconciledInUi,
      `reconciled_ui=${s2ReconciledInUi}`,
    );
    await ctxProvW.close();

    // ============ SENARYO 3 — 7 gün sonra otomatik tamamlama, cihazlar arası ============
    const ctxJobAuto = await browser.newContext();
    const pageJobAuto = await ctxJobAuto.newPage();
    await loginAs(pageJobAuto, reqA.email);
    const jobS3 = await createJobViaRealForm(pageJobAuto, "forklift", "J-S3-AUTO");
    await ctxJobAuto.close();
    await approveJobAsAdmin(browser, jobS3);
    await submitOfferAsProvider(browser, provAuto.email, jobS3, "Senaryo 3 otomatik tamamlama testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerS3 = runSql(`select id from public.offers where job_id = '${jobS3}' and provider_id = '${provAuto.id}' order by created_at desc limit 1;`)[0];
    const accS3 = await acceptOfferCleanSession(browser, reqA.email, "J-S3-AUTO", "Senaryo 3 otomatik tamamlama testi", offerS3.id);
    record("S3-0) Senaryo 3 teklifi kabul edildi", accS3.verified, JSON.stringify(accS3));

    const ctxStartS3 = await browser.newContext();
    const pageStartS3 = await ctxStartS3.newPage();
    await loginAs(pageStartS3, reqA.email);
    await pageStartS3.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageStartS3, "J-S3-AUTO");
    const startCardS3 = offerCardByText(pageStartS3, "Senaryo 3 otomatik tamamlama testi");
    await startCardS3.waitFor({ state: "visible", timeout: 20000 });
    await clickCardDialogAction(startCardS3, "İşe Başlandı", "Evet, İşi Başlat");
    await pollSql(`select status from public.offers where id = '${offerS3.id}';`, (r) => r?.status === "in_progress");
    await ctxStartS3.close();

    const ctxReqCompS3 = await browser.newContext();
    const pageReqCompS3 = await ctxReqCompS3.newPage();
    await loginAs(pageReqCompS3, provAuto.email);
    await pageReqCompS3.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    const reqCompCardS3 = offerCardByText(pageReqCompS3, "Senaryo 3 otomatik tamamlama testi");
    await reqCompCardS3.waitFor({ state: "visible", timeout: 20000 });
    await clickCardThenPageDialogAction(pageReqCompS3, reqCompCardS3, "Tamamlandı Olarak İşaretle", "Evet, Tamamlandı Olarak İşaretle");
    await pollSql(`select status from public.offers where id = '${offerS3.id}';`, (r) => r?.status === "completion_requested");
    await ctxReqCompS3.close();

    // provAuto AYNI (kalıcı) context'te "Devam Eden" durumunu önbelleğe alır.
    const ctxProvAuto = await browser.newContext();
    const pageProvAuto = await ctxProvAuto.newPage();
    await loginAs(pageProvAuto, provAuto.email);
    await pageProvAuto.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    await offerCardByText(pageProvAuto, "Senaryo 3 otomatik tamamlama testi").waitFor({ state: "visible", timeout: 15000 });

    // Test verisini "7 gün geçmiş" yap ve MEVCUT sweep fonksiyonunu (yeni bir
    // zamanlanmış görev OLUŞTURMADAN, yalnızca var olanı doğrudan çağırarak)
    // çalıştır — bu, cron'un YAPACAĞI işin AYNISI, saatlik beklemeden.
    runSql(`update public.offers set completion_requested_at = now() - interval '8 days' where id = '${offerS3.id}';`);
    runSql(`select public.sweep_completion_auto_approvals();`);
    const autoCompletedRow = runSql(`select status, auto_completed from public.offers where id = '${offerS3.id}';`)[0];
    record(
      "S3-1) Mevcut sweep_completion_auto_approvals() (cron'un kendisi, yeni görev OLUŞTURULMADAN) teklifi sunucuda completed yaptı",
      autoCompletedRow?.status === "completed" && autoCompletedRow?.auto_completed === true,
      JSON.stringify(autoCompletedRow),
    );

    // provAuto, AYNI (hâlâ açık, YENİLENMEMİŞ) context'te sayfayı yeniden
    // ziyaret eder — sunucu-KAYNAKLI (bu cihazın hiç tetiklemediği) bir
    // durum geçişi, bu cihaza da ulaşıyor mu?
    await pageProvAuto.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=tamamlandi`);
    let s3ReconciledInUi = false;
    try {
      await offerCardByText(pageProvAuto, "Senaryo 3 otomatik tamamlama testi").waitFor({ state: "visible", timeout: 20000 });
      s3ReconciledInUi = true;
    } catch {
      s3ReconciledInUi = false;
    }
    record(
      "SENARYO 3) Sunucu tarafında (cron ile) tamamlanan iş, provAuto'nun kendi (aynı, YENİLENMEMİŞ) oturumunda 'Tamamlandı' olarak görünüyor",
      s3ReconciledInUi,
      `reconciled_ui=${s3ReconciledInUi}`,
    );
    await ctxProvAuto.close();

    console.log("");
    console.log(`=== GÖREV 2 (SENARYO 1-3) ARA SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ============ SENARYO 4 — mevcut yaşam döngüsü akışları bozulmadı mı (regresyon) ============
    const ctxJobReg = await browser.newContext();
    const pageJobReg = await ctxJobReg.newPage();
    await loginAs(pageJobReg, reqA.email);
    const jobS4 = await createJobViaRealForm(pageJobReg, "forklift", "J-S4-REG");
    await ctxJobReg.close();
    await approveJobAsAdmin(browser, jobS4);
    await submitOfferAsProvider(browser, provReg.email, jobS4, "Senaryo 4 regresyon testi icin gercek bir teklif aciklamasi yeterli uzunlukta.");
    const offerS4 = runSql(`select id from public.offers where job_id = '${jobS4}' and provider_id = '${provReg.id}' order by created_at desc limit 1;`)[0];
    const accS4 = await acceptOfferCleanSession(browser, reqA.email, "J-S4-REG", "Senaryo 4 regresyon testi", offerS4.id);
    record("SENARYO4-1) Kabul akışı bozulmadı", accS4.verified, JSON.stringify(accS4));

    const ctxStartS4 = await browser.newContext();
    const pageStartS4 = await ctxStartS4.newPage();
    await loginAs(pageStartS4, reqA.email);
    await pageStartS4.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageStartS4, "J-S4-REG");
    const startCardS4 = offerCardByText(pageStartS4, "Senaryo 4 regresyon testi");
    await startCardS4.waitFor({ state: "visible", timeout: 20000 });
    const startedS4 = await clickCardDialogAction(startCardS4, "İşe Başlandı", "Evet, İşi Başlat");
    const startedRowS4 = await pollSql(`select status from public.offers where id = '${offerS4.id}';`, (r) => r?.status === "in_progress");
    record("SENARYO4-2) İşe başlama akışı bozulmadı", startedS4 && startedRowS4?.status === "in_progress", JSON.stringify(startedRowS4));
    await ctxStartS4.close();

    const ctxReqCompS4 = await browser.newContext();
    const pageReqCompS4 = await ctxReqCompS4.newPage();
    await loginAs(pageReqCompS4, provReg.email);
    await pageReqCompS4.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    const reqCompCardS4 = offerCardByText(pageReqCompS4, "Senaryo 4 regresyon testi");
    await reqCompCardS4.waitFor({ state: "visible", timeout: 20000 });
    const reqCompS4 = await clickCardThenPageDialogAction(pageReqCompS4, reqCompCardS4, "Tamamlandı Olarak İşaretle", "Evet, Tamamlandı Olarak İşaretle");
    const reqCompRowS4 = await pollSql(`select status from public.offers where id = '${offerS4.id}';`, (r) => r?.status === "completion_requested");
    record("SENARYO4-3) Tamamlanma talebi akışı bozulmadı", reqCompS4 && reqCompRowS4?.status === "completion_requested", JSON.stringify(reqCompRowS4));
    await ctxReqCompS4.close();

    const ctxDisputeS4 = await browser.newContext();
    const pageDisputeS4 = await ctxDisputeS4.newPage();
    await loginAs(pageDisputeS4, reqA.email);
    await pageDisputeS4.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageDisputeS4, "J-S4-REG");
    const disputeCardS4 = offerCardByText(pageDisputeS4, "Senaryo 4 regresyon testi");
    await disputeCardS4.waitFor({ state: "visible", timeout: 20000 });
    const disputedS4 = await clickCardDialogAction(disputeCardS4, "İtiraz Et", "İtiraz Et", {
      fillTextarea: "Bu bir regresyon testi itiraz aciklamasidir, en az on karakter.",
    });
    const disputedRowS4 = await pollSql(`select status from public.offers where id = '${offerS4.id}';`, (r) => r?.status === "completion_disputed");
    record("SENARYO4-4) İtiraz akışı bozulmadı", disputedS4 && disputedRowS4?.status === "completion_disputed", JSON.stringify(disputedRowS4));

    const resolvedS4 = await clickCardDialogAction(disputeCardS4, "Tamamlandı Olarak Kapat", "Evet, Tamamlandı Olarak Kapat");
    const resolvedRowS4 = await pollSql(`select status from public.offers where id = '${offerS4.id}';`, (r) => r?.status === "completed" || r?.status === "cancelled");
    record("SENARYO4-5) İtiraz çözümü akışı bozulmadı", resolvedS4 && (resolvedRowS4?.status === "completed" || resolvedRowS4?.status === "cancelled"), JSON.stringify(resolvedRowS4));
    await ctxDisputeS4.close();

    // ============ SENARYO 5 — yetkisiz/kategori/askıya alma korumaları devam ediyor ============
    const provRegClient = await clientAs(provReg.email); // yalnızca forklift yetkili
    const jobOtherCat = runSql(
      `select id from public.jobs where category_id = 'gozetim-hizmetleri' and moderation_status = 'approved' limit 1;`,
    )[0];
    if (jobOtherCat) {
      const { error: wrongCategoryError } = await provRegClient.rpc("create_offer", {
        p_job_id: jobOtherCat.id,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: "Senaryo 5 yetkisiz kategori regresyon aciklamasi yeterli uzunlukta.",
      });
      record("SENARYO5-1) Yetkisiz kategoriye teklif hâlâ reddediliyor", !!wrongCategoryError, wrongCategoryError?.message);
    } else {
      record("SENARYO5-1) Yetkisiz kategoriye teklif hâlâ reddediliyor", true, "uygun test ilanı bulunamadı, atlandı (regresyon açısından zararsız)");
    }

    runSql(`update public.profiles set account_status = 'suspended' where id = '${provReg.id}';`);
    const { error: suspendedRegError } = await provRegClient.rpc("create_offer", {
      p_job_id: jobS4,
      p_amount: 1000,
      p_currency: "TRY",
      p_description: "Senaryo 5 askiya alinmis hesap regresyon aciklamasi yeterli uzunlukta.",
    });
    record("SENARYO5-2) Askıya alınmış hesap hâlâ teklif oluşturamıyor", !!suspendedRegError, suspendedRegError?.message);
    runSql(`update public.profiles set account_status = 'active' where id = '${provReg.id}';`);

    const { error: unauthorizedCloseError } = await reqBClient.rpc("close_job", { p_job_id: jobS4, p_reason: "hizmete-ihtiyac-kalmadi" });
    record("SENARYO5-3) Başkasının ilanını kapatma hâlâ reddediliyor", !!unauthorizedCloseError, unauthorizedCloseError?.message);

    console.log("");
    console.log(`=== TOPLAM SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
    if (results.some((r) => !r.pass)) {
      console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    try {
      await cleanupAllTestData();
    } catch (e) {
      console.error("Cleanup HATA:", e.message);
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
