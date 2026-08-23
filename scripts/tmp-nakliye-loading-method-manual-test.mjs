// node scripts/tmp-nakliye-loading-method-manual-test.mjs
//
// Dar kapsamlı doğrulama: "+ Ek yükleme koşulları" / "+ Ek teslimat
// koşulları" kaldırma görevinin AÇIKÇA korunmasını istediği tek şey —
// Yükleme Yöntemi dropdown'ının KENDİ "Listede yok / Kendim gireceğim"
// manuel giriş alanı hâlâ çalışıyor mu? Diğer geniş kapsamlı senaryolar
// tmp-nakliye-quantity-and-cleanup-test.mjs/tmp-nakliye-measurement-info-test.mjs
// tarafından zaten kapsanıyor — bu script yalnızca bu tek noktayı test eder.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";
const stamp = Date.now();

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick (wanted "${value}")`);
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 30, g: 60, b: 220 } } })
    .jpeg()
    .toBuffer();
}

async function uploadPhotos(page, count) {
  const fileInput = page.locator('input[type="file"]');
  const files = [];
  for (let i = 0; i < count; i++) files.push({ name: `f-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  await fileInput.setInputFiles(files);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  }, { timeout: 20000 });
}

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email: `nq-loadmethod-${stamp}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: `nq-loadmethod-${stamp}@example.com`, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "Test Loading Method",
    p_phone: "+905321119911",
    p_company_name: "Test Loading Method Şirketi",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible" });
    await fillAndVerify(page.locator('input[type="email"]'), `nq-loadmethod-${stamp}@example.com`);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 });

    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption({ label: "Nakliye" });
    await page.getByLabel("İlan Başlığı").fill("NQ Test — Yükleme Yöntemi Manuel Giriş");
    await page.getByLabel("Hizmete Özel Açıklama").fill("Yükleme Yöntemi manuel giriş alanının hâlâ çalıştığını doğrulayan test ilanı.");
    await fillAndVerify(page.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo Test");
    await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
    await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "10");
    await page.getByLabel("Toplam Ağırlık").first().fill("5");

    await selectSearchable(page, "İlçe", 0, "Dilovası");
    await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
    await page.getByLabel("Açık Adres").nth(0).fill("Test Yükleme Açık Adresi, Dilovası");
    await selectSearchable(page, "İl", 1, "İstanbul");
    await selectSearchable(page, "İlçe", 1, "Kartal");
    await selectSearchable(page, "Liman / Sanayi / OSB", 1, "Listede yok, kendim gireceğim");
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
    await page.getByLabel("Açık Adres").nth(1).fill("Test Teslim Açık Adresi, Kartal");

    const today = new Date();
    await page.locator('input[type="date"]').nth(0).fill(new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10));
    await page.locator('input[type="date"]').nth(1).fill(new Date(today.getTime() + 4 * 86400000).toISOString().slice(0, 10));

    // Yükleme Yöntemi'nde "Listede yok / Kendim gireceğim" seç.
    await selectSearchable(page, "Yükleme Yöntemi", 0, "Listede yok / Kendim gireceğim", { exact: false });
    const manualFieldVisible = await page.getByLabel("Yükleme yöntemini yazın").first().isVisible().catch(() => false);
    record("Yükleme Yöntemi'nde manuel giriş alanı açıldı", manualFieldVisible);
    await fillAndVerify(page.getByLabel("Yükleme yöntemini yazın").first(), "Özel vinç sistemi ile");

    await page.getByText("Nakliyeci uygun aracı önersin").click();
    await uploadPhotos(page, 4);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
    const jobId = page.url().split("/ilanlar/")[1];
    console.log("Job (manuel yükleme yöntemi) oluşturuldu:", jobId);

    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => !document.body.innerText.includes("İlan bulunamadı"), { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    const detailText = await page.locator("body").innerText();
    record(
      "Detay sayfasında manuel yükleme yöntemi metni gösteriliyor",
      detailText.includes("Özel vinç sistemi ile"),
      detailText.match(/Yükleme yöntemi[^\n]*/)?.[0],
    );

    // Requester edit ekranını yeniden aç, manuel değer kalıcı mı?
    await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId}/duzenle`, { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => !document.body.innerText.includes("İlan bulunamadı"), { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    const reopenedManualValue = await page.getByLabel("Yükleme yöntemini yazın").first().inputValue().catch(() => "");
    record("Edit ekranı yeniden açılınca manuel değer kalıcı", reopenedManualValue === "Özel vinç sistemi ile", reopenedManualValue);
  } finally {
    await browser.close();
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} test geçti.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("SCRIPT HATASI:", error);
  process.exitCode = 1;
});
