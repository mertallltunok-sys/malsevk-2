// Site-geneli 404/444 denetimi: her rol için tüm menü/panel/bildirim
// linklerini toplar, HER BİRİNİ gerçek tarayıcıda (page.goto) ziyaret edip
// gerçek HTTP status kodunu, konsol hatalarını ve URL içinde undefined/null
// olup olmadığını doğrular. Yalnızca navigasyon linklerine dokunur —
// sil/iptal/teklif kabul/işe başla/tamamla/anlaşma sağlanamadı gibi
// tehlikeli aksiyon butonlarına HİÇ tıklamaz.
// Ön koşul: `npm run dev` (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" };
const STAMP = Date.now();

let anyFail = false;
const results = [];
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  results.push({ label, passed, detail });
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

const NOT_FOUND_MARKERS = [
  "This page could not be found",
  "404",
  "sayfa bulunamadı",
  "Sayfa Bulunamadı",
];

/** Doğrudan URL yükler (page.goto) — gerçek sunucu status kodunu, konsol hatasını, undefined/null URL'yi ve header/footer varlığını doğrular. */
async function visitAndCheck(page, url, label) {
  page.jsProblems = [];
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  let response;
  try {
    response = await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (error) {
    check(`${label} (${url})`, false, `goto hata: ${error}`);
    return;
  }
  const status = response ? response.status() : null;
  const finalUrl = page.url();
  await page.waitForTimeout(150);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasHeader = await page.locator("header").first().isVisible().catch(() => false);
  const hasFooter = await page.locator("footer").first().isVisible().catch(() => false);
  const hasUndefinedInUrl = /\/(undefined|null)(\/|\?|$)/.test(finalUrl);
  const looksNotFound = NOT_FOUND_MARKERS.some((marker) => bodyText.includes(marker));

  // status===null: aynı sayfa içi hash navigasyonu (ör. zaten "/" üzerindeyken
  // "/#nasil-calisir"e geçmek) — tarayıcı gerçek bir HTTP isteği yapmaz, bu
  // normal ve beklenen davranıştır, hata sayılmaz.
  const ok =
    (status === null || status < 400) &&
    !hasUndefinedInUrl &&
    hasHeader &&
    hasFooter &&
    !looksNotFound &&
    page.jsProblems.length === 0;

  check(
    `${label} (${url})`,
    ok,
    `status=${status}, finalUrl=${finalUrl}, header=${hasHeader}, footer=${hasFooter}, notFoundText=${looksNotFound}, jsErrors=${page.jsProblems.join(" | ")}`,
  );
}

async function loginAs(page, account, redirect = "/panel") {
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

/** Bir sayfadaki tüm İÇ (site-relative, "/" ile başlayan) <a href> değerlerini toplar — dış linkler/mailto/tel hariç. */
async function collectInternalHrefs(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href"))
      .filter((href) => href && href.startsWith("/") && !href.startsWith("//"));
  });
}

async function seedComprehensiveScenario(page, { zeynepId, mertId, mehmetId }) {
  return page.evaluate(
    ({ zeynepId, mertId, mehmetId, stamp }) => {
      const now = new Date().toISOString();
      function job(idSuffix, title) {
        return {
          id: `audit-job-${idSuffix}-${stamp}`,
          title: `${title}-${stamp}`,
          category: "depo-personeli",
          province: "Kocaeli",
          district: "Gebze",
          workLocationType: "Depo Sahası",
          workDate: "2026-12-15",
          description: "Site geneli route denetimi için oluşturulan test ilanı.",
          operationDetails: "Test operasyon detayı.",
          status: "yayinda",
          requesterId: zeynepId,
          photos: [],
        };
      }
      function offer(idSuffix, jobId, providerId, status, extra = {}) {
        return {
          id: `audit-offer-${idSuffix}-${stamp}`,
          jobId,
          providerId,
          amount: 5000,
          currency: "TRY",
          description: "Route denetimi için oluşturulan test teklifi, yirmi karakterden uzun.",
          estimatedDuration: "3 gün",
          status,
          createdAt: now,
          updatedAt: now,
          ...extra,
        };
      }

      const jobPending = job("pending", "AUDIT-PENDING");
      const jobAccepted = job("accepted", "AUDIT-ACCEPTED");
      const jobInProgress = job("inprogress", "AUDIT-INPROGRESS");
      const jobCompletionRequested = job("completionreq", "AUDIT-COMPLETIONREQ");
      const jobCompletionDisputed = job("completiondisp", "AUDIT-COMPLETIONDISP");
      const jobCompleted = job("completed", "AUDIT-COMPLETED");
      const jobCancelled = job("cancelled", "AUDIT-CANCELLED");
      const jobAgreementFailed = job("agreementfailed", "AUDIT-AGREEMENTFAILED");
      const jobRejected = job("rejected", "AUDIT-REJECTED");
      const jobWithdrawn = job("withdrawn", "AUDIT-WITHDRAWN");
      const jobSibling = job("sibling", "AUDIT-SIBLING");

      const jobs = [
        jobPending,
        jobAccepted,
        jobInProgress,
        jobCompletionRequested,
        jobCompletionDisputed,
        jobCompleted,
        jobCancelled,
        jobAgreementFailed,
        jobRejected,
        jobWithdrawn,
        jobSibling,
      ];

      const offers = [
        offer("pending", jobPending.id, mertId, "pending"),
        offer("accepted", jobAccepted.id, mertId, "accepted"),
        offer("inprogress", jobInProgress.id, mertId, "in_progress"),
        offer("completionreq", jobCompletionRequested.id, mertId, "completion_requested", {
          completionRequestedByUserId: mertId,
          completionRequestedAt: now,
        }),
        offer("completiondisp", jobCompletionDisputed.id, mertId, "completion_disputed", {
          completionRequestedByUserId: mertId,
          completionRequestedAt: now,
          completionDisputeNote: "Test itiraz notu, on karakterden uzun.",
        }),
        offer("completed", jobCompleted.id, mertId, "completed", {
          completionRequestedByUserId: mertId,
          completionRequestedAt: now,
        }),
        offer("cancelled", jobCancelled.id, mertId, "cancelled", {
          completionRequestedByUserId: mertId,
          completionRequestedAt: now,
          completionDisputeNote: "Test itiraz notu, iptal ile sonuçlandı.",
        }),
        offer("agreementfailed", jobAgreementFailed.id, mertId, "agreement_failed", {
          disagreementReason: "fiyatta_anlasilamadi",
        }),
        offer("rejected", jobRejected.id, mertId, "rejected"),
        offer("withdrawn", jobWithdrawn.id, mertId, "withdrawn"),
        // Sibling senaryosu: Mert kabul edilip işe başlıyor, Mehmet hâlâ pending kardeş teklif.
        offer("sibling-settled", jobSibling.id, mertId, "in_progress"),
        offer("sibling-pending", jobSibling.id, mehmetId, "pending"),
      ];

      const existingJobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const existingOffers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existingJobs, ...jobs]));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existingOffers, ...offers]));

      return { jobIds: jobs.map((j) => j.id) };
    },
    { zeynepId, mertId, mehmetId, stamp: STAMP },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: kapsamlı senaryo (tüm teklif durumları) ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await clearSession(page);
    await loginAs(page, MEHMET, "/panel");
    const mehmetId = await getUserId(page, MEHMET.email);
    await seedComprehensiveScenario(page, { zeynepId, mertId, mehmetId });
    check("[kurulum] 11 ilan + 12 teklif (tüm durumlar) oluşturuldu", true);
    await clearSession(page);

    // ================= GUEST =================
    console.log("\n=== GUEST akışı ===");
    await visitAndCheck(page, "/", "Ana Sayfa");
    await visitAndCheck(page, "/hizmet-talebi-olustur", "Hizmet Talebi Oluştur (guest gate)");
    await visitAndCheck(page, "/ilanlar", "İş İlanlarını İncele (guest gate)");
    await visitAndCheck(page, "/giris-yap", "Giriş");
    await visitAndCheck(page, "/giris-yap?mode=kayit", "Kayıt");
    await visitAndCheck(page, "/ilanlar/ilan-001", "Sabit örnek ilan detayı");
    await visitAndCheck(page, "/#hizmetler", "Footer: Hizmetler (anchor)");
    await visitAndCheck(page, "/#nasil-calisir", "Footer: Nasıl Çalışır (anchor)");

    // ================= HİZMET ALAN =================
    console.log("\n=== HİZMET ALAN (Zeynep) akışı ===");
    await loginAs(page, ZEYNEP, "/panel");

    const hizmetAlanMenuHrefs = [
      "/panel/profil",
      "/panel",
      "/panel/hizmet-taleplerim",
      "/panel/gelen-teklifler",
      "/panel/hizmet-taleplerim?durum=devam-eden",
      "/panel/hizmet-taleplerim?durum=tamamlandi",
      "/panel/bildirimler",
      "/panel/hesap-ayarlari",
    ];
    for (const href of hizmetAlanMenuHrefs) {
      await visitAndCheck(page, href, "Hizmet Alan profil menüsü");
    }

    await visitAndCheck(page, "/panel", "Panel Özeti");
    let panelHrefs = await collectInternalHrefs(page);
    for (const href of [...new Set(panelHrefs)]) {
      await visitAndCheck(page, href, "Hizmet Alan panel özeti kartı/linki");
    }

    console.log("\n=== Hizmet Taleplerim sekmeleri + kart linkleri ===");
    await visitAndCheck(page, "/panel/hizmet-taleplerim", "Hizmet Taleplerim (Aktif)");
    let jobRequestHrefs = await collectInternalHrefs(page);
    for (const href of [...new Set(jobRequestHrefs)].filter((h) => h.startsWith("/ilanlar/") || h.includes("/duzenle"))) {
      await visitAndCheck(page, href, "Hizmet Taleplerim (Aktif) kart linki");
    }
    await visitAndCheck(page, "/panel/hizmet-taleplerim?durum=devam-eden", "Hizmet Taleplerim (Devam Eden)");
    await visitAndCheck(page, "/panel/hizmet-taleplerim?durum=tamamlandi", "Hizmet Taleplerim (Tamamlanan)");

    console.log("\n=== Gelen Teklifler kart linkleri ===");
    await visitAndCheck(page, "/panel/gelen-teklifler", "Gelen Teklifler");
    let incomingHrefs = await collectInternalHrefs(page);
    for (const href of [...new Set(incomingHrefs)].filter((h) => h.startsWith("/ilanlar/"))) {
      await visitAndCheck(page, href, "Gelen Teklifler kart linki");
    }

    console.log("\n=== Hizmet Alan bildirimleri ===");
    await visitAndCheck(page, "/panel/bildirimler", "Bildirimler (Hizmet Alan)");
    let notifHrefsAlan = await collectInternalHrefs(page);
    const notifHrefsAlanUnique = [...new Set(notifHrefsAlan)].filter(
      (h) => h.startsWith("/panel/") || h.startsWith("/ilanlar/"),
    );
    check(
      "[bildirim] Hizmet Alan için en az 1 bildirim linki bulundu",
      notifHrefsAlanUnique.length > 0,
      `${notifHrefsAlanUnique.length} link`,
    );
    for (const href of notifHrefsAlanUnique) {
      await visitAndCheck(page, href, "Hizmet Alan bildirim linki");
    }

    await clearSession(page);

    // ================= HİZMET VEREN =================
    console.log("\n=== HİZMET VEREN (Mert) akışı ===");
    await loginAs(page, MERT, "/panel");

    const hizmetVerenMenuHrefs = [
      "/panel/profil",
      "/panel",
      "/ilanlar",
      "/panel/tekliflerim",
      "/panel/tekliflerim?durum=kabul-edildi",
      "/panel/tekliflerim?durum=devam-eden",
      "/panel/tekliflerim?durum=tamamlandi",
      "/panel/bildirimler",
      "/panel/hesap-ayarlari",
    ];
    for (const href of hizmetVerenMenuHrefs) {
      await visitAndCheck(page, href, "Hizmet Veren profil menüsü");
    }

    // "Kabul Edilen Teklifler" (durum=kabul-edildi) içerik doğrulaması —
    // sadece HTTP status yeterli değil: yanlış sekme sessizce aktif olabilir.
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=kabul-edildi`);
    const activeTabText = await page.getByRole("tab", { selected: true }).innerText().catch(() => "<bulunamadı>");
    check(
      "[içerik] '?durum=kabul-edildi' gerçekten 'Aktif' sekmesine mi düşüyor (beklenen: evet, tab yok)",
      activeTabText.trim() === "Aktif",
      `aktif sekme metni: "${activeTabText}"`,
    );

    await visitAndCheck(page, "/panel", "Panel Özeti (Hizmet Veren)");
    panelHrefs = await collectInternalHrefs(page);
    for (const href of [...new Set(panelHrefs)]) {
      await visitAndCheck(page, href, "Hizmet Veren panel özeti kartı/linki");
    }

    console.log("\n=== Aktif İlanlar ekranı: arama/filtre/detay ===");
    await visitAndCheck(page, "/ilanlar", "Aktif İlanlar");
    await page.getByLabel("İlanlarda ara").fill("audit");
    await page.waitForTimeout(300);
    let listingHrefs = await collectInternalHrefs(page);
    const jobDetailHrefs = [...new Set(listingHrefs)].filter((h) => h.startsWith("/ilanlar/") && h !== "/ilanlar/");
    check("[Aktif İlanlar] arama sonrası en az 1 ilan detay linki bulundu", jobDetailHrefs.length > 0, `${jobDetailHrefs.length} link`);
    for (const href of jobDetailHrefs) {
      await visitAndCheck(page, href, "Aktif İlanlar arama sonucu detay linki");
    }

    console.log("\n=== Tekliflerim sekmeleri + kart linkleri ===");
    for (const tab of ["", "?durum=devam-eden", "?durum=tamamlandi", "?durum=kapanan-teklifler"]) {
      await visitAndCheck(page, `/panel/tekliflerim${tab}`, `Tekliflerim ${tab || "(Aktif)"}`);
      const hrefs = await collectInternalHrefs(page);
      for (const href of [...new Set(hrefs)].filter((h) => h.startsWith("/ilanlar/"))) {
        await visitAndCheck(page, href, `Tekliflerim ${tab || "(Aktif)"} kart linki`);
      }
    }

    console.log("\n=== Hizmet Veren bildirimleri ===");
    await visitAndCheck(page, "/panel/bildirimler", "Bildirimler (Hizmet Veren)");
    let notifHrefsVeren = await collectInternalHrefs(page);
    const notifHrefsVerenUnique = [...new Set(notifHrefsVeren)].filter(
      (h) => h.startsWith("/panel/") || h.startsWith("/ilanlar/"),
    );
    check(
      "[bildirim] Hizmet Veren için en az 1 bildirim linki bulundu",
      notifHrefsVerenUnique.length > 0,
      `${notifHrefsVerenUnique.length} link`,
    );
    for (const href of notifHrefsVerenUnique) {
      await visitAndCheck(page, href, "Hizmet Veren bildirim linki");
    }
    await clearSession(page);

    // ================= HİZMET VEREN (Mehmet — "başka Hizmet Verenle anlaşıldı") =================
    console.log("\n=== HİZMET VEREN (Mehmet) — kardeş teklif kapanma bildirimi ===");
    await loginAs(page, MEHMET, "/panel/bildirimler");
    let notifHrefsMehmet = await collectInternalHrefs(page);
    const notifHrefsMehmetUnique = [...new Set(notifHrefsMehmet)].filter(
      (h) => h.startsWith("/panel/") || h.startsWith("/ilanlar/"),
    );
    check(
      "[bildirim] Mehmet için 'başka Hizmet Verenle anlaşıldı' bildirimi üretildi",
      notifHrefsMehmetUnique.length > 0,
      `${notifHrefsMehmetUnique.length} link`,
    );
    for (const href of notifHrefsMehmetUnique) {
      await visitAndCheck(page, href, "Mehmet bildirim linki (sibling-closed)");
    }
    await visitAndCheck(page, "/panel/tekliflerim?durum=kapanan-teklifler", "Mehmet: Tekliflerim (Kapanan Teklifler)");

    check("Genel: konsol hatası birikmedi (son sayfa)", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    const failCount = results.filter((r) => !r.passed).length;
    console.log(`\nToplam kontrol: ${results.length}, başarısız: ${failCount}`);
    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[audit] GENEL HATA:", error);
  process.exitCode = 1;
});
