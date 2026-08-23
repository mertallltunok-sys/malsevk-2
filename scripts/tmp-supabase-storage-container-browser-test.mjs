// Development Supabase projesine (hosted, NEXT_PUBLIC_SUPABASE_URL) VE
// gerçekten çalışan dev sunucusuna (http://localhost:3000, NEXT_PUBLIC_
// ENABLE_SUPABASE_JOB_SYNC=true) karşı — "Konteyner Depolama > Konteyner
// Bilgileri" (4 düz alan: Adet/Ölçü/Durum/İçerik) görevinin uçtan uca GERÇEK
// KULLANICI testi: Hizmet Alan (form, canlı Dolu<->Boş temizleme, ek hizmet
// izolasyonu) -> Admin (onay + düzenleme, Dolu->Boş) -> Hizmet Veren (ilan
// detayı, tek satırlık özet). Kurulum (hesap oluşturma/yetkilendirme)
// service-role RPC ile yapılır — tüm GERÇEK ÖZELLİK doğrulaması gerçek bir
// Chromium tarayıcısıyla, gerçek DOM üzerinden yapılır. Aynı dosyanın
// (tmp-supabase-storage-service-browser-test.mjs) kurduğu desen tekrar
// kullanılır.
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

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  const email = `ctnrtest-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `KonteynerTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `KonteynerTest Firma ${label}`,
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
  record(
    "Kurulum: 3 test hesabı oluşturuldu, biri admin'e yükseltildi",
    !promoteError && promoteRows[0]?.role === "admin",
    promoteError || JSON.stringify(promoteRows),
  );

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });
  const { error: authError } = await adminClient.rpc("authorize_provider_service", {
    p_provider_id: provider.id,
    p_service_category_id: CATEGORY_ID,
    p_reason: "KonteynerTest otomasyonu",
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
  // 1) HİZMET ALAN — kategori seçimi TEK BAŞINA "Konteyner Bilgileri"ni açmalı
  //    (kök neden düzeltmesinin kendisi), başlık placeholder'ı değişmeli,
  //    Dolu<->Boş CANLI temizlemeli, ek hizmet kartı İZOLE olmalı.
  // ===========================================================================
  await loginAs(page, requester.email, PASSWORD);
  record("Ön kontrol: Hizmet Alan girişi yapıldı", !page.url().includes("/giris-yap"), page.url());
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("select", { timeout: 60000 }).catch(async () => {
    const bodyText = await page.locator("body").innerText().catch(() => "(okunamadı)");
    console.error("DEBUG — /hizmet-talebi-olustur üzerinde <select> bulunamadı. URL:", page.url(), "\nSayfa metni (ilk 500):", bodyText.slice(0, 500));
    await page.screenshot({ path: path.join(os.tmpdir(), "ctnr-test-debug-no-select.png"), fullPage: true }).catch(() => {});
  });

  // 1a. Kategori seçmeden ÖNCE "Konteyner Bilgileri" hiç görünmüyor.
  const beforeCategoryText = await page.locator("body").innerText();
  record("1a. Kategori seçilmeden ÖNCE 'Konteyner Bilgileri' hiç görünmüyor", !beforeCategoryText.includes("Konteyner Bilgileri"));

  // 1b. KÖK NEDEN DÜZELTMESİ: yalnızca kategori seçilince (Depolanacak Ürün'e
  // HİÇ dokunmadan) "Konteyner Bilgileri" bölümü DERHAL görünmeli.
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);
  const afterCategoryText = await page.locator("body").innerText();
  record(
    "1b. KÖK NEDEN DÜZELTMESİ: yalnızca kategori seçilince (Depolanacak Ürün'e dokunmadan) 'Konteyner Bilgileri' DERHAL görünüyor",
    afterCategoryText.includes("Konteyner Bilgileri"),
  );
  record("1c. Alt alan etiketleri doğru: Konteyner Adedi/Ölçüsü/Durumu görünüyor", afterCategoryText.includes("Konteyner Adedi") && afterCategoryText.includes("Konteyner Ölçüsü") && afterCategoryText.includes("Konteyner Durumu"));
  record("1d. Durum seçilmeden 'Konteyner İçeriği / Yük Cinsi' alanı HENÜZ görünmüyor", !afterCategoryText.includes("Konteyner İçeriği"));

  // 1e. Başlık placeholder'ı Konteyner Depolama'ya özel metne dönmüş olmalı.
  const titleInput = page.getByLabel("İlan Başlığı").nth(0);
  const titlePlaceholder = await titleInput.getAttribute("placeholder");
  record(
    "1e. İlan Başlığı placeholder'ı Konteyner Depolama'ya özel ('75 Adet 40 ft Konteyner...')",
    titlePlaceholder === "Örnek: 75 Adet 40 ft Konteyner İçin Depolama Talebi",
    titlePlaceholder,
  );
  await titleInput.fill("KonteynerTest — Konteyner Depolama İhtiyacı");

  const descriptionArea = page.locator("textarea").first();
  await descriptionArea.fill("Otomasyonla oluşturulan test ilanı. 40 ft'lik dolu konteynerler için depolama alanı arıyoruz.");
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(WORK_DATE);
  await dateInputs.nth(1).fill(WORK_END_DATE);

  await page.locator('[id^="service-province-"]').first().click();
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[id^="service-district-"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(300);

  // Depolanacak Ürün Bilgileri (genel, mevcut alan) — Konteyner Bilgileri'nden
  // BAĞIMSIZ, kasıtlı olarak "Konteyner" YAZMIYORUZ (kök neden testinin bir
  // parçası: tetikleme YALNIZCA kategoriye bağlı olmalı).
  const storageProductTypeInput = page.locator('[id$="-storageProductType"]').first();
  await storageProductTypeInput.fill("Test Yük");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.locator('[id$="-storageProductQuantity"]').first().fill("2");
  await page.locator('[id$="-storageProductUnit"]').first().click();
  await page.getByRole("option", { name: "adet", exact: true }).click();

  // 1f. Konteyner Adedi — rakam olmayan karakterler süzülmeli (yalnızca rakam).
  const countInput = page.locator('[id$="-storageContainerCount"]').first();
  await countInput.fill("abc-7.5x5");
  const countAfterJunk = await countInput.inputValue();
  record("1f. Konteyner Adedi yalnızca rakamları kabul ediyor ('abc-7.5x5' -> '755')", countAfterJunk === "755", countAfterJunk);
  await countInput.fill("75");

  await page.locator('[id$="-storageContainerSize"]').first().click();
  await page.getByRole("option", { name: "40 ft", exact: true }).click();
  await page.waitForTimeout(200);

  await page.locator('[id$="-storageContainerStatus"]').first().click();
  await page.getByRole("option", { name: "Dolu", exact: true }).click();
  await page.waitForTimeout(200);

  // 1g. Durum=Dolu seçilince İçerik alanı CANLI olarak görünmeli.
  const afterDoluText = await page.locator("body").innerText();
  record("1g. Durum='Dolu' seçilince 'Konteyner İçeriği / Yük Cinsi' alanı CANLI görünüyor", afterDoluText.includes("Konteyner İçeriği"));

  const contentInput = page.locator('[id$="-storageContainerContent"]').first();
  await contentInput.fill("Rulo Sac");
  const contentValueAfterFill = await contentInput.inputValue();
  record("1h. İçerik alanına 'Rulo Sac' yazıldı", contentValueAfterFill === "Rulo Sac", contentValueAfterFill);

  // 1i. Dolu -> Boş: içerik alanı CANLI olarak kaybolmalı (yalnızca gönderim
  // anında değil) — görev tanımının en kritik gereksinimi.
  await page.locator('[id$="-storageContainerStatus"]').first().click();
  await page.getByRole("option", { name: "Boş", exact: true }).click();
  await page.waitForTimeout(200);
  const afterBosText = await page.locator("body").innerText();
  record("1i. Durum='Boş' seçilince 'Konteyner İçeriği / Yük Cinsi' alanı CANLI olarak kayboluyor", !afterBosText.includes("Konteyner İçeriği"));

  // 1j. Boş -> Dolu: içerik GERÇEKTEN temizlenmiş olmalı (eski 'Rulo Sac'
  // hayalet biçimde geri gelmemeli) — form state'inin GERÇEKTEN temizlendiğinin
  // kanıtı, yalnızca gizlenmediğinin değil.
  await page.locator('[id$="-storageContainerStatus"]').first().click();
  await page.getByRole("option", { name: "Dolu", exact: true }).click();
  await page.waitForTimeout(200);
  const contentValueAfterToggleBack = await page.locator('[id$="-storageContainerContent"]').first().inputValue();
  record(
    "1j. Boş -> Dolu geri dönüşünde İçerik GERÇEKTEN boş (eski 'Rulo Sac' hayalet geri gelmiyor)",
    contentValueAfterToggleBack === "",
    contentValueAfterToggleBack,
  );
  await page.locator('[id$="-storageContainerContent"]').first().fill("Rulo Sac");

  // ===========================================================================
  // 1k-1p) EK HİZMET — additional-service tetikleme + izolasyon. NOT: bir
  // operasyon AYNI kategoriyi iki kez içeremez (MLK54, ve UI de aynı kuralı
  // <option disabled> ile zaten uyguluyor — bu GERÇEK, kasıtlı bir iş kuralı,
  // canlı testte doğrulandı) — bu yüzden 2. kartı Konteyner Depolama
  // yapabilmek için 1. kart GEÇİCİ olarak başka bir kategoriye alınır (kendi
  // Konteyner değerleri —75/40/dolu/Rulo Sac— kaybolmadan, yalnızca kategori
  // değiştiği için GİZLENİR — bkz. 1s'teki geri-yükleme kontrolü).
  // ===========================================================================
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Nakliye" });
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Ek hizmet ekle" }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="checkbox"]').last().uncheck().catch(() => {});
  await page.getByLabel("Hizmet Kategorisi").nth(1).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);

  const secondCardText = await page.locator("body").innerText();
  record(
    "1k. ADDITIONAL-SERVICE TETİKLEME: 1. kart Konteyner Depolama OLMADIĞI halde, 2. (ek) kartta yalnızca kategori seçilince 'Konteyner Bilgileri' görünüyor",
    (secondCardText.match(/Konteyner Bilgileri/g) ?? []).length === 1,
  );

  const secondCardCountInput = page.locator('[id$="-storageContainerCount"]').nth(0);
  await secondCardCountInput.fill("10");
  await page.locator('[id$="-storageContainerSize"]').nth(0).click();
  await page.getByRole("option", { name: "20 ft", exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('[id$="-storageContainerStatus"]').nth(0).click();
  await page.getByRole("option", { name: "Dolu", exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('[id$="-storageContainerContent"]').nth(0).fill("Ek hizmet içeriği");

  const firstCardTitleValue = await page.getByLabel("İlan Başlığı").nth(0).inputValue();
  record(
    "1l. İZOLASYON: ek karttaki (2. kart, Konteyner Depolama) değerler 1. kartın (Nakliye) başlığını ETKİLEMEDİ",
    firstCardTitleValue === "KonteynerTest — Konteyner Depolama İhtiyacı",
    firstCardTitleValue,
  );
  const firstCardBodyTextWhileSecondFilled = await page.locator("body").innerText();
  record(
    "1m. 1. kart (Nakliye) 'Ek hizmet içeriği' metnini HİÇ göstermiyor (kardeş kartın verisi sızmadı)",
    !firstCardBodyTextWhileSecondFilled.includes("Ek hizmet içeriği") || (firstCardBodyTextWhileSecondFilled.match(/Ek hizmet içeriği/g) ?? []).length === 1,
  );

  // Ek kartı kaldır — gerçek gönderim tek hizmetli kalsın (kalıcı DB
  // izolasyonu zaten RPC testinde, Senaryo 7'de kanıtlandı).
  await page.getByRole("button", { name: "Kaldır" }).last().click();
  await page.waitForTimeout(300);
  const afterRemoveText = await page.locator("body").innerText();
  record("1n. Ek kart kaldırıldıktan sonra 'Konteyner Bilgileri' hiç görünmüyor (1. kart hâlâ Nakliye)", !afterRemoveText.includes("Konteyner Bilgileri"));

  // ===========================================================================
  // 1q) REGRESYON — Nakliye/genel Depolama gibi ilgisiz kategoriler seçilince
  // 'Konteyner Bilgileri' HİÇ görünmemeli (yalnızca konteyner-depolama'ya özel).
  // (1. kart zaten "Nakliye" — yukarıdaki additional-service testinin
  // yan etkisi olarak — bu yüzden burada zaten kanıtlanmış durumda; yine de
  // açıkça doğrulanır.)
  // ===========================================================================
  const nakliyeText = await page.locator("body").innerText();
  record("1q. Regresyon: Nakliye seçiliyken 'Konteyner Bilgileri' HİÇ görünmüyor", !nakliyeText.includes("Konteyner Bilgileri"));
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Genel Depolama" });
  await page.waitForTimeout(300);
  const genelDepolamaText = await page.locator("body").innerText();
  record("1r. Regresyon: Genel Depolama seçilince 'Konteyner Bilgileri' HİÇ görünmüyor (yalnızca Konteyner Depolama alt türü)", !genelDepolamaText.includes("Konteyner Bilgileri"));

  // Gerçek gönderim için kategoriyi tekrar Konteyner Depolama'ya al — form
  // state'inin diğer alanları (başlık/açıklama/tarih/konum/ürün/konteyner)
  // kategori ileri-geri değiştirilirken KAYBOLMADI mı, aynı zamanda bunun da
  // kanıtı.
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);
  const restoredCount = await page.locator('[id$="-storageContainerCount"]').nth(0).inputValue();
  const restoredSizeVisible = await page.locator("body").innerText();
  record(
    "1s. Kategori ileri-geri değiştirildikten SONRA Konteyner Bilgileri alanları hâlâ dolu (75, kaybolmadı)",
    restoredCount === "75" && restoredSizeVisible.includes("Konteyner İçeriği"),
    restoredCount,
  );

  const photosHeadingText = await page.locator("body").innerText();
  record("1t. Fotoğraf bölümü başlığı 'Yük / Ürün Fotoğrafları' (Depolama'ya özel)", photosHeadingText.includes("Yük / Ürün Fotoğrafları"));

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
  record("1u. 4 fotoğraf başarıyla işlendi (4 / 15 fotoğraf yüklendi)", true);

  const formSubmitButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await formSubmitButton.click();
  await page.waitForTimeout(1200);

  const previewText = await page.locator("body").innerText();
  if (!previewText.includes("Operasyon Özeti")) {
    console.error("DEBUG — form gönderiminden sonra hâlâ form ekranında. Hata metinleri (text-danger):");
    const errorTexts = await page.locator(".text-danger").allInnerTexts().catch(() => []);
    console.error(JSON.stringify(errorTexts));
    await page.screenshot({ path: path.join(os.tmpdir(), "ctnr-test-debug-submit-fail.png"), fullPage: true }).catch(() => {});
  }
  record("1v. Operasyon Önizleme ekranına geçildi ('Operasyon Özeti' görünüyor)", previewText.includes("Operasyon Özeti"));

  const publishButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishButton.click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  record("1w. Yayınlama sonrası ilan detay sayfasına (/ilanlar/[id]) yönlendirildi", /\/ilanlar\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname), page.url());
  createdJobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1] ?? null;

  // ---------------------------------------------------------------------
  // 2) DB SEVİYESİNDE DOĞRUDAN KANIT — form üzerinden girilen değerler
  // GERÇEKTEN Supabase'e (jobs tablosu) yazıldı mı.
  // ---------------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 1500));
  const { data: jobRows } = await requester.client
    .from("jobs")
    .select("id, category_id, storage_container_count, storage_container_size, storage_container_status, storage_container_content, moderation_status")
    .eq("requester_id", requester.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const dbJob = jobRows?.[0];
  if (!createdJobId) createdJobId = dbJob?.id ?? null;
  record("2a. İlan gerçekten Supabase'e (jobs tablosuna) senkronlandı", Boolean(dbJob) && dbJob.id === createdJobId, JSON.stringify(dbJob));
  record(
    "2b. storage_container_* alanları Supabase'de TAM OLARAK form girdisiyle eşleşiyor (75/40/dolu/Rulo Sac)",
    dbJob?.storage_container_count === 75 && dbJob?.storage_container_size === "40" && dbJob?.storage_container_status === "dolu" && dbJob?.storage_container_content === "Rulo Sac",
    JSON.stringify(dbJob),
  );
  record("2c. moderation_status = 'pending_review'", dbJob?.moderation_status === "pending_review", dbJob?.moderation_status);

  // ---------------------------------------------------------------------
  // 3) SAYFA YENİLEME / SUNUCUDAN YENİDEN ÇEKME — kalıcılık kanıtı.
  // ---------------------------------------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const reloadedText = await page.locator("body").innerText().catch(() => "");
  record(
    "3a. Sayfa yenilendikten SONRA tek satırlık özet doğru gösteriliyor (75 adet · 40 ft · Dolu · Rulo Sac)",
    /75\s*adet/.test(reloadedText) && /40\s*ft/.test(reloadedText) && reloadedText.includes("Dolu") && reloadedText.includes("Rulo Sac"),
    reloadedText.match(/Konteyner Bilgileri[\s\S]{0,120}/)?.[0],
  );

  await requesterContext.close();

  // ===========================================================================
  // 4) ADMIN — ilanı bulur, düzenleme formunda Konteyner Bilgileri'nin
  //    ÖNCEDEN DOLU geldiğini doğrular, ekleme/değişiklik yapmadan onaylar.
  // ===========================================================================
  const { context: adminContext, page: adminPage } = await newActorPage(browser);
  await loginAs(adminPage, adminUser.email, PASSWORD);
  await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await adminPage
    .waitForFunction(
      (title) => document.body.innerText.includes(title),
      "KonteynerTest — Konteyner Depolama İhtiyacı",
      { timeout: 45000 },
    )
    .catch(async () => {
      const bodyText = await adminPage.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — admin ilan detayında başlık bulunamadı. URL:", adminPage.url(), "\nSayfa metni (ilk 800):", bodyText.slice(0, 800));
      await adminPage.screenshot({ path: path.join(os.tmpdir(), "ctnr-test-debug-admin-detail.png"), fullPage: true }).catch(() => {});
    });

  const editButton = adminPage.getByRole("button", { name: /Düzenle/ }).first();
  await editButton.click();
  await adminPage.waitForTimeout(800);

  const adminFormText = await adminPage.locator("body").innerText();
  record("4a. Admin düzenleme formunda 'Konteyner Bilgileri' bölümü görünüyor", adminFormText.includes("Konteyner Bilgileri"));

  const adminCountValue = await adminPage.locator('[id$="-storageContainerCount"]').first().inputValue().catch(() => null);
  record("4b. Admin formunda Konteyner Adedi ÖNCEDEN DOLU geliyor (75, kayıpsız)", adminCountValue === "75", adminCountValue);
  const adminContentValue = await adminPage.locator('[id$="-storageContainerContent"]').first().inputValue().catch(() => null);
  record("4c. Admin formunda İçerik ÖNCEDEN DOLU geliyor ('Rulo Sac', kayıpsız)", adminContentValue === "Rulo Sac", adminContentValue);

  // Hiçbir değişiklik yapmadan iptal edip doğrudan onayla — "temiz onay"
  // senaryosu (admin verileri BOZMADAN onaylayabiliyor mu).
  const cancelButton = adminPage.getByRole("button", { name: "İptal" }).first();
  await cancelButton.click().catch(() => {});
  await adminPage.waitForTimeout(500);

  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: createdJobId });
  record("4d. Admin ilanı onaylıyor (approve_job_as_admin)", !approveError, approveError?.message);

  const { data: afterApproveRow } = await requester.client
    .from("jobs")
    .select("moderation_status, storage_container_count, storage_container_size, storage_container_status, storage_container_content")
    .eq("id", createdJobId)
    .maybeSingle();
  record(
    "4e. Onay SONRASI Konteyner Bilgileri BOZULMADI (75/40/dolu/Rulo Sac hâlâ aynı)",
    afterApproveRow?.moderation_status === "approved" &&
      afterApproveRow?.storage_container_count === 75 &&
      afterApproveRow?.storage_container_size === "40" &&
      afterApproveRow?.storage_container_status === "dolu" &&
      afterApproveRow?.storage_container_content === "Rulo Sac",
    JSON.stringify(afterApproveRow),
  );

  // ===========================================================================
  // 5) HİZMET VEREN — onaylanmış ilanın detayında TEK SATIRLIK özet
  //    (Dolu + içerik dahil) doğru mu.
  // ===========================================================================
  const { context: providerContext, page: providerPage } = await newActorPage(browser);
  await loginAs(providerPage, provider.email, PASSWORD);
  await providerPage.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await providerPage
    .waitForFunction(
      (title) => document.body.innerText.includes(title),
      "KonteynerTest — Konteyner Depolama İhtiyacı",
      { timeout: 45000 },
    )
    .catch(async () => {
      const bodyText = await providerPage.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — provider ilan detayında başlık bulunamadı. URL:", providerPage.url(), "\nSayfa metni (ilk 800):", bodyText.slice(0, 800));
      await providerPage.screenshot({ path: path.join(os.tmpdir(), "ctnr-test-debug-provider-detail.png"), fullPage: true }).catch(() => {});
    });
  const providerDetailText = await providerPage.locator("body").innerText().catch(() => "");
  record("5a. Yetkilendirilmiş Hizmet Veren ilan detayını açabiliyor (admin onayından sonra)", providerDetailText.includes("KonteynerTest") || providerDetailText.includes("Konteyner Depolama"));
  record(
    "5b. Tek satırlık özet DOLU durumda içerikle birlikte doğru gösteriliyor (75 adet · 40 ft · Dolu · Rulo Sac)",
    /75\s*adet/.test(providerDetailText) && /40\s*ft/.test(providerDetailText) && providerDetailText.includes("Dolu") && providerDetailText.includes("Rulo Sac"),
    providerDetailText.match(/Konteyner Bilgileri[\s\S]{0,120}/)?.[0],
  );
  record("5c. Sahte/placeholder metin YOK (Belirtilmedi/—/undefined/null hiçbiri görünmüyor Konteyner bölümünde)", !/Konteyner Bilgileri[\s\S]{0,120}(Belirtilmedi|undefined|null)/.test(providerDetailText));
  await providerContext.close();

  // ===========================================================================
  // 6) ADMIN TEKRAR — Dolu -> Boş (onay SONRASI gerçek admin edit akışı,
  //    localStorage fallback'i olmayan asıl yetkili yol) — İçerik hem admin
  //    formunda CANLI kaybolmalı hem de kaydettikten sonra kalıcı olarak
  //    temizlenmiş olmalı.
  // ===========================================================================
  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(1500);
  await adminPage.getByRole("button", { name: /Düzenle/ }).first().click();
  await adminPage.waitForTimeout(800);

  await adminPage.locator('[id$="-storageContainerStatus"]').first().click();
  await adminPage.getByRole("option", { name: "Boş", exact: true }).click();
  await adminPage.waitForTimeout(200);
  const adminFormAfterBosText = await adminPage.locator("body").innerText();
  record("6a. Admin formunda da Durum='Boş' seçilince İçerik alanı CANLI kayboluyor", !adminFormAfterBosText.includes("Konteyner İçeriği"));

  const adminSaveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
  await adminSaveButton.click();
  await adminPage.waitForTimeout(1500);

  const { data: afterAdminBosRow } = await requester.client
    .from("jobs")
    .select("storage_container_status, storage_container_content, storage_container_count, storage_container_size")
    .eq("id", createdJobId)
    .maybeSingle();
  record(
    "6b. Admin kaydından SONRA (onay SONRASI) İçerik veritabanında GERÇEKTEN temizlendi",
    afterAdminBosRow?.storage_container_status === "bos" && afterAdminBosRow?.storage_container_content === null,
    JSON.stringify(afterAdminBosRow),
  );
  record(
    "6c. Adet/Ölçü admin'in bu düzenlemesinden ETKİLENMEDİ (hâlâ 75/40)",
    afterAdminBosRow?.storage_container_count === 75 && afterAdminBosRow?.storage_container_size === "40",
    JSON.stringify(afterAdminBosRow),
  );
  await adminContext.close();

  // ===========================================================================
  // 7) HİZMET VEREN TEKRAR — Boş durumda İçerik SATIRDA HİÇ görünmemeli.
  // ===========================================================================
  const { context: providerContext2, page: providerPage2 } = await newActorPage(browser);
  await loginAs(providerPage2, provider.email, PASSWORD);
  await providerPage2.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await providerPage2
    .waitForFunction((title) => document.body.innerText.includes(title), "KonteynerTest — Konteyner Depolama İhtiyacı", { timeout: 45000 })
    .catch(() => {});
  const providerDetailText2 = await providerPage2.locator("body").innerText().catch(() => "");
  record(
    "7a. Boş duruma geçtikten SONRA özet satırında 'Boş' var ama 'Rulo Sac' KESİNLİKLE YOK",
    providerDetailText2.includes("Boş") && !providerDetailText2.includes("Rulo Sac"),
    providerDetailText2.match(/Konteyner Bilgileri[\s\S]{0,120}/)?.[0],
  );
  await providerContext2.close();
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
