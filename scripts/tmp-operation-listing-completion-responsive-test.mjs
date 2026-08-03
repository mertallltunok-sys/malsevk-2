// "Aktif İlanlar" (provider-job-listing.tsx) ekranındaki operasyon
// satırlarının/kartlarının YENİ tamamlanma-durumu ve responsive genişleme
// davranışının uçtan uca doğrulaması. Önceki tur (bkz.
// tmp-operation-listing-service-tags-test.mjs) yalnızca "hiçbir hizmet
// gizlenmez / durum hiç gösterilmez" kuralını doğruluyordu — bu tur onun
// ÜZERİNE, her hizmetin GERÇEK Offer/Job durumundan türetilen tamamlanma
// bilgisini ekler:
//
//  1. Karma bir operasyonda (3 hizmet, 1'i tamamlanmış): tamamlanan hizmet
//     soluk/gri renkte + ince bir line-through ile görünür — rozet, ikon,
//     "Tamamlandı" YAZISI YOK (tek gösterge üstü çizili görünümün kendisi).
//     Aktif iki hizmet mavi (text-accent), normal yazı, ÇİZGİSİZ kalır.
//     "Hizmet Türü" rozetinin metni "Operasyon • {kalan} Hizmet Arıyor"
//     biçimindedir (bkz. job-listing-row.ts#getJobListingCategoryBadgeLabel)
//     — kalan yalnızca TAMAMLANMAMIŞ hizmetlerden hesaplanır.
//  2. Aynı satırda hâlâ "Operasyon İlerlemesi: %<100" görünür (tam
//     tamamlanma değil) — "Operasyon Tamamlandı" YOK.
//  3. Tüm hizmetleri tamamlanmış bir operasyonda (2/2) operasyon Aktif
//     İlanlar'dan TAMAMEN kalkar (bkz. job-completion.ts#
//     isJobFullyCompletedForListing) — "Operasyon Tamamlandı" etiketi de
//     dahil hiçbir izi kalmaz (bu dal artık pratikte hiç tetiklenmiyor,
//     ayrıntılı doğrulama tmp-active-listing-title-completion-visibility-
//     test.mjs'dedir).
//  4. Bir hizmetin tamamlanması KARDEŞ hizmetlerin teklif alma/görünüm
//     durumunu etkilemez (Forklift hâlâ teklif almaya açık kalır).
//  5. Sıralama tamamlanma durumundan HİÇ etkilenmez: hizmetler her zaman
//     service-catalog.ts sırasında kalır, tamamlanan bir hizmet listenin
//     sonuna taşınmaz.
//  6. Hizmet adları hâlâ tıklanamaz (Link/button yok) — tamamlanma durumu
//     salt görsel bir göstergedir, hover/tıklama davranışını etkilemez.
//  7. Masaüstü (≥1024px) tablo, mobil/tablet (<1024px) kart listesine
//     dönüşür; 320/375/768/1024/1366/1920px genişliklerin HİÇBİRİNDE sayfa
//     genelinde yatay kaydırma (scrollWidth > clientWidth) oluşmaz.
//  8. Tek hizmetli (operationId'siz) bir ilan bu değişikliklerin hiçbirinden
//     etkilenmez.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

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
  await page.setViewportSize({ width: 1280, height: 900 });
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
async function seedJob(page, { id, title, category, reqId, operationId }) {
  await page.evaluate(
    ({ id, title, category, reqId, operationId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Tamamlanma durumu / responsive dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
        ...(operationId ? { operationId } : {}),
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, reqId, operationId },
  );
}
async function seedOffer(page, { id, jobId, providerId, status }) {
  await page.evaluate(
    ({ id, jobId, providerId, status }) => {
      const raw = localStorage.getItem("malsevk.offers.v1");
      const offers = raw ? JSON.parse(raw) : [];
      const now = new Date().toISOString();
      offers.push({
        id,
        jobId,
        providerId,
        amount: 5000,
        currency: "TRY",
        description: "Test teklifi - tamamlanma durumu dogrulamasi icin.",
        estimatedDuration: "2 gun",
        status,
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    },
    { id, jobId, providerId, status },
  );
}

// Karma operasyon: Nakliye tamamlanmis, Forklift teklif bekliyor (pending),
// Lashing henuz hic teklif almamis (aktif).
const MIXED_OP_ID = "compl-resp-mixed-operation";
const MIXED_NAKLIYE = { id: "compl-resp-nakliye", title: "Compl Resp Mixed Nakliye", category: "nakliye" };
const MIXED_FORKLIFT = { id: "compl-resp-forklift", title: "Compl Resp Mixed Forklift", category: "forklift" };
const MIXED_LASHING = { id: "compl-resp-lashing", title: "Compl Resp Mixed Lashing", category: "lashing" };

// Tam tamamlanmis operasyon: 2/2 hizmet "completed".
const FULL_OP_ID = "compl-resp-full-operation";
const FULL_KDOLUM = { id: "compl-resp-kdolum", title: "Compl Resp Full Konteyner Dolum", category: "konteyner-dolum" };
const FULL_UNLASHING = { id: "compl-resp-unlashing", title: "Compl Resp Full Unlashing", category: "unlashing" };

const SINGLE_JOB = { id: "compl-resp-single", title: "Compl Resp Tekil Depolama Ilani", category: "genel-depolama" };

const VIEWPORTS = [
  { width: 320, height: 640, label: "320px (kucuk mobil)" },
  { width: 375, height: 812, label: "375px (mobil)" },
  { width: 768, height: 1024, label: "768px (tablet dikey)" },
  { width: 1024, height: 900, label: "1024px (tablet yatay / laptop esigi)" },
  { width: 1366, height: 900, label: "1366px (dizustu)" },
  { width: 1920, height: 1080, label: "1920px (genis masaustu)" },
];

async function main() {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...MIXED_NAKLIYE, reqId: zeynepId, operationId: MIXED_OP_ID });
  await seedJob(page, { ...MIXED_FORKLIFT, reqId: zeynepId, operationId: MIXED_OP_ID });
  await seedJob(page, { ...MIXED_LASHING, reqId: zeynepId, operationId: MIXED_OP_ID });
  await seedJob(page, { ...FULL_KDOLUM, reqId: zeynepId, operationId: FULL_OP_ID });
  await seedJob(page, { ...FULL_UNLASHING, reqId: zeynepId, operationId: FULL_OP_ID });
  await seedJob(page, { ...SINGLE_JOB, reqId: zeynepId });
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  const mertId = await getUserId(page, "mert@test.com");

  await seedOffer(page, { id: "compl-resp-offer-nakliye", jobId: MIXED_NAKLIYE.id, providerId: mertId, status: "completed" });
  await seedOffer(page, { id: "compl-resp-offer-forklift", jobId: MIXED_FORKLIFT.id, providerId: mertId, status: "pending" });
  await seedOffer(page, { id: "compl-resp-offer-kdolum", jobId: FULL_KDOLUM.id, providerId: mertId, status: "completed" });
  await seedOffer(page, { id: "compl-resp-offer-unlashing", jobId: FULL_UNLASHING.id, providerId: mertId, status: "completed" });
  ok("Kurulum: karma operasyon (1/3 tamamlandi), tam operasyon (2/2 tamamlandi), tekil ilan");

  // --- Masaustu (tablo) dogrulamasi ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/ilanlar`);

  // Nakliye zaten tamamlanmış olarak seed edildi (yukarıda) — kalan =
  // 3 toplam - 1 tamamlanan = 2, rozet bu yüzden baştan "• 2" gösterir.
  const mixedCell = page.locator("td").filter({ hasText: "Operasyon • 2 Hizmet Arıyor" }).first();
  await mixedCell.waitFor({ state: "visible", timeout: 10000 });

  // NOT: `.whitespace-nowrap` sınıfı yalnızca kategori adı span'ında var
  // (dış sarmalayıcı span'da yok), bu yüzden hasText ile birleşince tek bir
  // adayı benzersiz şekilde hedefler.
  const nakliyeNameSpan = mixedCell.locator("p span.whitespace-nowrap", { hasText: "Nakliye" }).first();
  const nakliyeClass = await nakliyeNameSpan.getAttribute("class");
  assert.ok(nakliyeClass.includes("text-muted-foreground"), `Tamamlanan hizmet adi soluk/gri olmali, class: ${nakliyeClass}`);
  assert.ok(nakliyeClass.includes("line-through"), `Tamamlanan hizmet adı ince bir line-through taşımalı, class: ${nakliyeClass}`);
  ok('[Senaryo 1] Tamamlanan "Nakliye" hizmeti soluk/gri + line-through ile gösteriliyor, rozet/ikon yok');

  const forkliftNameSpan = mixedCell.locator("p span.whitespace-nowrap", { hasText: "Forklift" }).first();
  const forkliftClass = await forkliftNameSpan.getAttribute("class");
  assert.ok(forkliftClass.includes("text-accent"), `Aktif/teklif bekleyen hizmet mavi (text-accent) kalmali, class: ${forkliftClass}`);
  assert.ok(!forkliftClass.includes("line-through"), `Aktif hizmette line-through OLMAMALI, class: ${forkliftClass}`);
  ok("[Senaryo 1/4] Teklif bekleyen (pending) Forklift hâlâ mavi, normal yazı — tamamlanmamış bir hizmet asla soluklaşmaz/çizilmez");

  const lashingNameSpan = mixedCell.locator("p span.whitespace-nowrap", { hasText: "Lashing" }).first();
  const lashingClass = await lashingNameSpan.getAttribute("class");
  assert.ok(lashingClass.includes("text-accent"), `Hiç teklifi olmayan aktif hizmet de mavi kalmalı, class: ${lashingClass}`);
  assert.ok(!lashingClass.includes("line-through"), `Hiç teklifi olmayan aktif hizmette de line-through OLMAMALI, class: ${lashingClass}`);
  ok("[Senaryo 4] Henüz hiç teklifi olmayan Lashing hizmeti de mavi/aktif — kardeş tamamlanmasından etkilenmedi");

  // Hizmet Türü hücresinde (aggregate "Operasyon İlerlemesi" satırı hariç,
  // o ayrı bir <td>'dedir) artık hiçbir "Tamamlandı" yazısı/rozeti/ikonu
  // OLMAMALI — tek gösterge line-through'un kendisi.
  const mixedCellText = await mixedCell.innerText();
  assert.ok(!mixedCellText.includes("Tamamlandı"), `Hizmet Türü hücresinde "Tamamlandı" yazısı OLMAMALI, gelen: ${mixedCellText}`);
  const mixedCellSvgCount = await mixedCell.locator("svg").count();
  assert.equal(mixedCellSvgCount, 0, "Hizmet Türü hücresinde hiçbir ikon (svg) OLMAMALI");
  ok('[Senaryo 1] Hizmet Türü hücresinde "Tamamlandı" yazısı/ikonu yok — tek gösterge line-through');

  // Sıralama tamamlanma durumundan etkilenmemeli: hâlâ service-catalog.ts
  // sırasında (Lashing · Forklift · Nakliye), Nakliye tamamlanmış olsa bile
  // sona taşınmadı.
  const mixedNamesText = (await mixedCell.locator("p").first().innerText()).replace(/\s+/g, " ").trim();
  assert.equal(
    mixedNamesText,
    "Lashing · Forklift · Nakliye",
    `Tamamlanan hizmet sona taşınmamalı, sıra service-catalog.ts sırasında kalmalı, gelen: ${mixedNamesText}`,
  );
  ok("[Senaryo 5] Tamamlanan Nakliye listenin sonuna taşınmadı — sıra service-catalog.ts sırasında (değişmedi)");

  const mixedCellLinkCount = await mixedCell.locator("p a, p button").count();
  assert.equal(mixedCellLinkCount, 0, "Hizmet adları hâlâ tıklanamaz olmalı (Link/button yok)");
  ok("[Senaryo 6] Hizmet adları hâlâ tıklanamaz — tamamlanma durumu salt görsel, hover/tıklama davranışı eklenmedi");

  const mixedProgressCell = page.locator("td").filter({ hasText: "Operasyon İlerlemesi" }).first();
  const mixedProgressText = await mixedProgressCell.innerText();
  assert.match(mixedProgressText, /Operasyon İlerlemesi: %(?!100)\d+/, `Karma operasyon %100 olmamalı: ${mixedProgressText}`);
  assert.ok(!mixedProgressText.includes("Operasyon Tamamlandı"), "Karma operasyonda 'Operasyon Tamamlandı' YOK");
  ok("[Senaryo 2] Karma operasyonda hâlâ kısmi ilerleme yüzdesi gösteriliyor, 'Operasyon Tamamlandı' yok");

  // job-completion.ts#isJobFullyCompletedForListing artık TÜM hizmetleri
  // tamamlanmış (2/2) bir operasyonu Aktif İlanlar'dan TAMAMEN kaldırıyor —
  // eskiden burada "Operasyon Tamamlandı" etiketiyle görünmeye devam ederdi
  // (bkz. yukarıdaki senaryo notu); o dal artık pratikte hiç tetiklenmiyor.
  // Ayrıntılı/çok senaryolu doğrulama tmp-active-listing-title-completion-
  // visibility-test.mjs'de — burada yalnızca BU script'in kendi (farklı
  // kategori kombinasyonlu) FULL_OP fixture'ının da tutarlı biçimde
  // kaybolduğu doğrulanır.
  const fullOpTitleGone = await page.getByText(FULL_KDOLUM.title).count();
  assert.equal(fullOpTitleGone, 0, `Tüm hizmetleri tamamlanmış operasyonun gerçek başlığı ("${FULL_KDOLUM.title}") artık HİÇ görünmemeli`);
  const fullOpUnlashingGone = await page.getByText(FULL_UNLASHING.title).count();
  assert.equal(fullOpUnlashingGone, 0, `Tüm hizmetleri tamamlanmış operasyonun diğer hizmetinin başlığı ("${FULL_UNLASHING.title}") da HİÇ görünmemeli`);
  ok("[Senaryo 3] Tüm hizmetleri tamamlanmış operasyon (2/2) Aktif İlanlar'dan TAMAMEN kalktı — veriler silinmedi, yalnızca listeden çıktı");

  const singleRow = page.locator("tr").filter({ hasText: SINGLE_JOB.title }).first();
  await singleRow.waitFor({ state: "visible" });
  const singleRowText = await singleRow.innerText();
  assert.ok(!singleRowText.includes("Tamamlandı") && !singleRowText.includes("Operasyon"), "Tekil ilan satırı bu değişikliklerden hiç etkilenmemiş olmalı");
  ok("[Senaryo 8] Tekil (operationId'siz) ilan satırı hiç etkilenmedi");

  // --- Responsive: her genislikte sayfa genelinde yatay kaydirma olmamali ---
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.waitForSelector("table, ul[role=list]", { timeout: 10000 });
    // Operasyon icerigi render olana kadar bekle (tablo ya da kart agaci) —
    // FULL_OP artik tamamen kalktigi icin (bkz. yukarisi) yalnizca hala
    // aktif olan MIXED_OP'un rozeti kararli bir "yuklendi" sinyalidir.
    await page
      .getByText("Operasyon • 2 Hizmet Arıyor", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 10000 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      scrollWidth <= clientWidth + 1,
      `[${viewport.label}] Sayfa genelinde yatay kaydırma OLUŞMAMALI (scrollWidth: ${scrollWidth}, clientWidth: ${clientWidth})`,
    );

    const isDesktopWidth = viewport.width >= 1024;
    const hasTable = (await page.locator("table").count()) > 0;
    const hasCardList = (await page.locator('ul[role="list"]').count()) > 0;
    assert.equal(hasTable, isDesktopWidth, `[${viewport.label}] Tablo yalnızca ≥1024px genişlikte görünmeli`);
    assert.equal(hasCardList, !isDesktopWidth, `[${viewport.label}] Kart listesi yalnızca <1024px genişlikte görünmeli`);

    await page.screenshot({ path: `scripts/.tmp-screens/aktif-ilanlar-${viewport.width}.png`, fullPage: true });
    ok(`[Senaryo 7] ${viewport.label}: yatay kaydırma yok, doğru görünüm (${isDesktopWidth ? "tablo" : "kart"}) render edildi`);
  }

  if (consoleErrors.length > 0) {
    console.log("\n[operation-listing-completion-responsive-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[operation-listing-completion-responsive-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  await logout(page);

  // Temizlik
  const allJobIds = [
    MIXED_NAKLIYE.id,
    MIXED_FORKLIFT.id,
    MIXED_LASHING.id,
    FULL_KDOLUM.id,
    FULL_UNLASHING.id,
    SINGLE_JOB.id,
  ];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, allJobIds);

  console.log(`\n[operation-listing-completion-responsive-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[operation-listing-completion-responsive-test] HATA:", error);
  process.exitCode = 1;
});
