// node scripts/tmp-operation-status-global-badge-fix-test.mjs
//
// SÜPERSEDE EDİLDİ — bkz. scripts/tmp-operation-status-single-card-merge-test.mjs.
// "Operasyon içindeki hizmet kartlarının sadeleştirilmesi" görevi bu
// script'in ("ANA rozet HER ZAMAN global, kişisel bilgi AYRI bir ikincil not"
// modeli) temel varsayımını kasıtlı olarak değiştirdi: artık her satırın sağ
// tarafında TEK bir durum/aksiyon alanı var (bkz. offers.ts#
// getOperationServiceCardStatus) — izleyicinin KENDİ teklifine dair daha
// spesifik bir durumu varsa (ör. "Teklif Bekliyor"/"Başka Hizmet Verenle
// Anlaşıldı") bu, global bucket etiketinin YERİNE geçer; ayrı bir "ikincil
// not" elemanı artık render edilmez. Bu yüzden aşağıdaki `assertMainBadgeAndNote`
// beklentileri (özellikle TEST 1-4'ün ikincil not/ana rozet birlikteliği)
// KASITLI OLARAK artık geçmeyecektir — canlı regresyon kapısı olarak
// tmp-operation-status-single-card-merge-test.mjs kullanılmalıdır.
// Bu script BİLEREK değiştirilmedi (bkz. CLAUDE.md "tmp-*.mjs" script
// konvansiyonu) — Aşama 5.2'nin o anki davranışının tarihsel kaydı olarak
// kalır. TEST 6 (aggregate özet kutucukları) hâlâ GEÇERLİDİR ve GEÇER — bu
// görev `getPublicOperationStatusSummary`/`OperationStatusCard`'ın özet
// ızgarasını DEĞİŞTİRMEDİ, yalnızca hizmet listesindeki satır durumlarını.
//
// --- Aşağıdaki orijinal açıklama (satır rozetleri için artık kısmen geçersiz) ---
// Aşama 5.2 — Operasyon Hizmet Durumlarının Tutarlılık Denetimi.
//
// KÖK NEDEN (doğrulandı, bkz. offers.ts#getViewerOfferStatusNote dokümantasyonu):
// önceki "kullanıcı izolasyonu düzeltmesi" (getViewerScopedJobStatus), GLOBAL
// iş durumunu (herkes için aynı olması gereken) ve İZLEYENE ÖZEL kişisel
// teklif durumunu TEK bir değere ({bucket,label,tone}) sıkıştırıp bunu ANA
// rozet olarak render ediyordu — bu yüzden aynı ilan, kendi teklifi olmayan
// bir Hizmet Veren'e nötr "Aktif" gösterirken, gerçekte "Devam Ediyor"
// aşamasındaydı. Bu script, düzeltmenin bunu çözdüğünü doğrular: ANA rozet
// artık HER ZAMAN global (herkeste aynı), kişisel bilgi yalnızca küçük bir
// İKİNCİL not olarak görünür.
//
// GÜNCELLEME (bkz. tmp-offer-accept-workstart-lock-fix-test.mjs — "Teklif
// Kabulü ve İşe Başlama Kilit Kuralı" düzeltmesi): senaryo burada bilerek
// "accepted" DEĞİL, doğrudan "in_progress" ile kuruluyor — "accepted" (işe
// henüz başlanmamış, ön anlaşma aşaması) artık ANA rozette "Hizmet Veren
// Seçildi" ÜRETMEZ (o bucket "aktif"e/"Teklife Açık"a katlanır, bkz.
// job-requests.ts#getPublicOperationStatusBucket) — ilan yalnızca iş fiilen
// BAŞLADIĞINDA (in_progress) global olarak kapanır/"Devam Ediyor" gösterir.
// "accepted" aşamasının (ilan hâlâ açık kalmalı) kapsamlı doğrulaması
// tmp-offer-accept-workstart-lock-fix-test.mjs'tedir.
//
// Bu, aynı paylaşılan tarayıcı BAĞLAMI (localStorage) içinde farklı
// hesaplarla giriş yapılarak test edilir — gerçek farklı tarayıcı
// profilleri/cihazlar arasında localStorage'ın SENKRON OLMADIĞI (bu proje
// Supabase değil, saf client-side localStorage kullanıyor, bkz. CLAUDE.md
// "No real backend") ayrı, kod-dışı bir mimari sınırdır; bu script o
// senaryoyu simüle ETMEZ (edemez) — yalnızca AYNI veri kümesi üzerinde
// rozet hesaplamasının doğru olduğunu doğrular.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

// Bu proje gerçek bir sunucu/session doğrulaması yapmaz (bkz. CLAUDE.md "No
// real backend" — session.ts yalnızca {id,name,role} şeklini doğrular,
// users.ts tablosuna karşı çapraz kontrol YOKTUR). Üçüncü bir gerçek dev
// hesabı olmadığı için "hiç teklif vermemiş Hizmet Veren" senaryosunu,
// gerçek bir kayıt akışı yerine doğrudan session kaydı enjekte ederek test
// ediyoruz — mevcut testlerin job/offer enjeksiyonuyla AYNI teknik.
async function loginAsSyntheticProvider(page, { id, name }) {
  await page.evaluate(
    ({ id, name }) => {
      localStorage.setItem("malsevk.session.v1", JSON.stringify({ id, name, role: "hizmet-veren" }));
    },
    { id, name },
  );
}

async function getStoredUsers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
}

async function injectJob(page, { id, title, category = "lashing", workDate = "2026-09-01", requesterId, operationId }) {
  await page.evaluate(
    ({ id, title, category, workDate, requesterId, operationId }) => {
      const KEY = "malsevk.jobs.v1";
      const jobs = JSON.parse(localStorage.getItem(KEY) || "[]");
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Dilovası",
        workLocationType: "Ana Rozet Testi Tesisi",
        workDate,
        description: "Ana rozet/ikincil not testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Ana rozet testi operasyon detayı, en az on karakter.",
        status: "yayinda",
        requesterId,
        operationId,
        photos: [],
      });
      localStorage.setItem(KEY, JSON.stringify(jobs));
    },
    { id, title, category, workDate, requesterId, operationId },
  );
}

async function injectOffer(page, { jobId, providerId, status }) {
  await page.evaluate(
    ({ jobId, providerId, status }) => {
      const KEY = "malsevk.offers.v1";
      const offers = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = new Date().toISOString();
      offers.push({
        id: crypto.randomUUID(),
        jobId,
        providerId,
        amount: 1000,
        currency: "TRY",
        description: "Ana rozet testi teklifi",
        estimatedDuration: "1 gün",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem(KEY, JSON.stringify(offers));
    },
    { jobId, providerId, status },
  );
}

function siblingCard(page) {
  return page.getByRole("heading", { name: "Bu Operasyondaki Diğer Hizmetler" }).locator("xpath=..");
}
function statusCard(page) {
  return page.getByRole("heading", { name: "Operasyon Durumu" }).locator("xpath=..");
}
function offersCard(page) {
  return page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
}

function rowByTitle(card, page, title) {
  return card.locator("li", { has: page.getByText(title, { exact: true }) });
}
function rowByCategory(card, page, categoryLabel) {
  return card.locator("li", { has: page.getByText(categoryLabel, { exact: true }) });
}

const MAIN_BADGE_TEXT = "Devam Ediyor";

async function assertMainBadgeAndNote(page, { viewerLabel, expectedNote }) {
  // 1) "Bu Operasyondaki Diğer Hizmetler"
  await assert.doesNotReject(
    rowByTitle(siblingCard(page), page, "Rozet Testi Hedef Servis")
      .getByText(MAIN_BADGE_TEXT, { exact: true })
      .waitFor({ state: "visible", timeout: 5000 }),
    `${viewerLabel}: sibling kartında ana rozet '${MAIN_BADGE_TEXT}' görünmeli`,
  );
  // 2) "Operasyon Durumu" (kategori "Lashing" ile bulunuyor — bu karttaki
  // satırlar başlık değil kategori adı gösterir)
  await assert.doesNotReject(
    rowByCategory(statusCard(page), page, "Lashing")
      .getByText(MAIN_BADGE_TEXT, { exact: true })
      .waitFor({ state: "visible", timeout: 5000 }),
    `${viewerLabel}: Operasyon Durumu satırında ana rozet '${MAIN_BADGE_TEXT}' görünmeli`,
  );
  // 3) "Operasyondaki Hizmetler"
  await assert.doesNotReject(
    rowByTitle(offersCard(page), page, "Rozet Testi Hedef Servis")
      .getByText(MAIN_BADGE_TEXT, { exact: true })
      .waitFor({ state: "visible", timeout: 5000 }),
    `${viewerLabel}: Operasyondaki Hizmetler satırında ana rozet '${MAIN_BADGE_TEXT}' görünmeli`,
  );

  if (expectedNote) {
    await assert.doesNotReject(
      rowByTitle(siblingCard(page), page, "Rozet Testi Hedef Servis")
        .getByText(expectedNote, { exact: true })
        .waitFor({ state: "visible", timeout: 5000 }),
      `${viewerLabel}: sibling kartında ikincil not '${expectedNote}' görünmeli`,
    );
  } else {
    await assert.equal(
      await rowByTitle(siblingCard(page), page, "Rozet Testi Hedef Servis").getByText("Teklifiniz", { exact: false }).count(),
      0,
      `${viewerLabel}: kişisel 'Teklifiniz...' metni görmemeli`,
    );
  }

  ok(`${viewerLabel}: ana rozet HER ÜÇ kartta da '${MAIN_BADGE_TEXT}' (global, tutarlı)${expectedNote ? `, ikincil not '${expectedNote}'` : " (ikincil not yok)"}`);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

  let zeynepId, mertId, mehmetId;
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    let users = await getStoredUsers(page);
    zeynepId = users.find((u) => u.email === "zeynep@test.com").id;
    await loginAs(page, "mert@test.com", "Mert123!");
    users = await getStoredUsers(page);
    mertId = users.find((u) => u.email === "mert@test.com").id;
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!");
    users = await getStoredUsers(page);
    mehmetId = users.find((u) => u.email === "mehmet.demir.demo@malsevk.com").id;
    await page.close();
  }

  const operationId = "global-badge-test-" + crypto.randomUUID();
  const jobMain = { id: crypto.randomUUID(), title: "Rozet Testi Ana Sayfa" };
  const jobTarget = { id: crypto.randomUUID(), title: "Rozet Testi Hedef Servis" };
  const neverOfferedProviderId = "no-offer-provider-" + crypto.randomUUID();

  // =====================================================================
  // KURULUM — bir operasyon, iki servis: jobMain (sayfayı ziyaret etmek
  // için, tekliflerle ilgisiz) + jobTarget (test edilen: mert'in teklifi
  // FİİLEN İŞE BAŞLADI (in_progress), mehmet'in teklifi hâlâ beklemede ama
  // artık kardeş teklifin ilerlemesiyle kapanmış durumda).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await injectJob(page, { id: jobMain.id, title: jobMain.title, category: "forklift", requesterId: zeynepId, operationId });
    await injectJob(page, { id: jobTarget.id, title: jobTarget.title, category: "lashing", requesterId: zeynepId, operationId });
    await injectOffer(page, { jobId: jobTarget.id, providerId: mertId, status: "in_progress" });
    await injectOffer(page, { jobId: jobTarget.id, providerId: mehmetId, status: "pending" });
    ok("Kurulum: 2 servisli operasyon oluşturuldu — jobTarget'ta mert=in_progress, mehmet=pending (artık kardeşin ilerlemesiyle kapanmış)");
    await page.close();
  }

  // =====================================================================
  // TEST 1 — Hizmet Alan (zeynep, ilan sahibi): ana rozet global, ikincil
  // not ilan-sahibine uygun ("İş devam ediyor"), ASLA "Teklifiniz..." değil.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertMainBadgeAndNote(page, { viewerLabel: "Hizmet Alan (zeynep)", expectedNote: "İş devam ediyor" });
    await page.close();
  }

  // =====================================================================
  // TEST 2 — İşe başlanan teklifin sahibi Hizmet Veren (mert).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertMainBadgeAndNote(page, { viewerLabel: "İşe başlanan teklifin sahibi Hizmet Veren (mert)", expectedNote: "Teklifiniz: İşe Başlandı" });
    await page.close();
  }

  // =====================================================================
  // TEST 3 — Artık kardeşin ilerlemesiyle kapanmış bekleyen teklif sahibi
  // Hizmet Veren (mehmet).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertMainBadgeAndNote(page, { viewerLabel: "Kardeşin ilerlemesiyle kapanmış bekleyen teklif sahibi Hizmet Veren (mehmet)", expectedNote: "Başka hizmet verenle anlaşıldı" });
    await page.close();
  }

  // =====================================================================
  // TEST 4 — Teklif vermemiş Hizmet Veren (3. gerçek dev hesabı yok —
  // doğrudan session enjeksiyonuyla simüle edilir, bkz. yukarıdaki not).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.goto(`${BASE_URL}/ilanlar`);
    await loginAsSyntheticProvider(page, { id: neverOfferedProviderId, name: "Test Sağlayıcı" });
    await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertMainBadgeAndNote(page, { viewerLabel: "Teklif vermemiş Hizmet Veren (sentetik)", expectedNote: "Başka hizmet verenle anlaşıldı" });
    await page.close();
  }

  // =====================================================================
  // TEST 5 — Misafir: ana rozet yine global/aynı, hiçbir kişisel not yok.
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assertMainBadgeAndNote(page, { viewerLabel: "Misafir (oturumsuz)", expectedNote: null });
    await page.close();
  }

  // =====================================================================
  // TEST 6 — "Operasyon Durumu" özet kutucukları da GLOBAL sayılır: 3
  // viewer'ın hepsinde "Devam Ediyor: 1" / "Teklife Açık: 1" (jobMain hiç
  // teklifsiz) aynı olmalı — viewer-scoped sayım artık YOK. Ayrıca "Hizmet
  // Veren Seçildi" adında bir kutucuk ARTIK HİÇ YOK (bkz.
  // PUBLIC_OPERATION_STATUS_BUCKET_ORDER — yalnızca 4 değer).
  // =====================================================================
  {
    const page = await sharedContext.newPage();
    for (const [label, login] of [
      ["Hizmet Alan (zeynep)", () => loginAs(page, "zeynep@test.com", "Zeynep1!")],
      ["mert", () => loginAs(page, "mert@test.com", "Mert123!", "/ilanlar")],
      ["mehmet", () => loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar")],
    ]) {
      await login();
      await page.goto(`${BASE_URL}/ilanlar/${jobMain.id}`);
      const summaryDl = statusCard(page).locator("dl");
      await summaryDl.waitFor({ state: "visible", timeout: 10000 });
      const summaryText = await summaryDl.innerText();
      assert.ok(/Devam Ediyor[\s\S]*1/.test(summaryText), `${label}: özet kutucuğunda 'Devam Ediyor: 1' olmalı`);
      assert.ok(/Teklife Açık[\s\S]*1/.test(summaryText), `${label}: özet kutucuğunda 'Teklife Açık: 1' olmalı (jobMain'in kendisi)`);
      assert.equal(summaryText.includes("Hizmet Veren Seçildi"), false, `${label}: 'Hizmet Veren Seçildi' adında bir kutucuk artık hiç olmamalı`);
    }
    ok("TEST 6: 'Operasyon Durumu' özet kutucukları (Devam Ediyor: 1, Teklife Açık: 1, 'Hizmet Veren Seçildi' kutucuğu YOK) 3 farklı hesapta da BİREBİR aynı — global sayım");
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-operation-status-global-badge-fix-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
