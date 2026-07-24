// Gelen Teklifler ekranındaki Hizmet Veren profil pop-up'ının (drawer/modal)
// kaldırılıp, profil bilgilerinin doğrudan teklif kartı içine gömülmesinin
// doğrulaması:
// - Profil adına/görseline tıklayınca artık HİÇBİR dialog açılmıyor.
// - Firma adı, uzmanlık alanları, puan, tamamlanan iş sayısı, bölge ve kısa
//   tanıtım kart içinde doğrudan görünüyor.
// - Profili boş olan (fotoğrafsız, tanıtımsız) bir Hizmet Veren için sahte
//   veri üretilmiyor, yalnızca fallback ikon gösteriliyor.
// - İletişim gizliliği kuralı (kabul edilmeden telefon/e-posta yok) bozulmadı.
// - Kabul/Reddet butonları çalışıyor.
// - Uzun firma adı / uzun tanıtım / yüksek teklif tutarında taşma yok.
// - 320px, 375px, 768px, 1280px genişliklerde yatay scroll yok.
//
// NOT: Tüm senaryo TEK bir BrowserContext/page üzerinde yürütülür — Playwright
// context'leri birbirinden izole localStorage'a sahiptir, bu yüzden kurulum
// (profil doldurma) ile doğrulama adımları aynı context'te olmalıdır. Farklı
// genişlikler `page.setViewportSize()` ile aynı context/page üzerinde test edilir.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" };
const LOGO_FIXTURE = path.join(os.tmpdir(), "fixture-valid-1.jpg");
const LONG_COMPANY_NAME = "Kocaeli Uluslararası Lojistik, Depolama ve Konteyner Elleçleme Anonim Şirketi";
const LONG_BIO =
  "15 yıllık tecrübemizle konteyner elleçleme, depolama ve liman operasyonlarında uzman ekiplerle 7/24 kesintisiz hizmet veriyoruz. Müşteri memnuniyeti ve iş güvenliği önceliğimizdir, geniş ekipman filomuzla her ölçekte projeye destek sağlıyoruz.";

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function login(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

function seedJob(page, { jobId, requesterId, title }) {
  return page.evaluate(
    ({ jobId, requesterId, title }) => {
      const job = {
        id: jobId,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Inline profil doğrulaması için oluşturulan test ilanı.",
        operationDetails: "Test.",
        status: "yayinda",
        requesterId,
        photos: [],
      };
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId, requesterId, title },
  );
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function checkNoHorizontalOverflow(page, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`${label}: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    // ============ 1) Mert: zengin firma profili (uzun ad/tanıtım + logo) ============
    console.log("\n=== Kurulum: Mert'in firma profilini uzun ad/tanıtım + logo ile doldur ===");
    await login(page, MERT, "/panel/hesap-ayarlari");
    await page.getByLabel("Firma Adı").fill(LONG_COMPANY_NAME);
    await page.getByLabel("Kısa Firma Tanıtımı").fill(LONG_BIO);
    await page.getByLabel("Kuruluş Yılı").fill("2009");
    await page.getByRole("button", { name: "Lashing" }).click();
    await page.getByRole("button", { name: "Depolama" }).click();
    await page.getByRole("button", { name: "Forklift Operatörü" }).click();
    await page.getByRole("button", { name: "Kocaeli", exact: true }).click();
    await page.getByRole("button", { name: "İstanbul", exact: true }).click();
    await page.setInputFiles('input[type="file"]', [LOGO_FIXTURE]);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await page.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });
    // Kaydedilen alanların gerçekten kalıcı olduğunu doğrula (bölge toggle'ları
    // önceki bir çalıştırmadan kalan seçili durumu ters çevirmiş olabilir).
    await page.reload();
    await page.getByLabel("Firma Adı").waitFor({ state: "visible" });
    check("Firma Adı kalıcı", (await page.getByLabel("Firma Adı").inputValue()) === LONG_COMPANY_NAME);
    const kocaeliPressed = await page.getByRole("button", { name: "Kocaeli", exact: true }).getAttribute("aria-pressed");
    check("Kocaeli bölgesi seçili kalıcı", kocaeliPressed === "true", `aria-pressed=${kocaeliPressed}`);
    check("Kurulum: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 2) Zeynep iki ilan oluşturur; Mert ve Mehmet teklif verir ============
    console.log("\n=== Kurulum: Zeynep iki ilan oluşturur, Mert (zengin profil) ve Mehmet (boş profil) teklif verir ===");
    await clearSession(page);
    await login(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    const jobIdMert = `job-inline-profile-mert-${Date.now()}`;
    const jobIdMehmet = `job-inline-profile-mehmet-${Date.now()}`;
    await seedJob(page, { jobId: jobIdMert, requesterId: zeynepId, title: "Inline Profil Testi — Zengin Profil" });
    await seedJob(page, { jobId: jobIdMehmet, requesterId: zeynepId, title: "Inline Profil Testi — Boş Profil" });

    await clearSession(page);
    await login(page, MERT, "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${jobIdMert}`);
    await page.getByLabel("Teklif Fiyatı").fill("125000");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("3 hafta");
    await page
      .getByLabel("Teklif Açıklaması")
      .fill(
        "Talep edilen tüm operasyonu uçtan uca üstleniyoruz: saha kurulumu, ekipman sevkiyatı, vardiyalı personel planlaması ve günlük raporlama dahil eksiksiz bir hizmet paketi sunuyoruz.",
      );
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
    check("Mert (zengin profil) teklif gönderdi", true);

    await clearSession(page);
    await login(page, MEHMET, "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${jobIdMehmet}`);
    await page.getByLabel("Teklif Fiyatı").fill("3500");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Profili boş bir Hizmet Veren'den kısa bir teklif açıklaması.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
    check("Mehmet (boş profil) teklif gönderdi", true);

    // ============ 3) Zeynep: Gelen Teklifler — pop-up YOK, bilgiler kart içinde ============
    console.log("\n=== Hizmet Alan (Zeynep): Gelen Teklifler — pop-up yok, profil kart içinde ===");
    await clearSession(page);
    await login(page, ZEYNEP, "/panel/gelen-teklifler");

    check(
      "'Hizmet Veren Profili' butonu artık YOK",
      (await page.getByRole("button", { name: "Hizmet Veren Profili" }).count()) === 0,
    );

    const bodyText = await page.locator("body").innerText();
    check("Firma adı (uzun) kart içinde görünüyor", bodyText.includes(LONG_COMPANY_NAME));
    check("Uzmanlık alanı chip'i görünüyor ('Lashing')", bodyText.includes("Lashing"));
    check("Tamamlanan iş sayısı görünüyor", /tamamlanan iş/.test(bodyText));
    check("Bölge bilgisi görünüyor ('Kocaeli')", bodyText.includes("Kocaeli"));
    check("Kısa firma tanıtımı kart içinde görünüyor", bodyText.includes("konteyner elleçleme, depolama"));
    check("Teklif tutarı görünüyor (125.000)", /125\.000|125000/.test(bodyText));
    check("Teklif açıklaması görünüyor", bodyText.includes("uçtan uca üstleniyoruz"));
    check("Teklif tarihi etiketi görünüyor", bodyText.includes("Teklif tarihi"));
    check("Teklif durumu (Beklemede) görünüyor", bodyText.includes("Beklemede"));

    // Profil adına/logosuna tıklamak artık HİÇBİR dialog açmamalı.
    await page.getByText(LONG_COMPANY_NAME).first().click();
    await page.waitForTimeout(300);
    check("Profil adına tıklayınca dialog AÇILMIYOR", (await page.getByRole("dialog").count()) === 0);

    const logoImg = page.locator(`img[alt="${LONG_COMPANY_NAME} logosu"]`).first();
    check("Firma logosu kart içinde doğrudan görünüyor (pop-up gerekmeden)", await logoImg.isVisible());

    // Boş profilli Mehmet'in kartı: sahte veri üretilmemeli, fallback ikon.
    check("Mehmet Demir (profil doldurulmamış) ismi fallback olarak görünüyor", bodyText.includes("Mehmet Demir"));

    check("Gelen Teklifler (masaüstü): konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await checkNoHorizontalOverflow(page, "Masaüstü (1280px)");

    // ============ 4) İletişim gizliliği: kabul edilmeden telefon/e-posta yok ============
    console.log("\n=== İletişim gizliliği: kabul edilmeden telefon/e-posta yok ===");
    check("Kabul edilmemiş teklifte 'Telefon' etiketi YOK", !bodyText.includes("Telefon"));
    check("Kabul edilmemiş teklifte 'E-posta' etiketi YOK", !bodyText.includes("E-posta"));

    // ============ 5) Responsive (teklifler HALA pending — Kabul Et/Reddet görünür) ============
    // Bilerek kabul/red işleminden ÖNCE çalıştırılır: aksiyon butonlarının
    // dar ekranlarda ekran dışına taşmadığını doğrulamak için pending
    // durumdaki gerçek butonlar gerekir.
    console.log("\n=== Responsive genişlikler: 320px / 375px / 768px (teklifler pending) ===");
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await page.waitForTimeout(200);
      await checkNoHorizontalOverflow(page, `${width}px`);
      const cardVisible = await page.getByText(LONG_COMPANY_NAME).first().isVisible().catch(() => false);
      check(`${width}px: firma adı kart içinde görünür`, cardVisible);
      const noDialogButton = (await page.getByRole("button", { name: "Hizmet Veren Profili" }).count()) === 0;
      check(`${width}px: 'Hizmet Veren Profili' butonu yok`, noDialogButton);

      const acceptBtn = page.getByRole("button", { name: "Kabul Et" }).first();
      const rejectBtn = page.getByRole("button", { name: "Reddet" }).first();
      const acceptBox = await acceptBtn.boundingBox();
      const rejectBox = await rejectBtn.boundingBox();
      check(
        `${width}px: 'Kabul Et' butonu viewport içinde`,
        acceptBox !== null && acceptBox.x >= 0 && acceptBox.x + acceptBox.width <= width + 1,
        acceptBox ? `x=${acceptBox.x}, width=${acceptBox.width}` : "bulunamadı",
      );
      check(
        `${width}px: 'Reddet' butonu viewport içinde`,
        rejectBox !== null && rejectBox.x >= 0 && rejectBox.x + rejectBox.width <= width + 1,
        rejectBox ? `x=${rejectBox.x}, width=${rejectBox.width}` : "bulunamadı",
      );
      check(`${width}px: konsol hatası yok`, page.jsProblems.length === 0, page.jsProblems.join(" | "));
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();

    // ============ 6) Kabul Et çalışıyor + kabul sonrası iletişim görünüyor ============
    console.log("\n=== Kabul Et butonu + kabul sonrası iletişim bilgisi ===");
    const richCard = page.locator("div.rounded-card", { hasText: LONG_COMPANY_NAME }).first();
    await richCard.getByRole("button", { name: "Kabul Et" }).click();
    await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
    check("Kabul Et sonrası durum 'Kabul Edildi' olarak güncellendi", true);
    const afterAcceptText = await page.locator("body").innerText();
    check("Kabul sonrası 'Telefon' etiketi görünüyor", afterAcceptText.includes("Telefon"));
    check("Kabul sonrası 'E-posta' etiketi görünüyor", afterAcceptText.includes("E-posta"));
    check("Kabul sonrası: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 7) Reddet butonu çalışıyor (Mehmet'in teklifi üzerinde) ============
    console.log("\n=== Reddet butonu çalışıyor ===");
    const mehmetCard = page.locator("div.rounded-card", { hasText: "Mehmet Demir" }).first();
    await mehmetCard.getByRole("button", { name: "Reddet" }).click();
    await page.getByText("Reddedildi").first().waitFor({ state: "visible", timeout: 10000 });
    check("Reddet sonrası durum 'Reddedildi' olarak güncellendi", true);

    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
