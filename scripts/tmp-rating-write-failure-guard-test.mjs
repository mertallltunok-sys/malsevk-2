// K3 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden (düzeltme öncesi): ratings.ts#writeAllRatings, GERÇEK
// `Storage.prototype.setItem`i try/catch OLMADAN doğrudan çağırıyordu — kod
// tabanındaki (job-store.ts/offers.ts/users.ts/session.ts/...) TEK bu şekilde
// kalan tablo. Kota aşımı/kısıtlı gizlilik modu gibi nedenlerle `setItem`
// fırlarsa hata submitRating'i çağıran job-rating-modal.tsx#handleSubmit'in
// SENKRON tıklama işleyicisinden yakalanmadan dışarı çıkıyor, `setSubmitting
// (false)` satırına HİÇ ulaşılmıyor, kullanıcı "Gönderiliyor..." yazan,
// kapatılamayan bir modalda kilitli kalıyordu.
//
// Düzeltme: writeAllRatings artık local-storage.ts#writeJson (catch + boolean
// dönüş) kullanıyor (ratings.ts), submitRating yazma başarısızlığını gerçek
// bir { ok: false, error } olarak dönüyor, ve job-rating-modal.tsx#handleSubmit
// ayrıca bir try/catch/finally ile sarılarak `submitting`in HER durumda
// false'a dönmesini garanti ediyor.
//
// Bu script GERÇEK tarayıcı ortamında `Storage.prototype.setItem`i yalnızca
// `malsevk.ratings.v1` anahtarı için exception fırlatacak şekilde patch'leyip
// (tmp-storage-write-failure-guard-test.mjs ile AYNI teknik) şunları doğrular:
//   1. Yazma hatasında merkezi hata metni role="alert" ile gösterilir.
//   2. "Değerlendirmeyi Gönder" butonu "Gönderiliyor..." yazısında TAKILI
//      KALMAZ — hemen normal metnine ve tıklanabilir duruma döner.
//   3. Modal "Daha Sonra" ile kapatılabilir durumda kalır (kilitlenmiyor).
//   4. localStorage'da GERÇEKTEN hiçbir Rating kaydı oluşmamıştır.
//   5. Hiçbir uncaught JS hatası (page "pageerror" olayı) üretilmez.
//   6. Patch kaldırıldıktan sonra AYNI modal yeniden açılıp başarıyla
//      gönderilebilir (başarılı akış bozulmamış).
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STORAGE_WRITE_ERROR_MESSAGE =
  "İşlem kaydedilemedi. Tarayıcı depolama alanını kontrol edip tekrar deneyin.";
const RATINGS_KEY = "malsevk.ratings.v1";
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

/** tmp-storage-write-failure-guard-test.mjs ile AYNI teknik: gerçek Storage.prototype.setItem'ı yalnızca `matchKey` için exception fırlatacak şekilde patch'ler. */
async function installThrowingSetItem(page, matchKey) {
  await page.evaluate((key) => {
    if (window.__origSetItem) throw new Error("Test hatası: patch zaten kurulu, önce kaldırılmalı");
    window.__origSetItem = Storage.prototype.setItem;
    window.__throwKey = key;
    Storage.prototype.setItem = function (k, v) {
      if (k === window.__throwKey) {
        throw new DOMException("Simulated storage failure (K3 test)", "QuotaExceededError");
      }
      return window.__origSetItem.call(this, k, v);
    };
  }, matchKey);
}

async function removeThrowingSetItem(page) {
  await page.evaluate(() => {
    if (!window.__origSetItem) return;
    Storage.prototype.setItem = window.__origSetItem;
    delete window.__origSetItem;
    delete window.__throwKey;
  });
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 10000 });
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function getRawStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    // `console.error` BEKLENEN bir sinyaldir — local-storage.ts#writeJson
    // gerçek yazma hatasını kasıtlı olarak burada loglar (bkz. tmp-storage-
    // write-failure-guard-test.mjs'in AYNI ayrımı). Yalnızca `pageerror`
    // (yakalanmamış exception) bir regresyon işaretidir.
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    const providerId = "provider-k3-test";
    const jobId = `k3-rating-${STAMP}`;
    const jobTitle = `K3-RATING-${STAMP}`;
    const offerId = `${jobId}-offer-0`;

    await page.evaluate(
      ({ jobId, title, requesterId }) => {
        const job = {
          id: jobId,
          title,
          category: "Depolama",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Test Tesis",
          workDate: "2026-12-01",
          description: "K3 değerlendirme yazma-hatası koruması testi için oluşturulan ilan.",
          operationDetails: "Test operasyon detayı.",
          status: "yayinda",
          requesterId,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      },
      { jobId, title: jobTitle, requesterId: zeynepId },
    );
    await page.evaluate(
      ({ jobId, offerId, providerId }) => {
        const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
        offers.push({
          id: offerId,
          jobId,
          providerId,
          amount: 1000,
          currency: "TRY",
          description: "Test teklifi",
          estimatedDuration: 3,
          status: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
        localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      },
      { jobId, offerId, providerId },
    );

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const card = page.locator("li", { hasText: jobTitle });
    await assert.doesNotReject(card.waitFor({ state: "visible", timeout: 10000 }));

    // === Yazma hatası patch'i kurulu ===
    await installThrowingSetItem(page, RATINGS_KEY);

    await card.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
    const dialog = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("radio", { name: "5 yıldız" }).click();
    await dialog.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();

    const errorAlert = dialog.getByRole("alert");
    await assert.doesNotReject(errorAlert.waitFor({ state: "visible", timeout: 5000 }));
    const errorText = (await errorAlert.textContent())?.trim();
    check("1. Merkezi hata metni gösterildi", errorText === STORAGE_WRITE_ERROR_MESSAGE, `metin="${errorText}"`);

    const submitButton = dialog.getByRole("button", { name: "Değerlendirmeyi Gönder" });
    const submitButtonText = (await submitButton.textContent())?.trim();
    const submitButtonEnabled = await submitButton.isEnabled();
    check(
      "2. 'Değerlendirmeyi Gönder' butonu 'Gönderiliyor...' yazısında takılı kalmadı, tekrar tıklanabilir",
      submitButtonText === "Değerlendirmeyi Gönder" && submitButtonEnabled,
      `metin="${submitButtonText}", enabled=${submitButtonEnabled}`,
    );

    const cancelButton = dialog.getByRole("button", { name: "Daha Sonra" });
    const cancelEnabled = await cancelButton.isEnabled();
    check("3. 'Daha Sonra' ile modal kapatılabilir durumda (kilitlenmedi)", cancelEnabled);

    const rawRatingsAfterFailure = await getRawStorage(page, RATINGS_KEY);
    check(
      "4. localStorage'da hiçbir Rating kaydı oluşmadı",
      !rawRatingsAfterFailure || JSON.parse(rawRatingsAfterFailure).length === 0,
      `raw=${rawRatingsAfterFailure}`,
    );

    console.log(`  (bilgi) ${consoleErrors.length} beklenen console.error (writeJson'ın kendi loglaması): ${consoleErrors.join(" | ")}`);
    check("5. Hiçbir uncaught JS hatası (pageerror) oluşmadı", pageErrors.length === 0, pageErrors.join(" | "));

    // Modalın gerçekten kapatılabildiğini de doğrula.
    await cancelButton.click();
    await assert.doesNotReject(dialog.waitFor({ state: "hidden", timeout: 5000 }));
    check("3b. 'Daha Sonra' tıklanınca modal gerçekten kapandı", true);

    // === Patch kaldırıldı — aynı akış yeniden denenip başarıyla tamamlanmalı ===
    await removeThrowingSetItem(page);
    await card.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
    const dialog2 = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
    await dialog2.waitFor({ state: "visible", timeout: 5000 });
    await dialog2.getByRole("radio", { name: "5 yıldız" }).click();
    await dialog2.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
    await assert.doesNotReject(dialog2.waitFor({ state: "hidden", timeout: 5000 }));

    const rawRatingsAfterRetry = await getRawStorage(page, RATINGS_KEY);
    const ratingsAfterRetry = rawRatingsAfterRetry ? JSON.parse(rawRatingsAfterRetry) : [];
    check(
      "6. Patch kaldırılınca aynı değerlendirme yeniden denenip başarıyla kaydedildi",
      ratingsAfterRetry.some((r) => r.offerId === offerId && r.stars === 5),
      `kayıt sayısı=${ratingsAfterRetry.length}`,
    );

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[rating-write-failure-guard-test] GENEL HATA:", error);
  process.exitCode = 1;
});
