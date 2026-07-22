// Otomatik, tek seferlik demo veri sıfırlama migration'ının testi
// (app/_lib/reset-demo-data.ts#runDemoDataResetMigrationIfNeeded, tetikleme
// noktası: header-auth-actions.tsx). Dev-only sayfaya HİÇ gidilmeden,
// yalnızca herhangi bir sayfa açılarak temizliğin otomatik tetiklendiğini
// ve yalnızca BİR KEZ çalıştığını doğrular.
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
        description: "Otomatik migration testi icin olusturulan ilan.",
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

const D1 = { id: "auto-migration-demo-job-1" };
const R1 = { id: "auto-migration-real-job", title: "Otomatik Migration - Gerçek Kullanıcı İlanı" };
const REAL_ALAN = { name: "Elif Gerçek", email: "elif.gercek.automigration@test.com", phone: "0555 800 80 01", password: "ElifGercek1!", role: "hizmet-alan" };

async function register(page, { name, email, phone, password, role }) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit&redirect=/panel`);
  await page.locator('input[type="text"][autocomplete="name"]').fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.getByRole("radio", { name: role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan" }).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(`${BASE_URL}/panel`);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Kurulum: gerçek kullanıcı + ilanı (korunmalı) ---
  await register(page, REAL_ALAN);
  const realAlanId = await getUserId(page, REAL_ALAN.email);
  await seedJob(page, { id: R1.id, title: R1.title, reqId: realAlanId });
  ok("Kurulum: gerçek (demo olmayan) kullanıcı ve ilanı oluşturuldu");
  await logout(page);

  // --- Kurulum: demo hesaplara ait eski veri ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { id: D1.id, title: "Otomatik Migration - Demo İlan", reqId: zeynepId });
  ok("Kurulum: Zeynep'e (demo) ait eski bir ilan oluşturuldu");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, D1.id, { amount: "4500", duration: "1 gün", description: "Otomatik migration testi icin eski teklif, silinmeli." });
  await logout(page);

  // Kurulum sırasındaki (giriş/kayıt) sayfa ziyaretleri de HeaderAuthActions'ı
  // (dolayısıyla migration'ı) mount eder — ama o anda demo hesapların
  // ilan/teklifleri henüz oluşturulmamış olabilir, bu yüzden o ilk çalışma
  // muhtemelen hiçbir şey temizlemeden bayrağı set etmiş olabilir. Gerçek
  // senaryoyu (bu kod hiç çalışmamış, tarayıcıda ESKİDEN BERİ demo veri var)
  // birebir simüle etmek için bayrağı burada bilinçli olarak sıfırlıyoruz.
  await page.evaluate(() => localStorage.removeItem("malsevk.demo_data_reset_version"));
  const flagBefore = await page.evaluate(() => localStorage.getItem("malsevk.demo_data_reset_version"));
  assert.equal(flagBefore, null, "Migration bayrağı temizlenmiş olmalı (gerçek 'eski veri' senaryosunu simüle etmek için)");
  const demoJobExistsBefore = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").some((j) => j.id === id),
    D1.id,
  );
  assert.equal(demoJobExistsBefore, true, "Demo ilan, migration tetiklenmeden önce hâlâ localStorage'da olmalı");
  ok("[Ön koşul] Migration bayrağı sıfırlandı, demo ilan/teklif hâlâ localStorage'da duruyor — gerçek 'eski veri' durumu simüle edildi");

  // --- Dev-only sayfaya HİÇ gitmeden, yalnızca ana sayfayı ziyaret et ---
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(1000); // migration'ın (async) tamamlanması için kısa bekleme

  const flagAfter = await page.evaluate(() => localStorage.getItem("malsevk.demo_data_reset_version"));
  assert.equal(flagAfter, "demo-data-reset-v2", "Ana sayfa ziyareti sonrası migration bayrağı set edilmeli");
  ok("[Otomatik tetikleme] Dev-only sayfaya hiç gidilmeden, yalnızca ana sayfa açılarak migration otomatik çalıştı");

  const jobsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
  assert.ok(!jobsAfter.some((j) => j.id === D1.id), "Demo ilan otomatik olarak silinmiş olmalı");
  assert.ok(jobsAfter.some((j) => j.id === R1.id), "Gerçek kullanıcının ilanı silinmemeli");
  ok("[Otomatik tetikleme] Demo ilan otomatik silindi, gerçek kullanıcının ilanı korundu");

  const offersAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
  assert.equal(offersAfter.filter((o) => o.jobId === D1.id).length, 0, "Demo ilana bağlı teklif kalmamalı");
  ok("[Otomatik tetikleme] Demo teklif otomatik silindi");

  // --- Demo hesaplar hâlâ giriş yapabiliyor, veriler boş ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("Henüz aktif bir hizmet talebiniz bulunmuyor.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Doğrulama] Zeynep hâlâ giriş yapabiliyor, eski ilanı görünmüyor");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText("Henüz herhangi bir ilana teklif vermediniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Doğrulama] Mert hâlâ giriş yapabiliyor, eski teklifi görünmüyor");

  // Yeni ilana teklif verebiliyor mu (temizlik sonrası sistem normal çalışıyor mu)
  await submitOffer(page, R1.id, { amount: "5100", duration: "2 gün", description: "Temizlik sonrasi yeni teklif verilebildigini dogrulayan test." });
  ok("[Doğrulama] Temizlik sonrası yeni teklif verilebiliyor (sistem normal çalışıyor)");
  await logout(page);

  await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
  ok("[Doğrulama] Mehmet Demir hâlâ giriş yapabiliyor");
  await logout(page);

  // --- "Yalnızca bir kez" garantisi: yeni demo veri oluştur, tekrar sayfa aç, silinmediğini doğrula ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId2 = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { id: "auto-migration-demo-job-2", title: "İkinci Çalıştırmada Silinmemeli", reqId: zeynepId2 });
  await logout(page);

  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(800);
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(800);

  const jobsAfterSecondVisit = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
  assert.ok(
    jobsAfterSecondVisit.some((j) => j.id === "auto-migration-demo-job-2"),
    "Migration zaten tamamlandığı için ikinci/üçüncü ziyarette yeni oluşturulan (test amaçlı) ilana dokunulmamalı",
  );
  ok("[Tek seferlik garanti] Migration bayrağı set edildikten sonraki sayfa ziyaretleri veriyi tekrar silmiyor");

  if (consoleErrors.length > 0) {
    console.log("\n[auto-demo-reset-migration-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[auto-demo-reset-migration-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik (bu testin kendi kalıntıları)
  await page.evaluate(
    ({ realAlanEmail, jobIds }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const removedIds = users.filter((u) => u.email === realAlanEmail).map((u) => u.id);
      localStorage.setItem("malsevk.users.v1", JSON.stringify(users.filter((u) => !removedIds.includes(u.id))));
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !jobIds.includes(j.id));
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !jobIds.includes(o.jobId));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { realAlanEmail: REAL_ALAN.email, jobIds: [R1.id, "auto-migration-demo-job-2"] },
  );

  await browser.close();
  console.log(`\n[auto-demo-reset-migration-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[auto-demo-reset-migration-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
