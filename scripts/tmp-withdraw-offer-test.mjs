// KESİN TEKLİF KURALLARI testi: aynı Hizmet Veren aynı ilana yalnızca bir
// kez teklif verebilir (withdrawn dahil hiçbir durum yeniden teklif hakkı
// vermez), ama başka Hizmet Verenler teklif verebilir. (SENARYO 1-3)
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
async function submitOffer(page, { amount, duration, description }) {
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

const JOB_ID = "single-offer-rule-job";
const JOB_TITLE = "Tek Teklif Kuralı Test İlanı";

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
  await page.evaluate(
    ({ jobId, title, reqId }) => {
      const job = {
        id: jobId,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Tek teklif kurali testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      };
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([job]));
    },
    { jobId: JOB_ID, title: JOB_TITLE, reqId: zeynepId },
  );
  ok("Kurulum: Zeynep için test ilanı oluşturuldu");
  await logout(page);

  // --- Mert teklif verir (Offer A) ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
  await submitOffer(page, { amount: "5000", duration: "1 gün", description: "Ilk teklif, yirmi karakterden uzun aciklama metni." });
  ok("[Kurulum] Mert teklifini verdi (Offer A, pending)");

  // --- SENARYO 1: aynı ilana ikinci teklif (hâlâ pending iken) ---
  await page.reload();
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce teklif verdiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  const formVisibleWhilePending = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleWhilePending, 0, "Zaten teklif verilmiş ilanda form tekrar gösterilmemeli");
  ok("[SENARYO 1] pending teklif varken form tekrar gösterilmiyor, 'daha önce teklif verdiniz' görünüyor");

  // --- [1] Mert henüz kabul edilmemiş teklifini geri çeker ---
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.getByRole("button", { name: "Tekliften Vazgeç", exact: true }).click();
  await page
    .getByText("Teklifinizi geri çekmek istediğinize emin misiniz?")
    .waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: "Evet, Teklifi Geri Çek" }).click();
  await page.getByText("Geri Çekildi", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  ok("Mert teklifini geri çekti, durum 'Geri Çekildi'");

  const offerAStatus = await page.evaluate(() => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers[0]?.status;
  });
  assert.equal(offerAStatus, "withdrawn", "Offer.status 'withdrawn' olarak kaydedilmeli");
  ok("[Offer.status] localStorage'da gerçekten 'withdrawn' olarak kayıtlı, kayıt silinmedi");

  const noWithdrawButton = await page.getByRole("button", { name: "Tekliften Vazgeç", exact: true }).count();
  assert.equal(noWithdrawButton, 0, "Geri çekilmiş teklifte artık Vazgeç butonu görünmemeli");
  ok("[UI] Geri çekilmiş teklifte 'Tekliften Vazgeç' butonu artık görünmüyor");

  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(
    page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Kapasite] withdrawn teklif aktif iş kapasitesine dahil edilmiyor (0/5)");

  // --- SENARYO 2: withdrawn sonrası 3 günlük bekleme süresi doluncaya kadar
  // yeniden teklif engellenmeli (KALICI değil, bkz. job-requests.ts#REOFFER_COOLDOWN_DAYS) ---
  await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
  await assert.doesNotReject(
    page.getByText("Bu ilana daha önce verdiğiniz teklifi geri çektiniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page
      .getByText("Bekleme süresi dolduğunda aynı hizmet talebine yeniden teklif verebilirsiniz.")
      .waitFor({ state: "visible", timeout: 5000 }),
  );
  const formVisibleAfterWithdraw = await page.getByLabel("Teklif Fiyatı").count();
  assert.equal(formVisibleAfterWithdraw, 0, "withdrawn sonrası (bekleme süresi dolmadan) teklif formu gösterilmemeli");
  const offerButtonAfterWithdraw = await page.getByRole("button", { name: "Teklif Gönder" }).count();
  assert.equal(offerButtonAfterWithdraw, 0, "withdrawn sonrası (bekleme süresi dolmadan) 'Teklif Gönder' butonu gösterilmemeli");
  ok("[SENARYO 2] withdrawn sonrası doğru mesaj gösteriliyor, bekleme süresi dolmadan teklif formu/butonu görünmüyor");
  await logout(page);

  // --- Zeynep: geri çekilmiş teklif Gelen Teklifler'de görünmüyor, bildirim geldi ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.waitForTimeout(300);
  const gelenTekliflerBody = await page.locator("body").innerText();
  assert.ok(
    !gelenTekliflerBody.includes(JOB_TITLE),
    "Geri çekilmiş teklif Gelen Teklifler listesinde hiç görünmemeli",
  );
  ok("withdrawn teklif Hizmet Alan'ın Gelen Teklifler listesinde görünmüyor (Kabul Et/Reddet erişilemez)");

  await page.getByRole("button", { name: /Bildirimler/ }).click();
  const withdrawNotif = page
    .getByRole("menuitem")
    .filter({ hasText: "Hizmet Veren ilanınıza verdiği teklifi geri çekti." });
  await assert.doesNotReject(withdrawNotif.waitFor({ state: "visible", timeout: 10000 }));
  ok("'Teklif geri çekildi' bildirimi doğru mesajla geldi");
  await page.mouse.click(10, 10);

  // --- SENARYO 3: başka Hizmet Veren aynı ilana teklif verebilir ---
  await logout(page);
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
  await assert.doesNotReject(
    page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 }),
  );
  await submitOffer(page, { amount: "6200", duration: "2 gün", description: "Farkli hizmet veren teklifi, yirmi karakterden uzun aciklama." });
  ok("[SENARYO 3] Başka bir Hizmet Veren (Mehmet Demir) aynı ilana teklif verebildi");
  await logout(page);

  // --- Zeynep: yalnızca Mehmet'in (pending) teklifi görünmeli, Mert'inki (withdrawn) hâlâ yok ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByText(JOB_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
  const acceptButtons = await page.getByRole("button", { name: "Kabul Et" }).count();
  assert.equal(acceptButtons, 1, `Yalnızca Mehmet'in aktif teklifi için Kabul Et görünmeli, bulunan: ${acceptButtons}`);
  ok("[SENARYO 3] İlan diğer Hizmet Verenler için açık kalmaya devam etti; yalnızca Mert açısından kapalı");

  if (consoleErrors.length > 0) {
    console.log("\n[withdraw-offer-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[withdraw-offer-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate((jobId) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => j.id !== jobId);
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId !== jobId);
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, JOB_ID);

  await browser.close();
  console.log(`\n[withdraw-offer-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[withdraw-offer-test] HATA:", error);
  process.exitCode = 1;
});
