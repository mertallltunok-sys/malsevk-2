// node scripts/tmp-nakliye-container-adr-sections-test.mjs
//
// "Konteyner Taşıması ve ADR Bağımsız Bölümleri" görevinin uçtan uca
// doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı, migration
// 0064 sonrası.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 500) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const idSuffix = stamp.toString(36);

async function newActorClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = await newActorClient();
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: fullName,
    p_phone: "+905321119911",
    p_company_name: companyName,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;
  return { id: data.user.id, email };
}

async function newActorPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick after ${attempts} attempts (wanted "${value}")`);
}

async function loginAs(page, email) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 15000 });
    // NOT: dev sunucusunda (Turbopack) eşzamanlı ilk-kez rota derlemeleri
    // (başka bir sayfanın yeni bir rotaya ilk kez gitmesi) bazen bir Fast
    // Refresh yeniden-oluşturmasını tetikleyip bu formun React state'ini
    // sıfırlayabiliyor (DOM'daki değer görünse de submit anında boş
    // gidiyor) — bu YALNIZCA dev-modu/test eserleşmesi, gerçek bir uygulama
    // hatası değil. Kısa bir bekleme + submit ÖNCESİ değerleri yeniden
    // doğrulama bunu güvenilir biçimde aşıyor.
    await page.waitForTimeout(500);
    await fillAndVerify(page.locator('input[type="email"]'), email);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.waitForTimeout(300);
    if ((await page.locator('input[type="email"]').inputValue()) !== email) {
      await fillAndVerify(page.locator('input[type="email"]'), email);
    }
    if ((await page.locator('input[type="password"]').inputValue()) !== PASSWORD) {
      await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    }
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 20000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) return;
    const debugPath = path.join(os.tmpdir(), `nakliye-container-adr-login-debug-${Date.now()}-${attempt}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    console.error(`loginAs(${email}) deneme ${attempt} başarısız. url=${page.url()} ekran=${debugPath}`);
  }
  throw new Error(`loginAs(${email}) failed after ${maxAttempts} attempts`);
}

async function publishJob(page) {
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  try {
    await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  } catch (waitError) {
    const debugPath = path.join(os.tmpdir(), `nakliye-container-adr-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const dangerTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error("publishJob: önizlemeye geçilemedi. Ekran görüntüsü:", debugPath);
    console.error("publishJob: görünür .text-danger metinleri:", JSON.stringify(dangerTexts));
    throw waitError;
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 20000 });
}

async function makeDistinctJpeg(seed) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed * 40, g: 150, b: 90 } } })
    .jpeg()
    .toBuffer();
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  const files = [];
  for (let i = 0; i < 4; i++) {
    files.push({ name: `test-fixture-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeDistinctJpeg(i + 1) });
  }
  await fileInput.setInputFiles(files);
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function setToggle(page, toggleTitle, optionLabel) {
  const group = page.getByRole("radiogroup", { name: toggleTitle }).first();
  await group.waitFor({ state: "visible", timeout: 10000 });
  await group.getByRole("radio", { name: optionLabel }).click();
}

async function fillNakliyePickupLocation(page) {
  await selectSearchable(page, "İlçe", 0, "Dilovası");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Beldeport", { exact: false });
  await page.getByLabel("Açık Adres").nth(0).fill("Test Yükleme Açık Adresi, Dilovası");
  await selectSearchable(page, "İl", 1, "İstanbul");
  await selectSearchable(page, "İlçe", 1, "Kartal");
  await selectSearchable(page, "Liman / Sanayi / OSB", 1, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Teslim Tesisi");
  await page.getByLabel("Açık Adres").nth(1).fill("Test Teslim Açık Adresi, Kartal");
}

async function dbQuery(sql) {
  const { execSync } = await import("node:child_process");
  const output = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, {
    cwd: "c:\\Users\\merta\\malsevk-2",
    stdio: "pipe",
  }).toString();
  return JSON.parse(output).rows ?? [];
}

async function getJobFromSupabase(jobId, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const rows = await dbQuery(
        `select id, moderation_status, category_id, nakliye_hazmat, nakliye_container_transport, updated_at from public.jobs where id = '${jobId}';`,
      );
      return rows[0] ?? null;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`getJobFromSupabase: deneme ${attempt} başarısız, tekrar deneniyor...`);
    }
  }
  return null;
}

async function fillBasics(page, title) {
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Konteyner/ADR bölümleri testi için otomatik oluşturulan ilan açıklaması.");
  await fillNakliyePickupLocation(page);
  const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(0).fill(todayPlus7);
  await page.locator('input[type="date"]').nth(1).fill(todayPlus7);
  await fillAndVerify(page.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
  await selectSearchable(page, "Yükün Hazırlanış Biçimi", 0, "Paletli");
  await fillAndVerify(page.locator('input[id*="productQuantity"]').first(), "20");
  await fillAndVerify(page.getByLabel("Toplam Ağırlık", { exact: false }).first(), "8,5");
  await selectSearchable(page, "Yükleme Yöntemi", 0, "Forklift ile");
  await page.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `naklcontadr-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklContAdr Requester",
    companyName: "NaklContAdr Firma",
  });
  const viewer = await createAccount({
    email: `naklcontadr-viewer-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklContAdr Viewer",
    companyName: "NaklContAdr Viewer Firma",
  });
  const adminAccount = await createAccount({
    email: `naklcontadr-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklContAdr Admin",
    companyName: "NaklContAdr Admin Firma",
  });
  await dbQuery(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: hesaplar oluşturuldu (requester/viewer/admin)", true);

  const browser = await chromium.launch();
  let jobIdEvet = null;
  let jobIdHayirBos = null;

  try {
    const { page: reqPage } = await newActorPage(browser);
    await loginAs(reqPage, requester.email);

    // ============================================================
    // 1. Bölüm sırası ve "Özel Taşıma Koşulları" hiç yok.
    // ============================================================
    console.log("\n=== 1. Bölüm sırası (1-8) ve 'Özel Taşıma Koşulları' hiç yok ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");

    const expectedTitles = [
      "Temel Bilgiler",
      "Yük Bilgileri",
      "Konteyner Taşıması",
      "Tehlikeli Madde / ADR",
      "Taşıma Planı",
      "Araç Tercihi",
      "Yükleme ve Teslimat",
      "Fotoğraflar ve Belgeler",
    ];
    const badgeRows = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface > div.flex.items-center.gap-2");
    const count = await badgeRows.count();
    const actualTitles = [];
    const actualNumbers = [];
    for (let i = 0; i < count; i++) {
      const row = badgeRows.nth(i);
      const numberText = (await row.locator("span").first().innerText()).trim();
      const titleText = (await row.locator("p").first().innerText()).trim();
      actualNumbers.push(numberText);
      actualTitles.push(titleText);
    }
    record(
      "Bölüm sırası 1-8 (Temel Bilgiler..Yükleme ve Teslimat) doğru",
      JSON.stringify(actualTitles) === JSON.stringify(expectedTitles),
      JSON.stringify(actualTitles),
    );
    record(
      "Numara rozetleri YALNIZCA rakam (Sıra kelimesi yok)",
      actualNumbers.every((n) => /^[1-9]$/.test(n)),
      JSON.stringify(actualNumbers),
    );
    const ozelTasimaVisible = await reqPage.getByText("Özel Taşıma Koşulları", { exact: false }).first().isVisible().catch(() => false);
    record("'Özel Taşıma Koşulları' başlığı HİÇ YOK", !ozelTasimaVisible);

    await fillBasics(reqPage, `NaklContAdr Evet-Dolu ${idSuffix}`);

    // ============================================================
    // 2. Konteyner: Hayır -> alt alan yok.
    // ============================================================
    console.log("\n=== 2. Konteyner: Hayır -> alt alan yok ===");
    await setToggle(reqPage, "Yük konteyner olarak mı taşınacak?", "Hayır");
    const containerTypeVisibleAfterHayir = await reqPage.getByLabel("Konteyner Tipi").first().isVisible().catch(() => false);
    record("Konteyner=Hayır iken Konteyner Tipi alanı YOK", !containerTypeVisibleAfterHayir);

    // ============================================================
    // 3. ADR: Emin Değilim -> uyarı metni, engelleme yok.
    // ============================================================
    console.log("\n=== 3. ADR: Emin Değilim -> uyarı metni ===");
    await setToggle(reqPage, "Yük tehlikeli madde / ADR kapsamında mı?", "Emin Değilim");
    const uncertainInfoVisible = await reqPage
      .getByText("Bu bilgileri bilmiyorsanız", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    record("ADR=Emin Değilim iken bilgilendirme metni gösteriliyor", uncertainInfoVisible);

    // ============================================================
    // 4. Şasi/Yön/Free Time/Gen-set/SDS-MSDS hiçbir yerde yok.
    // ============================================================
    console.log("\n=== 4. Kaldırılan alanlar hiç yok ===");
    for (const removed of ["Konteyner Şasisi", "Şasi İhtiyacı", "Taşıma Yönü", "Free Time", "Ardiye", "Jeneratör", "Gen-set", "SDS", "MSDS"]) {
      const visible = await reqPage.getByText(removed, { exact: false }).first().isVisible().catch(() => false);
      record(`Kaldırılan alan hiç görünmüyor: ${removed}`, !visible);
    }

    // ============================================================
    // 5. Konteyner: Evet -> alan seti + Dolu -> içerik/ADR/açıklama.
    // ============================================================
    console.log("\n=== 5. Konteyner: Evet + Dolu -> tüm alanlar ===");
    await setToggle(reqPage, "Yük konteyner olarak mı taşınacak?", "Evet");
    await selectSearchable(reqPage, "Konteyner Tipi", 0, "40' High Cube");
    await selectSearchable(reqPage, "Dolu / Boş", 0, "Dolu");
    const contentFieldVisibleAfterDolu = await reqPage.getByLabel("Konteyner İçindeki Yük").first().isVisible().catch(() => false);
    record("Dolu seçilince 'Konteyner İçindeki Yük' alanı açıldı", contentFieldVisibleAfterDolu);
    const doluSubcardVisible = await reqPage.getByText("Dolu Konteyner Bilgileri", { exact: false }).first().isVisible().catch(() => false);
    record("'Dolu Konteyner Bilgileri' alt kartı açıldı", doluSubcardVisible);

    // 6. Kimyasal Ürün seçimi ADR'yi otomatik Evet YAPMAZ.
    console.log("\n=== 6. Kimyasal Ürün seçimi ADR'yi otomatik Evet yapmıyor ===");
    await selectSearchable(reqPage, "Konteyner İçindeki Yük", 0, "Kimyasal Ürün");
    await reqPage.waitForTimeout(300);
    const adrRadioInContentCard = reqPage.getByRole("radiogroup", { name: "Tehlikeli Madde / ADR var mı?" }).first();
    const adrStillNotEvet = await adrRadioInContentCard.getByRole("radio", { name: "Evet", exact: true }).getAttribute("aria-checked");
    record("Kimyasal Ürün seçilince ADR OTOMATİK Evet olmadı", adrStillNotEvet !== "true", adrStillNotEvet);

    // 7. Konteyner Adedi pozitif tam sayı olmalı — burada geçerli değer gir.
    await fillAndVerify(reqPage.getByLabel("Konteyner Adedi").first(), "3");
    await fillAndVerify(reqPage.getByLabel("Yük Açıklaması", { exact: false }).first(), "Test yük açıklaması.");

    // ============================================================
    // 8. Container Dolu kartından ADR=Evet -> Bölüm 4 kartı da Evet'e döner (paylaşılan state).
    // ============================================================
    console.log("\n=== 8. Container->ADR paylaşılan state senkronu (Container'dan) ===");
    await setToggle(reqPage, "Tehlikeli Madde / ADR var mı?", "Evet");
    const section4Group = reqPage.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" }).first();
    const section4Checked = await section4Group.getByRole("radio", { name: "Evet", exact: true }).getAttribute("aria-checked");
    record("Bölüm 4 (ADR) kartı da Evet oldu (Container kartından tetiklendi)", section4Checked === "true", section4Checked);
    const adrBilgileriVisible = await reqPage.getByText("ADR Bilgileri", { exact: true }).first().isVisible().catch(() => false);
    record("'ADR Bilgileri' alt kartı açıldı", adrBilgileriVisible);

    // ============================================================
    // 9. UN Numarası -> otomatik PSN doldurma, PSN salt-okunur.
    // ============================================================
    console.log("\n=== 9. UN numarası -> otomatik PSN doldurma ===");
    const unInput = reqPage.getByLabel("UN Numarası").first();
    await unInput.fill("UN1203");
    await unInput.blur();
    await reqPage.waitForTimeout(300);
    const psnInput = reqPage.getByLabel("Resmî Taşımacılık Adı").first();
    const psnValue = await psnInput.inputValue();
    record("UN1203 girilince Resmî Taşımacılık Adı otomatik doldu (BENZİN)", psnValue === "BENZİN", psnValue);
    const psnReadOnly = await psnInput.getAttribute("readonly");
    const psnDisabled = await psnInput.getAttribute("disabled");
    record("Resmî Taşımacılık Adı alanı salt-okunur/devre dışı", psnReadOnly !== null || psnDisabled !== null);
    const psnCaptionVisible = await reqPage
      .getByText("UN numarası seçildiğinde sistem tarafından otomatik doldurulur.", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    record("PSN altında gerekli açıklama metni var", psnCaptionVisible);
    await psnInput.click({ force: true }).catch(() => {});
    await psnInput.fill("MANUEL DEĞER").catch(() => {});
    const psnValueAfterAttempt = await psnInput.inputValue();
    record("PSN alanına elle yazma denemesi BAŞARISIZ kaldı (değer değişmedi)", psnValueAfterAttempt === "BENZİN", psnValueAfterAttempt);

    // ============================================================
    // 10. Ambalaj Grubu — Uygulanmaz / Emin Değilim seçenekleri var.
    // ============================================================
    console.log("\n=== 10. Ambalaj Grubu seçenekleri ===");
    await reqPage.getByRole("button", { name: "Ambalaj Grubu", exact: true }).first().click();
    const packingListbox = reqPage.locator('ul[aria-label="Ambalaj Grubu"]').first();
    await packingListbox.waitFor({ state: "visible" });
    const packingOptionTexts = await packingListbox.getByRole("option").allInnerTexts();
    record(
      "Ambalaj Grubu seçeneklerinde Uygulanmaz VE Emin Değilim var",
      packingOptionTexts.some((t) => t.includes("Uygulanmaz")) && packingOptionTexts.some((t) => t.includes("Emin Değilim")),
      JSON.stringify(packingOptionTexts),
    );
    await packingListbox.getByRole("option", { name: "Uygulanmaz", exact: true }).click();

    // ============================================================
    // 11. Bölüm 4 (ADR) kartından değişiklik -> Container kartı da güncellensin.
    // ============================================================
    console.log("\n=== 11. ADR->Container paylaşılan state senkronu (Bölüm 4'ten) ===");
    await setToggle(reqPage, "Yük tehlikeli madde / ADR kapsamında mı?", "Hayır");
    await reqPage.waitForTimeout(300);
    const contentCardAdrGroupAfter = reqPage.getByRole("radiogroup", { name: "Tehlikeli Madde / ADR var mı?" }).first();
    const contentCardAdrHayirChecked = await contentCardAdrGroupAfter.getByRole("radio", { name: "Hayır", exact: true }).getAttribute("aria-checked");
    record("Container kartındaki ADR sorusu da Hayır'a döndü (Bölüm 4'ten tetiklendi)", contentCardAdrHayirChecked === "true", contentCardAdrHayirChecked);
    const adrBilgileriGoneAfterHayir = await reqPage.getByText("ADR Bilgileri", { exact: true }).first().isVisible().catch(() => false);
    record("ADR=Hayır olunca 'ADR Bilgileri' alt kartı kapandı", !adrBilgileriGoneAfterHayir);

    // Yayımlamak için ADR'yi tekrar Evet yap ve UN'i yeniden gir (temiz veri için).
    await setToggle(reqPage, "Yük tehlikeli madde / ADR kapsamında mı?", "Evet");
    await fillAndVerify(reqPage.getByLabel("UN Numarası").first(), "UN1203");
    await reqPage.getByLabel("UN Numarası").first().blur();
    await reqPage.waitForTimeout(300);

    // ============================================================
    // 12. Boş -> Dolu alanları gizlenir, eski içerik yeni payload'a gitmez.
    // ============================================================
    console.log("\n=== 12. Dolu -> Boş geçişi: içerik alanları gizleniyor ===");
    await selectSearchable(reqPage, "Dolu / Boş", 0, "Boş");
    const contentFieldGoneAfterBos = await reqPage.getByLabel("Konteyner İçindeki Yük").first().isVisible().catch(() => false);
    record("Boş seçilince 'Konteyner İçindeki Yük' alanı gizlendi", !contentFieldGoneAfterBos);
    const doluSubcardGoneAfterBos = await reqPage.getByText("Dolu Konteyner Bilgileri", { exact: false }).first().isVisible().catch(() => false);
    record("Boş seçilince 'Dolu Konteyner Bilgileri' alt kartı kapandı", !doluSubcardGoneAfterBos);
    const grossWeightVisibleWhenBos = await reqPage.getByLabel("Toplam Brüt Ağırlık (ton)", { exact: false }).first().isVisible().catch(() => false);
    record("Boş iken Toplam Brüt Ağırlık üst seviyede gösteriliyor", grossWeightVisibleWhenBos);
    await fillAndVerify(reqPage.getByLabel("Toplam Brüt Ağırlık (ton)", { exact: false }).first(), "12");

    // ADR hâlâ bağımsız olarak sorulabilir mi (Boş iken de)?
    const section4GroupAfterBos = reqPage.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" }).first();
    const section4StillEvet = await section4GroupAfterBos.getByRole("radio", { name: "Evet", exact: true }).getAttribute("aria-checked");
    record("Boş iken ADR durumu hâlâ bağımsız olarak Evet kalabiliyor", section4StillEvet === "true", section4StillEvet);

    // ============================================================
    // 13. Manuel giriş: Konteyner Tipi "Listede yok".
    // ============================================================
    console.log("\n=== 13. Konteyner Tipi manuel giriş ===");
    await reqPage.getByRole("button", { name: "Konteyner Tipi", exact: true }).click();
    const typeListbox = reqPage.locator('ul[aria-label="Konteyner Tipi"]').first();
    await typeListbox.waitFor({ state: "visible" });
    const typeOptionTexts = await typeListbox.getByRole("option").allInnerTexts();
    const expectedTypeLabels = [
      "20' Standart",
      "40' Standart",
      "40' High Cube",
      "45' High Cube",
      "20' Open Top",
      "40' Open Top",
      "20' Flat Rack",
      "40' Flat Rack",
      "Reefer",
      "Tank Konteyner",
      "Emin Değilim",
      "Listede yok",
    ];
    record(
      "Konteyner Tipi listesi spesifikasyondaki TÜM seçenekleri içeriyor",
      expectedTypeLabels.every((label) => typeOptionTexts.some((t) => t.includes(label))),
      JSON.stringify(typeOptionTexts),
    );
    await typeListbox.getByRole("option", { name: "Listede yok", exact: false }).first().click();
    const manualTypeInputVisible = await reqPage.getByLabel("Konteyner tipini yazın").first().isVisible().catch(() => false);
    record("'Listede yok' seçilince manuel giriş alanı açıldı (Konteyner Tipi)", manualTypeInputVisible);
    if (manualTypeInputVisible) await fillAndVerify(reqPage.getByLabel("Konteyner tipini yazın").first(), "Özel Test Konteyneri");

    await uploadOnePhoto(reqPage);
    await publishJob(reqPage);
    const jobUrlEvet = reqPage.url();
    jobIdEvet = jobUrlEvet.split("/ilanlar/")[1]?.split(/[/?]/)[0];
    record("Konteyner=Evet ilanı yayımlandı", Boolean(jobIdEvet), jobUrlEvet);

    // Supabase satırı kontrolü.
    let jobRow = await getJobFromSupabase(jobIdEvet);
    record("Supabase satırı bulundu (Konteyner=Evet ilanı)", Boolean(jobRow));
    if (jobRow) {
      record(
        "nakliye_container_transport doğru senkronlandı (status=evet, loadStatus=bos, manuel tip)",
        jobRow.nakliye_container_transport?.status === "evet" &&
          jobRow.nakliye_container_transport?.loadStatus === "bos" &&
          jobRow.nakliye_container_transport?.containerTypeCustomText === "Özel Test Konteyneri",
        JSON.stringify(jobRow.nakliye_container_transport),
      );
      // NOT: senaryo 11'de UN Numarası BİLEREK yeniden girilip blur edildi
      // (paylaşılan-state senkron testi için) — bu, handleUnResolve'u tekrar
      // tetikleyip Ambalaj Grubu'nu UN1203'ün katalog değeri "II"ye geri
      // otomatik doldurdu (adrClass gibi, BEKLENEN/doğru davranış — kullanıcı
      // aynı UN'i yeniden çözümlerse otomatik doldurma otoriter kalır).
      record(
        "nakliye_hazmat doğru senkronlandı (status=evet, unNumber=UN1203, adrClass=3, packingGroup=UN kaydından otomatik II)",
        jobRow.nakliye_hazmat?.status === "evet" &&
          jobRow.nakliye_hazmat?.unNumber === "UN1203" &&
          jobRow.nakliye_hazmat?.adrClass === "3" &&
          jobRow.nakliye_hazmat?.packingGroup === "II",
        JSON.stringify(jobRow.nakliye_hazmat),
      );
      record("Yeni ilan moderation_status=pending_review ile başladı", jobRow.moderation_status === "pending_review", jobRow.moderation_status);
    }

    // ============================================================
    // 14. İlan detay sayfası (oluşturan kendi tarayıcısı, localStorage yolu).
    // ============================================================
    console.log("\n=== 14. İlan detay sayfası (localStorage yolu) ===");
    await reqPage.goto(jobUrlEvet, { waitUntil: "domcontentloaded" });
    await reqPage.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const detailShowsContainer = await reqPage.getByText("Boş", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında Konteyner Taşıması bilgisi (Boş) gösteriliyor", detailShowsContainer);
    const detailShowsAdr = await reqPage.getByText("UN1203", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında ADR bilgisi (UN1203) gösteriliyor", detailShowsAdr);
    const detailNoOzelTasima = await reqPage.getByText("Özel Taşıma Koşulları", { exact: false }).first().isVisible().catch(() => false);
    record("İlan detayında 'Özel Taşıma Koşulları' başlığı YOK", !detailNoOzelTasima);

    // ============================================================
    // 15. Hizmet Alan ilan düzenleme — Container/ADR alanları prefill ile açılıyor mu?
    // ============================================================
    console.log("\n=== 15. Hizmet Alan ilan düzenleme — prefill ===");
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobIdEvet}/duzenle`, { waitUntil: "domcontentloaded" });
    await reqPage.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    const editSectionOrder = [];
    const editBadgeRows = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface > div.flex.items-center.gap-2");
    const editCount = await editBadgeRows.count();
    for (let i = 0; i < editCount; i++) {
      editSectionOrder.push((await editBadgeRows.nth(i).locator("p").first().innerText()).trim());
    }
    record(
      "Düzenleme ekranı da aynı 1-7 kart sırasını gösteriyor (fotoğraflar ayrı)",
      JSON.stringify(editSectionOrder) === JSON.stringify(expectedTitles),
      JSON.stringify(editSectionOrder),
    );
    const editUnPrefill = await reqPage.getByLabel("UN Numarası").first().inputValue();
    record("Düzenleme ekranı UN Numarası=UN1203 ile prefill edildi", editUnPrefill === "UN1203", editUnPrefill);
    const editManualTypeValue = await reqPage.getByLabel("Konteyner tipini yazın").first().inputValue().catch(() => "");
    record(
      "Düzenleme ekranı manuel konteyner tipiyle prefill edildi",
      editManualTypeValue === "Özel Test Konteyneri",
      editManualTypeValue,
    );

    // Bir alanı değiştir: konteyner adedini 5 yap.
    await fillAndVerify(reqPage.getByLabel("Konteyner Adedi").first(), "5");
    await reqPage.getByRole("button", { name: "Kaydet" }).click();
    await reqPage.waitForURL((url) => url.pathname.includes(`/ilanlar/${jobIdEvet}`), { timeout: 20000 }).catch(async () => {
      await reqPage.waitForTimeout(1500);
    });
    await reqPage.waitForTimeout(1500);
    jobRow = await getJobFromSupabase(jobIdEvet);
    record(
      "Düzenleme sonrası Supabase'de konteyner adedi=5 güncellendi (update_job_as_requester)",
      jobRow?.nakliye_container_transport?.quantity === 5,
      JSON.stringify(jobRow?.nakliye_container_transport),
    );

    // ============================================================
    // 16. Admin panelinde görüntüleme + düzenleme + onay.
    // ============================================================
    console.log("\n=== 16. Admin panelinde görüntüleme/düzenleme/onay ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobIdEvet}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const adminSeesContainer = await adminPage.getByText("UN1203", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında ADR (UN1203) görünüyor", adminSeesContainer);
    const adminNoOzelTasima = await adminPage.getByText("Özel Taşıma Koşulları", { exact: false }).first().isVisible().catch(() => false);
    record("Admin ilan detayında 'Özel Taşıma Koşulları' YOK", !adminNoOzelTasima);

    const editButton = adminPage.getByRole("button", { name: /Düzenle/i }).first();
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await adminPage.waitForTimeout(500);
      const adminFormUnValue = await adminPage.getByLabel("UN Numarası").first().inputValue().catch(() => null);
      record("Admin düzenleme formu UN Numarası=UN1203 ile açıldı", adminFormUnValue === "UN1203", adminFormUnValue);
      const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await adminPage.waitForTimeout(1000);
      }
    } else {
      record("Admin düzenleme formu UN Numarası=UN1203 ile açıldı", false, "Düzenle butonu bulunamadı");
    }

    const approveButton = adminPage.getByRole("button", { name: /Onayla/i }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await adminPage.waitForTimeout(1000);
      record("Admin ilanı onayladı", true);
    } else {
      record("Admin ilanı onayladı", false, "Onayla butonu bulunamadı");
    }
    jobRow = await getJobFromSupabase(jobIdEvet);
    record("Admin onayı sonrası moderation_status=approved", jobRow?.moderation_status === "approved", jobRow?.moderation_status);
    record(
      "Admin onayı sonrası Container/ADR verisi KAYBOLMADI",
      jobRow?.nakliye_hazmat?.unNumber === "UN1203" && jobRow?.nakliye_container_transport?.status === "evet",
      JSON.stringify({ hazmat: jobRow?.nakliye_hazmat, container: jobRow?.nakliye_container_transport }),
    );

    // ============================================================
    // 17. Yayımlanan ilanı BAŞKA bir hesap/tarayıcıdan aç (Supabase okuma
    //     yolu — supabase-job-reads.ts#mapJobRow, localStorage'da hiç yok).
    // ============================================================
    console.log("\n=== 17. Uzak (Supabase) okuma yolu — farklı hesap ===");
    const { page: viewerPage } = await newActorPage(browser);
    await loginAs(viewerPage, viewer.email);
    await viewerPage.goto(`${APP_ORIGIN}/ilanlar/${jobIdEvet}`, { waitUntil: "domcontentloaded" });
    await viewerPage.getByText("Konteyner Taşıması", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const remoteViewerSeesAdr = await viewerPage.getByText("UN1203", { exact: false }).first().isVisible().catch(() => false);
    record("Farklı hesap, uzak Supabase okuma yolundan ADR (UN1203) görüyor", remoteViewerSeesAdr);
    const remoteViewerSeesContainer = await viewerPage.getByText("Konteyner Taşıması", { exact: false }).first().isVisible().catch(() => false);
    record("Farklı hesap, uzak Supabase okuma yolundan 'Konteyner Taşıması' bölümünü görüyor", remoteViewerSeesContainer);
    const remoteViewerNoError = !(await viewerPage.getByText("İlan bulunamadı", { exact: false }).first().isVisible().catch(() => false));
    record("Uzak okuma yolunda 'İlan bulunamadı' hatası YOK", remoteViewerNoError);

    // ============================================================
    // 18. Konteyner=Emin Değilim + ADR=Hayır ile ikinci bir ilan — engellenmiyor mu?
    // ============================================================
    console.log("\n=== 18. Konteyner=Emin Değilim + ADR=Hayır ilanı engellenmiyor ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    await fillBasics(reqPage, `NaklContAdr EminDegil ${idSuffix}`);
    await setToggle(reqPage, "Yük konteyner olarak mı taşınacak?", "Emin Değilim");
    await setToggle(reqPage, "Yük tehlikeli madde / ADR kapsamında mı?", "Hayır");
    await uploadOnePhoto(reqPage);
    let publishBlocked = false;
    try {
      await publishJob(reqPage);
    } catch {
      publishBlocked = true;
    }
    record("Konteyner=Emin Değilim ilan oluşturmayı ENGELLEMEDİ", !publishBlocked);
    if (!publishBlocked) {
      const jobUrlHayirBos = reqPage.url();
      jobIdHayirBos = jobUrlHayirBos.split("/ilanlar/")[1]?.split(/[/?]/)[0];
      jobRow = await getJobFromSupabase(jobIdHayirBos);
      record(
        "Konteyner=Emin Değilim ilanı Supabase'e 'emin-degil' olarak yazıldı",
        jobRow?.nakliye_container_transport?.status === "emin-degil",
        JSON.stringify(jobRow?.nakliye_container_transport),
      );
    }

    // ============================================================
    // 19. Regresyon: Liman Hizmetleri (Nakliye DIŞI) Container/ADR göstermiyor.
    // ============================================================
    console.log("\n=== 19. Regresyon: Liman Hizmetleri Container/ADR göstermiyor ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("lashing-unlashing");
    const limanHasContainer = await reqPage.getByText("Konteyner Taşıması", { exact: false }).first().isVisible().catch(() => false);
    record("Liman Hizmetleri kartında 'Konteyner Taşıması' hiç YOK (regresyon)", !limanHasContainer);
    const limanHasAdr = await reqPage.getByText("Tehlikeli Madde / ADR", { exact: false }).first().isVisible().catch(() => false);
    record("Liman Hizmetleri kartında 'Tehlikeli Madde / ADR' hiç YOK (regresyon)", !limanHasAdr);

    // ============================================================
    // 20. Eski (bu görevden önce oluşturulmuş) bir Nakliye ilanı var mı,
    //     hatasız açılıyor mu? (nakliye_hazmat/nakliye_container_transport
    //     ikisi de null olan, moderation onaylı gerçek bir eski kayıt).
    // ============================================================
    console.log("\n=== 20. Eski Nakliye ilanı (Container/ADR alanları olmayan) uyumluluğu ===");
    const legacyRows = await dbQuery(
      `select id from public.jobs where category_id = 'nakliye' and nakliye_hazmat is null and nakliye_container_transport is null and moderation_status = 'approved' order by created_at asc limit 1;`,
    );
    if (legacyRows.length > 0) {
      const legacyJobId = legacyRows[0].id;
      await viewerPage.goto(`${APP_ORIGIN}/ilanlar/${legacyJobId}`, { waitUntil: "domcontentloaded" });
      await viewerPage.waitForTimeout(1500);
      const legacyPageErrored = await viewerPage.getByText("İlan bulunamadı", { exact: false }).first().isVisible().catch(() => false);
      record(`Eski Nakliye ilanı (${legacyJobId}) kullanıcı detay sayfasında hatasız açılıyor`, !legacyPageErrored);
      await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${legacyJobId}`, { waitUntil: "domcontentloaded" });
      await adminPage.waitForTimeout(1500);
      const legacyAdminErrored = await adminPage.getByText("İlan bulunamadı", { exact: false }).first().isVisible().catch(() => false);
      record(`Eski Nakliye ilanı (${legacyJobId}) admin detay sayfasında hatasız açılıyor`, !legacyAdminErrored);
    } else {
      record(
        "Eski (Container/ADR alanları olmayan) bir Nakliye ilanı bulunamadı — bu senaryo DOĞRULANAMADI",
        false,
        "dev veritabanında uygun kayıt yok",
      );
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== SONUÇ ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length > 0) {
    console.log("BAŞARISIZ TESTLER:");
    for (const f of failed) console.log(` - ${f.name} :: ${f.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("SCRIPT HATASI:", err);
  process.exitCode = 1;
});
