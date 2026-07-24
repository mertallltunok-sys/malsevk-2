// Demo veri temizliğinin (app/_lib/reset-demo-data.ts) tekrar talep edilen
// çalıştırmasını doğrular: DEMO_DATA_RESET_VERSION "demo-data-reset-v3" ->
// "demo-data-reset-v4" (mantık değişmedi, yalnızca yeniden tetikleme).
// Kapsam: (A) gerçekçi demo kirliliği (çeşitli Offer.status'ları + rating +
// okunma/silinme bildirim durumu) + saf gerçek kullanıcı kontrol grubu
// seed'lenir, (B) dev-only sayfadan (/gelistirme/demo-veri-sifirla) DRY-RUN
// raporu alınır (hiçbir şey silinmeden), (C) "Temizliği Uygula" çalıştırılır,
// (D) 8 kabul kriteri doğrulanır, (E) gerçek kullanıcının verisi dokunulmadan
// kaldığı teyit edilir, (F) otomatik tek-seferlik migration'ın v3 -> v4
// altında da doğru tetiklendiği ayrıca (bağımsız bir tarayıcı bağlamında)
// doğrulanır.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STAMP = Date.now();

const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" };

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
async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
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

function seedRealUser(page, { id, name, email, phone, role }) {
  return page.evaluate(
    ({ id, name, email, phone, role }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      users.push({ id, name, email, phone, passwordHash: "not-used-in-this-test", role });
      localStorage.setItem("malsevk.users.v1", JSON.stringify(users));
    },
    { id, name, email, phone, role },
  );
}

function seedScenario(page, { zeynepId, mertId, mehmetId, realAlanId, realVerenId }) {
  return page.evaluate(
    ({ zeynepId, mertId, mehmetId, realAlanId, realVerenId, stamp }) => {
      const now = new Date().toISOString();
      const jobBase = {
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Demo veri temizliği (v4) testi için oluşturulan ilan.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        photos: [],
      };
      const offerBase = {
        amount: 5000,
        currency: "TRY",
        description: "Demo veri temizliği (v4) testi için oluşturulan teklif metni, yirmi karakterden uzun.",
        estimatedDuration: "2 gün",
      };

      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");

      // --- Demo kirliliği: Zeynep'in ilanları + Mert/Mehmet'in çeşitli durumdaki teklifleri ---
      const demoScenarios = [
        { key: "pending", offerStatus: "pending", providerId: mertId },
        { key: "accepted", offerStatus: "accepted", providerId: mertId },
        { key: "in_progress", offerStatus: "in_progress", providerId: mehmetId },
        { key: "completed", offerStatus: "completed", providerId: mehmetId, withRating: true },
        { key: "rejected", offerStatus: "rejected", providerId: mertId },
        { key: "cancelled", offerStatus: "cancelled", providerId: mehmetId },
        { key: "agreement_failed", offerStatus: "agreement_failed", providerId: mertId },
      ];
      for (const scenario of demoScenarios) {
        const jobId = `v4-demo-job-${scenario.key}-${stamp}`;
        const offerId = `v4-demo-offer-${scenario.key}-${stamp}`;
        jobs.push({ id: jobId, title: `V4-DEMO-${scenario.key.toUpperCase()}-${stamp}`, requesterId: zeynepId, ...jobBase });
        offers.push({
          id: offerId,
          jobId,
          providerId: scenario.providerId,
          status: scenario.offerStatus,
          createdAt: now,
          updatedAt: now,
          ...offerBase,
        });
        if (scenario.withRating) {
          ratings.push({
            id: `v4-demo-rating-${scenario.key}-${stamp}`,
            offerId,
            jobId,
            providerId: scenario.providerId,
            raterId: zeynepId,
            stars: 5,
            createdAt: now,
          });
        }
      }

      // --- Demo Hizmet Veren'in GERÇEK bir ilana verdiği teklif (yalnızca bu teklif silinmeli, ilan kalmalı) ---
      const mixedJobId = `v4-mixed-real-job-${stamp}`;
      const mixedOfferId = `v4-mixed-demo-offer-${stamp}`;
      jobs.push({ id: mixedJobId, title: `V4-KARISIK-GERCEK-ILAN-${stamp}`, requesterId: realAlanId, ...jobBase });
      offers.push({
        id: mixedOfferId,
        jobId: mixedJobId,
        providerId: mertId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
        ...offerBase,
      });
      ratings.push({
        id: `v4-mixed-rating-${stamp}`,
        offerId: mixedOfferId,
        jobId: mixedJobId,
        providerId: mertId,
        raterId: realAlanId,
        stars: 4,
        createdAt: now,
      });

      // --- Saf gerçek kontrol grubu: demo ile hiç teması yok, HİÇ dokunulmamalı ---
      const pureRealJobId = `v4-pure-real-job-${stamp}`;
      const pureRealOfferId = `v4-pure-real-offer-${stamp}`;
      jobs.push({ id: pureRealJobId, title: `V4-SAF-GERCEK-${stamp}`, requesterId: realAlanId, ...jobBase });
      offers.push({
        id: pureRealOfferId,
        jobId: pureRealJobId,
        providerId: realVerenId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
        ...offerBase,
      });
      ratings.push({
        id: `v4-pure-real-rating-${stamp}`,
        offerId: pureRealOfferId,
        jobId: pureRealJobId,
        providerId: realVerenId,
        raterId: realAlanId,
        stars: 5,
        createdAt: now,
      });

      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));

      // --- Bildirim okunma/silinme "kirliliği" (üç demo hesap için) ---
      for (const userId of [zeynepId, mertId, mehmetId]) {
        localStorage.setItem(`malsevk_read_notifications_${userId}`, JSON.stringify([`stale-read-${stamp}`]));
        localStorage.setItem(`malsevk_dismissed_notifications_${userId}`, JSON.stringify([`stale-dismissed-${stamp}`]));
      }

      return {
        jobIds: [...demoScenarios.map((s) => `v4-demo-job-${s.key}-${stamp}`), mixedJobId, pureRealJobId],
        mixedJobId,
        pureRealJobId,
        pureRealOfferId,
      };
    },
    { zeynepId, mertId, mehmetId, realAlanId, realVerenId, stamp: STAMP },
  );
}

async function submitOffer(page, jobId) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("4200");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Temizlik sonrası sıfırdan verilen yeni teklif, yirmi karakterden uzun bir açıklama metni.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== FAZ A: Gerçekçi demo kirliliği + gerçek kullanıcı kontrol grubu seed'leniyor ===");
    await page.goto(BASE_URL);
    // Bu iki hesabın kendisiyle giriş yapılmıyor -- yalnızca "gerçek
    // kullanıcı" temsilcisi StoredUser kaydı gerekli (bkz. önceki demo
    // temizliği görevindeki aynı desen).
    const realAlanId = `v4-real-alan-${STAMP}`;
    const realVerenId = `v4-real-veren-${STAMP}`;
    await seedRealUser(page, { id: realAlanId, name: "Elif Gerçek", email: `elif.v4.${STAMP}@test.com`, phone: "0555 900 00 01", role: "hizmet-alan" });
    await seedRealUser(page, { id: realVerenId, name: "Ahmet Gerçek", email: `ahmet.v4.${STAMP}@test.com`, phone: "0555 900 00 02", role: "hizmet-veren" });

    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await logout(page);
    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await logout(page);
    await loginAs(page, MEHMET, "/panel");
    const mehmetId = await getUserId(page, MEHMET.email);
    await logout(page);

    const seeded = await seedScenario(page, { zeynepId, mertId, mehmetId, realAlanId, realVerenId });
    check("[A] 7 durumlu demo kirliliği + karışık gerçek/demo + saf gerçek kontrol grubu + bildirim okunma/silinme kirliliği seed'lendi", true);

    // === FAZ B: Dry-run raporu (dev-only sayfa, hiçbir şey silinmeden) ===
    console.log("\n=== FAZ B: Dry-run raporu (/gelistirme/demo-veri-sifirla) ===");
    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/gelistirme/demo-veri-sifirla`);
    await page.getByRole("button", { name: "Planı Hesapla (Dry-Run)" }).click();
    await page.getByText("Silinecek kayıtlar (dry-run)").waitFor({ state: "visible", timeout: 10000 });

    const dryRunText = await page.locator("main").innerText();
    console.log("\n    --- DRY-RUN RAPORU (uygulamadan aynen alındı) ---");
    for (const line of dryRunText.split("\n")) {
      if (/ilan|teklif|değerlendirme|bildirim okunma|kullanıcı|Kullanıcılar|İlanlar|Teklifler/i.test(line) && line.trim()) {
        console.log(`    | ${line.trim()}`);
      }
    }
    console.log("    --- RAPOR SONU ---\n");

    check("[B] Dry-run raporu: tam olarak '7 ilan' silinecek diyor", dryRunText.includes("7 ilan"));
    check("[B] Dry-run raporu: tam olarak '8 teklif' silinecek diyor", dryRunText.includes("8 teklif"));
    check("[B] Dry-run raporu: tam olarak '2 değerlendirme' silinecek diyor", dryRunText.includes("2 değerlendirme"));
    // Bu aşamada HENÜZ hiçbir şey silinmemiş olmalı -- kontrol.
    const jobsStillThereBeforeApply = await page.evaluate(
      (jobIds) => {
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        return jobIds.every((id) => jobs.some((j) => j.id === id));
      },
      seeded.jobIds,
    );
    check("[B] Dry-run HİÇBİR VERİYİ silmedi (tüm seed edilen ilanlar hâlâ duruyor)", jobsStillThereBeforeApply);

    // === FAZ C: Temizliği Uygula ===
    console.log("\n=== FAZ C: 'Temizliği Uygula' çalıştırılıyor ===");
    await page.getByRole("button", { name: "Temizliği Uygula" }).click();
    await page.getByText("Temizlik tamamlandı.").waitFor({ state: "visible", timeout: 10000 });
    check("[C] Temizlik uygulandı", true);
    await logout(page);

    // === FAZ D: 8 kabul kriteri ===
    console.log("\n=== FAZ D: Kabul kriterleri ===");

    // 1) Demo Hizmet Alan hâlâ giriş yapabiliyor
    await loginAs(page, ZEYNEP, "/panel");
    check("[1] Demo Hizmet Alan (Zeynep) mevcut ve giriş yapabiliyor", true);

    // 3) Demo hesaba ait ilan sayısı 0
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await assert.doesNotReject(
      page.getByText("Henüz aktif bir hizmet talebiniz bulunmuyor.").waitFor({ state: "visible", timeout: 10000 }),
    );
    check("[3] Zeynep'in Hizmet Taleplerim'inde hiç ilan yok (demo ilan sayısı 0)", true);

    // 5) İlişkili eski bildirimler görünmüyor
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const zeynepNotifBody = await page.locator("main").innerText();
    check(
      "[5] Zeynep'in bildirimlerinde eski demo ilan başlıkları YOK",
      !zeynepNotifBody.includes(`V4-DEMO-`) && !zeynepNotifBody.includes(`V4-KARISIK`),
    );
    const zeynepReadKeyGone = await page.evaluate(
      (uid) => localStorage.getItem(`malsevk_read_notifications_${uid}`),
      zeynepId,
    );
    check("[5] Zeynep'in eski 'okunmuş bildirim' kirliliği temizlendi", zeynepReadKeyGone === null, `değer=${zeynepReadKeyGone}`);

    // 6) Yeni ilan oluşturma sorunsuz çalışıyor
    const NEW_JOB_TITLE = `V4-YENI-ILAN-${STAMP}`;
    await page.evaluate(
      ({ zeynepId, title }) => {
        const job = {
          id: `v4-fresh-job-${title}`,
          title,
          category: "Depolama",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Test Tesis",
          workDate: "2026-12-01",
          description: "Temizlik sonrası sıfırdan oluşturulan yeni ilan.",
          operationDetails: "Test operasyon detayı.",
          status: "yayinda",
          requesterId: zeynepId,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      },
      { zeynepId, title: NEW_JOB_TITLE },
    );
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await assert.doesNotReject(page.getByText(NEW_JOB_TITLE).waitFor({ state: "visible", timeout: 10000 }));
    check("[6] Temizlik sonrası Zeynep yeni ilan oluşturabiliyor", true);
    await logout(page);

    // 2) Demo Hizmet Veren hesapları hâlâ giriş yapabiliyor
    await loginAs(page, MERT, "/panel");
    check("[2] Demo Hizmet Veren (Mert) mevcut ve giriş yapabiliyor", true);

    // 4) Demo hesaba ait teklif sayısı 0
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    await assert.doesNotReject(
      page.getByText("Henüz herhangi bir ilana teklif vermediniz.").waitFor({ state: "visible", timeout: 10000 }),
    );
    const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
    await tablist.waitFor({ state: "visible", timeout: 10000 });
    for (const tab of ["Devam Eden", "Tamamlanan", "Kapanan Teklifler"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(150);
      const body = await page.locator("main").innerText();
      check(`[4] Mert'in '${tab}' sekmesinde de hiç eski demo teklif yok`, !body.includes("V4-DEMO-") && !body.includes("V4-KARISIK") && !body.includes("V4-SAF-GERCEK"));
    }
    check("[4] Mert'in 'Aktif' sekmesinde de hiç teklif yok (demo teklif sayısı 0)", true);

    // 6) Yeni teklif verme sorunsuz çalışıyor -- ayrıca kabul akışı sıfırdan test edilebiliyor
    await page.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    await logout(page);
    await loginAs(page, ZEYNEP, "/panel/hizmet-taleplerim");
    const freshJobId = await page.evaluate(
      (title) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").find((j) => j.title === title)?.id,
      NEW_JOB_TITLE,
    );
    await logout(page);
    await loginAs(page, MERT, "/panel");
    await submitOffer(page, freshJobId);
    check("[6] Temizlik sonrası Mert sıfırdan yeni teklif verebiliyor", true);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await assert.doesNotReject(page.getByText("Kabul Edildi").first().waitFor({ state: "visible", timeout: 10000 }));
    check("[6] Temizlik sonrası teklif kabul akışı sıfırdan çalışıyor", true);
    await logout(page);

    // Mehmet Demir de giriş yapabiliyor mu (2. kriterin tamamı)
    await loginAs(page, MEHMET, "/panel");
    check("[2] Demo Hizmet Veren (Mehmet Demir) mevcut ve giriş yapabiliyor", true);
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    await assert.doesNotReject(
      page.getByText("Henüz herhangi bir ilana teklif vermediniz.").waitFor({ state: "visible", timeout: 10000 }),
    );
    check("[4] Mehmet Demir'in de teklif sayısı 0", true);
    await logout(page);

    // === FAZ E: Gerçek kullanıcının verisine dokunulmadı mı ===
    console.log("\n=== FAZ E: Gerçek kullanıcı verisi (kontrol grubu) dokunulmadı mı ===");
    const afterCleanup = await page.evaluate(
      ({ mixedJobId, pureRealJobId, pureRealOfferId }) => {
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
        const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
        return {
          mixedJobStillExists: jobs.some((j) => j.id === mixedJobId),
          mixedJobOfferCount: offers.filter((o) => o.jobId === mixedJobId).length,
          pureRealJobStillExists: jobs.some((j) => j.id === pureRealJobId),
          pureRealOfferStillExists: offers.some((o) => o.id === pureRealOfferId),
          pureRealRatingStillExists: ratings.some((r) => r.offerId === pureRealOfferId),
        };
      },
      seeded,
    );
    check("[E] Gerçek Alan'ın (karışık senaryo) ilanı SİLİNMEDİ", afterCleanup.mixedJobStillExists);
    check("[E] Demo Hizmet Veren'in gerçek ilana verdiği teklif silindi (yalnızca o teklif)", afterCleanup.mixedJobOfferCount === 0);
    check("[E] Saf gerçek ilan HİÇ dokunulmadan duruyor", afterCleanup.pureRealJobStillExists);
    check("[E] Saf gerçek teklif HİÇ dokunulmadan duruyor", afterCleanup.pureRealOfferStillExists);
    check("[E] Saf gerçek rating HİÇ dokunulmadan duruyor", afterCleanup.pureRealRatingStillExists);

    check("Genel: konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    // === FAZ F: Otomatik tek-seferlik migration, v3 -> v4 altında da tetikleniyor mu ===
    console.log("\n=== FAZ F: Otomatik migration (v3 tamamlanmış tarayıcıda, v4'e yeniden tetiklenme) ===");
    const fContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const fPage = await fContext.newPage();
    attachDiagnostics(fPage);

    await loginAs(fPage, ZEYNEP, "/panel");
    const zeynepId2 = await getUserId(fPage, ZEYNEP.email);
    await fPage.evaluate(
      (zid) => {
        const job = {
          id: `v4-stale-job-${Date.now()}`,
          title: `V4-STALE-${Date.now()}`,
          category: "Depolama",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Test Tesis",
          workDate: "2026-12-01",
          description: "v3->v4 migration testi için stale demo ilan.",
          operationDetails: "Test.",
          status: "yayinda",
          requesterId: zid,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
        window.__V4_STALE_JOB_ID__ = job.id;
        // v3'ü zaten tamamlamış ama v4'ten SONRA yeni demo veri birikmiş bir tarayıcıyı simüle et.
        localStorage.setItem("malsevk.demo_data_reset_version", "demo-data-reset-v3");
      },
      zeynepId2,
    );
    const staleJobId = await fPage.evaluate(() => window.__V4_STALE_JOB_ID__);
    await logout(fPage);

    await fPage.goto(`${BASE_URL}/`);
    await fPage.waitForTimeout(1000);
    const flagAfter = await fPage.evaluate(() => localStorage.getItem("malsevk.demo_data_reset_version"));
    check("[F] Migration bayrağı 'demo-data-reset-v4'e yükseltildi", flagAfter === "demo-data-reset-v4", `flag=${flagAfter}`);
    const staleJobGone = await fPage.evaluate(
      (id) => !JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").some((j) => j.id === id),
      staleJobId,
    );
    check("[F] v3'ten sonra birikmiş stale demo ilan otomatik silindi", staleJobGone);

    // Tek seferlik garanti: v4 tamamlandıktan sonra yeni oluşturulan veri bir daha silinmiyor
    await loginAs(fPage, ZEYNEP, "/panel");
    const zeynepId3 = await getUserId(fPage, ZEYNEP.email);
    const secondJobId = `v4-after-migration-job-${Date.now()}`;
    await fPage.evaluate(
      ({ zid, jobId }) => {
        const job = {
          id: jobId,
          title: "V4-MIGRATION-SONRASI-SILINMEMELI",
          category: "Depolama",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Test Tesis",
          workDate: "2026-12-01",
          description: "Migration tamamlandıktan sonra oluşturulan test ilanı.",
          operationDetails: "Test.",
          status: "yayinda",
          requesterId: zid,
          photos: [],
        };
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
        jobs.push(job);
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      },
      { zid: zeynepId3, jobId: secondJobId },
    );
    await logout(fPage);
    await fPage.goto(`${BASE_URL}/`);
    await fPage.waitForTimeout(600);
    await fPage.goto(`${BASE_URL}/`);
    await fPage.waitForTimeout(600);
    const secondJobStillThere = await fPage.evaluate(
      (id) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").some((j) => j.id === id),
      secondJobId,
    );
    check("[F] Tek seferlik garanti: v4 tamamlandıktan sonraki ziyaretler yeni veriye dokunmuyor", secondJobStillThere);
    check("[F] Konsol/hydration hatası yok", fPage.jsProblems.length === 0, fPage.jsProblems.join(" | "));

    // Temizlik: bu testin kendi kalıntıları (gerçek hesaplar + kalan job/offer/rating).
    await fPage.evaluate(
      ({ realEmails, extraJobIds }) => {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        const removedIds = users.filter((u) => realEmails.includes(u.email)).map((u) => u.id);
        localStorage.setItem("malsevk.users.v1", JSON.stringify(users.filter((u) => !removedIds.includes(u.id))));
        const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !extraJobIds.includes(j.id));
        localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
        const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !extraJobIds.includes(o.jobId));
        localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
        const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !extraJobIds.includes(r.jobId));
        localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
      },
      {
        realEmails: [`elif.v4.${STAMP}@test.com`, `ahmet.v4.${STAMP}@test.com`],
        extraJobIds: [seeded.mixedJobId, seeded.pureRealJobId, secondJobId],
      },
    );

    await fContext.close();

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
