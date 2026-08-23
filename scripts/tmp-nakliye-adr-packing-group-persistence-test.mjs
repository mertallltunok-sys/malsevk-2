// node scripts/tmp-nakliye-adr-packing-group-persistence-test.mjs
//
// Dar kapsamlı ek doğrulama: "Ambalaj Grubu ... asla I/II/III seçimine
// zorlanmamalı" kuralının, kullanıcı manuel "Uygulanmaz" seçtiğinde ve
// paketleme grubu tanımsız bir UN kaydı (UN1268) kullanıldığında GERÇEKTEN
// kalıcı kaldığını (otomatik doldurma tarafından ezilmediğini) doğrular —
// tmp-nakliye-container-adr-sections-test.mjs'deki asıl senaryo UN1203'ü
// (paketleme grubu tanımlı) İKİ KEZ çözümlediği için bu tek noktayı
// doğrulayamamıştı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 300) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();

async function newActorClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = await newActorClient();
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: fullName,
    p_phone: "+905321119911",
    p_company_name: companyName,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;
  return { id: data.user.id, email };
}

async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick (wanted "${value}")`);
}

async function loginAs(page, email) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
    await fillAndVerify(page.locator('input[type="email"]'), email);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 20000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) return;
  }
  throw new Error(`loginAs(${email}) failed`);
}

async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 40, g: 150, b: 90 } } }).jpeg().toBuffer();
}

async function uploadOnePhoto(page) {
  const files = [];
  for (let i = 0; i < 4; i++) files.push({ name: `f-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  }, { timeout: 15000 });
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function setToggle(page, toggleTitle, optionLabel) {
  const group = page.getByRole("radiogroup", { name: toggleTitle }).first();
  await group.waitFor({ state: "visible", timeout: 10000 });
  await group.getByRole("radio", { name: optionLabel }).click();
}

async function dbQuery(sql) {
  const { execSync } = await import("node:child_process");
  const output = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, { cwd: "c:\\Users\\merta\\malsevk-2", stdio: "pipe" }).toString();
  return JSON.parse(output).rows ?? [];
}

async function main() {
  const requester = await createAccount({
    email: `naklpg-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklPG Requester",
    companyName: "NaklPG Firma",
  });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await loginAs(page, requester.email);

    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await page.getByLabel("İlan Başlığı").first().fill(`NaklPG Test ${stamp.toString(36)}`);
    await page.getByLabel("Açıklama", { exact: false }).first().fill("Ambalaj grubu kalıcılığı testi için otomatik ilan açıklaması.");
    await selectSearchable(page, "İlçe", 0, "Dilovası");
    await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
    await page.getByLabel("Açık Adres").nth(0).fill("Test Yükleme Açık Adresi, Dilovası");
    await selectSearchable(page, "İl", 1, "İstanbul");
    await selectSearchable(page, "İlçe", 1, "Kartal");
    await selectSearchable(page, "Liman / Sanayi / OSB", 1, "Listede yok, kendim gireceğim");
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
    await page.getByLabel("Açık Adres").nth(1).fill("Test Teslim Açık Adresi, Kartal");
    const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await page.locator('input[type="date"]').nth(1).fill(todayPlus7);
    await fillAndVerify(page.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
    await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
    await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "10");
    await fillAndVerify(page.getByLabel("Toplam Ağırlık", { exact: false }).first(), "5");
    await selectSearchable(page, "Yükleme Yöntemi", 0, "Forklift ile");
    await page.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();

    // ADR: Evet -> UN1268 (paketleme grubu TANIMSIZ katalogda) -> manuel "Uygulanmaz" seç.
    await setToggle(page, "Yük tehlikeli madde / ADR kapsamında mı?", "Evet");
    const unInput = page.getByLabel("UN Numarası").first();
    await unInput.fill("UN1268");
    await unInput.blur();
    await page.waitForTimeout(300);
    const psnValue = await page.getByLabel("Resmî Taşımacılık Adı").first().inputValue();
    record("UN1268 için PSN otomatik doldu (paketleme grubu tanımsız kayıt)", psnValue.includes("PETROL"), psnValue);

    await page.getByRole("button", { name: "Ambalaj Grubu", exact: true }).first().click();
    const listbox = page.locator('ul[aria-label="Ambalaj Grubu"]').first();
    await listbox.waitFor({ state: "visible" });
    await listbox.getByRole("option", { name: "Uygulanmaz", exact: true }).click();
    const packingButtonText = await page.getByRole("button", { name: "Ambalaj Grubu", exact: true }).first().innerText();
    record("Manuel 'Uygulanmaz' seçimi arayüzde hemen yansıdı", packingButtonText.includes("Uygulanmaz"), packingButtonText);

    // Konteyner: Hayır (bu testte odak ADR).
    await setToggle(page, "Yük konteyner olarak mı taşınacak?", "Hayır");

    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    try {
      await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    } catch (e) {
      const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
      console.error("danger texts:", JSON.stringify(dangerTexts));
      throw e;
    }
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
    const jobId = page.url().split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("İlan yayımlandı", Boolean(jobId), page.url());

    await page.waitForTimeout(1500);
    const rows = await dbQuery(`select nakliye_hazmat from public.jobs where id = '${jobId}';`);
    const hazmat = rows[0]?.nakliye_hazmat;
    record(
      "Manuel seçilen 'uygulanmaz' Ambalaj Grubu YAYIMDAN SONRA da korundu (otomatik doldurma tarafından EZİLMEDİ)",
      hazmat?.packingGroup === "uygulanmaz" && hazmat?.unNumber === "UN1268",
      JSON.stringify(hazmat),
    );
  } finally {
    await browser.close();
  }

  console.log("\n=== SONUÇ ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("SCRIPT HATASI:", err);
  process.exitCode = 1;
});
