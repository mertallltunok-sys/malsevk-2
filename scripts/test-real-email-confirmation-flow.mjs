// node scripts/test-real-email-confirmation-flow.mjs
//
// KALICI REGRESYON TESTİ (bkz. CLAUDE.md "tmp-" script konvansiyonu — bu
// dosya BİLEREK o desenin DIŞINDA tutulur, test-customs-documents-and-badges.mjs
// ile aynı gerekçeyle: sabit bir kuralı ileriye dönük korumak için var).
//
// KÖK NEDEN (2026-08-28, gerçek Production kullanıcı raporu): e-posta
// doğrulama linkine tıklandıktan sonra sayfa boş kalıyor/sonsuz yükleniyordu.
// Gerçek nedenler (bu script ikisini de kanıtlar ve kilit altına alır):
//   1. app/auth/confirm/route.ts, yönlendirme origin'ini `request.url`'den
//      türetiyordu — bu değer gerçek Host/X-Forwarded-Host header'ından
//      FARKLI olabilir (yerelde kanıtlandı: 127.0.0.1 host header'ıyla gelen
//      istekte Next.js "localhost" origin raporladı). Sonuç: doğrulama
//      BAŞARILI olsa bile oturum çerezleri bir origin'de, yönlendirme başka
//      bir origin'e gidiyordu — hedef sayfa oturumu hiç göremiyordu. Düzeltme:
//      origin artık APP_BASE_URL'den (zaten var olan, offer-notifications/
//      route.ts'in de kullandığı tek doğruluk kaynağı) türetiliyor.
//   2. E-posta linki, kaydı başlatandan FARKLI bir tarayıcı/cihazda açılırsa
//      (`pkce_code_verifier_not_found`), e-posta GERÇEKTEN doğrulanmış olsa
//      bile o oturum kurulamaz — eskiden bu, yanlış/kafa karıştırıcı bir
//      "süresi dolmuş" hatası gösteriyordu. Düzeltme: bu durumu özel olarak
//      tanıyıp "E-posta adresiniz doğrulandı. Devam etmek için giriş yapın."
//      gösteriyor (bkz. login-form.tsx#emailJustConfirmed).
//
// Gerçek Mailpit e-postasını (Development/local Docker Supabase, ASLA
// Production'a dokunmaz) okur, linki OLDUĞU GİBİ (elle yeniden inşa
// etmeden) kullanır — önceki bir test turunun tam da bu farkı (gerçek
// PKCE `code` akışı vs. elle kurulmuş token_hash linki) kaçırdığı
// belgelenmiştir, bu script kasıtlı olarak o boşluğu kapatır.
//
// Gereksinimler: `npx supabase start` (local Docker), local config.toml'da
// `auth.email.enable_confirmations = true`, uygulama `127.0.0.1:3000`
// üzerinde APP_BASE_URL=http://127.0.0.1:3000 ile çalışıyor olmalı.
import { chromium } from "playwright";

const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
const MAILPIT_URL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + String(detail).slice(0, 200) : ""}`);
}

async function selectSearchable(page, label, optionText) {
  await page.getByLabel(label, { exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

async function getLatestEmailFor(email, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const listResp = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=20`);
    const list = await listResp.json();
    const match = list.messages?.find((m) => m.To?.some((t) => t.Address === email));
    if (match) {
      const msgResp = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      return await msgResp.json();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function extractFirstHref(html) {
  const match = html.match(/href="([^"]+)"/);
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

async function registerAndGetConfirmationHref(browser, { role, email, companyLabel }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page.getByRole("radio", { name: role, exact: true }).check();
  await page.getByLabel("Ad", { exact: true }).fill("Test");
  await page.getByLabel("Soyad", { exact: true }).fill("Kullanıcı");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Telefon Numarası", { exact: true }).fill("+905551119911");
  await page.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Firma Adı", { exact: true }).fill(companyLabel);
  const companyTypeLabel = role === "Hizmet Veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi";
  const companyTypeOptionLabel = role === "Hizmet Veren" ? "Bireysel Hizmet Veren" : "Bireysel";
  await page.getByLabel(companyTypeLabel, { exact: true }).selectOption({ label: companyTypeOptionLabel });

  record(`[${role}] MERSİS alanı kayıt formunda hiç yok`, (await page.getByText(/MERS/i).count()) === 0);
  record(`[${role}] Belge yükleme alanı (input[type=file]) kayıt formunda hiç yok`, (await page.locator('input[type="file"]').count()) === 0);

  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Gebze");
  const legalCheckbox = page.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox.check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();

  const sawEmailWaitScreen = await page.getByText("E-postanızı Kontrol Edin").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  record(`[${role}] 'E-postanızı Kontrol Edin' ekranı gösterildi`, sawEmailWaitScreen);

  const message = await getLatestEmailFor(email);
  record(`[${role}] Gerçek e-posta Mailpit'e ulaştı`, Boolean(message), message ? message.Subject : "e-posta bulunamadı");
  await context.close();
  if (!message) return null;
  const href = extractFirstHref(message.HTML || message.Text || "");
  record(`[${role}] E-posta gövdesinde gerçek doğrulama linki bulundu`, Boolean(href));
  return href;
}

async function main() {
  const browser = await chromium.launch();
  const stamp = Date.now();

  // =========================================================================
  // 1) Hizmet Alan — AYNI context'te gerçek linke tıklama → /kayit-tamamla
  //    → kayıt tamamlama → belge istemeden panele/ilan oluşturmaya erişim.
  // =========================================================================
  const requesterEmail = `test-confirm-req-${stamp}@example.com`;
  const context1 = await browser.newContext();
  const page1 = await context1.newPage();
  await page1.goto(`${APP_ORIGIN}/giris-yap`);
  await page1.getByRole("tab", { name: "Kayıt Ol" }).click();
  await page1.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page1.getByLabel("Ad", { exact: true }).fill("Test");
  await page1.getByLabel("Soyad", { exact: true }).fill("Requester");
  await page1.getByLabel("E-posta", { exact: true }).fill(requesterEmail);
  await page1.getByLabel("Telefon Numarası", { exact: true }).fill("+905551119912");
  await page1.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Şifre Tekrar", { exact: true }).fill(PASSWORD);
  await page1.getByLabel("Firma Adı", { exact: true }).fill("Test Requester Firma");
  await page1.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ label: "Bireysel" });
  await selectSearchable(page1, "İl", "Kocaeli");
  await selectSearchable(page1, "İlçe", "Gebze");
  await page1.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]').check();
  await page1.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page1.getByText("E-postanızı Kontrol Edin").waitFor({ state: "visible", timeout: 10000 });

  const reqMessage = await getLatestEmailFor(requesterEmail);
  record("1a) Hizmet Alan: gerçek e-posta ulaştı", Boolean(reqMessage));
  const reqHref = reqMessage ? extractFirstHref(reqMessage.HTML || reqMessage.Text || "") : null;

  if (reqHref) {
    // AYNI context/tarayıcı sekmesinde tıklama. NOT: aynı context olduğu
    // için pending-registration-draft.ts'in sessionStorage taslağı da bu
    // sekmede mevcuttur — complete-registration-form.tsx'in KADEME 1'i
    // ("otomatik/mutlu yol") devreye girip kaydı ANINDA tamamlayıp
    // doğrudan /panel'e gönderebilir; bu durumda /kayit-tamamla'nın kendi
    // formu HİÇ görünmez (beklenen, DAHA İYİ bir sonuç) - bu yüzden hem
    // /kayit-tamamla hem doğrudan /panel "takılmadı" sayılır.
    await page1.goto(reqHref, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page1.waitForTimeout(1000);
    const stuckOnChecking = await page1.getByText("Kontrol ediliyor...").isVisible().catch(() => false);
    record("1b) Aynı context'te gerçek linke tıklama SONRASI 'Kontrol ediliyor...' ekranında TAKILI KALMADI", !stuckOnChecking, page1.url());
    const landedOnKayitTamamla = new URL(page1.url()).pathname === "/kayit-tamamla";
    const landedOnPanel = new URL(page1.url()).pathname === "/panel";
    record("1c) Aynı context'te gerçek linke tıklama /kayit-tamamla veya (auto-complete ile) doğrudan /panel'e ulaştı", landedOnKayitTamamla || landedOnPanel, page1.url());

    if (landedOnKayitTamamla) {
      record("1d) /kayit-tamamla: MERSİS metni hiç yok", (await page1.getByText(/MERS/i).count()) === 0);
      record("1e) /kayit-tamamla: belge yükleme alanı hiç yok", (await page1.locator('input[type="file"]').count()) === 0);
      const legalCheckbox1 = page1.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
      await legalCheckbox1.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      if ((await legalCheckbox1.count()) > 0) {
        await legalCheckbox1.check();
        await page1.getByRole("button", { name: "Kaydı Tamamla" }).click();
        await page1.waitForURL((url) => url.pathname !== "/kayit-tamamla", { timeout: 10000 }).catch(() => {});
        record("1f) Kayıt tamamlama sonrası panele ulaşıldı (belge istenmedi)", new URL(page1.url()).pathname === "/panel", page1.url());
      }
    } else if (landedOnPanel) {
      record("1d-f) Kayıt otomatik tamamlandı (aynı sekmede sessionStorage taslağı ile), doğrudan panele ulaşıldı - belge/MERSİS adımı hiç görünmedi", true, page1.url());
    }
  }

  // Hizmet Alan: belge yüklemeden ilan oluşturabiliyor mu?
  await page1.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  const onJobForm = new URL(page1.url()).pathname === "/hizmet-talebi-olustur";
  record("1g) Hizmet Alan belge istemeden /hizmet-talebi-olustur'a erişebiliyor", onJobForm, page1.url());
  await context1.close();

  // =========================================================================
  // 2) Hizmet Veren — FARKLI context'te gerçek linke tıklama →
  //    "E-posta adresiniz doğrulandı" mesajı → normal giriş → /kayit-tamamla
  //    → kayıt tamamlama (belgesiz) → /panel/belge-yukleme → belge onayı
  //    engeli.
  // =========================================================================
  const providerEmail = `test-confirm-prov-${stamp}@example.com`;
  const provHref = await registerAndGetConfirmationHref(browser, {
    role: "Hizmet Veren",
    email: providerEmail,
    companyLabel: "Test Provider Firma",
  });

  if (provHref) {
    const context2 = await browser.newContext(); // BİLEREK FARKLI context.
    const page2 = await context2.newPage();
    await page2.goto(provHref, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page2.waitForTimeout(500);
    record(
      "2a) Hizmet Veren: FARKLI context'te linke tıklama → 'E-posta adresiniz doğrulandı' mesajı gösteriliyor (yanlış 'süresi dolmuş' değil)",
      await page2.getByText("E-posta adresiniz doğrulandı").isVisible().catch(() => false),
      page2.url(),
    );

    // Şimdi normal girişle devam.
    await page2.getByLabel("E-posta").fill(providerEmail);
    await page2.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
    await page2.getByRole("button", { name: "Giriş Yap", exact: true }).click();
    await page2.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 }).catch(() => {});
    record("2b) Doğrulama sonrası normal giriş çalışıyor, /kayit-tamamla'ya iniyor", new URL(page2.url()).pathname === "/kayit-tamamla", page2.url());

    if (new URL(page2.url()).pathname === "/kayit-tamamla") {
      record("2c) /kayit-tamamla (Hizmet Veren): belge yükleme alanı hiç yok", (await page2.locator('input[type="file"]').count()) === 0);
      const legalCheckbox2 = page2.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
      await legalCheckbox2.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      if ((await legalCheckbox2.count()) > 0) {
        await legalCheckbox2.check();
        await page2.getByRole("button", { name: "Kaydı Tamamla" }).click();
        await page2.waitForURL((url) => url.pathname !== "/kayit-tamamla", { timeout: 10000 }).catch(() => {});
      }
    }

    // Belge onayı olmadan ilanları görmeye çalışınca engel + doğru link.
    await page2.goto(`${APP_ORIGIN}/ilanlar`);
    await page2.waitForTimeout(1500);
    const belgeLinkVisible = await page2.getByRole("link", { name: /Faaliyet Belgesi/i }).first().isVisible().catch(() => false);
    record("2d) Hizmet Veren belgesiz /ilanlar'da 'Faaliyet Belgesi Yükle' bağlantısı görünüyor", belgeLinkVisible);
    if (belgeLinkVisible) {
      const href = await page2.getByRole("link", { name: /Faaliyet Belgesi/i }).first().getAttribute("href");
      record("2e) 'Faaliyet Belgesi Yükle' bağlantısı doğru sayfaya gidiyor (/panel/belge-yukleme)", Boolean(href && href.includes("/panel/belge-yukleme")), href);
    }
    await context2.close();
  }

  // =========================================================================
  // 3) Bağlantıya İKİNCİ kez tıklama (aynı, artık kullanılmış link) →
  //    sonsuz spinner DEĞİL, anlaşılır sonuç ekranı.
  // =========================================================================
  if (reqHref) {
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();
    await page3.goto(reqHref, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page3.waitForTimeout(500);
    const stuck = await page3.getByText("Kontrol ediliyor...").isVisible().catch(() => false);
    // GoTrue kullanılmış tokeni KENDİSİ reddeder (otp_expired/access_denied) -
    // bu durumda istek /auth/confirm'e hiç gecerli bir code/token_hash ile
    // ULAŞMAZ, route "dogrulama-eksik" dalına düşer - üçü de (eksik/başarısız/
    // doğrulandı) sonsuz spinner OLMAYAN, anlaşılır bir sonuçtur.
    const hasErrorOrSuccess = (await page3.getByText(/doğrulandı|süresi dolmuş|hâlâ|zaten|eksik|geçersiz/i).count()) > 0 || new URL(page3.url()).pathname === "/panel";
    record("3) Aynı linke ikinci tıklamada sonsuz spinner YOK, anlaşılır sonuç/hata gösteriliyor", !stuck && hasErrorOrSuccess, page3.url());
    await context3.close();
  }

  // =========================================================================
  // 4) Callback rotasına eksik/geçersiz parametreyle giriş → sonsuz spinner
  //    YOK, anlaşılır hata.
  // =========================================================================
  const context4 = await browser.newContext();
  const page4 = await context4.newPage();
  await page4.goto(`${APP_ORIGIN}/auth/confirm`);
  await page4.waitForTimeout(500);
  record(
    "4) /auth/confirm parametresiz → 'Doğrulama bağlantısı eksik veya geçersiz.' (sonsuz spinner değil)",
    await page4.getByText("Doğrulama bağlantısı eksik veya geçersiz.").isVisible().catch(() => false),
    page4.url(),
  );

  await page4.goto(`${APP_ORIGIN}/auth/confirm?code=gecersiz-bir-kod-1234`);
  await page4.waitForTimeout(500);
  // NOT: GoTrue icin gecersiz bir code, PKCE code_verifier eslesmesi
  // basarisiz olduguzunda AYNI hata kodunu (pkce_code_verifier_not_found)
  // dondurur - route bu durumu bilerek "farkli cihazda dogrulanmis olabilir"
  // olarak ele alip emailConfirmed mesaji gosterir (guvenlik sorunu degil:
  // gercek giris hala e-posta+sifre gerektirir). Onemli olan: sonsuz spinner
  // OLMAMASI ve anlasilir BIR sonuc (hata YA DA emailConfirmed) gosterilmesi.
  const stuckOnInvalidCode = await page4.getByText("Kontrol ediliyor...").isVisible().catch(() => false);
  const clearResult = (await page4.getByText(/hata|geçersiz|dolmuş|eksik|doğrulandı/i).count()) > 0;
  record(
    "5) /auth/confirm geçersiz code ile → sonsuz spinner YOK, anlaşılır bir sonuç gösteriliyor",
    !stuckOnInvalidCode && clearResult,
    page4.url(),
  );
  await context4.close();

  // =========================================================================
  // 6) Regresyon: oturumsuz /panel koruması, normal giriş/çıkış, şifre
  //    sıfırlama akışı bozulmadı.
  // =========================================================================
  const context5 = await browser.newContext();
  const page5 = await context5.newPage();
  await page5.goto(`${APP_ORIGIN}/panel`);
  record("6a) Oturumsuz /panel → /giris-yap yönlendirmesi bozulmadı", new URL(page5.url()).pathname === "/giris-yap", page5.url());

  await page5.goto(`${APP_ORIGIN}/sifre-sifirla`);
  const forgotPasswordFormVisible = await page5.getByLabel("E-posta").first().isVisible().catch(() => false);
  record("6b) /sifre-sifirla sayfası normal render ediliyor (regresyon)", forgotPasswordFormVisible);
  await context5.close();

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Başarısız:", failed.map((r) => r.name).join("; "));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
