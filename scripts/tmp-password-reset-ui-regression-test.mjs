// node scripts/tmp-password-reset-ui-regression-test.mjs
//
// "Şifremi Unuttum" akışının GERÇEK UI'dan (forgot-password-form.tsx)
// regresyona uğramadığını doğrular: gerçek bir test hesabı oluşturur,
// gerçek formu doldurur, gönderir, nötr başarı mesajının göründüğünü ve
// konsolda hata olmadığını kontrol eder. NOT: bu ortamda gerçek bir
// e-posta kutusuna (inbox) erişim YOKTUR — bu script GERÇEK teslimatı
// KANITLAYAMAZ, yalnızca istemci tarafı akışın ve resetPasswordForEmail
// API çağrısının hatasız çalıştığını doğrular (bkz. proje raporu).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";
const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const email = `malsevk-pwreset-ui-${stamp}@gmail.com`;
let createdUserId = null;
let browser;

async function main() {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  createdUserId = data.user.id;

  browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${APP_ORIGIN}/sifre-sifirla`);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.locator('input[type="email"]').fill(email);

  const start = Date.now();
  await page.getByRole("button", { name: /gönder|sıfırla|talep/i }).click();
  const neutralMessageVisible = await page
    .getByText(/e-posta adresinize gönderildi|bağlantı gönderildi|kontrol edin/i)
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const elapsedMs = Date.now() - start;

  record("Gerçek /sifre-sifirla formu GERÇEK UI üzerinden gönderildi", true, `${elapsedMs}ms`);
  record("Nötr başarı mesajı gösterildi (e-posta enumeration koruması)", neutralMessageVisible);
  record("Konsol hatası yok", consoleErrors.length === 0, JSON.stringify(consoleErrors));

  if (!neutralMessageVisible) {
    console.log("--- DEBUG: sayfa metni ---");
    console.log((await page.locator("main").innerText()).slice(0, 1500));
  }

  await browser.close();
}

async function cleanup() {
  if (createdUserId) {
    await admin.auth.admin.deleteUser(createdUserId).catch((e) => console.error(`deleteUser failed: ${e.message}`));
  }
  if (browser) await browser.close().catch(() => {});
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
