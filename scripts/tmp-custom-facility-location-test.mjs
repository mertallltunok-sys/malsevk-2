// node scripts/tmp-custom-facility-location-test.mjs
//
// "Listede Yok / Özel Tesis Girişi" aşamasının (2026-07-25) uçtan uca
// doğrulaması: hazır katalog seçimi akışının bozulmadığını, yeni "Listede
// yok — tesis bilgilerini kendim gireceğim" özel tesis akışının doğru
// çalıştığını, mod geçişlerinin (özel<->hazır) veri kaybı yaratmadığını,
// eski ilanların hâlâ sorunsuz göründüğünü ve rol kapsamının (yalnızca
// Hizmet Alan) UI seviyesinde uygulandığını doğrular.
// Ön koşul: `npm run dev` http://localhost:3000 üzerinde çalışıyor olmalı.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
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

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

async function fillBaseJobFields(page, { title, category = "depo-personeli" }) {
  await page.locator("select").first().selectOption(category);
  await page.getByLabel("İlan Başlığı").fill(title);
  await page
    .getByLabel("İş Açıklaması")
    .fill("Bu test için oluşturulmuş, en az yirmi karakter içeren bir iş açıklamasıdır.");
  await page.getByLabel("İş Tarihi").fill("2026-12-20");
  await page
    .getByLabel("Operasyon Detayları")
    .fill("Test operasyon detayı, en az on karakter içerir.");
  // Fotoğraf zorunluluğunu bu testte atlamak için: MIN_PHOTOS kontrolü
  // yalnızca submit anında devreye girer, bu script fotoğraf yüklemeden
  // submit denemez (photoCount hatasını ayrı bir zaten var olan testte
  // tmp-provider-job-listing-redesign-test.mjs / browser-test-job-photos.mjs
  // kapsıyor) — bu yüzden burada seed verisi üzerinden değil, gerçek en az
  // 1 fotoğraf yükleyerek ilerliyoruz.
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    // 1x1 minimal JPEG
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  // JobPhotoUpload işleme bitene kadar bekle — kart görünür olduğunda hazırdır.
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

    // =========================================================
    console.log("\n=== Senaryo 1: Hazır liman (Beldeport) seçilerek ilan oluşturuluyor ===");
    await loginAs(page, ZEYNEP, "/hizmet-talebi-olustur");
    await fillBaseJobFields(page, { title: `CUSTOM-TEST-CATALOG-LIMAN-${STAMP}` });
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Dilovası");
    await selectFromSearchable(page, "Bölge / Tesis", "Beldeport", { exact: false });
    check(
      "[S1] Facility seçilince 'Firma / Fabrika Adı' alanı görünüyor (katalog modu)",
      (await page.getByLabel("Firma / Fabrika Adı").count()) > 0,
    );
    await page.getByLabel("Firma / Fabrika Adı").fill("Test Firma A.Ş.");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    await page.getByText(`CUSTOM-TEST-CATALOG-LIMAN-${STAMP}`).waitFor({ state: "visible", timeout: 10000 });
    check("[S1] Hazır liman seçilerek ilan başarıyla oluşturuldu", true);
    check(
      "[S1] İlan detayında 'Beldeport' görünüyor",
      (await page.locator("main").innerText()).includes("Beldeport"),
    );

    // =========================================================
    console.log("\n=== Senaryo 2: Hazır OSB (GOSB) seçilerek ilan oluşturuluyor ===");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await fillBaseJobFields(page, { title: `CUSTOM-TEST-CATALOG-OSB-${STAMP}` });
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await selectFromSearchable(page, "Bölge / Tesis", "GOSB", { exact: false });
    await page.getByLabel("Firma / Fabrika Adı").fill("Test Firma OSB A.Ş.");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:2, Gebze");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    await page.getByText(`CUSTOM-TEST-CATALOG-OSB-${STAMP}`).waitFor({ state: "visible", timeout: 10000 });
    check("[S2] Hazır OSB seçilerek ilan başarıyla oluşturuldu", true);
    check(
      "[S2] İlan detayında 'GOSB' görünüyor",
      (await page.locator("main").innerText()).includes("GOSB"),
    );

    // =========================================================
    console.log('\n=== Senaryo 3: "Listede yok" seçilince özel tesis alanları açılıyor ===');
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Dilovası");
    await selectFromSearchable(page, "Bölge / Tesis", "Listede yok — tesis bilgilerini kendim gireceğim");
    check("[S3] 'Tesis / İşletme Adı' alanı görünüyor", (await page.getByLabel("Tesis / İşletme Adı").count()) > 0);
    check(
      "[S3] 'Bölge / Mahalle' alanı görünüyor",
      (await page.getByLabel(/Bölge \/ Mahalle/).count()) > 0,
    );
    check(
      "[S3] 'Konum Bağlantısı' alanı görünüyor",
      (await page.getByLabel(/Konum Bağlantısı/).count()) > 0,
    );
    check(
      "[S3] 'Adres Tarifi' alanı görünüyor",
      (await page.getByLabel(/Adres Tarifi/).count()) > 0,
    );
    check(
      "[S3] 'Firma / Fabrika Adı' alanı ARTIK GÖRÜNMÜYOR (özel tesis modunda tek isim alanı var)",
      (await page.getByLabel("Firma / Fabrika Adı").count()) === 0,
    );

    // =========================================================
    console.log("\n=== Senaryo 4: Tesis adı veya açık adres boşsa ilan yayınlanamıyor ===");
    await fillBaseJobFields(page, { title: `CUSTOM-TEST-EMPTY-${STAMP}` });
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.waitForTimeout(500);
    check(
      "[S4] Boş Tesis/İşletme Adı ve Açık Adres ile submit engellendi (sayfa hâlâ ilan formunda)",
      page.url().includes("/hizmet-talebi-olustur"),
    );
    check(
      "[S4] 'Tesis / işletme adını belirtiniz.' hatası gösteriliyor",
      (await page.locator("main").innerText()).includes("Tesis / işletme adını belirtiniz."),
    );

    // =========================================================
    console.log("\n=== Senaryo 5: Özel tesis bilgileri ilana doğru kaydediliyor ===");
    await page.getByLabel("Tesis / İşletme Adı").fill("ABC Metal Fabrikası");
    await page.getByLabel(/Bölge \/ Mahalle/).fill("Çerkeşli Mahallesi");
    await page.getByLabel(/Konum Bağlantısı/).fill("https://maps.google.com/?q=test");
    await page.getByLabel(/Adres Tarifi/).fill("Ana kapıdan değil, B kapısından giriniz.");
    await page.getByLabel("Açık Adres").fill("Çerkeşli Mahallesi, Test Sokak No:5, Dilovası/Kocaeli");
    await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    const customJobUrl = page.url();
    let bodyText = await page.locator("main").innerText();
    check("[S5] Özel tesis ilanı başarıyla oluşturuldu", true);
    check("[S5] 'ABC Metal Fabrikası' ilan detayında görünüyor", bodyText.includes("ABC Metal Fabrikası"));
    check("[S5] 'Dilovası / Kocaeli' konumu görünüyor", bodyText.includes("Dilovası / Kocaeli"));
    check(
      "[S5] Açık adres (ilan sahibi olarak) görünüyor",
      bodyText.includes("Çerkeşli Mahallesi") && bodyText.includes("Test Sokak No:5"),
    );
    check("[S5] Adres tarifi görünüyor", bodyText.includes("B kapısından giriniz"));
    check(
      "[S5] Konum bağlantısı ('Haritada Görüntüle') görünüyor",
      bodyText.includes("Haritada Görüntüle"),
    );

    // =========================================================
    console.log("\n=== Senaryo 6: Sayfa yenilendiğinde özel tesis bilgileri korunuyor ===");
    await page.reload();
    await page.getByText("ABC Metal Fabrikası").waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check(
      "[S6] Yenileme sonrası tüm özel tesis bilgileri hâlâ doğru görünüyor",
      bodyText.includes("ABC Metal Fabrikası") &&
        bodyText.includes("Çerkeşli Mahallesi") &&
        bodyText.includes("B kapısından giriniz") &&
        bodyText.includes("Haritada Görüntüle"),
    );

    // =========================================================
    console.log("\n=== Senaryo 7: İlan düzenlemede özel tesis bilgileri geri geliyor ===");
    const customJobId = customJobUrl.split("/ilanlar/")[1];
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${customJobId}/duzenle`);
    await page.getByLabel("Tesis / İşletme Adı").waitFor({ state: "visible", timeout: 10000 });
    check(
      "[S7] 'Tesis / İşletme Adı' geri yüklendi",
      (await page.getByLabel("Tesis / İşletme Adı").inputValue()) === "ABC Metal Fabrikası",
    );
    check(
      "[S7] 'Bölge / Mahalle' geri yüklendi",
      (await page.getByLabel(/Bölge \/ Mahalle/).inputValue()) === "Çerkeşli Mahallesi",
    );
    check(
      "[S7] 'Konum Bağlantısı' geri yüklendi",
      (await page.getByLabel(/Konum Bağlantısı/).inputValue()) === "https://maps.google.com/?q=test",
    );
    check(
      "[S7] 'Adres Tarifi' geri yüklendi",
      (await page.getByLabel(/Adres Tarifi/).inputValue()) === "Ana kapıdan değil, B kapısından giriniz.",
    );
    check(
      "[S7] 'Firma / Fabrika Adı' hâlâ gizli (özel tesis modu korunuyor)",
      (await page.getByLabel("Firma / Fabrika Adı").count()) === 0,
    );

    // =========================================================
    console.log("\n=== Senaryo 8: Özel tesisten hazır tesise geçiş çalışıyor ===");
    await page.getByRole("button", { name: "Hazır listeden seçmek için tıklayın." }).click();
    await selectFromSearchable(page, "Bölge / Tesis", "Beldeport", { exact: false });
    check(
      "[S8] Hazır tesise geçince özel tesis alanları kayboluyor",
      (await page.getByLabel(/Bölge \/ Mahalle/).count()) === 0,
    );
    check(
      "[S8] Hazır tesise geçince 'Firma / Fabrika Adı' tekrar görünüyor",
      (await page.getByLabel("Firma / Fabrika Adı").count()) > 0,
    );
    await page.getByLabel("Firma / Fabrika Adı").fill("Beldeport Test Firma");
    await page.getByRole("button", { name: /Kaydet/ }).click();
    await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
    await page.goto(customJobUrl);
    await page.getByText("Beldeport Test Firma").waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[S8] Kayıt sonrası ilan detayında 'Beldeport' görünüyor", bodyText.includes("Beldeport"));
    check(
      "[S8] Eski özel tesis adı ('ABC Metal Fabrikası') artık görünmüyor",
      !bodyText.includes("ABC Metal Fabrikası"),
    );
    check(
      "[S8] Eski özel adres tarifi ('B kapısından giriniz') artık görünmüyor (mod değişince temizlendi)",
      !bodyText.includes("B kapısından giriniz"),
    );

    // =========================================================
    console.log("\n=== Senaryo 9: Hazır tesisten özel tesise geçiş çalışıyor ===");
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${customJobId}/duzenle`);
    await selectFromSearchable(page, "Bölge / Tesis", "Listede yok — tesis bilgilerini kendim gireceğim");
    check(
      "[S9] Özel tesise dönünce alanlar BOŞ açılıyor (eski Beldeport verisi sızmıyor)",
      (await page.getByLabel("Tesis / İşletme Adı").inputValue()) === "",
    );
    await page.getByLabel("Tesis / İşletme Adı").fill("XYZ Tekstil Fabrikası");
    await page.getByLabel("Açık Adres").fill("Yeni Mahalle, Yeni Cadde No:9, Dilovası/Kocaeli");
    await page.getByRole("button", { name: /Kaydet/ }).click();
    await page.waitForURL(/guncellendi=1/, { timeout: 15000 });
    await page.goto(customJobUrl);
    await page.getByText("XYZ Tekstil Fabrikası").waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("[S9] Hazır tesisten özel tesise geçiş sonrası 'XYZ Tekstil Fabrikası' görünüyor", bodyText.includes("XYZ Tekstil Fabrikası"));
    check("[S9] Eski katalog seçimi ('Beldeport') artık görünmüyor", !bodyText.includes("Beldeport"));

    // =========================================================
    console.log("\n=== Senaryo 10: İl ve ilçe filtreleri özel tesis ilanlarında da çalışıyor ===");
    await clearSession(page);
    await loginAs(page, MERT, "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar`);
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Dilovası");
    await page.waitForTimeout(500);
    bodyText = await page.locator("main").innerText();
    check(
      "[S10] Kocaeli/Dilovası filtresiyle özel tesisli ilan ('XYZ Tekstil Fabrikası') listede görünüyor",
      bodyText.includes("XYZ Tekstil Fabrikası") || bodyText.includes(`CUSTOM-TEST-CATALOG-LIMAN-${STAMP}`),
    );

    // =========================================================
    console.log("\n=== Senaryo 11: Eski (locationMode'suz) statik ilan sorunsuz görüntüleniyor ===");
    await page.goto(`${BASE_URL}/ilanlar/ilan-002`);
    await page.getByRole("heading", { name: "Fabrika Sahasında Forklift Operatörü İhtiyacı" }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    bodyText = await page.locator("main").innerText();
    check("[S11] Eski ilan sayfası çökmeden açılıyor", bodyText.length > 0);
    check("[S11] Sayfada 'undefined' metni yok", !bodyText.includes("undefined"));
    check("[S11] Eski ilanın workLocationType'ı ('Fabrika') doğru görünüyor", bodyText.includes("Fabrika"));

    // =========================================================
    console.log("\n=== Rol kapsamı: Hizmet Veren özel tesis formuna erişemiyor ===");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // useSession() ilk hidrasyon anında bir tık gecikmeli gerçek oturumu
    // yansıtır (bkz. malsevk_centralized_location_architecture.md hafıza
    // notu, Aşama 1.1'de aynı sınıf zamanlama hatası) — mesaj görünür
    // olana kadar bekle, yoksa an'lık "misafir" karesi yakalanabilir.
    await page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({
      state: "visible",
      timeout: 10000,
    });
    bodyText = await page.locator("main").innerText();
    check(
      "[Rol] Hizmet Veren'e 'Yalnızca Hizmet Alan...' engeli gösteriliyor, form yok",
      bodyText.includes("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.") &&
        (await page.getByLabel("Tesis / İşletme Adı").count()) === 0,
    );

    console.log("\n=== Rol kapsamı: Oturum açmamış ziyaretçiye özel tesis formu gösterilmiyor ===");
    await clearSession(page);
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    bodyText = await page.locator("main").innerText();
    check(
      "[Rol] Ziyaretçiye giriş engeli gösteriliyor, form yok",
      bodyText.includes("İlan oluşturmak için giriş yapmalısınız.") &&
        (await page.getByLabel("Tesis / İşletme Adı").count()) === 0,
    );

    check("Genel: konsol hatası yok", jsProblems.length === 0, jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-custom-facility-location-test] GENEL HATA:", error);
  process.exitCode = 1;
});
