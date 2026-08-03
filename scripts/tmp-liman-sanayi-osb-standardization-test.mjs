// node scripts/tmp-liman-sanayi-osb-standardization-test.mjs
//
// "Liman / Sanayi / OSB" konum alanının standardizasyonunun (2026-08-01)
// uçtan uca doğrulaması: Gümrük Müşavirliği HARİÇ tüm kategorilerde eski
// "Tesis / İşletme Adı" + Bölge/Mahalle/Konum Bağlantısı/Adres Tarifi
// yapısının kaldırıldığını, yeni sade "Liman / Sanayi / OSB" + manuel ad +
// her zaman görünür Açık Adres yapısının çalıştığını, manuel moda geçişte
// otomatik odağı, ve Gümrük Müşavirliği'nin eski yapısını AYNEN koruduğunu
// doğrular.
// Ön koşul: `npm run dev` çalışıyor olmalı (BASE_URL ile port verilebilir).
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

async function fillBaseJobFields(page, { title, category }) {
  await page.locator("select").first().selectOption(category);
  await page.getByLabel("İlan Başlığı").fill(title);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .fill("Bu test için oluşturulmuş, en az yirmi karakter içeren bir iş açıklamasıdır.");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-20");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-21");
  await page.getByLabel("Operasyon Detayları").fill("Test operasyon detayı, en az on karakter içerir.");
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsProblems = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsProblems.push(`[console:error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => jsProblems.push(`[pageerror] ${String(err)}`));

    await loginAs(page, ZEYNEP, "/hizmet-talebi-olustur");

    // =========================================================
    console.log("\n=== Senaryo 1: Forklift (Nakliye/Gümrük dışı) - eski yapı tamamen kalkmış ===");
    await fillBaseJobFields(page, { title: `LSOSB-TEST-FORKLIFT-${STAMP}`, category: "forklift" });
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Dilovası");

    check(
      "[S1] 'Liman / Sanayi / OSB' seçici görünüyor",
      (await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).count()) > 0,
    );
    check(
      "[S1] Eski 'Tesis / İşletme Adı' alanı YOK",
      (await page.getByLabel("Tesis / İşletme Adı").count()) === 0,
    );
    check(
      "[S1] Eski 'Hazır listeden seçmek için tıklayın' linki YOK",
      (await page.getByText("Hazır listeden seçmek için tıklayın").count()) === 0,
    );
    check("[S1] 'Açık Adres' HER ZAMAN görünüyor (katalog modunda)", (await page.getByLabel("Açık Adres").count()) > 0);
    check(
      "[S1] Eski 'Bölge / Mahalle' alanı YOK",
      (await page.getByLabel(/Bölge \/ Mahalle/).count()) === 0,
    );
    check(
      "[S1] Eski 'Konum Bağlantısı' alanı YOK",
      (await page.getByLabel(/Konum Bağlantısı/).count()) === 0,
    );
    check("[S1] Eski 'Adres Tarifi' alanı YOK", (await page.getByLabel(/Adres Tarifi/).count()) === 0);

    // =========================================================
    console.log('\n=== Senaryo 2: "Listede yok, kendim gireceğim" seçilince manuel ad anında açılıyor + odak alıyor ===');
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
    const dropdown = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
    await dropdown.waitFor({ state: "visible" });
    check(
      "[S2] Açılır listede tam olarak 'Listede yok, kendim gireceğim' seçeneği var",
      (await dropdown.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).count()) === 1,
    );
    await dropdown.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).click();

    const manualInput = page.getByLabel("Liman / Sanayi / OSB Adı");
    await manualInput.waitFor({ state: "visible", timeout: 5000 });
    check("[S2] 'Liman / Sanayi / OSB Adı' input'u anında görünür oldu", true);
    const isFocused = await manualInput.evaluate((el) => el === document.activeElement);
    check("[S2] Manuel ad input'u otomatik focus aldı", isFocused);
    check("[S2] Açık Adres manuel modda da görünmeye devam ediyor", (await page.getByLabel("Açık Adres").count()) > 0);

    await manualInput.fill("İzmir Aliağa Limanı");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:5, Dilovası/Kocaeli");
    await uploadOnePhoto(page);
    // İlk tık: forma doğrulama uygulayıp "Operasyon Önizleme"ye geçer.
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    const previewText = await page.locator("main").innerText();
    check("[S2] Önizlemede 'Tesis / Lokasyon: İzmir Aliağa Limanı' doğru gösteriliyor", previewText.includes("İzmir Aliağa Limanı"));
    // İkinci tık: önizlemenin kendi Yayınla butonu — createJob burada çağrılır.
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    let bodyText = await page.locator("main").innerText();
    check("[S2] İlan başarıyla oluşturuldu ve manuel ad görünüyor", bodyText.includes("İzmir Aliağa Limanı"));
    const forkliftJobUrl = page.url();

    // =========================================================
    console.log("\n=== Senaryo 3: İlan düzenlemede manuel kayıt doğru geri yükleniyor ===");
    const forkliftJobId = forkliftJobUrl.split("/ilanlar/")[1];
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${forkliftJobId}/duzenle`);
    const editManualInput = page.getByLabel("Liman / Sanayi / OSB Adı");
    await editManualInput.waitFor({ state: "visible", timeout: 10000 });
    check("[S3] Düzenlemede combobox 'Listede yok, kendim gireceğim' gösteriyor + manuel ad input açık", true);
    check("[S3] Manuel ad doğru yüklendi", (await editManualInput.inputValue()) === "İzmir Aliağa Limanı");
    check(
      "[S3] Açık adres doğru yüklendi",
      (await page.getByLabel("Açık Adres").inputValue()).includes("Test Mahallesi"),
    );

    // Switch back to catalog: manual input should disappear.
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
    const editDropdown = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
    await editDropdown.waitFor({ state: "visible" });
    const firstRealOption = editDropdown.getByRole("option").filter({ hasNotText: "Listede yok" }).first();
    const hasCatalogOption = (await firstRealOption.count()) > 0;
    if (hasCatalogOption) {
      const beforeAddress = await page.getByLabel("Açık Adres").inputValue();
      await firstRealOption.click();
      check("[S3] Katalog seçilince manuel ad input'u kayboldu", (await page.getByLabel("Liman / Sanayi / OSB Adı").count()) === 0);
      check(
        "[S3] Katalog seçilince Açık Adres İÇERİĞİ korunuyor (temizlenmiyor)",
        (await page.getByLabel("Açık Adres").inputValue()) === beforeAddress,
      );
    } else {
      console.log("    (Dilovası'nda katalog tesisi yok, geçiş testi atlandı)");
    }

    // =========================================================
    console.log("\n=== Senaryo 4: Gümrük Müşavirliği - eski yapı AYNEN korunuyor ===");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await fillBaseJobFields(page, { title: `LSOSB-TEST-GUMRUK-${STAMP}`, category: "gumruk-musavirligi" });
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Dilovası");
    await selectFromSearchable(page, "Liman / Sanayi / OSB", "Listede yok — tesis bilgilerini kendim gireceğim", {
      exact: false,
    });
    check(
      "[S4] Gümrük Müşavirliği: eski 'Tesis / İşletme Adı' alanı VAR (dokunulmadı)",
      (await page.getByLabel("Tesis / İşletme Adı").count()) > 0,
    );
    check(
      "[S4] Gümrük Müşavirliği: eski 'Hazır listeden seçmek için tıklayın' linki VAR",
      (await page.getByText("Hazır listeden seçmek için tıklayın").count()) > 0,
    );
    check(
      "[S4] Gümrük Müşavirliği: eski 'Bölge / Mahalle' alanı VAR",
      (await page.getByLabel(/Bölge \/ Mahalle/).count()) > 0,
    );
    check(
      "[S4] Gümrük Müşavirliği: eski 'Konum Bağlantısı' alanı VAR",
      (await page.getByLabel(/Konum Bağlantısı/).count()) > 0,
    );
    check(
      "[S4] Gümrük Müşavirliği: eski 'Adres Tarifi' alanı VAR",
      (await page.getByLabel(/Adres Tarifi/).count()) > 0,
    );
    check(
      "[S4] Gümrük Müşavirliği: yeni 'Liman / Sanayi / OSB Adı' etiketi YOK (eski etiket kullanılıyor)",
      (await page.getByLabel("Liman / Sanayi / OSB Adı").count()) === 0,
    );

    // =========================================================
    console.log("\n=== Senaryo 5: Nakliye - NakliyeLocationFields hâlâ doğru çalışıyor (refactor edildi) ===");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await fillBaseJobFields(page, { title: `LSOSB-TEST-NAKLIYE-${STAMP}`, category: "nakliye" });
    check(
      "[S5] Nakliye seçilince 'Yük Alınacak Yer' bölümü görünüyor",
      (await page.getByText("Yük Alınacak Yer").count()) > 0,
    );
    check(
      "[S5] Nakliye seçilince 'Teslim Edilecek Yer' bölümü görünüyor",
      (await page.getByText("Teslim Edilecek Yer").count()) > 0,
    );
    await page.locator('button[id$="-pickup-province"], button[id*="service-pickup-"][id$="-province"]').click();
    await page.locator('ul[aria-label="İl"]').first().getByRole("option", { name: "Kocaeli", exact: true }).click();
    await page.locator('button[id*="service-pickup-"][id$="-district"]').click();
    await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
    const pickupFacilityTrigger = page.locator('button[id*="service-pickup-"][id$="-locationType"]');
    await pickupFacilityTrigger.click();
    const pickupDropdown = page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first();
    await pickupDropdown.waitFor({ state: "visible" });
    await pickupDropdown.getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).click();
    const pickupManualInput = page.getByLabel("Liman / Sanayi / OSB Adı").first();
    await pickupManualInput.waitFor({ state: "visible", timeout: 5000 });
    const pickupFocused = await pickupManualInput.evaluate((el) => el === document.activeElement);
    check("[S5] Nakliye pickup: manuel ad input'u görünür oldu VE otomatik odak aldı", pickupFocused);

    check("Genel: konsol hatası yok", jsProblems.length === 0, jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-liman-sanayi-osb-standardization-test] GENEL HATA:", error);
  process.exitCode = 1;
});
