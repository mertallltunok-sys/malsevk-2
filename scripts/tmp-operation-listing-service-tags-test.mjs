// "Aktif İlanlar" (provider-job-listing.tsx) ekranındaki çoklu hizmet
// (Operasyon) satırlarının/kartlarının, ilana girmeden operasyondaki TÜM
// hizmetlerin adını (hiçbiri gizlenmeden, "·" ayracıyla akan tek bir
// paragrafta) göstermesinin uçtan uca doğrulaması (durum rozeti BİLEREK
// YOK). Bu bileşen iki tasarım yinelemesinden geçti: (1) sabit eşit
// genişlikli grid + truncate -> uzun adlar çirkin kesiliyordu, (2) içeriğe
// göre boyutlanan grid sütunları -> sütun genişliği en uzun ada göre
// sabitlendiğinde kısa/uzun hizmetler arasında satırdan satıra TUTARSIZ
// boşluklar oluşup dağınık görünüyordu. Bu üçüncü ve son sürüm, hizmet
// adlarını sütun kavramı OLMADAN, doğal metin akışıyla ("·" ayracı, normal
// satır kırma) gösterir.
//
// Kapsanan senaryolar:
//  1. "Hizmet Türü" rozeti (artık "Operasyon • {kalan} Hizmet Arıyor" —
//     bkz. job-listing-row.ts#getJobListingCategoryBadgeLabel) korunuyor,
//     hemen altında operasyondaki hizmet adları "·" ile ayrılmış tek bir
//     paragrafta görünüyor.
//  2. Hizmetler service-catalog.ts SIRASINA göre gösteriliyor (oluşturma
//     sırasına göre DEĞİL) — kayıt sırası bilerek katalog sırasının TAM
//     TERSİ seçildi.
//  3. Her hizmet yalnızca bir kez listeleniyor, hiçbiri kısaltılmıyor.
//  4. Hiçbir hizmet adı tıklanabilir değil (Link/button yok) ve hiçbir
//     yerde durum metni (ör. "Teklife Açık"/"Teklif Bekliyor") YOK — bir
//     hizmete teklif verildikten SONRA bile metin değişmiyor.
//  5. Tek hizmetli (operationId'siz) bir ilanın görünümü HİÇ değişmedi.
//  6. 4'ten FAZLA hizmeti olan bir operasyonda bile HİÇBİR hizmet
//     gizlenmiyor — "+N" özet etiketi hiçbir yerde kullanılmıyor, altı
//     hizmetin de tamamı eksiksiz görünüyor.
//  7. Operasyon İlerlemesi yüzdesi yerinde kalmaya devam ediyor.
//  8. Mobil (kart) görünümünde de aynı metin, rozetin hemen altında,
//     kartın dışına TAŞMADAN (gerekirse ikinci satıra sararak) görünüyor.
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

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
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
        description: "Operasyon hizmet etiketleri dogrulama testi icin olusturulan ilan.",
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
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

const OP_ID = "svc-tags-test-operation";
// Kayıt sırası bilerek katalog sırasının (Lashing -> Forklift -> Nakliye)
// TAM TERSİ: Nakliye, Forklift, Lashing.
const JOB_NAKLIYE = { id: "svc-tags-job-nakliye", title: "Svc Tags Operasyon Nakliye Hizmeti", category: "nakliye" };
const JOB_FORKLIFT = { id: "svc-tags-job-forklift", title: "Svc Tags Operasyon Forklift Hizmeti", category: "forklift" };
const JOB_LASHING = { id: "svc-tags-job-lashing", title: "Svc Tags Operasyon Lashing Hizmeti", category: "lashing" };
const SINGLE_JOB = { id: "svc-tags-job-single", title: "Svc Tags Tekil Depolama Ilani", category: "genel-depolama" };

// 6 hizmetlik ikinci bir operasyon — "hiçbir hizmet gizlenmez" kuralını
// (4 eşiğinin üzerinde) doğrulamak için. Kayıt sırası yine katalog
// sırasının TAM TERSİ.
const OVERFLOW_OP_ID = "svc-tags-overflow-operation";
const OVERFLOW_JOBS = [
  { id: "svc-tags-of-nakliye", title: "Svc Tags Overflow Op Nakliye", category: "nakliye" },
  { id: "svc-tags-of-forklift", title: "Svc Tags Overflow Op Forklift", category: "forklift" },
  { id: "svc-tags-of-kbosaltim", title: "Svc Tags Overflow Op Konteyner Bosaltim", category: "konteyner-bosaltim" },
  { id: "svc-tags-of-kdolum", title: "Svc Tags Overflow Op Konteyner Dolum", category: "konteyner-dolum" },
  { id: "svc-tags-of-unlashing", title: "Svc Tags Overflow Op Unlashing", category: "unlashing" },
  { id: "svc-tags-of-lashing", title: "Svc Tags Overflow Op Lashing", category: "lashing" },
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
  await seedJob(page, { ...JOB_NAKLIYE, reqId: zeynepId, operationId: OP_ID });
  await seedJob(page, { ...JOB_FORKLIFT, reqId: zeynepId, operationId: OP_ID });
  await seedJob(page, { ...JOB_LASHING, reqId: zeynepId, operationId: OP_ID });
  await seedJob(page, { ...SINGLE_JOB, reqId: zeynepId });
  for (const job of OVERFLOW_JOBS) {
    await seedJob(page, { ...job, reqId: zeynepId, operationId: OVERFLOW_OP_ID });
  }
  ok("Kurulum: 3 hizmetli operasyon (Nakliye/Forklift/Lashing sırasıyla), 6 hizmetli taşma operasyonu, 1 tekil ilan");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");

  // --- Masaüstü (tablo) görünümü ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/ilanlar`);

  const opCell = page.locator("td").filter({ hasText: "Operasyon • 3 Hizmet Arıyor" }).first();
  await opCell.waitFor({ state: "visible", timeout: 10000 });
  ok('[Senaryo 1] "Operasyon • 3 Hizmet Arıyor" rozeti korunuyor');

  // NOT: birincil (ilk oluşturulan) hizmet "Nakliye" olduğu için kartın
  // BAŞLIĞI da bu adı taşıyor — ama masaüstünde başlık AYRI bir "İlan
  // Başlığı" sütununda olduğundan `opCell` (yalnızca "Hizmet Türü" sütunu)
  // yalnızca rozet + hizmet paragrafını içerir, karışıklık riski yoktur.
  const cellServicesText = normalize(await opCell.locator("p").first().innerText());
  assert.equal(
    cellServicesText,
    "Lashing · Forklift · Nakliye",
    `Hizmetler service-catalog.ts sırasına göre (kayıt sırası Nakliye/Forklift/Lashing idi) "·" ile ayrılmış TAM metin olarak görünmeli, gelen: ${cellServicesText}`,
  );
  ok('[Senaryo 1/2/3] "Lashing · Forklift · Nakliye" — üç hizmet de eksiksiz, doğru sırada, tek paragrafta');

  assert.ok(
    !/Teklife Açık|Teklif Bekliyor|Teklif Kabul|Devam Ediyor|Tamamlandı|Süresi Doldu|İptal Edildi/.test(
      cellServicesText,
    ),
    "Paragraf durum metni İÇERMEMELİ",
  );
  ok("[Senaryo 4] Hizmet paragrafında hiçbir durum metni yok — yalnızca hizmet adları");

  const linksInsideCell = await opCell.locator("a, button").count();
  assert.equal(linksInsideCell, 0, "Hizmet Türü hücresinde hiçbir Link/button olmamalı (tıklanamaz)");
  ok("[Senaryo 4] Hizmet adları tıklanabilir değil — hücrede hiçbir Link/button yok");

  const progressText = await page.locator("td").filter({ hasText: "Operasyon İlerlemesi" }).first().innerText();
  assert.match(progressText, /Operasyon İlerlemesi: %\d+/);
  ok("[Senaryo 7] Operasyon İlerlemesi yüzdesi hâlâ mevcut, yerinde");

  // Tekil ilan hiç etkilenmemiş: yalnızca kendi kategori rozeti var, ek paragraf yok.
  const singleRow = page.locator("tr").filter({ hasText: SINGLE_JOB.title }).first();
  await singleRow.waitFor({ state: "visible" });
  const singleCategoryCell = singleRow.locator("td").nth(1);
  const singleCategoryText = await singleCategoryCell.innerText();
  assert.ok(singleCategoryText.includes("Genel Depolama"), "Tekil ilan kendi kategori rozetini göstermeli");
  const singleParagraphCount = await singleCategoryCell.locator("p").count();
  assert.equal(singleParagraphCount, 0, "Tekil ilanda OperationServiceTags paragrafı HİÇ render edilmemeli");
  ok("[Senaryo 5] Tekil (operationId'siz) ilanın görünümü değişmedi — yalnızca kendi kategori rozeti");

  // --- 6 hizmetlik operasyonda HİÇBİR hizmet gizlenmemeli — "+N" özet
  // etiketi YOKTUR, altı hizmetin ALTISI da service-catalog.ts sırasına
  // göre, eksiksiz görünmeli.
  const overflowCell = page.locator("td").filter({ hasText: "Operasyon • 6 Hizmet Arıyor" }).first();
  await overflowCell.waitFor({ state: "visible" });
  const overflowText = normalize(await overflowCell.locator("p").first().innerText());
  assert.equal(
    overflowText,
    "Lashing · Unlashing · Konteyner Dolum · Konteyner Boşaltım · Forklift · Nakliye",
    `6 hizmet de eksiksiz, service-catalog.ts sırasına göre görünmeli, gelen: ${overflowText}`,
  );
  const pageHasPlusSign = await page.getByText(/^\+\d+$/).count();
  assert.equal(pageHasPlusSign, 0, 'Sayfada hiçbir yerde "+N" tarzı bir özet etiketi görünmemeli');
  ok('[Senaryo 6] 6 hizmetlik operasyonda hiçbir hizmet gizlenmiyor/kısaltılmıyor — "+N" hiç kullanılmıyor, tümü eksiksiz görünüyor');

  // --- Mert, Lashing hizmetine pending teklif verir — metin yine de değişmemeli (durum hiç yok) ---
  await submitOffer(page, JOB_LASHING.id, {
    amount: "5000",
    duration: "2 gün",
    description: "Lashing hizmeti icin teklif, yirmi karakterden uzun aciklama metni.",
  });
  await page.goto(`${BASE_URL}/ilanlar`);
  const opCellAfterOffer = page.locator("td").filter({ hasText: "Operasyon • 3 Hizmet Arıyor" }).first();
  await opCellAfterOffer.waitFor({ state: "visible" });
  const textAfterOffer = normalize(await opCellAfterOffer.locator("p").first().innerText());
  assert.equal(
    textAfterOffer,
    "Lashing · Forklift · Nakliye",
    "Teklif verildikten sonra bile metin AYNI kalmalı (durum hiç gösterilmediği için etkilenmez)",
  );
  ok("[Senaryo 4] Bir hizmete teklif verildikten sonra bile metin değişmedi (durum sistemi bu ekrana hiç yansımıyor)");

  // --- Mobil (kart) görünümü: aynı metin, kartın dışına TAŞMADAN ---
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${BASE_URL}/ilanlar`);
  const opCard = page.locator("li").filter({ hasText: "Operasyon • 3 Hizmet Arıyor" }).first();
  await opCard.waitFor({ state: "visible", timeout: 10000 });
  const cardText = normalize(await opCard.locator("p").first().innerText());
  assert.equal(cardText, "Lashing · Forklift · Nakliye", "Mobil kartta da aynı üç hizmet, aynı sırayla görünmeli");
  ok("[Senaryo 8] Mobil (kart) görünümünde de rozetin hemen altında aynı üç hizmet, aynı sırayla görünüyor");

  // KRİTİK REGRESYON KONTROLÜ: bir önceki denemede, ayracın boşluğunu da
  // `whitespace-nowrap` kapsamına almak metnin satır kırmadan kartın
  // dışına TAŞMASINA yol açmıştı (gerçek kullanıcı geri bildirimiyle
  // tespit edildi). Paragrafın sağ kenarı kartın kendi sağ kenarını
  // AŞMAMALI — 6 hizmetlik (daha uzun) paragrafla da doğrulanır.
  await page.goto(`${BASE_URL}/ilanlar`);
  const overflowCard = page.locator("li").filter({ hasText: "Operasyon • 6 Hizmet Arıyor" }).first();
  await overflowCard.waitFor({ state: "visible" });
  const [cardBox, paragraphBox] = await Promise.all([
    overflowCard.boundingBox(),
    overflowCard.locator("p").first().boundingBox(),
  ]);
  assert.ok(
    paragraphBox.x + paragraphBox.width <= cardBox.x + cardBox.width + 1,
    `Hizmet paragrafı kartın dışına TAŞMAMALI (kart sağ kenarı: ${cardBox.x + cardBox.width}, paragraf sağ kenarı: ${paragraphBox.x + paragraphBox.width})`,
  );
  ok("[Regresyon] Uzun (6 hizmetlik) paragraf bile mobil kartın dışına taşmıyor — satır kırma doğru çalışıyor");

  // Temizlik/çıkış öncesi masaüstü görünümüne dön — mobil genişlikte profil
  // menüsü butonu hamburger menünün ardında olduğu için `logout` helper'ı
  // onu bulamaz (bu, uygulamanın kendisiyle değil yalnızca bu script'in
  // temizlik adımıyla ilgili bir detaydır).
  await page.setViewportSize({ width: 1280, height: 900 });

  if (consoleErrors.length > 0) {
    console.log("\n[operation-listing-service-tags-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[operation-listing-service-tags-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  await logout(page);

  // Temizlik
  const allJobIds = [
    JOB_NAKLIYE.id,
    JOB_FORKLIFT.id,
    JOB_LASHING.id,
    SINGLE_JOB.id,
    ...OVERFLOW_JOBS.map((j) => j.id),
  ];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  }, allJobIds);

  console.log(`\n[operation-listing-service-tags-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[operation-listing-service-tags-test] HATA:", error);
  process.exitCode = 1;
});
