// Bölüm 2-4 (completionRequestedAt + geri sayım), Bölüm 3C (7 gün sonunda
// otomatik tamamlanma), Bölüm 7-11 (puanlama sistemi) testi.
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
        description: "Tamamlama zamanlamasi ve puanlama testi icin olusturulan ilan.",
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

const J1 = { id: "timing-rating-job-1", title: "Zamanlama Testi - Manuel Tamamlama" };
const J2 = { id: "timing-rating-job-2", title: "Zamanlama Testi - Otomatik Tamamlama" };

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
  await seedJob(page, { ...J1, reqId: zeynepId });
  await seedJob(page, { ...J2, reqId: zeynepId });
  ok("Kurulum: Zeynep için 2 test ilanı oluşturuldu");
  await logout(page);

  // --- J1: accepted -> in_progress -> completion_requested ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, J1.id, { amount: "5000", duration: "1 gün", description: "J1 icin teklif, yirmi karakterden uzun aciklama metni." });
  await logout(page);
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await acceptOfferFor(page, J1.title);
  await startWorkFor(page, J1.title);
  await logout(page);
  await loginAs(page, "mert@test.com", "Mert123!");
  await requestCompletionFor(page, J1.title);
  ok("[Kurulum] J1: accepted -> in_progress -> completion_requested");

  // completionRequestedAt kaydedildi mi?
  const completionRequestedAt = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.completionRequestedAt;
  }, J1.id);
  assert.ok(completionRequestedAt, "completionRequestedAt kaydedilmeli");
  ok("[Bölüm 2] completion_requested oluşunca completionRequestedAt kaydedildi");

  // Hizmet Veren tarafında geri sayım görünüyor mu?
  await assert.doesNotReject(
    page.getByText(/Kalan Süre:/).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 4] Hizmet Veren tarafında geri sayım (Kalan Süre) görünüyor");
  await logout(page);

  // Hizmet Alan tarafında da geri sayım görünüyor mu? (Gelen Teklifler)
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await assert.doesNotReject(
    page.getByText(/Kalan Süre:/).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 4] Hizmet Alan tarafında (Gelen Teklifler) geri sayım görünüyor");

  // Hizmet Alan tarafında Hizmet Taleplerim > Devam Eden'de de görünüyor mu?
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await assert.doesNotReject(
    page.getByText(/Kalan Süre:/).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 4] Hizmet Alan tarafında (Hizmet Taleplerim > Devam Eden) geri sayım görünüyor");

  // --- J1: manuel onay (Yol A) ---
  await approveCompletionFor(page, J1.title);
  ok("[Bölüm 3A] Hizmet Alan manuel olarak onayladı");

  // Onaydan hemen sonra, sayfa değişmeden aynı tasarımdaki değerlendirme
  // modalı otomatik açılmalı (bkz. offer-outcome-panel.tsx#onCompleted +
  // incoming-offer-card.tsx — bu akış /panel/gelen-teklifler'de gerçekleşiyor).
  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 1] 'Evet, Onaylıyorum' sonrası sayfa değişmeden değerlendirme modalı otomatik açıldı");

  // Bu akışta modalı "Daha Sonra" ile kapatıp değerlendirmeyi aşağıda
  // Tamamlanan sekmesinden yapacağız — iş completed kalmalı, tamamlama
  // işlemi geri alınmamalı.
  await page.getByRole("button", { name: "Daha Sonra" }).click();
  await page.waitForTimeout(300);
  const offerStatusAfterSkip = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J1.id);
  assert.equal(offerStatusAfterSkip, "completed", "'Daha Sonra' sonrası iş completed olarak kalmalı");
  ok("[Senaryo 4] Modal 'Daha Sonra' ile kapatılınca iş completed olarak kaldı, tamamlama geri alınmadı");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await assert.doesNotReject(page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[Bölüm 3A] Manuel onay sonrası aktif kapasite boşaldı (0/5)");
  await logout(page);

  // --- Bölüm 8 / Senaryo 4-5: Tamamlanan sekmesinden "Hizmeti Değerlendir" ile puanlama ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(
    page.getByText("Bu hizmeti henüz değerlendirmediniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 4] Tamamlanan sekmesinde 'Daha Sonra' sonrası değerlendirilmemiş durum doğru gösteriliyor");

  await page.getByRole("button", { name: "Hizmeti Değerlendir" }).click();
  await assert.doesNotReject(
    page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText("Aldığınız hizmetten ne derece memnun kaldınız?").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Senaryo 5] 'Hizmeti Değerlendir' butonu, onaydan sonra açılanla birebir aynı tasarımdaki modalı açıyor");

  // Arama bilerek modal içeriğiyle sınırlı (sayfa geneli değil) — ilan
  // başlığı gibi test verisi kendi içinde bu kelimelerden birini
  // barındırabilir (ör. "Zamanlama Testi - ..."), bu yanlış-pozitif üretmemeli.
  const noSubcategories = await page
    .getByRole("dialog")
    .getByText(/İş Kalitesi|İletişim|Profesyonellik|Zamanlama/)
    .count();
  assert.equal(noSubcategories, 0, "Alt kategori metinleri kesinlikle bulunmamalı");
  ok("[Bölüm 8] Alt kategori (İş Kalitesi/İletişim/Profesyonellik/Zamanlama vb.) kesinlikle yok");

  // Senaryo 3: yıldız seçmeden göndermeyi dene -> hata görünmeli, kaydolmamalı
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await assert.doesNotReject(
    page.getByText("Lütfen bir yıldız seçin.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Senaryo 3] Yıldız seçmeden gönderilince uyarı gösteriliyor, değerlendirme kaydolmuyor");

  const stars = page.getByRole("radio", { name: /yıldız/ });
  assert.equal(await stars.count(), 5, "Tam olarak 5 yıldız olmalı");
  await stars.nth(3).click(); // 4 yıldız (0 tabanlı index -> "4 yıldız")
  await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
  await page.waitForTimeout(500);
  await assert.doesNotReject(
    page.getByText("Değerlendirmeniz için teşekkür ederiz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Senaryo 2] 4 yıldız gönderildi, modal kapandı, küçük başarı mesajı gösterildi");

  await assert.doesNotReject(page.getByText("Verdiğiniz puan").waitFor({ state: "visible", timeout: 10000 }));
  await assert.doesNotReject(page.getByText("4 / 5").waitFor({ state: "visible", timeout: 5000 }));
  ok("[Senaryo 2] Tamamlanan kartında 4/5 doğru gösteriliyor");

  const rateButtonGoneAfterRating = await page.getByRole("button", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(rateButtonGoneAfterRating, 0, "Puanlandıktan sonra 'Hizmeti Değerlendir' butonu görünmemeli");
  ok("[Senaryo 6] Aynı iş için ikinci kez puanlama arayüzden engelleniyor (buton kayboldu, salt-okunur gösteriliyor)");

  await page.reload();
  await assert.doesNotReject(page.getByText("Verdiğiniz puan").waitFor({ state: "visible", timeout: 10000 }));
  await assert.doesNotReject(page.getByText("4 / 5").waitFor({ state: "visible", timeout: 5000 }));
  ok("[Senaryo 8] Sayfa yenilendiğinde verilen puan kaybolmuyor");
  await logout(page);

  // --- Bölüm 13: Hizmet Veren, puanlama arayüzüne hiç erişemiyor ---
  // Puanlama widget'ı yalnızca "Hizmet Taleplerim" sayfasında render edilir
  // (bkz. job-requests-panel.tsx) ve bu sayfa role === "hizmet-alan" ile
  // sınırlıdır (bkz. JobRequestsPanel). Hizmet Veren bu sayfaya hiç giremediği
  // için puanlama arayüzüne ulaşmasının hiçbir yolu yok.
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page
      .getByText("Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir.")
      .waitFor({ state: "visible", timeout: 10000 }),
  );
  const ratingRadiosForProvider = await page.getByRole("radio", { name: /yıldız/ }).count();
  assert.equal(ratingRadiosForProvider, 0, "Hizmet Veren'e hiçbir puanlama arayüzü gösterilmemeli");
  const rateButtonForProvider = await page.getByRole("button", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(rateButtonForProvider, 0, "Hizmet Veren'e 'Hizmeti Değerlendir' butonu gösterilmemeli");
  ok("[Senaryo 7] Hizmet Veren, puanlama arayüzünün bulunduğu 'Hizmet Taleplerim' sayfasına erişemiyor (rol engeli)");
  await logout(page);

  // --- Bölüm 9: profilde ortalama puan ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/profil`);
  await assert.doesNotReject(page.getByText("4.0 / 5").waitFor({ state: "visible", timeout: 10000 }));
  await assert.doesNotReject(page.getByText("1 değerlendirme").waitFor({ state: "visible", timeout: 5000 }));
  ok("[Bölüm 9] Hizmet Veren'in profilinde ortalama puan (4.0 / 5, 1 değerlendirme) doğru gösteriliyor");
  await logout(page);

  // --- J2: 7 gün sonunda otomatik tamamlanma (Yol C) ---
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await submitOffer(page, J2.id, { amount: "6000", duration: "2 gün", description: "J2 icin teklif, yirmi karakterden uzun aciklama metni." });
  await logout(page);
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await acceptOfferFor(page, J2.title);
  await startWorkFor(page, J2.title);
  await logout(page);
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await requestCompletionFor(page, J2.title);
  // requestCompletionFor sayfayı /panel/tekliflerim'de bırakır; kapasite
  // göstergesi ("X / 5") yalnızca /panel'de olduğu için önce oraya gidilmeli.
  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(page.getByText("1 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[Kurulum] J2 completion_requested durumunda, aktif kapasitede sayılıyor (1/5)");

  // completionRequestedAt'i 8 gün öncesine çekerek "7 gün doldu" durumunu simüle et
  await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const next = offers.map((o) => (o.jobId === jobId ? { ...o, completionRequestedAt: eightDaysAgo } : o));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
  }, J2.id);
  await logout(page);

  // Herhangi bir sayfa ziyareti otomatik tamamlanmayı tetiklemeli (bkz. use-offers.ts)
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForTimeout(500);

  const j2Status = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId);
  }, J2.id);
  assert.equal(j2Status.status, "completed", "7 gün dolunca offer.status otomatik 'completed' olmalı");
  assert.equal(j2Status.autoCompleted, true, "autoCompleted işaretlenmeli");
  ok("[Bölüm 3C] 7 gün dolunca (gecikmeli kontrol) teklif otomatik 'completed' oldu, autoCompleted=true");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(page.getByText(J2.title).waitFor({ state: "visible", timeout: 10000 }));
  ok("[Bölüm 3C] Otomatik tamamlanan iş Tamamlanan sekmesinde görünüyor");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await assert.doesNotReject(page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }));
  ok("[Bölüm 3C] Otomatik tamamlanma sonrası aktif kapasite boşaldı (0/5)");
  await logout(page);

  // --- Bölüm 10: otomatik tamamlanan işte 30 gün içinde puanlama açık ---
  // Otomatik tamamlanma confirmCompletion/onCompleted akışından geçmediği
  // için (applyExpiredCompletionAutoApprovals gecikmeli/arka planda çalışır)
  // değerlendirme modalı otomatik AÇILMAZ — yalnızca Tamamlanan sekmesinden
  // "Hizmeti Değerlendir" ile sonradan puanlanabilir olması gerekiyor.
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const j2Card = page.locator("li").filter({ hasText: J2.title });
  await assert.doesNotReject(
    j2Card.getByRole("button", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Bölüm 10] Otomatik tamamlanan işte (30 gün içinde) 'Hizmeti Değerlendir' butonu hâlâ açık");

  // Şimdi 30 günü aşacak şekilde updatedAt'i geçmişe çekelim (autoCompleted olduğu an)
  await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const next = offers.map((o) => (o.jobId === jobId ? { ...o, updatedAt: past } : o));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(next));
  }, J2.id);
  await page.reload();
  const j2CardAfter = page.locator("li").filter({ hasText: J2.title });
  await page.waitForTimeout(300);
  const ratingWidgetGoneCount = await j2CardAfter.getByRole("button", { name: "Hizmeti Değerlendir" }).count();
  assert.equal(ratingWidgetGoneCount, 0, "30 gün dolunca otomatik tamamlanan işte puanlama butonu kapanmalı");
  ok("[Bölüm 10] 30 gün dolunca otomatik tamamlanan işte puanlama arayüzü artık görünmüyor");

  if (consoleErrors.length > 0) {
    console.log("\n[completion-timing-rating-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[completion-timing-rating-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const jobIds = [J1.id, J2.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !ids.includes(r.jobId));
    localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
  }, jobIds);

  await browser.close();
  console.log(`\n[completion-timing-rating-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[completion-timing-rating-test] HATA:", error);
  process.exitCode = 1;
});
