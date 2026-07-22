// Çift taraflı iş tamamlama akışı testi: Hizmet Veren tamamlama talebi
// gönderir, Hizmet Alan onaylar, her iki tarafta da "Devam Eden" ->
// "Tamamlanan" geçişi ve Hizmet Alan'a giden bildirim doğrulanır.
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

const JOB_ID = "completion-flow-job";
const JOB_TITLE = "Tamamlama Akışı Test İlanı";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Kurulum: Zeynep (hizmet-alan) için test ilanı ---
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
        description: "Cift tarafli tamamlama akisi testi icin olusturulan ilan.",
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

  // --- Mert (hizmet-veren) teklif verir ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
  await page.getByLabel("Teklif Fiyatı").fill("7500");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Tamamlama akisi testi icin verilen teklif aciklamasi, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
  ok("[Kurulum] Hizmet Veren (Mert) teklif verdi");
  await logout(page);

  // --- Zeynep teklifi kabul eder, iş başlar ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByRole("button", { name: "Kabul Et" }).click();
  await page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 });
  ok("[Kurulum] Hizmet Alan (Zeynep) teklifi kabul etti");

  await page.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(300);
  ok("[Kurulum] İş başlatıldı (offer -> in_progress)");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await assert.doesNotReject(
    page.getByText(JOB_TITLE).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[ön-koşul] İş başladıktan sonra 'Devam Eden' sekmesinde doğru görünüyor");
  await logout(page);

  // --- Mert tamamlanma talebi gönderir ---
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 10000 });
  ok("[1] Hizmet Veren (Mert) tamamlanma talebini gönderdi (completion_requested)");
  await logout(page);

  // --- Zeynep tamamlanmayı onaylar ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  await page.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(500);
  ok("[2] Hizmet Alan (Zeynep) tamamlanmayı onayladı");

  const offerStatus = await page.evaluate(() => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers[0]?.status;
  });
  assert.equal(offerStatus, "completed", "Offer.status 'completed' olarak kaydedilmeli");
  ok("[Offer.status] localStorage'da gerçekten 'completed' olarak kayıtlı");

  // --- Devam Eden sekmesinden kalkti mi ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page
    .getByText("Henüz devam eden bir işiniz bulunmuyor.")
    .waitFor({ state: "visible", timeout: 10000 });
  const devamEdenBody = await page.locator("body").innerText();
  assert.ok(!devamEdenBody.includes(JOB_TITLE), "İş artık Devam Eden sekmesinde görünmemeli");
  ok("[3] İş 'Devam Eden İşler' sekmesinden kalktı (Hizmet Alan)");

  // --- Tamamlanan sekmesinde mi ---
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(
    page.getByText(JOB_TITLE).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[4] İş 'Tamamlanan İşler' sekmesinde görünüyor (Hizmet Alan)");

  await page.reload();
  await assert.doesNotReject(
    page.getByText(JOB_TITLE).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[persistence] Sayfa yenilendikten sonra da localStorage'dan doğru yükleniyor");

  // --- Bildirim kontrolü ---
  const NOTIF_MESSAGE = "İşin tamamlanmasını onayladınız. İş Tamamlanan İşler bölümüne taşındı.";
  await page.getByRole("button", { name: /Bildirimler/ }).click();
  const notifItem = page.getByRole("menuitem").filter({ hasText: NOTIF_MESSAGE });
  await assert.doesNotReject(notifItem.waitFor({ state: "visible", timeout: 10000 }));
  ok("[5] 'İş tamamlandı' bildirimi doğru mesajla görünüyor");

  const href = await notifItem.getAttribute("href");
  assert.equal(
    href,
    "/panel/hizmet-taleplerim?durum=tamamlandi",
    "Bildirim linki Tamamlanan İşler sayfasına işaret etmeli",
  );
  ok("[6] Bildirim linki doğru rotaya işaret ediyor");

  await notifItem.click();
  await page.waitForURL(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(
    page.getByText(JOB_TITLE).waitFor({ state: "visible", timeout: 10000 }),
  );
  const notFoundVisible = await page.getByText(/404|bulunamadı/i).count();
  assert.equal(notFoundVisible, 0, "Bildirime tıklayınca bozuk/boş bir sayfa açılmamalı");
  ok("[7] Bildirime tıklanınca doğru sayfaya gidiliyor, bozuk/boş route oluşmuyor");

  // --- Mert tarafında durum kontrolü ---
  await logout(page);
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText("Tamamlandı", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[8] Hizmet Veren tarafında teklif durumu 'Tamamlandı' olarak görünüyor");

  await page.reload();
  await assert.doesNotReject(
    page.getByText("Tamamlandı", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[persistence] Hizmet Veren tarafında da yenileme sonrası durum korunuyor");

  if (consoleErrors.length > 0) {
    console.log("\n[completion-flow-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[completion-flow-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  await page.evaluate((jobId) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter(
      (j) => j.id !== jobId,
    );
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter(
      (o) => o.jobId !== jobId,
    );
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, JOB_ID);

  await browser.close();
  console.log(`\n[completion-flow-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[completion-flow-test] HATA:", error);
  process.exitCode = 1;
});
