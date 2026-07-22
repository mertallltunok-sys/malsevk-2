// Demo veri sıfırlama aracının (/gelistirme/demo-veri-sifirla) testi
// (SENARYO 9-10): yalnızca demo hesaplara ait ilan/teklif/bildirim/fotoğraf
// verileri silinir; gerçek kullanıcı verileri ve demo hesap girişleri
// korunur.
// Ön koşul: `npm run dev` (http://localhost:3000).
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
async function register(page, { name, email, phone, password, role }) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=/panel`);
  await page.locator('input[type="text"][autocomplete="name"]').fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.getByRole("radio", { name: role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}/panel`);
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
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function seedJob(page, { id, title, reqId }) {
  await page.evaluate(
    ({ id, title, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Demo veri sifirlama testi icin olusturulan ilan.",
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

/** D3'e 2 fotoğraf ekler (IndexedDB blob + Job.photos kaydı) — fotoğraf temizliğini test etmek için. */
async function seedJobWithPhotos(page, { id, title, reqId }) {
  await page.evaluate(
    async ({ id, title, reqId }) => {
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
      function makeBlob(color) {
        return new Promise((resolve) => {
          const canvas = document.createElement("canvas");
          canvas.width = 20;
          canvas.height = 20;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 20, 20);
          canvas.toBlob((blob) => resolve(blob), "image/png");
        });
      }
      const db = await openDb();
      const photos = [];
      const colors = ["#1e3a5f", "#2f6690"];
      for (let i = 0; i < 2; i++) {
        const storageKey = `demo-reset-test-photo-${i}`;
        const blob = await makeBlob(colors[i]);
        await putBlob(db, storageKey, blob);
        photos.push({ id: `demo-reset-photo-id-${i}`, order: i, fileName: `foto-${i}.png`, fileSize: blob.size, mimeType: "image/png", storageKey });
      }
      db.close();
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Fotografli demo ilan, sifirlama testi icin.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos,
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId },
  );
}

async function photoBlobExists(page, key) {
  return page.evaluate((key) => {
    return new Promise((resolve) => {
      const req = indexedDB.open("malsevk-photo-blobs", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("blobs", "readonly");
        const getReq = tx.objectStore("blobs").get(key);
        getReq.onsuccess = () => resolve(getReq.result !== undefined);
        getReq.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    });
  }, key);
}

const D1 = { id: "reset-demo-job-1", title: "Sıfırlama Testi - Withdrawn" };
const D2 = { id: "reset-demo-job-2", title: "Sıfırlama Testi - Accepted" };
const D3 = { id: "reset-demo-job-3", title: "Sıfırlama Testi - Fotoğraflı" };
const R1 = { id: "reset-demo-real-job", title: "Gerçek Kullanıcı İlanı - Sıfırlanmamalı" };
const REAL_ALAN = { name: "Ayşe Gerçek", email: "ayse.gercek.demoreset@test.com", phone: "0555 700 70 01", password: "AyseGercek1!", role: "hizmet-alan" };
const REAL_VEREN = { name: "Deniz Gerçek", email: "deniz.gercek.demoreset@test.com", phone: "0555 700 70 02", password: "DenizGercek1!", role: "hizmet-veren" };

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Kurulum: gerçek (demo olmayan) kullanıcılar + ilan + teklif ---
  await register(page, REAL_ALAN);
  const realAlanId = await getUserId(page, REAL_ALAN.email);
  await seedJob(page, { id: R1.id, title: R1.title, reqId: realAlanId });
  ok("Kurulum: gerçek (demo olmayan) Hizmet Alan ve ilanı oluşturuldu");
  await logout(page);

  await register(page, REAL_VEREN);
  await submitOffer(page, R1.id, { amount: "7000", duration: "3 gün", description: "Gercek kullanicinin gercek ilanina verdigi teklif, korunmali." });
  ok("Kurulum: gerçek (demo olmayan) Hizmet Veren, gerçek ilana teklif verdi");
  await logout(page);

  // --- Kurulum: demo hesaplarla ilişkili veriler ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { id: D1.id, title: D1.title, reqId: zeynepId });
  await seedJob(page, { id: D2.id, title: D2.title, reqId: zeynepId });
  await seedJobWithPhotos(page, { id: D3.id, title: D3.title, reqId: zeynepId });
  ok("Kurulum: Zeynep'e (demo) ait 3 ilan oluşturuldu (biri 2 fotoğraflı)");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, D1.id, { amount: "4000", duration: "1 gün", description: "Mert D1 icin teklif verdi, sonra geri cekecek." });
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.getByRole("button", { name: "Tekliften Vazgeç", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Teklifi Geri Çek" }).click();
  await page.getByText("Geri Çekildi", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  // Mert (demo), gerçek kullanıcının ilanına da teklif verdi.
  await submitOffer(page, R1.id, { amount: "6800", duration: "2 gün", description: "Demo Hizmet Veren gercek ilana da teklif verdi, bu teklif silinmeli." });
  ok("Kurulum: Mert (demo), D1'i geri çekti (withdrawn) ve gerçek ilana (R1) da teklif verdi");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await submitOffer(page, D2.id, { amount: "5200", duration: "2 gün", description: "Mehmet D2 icin teklif verdi, Zeynep kabul edecek." });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const d2Card = page.locator("div.rounded-card").filter({ hasText: D2.title });
  await d2Card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
  ok("Kurulum: Zeynep, Mehmet'in D2 teklifini kabul etti (accepted) — bu da bir bildirim üretti");
  await logout(page);

  // Mehmet'in aktif iş kapasitesi 1/5 olmalı (D2 accepted)
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(page.getByText("1 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[Ön koşul] Mehmet'in temizlik öncesi aktif iş kapasitesi 1/5");
  await logout(page);

  const d3PhotoKey = "demo-reset-test-photo-0";
  const photoExistsBefore = await photoBlobExists(page, d3PhotoKey);
  assert.equal(photoExistsBefore, true, "Temizlik öncesi demo ilan fotoğrafı IndexedDB'de bulunmalı");
  ok("[Ön koşul] Demo ilana (D3) ait fotoğraf blob'u IndexedDB'de mevcut");

  // --- Dev-only sıfırlama sayfası: plan (dry-run) ---
  await page.goto(`${BASE_URL}/gelistirme/demo-veri-sifirla`);
  await assert.doesNotReject(
    page.getByRole("heading", { name: "Demo Veri Sıfırlama" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await page.getByRole("button", { name: "Planı Hesapla (Dry-Run)" }).click();
  await assert.doesNotReject(
    page.getByText("Silinecek kayıtlar (dry-run)").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(page.getByText("3 ilan", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
  await assert.doesNotReject(page.getByText("3 teklif", { exact: true }).waitFor({ state: "visible", timeout: 5000 }));
  await assert.doesNotReject(
    page.getByText("2 ilan fotoğrafı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 9] Dry-run planı doğru sayıları gösteriyor: 3 demo ilan, 3 demo teklif, 2 demo fotoğraf");
  ok("[İlişki kuralı] Gerçek ilana (R1) verilen demo teklif de silinecekler arasında sayıldı (ilan silinmeden)");

  // --- Temizliği uygula ---
  await page.getByRole("button", { name: "Temizliği Uygula" }).click();
  await assert.doesNotReject(
    page.getByText("Temizlik tamamlandı.").waitFor({ state: "visible", timeout: 15000 }),
  );
  ok("[SENARYO 9] Temizlik uygulandı");

  const afterHeading = page.getByRole("heading", { name: "Temizlik sonrası durum" });
  await assert.doesNotReject(afterHeading.waitFor({ state: "visible", timeout: 10000 }));

  if (consoleErrors.length > 0) {
    console.log("\n[reset-demo-data-test] UYARI (plan/uygula sırasında): Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  }

  // --- Doğrulama: demo veriler gerçekten sıfırlandı ---
  const photoExistsAfter = await photoBlobExists(page, d3PhotoKey);
  assert.equal(photoExistsAfter, false, "Temizlik sonrası demo ilan fotoğrafı IndexedDB'den silinmiş olmalı");
  ok("[SENARYO 9] Demo ilana ait fotoğraf blob'u IndexedDB'den silindi");

  const jobsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
  assert.ok(!jobsAfter.some((j) => [D1.id, D2.id, D3.id].includes(j.id)), "Demo ilanlar localStorage'dan tamamen kalkmalı");
  assert.ok(jobsAfter.some((j) => j.id === R1.id), "Gerçek kullanıcının ilanı silinmemeli");
  ok("[SENARYO 9] Demo ilanlar localStorage'dan kalktı, gerçek kullanıcının ilanı korundu");

  const offersAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
  assert.equal(offersAfter.filter((o) => o.jobId === D1.id || o.jobId === D2.id || o.jobId === D3.id).length, 0, "Demo ilanlara bağlı teklifler kalmamalı");
  const r1Offers = offersAfter.filter((o) => o.jobId === R1.id);
  assert.equal(r1Offers.length, 1, "Gerçek ilanda yalnızca gerçek kullanıcının teklifi kalmalı (demo teklif silinmiş)");
  ok("[İlişki kuralı] Gerçek ilanın (R1) kendi teklifi korundu, yalnızca demo Hizmet Veren'in teklifi silindi");

  // --- Demo hesaplar hâlâ giriş yapabiliyor, verileri boş ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("Henüz aktif bir hizmet talebiniz bulunmuyor.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 10] Zeynep hâlâ giriş yapabiliyor, ilan sayısı 0");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText("Henüz herhangi bir ilana teklif vermediniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[SENARYO 10] Mert hâlâ giriş yapabiliyor, teklifi ve aktif işi 0");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[SENARYO 10] Mehmet Demir hâlâ giriş yapabiliyor, aktif işi 0");
  await logout(page);

  // --- Gerçek kullanıcı hâlâ çalışıyor ---
  await loginAs(page, REAL_VEREN.email, REAL_VEREN.password);
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText(R1.title).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Gerçek veri korumasi] Gerçek Hizmet Veren'in gerçek ilana verdiği teklifi hâlâ görünüyor");
  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[reset-demo-data-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[reset-demo-data-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik: bu testin oluşturduğu gerçek (demo olmayan) kullanıcı verilerini de kaldır.
  await page.evaluate(
    ({ realAlanEmail, realVerenEmail, jobIds }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const removedIds = users.filter((u) => u.email === realAlanEmail || u.email === realVerenEmail).map((u) => u.id);
      localStorage.setItem(
        "malsevk.users.v1",
        JSON.stringify(users.filter((u) => !removedIds.includes(u.id))),
      );
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !jobIds.includes(j.id));
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !jobIds.includes(o.jobId));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { realAlanEmail: REAL_ALAN.email, realVerenEmail: REAL_VEREN.email, jobIds: [R1.id] },
  );

  await browser.close();
  console.log(`\n[reset-demo-data-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[reset-demo-data-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
