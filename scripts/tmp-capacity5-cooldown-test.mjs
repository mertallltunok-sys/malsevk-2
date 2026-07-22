// Bölüm 1 (MAX_ACTIVE_JOBS=5) + Bölüm 6 (3 günlük yeniden teklif bekleme
// süresi, withdrawn/rejected/agreement_failed süreli - diğerleri kalıcı)
// testi.
// Ön koşul: `npm run dev` (http://localhost:3000).
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
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
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
async function rejectOfferFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Reddet" }).click();
  await page.waitForTimeout(400);
}
async function assertCapacity(page, expected) {
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(
    page.getByText(expected, { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
  );
}
async function setOfferUpdatedAtDaysAgo(page, jobId, days) {
  await page.evaluate(
    ({ jobId, days }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      const past = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const next = offers.map((o) => (o.jobId === jobId ? { ...o, updatedAt: past } : o));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
    },
    { jobId, days },
  );
}

const JOBS = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`j${i + 1}`, { id: `cap5-job-${i + 1}`, title: `Kapasite5 Test - J${i + 1}` }]),
);

async function seedJob(page, job, reqId) {
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
        description: "Kapasite 5 ve bekleme suresi testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id: job.id, title: job.title, reqId },
  );
}

async function main() {
  const browser = await chromium.launch();
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
  for (const job of Object.values(JOBS)) await seedJob(page, job, zeynepId);
  ok("Kurulum: Zeynep için 9 test ilanı oluşturuldu");
  await logout(page);

  // --- Bölüm 6: agreement_failed -> 3 günlük bekleme süresi ---
  // J9'un teklifi kabul edilip hemen "Anlaşma Sağlanamadı" olarak işaretlenir;
  // bu yüzden aşağıdaki "4 teklif kabul et" sayımını etkilemeden kapasite
  // tekrar 0/5'e döner (agreement_failed ENGAGED_OFFER_STATUSES dışında).
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOBS.j9.id, { amount: "3600", duration: "1 gün", description: "Anlasma saglanamayacak teklif, yirmi karakterden uzun aciklama." });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await acceptOfferFor(page, JOBS.j9.title);
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j9Card = page.locator("div.rounded-card").filter({ hasText: JOBS.j9.title });
  await j9Card.getByRole("button", { name: "Anlaşma Sağlanamadı" }).click();
  await page.getByRole("radio", { name: "Fiyatta anlaşamadık" }).check();
  await page.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
  ok("[Kurulum] J9 kabul edildi ve 'Anlaşma Sağlanamadı' olarak işaretlendi");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "0 / 5");
  ok("[Bölüm 6] agreement_failed sonrası aktif iş kapasitesinden düştü (0/5)");

  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j9.id}`);
  await assert.doesNotReject(
    page
      .getByText("Bu ilan için daha önce teklifiniz kabul edilmiş ancak anlaşma sağlanamamıştır.")
      .waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText(/Kalan Süre:/).waitFor({ state: "visible", timeout: 10000 }),
  );
  const formVisibleDuringAgreementFailedCooldown = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleDuringAgreementFailedCooldown, 0, "agreement_failed sonrası bekleme süresi içinde form gösterilmemeli");
  ok("[Bölüm 6] agreement_failed sonrası bekleme süresi içinde doğru mesaj + geri sayım gösteriliyor, form kapalı");
  await logout(page);

  // Bekleme süresini geçmişe alıp (4 gün önce anlaşma sağlanamamış gibi) süre doldu senaryosunu test et
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await setOfferUpdatedAtDaysAgo(page, JOBS.j9.id, 4);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j9.id}`);
  await assert.doesNotReject(
    page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 6] 3 gün dolunca (agreement_failed) yeniden teklif formu tekrar açılıyor");
  await submitOffer(page, JOBS.j9.id, { amount: "3700", duration: "1 gün", description: "Anlasma saglanamadiktan sonra yeniden verilen teklif, yirmi karakterden uzun." });
  ok("[Bölüm 6] agreement_failed sonrası bekleme süresi dolduktan sonra aynı ilana gerçekten yeniden teklif verilebildi");
  await logout(page);

  // --- Önce yalnızca 4 teklifi kabul et (kapasitede 1 boşluk bırak — aşağıdaki
  // bekleme süresi testleri pending/rejected/withdrawn ile çalışacak, bunlar
  // zaten kapasiteye sayılmıyor, ama teklif VERİRKEN kapasitenin dolu
  // olmaması gerekiyor). Kapasite dolu (5/5) senaryosu en sona bırakıldı.
  await loginAs(page, "mert@test.com", "Mert123!");
  for (const key of ["j1", "j2", "j3", "j4"]) {
    await submitOffer(page, JOBS[key].id, { amount: "5000", duration: "1 gün", description: "Kapasite testi icin teklif, yirmi karakterden uzun aciklama." });
  }
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  for (const key of ["j1", "j2", "j3", "j4"]) {
    await acceptOfferFor(page, JOBS[key].title);
  }
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "4 / 5");
  ok("[Kurulum] 4 teklif kabul edildi, aktif iş sayısı 4/5 (1 boşluk bırakıldı)");
  await logout(page);

  // --- Bölüm 6: rejected -> 3 günlük bekleme süresi ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOBS.j7.id, { amount: "3000", duration: "1 gün", description: "Reddedilecek teklif, yirmi karakterden uzun aciklama metni." });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await rejectOfferFor(page, JOBS.j7.title);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j7.id}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana verdiğiniz teklif reddedildi.").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText(/Kalan Süre:/).waitFor({ state: "visible", timeout: 10000 }),
  );
  const formVisibleDuringCooldown = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleDuringCooldown, 0, "Bekleme süresi içinde form gösterilmemeli");
  ok("[Bölüm 6] rejected sonrası bekleme süresi içinde doğru mesaj + geri sayım gösteriliyor, form kapalı");
  await logout(page);

  // Bekleme süresini geçmişe alıp (4 gün önce reddedilmiş gibi) süre doldu senaryosunu test et
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await setOfferUpdatedAtDaysAgo(page, JOBS.j7.id, 4);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j7.id}`);
  await assert.doesNotReject(
    page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 6] 3 gün dolunca (rejected) yeniden teklif formu tekrar açılıyor");
  await submitOffer(page, JOBS.j7.id, { amount: "3300", duration: "1 gün", description: "Bekleme suresi sonrasi yeniden verilen teklif, yirmi karakterden uzun." });
  ok("[Bölüm 6] Bekleme süresi dolduktan sonra aynı ilana gerçekten yeniden teklif verilebildi");
  await logout(page);

  // --- Bölüm 6: withdrawn -> 3 günlük bekleme süresi (kısa doğrulama) ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOBS.j8.id, { amount: "3400", duration: "1 gün", description: "Geri cekilecek teklif, yirmi karakterden uzun aciklama metni." });
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const j8Card = page.locator("div.rounded-card").filter({ hasText: JOBS.j8.title });
  await j8Card.getByRole("button", { name: "Tekliften Vazgeç", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Teklifi Geri Çek" }).click();
  await page.getByText("Geri Çekildi", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });

  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j8.id}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce verdiğiniz teklifi geri çektiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 6] withdrawn sonrası bekleme süresi içinde doğru mesaj gösteriliyor");
  await logout(page);

  // --- Bölüm 1: 5. teklifi de kabul ettirip kapasiteyi tam doldur, 6. ilan engellensin ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOBS.j5.id, { amount: "5200", duration: "1 gün", description: "Besinci kapasite testi teklifi, yirmi karakterden uzun aciklama." });
  await logout(page);
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await acceptOfferFor(page, JOBS.j5.title);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "5 / 5");
  ok("[Bölüm 1] 5 teklif kabul edilince aktif iş sayısı 5/5 (yeni MAX_ACTIVE_JOBS)");

  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j6.id}`);
  await assert.doesNotReject(
    page.getByText("Aktif hizmet verme sınırına ulaştınız.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 1] Kapasite doluyken (5/5) 6. ilana teklif engelleniyor");

  // --- Bölüm 6: accepted (kalıcı engel) - süre geçse bile yeniden teklif verilemez ---
  await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    const past = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const next = offers.map((o) => (o.jobId === jobId ? { ...o, updatedAt: past } : o));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
  }, JOBS.j1.id);
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j1.id}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce teklif verdiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  const formVisibleForAccepted = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleForAccepted, 0, "accepted teklif, süre ne kadar geçerse geçsin kalıcı olarak engellemeli");
  ok("[Bölüm 6] accepted durumu, çok uzun süre geçse bile KALICI olarak yeniden teklifi engelliyor");

  if (consoleErrors.length > 0) {
    console.log("\n[capacity5-cooldown-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[capacity5-cooldown-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const jobIds = Object.values(JOBS).map((j) => j.id);
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, jobIds);

  await browser.close();
  console.log(`\n[capacity5-cooldown-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[capacity5-cooldown-test] HATA:", error);
  process.exitCode = 1;
});
