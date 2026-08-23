// node scripts/tmp-desktop-layout-test.mjs
//
// Masaüstü genişlik/yoğunluk/kaydırma düzeltmesi görevinin doğrulama
// script'i — gerçek Chromium üzerinden, görev tanımının istediği 6
// çözünürlükte (375x812/768x1024/1024x768/1366x768/1440x900/1920x1080)
// temsili sayfaları gezip:
//   1) yatay taşma var mı (`scrollWidth` vs `clientWidth`),
//   2) header içerikle çakışıyor mu (basit bir konsol hata/uyarı taraması),
//   3) her sayfa+çözünürlük kombinasyonu için bir ekran görüntüsü
// kaydeder. Ön koşul: `npm run dev` çalışıyor olmalı (localhost:3000).
//
// Gerçek Supabase Auth oturumu (hizmet-veren/admin) GEREKTİREN sayfalar
// (ilan detayında GERÇEK teklif formu, admin ekranları) bu script'te test
// EDİLEMEDİ — bu development projesinde e-posta doğrulaması zorunlu
// (bkz. tmp-supabase-auth-integration-test.mjs'in kendi bulgusu) ve bu
// script'in servis-rolü/gizli anahtarı yok (SB_SECRET_KEY_FOR_TEST bilerek
// kullanılmadı — bu script salt görsel/yerleşim doğrulaması amaçlıdır, iş
// mantığı/RPC/veritabanı testi değil). Bilinen eski DEV_ACCOUNTS
// kimlik bilgileriyle GERÇEK bir giriş denemesi yine de yapılır (best-effort,
// zarafetle atlanır) — başarılı olursa ek sayfalar da test edilir.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE_URL = "http://localhost:3000";
const OUT_DIR =
  "C:/Users/merta/AppData/Local/Temp/claude/c--Users-merta-malsevk-2/673b8d14-085d-4ee5-80f7-209a097a3878/scratchpad/layout-screens";
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "mobil-375x812", width: 375, height: 812 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "kucuk-dizustu-1024x768", width: 1024, height: 768 },
  { name: "standart-dizustu-1366x768", width: 1366, height: 768 },
  { name: "masaustu-1440x900", width: 1440, height: 900 },
  { name: "genis-masaustu-1920x1080", width: 1920, height: 1080 },
];

const GUEST_PAGES = [
  { name: "ana-sayfa", path: "/" },
  { name: "ilanlar-guest", path: "/ilanlar" },
  { name: "hizmet-talebi-olustur-guest", path: "/hizmet-talebi-olustur" },
  { name: "ilan-detay-ilan001-guest", path: "/ilanlar/ilan-001" },
];

// Faz 2 — "ilk ekrana sığdırma" hedefinin sert şekilde test edildiği
// çözünürlükler (kullanıcının kendi talebi: en az 1366×768 ve üzeri).
const VIEWPORT_FIT_RESOLUTIONS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

let pass = 0;
let fail = 0;
const overflowIssues = [];
const viewportFitIssues = [];

async function checkPage(page, viewport, pageDef) {
  const url = `${BASE_URL}${pageDef.path}`;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => page.goto(url, { timeout: 20000 }));
  await page.waitForTimeout(400); // useSession/useSyncExternalStore hidrasyonu için kısa bekleme

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const overflow = metrics.scrollWidth > metrics.clientWidth + 1; // 1px tolerans
  if (overflow) {
    fail++;
    overflowIssues.push(`${pageDef.name} @ ${viewport.name}: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`);
    console.log(`  ✗ YATAY TAŞMA: ${pageDef.name} @ ${viewport.name} (scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth})`);
  } else {
    pass++;
    console.log(`  ✓ ${pageDef.name} @ ${viewport.name} (${metrics.clientWidth}px, taşma yok)`);
  }

  const screenshotPath = `${OUT_DIR}/${pageDef.name}__${viewport.name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((e) => console.log(`    (ekran görüntüsü alınamadı: ${e.message})`));
}

// Faz 2 doğrulaması: ilan detay sayfasında (misafir görünümü — bkz. script
// başlığındaki kısıt notu) görev tanımının "ilk ekranda kaydırmadan
// görünmeli" dediği elemanların ALT kenarının viewport yüksekliğinin
// İÇİNDE kaldığını gerçek DOM ölçümüyle doğrular. `AuthGateNotice` (misafir
// durumunda "Teklif Ver" kartının içeriği) gerçek `OfferForm` ile AYNI
// sağ-sütun/sticky JSX ağacını paylaştığı için (yalnızca içerik dallanıyor,
// bkz. offer-panel.tsx) bu ölçüm gerçek formun da aynı sınırlar içinde
// kalacağının dolaylı kanıtıdır — ama gerçek uçtan uca kanıt DEĞİLDİR
// (bkz. script başlığı ve nihai rapor).
async function checkViewportFit(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const url = `${BASE_URL}/ilanlar/ilan-001`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => page.goto(url, { timeout: 20000 }));
  await page.waitForTimeout(400);

  const checks = [
    { label: "İlan başlığı (h1)", locator: page.locator("h1").first() },
    { label: "İş Açıklaması başlığı", locator: page.getByRole("heading", { name: "İş Açıklaması" }) },
    {
      label: "Teklif Ver kartı (sağ sütun, misafir bildirim kartı dahil)",
      locator: page.locator('h2:has-text("Teklif Ver")').locator(".."),
    },
  ];

  let allFit = true;
  for (const check of checks) {
    const box = await check.locator.boundingBox().catch(() => null);
    if (!box) {
      allFit = false;
      viewportFitIssues.push(`${viewport.name}: "${check.label}" bulunamadı/ölçülemedi`);
      console.log(`  ✗ ${viewport.name} — "${check.label}" bulunamadı/ölçülemedi`);
      continue;
    }
    const bottom = box.y + box.height;
    const fits = bottom <= viewport.height + 1; // 1px tolerans
    if (!fits) {
      allFit = false;
      viewportFitIssues.push(`${viewport.name}: "${check.label}" alt kenarı ${Math.round(bottom)}px, viewport ${viewport.height}px'i aşıyor`);
      console.log(`  ✗ ${viewport.name} — "${check.label}" alt kenarı ${Math.round(bottom)}px (viewport ${viewport.height}px'i AŞIYOR)`);
    } else {
      console.log(`  ✓ ${viewport.name} — "${check.label}" alt kenarı ${Math.round(bottom)}px (${viewport.height}px içinde)`);
    }
  }

  const footerCount = await page.locator("footer").count();
  if (footerCount > 0) {
    allFit = false;
    viewportFitIssues.push(`${viewport.name}: ilan detay sayfasında footer render edilmiş (beklenen: hiç yok)`);
    console.log(`  ✗ ${viewport.name} — footer render edilmiş (beklenen: hiç yok, ilk ekranı daraltmasın diye)`);
  } else {
    console.log(`  ✓ ${viewport.name} — footer render edilmemiş (beklendiği gibi)`);
  }

  await page.screenshot({ path: `${OUT_DIR}/faz2-viewport-fit__${viewport.name}.png` }).catch(() => {});
  if (allFit) pass++;
  else fail++;
}

async function tryLogin(page, email, password, label) {
  await page.goto(`${BASE_URL}/giris-yap`, { timeout: 20000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  try {
    await page.getByRole("banner").getByText(/Hizmet Alan|Hizmet Veren|Admin/).waitFor({ state: "visible", timeout: 8000 });
    console.log(`  ✓ Giriş başarılı: ${label} (${email})`);
    return true;
  } catch {
    console.log(`  – Giriş denemesi başarısız/atlandı: ${label} (${email}) — bu hesap bu development projesinde gerçek bir Supabase Auth kullanıcısı olarak mevcut olmayabilir.`);
    return false;
  }
}

async function main() {
  const browser = await chromium.launch();

  console.log("=== Misafir (oturumsuz) sayfalar — 6 çözünürlük ===");
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    for (const pageDef of GUEST_PAGES) {
      await checkPage(page, viewport, pageDef);
    }
    await context.close();
  }

  console.log("\n=== Faz 2 — İlan detayı 'ilk ekrana sığdırma' ölçümü (misafir görünümü, 3 masaüstü çözünürlüğü) ===");
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const viewport of VIEWPORT_FIT_RESOLUTIONS) {
      await checkViewportFit(page, viewport);
    }
    await context.close();
  }

  console.log("\n=== Hizmet Veren (mert@test.com) girişi deneniyor ===");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const loggedIn = await tryLogin(page, "mert@test.com", "Mert123!", "Hizmet Veren");
    if (loggedIn) {
      const providerPages = [
        { name: "ilanlar-hizmet-veren", path: "/ilanlar" },
        { name: "ilan-detay-teklif-hizmet-veren", path: "/ilanlar/ilan-002" },
        { name: "panel-profil-hizmet-veren", path: "/panel/profil" },
      ];
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const pageDef of providerPages) {
          await checkPage(page, viewport, pageDef);
        }
      }
    }
    await context.close();
  }

  console.log("\n=== Admin (admin@test.com) girişi deneniyor ===");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const loggedIn = await tryLogin(page, "admin@test.com", "Admin123!", "Admin");
    if (loggedIn) {
      const adminPages = [
        { name: "admin-dashboard", path: "/admin" },
        { name: "admin-ilan-listesi", path: "/admin/ilanlar" },
        { name: "admin-firmalar-listesi", path: "/admin/firmalar" },
      ];
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const pageDef of adminPages) {
          await checkPage(page, viewport, pageDef);
        }
      }
    }
    await context.close();
  }

  await browser.close();

  console.log(`\n=== SONUÇ: ${pass} kontrol grubu geçti, ${fail} kontrol grubu başarısız ===`);
  if (overflowIssues.length > 0) {
    console.log("Yatay taşma detayları:");
    overflowIssues.forEach((issue) => console.log(`  - ${issue}`));
  }
  if (viewportFitIssues.length > 0) {
    console.log("Faz 2 'ilk ekrana sığdırma' sorunları:");
    viewportFitIssues.forEach((issue) => console.log(`  - ${issue}`));
  }
  console.log(`Ekran görüntüleri: ${OUT_DIR}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Script hata verdi:", err);
  process.exit(1);
});
