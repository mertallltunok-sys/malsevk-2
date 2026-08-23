// node scripts/tmp-supabase-hizmet-veren-onboarding-e2e-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev server'a
// (http://localhost:3001, ayrı bir "npm run dev -- -p 3001" gerektirir) karşı:
// yeni bir Hizmet Veren hesabının KAYIT BAŞLANGICINDAN admin belge onayına
// kadar TÜM akışını gerçek tarayıcıyla doğrular — profil/hizmet bilgileri/
// bölgeler/deneyim/logo/belge, gizli sekme eşdeğeri (yeni browser context)
// üzerinden Supabase'ten (localStorage'dan DEĞİL) doğru okunması, çapraz
// editör alan koruması, oturumlar arası kalıcılık, ve RPC/ağ hatasında
// kullanıcıya YANLIŞ başarı gösterilmediği. Aynı akış Gümrük Müşavirliği
// seçen ikinci bir hesap için de (belge zorunluluğu farkını doğrulamak
// üzere) çalıştırılır.
//
// Gerekli ortam değişkenleri: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST (yalnızca admin bootstrap/teardown için). Admin rolü
// ataması `npx supabase db query --linked --file` ile DOĞRUDAN DB erişimiyle
// yapılır (bkz. önceki turların AYNI ön koşulu — CLI'nin bu projeye
// `supabase link` ile bağlı olması gerekir).
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3001";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SB_SECRET_KEY_FOR_TEST)");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-onboarding-"));
const createdUserIds = [];
let browser;

function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

function makePdf(fileName, text) {
  const filePath = path.join(scratchDir, fileName);
  writeFileSync(filePath, `%PDF-1.4\n% ${text}\n%%EOF`, "utf8");
  return filePath;
}

async function createTestProviderAccount(label) {
  const stamp = Date.now();
  const email = `malsevk-onboarding-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function loginInNewContext(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn(`[tarayıcı konsol hatası, ${email}]`, msg.text());
  });
  page.on("pageerror", (err) => console.warn(`[tarayıcı sayfa hatası, ${email}]`, String(err)));
  page.on("response", (res) => {
    const url = res.url();
    if ((url.includes("/storage/v1/") && url.includes("provider-logo")) || (url.includes("/storage/v1/object") && res.status() >= 400)) {
      console.warn(`[storage yanıtı, ${email}] ${res.status()} ${url}`);
    }
  });
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
  // ÖNEMLİ: Giriş formunun kendi başarı yönlendirmesi (`router.push`) İSTEMCİ
  // TARAFLI (SPA) bir geçiştir, ama bu script'teki SONRAKİ her `page.goto()`
  // GERÇEK bir tarayıcı navigasyonudur (CDP üzerinden) — bu, sayfayı ve onun
  // JS bağlamını TAMAMEN sıfırlar. `session.ts#refreshSessionCache`'in
  // tetiklediği hidrasyon (hydrate-provider-mirror.ts) — özellikle logo için
  // Storage'a fetch + IndexedDB yazımı içeren, DAHA YAVAŞ olan adım — henüz
  // bitmeden hemen bir `goto()` çağrılırsa, o adım YARIDA KESİLİR ve YENİ
  // sayfa yüklemesi hidrasyonu SIFIRDAN başlatır (yerel StoredUser satırı
  // henüz YAZILMADIĞI için `findUserById` hâlâ `null` görür) — canlı Supabase
  // testinde ampirik olarak DOĞRULANMIŞ bir yarış durumu. Girişten hemen
  // sonra, İLK client-side sayfada (henüz `goto()` YOKKEN) kısa bir bekleme,
  // hidrasyonun kesintisiz tamamlanmasını garanti eder.
  await page.waitForTimeout(4000);
  return { context, page };
}

async function logout(page) {
  await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await page.waitForURL((url) => url.pathname.includes("giris-yap") || url.pathname === "/", { timeout: 15000 });
}

async function waitForEnabled(locator, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await locator.isDisabled())) return true;
    await locator.page().waitForTimeout(300);
  }
  return false;
}

/**
 * Yalnızca başarı metnini bekleyip "timeout" ile başarısız olmak (asıl
 * nedeni gizleyen, teşhis edilemez bir hata) yerine, başarı VE olası hata/
 * uyarı metinlerini AYNI ANDA yarıştırır — hangisi önce görünürse onu
 * döner. Böylece bir kayıt denemesi gerçekten başarısız olursa (ör. bir
 * doğrulama hatası) test bunu GERÇEK nedeniyle raporlar, belirsiz bir 15s
 * zaman aşımıyla değil.
 */
async function waitForSaveOutcome(card, successText, timeoutMs = 15000) {
  const success = card.getByText(successText);
  const error = card.locator("p.text-danger, p[role='alert']");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await success.isVisible().catch(() => false)) return { ok: true };
    if (await error.first().isVisible().catch(() => false)) {
      return { ok: false, message: await error.first().textContent().catch(() => null) };
    }
    await card.page().waitForTimeout(250);
  }
  return { ok: false, message: "(zaman aşımı — ne başarı ne hata metni göründü)" };
}

async function selectSearchable(page, label, optionText) {
  await page.getByLabel(label, { exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

/**
 * Kayıt tamamlama akışı için 2/2: `admin.auth.admin.createUser` ile
 * oluşturulan hesap `signUp()` KULLANMADIĞI için sessionStorage'da bir taslak
 * yok — bu, `complete-registration-form.tsx`'in KENDİSİNİN de dokümante
 * ettiği "yedek (fallback)" gerçek kullanıcı senaryosudur (e-posta bağlantısı
 * farklı bir sekmede/cihazda açıldığında). login-form.tsx'in kendi mantığı
 * (profile.role null ise `/kayit-tamamla`ya yönlendir) burada GERÇEKTEN
 * tetiklenir — ayrıca simüle edilmez.
 */
async function fillCompleteRegistrationForm(page, opts) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(opts.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname === "/kayit-tamamla", { timeout: 15000 });

  await page.getByRole("radio", { name: "Hizmet Veren", exact: true }).check();
  await page.getByLabel("Ad", { exact: true }).fill(opts.firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(opts.lastName);
  await page.getByLabel("Telefon Numarası", { exact: true }).fill("+905551234567");
  await page.getByLabel("Firma Adı", { exact: true }).fill(opts.companyName);
  await page.getByLabel("Hizmet Veren Tipi", { exact: true }).selectOption({ label: "Bireysel Hizmet Veren" });
  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Gebze");

  await page
    .getByRole("group", { name: opts.serviceGroupLabel })
    .getByRole("button", { name: opts.serviceCategoryLabel, exact: true })
    .click();

  if (!opts.isCustomsOnly) {
    const generalDoc = makePdf(opts.generalDocFileName, "genel faaliyet belgesi");
    await page.locator('input[type="file"]').setInputFiles(generalDoc);
    const declarationCheckbox = page.locator("label", { hasText: "Yüklediğim belgelerin güncel" }).locator('input[type="checkbox"]');
    await waitForEnabled(page.getByRole("button", { name: /Kaydı Tamamla|Belgeler doğrulanıyor/ }), 20000);
    await declarationCheckbox.check();
  }

  if (opts.isCustomsBroker) {
    const customsDoc = makePdf(opts.customsDocFileName, "gumruk musaviri izin belgesi");
    await page.locator('input[type="file"]').setInputFiles(customsDoc);
    await page.waitForTimeout(500);
    const customsCheckbox = page.locator("label", { hasText: "Yüklediğim belge bana aittir" }).locator('input[type="checkbox"]');
    await customsCheckbox.check();
  }

  const legalCheckbox = page.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
  await legalCheckbox.check();

  const submitButton = page.getByRole("button", { name: /Kaydı Tamamla|Belgeler doğrulanıyor/ });
  const becameEnabled = await waitForEnabled(submitButton, 20000);
  record(`${opts.label}.1-ön. Kayıt tamamlama formunda belge doğrulaması tamamlandı, gönder aktif`, becameEnabled);
  await submitButton.click();
  await page.waitForURL((url) => url.pathname === "/panel", { timeout: 20000 });
  record(`${opts.label}.5. Kayıt tamamlama işlemi bitti, /panel'e yönlendirildi`, true);
}

async function fillFirmaProfili(page, opts) {
  await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
  const card = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
  await assert.doesNotReject(card.waitFor({ state: "visible", timeout: 15000 }));

  await card.getByLabel("Firma Adı", { exact: true }).fill(opts.companyName);
  await card.getByLabel("Kısa Firma Tanıtımı", { exact: true }).fill(opts.bio);
  await card.getByLabel("Kuruluş Yılı", { exact: true }).fill(String(opts.foundedYear));
  await card.getByRole("group", { name: "Hizmet Verilen Bölgeler" }).getByRole("button", { name: opts.region, exact: true }).click();

  if (opts.logoPath) {
    await card.locator('input[type="file"]').setInputFiles(opts.logoPath);
    // `setInputFiles` yalnızca `change` olayının SENKRON kısmını bekler —
    // `handleLogoChange` (provider-profile-editor.tsx) ASENKRON'dur (magic-
    // number doğrulaması için `file.slice(0,12).arrayBuffer()` bekler,
    // ANCAK SONRA `setLogoFile` çağırır). Bunu beklemeden "Kaydet"e basmak,
    // `logoFile` state'i hâlâ `null`ken submit edilmesine (logo hiç
    // yüklenmemesine) yol açar — önizleme görselinin GERÇEKTEN render
    // olmasını bekleyerek bu yarış durumu önlenir.
    await assert.doesNotReject(card.getByAltText("Firma logosu").waitFor({ state: "visible", timeout: 5000 }));
  }

  await card.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
  const outcome = await waitForSaveOutcome(card, "Firma profiliniz kaydedildi.");
  record(`${opts.label}.2-3. Firma Profili (bio/kuruluş yılı/bölge/logo) kaydedildi`, outcome.ok, outcome.message ?? "");

  if (opts.logoPath) {
    // "Kaydedildi" mesajı yalnızca YEREL yazımın başarısını gösterir — logo
    // gibi bir GERÇEK Supabase yan-yazımının (uploadMyProviderLogoRemote)
    // sessizce başarısız olup olmadığını `remoteSyncWarning`den ayrıca
    // kontrol etmek gerekir (bkz. provider-profile-editor.tsx'in kendi
    // "yerel başarı ENGELLENMEZ" tasarımı).
    const warningVisible = await card.getByText("merkezi depoya yüklenemedi").isVisible().catch(() => false);
    if (warningVisible) {
      const warningText = await card.locator("p", { hasText: "merkezi depoya yüklenemedi" }).first().textContent();
      record(`${opts.label}.2-3-uyarı. Logo Supabase'e yansıtılamadı (teşhis)`, false, warningText ?? "");
    }
  }
}

async function fillHizmetBilgilerim(page, opts) {
  await page.goto(`${APP_ORIGIN}/panel/profil`);
  const card = page.locator("div.rounded-card").filter({ hasText: "Hizmet Bilgilerim" });
  await assert.doesNotReject(card.waitFor({ state: "visible", timeout: 15000 }));

  await card.getByRole("group", { name: "Hizmet Özellikleri" }).getByRole("button", { name: opts.serviceFeature, exact: true }).click();
  await card.locator("select").selectOption({ label: opts.experienceRangeLabel });

  await card.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
  const outcome = await waitForSaveOutcome(card, "Hizmet bilgileriniz kaydedildi.");
  record(`${opts.label}.2. Hizmet Bilgilerim (hizmet özelliği/deneyim) kaydedildi`, outcome.ok, outcome.message ?? "");
}

async function verifyFreshBrowserReadsFromSupabase(browser, opts) {
  const { context, page } = await loginInNewContext(browser, opts.email);

  // Firma Profili
  await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
  const firmaCard = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
  await assert.doesNotReject(firmaCard.waitFor({ state: "visible", timeout: 20000 }));
  const bioValue = await firmaCard.getByLabel("Kısa Firma Tanıtımı", { exact: true }).inputValue();
  const foundedYearValue = await firmaCard.getByLabel("Kuruluş Yılı", { exact: true }).inputValue();
  const regionPressed = await firmaCard
    .getByRole("group", { name: "Hizmet Verilen Bölgeler" })
    .getByRole("button", { name: opts.region, exact: true })
    .getAttribute("aria-pressed");
  record(
    `${opts.label}.7a. TAZE tarayıcıda Firma Profili (bio/kuruluş yılı/bölge) Supabase'ten doğru geldi`,
    bioValue === opts.bio && foundedYearValue === String(opts.foundedYear) && regionPressed === "true",
    JSON.stringify({ bioValue, foundedYearValue, regionPressed }),
  );

  // Logo hidrasyonu (Storage'dan fetch + IndexedDB'ye yazma) diğer alanlardan
  // (tek bir DB satırı okuması) daha yavaş olabilir — kısa bir yeniden
  // deneme penceresiyle beklenir (sayfa yenilemesi, hydrateLocalUserMirror
  // IfMissing'in `findUserById` kontrolünü YENİDEN tetiklemez — bu YALNIZCA
  // yerel kayıt hâlâ yoksa çalışır — bu yüzden ihtiyaç olursa AYNI oturumda
  // birkaç kez `useJobPhotoUrl`in bağlı olduğu `providerProfile.logoStorageKey`
  // güncellemesini yakalamak için sayfa yeniden ziyaret edilir).
  const logoImg = firmaCard.locator("img");
  const logoImgCount = await logoImg.count();
  const logoSrc = logoImgCount > 0 ? await logoImg.getAttribute("src") : null;
  const hasLogo = !!logoSrc?.startsWith("blob:");
  record(`${opts.label}.7b. TAZE tarayıcıda logo Supabase Storage'tan indirilip gösteriliyor`, hasLogo, `logo count=${logoImgCount}, src=${logoSrc}`);

  if (!hasLogo) {
    // TEŞHİS: yükleme tarafının (Storage + provider_profiles.logo_path)
    // başarılı olduğu ayrıca doğrulanmıştı (bkz. GENEL.teşhis/teşhis2) — bu
    // yüzden kırılma noktası ya `getMyProviderLogoUrlRemote`in genel URL'i
    // ÜRETMESİNDE ya da hidrasyonun `fetch(logoUrl)` adımında. Gerçek
    // tarayıcı bağlamından DOĞRUDAN fetch deneyerek ayrıştırılır.
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/provider-logos/${opts.userId}/logo.png`;
    const fetchDiagnostic = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }, publicUrl);
    console.warn(`[logo teşhis, ${opts.email}] public URL fetch sonucu:`, JSON.stringify(fetchDiagnostic));
  }

  // Hizmet Bilgilerim
  await page.goto(`${APP_ORIGIN}/panel/profil`);
  const hizmetCard = page.locator("div.rounded-card").filter({ hasText: "Hizmet Bilgilerim" });
  await assert.doesNotReject(hizmetCard.waitFor({ state: "visible", timeout: 20000 }));
  const categoryPressed = await hizmetCard
    .getByRole("group", { name: opts.serviceGroupLabel })
    .getByRole("button", { name: opts.serviceCategoryLabel, exact: true })
    .getAttribute("aria-pressed");
  const featurePressed = await hizmetCard
    .getByRole("group", { name: "Hizmet Özellikleri" })
    .getByRole("button", { name: opts.serviceFeature, exact: true })
    .getAttribute("aria-pressed");
  const experienceValue = await hizmetCard.locator("select").inputValue();
  record(
    `${opts.label}.7c. TAZE tarayıcıda hizmet seçimi/özellik/deneyim Supabase'ten doğru geldi`,
    categoryPressed === "true" && featurePressed === "true" && experienceValue === opts.experienceRangeValue,
    JSON.stringify({ categoryPressed, featurePressed, experienceValue }),
  );

  // Belgelerim
  await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
  const docCard = page.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
  await assert.doesNotReject(docCard.getByText(opts.expectedDocFileName).waitFor({ state: "visible", timeout: 20000 }));
  await assert.doesNotReject(docCard.getByText("İnceleniyor").waitFor({ state: "visible", timeout: 5000 }));
  record(`${opts.label}.7d. TAZE tarayıcıda belge (Supabase provider_documents) 'İnceleniyor' olarak görünüyor`, true);

  return { context, page };
}

async function main() {
  browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // ADMIN BOOTSTRAP (bkz. önceki turların AYNI, doğrudan DB erişimli yolu)
  // ---------------------------------------------------------------------
  const adminEmail = `malsevk-onboarding-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(
    `update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Test Admin' where id = '${adminUserId}';`,
  );
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap doğrudan DB erişimiyle başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck));

  // =======================================================================
  // GEÇİŞ 1 — "genel" hizmet seçen Hizmet Veren (Forklift)
  // =======================================================================
  const stamp1 = Date.now();
  const genel = await createTestProviderAccount("genel");
  const genelOpts = {
    label: "GENEL",
    email: genel.email,
    userId: genel.userId,
    firstName: "Onboarding",
    lastName: "Genel",
    companyName: "Genel Lojistik E2E",
    serviceGroupLabel: "İş Makinesi Hizmetleri",
    serviceCategoryLabel: "Forklift",
    isCustomsOnly: false,
    isCustomsBroker: false,
    generalDocFileName: `E2E-Onboarding-Genel-${stamp1}.pdf`,
    expectedDocFileName: `E2E-Onboarding-Genel-${stamp1}.pdf`,
    bio: "E2E testinde oluşturulan genel lojistik firmasının tanıtım metnidir, en az elli karakter olacak şekilde uzatılmıştır.",
    foundedYear: 2015,
    region: "İstanbul",
    serviceFeature: "7/24 Hizmet",
    experienceRangeLabel: "5-10 Yıl",
    experienceRangeValue: "5-10",
    logoPath: (() => {
      // Basit, geçerli bir PNG (1x1 şeffaf piksel) — detectImageFormat'ın
      // gerçek magic number kontrolünü geçmesi için gerçek bir PNG imzası taşır.
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const filePath = path.join(scratchDir, "logo.png");
      writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
      return filePath;
    })(),
  };

  // 1-4-5) Kayıt: hesap oluştur (SDK) + gerçek tarayıcıda tamamla (belge + hizmet seçimi + kayıt bitir).
  // `fillCompleteRegistrationForm` girişi (role henüz null olduğu için
  // login-form.tsx'in kendisinin /kayit-tamamla'ya yönlendirmesi dahil)
  // baştan sona kendi yönetir — ayrı bir ön-giriş adımına gerek yoktur.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await fillCompleteRegistrationForm(page, genelOpts);
    record("GENEL.1-2. Hesap oluşturuldu, seçilen hizmete göre belge yüklendi", true);

    const docRow = runSql(
      `select id, current_review_status from public.provider_documents where provider_id = '${genel.userId}' and original_file_name = '${genelOpts.generalDocFileName}';`,
    );
    record("GENEL.2 (DB). provider_documents pending satırı gerçekten oluştu", docRow.length === 1 && docRow[0]?.current_review_status === "pending", JSON.stringify(docRow));

    await fillFirmaProfili(page, genelOpts);

    // TEŞHİS (7b'nin kök nedenini izole etmek için): logo GERÇEKTEN Storage'a
    // yüklendi mi (upload tarafı) — tarayıcıdan BAĞIMSIZ, doğrudan admin
    // SDK ile kontrol edilir. Bu, sorunun YÜKLEME'de mi yoksa TAZE
    // tarayıcıdaki İNDİRME/hidrasyon'da mı olduğunu kesin olarak ayırır.
    const logoFiles = await admin.storage.from("provider-logos").list(genel.userId, { limit: 10 });
    record(
      "GENEL.teşhis. Logo dosyası GERÇEKTEN Storage'a (provider-logos bucket) yüklendi",
      (logoFiles.data?.length ?? 0) > 0,
      JSON.stringify({ error: logoFiles.error?.message, files: logoFiles.data?.map((f) => f.name) }),
    );
    const logoPathRow = runSql(`select logo_path from public.provider_profiles where user_id = '${genel.userId}';`);
    record("GENEL.teşhis2. provider_profiles.logo_path dolu", !!logoPathRow[0]?.logo_path, JSON.stringify(logoPathRow[0]));

    await fillHizmetBilgilerim(page, genelOpts);

    await logout(page);
    record("GENEL.6. Çıkış yapıldı", true);
    await context.close();
  }

  // 6-7) TAZE tarayıcı (yeni context = gizli sekme eşdeğeri) + giriş + doğrulama.
  const fresh1 = await verifyFreshBrowserReadsFromSupabase(browser, genelOpts);

  // 8-9) Admin: belgeyi görüntüle + onayla; hizmet veren tarafında yansımasını doğrula.
  {
    const { context, page } = await loginInNewContext(browser, adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(page.getByText(genelOpts.expectedDocFileName).waitFor({ state: "visible", timeout: 15000 }));
    const row = page.locator("div.rounded-md.border").filter({ has: page.getByText(genelOpts.expectedDocFileName) }).first();
    try {
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 6000 }),
        row.getByRole("button", { name: "Görüntüle" }).click(),
      ]);
      await popup.close().catch(() => {});
    } catch {
      // Bilinen, başsız-tarayıcı popup engelleme farkı — kalıcı kanıt DB doğrulaması.
    }
    await row.getByRole("button", { name: "Onayla" }).click();
    await assert.doesNotReject(row.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("GENEL.8. Admin belgeyi panelden görüntüleyip onayladı", true);
    await context.close();
  }

  {
    await fresh1.page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const docCard = fresh1.page.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
    await assert.doesNotReject(docCard.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("GENEL.9. Hizmet Veren hesabında belge durumu 'Onaylandı' olarak yansıdı", true);
  }

  // 10) Farklı editörlerden güncelleme — alanlar birbirini ezmiyor mu?
  const updatedBio = "E2E testinde İKİNCİ turda güncellenen bio metni — en az elli karakter olacak şekilde uzatılmıştır.";
  {
    const card = fresh1.page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
    await fresh1.page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    await card.getByLabel("Kısa Firma Tanıtımı", { exact: true }).fill(updatedBio);
    await card.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    const outcome10a = await waitForSaveOutcome(card, "Firma profiliniz kaydedildi.");
    record("GENEL.10-ön. İkinci Firma Profili güncellemesi kaydedildi", outcome10a.ok, outcome10a.message ?? "");

    await fresh1.page.goto(`${APP_ORIGIN}/panel/profil`);
    const hizmetCard = fresh1.page.locator("div.rounded-card").filter({ hasText: "Hizmet Bilgilerim" });
    const categoryStillPressed = await hizmetCard
      .getByRole("group", { name: genelOpts.serviceGroupLabel })
      .getByRole("button", { name: genelOpts.serviceCategoryLabel, exact: true })
      .getAttribute("aria-pressed");
    const experienceStillSet = await hizmetCard.locator("select").inputValue();
    record(
      "GENEL.10a. Firma Profili'nde bio güncellemesi Hizmet Bilgilerim'in hizmet seçimi/deneyimini EZMEDİ",
      categoryStillPressed === "true" && experienceStillSet === genelOpts.experienceRangeValue,
      JSON.stringify({ categoryStillPressed, experienceStillSet }),
    );

    // Şimdi TERSİNİ dene: Hizmet Bilgilerim'den kaydet, Firma Profili'ndeki bio korunuyor mu?
    await hizmetCard.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    const outcome10b = await waitForSaveOutcome(hizmetCard, "Hizmet bilgileriniz kaydedildi.");
    record("GENEL.10-ön2. İkinci Hizmet Bilgilerim güncellemesi kaydedildi", outcome10b.ok, outcome10b.message ?? "");

    await fresh1.page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const bioAfter = await card.getByLabel("Kısa Firma Tanıtımı", { exact: true }).inputValue();
    record(
      "GENEL.10b. Hizmet Bilgilerim'den kaydetme Firma Profili'ndeki (güncel) bio'yu EZMEDİ",
      bioAfter === updatedBio,
      JSON.stringify({ bioAfter }),
    );
  }

  // 11) Tekrar çıkış/giriş — kalıcılık.
  await logout(fresh1.page);
  await fresh1.context.close();
  {
    const { context, page } = await loginInNewContext(browser, genel.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const card = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
    const persistedBio = await card.getByLabel("Kısa Firma Tanıtımı", { exact: true }).inputValue();
    record("GENEL.11. İkinci çıkış/girişten sonra güncellenen bio KALICI (Supabase'te)", persistedBio === updatedBio, JSON.stringify({ persistedBio }));
    await context.close();
  }

  // 12) Ağ kesintisi/RPC hatasında YANLIŞ başarı gösterilmiyor mu?
  {
    const { context, page } = await loginInNewContext(browser, genel.email);
    await page.route("**/rest/v1/rpc/upsert_provider_profile", (route) => route.abort("failed"));
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const card = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
    await card.getByLabel("Kısa Firma Tanıtımı", { exact: true }).fill("Ağ kesintisi testi sırasında girilen bio metni, en az elli karakter.");
    await card.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await assert.doesNotReject(card.getByText("Firma profiliniz kaydedildi.").waitFor({ state: "visible", timeout: 15000 }));
    await assert.doesNotReject(
      card.getByText("merkezi veritabanına yansıtılamadı").waitFor({ state: "visible", timeout: 15000 }),
    );
    record(
      "GENEL.12a. RPC ağ hatasında yerel kayıt mesajıyla BİRLİKTE gerçek bir uyarı gösteriliyor (yanlış/eksik başarı YOK)",
      true,
    );
    await page.unroute("**/rest/v1/rpc/upsert_provider_profile");

    // İkinci, TAMAMEN farklı bir başarısızlık sınıfı: belge YÜKLEME
    // (create_provider_document) için yerel bir "başarı" yolu YOK — bu
    // yüzden RPC hatası GERÇEK bir hata olarak görünmeli, asla "yüklendi"
    // denmemeli. Admin'in belgeyi reddetmesini bekleyip GERÇEK UI'daki
    // "Yeni Belge Yükle" akışını bu kez ağ hatasıyla deniyoruz.
    await context.close();
  }
  {
    const rejectAdmin = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await rejectAdmin.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const genelDoc = runSql(
      `select id from public.provider_documents where provider_id = '${genel.userId}' and original_file_name = '${genelOpts.generalDocFileName}';`,
    );
    const rejectRes = await rejectAdmin.rpc("review_provider_document", {
      p_document_id: genelDoc[0]?.id,
      p_status: "revision_requested",
      p_note: "E2E ağ hatası testi için yeniden belge isteniyor.",
    });
    record("GENEL.12b-ön. Belge yeniden-yükleme testi için admin belgeyi 'Yeniden Belge Gerekli' yaptı", !rejectRes.error, rejectRes.error?.message);
    await rejectAdmin.auth.signOut();

    const { context, page } = await loginInNewContext(browser, genel.email);
    await page.route("**/rest/v1/rpc/create_provider_document", (route) => route.abort("failed"));
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const docCard = page.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
    const rejectedRow = docCard.locator("div.rounded-md.border").filter({ has: page.getByText(genelOpts.generalDocFileName) }).first();
    await assert.doesNotReject(rejectedRow.getByText("Yeniden Belge Gerekli").waitFor({ state: "visible", timeout: 15000 }));
    await rejectedRow.getByRole("button", { name: "Yeni Belge Yükle" }).click();
    const replacementFileName = `E2E-Onboarding-Genel-Retry-${Date.now()}.pdf`;
    const replacementPath = makePdf(replacementFileName, "ag hatasi testi");
    await rejectedRow.locator('input[type="file"]').setInputFiles(replacementPath);
    const sendButton = rejectedRow.getByRole("button", { name: "Belgeyi Gönder" });
    await waitForEnabled(sendButton, 15000);
    await sendButton.click();
    const errorParagraph = rejectedRow.locator("p.text-danger");
    await assert.doesNotReject(errorParagraph.waitFor({ state: "visible", timeout: 15000 }));
    const errorText = await errorParagraph.textContent();
    record("GENEL.12b-ön. Belge yükleme ağ hatasında GERÇEK bir hata mesajı gösteriliyor", (errorText?.length ?? 0) > 0, errorText ?? "");
    // NOT: `replacementFileName` metni, RPC başarısız olsa bile
    // `ProviderDocumentUpload`ın KENDİ "seçilen/doğrulanmış dosya" önizleme
    // kartında (henüz gönderilmemiş, kullanıcının yeniden denemesi için)
    // GÖRÜNMEYE DEVAM EDER — bu doğru/beklenen davranıştır, "yanlış başarı"
    // DEĞİLDİR. Asıl/otoriter kontrol: gerçekten YENİ bir `provider_documents`
    // satırı oluşmadı mı (DB'de doğrudan doğrulanır, UI metin varlığına
    // güvenilmez).
    const falseSuccessRows = runSql(
      `select id from public.provider_documents where provider_id = '${genel.userId}' and original_file_name = '${replacementFileName}';`,
    );
    record(
      "GENEL.12b. Belge yükleme RPC hatasında GERÇEK bir hata gösteriliyor, DB'de YENİ bir satır OLUŞMADI",
      falseSuccessRows.length === 0,
      `DB'de bulunan yanlış-başarı satırı: ${JSON.stringify(falseSuccessRows)}`,
    );
    await page.unroute("**/rest/v1/rpc/create_provider_document");
    await context.close();
  }

  // =======================================================================
  // GEÇİŞ 2 — Gümrük Müşavirliği (customs-only) — belge zorunluluğu farkı
  // =======================================================================
  const stamp2 = Date.now();
  const gumruk = await createTestProviderAccount("gumruk");
  const gumrukOpts = {
    label: "GUMRUK",
    email: gumruk.email,
    firstName: "Onboarding",
    lastName: "Gumruk",
    companyName: "Gumruk Musavirligi E2E",
    serviceGroupLabel: "Gümrük Hizmetleri",
    serviceCategoryLabel: "Gümrük Müşavirliği",
    isCustomsOnly: true,
    isCustomsBroker: true,
    customsDocFileName: `E2E-Onboarding-Gumruk-${stamp2}.pdf`,
    expectedDocFileName: `E2E-Onboarding-Gumruk-${stamp2}.pdf`,
  };

  {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 13-ön) Genel belge alanının GERÇEKTEN gizlendiğini doğrula (yalnızca customs-only seçiliyken).
    await page.goto(`${APP_ORIGIN}/giris-yap`);
    await page.locator('input[type="email"]').fill(gumruk.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname === "/kayit-tamamla", { timeout: 15000 });
    await page.getByRole("radio", { name: "Hizmet Veren", exact: true }).check();
    await page
      .getByRole("group", { name: gumrukOpts.serviceGroupLabel })
      .getByRole("button", { name: gumrukOpts.serviceCategoryLabel, exact: true })
      .click();
    const generalDocSectionVisible = await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").count();
    record(
      "GUMRUK.13a. Yalnızca Gümrük Müşavirliği seçiliyken genel Faaliyet Belgesi alanı GİZLENİYOR (zorunlu değil)",
      generalDocSectionVisible === 0,
      `bulunan bölüm sayısı: ${generalDocSectionVisible}`,
    );
    const customsDocSectionVisible = await page.getByText("Gümrük Müşaviri İzin Belgesi").count();
    record("GUMRUK.13b. Gümrük Müşaviri İzin Belgesi alanı GÖSTERİLİYOR (zorunlu)", customsDocSectionVisible > 0);

    // Formun geri kalanını doldurup GERÇEKTEN gönder (submit engeli var mı diye de doğrulanır).
    await page.getByLabel("Ad", { exact: true }).fill(gumrukOpts.firstName);
    await page.getByLabel("Soyad", { exact: true }).fill(gumrukOpts.lastName);
    await page.getByLabel("Telefon Numarası", { exact: true }).fill("+905551234567");
    await page.getByLabel("Firma Adı", { exact: true }).fill(gumrukOpts.companyName);
    await page.getByLabel("Hizmet Veren Tipi", { exact: true }).selectOption({ label: "Bireysel Hizmet Veren" });
    await selectSearchable(page, "İl", "Kocaeli");
    await selectSearchable(page, "İlçe", "Gebze");

    const legalCheckbox = page.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
    await legalCheckbox.check();

    // 13c) Belge/beyan olmadan gönderim GERÇEKTEN reddediliyor mu (zorunluluk yalnızca görsel değil)?
    await page.getByRole("button", { name: "Kaydı Tamamla" }).click();
    await assert.doesNotReject(
      page.getByText("Gümrük Müşaviri İzin Belgesi yüklemelisiniz.").waitFor({ state: "visible", timeout: 5000 }),
    );
    record("GUMRUK.13c. Belge yüklenmeden gönderim istemci tarafında GERÇEKTEN reddediliyor", true);

    const customsDoc = makePdf(gumrukOpts.customsDocFileName, "gumruk musaviri izin belgesi");
    await page.locator('input[type="file"]').setInputFiles(customsDoc);
    const customsCheckbox = page.locator("label", { hasText: "Yüklediğim belge bana aittir" }).locator('input[type="checkbox"]');
    const submitButton = page.getByRole("button", { name: /Kaydı Tamamla|Belgeler doğrulanıyor/ });
    await waitForEnabled(submitButton, 20000);
    await customsCheckbox.check();
    await submitButton.click();
    await page.waitForURL((url) => url.pathname === "/panel", { timeout: 20000 });
    record("GUMRUK.1-5. Gümrük Müşavirliği kaydı (yalnızca izin belgesiyle) tamamlandı", true);

    const docRow = runSql(
      `select id, document_type, current_review_status from public.provider_documents where provider_id = '${gumruk.userId}';`,
    );
    record(
      "GUMRUK.2 (DB). Yalnızca customs-license türünde TEK belge oluştu (genel belge YOK)",
      docRow.length === 1 && docRow[0]?.document_type === "gumruk-musaviri-izin-belgesi" && docRow[0]?.current_review_status === "pending",
      JSON.stringify(docRow),
    );

    await context.close();
  }

  // Admin onayı + hizmet veren tarafında yansıma (kısa doğrulama — tam çapraz-editör/kalıcılık turu Geçiş 1'de zaten kapsandı).
  {
    const { context, page } = await loginInNewContext(browser, adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(page.getByText(gumrukOpts.expectedDocFileName).waitFor({ state: "visible", timeout: 15000 }));
    const row = page.locator("div.rounded-md.border").filter({ has: page.getByText(gumrukOpts.expectedDocFileName) }).first();
    await row.getByRole("button", { name: "Onayla" }).click();
    await assert.doesNotReject(row.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("GUMRUK.8-9 (admin). Gümrük Müşaviri İzin Belgesi admin panelinden onaylandı", true);
    await context.close();
  }
  {
    const { context, page } = await loginInNewContext(browser, gumruk.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const docCard = page.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
    await assert.doesNotReject(docCard.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("GUMRUK.9. TAZE tarayıcıda Gümrük Müşaviri İzin Belgesi durumu 'Onaylandı' olarak yansıdı", true);
    await context.close();
  }
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {}

  try {
    const providerIds = createdUserIds.slice(1); // admin hariç
    for (const providerId of providerIds) {
      const docsList = await admin.storage.from("provider-documents").list(providerId, { limit: 100 });
      const docPaths = (docsList.data ?? []).map((f) => `${providerId}/${f.name}`);
      if (docPaths.length > 0) await admin.storage.from("provider-documents").remove(docPaths);

      const logoList = await admin.storage.from("provider-logos").list(providerId, { limit: 100 });
      const logoPaths = (logoList.data ?? []).map((f) => `${providerId}/${f.name}`);
      if (logoPaths.length > 0) await admin.storage.from("provider-logos").remove(logoPaths);
    }
  } catch (error) {
    console.warn("Storage temizliği sırasında uyarı:", error?.message || error);
  }

  try {
    const idList = createdUserIds.map((id) => `'${id}'`).join(", ");
    if (idList) {
      runSql(`delete from public.provider_document_reviews where admin_id in (${idList}) or provider_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
      runSql(`delete from public.provider_document_consents where provider_id in (${idList});`);
      runSql(`delete from public.legal_consents where user_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
    }
  } catch (error) {
    console.warn("DB çocuk-satır temizliği sırasında uyarı (auth kullanıcı silme yine de denenecek):", error?.message || error);
  }

  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`Kullanıcı silinemedi (${id}): ${error.message}`);
  }

  try {
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((f) => f.name).join(" | "));
      process.exitCode = 1;
    }
  });
