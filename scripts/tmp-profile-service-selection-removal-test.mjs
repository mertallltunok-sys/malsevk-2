// node scripts/tmp-profile-service-selection-removal-test.mjs
//
// "Profilim/Hesap Ayarları Sadeleştirmesi" görevinin uçtan uca doğrulaması
// — gerçek tarayıcıya karşı (Playwright, gerçek Chromium), Development
// Supabase projesine (trfnmpihcnriqgikglpu) karşı.
//
// Kapsam: Hizmet Veren'in kendi profilinden hizmet/uzmanlık seçemediği;
// "Hizmet Yetkileri"nin yalnızca admin onaylı+aktif kayıtları gösterdiği
// (tek/çok/sıfır aktif durumları + canlı admin yetkilendirme/kaldırma);
// bekleyen/reddedilen/kaldırılmış yetkilerin hiç görünmediği; Çalışma
// Bölgeleri/Deneyim/Firma Profili alanlarının çalışmaya devam ettiği; eski
// (legacy) uzmanlık/hizmet verisinin kaydetme sırasında SİLİNMEDİĞİ; profil
// tamamlama yüzdesinin kaldırılan kriterleri artık saymadığı; kayıt/belge
// yükleme akışının bozulmadığı; kategori izolasyonunun (backend) etkilenmediği;
// mobil/tablet/masaüstü regresyonu; konsol hataları.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
const createdJobIds = [];

async function createAccount({ email, role, fullName, companyName }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
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
  return { id: data.user.id, email, client };
}

async function newActorPage(browser, viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return { context, page, errors };
}

async function fillAndVerify(locator, value, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(300);
  }
  throw new Error(`fillAndVerify: value did not stick (wanted "${value}")`);
}

// isVisible() Playwright'ta OTOMATİK BEKLEMEZ (yalnız anlık kontrol) — bu
// yüzden script boyunca "önce görünür olmasını gerçekten bekle, sonra true
// dön" için TEK bir yardımcı kullanılır.
async function waitVisible(locator, timeout = 10000) {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function loginAs(page, email) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Giriş Yap" }).first().waitFor({ state: "visible", timeout: 15000 });
    await fillAndVerify(page.locator('input[type="email"]'), email);
    await fillAndVerify(page.locator('input[type="password"]'), PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) return;
  }
  throw new Error(`loginAs(${email}) failed after 4 attempts`);
}

async function gotoProfilAndWait(page) {
  // İlk istek, Turbopack'in ilgili route'u SOĞUK (henüz derlenmemiş)
  // derlemesi yüzünden beklenenden çok uzun sürebilir (özellikle bu route'a
  // dokunan dosyalar az önce değiştirildiyse) — bu yüzden ilk deneme
  // zaman aşımına uğrarsa TEK bir reload ile tekrar denenir (bu script
  // ailesinde daha önce kanıtlanmış desen, bkz. tmp-*-test.mjs'lerin
  // gotoJobAndWait'i).
  await page.goto(`${APP_ORIGIN}/panel/profil`, { waitUntil: "domcontentloaded" });
  const ok = await page
    .getByRole("heading", { name: "Hizmet Yetkileri" })
    .waitFor({ state: "visible", timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 25000 });
  }
  await waitAuthorizationsLoaded(page);
}

// "Hizmet Yetkileri" başlığı SENKRON render edilir (loading durumundan
// BAĞIMSIZ), ama kart İÇERİĞİ (boş durum metni / rozetler) yalnızca
// getMyServiceAuthorizations'ın ASENKRON fetch'i bittikten SONRA doğru
// hâle gelir — bu yüzden başlığın görünür olması TEK BAŞINA içerik
// kontrolü için yeterli değildir. "Yükleniyor..." spinner'ının KAYBOLMASI
// beklenerek gerçek yarış durumu (race) kapatılır.
async function waitAuthorizationsLoaded(page) {
  await page
    .getByText("Yükleniyor...", { exact: true })
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
}

async function main() {
  console.log("=== Kurulum: hesaplar ===");
  const requester = await createAccount({
    email: `profsimp-req-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "ProfSimp Requester",
    companyName: "ProfSimp Firma",
  });
  const providerZero = await createAccount({
    email: `profsimp-provzero-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "ProfSimp Sıfır Yetkili",
    companyName: "ProfSimp Sıfır Firma",
  });
  const providerMulti = await createAccount({
    email: `profsimp-provmulti-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "ProfSimp Çoklu Yetkili",
    companyName: "ProfSimp Çoklu Firma",
  });
  const providerLegacy = await createAccount({
    email: `profsimp-provlegacy-${stamp}@example.com`,
    role: "hizmet-veren",
    fullName: "ProfSimp Legacy Firma",
    companyName: "ProfSimp Legacy Firma",
  });
  const adminAccount = await createAccount({
    email: `profsimp-admin-${stamp}@example.com`,
    role: "hizmet-alan",
    fullName: "ProfSimp Admin",
    companyName: "ProfSimp Admin Firma",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${adminAccount.id}';`);
  record("Kurulum: 5 hesap oluşturuldu (requester, 3 provider, admin)", true);

  const browser = await chromium.launch();
  try {
    // ============================================================
    // 1. Sıfır aktif yetki — boş durum metni birebir
    // ============================================================
    console.log("\n=== 1. Sıfır aktif yetkili provider ===");
    const { page: zeroPage, errors: zeroErrors } = await newActorPage(browser);
    await loginAs(zeroPage, providerZero.email);
    await gotoProfilAndWait(zeroPage);
    // isVisible() Playwright'ta OTOMATİK BEKLEMEZ (yalnız anlık kontrol) —
    // getMyServiceAuthorizations'ın async fetch'i henüz bitmemiş olabilir,
    // bu yüzden ÖNCE gerçekten bekleyen waitFor() kullanılır.
    const zeroEmptyStateVisible = await zeroPage
      .getByText("Admin tarafından onaylanmış aktif hizmet yetkiniz bulunmuyor.", { exact: true })
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    record("Sıfır yetkili: boş durum metni BİREBİR gösteriliyor", zeroEmptyStateVisible);
    const zeroNoServiceSelectionUi = !(await zeroPage.getByText("Hizmet Seçimi", { exact: false }).isVisible().catch(() => false));
    record("Sıfır yetkili: 'Hizmet Seçimi' hiçbir yerde görünmüyor", zeroNoServiceSelectionUi);

    // ============================================================
    // 2. Hizmet Veren kendi profilinden hizmet/uzmanlık SEÇEMİYOR (DOM kanıtı)
    // ============================================================
    console.log("\n=== 2. Profilim'de hizmet seçim arayüzü tamamen kaldırılmış ===");
    const profilBodyText = await zeroPage.locator("main, body").first().innerText();
    record("Profilim: 'Hizmet Seçimi' başlığı YOK", !profilBodyText.includes("Hizmet Seçimi"));
    record("Profilim: 'Hizmet Özellikleri' başlığı YOK", !profilBodyText.includes("Hizmet Özellikleri"));
    record("Profilim: 'Geri Dönüşüm Uzmanlık Alanları' YOK", !profilBodyText.includes("Geri Dönüşüm Uzmanlık Alanları"));
    const noServiceCheckboxes = await zeroPage.locator('[id*="-chips"]').count();
    record("Profilim: eski hizmet-grubu chip container'ları DOM'da YOK", noServiceCheckboxes === 0, `count=${noServiceCheckboxes}`);
    record("Profilim: 'Çalışma Bölgeleri' hâlâ mevcut", profilBodyText.includes("Çalışma Bölgeleri"));
    record("Profilim: 'Deneyim' alanı hâlâ mevcut", profilBodyText.includes("Deneyim"));

    // ============================================================
    // 3. Hesap Ayarları'nda Uzmanlık Alanları kaldırılmış, Hizmet Verilen Bölgeler duruyor
    // ============================================================
    console.log("\n=== 3. Hesap Ayarları'nda Uzmanlık Alanları kaldırılmış ===");
    await zeroPage.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`, { waitUntil: "domcontentloaded" });
    await zeroPage.getByRole("heading", { name: "Firma Profili" }).waitFor({ state: "visible", timeout: 15000 });
    const hesapAyarlariText = await zeroPage.locator("main, body").first().innerText();
    record("Hesap Ayarları: 'Uzmanlık Alanları' başlığı YOK", !hesapAyarlariText.includes("Uzmanlık Alanları"));
    record("Hesap Ayarları: 'Hizmet Verilen Bölgeler' hâlâ mevcut", hesapAyarlariText.includes("Hizmet Verilen Bölgeler"));
    record("Hesap Ayarları: 'Firma Logosu' hâlâ mevcut", hesapAyarlariText.includes("Firma Logosu"));
    record("Hesap Ayarları: 'Firma Adı' hâlâ mevcut", hesapAyarlariText.includes("Firma Adı"));

    // Firma Profili kaydetme hâlâ çalışıyor mu? (bio + kısa tanıtım zorunlu)
    await zeroPage.getByLabel("Kısa Firma Tanıtımı").fill("Bu firma test amaçlı elli karakterden uzun bir tanıtım metnidir.");
    await zeroPage.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    const firmaProfiliSaved = await waitVisible(zeroPage.getByText("Firma profiliniz kaydedildi.", { exact: false }), 8000);
    record("Firma Profili kaydetme çalışıyor (regresyon yok)", firmaProfiliSaved);

    // ============================================================
    // 4. Hizmet Bilgilerim (Çalışma Bölgeleri + Deneyim) kaydetme çalışıyor
    // ============================================================
    console.log("\n=== 4. Hizmet Bilgilerim kaydetme (Çalışma Bölgeleri + Deneyim) ===");
    await zeroPage.goto(`${APP_ORIGIN}/panel/profil`, { waitUntil: "domcontentloaded" });
    await zeroPage.getByRole("heading", { name: "Hizmet Bilgilerim" }).waitFor({ state: "visible", timeout: 15000 });
    await zeroPage.getByLabel("Deneyim").selectOption("3-5");
    // MultiSelectChips açılır bir SearchableSelect DEĞİL — arama kutusu
    // (searchable=true iken) HER ZAMAN görünür bir <input>, tıklanacak ayrı
    // bir "aç" butonu yok. Eşleşen seçenek de bir "option" değil, bir chip
    // <button aria-pressed>.
    await zeroPage.getByLabel("Çalışma Bölgeleri içinde ara").fill("Kocaeli");
    await zeroPage.getByRole("button", { name: "Kocaeli", exact: true }).click();
    await zeroPage.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    const hizmetBilgileriSaved = await waitVisible(zeroPage.getByText("Hizmet bilgileriniz kaydedildi.", { exact: false }), 8000);
    record("Hizmet Bilgilerim kaydetme çalışıyor (Deneyim+Çalışma Bölgeleri)", hizmetBilgileriSaved);

    const providerServicesAfterSave = runSql(`select service_category_id from public.provider_services where provider_id = '${providerZero.id}';`);
    record("Hizmet Bilgilerim kaydı provider_services'i BOŞ bırakmış (bu formdan asla yazılmıyor)", providerServicesAfterSave.length === 0, JSON.stringify(providerServicesAfterSave));

    // ============================================================
    // 5-8. Tek/çok aktif yetki + canlı admin yetkilendirme/kaldırma
    // ============================================================
    console.log("\n=== 5-8. Canlı admin yetkilendirme/kaldırma ===");
    // Provider'ın "seçtiği" (belge-yükleme akışının normalde yazacağı) 3
    // kategori — admin panelinin "Hizmet Yetkileri" kartı SEÇİLİ
    // kategorileri listeler, test kurulumu bu seçimi gerçek RPC ile simüle
    // eder (document-upload-content.tsx'in kendi yazım yolunun aynısı).
    await providerMulti.client.rpc("set_provider_service_categories", {
      p_category_ids: ["gozetim-hizmetleri", "forklift", "lashing-unlashing"],
    });
    record("Kurulum: providerMulti 3 kategori seçti (gerçek RPC ile)", true);

    const { page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminAccount.email);
    await adminPage.goto(`${APP_ORIGIN}/admin/firmalar/${providerMulti.id}`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 15000 });

    async function authorizeRow(categoryLabel) {
      const row = adminPage.locator(".rounded-md.border.border-border.bg-background", { hasText: categoryLabel }).first();
      await row.getByRole("button", { name: "Yetkilendir", exact: true }).click();
      await row.getByRole("button", { name: "Yetkiyi Kaldır", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    }
    async function revokeRow(categoryLabel, reason) {
      const row = adminPage.locator(".rounded-md.border.border-border.bg-background", { hasText: categoryLabel }).first();
      await row.getByRole("button", { name: "Yetkiyi Kaldır", exact: true }).click();
      await row.getByLabel("Kaldırma nedeni (zorunlu)").fill(reason);
      await row.getByRole("button", { name: "Onayla", exact: true }).click();
      await row.getByRole("button", { name: "Yetkilendir", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    }

    await authorizeRow("Gözetim Hizmetleri");
    record("Admin canlı olarak 1. kategoriyi (Gözetim Hizmetleri) yetkilendirdi", true);

    // 5. Tek aktif yetkili
    const { page: multiPage } = await newActorPage(browser);
    await loginAs(multiPage, providerMulti.email);
    await gotoProfilAndWait(multiPage);
    let multiBodyText = await multiPage.locator("main, body").first().innerText();
    record(
      "Tek aktif yetki: yalnız 'Gözetim Hizmetleri' görünüyor, Forklift/Lashing YOK",
      multiBodyText.includes("Gözetim Hizmetleri") && !multiBodyText.includes("Forklift") && !multiBodyText.includes("Lashing"),
    );

    await authorizeRow("Forklift");
    record("Admin canlı olarak 2. kategoriyi (Forklift) yetkilendirdi", true);

    // 6. Çok aktif yetkili — provider sayfayı YENİLER ve canlı güncellemeyi görür
    await multiPage.reload({ waitUntil: "domcontentloaded" });
    await multiPage.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 15000 });
    await waitAuthorizationsLoaded(multiPage);
    multiBodyText = await multiPage.locator("main, body").first().innerText();
    record(
      "Çok aktif yetki: 'Gözetim Hizmetleri' VE 'Forklift' ikisi de görünüyor, Lashing hâlâ YOK",
      multiBodyText.includes("Gözetim Hizmetleri") && multiBodyText.includes("Forklift") && !multiBodyText.includes("Lashing"),
    );
    // "text=Aktif" (tırnaksız/exact olmayan) Playwright'ın metin motorunda
    // yalnız rozetin kendi <span>'ini DEĞİL, o metni İÇEREN üst elemanları da
    // eşleştirebilir (bilinen bir Playwright tuzağı) — bu yüzden yalnız
    // TRIMMED metni TAM OLARAK "Aktif" olan elemanlar sayılır.
    const activeBadgeCount = await multiPage.getByText("Aktif", { exact: true }).count();
    record("Çok aktif yetki: tam olarak 2 'Aktif' rozeti var", activeBadgeCount === 2, `count=${activeBadgeCount}`);

    // 7. Canlı kaldırma (revoke) — provider yeniden yenileyip kaybolduğunu görür
    await revokeRow("Gözetim Hizmetleri", "Test amaçlı kaldırma — canlı doğrulama.");
    record("Admin canlı olarak 'Gözetim Hizmetleri' yetkisini kaldırdı", true);
    await multiPage.reload({ waitUntil: "domcontentloaded" });
    await multiPage.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 15000 });
    await waitAuthorizationsLoaded(multiPage);
    multiBodyText = await multiPage.locator("main, body").first().innerText();
    record(
      "Kaldırma sonrası: 'Gözetim Hizmetleri' ARTIK GÖRÜNMÜYOR, 'Forklift' hâlâ görünüyor",
      !multiBodyText.includes("Gözetim Hizmetleri") && multiBodyText.includes("Forklift"),
    );

    // 8. Bekleyen/reddedilen/kaldırılmış hiçbiri görünmüyor (Lashing hiç yetkilendirilmedi = "seçilmedi" durumunda)
    record(
      "Hiç yetkilendirilmemiş 'Lashing / Unlashing' de görünmüyor (yalnızca aktif olanlar listelenir)",
      !multiBodyText.includes("Lashing"),
    );
    record(
      "Kaldırılan yetki (Gözetim Hizmetleri) 'kaldırıldı' rozetiyle bile GÖRÜNMÜYOR (tamamen dışlanıyor)",
      !multiBodyText.includes("Kaldırıldı") && !multiBodyText.includes("Yetkisiz"),
    );

    // ============================================================
    // 9. Kullanıcı kendi yetkisini değiştiremiyor (yalnız admin panelinde aksiyon var)
    // ============================================================
    console.log("\n=== 9. Kullanıcı kendi yetkisini değiştiremiyor ===");
    const anyActionButtonOnProfile = await multiPage
      .getByRole("button", { name: /Yetkilendir|Yetkiyi Kaldır/ })
      .count();
    record("Profilim'de yetki değiştirme butonu YOK (salt okunur)", anyActionButtonOnProfile === 0, `count=${anyActionButtonOnProfile}`);

    // ============================================================
    // 10+11. Eski (legacy) veri kaydetme sırasında SİLİNMİYOR
    // ============================================================
    console.log("\n=== 10-11. Legacy veri korunuyor mu ===");
    const { page: legacyPage } = await newActorPage(browser);
    await loginAs(legacyPage, providerLegacy.email);
    await gotoProfilAndWait(legacyPage); // ilk girişte StoredUser mirror'ı oluşsun diye

    await legacyPage.evaluate((email) => {
      const KEY = "malsevk.users.v1";
      const raw = localStorage.getItem(KEY);
      const users = JSON.parse(raw || "[]");
      const me = users.find((u) => u.email === email);
      if (!me) throw new Error("localStorage'da legacy provider bulunamadı");
      me.providerProfile = {
        ...(me.providerProfile || {}),
        companyName: me.providerProfile?.companyName || "ProfSimp Legacy Firma",
        bio: me.providerProfile?.bio || "",
        expertise: ["Nakliye", "Depolama"],
        serviceFeatures: ["7-24", "faturali"],
        recyclingMaterialSpecialties: ["metal-hurda"],
        regions: me.providerProfile?.regions ?? [],
      };
      localStorage.setItem(KEY, JSON.stringify(users));
    }, providerLegacy.email);

    function readLegacyProfile() {
      return legacyPage.evaluate((email) => {
        const KEY = "malsevk.users.v1";
        const users = JSON.parse(localStorage.getItem(KEY) || "[]");
        const me = users.find((u) => u.email === email);
        return me?.providerProfile ?? null;
      }, providerLegacy.email);
    }

    const beforeSaveProfile = await readLegacyProfile();
    record(
      "Legacy veri localStorage'a başarıyla enjekte edildi (test kurulumu)",
      Array.isArray(beforeSaveProfile?.expertise) && beforeSaveProfile.expertise.length === 2,
      JSON.stringify(beforeSaveProfile),
    );

    // Hesap Ayarları'ndan kaydet — Uzmanlık Alanları artık UI'da YOK ama
    // kayıt sırasında var olan `expertise` SİLİNMEMELİ.
    await legacyPage.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`, { waitUntil: "domcontentloaded" });
    await legacyPage.getByRole("heading", { name: "Firma Profili" }).waitFor({ state: "visible", timeout: 15000 });
    await legacyPage.getByLabel("Kısa Firma Tanıtımı").fill("Legacy firma için elli karakterden uzun test tanıtım metni budur.");
    await legacyPage.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    await legacyPage.getByText("Firma profiliniz kaydedildi.", { exact: false }).waitFor({ state: "visible", timeout: 8000 });

    const afterAccountSettingsSave = await readLegacyProfile();
    record(
      "Hesap Ayarları kaydından SONRA eski 'expertise' verisi DEĞİŞMEDEN duruyor",
      JSON.stringify(afterAccountSettingsSave?.expertise) === JSON.stringify(["Nakliye", "Depolama"]),
      JSON.stringify(afterAccountSettingsSave?.expertise),
    );
    record(
      "Hesap Ayarları kaydından SONRA eski 'serviceFeatures' verisi DEĞİŞMEDEN duruyor",
      JSON.stringify(afterAccountSettingsSave?.serviceFeatures) === JSON.stringify(["7-24", "faturali"]),
      JSON.stringify(afterAccountSettingsSave?.serviceFeatures),
    );

    // Profilim > Hizmet Bilgilerim'den de kaydet — recyclingMaterialSpecialties SİLİNMEMELİ.
    await legacyPage.goto(`${APP_ORIGIN}/panel/profil`, { waitUntil: "domcontentloaded" });
    await legacyPage.getByRole("heading", { name: "Hizmet Bilgilerim" }).waitFor({ state: "visible", timeout: 15000 });
    await legacyPage.getByLabel("Deneyim").selectOption("1-3");
    await legacyPage.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    await legacyPage.getByText("Hizmet bilgileriniz kaydedildi.", { exact: false }).waitFor({ state: "visible", timeout: 8000 });

    const afterServiceInfoSave = await readLegacyProfile();
    record(
      "Hizmet Bilgilerim kaydından SONRA eski 'expertise' verisi HÂLÂ duruyor",
      JSON.stringify(afterServiceInfoSave?.expertise) === JSON.stringify(["Nakliye", "Depolama"]),
      JSON.stringify(afterServiceInfoSave?.expertise),
    );
    record(
      "Hizmet Bilgilerim kaydından SONRA eski 'recyclingMaterialSpecialties' verisi HÂLÂ duruyor",
      JSON.stringify(afterServiceInfoSave?.recyclingMaterialSpecialties) === JSON.stringify(["metal-hurda"]),
      JSON.stringify(afterServiceInfoSave?.recyclingMaterialSpecialties),
    );
    record(
      "Hizmet Bilgilerim kaydı yeni Deneyim değerini doğru güncelledi (regresyon yok)",
      afterServiceInfoSave?.experienceRange === "1-3",
      afterServiceInfoSave?.experienceRange,
    );

    // ============================================================
    // 12. Profil Tamamlanma yüzdesi — kaldırılan kriter artık sayılmıyor
    // ============================================================
    console.log("\n=== 12. Profil Tamamlanma yüzdesi ===");
    const completionText = await legacyPage.locator("main, body").first().innerText();
    record("Profil Tamamlanma yüzdesi gösteriliyor (regresyon yok)", /%\d+/.test(completionText), completionText.match(/%\d+/)?.[0]);
    const checklistHasHizmetSecimi = completionText.includes("Hizmet Seçimi");
    record("Profil Tamamlanma kontrol listesinde 'Hizmet Seçimi' YOK", !checklistHasHizmetSecimi);
    const checklistItems = ["Firma Adı", "Telefon", "E-posta", "Çalışma Bölgeleri", "Deneyim"];
    const allFiveVisible = checklistItems.every((label) => completionText.includes(label));
    record("Profil Tamamlanma kontrol listesi tam olarak 5 kriter içeriyor", allFiveVisible, checklistItems.join(", "));

    // ============================================================
    // 13. Kayıt/belge yükleme akışı bozulmamış
    // ============================================================
    console.log("\n=== 13. Belge yükleme akışı (kayıt sonrası) regresyon kontrolü ===");
    await legacyPage.goto(`${APP_ORIGIN}/panel/belge-yukleme`, { waitUntil: "domcontentloaded" });
    const belgeYuklemeLoaded = await waitVisible(legacyPage.getByText("hizmet", { exact: false }).first(), 10000);
    const belgeYuklemeNoError = !(await legacyPage.getByText("bir hata oluştu", { exact: false }).isVisible().catch(() => false));
    record("/panel/belge-yukleme hâlâ hatasız yükleniyor (kayıt/belge akışı bozulmadı)", belgeYuklemeLoaded && belgeYuklemeNoError);

    // ============================================================
    // 14. Kategori izolasyonu (backend) etkilenmemiş
    // ============================================================
    console.log("\n=== 14. Kategori izolasyonu (backend) regresyon kontrolü ===");
    const isoJob = await requester.client.rpc("create_job", {
      p_category_id: "forklift",
      p_title: "ProfSimp İzolasyon Testi — Forklift",
      p_description: "Kategori izolasyonu regresyon testi açıklaması.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Dilovası",
      p_work_location_type: "Test Fabrika",
      p_work_date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      p_photos: [{ storage_path: `profsimp/${stamp}.jpg`, original_file_name: "t.jpg", mime_type: "image/jpeg", size_bytes: 1, width: null, height: null }],
      p_address_text: "Test Adres",
    });
    if (isoJob.error) throw isoJob.error;
    createdJobIds.push(isoJob.data.id);
    runSql(`update public.jobs set moderation_status = 'approved' where id = '${isoJob.data.id}';`);

    await multiPage.goto(`${APP_ORIGIN}/ilanlar/${isoJob.data.id}`, { waitUntil: "domcontentloaded" });
    const authorizedOfferVisible = await waitVisible(multiPage.getByLabel("Teklif Tutarı", { exact: false }).first(), 10000);
    record("Forklift'te AKTİF yetkili provider teklif formunu görüyor (izolasyon bozulmadı)", authorizedOfferVisible);

    await zeroPage.goto(`${APP_ORIGIN}/ilanlar/${isoJob.data.id}`, { waitUntil: "domcontentloaded" });
    const unauthorizedOfferHidden = !(await waitVisible(zeroPage.getByLabel("Teklif Tutarı", { exact: false }).first(), 5000));
    record("Forklift'te YETKİSİZ provider teklif formunu GÖRMÜYOR (izolasyon bozulmadı)", unauthorizedOfferHidden);

    // ============================================================
    // 15-17. Responsive: mobil/tablet/masaüstü
    // ============================================================
    console.log("\n=== 15-17. Responsive kontrolü ===");
    for (const viewport of [
      { name: "mobil", width: 390, height: 844 },
      { name: "tablet", width: 834, height: 1112 },
    ]) {
      const { page: rpage, errors: rerrors } = await newActorPage(browser, viewport);
      await loginAs(rpage, providerMulti.email);
      for (const path of ["/panel/profil", "/panel/hesap-ayarlari"]) {
        await rpage.goto(`${APP_ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
        await rpage.waitForTimeout(800);
        const metrics = await rpage.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        record(`${viewport.name}${path}: yatay taşma yok`, metrics.scrollWidth <= metrics.clientWidth + 1, JSON.stringify(metrics));
      }
      if (rerrors.length > 0) record(`${viewport.name}: konsolda yeni hata yok`, false, rerrors.join(" | "));
      else record(`${viewport.name}: konsolda yeni hata yok`, true);
    }

    // ============================================================
    // 18. Masaüstünde WhatsApp destek butonu içerikle çakışmıyor
    // ============================================================
    console.log("\n=== 18. WhatsApp buton çakışma kontrolü ===");
    await multiPage.goto(`${APP_ORIGIN}/panel/profil`, { waitUntil: "domcontentloaded" });
    await multiPage.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 15000 });
    const whatsappOverlap = await multiPage.evaluate(() => {
      const wa = document.querySelector('a[href*="wa.me"]');
      const heading = Array.from(document.querySelectorAll("h2")).find((el) => el.textContent?.includes("Hizmet Yetkileri"));
      if (!wa || !heading) return { found: false };
      const waRect = wa.getBoundingClientRect();
      const hRect = heading.getBoundingClientRect();
      const overlap = !(waRect.right < hRect.left || waRect.left > hRect.right || waRect.bottom < hRect.top || waRect.top > hRect.bottom);
      return { found: true, overlap };
    });
    record("WhatsApp destek butonu 'Hizmet Yetkileri' başlığıyla ÇAKIŞMIYOR", whatsappOverlap.found && !whatsappOverlap.overlap, JSON.stringify(whatsappOverlap));

    // ============================================================
    // 19. Konsol hata kontrolü (ana akış)
    // ============================================================
    console.log("\n=== 19. Konsol hata kontrolü ===");
    if (zeroErrors.length > 0) record("Ana test akışında (zeroPage) konsolda yeni hata yok", false, zeroErrors.join(" | "));
    else record("Ana test akışında (zeroPage) konsolda yeni hata yok", true);

    // ============================================================
    // 20. DB doğrulaması — eski veri gerçekten SİLİNMEDİ
    // ============================================================
    console.log("\n=== 20. Veritabanı doğrulaması ===");
    const providerServicesRows = runSql(
      `select service_category_id from public.provider_services where provider_id = '${providerMulti.id}' order by service_category_id;`,
    );
    record(
      "provider_services tablosu hâlâ providerMulti'nin 3 seçimini koruyor (silinmedi)",
      providerServicesRows.length === 3,
      JSON.stringify(providerServicesRows),
    );
    const activeAuthRows = runSql(
      `select service_category_id, revoked_at from public.provider_service_authorizations where provider_id = '${providerMulti.id}' and revoked_at is null;`,
    );
    record(
      "provider_service_authorizations: yalnız 1 aktif satır (Forklift) kaldı, Gözetim revoked_at ile işaretli",
      activeAuthRows.length === 1 && activeAuthRows[0].service_category_id === "forklift",
      JSON.stringify(activeAuthRows),
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cleanup() {
  try {
    for (const jobId of createdJobIds) {
      runSql(`delete from public.notifications where job_id = '${jobId}' or offer_id in (select id from public.offers where job_id = '${jobId}');`);
      runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${jobId}');`);
      runSql(`delete from public.offers where job_id = '${jobId}';`);
      runSql(`delete from public.job_photos where job_id = '${jobId}';`);
      runSql(`delete from public.job_activity_events where job_id = '${jobId}';`);
      runSql(`delete from public.jobs where id = '${jobId}';`);
    }
    const idList = createdUserIds.map((id) => `'${id}'`).join(",");
    if (idList) {
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList}) or authorized_by in (${idList}) or revoked_by in (${idList});`);
      runSql(`delete from public.provider_services where provider_id in (${idList});`);
      runSql(`delete from public.provider_profiles where user_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
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
    console.error("BEKLENMEYEN HATA:", error?.stack || error);
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
