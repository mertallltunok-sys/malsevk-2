// K2 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden (düzeltme öncesi): offers.ts#deleteJobWithOffers, bir ilanın
// silinip silinemeyeceğini job-requests.ts#jobHasAcceptedOffer ile kontrol
// ediyordu; bu fonksiyon ENGAGED_OFFER_STATUSES kullanır ve bu küme kendi
// tanımı gereği "completed"i BİLEREK dışarıda bırakır (job-requests.ts:21-22).
// Sonuç: tamamlanmış (ve puanlanmış) bir işin ilanı, "aktif VEYA tamamlanmış
// bir iş bulunduğu için silinemez" hata mesajının vaat ettiğinin aksine,
// hiçbir engelle karşılaşmadan silinebiliyordu.
//
// Düzeltme: deleteJobWithOffers artık getSettledOfferForJob'ı (ENGAGED ∪
// COMPLETED) kullanıyor — offers.ts:1020, job-requests.ts:410-412.
//
// BU TESTİN KAPSAMI VE BİLİNÇLİ SINIRI: uygulamanın GERÇEK arayüzünde
// "İlanı Sil" butonu yalnızca `filter === "aktif"` olan kartlarda render
// edilir (job-requests-panel.tsx#JobRequestCard, satır ~446) — accepted/
// in_progress/completion_requested/completion_disputed/completed durumundaki
// bir teklifi olan ilanlar için bu buton HİÇBİR sekmede hiç var olmaz (aynı
// şekilde "Süresi Dolan İlanlar" sekmesi de bu ilanlar için hiç görünmez,
// çünkü job-publish-window.ts#isJobListingExpired de getSettledOfferForJob
// === null şartını arar). Yani gerçek bir kullanıcı hiçbir zaman tıklayarak
// bu korumayı deneyemez — asıl K2 hatası yalnızca deleteJobWithOffers'ın
// DOĞRUDAN çağrılmasıyla (sahte/gelecekteki bir çağıran, devtools, vb.)
// ortaya çıkardı. Bu proje bir gerçek backend'e sahip olmadığından ve
// job-requests.ts gibi iç modüller (extensionless yerel import zinciri
// yüzünden, bkz. scripts/test-photo-feature.mjs'in kendi yorum notu)
// bugünkü araç setiyle ne düz Node'da ne de tarayıcıda test amacıyla
// dışarıdan çağrılabilir durumda değil — yeni bir test-only global hook
// eklemek (window.__test__ vb.) görev tanımındaki "tasarımı değiştirme"
// kuralını ihlal eder. Bu yüzden bu script iki şeyi ayrı ayrı doğrular:
//   (A) Silinebilir GERÇEK senaryoları uçtan uca, gerçek arayüzden tıklayarak
//       (teklifsiz / yalnız rejected+withdrawn / cancelled tek başına).
//   (B) Silinemez GERÇEK senaryolarda (accepted / in_progress / completed +
//       puanlanmış) "İlanı Sil" butonunun HİÇBİR sekmede var olmadığını —
//       yani normal bir kullanıcının bu ilanı ASLA silemeyeceğini.
// deleteJobWithOffers'ın kendisinin artık "completed" durumunu da doğru
// engellediği, doğrudan kaynak koddan (yukarıdaki satır referanslarıyla)
// ayrıca doğrulanmıştır — bu script o iç mantığı bire bir tekrar test etmez,
// dış davranışın (kullanıcının gerçekten yapabildiklerinin) bozulmadığını
// doğrular.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function seedJob(page, { id, title, requesterId }) {
  await page.evaluate(
    ({ id, title, requesterId }) => {
      const job = {
        id,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "K2 silme koruması regresyon testi için oluşturulan ilan.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId,
        photos: [],
      };
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, requesterId },
  );
}

async function seedOffers(page, jobId, statuses, providerId) {
  await page.evaluate(
    ({ jobId, statuses, providerId }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      statuses.forEach((status, i) => {
        offers.push({
          id: `${jobId}-offer-${i}`,
          jobId,
          providerId,
          amount: 1000,
          currency: "TRY",
          description: "Test teklifi",
          estimatedDuration: 3,
          status,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      });
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { jobId, statuses, providerId },
  );
}

async function seedRating(page, { jobId, offerId, providerId, raterId }) {
  await page.evaluate(
    ({ jobId, offerId, providerId, raterId }) => {
      const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
      ratings.push({
        id: `${jobId}-rating`,
        offerId,
        jobId,
        providerId,
        raterId,
        stars: 5,
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
    },
    { jobId, offerId, providerId, raterId },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const jsProblems = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsProblems.push(`[console:error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => jsProblems.push(`[pageerror] ${String(err)}`));

    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    const providerId = "provider-k2-test";

    // === SİLİNEBİLİR SENARYOLAR (A) — Aktif sekmesinden gerçek tıklamayla ===
    console.log("\n=== (A) Silinebilir senaryolar — gerçek arayüzden ===");

    const noOfferJobId = `k2-no-offer-${STAMP}`;
    const noOfferTitle = `K2-NOOFFER-${STAMP}`;
    await seedJob(page, { id: noOfferJobId, title: noOfferTitle, requesterId: zeynepId });

    const rejectedJobId = `k2-rejected-${STAMP}`;
    const rejectedTitle = `K2-REJECTED-${STAMP}`;
    await seedJob(page, { id: rejectedJobId, title: rejectedTitle, requesterId: zeynepId });
    await seedOffers(page, rejectedJobId, ["rejected", "withdrawn"], providerId);

    const cancelledJobId = `k2-cancelled-${STAMP}`;
    const cancelledTitle = `K2-CANCELLED-${STAMP}`;
    await seedJob(page, { id: cancelledJobId, title: cancelledTitle, requesterId: zeynepId });
    await seedOffers(page, cancelledJobId, ["cancelled"], providerId);

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });

    for (const [label, title] of [
      ["Senaryo 1: Teklifsiz ilan", noOfferTitle],
      ["Senaryo 2: Yalnız reddedilmiş/geri çekilmiş teklifleri olan ilan", rejectedTitle],
      ["Senaryo 6: İptal edilmiş (cancelled), başka aktif bağı olmayan ilan", cancelledTitle],
    ]) {
      const card = page.locator("li", { hasText: title });
      await assert.doesNotReject(card.waitFor({ state: "visible", timeout: 10000 }), `${label}: Aktif sekmesinde görünmüyor`);
      const deleteButton = card.getByRole("button", { name: "İlanı Sil" });
      await assert.doesNotReject(deleteButton.waitFor({ state: "visible", timeout: 5000 }), `${label}: 'İlanı Sil' butonu yok`);
      await deleteButton.click();
      await page.getByRole("button", { name: "Evet, İlanı Sil" }).click();
      await assert.doesNotReject(
        page.locator("li", { hasText: title }).waitFor({ state: "detached", timeout: 10000 }),
        `${label}: silme sonrası ilan hâlâ listede`,
      );
      // "İlan başarıyla silindi." banner'ının kendisi de erişilebilirlik için
      // role="alert" taşıyor (bkz. use-auto-dismiss-banner.ts) — bu yüzden
      // "herhangi bir alert yok" değil, DeleteJobDialog'un hata metninin
      // ("...silinemez.") sayfada hiç görünmediğini kontrol ediyoruz.
      const blockedErrorCount = await page.getByText("silinemez").count();
      check(`${label} -> gerçekten silinebildi, 'silinemez' hata metni gösterilmedi`, blockedErrorCount === 0, `adet=${blockedErrorCount}`);
    }

    // === SİLİNEMEZ SENARYOLAR (B) — "İlanı Sil" hiçbir sekmede yok ===
    console.log("\n=== (B) Silinemez senaryolar — 'İlanı Sil' hiçbir sekmede görünmüyor ===");

    const acceptedJobId = `k2-accepted-${STAMP}`;
    const acceptedTitle = `K2-ACCEPTED-${STAMP}`;
    await seedJob(page, { id: acceptedJobId, title: acceptedTitle, requesterId: zeynepId });
    await seedOffers(page, acceptedJobId, ["accepted"], providerId);

    const inProgressJobId = `k2-inprogress-${STAMP}`;
    const inProgressTitle = `K2-INPROGRESS-${STAMP}`;
    await seedJob(page, { id: inProgressJobId, title: inProgressTitle, requesterId: zeynepId });
    await seedOffers(page, inProgressJobId, ["in_progress"], providerId);

    const completedJobId = `k2-completed-${STAMP}`;
    const completedTitle = `K2-COMPLETED-${STAMP}`;
    await seedJob(page, { id: completedJobId, title: completedTitle, requesterId: zeynepId });
    await seedOffers(page, completedJobId, ["completed"], providerId);
    await seedRating(page, {
      jobId: completedJobId,
      offerId: `${completedJobId}-offer-0`,
      providerId,
      raterId: zeynepId,
    });

    const scenarios = [
      { label: "Senaryo 3: Kabul edilmiş (accepted) teklifli ilan", title: acceptedTitle, tab: "devam-eden" },
      { label: "Senaryo 4: Devam eden (in_progress) iş", title: inProgressTitle, tab: "devam-eden" },
      { label: "Senaryo 5 (K2): Tamamlanmış ve puanlanmış iş", title: completedTitle, tab: "tamamlandi" },
    ];

    for (const { label, title, tab } of scenarios) {
      const tabUrl = `${BASE_URL}/panel/hizmet-taleplerim?durum=${tab}`;
      await page.goto(tabUrl);
      await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
      const card = page.locator("li", { hasText: title });
      await assert.doesNotReject(
        card.waitFor({ state: "visible", timeout: 10000 }),
        `${label}: beklenen '${tab}' sekmesinde görünmüyor`,
      );
      const deleteButtonCount = await card.getByRole("button", { name: "İlanı Sil" }).count();
      check(`${label} -> '${tab}' sekmesinde ve 'İlanı Sil' butonu YOK (silinemez)`, deleteButtonCount === 0, `buton sayısı=${deleteButtonCount}`);
    }

    // Ekstra doğrulama: bu üç ilan "Aktif" sekmesinde de görünmemeli (silinebilir gibi görünmesin diye).
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    for (const { label, title } of scenarios) {
      const countInAktif = await page.locator("li", { hasText: title }).count();
      check(`${label} -> 'Aktif' sekmesinde YOK`, countInAktif === 0, `adet=${countInAktif}`);
    }

    check("Konsolda hiç JS hatası yakalanmadı", jsProblems.length === 0, jsProblems.join(" | "));

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[delete-job-with-offers-guard-test] GENEL HATA:", error);
  process.exitCode = 1;
});
