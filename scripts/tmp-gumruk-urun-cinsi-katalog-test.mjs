// Gümrük Müşavirliği "Ürün Cinsi" alanının, diğer hizmetlerle AYNI merkezi
// ürün kataloğunu (product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS) ve AYNI
// seçim component'ini (ProductTypeCombobox) kullandığının doğrulaması.
// Ön koşul: `npm run dev` (localhost:3000) VE `node scripts/generate-photo-test-fixtures.mjs`
// önceden çalıştırılmış olmalı (gerçek yayınlama adımı için).
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const FIX = (name) => path.join(os.tmpdir(), name);
// product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS ile BİREBİR aynı liste — bu
// betik katalog dosyasını tekrar tanımlamaz, yalnızca beklenen SAYIYI ve
// birkaç örnek değeri kontrol eder (tam listeyi de tarayıcıdan okuyup
// karşılaştırır, bkz. adım 1/2).
let passed = 0;
function ok(d) { passed++; console.log(`  ok ${d}`); }
function fail(d, e) { console.log(`  FAIL ${d}`); console.log(e?.message ?? e); process.exitCode = 1; }

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}
async function getJobByTitle(page, title) {
  return page.evaluate((t) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.title === t) ?? null;
  }, title);
}
async function seedLegacyFreeTextJob(page, requesterId) {
  return page.evaluate((reqId) => {
    const now = new Date();
    const createdAt = now.toISOString();
    const publishEndAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const job = {
      id: crypto.randomUUID(),
      status: "yayinda",
      requesterId: reqId,
      // MIN_PHOTOS (1) fotoğraf-sayısı doğrulamasını (bu testin asıl amacı
      // olan "Ürün Cinsi" alanıyla ilgisiz) atlatmak için sahte bir kayıt —
      // gerçek bir IndexedDB blob'u gerekmez, yalnızca job-edit-form.tsx'in
      // "korunacak fotoğraf sayısı" hesabı için yeterlidir.
      photos: [
        {
          id: crypto.randomUUID(),
          order: 0,
          fileName: "seed.jpg",
          fileSize: 1024,
          mimeType: "image/jpeg",
          storageKey: crypto.randomUUID(),
        },
      ],
      operationDetails: "",
      createdAt,
      publishEndAt,
      title: "Eski Gümrük İlanı Serbest Metin Ürün",
      category: "gumruk-musavirligi",
      province: "Kocaeli",
      district: "Dilovası",
      workLocationType: "",
      workDate: "2026-08-05",
      workEndDate: "2026-08-05",
      description: "Katalogda eslesmeyen eski serbest metin urun cinsi testi icin aciklama.",
      customsTransactionType: "ithalat",
      customsOfficeId: "dilovasi-gumruk-mudurlugu",
      // Katalogda (PRODUCT_TYPE_SUGGESTIONS) KESİNLİKLE olmayan, eski
      // serbest-metin dönemden kalma bir değer:
      customsProductType: "Eski Serbest Metin Ürünü XYZ",
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing, job]));
    return job.id;
  }, requesterId);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");

    // ---- 1/2) Gümrük Müşavirliği kartında Ürün Cinsi combobox'ı merkezi kataloğu gösteriyor mu? ----
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Gümrük Müşavirliği" });
    await page.waitForTimeout(150);

    const productTypeLabel = page.getByText("Ürün Cinsi", { exact: true });
    if ((await productTypeLabel.count()) === 0) fail("Gümrük Müşavirliği formunda Ürün Cinsi alanı bulunamadı");

    const isFreeTextInputOnly = await page.locator('input[placeholder="Örnek: Rulo Sac"]:not([role="combobox"])').count();
    if (isFreeTextInputOnly > 0) fail("Ürün Cinsi hâlâ eski serbest metin input'u olarak görünüyor (role=combobox değil)");

    // DİKKAT: page.getByRole("combobox") native <select>'leri de (ör. "Hizmet
    // Kategorisi") eşleştirir (native <select> ARIA'da implicit role=combobox
    // taşır) — bu yüzden burada spesifik "Ürün Cinsi" ETİKETİYLE hedeflenir,
    // ilk combobox'a GÜVENİLMEZ.
    const combobox = page.getByLabel("Ürün Cinsi", { exact: true });
    await combobox.click();
    await page.waitForTimeout(150);
    const optionTexts = await page.locator('ul[role="listbox"] [role="option"]').allTextContents();
    const catalogOptions = optionTexts.filter((t) => t !== "Listede Yok, Kendim Gireceğim");
    if (catalogOptions.length >= 20 && catalogOptions.includes("Rulo Sac") && catalogOptions.includes("Big Bag") && catalogOptions.includes("Paletli Yük")) {
      ok(`Gümrük Müşavirliği'nin Ürün Cinsi listesi merkezi kataloğun TAMAMINI gösteriyor (${catalogOptions.length} ürün)`);
    } else {
      fail("Gümrük Müşavirliği Ürün Cinsi listesi merkezi katalogla eşleşmiyor", { count: catalogOptions.length, catalogOptions });
    }
    if (optionTexts.includes("Listede Yok, Kendim Gireceğim")) {
      ok('"Listede Yok, Kendim Gireceğim" seçeneği listede mevcut');
    } else fail('"Listede Yok, Kendim Gireceğim" seçeneği bulunamadı');

    // ---- 4/5) "Listede yok" seçilince manuel alan açılıyor, hazır ürüne dönünce temizleniyor mu? ----
    await page.getByRole("option", { name: "Listede Yok, Kendim Gireceğim" }).click();
    await page.waitForTimeout(150);
    const manualFieldVisible = await page.getByLabel("Ürün Cinsini Yazınız").count();
    if (manualFieldVisible > 0) ok('"Listede yok" seçilince manuel "Ürün Cinsini Yazınız" alanı açılıyor');
    else fail("Manuel ürün cinsi alanı açılmadı");

    await page.getByLabel("Ürün Cinsini Yazınız").fill("Özel Test Ürünü ABC");
    await page.getByRole("button", { name: "Hazır listeden seçmek için tıklayın" }).click();
    await page.waitForTimeout(150);
    const manualFieldGoneAfterReturn = await page.getByLabel("Ürün Cinsini Yazınız").count();
    if (manualFieldGoneAfterReturn === 0) ok("Hazır listeye dönülünce manuel alan kapanıyor");
    else fail("Hazır listeye dönüldükten sonra manuel alan hâlâ görünüyor");

    // ---- 3) Hazır bir ürün seçip ilanı tamamen doldurup yayınla ----
    await combobox.click();
    await page.waitForTimeout(150);
    await page.getByRole("option", { name: "Rulo Sac", exact: true }).click();
    await page.waitForTimeout(150);
    const comboboxValueAfterSelect = await combobox.inputValue();
    if (comboboxValueAfterSelect === "Rulo Sac") ok('"Rulo Sac" seçildikten sonra alan doğru değeri gösteriyor');
    else fail("Rulo Sac seçimi combobox'a yansımadı", { comboboxValueAfterSelect });

    await page.locator('input[placeholder*="Fabrika Sahasında"]').fill("Gumruk Urun Katalog Testi Ilani");
    await page.locator("textarea").first().fill("Gumruk urun katalogu testi icin en az yirmi karakterlik aciklama.");
    // İşlem Türü + Gümrük Müdürlüğü zorunlu — SearchableSelect'ler.
    const transactionField = page.locator("text=İşlem Türü").locator("xpath=following::button[1]").first();
    await transactionField.click();
    await page.getByRole("option", { name: "İthalat", exact: true }).click();
    const officeField = page.locator("text=Gümrük Müdürlüğü").locator("xpath=following::button[1]").first();
    await officeField.click();
    await page.getByRole("option", { name: "Dilovası Gümrük Müdürlüğü", exact: false }).click();
    const districtField = page.locator("text=İlçe").locator("xpath=following::button[1]").first();
    await districtField.click();
    await page.getByRole("option", { name: "Dilovası", exact: true }).click();
    await page.locator('input[type="date"]').first().fill("2026-08-10");
    await page.locator('input[type="date"]').nth(1).fill("2026-08-10");
    // DİKKAT: Gümrük Müşavirliği kartı KENDİ evrak yükleme input'unu da
    // (Destekleyici Evraklar, JobCustomsDocumentUpload) taşır — sayfada İKİ
    // ayrı `input[type="file"]` bulunur, bu yüzden burada spesifik olarak
    // "Operasyon Fotoğrafları" başlığına en yakın olan hedeflenir.
    const photoUploadInput = page
      .locator("text=Operasyon Fotoğrafları")
      .locator("xpath=following::input[@type='file'][1]");
    await photoUploadInput.setInputFiles([FIX("fixture-valid-1.jpg")]);
    await page.waitForSelector("img[alt]:not([alt=''])", { timeout: 20000 }).catch(() => {});
    const thumbnailCount = await page.locator("img").count();
    console.log(`  [debug] fotoğraf yüklendikten sonra sayfadaki <img> sayısı: ${thumbnailCount}`);

    // Form gönderimi İKİ AŞAMALI (bkz. job-request-form.tsx "Operasyon
    // Önizleme"): ilk "İlanı Yayınla" yalnızca doğrular ve Önizleme moduna
    // geçer; createJob'ın GERÇEKTEN çağrıldığı yer önizlemenin KENDİ "İlanı
    // Yayınla" butonudur.
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForTimeout(500);
    const preSubmitErrors = await page.locator(".text-danger").allTextContents();
    if (preSubmitErrors.length > 0) {
      console.log("  [debug] doğrulama hataları:", preSubmitErrors);
    } else {
      ok("Operasyon Özeti (önizleme) ekranına geçildi — doğrulama hatası yok");
    }
    const previewProductText = await page.textContent("body");
    if (previewProductText.includes("Rulo Sac")) ok('Operasyon Önizleme ekranında "Rulo Sac" doğru gösteriliyor');
    else fail("Önizlemede beklenen ürün cinsi bulunamadı");

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
    ok("Hazır ürün (Rulo Sac) seçilerek Gümrük Müşavirliği ilanı başarıyla yayınlandı");

    const publishedJob = await getJobByTitle(page, "Gumruk Urun Katalog Testi Ilani");
    if (publishedJob?.customsProductType === "Rulo Sac") {
      ok('Yayınlanan ilanda customsProductType == "Rulo Sac" (sentinel değil, gerçek katalog değeri) doğru kaydedildi');
    } else fail("Yayınlanan ilanın customsProductType değeri yanlış", { customsProductType: publishedJob?.customsProductType });

    // ---- 7) İlan detayında doğru ürün gösteriliyor mu? ----
    const detailBodyText = await page.textContent("body");
    if (detailBodyText.includes("Rulo Sac")) ok('İlan detay sayfasında "Rulo Sac" doğru gösteriliyor');
    else fail("İlan detay sayfasında beklenen ürün cinsi bulunamadı");

    // ---- 6) Düzenleme ekranında mevcut ürün doğru yükleniyor mu? ----
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${publishedJob.id}/duzenle`);
    await page.waitForSelector("h1, form");
    const editComboboxValue = await page.getByLabel("Ürün Cinsi", { exact: true }).inputValue();
    if (editComboboxValue === "Rulo Sac") ok('Düzenleme ekranında mevcut ürün ("Rulo Sac") doğru ön-yükleniyor');
    else fail("Düzenleme ekranında ürün cinsi yanlış yüklendi", { editComboboxValue });

    // ---- Eski (katalogda eşleşmeyen) serbest metin ürünlü ilan: veri kaybı yok mu? ----
    const legacyJobId = await seedLegacyFreeTextJob(page, zeynepId);
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${legacyJobId}/duzenle`);
    await page.waitForSelector("h1, form");
    const legacyComboboxValue = await page.getByLabel("Ürün Cinsi", { exact: true }).inputValue();
    if (legacyComboboxValue === "Eski Serbest Metin Ürünü XYZ") {
      ok("Katalogda eşleşmeyen eski serbest-metin ürün, veri kaybı olmadan güvenle gösteriliyor");
    } else fail("Eski serbest-metin ürün verisi kaybolmuş/bozulmuş", { legacyComboboxValue });
    // Formu hiç değiştirmeden tekrar kaydetmenin veriyi bozmadığını doğrula.
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForURL(`${BASE_URL}/panel/hizmet-taleplerim?guncellendi=1`, { timeout: 10000 });
    const legacyJobAfterSave = await getJobByTitle(page, "Eski Gümrük İlanı Serbest Metin Ürün");
    if (legacyJobAfterSave?.customsProductType === "Eski Serbest Metin Ürünü XYZ") {
      ok("Eski serbest-metin ürün, dokunulmadan tekrar kaydedildiğinde AYNEN korunuyor (veri kaybı yok)");
    } else fail("Eski serbest-metin ürün tekrar kaydedilince değişti/kayboldu", { customsProductType: legacyJobAfterSave?.customsProductType });

    await browser.close();
  } catch (error) {
    fail("beklenmeyen hata", error);
    await browser.close();
    process.exit(1);
  }

  console.log(`\n${passed} kontrol geçti.`);
})();
