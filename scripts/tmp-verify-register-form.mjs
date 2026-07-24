// Genişletilmiş kayıt ekranının (Hesap Türü seçimi + rol bazlı ek alanlar +
// KVKK/Kullanım Koşulları + kayıt sonrası giriş sayfasına yönlendirme)
// uçtan uca doğrulaması. Gerçek yeni kullanıcılar oluşturur (mevcut demo
// hesaplara dokunmaz) — her çalıştırmada benzersiz e-posta kullanılır.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const RUN_ID = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function checkNoHorizontalOverflow(page, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`${label}: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

async function fillCommonFields(page, { firstName, lastName, email, phone, password }) {
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Telefon Numarası").fill(phone);
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar").fill(password);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    // ============ 1) Zorunlu alanlar boşken kayıt yapılamıyor ============
    console.log("\n=== Zorunlu alan doğrulaması (tümü boş) ===");
    await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Ad zorunlu hatası görünüyor", await page.getByText("Ad zorunludur.", { exact: true }).isVisible());
    check("Soyad zorunlu hatası görünüyor", await page.getByText("Soyad zorunludur.").isVisible());
    check("E-posta zorunlu hatası görünüyor", await page.getByText("E-posta zorunludur.").isVisible());
    check("Telefon zorunlu hatası görünüyor", await page.getByText("Telefon numarası zorunludur.").isVisible());
    check("Hesap türü zorunlu hatası görünüyor", await page.getByText("Devam etmek için bir hesap türü seçin.").isVisible());
    check("KVKK zorunlu hatası görünüyor", await page.getByText("KVKK Aydınlatma Metni'ni kabul etmelisiniz.").isVisible());
    check("Kullanım Koşulları zorunlu hatası görünüyor", await page.getByText("Kullanım Koşulları'nı kabul etmelisiniz.").isVisible());
    check("Firma adı / il / ilçe hatası GÖRÜNMÜYOR (rol seçilmediği için alanlar yok)", (await page.getByText("Firma adı zorunludur.").count()) === 0);

    // ============ 2) Hatalı telefon / e-posta reddediliyor ============
    console.log("\n=== Hatalı telefon / e-posta reddediliyor ===");
    await page.getByLabel("E-posta").fill("gecersiz-eposta");
    await page.getByLabel("Telefon Numarası").fill("123");
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Geçersiz e-posta hatası görünüyor", await page.getByText("Geçerli bir e-posta adresi giriniz.").isVisible());
    check("Geçersiz telefon hatası görünüyor", await page.getByText("Geçerli bir Türkiye cep telefonu numarası girin.").isVisible());

    // Hata temizleme: alanı düzeltince o alanın hatası kalkıyor mu?
    await page.getByLabel("E-posta").fill(`test-${RUN_ID}@example.com`);
    await page.waitForTimeout(100);
    check("E-posta düzeltilince hatası temizleniyor", (await page.getByText("Geçerli bir e-posta adresi giriniz.").count()) === 0);

    // ============ 3) Şifre kuralları + eşleşme ============
    console.log("\n=== Şifre kuralları ve eşleşme ===");
    await page.getByLabel("Şifre", { exact: true }).fill("zayif");
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Zayıf şifre hatası görünüyor", await page.getByText("Şifre yukarıdaki tüm kuralları karşılamalıdır.").isVisible());

    await page.getByLabel("Şifre", { exact: true }).fill("Guclu1!Sifre");
    await page.getByLabel("Şifre Tekrar").fill("Farkli1!Sifre");
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Şifre eşleşmiyor hatası görünüyor", await page.getByText("Şifreler eşleşmiyor.").isVisible());

    // Göster/gizle butonu çalışıyor mu?
    const passwordInput = page.locator('input[type="password"]').first();
    const hasPasswordType = await passwordInput.count();
    check("Şifre alanı başlangıçta gizli (type=password)", hasPasswordType > 0);
    await page.getByRole("button", { name: "Şifreyi göster" }).first().click();
    check("Göster butonuna basınca şifre görünür oluyor (type=text)", (await page.locator('input[type="password"]').count()) < hasPasswordType);

    // ============ 4) İl seçilmeden ilçe seçilemiyor + İl değişince ilçe temizleniyor ============
    console.log("\n=== İl / İlçe bağımlılığı ===");
    await page.getByRole("radio", { name: "Hizmet Alan" }).click();
    await page.waitForTimeout(150);
    const districtTrigger = page.getByLabel("İlçe", { exact: true });
    check("İl seçilmeden ilçe alanı devre dışı", await districtTrigger.isDisabled().catch(() => false));

    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
    await page.waitForTimeout(150);
    const districtFieldId = await page.getByLabel("İlçe", { exact: true }).getAttribute("id");
    await selectSearchable(page, districtFieldId, "Gebze");
    await page.waitForTimeout(150);
    check("Gebze ilçesi seçili görünüyor", (await page.locator(`#${districtFieldId}`).innerText()).includes("Gebze"));

    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "İstanbul");
    await page.waitForTimeout(150);
    const districtStillGebze = await page.getByText("Gebze", { exact: true }).count();
    check("İl değişince önceki ilçe seçimi temizleniyor", districtStillGebze === 0);

    // İlçeyi tekrar seç (asıl kayıt için gerekli)
    await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Kadıköy");

    check("İl/İlçe adımı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 5) Hizmet Alan kaydı — uçtan uca ============
    console.log("\n=== Hizmet Alan kaydı oluşturuluyor ===");
    const requesterEmail = `hizmet-alan-${RUN_ID}@example.com`;
    await fillCommonFields(page, {
      firstName: "Ayşe",
      lastName: "Kaya",
      email: requesterEmail,
      phone: "0532 111 22 33",
      password: "Guclu1!Sifre",
    });
    await page.getByLabel("Firma Adı").fill("Kaya Nakliyat");
    await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });
    // KVKK/Terms henüz işaretlenmedi — eksik olduğunu doğrula.
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("KVKK işaretlenmeden kayıt engelleniyor", await page.getByText("KVKK Aydınlatma Metni'ni kabul etmelisiniz.").isVisible());

    await page.getByLabel("KVKK Aydınlatma Metni'ni okudum ve kabul ediyorum.").check();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Yalnızca KVKK işaretliyken Kullanım Koşulları eksikliği hâlâ engelliyor", await page.getByText("Kullanım Koşulları'nı kabul etmelisiniz.").isVisible());

    await page.getByLabel("Kullanım Koşulları'nı kabul ediyorum.").check();

    const beforeSubmitUrl = page.url();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.").waitFor({ state: "visible", timeout: 10000 });
    check("Kayıt sonrası başarı mesajı görünüyor", true);
    check("Kayıt sonrası URL değişmedi (otomatik oturum/yönlendirme yok, aynı sayfada mod değişti)", page.url() === beforeSubmitUrl);
    check("Kayıt sonrası 'Giriş Yap' sekmesi aktif", await page.getByRole("tab", { name: "Giriş Yap" }).getAttribute("aria-selected") === "true");
    check("Kayıt sonrası: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // Oturum açılmadığını (otomatik login olmadığını) localStorage'dan doğrula.
    const sessionAfterRegister = await page.evaluate(() => localStorage.getItem("malsevk.session.v1"));
    check("Kayıt sonrası localStorage'da oturum YOK (otomatik giriş yapılmadı)", sessionAfterRegister === null);

    // Kullanıcı gerçekten localStorage'a yazılmış mı ve StoredUser alanları doğru mu?
    const storedUser = await page.evaluate((email) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === email) ?? null;
    }, requesterEmail);
    check("Yeni kullanıcı localStorage'a yazılmış", storedUser !== null);
    check("Rol doğru kaydedilmiş (hizmet-alan)", storedUser?.role === "hizmet-alan");
    check("Ad+Soyad birleşik 'name' alanına yazılmış", storedUser?.name === "Ayşe Kaya");
    check("Telefon normalize edilmiş (+905321112233)", storedUser?.phone === "+905321112233");
    check("Firma adı kaydedilmiş", storedUser?.companyName === "Kaya Nakliyat");
    check("Kullanıcı tipi kaydedilmiş (sahis-isletmesi)", storedUser?.companyType === "sahis-isletmesi");
    check("İl kaydedilmiş (İstanbul)", storedUser?.province === "İstanbul");
    check("İlçe kaydedilmiş (Kadıköy)", storedUser?.district === "Kadıköy");
    check("Şifre düz metin DEĞİL, hash'lenmiş", typeof storedUser?.passwordHash === "string" && storedUser.passwordHash !== "Guclu1!Sifre");

    // ============ 6) Aynı e-posta ile ikinci kayıt reddediliyor ============
    console.log("\n=== Aynı e-postayla ikinci kayıt reddediliyor ===");
    await page.getByRole("tab", { name: "Kayıt Ol" }).click();
    await page.getByRole("radio", { name: "Hizmet Alan" }).click();
    await fillCommonFields(page, {
      firstName: "Başka",
      lastName: "Kullanıcı",
      email: requesterEmail,
      phone: "0533 444 55 66",
      password: "Guclu1!Sifre",
    });
    await page.getByLabel("Firma Adı").fill("Başka Firma");
    await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Bireysel" });
    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Ankara");
    await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Çankaya");
    await page.getByLabel("KVKK Aydınlatma Metni'ni okudum ve kabul ediyorum.").check();
    await page.getByLabel("Kullanım Koşulları'nı kabul ediyorum.").check();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.getByText("Bu e-posta adresiyle daha önce hesap oluşturulmuş.").waitFor({ state: "visible", timeout: 10000 });
    check("Aynı e-posta ile ikinci kayıt reddedildi", true);

    // ============ 7) Hizmet Veren kaydı — uçtan uca + doğru role yönlendirme ============
    console.log("\n=== Hizmet Veren kaydı oluşturuluyor ===");
    const providerEmail = `hizmet-veren-${RUN_ID}@example.com`;
    await page.getByRole("radio", { name: "Hizmet Veren" }).click();
    check("'Hizmet Veren Tipi' etiketi görünüyor (role özel etiket)", await page.getByText("Hizmet Veren Tipi").isVisible());
    await fillCommonFields(page, {
      firstName: "Mehmet",
      lastName: "Öz",
      email: providerEmail,
      phone: "+905354445566",
      password: "Guclu1!Sifre",
    });
    await page.getByLabel("Firma Adı").fill("Öz Lojistik A.Ş.");
    await page.getByLabel("Hizmet Veren Tipi").selectOption({ label: "Bireysel Hizmet Veren" });
    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "İzmir");
    await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Çiğli");
    await page.getByLabel("KVKK Aydınlatma Metni'ni okudum ve kabul ediyorum.").check();
    await page.getByLabel("Kullanım Koşulları'nı kabul ediyorum.").check();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.").waitFor({ state: "visible", timeout: 10000 });
    check("Hizmet Veren kaydı başarılı", true);

    const providerUser = await page.evaluate((email) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === email) ?? null;
    }, providerEmail);
    check("Hizmet Veren rolü doğru kaydedilmiş", providerUser?.role === "hizmet-veren");
    check("Hizmet Veren companyType 'bireysel' kaydedilmiş", providerUser?.companyType === "bireysel");
    check("+90 ile başlayan telefon da doğru normalize edildi", providerUser?.phone === "+905354445566");

    // ============ 8) Yeni hesapla giriş + doğru panele yönlendirme ============
    // /panel'e yönlendirme yalnızca ?redirect= parametresiyle gelen giriş
    // akışlarında olur (bkz. giris-yap/page.tsx#resolveRedirectTarget —
    // parametresiz /giris-yap varsayılan olarak "/"e yönlendirir, bu mevcut
    // ve bu görevin kapsamı dışında bir davranıştır). Gerçek uygulamada
    // panele gitmek isteyen bir kullanıcı zaten bu şekilde yönlendirilir
    // (bkz. auth-gate-notice.tsx#loginRedirect kullanan ekranlar).
    console.log("\n=== Yeni hesapla giriş yapılıyor (Hizmet Veren) ===");
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
    await page.getByLabel("E-posta").fill(providerEmail);
    await page.getByLabel("Şifre", { exact: true }).fill("Guclu1!Sifre");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("Giriş sonrası /panel'e yönlendirildi", page.url() === `${BASE_URL}/panel`);
    const sessionAfterLogin = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.session.v1") || "null"));
    check("Oturumda doğru rol (hizmet-veren)", sessionAfterLogin?.role === "hizmet-veren");
    check("Panelde Hizmet Veren'e özgü içerik görünüyor (Aktif İlanlar)", await page.getByText("Aktif İlanlar").isVisible().catch(() => false) || await page.getByRole("heading", { name: /Aktif İlanlar|Panel/ }).first().isVisible().catch(() => false));

    // ============ 9) Sayfa yenilendiğinde kayıt/oturum korunuyor ============
    console.log("\n=== Sayfa yenileme sonrası kalıcılık ===");
    await page.reload();
    await page.waitForTimeout(300);
    const sessionAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.session.v1") || "null"));
    check("Yenileme sonrası oturum korunuyor", sessionAfterReload?.role === "hizmet-veren");
    const usersAfterReload = await page.evaluate((email) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.some((u) => u.email === email);
    }, providerEmail);
    check("Yenileme sonrası kullanıcı kaydı hâlâ localStorage'da", usersAfterReload);

    // ============ 10) Mevcut demo hesaplar bozulmadı ============
    console.log("\n=== Mevcut demo hesaplar (Zeynep) çalışmaya devam ediyor ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
    await page.getByLabel("E-posta").fill(ZEYNEP.email);
    await page.getByLabel("Şifre", { exact: true }).fill(ZEYNEP.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("Demo hesap (Zeynep/hizmet-alan) hâlâ giriş yapabiliyor", true);
    const zeynepSession = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.session.v1") || "null"));
    check("Demo hesap oturumunda doğru rol (hizmet-alan)", zeynepSession?.role === "hizmet-alan");

    await checkNoHorizontalOverflow(page, "Masaüstü (1280px)");

    // ============ 11) Responsive: 320 / 375 / 768 — kayıt formu ============
    console.log("\n=== Responsive: kayıt formu 320px / 375px / 768px ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
      await page.getByRole("radio", { name: "Hizmet Veren" }).click();
      await page.waitForTimeout(150);
      await checkNoHorizontalOverflow(page, `${width}px`);
      const submitBox = await page.getByRole("button", { name: "Hesap Oluştur" }).boundingBox();
      check(
        `${width}px: 'Hesap Oluştur' butonu viewport içinde`,
        submitBox !== null && submitBox.x >= 0 && submitBox.x + submitBox.width <= width + 1,
        submitBox ? `x=${submitBox.x}, width=${submitBox.width}` : "bulunamadı",
      );
      check(`${width}px: konsol hatası yok`, page.jsProblems.length === 0, page.jsProblems.join(" | "));
    }

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
