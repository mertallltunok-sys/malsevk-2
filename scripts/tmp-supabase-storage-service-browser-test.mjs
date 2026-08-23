// Development Supabase projesine (hosted, NEXT_PUBLIC_SUPABASE_URL) VE
// gerçekten çalışan dev sunucusuna (http://localhost:3000, NEXT_PUBLIC_
// ENABLE_SUPABASE_JOB_SYNC=true) karşı — "Depolama İlan Oluşturma" görevinin
// uçtan uca GERÇEK KULLANICI testi: Hizmet Alan (form) -> Admin (onay +
// düzenleme) -> Hizmet Veren (ilan detayı). Kurulum (hesap oluşturma/
// yetkilendirme) service-role RPC ile yapılır — tüm GERÇEK ÖZELLİK
// doğrulaması (form doldurma, buton metinleri, kart içerikleri, süre
// hesabı) gerçek bir Chromium tarayıcısıyla, gerçek DOM üzerinden yapılır.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Bu hosted dev projede service_role'ün PostgREST erişimi YOK (bkz.
// CLAUDE.md "service_role itself has no REST access to any public-schema
// table or function" bulgusu, önceki bir doğrulama turunda bulundu) — bu
// yüzden test fixture kurulumu/temizliği/doğrulaması, izole bir scratch
// npm projesindeki (ana repo'ya HİÇ dokunmadan, pg bağımlılığı eklemeden)
// doğrudan Postgres (pooler) bağlantısı üzerinden yapılır. Sıradan
// okuma/yazmalar (ilan doğrulama gibi) mümkün olduğunda bunun yerine ilgili
// GERÇEK kullanıcının kendi authenticated client'ı (RLS altında) kullanılır
// — yalnızca role='admin' yükseltmesi ve temizlik, RLS'in izin veremeyeceği
// işlemler olduğu için bu kanaldan geçer.
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
const CATEGORY_ID = "kapali-depolama";
const CATEGORY_LABEL = "Kapalı Depolama";

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
const WORK_END_DATE = todayPlus(28); // 20 -> 28 = düz fark 8 gün (kapsayıcı DEĞİL, 9 değil)

async function createUser(label, role) {
  const email = `depotest-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `DepoTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `DepoTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Canlı olarak GÖZLEMLENDİ: bazen ilk gönderim (dev sunucusu/Supabase Auth
  // ağ gecikmesi, ya da Turbopack'ın bu rotayı ilk kez derlemesi) 20s içinde
  // yönlenmiyor — sessizce "başarısız" sayıp devam etmek yerine, hâlâ
  // /giris-yap'taysa BİR kez daha dener (aynı formu yeniden doldurup
  // gönderir) — gerçek bir kimlik bilgisi hatası değil, zamanlama sorunudur.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) break;
  }
  await page.waitForTimeout(1000);
}

// Kullanıcı-arası geçiş için UI'dan "Çıkış Yap" tıklamak yerine (canlı
// olarak GÖZLEMLENDİ: profil menüsü açılır listesi bu otomasyon
// bağlamında tekrar tekrar zamanlama sorunu çıkardı — hydrasyon/outside-
// click gecikmesi), her aktör KENDİ İZOLE tarayıcı bağlamını (context)
// alır — 3 farklı gerçek kullanıcının 3 farklı tarayıcı/cihaz kullanması
// gerçek dünya davranışına da DAHA yakın, ayrı çerezler/oturumlar demektir.
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
    p_reason: "DepoTest otomasyonu",
  });
  record("Kurulum: Hizmet Veren, Kapalı Depolama için yetkilendirildi", !authError, authError?.message);

  const browser = await chromium.launch();
  try {
    await runBrowserFlow(browser, { requester, provider, adminUser, adminClient });
  } finally {
    // Bir önceki fazda ATILAN bir hata browser.close()'u ATLAMASIN diye —
    // aksi halde her başarısız koşu bir headless Chromium süreci sızdırır
    // (bu koşunun kendisinde canlı olarak gözlemlendi, bkz. proje raporu).
    await browser.close().catch(() => {});
  }
}

async function runBrowserFlow(browser, { requester, provider, adminUser, adminClient }) {
  const { context: requesterContext, page } = await newActorPage(browser);

  // ===========================================================================
  // 1) HİZMET ALAN — gerçek formu doldurup gerçek bir Depolama ilanı yayınlar.
  // ===========================================================================
  await loginAs(page, requester.email, PASSWORD);
  record("Ön kontrol: Hizmet Alan girişi yapıldı", !page.url().includes("/giris-yap"), page.url());
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("select", { timeout: 60000 }).catch(async () => {
    const bodyText = await page.locator("body").innerText().catch(() => "(okunamadı)");
    console.error("DEBUG — /hizmet-talebi-olustur üzerinde <select> bulunamadı. URL:", page.url(), "\nSayfa metni (ilk 500):", bodyText.slice(0, 500));
    await page.screenshot({ path: path.join(os.tmpdir(), "depo-test-debug-no-select.png"), fullPage: true }).catch(() => {});
  });

  await page.locator("select").first().selectOption({ label: CATEGORY_LABEL });
  await page.waitForTimeout(300);

  const titleInput = page.locator('input[placeholder*="Fabrika Sahasında"]').first();
  await titleInput.fill("DepoTest — Kapalı Depolama İhtiyacı");
  const descriptionArea = page.locator("textarea").first();
  await descriptionArea.fill(
    "Otomasyonla oluşturulan test ilanı. Ürünlerimizin güvenli şekilde kapalı alanda depolanmasını istiyoruz.",
  );

  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(WORK_DATE);
  await dateInputs.nth(1).fill(WORK_END_DATE);

  // İl/İlçe yalnızca (Depolama = sadeleştirilmiş konum) — Liman/Sanayi/OSB ve
  // Açık Adres hiç render edilmemeli.
  const pageTextBeforeLocation = await page.locator("form").innerText();
  record(
    "1a. Depolama kartında 'Liman / Sanayi / OSB' alanı HİÇ görünmüyor",
    !pageTextBeforeLocation.includes("Liman / Sanayi / OSB"),
  );
  record("1b. Depolama kartında 'Açık Adres' alanı HİÇ görünmüyor", !pageTextBeforeLocation.includes("Açık Adres"));

  await page.locator('[id^="service-province-"]').first().click();
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[id^="service-district-"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(300);

  // Depolanacak Ürün Bilgileri (StorageProductFields) — serbest metin Ürün
  // Cinsi, Miktar, Birim, (opsiyonel) Toplam Tonaj.
  const storageProductTypeInput = page.locator('[id$="-storageProductType"]').first();
  await storageProductTypeInput.fill("Test Karton Kutular");
  // ProductTypeCombobox, odaklanınca öneri açılır listesini AÇAR — bu liste
  // altındaki Birim SearchableSelect'inin tetikleyicisini görsel olarak
  // ÖRTEBİLİR (z-50, absolute) ve tıklamayı yakalar; Escape ile kapatılır.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const storageQuantityInput = page.locator('[id$="-storageProductQuantity"]').first();
  await storageQuantityInput.fill("120");
  await page.locator('[id$="-storageProductUnit"]').first().click();
  // recycling-catalog.ts#RECYCLING_UNIT_OPTIONS etiketleri KÜÇÜK harf ("adet"),
  // "Adet" DEĞİL — Playwright'ın exact eşleşmesi büyük/küçük harfe duyarlı.
  await page.getByRole("option", { name: "adet", exact: true }).click();
  const storageTonnageInput = page.locator('[id$="-storageProductTonnage"]').first();
  await storageTonnageInput.fill("3,5");

  // Fotoğraf başlığı Depolama'ya özel metne dönmeli.
  const photosHeadingText = await page.locator("body").innerText();
  record(
    "1c. Fotoğraf bölümü başlığı 'Yük / Ürün Fotoğrafları' (Depolama'ya özel)",
    photosHeadingText.includes("Yük / Ürün Fotoğrafları"),
  );

  const tmp = os.tmpdir();
  const photoFiles = [1, 2, 3, 4].map((i) => path.join(tmp, `fixture-valid-${i}.jpg`));
  for (const f of photoFiles) readFileSync(f); // dosyalar gerçekten var mı — yoksa erken/açık hata versin.
  await page.locator('input[type="file"]').setInputFiles(photoFiles);
  // Sunucu tarafı işleme (sharp) — her fotoğrafın "ready" olmasını bekle.
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*\/\s*15\s*fotoğraf yüklendi/);
      return match && Number(match[1]) === 4;
    },
    { timeout: 60000 },
  );
  record("1d. 4 fotoğraf başarıyla işlendi (4 / 15 fotoğraf yüklendi)", true);

  // Formu gönder -> Operasyon Önizleme'ye geçmeli (henüz yayınlanmaz).
  const formSubmitButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  const formSubmitText = await formSubmitButton.innerText();
  record("1e. Form gönder butonu metni 'İlanı Onaya Gönder' (Depolama'ya özel)", formSubmitText.trim() === "İlanı Onaya Gönder", formSubmitText);
  await formSubmitButton.click();
  await page.waitForTimeout(1200);

  const previewText = await page.locator("body").innerText();
  record("1f. Operasyon Önizleme ekranına geçildi ('Operasyon Özeti' görünüyor)", previewText.includes("Operasyon Özeti"));
  record("1g. Önizlemede Depolanacak ürün bilgisi görünüyor (Test Karton Kutular)", previewText.includes("Test Karton Kutular"));
  record("1h. Önizlemede Miktar/Birim doğru (120 adet)", /120\s*adet/i.test(previewText));

  const publishButton = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  const publishText = await publishButton.innerText();
  record("1i. Önizleme yayınla butonu metni 'İlanı Onaya Gönder'", publishText.trim() === "İlanı Onaya Gönder", publishText);
  await publishButton.click();
  // Tek hizmetli gönderim (bkz. CLAUDE.md "Post-creation redirect") ilan
  // detay sayfasına (/ilanlar/[id]) yönlendirir — /panel/hizmet-taleplerim
  // yalnızca ÇOK hizmetli operasyonlar içindir, bu test TEK hizmet oluşturur.
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  record("1j. Yayınlama sonrası ilan detay sayfasına (/ilanlar/[id]) yönlendirildi", /\/ilanlar\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname), page.url());

  // ---------------------------------------------------------------------
  // Supabase'te GERÇEKTEN oluşup oluşmadığını doğrula (senkron bloklayıcı).
  // ---------------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 1500));
  // service_role'ün bu projede PostgREST erişimi yok — bunun yerine
  // GERÇEK ilan sahibinin kendi authenticated client'ı kullanılır (RLS,
  // sahibin kendi ilanını her zaman okumasına izin verir).
  const { data: jobRows } = await requester.client
    .from("jobs")
    .select(
      "id, category_id, storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage, moderation_status, work_date, work_end_date, province, district, work_location_type, address_text",
    )
    .eq("requester_id", requester.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const dbJob = jobRows?.[0];
  createdJobId = dbJob?.id ?? null;
  record("2a. İlan gerçekten Supabase'e (jobs tablosuna) senkronlandı", Boolean(dbJob), JSON.stringify(dbJob));
  record(
    "2b. storage_product_* alanları Supabase'de doğru kaydedildi",
    dbJob?.storage_product_type === "Test Karton Kutular" &&
      Number(dbJob?.storage_product_quantity) === 120 &&
      dbJob?.storage_product_unit === "adet" &&
      Number(dbJob?.storage_product_tonnage) === 3.5,
    JSON.stringify(dbJob),
  );
  record("2c. moderation_status = 'pending_review' (diğer TÜM kategorilerle AYNI kural)", dbJob?.moderation_status === "pending_review", dbJob?.moderation_status);
  record(
    "2d. Facility/adres alanları BOŞ (Depolama = yalnızca İl/İlçe)",
    !dbJob?.work_location_type && !dbJob?.address_text,
    JSON.stringify({ wlt: dbJob?.work_location_type, addr: dbJob?.address_text }),
  );

  await requesterContext.close();

  // ===========================================================================
  // 3) ADMIN — ilanı bulur, düzenler (özellikle Tonaj kaybı OLMADIĞINI
  //    doğrular), sonra onaylar. Ayrı, izole bir tarayıcı bağlamında.
  // ===========================================================================
  const { context: adminContext, page: adminPage } = await newActorPage(browser);
  await loginAs(adminPage, adminUser.email, PASSWORD);
  await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // admin-job-detail.tsx kendi verisini (job + requester + offers + siblings
  // + photos, birden çok Supabase sorgusu) İSTEMCİ TARAFINDA, sayfa
  // yüklendikten SONRA çeker — canlı olarak gözlemlendi: sabit kısa bir
  // bekleme (1500ms) bu veri gelmeden önce çalışıyordu. Bunun yerine, gerçek
  // ilan başlığının DOM'da görünmesini bekle (en fazla 45s).
  await adminPage
    .waitForFunction(
      (title) => document.body.innerText.includes(title),
      "DepoTest — Kapalı Depolama İhtiyacı",
      { timeout: 45000 },
    )
    .catch(async () => {
      const bodyText = await adminPage.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — admin ilan detayında başlık bulunamadı. URL:", adminPage.url(), "\nSayfa metni (ilk 800):", bodyText.slice(0, 800));
      await adminPage.screenshot({ path: path.join(os.tmpdir(), "depo-test-debug-admin-detail.png"), fullPage: true }).catch(() => {});
    });
  const adminDetailText = await adminPage.locator("main").innerText().catch(() => "");
  record("3a. Admin ilan detay sayfasını açabiliyor", !adminPage.url().includes("/giris-yap") && adminDetailText.length > 0);

  const editButton = adminPage.getByRole("button", { name: /Düzenle/ }).first();
  await editButton.click();
  await adminPage.waitForTimeout(800);

  const storageFieldsetText = await adminPage.locator("body").innerText();
  record("3b. Admin düzenleme formunda 'Depolama Bilgileri' bölümü görünüyor", storageFieldsetText.includes("Depolama Bilgileri"));

  // Tonaj alanının ÖNCEDEN DOLU (3.5) geldiğini doğrula — geçmişte tespit
  // edilen "tonaj kaybı" hatasının tekrarlamadığının kanıtı.
  const tonnageFieldValue = await adminPage
    .locator('label:has-text("Toplam Tonaj") input')
    .first()
    .inputValue()
    .catch(() => null);
  record("3c. Admin formunda Tonaj alanı KAYIPSIZ önceden dolu geliyor (3.5)", tonnageFieldValue === "3.5", tonnageFieldValue);

  // Admin, Miktarı değiştirip kaydeder — diğer storage alanlarının (coalesce)
  // korunduğunu doğrulamak için.
  const quantityField = adminPage.locator('label:has-text("Miktar") input').first();
  await quantityField.fill("150");
  const saveButton = adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first();
  await saveButton.click();
  await adminPage.waitForTimeout(1500);

  const { data: afterAdminEdit } = await requester.client
    .from("jobs")
    .select("storage_product_quantity, storage_product_tonnage, storage_product_type, storage_product_unit")
    .eq("id", createdJobId)
    .maybeSingle();
  record(
    "3d. Admin düzenlemesi sonrası Miktar güncellendi (150), Tonaj/Ürün/Birim (dokunulmayan alanlar) KORUNDU",
    Number(afterAdminEdit?.storage_product_quantity) === 150 &&
      Number(afterAdminEdit?.storage_product_tonnage) === 3.5 &&
      afterAdminEdit?.storage_product_type === "Test Karton Kutular" &&
      afterAdminEdit?.storage_product_unit === "adet",
    JSON.stringify(afterAdminEdit),
  );

  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: createdJobId });
  record("3e. Admin ilanı onaylıyor (approve_job_as_admin)", !approveError, approveError?.message);
  await adminContext.close();

  // ===========================================================================
  // 4) HİZMET VEREN — onaylanmış ilanın detayını görür; Depolama Talebi
  //    kartı, konum gizliliği (yalnızca İl/İlçe), süre hesabı doğru mu.
  //    Ayrı, izole bir tarayıcı bağlamında.
  // ===========================================================================
  const { context: providerContext, page: providerPage } = await newActorPage(browser);
  await loginAs(providerPage, provider.email, PASSWORD);
  await providerPage.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // job-detail-content.tsx İLK yerel (localStorage) veriyi, yoksa Supabase
  // fallback'ini (get_visible_job RPC) okur — bu provider'ın kendi
  // tarayıcısında yerel kopya HİÇ yoktur (farklı context/hesap), bu yüzden
  // yalnızca uzak RPC yolu kullanılır ve zaman alabilir (bkz. admin
  // fazındaki AYNI gerekçe).
  await providerPage
    .waitForFunction(
      (title) => document.body.innerText.includes(title),
      "DepoTest — Kapalı Depolama İhtiyacı",
      { timeout: 45000 },
    )
    .catch(async () => {
      const bodyText = await providerPage.locator("body").innerText().catch(() => "(okunamadı)");
      console.error("DEBUG — provider ilan detayında başlık bulunamadı. URL:", providerPage.url(), "\nSayfa metni (ilk 800):", bodyText.slice(0, 800));
      await providerPage.screenshot({ path: path.join(os.tmpdir(), "depo-test-debug-provider-detail.png"), fullPage: true }).catch(() => {});
    });
  const detailText = await providerPage.locator("body").innerText().catch(() => "");

  record("4a. Hizmet Veren ilan detayını açabiliyor (admin onayından sonra)", detailText.includes("DepoTest") || detailText.includes("Kapalı Depolama"));
  record("4b. Üst özet panelde Depolama Türü rozeti ('Kapalı Depolama') görünüyor", detailText.includes("Kapalı Depolama"));
  record("4c. 'Depolama Talebi' kartı görünüyor", detailText.includes("Depolama Talebi"));
  record("4d. Kartta Depolanacak Ürün doğru (Test Karton Kutular)", detailText.includes("Test Karton Kutular"));
  record("4e. Kartta Miktar admin düzenlemesini yansıtıyor (150 adet)", /150\s*adet/i.test(detailText));
  record(
    "4f. Kartta Toplam Tonaj doğru (3,5 ton ya da 3.5 ton)",
    /3[.,]5\s*ton/i.test(detailText),
  );
  record("4g. Kartta Tercih Edilen Konum var (Gebze / Kocaeli)", /Gebze\s*\/\s*Kocaeli/.test(detailText));
  // Düz takvim farkı: 20 gün sonra -> 28 gün sonra = 8 gün (kapsayıcı 9 DEĞİL).
  record("4h. Depolama Süresi DÜZ fark ile hesaplanmış (8 gün, 9 gün DEĞİL)", /\b8\s*gün\b/.test(detailText) && !/\b9\s*gün\b/.test(detailText), detailText.match(/\d+\s*gün/g)?.join(", "));
  record("4i. Facility/açık adres HİÇBİR YERDE sızmıyor (yalnızca İl/İlçe)", !detailText.includes("Liman / Sanayi") && !/Açık Adres/.test(detailText));

  // Teklif formunda Nakliye'ye özel "Tamamlanması Taahhüt Edilen Gün" ASLA
  // görünmemeli (zaten kod incelemesiyle onaylandı, burada canlı DOM'da da
  // doğrulanıyor).
  record("4j. Teklif formunda 'Tamamlanması Taahhüt Edilen Gün' YOK (Depolama'da hiç görünmemeli)", !detailText.includes("Tamamlanması Taahhüt Edilen Gün"));

  await providerPage.screenshot({ path: path.join(tmp, "depo-test-provider-detail.png"), fullPage: true }).catch(() => {});
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
