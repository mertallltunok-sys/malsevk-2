// PRODUCTION doğrulaması (https://malsevk-2.vercel.app): bir ilana teklif
// kabul edildiğinde ilanın "Teklife Açık" kalmaya devam ettiğini, diğer
// Hizmet Verenlerin yeni teklif verebildiğini, ama Hizmet Alan'ın bu yeni
// tekliflerde Kabul Et/Reddet göremediğini (yerine engelleme mesajı) ve
// anlaşma sağlanamadığında bunun normale döndüğünü taze kayıtlı gerçek
// hesaplarla doğrular. Dev seed hesapları production'da mevcut olmadığı
// için (NODE_ENV gate'i, bkz. CLAUDE.md) üç hesap da gerçek Kayıt Ol
// akışıyla oluşturulur.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "https://malsevk-2.vercel.app";
const STAMP = Date.now();
const FIXTURE = path.join(os.tmpdir(), "fixture-valid-1.jpg");

const REQUESTER = {
  firstName: "Prod", lastName: `Requester${STAMP}`,
  email: `prod-acik-req-${STAMP}@test.com`, phone: "0532 111 22 33",
  password: "Test1234!", role: "hizmet-alan", companyName: "Prod Requester Ltd.",
};
const PROVIDER_A = {
  firstName: "Prod", lastName: `ProviderA${STAMP}`,
  email: `prod-acik-provA-${STAMP}@test.com`, phone: "0533 222 33 44",
  password: "Test1234!", role: "hizmet-veren", companyName: "Prod Provider A Ltd.",
};
const PROVIDER_C = {
  firstName: "Prod", lastName: `ProviderC${STAMP}`,
  email: `prod-acik-provC-${STAMP}@test.com`, phone: "0534 333 44 55",
  password: "Test1234!", role: "hizmet-veren", companyName: "Prod Provider C Ltd.",
};
const JOB_TITLE = `PROD-ACIK-KALAN-ILAN-${STAMP}`;

// Kartlarda gösterilen isim: providerProfile.companyName set edilmediği için
// (kayıt formundaki "Firma Adı" StoredUser.companyName'e gider, AYRI ve
// opsiyonel olan providerProfile.companyName'e değil — bkz. CLAUDE.md
// "Provider profiles") incoming-offer-card.tsx bu durumda provider.name'e
// düşer: `${firstName} ${lastName}`.
function displayName(account) {
  return `${account.firstName} ${account.lastName}`.trim();
}

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function selectSearchable(page, label, optionName) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const list = page.locator(`ul[aria-label="${label}"]`);
  await list.waitFor({ state: "visible" });
  await list.getByRole("option", { name: optionName, exact: true }).click();
}

/** Kayıt formunun mevcut hâli (Ad/Soyad/Firma/İl-İlçe/KVKK/Şartlar) ile gerçek bir hesap oluşturur, ardından giriş yapar. */
async function registerAndLogin(page, account, redirectTo) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page
    .getByRole("radio", { name: account.role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren" })
    .check();
  await page.getByLabel("Ad", { exact: true }).fill(account.firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(account.lastName);
  await page.getByLabel("E-posta").fill(account.email);
  await page.getByLabel("Telefon Numarası").fill(account.phone);
  await page.getByLabel("Şifre", { exact: true }).fill(account.password);
  await page.getByLabel("Şifre Tekrar").fill(account.password);
  await page.getByLabel("Firma Adı").fill(account.companyName);
  await page
    .getByLabel(account.role === "hizmet-veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi")
    .selectOption("bireysel");
  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Dilovası");
  await page.getByLabel(/KVKK Aydınlatma Metni/).check();
  await page.getByLabel(/Kullanım Koşulları/).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu").waitFor({ state: "visible", timeout: 15000 });

  // Kayıt sonrası otomatik oturum açılmıyor — e-posta formda kalır, şifre
  // temizlenir; giriş sekmesinden manuel giriş yapılır.
  await page.getByLabel("Şifre", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirectTo}`, { timeout: 15000 });
}

async function loginAs(page, account, redirectTo) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirectTo)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirectTo}`, { timeout: 15000 });
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

async function main() {
  const browser = await chromium.launch();
  try {
    console.log(`Hedef: ${BASE_URL}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: Requester kaydı + ilan oluşturma (PRODUCTION) ===");
    await registerAndLogin(page, REQUESTER, "/hizmet-talebi-olustur");
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Depo Personeli" });
    await page.getByLabel("İş Tarihi").fill("2026-12-01");
    await page.getByLabel("İlan Başlığı").fill(JOB_TITLE);
    await page.getByLabel("İş Açıklaması").fill("Production açık-kalan-ilan doğrulaması için oluşturulan test ilanı.");
    await selectSearchable(page, "İl", "Kocaeli");
    await selectSearchable(page, "İlçe", "Dilovası");
    await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
    await selectSearchable(page, "Tesis", "Beldeport");
    await page.getByLabel("Operasyon Detayları").fill("Production testi için operasyon detayları.");
    await page.setInputFiles('input[type="file"]', [FIXTURE]);
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === 1,
      { timeout: 20000 },
    );
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const jobUrl = page.url();
    check("[kurulum] ilan oluşturuldu (PRODUCTION)", true, jobUrl);
    await clearSession(page);

    console.log("\n=== Kurulum: Provider A kaydı + teklif verme (PRODUCTION) ===");
    await registerAndLogin(page, PROVIDER_A, "/panel");
    await page.goto(jobUrl);
    await page.getByLabel("Teklif Fiyatı").fill("6000");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("3 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Provider A'nın teklifi, production doğrulaması için yirmi karakterden uzun.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 });
    check("[kurulum] Provider A teklif verdi (PRODUCTION)", true);
    await clearSession(page);

    console.log("\n=== Requester: Provider A'nın teklifini kabul ediyor (PRODUCTION) ===");
    await loginAs(page, REQUESTER, "/panel/gelen-teklifler");
    const providerACard = page.locator(".rounded-card", { hasText: JOB_TITLE });
    await providerACard.waitFor({ state: "visible", timeout: 10000 });
    await providerACard.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(500);
    check("[kurulum] Provider A'nın teklifi kabul edildi (PRODUCTION)", true);
    await clearSession(page);

    console.log('\n=== Senaryo 1: Provider C ilan detayında "Teklife Açık" görüyor (PRODUCTION) ===');
    await page.goto(jobUrl);
    let bodyText = await page.locator("main").innerText();
    check("[detay] Rozet 'Teklife Açık' gösteriyor (PRODUCTION)", bodyText.includes("Teklife Açık"));
    check("[detay] Rozet 'Teklife Kapalı' GÖSTERMİYOR (PRODUCTION)", !bodyText.includes("Teklife Kapalı"));

    console.log("\n=== Senaryo 2: Provider C kaydı + yeni teklif verme (PRODUCTION) ===");
    const jobPath = new URL(jobUrl).pathname;
    await registerAndLogin(page, PROVIDER_C, jobPath);
    bodyText = await page.locator("main").innerText();
    check(
      "[detay] Provider C için eski engelleme mesajı YOK (PRODUCTION)",
      !bodyText.includes("Artık yeni teklif kabul edilmemektedir"),
    );
    await page.getByLabel("Teklif Fiyatı").fill("4500");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Provider C'nin yeni teklifi, production doğrulaması için yirmi karakterden uzun.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 15000 });
    check("[teklif] Provider C teklifi başarıyla gönderdi (PRODUCTION)", true);
    await clearSession(page);

    console.log("\n=== Senaryo 3: Requester, Provider C'nin teklifinde Kabul/Reddet GÖRMÜYOR (PRODUCTION) ===");
    await loginAs(page, REQUESTER, "/panel/gelen-teklifler");
    const providerCCard = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: displayName(PROVIDER_C) });
    await providerCCard.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[gelen-teklifler] Provider C engelleme mesajı görünüyor (PRODUCTION)",
      await providerCCard.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.").isVisible().catch(() => false),
    );
    check(
      "[gelen-teklifler] Provider C için Kabul Et YOK (PRODUCTION)",
      (await providerCCard.getByRole("button", { name: "Kabul Et" }).count()) === 0,
    );

    console.log('\n=== Senaryo 4: Requester, Provider A ile "Anlaşma Sağlanamadı" diyor (PRODUCTION) ===');
    const providerACardAgain = page
      .locator(".rounded-card", { hasText: JOB_TITLE })
      .filter({ hasText: displayName(PROVIDER_A) });
    await providerACardAgain.getByRole("button", { name: "Anlaşma Sağlanamadı" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle" }).click();
    await page.waitForTimeout(600);
    check("[kurulum] Provider A agreement_failed oldu (PRODUCTION)", true);

    console.log("\n=== Senaryo 5: Provider C'nin teklifi artık normal (Kabul Et/Reddet aktif) (PRODUCTION) ===");
    const providerCCardAfter = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: displayName(PROVIDER_C) });
    await providerCCardAfter.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[gelen-teklifler] Provider C için Kabul Et ARTIK VAR (PRODUCTION)",
      await providerCCardAfter.getByRole("button", { name: "Kabul Et" }).isVisible().catch(() => false),
    );
    check(
      "[gelen-teklifler] engelleme mesajı ARTIK YOK (PRODUCTION)",
      !(await providerCCardAfter.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.").isVisible().catch(() => false)),
    );

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
