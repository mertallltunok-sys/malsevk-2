// node scripts/tmp-vercel-preview-real-flow-verification.mjs <previewUrl>
//
// "Production Fotoğraf Yükleme Hatası" görevinin GERÇEK Vercel Linux runtime
// doğrulaması — gerçek bir preview deployment'a, gerçek Development Supabase
// hesaplarıyla, gerçek tarayıcı akışıyla:
//  1. Hizmet Alan: 1 gerçek HEIC fotoğrafla ilan oluşturur (sharp/heic-convert
//     gerçekten Vercel'in Linux runtime'ında çalışıyor mu — asıl kanıt).
//  2. Hizmet Veren: /panel/belge-yukleme'de aynı türde bir istemci-tarafı
//     reddini iki kez tetikler (hata BİRİKMEMELİ), sonra gerçek bir belge
//     yükler ve gönderir.
//
// Vercel'in kendi "Vercel Authentication" (SSO) koruması preview URL'lerini
// sarıyor — her isteğe x-vercel-protection-bypass header'ı eklenir (yalnızca
// bu betiğin kendi trafiği için, secret hiçbir yere yazdırılmaz).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const PREVIEW_URL = process.argv[2];
const SECRET_FILE = process.argv[3];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!PREVIEW_URL || !SECRET_FILE) {
  console.error("Kullanım: node tmp-vercel-preview-real-flow-verification.mjs <previewUrl> <secretFilePath>");
  process.exit(1);
}
if (!SUPABASE_URL || !/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}
const BYPASS_SECRET = readFileSync(SECRET_FILE, "utf8").trim();

const scratchDir = mkdtempSync(path.join(os.tmpdir(), "malsevk-previewtest-"));
function runSql(query) {
  const file = path.join(scratchDir, `q-${Date.now()}.sql`);
  writeFileSync(file, query, "utf8");
  const out = execSync(`npx supabase db query --linked --file ${file} --output json`, { encoding: "utf8" });
  return JSON.parse(out).rows ?? [];
}

let passed = 0;
function ok(d) { passed++; console.log(`  ✓ ${d}`); }

async function createRealTestUser(label, role) {
  const email = `malsevk-previewtest-${label}-${Date.now()}@gmail.com`;
  const cli = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await cli.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signInWithPassword(${label}) failed: ${signInError.message}`);
  }
  const { error: crError } = await cli.rpc("complete_registration", {
    p_role: role, p_full_name: `Preview Test ${label}`, p_phone: "+905551110055",
    p_company_name: `Preview Test Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Dilovası",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email };
}

const HEIC_PATH = "C:\\Users\\merta\\AppData\\Local\\Temp\\malsevk-real-test.heic";
const MINIMAL_VALID_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n" +
    "startxref\n0\n%%EOF",
  "utf8",
);
const pdfPath = path.join(scratchDir, "gecerli-belge.pdf");
writeFileSync(pdfPath, MINIMAL_VALID_PDF);
const badExtPath = path.join(scratchDir, "desteklenmeyen.exe");
writeFileSync(badExtPath, Buffer.from("belge degil"));

async function main() {
  const requester = await createRealTestUser("req", "hizmet-alan");
  const provider = await createRealTestUser("prov", "hizmet-veren");
  console.log(`requester=${requester.email} provider=${provider.email}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
    },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  // --- Hizmet Alan: gerçek HEIC fotoğrafla ilan oluştur ---
  await page.goto(`${PREVIEW_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill(requester.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${PREVIEW_URL}/hizmet-talebi-olustur`, { timeout: 30000 });
  ok(`Hizmet Alan girişi çalışıyor (${requester.email}, GERÇEK Vercel deployment)`);

  // browser-test-job-photos.mjs#fillBaseFormFields İLE AYNI, doğrulanmış alan doldurma sırası.
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("vinc-operatoru");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-15");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-15");
  await page.getByLabel("İlan Başlığı").first().fill("Preview Test İlanı - Gerçek HEIC");
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("Bu ilan Vercel preview deployment doğrulaması için otomatik oluşturulmuştur, en az yirmi karakter.");

  await page.getByRole("button", { name: "İl", exact: true }).first().click();
  await page.locator('ul[aria-label="İl"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İl"]').first().getByRole("option", { name: "Kocaeli", exact: true }).click();

  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();

  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
  await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Liman / Sanayi / OSB"]')
    .first()
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();

  await page.getByLabel("Açık Adres").first().fill("Deneme Mahallesi, Test Sokak No:1, Dilovası/Kocaeli");

  await page.setInputFiles('input[type="file"]', [HEIC_PATH]);
  await page.getByText(/1 \/ 15 fotoğraf yüklendi/).waitFor({ state: "visible", timeout: 30000 });
  const previewImg = page.locator("img").first();
  await previewImg.waitFor({ state: "visible", timeout: 20000 });
  const naturalWidth = await previewImg.evaluate((img) => img.naturalWidth);
  assert.ok(naturalWidth > 0, "HEIC önizlemesi gerçek bir görüntü olarak yüklenemedi (Vercel Linux runtime)");
  ok("Gerçek HEIC dosyası Vercel'in Linux runtime'ında (sharp+heic-convert) başarıyla işlendi ve önizlendi");

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("button", { name: /İlanı Yayınla|Hizmet İlanını Yayınla/ }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
  await assert.doesNotReject(page.locator("img[alt*=' - fotoğraf ']").waitFor({ state: "visible", timeout: 15000 }));
  ok("İlan (gerçek HEIC kapak fotoğrafıyla) Vercel preview'da başarıyla yayınlandı");

  // --- Hizmet Veren: belge yükleme, duplicate-hata fix + gerçek belge ---
  await page.goto(`${PREVIEW_URL}/giris-yap?redirect=/panel/belge-yukleme`);
  await page.locator('input[type="email"]').fill(provider.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${PREVIEW_URL}/panel/belge-yukleme`, { timeout: 30000 });
  ok(`Hizmet Veren girişi çalışıyor (${provider.email})`);

  const pickingSection = page.locator("div").filter({ has: page.getByRole("heading", { name: "Hangi hizmeti veriyorsunuz?" }) }).first();
  const firstCategoryCard = pickingSection.locator("button").first();
  await firstCategoryCard.waitFor({ state: "visible", timeout: 15000 });
  await firstCategoryCard.click();
  await page.locator('input[type="file"]').waitFor({ state: "visible", timeout: 10000 });

  await page.setInputFiles('input[type="file"]', [badExtPath]);
  await page.getByText("Desteklenmeyen dosya türü.").waitFor({ state: "visible", timeout: 5000 });
  await page.setInputFiles('input[type="file"]', [badExtPath]);
  await page.getByText("Desteklenmeyen dosya türü.").first().waitFor({ state: "visible", timeout: 5000 });
  const dupErrorCount = await page.getByText("Desteklenmeyen dosya türü.").count();
  assert.equal(dupErrorCount, 1, `İkinci denemeden sonra tam 1 hata satırı bekleniyor, bulunan: ${dupErrorCount}`);
  ok("Aynı hata art arda iki kez tetiklendi, ekranda birikme YOK (tam 1 satır) — GERÇEK Vercel deployment'ında");

  await page.setInputFiles('input[type="file"]', [pdfPath]);
  await page.getByText("1 / 1 belge yüklendi").waitFor({ state: "visible", timeout: 20000 });
  const genericServerErrorCount = await page.getByText("Sunucuda beklenmeyen bir hata oluştu.").count();
  assert.equal(genericServerErrorCount, 0, "Gerçek belge yüklemesinde sunucu hatası GÖRÜNMEMELİ");
  const submitButton = page.getByRole("button", { name: "Belgeyi Gönder" });
  await assert.doesNotReject(
    (async () => {
      for (let i = 0; i < 20; i++) {
        if (await submitButton.isEnabled()) return;
        await page.waitForTimeout(250);
      }
      throw new Error("Belgeyi Gönder aktifleşmedi");
    })(),
  );
  await submitButton.click();
  await assert.doesNotReject(
    page.getByText(/Onay Bekleniyor|başarıyla|gönderildi|Hizmet Yetkileri/i).first().waitFor({ state: "visible", timeout: 15000 }),
  );
  ok("Gerçek belge Vercel preview'da (sharp doğrulaması dahil) başarıyla yüklendi ve gönderildi");

  if (consoleErrors.length > 0) {
    console.log("UYARI: konsol hataları:", consoleErrors);
  } else {
    ok("Konsolda hiç JS hatası yakalanmadı");
  }

  await browser.close();
  console.log(`\n[vercel-preview-real-flow] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[vercel-preview-real-flow] HATA:", error);
  process.exitCode = 1;
});
