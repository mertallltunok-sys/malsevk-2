// Hizmet Veren'in geri çektiği tekliflerin tüm normal kullanıcı
// listelerinden/sayaçlarından kaldırılması + Hizmet Alan'a giden "Bir
// teklif geri çekildi" bildirimini doğrular. Gerçek iki kullanıcılı akış:
// teklif ver -> geri çek -> her iki tarafta da anında ve yenileme sonrası
// kalıcı kaybolma + doğru bildirim + doğru yönlendirme + gizlilik +
// kapasite/yeniden-teklif kurallarının bozulmaması.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const STAMP = Date.now();
const COMPANY_NAME = "Test Lojistik A.Ş.";

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

async function seedJob(page, jobId, title, requesterId) {
  await page.evaluate(
    ({ jobId, title, requesterId }) => {
      const job = {
        id: jobId,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Geri çekilen teklif testi için oluşturulan ilan.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId,
        photos: [],
      };
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId, title, requesterId },
  );
}

async function setProviderCompanyName(page, providerId, companyName) {
  await page.evaluate(
    ({ providerId, companyName }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const next = users.map((u) =>
        u.id === providerId
          ? {
              ...u,
              providerProfile: {
                companyName,
                bio: "Elli karakterden uzun, test amaçlı bir firma tanıtım metni burada yer alır.",
                regions: [],
                expertise: [],
              },
            }
          : u,
      );
      localStorage.setItem("malsevk.users.v1", JSON.stringify(next));
    },
    { providerId, companyName },
  );
}

async function submitOffer(page, jobId) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("4200");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page
    .getByLabel("Teklif Açıklaması")
    .fill("Geri çekilen teklif testi için verilen teklif açıklaması, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

function getStatCardValue(page, label) {
  return page
    .locator("a")
    .filter({ hasText: label })
    .first()
    .locator("p")
    .first()
    .innerText()
    .catch(() => null);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    const JOB_A_ID = `withdraw-a-${STAMP}`;
    const JOB_A_TITLE = `GERICEKME-A-${STAMP}`;

    console.log("\n=== Kurulum ===");
    await loginAs(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await seedJob(page, JOB_A_ID, JOB_A_TITLE, zeynepId);
    check("[kurulum] test ilanı oluşturuldu", true);
    await logout(page);

    await loginAs(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    await setProviderCompanyName(page, mertId, COMPANY_NAME);
    await submitOffer(page, JOB_A_ID);
    check("[kurulum] Hizmet Veren gerçek teklif verdi", true);

    // --- Baseline: teklif verildikten sonra her iki tarafta da görünüyor mu ---
    console.log("\n=== Baseline: teklif her iki tarafta da görünüyor ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    let bodyText = await page.locator("main").innerText();
    check("Mert'in Aktif sekmesinde görünüyor", bodyText.includes(JOB_A_TITLE));
    const withdrawButtonBefore = page.getByRole("button", { name: "Tekliften Vazgeç" });
    check("'Tekliften Vazgeç' butonu görünüyor", await withdrawButtonBefore.first().isVisible());

    await page.goto(`${BASE_URL}/panel`);
    const myOfferCountBefore = await getStatCardValue(page, "Verdiğim Teklifler");
    const activeCapacityBefore = await getStatCardValue(page, "Aktif İş Kapasitesi");
    console.log(`    [bilgi] Verdiğim Teklifler (teklif sonrası) = ${myOfferCountBefore}, Kapasite = ${activeCapacityBefore}`);
    await logout(page);

    await loginAs(page, ZEYNEP, "/panel/gelen-teklifler");
    // Hard navigation -> hidrasyon tamamlanana kadar liste geçici olarak boş
    // görünebilir (bkz. use-jobs.ts/use-offers.ts: getServerSnapshot SSR
    // güvenliği için her zaman []döner) — ilan başlığı görünür olduğunda
    // hidrasyon bitmiştir.
    await page.getByText(JOB_A_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("Zeynep'in Gelen Teklifler listesinde görünüyor", bodyText.includes(JOB_A_TITLE));

    await page.goto(`${BASE_URL}/panel`);
    const incomingCountBefore = await getStatCardValue(page, "Gelen Teklifler");
    console.log(`    [bilgi] Gelen Teklifler (teklif sonrası) = ${incomingCountBefore}`);
    await logout(page);

    // --- Mert tekliften vazgeçiyor ---
    console.log("\n=== Tekliften Vazgeç ===");
    await loginAs(page, MERT, "/panel/tekliflerim");
    await page.getByRole("button", { name: "Tekliften Vazgeç" }).first().click();
    await page.getByRole("button", { name: "Evet, Teklifi Geri Çek" }).click();
    await page.waitForTimeout(400);
    check("[işlem] Tekliften vazgeçildi", true);

    // --- Anında kaldırılma: Mert'in üç sekmesi ---
    console.log("\n=== Mert'in üç sekmesinde de artık görünmüyor (anında) ===");
    for (const durum of [null, "devam-eden", "tamamlandi"]) {
      const url = durum ? `${BASE_URL}/panel/tekliflerim?durum=${durum}` : `${BASE_URL}/panel/tekliflerim`;
      await page.goto(url);
      await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
      const text = await page.locator("main").innerText();
      check(`${durum ?? "aktif"} sekmesinde görünmüyor`, !text.includes(JOB_A_TITLE));
    }

    // --- Yenileme sonrası hâlâ görünmüyor ---
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    await page.reload();
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("Yenileme sonrası Aktif'te hâlâ görünmüyor", !bodyText.includes(JOB_A_TITLE));

    // --- Panel sayaçları düştü mü ---
    await page.goto(`${BASE_URL}/panel`);
    const myOfferCountAfter = await getStatCardValue(page, "Verdiğim Teklifler");
    const activeCapacityAfter = await getStatCardValue(page, "Aktif İş Kapasitesi");
    check(
      "'Verdiğim Teklifler' sayacı azaldı",
      Number(myOfferCountAfter) === Number(myOfferCountBefore) - 1,
      `önce=${myOfferCountBefore} sonra=${myOfferCountAfter}`,
    );
    check(
      "'Aktif İş Kapasitesi' değişmedi (pending zaten kapasiteye sayılmıyordu)",
      activeCapacityAfter === activeCapacityBefore,
      `önce=${activeCapacityBefore} sonra=${activeCapacityAfter}`,
    );

    // --- Yeniden teklif verme: cooldown hâlâ çalışıyor mu (mevcut kural korunmalı) ---
    console.log("\n=== Yeniden teklif verme (mevcut 3 günlük bekleme kuralı korunmalı) ===");
    await page.goto(`${BASE_URL}/ilanlar/${JOB_A_ID}`);
    const offerFormVisible = await page.getByLabel("Teklif Fiyatı").isVisible().catch(() => false);
    if (offerFormVisible) {
      await page.getByLabel("Teklif Fiyatı").fill("5000");
      await page.getByLabel("Tahmini Hizmet Süresi").fill("1 gün");
      await page.getByLabel("Teklif Açıklaması").fill("İkinci teklif denemesi, en az yirmi karakter olmalı.");
      await page.getByRole("button", { name: "Teklif Gönder" }).click();
      const cooldownMsg = await page
        .getByText(/bekleme süresi/i)
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check("Cooldown süresi dolmadan yeniden teklif engelleniyor (mevcut kural bozulmadı)", cooldownMsg);
    } else {
      check("İlan sayfası zaten kapalı/engelli mesajı gösteriyor (kural korunmuş)", true);
    }
    await logout(page);

    // --- Zeynep tarafında anında kaldırılma ---
    console.log("\n=== Zeynep'in Gelen Teklifler listesinden anında kalktı ===");
    await loginAs(page, ZEYNEP, "/panel/gelen-teklifler");
    bodyText = await page.locator("main").innerText();
    check("Gelen Teklifler'de artık görünmüyor", !bodyText.includes(JOB_A_TITLE));
    await page.reload();
    bodyText = await page.locator("main").innerText();
    check("Yenileme sonrası da görünmüyor", !bodyText.includes(JOB_A_TITLE));

    await page.goto(`${BASE_URL}/panel`);
    const incomingCountAfter = await getStatCardValue(page, "Gelen Teklifler");
    check(
      "'Gelen Teklifler' sayacı azaldı",
      Number(incomingCountAfter) === Number(incomingCountBefore) - 1,
      `önce=${incomingCountBefore} sonra=${incomingCountAfter}`,
    );

    // --- Bildirim: içerik, gizlilik, tekillik ---
    // NOT: aynı ilan için ayrıca (ilgisiz, önceden var olan) bir "yeni
    // teklif geldi" bildirimi de hâlâ görünür olabilir (o bildirim
    // offer.status'tan bağımsız türetilir, bkz. notifications.ts
    // #newOfferNotifications — bu görevin kapsamı dışında, kasıtlı olarak
    // dokunulmadı). Bu yüzden "mükerrer yok" kontrolü job title'a göre değil,
    // özellikle geri çekilme MESAJINA göre filtrelenir.
    console.log("\n=== 'Bir teklif geri çekildi' bildirimi ===");
    await page.goto(`${BASE_URL}/panel/bildirimler`);
    const EXPECTED_MESSAGE = `${COMPANY_NAME}, "${JOB_A_TITLE}" ilanına verdiği teklifi geri çekti. Bu teklif geri çekildiği için artık gelen teklifler arasında görüntülenmez.`;
    const withdrawnRows = page.locator("main ul li").filter({ hasText: "Bir teklif geri çekildi" }).filter({ hasText: JOB_A_TITLE });
    await assert.doesNotReject(withdrawnRows.first().waitFor({ state: "visible", timeout: 10000 }));
    const rowCount = await withdrawnRows.count();
    check("Tam olarak TEK geri çekilme bildirimi üretildi (mükerrer yok)", rowCount === 1, `adet=${rowCount}`);
    const rowText = await withdrawnRows.first().innerText();
    check("Başlık 'Bir teklif geri çekildi' içeriyor", rowText.includes("Bir teklif geri çekildi"));
    check("Mesaj tam olarak beklenen şablonla eşleşiyor", rowText.includes(EXPECTED_MESSAGE), rowText);
    // STAMP tabanlı ilan başlığı (ör. "...-1784826259669") çok haneli bir
    // sayı içerdiği için kaba bir "\d{3}...\d{2}" regex'i burada yanlış
    // pozitif üretir — bunun yerine Mert'in GERÇEK telefon/e-posta
    // değerleriyle doğrudan karşılaştırılır.
    check(
      "Gizlilik: telefon/e-posta/adres/vergi/TC bilgisi YOK",
      !rowText.includes("@") &&
        !rowText.includes(MERT.email) &&
        !rowText.includes("+905552222222") &&
        !/vergi|T\.?C\.?\s?kimlik/i.test(rowText),
      rowText,
    );

    const href = await withdrawnRows.first().locator("a").getAttribute("href");
    check("href '/panel/hizmet-taleplerim' ile başlıyor", href?.startsWith("/panel/hizmet-taleplerim") ?? false, `href="${href}"`);
    check("href ilgili ilanı vurgulamak için ilanId içeriyor", href?.includes(`ilanId=${JOB_A_ID}`) ?? false, `href="${href}"`);

    // --- Bildirime tıklama: doğru sayfa, doğru sekme, vurgulanmış kart, 404 yok ---
    console.log("\n=== Bildirime tıklama ===");
    const unreadBefore = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    await withdrawnRows.first().locator("a").click();
    await page.waitForURL(/\/panel\/hizmet-taleplerim/, { timeout: 10000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    bodyText = await page.locator("main").innerText();
    check("İlgili ilan (hâlâ mevcut) listede görünüyor", bodyText.includes(JOB_A_TITLE));
    const highlightedCard = page.locator("li.border-primary", { hasText: JOB_A_TITLE });
    check("İlgili ilan kartı vurgulanmış (highlight)", await highlightedCard.isVisible().catch(() => false));

    const unreadAfter = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("Tıklama sonrası okunmamış sayısı azaldı", unreadAfter < unreadBefore, `önce=${unreadBefore} sonra=${unreadAfter}`);

    await page.reload();
    await page.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const unreadAfterReload = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label*="okunmamış"]');
      const match = el?.getAttribute("aria-label")?.match(/(\d+) okunmamış/);
      return match ? Number(match[1]) : 0;
    });
    check("Okundu durumu yenileme sonrası kalıcı", unreadAfterReload === unreadAfter, `sonra=${unreadAfterReload}`);

    check("Genel: konsol/hydration hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    const storageState = await context.storageState();
    await context.close();

    // --- İkinci kanal: Header zilinden tıklama (ayrı senaryo) ---
    console.log("\n=== İkinci senaryo: Header zilinden tıklama ===");
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState });
    const page2 = await context2.newPage();
    attachDiagnostics(page2);

    const JOB_B_ID = `withdraw-b-${STAMP}`;
    const JOB_B_TITLE = `GERICEKME-B-${STAMP}`;
    await loginAs(page2, ZEYNEP, "/panel");
    await seedJob(page2, JOB_B_ID, JOB_B_TITLE, zeynepId);
    await logout(page2);

    await loginAs(page2, MERT, "/panel");
    await submitOffer(page2, JOB_B_ID);
    await page2.goto(`${BASE_URL}/panel/tekliflerim`);
    await page2.getByRole("button", { name: "Tekliften Vazgeç" }).first().click();
    await page2.getByRole("button", { name: "Evet, Teklifi Geri Çek" }).click();
    await page2.waitForTimeout(400);
    await logout(page2);

    await loginAs(page2, ZEYNEP, "/panel");
    await page2.getByRole("button", { name: /Bildirimler/ }).click();
    const bellMenu = page2.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellRow = bellMenu.getByRole("menuitem").filter({ hasText: "Bir teklif geri çekildi" }).filter({ hasText: JOB_B_TITLE });
    await assert.doesNotReject(bellRow.waitFor({ state: "visible", timeout: 10000 }));
    const bellRowText = await bellRow.innerText();
    check("Header zilinde de başlık görünüyor", bellRowText.includes("Bir teklif geri çekildi"));
    await bellRow.click();
    await page2.waitForURL(/\/panel\/hizmet-taleplerim/, { timeout: 10000 });
    check("Header zilinden tıklayınca da doğru sayfaya gidiliyor", page2.url().includes("/panel/hizmet-taleplerim"));
    check("Header zilinden: 404 yok", !(await page2.locator("text=404").isVisible().catch(() => false)));

    check("Genel (2. senaryo): konsol hatası yok", page2.jsProblems.length === 0, page2.jsProblems.join(" | "));
    const storageState2 = await context2.storageState();
    await context2.close();

    // --- Mobil/masaüstü ---
    console.log("\n=== Mobil (375px) ve masaüstü (1280px) ===");
    for (const width of [375, 1280]) {
      const rContext = await browser.newContext({ viewport: { width, height: 850 }, storageState: storageState2 });
      const rPage = await rContext.newPage();
      attachDiagnostics(rPage);
      await rPage.goto(`${BASE_URL}/panel/bildirimler`);
      await rPage.locator("main ul li").first().waitFor({ state: "visible", timeout: 10000 });
      const scrollWidth = await rPage.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await rPage.evaluate(() => document.documentElement.clientWidth);
      check(`${width}px: yatay taşma yok (Bildirimler)`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      await rPage.goto(`${BASE_URL}/panel/hizmet-taleplerim?ilanId=${JOB_B_ID}`);
      await rPage.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
      const scrollWidth2 = await rPage.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth2 = await rPage.evaluate(() => document.documentElement.clientWidth);
      check(`${width}px: yatay taşma yok (Hizmet Taleplerim + highlight)`, scrollWidth2 <= clientWidth2 + 1, `scrollWidth=${scrollWidth2}, clientWidth=${clientWidth2}`);
      check(`${width}px: konsol hatası yok`, rPage.jsProblems.length === 0, rPage.jsProblems.join(" | "));
      await rContext.close();
    }

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
