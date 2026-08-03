// "Aktif İlanlar" (provider-job-listing.tsx) ekranındaki görünürlük
// kuralının, TAMAMLANMA ile birlikte MANUEL KAPATMAYI (job-closure.ts) da
// kapsayacak şekilde düzeltilmesinin doğrulaması — bkz. job-completion.ts#
// isJobFullyCompletedForListing (ve yeni isOperationSiblingResolvedForListing
// yardımcısı). Önceki tur (tmp-active-listing-title-completion-visibility-
// test.mjs / tmp-operation-listing-completion-responsive-test.mjs) yalnızca
// "TÜM kardeşler GERÇEKTEN tamamlandı" senaryosunu kapsıyordu; bu senaryoda
// hâlâ doğru çalışıyordu. Gerçek hata, bir operasyonun kardeşlerinden bazıları
// TAMAMLANMADAN (yalnızca "İlanı Kapat" ile) kapatıldığında ortaya çıkıyordu:
// eski kod yalnızca "tamamlandi" bucket'ını sayıyordu, bu yüzden tamamı
// tamamlanmış+kapatılmış (hiçbiri "tamamlandi" olmayan) bir operasyon hiçbir
// zaman "hepsi bitti" sayılmıyor, tek gerçekten tamamlanmış kardeş "hayalet"
// bir tekil ilan gibi Aktif İlanlar'da kalıyordu.
//
// Kapsanan senaryolar (görev tanımındaki liste ile eşleşir):
//  1. Tekli aktif ilan görünür.
//  2. Tekli hizmet tamamlanınca Aktif İlanlar'dan kalkar.
//  3. Tekli ilan "İlanı Kapat" ile kapatılınca Aktif İlanlar'dan kalkar (YENİ).
//  4. Üç hizmetli operasyonda 1 tamamlanmış + 1 kapatılmış + 1 hâlâ açık
//     kardeş varken operasyon KALIR ve yalnızca gerçekten açık kardeği
//     sayan "Operasyon • 1 Hizmet Arıyor" gösterir (kapatılmış kardeş sayaca
//     dahil edilmez).
//  5. Aynı operasyonun son açık kardeği de tamamlanınca (artık 2 tamamlanmış
//     + 1 kapatılmış, hiçbiri gerçekten açık değil) operasyon TAMAMEN kalkar
//     (asıl hata buradaydı).
//  6. Kalkan operasyonun gerçek başlıkları hiçbir yerde görünmez, "Operasyon
//     Tamamlandı" / "0 Hizmet Arıyor" gibi bir metin de hiç yok.
//  7. Masaüstü (tablo) ve mobil (kart) görünümü aynı sonucu üretir.
//  8. Kapatılan tekli ilan "Hizmet Taleplerim > Kapatılan İlanlar" sekmesinde,
//     tamamlanan operasyon hizmetleri "Hizmet Taleplerim > Tamamlandı" /
//     "Verdiğim Teklifler > Tamamlanan" sekmelerinde korunur (veri silinmedi).
//  9. Kontrol operasyonu (hiçbir kardeşi dokunulmamış) bu değişikliklerden
//     etkilenmez.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

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
async function logout(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
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
// Bir operasyonun/tekil ilanın kendi satırını (masaüstü <tr> ya da mobil
// <li>) birincil hizmetinin GERÇEK job.title'ından bulur — sayfada aynı anda
// başka bir operasyonun/ilanın da AYNI rozet metnini ("Operasyon • N Hizmet
// Arıyor") taşıyabileceği durumlarda (ör. iki farklı operasyon aynı anda 2
// kalan hizmet gösteriyorsa) sayfa geneli metin aramasının belirsiz
// (strict-mode-violation) olmasını önlemek için.
function operationRowByTitle(page, title) {
  return page.getByRole("link", { name: title }).locator("xpath=ancestor::*[self::tr or self::li]").first();
}
async function seedJob(page, { id, title, category, reqId, operationId, closedAt, closureReason }) {
  await page.evaluate(
    ({ id, title, category, reqId, operationId, closedAt, closureReason }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Kapatma + tamamlanma karma gorunurluk testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
        ...(operationId ? { operationId } : {}),
        ...(closedAt ? { closedAt, closureReason: closureReason ?? "hizmete-ihtiyac-kalmadi" } : {}),
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, reqId, operationId, closedAt, closureReason },
  );
}
async function seedOffer(page, { id, jobId, providerId, status }) {
  await page.evaluate(
    ({ id, jobId, providerId, status }) => {
      const raw = localStorage.getItem("malsevk.offers.v1");
      const offers = raw ? JSON.parse(raw) : [];
      const now = new Date().toISOString();
      offers.push({
        id,
        jobId,
        providerId,
        amount: 5000,
        currency: "TRY",
        description: "Test teklifi - kapatma + tamamlanma karma dogrulamasi icin.",
        estimatedDuration: "2 gun",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { id, jobId, providerId, status },
  );
}

// Senaryo 1/2: tekli aktif ilan (dokunulmayacak) + tamamlanacak tekli ilan.
const SINGLE_ACTIVE = { id: "cvis-single-active", title: "Cvis Tekli Aktif Depolama", category: "genel-depolama" };
const SINGLE_COMPLETE = { id: "cvis-single-complete", title: "Cvis Tekli Tamamlanacak Lashing", category: "lashing" };

// Senaryo 3 (YENİ): tekli ilan, doğrudan "İlanı Kapat" ile kapatılmış (hiç teklifi yok).
const SINGLE_CLOSED = { id: "cvis-single-closed", title: "Cvis Tekli Kapatilan Forklift", category: "forklift" };

// Senaryo 4/5 (ASIL HATA): 3 hizmetli operasyon — Nakliye BAŞTAN tamamlanmış,
// Forklift kapatılacak (ama hiç tamamlanmadan), Lashing başta hâlâ açık.
const MIX_OP_ID = "cvis-mixed-operation";
const MIX_NAKLIYE = { id: "cvis-mix-nakliye", title: "Cvis Mix Nakliye Tamamlandi", category: "nakliye" };
const MIX_FORKLIFT = { id: "cvis-mix-forklift", title: "Cvis Mix Forklift Kapatilacak", category: "forklift" };
const MIX_LASHING = { id: "cvis-mix-lashing", title: "Cvis Mix Lashing Son Acik", category: "lashing" };

// Kontrol operasyonu: hiç dokunulmayacak, sonuna kadar aktif kalmalı.
const CONTROL_OP_ID = "cvis-control-operation";
const CONTROL_A = { id: "cvis-ctrl-vinc", title: "Cvis Control Vinc", category: "vinc" };
const CONTROL_B = { id: "cvis-ctrl-kdolum", title: "Cvis Control Kdolum", category: "konteyner-dolum" };

const ALL_JOB_IDS = [
  SINGLE_ACTIVE.id,
  SINGLE_COMPLETE.id,
  SINGLE_CLOSED.id,
  MIX_NAKLIYE.id,
  MIX_FORKLIFT.id,
  MIX_LASHING.id,
  CONTROL_A.id,
  CONTROL_B.id,
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
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Kurulum: Zeynep (hizmet-alan) ilanları oluşturur ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...SINGLE_ACTIVE, reqId: zeynepId });
  await seedJob(page, { ...SINGLE_COMPLETE, reqId: zeynepId });
  await seedJob(page, { ...SINGLE_CLOSED, reqId: zeynepId, closedAt: new Date().toISOString() });
  await seedJob(page, { ...MIX_NAKLIYE, reqId: zeynepId, operationId: MIX_OP_ID });
  await seedJob(page, { ...MIX_FORKLIFT, reqId: zeynepId, operationId: MIX_OP_ID });
  await seedJob(page, { ...MIX_LASHING, reqId: zeynepId, operationId: MIX_OP_ID });
  await seedJob(page, { ...CONTROL_A, reqId: zeynepId, operationId: CONTROL_OP_ID });
  await seedJob(page, { ...CONTROL_B, reqId: zeynepId, operationId: CONTROL_OP_ID });
  await logout(page);
  ok("Kurulum: tekli aktif/tamamlanacak/kapatılan ilanlar + karma operasyon (3 hizmet) + kontrol operasyonu (2 hizmet) oluşturuldu");

  // --- Mert (hizmet-veren) teklifleri verir / durumları oluşturur ---
  await loginAs(page, "mert@test.com", "Mert123!");
  const mertId = await getUserId(page, "mert@test.com");
  await seedOffer(page, { id: "cvis-offer-single-complete", jobId: SINGLE_COMPLETE.id, providerId: mertId, status: "completed" });
  await seedOffer(page, { id: "cvis-offer-mix-nakliye", jobId: MIX_NAKLIYE.id, providerId: mertId, status: "completed" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/ilanlar`);

  // --- Senaryo 1: tekli aktif ilan görünür ---
  await page.getByRole("link", { name: SINGLE_ACTIVE.title }).waitFor({ state: "visible", timeout: 10000 });
  ok("[Senaryo 1] Tekli aktif ilan Aktif İlanlar'da görünüyor");

  // --- Senaryo 2: tamamlanan tekli ilan kalkmış olmalı (kurulumda zaten "completed") ---
  const completedSingleGone = await page.getByText(SINGLE_COMPLETE.title).count();
  assert.equal(completedSingleGone, 0, "Tamamlanan tekli ilan Aktif İlanlar'da görünmemeli");
  ok("[Senaryo 2] Tamamlanan tekli ilan Aktif İlanlar'dan kalkmış");

  // --- Senaryo 3 (YENİ): kapatılan tekli ilan kalkmış olmalı ---
  const closedSingleGone = await page.getByText(SINGLE_CLOSED.title).count();
  assert.equal(closedSingleGone, 0, "İlanı Kapat ile kapatılan tekli ilan Aktif İlanlar'da HİÇ görünmemeli");
  ok('[Senaryo 3] "İlanı Kapat" ile kapatılan tekli ilan Aktif İlanlar\'dan kalkmış (YENİ davranış)');

  // --- Senaryo 4: karma operasyon (henüz Forklift kapatılmadı) hâlâ görünür,
  // Nakliye zaten tamamlandığı için başlangıçta "Operasyon • 2 Hizmet Arıyor" ---
  // NOT: kontrol operasyonu da (dokunulmamış, 2 hizmet) AYNI metni taşıyabilir
  // — bu yüzden sayfa geneli değil, karma operasyonun KENDİ satırı (birincil
  // hizmeti Nakliye'nin gerçek job.title'ından bulunur) kontrol edilir.
  const mixRowBefore = operationRowByTitle(page, MIX_NAKLIYE.title);
  await mixRowBefore.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 4 - ön koşul] Karma operasyon (1/3 tamamlandı) "Operasyon • 2 Hizmet Arıyor" gösteriyor');

  // Forklift'i şimdi (hiç tamamlanmadan) KAPAT.
  await page.evaluate(
    ({ jobId }) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const job = jobs.find((j) => j.id === jobId);
      job.closedAt = new Date().toISOString();
      job.closureReason = "hizmete-ihtiyac-kalmadi";
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId: MIX_FORKLIFT.id },
  );
  await page.goto(`${BASE_URL}/ilanlar`);

  // Operasyon hâlâ görünmeli (Lashing hâlâ gerçekten açık) — rozet artık
  // yalnızca GERÇEKTEN açık kardeşi (Lashing) saymalı: "Operasyon • 1 Hizmet
  // Arıyor" (Forklift kapatıldığı için sayaca dahil edilmemeli). Kontrol
  // operasyonu bu noktada da hâlâ kendi "Operasyon • 2 Hizmet Arıyor"
  // rozetini taşıdığından (dokunulmamış, bkz. Senaryo 9), kontrol sayfa
  // geneli değil KARMA operasyonun kendi satırı üzerinde yapılır.
  const mixRowAfterClose = operationRowByTitle(page, MIX_NAKLIYE.title);
  await mixRowAfterClose.getByText("Operasyon • 1 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const stillTwoInMixRow = await mixRowAfterClose.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).count();
  assert.equal(stillTwoInMixRow, 0, "Kapatılan Forklift artık karma operasyonun kendi 'kalan' sayaca dahil edilmemeli");
  ok('[Senaryo 4] 1 tamamlanmış + 1 kapatılmış + 1 açık kardeşli operasyon KALIYOR ve doğru şekilde "Operasyon • 1 Hizmet Arıyor" gösteriyor (kapatılan kardeş sayılmıyor)');

  await page.getByRole("link", { name: MIX_NAKLIYE.title }).waitFor({ state: "visible", timeout: 10000 });
  ok("Karma operasyonun gerçek başlığı (ilk hizmet) hâlâ görünüyor");

  // --- Senaryo 5 (ASIL HATA): son açık kardeş (Lashing) de tamamlanınca —
  // artık 2 tamamlanmış + 1 kapatılmış, HİÇBİRİ gerçekten açık değil —
  // operasyon TAMAMEN kalkmalı. ---
  await seedOffer(page, { id: "cvis-offer-mix-lashing", jobId: MIX_LASHING.id, providerId: mertId, status: "completed" });
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByText(/Aktif İlan$/).waitFor({ state: "visible", timeout: 10000 });

  for (const job of [MIX_NAKLIYE, MIX_FORKLIFT, MIX_LASHING]) {
    const stillVisible = await page.getByText(job.title).count();
    assert.equal(stillVisible, 0, `"${job.title}" (karma operasyonun bir hizmeti) artık Aktif İlanlar'da hiçbir yerde görünmemeli`);
  }
  // Sayfada artık YALNIZCA kontrol operasyonunun rozeti kalmış olmalı (2
  // hizmet, dokunulmamış) — karma operasyona ait hiçbir rozet (0/1/2 fark
  // etmez) kalmamalı. Tek tek rozet metinlerini toplayıp kontrol operasyonu
  // DIŞINDAKİ herhangi bir "Operasyon • N Hizmet Arıyor" olup olmadığına
  // bakılır (sayfa geneli exact-text araması artık güvenli, çünkü iki farklı
  // operasyon aynı anda aynı metni TAŞIMIYOR: karma operasyon tamamen
  // kalktı, yalnızca kontrol operasyonu kaldı).
  const allOperationBadges = await page.getByText(/^Operasyon • \d+ Hizmet Arıyor$/).allInnerTexts();
  assert.deepEqual(
    allOperationBadges,
    ["Operasyon • 2 Hizmet Arıyor"],
    `Sayfada yalnızca kontrol operasyonunun rozeti kalmalı, gelen: ${JSON.stringify(allOperationBadges)}`,
  );
  ok("[Senaryo 5] ASIL HATA DÜZELTMESİ: 2 tamamlanmış + 1 kapatılmış (hiçbiri gerçekten açık değil) operasyon Aktif İlanlar'dan TAMAMEN kalktı — eskiden burada tamamlanan Nakliye hayalet bir tekil ilan gibi kalıyordu");

  // --- Senaryo 6: "Operasyon Tamamlandı" / "0 Hizmet Arıyor" hiçbir yerde yok ---
  const bodyText = await page.locator("body").innerText();
  assert.ok(!bodyText.includes("Operasyon Tamamlandı"), "'Operasyon Tamamlandı' yazısı sayfada HİÇ olmamalı");
  assert.ok(!/Operasyon • 0 Hizmet Arıyor/.test(bodyText), "'Operasyon • 0 Hizmet Arıyor' yazısı sayfada HİÇ olmamalı");
  ok('[Senaryo 6] "Operasyon Tamamlandı" ve "Operasyon • 0 Hizmet Arıyor" metinleri sayfanın hiçbir yerinde yok');

  // --- Senaryo 9: kontrol operasyonu hâlâ tam ve etkilenmemiş ---
  await page.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: CONTROL_A.title }).waitFor({ state: "visible", timeout: 10000 });
  ok("[Senaryo 9] Kontrol operasyonu (hiçbir kardeşi dokunulmamış) hâlâ aktif ve tam görünüyor");

  // --- Senaryo 7: mobil kart görünümünde de AYNI sonuç ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForSelector('ul[role="list"]', { timeout: 10000 });
  for (const job of [MIX_NAKLIYE, MIX_FORKLIFT, MIX_LASHING, SINGLE_CLOSED, SINGLE_COMPLETE]) {
    const stillVisibleMobile = await page.getByText(job.title).count();
    assert.equal(stillVisibleMobile, 0, `[Mobil] "${job.title}" Aktif İlanlar'da görünmemeli`);
  }
  await page.getByRole("link", { name: SINGLE_ACTIVE.title }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const mobileBodyText = await page.locator("body").innerText();
  assert.ok(!mobileBodyText.includes("Operasyon Tamamlandı"), "[Mobil] 'Operasyon Tamamlandı' yok");
  ok("[Senaryo 7] Mobil kart görünümü masaüstüyle AYNI sonucu üretiyor (aynı gizli/görünür ilanlar)");

  await logout(page);

  // --- Senaryo 8: kapatılan/tamamlanan kayıtlar geçmiş ekranlarında korunuyor ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel/hizmet-taleplerim");
  await page.getByRole("tab", { name: "Kapatılan İlanlar" }).click();
  await page.getByText(SINGLE_CLOSED.title).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 8] Kapatılan tekli ilan "Hizmet Taleplerim > Kapatılan İlanlar" sekmesinde korunuyor (veri silinmedi)');

  await page.getByRole("tab", { name: "Tamamlanan" }).click();
  await page.getByText(SINGLE_COMPLETE.title).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText(MIX_NAKLIYE.title).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText(MIX_LASHING.title).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 8] Tamamlanan tekli ilan ve operasyon hizmetleri "Hizmet Taleplerim > Tamamlanan" sekmesinde korunuyor');
  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[active-listing-closed-plus-completed-visibility-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[active-listing-closed-plus-completed-visibility-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, ALL_JOB_IDS);
  await logout(page);

  console.log(`\n[active-listing-closed-plus-completed-visibility-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[active-listing-closed-plus-completed-visibility-test] HATA:", error);
  process.exitCode = 1;
});
