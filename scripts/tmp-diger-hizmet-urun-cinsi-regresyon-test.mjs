// Diğer hizmetlerin (ör. Nakliye) "Ürün Bilgileri" > Ürün Cinsi alanının bu
// görevden ETKİLENMEDİĞİNİN doğrulaması — aynı component/katalog, ayrı Job
// alanı (productType), davranış BİREBİR aynı kalmalı.
// Ön koşul: `npm run dev` (localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) { passed++; console.log(`  ok ${d}`); }
function fail(d, e) { console.log(`  FAIL ${d}`); console.log(e?.message ?? e); process.exitCode = 1; }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
    await page.locator('input[type="email"]').fill("zeynep@test.com");
    await page.locator('input[type="password"]').fill("Zeynep1!");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);

    await page.locator("select").first().selectOption({ label: "Nakliye" });
    await page.waitForTimeout(150);

    const productTypeField = page.getByLabel("Ürün Cinsi", { exact: true });
    if ((await productTypeField.count()) === 0) fail("Nakliye formunda Ürün Cinsi alanı bulunamadı");

    await productTypeField.click();
    await page.waitForTimeout(150);
    const optionTexts = await page.locator('ul[role="listbox"] [role="option"]').allTextContents();
    const catalogOptions = optionTexts.filter((t) => t !== "Listede Yok, Kendim Gireceğim");
    if (catalogOptions.length === 20 && catalogOptions.includes("Rulo Sac")) {
      ok(`Nakliye'nin Ürün Cinsi listesi DEĞİŞMEDEN aynı 20 ürünü gösteriyor (bu görev öncesiyle aynı davranış)`);
    } else fail("Nakliye'nin Ürün Cinsi listesi beklenenden farklı — regresyon olabilir", { count: catalogOptions.length });

    await page.getByRole("option", { name: "Boru", exact: true }).click();
    const value = await productTypeField.inputValue();
    if (value === "Boru") ok('Nakliye Ürün Cinsi seçimi ("Boru") normal şekilde çalışıyor');
    else fail("Nakliye Ürün Cinsi seçimi başarısız", { value });

    await browser.close();
  } catch (error) {
    fail("beklenmeyen hata", error);
    await browser.close();
    process.exit(1);
  }
  console.log(`\n${passed} kontrol geçti.`);
})();
