// PRODUCTION MODE (npm run build + npm start, http://localhost:3000) route
// denetimi. Dev seed hesapları burada YOK (NODE_ENV=development gate'i,
// bkz. users.ts#seedDevAccountsIfNeeded) — gerçek Kayıt Ol akışıyla taze
// hesaplar oluşturulur. Amaç: build çıktısının gerçek route'ları/chunk'ları
// doğru servis ettiğini, guest + oturumlu gezinmede 404/konsol hatası
// olmadığını doğrulamak (iş kuralları zaten dev modda kapsamlı test edildi).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STAMP = Date.now();
const REQUESTER = {
  firstName: "Prod", lastName: `Req${STAMP}`, email: `prod-audit-req-${STAMP}@test.com`,
  phone: "0532 111 22 33", password: "Test1234!", role: "hizmet-alan", companyName: "Prod Audit Requester",
};
const PROVIDER = {
  firstName: "Prod", lastName: `Prov${STAMP}`, email: `prod-audit-prov-${STAMP}@test.com`,
  phone: "0533 222 33 44", password: "Test1234!", role: "hizmet-veren", companyName: "Prod Audit Provider",
};

let anyFail = false;
const results = [];
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  results.push({ label, passed });
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

const NOT_FOUND_MARKERS = ["This page could not be found", "sayfa bulunamadı", "Sayfa Bulunamadı"];

async function visitAndCheck(page, url, label) {
  page.jsProblems = [];
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  let response;
  try {
    response = await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (error) {
    check(`${label} (${url})`, false, `goto hata: ${error}`);
    return;
  }
  const status = response ? response.status() : null;
  const finalUrl = page.url();
  await page.waitForTimeout(150);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasHeader = await page.locator("header").first().isVisible().catch(() => false);
  const hasFooter = await page.locator("footer").first().isVisible().catch(() => false);
  const hasUndefinedInUrl = /\/(undefined|null)(\/|\?|$)/.test(finalUrl);
  const looksNotFound = NOT_FOUND_MARKERS.some((marker) => bodyText.includes(marker));
  const ok =
    (status === null || status < 400) &&
    !hasUndefinedInUrl &&
    hasHeader &&
    hasFooter &&
    !looksNotFound &&
    page.jsProblems.length === 0;
  check(
    `${label} (${url})`,
    ok,
    `status=${status}, finalUrl=${finalUrl}, jsErrors=${page.jsProblems.join(" | ")}`,
  );
}

async function selectSearchable(page, label, optionName) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const list = page.locator(`ul[aria-label="${label}"]`);
  await list.waitFor({ state: "visible" });
  await list.getByRole("option", { name: optionName, exact: true }).click();
}

async function registerAndLogin(page, account, redirectTo) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page.getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" }).check();
  await page.getByLabel("Ad", { exact: true }).fill(account.firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(account.lastName);
  await page.getByLabel("E-posta").fill(account.email);
  await page.getByLabel("Telefon Numarası").fill(account.phone);
  await page.getByLabel("Şifre", { exact: true }).fill(account.password);
  await page.getByLabel("Şifre Tekrar").fill(account.password);
  await page.getByLabel("Firma Adı").fill(account.companyName);
  await page.getByLabel(account.role === "hizmet-veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi").selectOption("bireysel");
  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Dilovası");
  await page.getByLabel(/KVKK Aydınlatma Metni/).check();
  await page.getByLabel(/Kullanım Koşulları/).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Şifre", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirectTo}`, { timeout: 15000 });
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL} (PRODUCTION MODE — npm run build + npm start)`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== GUEST rotaları (PRODUCTION) ===");
    await visitAndCheck(page, "/", "Ana Sayfa");
    await visitAndCheck(page, "/hizmet-talebi-olustur", "Hizmet Talebi Oluştur (guest gate)");
    await visitAndCheck(page, "/ilanlar", "İş İlanlarını İncele (guest gate)");
    await visitAndCheck(page, "/giris-yap", "Giriş");
    await visitAndCheck(page, "/giris-yap?mode=kayit", "Kayıt");
    await visitAndCheck(page, "/ilanlar/ilan-001", "Sabit örnek ilan detayı");

    check(
      "[dev-gate] Dev seed hesapları PRODUCTION'da gösterilmiyor (isDev bloğu yok)",
      !(await page.locator("text=Geliştirme ortamı test hesapları").isVisible().catch(() => false)),
    );

    console.log("\n=== Hizmet Alan: gerçek kayıt + panel gezinme (PRODUCTION) ===");
    await registerAndLogin(page, REQUESTER, "/panel");
    for (const href of [
      "/panel/profil",
      "/panel",
      "/panel/hizmet-taleplerim",
      "/panel/gelen-teklifler",
      "/panel/hizmet-taleplerim?durum=devam-eden",
      "/panel/hizmet-taleplerim?durum=tamamlandi",
      "/panel/bildirimler",
      "/panel/hesap-ayarlari",
      "/hizmet-talebi-olustur",
    ]) {
      await visitAndCheck(page, href, "Hizmet Alan (PRODUCTION)");
    }
    await clearSession(page);

    console.log("\n=== Hizmet Veren: gerçek kayıt + panel/Aktif İlanlar gezinme (PRODUCTION) ===");
    await registerAndLogin(page, PROVIDER, "/panel");
    for (const href of [
      "/panel/profil",
      "/panel",
      "/ilanlar",
      "/panel/tekliflerim",
      "/panel/tekliflerim?durum=kabul-edildi",
      "/panel/tekliflerim?durum=devam-eden",
      "/panel/tekliflerim?durum=tamamlandi",
      "/panel/tekliflerim?durum=kapanan-teklifler",
      "/panel/bildirimler",
      "/panel/hesap-ayarlari",
    ]) {
      await visitAndCheck(page, href, "Hizmet Veren (PRODUCTION)");
    }

    // İçerik doğrulaması: '?durum=kabul-edildi' düzeltmeden sonra da hâlâ
    // güvenle "Aktif" sekmesine düşüyor mu (production build'de de).
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=kabul-edildi`);
    const activeTabText = await page.getByRole("tab", { selected: true }).innerText().catch(() => "<bulunamadı>");
    check(
      "[içerik] PRODUCTION'da '?durum=kabul-edildi' güvenle 'Aktif' sekmesine düşüyor",
      activeTabText.trim() === "Aktif",
    );

    await visitAndCheck(page, "/ilanlar", "Aktif İlanlar (PRODUCTION)");
    await page.getByLabel("İlanlarda ara").fill("");
    check("Genel: konsol hatası birikmedi (son sayfa, PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    await context.close();

    const failCount = results.filter((r) => !r.passed).length;
    console.log(`\nToplam kontrol: ${results.length}, başarısız: ${failCount}`);
    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ (PRODUCTION)." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ (PRODUCTION).");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[audit-prod] GENEL HATA:", error);
  process.exitCode = 1;
});
