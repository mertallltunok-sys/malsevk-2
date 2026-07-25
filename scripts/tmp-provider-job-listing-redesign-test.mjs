// Hizmet Veren "İş İlanlarını İncele" (Aktif İlanlar) ekranının yeniden
// tasarımını doğrular: eski "Teklife Açık"/"Teklife Kapalı" iki sütun
// tamamen kalkmış olmalı, canlı arama/filtreler/rozetler/favoriler/son
// görüntülenenler çalışmalı, ve Tek Aktif Kabul mimarisi (başka bir
// sağlayıcının kabul edilmiş teklifi olan bir ilan hâlâ listede görünmeli)
// bozulmamış olmalı.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" };
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/ilanlar") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

const JOB_A_ID = `redesign-job-a-${STAMP}`; // Depo Personeli, İzmir, 0 teklif -> "Teklif Bekliyor"
const JOB_B_ID = `redesign-job-b-${STAMP}`; // Forklift, Kocaeli, ACİL kelimesi başlıkta -> "Acil"
const JOB_C_ID = `redesign-job-c-${STAMP}`; // Vinç, İstanbul, başka sağlayıcının kabul edilmiş teklifi var (SAA regresyon)

async function seedScenario(page, { zeynepId, mehmetId }) {
  return page.evaluate(
    ({ zeynepId, mehmetId, jobAId, jobBId, jobCId, stamp }) => {
      const now = new Date().toISOString();
      const baseJob = {
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
        operationDetails: "Test operasyon detayı.",
      };
      const jobs = [
        {
          ...baseJob,
          id: jobAId,
          title: `REDESIGN-A-DEPO-${stamp}`,
          category: "depo-personeli",
          province: "İzmir",
          district: "Aliağa",
          workLocationType: "Depo Sahası",
          workDate: "2026-12-01",
          description: "Depo personeli ihtiyacı için test ilanı, arama testinde kullanılacak.",
        },
        {
          ...baseJob,
          id: jobBId,
          title: `REDESIGN-B-ACIL-FORKLIFT-${stamp}`,
          category: "forklift",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Fabrika",
          workDate: "2026-12-05",
          description: "ACİL forklift operatörü aranıyor, bu ilan çok kısa sürede doldurulmalı.",
        },
        {
          ...baseJob,
          id: jobCId,
          title: `REDESIGN-C-VINC-${stamp}`,
          category: "vinc",
          province: "İstanbul",
          district: "Tuzla",
          workLocationType: "Liman Sahası",
          workDate: "2026-12-10",
          description: "Vinç operatörü ihtiyacı, başka bir sağlayıcının teklifi kabul edilmiş test ilanı.",
        },
      ];

      const offerC = {
        id: `offer-c-${stamp}`,
        jobId: jobCId,
        providerId: mehmetId,
        amount: 7000,
        currency: "TRY",
        description: "Mehmet'in kabul edilmiş teklifi, test için yirmi karakterden uzun metin.",
        estimatedDuration: "4 gün",
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      };

      const existingJobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const existingOffers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existingJobs, ...jobs]));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existingOffers, offerC]));
    },
    { zeynepId, mehmetId, jobAId: JOB_A_ID, jobBId: JOB_B_ID, jobCId: JOB_C_ID, stamp: STAMP },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: 3 test ilanı (A: teklifsiz, B: acil, C: başka sağlayıcıya kabul edilmiş) ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MEHMET, "/panel");
    const mehmetId = await getUserId(page, MEHMET.email);
    await seedScenario(page, { zeynepId, mehmetId });
    check("[kurulum] 3 test ilanı + C için kabul edilmiş teklif oluşturuldu", true);
    await clearSession(page);

    console.log("\n=== Senaryo 1: Mert 'Aktif İlanlar' ekranını görüyor, eski 2-sütun YOK ===");
    await loginAs(page, MERT, "/ilanlar");
    await page.getByRole("heading", { name: "Aktif İlanlar" }).waitFor({ state: "visible", timeout: 10000 });
    let bodyText = await page.locator("main").innerText();
    check("[genel] 'Aktif İlanlar' başlığı var", bodyText.includes("Aktif İlanlar"));
    check("[genel] 'Teklife Açık İlanlar' YOK", !bodyText.includes("Teklife Açık İlanlar"));
    check("[genel] 'Teklife Kapalı İlanlar' YOK", !bodyText.includes("Teklife Kapalı İlanlar"));
    check("[genel] Sonuç sayacı görünüyor (örn. 'Aktif İlan')", /\d+\s*Aktif İlan/.test(bodyText));

    console.log("\n=== Senaryo 2: Tek Aktif Kabul regresyonu — C ilanı (başkasına kabul edilmiş) hâlâ listede ===");
    check("[SAA] C ilanı listede görünüyor", bodyText.includes(`REDESIGN-C-VINC-${STAMP}`));
    const jobCRow = page.locator("tr, li").filter({ hasText: `REDESIGN-C-VINC-${STAMP}` }).first();
    await jobCRow.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[SAA] C ilanı için 'İlanı İncele' hâlâ tıklanabilir (teklif engellenmemiş)",
      await jobCRow.getByRole("link", { name: "İlanı İncele" }).isVisible().catch(() => false),
    );

    console.log("\n=== Senaryo 3: Canlı arama (Türkçe karakter duyarlı) ===");
    await page.getByLabel("İlanlarda ara").fill("izmir");
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check("[arama] 'izmir' araması A ilanını buluyor (İzmir, büyük İ farkı yok)", bodyText.includes(`REDESIGN-A-DEPO-${STAMP}`));
    check("[arama] 'izmir' araması B/C ilanlarını GETİRMİYOR", !bodyText.includes(`REDESIGN-B-ACIL`) && !bodyText.includes(`REDESIGN-C-VINC`));
    await page.getByLabel("İlanlarda ara").fill("");
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 4: Rozetler — Acil / Teklif Bekliyor ===");
    const jobBRow = page.locator("tr, li").filter({ hasText: `REDESIGN-B-ACIL-FORKLIFT-${STAMP}` }).first();
    await jobBRow.waitFor({ state: "visible", timeout: 10000 });
    check("[rozet] B ilanında 'Acil' rozeti var", await jobBRow.getByText("Acil", { exact: true }).isVisible().catch(() => false));
    const jobARow = page.locator("tr, li").filter({ hasText: `REDESIGN-A-DEPO-${STAMP}` }).first();
    await jobARow.waitFor({ state: "visible", timeout: 10000 });
    check("[rozet] A ilanında 'Teklif Bekliyor' rozeti var (0 teklif)", await jobARow.getByText("Teklif Bekliyor").isVisible().catch(() => false));

    console.log("\n=== Senaryo 5: Favoriler — ekle, kalıcılık, filtre ===");
    await jobARow.getByRole("button", { name: "Favorilere ekle" }).click();
    await page.waitForTimeout(200);
    check("[favori] A ilanı favorilere eklendi (buton etiketi değişti)", await jobARow.getByRole("button", { name: "Favorilerden çıkar" }).isVisible().catch(() => false));
    await page.reload();
    await page.getByRole("heading", { name: "Aktif İlanlar" }).waitFor({ state: "visible", timeout: 10000 });
    const jobARowAfterReload = page.locator("tr, li").filter({ hasText: `REDESIGN-A-DEPO-${STAMP}` }).first();
    check("[favori] Sayfa yenilendikten sonra favori KALICI", await jobARowAfterReload.getByRole("button", { name: "Favorilerden çıkar" }).isVisible().catch(() => false));

    await page.getByRole("button", { name: "Yalnızca Favorilerim" }).click();
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check("[favori-filtre] Yalnızca A ilanı görünüyor", bodyText.includes(`REDESIGN-A-DEPO-${STAMP}`));
    check("[favori-filtre] B ilanı görünmüyor", !bodyText.includes(`REDESIGN-B-ACIL`));
    await page.getByRole("button", { name: "Yalnızca Favorilerim" }).click();
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 6: Hizmet Türü filtresi ===");
    await page.getByRole("button", { name: "Hizmet Türü" }).click();
    await page.locator('ul[aria-label="Hizmet Türü"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="Hizmet Türü"]').getByRole("option", { name: "Forklift", exact: true }).click();
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check("[filtre] Yalnızca Forklift kategorisindeki B ilanı görünüyor", bodyText.includes(`REDESIGN-B-ACIL`));
    check("[filtre] Depo Personeli kategorisindeki A ilanı GÖRÜNMÜYOR", !bodyText.includes(`REDESIGN-A-DEPO`));
    await page.getByText("Filtreleri Temizle").click();
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 7: Son Görüntülenenler ===");
    const jobBLink = page.locator("tr, li").filter({ hasText: `REDESIGN-B-ACIL-FORKLIFT-${STAMP}` }).getByRole("link", { name: "İlanı İncele" }).first();
    await jobBLink.click();
    await page.waitForURL(/\/ilanlar\/redesign-job-b-/, { timeout: 10000 });
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.getByRole("heading", { name: "Aktif İlanlar" }).waitFor({ state: "visible", timeout: 10000 });
    check(
      "[son-görüntülenen] 'Son Görüntülenenler' bölümü göründü",
      await page.getByRole("heading", { name: /son görüntülenenler/i }).isVisible().catch(() => false),
    );
    bodyText = await page.locator("main").innerText();
    check("[son-görüntülenen] B ilanı orada listeleniyor", bodyText.includes(`REDESIGN-B-ACIL-FORKLIFT-${STAMP}`));

    check("Genel: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
