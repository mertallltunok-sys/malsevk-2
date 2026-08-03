// A2 düzeltmesinin doğrulaması: ilan düzenleme ekranı artık workDate VE
// workEndDate'i birlikte topluyor, oluşturma akışıyla (validateServiceItem)
// AYNI merkezi kurala (job-form-validation.ts#validateWorkDateRange) göre
// doğruluyor, ve ters tarih aralığı (workDate > workEndDate) hem "bitişi
// geri çekme" hem "başlangıcı ileri taşıma" yollarından da kesin olarak
// engelliyor.
//
// Kapsanan senaryolar (görev tanımındaki 1-12 ile eşleşir; 13/14 ayrı
// komutlarla — mevcut oluşturma-validasyonu regresyonu ve genel regresyon/
// A1 kapasite testi — doğrulanır, bkz. rapor):
//  1. Düzenleme ekranında mevcut başlangıç/bitiş tarihi doğru görünür.
//  2. Başlangıç ve bitiş birlikte başarıyla güncellenebilir.
//  3. Bitiş < başlangıç seçilince kayıt reddedilir.
//  4. Yalnızca başlangıç, mevcut bitişten SONRAYA taşınınca kayıt reddedilir
//     (orijinal hatanın birebir kendisi).
//  5. Başarısız doğrulamada Job kaydı hiç değişmez.
//  6. Başarısız doğrulamada fotoğraflar/diğer alanlar etkilenmez.
//  7. Başlangıç = bitiş (aynı gün) geçerli, kayıt başarılı olur.
//  8. Tek hizmetli (operationId'siz) ilan düzenlenebilir.
//  9. Çoklu operasyondaki bir ilan düzenlenince kardeş ilanın tarihleri
//     DEĞİŞMEZ.
//  10. İlan detayında tarih aralığı doğru gösterilir (aynı gün tekrar
//      etmez, farklı günler aralık olarak gösterilir).
//  11. Hizmet Taleplerim kartında da aynı doğru gösterim.
//  12. 14 günlük yayın süresi alanları (createdAt/publishEndAt) düzenlemeden
//      etkilenmez.
//
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
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

// Geçerli katalog kategori id'si kasıtlı kullanılır ("Depolama" gibi eski/
// eşlenmemiş bir metin DEĞİL) — aksi halde job-edit-form.tsx kategori
// alanını boş başlatır ve BU test için ilgisiz bir "Hizmet kategorisi
// seçiniz." hatası tarih senaryolarını gölgeler.
const CATEGORY_ID = "genel-depolama";

async function seedJobsWithPhotos(page, requesterId, jobs) {
  await page.evaluate(
    async ({ reqId, jobs, categoryId }) => {
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
      const base = {
        category: categoryId,
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        description: "Tarih araligi duzenleme testi icin ilan aciklamasi.",
        operationDetails: "Test operasyon detayi, on karakterden uzun.",
        addressText: "Test adres bilgisi, en az on karakter uzunlugunda.",
        status: "yayinda",
        requesterId: reqId,
      };
      const built = [];
      for (const job of jobs) {
        const storageKey = `${job.id}-photo-0`;
        const blob = await makeBlob();
        await putBlob(db, storageKey, blob);
        built.push({
          ...base,
          ...job,
          photos: [{ id: `${job.id}-photo-id-0`, order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey }],
        });
      }
      db.close();
      const existingRaw = localStorage.getItem("malsevk.jobs.v1");
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing, ...built]));
    },
    { reqId: requesterId, jobs, categoryId: CATEGORY_ID },
  );
}

async function getJob(page, jobId) {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.id === id),
    jobId,
  );
}

async function openEditForm(page, jobId) {
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${jobId}/duzenle`);
  await page.getByLabel("Başlangıç Tarihi").waitFor({ state: "visible", timeout: 10000 });
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");

  const NORMAL = { id: "date-range-normal", title: "Tarih Araligi Testi - Normal", workDate: "2026-08-10", workEndDate: "2026-08-15" };
  const SAMEDAY = { id: "date-range-sameday", title: "Tarih Araligi Testi - Ayni Gun", workDate: "2026-09-01", workEndDate: "2026-09-01" };
  const OP_A = { id: "date-range-op-a", title: "Tarih Araligi Testi - Operasyon A", workDate: "2026-10-01", workEndDate: "2026-10-05", operationId: "date-range-test-operation" };
  const OP_B = { id: "date-range-op-b", title: "Tarih Araligi Testi - Operasyon B", workDate: "2026-10-02", workEndDate: "2026-10-06", operationId: "date-range-test-operation" };
  const REJECT_TARGET = { id: "date-range-reject", title: "Tarih Araligi Testi - Red Senaryosu", workDate: "2026-11-01", workEndDate: "2026-11-10" };

  await seedJobsWithPhotos(page, zeynepId, [NORMAL, SAMEDAY, OP_A, OP_B, REJECT_TARGET]);
  ok("Kurulum: 5 test ilanı (normal, aynı gün, operasyon kardeşleri x2, red senaryosu) oluşturuldu");

  const createdAtBefore = (await getJob(page, NORMAL.id)).createdAt;
  const publishEndAtBefore = (await getJob(page, NORMAL.id)).publishEndAt;

  // ================= Senaryo 1: mevcut tarihler doğru dolu geliyor =================
  await openEditForm(page, NORMAL.id);
  const startValue = await page.getByLabel("Başlangıç Tarihi").inputValue();
  const endValue = await page.getByLabel("Bitiş Tarihi").inputValue();
  assert.equal(startValue, NORMAL.workDate, "Başlangıç tarihi mevcut değerle dolu gelmeli");
  assert.equal(endValue, NORMAL.workEndDate, "Bitiş tarihi mevcut değerle dolu gelmeli");
  ok("[Senaryo 1] Düzenleme ekranı mevcut başlangıç/bitiş tarihini doğru gösteriyor");

  // ================= Senaryo 2: ikisi birlikte başarıyla güncellenir =================
  await page.getByLabel("Başlangıç Tarihi").fill("2026-08-12");
  await page.getByLabel("Bitiş Tarihi").fill("2026-08-20");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  await page.getByText("İlan başarıyla güncellendi.").waitFor({ state: "visible", timeout: 5000 });
  const normalAfterUpdate = await getJob(page, NORMAL.id);
  assert.equal(normalAfterUpdate.workDate, "2026-08-12", "workDate güncellenmeli");
  assert.equal(normalAfterUpdate.workEndDate, "2026-08-20", "workEndDate AYNI işlemde güncellenmeli");
  ok("[Senaryo 2] Başlangıç ve bitiş tarihi tek işlemde birlikte başarıyla güncellendi");

  // ================= Senaryo 3: bitiş < başlangıç reddedilir =================
  const beforeReject1 = await getJob(page, REJECT_TARGET.id);
  await openEditForm(page, REJECT_TARGET.id);
  await page.getByLabel("Bitiş Tarihi").fill("2026-10-25"); // başlangıç (2026-11-01) öncesi
  await page.getByRole("button", { name: "Kaydet" }).click();
  await assert.doesNotReject(
    page.getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  assert.equal(page.url(), `${BASE_URL}/panel/hizmet-taleplerim/${REJECT_TARGET.id}/duzenle`, "Reddedilen kayıtta sayfa değişmemeli/yönlendirme olmamalı");
  const afterReject1 = await getJob(page, REJECT_TARGET.id);
  assert.deepEqual(afterReject1, beforeReject1, "[Senaryo 5/6] Başarısız doğrulamada Job kaydı (fotoğraflar dahil) BAYT BAYT aynı kalmalı");
  ok("[Senaryo 3+5+6] Bitiş < başlangıç seçilince kayıt reddedildi; Job kaydı (fotoğraflar dahil) hiç değişmedi");

  // ================= Senaryo 4: yalnızca başlangıç, mevcut bitişten sonraya taşınınca reddedilir =================
  // (Sayfa hâlâ REJECT_TARGET'in düzenleme formunda; bitişi geri aldık: mevcut kayıttaki bitiş 2026-11-10.)
  await page.getByLabel("Bitiş Tarihi").fill("2026-11-10");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-11-15"); // mevcut bitişten (11-10) SONRA
  await page.getByRole("button", { name: "Kaydet" }).click();
  await assert.doesNotReject(
    page.getByText("Bitiş tarihi başlangıç tarihinden önce olamaz.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  const afterReject2 = await getJob(page, REJECT_TARGET.id);
  assert.deepEqual(afterReject2, beforeReject1, "[Senaryo 5/6] İkinci başarısız denemede de Job kaydı hiç değişmemeli");
  ok("[Senaryo 4] Yalnızca başlangıç tarihi mevcut bitişten sonraya taşınınca kayıt kesinlikle reddedildi (orijinal hata senaryosu)");

  // ================= Senaryo 7: aynı gün (başlangıç = bitiş) kabul edilir =================
  await openEditForm(page, SAMEDAY.id);
  const sameDayStart = await page.getByLabel("Başlangıç Tarihi").inputValue();
  const sameDayEnd = await page.getByLabel("Bitiş Tarihi").inputValue();
  assert.equal(sameDayStart, SAMEDAY.workDate);
  assert.equal(sameDayEnd, SAMEDAY.workEndDate);
  await page.locator('input[type="text"]').first().fill("Tarih Araligi Testi - Ayni Gun GUNCEL");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  const samedayAfter = await getJob(page, SAMEDAY.id);
  assert.equal(samedayAfter.workDate, SAMEDAY.workDate);
  assert.equal(samedayAfter.workEndDate, SAMEDAY.workEndDate);
  ok("[Senaryo 7] Başlangıç = bitiş (aynı gün) olan ilan, tarihlere dokunmadan başka bir alan güncellenerek başarıyla kaydedildi — mevcut iş kuralı (aynı gün geçerli) korunuyor");

  // ================= Senaryo 8: tek hizmetli (operationId'siz) ilan düzenlenebiliyor =================
  assert.equal(normalAfterUpdate.operationId, undefined, "NORMAL ilanın operationId'si olmamalı (tek hizmetli)");
  ok("[Senaryo 8] Tek hizmetli (operationId'siz) ilan (NORMAL) yukarıda sorunsuz düzenlendi");

  // ================= Senaryo 9: operasyon kardeşinin tarihleri değişmiyor =================
  const opBBefore = await getJob(page, OP_B.id);
  await openEditForm(page, OP_A.id);
  await page.getByLabel("Başlangıç Tarihi").fill("2026-10-08");
  await page.getByLabel("Bitiş Tarihi").fill("2026-10-09");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  const opAAfter = await getJob(page, OP_A.id);
  const opBAfter = await getJob(page, OP_B.id);
  assert.equal(opAAfter.workDate, "2026-10-08", "OP_A güncellenmeli");
  assert.equal(opAAfter.workEndDate, "2026-10-09", "OP_A güncellenmeli");
  assert.deepEqual(opBAfter, opBBefore, "[Senaryo 9] OP_A düzenlenirken kardeş OP_B'nin HİÇBİR alanı (tarihler dahil) değişmemeli");
  ok("[Senaryo 9] Çoklu operasyondaki bir ilan (OP_A) düzenlendi, aynı operationId'yi paylaşan kardeşi (OP_B) bayt bayt değişmeden kaldı");

  // ================= Senaryo 10: ilan detayında tarih aralığı doğru gösteriliyor =================
  await page.goto(`${BASE_URL}/ilanlar/${NORMAL.id}`);
  await assert.doesNotReject(
    page.getByText("12 Ağustos 2026 - 20 Ağustos 2026", { exact: false }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 10] İlan detayında farklı başlangıç/bitiş tarihi doğru aralık olarak gösteriliyor");

  await page.goto(`${BASE_URL}/ilanlar/${SAMEDAY.id}`);
  await page.waitForLoadState("networkidle");
  const samedayDetailBody = await page.locator("body").innerText();
  const septFirstOccurrences = (samedayDetailBody.match(/01 Eylül 2026/g) || []).length;
  assert.equal(septFirstOccurrences, 1, "Aynı gün olan ilan detayında tarih İKİ KEZ değil, TEK sefer gösterilmeli");
  assert.ok(!samedayDetailBody.includes("01 Eylül 2026 - 01 Eylül 2026"), "Aynı gün için gereksiz aralık tekrarı gösterilmemeli");
  ok("[Senaryo 10] Aynı günlü ilan detayında tarih GEREKSİZ tekrar edilmiyor (tek tarih gösteriliyor)");

  // ================= Senaryo 11: Hizmet Taleplerim kartında da aynı doğru gösterim =================
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("12 Ağustos 2026 - 20 Ağustos 2026", { exact: false }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 11] Hizmet Taleplerim kartında da tarih aralığı doğru gösteriliyor");

  // ================= Senaryo 12: 14 günlük yayın süresi alanları etkilenmiyor =================
  const createdAtAfter = normalAfterUpdate.createdAt;
  const publishEndAtAfter = normalAfterUpdate.publishEndAt;
  assert.equal(createdAtAfter, createdAtBefore, "[Senaryo 12] createdAt (yayın süresi başlangıcı) tarih düzenlemesinden ETKİLENMEMELİ");
  assert.equal(publishEndAtAfter, publishEndAtBefore, "[Senaryo 12] publishEndAt (14 günlük yayın süresi bitişi) tarih düzenlemesinden ETKİLENMEMELİ");
  ok("[Senaryo 12] İş tarihi (workDate/workEndDate) düzenlemesi, 14 günlük yayın süresi alanlarını (createdAt/publishEndAt) hiç değiştirmedi");

  if (consoleErrors.length > 0) {
    console.log("\n[job-edit-work-date-range-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[job-edit-work-date-range-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const ids = [NORMAL.id, SAMEDAY.id, OP_A.id, OP_B.id, REJECT_TARGET.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  }, ids);
  await page.evaluate(async () => {
    const req = indexedDB.deleteDatabase("malsevk-photo-blobs");
    await new Promise((resolve) => { req.onsuccess = resolve; req.onerror = resolve; req.onblocked = resolve; });
  });

  console.log(`\n[job-edit-work-date-range-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[job-edit-work-date-range-test] HATA:", error);
  process.exitCode = 1;
});
