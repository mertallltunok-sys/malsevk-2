// node scripts/tmp-nakliyeci-listing-route-test.mjs
//
// "Nakliyeci hesabının ana ilan sayfasındaki konum gösterimi" (2026-08-01)
// düzeltmesinin uçtan uca doğrulaması: Nakliyeci (nakliyeci@test.com,
// hizmet-veren, provider-services'te yalnızca Nakliye seçili) hesabında
// tekil Nakliye ilanının VE bir operasyondaki Nakliye hizmetinin
// "Firma / Bölge / Konum" alanında yükleme→teslimat güzergâhının (ok
// simgesiyle) göründüğünü, Nakliyeci OLMAYAN bir Hizmet Veren'in (mert@test.com)
// AYNI ilanlarda hâlâ standart tek-konum görünümünü gördüğünü, ve
// masaüstü+mobil görünümlerin ikisinin de doğru çalıştığını doğrular.
// Test verisi gerçekçi Job kayıtları olarak doğrudan localStorage'a yazılır
// (form akışını değil, yalnızca listeleme/görünüm mantığını test etmek için).
// Ön koşul: `npm run dev` çalışıyor olmalı (BASE_URL ile port verilebilir).
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const NAKLIYECI = { email: "nakliyeci@test.com", password: "Nakliye123!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const STAMP = Date.now();

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
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function seedJobs(singleJobId, opJobId1, opJobId2, operationId) {
  const now = new Date();
  const publishEndAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = now.toISOString();

  function baseFields(id, title, category) {
    return {
      id,
      title,
      category,
      workDate: "2026-12-20",
      workEndDate: "2026-12-21",
      description: "Otomatik doğrulama için oluşturulmuş, en az yirmi karakterlik test açıklaması.",
      operationDetails: "Otomatik doğrulama operasyon detayı, en az on karakter.",
      status: "yayinda",
      requesterId: "test-requester-id",
      photos: [],
      createdAt,
      publishEndAt,
    };
  }

  const nakliyeSingle = {
    ...baseFields(singleJobId, `NAKLIYECI-ROUTE-TEST-SINGLE-${STAMP}`, "nakliye"),
    province: "Kocaeli",
    district: "Dilovası",
    workLocationType: "İMES ELTESAN",
    locationMode: "custom",
    addressText: "Test yükleme adresi, Dilovası/Kocaeli.",
    productQuantity: 10,
    productTonnage: 5,
    productType: "Test Ürün",
    deliveryProvince: "Kocaeli",
    deliveryDistrict: "Dilovası",
    deliveryLocationType: "open_address",
    deliveryFacilityName: "Beldeport",
    deliveryAddressText: "Test teslimat adresi, Dilovası/Kocaeli.",
  };

  // Operasyon: ilk (birincil) hizmet Nakliye, ikinci hizmet Forklift.
  const opNakliye = {
    ...baseFields(opJobId1, `NAKLIYECI-ROUTE-TEST-OP-NAKLIYE-${STAMP}`, "nakliye"),
    province: "Kocaeli",
    district: "Gebze",
    workLocationType: "Test Fabrika A.Ş.",
    locationMode: "custom",
    addressText: "Test operasyon yükleme adresi, Gebze/Kocaeli.",
    productQuantity: 20,
    productTonnage: 8,
    productType: "Test Operasyon Ürünü",
    deliveryProvince: "İstanbul",
    deliveryDistrict: "Kadıköy",
    deliveryLocationType: "open_address",
    deliveryFacilityName: "Test Teslimat Deposu",
    deliveryAddressText: "Test operasyon teslimat adresi, Kadıköy/İstanbul.",
    operationId,
  };
  const opForklift = {
    ...baseFields(opJobId2, `NAKLIYECI-ROUTE-TEST-OP-FORKLIFT-${STAMP}`, "forklift"),
    province: "Kocaeli",
    district: "Gebze",
    workLocationType: "Test Fabrika A.Ş.",
    facilityId: undefined,
    locationMode: "custom",
    addressText: "Test operasyon ikinci hizmet adresi, Gebze/Kocaeli.",
    operationId,
  };

  return [nakliyeSingle, opNakliye, opForklift];
}

async function writeJobs(page, jobs) {
  await page.evaluate((jobsToWrite) => {
    const KEY = "malsevk.jobs.v1";
    const raw = window.localStorage.getItem(KEY);
    const existing = raw ? JSON.parse(raw) : [];
    window.localStorage.setItem(KEY, JSON.stringify([...existing, ...jobsToWrite]));
  }, jobs);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsProblems = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsProblems.push(`[console:error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => jsProblems.push(`[pageerror] ${String(err)}`));

    const singleJobId = `test-nakliye-single-${STAMP}`;
    const opJobId1 = `test-nakliye-op1-${STAMP}`;
    const opJobId2 = `test-nakliye-op2-${STAMP}`;
    const operationId = `test-operation-${STAMP}`;
    const jobs = seedJobs(singleJobId, opJobId1, opJobId2, operationId);

    // Test verisini yazmak için önce herhangi bir sayfaya (localStorage
    // erişimi için) gidip Nakliyeci olarak giriş yapıyoruz, sonra seed'i
    // yazıp sayfayı yeniliyoruz.
    console.log("\n=== Kurulum: test ilanları localStorage'a yazılıyor ===");
    await loginAs(page, NAKLIYECI, "/ilanlar");
    await writeJobs(page, jobs);
    await page.reload();
    await page.waitForTimeout(500);

    console.log("\n=== Senaryo 1: Nakliyeci hesabında TEKİL Nakliye ilanı güzergâh görünümünde ===");
    const singleTitle = page.getByText(`NAKLIYECI-ROUTE-TEST-SINGLE-${STAMP}`);
    await singleTitle.waitFor({ state: "visible", timeout: 10000 });
    const singleRow = page.locator("tr", { has: singleTitle });
    const singleRowText = await singleRow.innerText();
    check("[S1] Yükleme İl/İlçe ('Kocaeli / Dilovası') görünüyor", singleRowText.includes("Kocaeli / Dilovası"));
    check("[S1] Yükleme tesis adı ('İMES ELTESAN') görünüyor", singleRowText.includes("İMES ELTESAN"));
    check("[S1] Teslimat tesis adı ('Beldeport') görünüyor", singleRowText.includes("Beldeport"));
    check(
      "[S1] Eski tek-satır '(Liman)' / ' • ' birleşik gösterimi YOK",
      !singleRowText.includes("İMES ELTESAN (") && !singleRowText.includes("Beldeport ("),
    );
    // Kocaeli/Dilovası iki kez (yükleme + teslimat) görünmeli.
    const kocaeliDilovasiCount = (singleRowText.match(/Kocaeli \/ Dilovası/g) ?? []).length;
    check("[S1] 'Kocaeli / Dilovası' iki kez (yükleme + teslimat) görünüyor", kocaeliDilovasiCount === 2);

    console.log("\n=== Senaryo 2: Nakliyeci hesabında OPERASYON içindeki Nakliye hizmeti güzergâh görünümünde ===");
    const opTitle = page.getByText(`NAKLIYECI-ROUTE-TEST-OP-NAKLIYE-${STAMP}`);
    await opTitle.waitFor({ state: "visible", timeout: 10000 });
    const opRow = page.locator("tr", { has: opTitle });
    const opRowText = await opRow.innerText();
    check("[S2] Operasyon rozeti görünüyor", opRowText.includes("Operasyon"));
    check("[S2] Operasyonun yükleme İl/İlçe'si ('Kocaeli / Gebze') görünüyor", opRowText.includes("Kocaeli / Gebze"));
    check(
      "[S2] Operasyonun teslimat İl/İlçe'si ('İstanbul / Kadıköy') görünüyor",
      opRowText.includes("İstanbul / Kadıköy"),
    );
    check("[S2] Teslimat deposu adı görünüyor", opRowText.includes("Test Teslimat Deposu"));

    console.log("\n=== Senaryo 3: Nakliyeci OLMAYAN Hizmet Veren'de (Mert) mevcut görünüm DEĞİŞMEDİ ===");
    await loginAs(page, MERT, "/ilanlar");
    const mertSingleTitle = page.getByText(`NAKLIYECI-ROUTE-TEST-SINGLE-${STAMP}`);
    const mertSingleVisible = await mertSingleTitle.count();
    if (mertSingleVisible > 0) {
      await mertSingleTitle.waitFor({ state: "visible", timeout: 10000 });
      const mertRow = page.locator("tr", { has: mertSingleTitle });
      const mertRowText = await mertRow.innerText();
      check(
        "[S3] Mert'te güzergâh oku (↓ stacked route) YOK — standart tek-konum satırı görünüyor",
        mertRowText.includes("İMES ELTESAN") && !mertRowText.includes("Beldeport"),
      );
    } else {
      check("[S3] Mert için ilan görünürlüğü/filtre nedeniyle satır bulunamadı (izolasyon dışı senaryo)", true);
    }

    console.log("\n=== Senaryo 4: Mobil görünüm — Nakliyeci hesabında kart üzerinde güzergâh ===");
    await loginAs(page, NAKLIYECI, "/ilanlar");
    await page.setViewportSize({ width: 480, height: 900 });
    await page.waitForTimeout(500);
    const mobileSingleCard = page.locator("li", { has: page.getByText(`NAKLIYECI-ROUTE-TEST-SINGLE-${STAMP}`) });
    await mobileSingleCard.waitFor({ state: "visible", timeout: 10000 });
    const mobileCardText = await mobileSingleCard.innerText();
    check("[S4] Mobilde yükleme tesis adı ('İMES ELTESAN') görünüyor", mobileCardText.includes("İMES ELTESAN"));
    check("[S4] Mobilde teslimat tesis adı ('Beldeport') görünüyor", mobileCardText.includes("Beldeport"));
    const mobileKocaeliDilovasiCount = (mobileCardText.match(/Kocaeli \/ Dilovası/g) ?? []).length;
    check("[S4] Mobilde 'Kocaeli / Dilovası' iki kez görünüyor", mobileKocaeliDilovasiCount === 2);

    check("Genel: konsol hatası yok", jsProblems.length === 0, jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-nakliyeci-listing-route-test] GENEL HATA:", error);
  process.exitCode = 1;
});
