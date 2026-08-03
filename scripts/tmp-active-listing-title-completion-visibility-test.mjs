// "Aktif İlanlar" (provider-job-listing.tsx) ekranındaki "Hizmet Türü"
// ROZETİNİN yeni dinamik metni (job-listing-row.ts#getJobListingCategoryBadgeLabel)
// ve tamamlanma-bazlı görünürlük kuralının (job-completion.ts#
// isJobFullyCompletedForListing) uçtan uca doğrulaması. "İlan Başlığı"
// sütunu (gerçek `job.title`, ayrı bir Link) BU DEĞİŞİKLİKTEN HİÇ
// ETKİLENMEDİ — yalnızca rozetin metni değişti, kendi görünümü/konumu AYNI.
// Kapsanan senaryolar (görev tanımındaki 9 madde ile BİREBİR eşleşir):
//
//  1. Beş hizmetli operasyonda rozet "Operasyon • 5 Hizmet Arıyor" görünür.
//  2. Bir hizmet tamamlandığında rozet otomatik "Operasyon • 4 Hizmet
//     Arıyor" olur.
//  3. Tamamlanan hizmet sayaçta görünmez (kalan sayıya dahil değil) ama
//     geçmiş kaydı (my-offers-panel.tsx "Tamamlanan" sekmesi) korunur.
//  4. Operasyonun SON hizmeti de tamamlandığında operasyon aktif ilanlardan
//     TAMAMEN kalkar (gerçek job.title'ı dahil hiçbir iz kalmaz).
//  5. Tekli Lashing ilanının rozeti "Lashing Hizmeti Arıyor" olur.
//  6. Tekli ilan tamamlandığında aktif ilanlardan kalkar.
//  7. Tamamlanan operasyon/tekli ilan, kendi teklifi olmayan BAŞKA bir
//     Hizmet Veren için doğrudan URL ile açıldığında yeni teklif formu
//     GÖSTERMEZ (aktif bir ilan gibi açılamaz).
//  8. Diğer (tamamlanmamış) operasyon ve tekli ilan bu değişikliklerden HİÇ
//     etkilenmez.
//  9. Lint/type-check/build ayrıca `npm run lint` + `npm run build` ile
//     doğrulanır (bu script'in kapsamı dışında).
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
async function seedJob(page, { id, title, category, reqId, operationId }) {
  await page.evaluate(
    ({ id, title, category, reqId, operationId }) => {
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
        description: "Baslik/gorunurluk dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
        ...(operationId ? { operationId } : {}),
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, reqId, operationId },
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
        description: "Test teklifi - baslik/gorunurluk dogrulamasi icin.",
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

// Ana operasyon: 5 hizmet, hiçbiri baştan tamamlanmamış.
const OP_ID = "title-vis-op-a";
const OP_JOBS = [
  { id: "title-vis-a-lashing", title: "Title Vis Op A Lashing", category: "lashing" },
  { id: "title-vis-a-forklift", title: "Title Vis Op A Forklift", category: "forklift" },
  { id: "title-vis-a-nakliye", title: "Title Vis Op A Nakliye", category: "nakliye" },
  { id: "title-vis-a-kdolum", title: "Title Vis Op A Kdolum", category: "konteyner-dolum" },
  { id: "title-vis-a-unlashing", title: "Title Vis Op A Unlashing", category: "unlashing" },
];

// Tekil ilan (tamamlanacak).
const SINGLE_B = { id: "title-vis-single-b", title: "Title Vis Single Lashing Ilani", category: "lashing" };

// Kontrol grubu: hiç dokunulmayacak, sonuna kadar aktif kalmalı.
const CONTROL_OP_ID = "title-vis-op-control";
const CONTROL_OP_JOBS = [
  { id: "title-vis-ctrl-depolama", title: "Title Vis Control Depolama", category: "genel-depolama" },
  { id: "title-vis-ctrl-vinc", title: "Title Vis Control Vinc", category: "vinc" },
];
const CONTROL_SINGLE_D = { id: "title-vis-single-d", title: "Title Vis Control Single Forklift", category: "forklift" };

const ALL_JOB_IDS = [...OP_JOBS.map((j) => j.id), SINGLE_B.id, ...CONTROL_OP_JOBS.map((j) => j.id), CONTROL_SINGLE_D.id];

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
  for (const job of OP_JOBS) await seedJob(page, { ...job, reqId: zeynepId, operationId: OP_ID });
  await seedJob(page, { ...SINGLE_B, reqId: zeynepId });
  for (const job of CONTROL_OP_JOBS) await seedJob(page, { ...job, reqId: zeynepId, operationId: CONTROL_OP_ID });
  await seedJob(page, { ...CONTROL_SINGLE_D, reqId: zeynepId });
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  const mertId = await getUserId(page, "mert@test.com");
  ok("Kurulum: 5 hizmetli operasyon, tekil ilan, kontrol operasyonu (2 hizmet), kontrol tekil ilan oluşturuldu");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/ilanlar`);

  // --- Senaryo 1: 5 hizmetten hiçbiri tamamlanmadı -> rozet "Operasyon • 5 Hizmet Arıyor" ---
  await page.getByText("Operasyon • 5 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 1] Beş hizmetli operasyonun rozeti "Operasyon • 5 Hizmet Arıyor" gösteriyor');

  // İlan Başlığı sütunu HİÇ dokunulmadı — operasyonun birincil (ilk
  // oluşturulan) hizmetinin GERÇEK job.title'ı hâlâ orada.
  await page.getByRole("link", { name: OP_JOBS[0].title }).waitFor({ state: "visible", timeout: 10000 });
  ok("İlan Başlığı sütunu hâlâ operasyonun gerçek job.title'ını (\"" + OP_JOBS[0].title + "\") gösteriyor — dokunulmadı");

  await page.getByText("Lashing Hizmeti Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: SINGLE_B.title }).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 5] Tekil Lashing ilanının rozeti "Lashing Hizmeti Arıyor" gösteriyor, İlan Başlığı hâlâ gerçek job.title');

  const controlBadgeBefore = await page.getByText(/^Operasyon • \d Hizmet Arıyor$/).allInnerTexts();
  assert.ok(controlBadgeBefore.includes("Operasyon • 2 Hizmet Arıyor"), "Kontrol operasyonu başlangıçta 2 hizmetle görünmeli");
  ok('Kontrol operasyonu başlangıçta "Operasyon • 2 Hizmet Arıyor" rozetiyle görünüyor');

  // --- Senaryo 2: 1 hizmet tamamlanınca rozet "Operasyon • 4 Hizmet Arıyor" ---
  await seedOffer(page, { id: "title-vis-offer-lashing", jobId: OP_JOBS[0].id, providerId: mertId, status: "completed" });
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByText("Operasyon • 4 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const stillFive = await page.getByText("Operasyon • 5 Hizmet Arıyor", { exact: true }).count();
  assert.equal(stillFive, 0, "Eski '5 Hizmet Arıyor' rozeti artık HİÇ görünmemeli");
  ok('[Senaryo 2] Bir hizmet tamamlandığında rozet otomatik "Operasyon • 4 Hizmet Arıyor" oldu');

  // İlan Başlığı hâlâ değişmedi — operasyonun birincil hizmeti (Lashing)
  // tamamlanmış olsa bile primaryRow HÂLÂ Lashing'dir (creation-order ilk
  // üye, tamamlanma durumundan bağımsız), gerçek job.title AYNI kalır.
  await page.getByRole("link", { name: OP_JOBS[0].title }).waitFor({ state: "visible", timeout: 10000 });
  ok("İlan Başlığı sütunu bir hizmet tamamlandıktan sonra da değişmedi — gerçek job.title AYNEN duruyor");

  // --- Senaryo 3: tamamlanan hizmet sayaçta yok, ama geçmişte korunuyor ---
  const opRowText = await page
    .getByText("Operasyon • 4 Hizmet Arıyor", { exact: true })
    .locator("xpath=ancestor::tr")
    .first()
    .innerText();
  assert.ok(opRowText.includes("Lashing"), "Tamamlanan Lashing hizmeti hâlâ hizmet etiketleri listesinde (üstü çizili) görünmeli");
  ok("[Senaryo 3] Tamamlanan hizmet sayaçtan düşüyor ama hizmet etiketleri listesinde (üstü çizili) görünmeye devam ediyor");

  await page.goto(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`);
  await page.getByText(OP_JOBS[0].title).waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 3] Tamamlanan hizmetin geçmiş kaydı "Verdiğim Teklifler > Tamamlanan" sekmesinde korunuyor');

  // --- Kalan 4 hizmetten 1 tanesini daha tamamla (toplamda 2/5) ---
  await seedOffer(page, { id: "title-vis-offer-forklift", jobId: OP_JOBS[1].id, providerId: mertId, status: "completed" });
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByText("Operasyon • 3 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  ok('İkinci hizmet tamamlandığında rozet "Operasyon • 3 Hizmet Arıyor" oldu');

  // --- Senaryo 4: kalan 3 hizmeti de tamamla -> operasyon TAMAMEN kalkmalı ---
  await seedOffer(page, { id: "title-vis-offer-nakliye", jobId: OP_JOBS[2].id, providerId: mertId, status: "completed" });
  await seedOffer(page, { id: "title-vis-offer-kdolum", jobId: OP_JOBS[3].id, providerId: mertId, status: "completed" });
  await seedOffer(page, { id: "title-vis-offer-unlashing", jobId: OP_JOBS[4].id, providerId: mertId, status: "completed" });
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByText(/Aktif İlan$/).waitFor({ state: "visible", timeout: 10000 });

  // NOT: kontrol operasyonu bu noktada hâlâ aktif ve KENDİ "Operasyon • 2
  // Hizmet Arıyor" rozetini taşıyor — bu yüzden genel bir "Operasyon •
  // \d Hizmet Arıyor" regex'i yerine, operasyonun GERÇEK (ve benzersiz)
  // job.title'ının (İlan Başlığı sütunu, dokunulmamış) tamamen yok olduğu
  // doğrulanır.
  const opATitleStillThere = await page.getByText(OP_JOBS[0].title).count();
  assert.equal(opATitleStillThere, 0, `Tamamlanmış operasyonun gerçek başlığı ("${OP_JOBS[0].title}") artık HİÇ görünmemeli`);
  // Ayrıca tüm 5 hizmetin kendi gerçek job.title'ları da (İlan Başlığı
  // sütununda yalnızca birincil hizmetinki render edilir, ama diğer
  // dördünün de sayfada BAŞKA hiçbir yerde iz bırakmaması gerekir).
  for (const job of OP_JOBS) {
    const stillVisible = await page.getByText(job.title).count();
    assert.equal(stillVisible, 0, `"${job.title}" artık Aktif İlanlar'da hiçbir yerde görünmemeli`);
  }
  ok("[Senaryo 4] Operasyonun son hizmeti de tamamlandığında operasyon Aktif İlanlar'dan TAMAMEN kalktı (5 hizmetin de gerçek job.title'ı dahil hiçbir iz yok)");

  // --- Senaryo 6: tekil Lashing ilanını tamamla -> Aktif İlanlar'dan kalkmalı ---
  await page.getByText("Lashing Hizmeti Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await seedOffer(page, { id: "title-vis-offer-single-b", jobId: SINGLE_B.id, providerId: mertId, status: "completed" });
  await page.goto(`${BASE_URL}/ilanlar`);
  const lashingBadgeAfter = await page.getByText("Lashing Hizmeti Arıyor", { exact: true }).count();
  assert.equal(lashingBadgeAfter, 0, "Tamamlanan tekil ilanın rozeti artık HİÇ görünmemeli");
  const singleBTitleVisible = await page.getByText(SINGLE_B.title).count();
  assert.equal(singleBTitleVisible, 0, "Tamamlanan tekil ilanın gerçek job.title'ı da Aktif İlanlar'da kalmamalı");
  ok("[Senaryo 6] Tekil ilan tamamlandığında Aktif İlanlar'dan TAMAMEN kalktı (rozet ve gerçek başlık dahil)");

  // --- Senaryo 8: kontrol operasyonu ve kontrol tekil ilan hâlâ etkilenmemiş ---
  await page.getByText("Operasyon • 2 Hizmet Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: CONTROL_OP_JOBS[0].title }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Forklift Hizmeti Arıyor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: CONTROL_SINGLE_D.title }).waitFor({ state: "visible", timeout: 10000 });
  ok("[Senaryo 8] Kontrol operasyonu ve kontrol tekil ilan (rozet + gerçek başlık ikisi de) tüm bu değişikliklerden HİÇ etkilenmedi");

  await logout(page);

  // --- Senaryo 7: kendi teklifi olmayan BAŞKA bir Hizmet Veren doğrudan URL ile açtığında yeni teklif alamaz ---
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await page.goto(`${BASE_URL}/ilanlar/${SINGLE_B.id}`);
  await page.getByText("Bu ilan için bir hizmet verenle iş başlamış.").waitFor({ state: "visible", timeout: 10000 });
  const offerFormOnSingle = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(offerFormOnSingle, 0, "Tamamlanan tekil ilanın detay sayfasında teklif formu OLMAMALI");
  ok('[Senaryo 7] Tamamlanan tekil ilan, kendi teklifi olmayan başka bir Hizmet Veren için doğrudan URL ile "iş başlamış" mesajıyla açılıyor, teklif formu YOK');

  await page.goto(`${BASE_URL}/ilanlar/${OP_JOBS[0].id}`);
  await page.getByText("Bu ilan için bir hizmet verenle iş başlamış.").waitFor({ state: "visible", timeout: 10000 });
  const offerFormOnOp = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(offerFormOnOp, 0, "Tamamlanmış operasyonun bir hizmetinin detay sayfasında da teklif formu OLMAMALI");
  ok('[Senaryo 7] Tamamlanmış operasyonun bir hizmeti de doğrudan URL ile yeni teklif alabilecek aktif bir ilan gibi açılamıyor');

  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[active-listing-title-completion-visibility-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[active-listing-title-completion-visibility-test] Konsolda hiç JS hatası yakalanmadı.");
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

  console.log(`\n[active-listing-title-completion-visibility-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[active-listing-title-completion-visibility-test] HATA:", error);
  process.exitCode = 1;
});
