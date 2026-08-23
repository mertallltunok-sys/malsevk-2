// node scripts/tmp-nakliye-visual-redesign-submit-test.mjs
// Görsel yeniden düzenlemeden SONRA gerçek bir Nakliye ilanının hâlâ
// başarıyla oluşturulup oluşturulamadığını (form -> handlePublish ->
// createJob -> Supabase senkronu) uçtan uca doğrular. Development'a
// gerçek bir test ilanı yazar, script sonunda TEMİZLER (job-store'un kendi
// localStorage'ı tarayıcı oturumuyla birlikte kapanınca zaten kaybolur;
// Supabase tarafı için ayrı bir temizlik script'i çalıştırılır).
import { chromium } from "playwright";
import crypto from "node:crypto";

const BASE_URL = "http://localhost:3000";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

// Her fotoğraf FARKLI baytlar taşımalı — job-store.ts SHA-256 içerik hash'i
// ile aynı-fotoğraf mükerrer yüklemesini engelliyor (bkz. photo-validation.ts).
function makeUniqueJpeg(seed) {
  const base = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
    "base64",
  );
  const marker = Buffer.from(`\xff\xfe${String(seed).padStart(4, "0")}`, "binary");
  return Buffer.concat([base, marker]);
}

async function uploadFourPhotos(page) {
  const fileInput = page.locator('input[type="file"]');
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `test-${crypto.randomUUID()}.jpg`, mimeType: "image/jpeg", buffer: makeUniqueJpeg(i + 1) }));
  await fileInput.setInputFiles(files);
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 20000 },
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("PAGE ERROR: " + err.message));

  await loginAs(page, "ilanveren@demo.test", "Demo123!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
  await page.waitForTimeout(300);

  await page.locator('input[id^="service-title"]').fill("GORSEL TEST Nakliye Ilani");
  await page.locator('textarea[id^="service-description"]').fill("Gorsel yeniden tasarim sonrasi uctan uca gonderim testi. En az yirmi karakter.");

  // Bölüm 2: Taşıma Şekli / Sevkiyat Yapısı / tarihler
  await page.locator('button[id$="-shipment-type"]').click();
  await page.getByRole("option", { name: "Komple Taşıma (FTL)", exact: true }).click();
  const today = new Date(); today.setDate(today.getDate() + 3);
  const end = new Date(today); end.setDate(end.getDate() + 2);
  const fmt = (d) => d.toISOString().slice(0, 10);
  await page.locator('input[id$="-work-date"]').fill(fmt(today));
  await page.locator('input[id$="-work-end-date"]').fill(fmt(end));

  // Bölüm 3: Ürün Cinsi + Paletli seç + Palet Adedi/Toplam Ağırlık doldur
  await page.locator('input[id^="service-productType"]').fill("Gorsel Test Yuku");
  await page.getByRole("button", { name: "Paletli", exact: true }).click();
  await page.locator('input[id$="-qty"]').first().fill("10");
  await page.locator('input[id^="service-productTonnage-"]').fill("5");

  // Bölüm 4: Araç Tercihi — nakliyeci önersin
  await page.getByText("Nakliyeci uygun aracı önersin").click();

  // Bölüm 5: Yükleme (Nereden) — Gebze + gerçek bir facility seç
  await page.locator('button[id^="service-pickup-"][id$="-district"]').click();
  await page.getByRole("option", { name: "Gebze", exact: true }).first().click();
  await page.locator('button[id^="service-pickup-"][id$="-locationType"]').click();
  await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').getByRole("option").first().click();

  // Teslimat (Nereye) — İstanbul / Kadıköy + manuel adres
  await page.locator('button[id^="service-delivery-"][id$="-province"]').click();
  await page.getByRole("option", { name: "İstanbul", exact: true }).first().click();
  await page.locator('button[id^="service-delivery-"][id$="-district"]').click();
  await page.getByRole("option", { name: "Kadıköy", exact: true }).first().click();
  await page.locator('button[id^="service-delivery-"][id$="-locationType"]').click();
  const deliveryListbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await deliveryListbox.getByText("Listede Yok, Kendim Gireceğim", { exact: true }).click();
  await page.locator('input[id^="service-delivery-"][id$="-customFacilityName"]').fill("Test Deposu A.S.");

  await page.locator('textarea[id$="-addressText"]').first().fill("Gorsel test acik adres metni en az on karakter.");
  await page.locator('textarea[id$="-addressText"]').nth(1).fill("Teslimat acik adres metni en az on karakter.");

  await uploadFourPhotos(page);

  console.log("Form dolduruldu, gönderiliyor...");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 }).catch(async () => {
    console.log("Beklenen yönlendirme olmadı, mevcut URL:", page.url());
    const errorTexts = await page.locator(".text-danger").allTextContents();
    console.log("Hata mesajları:", JSON.stringify(errorTexts.filter(Boolean), null, 2));
  });

  await page.waitForTimeout(1000);
  console.log("Gönderim sonrası URL:", page.url());
  console.log("Konsol hataları:", consoleErrors.length === 0 ? "yok" : consoleErrors.join(" | "));

  const jobIdMatch = page.url().match(/\/ilanlar\/([a-f0-9-]{36})/);
  if (jobIdMatch) {
    console.log("OLUŞTURULAN_ILAN_ID:" + jobIdMatch[1]);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("HATA:", err);
  process.exit(1);
});
