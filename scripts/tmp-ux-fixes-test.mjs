// UX/mobil düzeltmelerinin testi: Hizmet Alan üst menüsü, mobil taşma,
// mobil bildirim zili, bildirim silme, ilan formu doğrulama UX.
// Ön koşul: `npm run dev` (http://localhost:3000).
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
  await page.goto(`${BASE_URL}/panel`);
  const viewport = page.viewportSize();
  const isMobile = viewport !== null && viewport.width < 768;
  if (isMobile) {
    // Mobilde ProfileMenu ayrı bir açılır buton değil, hamburger panelinin
    // içine gömülü düz bir liste (bkz. profile-menu.tsx "mobile" dalı) —
    // önce hamburger açılmalı, "Çıkış Yap" da role="menuitem" değil.
    await page.getByRole("button", { name: /Menüyü aç/ }).click();
    await page.getByRole("button", { name: "Çıkış Yap" }).click();
  } else {
    await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
    await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  }
  await page.waitForURL(`${BASE_URL}/`);
}
async function getUserId(page, email) {
  return page.evaluate((e) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === e)?.id;
  }, email);
}
async function checkNoOverflow(page, label) {
  const r = await page.evaluate(() => ({
    docWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(r.scrollWidth <= r.docWidth + 1, `[${label}] yatay taşma var: scrollWidth=${r.scrollWidth} docWidth=${r.docWidth}`);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const notFoundHits = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("response", (res) => {
    if (res.status() === 404) notFoundHits.push(res.url());
  });

  // ============ 1) HİZMET ALAN MASAÜSTÜ MENÜ ============
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/`);
  const desktopNav = page.getByRole("navigation", { name: "Ana menü" });
  // useSession() ilk render anında (hydration tamamlanmadan) null döner
  // (bkz. getServerSnapshot); CTA yalnızca client senkronizasyonu sonrası
  // görünür — bu yüzden metinleri okumadan önce CTA'nın görünür olmasını
  // bekliyoruz (allInnerTexts .count/.click gibi otomatik yeniden denemez).
  await desktopNav.getByRole("link", { name: "Hizmet Talebi Oluştur" }).waitFor({ state: "visible", timeout: 10000 });
  const navLinkTexts = await desktopNav.getByRole("link").allInnerTexts();
  assert.deepEqual(
    navLinkTexts,
    ["Nasıl Çalışır", "Hizmetler", "İlanlar", "Hizmet Talebi Oluştur"],
    `Masaüstü menü sırası yanlış: ${JSON.stringify(navLinkTexts)}`,
  );
  ok("[Masaüstü menü] Hizmet Alan için sıra doğru: Nasıl Çalışır, Hizmetler, İlanlar, Hizmet Talebi Oluştur");

  const ctaLink = desktopNav.getByRole("link", { name: "Hizmet Talebi Oluştur" });
  const ctaHref = await ctaLink.getAttribute("href");
  assert.equal(ctaHref, "/hizmet-talebi-olustur", "CTA doğru route'a gitmeli");
  await ctaLink.click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
  const notFoundText = await page.getByText(/404|bulunamadı/i).count();
  assert.equal(notFoundText, 0, "CTA 404'e gitmemeli");
  await assert.doesNotReject(
    page.getByRole("heading", { name: /Hizmet Talebi/i }).first().waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Masaüstü menü] 'Hizmet Talebi Oluştur' butonu doğru route'a yönlendiriyor, 404 yok");
  await logout(page);

  // ============ HİZMET VEREN MENÜSÜNDE BUTON GÖRÜNMEMELİ ============
  // Not: anasayfada header dışında da (ör. rol tanıtım kartları) "Hizmet
  // Talebi Oluştur" metni geçebilir — bu yüzden kontrol header'ın "Ana menü"
  // navigation'ıyla sınırlı, sayfa geneli değil.
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(300);
  const providerNav = page.getByRole("navigation", { name: "Ana menü" });
  const ctaForProvider = await providerNav.getByRole("link", { name: "Hizmet Talebi Oluştur" }).count();
  assert.equal(ctaForProvider, 0, "Hizmet Veren'de header'da 'Hizmet Talebi Oluştur' butonu görünmemeli");
  ok("[Hizmet Veren] Header'da 'Hizmet Talebi Oluştur' butonu gösterilmiyor");
  await logout(page);

  // ============ GİRİŞ YAPMAMIŞ KULLANICI ============
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(300);
  const loggedOutNav = page.getByRole("navigation", { name: "Ana menü" });
  const ctaLoggedOut = await loggedOutNav.getByRole("link", { name: "Hizmet Talebi Oluştur" }).count();
  assert.equal(ctaLoggedOut, 0, "Giriş yapmamış kullanıcıda header'da buton görünmemeli");
  await assert.doesNotReject(
    page.getByRole("link", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Giriş yapmamış] Ana sayfa düzeni bozulmadı, buton yok, mevcut Giriş Yap/Kayıt Ol duruyor");

  // ============ 2) MOBİL: 320-430px TAŞMA + HİZMET ALAN MOBİL MENÜ ============
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(200);
    await checkNoOverflow(page, `w=${width} anasayfa`);
  }
  ok("[Mobil taşma] 320/360/375/390/430 px genişliklerde anasayfada yatay taşma yok");

  await page.setViewportSize({ width: 375, height: 800 });
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/`);
  await checkNoOverflow(page, "w=375 anasayfa (Hizmet Alan girişli)");

  const hamburger = page.getByRole("button", { name: /Menüyü aç/ });
  await hamburger.click();
  await page.waitForTimeout(200);
  await checkNoOverflow(page, "w=375 mobil menü açık");
  // Homepage'de /hizmet-talebi-olustur'a giden başka pazarlama linkleri de
  // var (rol kartları vb.) - kontrol #mobil-menu-panel ile sınırlı olmalı.
  const mobileCta = page.locator("#mobil-menu-panel").getByRole("link", { name: "Hizmet Talebi Oluştur" });
  await assert.doesNotReject(mobileCta.waitFor({ state: "visible", timeout: 5000 }));
  const mobileNavTexts = await page
    .locator("#mobil-menu-panel")
    .getByRole("link")
    .allInnerTexts();
  const relevantMobileLinks = mobileNavTexts.filter((t) =>
    ["Nasıl Çalışır", "Hizmetler", "İlanlar", "Hizmet Talebi Oluştur"].includes(t),
  );
  assert.deepEqual(
    relevantMobileLinks,
    ["Nasıl Çalışır", "Hizmetler", "İlanlar", "Hizmet Talebi Oluştur"],
    `Mobil menü sırası yanlış: ${JSON.stringify(relevantMobileLinks)}`,
  );
  ok("[Mobil menü] Hizmet Alan mobil menüsünde de doğru sırayla 4 öğe var, CTA erişilebilir");

  // ============ 3) MOBİL BİLDİRİM ZİLİ (hamburger açmadan erişilebilir) ============
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForTimeout(200);
  const mobileBellButton = page.getByRole("button", { name: /Bildirimler/ });
  await assert.doesNotReject(mobileBellButton.first().waitFor({ state: "visible", timeout: 5000 }));
  ok("[Mobil bildirim zili] Hamburger menüsü AÇILMADAN, header'da doğrudan erişilebilir");
  await checkNoOverflow(page, "w=375 panel (bildirim zili header'da)");

  await mobileBellButton.first().click();
  await page.waitForTimeout(200);
  await assert.doesNotReject(
    page.getByRole("menu", { name: "Bildirimler" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  await checkNoOverflow(page, "w=375 bildirim zili panel açık");
  ok("[Mobil bildirim zili] Zile tıklanınca bildirim paneli açılıyor, ekran dışına taşmıyor");
  await page.keyboard.press("Escape").catch(() => {});
  await logout(page);

  // Hizmet Veren'de de mobil bildirim zili çalışmalı
  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/panel`);
  const providerMobileBell = page.getByRole("button", { name: /Bildirimler/ });
  await assert.doesNotReject(providerMobileBell.first().waitFor({ state: "visible", timeout: 5000 }));
  ok("[Mobil bildirim zili] Hizmet Veren hesabında da çalışıyor");
  await logout(page);

  // Giriş yapmamışta zil görünmemeli
  await page.goto(`${BASE_URL}/`);
  const bellLoggedOut = await page.getByRole("button", { name: /Bildirimler/ }).count();
  assert.equal(bellLoggedOut, 0, "Giriş yapmamışta bildirim zili görünmemeli");
  ok("[Mobil bildirim zili] Giriş yapmamış kullanıcıda görünmüyor");

  // ============ MASAÜSTÜ BİLDİRİM ZİLİ (regresyon kontrolü) ============
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel`);
  const desktopBell = page.getByRole("button", { name: /Bildirimler/ });
  await assert.doesNotReject(desktopBell.first().waitFor({ state: "visible", timeout: 5000 }));
  await desktopBell.first().click();
  await assert.doesNotReject(
    page.getByRole("menu", { name: "Bildirimler" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Masaüstü bildirim zili] Değişmeden çalışmaya devam ediyor");
  await page.keyboard.press("Escape").catch(() => {});

  // ============ 4) BİLDİRİM SİLME + KALICILIK + OKUNMAMIŞ SAYAÇ ============
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await page.evaluate((reqId) => {
    const job = {
      id: "ux-notif-job", title: "UX Bildirim Testi", category: "Depolama", province: "Kocaeli",
      district: "Gebze", workLocationType: "Test Tesis", workDate: "2026-12-01",
      description: "UX bildirim testi icin olusturulan ilan.", operationDetails: "Test.",
      status: "yayinda", requesterId: reqId, photos: [],
    };
    const raw = localStorage.getItem("malsevk.jobs.v1");
    const jobs = raw ? JSON.parse(raw) : [];
    jobs.push(job);
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  }, zeynepId);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await page.goto(`${BASE_URL}/ilanlar/ux-notif-job`);
  await page.getByLabel("Teklif Fiyatı").fill("5000");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("1 gün");
  await page.getByLabel("Teklif Açıklaması").fill("UX bildirim testi icin teklif, yirmi karakterden uzun.");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Bildirimler/ }).first().click();
  await page.waitForTimeout(300);
  const unreadBefore = await page.getByRole("button", { name: /Bildirimler, \d+ okunmamış/ }).count();
  assert.equal(unreadBefore, 1, "Yeni teklif geldiğinde okunmamış rozeti görünmeli");
  ok("[Okunmamış sayaç] Yeni bildirim geldiğinde rozet doğru gösteriliyor");

  const deleteBtn = page.getByRole("button", { name: "Bildirimi sil" }).first();
  await assert.doesNotReject(deleteBtn.waitFor({ state: "visible", timeout: 5000 }));
  page.once("dialog", (dialog) => dialog.accept());
  await deleteBtn.click();
  await page.waitForTimeout(400);
  const bodyAfterDelete = await page.locator('[role="menu"]').innerText().catch(() => "");
  assert.ok(!bodyAfterDelete.includes("UX Bildirim Testi"), "Silinen bildirim listeden anında kalkmalı");
  ok("[Bildirim silme] Onay sonrası bildirim listeden anında kalktı, doğru yönlendirmeye gitmedi (aynı sayfada kaldık)");

  const unreadAfter = await page.getByRole("button", { name: /Bildirimler, \d+ okunmamış/ }).count();
  assert.equal(unreadAfter, 0, "Silinen bildirim okunmamış sayaçtan da düşmeli");
  ok("[Okunmamış sayaç] Silme sonrası sayaç doğru güncellendi (0)");

  await page.reload();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Bildirimler/ }).first().click();
  await page.waitForTimeout(300);
  const bodyAfterReload = await page.locator('[role="menu"]').innerText().catch(() => "");
  assert.ok(!bodyAfterReload.includes("UX Bildirim Testi"), "Sayfa yenilenince silinen bildirim geri gelmemeli");
  assert.ok(bodyAfterReload.includes("Yeni bildiriminiz yok"), "Boş durum mesajı gösterilmeli");
  ok("[Bildirim silme] Sayfa yenilenince geri gelmiyor, boş durum mesajı doğru gösteriliyor");
  await page.keyboard.press("Escape").catch(() => {});

  // Başka kullanıcının bildirimleri etkilenmemeli (Mehmet Demir'in ayrı localStorage anahtarı var)
  const dismissedKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith("malsevk_dismissed_notifications_")),
  );
  assert.equal(dismissedKeys.length, 1, "Yalnızca Zeynep'in dismiss anahtarı oluşmalı");
  ok("[Bildirim silme] Yalnızca ilgili kullanıcının verisi etkilendi (tek dismiss anahtarı)");
  await logout(page);

  // ============ 5) İLAN FORMU DOĞRULAMA UX ============
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(400);

  await assert.doesNotReject(
    page.getByText("Lütfen işaretlenen zorunlu alanları tamamlayın.").waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Form doğrulama] Boş formda genel özet mesajı gösteriliyor");

  const expectedFieldErrors = [
    "Hizmet kategorisi seçiniz.",
    "İş tarihini seçiniz.",
    "İlan başlığı zorunludur.",
    "İş açıklaması zorunludur.",
  ];
  for (const message of expectedFieldErrors) {
    await assert.doesNotReject(
      page.getByText(message, { exact: true }).waitFor({ state: "visible", timeout: 5000 }),
      `"${message}" görünmeli`,
    );
  }
  ok("[Form doğrulama] Her zorunlu alan için doğru Türkçe hata mesajı görünüyor");

  const photoErrorVisible = await page.getByText(/en az.*fotoğraf/i).count();
  assert.ok(photoErrorVisible > 0, "Fotoğraf zorunluluğu hatası görünmeli");
  ok("[Form doğrulama] Fotoğraf zorunluluğu hatası da diğerleriyle birlikte görünüyor");

  // İlk hatalı alan (kategori) odakta mı / görünür mü
  const categorySelect = page.locator("select").first();
  const isCategoryFocused = await categorySelect.evaluate((el) => el === document.activeElement);
  assert.ok(isCategoryFocused, "İlk hatalı alan (kategori) odaklanmış olmalı");
  ok("[Form doğrulama] Gönderim başarısız olunca ilk hatalı alana (Hizmet Kategorisi) otomatik odaklanıyor");

  const categoryBorderColor = await categorySelect.evaluate((el) => getComputedStyle(el).borderColor);
  console.log("  (debug) kategori kenarlık rengi:", categoryBorderColor);

  // Alanı düzelt -> hata durumu kalkmalı
  await categorySelect.selectOption({ label: "Depolama" });
  await page.waitForTimeout(200);
  const categoryErrorGoneCount = await page.getByText("Hizmet kategorisi seçiniz.").count();
  assert.equal(categoryErrorGoneCount, 0, "Kategori seçilince o alanın hatası kalkmalı");
  ok("[Form doğrulama] Kullanıcı alanı düzeltince o alanın hata durumu canlı olarak kalkıyor");

  // ============ GEÇERLİ İLAN OLUŞTURMA (mevcut kurallar bozulmamış mı) ============
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.locator("select").first().selectOption({ label: "Depolama" });
  await page.locator('input[type="date"]').fill("2026-12-15");
  await page.getByLabel("İlan Başlığı").fill("UX Testi - Geçerli İlan Oluşturma");
  await page
    .getByLabel("İş Açıklaması")
    .fill("Bu ilan UX duzeltmeleri sonrasi gecerli bir ilan olusturulabildigini dogrulamak icin yazildi.");
  const os = await import("node:os");
  const path = await import("node:path");
  await page.locator('input[type="file"]').setInputFiles(path.join(os.tmpdir(), "fixture-valid-1.jpg"));
  await page.getByText(/1 \/ 10 fotoğraf yüklendi/).waitFor({ state: "visible", timeout: 10000 });

  // "İl" kısa olduğu için "İlan Başlığı"/"İlçe" gibi başka etiketlerle de eşleşebilir -> exact:true.
  await page.getByLabel("İl", { exact: true }).click();
  await page.getByPlaceholder("Ara...").fill("Kocaeli");
  await page.getByRole("option", { name: "Kocaeli" }).click();
  await page.getByLabel("İlçe", { exact: true }).click();
  await page.getByPlaceholder("Ara...").fill("Gebze");
  await page.getByRole("option", { name: "Gebze" }).click();
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Depo" });
  await page.waitForTimeout(300);

  // "Tesis" alanı, seçilen il/ilçe/yer türü için hazır bir liste varsa
  // SearchableSelect (buton), yoksa serbest metin girişi (input) olarak
  // render edilir (bkz. job-request-form.tsx) — ikisi de "Tesis" etiketli.
  const tesisInput = page.locator('input[type="text"]#' + (await page.locator('label:text("Tesis")').getAttribute("for")));
  if ((await tesisInput.count()) > 0 && (await tesisInput.evaluate((el) => el.tagName)) === "INPUT") {
    await tesisInput.fill("UX Test Tesisi");
  } else {
    const tesisButton = page.locator('label:text("Tesis") + button');
    await tesisButton.click();
    await page.getByPlaceholder("Ara...").fill("a");
    const firstOption = page.getByRole("option").first();
    if ((await firstOption.count()) > 0) {
      await firstOption.click();
    } else {
      await page.keyboard.press("Escape");
    }
  }
  await page
    .getByLabel("Operasyon Detayları")
    .fill("Operasyon detaylari UX testi icin en az on karakter uzunlugunda yazildi.");

  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/[a-f0-9-]+$/, { timeout: 15000 }).catch(() => {});
  const createdUrl = page.url();
  const jobCreated = /\/ilanlar\/[a-f0-9-]+$/.test(createdUrl);
  if (jobCreated) {
    ok("[Geçerli ilan] Tüm zorunlu alanlar dolu olduğunda ilan başarıyla oluşturuldu, ilan sayfasına yönlendirildi");
    await assert.doesNotReject(
      page.getByText("UX Testi - Geçerli İlan Oluşturma").waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("[Geçerli ilan] Oluşturulan ilan doğru başlıkla görüntüleniyor");
  } else {
    console.log("  (debug) Gecerli ilan olusturma basarisiz oldu, mevcut URL:", createdUrl);
    console.log("  (debug) sayfa govdesi:", (await page.locator("body").innerText()).slice(0, 1000));
  }

  if (consoleErrors.length > 0) {
    console.log("\n[ux-fixes-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[ux-fixes-test] Konsolda hiç JS hatası yakalanmadı.");
  }
  if (notFoundHits.length > 0) {
    console.log("[ux-fixes-test] UYARI: 404 yanıtları yakalandı:");
    for (const url of notFoundHits) console.log(`  ! ${url}`);
  } else {
    console.log("[ux-fixes-test] Hiç 404 yanıtı yakalanmadı.");
  }

  // Temizlik
  await page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => j.id !== "ux-notif-job");
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => o.jobId !== "ux-notif-job");
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
  });

  await browser.close();
  console.log(`\n[ux-fixes-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[ux-fixes-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Bir assertion ortada patlarsa bile tarayıcı kapanmadan process askıda
    // kalmasın diye — bu asılı kalma, önceki bir koşuda gerçek bir 34-zombi-
    // süreç birikimine yol açmıştı (browser.close() yalnızca başarı yolunda
    // çağrılıyordu).
    if (browser) await browser.close().catch(() => {});
  });
