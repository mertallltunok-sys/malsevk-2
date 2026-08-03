// PRODUCTION MODE (npm run build + npm start, http://localhost:3000)
// doğrulaması: Gümrük Müşaviri demo hesabı (gumrukdemo@malsevk.demo), Nakliyeci ve
// diğer tüm dev-seed hesapları gibi yalnızca `NODE_ENV === "development"`
// altında (bkz. users.ts#seedDevAccountsIfNeeded) oluşturulur/görünür olmalı
// — production build'de (Vercel preview/production dahil) hiç seed
// edilmemeli VE giriş ekranındaki "Geliştirme ortamı test hesapları"
// kutusunda hiç görünmemelidir.
// Ön koşul: `npm run build && npm start` (http://localhost:3000) — `npm run
// dev` DEĞİL, bu script tam olarak dev/production ayrımını sınadığı için.
// Production modda site-genelinde geçici şifre kapısı da aktif olur (bkz.
// proxy.ts, site-access.ts) — diğer tmp-*-prod.mjs script'leriyle AYNI
// desen: MALSEVK_SITE_PASSWORD .env.local'daki değerle eşleşmelidir.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SITE_ACCESS_PASSWORD = "TestSifre2026!";
const GUMRUK_DEMO = { email: "gumrukdemo@malsevk.demo", password: "Demo1234!" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log(`Hedef: ${BASE_URL} (production mode olduğu varsayılır)`);

    // ============ 0) Site-genelinde şifre kapısını geç ============
    await page.goto(`${BASE_URL}/`);
    if (page.url().includes("/site-erisim")) {
      await page.getByLabel("Şifre").fill(SITE_ACCESS_PASSWORD);
      await page.getByRole("button", { name: "Giriş Yap" }).click();
      await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
    }
    check("Site-genelinde şifre kapısı geçildi", !page.url().includes("/site-erisim"));

    // ============ 1) Giriş ekranında hiçbir demo hesap kutusu yok ============
    await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
    await page.waitForTimeout(300);
    check(
      "'Geliştirme ortamı test hesapları' kutusu HİÇ görünmüyor (production)",
      (await page.getByText("Geliştirme ortamı test hesapları").count()) === 0,
    );
    check(
      "'gumrukdemo@malsevk.demo' metni sayfanın HİÇBİR yerinde görünmüyor (production)",
      (await page.getByText("gumrukdemo@malsevk.demo").count()) === 0,
    );
    check(
      "Diğer hiçbir demo hesap e-postası da görünmüyor (Nakliyeci/Mert/Zeynep/Admin)",
      (await page.getByText(/nakliyeci@test\.com|mert@test\.com|zeynep@test\.com|admin@test\.com/).count()) === 0,
    );

    // ============ 2) Gümrük demo hesabıyla giriş BAŞARISIZ olmalı (hiç seed edilmedi) ============
    await page.goto(`${BASE_URL}/giris-yap`);
    await page.getByLabel("E-posta").fill(GUMRUK_DEMO.email);
    await page.getByLabel("Şifre", { exact: true }).fill(GUMRUK_DEMO.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForTimeout(1000);
    check(
      "Gümrük demo hesabıyla giriş BAŞARISIZ (hesap production'da hiç yok)",
      await page.getByText("E-posta veya şifre hatalı.").isVisible().catch(() => false),
    );
    check("Sayfa hâlâ /giris-yap'ta (yönlendirme olmadı)", page.url().startsWith(`${BASE_URL}/giris-yap`));

    check("Kontroller sırasında konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ (PRODUCTION)." : "\nSONUÇ: TÜM KONTROLLER PRODUCTION'DA DA GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify-prod] GENEL HATA:", error);
  process.exitCode = 1;
});
