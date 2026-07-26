// node scripts/tmp-proje-yuku-service-test.mjs
//
// "Proje Yük" adında yeni bir hizmet türünün merkezi katalog
// (app/_lib/service-catalog.ts#SERVICE_CATEGORY_GROUPS, yeni grup:
// "proje-yuku-hizmetleri" > kategori: "proje-yuku") üzerinden eklendiğini
// ve bunun tüm tüketici ekranlara doğru şekilde yayıldığını doğrular:
//   1) Hizmet Alan ilan oluşturma formunun "Hizmet Kategorisi" seçimi
//   2) Hizmet Veren'in "Hizmet Bilgilerim" (Panel > Profilim) çoklu seçimi
//   3) Hizmet Veren'in "Aktif İlanlar" (/ilanlar) "Hizmet Türü" filtresi
//   4) Ana sayfadaki hizmet kutuları (services-section.tsx, bağımsız liste)
//   5) "Proje Yük" kategorili gerçek bir ilanın Hizmet Alan'ın kendi
//      "Hizmet Taleplerim" panelinde, ilan detay sayfasında ve Hizmet
//      Veren'in ilan tablosunda doğru etiketle göründüğü + filtrelemenin
//      bu ilanı doğru şekilde bulduğu
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
  await page.waitForURL(`${BASE_URL}${redirect}`);
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

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

async function seedProjeYukuJob(page, requesterId) {
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
    const storageKey = "proje-yuku-test-photo-0";
    const blob = await makeBlob("#1e3a5f");
    await putBlob(db, storageKey, blob);
    const job = {
      id: "proje-yuku-test-job",
      title: "Proje Yükü Nakliyesi Test İlanı",
      category: "proje-yuku",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "Test Tesis",
      description: "Proje yükü hizmet türü doğrulama testi için oluşturulan ilan açıklaması.",
      operationDetails: "Proje yükü hizmet türü doğrulama testi için operasyon detayı.",
      workDate: "2026-12-15",
      status: "yayinda",
      requesterId: reqId,
      photos: [{ id: "proje-yuku-photo-id-0", order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey }],
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing.filter((j) => j.id !== job.id), job]));
    db.close();
  }, requesterId);
}

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

  // 1) Ana sayfa: "Proje Yük" hizmet kutusu görünüyor, /ilanlar'a yönlendiriyor.
  await page.goto(`${BASE_URL}/`);
  const homeCard = page.getByRole("link", { name: /Proje Yük/ });
  await assert.doesNotReject(homeCard.waitFor({ state: "visible", timeout: 10000 }));
  assert.equal(await homeCard.getAttribute("href"), "/ilanlar");
  ok('[1] Ana sayfada "Proje Yük" hizmet kutusu görünüyor ve /ilanlar\'a yönlendiriyor');

  // 2) Hizmet Alan (Zeynep) ilan oluşturma formu: "Hizmet Kategorisi" seçiminde
  // "Proje Yükü Hizmetleri" optgroup'u altında "Proje Yük" seçeneği var.
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  const categorySelect = page.getByLabel("Hizmet Kategorisi");
  await assert.doesNotReject(categorySelect.waitFor({ state: "visible", timeout: 10000 }));
  const optionInfo = await categorySelect.evaluate((select) => {
    const option = Array.from(select.querySelectorAll("option")).find((o) => o.value === "proje-yuku");
    const optgroup = option?.closest("optgroup");
    return { found: Boolean(option), label: option?.textContent, groupLabel: optgroup?.label };
  });
  assert.ok(optionInfo.found, '"Hizmet Kategorisi" seçiminde value="proje-yuku" bulunamadı');
  assert.equal(optionInfo.label, "Proje Yük");
  assert.equal(optionInfo.groupLabel, "Proje Yükü Hizmetleri");
  ok('[2] Hizmet Alan ilan oluşturma formunda "Hizmet Kategorisi" > "Proje Yükü Hizmetleri" > "Proje Yük" seçeneği mevcut');

  // 3) Aynı ilanı gerçekten seçip formun kabul ettiğini doğrula (submit etmeden).
  await categorySelect.selectOption("proje-yuku");
  assert.equal(await categorySelect.inputValue(), "proje-yuku");
  ok('[3] "Proje Yük" kategorisi formda seçilebiliyor (selectOption başarılı)');

  // 4) "Proje Yük" kategorili bir ilanı doğrudan enjekte et (fotoğraf yükleme
  // UI'ını simüle etmeden), Hizmet Alan'ın kendi "Hizmet Taleplerim" panelinde
  // ve ilan detay sayfasında doğru etiketle göründüğünü doğrula.
  await seedProjeYukuJob(page, zeynepId);
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("Proje Yükü Nakliyesi Test İlanı").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(page.getByText("Proje Yük", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }));
  ok('[4] Hizmet Alan\'ın "Hizmet Taleplerim" panelinde ilan "Proje Yük" etiketiyle görünüyor');

  await page.goto(`${BASE_URL}/ilanlar/proje-yuku-test-job`);
  await assert.doesNotReject(page.getByText("Proje Yük", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }));
  ok('[5] İlan detay sayfasında "Proje Yük" etiketi görünüyor');

  await logout(page);

  // 6) Hizmet Veren (Mert) "Hizmet Bilgilerim": "Proje Yük" chip'i seçilebiliyor.
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/profil`);
  const projeYukuChip = page.getByRole("button", { name: "Proje Yük", exact: true });
  await assert.doesNotReject(projeYukuChip.waitFor({ state: "visible", timeout: 10000 }));
  assert.equal(await projeYukuChip.getAttribute("aria-pressed"), "false");
  await projeYukuChip.click();
  assert.equal(await projeYukuChip.getAttribute("aria-pressed"), "true");
  ok('[6] Hizmet Veren "Hizmet Bilgilerim" ekranında "Proje Yük" chip\'i seçilebiliyor (aria-pressed doğru değişiyor)');

  // 7) Hizmet Veren "Aktif İlanlar": tabloda "Proje Yük" ilanı görünüyor,
  // "Hizmet Türü" filtresinde "Proje Yük" seçeneği var ve seçildiğinde
  // ilan hâlâ listede kalıyor (doğru eşleşiyor).
  await page.goto(`${BASE_URL}/ilanlar`);
  await assert.doesNotReject(
    page.getByText("Proje Yükü Nakliyesi Test İlanı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok('[7] Hizmet Veren "Aktif İlanlar" tablosunda "Proje Yük" kategorili ilan görünüyor');

  await selectSearchable(page, "job-listing-filter-category", "Proje Yük");
  await assert.doesNotReject(
    page.getByText("Proje Yükü Nakliyesi Test İlanı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok('[8] "Hizmet Türü" filtresinde "Proje Yük" seçilebiliyor ve ilan filtrelenmiş listede doğru görünüyor');

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-proje-yuku-service-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-proje-yuku-service-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  console.log(`\n[tmp-proje-yuku-service-test] ${passed}/${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[tmp-proje-yuku-service-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
