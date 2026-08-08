// MALSEVK — Supabase Geçişi Faz 2 "Gerçek İlan Oluşturma → Supabase" gerçek
// tarayıcı doğrulaması. Yerel, izole Docker Supabase yığınına karşı çalışır
// (tmp-supabase-facility-candidates-test.mjs ile AYNI docker-exec/psql
// deseni, admin rolüne yükseltme için) — hosted dev projede service_role'ün
// profiles tablosuna REST erişimi olmadığı (bilinen, dokümante edilmiş
// platform sınırlaması) zaten doğrulanmıştı, bu yüzden gerçek bir admin
// hesabı yalnızca yerelde üretilebiliyor.
//
// Önkoşul: `npm run dev`, .env.local'ı yerel Docker Supabase URL/anahtarına
// VE NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true'ya işaret edecek şekilde
// http://localhost:3000 üzerinde çalışıyor olmalı (bkz. görev sonu raporu —
// bu script'i çalıştırırken gerçek geliştirme sunucusu geçici olarak bu
// yapılandırmaya alındı, testten sonra orijinaline geri döndürüldü).
//
// Çalıştırma: node scripts/tmp-job-sync-admin-panel-browser-test.mjs
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const BASE_URL = "http://localhost:3000";
const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = "supabase_db_malsevk-2";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Refusing to run: target Supabase URL is not local (safety guard).");
}

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, { encoding: "utf-8" }).trim();
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
const stamp = Date.now();
const createdUserIds = [];

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

async function makeConfirmedUser(label) {
  const email = `job-sync-browser-${label}-${stamp}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  createdUserIds.push(created.data.user.id);
  return { email, id: created.data.user.id };
}

/** Sabit bir timeout yerine GERÇEK yönlendirmeyi bekler — tmp-custom-facility-location-test.mjs'in AYNI, daha sağlam deseni (flat waitForTimeout, giriş yavaş olduğunda /panel'e erken gidip proxy.ts'in koruma kapısına takılmaya yol açabiliyordu). */
async function loginAs(page, email, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

/**
 * Nakliye'nin "Yük Alınacak Yer" (pickup) VE "Teslim Edilecek Yer"
 * (delivery) bölümleri AYNI "İl"/"İlçe"/"Liman / Sanayi / OSB"/"Açık Adres"
 * etiketlerini kullanır (bkz. nakliye-location-fields.tsx'in kendi
 * dokümantasyonu — TEK paylaşılan bileşen) — DOM sırası her zaman pickup
 * ÖNCE, delivery SONRA olduğu için (job-request-form.tsx'in kendi JSX
 * sırası) `.first()`/`.last()` güvenilir bir ayrım sağlar.
 */
async function selectFromSearchableAt(page, label, optionText, position, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true })[position]().click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

async function uploadOnePhoto(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    // 1x1 minimal JPEG.
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function main() {
  console.log("=== Kurulum: test kullanıcıları ===");
  const requester = await makeConfirmedUser("requester");
  const adminUser = await makeConfirmedUser("admin");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    console.log("\n=== 1) Hizmet Alan kaydını tamamlar ===");
    await loginAs(page, requester.email, "/kayit-tamamla");
    // Kayıt tamamlama formu: hesap türü + temel firma bilgileri.
    await page.getByRole("button", { name: /Hizmet Alan/ }).first().click().catch(() => {});
    const fullNameInput = page.getByLabel(/Ad Soyad/).first();
    if ((await fullNameInput.count()) > 0) await fullNameInput.fill("Test Requester");
    const phoneInput = page.getByLabel(/Telefon/).first();
    if ((await phoneInput.count()) > 0) await phoneInput.fill("+905551112233");
    const companyInput = page.getByLabel(/Firma/).first();
    if ((await companyInput.count()) > 0) await companyInput.fill("Test Firma");
    await selectFromSearchable(page, "İl", "Kocaeli").catch(() => {});
    await selectFromSearchable(page, "İlçe", "Gebze").catch(() => {});
    const completeButton = page.getByRole("button", { name: /Kaydı Tamamla|Devam Et|Tamamla/ }).first();
    if ((await completeButton.count()) > 0) await completeButton.click().catch(() => {});
    await page.waitForTimeout(1500);

    // profiles.role henüz atanmamışsa (ör. kayıt tamamlama formu farklı bir
    // alan seti bekliyorsa) doğrudan RPC ile tamamla — bu script'in amacı
    // kayıt formunun kendisini DEĞİL, ilan oluşturma senkronunu doğrulamak.
    const roleCheck = psql(`select role from public.profiles where id = '${requester.id}';`);
    if (roleCheck !== "hizmet-alan") {
      const anonClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await anonClient.auth.signInWithPassword({ email: requester.email, password: PASSWORD });
      await anonClient.rpc("complete_registration", {
        p_role: "hizmet-alan", p_full_name: "Test Requester", p_phone: "+905551112233",
        p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
      });
    }
    check("1a. Hizmet Alan kaydı tamamlandı (RPC/form)", psql(`select role from public.profiles where id = '${requester.id}';`) === "hizmet-alan");

    console.log("\n=== 2) Admin hesabı yükseltiliyor (yerel, sandbox-only) ===");
    psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
    check("2a. Admin hesabı role='admin' oldu", psql(`select role from public.profiles where id = '${adminUser.id}';`) === "admin");

    console.log("\n=== 3) Gerçek UI üzerinden, flag AÇIKKEN ilan oluşturuluyor ===");
    const jobTitle = `SUPABASE-SYNC-TEST-${stamp}`;
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Forklift" });
    await page.getByLabel("İlan Başlığı").fill(jobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Bu, Supabase senkron testinin oluşturduğu bir ilandır — en az yirmi karakter.");
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    // NOT: bu ekranın gerçek "Listede yok" seçenek metni job-location.ts#
    // CUSTOM_FACILITY_OPTION_LABEL sabitinden FARKLI ("Listede yok, kendim
    // gireceğim" — virgüllü, em-dash'siz); bu yüzden geniş bir regex ile
    // eşleşiyoruz, tam metne bağımlı olmuyoruz.
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
    const facilityListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
    await facilityListbox.waitFor({ state: "visible" });
    await facilityListbox.getByRole("option", { name: /Listede yok/ }).first().click();
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Gebze");
    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
    await uploadOnePhoto(page);

    // Aşama 1: form doğrulanır, Operasyon Önizleme'ye geçilir (henüz createJob çağrılmaz).
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    check("3a. Önizleme ekranına geçildi (henüz ilan oluşmadı)", true);

    // Aşama 2: önizlemenin kendi Yayınla butonu -> gerçek createJob + (flag açıkken) Supabase senkronu.
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    const createdJobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("3b. İlan başarıyla oluşturuldu ve detay sayfasına yönlendirildi", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());

    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const bodyTextAfterCreate = await page.locator("main").innerText().catch(async () => page.textContent("body"));
    check("3c. Senkron uyarı banner'ı GÖRÜNMÜYOR (Supabase senkronu başarılı oldu)", !bodyTextAfterCreate.includes("sunucu senkronizasyonunda bir sorun"));
    check("3d. Sayfa başlığı doğru ilanı gösteriyor", bodyTextAfterCreate.includes(jobTitle));
    check("3e. Konsolda beklenmeyen JS hatası yok", jsErrors.length === 0, jsErrors.join(" | "));

    console.log("\n=== 4) Supabase'de gerçekten yazıldı mı (jobs tablosu, id eşleşmesi) ===");
    const jobRow = JSON.parse(psql(`select row_to_json(j) from public.jobs j where id = '${createdJobId}';`) || "null");
    check("4a. Supabase jobs tablosunda AYNI id ile bulunabiliyor (client-id stratejisi)", jobRow !== null, jobRow);
    check("4b. title/province/district doğru senkronlandı", jobRow?.title === jobTitle && jobRow?.province === "Kocaeli" && jobRow?.district === "Gebze", JSON.stringify(jobRow));
    check("4c. requester_id gerçek test kullanıcısı", jobRow?.requester_id === requester.id, jobRow?.requester_id);

    console.log("\n=== 4d-4g) Fotoğraf Storage senkronu (Faz 3) — placeholder KALMADI, gerçek dosya var ===");
    const photoRows = JSON.parse(
      psql(`select json_agg(row_to_json(p)) from public.job_photos p where job_id = '${createdJobId}' and deleted_at is null;`) || "null",
    ) ?? [];
    check("4d. job_photos satırı yazıldı", photoRows.length === 1, JSON.stringify(photoRows));
    const photoStoragePath = photoRows[0]?.storage_path;
    check("4e. storage_path GERÇEK bir yol (Faz 2'nin 'local-pending:' placeholder'ı değil)", typeof photoStoragePath === "string" && !photoStoragePath.startsWith("local-pending:"), photoStoragePath);
    check(
      "4f. storage_path, dokümante edilen konvansiyona uyuyor ({requester_id}/{job_id}/{photo_id}.{ext})",
      typeof photoStoragePath === "string" && photoStoragePath.startsWith(`${requester.id}/${createdJobId}/`),
      photoStoragePath,
    );
    const downloadResult = await admin.storage.from("job-photos").download(photoStoragePath);
    check("4g. Dosya GERÇEKTEN Storage'da mevcut ve indirilebiliyor (boş/placeholder değil)", !downloadResult.error && downloadResult.data && downloadResult.data.size > 0, downloadResult.error?.message ?? `size=${downloadResult.data?.size}`);

    console.log("\n=== 5) Admin panelinde GERÇEKTEN oluşturulan ilan görünüyor mu (seed değil) ===");
    await loginAs(page, adminUser.email);
    await page.goto(`${BASE_URL}/admin/ilanlar`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("5a. Admin İlan Yönetimi listesinde UI'dan oluşturulan gerçek ilan görünüyor", true);

    await page.goto(`${BASE_URL}/admin/ilanlar/${createdJobId}`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const detailText = await page.locator("main").innerText().catch(async () => page.textContent("body"));
    check("5b. Admin detay ekranı doğru ili gösteriyor", detailText.includes("Kocaeli"));
    check("5c. Admin detay ekranı doğru ilçeyi gösteriyor", detailText.includes("Gebze"));

    console.log("\n=== 5d-5e) Admin panelinde fotoğraf GERÇEKTEN çalışıyor mu ===");
    const photoImg = page.locator("main img").first();
    await photoImg.waitFor({ state: "visible", timeout: 15000 });
    const photoSrc = await photoImg.getAttribute("src");
    check("5d. Admin detay ekranında bir <img> render ediliyor ve src'si Storage yoluna işaret ediyor", typeof photoSrc === "string" && photoSrc.includes(photoStoragePath), photoSrc);
    const imgLoaded = await photoImg.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0);
    check("5e. Fotoğraf tarayıcıda GERÇEKTEN yükleniyor (kırık img değil)", imgLoaded === true, `complete/naturalWidth check: ${imgLoaded}`);

    console.log("\n=== 6) Admin etiketi UX düzeltmesi: üst sağda 'Admin' yazıyor, 'Hizmet Alan' değil ===");
    await page.getByRole("banner").getByText("Admin", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    const headerText = await page.getByRole("banner").innerText();
    check("6a. Üst sağ kullanıcı alanı (header) 'Admin' gösteriyor", headerText.includes("Admin"), headerText);
    check("6b. Üst sağ kullanıcı alanı (header) ARTIK 'Hizmet Alan' göstermiyor", !headerText.includes("Hizmet Alan"), headerText);

    console.log("\n=== 7) Regresyon: normal Hizmet Alan hesabı hâlâ 'Hizmet Alan' görüyor ===");
    // Aynı context'te bir admin oturumundan hemen sonra farklı bir kullanıcıya
    // geçmek Supabase'in localStorage tabanlı oturum durumunu karıştırabiliyor
    // — gerçek bir izolasyon için TAZE bir browser context kullanılır (yeni
    // sayfa DEĞİL, context: sayfalar aynı context'te storage'ı paylaşır).
    const regressionContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const regressionPage = await regressionContext.newPage();
    await loginAs(regressionPage, requester.email);
    // Sunucu tarafı yönlendirme (proxy.ts, gerçek Supabase oturumu) bitmiş
    // olabilir ama istemci tarafı `useSession()` önbelleği bir sonraki
    // render'a kadar hâlâ null dönebilir (bkz. session.ts) — header'ın
    // konuk (Giriş Yap/Kayıt Ol) durumundan çıkmasını gerçekten bekleriz.
    await regressionPage.getByRole("banner").getByText("Hizmet Alan").waitFor({ state: "visible", timeout: 15000 });
    const requesterHeaderText = await regressionPage.getByRole("banner").innerText();
    check("7a. Normal Hizmet Alan hesabı kendi rolünü doğru görüyor (regresyon yok)", requesterHeaderText.includes("Hizmet Alan"), requesterHeaderText);
    await regressionContext.close();

    console.log("\n=== 8) Supabase Geçişi Faz 4 — GERÇEK bir Nakliye ilanı UI üzerinden oluşturuluyor (6 teslimat alanı) ===");
    const nakliyeJobTitle = `NAKLIYE-SYNC-TEST-${stamp}`;
    await loginAs(page, requester.email);
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Nakliye" });
    await page.getByLabel("İlan Başlığı").fill(nakliyeJobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Bu, Nakliye Supabase senkron testinin oluşturduğu bir ilandır.");

    // Nakliye "Ürün Bilgileri" kapsamındadır (Ürün Adedi/Cinsi zorunlu,
    // Tonaj Nakliye'de ZORUNLU) — bu doldurulmadan form submit'i engeller.
    await page.getByLabel("Ürün Adedi").fill("7");
    await page.getByLabel(/^Tonaj/).fill("15");
    await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
    await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();

    // Yük Alınacak Yer (pickup) — sayfadaki İLK "İl"/"İlçe"/"Liman / Sanayi / OSB".
    await selectFromSearchableAt(page, "İl", "Kocaeli", "first");
    await selectFromSearchableAt(page, "İlçe", "Gebze", "first");
    await selectFromSearchableAt(page, "Liman / Sanayi / OSB", "Listede yok", "first", { exact: false });
    await page.getByLabel("Liman / Sanayi / OSB Adı").first().fill("Yük Alım Sahası Testi");
    await page.getByLabel("Açık Adres").first().fill("Yük alınacak açık adres, en az on karakter.");

    // Teslim Edilecek Yer (delivery) — sayfadaki SON "İl"/"İlçe"/"Liman / Sanayi / OSB" (bkz. selectFromSearchableAt'in kendi dokümantasyonu).
    await page.getByText("Teslim Edilecek Yer", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await selectFromSearchableAt(page, "İl", "İstanbul", "last");
    await selectFromSearchableAt(page, "İlçe", "Kadıköy", "last");
    await selectFromSearchableAt(page, "Liman / Sanayi / OSB", "Listede yok", "last", { exact: false });
    await page.getByLabel("Liman / Sanayi / OSB Adı").last().fill("Teslim Sahası Testi");
    await page.getByLabel("Açık Adres").last().fill("Teslim edilecek açık adres, en az on karakter.");

    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-05");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-07");
    await uploadOnePhoto(page);

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    const nakliyeJobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("8a. Nakliye ilanı başarıyla oluşturuldu ve detay sayfasına yönlendirildi", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());
    await page.getByText(nakliyeJobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const nakliyeBodyText = await page.locator("main").innerText().catch(async () => page.textContent("body"));
    check("8b. Senkron uyarı banner'ı GÖRÜNMÜYOR (Nakliye senkronu da başarılı oldu)", !nakliyeBodyText.includes("sunucu senkronizasyonunda bir sorun"));

    console.log("\n=== 9) Supabase'de 6 teslimat alanı da doğru yazıldı mı (jobs tablosu) ===");
    const nakliyeJobRow = JSON.parse(psql(`select row_to_json(j) from public.jobs j where id = '${nakliyeJobId}';`) || "null");
    check("9a. Nakliye ilanı Supabase'de AYNI id ile bulunabiliyor", nakliyeJobRow !== null, nakliyeJobRow);
    check("9b. Pickup (Yük Alınacak Yer) doğru — İl/İlçe Kocaeli/Gebze", nakliyeJobRow?.province === "Kocaeli" && nakliyeJobRow?.district === "Gebze", JSON.stringify({ p: nakliyeJobRow?.province, d: nakliyeJobRow?.district }));
    check(
      "9c. Delivery (Teslim Edilecek Yer) 6 alanı da BİREBİR doğru — pickup'tan BAĞIMSIZ",
      nakliyeJobRow?.delivery_province === "İstanbul" &&
        nakliyeJobRow?.delivery_district === "Kadıköy" &&
        nakliyeJobRow?.delivery_location_type === "open_address" &&
        nakliyeJobRow?.delivery_facility_id === null &&
        nakliyeJobRow?.delivery_facility_name === "Teslim Sahası Testi" &&
        nakliyeJobRow?.delivery_address_text === "Teslim edilecek açık adres, en az on karakter.",
      JSON.stringify({
        dp: nakliyeJobRow?.delivery_province, dd: nakliyeJobRow?.delivery_district, dlt: nakliyeJobRow?.delivery_location_type,
        dfi: nakliyeJobRow?.delivery_facility_id, dfn: nakliyeJobRow?.delivery_facility_name, dat: nakliyeJobRow?.delivery_address_text,
      }),
    );

    console.log("\n=== 10) Admin panelinden AYNI Nakliye ilanı açılıyor — 6 alan Supabase'den doğru okunuyor mu (görev bölüm 6) ===");
    await loginAs(page, adminUser.email);
    await page.goto(`${BASE_URL}/admin/ilanlar/${nakliyeJobId}`);
    await page.getByText(nakliyeJobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const nakliyeAdminText = await page.locator("main").innerText().catch(async () => page.textContent("body"));
    check("10a. Admin detay ekranı pickup ilini gösteriyor (Kocaeli)", nakliyeAdminText.includes("Kocaeli"));
    check("10b. Admin detay ekranı Teslim İl/İlçe'yi gösteriyor (İstanbul / Kadıköy)", nakliyeAdminText.includes("İstanbul") && nakliyeAdminText.includes("Kadıköy"), nakliyeAdminText);
    check("10c. Admin detay ekranı Teslim Tesisi adını gösteriyor", nakliyeAdminText.includes("Teslim Sahası Testi"));
    check("10d. Admin detay ekranı Teslim Adresini gösteriyor", nakliyeAdminText.includes("Teslim edilecek açık adres"));

    console.log("\n=== Temizlik ===");
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }

    console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) {
      console.log("Başarısız testler:");
      for (const f of failures) console.log(` - ${f}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
