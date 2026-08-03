// "İlanı Kapat" (job-closure.ts) özelliğinin uçtan uca doğrulaması.
//
// Kapsanan senaryolar:
//  1. Hizmet Alan panelinde (Aktif sekmesi) "İlanı Kapat" butonu "İlanı Sil"in
//     yanında görünür ve "İlanı Sil"in davranışını hiç etkilemez.
//  2. Onay modalı doğru başlık/açıklama/dört seçenek/"geri alınamaz" uyarısını
//     gösterir; neden seçilmeden onay verilemez.
//  3. Kapatma sonrası: ilan "Aktif" sekmesinden kalkar, "Kapatılan İlanlar"
//     sekmesinde nedeniyle birlikte görünür; Job.status/teklif geçmişi/
//     bildirimler SİLİNMEZ (localStorage'da kayıt hâlâ mevcut).
//  4. Kapatılan ilana bağlı "pending" teklif "rejected"e döner (kayıt
//     SİLİNMEZ) ve Hizmet Veren'in "Verdiğim Teklifler" ekranında "Kapanan
//     Teklifler" sekmesine taşınır (artık "Aktif" sekmesinde görünmez).
//  5. "Başka bir hizmet verenle anlaşıldı" seçildiğinde etkilenen Hizmet
//     Veren'e TAM OLARAK "Hizmet Alan başka bir hizmet verenle anlaştı."
//     bildirimi gönderilir.
//  6. Kapatılan ilan, Hizmet Veren'in "Aktif İlanlar" (provider-job-listing)
//     listesinden kalkar — yeni teklif alamaz.
//  7. MALSEVK üzerinden işe başlanmış (in_progress) bir teklifi olan ilanda
//     "İlanı Kapat" butonu hiçbir sekmede gösterilmez (yalnızca "Aktif"
//     sekmesinde render edilir, o ilan artık "Devam Eden" sekmesindedir).
//  8. Aynı operasyondaki kardeş ilan kapatmadan etkilenmez.
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
async function seedJob(page, { id, title, reqId, operationId }) {
  await page.evaluate(
    ({ id, title, reqId, operationId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category: "depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Ilan kapatma dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
        ...(operationId ? { operationId } : {}),
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId, operationId },
  );
}
// DÜZELTME (Y7, veritabanı geçişi öncesi denetim): eski "Tahmini Hizmet
// Süresi" serbest-metin alanı kaldırıldı; yerine gelen "Tamamlanması
// Taahhüt Edilen Gün" (bir <select>, offer-form.tsx) yalnızca Nakliye
// kategorisindeki ilanlarda render edilir (bkz. offer-form.tsx#
// requiresEstimatedDuration = isTransportationCategory(job.category)).
// Bu testteki ilanların hepsi Depolama ("depolama") olduğu için bu alan
// hiç render EDİLMEZ — `duration` parametresi artık kullanılmıyor, geriye
// dönük uyumluluk için çağıranlarda hâlâ geçirilebilir ama yok sayılır.
async function submitOffer(page, jobId, { amount, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}
async function getJob(page, jobId) {
  return page.evaluate((jobId) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.id === jobId) ?? null;
  }, jobId);
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
async function setOfferStatus(page, jobId, providerId, status) {
  await page.evaluate(
    ({ jobId, providerId, status }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      const next = offers.map((o) =>
        o.jobId === jobId && o.providerId === providerId ? { ...o, status, updatedAt: new Date().toISOString() } : o,
      );
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
    },
    { jobId, providerId, status },
  );
}

// Başlıklar bilerek birbirinin ALT DİZESİ (substring) olmayacak şekilde
// seçildi — Playwright'ın `hasText` filtresi varsayılan olarak substring
// eşleştirir, bu yüzden ör. "Ilan A" başka bir kartın başlığında da geçseydi
// (ör. "Ilan A (operasyon ana)") `.filter({ hasText: "Ilan A" })` YANLIŞ
// kartı da eşleştirirdi.
const JOB_A = { id: "kapat-test-job-a", title: "Kapatma Testi Alfa Ilani" };
const JOB_B = { id: "kapat-test-job-b", title: "Kapatma Testi Beta Ilani Devam Eden" };
const OPERATION_ID = "kapat-test-operation-1";
const OPERATION_MAIN = { id: "kapat-test-operation-main", title: "Kapatma Testi Operasyon Ana Hizmeti" };
const JOB_SIBLING = { id: "kapat-test-job-sibling", title: "Kapatma Testi Operasyon Kardes Hizmeti" };

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

  // --- Kurulum ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...JOB_A, reqId: zeynepId });
  await seedJob(page, { ...JOB_B, reqId: zeynepId });
  await seedJob(page, { ...OPERATION_MAIN, reqId: zeynepId, operationId: OPERATION_ID });
  await seedJob(page, { ...JOB_SIBLING, reqId: zeynepId, operationId: OPERATION_ID });
  ok("Kurulum: test ilanları oluşturuldu (A: kapatılacak, B: işe başlanacak, operasyon çifti)");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  const mertId = await getUserId(page, "mert@test.com");
  await submitOffer(page, JOB_A.id, {
    amount: "5000",
    duration: "2 gün",
    description: "Ilan A icin teklif, yirmi karakterden uzun aciklama metni.",
  });
  await submitOffer(page, JOB_B.id, {
    amount: "6000",
    duration: "3 gün",
    description: "Ilan B icin teklif, yirmi karakterden uzun aciklama metni.",
  });
  ok("Kurulum: Mert, A ve B ilanlarına pending teklif verdi");
  await logout(page);

  // Mert'in B ilanındaki teklifini kabul edilmiş + işe başlanmış hâle getir.
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await setOfferStatus(page, JOB_B.id, mertId, "in_progress");

  // --- Senaryo 1/2: "İlanı Kapat" butonu ve modal ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  const cardA = page.locator("li").filter({ hasText: JOB_A.title }).first();
  await cardA.getByRole("button", { name: "İlanı Kapat" }).waitFor({ state: "visible" });
  await cardA.getByRole("button", { name: "İlanı Sil" }).waitFor({ state: "visible" });
  ok('[Senaryo 1] "İlanı Kapat" butonu "İlanı Sil"in yanında görünüyor');

  await cardA.getByRole("button", { name: "İlanı Kapat" }).click();
  const dialog = page.getByRole("dialog", { name: "İlanı Kapat" });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("Bu işlem ilanı yayından kaldıracaktır. Lütfen kapatma nedenini seçin.").waitFor({
    state: "visible",
  });
  await dialog.getByText("Başka bir hizmet verenle anlaşıldı").waitFor({ state: "visible" });
  await dialog.getByText("Hizmete artık ihtiyaç kalmadı").waitFor({ state: "visible" });
  await dialog.getByText("Yanlışlıkla oluşturuldu").waitFor({ state: "visible" });
  await dialog.getByText("Diğer", { exact: true }).waitFor({ state: "visible" });
  await dialog.getByText("Bu işlem geri alınamaz.").waitFor({ state: "visible" });
  ok("[Senaryo 2] Modal başlığı/açıklaması/dört seçenek/geri alınamaz uyarısı doğru gösteriliyor");

  await dialog.getByRole("button", { name: "Evet, İlanı Kapat" }).click();
  await dialog.getByText("Lütfen bir kapatma nedeni seçin.").waitFor({ state: "visible" });
  ok("[Senaryo 2] Neden seçilmeden onay verilemiyor — istemci tarafı doğrulama çalışıyor");

  await dialog.getByText("Başka bir hizmet verenle anlaşıldı").click();
  await dialog.getByRole("button", { name: "Evet, İlanı Kapat" }).click();
  await page.getByText("İlan başarıyla kapatıldı.").waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 2] "Başka bir hizmet verenle anlaşıldı" seçilip onaylandıktan sonra başarı banner\'ı gösterildi');

  // --- Senaryo 8: operasyondaki ANA hizmeti (teklifsiz) farklı bir nedenle
  // kapat — kardeş ilan kesinlikle etkilenmemeli.
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  const cardOpMain = page.locator("li").filter({ hasText: OPERATION_MAIN.title }).first();
  await cardOpMain.getByRole("button", { name: "İlanı Kapat" }).click();
  const opDialog = page.getByRole("dialog", { name: "İlanı Kapat" });
  await opDialog.waitFor({ state: "visible" });
  await opDialog.getByText("Hizmete artık ihtiyaç kalmadı").click();
  await opDialog.getByRole("button", { name: "Evet, İlanı Kapat" }).click();
  await page.getByText("İlan başarıyla kapatıldı.").waitFor({ state: "visible", timeout: 10000 });
  const opMainAfter = await getJob(page, OPERATION_MAIN.id);
  assert.equal(opMainAfter.closureReason, "hizmete-ihtiyac-kalmadi");
  const siblingAfterOpClose = await getJob(page, JOB_SIBLING.id);
  assert.equal(siblingAfterOpClose.closedAt, undefined, "Operasyondaki kardeş ilan kesinlikle etkilenmemeli");
  ok("[Senaryo 8] Operasyondaki ana hizmet farklı bir nedenle kapatıldı, kardeş ilan (aynı operationId) hiç etkilenmedi");

  // --- Senaryo 3: Aktif sekmesinden kalkma + Kapatılan İlanlar'da görünme ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page
      .locator("li")
      .filter({ hasText: JOB_A.title })
      .first()
      .waitFor({ state: "hidden", timeout: 3000 })
      .catch(() => {}),
  );
  const stillInAktif = await page.locator("li").filter({ hasText: JOB_A.title }).count();
  assert.equal(stillInAktif, 0, "Kapatılan ilan Aktif sekmesinde artık görünmemeli");
  ok('[Senaryo 3] Kapatılan ilan "Aktif" sekmesinden kalktı');

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=kapatildi`);
  const closedCard = page.locator("li").filter({ hasText: JOB_A.title }).first();
  await closedCard.waitFor({ state: "visible" });
  await closedCard.getByText("Kapatıldı").waitFor({ state: "visible" });
  await closedCard.getByText("Başka bir hizmet verenle anlaşıldı").waitFor({ state: "visible" });
  ok('[Senaryo 3] "Kapatılan İlanlar" sekmesinde ilan, doğru nedenle birlikte görünüyor');

  const jobAAfter = await getJob(page, JOB_A.id);
  assert.equal(jobAAfter.status, "yayinda", "Job.status kapatmadan sonra da değişmemeli");
  assert.ok(jobAAfter.closedAt, "closedAt dolu olmalı");
  assert.equal(jobAAfter.closureReason, "baska-hizmet-verenle-anlasildi");
  ok("[Senaryo 3] Job.status değişmedi, kayıt silinmedi, closedAt/closureReason doğru yazıldı");

  const offerAStatus = await getOfferStatus(page, JOB_A.id, mertId);
  assert.equal(offerAStatus, "rejected", "Kapatılan ilana bağlı pending teklif 'rejected'e dönmeli, silinmemeli");
  ok("[Senaryo 4] Kapatılan ilana bağlı teklif 'rejected'e döndü (kayıt hâlâ mevcut, silinmedi)");
  await logout(page);

  // --- Senaryo 4/5/6: Hizmet Veren tarafı ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim?durum=kapanan-teklifler`);
  await page.locator("div.rounded-card").filter({ hasText: JOB_A.title }).first().waitFor({ state: "visible" });
  ok('[Senaryo 4] Kapatılan ilana verilen teklif "Verdiğim Teklifler > Kapanan Teklifler" sekmesinde görünüyor');

  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const stillInActiveOffers = await page.locator("div.rounded-card").filter({ hasText: JOB_A.title }).count();
  assert.equal(stillInActiveOffers, 0, "Kapatılan ilana ait teklif artık Aktif teklif listesinde görünmemeli");
  ok('[Senaryo 4] Aynı teklif artık "Aktif" teklif listesinde görünmüyor');

  await page.goto(`${BASE_URL}/panel/bildirimler`);
  await page.getByText("Hizmet Alan başka bir hizmet verenle anlaştı.").waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 5] Bildirim tam olarak "Hizmet Alan başka bir hizmet verenle anlaştı." metniyle gönderildi');

  await page.goto(`${BASE_URL}/ilanlar`);
  const stillInListing = await page.locator("body").locator(`text=${JOB_A.title}`).count();
  assert.equal(stillInListing, 0, "Kapatılan ilan Aktif İlanlar listesinde artık görünmemeli");
  ok('[Senaryo 6] Kapatılan ilan Hizmet Veren\'in "Aktif İlanlar" listesinden kalktı');
  await logout(page);

  // --- Senaryo 7: işe başlanmış (in_progress) bir ilanda "İlanı Kapat" hiç görünmez ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  const cardB = page.locator("li").filter({ hasText: JOB_B.title }).first();
  await cardB.waitFor({ state: "visible" });
  const closeButtonOnB = await cardB.getByRole("button", { name: "İlanı Kapat" }).count();
  assert.equal(closeButtonOnB, 0, '"İlanı Kapat" butonu, işe başlanmış bir ilanda (Devam Eden sekmesi) hiç render edilmemeli');
  ok('[Senaryo 7] İşe başlanmış (in_progress) bir teklifi olan ilanda "İlanı Kapat" butonu hiçbir sekmede gösterilmiyor');

  if (consoleErrors.length > 0) {
    console.log("\n[ilan-kapat-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[ilan-kapat-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const allJobIds = [JOB_A.id, JOB_B.id, OPERATION_MAIN.id, JOB_SIBLING.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, allJobIds);

  console.log(`\n[ilan-kapat-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[ilan-kapat-test] HATA:", error);
  process.exitCode = 1;
});
