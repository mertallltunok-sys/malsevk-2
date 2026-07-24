// Aşama 3.2 doğrulama: (1) ilan düzenleme formunda il/ilçe/yer türü
// değiştiğinde eski hata mesajlarının temizlenmesi, (2) fotoğraf kartı
// sırala/sil butonlarının mobilde en az ~44x44px dokunma hedefine
// büyütülmesi (masaüstünde eski boyutuna dönmesi). Ön koşul: `npm run dev`.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const FIX = (name) => path.join(os.tmpdir(), name);
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

async function seedEditJob(page, requesterId) {
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
    const blob = await makeBlob("#2f6690");
    const storageKey = "ui-consistency-photo-0";
    await putBlob(db, storageKey, blob);
    db.close();

    // İl kasıtlı olarak mevcut il listesiyle EŞLEŞMEYEN bir değer -- bu,
    // düzenleme formunun provinceCode'u "" (seçilmemiş) olarak başlatmasını
    // tetikler (gerçek dünyada eski/bozuk veri ile aynı senaryo). İlçe ve
    // tesis de kasıtlı olarak boş -- eski hata mesajlarının il/ilçe/yer türü
    // değiştiğinde temizlenip temizlenmediğini test edebilmek için.
    const job = {
      id: "ui-consistency-job",
      title: "UI Tutarlılık Test İlanı",
      category: "lashing",
      province: "Yanlis-Il-Adi",
      district: "",
      workLocationType: "",
      workDate: "2026-09-01",
      description: "Bu ilan Asama 3.2 UI tutarlilik testleri icin olusturulmustur.",
      operationDetails: "Operasyon detaylari test amaclidir, en az on karakter.",
      status: "yayinda",
      requesterId: reqId,
      photos: [
        { id: "ui-consistency-photo-id-0", order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey },
      ],
    };
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify([job]));
  }, requesterId);
}

async function selectSearchable(page, labelText, optionText) {
  await page.locator(`label:text-is("${labelText}") + button`).click();
  await page.getByRole("textbox", { name: `${labelText} içinde ara` }).fill(optionText);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

async function selectedLabelOf(page, labelText) {
  return page.locator(`label:text-is("${labelText}") + button span`).first().innerText();
}

async function fillTesis(page, value) {
  const freeTextInput = page.locator('label:text-is("Tesis") + input');
  if ((await freeTextInput.count()) > 0) {
    await freeTextInput.fill(value);
    return;
  }
  await page.locator('label:text-is("Tesis") + button').click();
  await page.getByRole("listbox", { name: "Tesis" }).getByRole("option").first().click();
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

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedEditJob(page, zeynepId);
  ok("Kurulum: eşleşmeyen il / boş ilçe / boş tesis ile test ilanı oluşturuldu");

  // ---- DÜZENLEME FORMU ----
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/ui-consistency-job/duzenle`);
  await page.getByRole("button", { name: "Kaydet" }).waitFor({ state: "visible", timeout: 10000 });

  // [TEST 1] Mevcut (eşleşmeyen il / boş ilçe / boş tesis) durumla gönderim -> ilgili hatalar görünüyor
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("İl zorunludur.").waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("İlçe zorunludur.").waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("İşin yapılacağı yeri (tesisi) belirtiniz.").waitFor({ state: "visible", timeout: 5000 });
  ok("[1] Düzenleme formu geçersiz durumda gönderildiğinde il/ilçe/tesis hataları görünüyor");

  // [TEST 2/3] Geçerli bir il seçilince eski il VE ilçe hatası hemen temizleniyor, ilçe sıfırlanıyor
  await selectSearchable(page, "İl", "Kocaeli");
  await assert.doesNotReject(
    page.getByText("İl zorunludur.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  await assert.doesNotReject(
    page.getByText("İlçe zorunludur.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  const districtLabelAfterProvince = await selectedLabelOf(page, "İlçe");
  assert.equal(districtLabelAfterProvince, "İlçe seçiniz", "İl değişince ilçe seçimi sıfırlanmalı");
  ok("[2] Geçerli il seçilince eski 'İl zorunludur.' hatası hemen temizleniyor");
  ok("[3] İl değişince ilçe seçimi sıfırlanıyor ve eski 'İlçe zorunludur.' hatası da temizleniyor");

  // [TEST 4] Geçerli bir ilçe seçilince eski ilçe hatası temizli kalıyor (zaten yukarıda temizlenmişti; burada seçim sonrası tekrar hata çıkmadığını doğrula)
  await selectSearchable(page, "İlçe", "Gebze");
  const districtLabelAfterSelect = await selectedLabelOf(page, "İlçe");
  assert.equal(districtLabelAfterSelect, "Gebze");
  await assert.doesNotReject(
    page.getByText("İlçe zorunludur.").waitFor({ state: "hidden", timeout: 2000 }),
  );
  ok("[4] Geçerli ilçe seçildikten sonra ilçe hatası görünmüyor");

  // Tesis hâlâ boş -> tekrar gönderince tesis hatası yeniden çıkmalı (bir sonraki adım için ön koşul)
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("İşin yapılacağı yeri (tesisi) belirtiniz.").waitFor({ state: "visible", timeout: 5000 });
  ok("Ön koşul: tesis boş olduğu için 'İşin yapılacağı yeri (tesisi) belirtiniz.' hatası tekrar çıktı");

  // [TEST 2 devamı] İl değiştiğinde tesisle ilgili eski hata da temizleniyor mu
  await selectSearchable(page, "İl", "İstanbul");
  await assert.doesNotReject(
    page.getByText("İşin yapılacağı yeri (tesisi) belirtiniz.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  const districtLabelAfterSecondProvince = await selectedLabelOf(page, "İlçe");
  assert.equal(districtLabelAfterSecondProvince, "İlçe seçiniz", "İl tekrar değişince ilçe yine sıfırlanmalı");
  ok("[2] İl değiştiğinde tesisle ilgili eski hata da (yeniden gönderim beklenmeden) temizleniyor");

  // Tutarlı bir duruma geri dön: Kocaeli / Gebze
  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Gebze");

  // Tesis hâlâ boş -> tekrar gönderip hatayı yeniden oluştur (TEST 5 ön koşulu)
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("İşin yapılacağı yeri (tesisi) belirtiniz.").waitFor({ state: "visible", timeout: 5000 });

  // [TEST 5] Yer türü değiştiğinde eski tesis hatası temizleniyor
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Depo" });
  await assert.doesNotReject(
    page.getByText("İşin yapılacağı yeri (tesisi) belirtiniz.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  ok("[5] Yer türü değiştiğinde eski tesis hatası hemen temizleniyor");

  // [TEST 7] Geçerli bir tesis girip kaydet -> düzenleme başarıyla tamamlanıyor
  await fillTesis(page, "Test Deposu 123");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  await page.getByText("İlan başarıyla güncellendi.").waitFor({ state: "visible", timeout: 5000 });
  ok("[7] İlan düzenleme, konum hatalarının tamamı giderildikten sonra başarıyla kaydediliyor");

  const savedJob = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.id === "ui-consistency-job"),
  );
  assert.equal(savedJob.province, "Kocaeli");
  assert.equal(savedJob.district, "Gebze");
  assert.equal(savedJob.workLocationType, "Test Deposu 123");
  ok("Kaydedilen ilan verisi (il/ilçe/tesis) beklenen değerlerle kalıcı olarak güncellendi");

  // ---- OLUŞTURMA FORMU: mevcut davranış bozulmadı mı (paylaşılan yardımcı sonrası) ----
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByText("İl zorunludur.").waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("İlçe zorunludur.").waitFor({ state: "visible", timeout: 5000 });
  await selectSearchable(page, "İl", "İzmir");
  await assert.doesNotReject(
    page.getByText("İl zorunludur.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  await assert.doesNotReject(
    page.getByText("İlçe zorunludur.").waitFor({ state: "hidden", timeout: 3000 }),
  );
  ok("[6] İlan oluşturma formunda il/ilçe hata temizleme davranışı (paylaşılan yardımcı ile) bozulmadı");

  // ---- FOTOĞRAF KARTI DOKUNMA HEDEFLERİ (mobil) ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "İlanı Yayınla" }).waitFor({ state: "visible", timeout: 10000 });
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg"), FIX("fixture-valid-2.jpg")]);
  await page.getByRole("button", { name: "Sırada geri al" }).first().waitFor({ state: "visible", timeout: 15000 });

  const noOverflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  assert.ok(noOverflow390, "390px genişlikte sayfa yatay taşma yapmamalı");
  ok("[10] 390px genişlikte yatay taşma yok");

  async function measure(locator) {
    const box = await locator.first().boundingBox();
    assert.ok(box, "Buton bulunamadı / görünmüyor");
    return box;
  }

  const deleteBoxMobile = await measure(page.getByRole("button", { name: /fotoğrafını sil/ }));
  const moveLeftBoxMobile = await measure(page.getByRole("button", { name: "Sırada öne al" }));
  const moveRightBoxMobile = await measure(page.getByRole("button", { name: "Sırada geri al" }));
  for (const [name, box] of [
    ["sil", deleteBoxMobile],
    ["sola taşı", moveLeftBoxMobile],
    ["sağa taşı", moveRightBoxMobile],
  ]) {
    assert.ok(box.width >= 43, `${name} butonu mobilde en az ~44px genişlikte olmalı, ölçülen: ${box.width}`);
    assert.ok(box.height >= 43, `${name} butonu mobilde en az ~44px yükseklikte olmalı, ölçülen: ${box.height}`);
  }
  ok(
    `[11] Mobilde (390px) dokunma hedefleri: sil ${deleteBoxMobile.width.toFixed(0)}x${deleteBoxMobile.height.toFixed(0)}px, ` +
      `sola taşı ${moveLeftBoxMobile.width.toFixed(0)}x${moveLeftBoxMobile.height.toFixed(0)}px, ` +
      `sağa taşı ${moveRightBoxMobile.width.toFixed(0)}x${moveRightBoxMobile.height.toFixed(0)}px (hepsi >= ~44px)`,
  );

  // 320px genişlikte de taşma yok ve boyutlar aynı şekilde büyük mü
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(200);
  const noOverflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  assert.ok(noOverflow320, "320px genişlikte sayfa yatay taşma yapmamalı");
  const deleteBox320 = await measure(page.getByRole("button", { name: /fotoğrafını sil/ }));
  assert.ok(deleteBox320.width >= 43 && deleteBox320.height >= 43, "320px genişlikte sil butonu hâlâ ~44px olmalı");
  ok("[10] 320px genişlikte de yatay taşma yok, dokunma hedefleri korunuyor");

  // Masaüstünde eski (küçük) boyuta dönüyor mu -- gereksiz büyük/kaba görünüm yok
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  const deleteBoxDesktop = await measure(page.getByRole("button", { name: /fotoğrafını sil/ }));
  const moveLeftBoxDesktop = await measure(page.getByRole("button", { name: "Sırada öne al" }));
  assert.ok(deleteBoxDesktop.width <= 36, `Masaüstünde sil butonu eski (küçük) boyutuna dönmeli, ölçülen: ${deleteBoxDesktop.width}`);
  assert.ok(moveLeftBoxDesktop.width <= 32, `Masaüstünde sıralama butonu eski (küçük) boyutuna dönmeli, ölçülen: ${moveLeftBoxDesktop.width}`);
  ok(
    `Masaüstünde (1280px) butonlar eski kompakt boyutuna dönüyor: sil ${deleteBoxDesktop.width.toFixed(0)}px, ` +
      `sıralama ${moveLeftBoxDesktop.width.toFixed(0)}px (gereksiz büyüme yok)`,
  );

  // Butonlar birbirinin üzerine binmiyor mu (aynı satırdaki iki sıralama butonunun kutuları kesişmemeli)
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(200);
  const leftBox = await measure(page.getByRole("button", { name: "Sırada öne al" }));
  const rightBox = await measure(page.getByRole("button", { name: "Sırada geri al" }));
  const overlap = leftBox.x + leftBox.width > rightBox.x;
  assert.ok(!overlap, "Sıralama butonları 320px genişlikte birbirinin üzerine binmemeli");
  ok("[11] 320px genişlikte büyütülmüş sıralama butonları birbirinin üzerine binmiyor");

  // [TEST 8/9] Sıralama ve silme işlevleri hâlâ çalışıyor mu
  const namesBefore = await page.locator("[data-photo-filename]").evaluateAll((els) => els.map((el) => el.getAttribute("data-photo-filename")));
  await page.getByRole("button", { name: "Sırada geri al" }).first().click();
  await page.waitForTimeout(200);
  const namesAfterMove = await page.locator("[data-photo-filename]").evaluateAll((els) => els.map((el) => el.getAttribute("data-photo-filename")));
  assert.notDeepEqual(namesAfterMove, namesBefore, "Sırada geri al sonrası fotoğraf sırası değişmeli");
  ok(`[8] Fotoğraf sıralama butonu çalışıyor (sıra: ${namesBefore.join(",")} -> ${namesAfterMove.join(",")})`);

  await page.getByRole("button", { name: /fotoğrafını sil/ }).first().click();
  await page.waitForTimeout(200);
  const countAfterDelete = await page.locator("[data-photo-filename]").count();
  assert.equal(countAfterDelete, 1, "Bir fotoğraf silindikten sonra 1 tane kalmalı");
  ok("[9] Fotoğraf silme butonu çalışıyor");

  if (consoleErrors.length > 0) {
    console.log("\n[asama-3-2-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[asama-3-2-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter(
      (j) => j.id !== "ui-consistency-job",
    );
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  });
  await page.evaluate(async () => {
    const req = indexedDB.deleteDatabase("malsevk-photo-blobs");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  console.log(`\n[asama-3-2-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[asama-3-2-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
