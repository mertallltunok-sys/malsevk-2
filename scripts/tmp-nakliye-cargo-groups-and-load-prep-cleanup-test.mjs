// node scripts/tmp-nakliye-cargo-groups-and-load-prep-cleanup-test.mjs
//
// "Nakliye Çoklu Yük Grubu" + "Konteyner İçinde" kaldırma görevlerinin
// uçtan uca doğrulaması — gerçek tarayıcıya karşı (Playwright, gerçek
// Chromium), Development Supabase projesine (trfnmpihcnriqgikglpu) karşı,
// migration 0066 sonrası.
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
    const debugPath = path.join(os.tmpdir(), `nakliye-cargo-groups-login-debug-${Date.now()}-${attempt}.png`);
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

async function getSearchableOptionTexts(scope, label) {
  await scope.getByRole("button", { name: label, exact: true }).first().click();
  const listbox = scope.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  const texts = await listbox.getByRole("option").allInnerTexts();
  // Kapatmak için Escape (dışarı tıklamak yerine, portalsız/inline listbox
  // için daha güvenilir).
  await scope.page().keyboard.press("Escape");
  return texts;
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

async function getJobRow(jobId, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const rows = await dbQuery(
        `select id, moderation_status, category_id, product_quantity, product_tonnage, product_type, product_tonnage_unit, nakliye_load_preparation_type, nakliye_container_transport, nakliye_cargo_groups, updated_at from public.jobs where id = '${jobId}';`,
      );
      return rows[0] ?? null;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`getJobRow: deneme ${attempt} başarısız, tekrar deneniyor...`);
    }
  }
  return null;
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `naklcargo-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklCargo Requester",
    companyName: "NaklCargo Firma",
  });
  const adminAccount = await createAccount({
    email: `naklcargo-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "NaklCargo Admin",
    companyName: "NaklCargo Admin Firma",
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
    // 1. Oluşturma formu — kart sırası, "3 — Konteyner Taşıması" yok.
    // ============================================================
    console.log("\n=== 1. Kart sırası (7 kart, ayrı Konteyner Taşıması kartı yok) ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");

    const badgeRows = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface > div.flex.flex-wrap.items-center.justify-between > div.flex.items-center.gap-2");
    const count = await badgeRows.count();
    const actualTitles = [];
    for (let i = 0; i < count; i++) {
      actualTitles.push((await badgeRows.nth(i).locator("p").first().innerText()).trim());
    }
    const expectedTitles = ["Temel Bilgiler", "Yük Bilgileri", "Tehlikeli Madde / ADR", "Taşıma Planı", "Araç Tercihi", "Yükleme ve Teslimat", "Fotoğraflar ve Belgeler"];
    record("Kart sırası doğru, ayrı 'Konteyner Taşıması' kartı YOK", JSON.stringify(actualTitles) === JSON.stringify(expectedTitles), JSON.stringify(actualTitles));

    // ============================================================
    // 2. Yük Grubu 1 — varsayılan Hayır, dropdown'da "Konteyner İçinde" YOK.
    // ============================================================
    console.log("\n=== 2. Yük Grubu 1: varsayılan Hayır + Konteyner İçinde yok ===");
    const yukBilgileriCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const group1 = groupCard(yukBilgileriCard, 1);
    await group1.waitFor({ state: "visible", timeout: 10000 });
    const toggle1 = group1.getByRole("radiogroup", { name: "Yük konteyner olarak mı taşınacak?" });
    const hayirRadio1 = toggle1.getByRole("radio", { name: "Hayır" });
    record("Yük Grubu 1 varsayılan olarak Hayır seçili", (await hayirRadio1.getAttribute("aria-checked")) === "true");
    record(
      "Yük Grubu 1'de normal alanlar (Ürün/Yük Cinsi) görünür",
      await group1.getByRole("combobox", { name: "Ürün/Yük Cinsi" }).isVisible().catch(() => false),
    );
    record(
      "Yük Grubu 1'de Konteyner Bilgileri alanları GÖRÜNMÜYOR (Konteyner Tipi yok)",
      !(await group1.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible().catch(() => false)),
    );
    const group1LoadPrepOptions = await getSearchableOptionTexts(group1, "Yükün Hazırlanış Biçimi");
    record(
      "Yük Grubu 1 'Yükün Hazırlanış Biçimi' listesinde 'Konteyner İçinde' YOK",
      !group1LoadPrepOptions.some((t) => t.includes("Konteyner İçinde")),
      JSON.stringify(group1LoadPrepOptions),
    );

    // ============================================================
    // 3. Yük Grubu 1'i Evet'e çevir — konteyner alanları açılır.
    // ============================================================
    console.log("\n=== 3. Yük Grubu 1: Evet -> Konteyner alanları ===");
    await setToggleInScope(group1, "Yük konteyner olarak mı taşınacak?", "Evet");
    record(
      "Evet sonrası normal alanlar (Ürün/Yük Cinsi) KAYBOLDU",
      !(await group1.getByRole("combobox", { name: "Ürün/Yük Cinsi" }).isVisible().catch(() => false)),
    );
    record(
      "Evet sonrası Konteyner Tipi alanı GÖRÜNÜR",
      await group1.getByRole("button", { name: "Konteyner Tipi", exact: true }).isVisible().catch(() => false),
    );
    await selectSearchableInScope(group1, "Konteyner Tipi", "40' Standart");
    await selectSearchableInScope(group1, "Dolu / Boş", "Dolu");
    record(
      "Dolu seçilince 'Dolu Konteyner Bilgileri' alt kartı açılır (Konteyner İçindeki Yük)",
      await group1.getByRole("button", { name: "Konteyner İçindeki Yük", exact: true }).isVisible().catch(() => false),
    );
    await selectSearchableInScope(group1, "Konteyner İçindeki Yük", "Makine / Ekipman");
    await fillAndVerify(group1.locator('input[id$="-qty"]').first(), "1");

    // ============================================================
    // 4. "+ Başka Yük Grubu Ekle" -> Yük Grubu 2 (Hayır, Paletli).
    // ============================================================
    console.log("\n=== 4. Yük Grubu 2 ekleme ===");
    await yukBilgileriCard.getByRole("button", { name: "Başka Yük Grubu Ekle" }).click();
    const group2 = groupCard(yukBilgileriCard, 2);
    await group2.waitFor({ state: "visible", timeout: 10000 });
    const hayirRadio2 = group2.getByRole("radiogroup", { name: "Yük konteyner olarak mı taşınacak?" }).getByRole("radio", { name: "Hayır" });
    record("Yeni Yük Grubu 2 varsayılan olarak Hayır", (await hayirRadio2.getAttribute("aria-checked")) === "true");
    const group2LoadPrepOptions = await getSearchableOptionTexts(group2, "Yükün Hazırlanış Biçimi");
    record(
      "Yük Grubu 2 'Yükün Hazırlanış Biçimi' listesinde de 'Konteyner İçinde' YOK",
      !group2LoadPrepOptions.some((t) => t.includes("Konteyner İçinde")),
      JSON.stringify(group2LoadPrepOptions),
    );
    await fillAndVerify(group2.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
    await selectSearchableInScope(group2, "Yükün Hazırlanış Biçimi", "Paletli");
    await fillAndVerify(group2.locator('input[id$="-quantity"]').first(), "12");
    await fillAndVerify(group2.locator('input[id$="-tonnage"]').first(), "4,2");

    // ============================================================
    // 5. Kalan alanlar: Taşıma Planı / Araç Tercihi / Yükleme ve Teslimat / ADR / Fotoğraf.
    // ============================================================
    console.log("\n=== 5. Kalan alanları doldur ===");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklCargo Çoklu Grup ${idSuffix}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Çoklu yük grubu testi için otomatik oluşturulan ilan açıklaması.");
    await fillNakliyePickupLocation(reqPage);
    const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await reqPage.locator('input[type="date"]').nth(0).fill(todayPlus7);
    await reqPage.locator('input[type="date"]').nth(1).fill(todayPlus7);
    // Araç Tercihi — Grup 2 Hayır olduğu için görünür olmalı.
    const aracTercihiVisible = await reqPage.getByText("Araç Tercihi", { exact: false }).first().isVisible().catch(() => false);
    record("Araç Tercihi kartı GÖRÜNÜR (en az bir grup Hayır modunda)", aracTercihiVisible);
    if (aracTercihiVisible) {
      await reqPage.getByRole("checkbox", { name: /uygun aracı önersin/i }).first().check();
    }
    await selectSearchable(reqPage, "Yükleme Yöntemi", 0, "Forklift ile");
    await uploadOnePhoto(reqPage);

    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    try {
      await reqPage.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
    } catch (waitError) {
      const debugPath = path.join(os.tmpdir(), `nakliye-cargo-groups-debug-${Date.now()}.png`);
      await reqPage.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
      const dangerTexts = await reqPage.locator(".text-danger").allInnerTexts().catch(() => []);
      console.error("publish: önizlemeye geçilemedi. Ekran görüntüsü:", debugPath, "hatalar:", JSON.stringify(dangerTexts));
      throw waitError;
    }
    // Önizleme özetinde her iki Yük Grubu satırı da görünmeli.
    const previewText = await reqPage.locator("body").innerText();
    record("Önizlemede 'Yük Grubu 1' ve 'Yük Grubu 2' ikisi de görünür", previewText.includes("Yük Grubu 1") && previewText.includes("Yük Grubu 2"));
    await reqPage.getByRole("button", { name: "İlanı Yayınla" }).click();
    await reqPage.waitForURL(/\/ilanlar\//, { timeout: 20000 });
    jobId = reqPage.url().split("/ilanlar/")[1].split("?")[0];
    record("İlan oluşturuldu, id alındı", Boolean(jobId), jobId);

    // ============================================================
    // 6. DB doğrulama.
    // ============================================================
    console.log("\n=== 6. DB doğrulama ===");
    const jobRow = await getJobRow(jobId);
    record("İlan Supabase'te bulundu", Boolean(jobRow));
    if (jobRow) {
      const groups = jobRow.nakliye_cargo_groups;
      record("nakliye_cargo_groups 2 eleman içeriyor", Array.isArray(groups) && groups.length === 2, JSON.stringify(groups));
      if (Array.isArray(groups) && groups.length === 2) {
        record("Grup 1 konteyner modunda (evet)", groups[0].containerTransport?.status === "evet", JSON.stringify(groups[0]));
        record("Grup 1 konteyner tipi/miktar doğru", groups[0].containerTransport?.containerType === "40-standart" && groups[0].containerTransport?.loadStatus === "dolu" && groups[0].containerTransport?.quantity === 1);
        record("Grup 2 normal modda (hayır), Paletli", groups[1].containerTransport?.status === "hayir" && groups[1].loadPreparationType === "paletli", JSON.stringify(groups[1]));
        record("Grup 2 productQuantity/Tonnage doğru", groups[1].productQuantity === 12 && groups[1].productTonnage === 4.2);
      }
      record(
        "Üst seviye (legacy ayna) alanlar GRUP 1'i (konteyner) yansıtıyor: product_* NULL, nakliye_container_transport dolu",
        jobRow.product_quantity === null && jobRow.product_tonnage === null && jobRow.product_type === null && jobRow.nakliye_load_preparation_type === null,
        JSON.stringify({ pq: jobRow.product_quantity, pt: jobRow.product_tonnage, ptype: jobRow.product_type, nlpt: jobRow.nakliye_load_preparation_type }),
      );
      record(
        "Üst seviye nakliye_container_transport grup 1'i yansıtıyor",
        jobRow.nakliye_container_transport?.status === "evet" && jobRow.nakliye_container_transport?.containerType === "40-standart",
        JSON.stringify(jobRow.nakliye_container_transport),
      );
    }

    // ============================================================
    // 7. Sahip detay sayfası.
    // ============================================================
    console.log("\n=== 7. Sahip (Hizmet Alan) detay sayfası ===");
    await reqPage.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await reqPage.getByText(jobRow ? "Yük Grubu 1" : "x", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const detailText = await reqPage.locator("body").innerText();
    record("Detay sayfasında 'Yük Grubu 1' VE 'Yük Grubu 2' ayrı ayrı gösteriliyor", detailText.includes("Yük Grubu 1") && detailText.includes("Yük Grubu 2"));
    record("Detay sayfasında Grup 1 için 'Konteyner Taşıması' bilgisi var", detailText.includes("Konteyner Taşıması"));
    record("Detay sayfasında Grup 2 için 'Paletli' hazırlanış bilgisi var", detailText.includes("Paletli"));

    // ============================================================
    // 8. Admin düzenleme ekranı.
    // ============================================================
    console.log("\n=== 8. Admin düzenleme ekranı ===");
    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: /Düzenle/i }).first().waitFor({ state: "visible", timeout: 15000 });
    await adminPage.getByRole("button", { name: /Düzenle/i }).first().click();
    const adminYukBilgileri = adminPage.locator("fieldset").filter({ hasText: "Yük Bilgileri" }).first();
    await adminYukBilgileri.waitFor({ state: "visible", timeout: 10000 });
    record("Admin formunda başlık 'Yük Bilgileri' (Nakliye)", await adminYukBilgileri.getByText("Yük Bilgileri", { exact: true }).first().isVisible());
    record(
      "Admin formunda ayrı 'Konteyner Taşıması' fieldset'i YOK",
      !(await adminPage.locator("fieldset").getByText("Konteyner Taşıması", { exact: true }).first().isVisible().catch(() => false)),
    );
    const adminGroup1 = groupCard(adminYukBilgileri, 1);
    const adminGroup2 = groupCard(adminYukBilgileri, 2);
    await adminGroup1.waitFor({ state: "visible", timeout: 10000 });
    await adminGroup2.waitFor({ state: "visible", timeout: 10000 });
    record("Admin formunda Grup 1 Evet (Konteyner) önceden seçili", (await adminGroup1.getByRole("radiogroup", { name: "Yük konteyner olarak mı taşınacak?" }).getByRole("radio", { name: "Evet" }).getAttribute("aria-checked")) === "true");
    record("Admin formunda Grup 2 Hayır önceden seçili", (await adminGroup2.getByRole("radiogroup", { name: "Yük konteyner olarak mı taşınacak?" }).getByRole("radio", { name: "Hayır" }).getAttribute("aria-checked")) === "true");
    const adminGroup2LoadPrepOptions = await getSearchableOptionTexts(adminGroup2, "Yükün Hazırlanış Biçimi");
    record(
      "Admin formunda da 'Yükün Hazırlanış Biçimi' listesinde 'Konteyner İçinde' YOK",
      !adminGroup2LoadPrepOptions.some((t) => t.includes("Konteyner İçinde")),
      JSON.stringify(adminGroup2LoadPrepOptions),
    );

    // Kaydet (değişiklik yapmadan) — coalesce/aynalama regresyonu kontrolü.
    const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" });
    await saveButton.waitFor({ state: "visible" });
    if (await saveButton.isEnabled()) {
      await saveButton.click();
      await adminPage.waitForTimeout(1500);
    }
    const jobRowAfterAdminSave = await getJobRow(jobId);
    const groupsAfterSave = jobRowAfterAdminSave?.nakliye_cargo_groups;
    record(
      "Admin kaydından SONRA da iki grup korunuyor (regresyon yok)",
      Array.isArray(groupsAfterSave) && groupsAfterSave.length === 2,
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
    record("Admin onayından sonra moderation_status = approved", jobRowAfterApprove?.moderation_status === "approved", jobRowAfterApprove?.moderation_status);

    // ============================================================
    // 9. Admin detay sayfası (onay sonrası).
    // ============================================================
    console.log("\n=== 9. Admin detay sayfası (onay sonrası) ===");
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("Yük Grubu 1", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const adminDetailText = await adminPage.locator("body").innerText();
    // Not: grup başlığı CSS `uppercase` ile gösterilir (admin-job-detail.tsx) —
    // innerText() render edilmiş (BÜYÜK HARF) metni döner, ham JSX string'i değil.
    const adminDetailTextUpper = adminDetailText.toUpperCase();
    record(
      "Admin detay sayfasında Yük Grubu 1 ve 2 ayrı ayrı görünür",
      adminDetailTextUpper.includes("YÜK GRUBU 1") && adminDetailTextUpper.includes("YÜK GRUBU 2"),
    );
    record("Admin detay sayfasında Grup 1 için Konteyner Taşıması bilgisi var", adminDetailText.includes("Konteyner Taşıması"));

    // ============================================================
    // 10. Eski "konteyner-icinde" kaydının güvenliği.
    // ============================================================
    console.log("\n=== 10. Eski 'konteyner-icinde' kaydı güvenliği ===");
    await reqPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded" });
    await reqPage.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
    const legacyYukCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const legacyGroup1 = groupCard(legacyYukCard, 1);
    await legacyGroup1.waitFor({ state: "visible", timeout: 10000 });
    await fillAndVerify(legacyGroup1.getByRole("combobox", { name: "Ürün/Yük Cinsi" }), "Genel Kargo");
    await selectSearchableInScope(legacyGroup1, "Yükün Hazırlanış Biçimi", "Paletli");
    await fillAndVerify(legacyGroup1.locator('input[id$="-quantity"]').first(), "5");
    await fillAndVerify(legacyGroup1.locator('input[id$="-tonnage"]').first(), "2");
    await reqPage.getByLabel("İlan Başlığı").first().fill(`NaklCargo Legacy ${idSuffix}`);
    await reqPage.getByLabel("Açıklama", { exact: false }).first().fill("Eski hazırlanış biçimi değeri simülasyonu için otomatik oluşturulan ilan.");
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
    record("Legacy simülasyonu için taze ilan oluşturuldu", Boolean(legacyJobId), legacyJobId);

    // Gerçek Development'ta bulunan 4 eski kaydın AYNI şeklini simüle et:
    // nakliye_load_preparation_type = 'konteyner-icinde', nakliye_cargo_groups = null.
    // ÖNEMLİ: job-detail-content.tsx/job-edit-form.tsx bu ilan için localStorage'ı
    // okur (bu tarayıcı ilanı KENDİSİ oluşturdu, hâlâ pending_review — useAllJobs()'in
    // remoteWinsOverLocal kuralı yerel kopyayı korur) — SADECE Supabase satırını
    // güncellemek bu tarayıcının gördüğü veriyi DEĞİŞTİRMEZ. Bu yüzden asıl
    // "kullanıcı kendi eski ilanını kendi cihazında düzenliyor" senaryosunu doğru
    // simüle etmek için localStorage kopyası da AYNI şekilde elle bozulur.
    await reqPage.evaluate((jid) => {
      const raw = window.localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      const job = jobs.find((j) => j.id === jid);
      if (!job) throw new Error("localStorage'da ilan bulunamadı: " + jid);
      job.nakliyeCargoGroups = undefined;
      job.nakliyeDetails = { ...(job.nakliyeDetails ?? {}), loadPreparationType: "konteyner-icinde" };
      window.localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    }, legacyJobId);
    await dbQuery(`update public.jobs set nakliye_load_preparation_type = 'konteyner-icinde', nakliye_cargo_groups = null where id = '${legacyJobId}';`);
    const legacyRowBefore = await getJobRow(legacyJobId);
    record("SQL ile eski değer simüle edildi (konteyner-icinde, cargo_groups=null)", legacyRowBefore?.nakliye_load_preparation_type === "konteyner-icinde" && legacyRowBefore?.nakliye_cargo_groups === null);

    // 10a. Detay sayfası — çökmeden, "Konteyner İçinde" etiketiyle açılmalı (ham id değil).
    await reqPage.goto(`${APP_ORIGIN}/ilanlar/${legacyJobId}`, { waitUntil: "domcontentloaded" });
    await reqPage.getByRole("heading", { name: /NaklCargo Legacy/ }).waitFor({ state: "visible", timeout: 10000 });
    const legacyDetailText = await reqPage.locator("body").innerText();
    record("Eski kayıt detay sayfası HATASIZ açıldı", legacyDetailText.includes("NaklCargo Legacy"));
    record(
      "Eski kayıt detayında 'Konteyner İçinde' okunabilir etiketle gösteriliyor (ham id değil)",
      legacyDetailText.includes("Konteyner İçinde") && !legacyDetailText.includes("konteyner-icinde"),
    );

    // 10b. Düzenleme formu — dropdown boş görünmeli, değiştirmeden kaydetmek engellenmeli.
    await reqPage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${legacyJobId}/duzenle`, { waitUntil: "domcontentloaded" });
    const editYukCard = reqPage.locator("div.rounded-\\[10px\\].border.border-border.bg-surface").filter({ hasText: "Yük Bilgileri" }).first();
    const editGroup1 = groupCard(editYukCard, 1);
    await editGroup1.waitFor({ state: "visible", timeout: 10000 });
    const editLoadPrepButtonText = await editGroup1.getByRole("button", { name: "Yükün Hazırlanış Biçimi", exact: true }).first().innerText();
    record(
      "Düzenleme formu HATASIZ açıldı, dropdown 'Konteyner İçinde' GÖSTERMİYOR (eşleşen seçenek yok, Seçiniz görünüyor)",
      editLoadPrepButtonText.trim() === "Seçiniz",
      editLoadPrepButtonText,
    );
    // Formu göndermeyi dene — doğrulama hatası (Yükün hazırlanış biçimini seçiniz) beklenir, DB'de eski değer AYNEN kalmalı.
    const submitBtn = reqPage.locator('button[type="submit"]').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await reqPage.waitForTimeout(800);
    }
    const legacyRowAfterBlockedSubmit = await getJobRow(legacyJobId);
    record(
      "Değiştirmeden kaydetme DENEMESİ eski değeri SİLMEDİ/DEĞİŞTİRMEDİ (kayıt hâlâ konteyner-icinde)",
      legacyRowAfterBlockedSubmit?.nakliye_load_preparation_type === "konteyner-icinde",
      legacyRowAfterBlockedSubmit?.nakliye_load_preparation_type,
    );
    record("Sayfa hâlâ düzenleme ekranında (yönlendirme olmadı — gönderim engellendi)", reqPage.url().includes("/duzenle"));

    // 10c. Şimdi gerçek/geçerli bir değer seçip kaydet — gerçek save çalışmalı.
    await selectSearchableInScope(editGroup1, "Yükün Hazırlanış Biçimi", "Kolili / Paketli");
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await reqPage.waitForURL((url) => !url.pathname.includes("/duzenle"), { timeout: 15000 }).catch(() => {});
    }
    const legacyRowAfterRealSave = await getJobRow(legacyJobId);
    record(
      "Geçerli yeni bir hazırlanış biçimi seçilip kaydedince DB güncellendi (kolili-paketli)",
      legacyRowAfterRealSave?.nakliye_load_preparation_type === "kolili-paketli" ||
        legacyRowAfterRealSave?.nakliye_cargo_groups?.[0]?.loadPreparationType === "kolili-paketli",
      JSON.stringify({ top: legacyRowAfterRealSave?.nakliye_load_preparation_type, groups: legacyRowAfterRealSave?.nakliye_cargo_groups }),
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
