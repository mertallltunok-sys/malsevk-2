// Bu turda eklenen/düzeltilen davranışların testi:
//  - Hizmet Alan'ın "Hizmet Taleplerim" (Devam Eden) ekranında, teklif
//    completion_requested/completion_disputed olduğunda inline onay/itiraz
//    kutusunun görünmesi (asıl bildirilen hata).
//  - Bildirim matrisi: kabul, ret, tamamlanma talebi (Hizmet Alan'a),
//    tamamlanma onaylandı (Hizmet Veren'e), itiraz (her iki tarafa), iptal
//    (Hizmet Veren'e).
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
async function checkNotification(page, message, expectedHref) {
  await page.getByRole("button", { name: /Bildirimler/ }).click();
  const item = page.getByRole("menuitem").filter({ hasText: message });
  await assert.doesNotReject(item.waitFor({ state: "visible", timeout: 10000 }));
  if (expectedHref !== undefined) {
    const href = await item.getAttribute("href");
    assert.equal(href, expectedHref, `Bildirim linki '${expectedHref}' olmalı, bulunan: ${href}`);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(10, 10);
}

const JOB_A = { id: "matrix-job-a", title: "Bildirim Matrisi Test - Kabul ve Tamamlama" };
const JOB_B = { id: "matrix-job-b", title: "Bildirim Matrisi Test - Ret" };
const JOB_C = { id: "matrix-job-c", title: "Bildirim Matrisi Test - Itiraz ve Iptal" };

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
        description: "Bildirim matrisi testi icin olusturulan ilan.",
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
  await seedJob(page, JOB_A, zeynepId);
  await seedJob(page, JOB_B, zeynepId);
  await seedJob(page, JOB_C, zeynepId);
  ok("Kurulum: Zeynep için 3 test ilanı oluşturuldu");
  await logout(page);

  // ============ SENARYO 1: yeni teklif ============
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await submitOffer(page, JOB_A.id, {
    amount: "8000",
    duration: "3 gün",
    description: "Kabul ve tamamlama senaryosu icin teklif, yirmi karakterden uzun.",
  });
  ok("[SENARYO 1] Hizmet Veren (Mehmet Demir) JOB_A'ya teklif verdi");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, JOB_B.id, {
    amount: "4000",
    duration: "1 gün",
    description: "Ret senaryosu icin verilen teklif, yirmi karakterden uzun aciklama.",
  });
  ok("[Kurulum] Hizmet Veren (Mert) JOB_B'ye teklif verdi");
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByText(JOB_A.title).first().waitFor({ state: "visible", timeout: 10000 });
  await checkNotification(
    page,
    `İlanınıza yeni teklif geldi: ${JOB_A.title}`,
  );
  ok("[SENARYO 1] Hizmet Alan (Zeynep) 'yeni teklif' bildirimini aldı");

  // ============ SENARYO 2: teklif kabul ============
  const jobACard = page.locator("div.rounded-card").filter({ hasText: JOB_A.title });
  await jobACard.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
  ok("[SENARYO 2] Hizmet Alan, JOB_A teklifini kabul etti");

  // ============ SENARYO 3: teklif ret ============
  const jobBCard = page.locator("div.rounded-card").filter({ hasText: JOB_B.title });
  await jobBCard.getByRole("button", { name: "Reddet" }).click();
  await page.waitForTimeout(400);
  ok("[SENARYO 3] Hizmet Alan, JOB_B teklifini reddetti");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await checkNotification(page, "Hizmet Alan teklifinizi kabul etti.", "/panel/tekliflerim");
  ok("[SENARYO 2] Hizmet Veren (Mehmet Demir), 'Teklifiniz kabul edildi' bildirimini doğru mesajla aldı");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await checkNotification(page, "Hizmet Alan teklifinizi kabul etmedi.", "/panel/tekliflerim");
  ok("[SENARYO 3] Hizmet Veren (Mert), 'Teklifiniz kabul edilmedi' bildirimini doğru mesajla aldı");
  const mertContactCount = await page.getByText(/^0\d{3} \d{3}/).count();
  assert.equal(mertContactCount, 0, "Reddedilen teklifte iletişim bilgisi görünmemeli");
  ok("[SENARYO 3] Reddedilen teklifte iletişim bilgisi görünmüyor");
  await logout(page);

  // ============ İşe başlama + bildirim ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
  ok("İş başlatıldı (JOB_A, offer -> in_progress)");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await checkNotification(page, "Hizmet Alan, işin başladığını onayladı.", "/panel/tekliflerim");
  ok("Hizmet Veren, iş başladı bildirimini aldı");

  // ============ SENARYO 5: Hizmet Veren tamamlanma talebi ============
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await assert.doesNotReject(
    page.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    page.getByText("Hizmet Alan'ın onayı bekleniyor.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[SENARYO 5.3] Hizmet Veren tarafında 'Tamamlanma onayı bekleniyor / Hizmet Alan'ın onayı bekleniyor.' doğru gösteriliyor, tekrar buton yok");
  const reRequestButtons = await page
    .getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true })
    .count();
  assert.equal(reRequestButtons, 0, "completion_requested durumunda tekrar talep butonu görünmemeli");
  await logout(page);

  // Hizmet Alan'a bildirim
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await checkNotification(
    page,
    "Hizmet Veren işin tamamlandığını bildirdi. Lütfen işi kontrol ederek onaylayın veya itiraz edin.",
    "/panel/hizmet-taleplerim?durum=devam-eden",
  );
  ok("[SENARYO 5.4] Hizmet Alan, 'Tamamlanma onayınız bekleniyor' bildirimini doğru mesaj+linkle aldı");

  // --- ASIL BİLDİRİLEN HATA: Hizmet Taleplerim > Devam Eden ekranında inline onay/itiraz kutusu ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.getByText(JOB_A.title).first().waitFor({ state: "visible", timeout: 10000 });
  await assert.doesNotReject(
    page.getByText("Tamamlandı Onayı Bekleniyor").waitFor({ state: "visible", timeout: 10000 }),
  );
  const approveButton = page.getByRole("button", { name: "Tamamlandığını Onayla" });
  const disputeButton = page.getByRole("button", { name: "İtiraz Et" });
  await assert.doesNotReject(approveButton.waitFor({ state: "visible", timeout: 5000 }));
  await assert.doesNotReject(disputeButton.waitFor({ state: "visible", timeout: 5000 }));
  ok("[SENARYO 5.5 / KÖK HATA DÜZELTMESİ] Hizmet Alan'ın 'Hizmet Taleplerim > Devam Eden' ekranındaki ilan kartında 'Tamamlandığını Onayla' ve 'İtiraz Et' butonları doğrudan görünüyor (Gelen Teklifler'e gitmeye gerek yok)");

  // ============ SENARYO 5.6-10: onaylama ============
  await approveButton.click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(500);
  ok("[SENARYO 5.6] Hizmet Alan, tamamlanmayı doğrudan Hizmet Taleplerim ekranından onayladı");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.waitForTimeout(300);
  const devamEdenBody = await page.locator("body").innerText();
  assert.ok(!devamEdenBody.includes(JOB_A.title), "JOB_A artık Devam Eden'de görünmemeli");
  ok("[SENARYO 5.7] İş Hizmet Alan'ın Devam Eden listesinden çıktı");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(
    page.getByText(JOB_A.title).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 5.8] İş Hizmet Alan'ın Tamamlanan listesine geçti");

  await page.reload();
  await assert.doesNotReject(
    page.getByText(JOB_A.title).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 5.10] Sayfa yenilendiğinde durum korunuyor (Hizmet Alan)");

  await checkNotification(
    page,
    "İşin tamamlanmasını onayladınız. İş Tamamlanan İşler bölümüne taşındı.",
    "/panel/hizmet-taleplerim?durum=tamamlandi",
  );
  ok("[SENARYO 5] Hizmet Alan'ın kendi işlem kaydı bildirimi doğru metinle geldi");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await checkNotification(page, "Hizmet Alan işin tamamlandığını onayladı.", "/panel/tekliflerim");
  ok("[SENARYO 5.9] Hizmet Veren'e 'İş tamamlandı' bildirimi doğru mesajla geldi");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText("Tamamlandı", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  await page.reload();
  await assert.doesNotReject(
    page.getByText("Tamamlandı", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 5.10] Sayfa yenilendiğinde durum korunuyor (Hizmet Veren)");
  await logout(page);

  // ============ SENARYO 6 + 8: itiraz ve iptal (JOB_C) ============
  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await submitOffer(page, JOB_C.id, {
    amount: "9000",
    duration: "4 gün",
    description: "Itiraz ve iptal senaryosu icin teklif, yirmi karakterden uzun aciklama.",
  });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const jobCCard = page.locator("div.rounded-card").filter({ hasText: JOB_C.title });
  await jobCCard.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
  ok("[Kurulum] JOB_C kabul edildi ve işe başlandı");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const jobCOfferCard = page.locator("div.rounded-card").filter({ hasText: JOB_C.title });
  await jobCOfferCard.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
  ok("[Kurulum] JOB_C için tamamlanma talebi gönderildi");
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  const jobCJobCard = page.locator("li").filter({ hasText: JOB_C.title });
  await jobCJobCard.getByRole("button", { name: "İtiraz Et" }).click();
  await page
    .getByLabel("İtiraz Açıklaması")
    .fill("İş gerçekte tamamlanmadı, saha temizliği eksik kaldı.");
  await page.getByRole("dialog").getByRole("button", { name: "İtiraz Et", exact: true }).click();
  await page.waitForTimeout(500);
  ok("[SENARYO 6] Hizmet Alan, Hizmet Taleplerim ekranından doğrudan itiraz etti");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await assert.doesNotReject(
    page.getByText(JOB_C.title).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 6.4] İtiraz sonrası iş Devam Eden'de kalmaya devam ediyor");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.waitForTimeout(300);
  const tamamlandiBody = await page.locator("body").innerText();
  assert.ok(!tamamlandiBody.includes(JOB_C.title), "İtiraz edilen iş Tamamlanan'a girmemeli");
  ok("[SENARYO 6] İtiraz edilen iş yanlışlıkla Tamamlanan'a girmedi");

  await checkNotification(page, "Tamamlanma talebine yaptığınız itiraz Hizmet Veren'e iletildi.");
  ok("[SENARYO 6] Hizmet Alan'a 'İtirazınız kaydedildi' işlem kaydı bildirimi geldi");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await checkNotification(
    page,
    "Hizmet Alan, işin tamamlanma talebine itiraz etti. İtiraz açıklamasını kontrol edin.",
    "/panel/tekliflerim",
  );
  ok("[SENARYO 6.5] Hizmet Veren'e itiraz bildirimi doğru mesajla geldi");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page
      .getByText("İş gerçekte tamamlanmadı, saha temizliği eksik kaldı.")
      .waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 6.6] İtiraz notu Hizmet Veren'in teklif kartında doğru gösteriliyor");
  await logout(page);

  // ============ SENARYO 8: iptal ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  const jobCJobCard2 = page.locator("li").filter({ hasText: JOB_C.title });
  await jobCJobCard2.getByRole("button", { name: "İşi İptal Et" }).click();
  await page.getByRole("button", { name: "Evet, İşi İptal Et" }).click();
  await page.waitForTimeout(500);
  ok("[SENARYO 8] Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.waitForTimeout(300);
  const devamEdenBody2 = await page.locator("body").innerText();
  assert.ok(!devamEdenBody2.includes(JOB_C.title), "İptal edilen iş Devam Eden'de görünmemeli");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await page.waitForTimeout(300);
  const tamamlandiBody2 = await page.locator("body").innerText();
  assert.ok(!tamamlandiBody2.includes(JOB_C.title), "İptal edilen iş yanlışlıkla Tamamlanan'a girmemeli");
  ok("[SENARYO 8.3-4] İptal edilen iş ne Devam Eden'de ne Tamamlanan'da görünüyor");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  await checkNotification(
    page,
    "Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı.",
    "/panel/tekliflerim",
  );
  ok("[SENARYO 8.2] Hizmet Veren'e iptal bildirimi doğru mesajla geldi");

  await page.goto(`${BASE_URL}/panel`);
  await assert.doesNotReject(
    page.getByText("0 / 5").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[SENARYO 8] İptal sonrası aktif iş kapasitesi doğru düştü (0/5)");

  if (consoleErrors.length > 0) {
    console.log("\n[completion-notification-matrix-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[completion-notification-matrix-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate(
    (ids) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter(
        (j) => !ids.includes(j.id),
      );
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter(
        (o) => !ids.includes(o.jobId),
      );
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    [JOB_A.id, JOB_B.id, JOB_C.id],
  );

  await browser.close();
  console.log(`\n[completion-notification-matrix-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[completion-notification-matrix-test] HATA:", error);
  process.exitCode = 1;
});
