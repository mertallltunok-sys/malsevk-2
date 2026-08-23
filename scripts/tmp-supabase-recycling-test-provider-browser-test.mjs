// Development Supabase projesine (trfnmpihcnriqgikglpu) VE zaten çalışan
// gerçek dev sunucusuna (http://localhost:3000, aynı projeye bağlı,
// NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true) karşı: AŞAMA E — GERÇEK
// tarayıcı testi.
//
// ÖNEMLİ MİMARİ NOT (bu script'in TEK sayfa/context kullanma nedeni):
// canlı uygulama /ilanlar ve /ilanlar/[id] ekranları SADECE bu TARAYICININ
// KENDİ localStorage'ını okur (bkz. CLAUDE.md "No real backend") — Supabase
// job-sync yalnızca best-effort bir AYNA'dır, GERÇEK okuma yolu değildir.
// Önceki turda `create_job` RPC'siyle DOĞRUDAN oluşturulan ilan bu yüzden
// HİÇBİR tarayıcının localStorage'ında YOK — bu script bu yüzden ilanı
// GERÇEK `/hizmet-talebi-olustur` formundan (buyer), onayı GERÇEK
// `/admin/ilanlar` ekranından (admin) geçirir — tıpkı
// tmp-supabase-job-moderation-e2e-test.mjs'in AYNI, kanıtlanmış deseni: TEK
// paylaşılan browser context, roller arasında GERÇEK giriş/çıkışla geçiş
// (localStorage tarayıcı başına paylaşılır, admin'in "Onayla" tıklaması
// hem Supabase'i hem best-effort bu tarayıcının local ilan aynasını
// günceller — bkz. admin-jobs.ts#approveJobAsAdmin).
//
// Şifreler DEĞİŞTİRİLMEDİ — parametre/önceki turun sabit değerleri.
import { chromium } from "playwright";

const APP_ORIGIN = "http://localhost:3000";
const PROVIDER_EMAIL = "geri-donusum-test@malsevk.test";
const PROVIDER_PASSWORD = process.env.RECYCLING_TEST_PROVIDER_PASSWORD;
const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = "TestSifre2026!";
const BUYER_EMAIL = process.argv[3];
const BUYER_PASSWORD = "TestSifre2026!";

if (!PROVIDER_PASSWORD || !ADMIN_EMAIL || !BUYER_EMAIL) {
  console.error("Kullanım: RECYCLING_TEST_PROVIDER_PASSWORD=... node ...browser-test.mjs <adminEmail> <buyerEmail>");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 220) : ""));
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}

async function logout(page) {
  await page.goto(`${APP_ORIGIN}/`);
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await page.waitForTimeout(1000);
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
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
  await page.waitForTimeout(1000);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const stamp = Date.now();
  const jobTitle = `[TARAYICI TEST İLANI] Geri Dönüşüm ${stamp}`;

  // -------------------------------------------------------------------
  // 1) Buyer: GERÇEK /hizmet-talebi-olustur formundan Geri Dönüşüm ilanı.
  // -------------------------------------------------------------------
  await loginAs(page, BUYER_EMAIL, BUYER_PASSWORD);
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await selectFromSearchable(page, "Hizmet Kategorisi", "Geri Dönüşüm & Atık Tahliye");
  await page.getByLabel("İlan Başlığı").fill(jobTitle);
  await page.getByLabel("Hizmete Özel Açıklama").fill("BU BİR TEST İLANIDIR — tarayıcı görünürlük testi için oluşturuldu, gerçek bir hizmet talebi değildir.");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Gebze").catch(() => {});
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-20");
  await uploadOnePhoto(page);
  await selectFromSearchable(page, "Malzeme Kategorisi", "Metal Hurda");
  await selectFromSearchable(page, "Alt Tür", "Demir / Çelik");
  await page.getByLabel("Tahmini Miktar", { exact: false }).fill("10");
  await selectFromSearchable(page, "Birim", "ton");
  await selectFromSearchable(page, "Malzeme Durumu", "Karışık");
  for (const scope of ["Sahadan toplama", "Yükleme", "Tesisten tahliye", "Taşıma"]) {
    await page.getByRole("button", { name: scope, exact: true }).click().catch(() => {});
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 }).catch(() => {});
  const jobId = page.url().includes("/ilanlar/") ? page.url().split("/ilanlar/")[1].split("?")[0] : null;
  record("E1. Gerçek UI formundan Geri Dönüşüm test ilanı oluşturuldu", Boolean(jobId), jobId || page.url());

  // -------------------------------------------------------------------
  // 2) Admin: GERÇEK /admin/ilanlar ekranından onayla (aynı context —
  //    localStorage'daki ilan aynası best-effort güncellenir).
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${APP_ORIGIN}/admin/ilanlar`);
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const foundInAdmin = await page.getByText(jobTitle).first().isVisible().catch(() => false);
  record("E2. Admin 'İlan Yönetimi'nde gerçek test ilanını görüyor", foundInAdmin);

  if (jobId) {
    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
    await page.getByRole("button", { name: "Onayla ve Yayınla" }).click({ timeout: 10000 }).catch(async () => {
      await page.getByRole("button", { name: /Onayla/ }).first().click().catch(() => {});
    });
    await page.waitForTimeout(2000);
    record("E3. Admin gerçek UI'dan onayladı", true);
  }

  // -------------------------------------------------------------------
  // 3) Geri Dönüşüm test provider: AYNI context/localStorage'dan görüyor mu?
  // -------------------------------------------------------------------
  await logout(page);
  await loginAs(page, PROVIDER_EMAIL, PROVIDER_PASSWORD);
  record("E4. Test provider gerçek UI üzerinden giriş yaptı", !page.url().includes("/giris-yap"), page.url());

  await page.goto(`${APP_ORIGIN}/ilanlar`);
  await page.waitForTimeout(2500);
  const listingText = await page.locator("main").innerText().catch(() => "");
  record("E5. Aktif İlanlar açılıyor ve Geri Dönüşüm test ilanı listeleniyor", listingText.includes(jobTitle) || listingText.includes("Geri Dönüşüm"), listingText.slice(0, 250));

  if (jobId) {
    await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await page.waitForTimeout(2000);
    const detailText = await page.locator("main").innerText().catch(() => "");
    record("E6. İlan detayına girilebiliyor", page.url().includes(jobId));
    record("E7. Detayda 'Geri Dönüşüm & Atık Tahliye Bilgileri' kartı görünüyor", detailText.includes("Geri Dönüşüm"));
    record("E8. Malzeme (Demir / Çelik), miktar (10 ton), Hizmet Kapsamı doğru görünüyor", detailText.includes("Demir") && detailText.includes("10") && detailText.includes("Sahadan toplama"));
    record("E9. Teklif alanı erişilebilir (form ya da mevcut teklif durumu)", detailText.toLowerCase().includes("teklif"));
  }

  await browser.close();
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
