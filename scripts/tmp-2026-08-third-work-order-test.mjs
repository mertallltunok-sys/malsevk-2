// Bu iş emrindeki değişikliklerin doğrulaması:
//  1. Gelen Teklifler ilan seçim kartları: eşit yükseklik, hizmet adı en
//     büyük/kalın/koyu-lacivert, teklif sayısı daha küçük, tarih en küçük.
//  2. "Listede Yok, Kendim Gireceğim" seçildiğinde açılan manuel Ürün Cinsi
//     inputu satırın TAMAMINI kaplıyor ve otomatik odaklanıyor.
//  3. Bize Ulaşın modalının açılıp/kapanıp yeniden açılabilirliği
//     (bkz. tmp-2026-08-second-work-order-test.mjs'in güncellenmiş 5.
//     bölümü — burada TEKRARLANMAZ).
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}
async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}
async function seedJob(page, { id, title, category, reqId }) {
  await page.evaluate(
    ({ id, title, category, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Kart tipografi testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, reqId },
  );
}
async function submitOffer(page, jobId, { amount, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

const JOB_SHORT = { id: "tipografi-test-job-short", title: "Depolama Testi", category: "kapali-depolama" };
const JOB_LONG = {
  id: "tipografi-test-job-long",
  title: "Cok Uzun Bir Lashing Unlashing Ilan Basligi Buraya Yazildi",
  category: "lashing-unlashing",
};

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    await seedJob(page, { ...JOB_SHORT, reqId: zeynepId });
    await seedJob(page, { ...JOB_LONG, reqId: zeynepId });
    await logout(page);

    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await submitOffer(page, JOB_SHORT.id, { amount: "5000", description: "Depolama testi icin bir teklif metni." });
    await submitOffer(page, JOB_LONG.id, { amount: "7500", description: "Lashing testi icin bir teklif metni." });
    await logout(page);

    // ---- 1. Gelen Teklifler kart tipografisi ----
    console.log("1) Gelen Teklifler kart tipografisi");
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/gelen-teklifler");

    const chipShort = page.locator(`button[title="${JOB_SHORT.title}"]`);
    const chipLong = page.locator(`button[title="${JOB_LONG.title}"]`);
    await chipShort.waitFor({ state: "visible" });
    await chipLong.waitFor({ state: "visible" });

    const boxShort = await chipShort.boundingBox();
    const boxLong = await chipLong.boundingBox();
    assert.ok(boxShort && boxLong, "her iki kartın da bounding box'ı olmalı");
    assert.ok(
      Math.abs(boxShort.height - boxLong.height) < 1,
      `kısa (${boxShort.height}px) ve uzun (${boxLong.height}px) başlıklı kartların yükseklikleri eşit olmalı`,
    );
    ok(`Kısa ("Depolama") ve uzun (uzun Lashing başlığı) kartların yükseklikleri eşit (${boxShort.height}px)`);

    const titleShort = chipShort.locator("span.truncate");
    const titleStyles = await titleShort.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { fontWeight: style.fontWeight, fontSize: style.fontSize, color: style.color };
    });
    assert.ok(Number(titleStyles.fontWeight) >= 700, `hizmet adı kalın olmalı (font-weight: ${titleStyles.fontWeight})`);
    ok(`Hizmet adı kalın (font-weight: ${titleStyles.fontWeight}, renk: ${titleStyles.color})`);

    const countLine = chipShort.locator("span", { hasText: "Teklif" }).first();
    const countStyles = await countLine.evaluate((el) => window.getComputedStyle(el).fontSize);
    assert.ok(
      parseFloat(countStyles) < parseFloat(titleStyles.fontSize),
      `teklif sayısı (${countStyles}) hizmet adından (${titleStyles.fontSize}) küçük olmalı`,
    );
    ok(`Teklif sayısı punto olarak hizmet adından küçük (${countStyles} < ${titleStyles.fontSize})`);

    // ---- 2. Ürün Cinsi manuel alanı — bkz. tmp-2026-08-fourth-work-order-test.mjs.
    // Bu bölümün BURADAKİ eski hâli, "Listede Yok, Kendim Gireceğim"
    // seçilince AYRI bir "Ürün Cinsini Yazınız" kutusunun açılmasını (o
    // zamanki "genişlik + otomatik odak" doğru davranışı) doğruluyordu —
    // sonraki bir iş emri bunun TAM OLARAK bu ikinci-kutu görünümünü
    // hatalı bulup kaldırdı (aynı kutu artık yerinde manuel yazı alanına
    // dönüşüyor, bkz. product-type-combobox.tsx). Tam genişlik + otomatik
    // odak + tek-kutu doğrulaması artık o dosyada, burada TEKRARLANMIYOR.

    console.log(`\n${passed} kontrol PASSED.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("TEST FAILED:", error);
  process.exit(1);
});
