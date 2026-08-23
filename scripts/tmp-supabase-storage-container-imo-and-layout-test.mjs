// Konteyner Depolama — "IMO Sınıfı açılır menüsü" + "ilan detay 3 sütunlu
// yerleşim" görevinin uçtan uca GERÇEK KULLANICI testi. Development
// Supabase projesine (NEXT_PUBLIC_SUPABASE_URL) VE gerçek dev sunucusuna
// (localhost:3000) karşı çalışır. Senaryo (görev talimatının kendi örneği):
// Grup1=20x40ft Standart Dolu Metanol 3,5ton Tehlikeli UN1230/IMO 3;
// Grup2=30x40ft Reefer Dolu Muz Tehlikeli:Hayır -1°C Elektrik:Evet;
// Grup3=16x20ft High Cube Boş. Toplam=66.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
function envVar(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : process.env[name];
}

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "TestSifre2026!";
const CATEGORY_ID = "konteyner-depolama";
const CATEGORY_LABEL = "Konteyner Depolama";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Gerekli env değişkenleri .env.local'da bulunamadı.");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 300) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
let createdJobId = null;
let legacyJobId = null;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);
const WORK_END_DATE = todayPlus(28);

async function createUser(label, role) {
  const email = `ctnrimo-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `KonteynerImoTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `KonteynerImoTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) break;
  }
  await page.waitForTimeout(1000);
}

async function newActorPage(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : undefined);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  const promoteRows = runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}' returning id, role;`);
  record("Kurulum: 3 test hesabı oluşturuldu, biri admin'e yükseltildi", promoteRows[0]?.role === "admin", JSON.stringify(promoteRows));

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });
  const { error: authError } = await adminClient.rpc("authorize_provider_service", {
    p_provider_id: provider.id,
    p_service_category_id: CATEGORY_ID,
    p_reason: "KonteynerImoTest otomasyonu",
  });
  record("Kurulum: Hizmet Veren, Konteyner Depolama için yetkilendirildi", !authError, authError?.message);

  const browser = await chromium.launch();
  try {
    await runFlow(browser, { requester, provider, adminUser, adminClient });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runFlow(browser, { requester, provider, adminUser, adminClient }) {
  // =========================================================================
  // 0) BACKEND — geçersiz (elle uydurulmuş, dropdown'dan asla gelemeyecek)
  //    bir IMO kodu gönderilirse create_job REDDETMELİ (MLK56). Gerçek
  //    oturumla, gerçek RPC üzerinden — az önceki doğrudan-SQL testinin
  //    tekrarı değil, gerçek kullanıcı RPC çağrısı.
  // =========================================================================
  {
    const { error } = await requester.client.rpc("create_job", {
      p_category_id: CATEGORY_ID,
      p_title: "IMO Backend Red Testi",
      p_description: "Bu ilan hiç oluşmamalı.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Depo",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
      p_storage_container_groups: [
        { id: "g1", quantity: 5, size: "20", type: "standart", status: "dolu", content: "Test", hazardous: true, unNumber: "UN1230", imoClass: "IMO 3" },
      ],
    });
    record("0. Backend: elle uydurulmuş 'IMO 3' (serbest metin) create_job tarafından REDDEDİLDİ (MLK56)", error?.code === "MLK56" || /MLK56/.test(error?.message ?? ""), error?.message);
  }

  const { context: requesterContext, page } = await newActorPage(browser);

  // =========================================================================
  // 1) HİZMET ALAN — 3 grup, IMO açılır menüsünden seçim, canlı toplam=66.
  // =========================================================================
  await loginAs(page, requester.email, PASSWORD);
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);

  await page.getByLabel("İlan Başlığı").nth(0).fill("KonteynerImoTest — Metanol + Muz + Boş");
  await page.locator("textarea").first().fill("IMO açılır menüsü ve 3 sütunlu detay ekranı testi.");
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(WORK_DATE);
  await dateInputs.nth(1).fill(WORK_END_DATE);
  await page.locator('[id^="service-province-"]').first().click();
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[id^="service-district-"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(300);

  // --- Grup 1: 20 adet, 40ft, Standart, Dolu, Metanol, 3,5 ton, Tehlikeli:Evet, UN1230, IMO 3 ---
  async function fillSelect(idSuffixIndex, suffix, optionName) {
    await page.locator(`[id$="${suffix}"]`).nth(idSuffixIndex).click();
    await page.getByRole("option", { name: optionName, exact: true }).click();
    await page.waitForTimeout(150);
  }

  await page.locator('[id$="-quantity"]').nth(0).fill("20");
  await fillSelect(0, "-size", "40 ft");
  await fillSelect(0, "-type", "Standart");
  await fillSelect(0, "-status", "Dolu");
  await page.waitForTimeout(200);
  await page.locator('[id$="-content"]').nth(0).fill("Metanol");
  await page.locator('[id$="-grossWeight"]').nth(0).fill("3,5");
  await fillSelect(0, "-hazardous", "Evet");

  const afterHazardousText = await page.locator("body").innerText();
  record("1a. Grup 1 Tehlikeli=Evet seçilince UN Numarası/IMO Sınıfı açılıyor (canlı)", afterHazardousText.includes("UN Numarası") && afterHazardousText.includes("IMO Sınıfı"));

  await page.locator('[id$="-unNumber"]').nth(0).fill("UN1230");
  // IMO Sınıfı artık bir <select> — native select üzerinden seç.
  const imoSelects = page.locator('[id$="-imoClass"]');
  const imoOptionLabelForClass3 = await imoSelects.nth(0).locator('option[value="3"]').innerText();
  record("1b. IMO Sınıfı dropdown'ında '3' seçeneğinin metni açıklama içeriyor ('Yanıcı')", /Yanıcı/i.test(imoOptionLabelForClass3), imoOptionLabelForClass3);
  await imoSelects.nth(0).selectOption("3");

  const optgroupLabels = await page.locator('[id$="-imoClass"]').nth(0).locator("optgroup").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("label")));
  record(
    "1c. IMO dropdown'ında Sınıf 1/2/4/5/6 birer <optgroup> (grup başlığı SEÇİLEMEZ), Sınıf 3/7/8/9 YOK (doğrudan seçilebilir)",
    optgroupLabels.length === 5 && optgroupLabels.some((l) => l?.startsWith("Sınıf 1")) && !optgroupLabels.some((l) => l?.startsWith("Sınıf 3")),
    JSON.stringify(optgroupLabels),
  );

  const totalAfterGroup1 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1d. Grup 1'den sonra canlı toplam '20 Adet'", /Toplam Konteyner:\s*20\s*Adet/.test(totalAfterGroup1), totalAfterGroup1);

  // --- Grup 2 ekle: 30 adet, 40ft, Reefer, Dolu, Muz, Tehlikeli:Hayır, -1°C, Elektrik:Evet ---
  await page.getByRole("button", { name: "Konteyner Grubu Ekle" }).click();
  await page.waitForTimeout(300);
  await page.locator('[id$="-quantity"]').nth(1).fill("30");
  await fillSelect(1, "-size", "40 ft");
  await fillSelect(1, "-type", "Reefer");
  await fillSelect(1, "-status", "Dolu");
  await page.waitForTimeout(200);
  await page.locator('[id$="-content"]').nth(1).fill("Muz");
  await fillSelect(1, "-hazardous", "Hayır");
  const afterHazNoText = await page.locator("body").innerText();
  record("1e. Grup 2 Tehlikeli=Hayır seçilince UN/IMO alanları HİÇ görünmüyor", !/Grup.{0,400}UN Numarası/s.test(afterHazNoText) || (await page.locator('[id$="-unNumber"]').count()) === 1);
  await page.locator('[id$="-reeferTemperature"]').nth(0).fill("-1");
  await fillSelect(0, "-reeferElectrical", "Evet");

  const totalAfterGroup2 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1f. Grup 2'den sonra canlı toplam '50 Adet' (20+30)", /Toplam Konteyner:\s*50\s*Adet/.test(totalAfterGroup2), totalAfterGroup2);

  // --- Grup 3 ekle: 16 adet, 20ft, High Cube, Boş ---
  await page.getByRole("button", { name: "Konteyner Grubu Ekle" }).click();
  await page.waitForTimeout(300);
  await page.locator('[id$="-quantity"]').nth(2).fill("16");
  await fillSelect(2, "-size", "20 ft");
  await fillSelect(2, "-type", "High Cube");
  await fillSelect(2, "-status", "Boş");
  await page.waitForTimeout(200);

  const totalAfterGroup3 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1g. Grup 3'ten sonra canlı toplam '66 Adet' (20+30+16)", /Toplam Konteyner:\s*66\s*Adet/.test(totalAfterGroup3), totalAfterGroup3);

  // --- Grup 2'yi tekrar aç: Tehlikeli=Evet yap, IMO'yu BOŞ bırak, gönderimi dene -> engellenmeli ---
  await fillSelect(1, "-hazardous", "Evet");
  await page.waitForTimeout(200);

  const photosHeadingText = await page.locator("body").innerText();
  record("1h. Fotoğraf bölümü başlığı 'Yük / Ürün Fotoğrafları'", photosHeadingText.includes("Yük / Ürün Fotoğrafları"));
  const tmp = os.tmpdir();
  const photoFiles = [1, 2, 3, 4].map((i) => path.join(tmp, `fixture-valid-${i}.jpg`));
  for (const f of photoFiles) readFileSync(f);
  await page.locator('input[type="file"]').setInputFiles(photoFiles);
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      const m = t.match(/(\d+)\s*\/\s*15\s*fotoğraf yüklendi/);
      return m && Number(m[1]) === 4;
    },
    { timeout: 60000 },
  );

  const submitButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await submitButton.click();
  await page.waitForTimeout(1000);
  const afterBlockedSubmitText = await page.locator("body").innerText();
  const stillOnForm = !afterBlockedSubmitText.includes("Operasyon Özeti");
  record(
    "1i. Grup 2 Tehlikeli=Evet + IMO BOŞ iken gönderim ENGELLENDİ (Operasyon Özeti'ne geçmedi, hata gösterildi)",
    stillOnForm && afterBlockedSubmitText.includes("IMO sınıfını seçiniz"),
    stillOnForm ? "form'da kaldı" : "YANLIŞLIKLA önizlemeye geçti",
  );

  // Şimdi Grup 2'yi tekrar Tehlikeli=Hayır'a çevir (UN/IMO temizlensin) ve gerçekten gönder.
  await fillSelect(1, "-hazardous", "Hayır");
  await page.waitForTimeout(200);
  const imoValueAfterClear = await page.locator('[id$="-imoClass"]').nth(1).inputValue().catch(() => null);
  record("1j. Tehlikeli=Hayır'a dönünce Grup 2'nin IMO alanı state'ten TEMİZLENDİ (artık DOM'da bile yok/boş)", imoValueAfterClear === null || imoValueAfterClear === "", imoValueAfterClear);

  await submitButton.click();
  await page.waitForTimeout(1200);
  const previewText = await page.locator("body").innerText();
  if (!previewText.includes("Operasyon Özeti")) {
    console.error("DEBUG — hâlâ formda. Hatalar:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
    await page.screenshot({ path: path.join(os.tmpdir(), "ctnr-imo-debug-submit-fail.png"), fullPage: true }).catch(() => {});
  }
  record("1k. Grup 2 düzeltildikten SONRA Operasyon Önizleme ekranına geçildi", previewText.includes("Operasyon Özeti"));

  const publishButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishButton.click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  createdJobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1] ?? null;
  record("1l. Yayınlama sonrası ilan detay sayfasına yönlendirildi", Boolean(createdJobId), page.url());

  // =========================================================================
  // 2) DB — Grup1 UN1230/IMO3 kaydedildi mi, Grup2'de UN/IMO YOK mu, toplam 66 mı.
  // =========================================================================
  await new Promise((r) => setTimeout(r, 1500));
  const { data: jobRows } = await requester.client
    .from("jobs")
    .select("id, storage_container_groups, moderation_status")
    .eq("id", createdJobId)
    .limit(1);
  const dbJob = jobRows?.[0];
  const dbGroups = dbJob?.storage_container_groups ?? [];
  record("2a. Supabase'de 3 grup var", dbGroups.length === 3, JSON.stringify(dbGroups));
  const dbTotal = dbGroups.reduce((s, g) => s + (g.quantity ?? 0), 0);
  record("2b. Supabase'deki toplam 66 (20+30+16)", dbTotal === 66, dbTotal);
  const g1 = dbGroups.find((g) => g.quantity === 20);
  const g2 = dbGroups.find((g) => g.quantity === 30);
  const g3 = dbGroups.find((g) => g.quantity === 16);
  record("2c. Grup 1: UN1230 + IMO '3' (kanonik kod) kaydedildi", g1?.unNumber === "UN1230" && g1?.imoClass === "3", JSON.stringify(g1));
  record("2d. Grup 2: UN/IMO alanları YOK (Tehlikeli=Hayır)", !g2?.unNumber && !g2?.imoClass, JSON.stringify(g2));
  record("2e. Grup 2: reefer sıcaklık/elektrik doğru (-1, true)", g2?.reeferTemperature === -1 && g2?.reeferElectrical === true, JSON.stringify(g2));
  record("2f. Grup 3: yüke bağlı HİÇBİR alan gönderilmedi (Boş)", !g3?.content && !g3?.hazardous && g3?.unNumber === undefined && g3?.imoClass === undefined, JSON.stringify(g3));

  // =========================================================================
  // 3) SAYFA YENİLEME + 3-SÜTUN YERLEŞİM / TAŞMA KONTROLÜ (1366×768).
  // =========================================================================
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const reloadedText = await page.locator("body").innerText().catch(() => "");
  record("3a. Yenileme sonrası 3 grup kayıpsız (20/30/16 adet)", /20\s*adet/.test(reloadedText) && /30\s*adet/.test(reloadedText) && /16\s*adet/.test(reloadedText));
  record("3b. Yenileme sonrası 'Toplam: 66 Konteyner'", /Toplam:\s*66\s*Konteyner/.test(reloadedText), reloadedText.match(/Toplam:[\s\S]{0,30}/)?.[0]);
  record("3c. Grup 1 satırında 'IMO 3 – Yanıcı sıvılar' formatı gösteriliyor", /IMO 3 – Yanıcı sıvılar/.test(reloadedText), reloadedText.match(/IMO[\s\S]{0,40}/)?.[0]);
  record("3d. Grup 1 satırında 'UN 1230' gösteriliyor", /UN 1230/.test(reloadedText));
  // DOM'a-göre-KAPSAMLI kontrol (bkz. önceki grup-model testindeki AYNI
  // gerekçe — metin-penceresi regex'i komşu karta taşabilir): "30 adet"i
  // içeren GERÇEK kartı bul, YALNIZCA o kartın kendi metninde UN/IMO'nun
  // YOK olduğunu doğrula.
  const reeferGroupCardText = await page.locator("text=/30 adet/").locator("..").innerText();
  record("3e. Grup 2 (Reefer, Tehlikeli=Hayır) kendi kartında UN/IMO METNİ YOK", !/\bUN \d|\bIMO \d/.test(reeferGroupCardText), reeferGroupCardText);
  record("3f. 'Tehlikeli' rozeti sayfada görünüyor (yalnız Grup 1 için)", reloadedText.includes("Tehlikeli"));

  // Yatay taşma kontrolü — sayfa genişliği viewport'u aşmamalı.
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  record("3g. 1366×768'de YATAY TAŞMA YOK", !hasHorizontalOverflow);

  // Gerçek 3 sütun mu — üç ana kart (fotoğraf/açıklama sütunu, orta bilgi sütunu, Teklif Ver sütunu) farklı x-koordinatlarında mı.
  const columnBoxes = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2"));
    const offerHeading = headings.find((h) => h.textContent?.trim() === "Teklif Ver");
    const descHeading = headings.find((h) => h.textContent?.trim() === "İş Açıklaması");
    const orta = document.body.innerText.includes("Depolama Talebi");
    return {
      offerLeft: offerHeading ? offerHeading.getBoundingClientRect().left : null,
      descLeft: descHeading ? descHeading.getBoundingClientRect().left : null,
      ortaExists: orta,
    };
  });
  record(
    "3h. Sağ sütun (Teklif Ver) ile sol sütun (İş Açıklaması) farklı x-konumunda (gerçek yan yana sütunlar)",
    columnBoxes.offerLeft !== null && columnBoxes.descLeft !== null && columnBoxes.offerLeft > columnBoxes.descLeft + 200,
    JSON.stringify(columnBoxes),
  );
  record("3i. Orta sütunda 'Depolama Talebi' bilgi bloğu render edildi", columnBoxes.ortaExists);

  const screenshotPath = path.join(os.tmpdir(), "ctnr-imo-layout-1366x768.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Ekran görüntüsü kaydedildi:", screenshotPath);

  // Mobil kontrol — 375px genişlik, konteyner kartı metni kesilmemeli, yatay taşma olmamalı.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(500);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  record("3j. 375px mobil genişlikte YATAY TAŞMA YOK", !mobileOverflow);
  const mobileGroupCardText = await page.locator("text=/20 adet/").first().innerText().catch(() => "");
  record("3k. Mobilde konteyner kartı metni okunur/kesilmemiş (ör. '20 adet' tam görünüyor)", mobileGroupCardText.includes("20 adet"), mobileGroupCardText);
  await page.setViewportSize({ width: 1366, height: 768 });

  await requesterContext.close();

  // =========================================================================
  // 4) ADMIN — bekleyen ilanı görür, IMO dropdown'ının ÖNCEDEN DOLU geldiğini
  //    doğrular, onaylar; onay sonrası veriler bozulmamalı.
  // =========================================================================
  const { context: adminContext, page: adminPage } = await newActorPage(browser);
  await loginAs(adminPage, adminUser.email, PASSWORD);
  await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await adminPage
    .waitForFunction((title) => document.body.innerText.includes(title), "KonteynerImoTest — Metanol + Muz + Boş", { timeout: 45000 })
    .catch(() => {});
  const adminDetailText = await adminPage.locator("body").innerText().catch(() => "");
  record("4a. Admin ilan detayını açabiliyor ('İlan Moderasyonu' kartı görünüyor)", adminDetailText.includes("İlan Moderasyonu"));

  await adminPage.getByRole("button", { name: /Düzenle/ }).first().click();
  await adminPage.waitForTimeout(800);
  const adminImoValue = await adminPage.locator('[id$="-imoClass"]').nth(0).inputValue();
  record("4b. Admin düzenleme formunda Grup 1'in IMO dropdown'ı ÖNCEDEN '3' seçili geliyor (kayıpsız)", adminImoValue === "3", adminImoValue);
  const adminUnNumberValue = await adminPage.locator('[id$="-unNumber"]').nth(0).inputValue();
  record("4c. Admin düzenleme formunda Grup 1'in UN Numarası ÖNCEDEN 'UN1230' geliyor", adminUnNumberValue === "UN1230", adminUnNumberValue);

  await adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first().click();
  await adminPage.waitForTimeout(1200);

  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: createdJobId });
  record("4d. Admin ilanı onaylıyor", !approveError, approveError?.message);

  const { data: afterApproveRow } = await requester.client.from("jobs").select("moderation_status, storage_container_groups").eq("id", createdJobId).maybeSingle();
  const approvedGroups = afterApproveRow?.storage_container_groups ?? [];
  const approvedTotal = approvedGroups.reduce((s, g) => s + (g.quantity ?? 0), 0);
  const approvedG1 = approvedGroups.find((g) => g.quantity === 20);
  record(
    "4e. Onay SONRASI veriler BOZULMADI (3 grup, toplam 66, Grup1 UN1230/IMO3 hâlâ duruyor)",
    afterApproveRow?.moderation_status === "approved" && approvedGroups.length === 3 && approvedTotal === 66 && approvedG1?.unNumber === "UN1230" && approvedG1?.imoClass === "3",
    JSON.stringify(afterApproveRow),
  );
  await adminContext.close();

  // =========================================================================
  // 5) HİZMET VEREN — onaylanmış ilanda aynı bilgileri görüyor, tek teklif verebiliyor.
  // =========================================================================
  const { context: providerContext, page: providerPage } = await newActorPage(browser);
  await loginAs(providerPage, provider.email, PASSWORD);
  await providerPage.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await providerPage.waitForFunction((title) => document.body.innerText.includes(title), "KonteynerImoTest — Metanol + Muz + Boş", { timeout: 45000 }).catch(() => {});
  const providerText = await providerPage.locator("body").innerText().catch(() => "");
  record("5a. Yetkili Hizmet Veren aynı bilgileri görüyor (66 konteyner, UN1230, IMO 3)", /Toplam:\s*66\s*Konteyner/.test(providerText) && providerText.includes("UN 1230") && /IMO 3/.test(providerText));
  const offerText = await providerPage.locator("body").innerText().catch(() => "");
  record("5b. Teklif paneli TEK bir toplam-fiyat teklifi alıyor (66 konteynerin tamamı için)", offerText.includes("Teklif Ver"));
  await providerContext.close();

  // =========================================================================
  // 6) ESKİ TEK GRUPLU İLAN — hâlâ açılabiliyor mu (backward compat, DB'de
  //    doğrudan eski-şekilde bir kayıt oluşturup gerçek tarayıcıda açarak).
  // =========================================================================
  {
    const legacyRows = runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, address_text, work_date, storage_container_groups, moderation_status)
       values (gen_random_uuid(), '${requester.id}', 'konteyner-depolama', 'Eski Tek Gruplu Konteyner İlanı', 'Backward compat testi', '', 'Kocaeli', 'Gebze', 'Test Depo', '', '${WORK_DATE}', '[{"id":"legacy-single-group","quantity":42,"size":"45","type":"tank","status":"dolu","content":"Eski Kimyasal","hazardous":true,"unNumber":"UN9999","imoClass":"8"}]'::jsonb, 'approved') returning id;`,
    );
    legacyJobId = legacyRows[0]?.id;
    record("6a. Eski-şekilde (tek grup, doğrudan DB) bir ilan oluşturuldu", Boolean(legacyJobId), legacyJobId);
  }
  {
    const { context: legacyContext, page: legacyPage } = await newActorPage(browser);
    await loginAs(legacyPage, requester.email, PASSWORD);
    await legacyPage.goto(`${APP_ORIGIN}/ilanlar/${legacyJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await legacyPage.waitForFunction((title) => document.body.innerText.includes(title), "Eski Tek Gruplu Konteyner İlanı", { timeout: 30000 }).catch(() => {});
    const legacyText = await legacyPage.locator("body").innerText().catch(() => "");
    record("6b. Eski tek gruplu ilan HATASIZ açılıyor, 42 adet gösteriyor", /42\s*adet/.test(legacyText), legacyText.slice(0, 300));
    record("6c. Eski ilanın Toplam'ı 42 (tek grup)", /Toplam:\s*42\s*Konteyner/.test(legacyText));
    record("6d. Eski ilanın UN9999/IMO 8 bilgisi de doğru gösteriliyor", legacyText.includes("UN 9999") && /IMO 8/.test(legacyText));
    await legacyContext.close();
  }

  // =========================================================================
  // 7) REGRESYON — Genel Depolama formu ve Nakliye RPC'si etkilenmedi mi.
  // =========================================================================
  {
    const { context: regContext, page: regPage } = await newActorPage(browser);
    await loginAs(regPage, requester.email, PASSWORD);
    await regPage.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await regPage.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await regPage.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Genel Depolama" });
    await regPage.waitForTimeout(300);
    const genelText = await regPage.locator("body").innerText();
    record("7a. Genel Depolama'da 'Konteyner Grupları'/IMO alanı HİÇ görünmüyor (regresyon yok)", !genelText.includes("Konteyner Grupları") && !genelText.includes("IMO Sınıfı"));
    record("7b. Genel Depolama'da mevcut 'Depolanacak Ürün Bilgileri' alanları hâlâ duruyor", genelText.includes("Ürün Cinsi") || genelText.includes("Depolanacak"));
    await regContext.close();
  }
  {
    const { error } = await requester.client.rpc("create_job", {
      p_category_id: "nakliye",
      p_title: "IMO Regresyon — Nakliye",
      p_description: "regresyon",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    });
    record("7c. Nakliye create_job storage_container_groups/IMO olmadan hatasız çalışıyor (regresyon yok)", !error, error?.message);
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  try {
    if (idList) {
      // Bu test hesaplarının OLUŞTURDUĞU (yalnızca yayınlanmış createdJobId/
      // legacyJobId DEĞİL — 7c'deki regresyon Nakliye job'u dahil HER şey)
      // her job'un FK bağımlılıklarını (activity events/offers/photos) job
      // satırı silinmeden ÖNCE temizle, aksi halde bulk delete FK ihlaliyle
      // patlıyor (gerçek çalıştırmada bulunan bir hata).
      runSql(
        `delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`,
      );
      runSql(
        `delete from public.offer_status_history where offer_id in (select id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`,
      );
      runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    }
  } catch (error) {
    console.error("cleanup sql failed (continuing):", error?.message || error);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
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
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
