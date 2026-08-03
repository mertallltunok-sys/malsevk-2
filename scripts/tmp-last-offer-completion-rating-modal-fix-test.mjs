// node scripts/tmp-last-offer-completion-rating-modal-fix-test.mjs
//
// KRİTİK REGRESYON: bir teklif, Gelen Teklifler ekranındaki SON/TEK
// görünür teklifken "Tamamlandığını Onayla" ile onaylandığında,
// değerlendirme modalının (job-rating-modal.tsx) SESSİZCE hiç açılmaması
// hatasının düzeltmesini doğrular.
//
// KÖK NEDEN (bu görevin kapsamı DIŞINDA, önceden var olan bir hataydı —
// incoming-offers-panel.tsx'in Hizmet Türü -> İlan -> Teklifler gruplama
// refaktörüyle birlikte gelmiş, bu görevle İLGİSİZ): `onCompleted` ->
// `setRatingModalOffer` state'i ayarlansa bile, teklif artık "completed"
// olduğu için AYNI render'da `groups` de boşalıyordu (bkz. useMemo filtre
// zinciri) — eskiden bu durumda component `groups.length === 0` dalında
// ERKEN `return` ediyordu, bu da alttaki `{ratingModalOffer && <JobRatingModal/>}`
// render bloğuna hiç ulaşılmamasına yol açıyordu. Birden fazla teklif/şablon
// varken (yalnızca biri kalkarken) bu hata GİZLİ kalıyordu — `groups` o
// zaman hâlâ boş olmadığı için modal zaten görünüyordu; yalnızca "Gelen
// Teklifler'deki SON kalan teklif tamamlandı" özel durumunda ortaya
// çıkıyordu. DÜZELTME: modal/banner render'ı artık boş-durum dalının
// DIŞINDA, ortak üst gövdede — bkz. incoming-offers-panel.tsx.
//
// Aynı zamanda job-rating-modal.tsx'e eklenen firma kimliği görünümünü
// (logo/baş-harf avatarı + firma adı/kullanıcı adı) de doğrular.
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
        id, title, category: "Depolama", province: "Kocaeli", district: "Gebze",
        workLocationType: "Test Tesis", workDate: "2026-12-01",
        description: "Son teklif tamamlanma modali testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.", status: "yayinda", requesterId: reqId, photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId },
  );
}
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

const JOB = { id: "son-teklif-tamamlanma-modal-testi", title: "Son Teklif Tamamlanma Modalı Testi" };

async function main() {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const page = await (await browser.newContext()).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // =====================================================================
  // KURULUM: tek ilan, tek teklif — accepted -> in_progress -> completion_requested.
  // Bilinçli olarak TEK teklif/ilan: kritik senaryo tam olarak budur (Gelen
  // Teklifler'deki SON/TEK görünür teklifin tamamlanması).
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...JOB, reqId: zeynepId });
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOB.id, {
    amount: "5000",
    duration: "1 gün",
    description: `${JOB.title} icin teklif, yirmi karakterden uzun aciklama metni.`,
  });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: JOB.title });
  await card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
  await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
  await logout(page);
  ok("KURULUM: tek ilan, tek teklif — kabul edildi, işe başlandı");

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
  const providerCard = page.locator("div.rounded-card").filter({ hasText: JOB.title });
  await providerCard.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await providerCard.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
  await logout(page);
  ok("KURULUM: Mert tamamlandı bildirdi (completion_requested)");

  // =====================================================================
  // TEST 1: Gelen Teklifler'deki SON/TEK teklifi onayla — değerlendirme
  // modalı SESSİZCE kaybolmadan, SAYFA YENİLEMEDEN açılmalı.
  // =====================================================================
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();

  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
    "KRİTİK: son/tek teklif tamamlanınca değerlendirme modalı AÇILMALI (regresyon: eskiden 'Henüz gelen teklif yok.' erken dönüşü modalı gizliyordu)",
  );
  ok("TEST 1: Gelen Teklifler'deki SON/TEK teklif tamamlanınca değerlendirme modalı SAYFA YENİLEMEDEN açıldı");

  const statusAfterConfirm = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, JOB.id);
  assert.equal(statusAfterConfirm, "completed", "Onay sonrası offer.status 'completed' olmalı (mevcut akış, değişmedi)");
  ok("TEST 1 (devam): mevcut tamamlanma akışı (offer.status -> 'completed') değişmeden çalıştı");

  // Arka plandaki sayfa da doğru boş-durum mesajını gösteriyor olmalı
  // (modal bunun ÜSTÜNDE bir overlay'dir, ikisi ÇELİŞMEZ — aynı anda var
  // olmaları BEKLENEN davranıştır).
  await assert.doesNotReject(
    page.getByText("Henüz gelen teklif yok.").waitFor({ state: "visible", timeout: 5000 }),
    "Modalın ARKASINDAKİ sayfa da doğru şekilde boş-durum mesajını göstermeli (groups boşaldı)",
  );
  ok("TEST 1 (devam): modalın arkasındaki sayfa da doğru şekilde 'Henüz gelen teklif yok.' gösteriyor — ikisi çelişmeden bir arada");

  // =====================================================================
  // TEST 2: modalda YALNIZCA ilgili (teklifi kabul edilmiş) Hizmet Veren'in
  // kimliği görünür — firma profili boş olduğu için kullanıcı adı ("Mert")
  // + baş-harf avatarı ("M").
  // =====================================================================
  const dialog = page.getByRole("dialog", { name: "Hizmeti Değerlendir" });
  await assert.doesNotReject(
    dialog.getByText("Mert", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    "Modalda ilgili Hizmet Veren'in adı ('Mert') görünmeli",
  );
  await assert.doesNotReject(
    dialog.getByText("M", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    "Logo yüklenmediği için mevcut tasarıma uygun baş-harf avatarı ('M') görünmeli",
  );
  assert.equal(await dialog.locator("img").count(), 0, "Logo yok, modalda hiçbir <img> olmamalı");
  ok("TEST 2: modalda yalnızca ilgili Hizmet Veren'in kimliği (ad + baş-harf avatarı) görünüyor");

  // =====================================================================
  // TEST 3: puanla, kaydolduğunu doğrula.
  // =====================================================================
  const stars = page.getByRole("radio", { name: /yıldız/ });
  await stars.nth(4).click();
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await page.waitForTimeout(400);
  const rating = await page.evaluate((jobId) => {
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
    return ratings.find((r) => r.jobId === jobId);
  }, JOB.id);
  assert.ok(rating, "Rating kaydı oluşmalı");
  assert.equal(rating.stars, 5, "Rating.stars 5 olmalı");
  ok("TEST 3: değerlendirme başarıyla gönderildi ve kaydoldu");

  assert.equal(consoleErrors.length, 0, `Konsolda JS hatası var: ${consoleErrors.join(" | ")}`);
  ok("Genel: konsolda hiç JS hatası yakalanmadı");

  // Temizlik
  await page.evaluate((id) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => j.id !== id);
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId !== id);
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => r.jobId !== id);
    localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
  }, JOB.id);
  await logout(page);

  console.log(`\n[tmp-last-offer-completion-rating-modal-fix-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-last-offer-completion-rating-modal-fix-test] HATA:", error);
  process.exitCode = 1;
});
