import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function uploadFourPhotos(page) {
  const fileInput = page.locator('input[type="file"]');
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
    "base64",
  );
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `t${i}.jpg`, mimeType: "image/jpeg", buffer: jpeg }));
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
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();

  await loginAs(page, "ilanveren@demo.test", "Demo123!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
  await page.waitForTimeout(300);

  await page.locator('input[id^="service-title"]').fill(`GÖRSEL TEST Nakliye ${Date.now()}`);
  await page.locator('textarea[id^="service-description"]').fill("Görsel yeniden tasarım sonrası uçtan uca gönderim testi. En az yirmi karakter.");
  await page.locator('button[id$="-shipment-type"]').click();
  await page.getByRole("option", { name: "Komple Taşıma (FTL)", exact: true }).click();
  const today = new Date(); today.setDate(today.getDate() + 3);
  const end = new Date(today); end.setDate(end.getDate() + 2);
  const fmt = (d) => d.toISOString().slice(0, 10);
  await page.locator('input[id$="-work-date"]').fill(fmt(today));
  await page.locator('input[id$="-work-end-date"]').fill(fmt(end));
  await page.locator('input[id^="service-productType"]').fill("Görsel Test Yükü");
  await page.locator('button[id$="-district"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).first().click();
  const deliveryProvinceBtn = page.locator('button[id$="-province"]').nth(1);
  await deliveryProvinceBtn.click();
  await page.getByRole("option", { name: "İstanbul", exact: true }).first().click();
  await page.locator('button[id$="-district"]').nth(1).click();
  await page.getByRole("option", { name: "Kadıköy", exact: true }).first().click();
  await page.locator('textarea[id$="-addressText"]').first().fill("Görsel test açık adres metni, en az on karakter.");
  await page.locator('textarea[id$="-addressText"]').nth(1).fill("Teslimat açık adres metni, en az on karakter.");
  await uploadFourPhotos(page);

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(1000);

  const errorTexts = await page.locator(".text-danger").allTextContents();
  console.log("Görünen hata mesajları:", JSON.stringify(errorTexts.filter(Boolean), null, 2));
  const alertBanner = await page.locator('[role="alert"]').allTextContents();
  console.log("Alert bannerlar:", JSON.stringify(alertBanner.filter(Boolean), null, 2));

  await browser.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
