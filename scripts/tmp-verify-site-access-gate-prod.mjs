// node scripts/tmp-verify-site-access-gate-prod.mjs
//
// "Site Geneli Geliştirme Şifre Koruması" (proxy.ts + app/site-erisim/)
// doğrulaması. Bu koruma yalnızca NODE_ENV=production'da etkin olduğu
// için `npm run dev` DEĞİL, bir üretim derlemesi + sunucusu gerektirir:
//   npm run build && npm start -- -p 3100
// (MALSEVK_SITE_PASSWORD ortam değişkeni .env.local üzerinden ayarlı
// olmalı — bu script'in test şifresi aşağıdaki TEST_PASSWORD ile
// birebir eşleşmelidir). Diğer `-prod` script'leriyle aynı desen: dev
// seed hesapları (DEV_ACCOUNTS) bu modda yoktur, bu yüzden mevcut giriş
// sisteminin bozulmadığını doğrulamak için gerçek Kayıt Ol akışıyla
// taze bir hesap oluşturulur.
//
// Ayrıca DEV_BASE_URL (npm run dev, :3000) üzerinde kapının tamamen
// devre dışı olduğunu (localhost geliştirme akışı belgelendiği gibi
// çalışıyor) da doğrular.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3100";
const DEV_BASE_URL = "http://localhost:3000";
const TEST_PASSWORD = "TestSifre2026!";
const WRONG_PASSWORD = "YanlisSifre123";

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function main() {
  const browser = await chromium.launch();

  // 11) Localhost geliştirme akışı: npm run dev üzerinde kapı tamamen
  // devre dışı, mevcut deneyim bozulmuyor.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(`${DEV_BASE_URL}/`);
    assert.equal(response.status(), 200);
    assert.equal(page.url(), `${DEV_BASE_URL}/`);
    ok("[dev] npm run dev (:3000) üzerinde ana sayfa yönlendirme olmadan 200 dönüyor (kapı devre dışı)");

    const panelResponse = await page.goto(`${DEV_BASE_URL}/panel`);
    assert.equal(panelResponse.status(), 200);
    assert.equal(page.url(), `${DEV_BASE_URL}/panel`);
    ok("[dev] npm run dev (:3000) üzerinde /panel de doğrudan (yönlendirilmeden) açılıyor");
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // 1) Şifresiz ziyaretçi ana sayfayı göremiyor.
  await page.goto(`${BASE_URL}/`);
  await page.waitForURL(`${BASE_URL}/site-erisim?next=%2F`);
  await assert.doesNotReject(page.getByLabel("Şifre").waitFor({ state: "visible", timeout: 10000 }));
  ok("[1] Şifresiz ziyaretçi ana sayfada /site-erisim'e yönlendiriliyor, ana sayfa içeriği yok");

  // 2) Şifresiz ziyaretçi doğrudan panel URL'sine gidemiyor.
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForURL(`${BASE_URL}/site-erisim?next=%2Fpanel`);
  ok("[2] Şifresiz ziyaretçi /panel'e doğrudan gidemiyor, next=%2Fpanel ile kapıya yönlendiriliyor");

  // 3) Şifresiz ziyaretçi API route'una erişemiyor.
  const apiResponse = await page.request.get(`${BASE_URL}/api/health`);
  assert.equal(apiResponse.status(), 401);
  const apiBody = await apiResponse.json();
  assert.equal(typeof apiBody.error, "string");
  ok("[3] Şifresiz ziyaretçi /api/health'e erişemiyor (401 JSON, sayfa yönlendirmesi değil)");

  // 4) Yanlış şifre reddediliyor.
  await page.goto(`${BASE_URL}/site-erisim?next=%2Fpanel`);
  await page.getByLabel("Şifre").fill(WRONG_PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await assert.doesNotReject(page.getByText("Şifre hatalı.").waitFor({ state: "visible", timeout: 10000 }));
  assert.equal(page.url(), `${BASE_URL}/site-erisim?next=%2Fpanel`);
  const cookiesAfterWrong = await context.cookies();
  assert.equal(
    cookiesAfterWrong.some((c) => c.name === "malsevk_site_access"),
    false,
  );
  ok("[4] Yanlış şifre 'Şifre hatalı.' ile reddediliyor, cookie oluşturulmuyor");

  // 5) Doğru şifre kabul ediliyor + orijinal hedefe (next) yönlendiriyor.
  await page.getByLabel("Şifre").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/panel`);
  ok("[5] Doğru şifre kabul ediliyor, orijinal istenen adrese (/panel) yönlendiriyor");

  // 6) Doğru şifre sonrası uygulama normal çalışıyor (ana sayfa + mevcut giriş sistemi).
  await page.goto(`${BASE_URL}/`);
  await assert.doesNotReject(
    page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[6] Doğru şifre sonrası ana sayfa normal şekilde render ediliyor");

  // 9) Cookie içinde düz şifre bulunmuyor.
  const cookiesAfterAuth = await context.cookies();
  const gateCookie = cookiesAfterAuth.find((c) => c.name === "malsevk_site_access");
  assert.ok(gateCookie, "malsevk_site_access cookie'si bulunamadı");
  assert.equal(gateCookie.value.includes(TEST_PASSWORD), false);
  assert.notEqual(gateCookie.value, TEST_PASSWORD);
  assert.equal(gateCookie.httpOnly, true);
  assert.equal(gateCookie.secure, true);
  assert.equal(gateCookie.sameSite, "Lax");
  ok("[9] Cookie düz şifre içermiyor; HttpOnly+Secure+SameSite=Lax doğrulandı");

  // 7) Sayfa yenilemede erişim korunuyor.
  await page.reload();
  await assert.doesNotReject(
    page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  assert.equal(page.url(), `${BASE_URL}/`);
  ok("[7] Sayfa yenilemede tekrar şifre istenmiyor, erişim korunuyor");

  // 13) Mevcut kullanıcı giriş sistemi bozulmuyor: gerçek Kayıt Ol akışıyla
  // taze bir hesap oluşturulur (prod modda DEV_ACCOUNTS yoktur).
  async function selectSearchable(fieldId, optionLabel) {
    await page.locator(`#${fieldId}`).click();
    await page.getByRole("option", { name: optionLabel, exact: true }).click();
  }

  const email = `site-access-test-${Date.now()}@example.com`;
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page.getByRole("radio", { name: "Hizmet Alan" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Test");
  await page.getByLabel("Soyad", { exact: true }).fill("Kullanici");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Telefon Numarası").fill("0532 111 22 33");
  await page.getByLabel("Şifre", { exact: true }).fill("GecerliSifre1!");
  await page.getByLabel("Şifre Tekrar").fill("GecerliSifre1!");
  await page.getByLabel("Firma Adı").fill("Test Firma A.Ş.");
  await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });
  await selectSearchable(await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  await page.getByLabel("KVKK Aydınlatma Metni'ni okudum ve kabul ediyorum.").check();
  await page.getByLabel("Kullanım Koşulları'nı kabul ediyorum.").check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await assert.doesNotReject(
    page.getByText("Kaydınız başarıyla oluşturuldu.").waitFor({ state: "visible", timeout: 15000 }),
  );
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre", { exact: true }).fill("GecerliSifre1!");
  await page.getByRole("button", { name: "Giriş Yap", exact: true }).click();
  await assert.doesNotReject(page.waitForURL(`${BASE_URL}/`, { timeout: 15000 }));
  ok("[6/13] Site kapısı arkasında MALSEVK'in kendi Kayıt Ol + Giriş Yap akışı sorunsuz çalışıyor");

  // 12) Mobil görünüm bozulmuyor (çıkış yapıp kapı ekranını mobilde kontrol).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/site-erisim`);
  await assert.doesNotReject(
    page.getByRole("button", { name: "Erişimi Kilitle" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  await page.getByRole("button", { name: "Erişimi Kilitle" }).click();

  // 8) Çıkış yapınca tekrar şifre ekranı geliyor.
  await page.waitForURL(`${BASE_URL}/site-erisim`);
  await assert.doesNotReject(page.getByLabel("Şifre").waitFor({ state: "visible", timeout: 10000 }));
  const cookiesAfterLogout = await context.cookies();
  assert.equal(
    cookiesAfterLogout.some((c) => c.name === "malsevk_site_access"),
    false,
  );
  ok("[8] 'Erişimi Kilitle' sonrası cookie temizleniyor, tekrar şifre ekranı geliyor");

  await page.goto(`${BASE_URL}/`);
  await page.waitForURL(`${BASE_URL}/site-erisim?next=%2F`);
  ok("[8b] Çıkış sonrası ana sayfa tekrar kapı arkasında (mobil görünümde de doğrulandı)");

  // 12b) Mobil görünümde şifre formu kullanılabilir (taşma/overlap yok, temel kontrol).
  await page.getByLabel("Şifre").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
  ok("[12] Mobil görünümde (390px) şifre formu dolduruldu ve gönderildi, giriş başarılı");

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-verify-site-access-gate-prod] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[tmp-verify-site-access-gate-prod] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[tmp-verify-site-access-gate-prod] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-verify-site-access-gate-prod] HATA:", error);
  process.exitCode = 1;
});
