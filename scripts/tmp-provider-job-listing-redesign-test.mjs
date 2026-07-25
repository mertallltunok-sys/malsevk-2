// Hizmet Veren "İş İlanlarını İncele" (Aktif İlanlar) ekranının yeniden
// tasarımını doğrular. İki dalga:
//   1) 2026-07 redesign: eski "Teklife Açık"/"Teklife Kapalı" iki sütun
//      tamamen kalkmış olmalı, canlı arama çalışmalı, Tek Aktif Kabul
//      mimarisi (başka bir sağlayıcının kabul edilmiş teklifi olan bir ilan
//      hâlâ listede görünmeli) bozulmamış olmalı.
//   2) 2026-07-25 filtre düzeltmesi: Hizmet Türü filtresi merkezi
//      service-catalog.ts kataloğundan gelmeli (ilan sayısı sıfır olsa
//      bile), İl->İlçe->Bölge/Tesis kademeli ve ID tabanlı çalışmalı
//      (turkey-locations.ts ile aynı kaynak), Favoriler ve Rozetler
//      sistemleri tamamen kaldırılmış olmalı.
//   3) 2026-07-25 merkezi lokasyon sistemi: Firma/Fabrika arama filtresi
//      job.companyOrFactoryName üzerinde çalışmalı, eski (companyOrFactoryName'i
//      olmayan) ilanları hiç etkilememeli.
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

/** job-request-form.tsx'teki SearchableSelect'lerle aynı desen: buton -> ara/seç. */
async function selectSearchable(page, label, optionName) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const list = page.locator(`ul[aria-label="${label}"]`);
  await list.waitFor({ state: "visible" });
  await list.getByRole("option", { name: optionName, exact: true }).click();
}

const JOB_A_ID = `redesign-job-a-${STAMP}`; // Depo Personeli, İzmir/Aliağa, 0 teklif
const JOB_B_ID = `redesign-job-b-${STAMP}`; // Forklift, Kocaeli/Gebze
const JOB_C_ID = `redesign-job-c-${STAMP}`; // Vinç, İstanbul/Tuzla, başka sağlayıcının kabul edilmiş teklifi var (SAA regresyon)
const JOB_D_ID = `redesign-job-d-${STAMP}`; // Depo Personeli, Kocaeli/Dilovası, workLocationType="Beldeport" (bölge/tesis kataloğuyla eşleşen gerçek tesis adı)

async function seedScenario(page, { zeynepId, mehmetId }) {
  return page.evaluate(
    ({ zeynepId, mehmetId, jobAId, jobBId, jobCId, jobDId, stamp }) => {
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
        {
          ...baseJob,
          id: jobDId,
          title: `REDESIGN-D-DILOVASI-${stamp}`,
          category: "depo-personeli",
          province: "Kocaeli",
          district: "Dilovası",
          workLocationType: "Beldeport",
          companyOrFactoryName: `Beldeport Lojistik ${stamp} A.Ş.`,
          workDate: "2026-12-12",
          description: "Dilovası OSB bölgesinde Beldeport tesisinde depo personeli ihtiyacı, konum filtresi testi.",
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
    { zeynepId, mehmetId, jobAId: JOB_A_ID, jobBId: JOB_B_ID, jobCId: JOB_C_ID, jobDId: JOB_D_ID, stamp: STAMP },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: 4 test ilanı (A: İzmir/teklifsiz, B: Kocaeli/Gebze/forklift, C: İstanbul/başka sağlayıcıya kabul edilmiş, D: Kocaeli/Dilovası/Beldeport) ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await loginAs(page, MEHMET, "/panel");
    const mehmetId = await getUserId(page, MEHMET.email);
    await seedScenario(page, { zeynepId, mehmetId });
    check("[kurulum] 4 test ilanı + C için kabul edilmiş teklif oluşturuldu", true);
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
    check(
      "[arama] 'izmir' araması B/C/D ilanlarını GETİRMİYOR",
      !bodyText.includes("REDESIGN-B-ACIL") && !bodyText.includes("REDESIGN-C-VINC") && !bodyText.includes("REDESIGN-D-DILOVASI"),
    );
    await page.getByLabel("İlanlarda ara").fill("");
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 4: Hizmet Türü filtresi — merkezi katalogdan gelir (0 ilanlı kategori de görünür) ===");
    await page.getByRole("button", { name: "Hizmet Türü", exact: true }).click();
    const categoryList = page.locator('ul[aria-label="Hizmet Türü"]');
    await categoryList.waitFor({ state: "visible" });
    check(
      "[hizmet-türü] Hiç ilanı olmayan 'Sayım Hizmeti' kategorisi de listede (job-data değil katalog kaynaklı kanıtı)",
      await categoryList.getByRole("option", { name: "Sayım Hizmeti", exact: true }).isVisible().catch(() => false),
    );
    await categoryList.getByRole("option", { name: "Forklift", exact: true }).click();
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check("[hizmet-türü] Yalnızca Forklift kategorisindeki B ilanı görünüyor", bodyText.includes("REDESIGN-B-ACIL"));
    check(
      "[hizmet-türü] Depo Personeli kategorisindeki A/D ilanları GÖRÜNMÜYOR",
      !bodyText.includes("REDESIGN-A-DEPO") && !bodyText.includes("REDESIGN-D-DILOVASI"),
    );
    await page.getByText("Filtreleri Temizle").click();
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 5: Konum kaskadı — İl -> İlçe -> Bölge/Tesis (ID tabanlı, kademeli) ===");
    const districtButton = page.getByRole("button", { name: "İlçe", exact: true });
    const facilityButton = page.getByRole("button", { name: "Bölge / Tesis", exact: true });
    check("[kaskad] İl seçilmeden İlçe pasif", await districtButton.isDisabled());
    check("[kaskad] İl seçilmeden Bölge/Tesis pasif", await facilityButton.isDisabled());

    await selectSearchable(page, "İl", "Kocaeli");
    check("[kaskad] Kocaeli seçilince İlçe aktifleşiyor", !(await districtButton.isDisabled()));

    await districtButton.click();
    const districtList = page.locator('ul[aria-label="İlçe"]');
    await districtList.waitFor({ state: "visible" });
    let districtListText = await districtList.innerText();
    check("[kaskad] İlçe listesinde Gebze var", districtListText.includes("Gebze"));
    check("[kaskad] İlçe listesinde Dilovası var", districtListText.includes("Dilovası"));
    check(
      "[kaskad] İlçe listesinde başka illerin ilçeleri (Aliağa/Tuzla) YOK",
      !districtListText.includes("Aliağa") && !districtListText.includes("Tuzla"),
    );
    await districtList.getByRole("option", { name: "Dilovası", exact: true }).click();
    await page.waitForTimeout(200);
    check("[kaskad] Dilovası seçilince Bölge/Tesis aktifleşiyor", !(await facilityButton.isDisabled()));

    await facilityButton.click();
    const facilityList = page.locator('ul[aria-label="Bölge / Tesis"]');
    await facilityList.waitFor({ state: "visible" });
    const facilityListText = await facilityList.innerText();
    check(
      "[kaskad] Bölge/Tesis listesinde Dilovası'nın gerçek tesisleri var (Beldeport, Yılport Gebze)",
      facilityListText.includes("Beldeport") && facilityListText.includes("Yılport Gebze"),
    );
    check(
      "[kaskad] Bölge/Tesis listesinde başka ilçenin tesisi (Körfez'deki DP World Evyap Körfez) YOK",
      !facilityListText.includes("Evyap Körfez"),
    );
    await facilityList.getByRole("option", { name: "Beldeport", exact: true }).click();
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check("[kaskad] Beldeport seçilince yalnızca D ilanı görünüyor", bodyText.includes("REDESIGN-D-DILOVASI"));
    check(
      "[kaskad] A/B/C ilanları görünmüyor",
      !bodyText.includes("REDESIGN-A-DEPO") && !bodyText.includes("REDESIGN-B-ACIL") && !bodyText.includes("REDESIGN-C-VINC"),
    );

    console.log("\n=== Senaryo 6: İl değişince eski İlçe/Bölge seçimi temizlenir ===");
    await selectSearchable(page, "İl", "İstanbul");
    await page.waitForTimeout(300);
    check(
      "[kaskad-reset] İlçe seçimi 'Tümü'ne döndü (buton eski 'Dilovası' metnini göstermiyor)",
      !(await districtButton.innerText()).includes("Dilovası"),
    );
    check(
      "[kaskad-reset] Bölge/Tesis seçimi 'Tümü'ne döndü ve tekrar pasif",
      (await facilityButton.isDisabled()) && !(await facilityButton.innerText()).includes("Beldeport"),
    );
    bodyText = await page.locator("main").innerText();
    check("[kaskad-reset] C ilanı (İstanbul) tekrar görünüyor", bodyText.includes("REDESIGN-C-VINC"));
    await page.getByText("Filtreleri Temizle").click();
    await page.waitForTimeout(300);

    console.log("\n=== Senaryo 7: Şehir + İlçe + Hizmet Türü AND mantığı ===");
    await selectSearchable(page, "İl", "Kocaeli");
    await selectSearchable(page, "İlçe", "Dilovası");
    await selectSearchable(page, "Hizmet Türü", "Forklift");
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check(
      "[AND] Kocaeli + Dilovası + Forklift kombinasyonu HİÇBİR ilan getirmiyor (D Dilovası'da ama Depo Personeli, Forklift değil)",
      !bodyText.includes("REDESIGN-D-DILOVASI") && !bodyText.includes("REDESIGN-B-ACIL"),
    );
    await selectSearchable(page, "Hizmet Türü", "Depo Personeli");
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check(
      "[AND] Kocaeli + Dilovası + Depo Personeli yalnızca D ilanını getiriyor",
      bodyText.includes("REDESIGN-D-DILOVASI") && !bodyText.includes("REDESIGN-B-ACIL"),
    );
    await page.getByText("Filtreleri Temizle").click();
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check(
      "[AND] Filtreleri Temizle sonrası tüm test ilanları geri geldi",
      bodyText.includes("REDESIGN-A-DEPO") &&
        bodyText.includes("REDESIGN-B-ACIL") &&
        bodyText.includes("REDESIGN-C-VINC") &&
        bodyText.includes("REDESIGN-D-DILOVASI"),
    );

    console.log("\n=== Senaryo 7b: Firma / Fabrika araması (job.companyOrFactoryName üzerinde) ===");
    await page.getByLabel("Firma / Fabrika Ara").fill(`Beldeport Lojistik ${STAMP}`);
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check(
      "[firma-arama] Sorgu yalnızca companyOrFactoryName'i eşleşen D ilanını getiriyor",
      bodyText.includes("REDESIGN-D-DILOVASI") &&
        !bodyText.includes("REDESIGN-A-DEPO") &&
        !bodyText.includes("REDESIGN-B-ACIL") &&
        !bodyText.includes("REDESIGN-C-VINC"),
    );
    await page.getByLabel("Firma / Fabrika Ara").fill("");
    await page.waitForTimeout(300);
    bodyText = await page.locator("main").innerText();
    check(
      "[firma-arama] Sorgu temizlenince companyOrFactoryName'i OLMAYAN eski ilanlar (A/B/C) hatasız tekrar görünüyor",
      bodyText.includes("REDESIGN-A-DEPO") && bodyText.includes("REDESIGN-B-ACIL") && bodyText.includes("REDESIGN-C-VINC"),
    );

    console.log("\n=== Senaryo 8: Son Görüntülenenler ===");
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

    console.log("\n=== Senaryo 9: Kaldırılan sistemler — Favoriler ve Rozetler hiçbir yerde yok ===");
    check(
      "[kaldırıldı] Hiçbir 'Favori...' butonu yok (masaüstü/mobil ortak DOM, yalnızca biri mount)",
      (await page.getByRole("button", { name: /Favori/i }).count()) === 0,
    );
    check(
      "[kaldırıldı] 'Yalnızca Favorilerim' filtre butonu yok",
      (await page.getByRole("button", { name: "Yalnızca Favorilerim" }).count()) === 0,
    );
    check(
      "[kaldırıldı] 'Rozetlere göre' filtre dropdown'u yok",
      (await page.getByRole("button", { name: "Rozetlere göre" }).count()) === 0,
    );
    check("[kaldırıldı] 'Rozetler' tablo sütunu/etiketi yok", !(await page.locator("main").innerText()).includes("Rozetler"));
    check(
      "[kaldırıldı] Rozet-özel metinler ('Teklif Bekliyor'/'Yoğun İlgi') yok",
      !(await page.locator("main").innerText()).includes("Teklif Bekliyor") &&
        !(await page.locator("main").innerText()).includes("Yoğun İlgi"),
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
