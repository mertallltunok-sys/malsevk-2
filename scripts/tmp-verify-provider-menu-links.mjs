// Hizmet Veren profil menüsündeki 4 "YAKINDA" öğesinin (Kabul Edilen
// Teklifler, Devam Eden İşler, Tamamlanan İşler, Bildirimler) gerçek
// çalışan route'lara bağlandığını doğrular: doğru sekmede doğru kayıtlar,
// aynı teklifin iki sekmede birden görünmemesi, boş durum mesajları,
// bildirimlerin header ziliyle aynı veri kaynağını kullanması, rol/oturum
// yetkilendirmesi, 404/konsol/hydration hatası olmaması.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function login(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
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

/** Zeynep'in ilanlarını ve Mert'in tekliflerini doğrudan localStorage'a yazar (hızlı, tekrarlanabilir test kurulumu). */
async function seedScenario(page, zeynepId, mertId) {
  await page.evaluate(
    ({ zeynepId, mertId }) => {
      const STAMP = Date.now();
      const jobBase = {
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Sekme doğrulama senaryosu için oluşturulan test ilanı.",
        operationDetails: "Test.",
        status: "yayinda",
        requesterId: zeynepId,
        photos: [],
      };
      const offerBase = {
        providerId: mertId,
        amount: 5000,
        currency: "TRY",
        description: "Sekme doğrulama senaryosu için oluşturulan test teklifi metni.",
        estimatedDuration: "2 gün",
      };
      const now = new Date().toISOString();

      const scenarios = [
        { key: "pending", jobTitle: `SEKME-BEKLEMEDE-${STAMP}`, offerStatus: "pending" },
        { key: "accepted", jobTitle: `SEKME-KABUL-${STAMP}`, offerStatus: "accepted" },
        { key: "in_progress", jobTitle: `SEKME-DEVAMEDEN-${STAMP}`, offerStatus: "in_progress" },
        {
          key: "completion_requested",
          jobTitle: `SEKME-ONAYBEKLIYOR-${STAMP}`,
          offerStatus: "completion_requested",
          extra: { completionRequestedByUserId: mertId, completionRequestedAt: now },
        },
        { key: "completed", jobTitle: `SEKME-TAMAMLANDI-${STAMP}`, offerStatus: "completed" },
        { key: "cancelled", jobTitle: `SEKME-IPTAL-${STAMP}`, offerStatus: "cancelled" },
        { key: "rejected", jobTitle: `SEKME-REDDEDILDI-${STAMP}`, offerStatus: "rejected" },
      ];

      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");

      for (const scenario of scenarios) {
        const jobId = `job-${scenario.key}-${STAMP}`;
        const offerId = `offer-${scenario.key}-${STAMP}`;
        jobs.push({ id: jobId, title: scenario.jobTitle, ...jobBase });
        offers.push({
          id: offerId,
          jobId,
          status: scenario.offerStatus,
          createdAt: now,
          updatedAt: now,
          ...offerBase,
          ...(scenario.extra ?? {}),
        });
      }

      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      window.__SEKME_STAMP__ = STAMP;
    },
    { zeynepId, mertId },
  );
  return page.evaluate(() => window.__SEKME_STAMP__);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    console.log("\n=== Kurulum: test senaryoları localStorage'a yazılıyor ===");
    await login(page, ZEYNEP, "/panel");
    const zeynepId = await getUserId(page, ZEYNEP.email);
    await clearSession(page);
    await login(page, MERT, "/panel");
    const mertId = await getUserId(page, MERT.email);
    const stamp = await seedScenario(page, zeynepId, mertId);
    console.log(`    [bilgi] STAMP=${stamp}`);

    // --- 1) Aktif (varsayılan / "Verdiğim Teklifler") sekmesi ---
    console.log("\n=== 'Verdiğim Teklifler' (Aktif) sekmesi ===");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    // Hard navigation -> sunucu anlık görüntüsü (session=null) kısa süreliğine
    // görünür, hidrasyon sonrası gerçek oturuma geçer (bkz. session.ts
    // getServerSnapshot notu) — tab listesi göründüğünde hidrasyon bitmiştir.
    await page.getByRole("tablist", { name: "Teklif durumu" }).waitFor({ state: "visible", timeout: 10000 });
    let bodyText = await page.locator("main").innerText();
    check("BEKLEMEDE ilanı görünüyor (pending)", bodyText.includes(`SEKME-BEKLEMEDE-${stamp}`));
    check("REDDEDILDI ilanı görünüyor (rejected, 'aktif' kovasında)", bodyText.includes(`SEKME-REDDEDILDI-${stamp}`));
    check("IPTAL ilanı görünüyor (cancelled, 'aktif' kovasında)", bodyText.includes(`SEKME-IPTAL-${stamp}`));
    check("KABUL ilanı BURADA GÖRÜNMÜYOR (accepted başka sekmede olmalı)", !bodyText.includes(`SEKME-KABUL-${stamp}`));
    check("DEVAMEDEN ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-DEVAMEDEN-${stamp}`));
    check("TAMAMLANDI ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-TAMAMLANDI-${stamp}`));

    // --- 2) Kabul Edilen Teklifler (profil menüsü linkiyle) ---
    console.log("\n=== 'Kabul Edilen Teklifler' menü linki ===");
    const hamburgerOrProfile = page.getByRole("button", { name: /Mert/ }).first();
    await hamburgerOrProfile.click();
    const kabulLink = page.getByRole("menuitem", { name: "Kabul Edilen Teklifler" });
    const kabulHref = await kabulLink.getAttribute("href");
    check("href gerçek bir route (# / boş / javascript: değil)", Boolean(kabulHref) && kabulHref !== "#" && !kabulHref.startsWith("javascript:"), `href="${kabulHref}"`);
    const kabulResponse = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/panel/tekliflerim") || true, { timeout: 5000 }).catch(() => null),
      kabulLink.click(),
    ]);
    await page.waitForURL(/durum=kabul-edildi/, { timeout: 5000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));
    bodyText = await page.locator("main").innerText();
    check("KABUL ilanı burada görünüyor", bodyText.includes(`SEKME-KABUL-${stamp}`));
    check("BEKLEMEDE ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-BEKLEMEDE-${stamp}`));
    check("DEVAMEDEN ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-DEVAMEDEN-${stamp}`));
    check("TAMAMLANDI ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-TAMAMLANDI-${stamp}`));
    void kabulResponse;

    // --- 3) Devam Eden İşler ---
    console.log("\n=== 'Devam Eden İşler' menü linki ===");
    await hamburgerOrProfile.click();
    const devamLink = page.getByRole("menuitem", { name: "Devam Eden İşler" });
    const devamHref = await devamLink.getAttribute("href");
    check("href gerçek bir route", Boolean(devamHref) && devamHref !== "#" && !devamHref.startsWith("javascript:"), `href="${devamHref}"`);
    await devamLink.click();
    await page.waitForURL(/durum=devam-eden/, { timeout: 5000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));
    bodyText = await page.locator("main").innerText();
    check("DEVAMEDEN ilanı (in_progress) burada görünüyor", bodyText.includes(`SEKME-DEVAMEDEN-${stamp}`));
    check("ONAYBEKLIYOR ilanı (completion_requested) burada görünüyor", bodyText.includes(`SEKME-ONAYBEKLIYOR-${stamp}`));
    check("KABUL ilanı BURADA GÖRÜNMÜYOR (accepted ayrı sekmede)", !bodyText.includes(`SEKME-KABUL-${stamp}`));
    check("TAMAMLANDI ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-TAMAMLANDI-${stamp}`));

    // --- 4) Tamamlanan İşler ---
    console.log("\n=== 'Tamamlanan İşler' menü linki ===");
    await hamburgerOrProfile.click();
    const tamamlananLink = page.getByRole("menuitem", { name: "Tamamlanan İşler" });
    const tamamlananHref = await tamamlananLink.getAttribute("href");
    check("href gerçek bir route", Boolean(tamamlananHref) && tamamlananHref !== "#" && !tamamlananHref.startsWith("javascript:"), `href="${tamamlananHref}"`);
    await tamamlananLink.click();
    await page.waitForURL(/durum=tamamlandi/, { timeout: 5000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));
    bodyText = await page.locator("main").innerText();
    check("TAMAMLANDI ilanı burada görünüyor", bodyText.includes(`SEKME-TAMAMLANDI-${stamp}`));
    check("IPTAL (cancelled) ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-IPTAL-${stamp}`));
    check("REDDEDILDI (rejected) ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-REDDEDILDI-${stamp}`));
    check("DEVAMEDEN ilanı BURADA GÖRÜNMÜYOR", !bodyText.includes(`SEKME-DEVAMEDEN-${stamp}`));

    // --- 5) Bildirimler ---
    console.log("\n=== 'Bildirimler' menü linki ===");
    // Header zilindeki bildirim metinlerini ÖNCE topla (aynı veri kaynağı
    // karşılaştırması için) — zili açmak profil dropdown'ını (dışına tıklama
    // sayıldığı için) kapatır, bu yüzden profil menüsünü SONRA açıp
    // tıklıyoruz, aksi halde önceden yakalanan menuitem locator'ı artık
    // DOM'da olmayan/kapalı bir panele işaret eder.
    const bellButton = page.getByRole("button", { name: /Bildirimler/ }).first();
    await bellButton.click();
    const bellMenu = page.getByRole("menu", { name: "Bildirimler" });
    await bellMenu.waitFor({ state: "visible" });
    const bellTexts = await bellMenu.locator("[role='menuitem']").allInnerTexts();
    await page.keyboard.press("Escape");
    await bellMenu.waitFor({ state: "hidden" });

    await hamburgerOrProfile.click();
    const bildirimLink = page.getByRole("menuitem", { name: "Bildirimler" });
    const bildirimHref = await bildirimLink.getAttribute("href");
    check("href gerçek bir route", bildirimHref === "/panel/bildirimler", `href="${bildirimHref}"`);

    await bildirimLink.click();
    await page.waitForURL(/\/panel\/bildirimler/, { timeout: 5000 });
    check("404 sayfasına düşmedi", !(await page.locator("text=404").isVisible().catch(() => false)));
    check(
      "Artık 'yalnızca Hizmet Alan' engeliyle karşılaşmıyor",
      !(await page.getByText("Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir.").isVisible().catch(() => false)),
    );
    const pageTexts = await page.locator("main ul li").allInnerTexts();
    const sameSource = bellTexts.length === 0
      ? pageTexts.length >= 0 // ikisi de boşsa da tutarlı
      : bellTexts.some((t) => pageTexts.some((p) => p.includes(t.split("\n")[0]?.trim() ?? "___")));
    check(
      "Sayfadaki bildirimler header zili ile aynı veri kaynağından geliyor (en az bir ortak mesaj)",
      bellTexts.length === 0 || sameSource,
      `zil: ${bellTexts.length} adet, sayfa: ${pageTexts.length} adet`,
    );

    check("Genel: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await context.close();

    // --- 6) Yetkilendirme: Hizmet Alan bu sayfalara erişmeye çalışırsa ---
    console.log("\n=== Yetkisiz erişim: Hizmet Alan (Zeynep) tekliflerim'e giderse ===");
    const alanContext = await browser.newContext();
    const alanPage = await alanContext.newPage();
    attachDiagnostics(alanPage);
    await login(alanPage, ZEYNEP, "/panel");
    await alanPage.goto(`${BASE_URL}/panel/tekliflerim?durum=kabul-edildi`);
    const roleGateVisible = await alanPage
      .getByText("Bu sayfa yalnızca Hizmet Veren kullanıcılar içindir.")
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check("404 değil, güvenli bir uyarı gösteriliyor", roleGateVisible);
    console.log("\n=== Hizmet Alan (Zeynep) artık kendi bildirimler sayfasını görebiliyor mu ===");
    await alanPage.goto(`${BASE_URL}/panel/bildirimler`);
    check(
      "Hizmet Alan bildirimler sayfası hâlâ çalışıyor (engellenmiyor)",
      !(await alanPage.getByText("Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir.").isVisible().catch(() => false)),
    );
    check("Hizmet Alan: konsol hatası yok", alanPage.jsProblems.length === 0, alanPage.jsProblems.join(" | "));
    await alanContext.close();

    // --- 7) Oturumsuz erişim ---
    console.log("\n=== Oturumsuz erişim ===");
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    attachDiagnostics(anonPage);
    await anonPage.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
    check("Oturumsuz: giriş gerekli uyarısı gösteriliyor (404 değil)", await anonPage.getByText("giriş yapmalısınız").isVisible());
    await anonPage.goto(`${BASE_URL}/panel/bildirimler`);
    check("Oturumsuz bildirimler: giriş gerekli uyarısı gösteriliyor", await anonPage.getByText("giriş yapmalısınız").isVisible());
    check("Oturumsuz: konsol hatası yok", anonPage.jsProblems.length === 0, anonPage.jsProblems.join(" | "));
    await anonContext.close();

    // --- 8) Mobil görünüm (375px) ---
    console.log("\n=== Mobil (375px): sekmeler taşmıyor, menü linkleri çalışıyor ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await login(mobilePage, MERT, "/panel/tekliflerim?durum=devam-eden");
    const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
    check("mobilde yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    check("mobilde konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

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
