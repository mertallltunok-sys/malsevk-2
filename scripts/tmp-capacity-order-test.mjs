// AKTİF İŞ KAPASİTESİ + KONTROL SIRASI testi (SENARYO 4-8).
// MAX_ACTIVE_JOBS=5 olduğu için kapasiteyi gerçekten doldurmak (SENARYO 4/8)
// artık 2 değil 5 kabul edilmiş/devam eden iş gerektiriyor (bkz.
// provider-capacity.ts). J1-J5 kapasiteyi dolduran işler, J6 "kapasite
// doluyken engellenen" hedef ilan, J7/J8 baştan sona pending kalan
// (kapasiteyi hiç etkilemeyen) ilanlar.
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
async function startWorkFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
}
async function requestCompletionFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
}
async function approveCompletionFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);
}
async function disputeCompletionFor(page, jobTitle, note) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "İtiraz Et" }).click();
  await page.getByLabel("İtiraz Açıklaması").fill(note);
  await page.getByRole("dialog").getByRole("button", { name: "İtiraz Et", exact: true }).click();
  await page.waitForTimeout(400);
}
async function cancelDisputedFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "İşi İptal Et" }).click();
  await page.getByRole("button", { name: "Evet, İşi İptal Et" }).click();
  await page.waitForTimeout(400);
}
async function assertCapacity(page, expected) {
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(
    page.getByText(expected, { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
  );
}

const JOBS = {
  j1: { id: "capacity-job-1", title: "Kapasite Test - J1" },
  j2: { id: "capacity-job-2", title: "Kapasite Test - J2" },
  j3: { id: "capacity-job-3", title: "Kapasite Test - J3" },
  j4: { id: "capacity-job-4", title: "Kapasite Test - J4" },
  j5: { id: "capacity-job-5", title: "Kapasite Test - J5" },
  j6: { id: "capacity-job-6", title: "Kapasite Test - J6 (Engellenen Hedef)" },
  j7: { id: "capacity-job-7", title: "Kapasite Test - J7 (Pending)" },
  j8: { id: "capacity-job-8", title: "Kapasite Test - J8 (Pending)" },
};

async function seedJob(page, job, reqId) {
  await page.evaluate(
    ({ jobId, title, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id: jobId,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Kapasite ve kontrol sirasi testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId: job.id, title: job.title, reqId },
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
  ok("Kurulum: Zeynep için 8 test ilanı oluşturuldu");
  await logout(page);

  // --- SENARYO 7 (kısmi): pending teklifler kapasitede sayılmaz ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOBS.j7.id, { amount: "3000", duration: "1 gün", description: "J7 icin bekleyen teklif, yirmi karakterden uzun aciklama." });
  await submitOffer(page, JOBS.j8.id, { amount: "3200", duration: "1 gün", description: "J8 icin bekleyen teklif, yirmi karakterden uzun aciklama." });
  await assertCapacity(page, "0 / 5");
  ok("[SENARYO 7] İki farklı ilanda pending teklif varken aktif iş sayısı 0");
  await logout(page);

  // --- J1-J5: hepsi accepted + in_progress yapılarak kapasite tam olarak
  // 5/5'e doldurulur (MAX_ACTIVE_JOBS=5, bkz. provider-capacity.ts) ---
  const fillerJobs = [JOBS.j1, JOBS.j2, JOBS.j3, JOBS.j4, JOBS.j5];
  for (let i = 0; i < fillerJobs.length; i++) {
    const job = fillerJobs[i];
    await loginAs(page, "mert@test.com", "Mert123!");
    await submitOffer(page, job.id, {
      amount: `${5000 + i * 100}`,
      duration: "1 gün",
      description: `${job.title} icin teklif, yirmi karakterden uzun aciklama metni.`,
    });
    await logout(page);
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await acceptOfferFor(page, job.title);
    await startWorkFor(page, job.title);
    await logout(page);
    await loginAs(page, "mert@test.com", "Mert123!");
    await assertCapacity(page, `${i + 1} / 5`);
    ok(`[Kurulum] ${job.title} kabul edilip işe başlandı, aktif iş sayısı ${i + 1}/5`);
    await logout(page);
  }

  // --- SENARYO 4: kapasite doluyken (5/5) altıncı ilana teklif verilemez ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j6.id}`);
  await assert.doesNotReject(
    page.getByText("Aktif hizmet verme sınırına ulaştınız.").waitFor({ state: "visible", timeout: 10000 }),
  );
  const formVisibleAtCapacity = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleAtCapacity, 0, "Kapasite doluyken teklif formu gösterilmemeli");
  ok("[SENARYO 4] Kapasite doluyken (5/5) yeni ilana teklif formu engelleniyor, doğru mesaj gösteriliyor");

  // --- SENARYO 8: kontrol sırası — daha önce teklif verilmiş ilanda kapasite mesajı DEĞİL, önceki teklif mesajı görünmeli ---
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j1.id}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce teklif verdiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  const capacityMessageOnJ1 = await page.getByText("Aktif hizmet verme sınırına ulaştınız.").count();
  assert.equal(capacityMessageOnJ1, 0, "Daha önce teklif verilen ilanda kapasite mesajı görünmemeli");
  ok("[SENARYO 8] Daha önce teklif verilmiş + kapasite dolu ilanda doğru sırayla 'daha önce teklif verdiniz' mesajı görünüyor");
  await logout(page);

  // --- SENARYO 9 (Kural): completion_requested kapasiteden düşmüyor ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await requestCompletionFor(page, JOBS.j2.title);
  await assertCapacity(page, "5 / 5");
  ok("[SENARYO 9 (Kural)] completion_requested durumu hâlâ kapasitede sayılıyor (5/5)");
  await logout(page);

  // --- SENARYO 5: J2 tamamlanınca kapasite 5'ten 4'e düşer ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await approveCompletionFor(page, JOBS.j2.title);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "4 / 5");
  ok("[SENARYO 5] J2 tamamlanınca (completed) aktif iş sayısı 5'ten 4'e düştü");

  // Artık kapasite açıldığı için J6'ya teklif verebilmeli
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j6.id}`);
  await assert.doesNotReject(
    page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 }),
  );
  await submitOffer(page, JOBS.j6.id, { amount: "6000", duration: "2 gün", description: "J6 icin teklif, yirmi karakterden uzun aciklama metni." });
  ok("[SENARYO 5] Kapasite açılınca başka bir ilana (J6) teklif verilebildi");

  // Tamamlanan J2'ye tekrar teklif VERİLEMEZ (Kural 1, completed dahil)
  await page.goto(`${BASE_URL}/ilanlar/${JOBS.j2.id}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce teklif verdiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 5] Tamamlanan aynı ilana (J2) tekrar teklif verilemiyor");
  await logout(page);

  // --- SENARYO 6: completion_disputed kapasitede kalır, cancelled olunca düşer ---
  // (J3, adım J1-J5 doldurma sırasında zaten accepted+in_progress durumuna getirildi.)
  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "4 / 5");
  await requestCompletionFor(page, JOBS.j3.title);
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await disputeCompletionFor(page, JOBS.j3.title, "İş gerçekte tamamlanmadı, eksikler var.");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "4 / 5");
  ok("[SENARYO 6] completion_disputed durumu hâlâ aktif kapasitede sayılıyor (4/5)");
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await cancelDisputedFor(page, JOBS.j3.title);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assertCapacity(page, "3 / 5");
  ok("[SENARYO 6] İtiraz sonucu iptal (cancelled) olunca aktif kapasiteden düştü (3/5)");

  // J7/J8 pending teklifler hâlâ hiç etkilenmeden duruyor mu (SENARYO 7
  // tamamlanışı). Sayfa genelinde "Beklemede" sayısı yerine J7/J8 kartlarına
  // özel bakılır — J6 de bu noktada (SENARYO 5'te verilen, hiç
  // sonuçlandırılmamış) kendi başına pending bir teklife sahip, bu J7/J8'in
  // durumuyla ilgisiz ve kontrolü etkilememeli.
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const j7Card = page.locator("div.rounded-card").filter({ hasText: JOBS.j7.title });
  const j8Card = page.locator("div.rounded-card").filter({ hasText: JOBS.j8.title });
  await assert.doesNotReject(
    j7Card.getByText("Beklemede", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    j8Card.getByText("Beklemede", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 7] Baştan beri var olan iki pending teklif (J7, J8) sürecin hiçbir aşamasında kapasiteyi etkilemedi");

  if (consoleErrors.length > 0) {
    console.log("\n[capacity-order-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[capacity-order-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, Object.values(JOBS).map((j) => j.id));

  await browser.close();
  console.log(`\n[capacity-order-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[capacity-order-test] HATA:", error);
  process.exitCode = 1;
});
