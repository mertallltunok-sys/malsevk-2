// İlan detay tarih uyarısı + İlanı Düzenle akışı testi.
// Ön koşul: `npm run dev`.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) { passed++; console.log(`  ok ${d}`); }
function fail(d, e) { console.log(`  FAIL ${d}`); console.log(e); process.exitCode = 1; }

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
async function seedJobsWithPhotos(page, requesterId) {
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
        canvas.width = 40; canvas.height = 40;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 40, 40);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    }
    const db = await openDb();
    const base = { category: "Depolama", province: "Kocaeli", district: "Gebze", workLocationType: "Test Tesis", description: "Duzenleme testi icin aciklama metni.", operationDetails: "Duzenleme testi operasyon detayi.", status: "yayinda", requesterId: reqId };

    async function makePhotos(count, prefix) {
      const photos = [];
      const colors = ["#1e3a5f", "#2f6690", "#3f8f6c"];
      for (let i = 0; i < count; i++) {
        const storageKey = `${prefix}-photo-${i}`;
        const blob = await makeBlob(colors[i % colors.length]);
        await putBlob(db, storageKey, blob);
        photos.push({ id: `${prefix}-photo-id-${i}`, order: i, fileName: `foto-${i}.png`, fileSize: blob.size, mimeType: "image/png", storageKey });
      }
      return photos;
    }

    const jobs = [
      { ...base, id: "edit-job-future", title: "Duzenleme Test - Gelecek Tarih", workDate: "2026-12-01", photos: await makePhotos(2, "future") },
      { ...base, id: "edit-job-past", title: "Duzenleme Test - Gecmis Tarih", workDate: "2020-01-01", photos: await makePhotos(2, "past") },
      { ...base, id: "edit-job-offer", title: "Duzenleme Test - Teklifli Ilan", workDate: "2026-12-05", photos: await makePhotos(2, "offer") },
    ];
    db.close();
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  }, requesterId);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJobsWithPhotos(page, zeynepId);
  ok("Kurulum: 3 test ilanı (gelecek tarih, geçmiş tarih, teklifli) + fotoğraflar oluşturuldu");

  // --- 1) Geçmiş tarih uyarısı detay sayfasında görünüyor mu ---
  await page.goto(`${BASE_URL}/ilanlar/edit-job-past`);
  await assert.doesNotReject(
    page.getByText("Tarihi güncellemeniz önerilir.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[1] Geçmiş tarihli kendi ilanında detay sayfasında uyarı görünüyor");

  // --- 2) Aktif (gelecek tarihli) ilanda uyarı görünmüyor ---
  await page.goto(`${BASE_URL}/ilanlar/edit-job-future`);
  await page.waitForTimeout(500);
  const futureBody = await page.locator("body").innerText();
  assert.ok(!futureBody.includes("Tarihi güncellemeniz önerilir."), "Gelecek tarihli ilanda uyarı görünmemeli");
  ok("[2] Aktif (gelecek tarihli) ilanda gereksiz uyarı görünmüyor");
  await logout(page);

  // --- 3) Başkasının ilanında (owner değilken) uyarı görünmüyor ---
  await register(page, { name: "Other Hizmet Alan", email: "other-hizmetalan@test.com", phone: "0555 600 60 01", password: "OtherAlan1!", role: "hizmet-alan" });
  await page.goto(`${BASE_URL}/ilanlar/edit-job-past`);
  await page.waitForTimeout(500);
  const otherOwnerBody = await page.locator("body").innerText();
  assert.ok(!otherOwnerBody.includes("Tarihi güncellemeniz önerilir."), "Sahibi olmayan kullanıcıya uyarı gösterilmemeli");
  ok("[3] İlan sahibi olmayan kullanıcıda uyarı görünmüyor");

  // Yetkisiz düzenleme erişimi engelleniyor mu
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/edit-job-past/duzenle`);
  await assert.doesNotReject(
    page.getByText("Bu ilanı düzenleme yetkiniz yok.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Yetki] Başka bir Hizmet Alan, sahibi olmadığı ilanı düzenleme URL'ine girince engelleniyor");
  await logout(page);

  // Hizmet Veren de düzenleyemez
  await register(page, { name: "Provider Edit Test", email: "provider-edittest@test.com", phone: "0555 600 60 02", password: "ProviderEdit1!", role: "hizmet-veren" });
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/edit-job-past/duzenle`);
  await assert.doesNotReject(
    page.getByText("Bu ilanı düzenleme yetkiniz yok.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Yetki] Hizmet Veren de ilan düzenleme URL'ine girince engelleniyor");

  // Provider bu ilana teklif verir (bildirim/teklif korunumu testi için)
  await page.goto(`${BASE_URL}/ilanlar/edit-job-offer`);
  await page.getByLabel("Teklif Fiyatı").fill("5000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("3 gün");
  await page.getByLabel("Teklif Açıklaması").fill("Duzenleme testi icin teklif, en az yirmi karakter uzunlugunda.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
  ok("Provider, edit-job-offer ilanına teklif verdi (koruma testi için)");
  await logout(page);

  // --- 4) İlanı Düzenle butonu görünüyor mu ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/hizmet-taleplerim");
  await page.getByRole("heading", { name: "Hizmet Taleplerim", level: 1 }).waitFor({ state: "visible" });
  await page.getByText("Duzenleme Test - Gecmis Tarih").first().waitFor({ state: "visible", timeout: 10000 });
  const debugState = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("malsevk.session.v1") || "null");
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return { sessionId: session?.id, jobRequesterIds: jobs.map((j) => ({ id: j.id, requesterId: j.requesterId })) };
  });
  console.log("  (debug) session/jobs state:", JSON.stringify(debugState));
  console.log("  (debug) console errors so far:", JSON.stringify(consoleErrors));
  console.log("  (debug) body text:", (await page.locator("body").innerText()).slice(0, 1500));
  const editButtons = await page.getByRole("link", { name: "İlanı Düzenle" }).count();
  assert.ok(editButtons >= 3, `Zeynep'in her ilan kartında İlanı Düzenle butonu olmalı, bulunan: ${editButtons}`);
  ok(`[4] İlan sahibi (Zeynep) kendi ilan kartlarında İlanı Düzenle butonunu görüyor (${editButtons} adet)`);

  const beforeJobCount = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").length);

  // --- 5/6/9) Düzenleme: mevcut bilgilerle dolu geliyor mu, güncelleme çalışıyor mu ---
  const editCard = page.locator('li').filter({ hasText: /Duzenleme Test - Gecmis Tarih/i });
  await editCard.getByRole("link", { name: "İlanı Düzenle" }).click();
  await page.waitForURL(/\/duzenle$/);

  const titleInput = page.locator('input[type="text"]').first();
  const titleValue = await titleInput.inputValue();
  assert.equal(titleValue, "Duzenleme Test - Gecmis Tarih", "Başlık alanı mevcut veriyle dolu gelmeli");
  const descTextarea = page.locator("textarea").first();
  const descValue = await descTextarea.inputValue();
  assert.equal(descValue, "Duzenleme testi icin aciklama metni.", "Açıklama alanı mevcut veriyle dolu gelmeli");
  const dateInput = page.locator('input[type="date"]');
  const dateValue = await dateInput.inputValue();
  assert.equal(dateValue, "2020-01-01", "Tarih alanı mevcut veriyle dolu gelmeli");
  ok("[5] Düzenleme formu mevcut ilan bilgileriyle (başlık, açıklama, tarih) dolu geliyor");

  // Fotoğraf kontrolü: 2 mevcut fotoğraf gösteriliyor mu
  const existingPhotoCount = await page.locator('[data-photo-filename]').count();
  assert.equal(existingPhotoCount, 2, `Mevcut 2 fotoğraf gösterilmeli, bulunan: ${existingPhotoCount}`);
  ok("[9] Mevcut fotoğraflar (2 adet) düzenleme ekranında gösteriliyor");

  // Bir mevcut fotoğrafı sil
  await page.locator('[data-photo-filename]').first().getByRole("button", { name: /fotoğrafını sil/ }).click();
  await page.waitForTimeout(300);
  const afterDeletePhotoCount = await page.locator('[data-photo-filename]').count();
  assert.equal(afterDeletePhotoCount, 1, "Bir fotoğraf silindikten sonra 1 tane kalmalı");
  ok("[9] Mevcut fotoğraf silinebiliyor");

  // Başlığı değiştir, kaydet
  await titleInput.fill("Duzenleme Test - GUNCELLENDI");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(1500);
  console.log("  (debug) URL after Kaydet click:", page.url());
  console.log("  (debug) console errors:", JSON.stringify(consoleErrors));
  console.log("  (debug) body after Kaydet:", (await page.locator("body").innerText()).slice(0, 1200));

  // --- 11) Başarı mesajı + yönlendirme ---
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });
  await assert.doesNotReject(
    page.getByText("İlan başarıyla güncellendi.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[11] Kaydet sonrası Hizmet Taleplerim'e yönlendirildi, başarı mesajı gösterildi");

  // --- 6) Yeni ilan oluşmadı mı ---
  const afterJobCount = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").length);
  assert.equal(afterJobCount, beforeJobCount, "Düzenleme sonrası toplam ilan sayısı değişmemeli (yeni ilan oluşmamalı)");
  ok("[6] Yeni ilan oluşmadı, ilan ID'si ve toplam sayı korundu");

  // --- 9) Fotoğraf sayısı gerçekten kalıcı olarak 1'e düştü mü ---
  const updatedJob = await page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.id === "edit-job-past");
  });
  assert.equal(updatedJob.id, "edit-job-past", "İlan ID'si değişmemeli");
  assert.equal(updatedJob.title, "Duzenleme Test - GUNCELLENDI", "Başlık güncellenmeli");
  assert.equal(updatedJob.photos.length, 1, "Fotoğraf sayısı kalıcı olarak 1 olmalı");
  ok("[5/6/9] İlan kalıcı olarak güncellendi: ID sabit, başlık güncel, fotoğraf sayısı doğru (1)");

  // İlan bağlantısı değişmedi mi (aynı /ilanlar/edit-job-past hâlâ çalışıyor mu)
  await page.goto(`${BASE_URL}/ilanlar/edit-job-past`);
  await assert.doesNotReject(page.getByText("Duzenleme Test - GUNCELLENDI").waitFor({ state: "visible", timeout: 10000 }));
  ok("İlan bağlantısı (/ilanlar/edit-job-past) değişmeden çalışmaya devam ediyor, güncel başlığı gösteriyor");

  // --- 7/8) Teklifli ilanı düzenle, teklif ve bildirim korunuyor mu ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  const offerJobCard = page.locator("li").filter({ hasText: /Duzenleme Test - Teklifli Ilan/i });
  await offerJobCard.getByRole("link", { name: "İlanı Düzenle" }).click();
  await page.waitForURL(/\/duzenle$/);
  const offerJobDescTextarea = page.locator("textarea").first();
  await offerJobDescTextarea.fill("Bu aciklama duzenleme sonrasi guncellendi, en az yirmi karakter.");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/panel\/hizmet-taleplerim\?guncellendi=1/, { timeout: 10000 });

  const offersAfterEdit = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId === "edit-job-offer"),
  );
  assert.equal(offersAfterEdit.length, 1, "[7] İlan düzenlendikten sonra teklif silinmemeli");
  ok("[7] Teklifler ilan düzenlendikten sonra korunuyor (silinmedi)");

  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await assert.doesNotReject(
    page.getByText(/Duzenleme Test - Teklifli Ilan/i).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[7] Gelen Teklifler sayfası düzenlenmiş ilan için teklifi hâlâ doğru gösteriyor");

  await page.getByRole("button", { name: /Bildirimler/ }).click();
  const notifLink = page.getByRole("menuitem", { name: /Duzenleme Test - Teklifli Ilan/i }).first();
  await assert.doesNotReject(notifLink.waitFor({ state: "visible", timeout: 5000 }));
  const notifHref = await notifLink.getAttribute("href");
  assert.ok(notifHref && notifHref.startsWith("/panel/gelen-teklifler?offerId="), `[8] Bildirim linki geçerli olmalı: ${notifHref}`);
  ok("[8] Bildirimler ilan düzenlendikten sonra da bozulmadı, doğru linke işaret ediyor");

  // --- 10) Responsive: mobilde düzenleme formu ---
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/edit-job-future/duzenle`);
  await page.waitForTimeout(500);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.ok(!mobileOverflow, "Mobilde düzenleme formunda yatay taşma olmamalı");
  ok("[10] Mobil görünümde düzenleme formu taşma yapmıyor");
  await page.setViewportSize({ width: 1280, height: 800 });

  if (consoleErrors.length > 0) {
    console.log("\n[edit-job-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[edit-job-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate(() => {
    const ids = new Set(["edit-job-future", "edit-job-past", "edit-job-offer"]);
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.has(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.has(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  });
  await page.evaluate(async () => {
    const req = indexedDB.deleteDatabase("malsevk-photo-blobs");
    await new Promise((resolve) => { req.onsuccess = resolve; req.onerror = resolve; req.onblocked = resolve; });
  });

  await browser.close();
  console.log(`\n[edit-job-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[edit-job-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
