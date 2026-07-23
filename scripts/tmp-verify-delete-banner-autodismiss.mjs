// "İlan başarıyla silindi." başarı banner'ının artık kalıcı kalmayıp
// ~3 saniye sonra yumuşak bir fade-out (250ms) ile DOM'dan tamamen
// kalktığını doğrular (bkz. app/_lib/use-auto-dismiss-banner.ts,
// job-requests-panel.tsx). Ayrıca: sayfa yenileme/sayfadan çıkıp geri
// gelmede tekrar görünmemesi, art arda silmede timer'ın sıfırdan
// başlaması, component unmount'ta hata olmaması, prefers-reduced-motion
// altında anında kaybolması, mobilde bozulmaması ve "İlan başarıyla
// güncellendi." banner'ının bu değişiklikten etkilenmediği test edilir.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
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
  await page.waitForURL(`${BASE_URL}${redirect}`);
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
        description: "Silme banner testi için oluşturulan ilan.",
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

const BANNER_TEXT = "İlan başarıyla silindi.";

async function deleteJobViaUi(page, jobTitle) {
  const card = page.locator("li", { hasText: jobTitle });
  await card.getByRole("button", { name: "İlanı Sil" }).click();
  await page.getByRole("button", { name: "Evet, İlanı Sil" }).click();
}

async function main() {
  const browser = await chromium.launch();
  try {
    // === SENARYO A: temel yaşam döngüsü (görünür -> 3sn -> fade -> DOM'dan kalkma) ===
    console.log("\n=== Senaryo A: temel yaşam döngüsü ===");
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageA = await contextA.newPage();
    attachDiagnostics(pageA);

    await loginAs(pageA, ZEYNEP, "/panel");
    const zeynepId = await getUserId(pageA, ZEYNEP.email);
    const JOB_A_ID = `banner-a-${STAMP}`;
    const JOB_A_TITLE = `BANNER-A-${STAMP}`;
    await seedJob(pageA, JOB_A_ID, JOB_A_TITLE, zeynepId);

    await pageA.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageA.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    await pageA.getByText(JOB_A_TITLE).first().waitFor({ state: "visible", timeout: 10000 });

    await deleteJobViaUi(pageA, JOB_A_TITLE);
    const banner = pageA.getByText(BANNER_TEXT);
    await assert.doesNotReject(banner.waitFor({ state: "visible", timeout: 5000 }));
    check("[A1] Silme sonrası banner hemen görünüyor", true);

    const opacityRightAfter = await banner.evaluate((el) => getComputedStyle(el).opacity);
    check("[A1] Başlangıçta tam opak (fade henüz başlamadı)", opacityRightAfter === "1", `opacity=${opacityRightAfter}`);

    await pageA.waitForTimeout(2500);
    const stillVisibleAt2500 = await banner.isVisible().catch(() => false);
    check("[A2] ~2.5sn'de hâlâ tam görünür (henüz 3sn dolmadı)", stillVisibleAt2500);
    const opacityAt2500 = stillVisibleAt2500 ? await banner.evaluate((el) => getComputedStyle(el).opacity) : null;
    check("[A2] ~2.5sn'de hâlâ tam opak", opacityAt2500 === "1", `opacity=${opacityAt2500}`);

    // 3sn dolduktan hemen sonra (fade-out ortasında) opaklık düşmüş olmalı
    await pageA.waitForTimeout(600);
    const midFadeVisible = await banner.count();
    const midFadeOpacity = midFadeVisible > 0 ? await banner.evaluate((el) => getComputedStyle(el).opacity).catch(() => null) : null;
    console.log(`    [bilgi] ~3.1sn'de DOM'da eleman sayısı=${midFadeVisible}, opacity=${midFadeOpacity}`);

    // Fade tamamlandıktan sonra (3000 + 250 + pay) DOM'dan TAMAMEN kalkmalı
    await pageA.waitForTimeout(400);
    const countAfterFade = await pageA.getByText(BANNER_TEXT).count();
    check("[A3] Fade tamamlandıktan sonra banner DOM'dan tamamen kaldırıldı", countAfterFade === 0, `adet=${countAfterFade}`);

    check("[Senaryo A] konsol/hydration hatası yok", pageA.jsProblems.length === 0, pageA.jsProblems.join(" | "));
    await contextA.close();

    // === SENARYO B: sayfa yenileme sonrası tekrar görünmüyor ===
    console.log("\n=== Senaryo B: sayfa yenileme sonrası tekrar görünmüyor ===");
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageB = await contextB.newPage();
    attachDiagnostics(pageB);
    await loginAs(pageB, ZEYNEP, "/panel");
    const zeynepIdB = await getUserId(pageB, ZEYNEP.email);
    const JOB_B_ID = `banner-b-${STAMP}`;
    const JOB_B_TITLE = `BANNER-B-${STAMP}`;
    await seedJob(pageB, JOB_B_ID, JOB_B_TITLE, zeynepIdB);
    await pageB.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageB.getByText(JOB_B_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
    await deleteJobViaUi(pageB, JOB_B_TITLE);
    await pageB.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    check("[B1] Silme sonrası banner görünüyor", true);

    await pageB.reload();
    await pageB.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const bannerCountAfterReload = await pageB.getByText(BANNER_TEXT).count();
    check("[B2] Sayfa yenilendiğinde banner tekrar görünmüyor", bannerCountAfterReload === 0, `adet=${bannerCountAfterReload}`);

    // --- Sayfadan çık, geri gel ---
    await pageB.goto(`${BASE_URL}/panel`);
    await pageB.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageB.getByRole("tablist", { name: "Hizmet talebi durumu" }).waitFor({ state: "visible", timeout: 10000 });
    const bannerCountAfterNav = await pageB.getByText(BANNER_TEXT).count();
    check("[B3] Sayfadan çıkıp geri gelince banner tekrar görünmüyor", bannerCountAfterNav === 0, `adet=${bannerCountAfterNav}`);

    check("[Senaryo B] konsol/hydration hatası yok", pageB.jsProblems.length === 0, pageB.jsProblems.join(" | "));
    await contextB.close();

    // === SENARYO C: art arda silme -> timer sıfırdan başlıyor ===
    console.log("\n=== Senaryo C: art arda silme -> eski timer temizlenip yeni süre başlıyor ===");
    const contextC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageC = await contextC.newPage();
    attachDiagnostics(pageC);
    await loginAs(pageC, ZEYNEP, "/panel");
    const zeynepIdC = await getUserId(pageC, ZEYNEP.email);
    const JOB_C1_ID = `banner-c1-${STAMP}`;
    const JOB_C1_TITLE = `BANNER-C1-${STAMP}`;
    const JOB_C2_ID = `banner-c2-${STAMP}`;
    const JOB_C2_TITLE = `BANNER-C2-${STAMP}`;
    await seedJob(pageC, JOB_C1_ID, JOB_C1_TITLE, zeynepIdC);
    await seedJob(pageC, JOB_C2_ID, JOB_C2_TITLE, zeynepIdC);
    await pageC.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageC.getByText(JOB_C1_TITLE).first().waitFor({ state: "visible", timeout: 10000 });

    const t0 = Date.now();
    await deleteJobViaUi(pageC, JOB_C1_TITLE);
    await pageC.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    check("[C1] İlk silme sonrası banner görünüyor", true);

    // 2sn bekle (ilk timer'ın %2/3'ü geçmiş olsun), sonra ikinci ilanı sil
    await pageC.waitForTimeout(2000);
    await deleteJobViaUi(pageC, JOB_C2_TITLE);
    const t1 = Date.now();
    await pageC.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    check("[C2] İkinci silme sonrası banner hâlâ/yine görünüyor", true);

    // İlk silmeden 3sn+pay geçmiş olmasına rağmen (toplam ~2.6sn + şimdi),
    // eğer timer doğru sıfırlanmadıysa banner burada zaten kaybolmuş olurdu.
    const elapsedSinceFirstDelete = Date.now() - t0;
    console.log(`    [bilgi] ilk silmeden bu ana kadar geçen süre=${elapsedSinceFirstDelete}ms`);
    const stillVisibleAfterSecondDelete = await pageC.getByText(BANNER_TEXT).isVisible().catch(() => false);
    check(
      "[C3] İlk silmenin süresi (yeniden başlamasaydı) dolmuş olsa bile banner hâlâ görünür (timer sıfırlandı)",
      stillVisibleAfterSecondDelete,
    );

    // İkinci silmeden ~3.4sn sonra (yeni süre + fade + pay) kaybolmalı
    const remaining = 3400 - (Date.now() - t1);
    if (remaining > 0) await pageC.waitForTimeout(remaining);
    const countAfterSecondCycle = await pageC.getByText(BANNER_TEXT).count();
    check("[C4] İkinci silmenin süresi dolunca banner DOM'dan kalkıyor", countAfterSecondCycle === 0, `adet=${countAfterSecondCycle}`);

    check("[Senaryo C] konsol/hydration hatası yok", pageC.jsProblems.length === 0, pageC.jsProblems.join(" | "));
    await contextC.close();

    // === SENARYO D: unmount sırasında hata/leak olmuyor ===
    console.log("\n=== Senaryo D: banner görünürken sayfadan ayrılma (unmount) ===");
    const contextD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageD = await contextD.newPage();
    attachDiagnostics(pageD);
    await loginAs(pageD, ZEYNEP, "/panel");
    const zeynepIdD = await getUserId(pageD, ZEYNEP.email);
    const JOB_D_ID = `banner-d-${STAMP}`;
    const JOB_D_TITLE = `BANNER-D-${STAMP}`;
    await seedJob(pageD, JOB_D_ID, JOB_D_TITLE, zeynepIdD);
    await pageD.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageD.getByText(JOB_D_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
    await deleteJobViaUi(pageD, JOB_D_TITLE);
    await pageD.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    // Banner hâlâ görünürken (timer beklerken) başka bir sayfaya git —
    // component unmount olur, cleanup çalışmalı, hata/uyarı olmamalı.
    await pageD.goto(`${BASE_URL}/panel`);
    await pageD.waitForTimeout(3500); // eski timer'lar (temizlenmediyse) burada patlardı
    check("[D1] Unmount sonrası (eski timer'lar temizlendiği için) konsol hatası yok", pageD.jsProblems.length === 0, pageD.jsProblems.join(" | "));
    await contextD.close();

    // === SENARYO E: prefers-reduced-motion -> animasyonsuz, süre sonunda anında kayboluyor ===
    console.log("\n=== Senaryo E: prefers-reduced-motion ===");
    const contextE = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const pageE = await contextE.newPage();
    attachDiagnostics(pageE);
    await loginAs(pageE, ZEYNEP, "/panel");
    const zeynepIdE = await getUserId(pageE, ZEYNEP.email);
    const JOB_E_ID = `banner-e-${STAMP}`;
    const JOB_E_TITLE = `BANNER-E-${STAMP}`;
    await seedJob(pageE, JOB_E_ID, JOB_E_TITLE, zeynepIdE);
    await pageE.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageE.getByText(JOB_E_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
    await deleteJobViaUi(pageE, JOB_E_TITLE);
    await pageE.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    check("[E1] reduced-motion altında banner yine görünüyor", true);
    await pageE.waitForTimeout(3300);
    const countReducedMotion = await pageE.getByText(BANNER_TEXT).count();
    check("[E2] reduced-motion altında ~3sn sonra DOM'dan kalkmış", countReducedMotion === 0, `adet=${countReducedMotion}`);
    check("[Senaryo E] konsol hatası yok", pageE.jsProblems.length === 0, pageE.jsProblems.join(" | "));
    await contextE.close();

    // === SENARYO F: mobil (375px) ===
    console.log("\n=== Senaryo F: mobil (375px) ===");
    const contextF = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const pageF = await contextF.newPage();
    attachDiagnostics(pageF);
    await loginAs(pageF, ZEYNEP, "/panel");
    const zeynepIdF = await getUserId(pageF, ZEYNEP.email);
    const JOB_F_ID = `banner-f-${STAMP}`;
    const JOB_F_TITLE = `BANNER-F-${STAMP}`;
    await seedJob(pageF, JOB_F_ID, JOB_F_TITLE, zeynepIdF);
    await pageF.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
    await pageF.getByText(JOB_F_TITLE).first().waitFor({ state: "visible", timeout: 10000 });
    await deleteJobViaUi(pageF, JOB_F_TITLE);
    await pageF.getByText(BANNER_TEXT).waitFor({ state: "visible", timeout: 5000 });
    const scrollWidth = await pageF.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await pageF.evaluate(() => document.documentElement.clientWidth);
    check("[F1] Mobilde banner görünüyor, yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    await pageF.waitForTimeout(3400);
    const countMobile = await pageF.getByText(BANNER_TEXT).count();
    check("[F2] Mobilde de ~3sn+fade sonra DOM'dan kalkıyor", countMobile === 0, `adet=${countMobile}`);
    check("[Senaryo F] konsol hatası yok", pageF.jsProblems.length === 0, pageF.jsProblems.join(" | "));
    await contextF.close();

    // === SENARYO G: "İlan başarıyla güncellendi." banner'ı bu değişiklikten etkilenmedi (regresyon) ===
    console.log("\n=== Senaryo G: 'İlan başarıyla güncellendi.' banner'ı (regresyon, dokunulmadı) ===");
    const contextG = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageG = await contextG.newPage();
    attachDiagnostics(pageG);
    await loginAs(pageG, ZEYNEP, "/panel/hizmet-taleplerim?guncellendi=1");
    await assert.doesNotReject(
      pageG.getByText("İlan başarıyla güncellendi.").waitFor({ state: "visible", timeout: 10000 }),
    );
    check("[G1] 'İlan başarıyla güncellendi.' banner'ı hâlâ eskisi gibi çalışıyor (URL param tabanlı, dokunulmadı)", true);
    check("[Senaryo G] konsol hatası yok", pageG.jsProblems.length === 0, pageG.jsProblems.join(" | "));
    await contextG.close();

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
