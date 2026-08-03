// B1 düzeltmesinin doğrulaması (Production Öncesi Teknik Denetim raporu):
// "localStorage yazma hatalarının bazı kritik akışlarda sessizce yutulması
// ve UI'ın işlem başarılı olmuş gibi davranabilmesi".
//
// Kök neden: app/_lib/local-storage.ts#writeJson `localStorage.setItem`i
// try/catch içine alıp hatayı YUTUYOR, her zaman `void` dönüyordu — çağıran
// hiçbir iş fonksiyonu yazmanın başarısız olduğunu ASLA öğrenemiyordu.
// app/_lib/offers.ts#writeAllOffers ve app/_lib/session.ts#setSession/
// clearSession ise try/catch'i HİÇ KULLANMIYORDU — bir exception KONTROLSÜZ
// biçimde çağıran onClick handler'ından yukarı fırlıyordu.
//
// Bu script, GERÇEK tarayıcı ortamında `Storage.prototype.setItem`i HEDEF
// bir anahtar için kontrollü olarak exception fırlatacak şekilde patch'leyip
// (fonksiyon mocklanmadan; gerçek UI/iş akışları kullanılarak) şu kritik
// akışları uçtan uca doğrular:
//   - Kullanıcı kaydı (users.ts#registerUser, malsevk.users.v1)
//   - Oturum açma/current-user yazımı (session.ts#setSession, malsevk.session.v1)
//   - İlan düzenleme (job-store.ts#updateJob, malsevk.jobs.v1)
//   - Teklif oluşturma (offers.ts#createOffer, malsevk.offers.v1)
//   - Bildirim gizleme (notification-dismissals.ts#dismissNotification)
//   - Teklif kabulü (offers.ts#updateOfferStatus, malsevk.offers.v1)
//   - İşi başlatma (offers.ts#startWorkForOffer, malsevk.offers.v1)
//
// Her senaryoda: (1) yazma başarısız olduğunda merkezi hata metni
// ("İşlem kaydedilemedi. Tarayıcı depolama alanını kontrol edip tekrar
// deneyin.") role="alert" ile gösterilir, (2) hiçbir başarı
// bildirimi/yönlendirme/durum değişikliği oluşmaz, (3) localStorage
// GERÇEKTEN değişmemiştir (snapshot karşılaştırması), (4) hiçbir uncaught
// JS hatası (page "pageerror" olayı) üretilmez — ÖNCEDEN session.ts/
// offers.ts'te try/catch olmadığı için bu tam olarak uncaught bir exception
// üretiyordu, (5) patch kaldırıldıktan sonra AYNI işlem hemen yeniden
// denenip başarıyla tamamlanır.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STORAGE_WRITE_ERROR_MESSAGE =
  "İşlem kaydedilemedi. Tarayıcı depolama alanını kontrol edip tekrar deneyin.";

let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

/** GERÇEK localStorage.setItem'ı yalnızca `matchKey` için exception fırlatacak şekilde patch'ler — başka hiçbir anahtarın yazımını etkilemez. Fonksiyon mocklanmaz, gerçek Storage API'si değiştirilir. */
async function installThrowingSetItem(page, matchKey) {
  await page.evaluate((key) => {
    if (window.__origSetItem) throw new Error("Test hatası: patch zaten kurulu, önce kaldırılmalı");
    window.__origSetItem = Storage.prototype.setItem;
    window.__throwKey = key;
    Storage.prototype.setItem = function (k, v) {
      if (k === window.__throwKey) {
        throw new DOMException("Simulated storage failure (B1 test)", "QuotaExceededError");
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

async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function getRawStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

let phoneCounter = 9990001;
function freshPhone() {
  phoneCounter += 1;
  return `+90555${phoneCounter}`;
}
function freshEmail(tag) {
  return `b1-storage-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

const CATEGORY_ID = "genel-depolama";
const JOB_ID = `b1-storage-job-${Date.now()}`;
const JOB_TITLE_ORIGINAL = "B1 Depolama Testi - Orijinal Başlık";
const JOB_TITLE_UPDATED = "B1 Depolama Testi - Güncellenmiş Başlık";
const OFFER_DESCRIPTION_MARKER =
  "B1-STORAGE-TEST-MARKER-TEKLIF-ACIKLAMASI-benzersiz-tanimlayici-metin";

/** tmp-job-edit-work-date-range-test.mjs'teki desenin AYNISI: fotoğraf yükleme UI'sini atlayıp doğrudan IndexedDB + localStorage'a bir ilan yazar — bu script'in odağı iş kuralları değil B1 yazma-hatası davranışı olduğu için gerçek fotoğraf yükleme akışını tekrar sürmeye gerek yok. */
async function seedJob(page, requesterId) {
  await page.evaluate(
    async ({ reqId, jobId, title, categoryId }) => {
      function openDb() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open("malsevk-photo-blobs", 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      function putBlob(db, key, blob) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction("blobs", "readwrite");
          tx.objectStore("blobs").put(blob, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      function makeBlob() {
        return new Promise((resolve) => {
          const canvas = document.createElement("canvas");
          canvas.width = 20;
          canvas.height = 20;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#2f6690";
          ctx.fillRect(0, 0, 20, 20);
          canvas.toBlob((blob) => resolve(blob), "image/png");
        });
      }
      const db = await openDb();
      const storageKey = `${jobId}-photo-0`;
      const blob = await makeBlob();
      await putBlob(db, storageKey, blob);
      db.close();
      const job = {
        id: jobId,
        title,
        category: categoryId,
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-09-01",
        workEndDate: "2026-09-05",
        description: "B1 depolama yazma hatası testi icin ilan aciklamasi metni.",
        operationDetails: "Test operasyon detayi, on karakterden uzun metin.",
        addressText: "Test adres bilgisi, en az on karakter uzunlugunda metin.",
        status: "yayinda",
        requesterId: reqId,
        photos: [{ id: `${jobId}-photo-id-0`, order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey }],
      };
      const existingRaw = localStorage.getItem("malsevk.jobs.v1");
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing, job]));
    },
    { reqId: requesterId, jobId: JOB_ID, title: JOB_TITLE_ORIGINAL, categoryId: CATEGORY_ID },
  );
}

async function getJob(page, jobId) {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.id === id),
    jobId,
  );
}

async function getOffersForJob(page, jobId) {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId === id),
    jobId,
  );
}

let browser;

async function main() {
  browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  // MALSEVK'in gerçek backend'i yok — Zeynep/Mert AYNI orijinin (localhost:3000)
  // AYNI localStorage tablolarını (malsevk.users/jobs/offers.v1) paylaşır,
  // yalnızca malsevk.session.v1 hangi kullanıcının "giriş yapmış" sayıldığını
  // belirler (bkz. CLAUDE.md "No real backend"). Bu yüzden burada TEK bir
  // context/page kullanılır ve roller arası geçiş `loginAs` ile yapılır —
  // AYRI browser context'leri (ilk denemede kullanılmıştı) birbirinden
  // TAMAMEN izole localStorage'a sahip olduğu için Zeynep'in oluşturduğu
  // ilan Mert'in context'inde hiç görünmezdi; bu, gerçek bir hata değil, test
  // kurulumunun bu tek-localStorage mimarisini yanlış modellemesiydi.
  //
  // reducedMotion: notification-dismissals.tsx onDismiss'i use-dismiss-animation.ts
  // aracılığıyla tetikler — bu hook prefers-reduced-motion altında animasyonu
  // ATLAYIP callback'i HEMEN çağırır (bkz. CLAUDE.md), testin deterministik
  // olması için bu şart.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleErrorTexts = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrorTexts.push(msg.text());
  });

  // ================= Senaryo 1: Kullanıcı kaydı yazımı başarısız =================
  const regEmail = freshEmail("register");
  const regPhone = freshPhone();
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  await page.getByLabel("Ad", { exact: true }).fill("B1Test");
  await page.getByLabel("Soyad", { exact: true }).fill("Kayit");
  await page.getByLabel("E-posta", { exact: true }).fill(regEmail);
  await page.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page.getByLabel("Telefon Numarası", { exact: true }).fill(regPhone);
  await page.getByLabel("Firma Adı", { exact: true }).fill("B1 Test Firması");
  await page.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ index: 1 });
  const provinceFieldId = await page.getByLabel("İl", { exact: true }).getAttribute("id");
  await selectSearchable(page, provinceFieldId, "Kocaeli");
  const districtFieldId = await page.getByLabel("İlçe", { exact: true }).getAttribute("id");
  await selectSearchable(page, districtFieldId, "Dilovası");
  await page.getByLabel("Şifre", { exact: true }).fill("GucluSifre1!");
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill("GucluSifre1!");
  await page.locator('form input[type="checkbox"]').check();

  const usersBeforeRaw = await getRawStorage(page, "malsevk.users.v1");
  await installThrowingSetItem(page, "malsevk.users.v1");
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  // Next.js'in kendi route-announcer'ı (`#__next-route-announcer__`) da
  // role="alert" taşıdığı için sayfa-geneli `getByRole("alert")` iki eleman
  // döndürebiliyor — beklenen metne göre filtreleyerek tekil hâle getirilir.
  const regAlert = page.getByRole("alert").filter({ hasText: STORAGE_WRITE_ERROR_MESSAGE });
  await regAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await regAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "Yazma hatasında merkezi, teknik-detaysız hata metni gösterilmeli");
  ok("[Senaryo 1] Kayıt sırasında setItem exception fırlatınca merkezi hata mesajı gösterildi (ham exception/stack DEĞİL)");

  const usersAfterFail = await page.evaluate((email) => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]").some((u) => u.email === email), regEmail);
  assert.equal(usersAfterFail, false, "Yazma başarısız olduğunda kullanıcı oluşmuş SAYILMAMALI");
  const usersAfterFailRaw = await getRawStorage(page, "malsevk.users.v1");
  assert.equal(usersAfterFailRaw, usersBeforeRaw, "malsevk.users.v1 BAYT BAYT değişmemiş olmalı (kısmi yazım yok)");
  ok("[Senaryo 1] localStorage snapshot'ı yazma öncesiyle bayt bayt aynı — kısmi/hayalet kullanıcı oluşmadı");
  // Hâlâ kayıt (kayit) sekmesinde olmalı, Giriş Yap'a otomatik geçiş YAPILMAMALI.
  assert.equal(await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).getAttribute("aria-selected"), "true", "Başarısız kayıtta Giriş Yap sekmesine geçilmemeli");
  ok("[Senaryo 1] Başarısız kayıtta sekme geçişi/form sıfırlama gibi 'başarı' davranışları oluşmadı");

  await removeThrowingSetItem(page);
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const usersAfterRetry = await page.evaluate((email) => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]").some((u) => u.email === email), regEmail);
  assert.equal(usersAfterRetry, true, "Yazma hatası kaldırıldıktan sonra AYNI form yeniden gönderilince kullanıcı başarıyla oluşmalı");
  ok("[Senaryo 1 - retry] Yazma hatası kaldırılınca kullanıcı hemen yeniden denenip başarıyla oluşturuldu");

  // ================= Senaryo 2 (bu koda uyarlanmış): oturum yazımı başarısız =================
  // Not: bu kod tabanında KAYIT oturum otomatik AÇMAZ (bkz. CLAUDE.md/
  // login-form.tsx) — bu yüzden "kayıt sonrası oturum yazılmamalı" senaryosu
  // mimari olarak zaten geçerli (registerUser hiç setSession çağırmaz).
  // Görev maddesinin gerçek karşılığı GİRİŞ akışıdır: session.ts#setSession
  // başarısız olursa yönlendirme YAPILMAMALI, oturum anahtarı yazılmamalı.
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent("/panel")}`);
  await page.locator('input[type="email"]').fill(regEmail);
  await page.locator('input[type="password"]').fill("GucluSifre1!");
  const sessionBeforeRaw = await getRawStorage(page, "malsevk.session.v1");
  assert.equal(sessionBeforeRaw, null, "Ön koşul: bu sayfada henüz oturum yazılmamış olmalı");
  await installThrowingSetItem(page, "malsevk.session.v1");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  const loginAlert = page.getByRole("alert").filter({ hasText: STORAGE_WRITE_ERROR_MESSAGE });
  await loginAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await loginAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "Oturum yazımı başarısız olunca merkezi hata mesajı gösterilmeli");
  assert.equal(page.url(), `${BASE_URL}/giris-yap?redirect=%2Fpanel`, "Oturum yazılamazsa /panel'e YÖNLENDİRME yapılmamalı");
  const sessionAfterFail = await getRawStorage(page, "malsevk.session.v1");
  assert.equal(sessionAfterFail, null, "Oturum yazımı başarısız olunca malsevk.session.v1 HİÇ yazılmamış olmalı");
  ok("[Senaryo 2] setSession başarısız olunca: yönlendirme yapılmadı, oturum anahtarı hiç yazılmadı, kullanıcıya anlaşılır hata gösterildi");

  await removeThrowingSetItem(page);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
  ok("[Senaryo 2 - retry] Yazma hatası kaldırılınca AYNI giriş formu hemen yeniden denenip oturum başarıyla açıldı");

  // ================= Kurulum: Zeynep (hizmet-alan) + Mert (hizmet-veren) =================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, zeynepId);
  ok("Kurulum: Zeynep için 1 test ilanı (foto dahil, IndexedDB+localStorage'a doğrudan yazılarak) oluşturuldu");

  // ================= Senaryo 3: İlan düzenleme yazımı başarısız =================
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${JOB_ID}/duzenle`);
  await page.getByLabel("İlan Başlığı", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const jobBeforeEdit = await getJob(page, JOB_ID);
  await page.getByLabel("İlan Başlığı", { exact: true }).fill(JOB_TITLE_UPDATED);
  await installThrowingSetItem(page, "malsevk.jobs.v1");
  await page.getByRole("button", { name: "Kaydet" }).click();
  const editAlert = page.getByRole("alert").filter({ hasText: STORAGE_WRITE_ERROR_MESSAGE });
  await editAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await editAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "İlan düzenleme yazımı başarısız olunca merkezi hata mesajı gösterilmeli");
  assert.ok(page.url().includes("/duzenle"), "Yazma başarısız olunca düzenleme sayfasından AYRILINMAMALI (?guncellendi=1'e yönlendirme yok)");
  const jobAfterFail = await getJob(page, JOB_ID);
  assert.deepEqual(jobAfterFail, jobBeforeEdit, "Yazma başarısız olunca Job kaydı (fotoğraflar dahil) BAYT BAYT eskisiyle aynı kalmalı — eski başlık korunmalı");
  assert.equal(jobAfterFail.title, JOB_TITLE_ORIGINAL, "Eski başlık korunmalı, YENİ başlık kaydedilmemiş olmalı");
  ok("[Senaryo 3] updateJob yazımı başarısız olunca: eski Job verisi bayt bayt korundu, başarı gösterilmedi, sayfadan ayrılınmadı");

  await removeThrowingSetItem(page);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  const jobAfterRetry = await getJob(page, JOB_ID);
  assert.equal(jobAfterRetry.title, JOB_TITLE_UPDATED, "Yazma hatası kaldırılınca AYNI düzenleme yeniden denenip başarıyla kaydedilmeli");
  ok("[Senaryo 3 - retry] Yazma hatası kaldırılınca ilan düzenleme hemen yeniden denenip başarıyla tamamlandı");

  // ================= Senaryo 4: Teklif oluşturma yazımı başarısız =================
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
  await page.getByLabel("Teklif Fiyatı", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı", { exact: true }).fill("12500");
  await page.getByLabel("Teklif Açıklaması", { exact: true }).fill(OFFER_DESCRIPTION_MARKER);
  // DÜZELTME (Y7, veritabanı geçişi öncesi denetim): eski "Tahmini Hizmet
  // Süresi" serbest-metin alanı kaldırıldı; yerine gelen "Tamamlanması
  // Taahhüt Edilen Gün" (bir <select>, offer-form.tsx) yalnızca Nakliye
  // kategorisindeki ilanlarda render edilir (bkz. offer-form.tsx#
  // requiresEstimatedDuration = isTransportationCategory(job.category)).
  // Bu senaryonun ilanı Depolama (CATEGORY_ID = "genel-depolama") olduğu
  // için bu alan hiç render EDİLMEZ — doldurulmaya çalışılmamalı.

  const offersBeforeRaw = await getRawStorage(page, "malsevk.offers.v1");
  await installThrowingSetItem(page, "malsevk.offers.v1");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  const offerAlert = page.getByRole("alert").filter({ hasText: STORAGE_WRITE_ERROR_MESSAGE });
  await offerAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await offerAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "Teklif oluşturma yazımı başarısız olunca merkezi hata mesajı gösterilmeli");
  const offersAfterFail = await getOffersForJob(page, JOB_ID);
  assert.equal(offersAfterFail.length, 0, "Yazma başarısız olduğunda teklif oluşmuş SAYILMAMALI");
  assert.equal(await getRawStorage(page, "malsevk.offers.v1"), offersBeforeRaw, "malsevk.offers.v1 BAYT BAYT değişmemiş olmalı");
  ok("[Senaryo 4] createOffer yazımı başarısız olunca: teklif oluşmadı, hata gösterildi, localStorage değişmedi");

  await removeThrowingSetItem(page);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Verdiğim Teklifler'i görüntüle", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const offersAfterRetry = await getOffersForJob(page, JOB_ID);
  assert.equal(offersAfterRetry.length, 1, "Yazma hatası kaldırılınca AYNI teklif formu yeniden gönderilince teklif başarıyla oluşmalı");
  assert.equal(offersAfterRetry[0].status, "pending", "Yeni oluşan teklif 'pending' durumunda olmalı");
  const offerId = offersAfterRetry[0].id;
  ok("[Senaryo 4 - retry] Yazma hatası kaldırılınca teklif hemen yeniden gönderilip başarıyla oluşturuldu");

  // ================= Senaryo (Bildirim gizleme) yazımı başarısız =================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/bildirimler`);
  const newOfferNotificationText = `İlanınıza yeni teklif geldi: ${JOB_TITLE_UPDATED}`;
  const notifRow = page.locator("li", { hasText: newOfferNotificationText });
  await notifRow.waitFor({ state: "visible", timeout: 10000 });
  ok("Kurulum: Zeynep'in bildirimler ekranında yeni teklif bildirimi göründü");

  const dismissedKey = `malsevk_dismissed_notifications_${zeynepId}`;
  const dismissedBeforeRaw = await getRawStorage(page, dismissedKey);
  await installThrowingSetItem(page, dismissedKey);
  await notifRow.getByRole("button", { name: "Bildirimi sil" }).click();
  // Silme yazımı başarısız olduğunda notify() hiç tetiklenmeyip önbellek
  // güncellenmediği için satır DOM'da KALMALI (dismissNotification içindeki
  // writeIds sessizce başarısız olup UI'a kalıcı başarı yansıtmamalı).
  await page.waitForTimeout(300);
  await assert.doesNotReject(notifRow.waitFor({ state: "visible", timeout: 2000 }), "Bildirim gizleme yazımı başarısız olunca satır DOM'da kalmalı (kalıcı başarı varsayılmamalı)");
  assert.equal(await getRawStorage(page, dismissedKey), dismissedBeforeRaw, "Gizlenen bildirim anahtarı BAYT BAYT değişmemiş olmalı");
  await page.reload();
  await page.locator("li", { hasText: newOfferNotificationText }).waitFor({ state: "visible", timeout: 10000 });
  ok("[Bildirim gizleme] writeIds başarısız olunca: bildirim sayfa yenilendikten SONRA DA geri geldi — UI kalıcı başarı varsaymadı");

  await removeThrowingSetItem(page);
  await page.locator("li", { hasText: newOfferNotificationText }).getByRole("button", { name: "Bildirimi sil" }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await assert.rejects(
    page.locator("li", { hasText: newOfferNotificationText }).waitFor({ state: "visible", timeout: 3000 }),
    "Yazma hatası kaldırılınca AYNI bildirim yeniden gizlenince sayfa yenilense bile geri GELMEMELİ",
  );
  ok("[Bildirim gizleme - retry] Yazma hatası kaldırılınca gizleme hemen yeniden denenip kalıcı olarak başarıyla tamamlandı");

  // ================= Senaryo 5: Teklif kabulü yazımı başarısız =================
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  // incoming-offer-category-section.tsx'in kendi kategori/ilan grubu sarmalayıcısı
  // (bir <section>) da .rounded-card taşıdığı için düz ".rounded-card" seçici
  // iki eşleşme döndürüyor — asıl teklif kartı (bir <div>) daha spesifik sınıf
  // kombinasyonuyla (incoming-offer-card.tsx'in kendi className'i) ayrıştırılır.
  const offerCard = page.locator("div.rounded-card.border.bg-surface.p-6", { hasText: OFFER_DESCRIPTION_MARKER });
  await offerCard.waitFor({ state: "visible", timeout: 10000 });

  await installThrowingSetItem(page, "malsevk.offers.v1");
  await offerCard.getByRole("button", { name: "Kabul Et" }).click();
  const acceptAlert = offerCard.getByRole("alert");
  await acceptAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await acceptAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "Teklif kabulü yazımı başarısız olunca merkezi hata mesajı gösterilmeli");
  const offerAfterAcceptFail = (await getOffersForJob(page, JOB_ID)).find((o) => o.id === offerId);
  assert.equal(offerAfterAcceptFail.status, "pending", "Yazma başarısız olduğunda teklif 'pending' KALMALI, 'accepted' olmamalı");
  ok("[Senaryo 5] updateOfferStatus(accepted) yazımı başarısız olunca teklif 'pending' kaldı, hata gösterildi");

  // Yan etki kontrolü: Mert'in "teklif kabul edildi" bildirimi OLUŞMAMALI
  // (bildirimler doğrudan Offer.status'tan türetildiği için status hâlâ
  // "pending" olduğundan bu kontrol otomatik sağlanır — ek doğrulama olarak
  // Mert'in bildirimler ekranında bu metnin GÖRÜNMEDİĞİni de kontrol ediyoruz).
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/bildirimler`);
  const acceptedNotifBody = await page.locator("body").innerText();
  assert.ok(!acceptedNotifBody.includes("Hizmet Alan teklifinizi kabul etti."), "Kabul başarısız olduğu için Mert'e 'teklifiniz kabul edildi' bildirimi OLUŞMAMALI (yan etki tetiklenmemeli)");
  ok("[Senaryo 5] Kabul yazımı başarısız olduğu için karşı tarafta ikincil bildirim yan etkisi de OLUŞMADI");
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await offerCard.waitFor({ state: "visible", timeout: 10000 });

  await offerCard.getByRole("button", { name: "Kabul Et" }).click();
  await offerCard.getByRole("button", { name: "İşe Başlandı" }).waitFor({ state: "visible", timeout: 10000 });
  const offerAfterAcceptRetry = (await getOffersForJob(page, JOB_ID)).find((o) => o.id === offerId);
  assert.equal(offerAfterAcceptRetry.status, "accepted", "Yazma hatası kaldırılınca AYNI kabul işlemi yeniden denenip başarıyla tamamlanmalı");
  ok("[Senaryo 5 - retry] Yazma hatası kaldırılınca teklif kabulü hemen yeniden denenip başarıyla tamamlandı");

  // ================= Senaryo 6: İşi başlatma yazımı başarısız =================
  await offerCard.getByRole("button", { name: "İşe Başlandı" }).click();
  await page.getByRole("heading", { name: "İşi Başlat" }).waitFor({ state: "visible", timeout: 5000 });

  await installThrowingSetItem(page, "malsevk.offers.v1");
  await page.getByRole("button", { name: "Evet, İşi Başlat" }).click();
  const startWorkAlert = page.getByRole("alert").filter({ hasText: STORAGE_WRITE_ERROR_MESSAGE });
  await startWorkAlert.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await startWorkAlert.innerText(), STORAGE_WRITE_ERROR_MESSAGE, "İşi başlatma yazımı başarısız olunca merkezi hata mesajı gösterilmeli");
  const offerAfterStartFail = (await getOffersForJob(page, JOB_ID)).find((o) => o.id === offerId);
  assert.equal(offerAfterStartFail.status, "accepted", "Yazma başarısız olduğunda durum 'accepted' olarak KALMALI, 'in_progress' olmamalı");
  await page.getByRole("heading", { name: "İşi Başlat" }).waitFor({ state: "visible", timeout: 2000 });
  ok("[Senaryo 6] startWorkForOffer yazımı başarısız olunca: durum 'accepted' olarak kaldı, onay diyaloğu açık kaldı, hata gösterildi");

  await removeThrowingSetItem(page);
  await page.getByRole("button", { name: "Evet, İşi Başlat" }).click();
  await assert.rejects(
    page.getByRole("heading", { name: "İşi Başlat" }).waitFor({ state: "visible", timeout: 3000 }),
    "Başarılı işe başlatmada onay diyaloğu KAPANMALI",
  );
  const offerAfterStartRetry = (await getOffersForJob(page, JOB_ID)).find((o) => o.id === offerId);
  assert.equal(offerAfterStartRetry.status, "in_progress", "Yazma hatası kaldırılınca AYNI işlem yeniden denenip başarıyla tamamlanmalı");
  ok("[Senaryo 6 - retry] Yazma hatası kaldırılınca işi başlatma hemen yeniden denenip başarıyla tamamlandı");

  // ================= Genel doğrulama: hiçbir uncaught JS hatası (pageerror) üretilmedi =================
  console.log(`\n[storage-write-failure-guard-test] Konsol console.error mesajları (BEKLENEN — her simüle edilen senaryoda yazma hatası merkezi noktada loglanmalı): ${consoleErrorTexts.length} adet.`);
  for (const text of consoleErrorTexts) console.log(`  (beklenen log) ${text}`);
  assert.equal(pageErrors.length, 0, `HİÇBİR uncaught JS hatası (pageerror) OLUŞMAMALI — ÖNCEDEN (düzeltme öncesi) session.ts/offers.ts try/catch kullanmadığı için bu senaryolar tam olarak uncaught exception üretiyordu. Yakalanan: ${JSON.stringify(pageErrors)}`);
  ok("[Genel] Hiçbir simüle edilmiş senaryoda uncaught JS hatası (pageerror) oluşmadı — tüm hatalar kontrollü biçimde yakalandı");

  console.log(`\n[storage-write-failure-guard-test] ${passed} test geçti.`);
  console.log("(Not: bu script users.v1/jobs.v1/offers.v1/notification-dismissals'a kalıcı test verisi biriktirir — mevcut tmp-*.mjs desenlerinin izlediği kabul edilmiş yaklaşımın aynısı, temizlik yapılmaz.)");

  await page.close();
  await context.close();
}

main().catch((error) => {
  console.error("[storage-write-failure-guard-test] HATA:", error);
  process.exitCode = 1;
});
