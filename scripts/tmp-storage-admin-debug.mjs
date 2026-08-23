// Odaklı tanı: fresh bir admin hesabı oluşturup /admin, /admin/ilanlar,
// /admin/ilanlar/[gerçek bir id] sayfalarını sırayla açar, her adımda tam
// sayfa metnini + ekran görüntüsünü + konsol hatalarını kaydeder.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";
const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const stamp = Date.now();
const email = `depodebug-adm-${stamp}@example.com`;

async function main() {
  const admin = createClient(SUPABASE_URL, readFileSync("C:/Users/merta/malsevk-2/.env.local", "utf8").match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)[1].trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "DepoDebug Admin",
    p_phone: "+905321119911",
    p_company_name: "DepoDebug Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${data.user.id}';`);
  console.log("Admin hesabı hazır:", email);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
  page.on("requestfailed", (req) => console.log("[REQUEST FAILED]", req.url(), req.failure()?.errorText));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("[HTTP ERROR]", res.status(), res.url());
  });

  console.log("\n--- /giris-yap ---");
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 20000 }).catch((e) => console.log("waitForURL sonrası hâlâ /giris-yap'ta:", e.message));
  await page.waitForTimeout(2000);
  console.log("Giriş sonrası URL:", page.url());

  console.log("\n--- /admin ---");
  await page.goto(`${APP_ORIGIN}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("URL:", page.url());
  console.log("Body metni (ilk 400):", (await page.locator("body").innerText().catch(() => "(okunamadı)")).slice(0, 400));
  await page.screenshot({ path: path.join(os.tmpdir(), "depo-debug-admin-dashboard.png"), fullPage: true }).catch(() => {});

  console.log("\n--- /admin/ilanlar ---");
  await page.goto(`${APP_ORIGIN}/admin/ilanlar`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("URL:", page.url());
  console.log("Body metni (ilk 600):", (await page.locator("body").innerText().catch(() => "(okunamadı)")).slice(0, 600));
  await page.screenshot({ path: path.join(os.tmpdir(), "depo-debug-admin-ilanlar-list.png"), fullPage: true }).catch(() => {});

  console.log("\n--- gerçek bir ilanın satırına tıkla ---");
  const firstRow = page.locator('a[href^="/admin/ilanlar/"]').first();
  const rowHref = await firstRow.getAttribute("href").catch(() => null);
  console.log("Bulunan ilk ilan linki:", rowHref);
  if (rowHref) {
    await firstRow.click();
    await page.waitForTimeout(3000);
    console.log("URL:", page.url());
    console.log("Body metni (ilk 800):", (await page.locator("body").innerText().catch(() => "(okunamadı)")).slice(0, 800));
    await page.screenshot({ path: path.join(os.tmpdir(), "depo-debug-admin-ilan-detail.png"), fullPage: true }).catch(() => {});
  }

  await browser.close();
  await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
  console.log("\nTamamlandı.");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exitCode = 1;
});
