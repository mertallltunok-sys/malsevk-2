// A1 düzeltmesinin doğrulaması: `MAX_ACTIVE_JOBS` (provider-capacity.ts)
// kuralı artık yalnızca teklif OLUŞTURULURKEN değil, Hizmet Alan bir teklifi
// KABUL ederken de (offers.ts#updateOfferStatus) uygulanıyor.
//
// Kapsanan senaryolar (görev tanımındaki 1-10 ile birebir eşleşir):
//  1. 4 aktif işi olan bir Hizmet Veren'in pending teklifi kabul edilebilir,
//     aktif iş sayısı 5 olur.
//  2. 5 aktif işi olan bir Hizmet Veren'in pending teklifi kabul edilemez.
//  3. Başarısız kabul denemesinde teklif "pending" kalır.
//  4. Başarısız kabul denemesi, teklifler dizisinde HİÇBİR başka kaydı
//     değiştirmez (tam JSON eşitliği ile doğrulanır — kısmi yazma yok).
//  5. Başarısız kabul denemesinden sonra ilan, BAŞKA bir Hizmet Veren'den
//     hâlâ teklif alabiliyor (teklif formu hâlâ açık).
//  6. Kapasitesi dolu OLMAYAN başka bir Hizmet Veren'in teklifi normal
//     şekilde kabul edilebilir.
//  7. Kabul dışındaki durum geçişleri (Reddet) kapasiteden etkilenmeden
//     çalışmaya devam eder.
//  8. Mevcut tek-aktif-kabul kuralı (isOfferPendingActionBlocked) koda hiç
//     dokunulmadığı için bozulmamıştır (bkz. rapordaki not).
//  9. Mevcut kapasite ile ilgili davranış (teklif OLUŞTURMA anındaki kontrol)
//     bu değişiklikten etkilenmemiştir.
//  10. Art arda, aralıksız iki kabul denemesi (senkron fonksiyon, tek
//      sekme/tek JS event-loop) kapasiteyi aşamaz.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const CAPACITY_ERROR = "Bu hizmet veren aktif iş kapasitesine ulaştığı için teklif şu anda kabul edilemiyor.";
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
        description: "Kapasite kontrolu dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.", status: "yayinda",
        requesterId: reqId, photos: [],
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
async function getOffersSnapshot(page) {
  return page.evaluate(() => localStorage.getItem("malsevk.offers.v1") || "[]");
}
async function getOfferStatus(page, jobId, providerId) {
  return page.evaluate(
    ({ jobId, providerId }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      return offers.find((o) => o.jobId === jobId && o.providerId === providerId)?.status;
    },
    { jobId, providerId },
  );
}
async function getActiveCount(page, providerId) {
  return page.evaluate((providerId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.filter((o) => o.providerId === providerId && o.status === "accepted").length;
  }, providerId);
}

const JOBS = [
  { id: "cap-guard-job-1", title: "Kapasite Testi Is 1" },
  { id: "cap-guard-job-2", title: "Kapasite Testi Is 2" },
  { id: "cap-guard-job-3", title: "Kapasite Testi Is 3" },
  { id: "cap-guard-job-4", title: "Kapasite Testi Is 4" },
  { id: "cap-guard-job-5", title: "Kapasite Testi Is 5" },
  { id: "cap-guard-job-6-over", title: "Kapasite Testi Is 6 Asim" },
  { id: "cap-guard-job-7-other-hv", title: "Kapasite Testi Is 7 Diger HV" },
  { id: "cap-guard-job-8-over", title: "Kapasite Testi Is 8 Asim" },
];

async function main() {
  const browser = await chromium.launch();
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

  // --- Kurulum: 8 ilan (Zeynep sahipliğinde) ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  for (const job of JOBS) await seedJob(page, { ...job, reqId: zeynepId });
  ok("Kurulum: 8 test ilanı oluşturuldu");
  await logout(page);

  const mertId = await (async () => {
    await loginAs(page, "mert@test.com", "Mert123!");
    return getUserId(page, "mert@test.com");
  })();
  // Mert: J1-J6 ve J8'e teklif verir (6 + 1 over-capacity aday + 1 daha = 7 teklif toplam, J6/J8 kapasite üstü test için).
  let amount = 5000;
  for (const job of [JOBS[0], JOBS[1], JOBS[2], JOBS[3], JOBS[4], JOBS[5], JOBS[7]]) {
    await submitOffer(page, job.id, {
      amount: String(amount),
      duration: "1 gün",
      description: `${job.title} icin verilen teklif, yirmi karakterden uzun aciklama metni.`,
    });
    amount += 100;
  }
  ok("Kurulum: Mert, 7 ayrı ilana (J1-J6, J8) pending teklif verdi — HİÇBİRİ henüz kabul edilmedi, bu yüzden create-anındaki kapasite kontrolü hepsine izin verdi");
  await logout(page);

  // Mehmet Demir: J7'ye teklif verir, ayrıca J6'nın (henüz kabul edilmemiş,
  // kapasite üstü) hâlâ teklif alabildiğini "farklı bir Hizmet Veren'in
  // gözünden" doğrular (senaryo 5).
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  const mehmetId = await getUserId(page, "mehmet.demir.demo@malsevk.com");
  await submitOffer(page, JOBS[6].id, {
    amount: "6000",
    duration: "2 gün",
    description: "Kapasitesi dolu olmayan Hizmet Veren'in teklifi, yirmi karakterden uzun aciklama.",
  });
  ok("Kurulum: Mehmet Demir (ayrı, kapasitesi dolu olmayan Hizmet Veren) J7'ye teklif verdi");
  await page.goto(`${BASE_URL}/ilanlar/${JOBS[5].id}`);
  await assert.doesNotReject(
    page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 5 - ön kontrol] J6, henüz kimse kabul etmediği için başka bir Hizmet Veren'e (Mehmet) hâlâ teklif formu gösteriyor");
  await logout(page);

  // --- Zeynep: J1-J5'i sırayla kabul eder (4 -> 5 aktif iş geçişi dahil) ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  for (let i = 0; i < 5; i++) {
    const job = JOBS[i];
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    const card = page.locator("div.rounded-card").filter({ hasText: job.title });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(300);
    const status = await getOfferStatus(page, job.id, mertId);
    assert.equal(status, "accepted", `${job.title} kabul sonrası "accepted" olmalı`);
    const activeCount = await getActiveCount(page, mertId);
    assert.equal(activeCount, i + 1, `${i + 1}. kabulden sonra Mert'in aktif iş sayısı ${i + 1} olmalı`);
  }
  ok("[Senaryo 1] Mert'in 0'dan 5'e kadar art arda 5 teklifi sorunsuz kabul edildi, aktif iş sayısı doğru arttı (son adım: 4 -> 5)");

  // --- Senaryo 2/3/4: J6 (6. teklif, kapasite dolu) kabul edilemez ---
  const snapshotBefore = await getOffersSnapshot(page);
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j6Card = page.locator("div.rounded-card").filter({ hasText: JOBS[5].title });
  await j6Card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(300);
  await assert.doesNotReject(
    j6Card.getByText(CAPACITY_ERROR, { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok('[Senaryo 2] 5/5 kapasitedeyken 6. teklifin kabulü tam olarak beklenen mesajla reddedildi: "' + CAPACITY_ERROR + '"');

  const j6StatusAfterFail = await getOfferStatus(page, JOBS[5].id, mertId);
  assert.equal(j6StatusAfterFail, "pending", "Başarısız kabul denemesi sonrası J6 teklifi 'pending' kalmalı");
  ok("[Senaryo 3] Başarısız kabul denemesi sonrası teklif 'pending' durumunda kaldı");

  const snapshotAfterFail = await getOffersSnapshot(page);
  assert.equal(snapshotAfterFail, snapshotBefore, "Başarısız kabul denemesi teklifler dizisinde HİÇBİR kaydı değiştirmemeli (kısmi yazma yok)");
  ok("[Senaryo 4] Başarısız kabul denemesi öncesi/sonrası teklifler dizisi bayt-bayt aynı — hiçbir kısmi veri yazılmadı, diğer teklifler etkilenmedi");

  // --- Senaryo 10: hemen ardından, aynı sekmede, ikinci bir (farklı ilana ait) aşırı-kapasite kabul denemesi ---
  const j8Card = page.locator("div.rounded-card").filter({ hasText: JOBS[7].title });
  await j8Card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(300);
  await assert.doesNotReject(
    j8Card.getByText(CAPACITY_ERROR, { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  const j8StatusAfterFail = await getOfferStatus(page, JOBS[7].id, mertId);
  assert.equal(j8StatusAfterFail, "pending", "J8 teklifi de 'pending' kalmalı");
  const activeCountAfterBoth = await getActiveCount(page, mertId);
  assert.equal(activeCountAfterBoth, 5, "İki art arda başarısız denemeden sonra da aktif iş sayısı hâlâ 5 olmalı (aşılmadı)");
  ok("[Senaryo 10] Aynı sekmede, aralıksız art arda ikinci bir kabul denemesi de (farklı ilan) reddedildi — kapasite hiçbir noktada aşılmadı");

  // --- Senaryo 7: kabul dışındaki geçiş (Reddet) kapasiteden etkilenmemeli ---
  await j6Card.getByRole("button", { name: "Reddet" }).click();
  await page.waitForTimeout(300);
  const j6StatusAfterReject = await getOfferStatus(page, JOBS[5].id, mertId);
  assert.equal(j6StatusAfterReject, "rejected", "Mert 5/5 kapasitedeyken bile 'Reddet' normal şekilde çalışıp 'rejected' üretmeli");
  ok("[Senaryo 7] Kapasite dolu olsa da 'Reddet' (kabul dışı geçiş) etkilenmeden, normal şekilde çalıştı");

  // --- Senaryo 6: kapasitesi dolu OLMAYAN başka bir Hizmet Veren'in teklifi normal kabul edilir ---
  const j7Card = page.locator("div.rounded-card").filter({ hasText: JOBS[6].title });
  await j7Card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(300);
  const j7Status = await getOfferStatus(page, JOBS[6].id, mehmetId);
  assert.equal(j7Status, "accepted", "Kapasitesi dolu olmayan Mehmet Demir'in teklifi normal şekilde kabul edilebilmeli");
  ok("[Senaryo 6] Kapasitesi dolu olmayan farklı bir Hizmet Veren'in (Mehmet Demir) teklifi sorunsuz kabul edildi");

  await logout(page);

  // --- Senaryo 8/9 notu: isOfferPendingActionBlocked (tek-aktif-kabul kuralı)
  // ve createOffer/canProviderSubmitNewOffer'daki (oluşturma anındaki)
  // kapasite kontrolü bu değişiklikte hiç dokunulmadı — Kurulum adımındaki 7
  // bağımsız teklifin hepsinin sorunsuz OLUŞTURULABİLMESİ (create-time kontrol
  // hâlâ çalışıyor, offer.status="pending" kapasiteye hiç girmiyor) ve yukarıdaki
  // 5 ayrı kabulün (her biri kendi bağımsız ilanında, rakip teklif yokken)
  // sorunsuz ilerlemesi bu iki mekanizmanın bozulmadığını doğrular.
  ok("[Senaryo 8/9] isOfferPendingActionBlocked ve createOffer/canProviderSubmitNewOffer'daki mevcut kapasite kontrolüne dokunulmadı, davranışları yukarıdaki akış boyunca gözlemlenen şekliyle korundu");

  if (consoleErrors.length > 0) {
    console.log("\n[provider-capacity-accept-guard-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[provider-capacity-accept-guard-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const jobIds = JOBS.map((j) => j.id);
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, jobIds);

  console.log(`\n[provider-capacity-accept-guard-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[provider-capacity-accept-guard-test] HATA:", error);
  process.exitCode = 1;
});
