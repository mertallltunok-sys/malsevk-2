// PRODUCTION doğrulaması: https://malsevk-2.vercel.app üzerinde Hizmet Veren
// firma profili özelliğinin uçtan uca çalıştığını (profil düzenleme, drawer,
// gizlilik) taze kayıtlı hesaplarla doğrular.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const REQUESTER = { name: "Prod Profil Requester", email: `prod-profil-req-${STAMP}@test.com`, phone: "0532 111 22 33", password: "Requester1!", role: "hizmet-alan" };
const PROVIDER = { name: "Prod Profil Provider", email: `prod-profil-prov-${STAMP}@test.com`, phone: "0533 444 55 66", password: "Provider1!", role: "hizmet-veren" };
const LOGO_FIXTURE = path.join(os.tmpdir(), "fixture-valid-1.jpg");

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.type(text);
}

async function registerAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=${encodeURIComponent(redirect)}`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await typeInto(page, page.getByLabel("Ad Soyad"), account.name);
  await typeInto(page, page.getByLabel("E-posta"), account.email);
  await typeInto(page, page.getByLabel("Telefon Numarası"), account.phone);
  await typeInto(page, page.getByLabel("Şifre", { exact: true }), account.password);
  await typeInto(page, page.getByLabel("Şifre Tekrar"), account.password);
  await page.getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
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
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Hizmet Veren: kayıt + Firma Profili doldur (PRODUCTION) ===");
    await registerAs(page, PROVIDER, "/panel/hesap-ayarlari");
    await page.getByRole("heading", { name: "Firma Profili" }).waitFor({ state: "visible", timeout: 10000 });

    await page.getByLabel("Firma Adı").fill("Prod Test Lojistik A.Ş.");
    await page.getByLabel("Kısa Firma Tanıtımı").fill(
      "Production doğrulaması için oluşturulan test firma tanıtımı, elli karakterden uzun olacak şekilde yazılmıştır.",
    );
    await page.getByLabel("Kuruluş Yılı").fill("2015");
    await page.getByRole("button", { name: "Depolama" }).click();
    await page.getByRole("button", { name: "Kocaeli", exact: true }).click();
    await page.setInputFiles('input[type="file"]', [LOGO_FIXTURE]);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await page.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 15000 });
    check("Firma profili kaydedildi (PRODUCTION)", true);

    console.log("\n=== Kurulum: Hizmet Alan ilan oluşturur, Hizmet Veren teklif verir (PRODUCTION) ===");
    await registerAs(page, REQUESTER, "/hizmet-talebi-olustur");
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Depolama" });
    await page.getByLabel("İş Tarihi").fill("2026-09-15");
    await page.getByLabel("İlan Başlığı").fill(`Prod Profil Test İlanı ${STAMP}`);
    await page.getByLabel("İş Açıklaması").fill("Production doğrulaması için oluşturulan test ilanı, yirmi karakterden uzun.");
    await page.getByRole("button", { name: "İl", exact: true }).click();
    await page.locator('ul[aria-label="İl"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İl"]').getByRole("option", { name: "Kocaeli", exact: true }).click();
    await page.getByRole("button", { name: "İlçe", exact: true }).click();
    await page.locator('ul[aria-label="İlçe"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();
    await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
    await page.getByRole("button", { name: "Tesis", exact: true }).click();
    await page.locator('ul[aria-label="Tesis"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="Tesis"]').getByRole("option", { name: "Beldeport" }).click();
    await page.getByLabel("Operasyon Detayları").fill("Production testi için operasyon detayları.");
    await page.setInputFiles('input[type="file"]', [LOGO_FIXTURE]);
    await page.waitForFunction(() => document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === 1, { timeout: 20000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const jobUrl = page.url();

    // Hizmet Veren zaten kayıtlı (yukarıda) — doğrudan giriş yap.
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
    await page.locator('input[type="email"]').fill(PROVIDER.email);
    await page.locator('input[type="password"]').fill(PROVIDER.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 15000 });

    await page.goto(jobUrl);
    await page.getByLabel("Teklif Fiyatı").fill("5000");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Production drawer testi için yirmi karakterden uzun açıklama metni.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 });

    console.log("\n=== Hizmet Alan: 'Hizmet Veren Profili' drawer'ı (PRODUCTION) ===");
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel%2Fgelen-teklifler`);
    await page.locator('input[type="email"]').fill(REQUESTER.email);
    await page.locator('input[type="password"]').fill(REQUESTER.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel/gelen-teklifler`, { timeout: 15000 });

    const profileButton = page.getByRole("button", { name: "Hizmet Veren Profili" }).first();
    await profileButton.waitFor({ state: "visible", timeout: 10000 });
    await profileButton.click();
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    const dialogText = await dialog.innerText();

    check("Drawer'da firma adı görünüyor", dialogText.includes("Prod Test Lojistik A.Ş."));
    check("Drawer'da stat kartları görünüyor", dialogText.includes("Tamamlanan İş") && dialogText.includes("Devam Eden İş") && dialogText.includes("Teklif Kabul Oranı"));
    check("Drawer'da 'Telefon' etiketi YOK (PRODUCTION)", !dialogText.includes("Telefon"));
    check("Drawer'da 'E-posta' etiketi YOK (PRODUCTION)", !dialogText.includes("E-posta"));
    check("Drawer'da telefon/e-posta deseni YOK (PRODUCTION)", !/\+90\d{10}|0\d{3}\s?\d{3}\s?\d{2}\s?\d{2}/.test(dialogText) && !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(dialogText.replace(REQUESTER.email, "").replace(PROVIDER.email, "")));

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    check("ESC ile drawer kapanıyor (PRODUCTION)", true);

    check("Genel: konsol hatası yok (PRODUCTION)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

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
