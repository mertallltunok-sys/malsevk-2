// node scripts/tmp-supabase-offer-lifecycle-regression-test.mjs
//
// Development ortamındaki HOSTED Supabase projesine (trfnmpihcnriqgikglpu)
// karşı, GERÇEK Supabase Auth hesaplarıyla uçtan uca teklif yaşam döngüsü
// regresyonu: ilan oluştur -> teklif ver -> kabul et -> işe başla ->
// tamamlandı işaretle -> onayla -> değerlendir -> nihai sekmeler.
//
// Akışın kendisi (offers.ts/ratings.ts) hâlâ localStorage'dır — burada
// GERÇEKTEN doğrulanan şey bu iş mantığının bu oturumda YAPILAN HİÇBİR
// DEĞİŞİKLİKTEN etkilenmediğidir (regresyon yok). UI adımları/buton
// metinleri scripts/tmp-e2e-regression-offer-lifecycle-test.mjs'den (yerel
// Docker hedefli, önceki oturumda kanıtlanmış) doğrudan alındı; BURADA
// hosted dev projeye ve .env.local'daki gerçek anon key'e uyarlandı.
//
// NOT (bu oturumda GERÇEK HEIC testinde bulunan ve düzeltilen aynı tuzak):
// başlığa/açıklamaya ham Date.now() gibi uzun ardışık rakam dizisi
// eklenirse containsDirectContactInfo (contact-leak-detection.ts) onu
// telefon numarası sanıp gönderimi GERÇEKTEN engeller — bu bir app bug'ı
// DEĞİL. Bu yüzden burada da base36 etiket kullanılıyor.
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

async function makeRealAccount(label, role) {
  const email = `malsevk-offere2e-${label}-${stamp}@gmail.com`;
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

// "Service Authorization" (Hizmet Bazlı Provider Yetkilendirmesi, 0038) —
// bir provider, admin tarafından o kategori için AÇIKÇA yetkilendirilene
// kadar ilgili kategorideki ilanları hiç göremez/teklif veremez
// (job-visibility.ts#resolveVisibility). Bu, gerçek bir güvenlik özelliği
// (bug DEĞİL) — test kurulumunda, gerçek belge-onay akışını simüle etmek
// yerine (kapsam dışı), doğrudan SQL ile provider_service_authorizations
// tablosuna yetki satırı eklenir (0041'in kendi backfill DML'iyle AYNI
// desen: RPC yerine doğrudan INSERT, çünkü service_role ile auth.uid()
// NULL döner ve authorize_provider_service RPC'sinin is_admin() kontrolü
// bu bağlamda geçerli bir admin oturumu bulamaz).
async function authorizeProviderForCategory(providerId, categoryId) {
  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const sqlPath = path.join(tmpdir(), `offer-e2e-authorize-${Date.now()}.sql`);
  writeFileSync(
    sqlPath,
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorize_reason) values ('${providerId}', '${categoryId}', 'e2e regresyon testi kurulumu');`,
  );
  execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" });
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

// "İlan Moderasyonu" (0035) — job-detail-content.tsx satır ~506:
// `isVisible = useIsJobVisibleToSession(...) && isJobVisibleForModeration(session, job)`.
// Yeni oluşturulan HER ilan `moderationStatus: "pending_review"` ile
// başlar (create_job/createJob) ve bir ADMİN onaylayana kadar sahibi
// DIŞINDA kimseye (dolayısıyla OfferPanel'e de) görünmez — bu GERÇEK,
// kasıtlı bir davranış (bug DEĞİL). Gerçek admin hesabını KULLANMADAN
// (görev talimatı: gerçek admini test eylemleri için kullanma/değiştirme)
// test kurulumunda, tarayıcının KENDİ localStorage'ındaki job kaydı
// doğrudan "approved" olarak işaretlenir — job-store.ts'in localStorage
// anahtarını (`malsevk.jobs.v1`) ve Job şeklini birebir taklit eder, ayrı
// bir sahte/paralel mekanizma DEĞİL.
async function approveJobInLocalStorage(page, jobId) {
  const patched = await page.evaluate((id) => {
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
  return patched;
}

// create_offer RPC'sinin KENDİSİ de moderation_status <> 'approved' iken
// MLK60 ile reddediyor (bkz. "İlan Moderasyonu" — create_offer bu korumayı
// jobs_select_visible RLS'iyle AYNI kodu paylaşarak taşıyor). Yerel
// localStorage yaması TEK BAŞINA yeterli değil — teklif oluşturma artık
// GERÇEKTEN Supabase'e de dual-write yapıyor (supabase-offer-sync.ts), bu
// yüzden GERÇEK Supabase satırı da onaylanmalı. Aynı "test kurulumunda
// doğrudan SQL, RPC'nin is_admin() kontrolünü atla" deseni.
async function approveJobInSupabase(jobId) {
  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const sqlPath = path.join(tmpdir(), `offer-e2e-approve-job-${Date.now()}.sql`);
  writeFileSync(
    sqlPath,
    `update public.jobs set moderation_status = 'approved' where id = '${jobId}';` +
      `select id, moderation_status from public.jobs where id = '${jobId}';`,
  );
  const out = execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" }).toString();
  return out.includes('"approved"');
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

let jobId = null;

async function main() {
  console.log("=== Kurulum: gerçek Supabase Auth hesapları (requester + provider) ===");
  const requester = await makeRealAccount("requester", "hizmet-alan");
  const provider = await makeRealAccount("provider", "hizmet-veren");
  check("setup: requester + provider hesapları oluşturuldu", !!requester.id && !!provider.id);
  await authorizeProviderForCategory(provider.id, "forklift");
  check("setup: provider 'forklift' kategorisi için yetkilendirildi", true);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    console.log("\n=== 1) Requester GERÇEK UI ile bir Forklift ilanı oluşturuyor ===");
    const jobTitle = `E2E Teklif Akışı Testi ${uniqueTag}`;
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Forklift" });
    await page.getByLabel("İlan Başlığı").fill(jobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Teklif akışı uçtan uca regresyon testi için oluşturuldu.");
    // NOT: "Forklift" Liman Hizmetleri/Nakliye kapsamında DEĞİL, bu yüzden
    // requiresProductInfo(category) false döner ve Ürün Adedi/Ürün Cinsi
    // alanları HİÇ render edilmez (bkz. product-catalog.ts) — bilerek
    // doldurulmuyor (önceki bir denemede bunları doldurmaya çalışmak
    // gerçek bir app bug'ı DEĞİL, bu test script'inin kendi hatasıydı).
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
    if (!reachedPreview) {
      const invalidEls = await page.locator('[aria-invalid="true"]').all();
      console.log(`DEBUG: aria-invalid alan sayısı: ${invalidEls.length}`);
      for (const el of invalidEls) {
        const describedBy = await el.getAttribute("aria-describedby");
        const errorText = describedBy ? await page.locator(`#${describedBy}`).innerText().catch(() => "") : "";
        console.log(`  - aria-describedby=${describedBy} => "${errorText}"`);
      }
    }
    check("1a. Operasyon Önizlemesine ulaşıldı (form doğrulandı)", reachedPreview);
    if (!reachedPreview) throw new Error("İlan formu doğrulanamadı, akış devam edemez.");
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    jobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("1b. İlan oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());

    const moderationPatched = await approveJobInLocalStorage(page, jobId);
    check("1c. Test kurulumu: ilan moderasyon onayı yerel olarak işaretlendi", moderationPatched);
    await page.waitForTimeout(2500); // Supabase job senkronunun tamamlanması için (best-effort dual-write).
    const supabaseModerationPatched = await approveJobInSupabase(jobId);
    check("1d. Test kurulumu: GERÇEK Supabase ilanı da onaylandı (create_offer RPC'si moderation_status kontrolü yapıyor)", supabaseModerationPatched);

    console.log("\n=== 2) Provider AYNI ilana teklif veriyor ===");
    await loginAs(page, provider.email);
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // NOT: alan etiketi GERÇEKTEN "Teklif Tutarı"dır (offer-form.tsx:157) —
    // "Teklif Fiyatı" (önceki denemede kullanılan) ARTIK GEÇERSİZ bir etiket,
    // gerçek bir app bug'ı DEĞİL (bkz. dosyanın kendi yorumu: "Para Birimi" +
    // "Teklif Fiyatı" ayrı alanları GEÇMİŞTE "Teklif Tutarı" olarak
    // birleştirildi). Sayfa dökümüyle doğrulandı: form GERÇEKTEN görünüyor.
    const offerFieldVisible = await page.getByLabel("Teklif Tutarı").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    if (!offerFieldVisible) {
      console.log("--- DEBUG: 'Teklif Tutarı' görünmüyor - sayfa metni ---");
      console.log((await page.locator("main").innerText()).slice(0, 3000));
      throw new Error("Teklif formu görünmüyor - akış devam edemez.");
    }
    await page.getByLabel("Teklif Tutarı").fill("7500");
    await page.getByLabel("Teklif Açıklaması").fill("Bu teklif e2e regresyon testi tarafından oluşturulmuştur, en az yirmi karakter içerir.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    const offerSubmitted = await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    if (!offerSubmitted) {
      console.log("--- DEBUG: teklif gönderim onayı görünmedi - sayfa metni ---");
      console.log((await page.locator("main").innerText()).slice(0, 3000));
    }
    check("2a. Teklif başarıyla gönderildi", offerSubmitted);
    if (!offerSubmitted) throw new Error("Teklif gönderilemedi - akış devam edemez.");

    console.log("\n=== 3) Requester teklifi görüyor ve kabul ediyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("3a. Gelen Teklifler'de ilan/teklif görünüyor", true);
    let card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(600);
    check("3b. Teklif kabul edildi (sayfa hatasız devam ediyor)", jsErrors.length === 0, jsErrors.join(" | "));

    console.log("\n=== 4) Requester işe başlandığını işaretliyor ===");
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşi Başlat" }).click();
    await page.waitForTimeout(600);
    check("4a. İşe başlandı olarak işaretlendi", true);

    console.log("\n=== 5) Provider tamamlandı olarak işaretliyor (completion request) ===");
    await loginAs(page, provider.email);
    await page.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
    await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
    await page.waitForTimeout(600);
    check("5a. Provider tamamlama talebini gönderdi", true);

    console.log("\n=== 6) Requester tamamlandığını onaylıyor + değerlendirme modalı açılıyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
    await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
    await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });
    check("6a. Tamamlama onaylandı ve değerlendirme modalı otomatik açıldı", true);

    const stars = page.getByRole("radio", { name: /yıldız/ });
    check("6b. Tam olarak 5 yıldız seçeneği var", (await stars.count()) === 5, await stars.count());
    await stars.nth(4).click();
    await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
    await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    check("6c. Değerlendirme gönderildikten sonra modal kapandı", (await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count()) === 0);

    console.log("\n=== 7) Nihai durum: iş Tamamlandı sekmesinde görünüyor mu ===");
    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim?durum=tamamlandi`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("7a. İş, Hizmet Taleplerim > Tamamlandı sekmesinde görünüyor", true);

    await loginAs(page, provider.email);
    await page.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=tamamlandi`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("7b. Teklif, Verdiğim Teklifler > Tamamlanan sekmesinde görünüyor", true);

    check("8. Tüm akış boyunca beklenmeyen JS hatası yok", jsErrors.length === 0, jsErrors.join(" | "));
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  // GERÇEK Supabase Storage'a yüklenen (NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC
  // açık olduğu için dual-write olan) nesneler hesap silinmeden ÖNCE
  // temizlenir — bkz. görev talimatı.
  if (jobId) {
    for (const requesterId of createdUserIds) {
      const { data } = await admin.storage.from("job-photos").list(`${requesterId}/${jobId}`);
      for (const obj of data ?? []) uploadedStoragePaths.push(`${requesterId}/${jobId}/${obj.name}`);
    }
  }
  if (uploadedStoragePaths.length > 0) {
    const { error } = await admin.storage.from("job-photos").remove(uploadedStoragePaths);
    console.log(`Storage temizliği: ${uploadedStoragePaths.length} nesne ${error ? "BAŞARISIZ: " + error.message : "silindi"}`);
  }

  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    const { execSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const sqlPath = path.join(tmpdir(), `offer-e2e-cleanup-${Date.now()}.sql`);
    writeFileSync(
      sqlPath,
      // SIRA ÖNEMLİ: notifications.offer_id -> offers.id FK'si var, bu
      // yüzden notifications HER ZAMAN offers'tan ÖNCE silinmeli (bir
      // önceki denemede bulunan gerçek bir hata: offers önce silinince
      // 23503 foreign key violation ile TÜM batch rollback oluyordu).
      // notifications, yalnızca recipient/actor_id ile DEĞİL, offer_id
      // üzerinden de (teklife ait ama alıcısı/aktörü test hesabı olmayan
      // bir bildirim kalmasın diye) eşleştirilir.
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
    try {
      execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" });
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
