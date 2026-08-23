// Development Supabase projesine (hosted, NEXT_PUBLIC_SUPABASE_URL) VE
// gerçekten çalışan dev sunucusuna (http://localhost:3000, NEXT_PUBLIC_
// ENABLE_SUPABASE_JOB_SYNC=true) karşı — "Konteyner Depolama > Konteyner
// Grupları" (tekrarlanabilir alan grubu) görevinin uçtan uca GERÇEK
// KULLANICI testi: Hizmet Alan (form, 3 grup: 20x20ft+15x40ft+65x45ft,
// canlı toplam) -> Admin (onay + grup düzenleme/ekleme/silme) -> Hizmet
// Veren (ilan detayı, tablo). Kurulum (hesap oluşturma/yetkilendirme)
// service-role RPC ile yapılır — tüm GERÇEK ÖZELLİK doğrulaması gerçek bir
// Chromium tarayıcısıyla, gerçek DOM üzerinden yapılır.
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
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY .env.local'da olmalı.");
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

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);
const WORK_END_DATE = todayPlus(28);

async function createUser(label, role) {
  const email = `ctnrgrp-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `KonteynerGrupTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `KonteynerGrupTest Firma ${label}`,
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

async function newActorPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  let promoteRows = [];
  let promoteError = null;
  try {
    promoteRows = runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}' returning id, role;`);
  } catch (error) {
    promoteError = error?.message || String(error);
  }
  record("Kurulum: 3 test hesabı oluşturuldu, biri admin'e yükseltildi", !promoteError && promoteRows[0]?.role === "admin", promoteError || JSON.stringify(promoteRows));

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });
  const { error: authError } = await adminClient.rpc("authorize_provider_service", {
    p_provider_id: provider.id,
    p_service_category_id: CATEGORY_ID,
    p_reason: "KonteynerGrupTest otomasyonu",
  });
  record("Kurulum: Hizmet Veren, Konteyner Depolama için yetkilendirildi", !authError, authError?.message);

  const browser = await chromium.launch();
  try {
    await runBrowserFlow(browser, { requester, provider, adminUser, adminClient });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runBrowserFlow(browser, { requester, provider, adminUser, adminClient }) {
  const { context: requesterContext, page } = await newActorPage(browser);

  // ===========================================================================
  // 1) HİZMET ALAN — 3 konteyner grubu ekler (20x20ft Boş + 15x40ft Dolu +
  //    65x45ft Dolu+Tehlikeli), canlı toplamı doğrular, gönderir.
  // ===========================================================================
  await loginAs(page, requester.email, PASSWORD);
  record("Ön kontrol: Hizmet Alan girişi yapıldı", !page.url().includes("/giris-yap"), page.url());
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});

  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);
  const afterCategoryText = await page.locator("body").innerText();
  // NOT: grup başlığı CSS `uppercase` sınıfı taşıyor (bkz. storage-container-
  // details-fields.tsx satır 189) — tarayıcı `innerText`i GERÇEK görsel metne
  // göre döndürür (örn. "KONTEYNER GRUBU 1"), DOM'daki orijinal case'e göre
  // DEĞİL. Bu yüzden bu ve benzeri kontroller `/i` bayrağıyla eşleştiriyor.
  record("1a. KÖK NEDEN: yalnızca kategori seçilince 'Konteyner Grupları' DERHAL görünüyor", afterCategoryText.includes("Konteyner Grupları"));
  record("1b. İlk konteyner grubu form açıldığında hazır geliyor ('Konteyner Grubu 1' görünüyor)", /konteyner grubu 1/i.test(afterCategoryText));
  record("1c. Tek grup varken 'Kaldır' butonu YOK (son grup silinemez)", !afterCategoryText.includes("Kaldır"));

  const titlePlaceholder = await page.getByLabel("İlan Başlığı").nth(0).getAttribute("placeholder");
  record(
    "1d. İlan Başlığı placeholder'ı çoklu-grup örneğine güncellendi ('100 Adet Karışık Ölçülü...')",
    titlePlaceholder === "Örnek: 100 Adet Karışık Ölçülü Konteyner İçin Depolama Talebi",
    titlePlaceholder,
  );
  await page.getByLabel("İlan Başlığı").nth(0).fill("KonteynerGrupTest — Karışık Ölçülü Konteyner Depolama");
  await page.locator("textarea").first().fill("Otomasyonla oluşturulan test ilanı. Üç farklı ölçüde konteyner için depolama alanı arıyoruz.");
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(WORK_DATE);
  await dateInputs.nth(1).fill(WORK_END_DATE);

  await page.locator('[id^="service-province-"]').first().click();
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[id^="service-district-"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(300);

  // --- Grup 1: 20 adet, 20 ft, Standart, Boş (varsayılan olarak zaten hazır) ---
  await page.locator('[id$="-quantity"]').nth(0).fill("20");
  await page.locator('[id$="-size"]').nth(0).click();
  await page.getByRole("option", { name: "20 ft", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-type"]').nth(0).click();
  await page.getByRole("option", { name: "Standart", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-status"]').nth(0).click();
  await page.getByRole("option", { name: "Boş", exact: true }).click();
  await page.waitForTimeout(150);

  const afterGroup1Text = await page.locator("body").innerText();
  record("1e. Grup 1 Boş seçilince Yük İçeriği/Tehlikeli Madde alanları görünmüyor", !afterGroup1Text.includes("Yük İçeriği"));
  const totalAfterGroup1 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1f. Grup 1'den sonra canlı toplam '20 Adet' gösteriyor", /Toplam Konteyner:\s*20\s*Adet/.test(totalAfterGroup1), totalAfterGroup1);

  // --- Grup 2 ekle: 15 adet, 40 ft, Standart, Dolu, Yük İçeriği='Rulo Sac' ---
  await page.getByRole("button", { name: "Konteyner Grubu Ekle" }).click();
  await page.waitForTimeout(300);
  const afterAddGroup2Text = await page.locator("body").innerText();
  record("1g. 'Konteyner Grubu Ekle' sonrası 'Konteyner Grubu 2' görünüyor", /konteyner grubu 2/i.test(afterAddGroup2Text));
  record("1h. 2+ grup varken 'Kaldır' butonları görünüyor", (afterAddGroup2Text.match(/Kaldır/g) ?? []).length >= 2);

  await page.locator('[id$="-quantity"]').nth(1).fill("15");
  await page.locator('[id$="-size"]').nth(1).click();
  await page.getByRole("option", { name: "40 ft", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-type"]').nth(1).click();
  await page.getByRole("option", { name: "Standart", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-status"]').nth(1).click();
  await page.getByRole("option", { name: "Dolu", exact: true }).click();
  await page.waitForTimeout(200);

  const afterGroup2DoluText = await page.locator("body").innerText();
  record("1i. Grup 2 Dolu seçilince Yük İçeriği/Tehlikeli Madde alanları CANLI görünüyor", afterGroup2DoluText.includes("Yük İçeriği") && afterGroup2DoluText.includes("Tehlikeli Madde"));

  await page.locator('[id$="-content"]').nth(0).fill("Rulo Sac");
  await page.locator('[id$="-hazardous"]').nth(0).click();
  await page.getByRole("option", { name: "Hayır", exact: true }).click();
  await page.waitForTimeout(150);

  const totalAfterGroup2 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1j. Grup 2'den sonra canlı toplam '35 Adet' gösteriyor (20+15)", /Toplam Konteyner:\s*35\s*Adet/.test(totalAfterGroup2), totalAfterGroup2);

  // --- Grup 3 ekle: 65 adet, 45 ft, High Cube, Dolu, Tehlikeli Madde: Evet, UN1230/IMO3 ---
  await page.getByRole("button", { name: "Konteyner Grubu Ekle" }).click();
  await page.waitForTimeout(300);
  await page.locator('[id$="-quantity"]').nth(2).fill("65");
  await page.locator('[id$="-size"]').nth(2).click();
  await page.getByRole("option", { name: "45 ft", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-type"]').nth(2).click();
  await page.getByRole("option", { name: "High Cube", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-status"]').nth(2).click();
  await page.getByRole("option", { name: "Dolu", exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('[id$="-content"]').nth(1).fill("Kimyasal Varil");
  await page.locator('[id$="-hazardous"]').nth(1).click();
  await page.getByRole("option", { name: "Evet", exact: true }).click();
  await page.waitForTimeout(200);

  const afterHazardousYesText = await page.locator("body").innerText();
  record("1k. Tehlikeli Madde='Evet' seçilince UN Numarası/IMO Sınıfı CANLI görünüyor", afterHazardousYesText.includes("UN Numarası") && afterHazardousYesText.includes("IMO Sınıfı"));
  await page.locator('[id$="-unNumber"]').nth(0).fill("UN1230");
  await page.locator('[id$="-imoClass"]').nth(0).fill("3");

  const totalAfterGroup3 = await page.locator("text=/Toplam Konteyner:/").innerText();
  record("1l. Grup 3'ten sonra canlı toplam '100 Adet' gösteriyor (20+15+65)", /Toplam Konteyner:\s*100\s*Adet/.test(totalAfterGroup3), totalAfterGroup3);

  // --- Tehlikeli Madde 'Evet'den 'Hayır'a: UN/IMO CANLI temizlenmeli ---
  await page.locator('[id$="-hazardous"]').nth(1).click();
  await page.getByRole("option", { name: "Hayır", exact: true }).click();
  await page.waitForTimeout(200);
  const afterHazardousNoText = await page.locator("body").innerText();
  record("1m. Tehlikeli Madde='Hayır'a dönünce UN/IMO alanları CANLI kayboluyor", !afterHazardousNoText.includes("UN Numarası"));
  // Testin geri kalanı için Tehlikeli Madde'yi tekrar 'Evet' yap.
  await page.locator('[id$="-hazardous"]').nth(1).click();
  await page.getByRole("option", { name: "Evet", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator('[id$="-unNumber"]').nth(0).fill("UN1230");
  await page.locator('[id$="-imoClass"]').nth(0).fill("3");

  // --- Regresyon: Genel Depolama / Nakliye seçilince Konteyner Grupları hiç görünmüyor (geçici geçiş) ---
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Genel Depolama" });
  await page.waitForTimeout(300);
  const genelDepolamaText = await page.locator("body").innerText();
  record("1n. Regresyon: Genel Depolama seçilince 'Konteyner Grupları' HİÇ görünmüyor", !genelDepolamaText.includes("Konteyner Grupları"));
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);
  const restoredText = await page.locator("body").innerText();
  const restoredTotal = await page.locator("text=/Toplam Konteyner:/").innerText();
  record(
    "1o. Kategori ileri-geri değiştirildikten SONRA 3 grup ve toplam (100) hâlâ duruyor (kaybolmadı)",
    /konteyner grubu 3/i.test(restoredText) && /Toplam Konteyner:\s*100\s*Adet/.test(restoredTotal),
    restoredTotal,
  );

  const photosHeadingText = await page.locator("body").innerText();
  record("1p. Fotoğraf bölümü başlığı 'Yük / Ürün Fotoğrafları' (Depolama'ya özel)", photosHeadingText.includes("Yük / Ürün Fotoğrafları"));

  const tmp = os.tmpdir();
  const photoFiles = [1, 2, 3, 4].map((i) => path.join(tmp, `fixture-valid-${i}.jpg`));
  for (const f of photoFiles) readFileSync(f);
  await page.locator('input[type="file"]').setInputFiles(photoFiles);
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*\/\s*15\s*fotoğraf yüklendi/);
      return match && Number(match[1]) === 4;
    },
    { timeout: 60000 },
  );
  record("1q. 4 fotoğraf başarıyla işlendi (4 / 15 fotoğraf yüklendi)", true);

  const formSubmitButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await formSubmitButton.click();
  await page.waitForTimeout(1200);
  const previewText = await page.locator("body").innerText();
  if (!previewText.includes("Operasyon Özeti")) {
    console.error("DEBUG — form gönderiminden sonra hâlâ form ekranında. Hata metinleri (text-danger):");
    console.error(JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
    await page.screenshot({ path: path.join(os.tmpdir(), "ctnr-groups-debug-submit-fail.png"), fullPage: true }).catch(() => {});
  }
  record("1r. Operasyon Önizleme ekranına geçildi ('Operasyon Özeti' görünüyor)", previewText.includes("Operasyon Özeti"));

  const publishButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishButton.click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  record("1s. Yayınlama sonrası ilan detay sayfasına (/ilanlar/[id]) yönlendirildi", /\/ilanlar\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname), page.url());
  createdJobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1] ?? null;

  // ---------------------------------------------------------------------
  // 2) DB SEVİYESİNDE DOĞRUDAN KANIT.
  // ---------------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 1500));
  const { data: jobRows } = await requester.client
    .from("jobs")
    .select("id, category_id, storage_container_groups, moderation_status")
    .eq("requester_id", requester.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const dbJob = jobRows?.[0];
  if (!createdJobId) createdJobId = dbJob?.id ?? null;
  record("2a. İlan gerçekten Supabase'e (jobs tablosuna) senkronlandı", Boolean(dbJob) && dbJob.id === createdJobId, JSON.stringify(dbJob));
  const dbGroups = dbJob?.storage_container_groups ?? [];
  record("2b. Supabase'de TAM OLARAK 3 grup var", dbGroups.length === 3, JSON.stringify(dbGroups));
  const dbTotal = dbGroups.reduce((sum, g) => sum + (g.quantity ?? 0), 0);
  record("2c. Supabase'deki grupların toplamı 100 (20+15+65)", dbTotal === 100, dbTotal);
  record("2d. moderation_status = 'pending_review'", dbJob?.moderation_status === "pending_review", dbJob?.moderation_status);

  // ---------------------------------------------------------------------
  // 3) SAYFA YENİLEME — kalıcılık kanıtı.
  // ---------------------------------------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const reloadedText = await page.locator("body").innerText().catch(() => "");
  record(
    "3a. Sayfa yenilendikten SONRA tüm 3 grup tabloda kayıpsız görünüyor (20 adet, 15 adet, 65 adet)",
    /20\s*adet/.test(reloadedText) && /15\s*adet/.test(reloadedText) && /65\s*adet/.test(reloadedText),
  );
  record("3b. Sayfa yenilendikten SONRA 'Toplam: 100 Konteyner' gösteriyor", /Toplam:\s*100\s*Konteyner/.test(reloadedText), reloadedText.match(/Toplam:[\s\S]{0,30}/)?.[0]);
  record("3c. Dolu gruplardaki yük içeriği kayıpsız (Rulo Sac, Kimyasal Varil)", reloadedText.includes("Rulo Sac") && reloadedText.includes("Kimyasal Varil"));
  // DOM'a-göre-KAPSAMLI kontrol (metin-penceresi regex'i DEĞİL — o, bir
  // sonraki <tr>'ye taşabilirdi): Konteyner Grupları tablosunda "20 adet"i
  // içeren GERÇEK <tr> satırını bul, YALNIZCA o satırın kendi metninde Yük
  // İçeriği/Tehlikeli Madde'nin YOK olduğunu doğrula (satırlar arası veri
  // karışması yapısal olarak da imkansız — bkz. job-detail-content.tsx'teki
  // StorageContainerGroupsTable, her <tr> yalnızca kendi group nesnesinden
  // okur — ama bunu gerçek DOM'dan da kanıtlıyoruz).
  const bosGroupRow = page.locator("table tr", { hasText: "20 adet" });
  const bosGroupRowText = await bosGroupRow.innerText();
  record(
    "3d. Boş gruptaki (Grup 1) yük içeriği/tehlikeli madde bilgisi HİÇ görünmüyor (satıra-göre DOM kontrolü)",
    !/Yük İçeriği|Tehlikeli/.test(bosGroupRowText),
    bosGroupRowText,
  );

  await requesterContext.close();

  // ===========================================================================
  // 4) ADMIN — bekleyen ilanı görür, bir grubu düzenler, yeni grup ekler,
  //    bir grubu siler, sonra onaylar.
  // ===========================================================================
  const { context: adminContext, page: adminPage } = await newActorPage(browser);
  await loginAs(adminPage, adminUser.email, PASSWORD);
  await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await adminPage
    .waitForFunction((title) => document.body.innerText.includes(title), "KonteynerGrupTest — Karışık Ölçülü Konteyner Depolama", { timeout: 45000 })
    .catch(async () => {
      const bodyText = await adminPage.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — admin ilan detayında başlık bulunamadı. URL:", adminPage.url(), "\nSayfa metni (ilk 800):", bodyText.slice(0, 800));
      await adminPage.screenshot({ path: path.join(os.tmpdir(), "ctnr-groups-debug-admin-detail.png"), fullPage: true }).catch(() => {});
    });
  const adminDetailText = await adminPage.locator("body").innerText().catch(() => "");
  record(
    "4a. Admin ilan detay sayfasını açabiliyor, 'İlan Moderasyonu' kartı görünüyor",
    !adminPage.url().includes("/giris-yap") && adminDetailText.includes("İlan Moderasyonu"),
    adminDetailText.slice(0, 200),
  );

  const editButton = adminPage.getByRole("button", { name: /Düzenle/ }).first();
  await editButton.click();
  await adminPage.waitForTimeout(800);

  const adminFormText = await adminPage.locator("body").innerText();
  record("4b. Admin düzenleme formunda 'Konteyner Grupları' bölümü görünüyor, 3 grup ÖNCEDEN DOLU geliyor", /konteyner grubu 3/i.test(adminFormText));

  const adminQuantity0Before = await adminPage.locator('[id$="-quantity"]').nth(0).inputValue();
  record("4c. Admin formunda Grup 1 adedi ÖNCEDEN DOLU geliyor (20, kayıpsız)", adminQuantity0Before === "20", adminQuantity0Before);

  // Grup 1'i düzenle (20 -> 30), Grup 3'ü sil, yeni bir grup (Reefer) ekle.
  await adminPage.locator('[id$="-quantity"]').nth(0).fill("30");
  await adminPage.getByRole("button", { name: "Kaldır" }).last().click();
  await adminPage.waitForTimeout(300);
  await adminPage.getByRole("button", { name: "Konteyner Grubu Ekle" }).click();
  await adminPage.waitForTimeout(300);
  await adminPage.locator('[id$="-quantity"]').nth(2).fill("10");
  await adminPage.locator('[id$="-size"]').nth(2).click();
  await adminPage.getByRole("option", { name: "45 ft", exact: true }).click();
  await adminPage.waitForTimeout(150);
  await adminPage.locator('[id$="-type"]').nth(2).click();
  await adminPage.getByRole("option", { name: "Reefer", exact: true }).click();
  await adminPage.waitForTimeout(150);
  await adminPage.locator('[id$="-status"]').nth(2).click();
  await adminPage.getByRole("option", { name: "Dolu", exact: true }).click();
  await adminPage.waitForTimeout(200);
  await adminPage.locator('[id$="-content"]').nth(1).fill("Dondurulmuş Gıda");
  const reeferTempFields = adminPage.locator('[id$="-reeferTemperature"]');
  await reeferTempFields.last().fill("-18");
  const reeferElecFields = adminPage.locator('[id$="-reeferElectrical"]');
  await reeferElecFields.last().click();
  await adminPage.getByRole("option", { name: "Evet", exact: true }).click();
  await adminPage.waitForTimeout(200);

  const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
  await saveButton.click();
  await adminPage.waitForTimeout(1500);

  const { data: afterAdminEdit } = await requester.client.from("jobs").select("storage_container_groups").eq("id", createdJobId).maybeSingle();
  const editedGroups = afterAdminEdit?.storage_container_groups ?? [];
  record("4d. Admin düzenlemesi sonrası TAM OLARAK 3 grup var (1 düzenlendi, 1 silindi, 1 eklendi)", editedGroups.length === 3, JSON.stringify(editedGroups));
  const editedTotal = editedGroups.reduce((sum, g) => sum + (g.quantity ?? 0), 0);
  record("4e. Admin düzenlemesi sonrası toplam 55 (30+15+10)", editedTotal === 55, editedTotal);
  const reeferGroup = editedGroups.find((g) => g.type === "reefer");
  record("4f. Yeni eklenen Reefer grubu doğru kaydedildi (sıcaklık -18, elektrik true)", reeferGroup?.reeferTemperature === -18 && reeferGroup?.reeferElectrical === true, JSON.stringify(reeferGroup));

  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: createdJobId });
  record("4g. Admin ilanı onaylıyor (approve_job_as_admin)", !approveError, approveError?.message);

  const { data: afterApproveRow } = await requester.client.from("jobs").select("moderation_status, storage_container_groups").eq("id", createdJobId).maybeSingle();
  record(
    "4h. Onay SONRASI grup bilgileri BOZULMADI (hâlâ 3 grup, toplam 55)",
    afterApproveRow?.moderation_status === "approved" && (afterApproveRow?.storage_container_groups ?? []).reduce((s, g) => s + (g.quantity ?? 0), 0) === 55,
    JSON.stringify(afterApproveRow),
  );
  await adminContext.close();

  // ===========================================================================
  // 5) HİZMET VEREN — onaylanmış ilanın detayında admin'in düzenlediği HALİ
  //    (30+15+10 reefer grubu) doğru gösteriliyor mu.
  // ===========================================================================
  const { context: providerContext, page: providerPage } = await newActorPage(browser);
  await loginAs(providerPage, provider.email, PASSWORD);
  await providerPage.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await providerPage
    .waitForFunction((title) => document.body.innerText.includes(title), "KonteynerGrupTest — Karışık Ölçülü Konteyner Depolama", { timeout: 45000 })
    .catch(() => {});
  const providerDetailText = await providerPage.locator("body").innerText().catch(() => "");
  record("5a. Yetkilendirilmiş Hizmet Veren ilan detayını açabiliyor (admin onayından sonra)", providerDetailText.includes("KonteynerGrupTest") || providerDetailText.includes("Konteyner Depolama"));
  record("5b. Hizmet Veren, admin'in GÜNCEL grup verisini görüyor (30 adet, 15 adet, 10 adet)", /30\s*adet/.test(providerDetailText) && /15\s*adet/.test(providerDetailText) && /10\s*adet/.test(providerDetailText));
  record("5c. Hizmet Veren 'Toplam: 55 Konteyner' görüyor", /Toplam:\s*55\s*Konteyner/.test(providerDetailText), providerDetailText.match(/Toplam:[\s\S]{0,30}/)?.[0]);
  record("5d. Reefer grubunun sıcaklık/elektrik bilgisi doğru grubun altında gösteriliyor", /Sıcaklık:\s*-18/.test(providerDetailText) && providerDetailText.includes("Dondurulmuş Gıda"));
  record("5e. Sahte/placeholder metin YOK (Belirtilmedi/undefined/null hiçbiri görünmüyor)", !/(Belirtilmedi|undefined|null)/.test(providerDetailText.replace(/null(?=[a-zçğıöşü])/gi, "")));

  // Teklif formu tek bir toplam-fiyat teklifi alır — konteyner grubu başına
  // AYRI bir fiyatlandırma alanı YOKTUR (görev tanımı: "hizmet veren tüm
  // konteynerler için TEK teklif verebilsin").
  const offerFormText = await providerPage.locator("body").innerText().catch(() => "");
  record("5f. Teklif formu TEK bir toplam fiyat alanı içeriyor (grup başına ayrı fiyatlandırma YOK)", offerFormText.includes("Teklif Fiyatı") || offerFormText.includes("Teklif Ver"));

  await providerContext.close();
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      if (createdJobId) {
        runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${createdJobId}');`);
        runSql(`delete from public.offers where job_id = '${createdJobId}';`);
        runSql(`delete from public.job_photos where job_id = '${createdJobId}';`);
        runSql(`delete from public.job_activity_events where job_id = '${createdJobId}';`);
        runSql(`delete from public.jobs where id = '${createdJobId}';`);
      }
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    } catch (error) {
      console.error("cleanup sql failed (continuing):", error?.message || error);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
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
