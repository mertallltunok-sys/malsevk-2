// node scripts/tmp-nakliye-container-product-type-trigger-test.mjs
//
// "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevinin uçtan uca
// doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek Chromium),
// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı, migration
// 0067 sonrası.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000),
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
// ortam değişkenlerinde tanımlı olmalı (.env.local).

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
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 600) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();

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
    const debugPath = path.join(os.tmpdir(), `nakliye-container-trigger-login-debug-${Date.now()}-${attempt}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    console.error(`loginAs(${email}) deneme ${attempt} başarısız. url=${page.url()} ekran=${debugPath}`);
  }
  throw new Error(`loginAs(${email}) failed after ${maxAttempts} attempts`);
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

function groupCard(scope, groupNumber) {
  return scope
    .locator("div.rounded-\\[10px\\].border.border-border.bg-background.p-4")
    .filter({ hasText: new RegExp(`Yük Grubu ${groupNumber}(?!\\d)`) })
    .first();
}

async function selectSearchableInScope(scope, label, optionName, { exact = true } = {}) {
  await scope.getByRole("button", { name: label, exact: true }).first().click();
  const listbox = scope.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function setToggleInScope(scope, toggleTitle, optionLabel) {
  const group = scope.getByRole("radiogroup", { name: toggleTitle }).first();
  await group.waitFor({ state: "visible", timeout: 10000 });
  await group.getByRole("radio", { name: optionLabel }).click();
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
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

async function getJobRow(jobId) {
  const rows = await dbQuery(
    `select id, moderation_status, category_id, product_quantity, product_tonnage, product_type, product_tonnage_unit, nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups, updated_at from public.jobs where id = '${jobId}';`,
  );
  return rows[0] ?? null;
}

/**
 * "Ürün/Yük Cinsi" combobox'ı için — SearchableSelect'ten farklı, serbest
 * metin + öneri listesi. Önce input BOŞALTILIR: combobox kendi mevcut
 * değerine göre öneri listesini FİLTRELER (gerçek kullanıcı davranışı),
 * boşaltılmazsa örn. "Konteyner" yazılıyken listede yalnızca "Konteyner"
 * kalır, farklı bir seçeneğe geçilemez.
 */
async function selectProductTypeInScope(scope, optionText) {
  const input = scope.getByRole("combobox", { name: "Ürün/Yük Cinsi" });
  await input.click();
  await input.fill("");
  const listbox = scope.locator('ul[role="listbox"]').first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact: true }).first().click();
}

async function getProductTypeOptionTexts(scope) {
  const input = scope.getByRole("combobox", { name: "Ürün/Yük Cinsi" });
  await input.click();
  const listbox = scope.locator('ul[role="listbox"]').first();
  await listbox.waitFor({ state: "visible" });
  const texts = await listbox.getByRole("option").allInnerTexts();
  // NOT: Escape yalnızca global "open" state'ini kapatır, input'un kendi
  // focus'unu KORUR — ProductTypeCombobox'ın tetikleyicisi bir <input> ve
  // yeniden açılması onFocus'a dayanır (SearchableSelect'in <button>'ından
  // FARKLI, click her zaman yeniden tetiklenir). Zaten focus'lu bir input'a
  // ikinci .click() gerçek bir focus event ATEŞLEMEZ, dropdown bir daha
  // AÇILAMAZ. Bu yüzden dışarı tıklayıp gerçek bir blur/yeniden-focus
  // döngüsü sağlanır.
  await scope.page().locator("body").click({ position: { x: 5, y: 5 } });
  return texts;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `nakcontrig-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklContTrig Requester",
    companyName: "NaklContTrig Firma",
  });
  const adminAccount = await createAccount({
    email: `nakcontrig-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklContTrig Admin",
    companyName: "NaklContTrig Admin Firma",
  });
  await dbQuery(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: hesaplar oluşturuldu (requester/admin)", true);

  const browser = await chromium.launch();
  let jobId = null;
  let legacyJobId = null;

  try {
    const { page: reqPage } = await newActorPage(browser);
    await loginAs(reqPage, requester.email);

    // ============================================================
    // 1. Kart sırası — ayrı ADR kartı YOK.
    // ============================================================
    console.log("\n=== 1. Kart sırası (ayrı 'Tehlikeli Madde / ADR' kartı YOK) ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    const badgeRows = reqPage.locator(
      "div.rounded-\\[10px\\].border.border-border.bg-surface > div.flex.flex-wrap.items-center.justify-between > div.flex.items-center.gap-2",
    );
    await badgeRows.first().waitFor({ state: "visible", timeout: 10000 });
    const cardTitles = await badgeRows.locator("p").allInnerTexts();
    record(
      "Kart sırasında ayrı 'Tehlikeli Madde / ADR' kartı YOK",
      !cardTitles.some((t) => t.includes("Tehlikeli Madde")),
      JSON.stringify(cardTitles),
    );

    const yukBilgileriCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const group1 = groupCard(yukBilgileriCard, 1);
    await group1.waitFor({ state: "visible", timeout: 10000 });

    // ============================================================
    // 2 (Test A, C). "Konteyner" ilk seçenek + eski toggle sorusu YOK.
    // ============================================================
    console.log("\n=== 2. Test A/C: 'Konteyner' ilk seçenek, eski toggle sorusu YOK ===");
    const productTypeOptions = await getProductTypeOptionTexts(group1);
    record("A: 'Ürün / Yük Cinsi' listesinin İLK seçeneği 'Konteyner'", productTypeOptions[0] === "Konteyner", JSON.stringify(productTypeOptions.slice(0, 5)));
    const pageTextBeforeContainer = await reqPage.locator("body").innerText();
    record("C: Eski 'Yük konteyner olarak mı taşınacak?' sorusu YOK", !pageTextBeforeContainer.includes("Yük konteyner olarak mı taşınacak?"));

    // ============================================================
    // 3 (Test D, I, J). Konteyner seçilince konteyner alanları açılıyor,
    // normal Yük Şekli kapanıyor; ADR bölümü grubun altında, varsayılan Hayır.
    // ============================================================
    console.log("\n=== 3. Test D/I/J: Konteyner seçilince alanlar + ADR varsayılan Hayır ===");
    await selectProductTypeInScope(group1, "Konteyner");
    await group1.getByRole("button", { name: "Konteyner Tipi", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    record("D: Konteyner seçilince Konteyner Tipi alanı GÖRÜNÜR", await group1.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible());
    record(
      "D: Konteyner seçilince normal 'Yükün Hazırlanış Biçimi' alanı KAYBOLDU",
      !(await group1.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).isVisible().catch(() => false)),
    );
    const adrToggle = group1.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" });
    record("I: ADR bölümü Yük Grubu kartının İÇİNDE bulunuyor", await adrToggle.isVisible());
    record(
      "J: ADR varsayılan olarak Hayır",
      (await adrToggle.getByRole("radio", { name: "Hayır" }).getAttribute("aria-checked")) === "true",
    );

    // ============================================================
    // 4 (Test E, F). Dolu/Boş -> içerik alanı.
    // ============================================================
    console.log("\n=== 4. Test E/F: Dolu -> içerik alanı açılır, Boş -> kapanır ===");
    await selectSearchableInScope(group1, "Konteyner Tipi", "40' Standart", { exact: false });
    await selectSearchableInScope(group1, "Dolu / Boş", "Dolu");
    await group1.getByRole("button", { name: "Konteyner İçindeki Yük", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    record("E: Dolu seçilince 'Konteyner İçindeki Yük' alanı AÇILIYOR", await group1.getByRole("button", { name: "Konteyner İçindeki Yük", exact: true }).isVisible());
    await selectSearchableInScope(group1, "Dolu / Boş", "Boş");
    record(
      "F: Boş seçilince 'Konteyner İçindeki Yük' alanı KAPANIYOR",
      !(await group1.getByRole("button", { name: "Konteyner İçindeki Yük", exact: true }).isVisible().catch(() => false)),
    );
    // Dolu'ya geri dön, gerçek senaryo için (Grup 1 = dolu konteyner, makine/ekipman).
    await selectSearchableInScope(group1, "Dolu / Boş", "Dolu");
    await selectSearchableInScope(group1, "Konteyner İçindeki Yük", "Makine / Ekipman", { exact: false });
    await fillAndVerify(group1.locator('input[id$="-qty"]'), "1");
    await fillAndVerify(group1.locator('input[id$="-tonnage"]'), "12");

    // ============================================================
    // 5 (Test K, L). ADR Evet -> sınıf alanı; UN/Ambalaj Grubu/Resmi
    // Taşımacılık Adı/Emin Değilim YOK.
    // ============================================================
    console.log("\n=== 5. Test K/L: ADR Evet -> Sınıf alanı; UN/Ambalaj/Resmi Taşımacılık/Emin Değilim YOK ===");
    await setToggleInScope(group1, "Yük tehlikeli madde / ADR kapsamında mı?", "Evet");
    const adrClassSelect = group1.getByLabel("ADR Sınıfı", { exact: true });
    await adrClassSelect.waitFor({ state: "visible", timeout: 10000 });
    record("K: ADR 'Evet' seçilince ADR Sınıfı alanı AÇILIYOR", await adrClassSelect.isVisible());
    // "3" (Yanıcı sıvılar) grupsuz tek bir <option>, value="3" — gerçek
    // <option> metni "3 — Yanıcı sıvılar"dır (getImoClassOptionLabel), value
    // ile seçmek metin biçimine bağımlı olmadığı için daha sağlamdır.
    await adrClassSelect.selectOption("3");
    record("K: ADR Sınıfı gerçekten seçildi (value=3)", (await adrClassSelect.inputValue()) === "3");
    const group1Text = await group1.innerText();
    record("L: 'Emin Değilim' seçeneği YOK", !group1Text.includes("Emin Değilim"));
    record("L: 'UN Numarası' alanı YOK", !group1Text.includes("UN Numarası"));
    record("L: 'Ambalaj Grubu' alanı YOK", !group1Text.includes("Ambalaj Grubu"));
    record("L: 'Resmî Taşımacılık Adı' alanı YOK", !group1Text.includes("Resmî Taşımacılık Adı") && !group1Text.includes("Resmi Taşımacılık Adı"));

    // ============================================================
    // 6 (Test B). "Yükün Hazırlanış Biçimi" listesinde "Konteyner" YOK —
    // normal moda geçici olarak bakmak gerekiyor, Grup 2'de kontrol edelim.
    // ============================================================
    console.log("\n=== 6. Yeni Yük Grubu ekle (Test M, N, B, G, H) ===");
    await reqPage.getByRole("button", { name: "Başka Yük Grubu Ekle" }).click();
    const group2 = groupCard(yukBilgileriCard, 2);
    await group2.waitFor({ state: "visible", timeout: 10000 });

    const group2LoadPrepOptions = await (async () => {
      // Grup 2 varsayılan olarak normal moddadır (Hayır) — Yükün Hazırlanış
      // Biçimi zaten görünür.
      await group2.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).click();
      const listbox = group2.locator('ul[aria-label="Yükün Hazırlanış Biçimi"]').first();
      await listbox.waitFor({ state: "visible" });
      const texts = await listbox.getByRole("option").allInnerTexts();
      await reqPage.keyboard.press("Escape");
      return texts;
    })();
    record(
      "B: 'Yükün Hazırlanış Biçimi' listesinde 'Konteyner' YOK",
      !group2LoadPrepOptions.some((t) => t.includes("Konteyner")),
      JSON.stringify(group2LoadPrepOptions),
    );

    // Test G: Grup 2'yi ÖNCE Konteyner yap, sonra normal ürüne geri döndür —
    // konteyner alanları kapanmalı, Yük Şekli alanı açılmalı.
    await selectProductTypeInScope(group2, "Konteyner");
    await group2.getByRole("button", { name: "Konteyner Tipi", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await selectProductTypeInScope(group2, "Alüminyum Külçe");
    record(
      "G: Normal ürün seçilince Konteyner alanları KAPANIYOR",
      !(await group2.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible().catch(() => false)),
    );
    record("G: Normal ürün seçilince 'Yükün Hazırlanış Biçimi' alanı AÇILIYOR", await group2.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).isVisible());

    // Test H: Paletli seçilince palet alanları (Palet Türü) gösteriliyor.
    await selectSearchableInScope(group2, "Yükün Hazırlanış Biçimi", "Paletli");
    await fillAndVerify(group2.locator('input[id$="-quantity"]'), "12");
    await fillAndVerify(group2.locator('input[id$="-tonnage"]'), "4.2");
    const palletTypeSelect = group2.getByRole("button", { name: "Palet Ölçüsü", exact: true });
    record("H: 'Paletli' seçilince Palet Ölçüsü alanı GÖSTERİLİYOR (yalnız palet alanları)", await palletTypeSelect.isVisible().catch(() => false));

    // Test N: Grup 2'nin ADR'ı Hayır kalsın (varsayılan) — Grup 1'in Evet
    // durumundan BAĞIMSIZ olmalı.
    const group1AdrAfterGroup2 = group1.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" });
    const group2AdrToggle = group2.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" });
    record(
      "N: Grup 1 ADR hâlâ Evet (Grup 2 eklenmesinden ETKİLENMEDİ)",
      (await group1AdrAfterGroup2.getByRole("radio", { name: "Evet" }).getAttribute("aria-checked")) === "true",
    );
    record(
      "N: Grup 2 ADR varsayılan Hayır (Grup 1'in Evet durumundan BAĞIMSIZ)",
      (await group2AdrToggle.getByRole("radio", { name: "Hayır" }).getAttribute("aria-checked")) === "true",
    );

    // ============================================================
    // 7 (Test M). Kalan zorunlu alanları doldur, yayınla.
    // ============================================================
    console.log("\n=== 7. Kalan alanları doldur, yayınla (Test M) ===");
    const idSuffix = stamp.toString(36);
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklContTrig ${idSuffix}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Konteyner tetikleyicisi ürün/yük cinsine taşındı testi için otomatik ilan.");
    await fillNakliyePickupLocation(reqPage);
    const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await reqPage.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await reqPage.locator('input[type="date"]').nth(1).fill(todayPlus7);
    // Grup 2 hâlâ normal moddayken Araç Tercihi kartı görünmeli.
    if (await reqPage.getByText("Araç Tercihi", { exact: false }).first().isVisible().catch(() => false)) {
      await reqPage.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
    }
    await selectSearchable(reqPage, "Yükleme Yöntemi", 0, "Forklift ile");
    await uploadOnePhoto(reqPage);
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    await reqPage.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    record("M: Önizlemede 'Yük Grubu 1' ve 'Yük Grubu 2' ikisi de görünür", (await reqPage.locator("body").innerText()).includes("Yük Grubu 1") && (await reqPage.locator("body").innerText()).includes("Yük Grubu 2"));
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    await reqPage.waitForURL(/\/ilanlar\//, { timeout: 20000 });
    jobId = reqPage.url().split("/ilanlar/")[1].split("?")[0];
    record("M: Aynı ilanda konteyner + paletli yük birlikte oluşturuldu, id alındı", Boolean(jobId), jobId);

    // ============================================================
    // 8 (Test O - DB). Doğrudan SQL ile DB şekli doğrulama.
    // ============================================================
    console.log("\n=== 8. DB doğrulama (Test O) ===");
    const jobRow = await getJobRow(jobId);
    record("O: İlan Supabase'te bulundu", Boolean(jobRow));
    const groups = jobRow?.nakliye_cargo_groups;
    record("O: nakliye_cargo_groups 2 eleman içeriyor", Array.isArray(groups) && groups.length === 2, JSON.stringify(groups));
    const g1 = groups?.[0];
    const g2 = groups?.[1];
    record(
      "O: Grup 1 = Konteyner, Dolu, ADR Evet + Sınıf 3",
      g1?.productType === "Konteyner" && g1?.containerTransport?.status === "evet" && g1?.containerTransport?.loadStatus === "dolu" && g1?.hazmat?.status === "evet" && Boolean(g1?.hazmat?.adrClass),
      JSON.stringify(g1),
    );
    record(
      "O: Grup 1'in productTonnage'ı (PAYLAŞILAN alan) DOLU — grossWeightTon'a değil",
      g1?.productTonnage === 12 && g1?.containerTransport?.grossWeightTon === undefined,
      JSON.stringify({ productTonnage: g1?.productTonnage, grossWeightTon: g1?.containerTransport?.grossWeightTon }),
    );
    record(
      "O: Grup 2 = Alüminyum Külçe, Paletli, ADR Hayır",
      g2?.productType === "Alüminyum Külçe" && g2?.loadPreparationType === "paletli" && g2?.containerTransport?.status === "hayir" && g2?.hazmat?.status === "hayir",
      JSON.stringify(g2),
    );
    record(
      "O: Üst seviye (legacy ayna) alanlar GRUP 1'i yansıtıyor — productType='Konteyner', product_tonnage=12",
      jobRow?.product_type === "Konteyner" && Number(jobRow?.product_tonnage) === 12,
      JSON.stringify({ product_type: jobRow?.product_type, product_tonnage: jobRow?.product_tonnage }),
    );
    record(
      "O: Üst seviye nakliye_hazmat GRUP 1'i yansıtıyor (evet + sınıf)",
      jobRow?.nakliye_hazmat?.status === "evet" && Boolean(jobRow?.nakliye_hazmat?.adrClass),
      JSON.stringify(jobRow?.nakliye_hazmat),
    );

    // ============================================================
    // 9 (Test O - sahip detay). Owner detay sayfası.
    // ============================================================
    console.log("\n=== 9. Sahip (Hizmet Alan) detay sayfası (Test O) ===");
    await reqPage.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await reqPage.getByRole("heading", { name: /NaklContTrig/ }).waitFor({ state: "visible", timeout: 10000 });
    const ownerDetailText = await reqPage.locator("body").innerText();
    record("O: Sahip detayında 'Yük Grubu 1' VE 'Yük Grubu 2' ayrı gösteriliyor", ownerDetailText.includes("Yük Grubu 1") && ownerDetailText.includes("Yük Grubu 2"));
    record("O: Grup 1 için 'Konteyner Taşıması' bilgisi var", ownerDetailText.includes("Konteyner Taşıması"));
    record("O: Grup 1 için Tehlikeli Madde / ADR bilgisi var (Evet)", ownerDetailText.includes("Tehlikeli Madde / ADR"));
    record("O: Grup 2 için 'Paletli' hazırlanış bilgisi var", ownerDetailText.includes("Paletli"));
    // Grup 2'nin ADR'ı Hayır olduğu için formatHazmatSummary null döner —
    // "Tehlikeli Madde / ADR" satırı yalnızca BİR KEZ (Grup 1 için) görünmeli.
    const adrOccurrences = (ownerDetailText.match(/Tehlikeli Madde \/ ADR/g) || []).length;
    record("O: 'Tehlikeli Madde / ADR' satırı yalnızca Grup 1 için (Grup 2 Hayır -> hiç gösterilmiyor)", adrOccurrences === 1, `occurrences=${adrOccurrences}`);

    // ============================================================
    // 10 (Test O - admin düzenleme). Admin edit formu.
    // ============================================================
    console.log("\n=== 10. Admin düzenleme ekranı (Test O) ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: /Düzenle/i }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage.getByRole("button", { name: /Düzenle/i }).first().click();
    const adminYukBilgileri = adminPage.locator("fieldset").filter({ hasText: "Yük Bilgileri" }).first();
    await adminYukBilgileri.waitFor({ state: "visible", timeout: 10000 });
    record(
      "O: Admin formunda ayrı 'Tehlikeli Madde / ADR' fieldset'i YOK",
      !(await adminPage.locator("fieldset").getByText("Tehlikeli Madde / ADR", { exact: true }).first().isVisible().catch(() => false)),
    );
    const adminGroup1 = groupCard(adminYukBilgileri, 1);
    const adminGroup2 = groupCard(adminYukBilgileri, 2);
    await adminGroup1.waitFor({ state: "visible", timeout: 10000 });
    await adminGroup2.waitFor({ state: "visible", timeout: 10000 });
    record("O: Admin formunda Grup 1 Konteyner Tipi alanı GÖRÜNÜR (konteyner modu doğru tanındı)", await adminGroup1.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible());
    record(
      "O: Admin formunda Grup 1 ADR Evet önceden seçili",
      (await adminGroup1.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" }).getByRole("radio", { name: "Evet" }).getAttribute("aria-checked")) === "true",
    );
    record(
      "O: Admin formunda Grup 2 ADR Hayır önceden seçili",
      (await adminGroup2.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" }).getByRole("radio", { name: "Hayır" }).getAttribute("aria-checked")) === "true",
    );
    record("O: Admin formunda Grup 2 'Yükün Hazırlanış Biçimi' alanı GÖRÜNÜR (Paletli, normal mod)", await adminGroup2.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).isVisible());

    // Kaydet (değişiklik yapmadan) — regresyon kontrolü.
    const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" });
    await saveButton.waitFor({ state: "visible" });
    if (await saveButton.isEnabled()) {
      await saveButton.click();
      await adminPage.waitForTimeout(1500);
    }
    const jobRowAfterAdminSave = await getJobRow(jobId);
    const groupsAfterSave = jobRowAfterAdminSave?.nakliye_cargo_groups;
    record(
      "O: Admin kaydından SONRA da iki grup + ADR bilgileri korunuyor (regresyon yok)",
      Array.isArray(groupsAfterSave) &&
        groupsAfterSave.length === 2 &&
        groupsAfterSave[0]?.hazmat?.status === "evet" &&
        groupsAfterSave[1]?.hazmat?.status === "hayir" &&
        groupsAfterSave[0]?.productType === "Konteyner",
      JSON.stringify(groupsAfterSave),
    );

    // Onayla.
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    const approveButton = adminPage.getByRole("button", { name: "Onayla" }).first();
    await approveButton.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await adminPage.waitForTimeout(1500);
    }
    const jobRowAfterApprove = await getJobRow(jobId);
    record("O: Admin onayından sonra moderation_status = approved", jobRowAfterApprove?.moderation_status === "approved", jobRowAfterApprove?.moderation_status);

    // ============================================================
    // 11 (Test O - admin detay). Admin detay sayfası (onay sonrası).
    // ============================================================
    console.log("\n=== 11. Admin detay sayfası (onay sonrası, Test O) ===");
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("Yük Grubu 1", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    // Not: yalnızca "Yük Grubu N" alt başlığı CSS `uppercase` ile gösterilir
    // (admin-job-detail.tsx) — InfoRow etiketleri (Konteyner Taşıması,
    // Tehlikeli Madde / ADR) DEĞİL. JS'in locale-bağımsız `.toUpperCase()`u
    // Türkçe "i"yi ASCII "I"ya çevirir (Türkçe "İ" DEĞİL) — bu yüzden
    // "Tehlikeli" gibi küçük "i" içeren metinler ham (büyütülmemiş) hâliyle
    // karşılaştırılmalı, yalnızca "Yük Grubu" için büyütülmüş kopya kullanılır.
    const adminDetailTextRaw = await adminPage.locator("body").innerText();
    const adminDetailTextUpper = adminDetailTextRaw.toUpperCase();
    record("O: Admin detay sayfasında Yük Grubu 1 ve 2 ayrı ayrı görünür", adminDetailTextUpper.includes("YÜK GRUBU 1") && adminDetailTextUpper.includes("YÜK GRUBU 2"));
    record("O: Admin detay sayfasında Konteyner Taşıması bilgisi var", adminDetailTextRaw.includes("Konteyner Taşıması"));
    record("O: Admin detay sayfasında Tehlikeli Madde / ADR bilgisi var", adminDetailTextRaw.includes("Tehlikeli Madde / ADR"));

    // ============================================================
    // 12 (Test P). Eski (toggle-tabanlı konteyner + job-seviyeli hazmat)
    // ilanların bozulmadan açılması.
    // ============================================================
    console.log("\n=== 12. Eski (legacy) kayıt güvenliği (Test P) ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    const legacyYukCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const legacyGroup1 = groupCard(legacyYukCard, 1);
    await legacyGroup1.waitFor({ state: "visible", timeout: 10000 });
    await selectProductTypeInScope(legacyGroup1, "Alüminyum");
    await selectSearchableInScope(legacyGroup1, "Yükün Hazırlanış Biçimi", "Paletli");
    await fillAndVerify(legacyGroup1.locator('input[id$="-quantity"]'), "5");
    await fillAndVerify(legacyGroup1.locator('input[id$="-tonnage"]'), "2");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklContTrig Legacy ${stamp.toString(36)}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Eski toggle tabanlı konteyner ve job seviyeli ADR kaydı simülasyonu.");
    await fillNakliyePickupLocation(reqPage);
    await reqPage.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await reqPage.locator('input[type="date"]').nth(1).fill(todayPlus7);
    if (await reqPage.getByText("Araç Tercihi", { exact: false }).first().isVisible().catch(() => false)) {
      await reqPage.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
    }
    await selectSearchable(reqPage, "Yükleme Yöntemi", 0, "Forklift ile");
    await uploadOnePhoto(reqPage);
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    await reqPage.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    await reqPage.waitForURL(/\/ilanlar\//, { timeout: 20000 });
    legacyJobId = reqPage.url().split("/ilanlar/")[1].split("?")[0];
    record("P: Legacy simülasyonu için taze ilan oluşturuldu", Boolean(legacyJobId), legacyJobId);

    // Gerçek eski (bu görevden ÖNCEki) şekli simüle et: toggle-tabanlı
    // konteyner (productType hiç yok, containerTransport.status='evet') +
    // job-seviyeli tri-state hazmat (nakliye_hazmat), nakliye_cargo_groups=null.
    await reqPage.evaluate((jid) => {
      const raw = window.localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      const job = jobs.find((j) => j.id === jid);
      if (!job) throw new Error("localStorage'da ilan bulunamadı: " + jid);
      job.nakliyeCargoGroups = undefined;
      job.productType = undefined;
      job.productQuantity = undefined;
      job.productTonnage = undefined;
      job.nakliyeDetails = {
        ...(job.nakliyeDetails ?? {}),
        loadPreparationType: undefined,
        loadPreparationCustomText: undefined,
        measurementInfo: undefined,
        containerTransport: { status: "evet", containerType: "40dc", loadStatus: "bos", quantity: 2, grossWeightTon: 18 },
        hazmat: { status: "evet", adrClass: "3" },
      };
      window.localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    }, legacyJobId);
    await dbQuery(
      `update public.jobs set nakliye_cargo_groups = null, product_type = null, product_quantity = null, product_tonnage = null, nakliye_load_preparation_type = null, nakliye_container_transport = '{"status":"evet","containerType":"40dc","loadStatus":"bos","quantity":2,"grossWeightTon":18}'::jsonb, nakliye_hazmat = '{"status":"evet","adrClass":"3"}'::jsonb where id = '${legacyJobId}';`,
    );
    const legacyRowBefore = await getJobRow(legacyJobId);
    record(
      "P: SQL ile eski şekil simüle edildi (toggle-container + job-level hazmat, cargo_groups=null)",
      legacyRowBefore?.nakliye_container_transport?.status === "evet" && legacyRowBefore?.nakliye_hazmat?.status === "evet" && legacyRowBefore?.nakliye_cargo_groups === null,
    );

    // 12a. Detay sayfası — çökmeden, Konteyner + ADR bilgisiyle açılmalı.
    await reqPage.goto(`${APP_ORIGIN}/ilanlar/${legacyJobId}`, { waitUntil: "domcontentloaded" });
    await reqPage.getByRole("heading", { name: /NaklContTrig Legacy/ }).waitFor({ state: "visible", timeout: 10000 });
    const legacyDetailText = await reqPage.locator("body").innerText();
    record("P: Eski kayıt detay sayfası HATASIZ açıldı", legacyDetailText.includes("NaklContTrig Legacy"));
    record("P: Eski kayıt detayında 'Konteyner Taşıması' bilgisi (toggle'dan sentezlenmiş) var", legacyDetailText.includes("Konteyner Taşıması"));
    record("P: Eski kayıt detayında Tehlikeli Madde / ADR bilgisi (job-seviyeli hazmat'tan sentezlenmiş) var", legacyDetailText.includes("Tehlikeli Madde / ADR"));

    // 12b. Düzenleme formu — Konteyner alanları önceden dolu/doğru açılmalı,
    // ADR Evet + Sınıf 3 önceden seçili olmalı.
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${legacyJobId}/duzenle`, { waitUntil: "domcontentloaded" });
    const editYukCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const editGroup1 = groupCard(editYukCard, 1);
    await editGroup1.waitFor({ state: "visible", timeout: 10000 });
    const editProductTypeInput = editGroup1.getByRole("combobox", { name: "Ürün/Yük Cinsi" });
    record("P: Düzenleme formunda Grup 1 'Ürün/Yük Cinsi' = Konteyner (eski toggle'dan sentezlendi)", (await editProductTypeInput.inputValue()) === "Konteyner");
    record("P: Düzenleme formunda Konteyner Tipi alanı GÖRÜNÜR (eski toggle doğru tanındı)", await editGroup1.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible());
    const editAdrToggle = editGroup1.getByRole("radiogroup", { name: "Yük tehlikeli madde / ADR kapsamında mı?" });
    record(
      "P: Düzenleme formunda ADR Evet önceden seçili (eski job-seviyeli hazmat'tan sentezlendi)",
      (await editAdrToggle.getByRole("radio", { name: "Evet" }).getAttribute("aria-checked")) === "true",
    );

    // Hiçbir şeyi değiştirmeden kaydet — DB'de eski konteyner/ADR verisi
    // silinmemeli (kanıtsız veri kaybı yok).
    const editSubmitBtn = reqPage.locator('button[type="submit"]').first();
    if (await editSubmitBtn.isVisible().catch(() => false)) {
      await editSubmitBtn.click();
      await reqPage.waitForURL((url) => !url.pathname.includes("/duzenle"), { timeout: 15000 }).catch(() => {});
    }
    const legacyRowAfterSave = await getJobRow(legacyJobId);
    const legacyGroupsAfterSave = legacyRowAfterSave?.nakliye_cargo_groups;
    record(
      "P: Değiştirmeden kaydetme sonrası Konteyner/ADR bilgisi KORUNDU (yeni nakliyeCargoGroups dizisine doğru yazıldı)",
      Array.isArray(legacyGroupsAfterSave) &&
        legacyGroupsAfterSave.length === 1 &&
        legacyGroupsAfterSave[0]?.productType === "Konteyner" &&
        legacyGroupsAfterSave[0]?.hazmat?.status === "evet" &&
        legacyGroupsAfterSave[0]?.hazmat?.adrClass === "3",
      JSON.stringify(legacyGroupsAfterSave),
    );
  } finally {
    await browser.close();
  }

  console.log("\n=== SONUÇ ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length > 0) {
    console.log("BAŞARISIZ testler:");
    for (const f of failed) console.log(` - ${f.name}${f.detail ? " :: " + f.detail : ""}`);
    process.exitCode = 1;
  }
  if (jobId) console.log(`\nÇoklu grup test ilanı: ${APP_ORIGIN}/ilanlar/${jobId}`);
  if (legacyJobId) console.log(`Legacy simülasyon ilanı: ${APP_ORIGIN}/ilanlar/${legacyJobId}`);
}

main().catch((error) => {
  console.error("KRİTİK HATA:", error);
  process.exitCode = 1;
});
