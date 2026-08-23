// node scripts/tmp-field-limit-hardening-test.mjs
//
// "Tüm İlan Formlarında Gerçek, Alana Uygun ve Aşılamaz Giriş Sınırları"
// görevinin gerçek tarayıcıya karşı kanıtı — ilan başlığı/açık adres/
// Nakliye'nin Ürün-Yük Cinsi/Boy alanlarının maxLength'i VE "Başka Yük
// Grubu Ekle" butonunun 20'de durduğu doğrudan DOM üzerinden kontrol edilir.
// Sunucu/RPC/DB tarafı bypass testleri (bu görevin ayrı, tamamlanmış parçası)
// tmp-general-security-hardening-test.mjs'in helper'larıyla AYNI desenle
// zaten doğrudan SQL ile hosted Development'a karşı yapıldı (bkz. görev
// raporu) — bu script yalnızca UI/DOM katmanını kanıtlar.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-fieldlimit-"));
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
  const email = `malsevk-fieldlimit-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;

  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signIn(${label}) after confirm failed: ${signInError.message}`);
  }

  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Field Limit ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Field Limit Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);

  return { id: userId, email, client };
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

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Test kullanıcısı oluşturuluyor ---");
    const requester = await createUser("req", "hizmet-alan");
    console.log(`requester=${requester.email}`);

    const page = await browser.newPage();
    await loginAs(page, requester.email);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

    // A) İlan Başlığı — maxLength=80, 200 karakter yapıştırma denemesi
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
    await page.waitForTimeout(400);
    const titleInput = page.getByLabel("İlan Başlığı").first();
    await titleInput.fill("A".repeat(200));
    const titleValue = await titleInput.inputValue();
    record("A) İlan Başlığı maxLength=80 gerçek arayüzde uygulanıyor", titleValue.length === 80, `200 karakter yazıldı, ${titleValue.length} karakter kaldı`);

    // B) Açık Adres — maxLength=250
    await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
    const districtListbox = page.locator('ul[aria-label="İlçe"]').first();
    await districtListbox.waitFor({ state: "visible" });
    await districtListbox.getByRole("option", { name: "Gebze", exact: true }).first().click();
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
    const facilityListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first();
    await facilityListbox.waitFor({ state: "visible" });
    await facilityListbox.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).first().click();
    const addressInput = page.getByLabel("Açık Adres").first();
    await addressInput.fill("B".repeat(400));
    const addressValue = await addressInput.inputValue();
    record("B) Açık Adres maxLength=250 gerçek arayüzde uygulanıyor", addressValue.length === 250, `400 karakter yazıldı, ${addressValue.length} karakter kaldı`);

    // C) Nakliye kategorisine geç — Ürün/Yük Cinsi manuel metin (100), Boy (5000cm max), yük grubu 20 sınırı
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await page.waitForTimeout(600);

    // Ürün/Yük Cinsi -> "Listede Yok, Kendim Gireceğim" -> maxLength=100
    const productTypeCombobox = page.locator('input[role="combobox"]').first();
    await productTypeCombobox.waitFor({ state: "visible", timeout: 10000 });
    await productTypeCombobox.fill("Listede Yok");
    await page.waitForTimeout(300);
    const customOption = page.getByRole("option", { name: "Listede Yok, Kendim Gireceğim" }).first();
    if (await customOption.isVisible().catch(() => false)) {
      await customOption.click();
      const customInput = page.locator('input[id$="-product-type-custom"]').first();
      await customInput.waitFor({ state: "visible", timeout: 5000 });
      await customInput.fill("C".repeat(300));
      const customValue = await customInput.inputValue();
      record("C) Ürün/Yük Cinsi manuel giriş maxLength=100 uygulanıyor", customValue.length === 100, `300 karakter yazıldı, ${customValue.length} karakter kaldı`);
    } else {
      record("C) Ürün/Yük Cinsi manuel giriş maxLength=100 uygulanıyor", false, "Listede Yok seçeneği bulunamadı");
    }

    // Yükün Hazırlanış Biçimi -> "Paletli" seçildiğinde Ölçü kartı açılır -> Boy (cm) maxLength testi
    const loadPrepButton = page.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).first();
    await loadPrepButton.click();
    const loadPrepListbox = page.locator('ul[aria-label="Yükün Hazırlanış Biçimi"]').first();
    await loadPrepListbox.waitFor({ state: "visible" });
    await loadPrepListbox.getByRole("option", { name: "Paletli", exact: true }).first().click();
    await page.waitForTimeout(400);
    const lengthInput = page.getByLabel("Boy (cm)", { exact: false }).first();
    await lengthInput.waitFor({ state: "visible", timeout: 5000 });
    await lengthInput.fill("99999999");
    const lengthValue = await lengthInput.inputValue();
    // MAX_LENGTH_CM=5000 -> digitInputMaxLength(5000) = 4 digits, no decimal char typed here
    record("D) Nakliye Boy (cm) alanı sınırsız basamak kabul etmiyor (maxLength uygulanıyor)", lengthValue.length <= 7, `8 haneli rakam yazıldı, ${lengthValue.length} karakter kaldı (${lengthValue})`);

    // E) "Başka Yük Grubu Ekle" 20'de duruyor mu?
    const addGroupButton = page.getByRole("button", { name: "Başka Yük Grubu Ekle" });
    let clicks = 0;
    for (let i = 0; i < 25; i += 1) {
      const visible = await addGroupButton.isVisible().catch(() => false);
      if (!visible) break;
      await addGroupButton.click();
      clicks += 1;
      await page.waitForTimeout(60);
    }
    const groupCount = await page.locator('p:text-matches("^Yük Grubu \\\\d+$")').count();
    const buttonGoneAt20 = !(await addGroupButton.isVisible().catch(() => false));
    record(
      "E) Yük grubu ekleme 20'de duruyor (21. eklenemiyor)",
      groupCount === 20 && buttonGoneAt20,
      `${clicks} kez tıklandı, ekranda ${groupCount} grup var, buton görünür mü: ${!buttonGoneAt20}`,
    );

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
