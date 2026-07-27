// node scripts/tmp-offer-accept-workstart-lock-fix-test.mjs
//
// KISMEN SÜPERSEDE EDİLDİ — bkz. scripts/tmp-operation-status-single-card-merge-test.mjs.
// "Operasyon içindeki hizmet kartlarının sadeleştirilmesi" görevi, bu
// script'teki `assertGlobalBadge` yardımcısının temel varsayımını ("ana
// rozet HER ZAMAN, tüm izleyicilerde birebir aynı global metni gösterir")
// kasıtlı olarak değiştirdi: artık her satırda TEK bir durum alanı var (bkz.
// offers.ts#getOperationServiceCardStatus) ve izleyicinin KENDİ (ya da ilan
// sahibiyse kendi sahiplik) durumu daha spesifikse bu, eski "güvenli/genel"
// global etiketin YERİNE geçer — ör. kabul edilmiş ama başlanmamış bir işte
// artık HERKES "Teklife Açık" değil, ilan sahibi/teklif sahibi "Teklif Kabul
// Edildi", rakip bekleyen teklif sahibi "Teklif Bekliyor" görür; işe
// başlandıktan sonra kendi (artık anlamsız) bekleyen teklifi olan ya da hiç
// teklifi olmayan bir Hizmet Veren "Devam Ediyor" değil "Başka Hizmet
// Verenle Anlaşıldı" görür (bu switch İKİ DURUMDA DA — az önce "aktif"
// bucket'ta pending teklifi olan ilan sahibi artık "Teklife Açık" değil
// "İşe Başlama Onayı Bekleniyor" görür). BU YÜZDEN aşağıdaki
// `assertGlobalBadge` çağrılarının çoğu ve "Teklifiniz kabul edildi"/"Başka
// hizmet verenle anlaşıldı" (küçük harfle, eski ikincil not metni) tam eşleşme
// bekleyen satırlar artık KASITLI OLARAK geçmeyecektir.
//
// BU SCRIPT'İN ASIL KORUDUĞU KRİTİK İŞ KURALI HÂLÂ TAM OLARAK GEÇERLİDİR ve
// bu dosyadaki `trySubmitRealOffer` tabanlı bloklar (D/F gerçekten teklif
// verebiliyor, E işe başlandıktan sonra veremiyor) METİNDEN bağımsız
// oldukları için DEĞİŞMEDEN GEÇER — canProviderSubmitNewOffer/createOffer/
// OfferPanel hiç değişmedi. Bu script BİLEREK değiştirilmedi (bkz. CLAUDE.md
// "tmp-*.mjs" script konvansiyonu) — canlı regresyon kapısı olarak (hem kilit
// kuralı hem yeni birleşik metin için) tmp-operation-status-single-card-merge-test.mjs
// kullanılmalıdır.
//
// --- Aşağıdaki orijinal açıklama (rozet metinleri için kısmen geçersiz) ---
// "Teklif Kabulü ve İşe Başlama Kilit Kuralı" düzeltmesi.
//
// KÖK NEDEN (doğrulandı): `offers.ts#canProviderSubmitNewOffer`/`createOffer`
// ve `offer-panel.tsx` yalnızca `job.status`a (hep "yayinda") bakıyordu —
// `isJobClosedToNewOffers` kontrolü hiç yoktu. Bu yüzden bir teklif fiilen
// İŞE BAŞLASA (in_progress) BİLE üçüncü taraflar sınırsızca yeni teklif
// verebiliyordu. Ayrıca Aşama 5.2'nin operasyon kartı ANA rozeti, "accepted"
// (henüz işe başlanmamış, ön anlaşma aşaması) durumunu yanlışlıkla "Hizmet
// Veren Seçildi" (kapanmış izlenimi) olarak gösteriyordu — halbuki ilan o
// aşamada GERÇEKTEN hâlâ teklife açık olmalıydı.
//
// DÜZELTME: job-requests.ts#isJobClosedToNewOffers (settled teklif "accepted"
// ÖTESİNDEYSE true) artık canProviderSubmitNewOffer/createOffer/OfferPanel
// tarafından kullanılıyor; operasyon kartlarının ana rozeti
// getPublicOperationStatusBucket'a taşındı ("kabul-edildi" "aktif"e katlanır).
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

async function loginAsSyntheticProvider(page, { id, name }) {
  await page.goto(`${BASE_URL}/ilanlar`);
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

async function getStoredOffers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
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
        workLocationType: "Kilit Kuralı Testi Tesisi",
        workDate,
        description: "Teklif kabulü/işe başlama kilit kuralı testi için oluşturulmuş ilan, en az yirmi karakter.",
        operationDetails: "Kilit kuralı testi operasyon detayı, en az on karakter.",
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

async function injectOffer(page, { jobId, providerId, status, description }) {
  await page.evaluate(
    ({ jobId, providerId, status, description }) => {
      const KEY = "malsevk.offers.v1";
      const offers = JSON.parse(localStorage.getItem(KEY) || "[]");
      const now = new Date().toISOString();
      offers.push({
        id: crypto.randomUUID(),
        jobId,
        providerId,
        amount: 1000,
        currency: "TRY",
        description,
        estimatedDuration: "1 gün",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem(KEY, JSON.stringify(offers));
    },
    { jobId, providerId, status, description },
  );
}

function offerCardByDescription(page, description) {
  return page.locator(".rounded-card.border", { hasText: description });
}

async function acceptOffer(page, description) {
  const card = offerCardByDescription(page, description);
  await card.getByRole("button", { name: "Kabul Et", exact: true }).click();
  await card.getByText("Görüşme Sonucu", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

async function startWork(page, description) {
  const card = offerCardByDescription(page, description);
  await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı", exact: true }).click();
  await page.getByRole("heading", { name: "İşe Başlandı" }).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
}

async function markAgreementFailed(page, description) {
  const card = offerCardByDescription(page, description);
  await card.getByRole("button", { name: "Anlaşma Sağlanamadı", exact: true }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Anlaşma Sağlanamadı Olarak İşaretle", exact: true }).click();
  await page.getByRole("heading", { name: "Anlaşma Sağlanamadı" }).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
}

/** Gerçek OfferForm akışını sürer (createOffer/canProviderSubmitNewOffer'ın gerçek kapı bekçiliğini test eder). */
async function trySubmitRealOffer(page, jobId, description) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByRole("heading", { name: "Teklif Ver" }).waitFor({ state: "visible", timeout: 10000 });
  const formVisible = await page.getByLabel("Teklif Fiyatı").isVisible().catch(() => false);
  if (!formVisible) {
    return { submitted: false, formVisible: false };
  }
  const before = (await getStoredOffers(page)).length;
  await page.getByLabel("Teklif Fiyatı").fill("3000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
  await page.waitForFunction(
    (before) => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").length > before,
    before,
    { timeout: 10000 },
  ).catch(() => {});
  const after = (await getStoredOffers(page)).length;
  return { submitted: after > before, formVisible: true };
}

function offersCard(page) {
  return page.getByRole("heading", { name: "Operasyondaki Hizmetler" }).locator("xpath=..");
}
function rowByTitle(page, title) {
  return offersCard(page).locator("li", { has: page.getByText(title, { exact: true }) });
}

async function assertGlobalBadge(page, jobMainId, targetTitle, expectedBadge, viewerLabel) {
  await page.goto(`${BASE_URL}/ilanlar/${jobMainId}`);
  await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
  await assert.doesNotReject(
    rowByTitle(page, targetTitle).getByText(expectedBadge, { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    `${viewerLabel}: ana rozet '${expectedBadge}' olmalı`,
  );
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

  const cId = "synthetic-c-" + crypto.randomUUID();
  const dId = "synthetic-d-" + crypto.randomUUID();

  // =====================================================================
  // SENARYO 1 — Kabul Et -> İşe Başlandı
  // =====================================================================
  const op1 = "lock-rule-op1-" + crypto.randomUUID();
  const job1Main = { id: crypto.randomUUID(), title: "Kilit Kurali Ana Sayfa 1" };
  const job1Target = { id: crypto.randomUUID(), title: "Kilit Kurali Hedef Servis 1" };
  const DESC_A1 = "TEKLIF-A1-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const DESC_B1 = "TEKLIF-B1-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const DESC_C1 = "TEKLIF-C1-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const DESC_D1 = "TEKLIF-D1-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER-YENI";

  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await injectJob(page, { id: job1Main.id, title: job1Main.title, category: "forklift", requesterId: zeynepId, operationId: op1 });
    await injectJob(page, { id: job1Target.id, title: job1Target.title, category: "lashing", requesterId: zeynepId, operationId: op1 });
    await injectOffer(page, { jobId: job1Target.id, providerId: mertId, status: "pending", description: DESC_A1 });
    await injectOffer(page, { jobId: job1Target.id, providerId: mehmetId, status: "pending", description: DESC_B1 });
    await injectOffer(page, { jobId: job1Target.id, providerId: cId, status: "pending", description: DESC_C1 });
    ok("Senaryo 1 kurulumu: A(mert)/B(mehmet)/C(sentetik) job1Target'a pending teklif verdi");
    await page.close();
  }

  // --- A'nın teklifi kabul edilir ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler?ilanId=${job1Target.id}`);
    await acceptOffer(page, DESC_A1);
    ok("A'nın (mert) teklifi 'Kabul Et' ile kabul edildi");

    const offersAfterAccept = await getStoredOffers(page);
    const bOffer = offersAfterAccept.find((o) => o.description === DESC_B1);
    const cOffer = offersAfterAccept.find((o) => o.description === DESC_C1);
    assert.equal(bOffer.status, "pending", "B'nin teklifi 'pending' kalmalı");
    assert.equal(cOffer.status, "pending", "C'nin teklifi 'pending' kalmalı");
    ok("B ve C teklifleri kabul sonrası 'pending' (beklemede) kaldı — reddedilmedi/silinmedi");
    await page.close();
  }

  // --- İlan global olarak 'Teklife Açık' kalmalı (tüm hesaplarda) ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Teklife Açık", "Hizmet Alan (zeynep)");
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Teklife Açık", "A (mert, kabul edilen)");
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Teklife Açık", "B (mehmet, bekleyen)");
    ok("KRİTİK: 'Kabul Et' sonrası (işe henüz başlanmadı) ilan HERKESTE global olarak 'Teklife Açık' — 'Hizmet Veren Seçildi' DEĞİL");
    await page.close();
  }

  // --- A'da kişisel bilgi 'Teklifiniz kabul edildi' ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mert@test.com", "Mert123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${job1Main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assert.doesNotReject(
      rowByTitle(page, job1Target.title).getByText("Teklifiniz kabul edildi", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("A'da (mert) kişisel ikincil bilgi 'Teklifiniz kabul edildi' görünüyor");
    await page.close();
  }

  // --- D hâlâ teklif verebilmeli ---
  {
    const page = await sharedContext.newPage();
    await loginAsSyntheticProvider(page, { id: dId, name: "Test D" });
    const result = await trySubmitRealOffer(page, job1Target.id, DESC_D1);
    assert.equal(result.formVisible, true, "D için Teklif Ver formu görünmeli (ilan hâlâ açık)");
    assert.equal(result.submitted, true, "D gerçek bir teklif gönderebilmeli");
    ok("D isimli yeni kullanıcı (sentetik), A kabul edildikten sonra hâlâ GERÇEKTEN teklif verebiliyor");
    await page.close();
  }

  // --- A için 'İşe Başlandı' ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler?ilanId=${job1Target.id}`);
    await startWork(page, DESC_A1);
    ok("A için 'İşe Başlandı' onaylandı");

    const offers = await getStoredOffers(page);
    const aOffer = offers.find((o) => o.description === DESC_A1);
    assert.equal(aOffer.status, "in_progress", "A'nın teklifi 'in_progress' olmalı");
    ok("A'nın teklifi in_progress durumuna geçti");
    await page.close();
  }

  // --- İlan teklife kesin kapanmalı, yeni teklif engellenmeli (tüm hesaplarda 'Devam Ediyor') ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Devam Ediyor", "Hizmet Alan (zeynep)");
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Devam Ediyor", "B (mehmet)");
    await loginAsSyntheticProvider(page, { id: "synthetic-e-" + crypto.randomUUID(), name: "Test E" });
    await assertGlobalBadge(page, job1Main.id, job1Target.title, "Devam Ediyor", "E (hiç teklifi olmayan, sentetik)");
    ok("KRİTİK: İşe başlandıktan sonra ilan HERKESTE global olarak 'Devam Ediyor' gösteriyor");
    await page.close();
  }

  {
    const page = await sharedContext.newPage();
    const eId = "synthetic-e2-" + crypto.randomUUID();
    await loginAsSyntheticProvider(page, { id: eId, name: "Test E2" });
    const result = await trySubmitRealOffer(page, job1Target.id, "TEKLIF-E2-ENGELLENMELI-EN-AZ-YIRMI-KARAKTER");
    assert.equal(result.formVisible, false, "İşe başlandıktan sonra Teklif Ver formu ARTIK render edilmemeli");
    ok("KRİTİK: İşe başlandıktan sonra yeni (hiç teklifi olmayan) bir kullanıcı için Teklif Ver formu görünmüyor/işlevsel değil");
    await page.close();
  }

  // --- B ve C 'Başka hizmet verenle anlaşıldı' durumuna geçmeli (kendi görünümlerinde) ---
  {
    const page = await sharedContext.newPage();
    await loginAs(page, "mehmet.demir.demo@malsevk.com", "Demo123!", "/ilanlar");
    await page.goto(`${BASE_URL}/ilanlar/${job1Main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assert.doesNotReject(
      rowByTitle(page, job1Target.title).getByText("Başka hizmet verenle anlaşıldı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("B'nin (mehmet) kişisel ikincil bilgisi 'Başka hizmet verenle anlaşıldı' oldu");

    await loginAsSyntheticProvider(page, { id: cId, name: "Test C" });
    await page.goto(`${BASE_URL}/ilanlar/${job1Main.id}`);
    await offersCard(page).waitFor({ state: "visible", timeout: 10000 });
    await assert.doesNotReject(
      rowByTitle(page, job1Target.title).getByText("Başka hizmet verenle anlaşıldı", { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("C'nin (sentetik) kişisel ikincil bilgisi de 'Başka hizmet verenle anlaşıldı' oldu");

    const offers = await getStoredOffers(page);
    assert.equal(offers.find((o) => o.description === DESC_B1).status, "pending", "B'nin gerçek Offer.status'u hâlâ 'pending' — yalnızca GÖRÜNÜM değişti, kayıt mutasyona uğramadı");
    assert.equal(offers.find((o) => o.description === DESC_C1).status, "pending", "C'nin gerçek Offer.status'u hâlâ 'pending'");
    ok("B/C'nin 'Başka hizmet verenle anlaşıldı' görünümü yalnızca TÜRETİLMİŞ bir görünüm — gerçek Offer kaydı 'pending' olarak korunuyor");
    await page.close();
  }

  // =====================================================================
  // SENARYO 2 — Kabul Et -> Anlaşma Sağlanamadı (ayrı bir ilan üzerinde)
  // =====================================================================
  const op2 = "lock-rule-op2-" + crypto.randomUUID();
  const job2Main = { id: crypto.randomUUID(), title: "Kilit Kurali Ana Sayfa 2" };
  const job2Target = { id: crypto.randomUUID(), title: "Kilit Kurali Hedef Servis 2" };
  const DESC_A2 = "TEKLIF-A2-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const DESC_B2 = "TEKLIF-B2-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const DESC_C2 = "TEKLIF-C2-BENZERSIZ-ACIKLAMA-EN-AZ-YIRMI-KARAKTER";
  const fId = "synthetic-f-" + crypto.randomUUID();

  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await injectJob(page, { id: job2Main.id, title: job2Main.title, category: "forklift", requesterId: zeynepId, operationId: op2 });
    await injectJob(page, { id: job2Target.id, title: job2Target.title, category: "lashing", requesterId: zeynepId, operationId: op2 });
    await injectOffer(page, { jobId: job2Target.id, providerId: mertId, status: "pending", description: DESC_A2 });
    await injectOffer(page, { jobId: job2Target.id, providerId: mehmetId, status: "pending", description: DESC_B2 });
    await injectOffer(page, { jobId: job2Target.id, providerId: cId, status: "pending", description: DESC_C2 });
    await page.goto(`${BASE_URL}/panel/gelen-teklifler?ilanId=${job2Target.id}`);
    await acceptOffer(page, DESC_A2);
    await markAgreementFailed(page, DESC_A2);
    ok("Senaryo 2: A(mert)'nin teklifi kabul edildi, ardından 'Anlaşma Sağlanamadı' olarak işaretlendi");

    const offers = await getStoredOffers(page);
    assert.equal(offers.find((o) => o.description === DESC_A2).status, "agreement_failed", "A2'nin teklifi 'agreement_failed' olmalı");
    await page.close();
  }

  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await assertGlobalBadge(page, job2Main.id, job2Target.title, "Teklife Açık", "Hizmet Alan (zeynep)");
    ok("Anlaşma Sağlanamadı sonrası ilan tekrar global olarak 'Teklife Açık'");
    await page.close();
  }

  {
    const page = await sharedContext.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler?ilanId=${job2Target.id}`);
    const cardB = offerCardByDescription(page, DESC_B2);
    await assert.doesNotReject(
      cardB.getByRole("button", { name: "Kabul Et", exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      "B2'nin 'Kabul Et' butonu tekrar görünür/tıklanabilir olmalı",
    );
    const cardC = offerCardByDescription(page, DESC_C2);
    await assert.doesNotReject(
      cardC.getByRole("button", { name: "Kabul Et", exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      "C2'nin 'Kabul Et' butonu tekrar görünür/tıklanabilir olmalı",
    );
    ok("Anlaşma Sağlanamadı sonrası B ve C yeniden değerlendirilebilir (Kabul Et/Reddet butonları geri döndü)");
    await page.close();
  }

  {
    const page = await sharedContext.newPage();
    await loginAsSyntheticProvider(page, { id: fId, name: "Test F" });
    const result = await trySubmitRealOffer(page, job2Target.id, "TEKLIF-F-YENIDEN-ACIK-EN-AZ-YIRMI-KARAKTER");
    assert.equal(result.formVisible, true, "F için Teklif Ver formu tekrar görünmeli");
    assert.equal(result.submitted, true, "F gerçek bir teklif gönderebilmeli (ilan yeniden açık)");
    ok("Anlaşma Sağlanamadı sonrası yeni bir kullanıcı (F) gerçekten teklif verebiliyor");
    await page.close();
  }

  await sharedContext.close();
  await browser.close();
  console.log(`\n[tmp-offer-accept-workstart-lock-fix-test] ${passed} test geçti.`);
}

main().catch(async (err) => {
  console.error(err);
  if (browser) await browser.close();
  process.exit(1);
});
