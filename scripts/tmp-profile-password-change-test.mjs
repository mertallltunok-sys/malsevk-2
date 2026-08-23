// node scripts/tmp-profile-password-change-test.mjs
//
// "Profil İçinden Şifre Değiştirme" görevinin gerçek tarayıcı + gerçek
// Supabase Auth kanıtı: Hesap Ayarları > Güvenlik'teki yeni "Şifre Değiştir"
// formu ile GERÇEK bir şifre değişikliği yapılır, ardından ESKİ şifreyle
// giriş REDDEDİLDİĞİ, YENİ şifreyle giriş KABUL EDİLDİĞİ doğrudan
// `supabase.auth.signInWithPassword` ile kanıtlanır (yalnızca ekrandaki
// "başarılı" mesajına güvenilmez).
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const OLD_PASSWORD = "TestSifre2026!";
const NEW_PASSWORD = "YeniTestSifre2026!";

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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-pwchange-"));
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
const email = `malsevk-pwchange-req-${stamp}@gmail.com`;

async function run() {
  console.log("--- Test kullanıcısı oluşturuluyor (hizmet-alan) ---");
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: OLD_PASSWORD });
  if (error) throw new Error(`signUp failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "Password Change Test",
    p_phone: "+905551110099",
    p_company_name: "Password Change Test Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration failed: ${crError.message}`);
  console.log(`user=${email}`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${APP_ORIGIN}/giris-yap`);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 10000 });
    record("A) Eski şifreyle gerçek girişe UI üzerinden başarılı", true);

    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    await page.getByRole("heading", { name: "Güvenlik" }).waitFor({ state: "visible", timeout: 10000 });
    record('B) "Yakında" ibaresi Güvenlik kartında artık YOK', (await page.getByText("Yakında").count()) === 0);

    // Yanlış mevcut şifre denemesi — REDDEDİLMELİ.
    await page.getByLabel("Mevcut Şifre").fill("YanlisSifre999!");
    await page.getByLabel("Yeni Şifre", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Yeni Şifre Tekrar").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Şifreyi Değiştir" }).click();
    const wrongPwError = page.getByRole("alert").filter({ hasText: "Mevcut şifreniz hatalı." });
    await wrongPwError.waitFor({ state: "visible", timeout: 10000 });
    record("C) Yanlış mevcut şifre GERÇEK arayüzde reddediliyor", true, await wrongPwError.textContent());

    // Uyuşmayan yeni şifreler — REDDEDİLMELİ.
    await page.getByLabel("Mevcut Şifre").fill(OLD_PASSWORD);
    await page.getByLabel("Yeni Şifre", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Yeni Şifre Tekrar").fill("BaskaBirSifre999!");
    await page.getByRole("button", { name: "Şifreyi Değiştir" }).click();
    const mismatchError = page.getByRole("alert").filter({ hasText: "Yeni şifreler eşleşmiyor." });
    await mismatchError.waitFor({ state: "visible", timeout: 10000 });
    record("D) Uyuşmayan yeni şifreler GERÇEK arayüzde reddediliyor", true, await mismatchError.textContent());

    // Yeni şifre = mevcut şifre — REDDEDİLMELİ.
    await page.getByLabel("Mevcut Şifre").fill(OLD_PASSWORD);
    await page.getByLabel("Yeni Şifre", { exact: true }).fill(OLD_PASSWORD);
    await page.getByLabel("Yeni Şifre Tekrar").fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Şifreyi Değiştir" }).click();
    const samePwError = page.getByRole("alert").filter({ hasText: "Yeni şifreniz mevcut şifrenizden farklı olmalıdır." });
    await samePwError.waitFor({ state: "visible", timeout: 10000 });
    record("E) Yeni şifre = mevcut şifre GERÇEK arayüzde reddediliyor", true, await samePwError.textContent());

    // GERÇEK, başarılı değişiklik.
    await page.getByLabel("Mevcut Şifre").fill(OLD_PASSWORD);
    await page.getByLabel("Yeni Şifre", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Yeni Şifre Tekrar").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Şifreyi Değiştir" }).click();
    const successMsg = page.getByRole("status").filter({ hasText: "Şifreniz başarıyla değiştirildi." });
    await successMsg.waitFor({ state: "visible", timeout: 10000 });
    record("F) Gerçek şifre değişikliği GERÇEK arayüzde başarılı mesajı gösteriyor", true, await successMsg.textContent());

    // Kullanıcı ÇIKIŞA ZORLANMADI mı? Hâlâ /panel/hesap-ayarlari'nda mı?
    record("G) Başarı sonrası kullanıcı çıkışa ZORLANMADI (hâlâ hesap ayarlarında)", page.url().includes("/panel/hesap-ayarlari"));

    await browser.close();
  } catch (e) {
    await browser.close();
    throw e;
  }

  // GERÇEK Supabase Auth ile doğrudan doğrulama — ekran mesajına güvenmeden.
  const oldPwClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: oldPwError } = await oldPwClient.auth.signInWithPassword({ email, password: OLD_PASSWORD });
  record("H) ESKİ şifreyle GERÇEK Supabase Auth girişi artık REDDEDİLİYOR", !!oldPwError, oldPwError ? oldPwError.message : "HATA: eski şifre hâlâ çalışıyor");

  const newPwClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: newPwError } = await newPwClient.auth.signInWithPassword({ email, password: NEW_PASSWORD });
  record("I) YENİ şifreyle GERÇEK Supabase Auth girişi BAŞARILI", !newPwError, newPwError ? newPwError.message : "başarılı");

  console.log("");
  console.log(`=== SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
  if (results.some((r) => !r.pass)) {
    console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
