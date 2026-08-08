// MALSEVK — Tam uçtan uca regresyon eki: henüz gerçek UI ile denenmemiş
// kalan hizmet türleri (Kapalı Depolama, Gümrük Müşavirliği — ikisi de
// isSimplifiedLocationCategory, yalnızca İl/İlçe) + admin "Bize Ulaşın
// Mesajları" modülünün duman testi. Gerçek Supabase Auth hesaplarıyla.
// Önkoşul: `npm run dev`, yerel Docker Supabase'e işaret ediyor olmalı.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";
const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Refusing to run: target Supabase URL is not local (safety guard).");
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

async function makeRealAccount(label, role) {
  const email = `e2e-cat-${label}-${stamp}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  createdUserIds.push(created.data.user.id);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  const reg = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Test ${label}`, p_phone: "+905551239911",
    p_company_name: `Test ${label} Firma`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (reg.error) throw new Error(`${label} complete_registration: ${reg.error.message}`);
  return { email, id: created.data.user.id };
}

async function loginAs(page, email, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function uploadOnePhoto(page) {
  // Gümrük Müşavirliği kategorisinde İKİ dosya input'u var: ilan fotoğrafları
  // VE destekleyici evrak yükleme (bkz. job-customs-document-upload.tsx) —
  // accept özniteliğiyle özellikle FOTOĞRAF input'u hedeflenir.
  await page.locator('input[type="file"][accept*="webp"]').setInputFiles({
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

async function main() {
  console.log("=== Kurulum ===");
  const requester = await makeRealAccount("requester", "hizmet-alan");
  const adminUser = await makeRealAccount("admin", "hizmet-alan");
  check("setup: hesaplar oluşturuldu", !!requester.id && !!adminUser.id);

  // Admin rolüne yükseltme (yerel, sandbox-only) — docker exec psql, diğer script'lerle AYNI desen.
  const { execSync } = await import("node:child_process");
  execSync(
    `docker exec supabase_db_malsevk-2 psql -U postgres -d postgres -t -A -c "update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';"`,
  );

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    console.log("\n=== 1) Kapalı Depolama ilanı — sadeleştirilmiş lokasyon (yalnız İl/İlçe) ===");
    const depoTitle = `E2E-DEPO-${stamp}`;
    await loginAs(page, requester.email);
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Kapalı Depolama" });
    await page.getByLabel("İlan Başlığı").fill(depoTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Kapalı depolama e2e regresyon testi, yirmi karakterden uzun.");
    check("1a. Sadeleştirilmiş kategori için 'Liman / Sanayi / OSB' alanı HİÇ gösterilmiyor", (await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).count()) === 0);
    check("1b. Sadeleştirilmiş kategori için 'Açık Adres' alanı HİÇ gösterilmiyor", (await page.getByLabel("Açık Adres").count()) === 0);
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-15");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-20");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    check("1c. Kapalı Depolama ilanı oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());
    await page.getByText(depoTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const depoText = await page.locator("main").innerText();
    check("1d. Detay sayfası doğru ili gösteriyor", depoText.includes("Kocaeli"));

    console.log("\n=== 2) Gümrük Müşavirliği ilanı — sadeleştirilmiş lokasyon + Operasyon Bilgileri ===");
    const gumrukTitle = `E2E-GUMRUK-${stamp}`;
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Gümrük Müşavirliği" });
    await page.getByLabel("İlan Başlığı").fill(gumrukTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Gümrük müşavirliği e2e regresyon testi, yirmi karakterden uzun.");
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await selectFromSearchable(page, "İşlem Türü", "İthalat");
    await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
    await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-15");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-16");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    check("2a. Gümrük Müşavirliği ilanı oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());
    await page.getByText(gumrukTitle).first().waitFor({ state: "visible", timeout: 15000 });
    const gumrukText = await page.locator("main").innerText();
    check("2b. Detay sayfası İşlem Türünü gösteriyor (İthalat)", gumrukText.includes("İthalat"));
    check("2c. Detay sayfası Ürün Cinsini gösteriyor (Rulo Sac)", gumrukText.includes("Rulo Sac"));
    check("2d. Konsolda beklenmeyen JS hatası yok (her iki kategori)", jsErrors.length === 0, jsErrors.join(" | "));

    console.log("\n=== 3) Admin 'Bize Ulaşın Mesajları' modülü duman testi ===");
    await loginAs(page, adminUser.email);
    await page.goto(`${BASE_URL}/admin/iletisim-mesajlari`);
    const notFoundCount = await page.getByText(/404|bulunamadı/i).count();
    check("3a. Admin /admin/iletisim-mesajlari'a erişebiliyor (404 yok)", notFoundCount === 0);
    check("3b. Sayfa hatasız render ediliyor", jsErrors.length === 0, jsErrors.join(" | "));

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
