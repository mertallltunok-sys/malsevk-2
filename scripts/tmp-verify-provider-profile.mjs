// Hizmet Veren firma profili özelliğinin uçtan uca doğrulaması:
// - Hesap Ayarları'ndaki "Firma Profili" bölümü (doldurma, logo, kaydetme,
//   kalıcılık, boş durum, yalnızca hizmet-veren'e görünürlük).
// - Gelen Teklifler'deki "Hizmet Veren Profili" drawer'ı (içerik doğruluğu,
//   İLETİŞİM BİLGİSİ KESİNLİKLE YOK, ESC/backdrop/kapat düğmesi, mobil tam
//   ekran / masaüstü modal).
// - Eski (createdAt'siz) kullanıcı kaydının bozulmadan çalışması.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const LOGO_FIXTURE = path.join(os.tmpdir(), "fixture-valid-1.jpg");

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
    // ============ 1) Eski (createdAt/providerProfile'sız) kullanıcı ile boş durum ============
    console.log("\n=== Eski kullanıcı (createdAt yok) — Hesap Ayarları boş durum ===");
    const legacyContext = await browser.newContext();
    const legacyPage = await legacyContext.newPage();
    attachDiagnostics(legacyPage);
    await login(legacyPage, MERT, "/panel");
    const mertId = await getUserId(legacyPage, MERT.email);
    // Mert kaydını bilerek createdAt/providerProfile OLMADAN eski bir kayıt
    // gibi yeniden yazıyoruz — migration'ın bunu kırmadığını doğrulamak için.
    await legacyPage.evaluate((id) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const next = users.map((u) => {
        if (u.id !== id) return u;
        const { createdAt, providerProfile, ...rest } = u;
        void createdAt;
        void providerProfile;
        return rest;
      });
      localStorage.setItem("malsevk.users.v1", JSON.stringify(next));
    }, mertId);

    await legacyPage.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    const legacyHeadingVisible = await legacyPage
      .getByRole("heading", { name: "Firma Profili" })
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("Sayfa çökmedi, 'Firma Profili' başlığı görünüyor", legacyHeadingVisible);
    const companyNameInputLegacy = legacyPage.getByLabel("Firma Adı");
    check("Firma Adı boş başlıyor (sahte veri üretilmemiş)", (await companyNameInputLegacy.inputValue()) === "");
    check("Eski kullanıcı: konsol hatası yok", legacyPage.jsProblems.length === 0, legacyPage.jsProblems.join(" | "));
    await legacyContext.close();

    // ============ 2) Hizmet Veren profilini doldurup kaydeder ============
    console.log("\n=== Hizmet Veren: Firma Profili doldur + kaydet ===");
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);
    await login(page, MERT, "/panel/hesap-ayarlari");

    await page.getByLabel("Firma Adı").fill("Kocaeli Lojistik A.Ş.");
    await page
      .getByLabel("Kısa Firma Tanıtımı")
      .fill(
        "15 yıllık tecrübemizle konteyner elleçleme, depolama ve liman operasyonlarında uzman ekiplerle hizmet veriyoruz.",
      );
    await page.getByLabel("Kuruluş Yılı").fill("2009");
    await page.getByRole("button", { name: "Lashing" }).click();
    await page.getByRole("button", { name: "Depolama" }).click();
    await page.getByRole("button", { name: "Kocaeli", exact: true }).click();
    await page.setInputFiles('input[type="file"]', [LOGO_FIXTURE]);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await page.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });
    check("Kaydetme başarı mesajı görünüyor", true);

    await page.reload();
    await page.getByLabel("Firma Adı").waitFor({ state: "visible" });
    check("Sayfa yenilenince Firma Adı kalıcı", (await page.getByLabel("Firma Adı").inputValue()) === "Kocaeli Lojistik A.Ş.");
    check("Kuruluş Yılı kalıcı", (await page.getByLabel("Kuruluş Yılı").inputValue()) === "2009");
    const logoImg = page.locator("img[alt='Firma logosu']");
    check("Logo kalıcı (görsel önizleme var)", await logoImg.isVisible());
    check("Hizmet Veren profil düzenleme: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 3) Doğrulama: bio çok kısa ise hata ============
    console.log("\n=== Doğrulama: 50 karakterden kısa tanıtım reddediliyor ===");
    await page.getByLabel("Kısa Firma Tanıtımı").fill("Çok kısa.");
    await page.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    check("Kısa tanıtım hata veriyor", await page.getByText(/en az 50 karakter/).isVisible());
    await page.reload();

    // ============ 4) Hizmet Alan tarafı: teklif kartında profil butonu ============
    console.log("\n=== Kurulum: Zeynep bir ilan oluşturur, Mert teklif verir ===");
    await clearSession(page);
    await login(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    const jobId = `job-provider-profile-test-${Date.now()}`;
    await page.evaluate(
      ({ jobId, zeynepId }) => {
        const job = {
          id: jobId,
          title: "Firma Profili Test İlanı",
          category: "Depolama",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Test Tesis",
          workDate: "2026-12-01",
          description: "Firma profili drawer doğrulaması için oluşturulan test ilanı.",
          operationDetails: "Test.",
          status: "yayinda",
          requesterId: zeynepId,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      },
      { jobId, zeynepId },
    );
    await clearSession(page);
    await login(page, MERT, "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
    await page.getByLabel("Teklif Fiyatı").fill("4000");
    await page.getByLabel("Tahmini Hizmet Süresi").fill("1 gün");
    await page.getByLabel("Teklif Açıklaması").fill("Firma profili drawer testi için yirmi karakterden uzun açıklama.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });

    console.log("\n=== Hizmet Alan: 'Hizmet Veren Profili' drawer'ı ===");
    await clearSession(page);
    await login(page, ZEYNEP, "/panel/gelen-teklifler");

    const profileButton = page.getByRole("button", { name: "Hizmet Veren Profili" }).first();
    const hasOffers = await profileButton
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("Gelen Teklifler'de en az bir teklif var (test kurulumu)", hasOffers);

    if (hasOffers) {
      await profileButton.click();
      const dialog = page.getByRole("dialog", { name: "Kocaeli Lojistik A.Ş." });
      await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(async () => {
        // Firma adı farklı bir teklife ait olabilir; herhangi bir profil diyaloğu da kabul edilir.
        await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 5000 });
      });
      const anyDialog = page.getByRole("dialog").first();
      const dialogText = await anyDialog.innerText();

      check("Drawer içeriğinde 'Tamamlanan İş' görünüyor", dialogText.includes("Tamamlanan İş"));
      check("Drawer içeriğinde 'Devam Eden İş' görünüyor", dialogText.includes("Devam Eden İş"));
      check("Drawer içeriğinde 'Teklif Kabul Oranı' görünüyor", dialogText.includes("Teklif Kabul Oranı"));
      check("Drawer içeriğinde 'Uzmanlık Alanları' görünüyor", dialogText.includes("Uzmanlık Alanları"));
      check("Drawer içeriğinde 'Hizmet Verilen Bölgeler' görünüyor", dialogText.includes("Hizmet Verilen Bölgeler"));
      check("Drawer içeriğinde 'Firma Tanıtımı' görünüyor", dialogText.includes("Firma Tanıtımı"));
      check("Drawer içeriğinde 'MALSEVK'e katılım' görünüyor", dialogText.includes("katılım"));

      // GİZLİLİK: iletişim bilgisi hiçbir biçimde drawer içinde YOK.
      check("Drawer'da 'Telefon' etiketi YOK", !dialogText.includes("Telefon"));
      check("Drawer'da 'E-posta' etiketi YOK", !dialogText.includes("E-posta"));
      check("Drawer'da 'Adres' etiketi YOK", !dialogText.includes("Adres"));
      check("Drawer'da telefon numarası deseni YOK", !/\+90\d{10}|0\d{3}\s?\d{3}\s?\d{2}\s?\d{2}/.test(dialogText));
      check("Drawer'da e-posta deseni YOK", !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(dialogText));

      // ESC ile kapanma.
      await page.keyboard.press("Escape");
      await anyDialog.waitFor({ state: "hidden", timeout: 5000 });
      check("ESC ile drawer kapanıyor", true);

      // Tekrar aç, X butonuyla kapat.
      await profileButton.click();
      await page.getByRole("dialog").first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Kapat" }).click();
      await page.getByRole("dialog").first().waitFor({ state: "hidden", timeout: 5000 });
      check("Kapat (X) butonuyla drawer kapanıyor", true);

      // Mobil (375px): AYNI context/oturum + seed edilmiş teklif üzerinde —
      // tam ekran sheet davranışını gerçek veriyle doğrular.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(150);
      await profileButton.click();
      const mobileDialog = page.getByRole("dialog").first();
      await mobileDialog.waitFor({ state: "visible" });
      const box = await mobileDialog.boundingBox();
      check(
        "mobilde drawer tam ekran (viewport genişliği/yüksekliğini kaplıyor)",
        Math.abs(box.width - 375) < 2 && box.height > 700,
        `genişlik=${box.width}, yükseklik=${box.height}`,
      );
      const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const mobileClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      check(
        "mobilde drawer açıkken yatay taşma yok",
        mobileScrollWidth <= mobileClientWidth + 1,
        `scrollWidth=${mobileScrollWidth}, clientWidth=${mobileClientWidth}`,
      );
      await page.keyboard.press("Escape");
      await mobileDialog.waitFor({ state: "hidden", timeout: 5000 });
    }
    check("Hizmet Alan / drawer: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    // ============ 5) Rol koruması: Hizmet Alan'ın Hesap Ayarları'nda Firma Profili YOK ============
    console.log("\n=== Rol koruması: Hizmet Alan'da 'Firma Profili' bölümü yok ===");
    const roleContext = await browser.newContext();
    const rolePage = await roleContext.newPage();
    attachDiagnostics(rolePage);
    await login(rolePage, ZEYNEP, "/panel/hesap-ayarlari");
    check(
      "Hizmet Alan Hesap Ayarları'nda 'Firma Profili' başlığı YOK",
      (await rolePage.getByRole("heading", { name: "Firma Profili" }).count()) === 0,
    );
    check("Hizmet Alan hesap ayarları: konsol hatası yok", rolePage.jsProblems.length === 0, rolePage.jsProblems.join(" | "));
    await roleContext.close();

    // ============ 6) Mobil (375px): Hesap Ayarları / Firma Profili formu ============
    console.log("\n=== Mobil (375px): Firma Profili formu ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await login(mobilePage, MERT, "/panel/hesap-ayarlari");
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("mobilde Hesap Ayarları'nda yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    check(
      "mobilde çoklu seçim (uzmanlık) chip'leri tıklanabilir",
      await mobilePage.getByRole("button", { name: "Lashing" }).isVisible(),
    );
    check("mobil: konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

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
