// node scripts/tmp-devam-eden-completion-priority-test.mjs
//
// İki ilişkili düzeltmeyi GERÇEK arayüz akışlarıyla uçtan uca doğrular:
//
//   A) "Hizmet Taleplerim > Devam Eden" sekmesinde tamamlanma onayı bekleyen
//      (completion_requested) işler en üstte gösterilir — bkz. job-requests.ts#
//      isOfferAwaitingCompletionConfirmation. Birden fazla tamamlanma onayı
//      bekleyen iş varsa kendi aralarında MEVCUT (tarih tabanlı) sıralama
//      korunur; yeni bir tarih karşılaştırması İCAT EDİLMEZ. "Tamamlandığını
//      Onayla" ile onaylanan iş mevcut akışla Tamamlanan'a taşınır ve Devam
//      Eden'den kalkar.
//   B) Değerlendirme modalında (job-rating-modal.tsx) YALNIZCA ilgili işi
//      yapan (teklifi kabul edilmiş) Hizmet Veren'in kimliği (logo varsa
//      logo, yoksa baş-harf avatarı; firma adı varsa o, yoksa kullanıcı adı)
//      gösterilir.
//
// SENARYO (oluşturulma sırası ÖNEMLİ — useAllJobs() en-yeni-önce sıralar,
// bkz. use-jobs.ts):
//   1) İlan A (EN ESKİ) oluşturulur, kabul edilir, işe başlanır, Mert
//      tamamlandı bildirir (completion_requested).
//   2) İlan B (ORTA) oluşturulur, kabul edilir, işe başlanır — YALNIZCA
//      in_progress'te bırakılır (tamamlandı bildirilmez).
//   3) İlan C (EN YENİ) oluşturulur, kabul edilir, işe başlanır, Mert
//      tamamlandı bildirir (completion_requested).
//
// Düzeltme OLMASAYDI, "Devam Eden" saf oluşturulma sırasıyla (en yeni önce)
// [C, B, A] gösterirdi. Düzeltmeyle BEKLENEN sıra: tamamlanma onayı bekleyen
// ikili (C, A) — kendi ARALARINDAKİ mevcut (C daha yeni olduğu için C->A)
// sırayı koruyarak — en üstte, ardından yalnızca in_progress olan B: [C, A, B].
// Bu, hem "en üstte" kuralını (A, kronolojik olarak EN ESKİ olmasına rağmen,
// yalnızca in_progress olan B'nin ÜSTÜNE çıkar) hem "aralarında mevcut
// sıralama korunur" kuralını (C her zaman A'nın üstünde kalır) TEK bir
// senaryoda kanıtlar.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
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
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
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
        description: "Devam Eden onceliklendirme testi icin olusturulan ilan.",
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

async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function acceptOfferFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
}

async function startWorkFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
}

async function requestCompletionFor(page, jobTitle) {
  // "Tamamlandı Olarak İşaretle" yalnızca "Devam Eden" (in_progress) sekmesinde
  // görünür (bkz. my-offers-panel.tsx#getProviderOfferFilter) — sorgu
  // parametresi olmadan sayfa varsayılan "Aktif" sekmesine düşer, kart hiç
  // render edilmez ve buton araması zaman aşımına uğrar.
  await page.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
}

/** Devam Eden sekmesindeki kartları DOM sırasıyla, bilinen başlıklara göre eşleştirir. */
async function readDevamEdenOrder(page, titles) {
  const items = page.locator("li");
  const count = await items.count();
  const order = [];
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).innerText();
    const matchIndex = titles.findIndex((title) => text.includes(title));
    if (matchIndex !== -1) order.push(titles[matchIndex]);
  }
  return order;
}

const JOB_A = { id: "devam-eden-oncelik-a", title: "Devam Eden Öncelik Testi - A (En Eski)" };
const JOB_B = { id: "devam-eden-oncelik-b", title: "Devam Eden Öncelik Testi - B (Orta)" };
const JOB_C = { id: "devam-eden-oncelik-c", title: "Devam Eden Öncelik Testi - C (En Yeni)" };

async function main() {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    // Hata durumunda bile browser'ı kapat — aksi halde açık kalan
    // Playwright browser bağlantısı Node process'ini süresiz canlı tutar.
    await browser.close();
  }
}

async function run(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const loginMert = (p) => loginAs(p, "mert@test.com", "Mert123!");

  // =====================================================================
  // KURULUM: 3 ilan, oluşturulma sırasıyla (A en eski, C en yeni). Üçü de
  // kabul edilip işe başlanır; A ve C tamamlandı bildirilir (completion_requested),
  // B yalnızca in_progress'te bırakılır.
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  for (const job of [JOB_A, JOB_B, JOB_C]) {
    await seedJob(page, { ...job, reqId: zeynepId });
  }
  await logout(page);

  for (const job of [JOB_A, JOB_B, JOB_C]) {
    await loginMert(page);
    await submitOffer(page, job.id, {
      amount: "5000",
      duration: "1 gün",
      description: `${job.title} icin teklif, yirmi karakterden uzun aciklama metni.`,
    });
    await logout(page);

    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await acceptOfferFor(page, job.title);
    await startWorkFor(page, job.title);
    await logout(page);
  }
  ok("KURULUM: 3 ilan (A en eski, B orta, C en yeni) oluşturuldu, kabul edildi, işe başlandı");

  await loginMert(page);
  await requestCompletionFor(page, JOB_A.title);
  await requestCompletionFor(page, JOB_C.title);
  await logout(page);
  ok("KURULUM: Mert, A ve C için tamamlandı bildirdi (completion_requested); B yalnızca in_progress kaldı");

  // =====================================================================
  // TEST 1: Devam Eden sekmesinde sıra [C, A, B] olmalı — tamamlanma onayı
  // bekleyen ikili (C, A) en üstte, kendi aralarında mevcut (C->A, C daha
  // yeni) sırayı koruyarak; yalnızca in_progress olan B en altta.
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.waitForLoadState("networkidle");

  const order = await readDevamEdenOrder(page, [JOB_A.title, JOB_B.title, JOB_C.title]);
  assert.deepEqual(
    order,
    [JOB_C.title, JOB_A.title, JOB_B.title],
    "Tamamlanma onayı bekleyen (C, A) en üstte, aralarındaki mevcut sıra (C->A) korunmalı; yalnızca in_progress olan B en altta olmalı",
  );
  ok("TEST 1: Devam Eden sırası [C, A, B] — tamamlanma onayı bekleyenler üstte, aralarındaki mevcut sıra korunuyor, A (en eski) B'nin (yalnızca in_progress) üstüne çıkıyor");

  // =====================================================================
  // TEST 2: sayfa yenilendikten sonra da bu sıra korunuyor.
  // =====================================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  const orderAfterReload = await readDevamEdenOrder(page, [JOB_A.title, JOB_B.title, JOB_C.title]);
  assert.deepEqual(orderAfterReload, [JOB_C.title, JOB_A.title, JOB_B.title], "Sayfa yenilendikten sonra da sıra korunmalı");
  ok("TEST 2: sayfa yenilemesinden sonra da sıralama korundu");

  // =====================================================================
  // TEST 3: C'yi onayla — mevcut tamamlanma akışıyla Tamamlanan'a taşınır,
  // Devam Eden'den kalkar; A, B Devam Eden'de etkilenmeden kalır.
  // =====================================================================
  await page.getByRole("button", { name: "Tamamlandığını Onayla" }).first().click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);

  const cStatusAfterConfirm = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, JOB_C.id);
  assert.equal(cStatusAfterConfirm, "completed", "Onay sonrası C'nin offer.status'u 'completed' olmalı (mevcut akış)");
  ok("TEST 3: 'Tamamlandığını Onayla' ile C mevcut akışla 'completed' oldu");

  // Değerlendirme modalı otomatik açılır (mevcut davranış) — kapat, sonra
  // Devam Eden'i tekrar kontrol et.
  await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Daha Sonra" }).click();
  await page.waitForTimeout(300);

  const devamEdenAfterConfirm = await readDevamEdenOrder(page, [JOB_A.title, JOB_B.title, JOB_C.title]);
  assert.deepEqual(devamEdenAfterConfirm, [JOB_A.title, JOB_B.title], "C, Devam Eden'den KALKMALI (SAYFA YENİLEMEDEN); A ve B etkilenmeden kalmalı");
  ok("TEST 3 (devam): C, Devam Eden'den kalktı; A ve B (sırası [A, B] olarak) etkilenmeden kaldı");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(
    page.getByText(JOB_C.title).waitFor({ state: "visible", timeout: 10000 }),
    "C, Tamamlanan sekmesinde görünmeli",
  );
  ok("TEST 3 (devam): C, Tamamlanan sekmesine taşındı");

  // =====================================================================
  // TEST 4: değerlendirme modalında YALNIZCA ilgili (teklifi kabul edilmiş)
  // Hizmet Veren'in (Mert) kimliği görünür — firma profili boş olduğu için
  // kullanıcı adı ("Mert") + baş-harf avatarı ("M") beklenir.
  // =====================================================================
  const cCard = page.locator("li").filter({ hasText: JOB_C.title });
  await cCard.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
  await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });

  const dialog = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
  await assert.doesNotReject(
    dialog.getByText("Mert", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    "Modalda Mert'in adı (firma profili boş olduğu için kullanıcı adı) görünmeli",
  );
  ok("TEST 4: değerlendirme modalında ilgili Hizmet Veren'in adı ('Mert') görünüyor");

  await assert.doesNotReject(
    dialog.getByText("M", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    "Logo yüklenmediği için baş-harf avatarı ('M') görünmeli",
  );
  const logoImgCount = await dialog.locator("img").count();
  assert.equal(logoImgCount, 0, "Logo yüklenmediği için modalda hiçbir <img> olmamalı, yalnızca baş-harf avatarı");
  ok("TEST 4 (devam): logo yüklenmediği için mevcut tasarıma uygun baş-harf avatarı ('M') gösteriliyor, sahte/varsayılan logo görseli YOK");

  await page.getByRole("button", { name: "Daha Sonra" }).click();
  await page.waitForTimeout(300);

  assert.equal(consoleErrors.length, 0, `Konsolda JS hatası var: ${consoleErrors.join(" | ")}`);
  ok("Genel: konsolda hiç JS hatası yakalanmadı");

  // Temizlik
  const jobIds = [JOB_A.id, JOB_B.id, JOB_C.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !ids.includes(r.jobId));
    localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
  }, jobIds);

  await logout(page);
  console.log(`\n[tmp-devam-eden-completion-priority-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-devam-eden-completion-priority-test] HATA:", error);
  process.exitCode = 1;
});
