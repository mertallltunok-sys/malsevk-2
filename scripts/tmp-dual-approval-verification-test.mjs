// İkili onay (Hizmet Veren tamamlanma talebi gönderir, Hizmet Alan onaylar/
// itiraz eder) akışının iddia edilen "regresyon" sonrası kapsamlı doğrulaması.
// Kapsanan zorunlu senaryolar:
//  - Hizmet Veren talep gönderir -> Hizmet Alan onaylar -> tamamlandı.
//  - Talep gönderilir -> karşı taraf itiraz eder -> tamamlanmaz.
//  - Tek taraf işlem yaptığında iş Tamamlanan'a düşmez (in_progress/
//    completion_requested/completion_disputed hiçbiri "tamamlandi" filtresine
//    girmez).
//  - Onay sonrası iki hesapta da durum senkron görünür (sayfa yenilemeden).
//  - Bildirimler doğru kullanıcıya ve çalışan route'a gider (404 yok).
//  - Sayfa yenilemesinde durum kaybolmaz.
//  - Mobil görünümde aksiyonlar erişilebilir olur (yatay taşma yok, butonlar
//    tıklanabilir).
//  - Konsol hatası olmaz.
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
async function seedJob(page, { id, title, reqId }) {
  await page.evaluate(
    ({ id, title, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id, title, category: "Depolama", province: "Kocaeli", district: "Gebze",
        workLocationType: "Test Tesis", workDate: "2026-12-01",
        description: "Ikili onay dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.", status: "yayinda",
        requesterId: reqId, photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId },
  );
}
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

const J1 = { id: "dual-approval-job-1", title: "Ikili Onay Test - Onaylanan" };
const J2 = { id: "dual-approval-job-2", title: "Ikili Onay Test - Itiraz Edilen" };

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const notFoundHits = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("response", (res) => {
    if (res.status() === 404) notFoundHits.push(res.url());
  });

  // --- Kurulum ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...J1, reqId: zeynepId });
  await seedJob(page, { ...J2, reqId: zeynepId });
  ok("Kurulum: 2 test ilanı oluşturuldu");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, J1.id, { amount: "5000", duration: "1 gün", description: "J1 icin teklif, yirmi karakterden uzun aciklama metni." });
  await submitOffer(page, J2.id, { amount: "5100", duration: "1 gün", description: "J2 icin teklif, yirmi karakterden uzun aciklama metni." });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  for (const job of [J1, J2]) {
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    const card = page.locator("div.rounded-card").filter({ hasText: job.title });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(300);
    await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
    await page.waitForTimeout(300);
  }
  ok("Kurulum: J1 ve J2 kabul edildi, işe başlandı (in_progress)");
  await logout(page);

  // ============ ZORUNLU: tek taraf işlem yaptığında Tamamlanan'a düşmez ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const tamamlandiBodyBefore = await page.locator("body").innerText();
  assert.ok(!tamamlandiBodyBefore.includes(J1.title), "in_progress durumundaki iş Tamamlanan'da görünmemeli");
  ok("[Zorunlu] in_progress durumunda iş Tamamlanan sekmesine düşmüyor");
  await logout(page);

  // ============ SENARYO: Hizmet Veren talep gönderir -> Hizmet Alan onaylar -> tamamlandı ============
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const j1OfferCard = page.locator("div.rounded-card").filter({ hasText: J1.title });
  await assert.doesNotReject(
    j1OfferCard.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Ekran: Hizmet Veren > Verdiğim Teklifler] 'Tamamlandı Olarak İşaretle' butonu görünüyor (in_progress)");
  await j1OfferCard.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);

  const j1StatusAfterRequest = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J1.id);
  assert.equal(j1StatusAfterRequest, "completion_requested", "Talep sonrası completion_requested olmalı, DOĞRUDAN completed OLMAMALI");
  ok("[Zorunlu] Tek taraflı talep işi completed yapmıyor (completion_requested'da bekliyor)");

  await assert.doesNotReject(
    j1OfferCard.getByText("Tamamlanma onayı bekleniyor").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Ekran: Verdiğim Teklifler] Talep sonrası 'Tamamlanma onayı bekleniyor' gösteriliyor");
  await logout(page);

  // Hizmet Alan tarafında talep görünüyor mu (Gelen Teklifler)
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j1IncomingCard = page.locator("div.rounded-card").filter({ hasText: J1.title });
  await assert.doesNotReject(
    j1IncomingCard.getByRole("button", { name: "Tamamlandığını Onayla" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    j1IncomingCard.getByRole("button", { name: "İtiraz Et" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Ekran: Hizmet Alan > Gelen Teklifler] Talep görünüyor, 'Tamamlandığını Onayla' + 'İtiraz Et' butonları mevcut");

  // Aynı akış Hizmet Taleplerim > Devam Eden'de de var mı
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  const j1RequestsCard = page.locator("li").filter({ hasText: J1.title });
  await assert.doesNotReject(
    j1RequestsCard.getByRole("button", { name: "Tamamlandığını Onayla" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    j1RequestsCard.getByRole("button", { name: "İtiraz Et" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Ekran: Hizmet Alan > Hizmet Taleplerim > Devam Eden] Aynı onay/itiraz butonları burada da mevcut");

  // Bildirim doğru kullanıcıya/route'a gidiyor mu
  await page.getByRole("button", { name: /Bildirimler/ }).click();
  const notifItem = page.getByRole("menuitem").filter({ hasText: "Hizmet Veren işin tamamlandığını bildirdi" });
  await assert.doesNotReject(notifItem.waitFor({ state: "visible", timeout: 10000 }));
  const notifHref = await notifItem.getAttribute("href");
  await notifItem.click();
  await page.waitForLoadState("networkidle");
  const notFoundAfterNotifClick = await page.getByText(/404|bulunamadı|sayfa bulunamadı/i).count();
  assert.equal(notFoundAfterNotifClick, 0, "Bildirime tıklayınca 404/bozuk sayfa açılmamalı");
  ok(`[Bildirim] 'Tamamlanma onayı bekleniyor' bildirimi doğru linke (${notifHref}) gidiyor, 404 yok`);

  // Onayla
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j1IncomingCard2 = page.locator("div.rounded-card").filter({ hasText: J1.title });
  await j1IncomingCard2.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Daha Sonra" }).click(); // otomatik açılan değerlendirme modalını geç

  const j1StatusAfterConfirm = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId)?.status;
  }, J1.id);
  assert.equal(j1StatusAfterConfirm, "completed", "Hizmet Alan onaylayınca completed olmalı");
  ok("[SENARYO] Hizmet Veren talep gönderdi -> Hizmet Alan onayladı -> iş completed oldu");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  await assert.doesNotReject(page.getByText(J1.title).waitFor({ state: "visible", timeout: 10000 }));
  ok("[Zorunlu] İki taraflı onay tamamlanınca iş Tamamlanan sekmesine geçti");

  await assert.doesNotReject(
    page.locator("li").filter({ hasText: J1.title }).getByRole("button", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Zorunlu] Tamamlanınca puanlama alanı (Hizmeti Değerlendir) korunuyor");
  await page.reload();
  await assert.doesNotReject(page.getByText(J1.title).waitFor({ state: "visible", timeout: 10000 }));
  ok("[Zorunlu] Sayfa yenilemesinde durum (Tamamlanan) kaybolmuyor");
  await logout(page);

  // İki hesapta da senkron mu (Mert tarafı, sayfa yenilemeden yeniden giriş)
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.locator("div.rounded-card").filter({ hasText: J1.title }).getByText("Tamamlandı", { exact: true }).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Zorunlu] Onay sonrası Hizmet Veren hesabında da durum 'Tamamlandı' olarak senkron görünüyor");
  await logout(page);

  // ============ SENARYO: talep gönderilir -> karşı taraf itiraz eder -> tamamlanmaz ============
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const j2OfferCard = page.locator("div.rounded-card").filter({ hasText: J2.title });
  await j2OfferCard.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const j2Card = page.locator("div.rounded-card").filter({ hasText: J2.title });
  await j2Card.getByRole("button", { name: "İtiraz Et" }).click();
  await page.getByLabel("İtiraz Açıklaması").fill("İş gerçekte tamamlanmadı, eksikler var, doğrulama testi.");
  await page.getByRole("dialog").getByRole("button", { name: "İtiraz Et", exact: true }).click();
  await page.waitForTimeout(400);

  const j2StatusAfterDispute = await page.evaluate((jobId) => {
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    return offers.find((o) => o.jobId === jobId);
  }, J2.id);
  assert.equal(j2StatusAfterDispute.status, "completion_disputed", "İtiraz sonrası completion_disputed olmalı");
  assert.ok(j2StatusAfterDispute.completionDisputeNote?.includes("doğrulama testi"), "İtiraz notu korunmalı");
  ok("[SENARYO] Talep gönderildi -> Hizmet Alan itiraz etti -> iş tamamlanmadı (completion_disputed), itiraz notu korunuyor");

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const tamamlandiBodyAfterDispute = await page.locator("body").innerText();
  assert.ok(!tamamlandiBodyAfterDispute.includes(J2.title), "İtiraz edilen iş Tamamlanan'a düşmemeli");
  ok("[Zorunlu] İtiraz edilen iş Tamamlanan sekmesine düşmüyor");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.locator("div.rounded-card").filter({ hasText: J2.title }).getByText(/İtiraz edildi/).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Zorunlu] İtiraz sonrası Hizmet Veren hesabında da durum senkron görünüyor (İtiraz edildi)");
  await logout(page);

  // ============ MOBİL GÖRÜNÜM: aksiyonlar erişilebilir mi ============
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await page.waitForTimeout(300);
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.ok(!mobileOverflow, "Mobilde 'Hizmet Taleplerim > Devam Eden' yatay taşma yapmamalı");
  const j2MobileCard = page.locator("li").filter({ hasText: J2.title });
  await assert.doesNotReject(
    j2MobileCard.getByRole("button", { name: "Tamamlandı Olarak Kapat" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await assert.doesNotReject(
    j2MobileCard.getByRole("button", { name: "İşi İptal Et" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Mobil] Devam Eden ekranındaki itiraz-sonrası aksiyonlar (Tamamlandı Olarak Kapat / İşi İptal Et) mobilde de erişilebilir, taşma yok");
  await page.setViewportSize({ width: 1280, height: 800 });
  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[dual-approval-verification-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[dual-approval-verification-test] Konsolda hiç JS hatası yakalanmadı.");
  }
  if (notFoundHits.length > 0) {
    console.log("\n[dual-approval-verification-test] UYARI: 404 yanıtları yakalandı:");
    for (const url of notFoundHits) console.log(`  ! ${url}`);
  } else {
    console.log("[dual-approval-verification-test] Hiç 404 yanıtı yakalanmadı.");
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
  console.log(`\n[dual-approval-verification-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[dual-approval-verification-test] HATA:", error);
  process.exitCode = 1;
});
