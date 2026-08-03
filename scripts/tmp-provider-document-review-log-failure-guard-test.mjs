// Y4 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden: provider-document-reviews.ts#recordProviderDocumentReview,
// denormalize edilmiş belge durumunu (provider-documents.ts) başarıyla
// güncelledikten SONRA append-only inceleme günlüğünü (bu dosyanın kendi
// `malsevk.provider_document_reviews.v1` tablosu) yazıyordu, ama bu İKİNCİ
// yazımın dönüş değerini HİÇ kontrol etmiyordu — günlük satırı yazılamasa
// bile fonksiyon koşulsuz `{ok:true}` dönüyordu. Admin ekranında işlem
// "başarılı" görünüyordu ama inceleme geçmişi sessizce kayboluyordu; belge
// durumu ile günlük arasında kalıcı bir "yarım başarı" oluşuyordu.
//
// Düzeltme: günlük yazımı artık kontrol ediliyor. Başarısız olursa (a) az
// önce yazılan belge durumu ESKİ (değişiklik öncesi) değerine en iyi
// çabayla geri alınır (localStorage'da gerçek bir transaction olmadığından
// tam atomiklik mümkün değil), (b) admin ekranına merkezi
// STORAGE_WRITE_ERROR_MESSAGE ile gerçek bir hata döner, (c) başarılı akış
// (patch kaldırıldıktan sonra) değişmeden çalışmaya devam eder.
//
// Bu script GERÇEK tarayıcı ortamında `Storage.prototype.setItem`i yalnızca
// `malsevk.provider_document_reviews.v1` anahtarı için exception fırlatacak
// şekilde patch'leyip (tmp-storage-write-failure-guard-test.mjs ile AYNI
// teknik) şunları doğrular:
//   1. Admin ekranına gerçek bir hata mesajı gösterilir (sessiz "başarı" yok).
//   2. Belgenin denormalize reviewStatus'u ESKİ değerine ("pending") geri
//      alınır — kalıcı olarak "rejected" görünmez.
//   3. Hiçbir günlük (review) satırı oluşmamıştır (yarım başarı yok).
//   4. Hiçbir uncaught JS hatası (pageerror) üretilmez.
//   5. Patch kaldırılınca AYNI işlem yeniden denenip başarıyla tamamlanır —
//      hem belge durumu hem günlük satırı doğru şekilde güncellenir.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STORAGE_WRITE_ERROR_MESSAGE =
  "İşlem kaydedilemedi. Tarayıcı depolama alanını kontrol edip tekrar deneyin.";
const REVIEWS_KEY = "malsevk.provider_document_reviews.v1";
const DOCUMENTS_KEY = "malsevk.provider_documents.v1";
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function installThrowingSetItem(page, matchKey) {
  await page.evaluate((key) => {
    if (window.__origSetItem) throw new Error("Test hatası: patch zaten kurulu, önce kaldırılmalı");
    window.__origSetItem = Storage.prototype.setItem;
    window.__throwKey = key;
    Storage.prototype.setItem = function (k, v) {
      if (k === window.__throwKey) {
        throw new DOMException("Simulated storage failure (Y4 test)", "QuotaExceededError");
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

async function getRawStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    // Ayrı/izole sahte bir hizmet-veren + tek bir "pending" belge — mevcut
    // dev-seed hesaplarını (Mert, Nakliye Demo, ...) hiç etkilemez.
    const providerName = `Y4 Test Sağlayıcı ${STAMP}`;
    const providerId = `y4-provider-${STAMP}`;
    const documentId = `y4-doc-${STAMP}`;

    await page.goto(`${BASE_URL}/`);
    await page.evaluate(
      ({ providerId, providerName, documentId }) => {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        users.push({
          id: providerId,
          name: providerName,
          email: `y4-test-${providerId}@example.com`,
          phone: "+905550000000",
          passwordHash: "test-not-a-real-hash",
          role: "hizmet-veren",
        });
        localStorage.setItem("malsevk.users.v1", JSON.stringify(users));

        const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
        documents.push({
          id: documentId,
          userId: providerId,
          originalFileName: "y4-test-faaliyet-belgesi.pdf",
          mimeType: "application/pdf",
          extension: "pdf",
          size: 12345,
          indexedDbStorageKey: `y4-test-blob-${documentId}`,
          uploadedAt: "2026-01-01T00:00:00.000Z",
          reviewStatus: "pending",
          documentType: "genel",
        });
        localStorage.setItem("malsevk.provider_documents.v1", JSON.stringify(documents));
      },
      { providerId, providerName, documentId },
    );

    await loginAs(page, "admin@test.com", "Admin123!", "/panel");
    await page.goto(`${BASE_URL}/admin`);
    await page.getByRole("heading", { name: "Hizmet Veren Belge Kontrolü" }).waitFor({ state: "visible", timeout: 10000 });

    const providerCard = page
      .getByText(providerName, { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
    await assert.doesNotReject(providerCard.waitFor({ state: "visible", timeout: 10000 }));

    // === Yazma hatası patch'i kurulu — Reddet dene ===
    await installThrowingSetItem(page, REVIEWS_KEY);

    await providerCard.getByRole("button", { name: "Reddet" }).click();
    await providerCard.getByPlaceholder("Açıklama girin...").fill("Y4 testi: bu belge okunaklı değil.");
    await providerCard.getByRole("button", { name: "Gönder" }).click();

    const errorText = await providerCard.locator("p.text-danger").last().textContent();
    check("1. Admin ekranına gerçek hata mesajı gösterildi", errorText?.trim() === STORAGE_WRITE_ERROR_MESSAGE, `metin="${errorText}"`);

    const stillPendingBadgeCount = await providerCard.getByText("İnceleniyor", { exact: true }).count();
    check("2. Belge durumu ESKİ değerine ('İnceleniyor'/pending) geri alındı, kalıcı 'Reddedildi' olmadı", stillPendingBadgeCount > 0, `adet=${stillPendingBadgeCount}`);

    const rawDocsAfterFailure = JSON.parse((await getRawStorage(page, DOCUMENTS_KEY)) || "[]");
    const docAfterFailure = rawDocsAfterFailure.find((d) => d.id === documentId);
    check(
      "2b. localStorage'daki belge kaydı da gerçekten 'pending'e geri alındı",
      docAfterFailure?.reviewStatus === "pending",
      `reviewStatus="${docAfterFailure?.reviewStatus}"`,
    );

    const rawReviewsAfterFailure = await getRawStorage(page, REVIEWS_KEY);
    const reviewsAfterFailure = rawReviewsAfterFailure ? JSON.parse(rawReviewsAfterFailure) : [];
    check(
      "3. Hiçbir günlük (review) satırı oluşmadı",
      reviewsAfterFailure.filter((r) => r.documentId === documentId).length === 0,
      `adet=${reviewsAfterFailure.filter((r) => r.documentId === documentId).length}`,
    );

    console.log(`  (bilgi) ${consoleErrors.length} beklenen console.error (writeJson'ın kendi loglaması + rollback bilgisi)`);
    check("4. Hiçbir uncaught JS hatası (pageerror) oluşmadı", pageErrors.length === 0, pageErrors.join(" | "));

    // === Patch kaldırıldı — aynı işlem yeniden denenip başarıyla tamamlanmalı ===
    await removeThrowingSetItem(page);
    await providerCard.getByRole("button", { name: "Gönder" }).click();
    await assert.doesNotReject(
      providerCard.getByText("Reddedildi", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
    );

    const rawDocsAfterRetry = JSON.parse((await getRawStorage(page, DOCUMENTS_KEY)) || "[]");
    const docAfterRetry = rawDocsAfterRetry.find((d) => d.id === documentId);
    check("5a. Patch kaldırılınca belge durumu gerçekten 'rejected' oldu", docAfterRetry?.reviewStatus === "rejected");

    const rawReviewsAfterRetry = JSON.parse((await getRawStorage(page, REVIEWS_KEY)) || "[]");
    const matchingReviews = rawReviewsAfterRetry.filter((r) => r.documentId === documentId);
    check("5b. Patch kaldırılınca tam olarak 1 günlük satırı yazıldı", matchingReviews.length === 1, `adet=${matchingReviews.length}`);

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[provider-document-review-log-failure-guard-test] GENEL HATA:", error);
  process.exitCode = 1;
});
