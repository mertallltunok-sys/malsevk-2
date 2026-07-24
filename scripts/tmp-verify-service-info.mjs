// "Hizmet Bilgilerim" (Panel > Profilim) özelliğinin uçtan uca doğrulaması:
// - Yalnızca Hizmet Veren'de görünüyor.
// - Çoklu hizmet seçimi (farklı gruplardan), hizmet özellikleri, deneyim,
//   çalışma bölgeleri kaydediliyor ve sayfa yenilenince korunuyor.
// - Profil tamamlanma yüzdesi canlı ve doğru hesaplanıyor.
// - Hesap Ayarları > Firma Profili kaydı, Hizmet Bilgilerim alanlarını
//   SİLMİYOR (users.ts#updateProviderProfile'daki geçiş düzeltmesi).
// - Demo hesaplar (Zeynep/Mert) bozulmadı.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };

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

async function login(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

async function checkNoHorizontalOverflow(page, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`${label}: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
}

async function readProviderProfile(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.providerProfile ?? null;
  }, email);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    // ============ 1) Hizmet Alan'da (Zeynep) bölüm YOK ============
    console.log("\n=== Hizmet Alan (Zeynep): 'Hizmet Bilgilerim' bölümü yok ===");
    await login(page, ZEYNEP, "/panel/profil");
    check(
      "Zeynep'in profilinde 'Hizmet Bilgilerim' başlığı YOK",
      (await page.getByRole("heading", { name: "Hizmet Bilgilerim" }).count()) === 0,
    );
    check("Zeynep profil sayfası: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 2) Hizmet Veren (Mert): bölüm var, başlangıç tamamlanma %33 ============
    console.log("\n=== Hizmet Veren (Mert): 'Hizmet Bilgilerim' bölümü ve başlangıç tamamlanma ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await login(page, MERT, "/panel/profil");
    check(
      "Mert'in profilinde 'Hizmet Bilgilerim' başlığı görünüyor",
      await page.getByRole("heading", { name: "Hizmet Bilgilerim" }).isVisible(),
    );
    const initialPercentText = await page.getByText(/^%\d+$/).first().innerText();
    check(
      "Başlangıç tamamlanma %33 (yalnızca telefon+e-posta dolu; demo hesapta companyName yok)",
      initialPercentText === "%33",
      `görünen: ${initialPercentText}`,
    );
    check(
      "'Firma adınızı Hesap Ayarları sayfasından ekleyebilirsiniz' ipucu görünüyor",
      await page.getByText("sayfasından ekleyebilirsiniz.").isVisible(),
    );

    // ============ 3) Çoklu hizmet seçimi (farklı gruplardan) ============
    console.log("\n=== Çoklu hizmet seçimi, özellikler, deneyim, bölge ===");
    await page.getByRole("button", { name: "Lashing", exact: true }).click();
    await page.getByRole("button", { name: "Forklift Operatörü", exact: true }).click();
    await page.getByRole("button", { name: "Personel Temini", exact: true }).click();
    check(
      "Üç farklı gruptan hizmet seçildi (Lashing, Forklift Operatörü, Personel Temini basılı)",
      (await page.getByRole("button", { name: "Lashing", exact: true }).getAttribute("aria-pressed")) === "true" &&
        (await page.getByRole("button", { name: "Forklift Operatörü", exact: true }).getAttribute("aria-pressed")) === "true" &&
        (await page.getByRole("button", { name: "Personel Temini", exact: true }).getAttribute("aria-pressed")) === "true",
    );

    await page.getByRole("button", { name: "7/24 Hizmet" }).click();
    await page.getByRole("button", { name: "Acil Hizmet Verebilir" }).click();

    await page.getByLabel("Deneyim").selectOption({ label: "3-5 Yıl" });

    const regionsGroup = page.getByRole("group", { name: "Çalışma Bölgeleri" });
    await regionsGroup.getByRole("button", { name: "Kocaeli", exact: true }).click();
    await regionsGroup.getByRole("button", { name: "İstanbul", exact: true }).click();
    check(
      "Çalışma Bölgeleri: 2 seçildi",
      (await page.getByText("2 seçildi").count()) > 0,
    );

    // Kaydetmeden ÖNCE, canlı tamamlanma yüzdesi güncellenmiş olmalı:
    // Telefon + E-posta + Hizmet Seçimi + Çalışma Bölgeleri + Deneyim = 5/6 -> %83
    const livePercentText = await page.getByText(/^%\d+$/).first().innerText();
    check(
      "Kaydetmeden önce CANLI tamamlanma %83'e güncellendi (5/6 — Firma Adı hariç)",
      livePercentText === "%83",
      `görünen: ${livePercentText}`,
    );

    check("Form doldurma adımı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 4) Kaydet + localStorage doğrulaması ============
    console.log("\n=== Kaydet ve localStorage doğrulaması ===");
    await page.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    await page.getByText("Hizmet bilgileriniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });
    check("Kayıt başarı mesajı görünüyor", true);

    const profileAfterSave = await readProviderProfile(page, MERT.email);
    check("serviceCategories doğru kaydedilmiş (3 öğe)", profileAfterSave?.serviceCategories?.length === 3);
    check(
      "serviceCategories doğru id'leri içeriyor",
      ["lashing", "forklift-operatoru", "personel-temini"].every((id) =>
        profileAfterSave?.serviceCategories?.includes(id),
      ),
    );
    check(
      "serviceFeatures doğru kaydedilmiş (7-24, acil-hizmet)",
      profileAfterSave?.serviceFeatures?.includes("7-24") && profileAfterSave?.serviceFeatures?.includes("acil-hizmet"),
    );
    check("experienceRange doğru kaydedilmiş (3-5)", profileAfterSave?.experienceRange === "3-5");
    check(
      "regions doğru kaydedilmiş (Kocaeli, İstanbul)",
      profileAfterSave?.regions?.includes("Kocaeli") && profileAfterSave?.regions?.includes("İstanbul"),
    );

    // ============ 5) Sayfa yenilenince kaybolmuyor ============
    console.log("\n=== Sayfa yenileme sonrası kalıcılık ===");
    await page.reload();
    await page.waitForTimeout(300);
    check(
      "Yenileme sonrası 'Lashing' hâlâ seçili görünüyor",
      (await page.getByRole("button", { name: "Lashing", exact: true }).getAttribute("aria-pressed")) === "true",
    );
    check(
      "Yenileme sonrası Deneyim hâlâ '3-5 Yıl'",
      (await page.getByLabel("Deneyim").inputValue()) === "3-5",
    );
    const percentAfterReload = await page.getByText(/^%\d+$/).first().innerText();
    check("Yenileme sonrası tamamlanma hâlâ %83", percentAfterReload === "%83", `görünen: ${percentAfterReload}`);
    check("Yenileme sonrası: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 6) Hesap Ayarları > Firma Profili kaydı, Hizmet Bilgilerim'i SİLMİYOR ============
    console.log("\n=== Firma Profili kaydı, Hizmet Bilgilerim alanlarını silmiyor ===");
    await page.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    await page.getByLabel("Firma Adı").fill("Mert Lojistik");
    await page.getByLabel("Kısa Firma Tanıtımı").fill(
      "Kocaeli bölgesinde konteyner elleçleme ve depolama hizmetleri sunan deneyimli bir ekibiz.",
    );
    await page.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await page.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });

    const profileAfterCompanySave = await readProviderProfile(page, MERT.email);
    check("Firma Profili kaydı sonrası companyName güncellendi", profileAfterCompanySave?.companyName === "Mert Lojistik");
    check(
      "Firma Profili kaydı sonrası serviceCategories KORUNDU (silinmedi)",
      profileAfterCompanySave?.serviceCategories?.length === 3,
    );
    check(
      "Firma Profili kaydı sonrası experienceRange KORUNDU",
      profileAfterCompanySave?.experienceRange === "3-5",
    );
    check(
      "Firma Profili kaydı sonrası regions KORUNDU",
      profileAfterCompanySave?.regions?.includes("Kocaeli") && profileAfterCompanySave?.regions?.includes("İstanbul"),
    );

    // Şimdi Hizmet Bilgilerim'de tamamlanma Firma Adı da dolduğu için %100 olmalı.
    await page.goto(`${BASE_URL}/panel/profil`);
    const percentAfterCompanyName = await page.getByText(/^%\d+$/).first().innerText();
    check(
      "Firma Adı dolunca Hizmet Bilgilerim tamamlanma %100 oldu",
      percentAfterCompanyName === "%100",
      `görünen: ${percentAfterCompanyName}`,
    );
    check(
      "Firma Adı ipucu artık görünmüyor",
      (await page.getByText("sayfasından ekleyebilirsiniz.").count()) === 0,
    );
    check("Firma Profili/Hizmet Bilgilerim etkileşimi: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    await context.close();

    // ============ 7) Mobil (375px) ============
    console.log("\n=== Mobil (375px): Hizmet Bilgilerim ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await login(mobilePage, MERT, "/panel/profil");
    await checkNoHorizontalOverflow(mobilePage, "375px");
    check(
      "Mobilde 'Hizmet Bilgilerim' başlığı görünüyor",
      await mobilePage.getByRole("heading", { name: "Hizmet Bilgilerim" }).isVisible(),
    );
    await mobilePage.getByRole("button", { name: "Unlashing", exact: true }).click();
    await checkNoHorizontalOverflow(mobilePage, "375px (seçim sonrası)");
    check("Mobil: konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

    // ============ 8) Demo hesaplar bozulmadı ============
    console.log("\n=== Demo hesaplar (Zeynep, Mert) hâlâ giriş yapabiliyor ===");
    const finalContext = await browser.newContext();
    const finalPage = await finalContext.newPage();
    attachDiagnostics(finalPage);
    await login(finalPage, ZEYNEP, "/panel");
    check("Zeynep hâlâ giriş yapabiliyor", finalPage.url() === `${BASE_URL}/panel`);
    await finalPage.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await login(finalPage, MERT, "/panel");
    check("Mert hâlâ giriş yapabiliyor", finalPage.url() === `${BASE_URL}/panel`);
    check("Demo hesap girişleri: konsol hatası yok", finalPage.jsProblems.length === 0, finalPage.jsProblems.join(" | "));
    await finalContext.close();

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
