// node scripts/tmp-supabase-service-authorization-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna (http://localhost:3000, NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true)
// karşı: HİZMET BAZLI PROVIDER YETKİLENDİRMESİ'ni (migration 0038) görev
// bölüm 45-47'nin BİREBİR senaryosuyla, uçtan uca doğrular.
//
// Senaryo: Hizmet Alan Nakliye/Lashing/Gözetim kategorilerinde birer ilan
// oluşturur (GERÇEK UI). Provider bu üç hizmeti SEÇER (RPC, hızlı) ama admin
// yalnızca Gözetim'i YETKİLENDİRİR (GERÇEK admin UI). Provider'ın "İlan
// Havuzu"nda YALNIZCA Gözetim görünmeli, Nakliye/Lashing 0 olmalı, doğrudan
// URL ile de erişilememeli, createOffer RPC'si de reddetmeli. Sonra admin
// Nakliye'yi de yetkilendirir (§46) — Gözetim+Nakliye görünür, Lashing hâlâ
// görünmez. Sonra admin Nakliye'yi geri alır (§47) — yalnızca Gözetim kalır,
// geçmiş teklif/operasyon silinmez. Güvenlik (§35): provider kendi
// authorize_provider_service'i çağıramaz. Cross-device (§34): admin'in
// yaptığı değişiklik TAMAMEN AYRI, taze bir Supabase client'tan (localStorage
// önbelleği DEĞİL, gerçek DB okuması) anında doğrulanır.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-svc-auth-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}
function safeRunSql(sql) {
  try {
    return runSql(sql);
  } catch (error) {
    console.error("sql failed (continuing):", error?.message || error);
    return [];
  }
}

const createdUserIds = [];
// NOT: `browser` modül seviyesinde tutulur — daha önce main()'in HER ADIMI
// başarılı olursa ÇAĞRILAN `browser.close()` (main()'in kendi sonunda),
// main() ORTADA bir hata fırlattığında (ör. bir Playwright waitForURL
// zaman aşımı) HİÇ ÇAĞRILMIYORDU — bu, script kendi özetini yazdıktan
// SONRA bile Node sürecinin (ve arkasındaki gerçek Chromium işleminin)
// SONSUZA KADAR açık kalmasına neden olan gerçek bir bug'dı (canlı
// gözlemle bulundu: process "Responding: True" ama CPU'su neredeyse hiç
// artmıyordu — kapanmamış bir Playwright browser handle'ı). `cleanup()`
// (aşağıda, HER durumda .finally() içinde çalışır) artık `browser`ı da
// kapatıyor.
let browser;
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-svcauth-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `SvcAuth ${label}`, p_phone: "+905551110096",
    p_company_name: `SvcAuth Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}

// NOT: header dropdown menüsünden "Çıkış Yap" tıklamak (bkz. önceki
// denemeler) sayfa/rol durumuna göre kırılgan çıktı (bildirim ziliyle aynı
// aria-haspopup="menu" özniteliği, mobil/masaüstü kopyaları, hydration
// zamanlaması). Bunun yerine Supabase Auth oturumunun GERÇEK taşıyıcısı
// olan ÇEREZLER doğrudan temizlenir (bkz. supabase/browser-client.ts'in
// @supabase/ssr çerez-tabanlı deseni) — bu, test edilen ASIL şey olan ilan
// görünürlüğü ile HİÇ ilgisi olmayan bir UI etkileşimini test dışı bırakır.
// KRİTİK: yalnızca çerezler temizlenir, localStorage'a HİÇ dokunulmaz —
// `malsevk.jobs.v1` (paylaşılan ilan havuzu, bu testin üç rol arasında
// GÖRMESİ gereken veri) localStorage'da durur, silinirse test kendi kendini
// bozardı.
async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.waitForTimeout(500);
}

// NOT: Nakliye ilanlarında "İl"/"İlçe"/"Liman / Sanayi / OSB" etiketleri
// SAYFADA İKİ KEZ görünür (Yük Alınacak Yer + Teslim Edilecek Yer) — bu
// yüzden `position` ("first"/"last") ZORUNLU bir parametre, tek bir
// `.click()` iki eşleşmede Playwright strict-mode hatası verir (bkz.
// tmp-job-sync-admin-panel-browser-test.mjs'in KENDİ AYNI çözümü).
async function selectFromSearchable(page, label, optionText, { exact = true, position = "first" } = {}) {
  await page.getByRole("button", { name: label, exact: true })[position]().click();
  const listbox = page.locator(`ul[aria-label="${label}"]`)[position]();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

// NOT: eski 1x1 piksel base64 JPEG, server-side işleme (/api/job-photos/
// process, sharp ile GERÇEK decode) tarafından reddediliyordu ("Fotoğraf
// işlenirken bir sorun oluştu") — bu, "0/10 fotoğraf yüklendi" durumunda
// "İlanı Yayınla" tıklamasının SESSİZCE hiçbir şey yapmamasına (yalnızca
// istemci-taraflı doğrulama hatası göstermesine) yol açıyordu; test bunu
// gerçek bir navigasyon/uygulama hatası sanıp 20-40sn boyunca `waitForURL`da
// bekliyordu. Kanıt: canlı DEBUG dökümünde "test-fixture.jpg: Fotoğraf
// işlenirken bir sorun oluştu. Lütfen tekrar deneyin." + "0 / 10 fotoğraf
// yüklendi" görüldü. Düzeltme: scripts/generate-photo-test-fixtures.mjs'in
// KENDİ deseniyle (sharp ile GERÇEK 800x600 JPEG) aynı, geçerli bir fixture.
let validPhotoBufferPromise;
function getValidPhotoBuffer() {
  if (!validPhotoBufferPromise) {
    validPhotoBufferPromise = sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 140, b: 200 } },
    })
      .jpeg()
      .toBuffer();
  }
  return validPhotoBufferPromise;
}

async function uploadOnePhoto(page) {
  const buffer = await getValidPhotoBuffer();
  await page.locator('input[type="file"]').setInputFiles({
    name: "svcauth-fixture.jpg",
    mimeType: "image/jpeg",
    buffer,
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
}

// NOT: provider-job-listing.tsx'in kendi ilan verisi (localStorage) ANINDA
// hazır, ama GÖRÜNÜRLÜK filtresi artık `useAuthorizedServiceCategoryIds`
// (bkz. supabase-provider-service-authorizations.ts) üzerinden GERÇEK bir
// Supabase fetch'ine bağlı — bu iki ayrı async zincir (önce session
// hidrasyonu, SONRA yetki fetch'i) sabit kısa bir `waitForTimeout`ı
// güvenilmez kılabilir. `networkidle` TÜM ağ isteklerinin (ikisi dahil)
// gerçekten bittiğini bekler — bu, "sonuç yanlış" ile "henüz yüklenmedi"
// belirsizliğini ortadan kaldırır.
async function waitForListingSettled(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function createSimpleJob(page, category, jobTitle) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.locator("select").first().selectOption({ label: category });
  await page.getByLabel("İlan Başlığı").fill(jobTitle);
  await page.getByLabel("Hizmete Özel Açıklama").fill(`Hizmet yetkilendirme testi — ${category}.`);
  if (category === "Nakliye" || category === "Lashing / Unlashing" || category === "Gözetim Hizmetleri") {
    await page.getByLabel("Ürün Adedi").fill("5");
    await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
    await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
    if (category === "Nakliye") await page.getByLabel(/^Tonaj/).fill("10");
  }
  if (category === "Nakliye") {
    await selectFromSearchable(page, "İl", "Kocaeli", { position: "first" });
    await selectFromSearchable(page, "İlçe", "Gebze", { position: "first" });
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
    await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().getByRole("option", { name: /Listede yok/ }).first().click();
    await page.getByLabel("Liman / Sanayi / OSB Adı").first().fill("Test Sahası A");
    await page.getByLabel("Açık Adres").first().fill("Yük alınacak açık adres, en az on karakter.");
    await page.getByText("Teslim Edilecek Yer", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await selectFromSearchable(page, "İl", "İstanbul", { position: "last" });
    await selectFromSearchable(page, "İlçe", "Kadıköy", { position: "last" });
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).last().click();
    await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').last().getByRole("option", { name: /Listede yok/ }).first().click();
    await page.getByLabel("Liman / Sanayi / OSB Adı").last().fill("Teslim Sahası A");
    await page.getByLabel("Açık Adres").last().fill("Teslim edilecek açık adres, en az on karakter.");
  } else {
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
    const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
    await listbox.waitFor({ state: "visible" });
    await listbox.getByRole("option", { name: /Listede yok/ }).first().click();
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
    await page.getByLabel("Açık Adres").fill("Test açık adresi, en az on karakter.");
  }
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  // NOT: 40sn'lik cömert zaman aşımı — dev sunucusu yeni başlatılmışsa
  // Turbopack'in bu (ağır, çok bağımlılıklı) sayfayı İLK kez soğuk derlemesi
  // gerçekten 20sn'yi aşabiliyor (canlı gözlemle doğrulandı, uygulama
  // hatası DEĞİL).
  try {
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 40000 });
  } catch (navError) {
    // TANI: navigasyon hiç olmadıysa form muhtemelen bir doğrulama
    // hatasında takılı kaldı (submit hiç network isteği tetiklemedi) — bunu
    // "hâlâ derleniyor" (network isteği var ama yanıt gecikiyor) durumundan
    // ayırt etmek için sayfanın GERÇEK anlık durumunu (URL + görünür metin +
    // konsol hataları) döküyoruz, sonra orijinal hatayı yeniden fırlatıyoruz.
    console.error(`--- DEBUG createSimpleJob(${category}) navigasyon başarısız, mevcut URL: ${page.url()} ---`);
    const bodyText = await page.locator("body").innerText().catch(() => "(body okunamadı)");
    console.error("--- DEBUG sayfa içeriği (ilk 4000 karakter) ---");
    console.error(bodyText.slice(0, 4000));
    const screenshotPath = path.join(tmpdir(), `svcauth-fail-${category.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.error(`--- DEBUG ekran görüntüsü: ${screenshotPath} ---`);
    throw navError;
  }
  return page.url().split("/ilanlar/")[1].split("?")[0];
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);

  // Provider hizmetleri SEÇER (üçünü) — RPC ile hızlı, gerçek "Hizmet
  // Bilgilerim" formunun yaptığı ile AYNI RPC (set_provider_service_categories).
  const { error: setServicesError } = await provider.client.rpc("set_provider_service_categories", {
    p_category_ids: ["nakliye", "lashing-unlashing", "gozetim-hizmetleri"],
  });
  record("0a. Provider 3 hizmeti SEÇTİ (nakliye/lashing-unlashing/gozetim-hizmetleri)", !setServicesError, setServicesError?.message);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageConsoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") pageConsoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageConsoleErrors.push(String(err)));

  console.log("\n=== Hizmet Alan: 3 farklı kategoride GERÇEK ilan oluşturuyor ===");
  await loginAs(page, requester.email);
  const nakliyeJobId = await createSimpleJob(page, "Nakliye", `SVCAUTH-NAKLIYE-${stamp}`);
  const lashingJobId = await createSimpleJob(page, "Lashing / Unlashing", `SVCAUTH-LASHING-${stamp}`);
  const gozetimJobId = await createSimpleJob(page, "Gözetim Hizmetleri", `SVCAUTH-GOZETIM-${stamp}`);
  record("0b. 3 ilan da gerçek UI'dan oluşturuldu", [nakliyeJobId, lashingJobId, gozetimJobId].every((id) => /^[0-9a-f-]{36}$/.test(id)), JSON.stringify({ nakliyeJobId, lashingJobId, gozetimJobId }));

  // Admin üçünü de ONAYLAR (moderasyon) — GERÇEK admin UI'dan
  // (/admin/ilanlar/[id], "Onayla ve Yayınla"), doğrudan RPC çağrısıyla
  // DEĞİL. KRİTİK DÜZELTME: bu adım daha önce admin'in KENDİ Supabase
  // client'ından `approve_job_as_admin` RPC'sini DOĞRUDAN çağırıyordu — bu,
  // yalnızca UZAK (Postgres) `jobs.moderation_status`u günceller,
  // `admin-jobs.ts#approveJobAsAdmin`'in RPC'den SONRA çağırdığı
  // `job-store.ts#applyAdminModerationDecision` YEREL (localStorage)
  // yansımasını ASLA tetiklemez (bkz. admin-jobs.ts'in kendi dokümantasyonu:
  // "bu ilan bu tarayıcının paylaşılan localStorage ilan havuzunda da
  // mevcutsa canlı ekranlara yansır"). Provider'ın GERÇEK /ilanlar sayfası
  // yalnızca localStorage okur (job-moderation.ts#isJobVisibleForModeration)
  // — bu yüzden `Job.moderationStatus` bu paylaşılan tarayıcı bağlamında
  // SONSUZA KADAR "pending_review" kalıyordu ve provider ne admin ne de
  // ilan sahibi olduğu için HİÇBİR ilan (Gözetim dahil) hiçbir zaman
  // görünmüyordu — hizmet yetkilendirmesiyle TAMAMEN İLGİSİZ, ayrı bir kapı.
  // GERÇEK UI akışı kullanmak hem bu yerel yansımayı doğru tetikler hem de
  // testi görev gereksinimiyle (§21: "gerçek Supabase row ve query sonucu")
  // birebir hizalar.
  await loginAs(page, adminUser.email);
  for (const jobId of [nakliyeJobId, lashingJobId, gozetimJobId]) {
    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).click();
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).waitFor({ state: "hidden", timeout: 15000 });
  }
  await logout(page);
  const approvedCheck = runSql(`select id, moderation_status from public.jobs where id in ('${nakliyeJobId}','${lashingJobId}','${gozetimJobId}');`);
  record("0c. 3 ilan da admin tarafından GERÇEK UI'dan onaylandı (moderation_status=approved)", approvedCheck.every((r) => r.moderation_status === "approved"), JSON.stringify(approvedCheck));

  console.log("\n=== Admin, GERÇEK UI'dan YALNIZCA Gözetim'i yetkilendiriyor ===");
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/firmalar/${provider.id}`);
  await page.getByText("Hizmet Yetkileri").first().waitFor({ state: "visible", timeout: 15000 });
  const gozetimRow = page.locator("p", { hasText: "Gözetim Hizmetleri" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  await gozetimRow.getByRole("button", { name: "Yetkilendir" }).click();
  await page.waitForTimeout(2000);

  const authAfterGozetim = runSql(`select service_category_id, revoked_at from public.provider_service_authorizations where provider_id = '${provider.id}' and revoked_at is null;`);
  record("1. DB: yalnızca gozetim-hizmetleri aktif yetkilendirilmiş", authAfterGozetim.length === 1 && authAfterGozetim[0].service_category_id === "gozetim-hizmetleri", JSON.stringify(authAfterGozetim));

  console.log("\n=== §34 Cross-device: TAMAMEN AYRI/taze bir Supabase client'tan doğrulama ===");
  const freshProviderClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await freshProviderClient.auth.signInWithPassword({ email: provider.email, password: PASSWORD });
  const freshRead = await freshProviderClient.from("provider_service_authorizations").select("service_category_id").eq("provider_id", provider.id).is("revoked_at", null);
  record("2. Cross-device: TAMAMEN AYRI bir oturumdan (localStorage'a hiç dokunmadan) gerçek Supabase satırı okunabiliyor", freshRead.data?.length === 1 && freshRead.data[0].service_category_id === "gozetim-hizmetleri", JSON.stringify(freshRead.data));
  await freshProviderClient.auth.signOut({ scope: "local" });

  console.log("\n=== §45: Provider login, İlan Havuzu YALNIZCA Gözetim göstermeli ===");
  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const listingText = await page.locator("main").innerText();
  const gozetimVisible = listingText.includes(`SVCAUTH-GOZETIM-${stamp}`);
  record("3. Provider Gözetim ilanını GÖRÜYOR", gozetimVisible);
  record("4. Provider Nakliye ilanını GÖRMÜYOR", !listingText.includes(`SVCAUTH-NAKLIYE-${stamp}`));
  record("5. Provider Lashing ilanını GÖRMÜYOR", !listingText.includes(`SVCAUTH-LASHING-${stamp}`));
  if (!gozetimVisible) {
    console.log("--- DEBUG: /ilanlar sayfa içeriği (main) ---");
    console.log(listingText.slice(0, 3000));
    console.log("--- DEBUG: konsol hataları ---");
    console.log(JSON.stringify(pageConsoleErrors));
    console.log("--- DEBUG SON ---");
  }

  console.log("\n=== §36 Direct Job Access: yetkisiz kategoriye doğrudan URL ile erişim ===");
  await page.goto(`${APP_ORIGIN}/ilanlar/${nakliyeJobId}`);
  await page.waitForTimeout(1500);
  const nakliyeDirectText = await page.locator("body").innerText();
  record("6. Nakliye ilanına DOĞRUDAN URL ile erişim REDDEDİLİYOR ('bulunamadı')", nakliyeDirectText.includes("bulunamadı") || nakliyeDirectText.includes("artık yayında değil"));

  console.log("\n=== §13 Offer RPC Enforcement: yetkisiz kategoriye createOffer backend'de REJECT ===");
  const providerRpcClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await providerRpcClient.auth.signInWithPassword({ email: provider.email, password: PASSWORD });
  const offerAttempt = await providerRpcClient.rpc("create_offer", { p_job_id: nakliyeJobId, p_amount: 1000, p_currency: "TRY", p_description: "Yetkisiz teklif denemesi, en az yirmi karakter.", p_estimated_duration: 5 });
  record("7. createOffer RPC'si yetkisiz kategori için BACKEND'de reddediyor (MLK60)", offerAttempt.error?.code === "MLK60", `${offerAttempt.error?.code}: ${offerAttempt.error?.message}`);

  console.log("\n=== §35 Security: provider kendi authorize_provider_service'ini çağıramaz ===");
  const selfAuthAttempt = await providerRpcClient.rpc("authorize_provider_service", { p_provider_id: provider.id, p_service_category_id: "nakliye" });
  record("8. Provider kendi kendine yetki VEREMEZ (admin-only, MLK50)", selfAuthAttempt.error?.code === "MLK50", `${selfAuthAttempt.error?.code}: ${selfAuthAttempt.error?.message}`);
  await providerRpcClient.auth.signOut({ scope: "local" });

  console.log("\n=== Gözetim'e GERÇEK teklif verilebiliyor mu (yetkili kategori) ===");
  await page.goto(`${APP_ORIGIN}/ilanlar/${gozetimJobId}`);
  await page.getByRole("button", { name: /Teklif Ver/ }).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const gozetimOfferFormVisible = (await page.locator('button:has-text("Teklif Ver")').count()) > 0 || (await page.getByLabel(/Teklif Tutarı|Fiyat/).count()) > 0;
  record("9. Provider yetkili olduğu Gözetim ilanında GERÇEK teklif formunu görebiliyor", gozetimOfferFormVisible);

  console.log("\n=== §46: Admin şimdi Nakliye'yi de yetkilendiriyor ===");
  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/firmalar/${provider.id}`);
  await page.getByText("Hizmet Yetkileri").first().waitFor({ state: "visible", timeout: 15000 });
  const nakliyeRow = page.locator("p", { hasText: "Nakliye" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  await nakliyeRow.getByRole("button", { name: "Yetkilendir" }).click();
  await page.waitForTimeout(2000);

  const authAfterNakliye = runSql(`select service_category_id from public.provider_service_authorizations where provider_id = '${provider.id}' and revoked_at is null order by service_category_id;`);
  record("10. DB: Gözetim + Nakliye ikisi de aktif yetkilendirilmiş", authAfterNakliye.map((r) => r.service_category_id).sort().join(",") === "gozetim-hizmetleri,nakliye", JSON.stringify(authAfterNakliye));

  const notifAfterNakliye = runSql(`select type, message from public.notifications where recipient_id = '${provider.id}' and type = 'service_authorized' order by created_at desc limit 1;`);
  record("11. Nakliye yetkilendirme bildirimi GERÇEKTEN oluştu, doğru dinamik metinle", notifAfterNakliye[0]?.message?.includes("Nakliye"), JSON.stringify(notifAfterNakliye[0]));

  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const listingTextAfterNakliye = await page.locator("main").innerText();
  record("12. Provider REFRESH sonrası artık Gözetim + Nakliye görüyor", listingTextAfterNakliye.includes(`SVCAUTH-GOZETIM-${stamp}`) && listingTextAfterNakliye.includes(`SVCAUTH-NAKLIYE-${stamp}`));
  record("13. Provider hâlâ Lashing GÖRMÜYOR", !listingTextAfterNakliye.includes(`SVCAUTH-LASHING-${stamp}`));

  console.log("\n=== §47: Admin Nakliye yetkisini KALDIRIYOR ===");
  await logout(page);
  await loginAs(page, adminUser.email);
  await page.goto(`${APP_ORIGIN}/admin/firmalar/${provider.id}`);
  await page.getByText("Hizmet Yetkileri").first().waitFor({ state: "visible", timeout: 15000 });
  const nakliyeRow2 = page.locator("p", { hasText: "Nakliye" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  await nakliyeRow2.getByRole("button", { name: "Yetkiyi Kaldır" }).click();
  await page.getByPlaceholder(/faaliyet belgesi bulunmuyor/).fill("Test: faaliyet belgesi süresi doldu.");
  await page.getByRole("button", { name: "Onayla" }).click();
  await page.waitForTimeout(2000);

  const authAfterRevoke = runSql(`select service_category_id, revoked_at, revoke_reason from public.provider_service_authorizations where provider_id = '${provider.id}';`);
  const nakliyeRevoked = authAfterRevoke.find((r) => r.service_category_id === "nakliye");
  record("14. DB: Nakliye yetkisi revoked_at ile KALDIRILDI (satır silinmedi, tarihçe korundu)", nakliyeRevoked?.revoked_at !== null && Boolean(nakliyeRevoked?.revoke_reason), JSON.stringify(nakliyeRevoked));
  const gozetimStillActive = authAfterRevoke.find((r) => r.service_category_id === "gozetim-hizmetleri");
  record("15. DB: Gözetim yetkisi ETKİLENMEDİ (hâlâ aktif)", gozetimStillActive?.revoked_at === null, JSON.stringify(gozetimStillActive));

  await logout(page);
  await loginAs(page, provider.email);
  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await waitForListingSettled(page);
  const listingTextAfterRevoke = await page.locator("main").innerText();
  record("16. Provider REFRESH sonrası Nakliye TEKRAR kayboldu", !listingTextAfterRevoke.includes(`SVCAUTH-NAKLIYE-${stamp}`));
  record("17. Provider Gözetim'i hâlâ GÖRÜYOR (Nakliye'nin kaldırılması Gözetim'i etkilemedi)", listingTextAfterRevoke.includes(`SVCAUTH-GOZETIM-${stamp}`));

  console.log("\n=== §37: Yetki kaldırılsa bile geçmiş kayıtlar silinmiyor (job/offer/audit) ===");
  const jobsStillExist = runSql(`select count(*)::int as c from public.jobs where id in ('${nakliyeJobId}','${lashingJobId}','${gozetimJobId}') and deleted_at is null;`);
  record("18. Nakliye/Lashing/Gözetim ilanlarının hiçbiri silinmedi", jobsStillExist[0]?.c === 3, JSON.stringify(jobsStillExist[0]));
  const auditRows = runSql(`select action from public.audit_logs where entity_id in (select id from public.provider_service_authorizations where provider_id = '${provider.id}') order by created_at;`);
  record("19. audit_logs: authorize/revoke işlemleri kaydedildi (mevcut audit altyapısı, ikinci sistem değil)", auditRows.some((r) => r.action === "authorize_provider_service") && auditRows.some((r) => r.action === "revoke_provider_service_authorization"), JSON.stringify(auditRows));

  await browser.close();
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    safeRunSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
    safeRunSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
    safeRunSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.provider_service_authorizations where provider_id in (${idList})) or entity_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
    safeRunSql(`delete from public.provider_services where provider_id in (${idList});`);
    safeRunSql(`delete from public.jobs where requester_id in (${idList});`);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  rmSync(scratchDir, { recursive: true, force: true });
  // KRİTİK: main() bir hatayla YARIDA kesilse bile (bkz. yukarıdaki modül
  // seviyesindeki `browser` notu) tarayıcı burada, HER durumda kapatılır —
  // aksi halde Node süreci (ve arkasındaki Chromium) sonsuza kadar açık
  // kalır, sonraki koşumlar için gereksiz kaynak tüketir.
  if (browser) {
    await browser.close().catch(() => {});
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
