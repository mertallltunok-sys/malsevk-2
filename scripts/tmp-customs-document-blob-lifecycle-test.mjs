// Y5 / O6 / O7 düzeltmeleri (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök nedenler (düzeltme öncesi):
//  Y5: job-store.ts#deleteJob yalnızca `existing.photos` blob'larını
//      temizliyordu — Gümrük Müşavirliği evrakları (customsDocuments) hiç
//      silinmiyordu, ilan silindiğinde bu evrakların IndexedDB blob'ları
//      kalıcı olarak sahipsiz (orphan) kalıyordu.
//  O6: job-store.ts#republishJob, customsDocuments'ı `...existing` spread'i
//      üzerinden ESKİ storageKey'lerle olduğu gibi taşıyordu (fotoğraflar
//      gibi YENİ storageKey'lerle kopyalamıyordu) — eski ilan silinince (Y5
//      düzeltmesiyle) yeniden yayınlanan yeni ilanın evrakları da kırılırdı.
//  O7: job-store.ts#updateJob'daki `removedCustomsDocuments` yalnızca
//      `input.keptCustomsDocumentIds`e bakıyordu — kategori Gümrük
//      Müşavirliği'nden BAŞKA bir kategoriye değiştirildiğinde
//      `resolveCustomsBrokerageFields` `customsDocuments`ı sessizce
//      `undefined` yapar, ama form hâlâ eski id'leri "kept" olarak
//      gönderdiği için hiçbir blob silinmiyordu (orphan).
//
// Düzeltmeler: deleteJob artık customsDocuments blob'larını da temizliyor;
// republishJob artık evrakları da bağımsız storageKey'lerle kopyalıyor;
// updateJob artık orphan hesabını `updated.customsDocuments`ın NİHAİ
// (resolveCustomsBrokerageFields sonrası) haliyle karşılaştırarak yapıyor.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 10000 });
}

async function uploadOnePhoto(page) {
  // Metne-bağlı (text-anchored) locator kullanılır — sayfada iki
  // `input[type="file"]` varken (fotoğraf + Gümrük evrakı) salt DOM
  // sırasına güvenen `.first()` bazen yanlış input'u hedefleyebiliyordu.
  const fileInput = page
    .getByText("Fotoğrafları buraya sürükleyin veya dosya seçin.")
    .locator("xpath=following::input[@type='file'][1]");
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
}

async function uploadOneCustomsDocument(page) {
  const fileInput = page.getByText("Destekleyici Evraklar").locator("xpath=following::input[@type='file'][1]");
  await fileInput.setInputFiles({
    name: `evrak-${STAMP}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
}

async function waitForSubmitEnabled(page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 20000 },
  );
}

/** Gümrük Müşavirliği kategorisinde, tek bir destekleyici evrakı olan bir ilan oluşturur. Yayınlanan ilanın id'sini ve evrakın storageKey'ini döndürür. */
async function createGumrukJobWithDocument(page, title) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("gumruk-musavirligi");

  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("Bu ilan Y5/O6/O7 evrak yaşam döngüsü testinin bir parçasıdır, en az yirmi karakter.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-10");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-10");

  await page.getByRole("button", { name: "İşlem Türü", exact: true }).first().click();
  await page.locator('ul[aria-label="İşlem Türü"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İşlem Türü"]').first().getByRole("option").first().click();

  await page.getByLabel("Ürün Cinsi").first().fill("Test Gümrük Ürünü");

  // Gümrük Müşavirliği: sadeleştirilmiş lokasyon (yalnızca İl/İlçe).
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();

  await uploadOneCustomsDocument(page);
  await uploadOnePhoto(page);
  await waitForSubmitEnabled(page);

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });

  const jobId = page.url().split("/").pop();
  const job = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.id === id),
    jobId,
  );
  assert.ok(job, `Oluşturulan ilan (${jobId}) localStorage'da bulunamadı`);
  assert.ok(job.customsDocuments?.length === 1, `Beklenen 1 customsDocuments, bulunan: ${job.customsDocuments?.length}`);
  return { jobId, storageKey: job.customsDocuments[0].storageKey };
}

/** IndexedDB'de (malsevk-photo-blobs / blobs) belirtilen anahtarın gerçekten var olup olmadığını kontrol eder. */
async function blobExists(page, storageKey) {
  return page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("malsevk-photo-blobs", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("blobs", "readonly");
          const getRequest = tx.objectStore("blobs").get(key);
          getRequest.onsuccess = () => {
            resolve(getRequest.result !== undefined);
            db.close();
          };
          getRequest.onerror = () => {
            reject(getRequest.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    storageKey,
  );
}

/** IndexedDB'den (malsevk-photo-blobs / blobs) belirtilen anahtarı doğrudan siler — photo-blob-store.ts#deletePhotoBlob ile AYNI işlemi tarayıcı context'inde tekrarlar. */
async function blobDelete(page, storageKey) {
  await page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("malsevk-photo-blobs", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("blobs", "readwrite");
          tx.objectStore("blobs").delete(key);
          tx.oncomplete = () => {
            resolve();
            db.close();
          };
          tx.onerror = () => {
            reject(tx.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    storageKey,
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");

    // ===================== Y5: silme evrak blob'unu da temizliyor =====================
    console.log("\n=== Y5: İlan silinince customsDocuments blob'u da temizleniyor ===");
    const y5 = await createGumrukJobWithDocument(page, `Y5-DELETE-TEST-${STAMP}`);
    check("Y5 kurulum: evrak blob'u başlangıçta gerçekten var", await blobExists(page, y5.storageKey));

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const y5Card = page.locator("li", { hasText: `Y5-DELETE-TEST-${STAMP}` });
    await y5Card.getByRole("button", { name: "İlanı Sil" }).click();
    await page.getByRole("button", { name: "Evet, İlanı Sil" }).click();
    await y5Card.waitFor({ state: "detached", timeout: 10000 });
    check("Y5: İlan silindi, blob artık IndexedDB'de YOK", !(await blobExists(page, y5.storageKey)));

    // ===================== O6: yeniden yayınlama evrakı bağımsız kopyalıyor =====================
    console.log("\n=== O6: Yeniden yayınlama evrakı YENİ storageKey ile kopyalıyor ===");
    const o6 = await createGumrukJobWithDocument(page, `O6-REPUBLISH-TEST-${STAMP}`);
    // Süresi dolmuş say (gerçek 14 gün beklemeden) — publish-window.ts'in
    // tek doğruluk kaynağı olan createdAt/publishEndAt alanlarını doğrudan
    // geçmişe çekiyoruz (tmp-job-publish-window-test.mjs ile AYNI teknik).
    await page.evaluate((id) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const past = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const next = jobs.map((j) => (j.id === id ? { ...j, createdAt: past, publishEndAt: pastEnd } : j));
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(next));
    }, o6.jobId);

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=suresi-dolmus`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const o6Card = page.locator("li", { hasText: `O6-REPUBLISH-TEST-${STAMP}` });
    await o6Card.waitFor({ state: "visible", timeout: 10000 });
    await o6Card.getByRole("button", { name: "Yeniden Yayınla" }).click();
    await page.getByLabel("Başlangıç Tarihi").fill("2026-09-01");
    await page.getByLabel("Bitiş Tarihi").fill("2026-09-01");
    await page.getByRole("button", { name: "Yeniden Yayınla" }).last().click();
    await page.getByText("Yeniden Yayınlandı").first().waitFor({ state: "visible", timeout: 10000 });

    const republishedJobs = await page.evaluate((oldId) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const oldJob = jobs.find((j) => j.id === oldId);
      const newJob = jobs.find((j) => j.republishedFromJobId === oldId);
      return { oldJob, newJob };
    }, o6.jobId);
    const newStorageKey = republishedJobs.newJob?.customsDocuments?.[0]?.storageKey;
    check(
      "O6: Yeni ilanın evrakı FARKLI bir storageKey taşıyor (eskiyle paylaşılmıyor)",
      Boolean(newStorageKey) && newStorageKey !== y5.storageKey && newStorageKey !== o6.storageKey,
      `eski=${o6.storageKey}, yeni=${newStorageKey}`,
    );
    check("O6: Yeni ilanın evrak blob'u gerçekten var", Boolean(newStorageKey) && (await blobExists(page, newStorageKey)));

    // NOT: "Kalıcı Olarak Sil" butonu, bir ilan yeniden yayınlandıktan SONRA
    // ExpiredJobRequestCard'da artık HİÇ gösterilmiyor (ayrı, önceden var
    // olan bir koruma — bkz. job-requests-panel.tsx: alreadyRepublished ise
    // aksiyon butonları tamamen kalkıyor, yalnızca "Yeniden Yayınlandı" notu
    // kalıyor). Yani gerçek arayüzden artık zaten yeniden yayınlanmış eski
    // bir ilan bir daha hiç silinemiyor. O6 düzeltmesinin asıl doğrulamak
    // istediği ("eski ilanın blob'u silinirse yeni ilanın evrakı kırılmasın")
    // özelliğini, deleteJob'un GERÇEKTEN yapacağı işlemi (kayıt + blob
    // silme) doğrudan simüle ederek test ediyoruz — Y5 düzeltmesi zaten
    // ayrı ayrı, gerçek "İlanı Sil" akışıyla doğrulandı (yukarıda).
    await page.evaluate(
      (id) => {
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs.filter((j) => j.id !== id)));
      },
      o6.jobId,
    );
    await blobDelete(page, o6.storageKey);
    check("O6: Eski ilanın kendi evrak blob'u silindi", !(await blobExists(page, o6.storageKey)));
    check(
      "O6 (asıl regresyon): Eski ilan silindikten SONRA yeni (yeniden yayınlanan) ilanın evrak blob'u hâlâ SAĞLAM",
      await blobExists(page, newStorageKey),
    );

    // ===================== O7: kategori değişince evrak orphan kalmıyor =====================
    console.log("\n=== O7: Kategori Gümrük Müşavirliği'nden başka kategoriye değişince evrak blob'u temizleniyor ===");
    const o7 = await createGumrukJobWithDocument(page, `O7-CATEGORY-CHANGE-TEST-${STAMP}`);
    check("O7 kurulum: evrak blob'u başlangıçta gerçekten var", await blobExists(page, o7.storageKey));

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${o7.jobId}/duzenle`);
    await page.getByLabel("Hizmet Kategorisi").waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Hizmet Kategorisi").selectOption("kapali-depolama");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForURL(/guncellendi=1/, { timeout: 15000 });

    const o7JobAfter = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.id === id),
      o7.jobId,
    );
    check(
      "O7: Kaydedilen ilanda customsDocuments artık yok (kategori değişti)",
      !o7JobAfter?.customsDocuments || o7JobAfter.customsDocuments.length === 0,
    );
    check(
      "O7 (asıl regresyon): Eski evrak blob'u artık IndexedDB'de YOK (orphan kalmadı)",
      !(await blobExists(page, o7.storageKey)),
    );

    check("Hiçbir uncaught JS hatası oluşmadı", jsErrors.length === 0, jsErrors.join(" | "));

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[customs-document-blob-lifecycle-test] GENEL HATA:", error);
  process.exitCode = 1;
});
