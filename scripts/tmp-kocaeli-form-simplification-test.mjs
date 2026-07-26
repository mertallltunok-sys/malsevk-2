// node scripts/tmp-kocaeli-form-simplification-test.mjs
//
// "Hizmet Talebi Oluştur" formunun Kocaeli-sadeleştirmesini doğrular:
//   1) İl artık kullanıcı tarafından seçilemez, her zaman "Kocaeli" (Lock
//      ikonlu, readonly gösterim) — ne katalog ne özel tesis modunda bir
//      SearchableSelect/buton olarak render edilmiyor.
//   2) İlçe hâlâ Kocaeli'nin tüm ilçelerini listeliyor (ör. Dilovası).
//   3) Bölge/Tesis filtrelemesi (katalog + "Listede yok" özel mod) bozulmadı.
//   4) "Firma / Fabrika Adı" alanı UI'dan TAMAMEN kaldırıldı — ne katalog
//      ne özel tesis modunda hiçbir yerde görünmüyor.
//   5) Yeni oluşturulan ilan province="Kocaeli" ile kaydediliyor ve
//      companyOrFactoryName alanı hiç yazılmıyor.
//   6) Geriye dönük uyumluluk: companyOrFactoryName'i olan ESKİ bir ilan,
//      hem detay sayfasında hem Hizmet Veren'in ilan tablosunda/kartlarında
//      hâlâ doğru gösteriliyor; bu ilan düzenleme formundan (Firma/Fabrika
//      Adı artık orada da yok) kaydedilse bile eski değer KAYBOLMUYOR
//      (job-store.ts#resolveLocationFields'ın ...existing spread'i sayesinde).
//   7) job-edit-form.tsx'in İl alanına dokunulmadığı: hâlâ gerçek bir
//      SearchableSelect (buton), sabit/readonly bir kutu DEĞİL.
// Ön koşul: `npm run dev` çalışıyor olmalı.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ✓ ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

async function getUserId(page, email) {
  return page.evaluate(
    (targetEmail) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === targetEmail)?.id;
    },
    email,
  );
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function seedLegacyJobWithCompanyName(page, requesterId) {
  await page.evaluate(async (reqId) => {
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
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 40, 40);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    }
    const db = await openDb();
    const storageKey = "legacy-company-test-photo-0";
    const blob = await makeBlob("#2f6690");
    await putBlob(db, storageKey, blob);
    const job = {
      id: "legacy-company-test-job",
      title: "Eski Firma Alanli Test Ilani",
      category: "depo-personeli",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "Test Tesis Eski",
      companyOrFactoryName: "Eski Firma A.Ş.",
      addressText: "Eski test adresi, en az on karakter.",
      locationMode: "catalog",
      description: "Geriye donuk uyumluluk testi icin aciklama metni.",
      operationDetails: "Geriye donuk uyumluluk testi icin operasyon detayi.",
      workDate: "2026-12-20",
      status: "yayinda",
      requesterId: reqId,
      photos: [{ id: "legacy-photo-id-0", order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey }],
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing.filter((j) => j.id !== job.id), job]));
    db.close();
  }, requesterId);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // === 1) Hizmet Talebi Oluştur: İl sabit "Kocaeli", seçilemez ===
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);

  const provinceButtonCount = await page.getByRole("button", { name: "İl", exact: true }).count();
  assert.equal(provinceButtonCount, 0, "İl artık interaktif bir SearchableSelect butonu olmamalı");
  const provinceLabelSpan = page.locator("span", { hasText: "İl" }).first();
  await assert.doesNotReject(provinceLabelSpan.waitFor({ state: "visible", timeout: 10000 }));
  await assert.doesNotReject(page.getByText("Kocaeli", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }));
  ok('[1] "Hizmet Talebi Oluştur"da İl artık seçilemiyor, sabit "Kocaeli" gösteriliyor');

  // === 2) Firma / Fabrika Adı hiçbir modda görünmüyor (henüz tesis seçilmeden önce de) ===
  assert.equal(
    await page.getByLabel("Firma / Fabrika Adı").count(),
    0,
    '"Firma / Fabrika Adı" alanı henüz tesis seçilmeden de görünmemeli (alan tamamen kaldırıldı)',
  );

  // === 3) İlçe hâlâ Kocaeli ilçelerini listeliyor, Bölge/Tesis katalog modu çalışıyor ===
  const categorySelect = page.locator("select").first();
  await categorySelect.selectOption("depo-personeli");
  await page.getByLabel("İlan Başlığı").fill(`KOCAELI-SADELESTIRME-TEST-${Date.now()}`);
  await page.getByLabel("İş Açıklaması").fill("Bu test icin olusturulmus, en az yirmi karakter iceren bir aciklama.");
  await page.getByLabel("İş Tarihi").fill("2026-12-22");
  await page.getByLabel("Operasyon Detayları").fill("Test operasyon detayi, en az on karakter.");
  await selectFromSearchable(page, "İlçe", "Dilovası");
  ok('[2] İlçe seçiminde Kocaeli ilçesi ("Dilovası") sorunsuz seçilebiliyor');

  await selectFromSearchable(page, "Bölge / Tesis", "Beldeport", { exact: false });
  assert.equal(
    await page.getByLabel("Firma / Fabrika Adı").count(),
    0,
    'Katalogdan gerçek bir tesis (Beldeport) seçilse bile "Firma / Fabrika Adı" GÖRÜNMEMELİ',
  );
  ok('[3] Katalogdan tesis seçilse bile "Firma / Fabrika Adı" alanı hiç görünmüyor (tamamen kaldırılmış)');

  await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: /İlanı Yayınla/ }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  const newJobUrl = page.url();
  const newJobId = newJobUrl.split("/ilanlar/")[1];
  ok("[4] Yeni ilan başarıyla oluşturuldu (Firma/Fabrika Adı hiç istenmeden)");

  const newJobRecord = await page.evaluate((id) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.id === id);
  }, newJobId);
  assert.equal(newJobRecord.province, "Kocaeli", "Yeni ilanın province değeri her zaman Kocaeli olmalı");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(newJobRecord, "companyOrFactoryName") || !newJobRecord.companyOrFactoryName,
    "Yeni ilanda companyOrFactoryName hiç yazılmamalı",
  );
  ok('[5] Kaydedilen ilanda province="Kocaeli" ve companyOrFactoryName yok — veri modeli doğru');

  // === 6) Özel tesis ("Listede yok") modu hâlâ çalışıyor, Firma/Fabrika Adı orada da yok ===
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await categorySelect.selectOption("depo-personeli");
  await page.getByLabel("İlan Başlığı").fill(`KOCAELI-OZEL-TESIS-TEST-${Date.now()}`);
  await page.getByLabel("İş Açıklaması").fill("Ozel tesis modu icin en az yirmi karakter iceren aciklama metni.");
  await page.getByLabel("İş Tarihi").fill("2026-12-23");
  await page.getByLabel("Operasyon Detayları").fill("Ozel tesis modu operasyon detayi, en az on karakter.");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await selectFromSearchable(page, "Bölge / Tesis", "Listede yok", { exact: false });
  await assert.doesNotReject(page.getByLabel("Tesis / İşletme Adı").waitFor({ state: "visible", timeout: 5000 }));
  assert.equal(
    await page.getByLabel("Firma / Fabrika Adı").count(),
    0,
    'Özel tesis modunda da "Firma / Fabrika Adı" görünmemeli (zaten hiç yok)',
  );
  ok('[6] Özel tesis ("Listede yok") modu bozulmadan çalışıyor, "Firma / Fabrika Adı" orada da yok');

  await logout(page);

  // === 7) Geriye dönük uyumluluk: eski (companyOrFactoryName'li) ilan enjekte et ===
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await seedLegacyJobWithCompanyName(page, zeynepId);

  await page.goto(`${BASE_URL}/ilanlar/legacy-company-test-job`);
  await assert.doesNotReject(page.getByText("Eski Firma A.Ş.", { exact: true }).waitFor({ state: "visible", timeout: 10000 }));
  ok('[7] Eski ilanın detay sayfasında "Eski Firma A.Ş." hâlâ doğru şekilde görünüyor (geriye dönük uyumluluk)');

  // === 8) job-edit-form.tsx: Firma/Fabrika Adı yok, ama İl alanı DOKUNULMAMIŞ (hâlâ SearchableSelect) ===
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/legacy-company-test-job/duzenle`);
  assert.equal(
    await page.getByLabel("Firma / Fabrika Adı").count(),
    0,
    "Düzenleme formunda da Firma/Fabrika Adı artık görünmemeli",
  );
  const editProvinceButton = page.getByRole("button", { name: "İl", exact: true });
  await assert.doesNotReject(editProvinceButton.waitFor({ state: "visible", timeout: 10000 }));
  const editProvinceButtonText = await editProvinceButton.innerText();
  assert.ok(editProvinceButtonText.includes("Kocaeli"), "Düzenleme formunda İl alanı hâlâ Kocaeli değerini gösteriyor olmalı");
  ok('[8] job-edit-form.tsx: "Firma / Fabrika Adı" kaldırılmış AMA İl alanı hâlâ gerçek/etkileşimli bir SearchableSelect (dokunulmamış)');

  // Ufak bir değişiklik yapıp kaydet — eski companyOrFactoryName'in KAYBOLMADIĞINI doğrula.
  await page.locator('input[type="text"]').first().fill("Eski Firma Alanli Test Ilani - GUNCELLENDI");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim/, { timeout: 15000 });

  const updatedLegacyJob = await page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.id === "legacy-company-test-job");
  });
  assert.equal(updatedLegacyJob.title, "Eski Firma Alanli Test Ilani - GUNCELLENDI", "Başlık güncellenmiş olmalı");
  assert.equal(
    updatedLegacyJob.companyOrFactoryName,
    "Eski Firma A.Ş.",
    "Düzenleme sonrası eski companyOrFactoryName değeri KAYBOLMAMALI (backward-compat)",
  );
  ok('[9] Düzenleme formundan kaydedilse bile eski companyOrFactoryName ("Eski Firma A.Ş.") kaybolmuyor — veri kaybı yok');

  await page.goto(`${BASE_URL}/ilanlar/legacy-company-test-job`);
  await assert.doesNotReject(page.getByText("Eski Firma A.Ş.", { exact: true }).waitFor({ state: "visible", timeout: 10000 }));
  ok('[10] Düzenleme sonrası detay sayfasında "Eski Firma A.Ş." hâlâ görünüyor');

  await logout(page);

  // === 11) Hizmet Veren tarafında (Aktif İlanlar tablo/kart) eski firma adı hâlâ görünüyor ===
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar`);
  await assert.doesNotReject(
    page.getByText("Eski Firma Alanli Test Ilani - GUNCELLENDI").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(page.getByText("Eski Firma A.Ş.", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }));
  ok('[11] Hizmet Veren "Aktif İlanlar" görünümünde eski ilanın "Eski Firma A.Ş." bilgisi hâlâ doğru gösteriliyor');

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-kocaeli-form-simplification-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-kocaeli-form-simplification-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  console.log(`\n[tmp-kocaeli-form-simplification-test] ${passed}/${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[tmp-kocaeli-form-simplification-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
