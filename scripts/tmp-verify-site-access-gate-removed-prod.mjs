// node scripts/tmp-verify-site-access-gate-removed-prod.mjs
//
// "MALSEVK_SITE_PASSWORD" site-genelinde geçici geliştirme şifre kapısı
// (proxy.ts + app/_lib/site-access.ts#isSiteAccessGateActive) gerçek
// malsevk.com açılışıyla KALICI OLARAK KALDIRILDI (isSiteAccessGateActive
// artık koşulsuz `false` döner). Bu script, kaldırmanın kod-seviyesinde
// gerçekten etkili olduğunu doğrular — özellikle de eski davranışın tam
// tersini: `tmp-verify-site-access-gate-prod.mjs` "kapı VARSA doğru
// çalışıyor mu" diye test ediyordu, bu script "kapı artık YOK mu" diye
// test ediyor, aynı `-prod.mjs` desenini izleyerek (npm run build && npm
// start gerektirir, prod modu şart çünkü kapı yalnızca NODE_ENV=production
// altında anlamlıydı).
//
// KRİTİK: Bu test MALSEVK_SITE_PASSWORD ortam değişkenini BİLEREK SET
// EDİLMİŞ halde çalıştırılır (aşağıdaki komuta bakın) — bu, "env
// değişkeni tanımsız olduğu için kapı boşta kaldı" ihtimalini değil,
// gerçekten kod yolunun (isSiteAccessGateActive) atlandığını kanıtlar.
// Eski test dosyası SİLİNMEDİ (geçmiş kaydı olarak kalıyor, bkz. AGENTS.md
// tmp-*.mjs konvansiyonu) ama artık YANLIŞ/ESKİ davranışı test ediyor —
// bu script onun güncel karşılığıdır.
//
// Çalıştırma:
//   MALSEVK_SITE_PASSWORD=TestSifre2026! npm run build
//   MALSEVK_SITE_PASSWORD=TestSifre2026! npm start -- -p 3100
//   node scripts/tmp-verify-site-access-gate-removed-prod.mjs

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3100";

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // 1) Şifresiz/cookie'siz ziyaretçi ana sayfayı DOĞRUDAN görüyor —
  // /site-erisim'e yönlendirme YOK, MALSEVK_SITE_PASSWORD process ortamında
  // gerçekten set olsa bile.
  const homeResponse = await page.goto(`${BASE_URL}/`);
  assert.equal(homeResponse.status(), 200);
  assert.equal(page.url(), `${BASE_URL}/`);
  ok("[1] Prod modda, MALSEVK_SITE_PASSWORD set olsa da, ana sayfa /site-erisim'e yönlendirmeden doğrudan 200 dönüyor");

  // 2) malsevk_site_access cookie'si hiç oluşmamış — hiçbir şifre girilmedi.
  const cookies = await context.cookies();
  assert.equal(
    cookies.some((c) => c.name === "malsevk_site_access"),
    false,
  );
  ok("[2] Hiç şifre girilmeden malsevk_site_access cookie'si oluşmuyor (kapı devre dışı)");

  // 3) /api/health artık site-şifresi yüzünden 401 DÖNMÜYOR (DB durumuna
  // göre 200 ya da 503 olabilir, ama asla eski kapı JSON hatası değil).
  const apiResponse = await page.request.get(`${BASE_URL}/api/health`);
  assert.notEqual(apiResponse.status(), 401);
  ok(`[3] /api/health artık site-şifresi kapısından 401 dönmüyor (gerçek durum: ${apiResponse.status()})`);

  // 4) Halka açık statik sayfalar da (KVKK, Gizlilik) doğrudan erişilebilir.
  const kvkkResponse = await page.goto(`${BASE_URL}/kvkk-aydinlatma-metni`);
  assert.equal(kvkkResponse.status(), 200);
  assert.equal(page.url(), `${BASE_URL}/kvkk-aydinlatma-metni`);
  ok("[4] /kvkk-aydinlatma-metni de kapı olmadan doğrudan açılıyor");

  // 5) Bilerek ayrı/ilgisiz bir yetkilendirme katmanı bozulmadı: gerçek
  // Supabase oturumu olmayan bir ziyaretçi /panel'e giderken YİNE de
  // /giris-yap'e yönlendiriliyor — ama bunun nedeni site-şifresi kapısı
  // DEĞİL, proxy.ts'nin kendi PROTECTED_ROUTE_PREFIXES + gerçek Supabase
  // oturum kontrolüdür (bkz. proxy.ts, isSiteAccessGateActive'ten sonraki,
  // ayrı blok). next=... hedefi /site-erisim değil /giris-yap olmalı.
  const panelResponse = await page.goto(`${BASE_URL}/panel`);
  const panelUrl = new URL(page.url());
  assert.equal(panelUrl.pathname, "/giris-yap");
  assert.equal(panelResponse.status(), 200);
  ok("[5] Oturumsuz ziyaretçi /panel'de /giris-yap'e yönlendiriliyor (site-şifresi kapısı değil, gerçek auth sınırı — dokunulmadı)");

  // 6) /site-erisim rotası hâlâ mevcut/kırık değil (mekanizma silinmedi,
  // sadece proxy.ts'de atlanıyor) ama artık zorunlu bir geçiş noktası değil.
  const siteErisimResponse = await page.goto(`${BASE_URL}/site-erisim`);
  assert.equal(siteErisimResponse.status(), 200);
  ok("[6] /site-erisim sayfası hâlâ kırılmadan render ediliyor (mekanizma kaldırılmadı, sadece proxy.ts'de devre dışı)");

  // 7) Mevcut kullanıcı giriş sistemi (Supabase Auth) hiç bozulmadı —
  // /giris-yap sayfası kapı olmadan normal şekilde render ediliyor.
  await page.goto(`${BASE_URL}/giris-yap`);
  await assert.doesNotReject(page.getByLabel("E-posta").waitFor({ state: "visible", timeout: 10000 }));
  ok("[7] /giris-yap sayfası (gerçek Supabase Auth giriş formu) kapı olmadan normal render ediliyor");

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-verify-site-access-gate-removed-prod] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[tmp-verify-site-access-gate-removed-prod] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[tmp-verify-site-access-gate-removed-prod] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-verify-site-access-gate-removed-prod] HATA:", error);
  process.exitCode = 1;
});
