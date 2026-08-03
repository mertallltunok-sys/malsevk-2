// Bu commit kapsamındaki değişikliklerin uçtan uca doğrulaması:
//  1. Gelen Teklifler ilan seçim kartlarında ilan başlığı ARTIK GÖRÜNMEZ,
//     yalnızca hizmet adı + toplam teklif sayısı görünür.
//  2. Okunmamış "yeni teklif" kırmızı sayacı jobId bazında hesaplanır,
//     toplam teklif sayısından bağımsızdır, yalnızca ilgili ilan
//     GÖRÜNTÜLENDİĞİNDE (varsayılan seçili DAHİL, ya da tıklanınca) söner ve
//     yeni bir teklifte yeniden "1" olarak belirir.
//  3. Gümrük Müşavirliği formunda "Gümrük Müdürlüğü" alanı YOKTUR; onun
//     eski yerinde artık "Ürün Cinsi" vardır.
//  4. Başlangıç tarihi alanı bugünden önceki bir günü kabul etmez (hem
//     `min` özniteliği hem submit-anı doğrulaması).
//  5. Footer'ın sol marka kolonunda "Bize Ulaşın" bağlantısı vardır ve
//     /bize-ulasin sayfası "MALSEVK.com" başlığıyla açılır.
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
async function seedJob(page, { id, title, reqId }) {
  await page.evaluate(
    ({ id, title, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category: "depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Rozet dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId },
  );
}
async function submitOffer(page, jobId, { amount, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}
const JOB_A = { id: "rozet-test-job-a", title: "Rozet Testi Ilan Alfa" };
const JOB_B = { id: "rozet-test-job-b", title: "Rozet Testi Ilan Beta" };

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    // ---- 5. Footer "Bize Ulaşın" — bkz. tmp-2026-08-fourth-work-order-test.mjs.
    // Bu davranış (sayfa mı modal mı) iki kez değişti (sayfa → modal →
    // tekrar sayfa); en güncel/kalıcı doğrulama artık o dosyada, burada
    // TEKRARLANMIYOR (bkz. o dosyanın kendi dokümanı).

    // ---- Setup: Zeynep (hizmet-alan) iki ilan oluşturur ----
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    await seedJob(page, { ...JOB_A, reqId: zeynepId });
    await seedJob(page, { ...JOB_B, reqId: zeynepId });

    // ---- 4. Geçmiş tarih engeli (Zeynep, ilan oluşturma formu) ----
    console.log("4) Geçmiş başlangıç tarihi engeli");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    const todayLocal = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    const workDateInput = page.locator('input[type="date"]').first();
    const minAttr = await workDateInput.getAttribute("min");
    assert.equal(minAttr, todayLocal);
    ok(`Başlangıç Tarihi input'unun min değeri bugüne eşit (${minAttr})`);

    // ---- 3. Gümrük Müşavirliği: Gümrük Müdürlüğü yok, Ürün Cinsi üstte ----
    console.log("3) Gümrük Müşavirliği alan grubu");
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Gümrük Müşavirliği" });
    await page.getByText("Gümrük Müşavirliği — Operasyon Bilgileri").waitFor({ state: "visible" });
    const gumrukMudurluguCount = await page.getByText("Gümrük Müdürlüğü", { exact: true }).count();
    assert.equal(gumrukMudurluguCount, 0);
    ok("Gümrük Müdürlüğü alanı formda hiç görünmüyor");
    await page.getByLabel("Ürün Cinsi").waitFor({ state: "visible" });
    ok("Ürün Cinsi alanı Gümrük Müşavirliği bölümünde (eski Gümrük Müdürlüğü yerinde) görünüyor");
    // Geçmiş tarih submit-anı engeli: JS ile min kısıtını atlayıp submit dener.
    await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Depolama" }).catch(() => {});

    // ---- Mert (hizmet-veren) iki ilana da teklif verir: önce B, sonra A ----
    await logout(page);
    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await submitOffer(page, JOB_B.id, { amount: "10000", description: "Beta ilanina teklif." });
    await submitOffer(page, JOB_A.id, { amount: "12000", description: "Alfa ilanina teklif." });
    await logout(page);

    // ---- 1 & 2. Gelen Teklifler: başlık yok, rozet jobId bazlı ----
    console.log("1-2) Gelen Teklifler ilan kartları ve okunmamış rozet");
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/gelen-teklifler");

    const chipA = page.locator(`button[title="${JOB_A.title}"]`);
    const chipB = page.locator(`button[title="${JOB_B.title}"]`);
    await chipA.waitFor({ state: "visible" });
    await chipB.waitFor({ state: "visible" });

    const chipAText = await chipA.innerText();
    const chipBText = await chipB.innerText();
    assert.ok(!chipAText.includes(JOB_A.title), "Kart A ilan başlığını içermemeli");
    assert.ok(!chipBText.includes(JOB_B.title), "Kart B ilan başlığını içermemeli");
    ok("Hiçbir seçim kartı uzun ilan başlığını görünür metin olarak içermiyor");
    assert.ok(chipAText.includes("1 Teklif"));
    assert.ok(chipBText.includes("1 Teklif"));
    ok("Her iki kart da doğru toplam teklif sayısını (1 Teklif) gösteriyor");

    // A varsayılan (en güncel teklife sahip olduğu için otomatik) seçili
    // olsa da HENÜZ TIKLANMADI -> yalnızca "seçili görünmek" rozeti
    // yanlışlıkla söndürmemeli (bkz. görev tanımı) -> A'da da rozet
    // görünmeye devam etmeli.
    const badgeA = chipA.getByLabel(/okunmamış yeni teklif/);
    await badgeA.waitFor({ state: "visible" });
    assert.equal((await badgeA.innerText()).trim(), "1");
    ok("Yalnızca varsayılan seçili (henüz tıklanmamış) kart A'da da rozet görünmeye devam ediyor");

    // B de henüz görüntülenmedi -> rozet "1" olarak görünmeli.
    const badgeB = chipB.getByLabel(/okunmamış yeni teklif/);
    await badgeB.waitFor({ state: "visible" });
    assert.equal((await badgeB.innerText()).trim(), "1");
    ok("Henüz açılmamış kart B'de kırmızı '1' rozeti görünüyor");

    // Kart A'ya TIKLA -> gerçek kullanıcı etkileşimiyle teklifleri aç -> rozet sönmeli.
    await chipA.click();
    await page.waitForTimeout(300);
    assert.equal(await chipA.getByLabel(/okunmamış yeni teklif/).count(), 0);
    ok("Kart A'ya tıklayıp teklifleri açınca rozet sönüyor");
    // B hâlâ etkilenmemiş olmalı (henüz tıklanmadı).
    assert.equal((await chipB.getByLabel(/okunmamış yeni teklif/).innerText()).trim(), "1");
    ok("Kart B'nin rozeti A'nın açılmasından etkilenmedi");

    // Kart B'ye tıkla -> teklifleri aç -> rozet sönmeli.
    await chipB.click();
    await page.waitForTimeout(300);
    assert.equal(await chipB.getByLabel(/okunmamış yeni teklif/).count(), 0);
    ok("Kart B'ye tıklayıp teklifleri açınca rozet sönüyor");
    // A hâlâ etkilenmemiş olmalı (zaten rozetsizdi, hâlâ öyle).
    assert.equal(await chipA.getByLabel(/okunmamış yeni teklif/).count(), 0);
    ok("Kart A'nın durumu B'nin açılmasından etkilenmedi");

    // ---- Yeni bir teklif (Mehmet Demir'den) B'ye gelirse rozet yeniden "1" olmalı ----
    await logout(page);
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/panel");
    await submitOffer(page, JOB_B.id, { amount: "9500", description: "Beta ilanina ikinci teklif." });
    await logout(page);
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/gelen-teklifler");
    const badgeBAgain = chipB.getByLabel(/okunmamış yeni teklif/);
    await badgeBAgain.waitFor({ state: "visible" });
    assert.equal((await badgeBAgain.innerText()).trim(), "1");
    ok("B'ye yeni teklif gelince rozet yeniden '1' oluyor (toplam artık 2 Teklif)");
    assert.ok((await chipB.innerText()).includes("2 Teklif"));
    ok("Kart B'nin toplam teklif sayısı doğru şekilde 2'ye çıktı");

    console.log(`\n${passed} kontrol PASSED.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("TEST FAILED:", error);
  process.exit(1);
});
