// node scripts/tmp-belge-yukleme-duplicate-error-and-upload-test.mjs
//
// "Production Fotoğraf Yükleme Hatası ve Minimum 1 Fotoğraf Kuralı" görevinin
// belge-yükleme (/panel/belge-yukleme) parçasını doğrular:
//  1. /api/provider-documents/validate artık gerçekten 200 dönüyor (sharp
//     0.35.4 fix'i sonrası) — gerçek bir PDF yüklenince sayaç 1/1 olur ve
//     "Belgeyi Gönder" aktifleşir.
//  2. provider-document-upload.tsx#handleFiles'ın YENİ setUploadErrors([])
//     temizlemesi çalışıyor — aynı türde bir istemci-tarafı reddi art arda
//     İKİ kez tetiklenince, her denemeden SONRA ekranda tam olarak BİR hata
//     satırı görünüyor (önceki denemeden kalan ikinci bir kopya YOK).
//
// Ön koşul: `npm run dev` http://localhost:3000 üzerinde çalışıyor olmalı,
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ortam değişkenleri Development projeyi
// göstermeli (bkz. browser-test-job-photos.mjs ile AYNI desen).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`[belge-yukleme-test] FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(os.tmpdir(), "malsevk-belgetest-"));
function runSql(query) {
  const file = path.join(scratchDir, `q-${Date.now()}.sql`);
  writeFileSync(file, query, "utf8");
  const out = execSync(`npx supabase db query --linked --file ${file} --output json`, { encoding: "utf8" });
  return JSON.parse(out).rows ?? [];
}

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function createRealTestUser(label) {
  const email = `malsevk-belgetest-${label}-${Date.now()}@gmail.com`;
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
    p_role: "hizmet-veren", p_full_name: `Belge Test ${label}`, p_phone: "+905551110088",
    p_company_name: `Belge Test Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Dilovası",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email };
}

// Gerçek, minimal ama GEÇERLİ bir PDF — sharp'a hiç gitmez (document-
// validation.ts#EXTENSION_CONTAINER PDF'i sharp değil kendi imza kontrolüyle
// doğrular), yalnızca /api/provider-documents/validate'in genel çöküşten
// kurtulduğunu (200 döndüğünü) kanıtlamak için yeterli.
const MINIMAL_VALID_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n" +
    "startxref\n0\n%%EOF",
  "utf8",
);
const pdfPath = path.join(scratchDir, "gecerli-faaliyet-belgesi.pdf");
writeFileSync(pdfPath, MINIMAL_VALID_PDF);
const badExtPath = path.join(scratchDir, "desteklenmeyen-dosya.exe");
writeFileSync(badExtPath, Buffer.from("bu bir belge degil"));

async function main() {
  const provider = await createRealTestUser("prov");
  console.log(`provider=${provider.email}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill(provider.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(BASE_URL + "/");
  ok(`Giriş başarılı (${provider.email} / hizmet-veren, gerçek Supabase Auth hesabı)`);

  await page.goto(`${BASE_URL}/panel/belge-yukleme`);
  await page.waitForLoadState("networkidle");

  // İlk seçilebilir kategori kartına tıkla (hangisi olduğu bu testler için
  // önemsiz) — seçici, sayfa başlığı/header/nav'daki AYNI kelimeleri içeren
  // alakasız butonlarla (ör. "Hizmet Taleplerim" nav linki) KARIŞMAMASI için
  // "Hangi hizmeti veriyorsunuz?" başlığını taşıyan kart konteynerine
  // SKOPLANIR — genel bir metin regex'i yerine.
  const pickingSection = page.locator("div").filter({ has: page.getByRole("heading", { name: "Hangi hizmeti veriyorsunuz?" }) }).first();
  const firstCategoryCard = pickingSection.locator("button").first();
  await firstCategoryCard.waitFor({ state: "visible", timeout: 15000 });
  await firstCategoryCard.click();

  await page.locator('input[type="file"]').waitFor({ state: "visible", timeout: 10000 });
  ok("Bir hizmet kategorisi seçildi, belge yükleme alanı göründü");

  // TEST A: desteklenmeyen dosya türü İKİ KEZ ART ARDA seçilir — düzeltmeden
  // ÖNCE, ikinci denemeden sonra AYNI hata metni iki kez (üst üste) görünürdü.
  await page.setInputFiles('input[type="file"]', [badExtPath]);
  await page.getByText("Desteklenmeyen dosya türü.").waitFor({ state: "visible", timeout: 5000 });
  let errorCountAfterFirst = await page.getByText("Desteklenmeyen dosya türü.").count();
  assert.equal(errorCountAfterFirst, 1, `İlk denemeden sonra tam 1 hata satırı bekleniyor, bulunan: ${errorCountAfterFirst}`);

  await page.setInputFiles('input[type="file"]', [badExtPath]);
  await page.getByText("Desteklenmeyen dosya türü.").first().waitFor({ state: "visible", timeout: 5000 });
  const errorCountAfterSecond = await page.getByText("Desteklenmeyen dosya türü.").count();
  assert.equal(
    errorCountAfterSecond,
    1,
    `İkinci (tekrar) denemeden sonra da tam 1 hata satırı bekleniyor (eski hata BİRİKMEMELİ), bulunan: ${errorCountAfterSecond}`,
  );
  ok("TEST A: Aynı hata art arda iki kez tetiklendi, her seferinde ekranda tam olarak 1 hata satırı (birikme YOK)");

  // TEST B: gerçek/geçerli bir PDF yükle — sayaç 1/1 olmalı, "Belgeyi Gönder" aktifleşmeli.
  await page.setInputFiles('input[type="file"]', [pdfPath]);
  await page.getByText("1 / 1 belge yüklendi").waitFor({ state: "visible", timeout: 15000 });
  const submitButton = page.getByRole("button", { name: "Belgeyi Gönder" });
  await assert.doesNotReject(
    (async () => {
      for (let i = 0; i < 20; i++) {
        if (await submitButton.isEnabled()) return;
        await page.waitForTimeout(250);
      }
      throw new Error("Belgeyi Gönder 5 saniye içinde aktifleşmedi");
    })(),
  );
  // Önceki (sunucu 500 çöküşü nedeniyle) reddedilen hata satırları artık YOK.
  const genericServerErrorCount = await page.getByText("Sunucuda beklenmeyen bir hata oluştu.").count();
  assert.equal(genericServerErrorCount, 0, "Gerçek PDF yüklemesinde sunucu hatası GÖRÜNMEMELİ (sharp fix doğrulaması)");
  ok('TEST B: Geçerli PDF sunucu tarafında (sharp 0.35.4) başarıyla doğrulandı, sayaç "1 / 1", "Belgeyi Gönder" aktif, sunucu hatası YOK');

  await submitButton.click();
  await assert.doesNotReject(
    page.getByText(/Onay Bekleniyor|başarıyla|gönderildi|Hizmet Yetkileri/i).first().waitFor({ state: "visible", timeout: 15000 }),
  );
  ok("TEST C: Belge gönderimi tamamlandı (kayıt oluştu)");

  await browser.close();

  console.log(`\n[belge-yukleme-test] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[belge-yukleme-test] HATA:", error);
  process.exitCode = 1;
});
