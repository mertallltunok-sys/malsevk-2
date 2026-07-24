// Bu görevin doğrulaması: bir ilana teklif kabul edildiğinde ilan "Teklife
// Kapalı"ya taşınmamalı, diğer Hizmet Verenler yeni teklif verebilmeli, ama
// aynı anda yalnızca TEK teklifin (Mert'in kabul edilen teklifi) anlaşma
// süreci ilerleyebilmeli — Mehmet'in yeni (pending) teklifinde Kabul
// Et/Reddet butonları görünmemeli/pasif olmalı. Anlaşma sağlanamazsa (Mert
// -> agreement_failed) Mehmet'in teklifi normal hale dönmeli.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" }; // hizmet-alan
const MERT = { email: "mert@test.com", password: "Mert123!" }; // hizmet-veren A (kabul edilecek)
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" }; // hizmet-veren B (yeni teklif verecek)
const STAMP = Date.now();
const JOB_ID = `acik-kalan-job-${STAMP}`;
const JOB_TITLE = `ACIK-KALAN-ILAN-${STAMP}`;

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
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

// Mert'in teklifi doğrudan "accepted" olarak seed edilir (asıl test edilen
// davranış — ilanın açık kalması ve Mehmet'in yeni teklif verebilmesi —
// gerçek UI akışıyla test edilir, kabul kararının kendisi değil).
async function seedScenario(page, { zeynepId, mertId }) {
  return page.evaluate(
    ({ zeynepId, mertId, jobId, jobTitle }) => {
      const now = new Date().toISOString();
      const job = {
        id: jobId,
        title: jobTitle,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Açık kalan ilan senaryosu için oluşturulan test ilanı.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
      };
      const offerMert = {
        id: `offer-mert-${jobId}`,
        jobId,
        providerId: mertId,
        amount: 6000,
        currency: "TRY",
        description: "Mert'in kabul edilmiş teklifi, en az yirmi karakter uzunluğunda metin.",
        estimatedDuration: "3 gün",
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      };

      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      jobs.push(job);
      offers.push(offerMert);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { zeynepId, mertId, jobId: JOB_ID, jobTitle: JOB_TITLE },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: Zeynep'in ilanı, Mert'in kabul edilmiş teklifi ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await seedScenario(page, { zeynepId, mertId });
    check("[kurulum] ilan + Mert(accepted) teklifi oluşturuldu", true);
    await clearSession(page);

    // === SENARYO 1: Mehmet (hiç teklif vermemiş) ilan detayında "Teklife Açık" görüyor ===
    console.log('\n=== Senaryo 1: Mehmet ilan detayında "Teklife Açık" görüyor, OfferForm açık ===');
    await loginAs(page, MEHMET, `/ilanlar/${JOB_ID}`);
    let bodyText = await page.locator("main").innerText();
    check("[detay] Rozet 'Teklife Açık' gösteriyor", bodyText.includes("Teklife Açık"));
    check("[detay] Rozet 'Teklife Kapalı' GÖSTERMİYOR", !bodyText.includes("Teklife Kapalı"));
    check(
      "[detay] eski engelleme mesajı YOK ('anlaşma sağlanmıştır')",
      !bodyText.includes("Artık yeni teklif kabul edilmemektedir"),
    );
    const offerFormVisible = await page.getByLabel("Teklif Fiyatı").isVisible().catch(() => false);
    check("[detay] Teklif formu render ediliyor (engellenmemiş)", offerFormVisible);

    // === SENARYO 2: İş İlanları listesinde ilan "Teklife Açık" bölümünde ===
    console.log('\n=== Senaryo 2: "İş İlanları" listesinde ilan "Teklife Açık" bölümünde ===');
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.waitForSelector("text=Teklife Açık İlanlar", { timeout: 10000 });
    const openHeading = page.getByRole("heading", { name: /Teklife Açık İlanlar/ });
    const closedHeading = page.getByRole("heading", { name: /Teklife Kapalı İlanlar/ });
    // grid'in iki kolonu kardeş `<section>` — en yakın ortak kapsayıcının
    // DOĞRUDAN çocuğu olan section'a `xpath=..` ile çıkılır (sayfadaki en
    // dıştaki `<section className="bg-background">` yanlışlıkla her iki
    // başlığı da içerdiği için düz `hasText` eşleşmesi yanıltıcı olurdu).
    const openSection = openHeading.locator("xpath=ancestor::section[1]");
    const closedSection = closedHeading.locator("xpath=ancestor::section[1]");
    check(
      "[liste] ilan 'Teklife Açık İlanlar' bölümünde görünüyor",
      await openSection.getByText(JOB_TITLE).isVisible().catch(() => false),
    );
    check(
      "[liste] ilan 'Teklife Kapalı İlanlar' bölümünde YOK",
      !(await closedSection.getByText(JOB_TITLE).isVisible().catch(() => false)),
    );

    // === SENARYO 3: Mehmet gerçekten teklif verebiliyor (UI üzerinden) ===
    console.log("\n=== Senaryo 3: Mehmet ilana yeni teklif veriyor (UI) ===");
    await page.goto(`${BASE_URL}/ilanlar/${JOB_ID}`);
    await page.getByLabel("Teklif Fiyatı").fill("4500");
    await page.getByLabel("Teklif Açıklaması").fill(
      "Mehmet'in yeni teklifi, en az yirmi karakter uzunluğunda test açıklaması.",
    );
    await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.waitForTimeout(500);
    bodyText = await page.locator("main").innerText();
    check(
      "[teklif] Mehmet'in teklifi başarıyla gönderildi (ret mesajı yok)",
      !bodyText.includes("artık teklif kabul edilmemektedir") && !bodyText.includes("Bu ilan için artık"),
    );
    check("[teklif] 'Bu ilana daha önce teklif verdiniz' özet kartı göründü", bodyText.includes("Bu ilana daha önce teklif verdiniz."));
    await clearSession(page);

    // === SENARYO 4: Zeynep "Gelen Teklifler"de Mehmet'in teklifini görüyor, ama Kabul/Reddet YOK ===
    console.log('\n=== Senaryo 4: Zeynep, Mehmet\'in teklifinde Kabul Et/Reddet butonlarını GÖRMÜYOR ===');
    await loginAs(page, ZEYNEP, "/panel/gelen-teklifler");
    const mehmetCard = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mehmet Demir" });
    await mehmetCard.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[gelen-teklifler] Mehmet'in engelleme mesajı görünüyor",
      await mehmetCard.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.").isVisible().catch(() => false),
    );
    check(
      "[gelen-teklifler] Mehmet için Kabul Et butonu YOK",
      (await mehmetCard.getByRole("button", { name: "Kabul Et" }).count()) === 0,
    );
    check(
      "[gelen-teklifler] Mehmet için Reddet butonu YOK",
      (await mehmetCard.getByRole("button", { name: "Reddet" }).count()) === 0,
    );

    const mertCard = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mert" }).filter({ hasNotText: "Mehmet" });
    await mertCard.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[gelen-teklifler] Mert'in kartında 'Görüşme Sonucu' aksiyon paneli var (accepted)",
      await mertCard.getByText("Görüşme Sonucu", { exact: true }).isVisible().catch(() => false),
    );

    // === SENARYO 5: Zeynep, Mert ile "Anlaşma Sağlanamadı" diyor ===
    console.log('\n=== Senaryo 5: Zeynep, Mert ile "Anlaşma Sağlanamadı" diyor ===');
    await mertCard.getByRole("button", { name: "Anlaşma Sağlanamadı" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle" }).click();
    await page.waitForTimeout(500);
    check("[kurulum] Mert'in teklifi agreement_failed oldu", true);

    // === SENARYO 6: Mehmet'in teklifi artık normal — Kabul Et/Reddet geri geldi ===
    console.log("\n=== Senaryo 6: Mehmet'in teklifi artık normal hale döndü (Kabul Et/Reddet aktif) ===");
    const mehmetCardAfter = page.locator(".rounded-card", { hasText: JOB_TITLE }).filter({ hasText: "Mehmet Demir" });
    await mehmetCardAfter.waitFor({ state: "visible", timeout: 10000 });
    check(
      "[gelen-teklifler] Mehmet için Kabul Et butonu ARTIK VAR",
      await mehmetCardAfter.getByRole("button", { name: "Kabul Et" }).isVisible().catch(() => false),
    );
    check(
      "[gelen-teklifler] Mehmet için Reddet butonu ARTIK VAR",
      await mehmetCardAfter.getByRole("button", { name: "Reddet" }).isVisible().catch(() => false),
    );
    check(
      "[gelen-teklifler] engelleme mesajı ARTIK YOK",
      !(await mehmetCardAfter.getByText("Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.").isVisible().catch(() => false)),
    );

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
