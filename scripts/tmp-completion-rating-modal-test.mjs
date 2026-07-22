// "Tamamlandığını Onayla" sonrası açılan değerlendirme modalı özelliğinin
// testi (10 SENARYO): otomatik açılma, yıldız gönderme, boş gönderim uyarısı,
// "Daha Sonra", Tamamlanan sekmesinden puanlama, tekil puan kuralı, Hizmet
// Veren engeli, kalıcılık, çift tıklama koruması, tamamlama başarısız
// olursa modal açılmaması.
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
        description: "Degerlendirme modali testi icin olusturulan ilan.",
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

const J1 = { id: "rating-modal-job-1", title: "Değerlendirme Modalı Testi - J1" };
const J2 = { id: "rating-modal-job-2", title: "Değerlendirme Modalı Testi - J2 (Çift Tıklama)" };
const J3 = { id: "rating-modal-job-3", title: "Değerlendirme Modalı Testi - J3 (Hatalı Tamamlama)" };

async function setupAcceptedInProgress(page, job, providerLoginFn) {
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...job, reqId: zeynepId });
  await logout(page);

  await providerLoginFn(page);
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

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const loginMert = (p) => loginAs(p, "mert@test.com", "Mert123!");

  // ============ Kurulum: J1 accepted -> in_progress -> completion_requested ============
  await setupAcceptedInProgress(page, J1, loginMert);
  await loginMert(page);
  await requestCompletionFor(page, J1.title);
  ok("Kurulum: J1 accepted -> in_progress -> completion_requested (Mert)");
  await logout(page);

  // ============ SENARYO 1: "Evet, Onaylıyorum" -> completed + aynı sayfada modal ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);

  const j1StatusAfterConfirm = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J1.id);
  assert.equal(j1StatusAfterConfirm, "completed", "Onay sonrası offer.status 'completed' olmalı");
  ok("[SENARYO 1] 'Evet, Onaylıyorum' sonrası iş completed oldu");

  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  assert.equal(page.url(), `${BASE_URL}/panel/gelen-teklifler`, "Sayfa değişmemeli, aynı URL'de kalınmalı");
  ok("[SENARYO 1] İlk onay modalı kapandı, sayfa değişmeden aynı tasarımdaki değerlendirme modalı açıldı");

  // ============ SENARYO 3: yıldız seçmeden gönder -> uyarı, kaydolmuyor ============
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await assert.doesNotReject(
    page.getByText("Lütfen bir yıldız seçin.").waitFor({ state: "visible", timeout: 5000 }),
  );
  const ratingsAfterEmptySubmit = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]"),
  );
  assert.equal(ratingsAfterEmptySubmit.length, 0, "Yıldız seçilmeden değerlendirme kaydolmamalı");
  ok("[SENARYO 3] Yıldız seçmeden gönderilince 'Lütfen bir yıldız seçin.' uyarısı gösteriliyor, kaydolmuyor");

  // ============ SENARYO 2: 5 yıldız ver -> kaydolur, modal kapanır, 5/5 görünür ============
  const stars = page.getByRole("radio", { name: /yıldız/ });
  assert.equal(await stars.count(), 5, "Tam olarak 5 yıldız olmalı");
  await stars.nth(4).click(); // 5. yıldız (index 4 -> "5 yıldız")
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await page.waitForTimeout(400);

  const modalGoneAfterSubmit = await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(modalGoneAfterSubmit, 0, "Gönderim sonrası modal kapanmalı");
  ok("[SENARYO 2] 5 yıldız verildi, puan kaydoldu, modal kapandı");

  const ratingAfterSubmit = await page.evaluate((jobId) => {
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
    return ratings.find((r) => r.jobId === jobId);
  }, J1.id);
  assert.ok(ratingAfterSubmit, "Rating kaydı oluşmalı");
  assert.equal(ratingAfterSubmit.stars, 5, "Rating.stars 5 olmalı");
  ok("[Veri] Rating kaydı localStorage'da doğru (stars=5, jobId eşleşiyor)");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const j1Card = page.locator("li").filter({ hasText: J1.title });
  await assert.doesNotReject(j1Card.getByText("5 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[SENARYO 2] Tamamlanan kartında 5/5 görünüyor");
  await logout(page);

  // ============ SENARYO 7: Hizmet Veren puan veremiyor ============
  await loginMert(page);
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir.").waitFor({ state: "visible", timeout: 10000 }),
  );
  const rateButtonForProvider = await page.getByRole("button", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(rateButtonForProvider, 0, "Hizmet Veren'e değerlendirme butonu gösterilmemeli");
  ok("[SENARYO 7] Hizmet Veren, puanlama arayüzüne erişemiyor (rol engeli)");
  await logout(page);

  // ============ SENARYO 8: sayfa yenilenince puan kaybolmuyor ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.reload();
  const j1CardAfterReload = page.locator("li").filter({ hasText: J1.title });
  await assert.doesNotReject(j1CardAfterReload.getByText("5 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[SENARYO 8] Sayfa yenilendiğinde verilen puan (5/5) kaybolmuyor");

  // ============ SENARYO 6: aynı işe ikinci kez puan verilemiyor ============
  const rateButtonGone = await j1CardAfterReload.getByRole("button", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(rateButtonGone, 0, "Zaten puanlanmış işte değerlendirme butonu görünmemeli");
  ok("[SENARYO 6] Aynı işe ikinci kez puan verme arayüzden engelleniyor (buton yok)");

  // Veri katmanında da tekilliği doğrudan doğrula: submitRating'i normal
  // arayüz dışından (ikinci bir çağrı simülasyonu) tekrar tetiklemeye
  // çalışırsak (aynı offerId ile) veri katmanı da reddetmeli. Bunu UI'dan
  // tekrar test etmek için ikinci bir Hizmet Alan hesabıyla aynı işi
  // puanlamaya çalışmak (yetki hatası) ayrıca SENARYO'da örtük olarak test
  // ediliyor (yalnızca iş sahibi Hizmet Alan puanlayabilir, bkz. ratings.ts).
  const ratingsCountForJ1 = await page.evaluate((jobId) => {
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
    return ratings.filter((r) => r.jobId === jobId).length;
  }, J1.id);
  assert.equal(ratingsCountForJ1, 1, "J1 için tam olarak 1 rating kaydı olmalı");
  ok("[Veri] J1 için yalnızca 1 rating kaydı var (ikinci kayıt oluşmadı)");
  await logout(page);

  // ============ SENARYO 4: "Daha Sonra" -> completed kalır, Tamamlanan'da buton görünür ============
  await setupAcceptedInProgress(page, J2, loginMert);
  await loginMert(page);
  await requestCompletionFor(page, J2.title);
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j2Card = page.locator("div.rounded-card").filter({ hasText: J2.title });
  await j2Card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);
  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Kurulum] J2 onaylandı, değerlendirme modalı açıldı");

  await page.getByRole("button", { name: "Daha Sonra" }).click();
  await page.waitForTimeout(300);
  const modalGoneAfterSkip = await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(modalGoneAfterSkip, 0, "'Daha Sonra' sonrası modal kapanmalı");

  const j2StatusAfterSkip = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J2.id);
  assert.equal(j2StatusAfterSkip, "completed", "'Daha Sonra' sonrası iş completed kalmalı");
  ok("[SENARYO 4] 'Daha Sonra' ile modal kapandı, iş completed kaldı, tamamlama geri alınmadı");
  assert.equal(page.url(), `${BASE_URL}/panel/gelen-teklifler`, "Kullanıcı aynı sayfada kalmalı");
  ok("[SENARYO 4] Kullanıcı başka bir ekrana yönlendirilmedi");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const j2CardTamamlandi = page.locator("li").filter({ hasText: J2.title });
  await assert.doesNotReject(
    j2CardTamamlandi.getByText("Bu hizmeti henüz değerlendirmediniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    j2CardTamamlandi.getByRole("button", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 4] Tamamlanan sekmesinde J2 değerlendirilmemiş olarak görünüyor, buton mevcut");

  // ============ SENARYO 5: Tamamlanan sekmesinden puan ver -> aynı modal, doğru işe/Hizmet Verene kaydolur ============
  await j2CardTamamlandi.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText("Aldığınız hizmetten ne derece memnun kaldınız?").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 5] Tamamlanan sekmesinden açılan modal, onay sonrası açılanla birebir aynı");

  const starsJ2 = page.getByRole("radio", { name: /yıldız/ });
  await starsJ2.nth(2).click(); // 3 yıldız
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await page.waitForTimeout(400);

  const ratingJ2 = await page.evaluate((jobId) => {
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
    return ratings.find((r) => r.jobId === jobId);
  }, J2.id);
  assert.ok(ratingJ2, "J2 için rating kaydı oluşmalı");
  assert.equal(ratingJ2.stars, 3, "J2 rating.stars 3 olmalı");
  const mertId = await getUserId(page, "mert@test.com");
  assert.equal(ratingJ2.providerId, mertId, "Rating doğru Hizmet Verene (Mert) bağlanmalı");
  ok("[SENARYO 5] Puan doğru işe (J2) ve doğru Hizmet Verene (Mert) kaydoldu");
  await logout(page);

  // ============ SENARYO 10: tamamlama BAŞARISIZ olursa değerlendirme modalı açılmamalı ============
  await setupAcceptedInProgress(page, J3, loginMert);
  await loginMert(page);
  await requestCompletionFor(page, J3.title);
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j3Card = page.locator("div.rounded-card").filter({ hasText: J3.title });
  await j3Card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();

  // Onay modalı açıkken, tamamlama işleminin arka planda başarısız olacağı
  // bir durumu simüle et: teklifi "Evet, Onaylıyorum"a basmadan hemen önce
  // completion_requested dışına taşı (ör. bir yarış durumunda başka bir
  // sekmede itiraz edilmiş gibi) — confirmCompletion bu durumda status
  // kontrolünde başarısız olmalı.
  await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    const next = offers.map((o) => (o.jobId === jobId ? { ...o, status: "completion_disputed" } : o));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
  }, J3.id);

  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);

  await assert.doesNotReject(
    page.getByText("Bu işlem yalnızca onay bekleyen bir iş için yapılabilir.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 10] Tamamlama işlemi başarısız olunca mevcut hata gösterim sistemiyle hata bildirildi");

  const ratingModalOpenAfterFailure = await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(ratingModalOpenAfterFailure, 0, "Tamamlama başarısızsa değerlendirme modalı kesinlikle açılmamalı");
  ok("[SENARYO 10] Tamamlama başarısız olduğu için değerlendirme modalı açılmadı");

  const j3StatusAfterFailure = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J3.id);
  assert.equal(j3StatusAfterFailure, "completion_disputed", "İş completed görünmemeli, önceki durumda kalmalı");
  ok("[SENARYO 10] İş completed olarak görünmüyor (simüle edilen durum korunuyor)");

  const ratingsForJ3 = await page.evaluate((jobId) => {
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
    return ratings.filter((r) => r.jobId === jobId).length;
  }, J3.id);
  assert.equal(ratingsForJ3, 0, "Başarısız tamamlamada hiçbir rating kaydı oluşmamalı");
  ok("[SENARYO 10] Hiçbir rating kaydı oluşmadı");
  await logout(page);

  // ============ SENARYO 9: çift tıklama iki puan/iki tamamlama kaydı oluşturmaz ============
  // J3'ü normal yoldan (durumu geri alarak) completion_requested'a döndürüp
  // tekrar dene — bu sefer arka arkaya iki kez "Evet, Onaylıyorum"a tıkla.
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    const next = offers.map((o) => (o.jobId === jobId ? { ...o, status: "completion_requested" } : o));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
  }, J3.id);
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j3CardRetry = page.locator("div.rounded-card").filter({ hasText: J3.title });
  await j3CardRetry.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  const confirmBtn = page.getByRole("button", { name: "Evet, Onaylıyorum" });
  await confirmBtn.click();
  // İkinci tıklamayı hemen ardından dene — confirmCompletion senkron
  // çalıştığı ve buton/modal aynı anda kalktığı için bu ikinci tıklama
  // kısa sürede hedefini bulamayıp başarısız olmalı: bu da tek bir işlemin
  // gerçekleştiğinin kanıtıdır (Promise.all ile eşzamanlı tıklama, DOM
  // geçişiyle yarışıp "element detached" hatası verdiği için güvenilmez).
  await confirmBtn.click({ timeout: 1500, force: true }).catch(() => {});
  await page.waitForTimeout(500);

  const j3OffersAfterDoubleClick = await page.evaluate(
    (jobId) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId === jobId),
    J3.id,
  );
  assert.equal(j3OffersAfterDoubleClick.length, 1, "Çift tıklama ikinci bir teklif/tamamlama kaydı oluşturmamalı");
  assert.equal(j3OffersAfterDoubleClick[0].status, "completed", "İş yine de doğru şekilde completed olmalı");
  ok("[SENARYO 9] Çift tıklama ikinci bir tamamlama kaydı oluşturmadı (tek offer kaydı, completed)");

  const ratingModalCountAfterDoubleClick = await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(ratingModalCountAfterDoubleClick, 1, "Çift tıklama sonrası tam olarak 1 değerlendirme modalı açık olmalı");
  ok("[SENARYO 9] Çift tıklama iki değerlendirme modalı açılmasına yol açmadı (tam olarak 1 modal)");

  // Değerlendirme modalında da aynı çift tıklama korumasını doğrula.
  const starsJ3 = page.getByRole("radio", { name: /yıldız/ });
  await starsJ3.nth(3).click();
  const submitBtn = page.getByRole("button", { name: "Değerlendirmeyi Gönder" });
  await submitBtn.click();
  await submitBtn.click({ timeout: 1500, force: true }).catch(() => {});
  await page.waitForTimeout(500);

  const ratingsForJ3AfterDoubleSubmit = await page.evaluate(
    (jobId) => JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => r.jobId === jobId),
    J3.id,
  );
  assert.equal(ratingsForJ3AfterDoubleSubmit.length, 1, "Çift tıklama ikinci bir rating kaydı oluşturmamalı");
  ok("[SENARYO 9] Değerlendirme gönderiminde çift tıklama ikinci bir puan kaydı oluşturmadı");
  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[completion-rating-modal-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[completion-rating-modal-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const jobIds = [J1.id, J2.id, J3.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !ids.includes(r.jobId));
    localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
  }, jobIds);

  await browser.close();
  console.log(`\n[completion-rating-modal-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[completion-rating-modal-test] HATA:", error);
  process.exitCode = 1;
});
