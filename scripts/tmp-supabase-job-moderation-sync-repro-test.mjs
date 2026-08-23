// node scripts/tmp-supabase-job-moderation-sync-repro-test.mjs
//
// AŞAMA 1 — BUG'I KANITLA (flag KAPALI, mevcut .env.local/dev sunucusu
// DEĞİŞTİRİLMEDEN). Development Supabase projesine (trfnmpihcnriqgikglpu) ve
// GERÇEK dev sunucusuna (http://localhost:3000, zaten çalışıyor olmalı,
// NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC .env.local'da TANIMLI DEĞİL) karşı:
// gerçek bir Hizmet Alan hesabıyla, gerçek `/hizmet-talebi-olustur` formundan
// bir ilan oluşturur, ardından:
//   (a) kullanıcının kendi "Hizmet Taleplerim" ekranında GERÇEKTEN "Admin
//       Onayı Bekleniyor" rozetini görüp görmediğini,
//   (b) bu ilana karşılık gelen bir satırın Supabase `jobs` tablosunda
//       GERÇEKTEN var olup olmadığını (id/title ile doğrudan sorgu)
// doğrudan kanıtlar. Beklenen (bug'ın kendisi): (a) EVET görünür, (b) HAYIR
// hiçbir satır yok — yani kullanıcı tarafındaki moderasyon durumu ile admin
// panelinin (100% Supabase) okuduğu gerçek kayıt birbirinden TAMAMEN kopuk.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-mod-repro-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

const createdUserIds = [];
async function createRequester() {
  const stamp = Date.now();
  const email = `malsevk-modrepro-req-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: "ModRepro Requester", p_phone: "+905551110099",
    p_company_name: "ModRepro Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration failed: ${crError.message}`);
  return { id: data.user.id, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
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
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function main() {
  const requester = await createRequester();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  await loginAs(page, requester.email);

  const jobTitle = `MODREPRO-TEST-${Date.now()}`;
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.locator("select").first().selectOption({ label: "Forklift" });
  await page.getByLabel("İlan Başlığı").fill(jobTitle);
  await page.getByLabel("Hizmete Özel Açıklama").fill("Bu, moderasyon senkron reprodüksiyon testinin oluşturduğu bir ilandır.");
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
  const facilityListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await facilityListbox.waitFor({ state: "visible" });
  await facilityListbox.getByRole("option", { name: /Listede yok/ }).first().click();
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
  await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Gebze");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
  await uploadOnePhoto(page);

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
  const createdJobId = page.url().split("/ilanlar/")[1].split("?")[0];
  record("1. İlan gerçek UI'dan başarıyla oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());

  await page.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
  await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
  const panelText = await page.locator("main").innerText();
  const sawPendingBadge = panelText.includes("Admin Onayı Bekleniyor");
  record("2. Kullanıcının KENDİ ekranında (Hizmet Taleplerim) 'Admin Onayı Bekleniyor' GÖRÜNÜYOR", sawPendingBadge);

  const jobRow = runSql(`select id, title, moderation_status from public.jobs where id = '${createdJobId}';`);
  record(
    "3. BUG KANITI: Supabase 'jobs' tablosunda BU ilana ait HİÇBİR satır YOK (flag kapalı olduğu için hiç senkron edilmedi)",
    jobRow.length === 0,
    JSON.stringify(jobRow),
  );

  const anyTitleMatch = runSql(`select id, title from public.jobs where title = '${jobTitle}';`);
  record("4. Başlığa göre arasak da Supabase'de aynı ilan yok (id uyuşmazlığı değil, gerçekten senkronize edilmemiş)", anyTitleMatch.length === 0, JSON.stringify(anyTitleMatch));

  await browser.close();
  console.log(`\nOluşturulan yerel ilan id: ${createdJobId} (yalnızca bu tarayıcının localStorage'ında var, Supabase'de YOK)`);
  console.log(`Test kullanıcısı: ${requester.email} (Supabase auth id: ${requester.id}) — temizlenmedi, sonraki fazda tekrar kullanılabilir ya da manuel silinebilir.`);
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
    }
  });
