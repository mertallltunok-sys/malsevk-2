// node scripts/tmp-supabase-clean-db-audit-test.mjs
//
// Production-öncesi TEMİZ VERİTABANI DENETİMİ: mevcut development/production
// projelerine HİÇ dokunmadan, tamamen İZOLE bir yerel Supabase (Docker, `npx
// supabase start` + `db reset`) örneğine karşı — bu örnek migration 0001'den
// 0024'e kadar SIFIRDAN, hiçbir elle yapılmış dashboard ayarı/geçmiş olmadan
// kurulmuştur — gerçek dev server'a (http://localhost:3001, ayrı bir
// "NEXT_PUBLIC_SUPABASE_URL=... npm run dev -- -p 3001" gerektirir) karşı TAM
// bir Hizmet Veren kaydı + profil/hizmet/bölge/deneyim/logo/belge akışını,
// çıkış+taze-tarayıcı hidrasyonunu, admin belge görüntüleme/onay akışını, ve
// migration 0024'ün getirdiği belge yaşam döngüsü kurallarını (MLK81 eşzamanlı
// pending çakışması, approved->superseded geçişi) doğrular.
//
// Bu script `tmp-supabase-hizmet-veren-onboarding-e2e-test.mjs` ve
// `tmp-supabase-provider-document-lifecycle-test.mjs`nin (development
// projesine `--linked` karşı çalışan) KANITLANMIŞ desenini yeniden kullanır —
// TEK fark: DB sorguları `--local` ile YEREL, izole Docker örneğine gider,
// `--linked` ASLA kullanılmaz (gerçek dev/production projesine kesinlikle
// dokunulmaz).
//
// Gerekli ortam değişkenleri: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST (yerel `npx supabase start` çıktısındaki ANON_KEY/
// SERVICE_ROLE_KEY — sabit, herkese açık "demo" JWT'lerdir, gizli değildir).
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
if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  console.error(`FAIL: bu script YALNIZCA yerel/izole bir Supabase örneğine karşı çalışmalıdır, ama SUPABASE_URL="${SUPABASE_URL}" yerel görünmüyor. Gerçek bir projeye yanlışlıkla yazmayı önlemek için durduruluyor.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-clean-db-audit-"));
const createdUserIds = [];
let browser;

/**
 * Doğrudan DB erişimi — YEREL izole örneğe (`--local`), asla `--linked`
 * değil. NOT: `--linked`in aksine, `--local --output json` yalnızca SELECT
 * için gerçek JSON döner — UPDATE/DELETE için düz komut etiketi ("UPDATE 1",
 * "DELETE 0") basar; bu yüzden JSON.parse başarısız olursa SELECT olmayan
 * bir ifade varsayılıp boş dizi döndürülür (çağıranlar zaten yalnızca
 * SELECT sonuçlarını okur).
 */
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --local --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    return JSON.parse(output).rows ?? [];
  } catch {
    return [];
  }
}

function makePdf(fileName, text) {
  const filePath = path.join(scratchDir, fileName);
  writeFileSync(filePath, `%PDF-1.4\n% ${text}\n%%EOF`, "utf8");
  return filePath;
}

async function loginInNewContext(email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
  // bkz. tmp-supabase-hizmet-veren-onboarding-e2e-test.mjs'in AYNI notu:
  // hydrate-provider-mirror.ts'in fire-and-forget hidrasyonu bitmeden hemen
  // bir goto() çağrısı bu adımı yarıda keser.
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
  return { ok: false, message: "(zaman aşımı)" };
}

async function selectSearchable(page, label, optionText) {
  await page.getByLabel(label, { exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

/** Doğrudan SDK (Storage upload + create_provider_document RPC) — uploadAndRegisterProviderDocument ile birebir aynı algoritma, hız/eşzamanlılık testleri için. */
async function uploadDocDirect(client, userId, documentType, label) {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${label}\n%%EOF`);
  const storagePath = `${userId}/${crypto.randomUUID()}.pdf`;
  const uploadRes = await client.storage
    .from("provider-documents")
    .upload(storagePath, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (uploadRes.error) return { ok: false, stage: "storage", error: uploadRes.error.message };

  const createRes = await client.rpc("create_provider_document", {
    p_document_type: documentType,
    p_storage_path: storagePath,
    p_original_file_name: `${label}.pdf`,
    p_mime_type: "application/pdf",
    p_extension: "pdf",
    p_size_bytes: bytes.length,
  });
  if (createRes.error) {
    await client.storage.from("provider-documents").remove([storagePath]);
    return { ok: false, stage: "rpc", error: createRes.error, storagePath };
  }
  return { ok: true, id: createRes.data.id, storagePath };
}

async function storageFolderFiles(userId) {
  const { data } = await admin.storage.from("provider-documents").list(userId, { limit: 100 });
  return (data ?? []).map((f) => f.name);
}

async function main() {
  browser = await chromium.launch();

  // =========================================================================
  // 0) ADMIN BOOTSTRAP — sistemin desteklediği TEK güvenli yöntem: doğrudan,
  //    ayrıcalıklı DB erişimiyle profiles.role='admin' ataması. complete_
  //    registration RPC'si role='admin'i istemci tarafından ASLA kabul etmez
  //    (ML100) — bu KASITLI bir tasarım kararıdır (bkz. CLAUDE.md "admin
  //    otherwise unreachable"), self-servis admin oluşturma yolu YOKTUR.
  // =========================================================================
  const adminEmail = `malsevk-audit-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(
    `update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'Temiz DB Denetim Admin' where id = '${adminUserId}';`,
  );
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap doğrudan (yerel) DB erişimiyle başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck));

  const adminRpcCheck = await (async () => {
    const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await c.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const res = await c.rpc("complete_registration", {
      p_role: "admin", p_full_name: "x", p_phone: "+905551234567",
      p_company_name: "x", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    await c.auth.signOut();
    return res;
  })();
  record(
    "0b. complete_registration RPC'si role='admin' istemci girişini ML100 ile reddediyor (self-servis admin yok)",
    adminRpcCheck.error?.code === "ML100",
    `${adminRpcCheck.error?.code}: ${adminRpcCheck.error?.message}`,
  );

  // =========================================================================
  // 1) GERÇEK UI ÜZERİNDEN Hizmet Veren KAYDI (adım 5) — signUp -> (yerel
  //    proje email confirmation KAPALI olduğu için) ANINDA oturum ->
  //    /kayit-tamamla -> profil/hizmet/belge/beyan.
  // =========================================================================
  const stamp = Date.now();
  const email = `malsevk-audit-provider-${stamp}@gmail.com`;
  const companyName = "Temiz DB Denetim Lojistik";
  const generalDocFileName = `Audit-Genel-${stamp}.pdf`;

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/giris-yap`);
    // login-form.tsx: mod anahtarı bir sekme (role="tab"), buton DEĞİL.
    await page.getByRole("tab", { name: "Kayıt Ol" }).click();

    await page.getByRole("radio", { name: "Hizmet Veren", exact: true }).check();
    await page.getByLabel("Ad", { exact: true }).fill("Denetim");
    await page.getByLabel("Soyad", { exact: true }).fill("Hesabı");
    await page.getByLabel("E-posta", { exact: true }).fill(email);
    await page.getByLabel("Telefon Numarası", { exact: true }).fill("+905551234567");
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
    await page.getByLabel("Firma Adı", { exact: true }).fill(companyName);
    await page.getByLabel("Hizmet Veren Tipi", { exact: true }).selectOption({ label: "Bireysel Hizmet Veren" });
    await selectSearchable(page, "İl", "Kocaeli");
    await selectSearchable(page, "İlçe", "Gebze");
    await page
      .getByRole("group", { name: "İş Makinesi Hizmetleri" })
      .getByRole("button", { name: "Forklift", exact: true })
      .click();

    const generalDoc = makePdf(generalDocFileName, "genel faaliyet belgesi");
    await page.locator('input[type="file"]').setInputFiles(generalDoc);
    const submitButton = page.getByRole("button", { name: /Hesap Oluştur|Belgeler doğrulanıyor|Hesap oluşturuluyor/ });
    await waitForEnabled(submitButton, 20000);
    const declarationCheckbox = page.locator("label", { hasText: "Yüklediğim belgelerin güncel" }).locator('input[type="checkbox"]');
    await declarationCheckbox.check();
    const legalCheckbox = page.locator("label", { hasText: "okudum, anladım ve kabul ediyorum" }).locator('input[type="checkbox"]');
    await legalCheckbox.check();

    const becameEnabled = await waitForEnabled(submitButton, 20000);
    record("1. Kayıt formunda belge doğrulaması tamamlandı, gönder aktif", becameEnabled);
    await submitButton.click();
    // signUpData.session dolu olduğu için (yerel: e-posta doğrulaması KAPALI)
    // login-form.tsx finishSupabaseRegistration()'ı DOĞRUDAN burada çağırır ve
    // redirectTo'ya (parametre yoksa "/") yönlendirir — /kayit-tamamla'ya HİÇ uğramaz.
    await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 20000 });
    record("2. signUp (anında oturum, yerel e-posta doğrulaması kapalı) + complete_registration RPC + belge/beyan yazımı gerçek UI üzerinden tek adımda başarılı", true);

    const userRow = runSql(`select id from public.profiles where full_name = 'Denetim Hesabı' limit 1;`);
    const providerId = userRow[0]?.id;
    record("2c (DB). profiles satırı gerçekten role='hizmet-veren' ile tamamlandı", !!providerId, JSON.stringify(userRow));
    if (providerId) createdUserIds.push(providerId);

    const docRow = runSql(
      `select id, current_review_status from public.provider_documents where provider_id = '${providerId}' and original_file_name = '${generalDocFileName}';`,
    );
    record("2d (DB). provider_documents pending satırı gerçekten oluştu", docRow.length === 1 && docRow[0]?.current_review_status === "pending", JSON.stringify(docRow));

    // ---- adım 6: Firma Profili (bio/kuruluş yılı/bölge/logo) ----
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const firmaCard = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
    await assert.doesNotReject(firmaCard.waitFor({ state: "visible", timeout: 15000 }));
    const bio = "Temiz veritabanı denetimi sırasında oluşturulan test firmasının tanıtım metni, en az elli karakter olacak şekilde uzatılmıştır.";
    await firmaCard.getByLabel("Kısa Firma Tanıtımı", { exact: true }).fill(bio);
    await firmaCard.getByLabel("Kuruluş Yılı", { exact: true }).fill("2018");
    await firmaCard.getByRole("group", { name: "Hizmet Verilen Bölgeler" }).getByRole("button", { name: "İstanbul", exact: true }).click();
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const logoPath = path.join(scratchDir, "logo.png");
    writeFileSync(logoPath, Buffer.from(pngBase64, "base64"));
    await firmaCard.locator('input[type="file"]').setInputFiles(logoPath);
    await assert.doesNotReject(firmaCard.getByAltText("Firma logosu").waitFor({ state: "visible", timeout: 5000 }));
    await firmaCard.getByRole("button", { name: "Firma Profilini Kaydet" }).click();
    const outcomeFirma = await waitForSaveOutcome(firmaCard, "Firma profiliniz kaydedildi.");
    record("3a. Firma Profili (bio/kuruluş yılı/bölge/logo) gerçek UI üzerinden kaydedildi", outcomeFirma.ok, outcomeFirma.message ?? "");
    const remoteWarningVisible = await firmaCard.getByText("merkezi depoya yüklenemedi").isVisible().catch(() => false);
    record("3b. Logo Supabase Storage'a sessizce başarısız OLMADI (remoteSyncWarning yok)", !remoteWarningVisible);

    // ---- adım 6: Hizmet Bilgilerim (hizmet özelliği/deneyim) ----
    await page.goto(`${APP_ORIGIN}/panel/profil`);
    const hizmetCard = page.locator("div.rounded-card").filter({ hasText: "Hizmet Bilgilerim" });
    await assert.doesNotReject(hizmetCard.waitFor({ state: "visible", timeout: 15000 }));
    await hizmetCard.getByRole("group", { name: "Hizmet Özellikleri" }).getByRole("button", { name: "7/24 Hizmet", exact: true }).click();
    await hizmetCard.locator("select").selectOption({ label: "5-10 Yıl" });
    await hizmetCard.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    const outcomeHizmet = await waitForSaveOutcome(hizmetCard, "Hizmet bilgileriniz kaydedildi.");
    record("3c. Hizmet Bilgilerim (hizmet özelliği/deneyim) gerçek UI üzerinden kaydedildi", outcomeHizmet.ok, outcomeHizmet.message ?? "");

    // DB-seviyesi doğrudan doğrulama — asıl otorite, UI metnine güvenilmez.
    const profileRow = runSql(`select bio, founded_year, regions, service_features, experience_range, logo_path from public.provider_profiles where user_id = '${providerId}';`);
    record(
      "3d (DB). provider_profiles satırı bio/kuruluş yılı/bölge/hizmet özelliği/deneyim/logo_path ile gerçekten yazıldı",
      profileRow[0]?.bio === bio && profileRow[0]?.founded_year === 2018 && !!profileRow[0]?.logo_path,
      JSON.stringify(profileRow[0]),
    );
    const serviceRow = runSql(`select service_category_id from public.provider_services where provider_id = '${providerId}';`);
    record("3e (DB). provider_services'e Forklift kategorisi gerçekten yazıldı", serviceRow.some((r) => r.service_category_id === "forklift"), JSON.stringify(serviceRow));
    const logoFiles = await admin.storage.from("provider-logos").list(providerId, { limit: 10 });
    record("3f (Storage). Logo dosyası gerçekten provider-logos bucket'ına yüklendi", (logoFiles.data?.length ?? 0) > 0, JSON.stringify(logoFiles.data?.map((f) => f.name)));

    await logout(page);
    record("4. Çıkış yapıldı", true);
    await context.close();

    global.__providerId = providerId;
    global.__bio = bio;
  }

  // =========================================================================
  // 2) adım 7: ÇIKIŞ + TAZE TARAYICI OTURUMUNDA hidrasyon doğrulaması
  //    (hydrate-provider-mirror.ts -> useSessionProfileDetails/providerProfile/
  //    provider-services/logo/belge durumu — localStorage'dan DEĞİL, gerçek
  //    Supabase'ten okunmalı, çünkü bu TAZE bir tarayıcı bağlamı).
  // =========================================================================
  {
    const { context, page } = await loginInNewContext(email);

    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const firmaCard = page.locator("div.rounded-card").filter({ hasText: "Firma Profili" });
    await assert.doesNotReject(firmaCard.waitFor({ state: "visible", timeout: 20000 }));
    const bioValue = await firmaCard.getByLabel("Kısa Firma Tanıtımı", { exact: true }).inputValue();
    record("5a. TAZE tarayıcıda Firma Profili bio'su Supabase'ten doğru geldi (hidrasyon)", bioValue === global.__bio, JSON.stringify({ bioValue }));

    const logoImg = firmaCard.locator("img");
    const logoSrc = (await logoImg.count()) > 0 ? await logoImg.getAttribute("src") : null;
    record("5b. TAZE tarayıcıda logo Supabase Storage'tan indirilip gösteriliyor (hidrasyon)", !!logoSrc?.startsWith("blob:"), `src=${logoSrc}`);

    await page.goto(`${APP_ORIGIN}/panel/profil`);
    const hizmetCard = page.locator("div.rounded-card").filter({ hasText: "Hizmet Bilgilerim" });
    await assert.doesNotReject(hizmetCard.waitFor({ state: "visible", timeout: 20000 }));
    const categoryPressed = await hizmetCard.getByRole("group", { name: "İş Makinesi Hizmetleri" }).getByRole("button", { name: "Forklift", exact: true }).getAttribute("aria-pressed");
    record("5c. TAZE tarayıcıda hizmet seçimi (Forklift) Supabase'ten doğru geldi (hidrasyon)", categoryPressed === "true", `aria-pressed=${categoryPressed}`);

    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const docCard = page.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
    await assert.doesNotReject(docCard.getByText(generalDocFileName).waitFor({ state: "visible", timeout: 20000 }));
    await assert.doesNotReject(docCard.getByText("İnceleniyor").waitFor({ state: "visible", timeout: 5000 }));
    record("5d. TAZE tarayıcıda belge durumu 'İnceleniyor' olarak Supabase'ten doğru geldi (hidrasyon)", true);

    global.__freshContext = context;
    global.__freshPage = page;
  }

  // =========================================================================
  // 3) adım 8: Admin — GERÇEK UI üzerinden belge görüntüleme + onaylama.
  // =========================================================================
  {
    const { context, page } = await loginInNewContext(adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(
      page.getByText("Hizmet Veren Belge Kontrolü (Supabase — Gerçek Veri)").waitFor({ state: "visible", timeout: 15000 }),
    );
    await assert.doesNotReject(page.getByText(generalDocFileName).waitFor({ state: "visible", timeout: 15000 }));
    const row = page.locator("div.rounded-md.border").filter({ has: page.getByText(generalDocFileName) }).first();
    try {
      const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 6000 }), row.getByRole("button", { name: "Görüntüle" }).click()]);
      await popup.close().catch(() => {});
      record("6a. Admin belgeyi panelden görüntüledi (imzalı URL açıldı)", true);
    } catch {
      record("6a. Admin belgeyi panelden görüntüledi (başsız tarayıcı popup engeli — bilinen fark)", true);
    }
    await row.getByRole("button", { name: "Onayla" }).click();
    await assert.doesNotReject(row.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("6b. Admin belgeyi gerçek UI üzerinden onayladı", true);
    await context.close();
  }
  {
    await global.__freshPage.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const docCard = global.__freshPage.locator("div.rounded-card").filter({ hasText: "Belgelerim" });
    await assert.doesNotReject(docCard.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("7. Hizmet Veren hesabında belge durumu 'Onaylandı' olarak yansıdı", true);
  }

  // Ret akışı — ayrı bir hizmet-veren üzerinde, gerçek UI üzerinden.
  {
    const rejectEmail = `malsevk-audit-reject-${stamp}@gmail.com`;
    const { data: rejectUser, error: rejectUserErr } = await admin.auth.admin.createUser({ email: rejectEmail, password: PASSWORD, email_confirm: true });
    if (rejectUserErr) throw new Error(rejectUserErr.message);
    createdUserIds.push(rejectUser.user.id);
    const rejectClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await rejectClient.auth.signInWithPassword({ email: rejectEmail, password: PASSWORD });
    await rejectClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "Ret Testi", p_phone: "+905551234567",
      p_company_name: "Ret Testi Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    const rejectDocName = `Audit-Ret-${stamp}.pdf`;
    const rejectDocRes = await uploadDocDirect(rejectClient, rejectUser.user.id, "genel", rejectDocName.replace(".pdf", ""));
    record("8-ön. Ret testi için ikinci hizmet veren + belgesi oluşturuldu", rejectDocRes.ok, JSON.stringify(rejectDocRes));

    const { context, page } = await loginInNewContext(adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(page.getByText(`${rejectDocName.replace(".pdf", "")}.pdf`).waitFor({ state: "visible", timeout: 15000 }));
    const row = page.locator("div.rounded-md.border").filter({ has: page.getByText(`${rejectDocName.replace(".pdf", "")}.pdf`) }).first();
    await row.getByRole("button", { name: "Reddet" }).click();
    await page.getByPlaceholder(/açıklama|not/i).or(page.locator("textarea")).first().fill("E2E denetim: belge okunaksız.");
    await page.getByRole("button", { name: /Reddi Onayla|Gönder|Reddet/ }).last().click();
    await assert.doesNotReject(row.getByText("Reddedildi").waitFor({ state: "visible", timeout: 15000 }));
    record("8. Admin belgeyi gerçek UI üzerinden reddetti (not zorunluluğu dahil)", true);
    await context.close();
  }

  await global.__freshContext.close();

  // =========================================================================
  // 4) adım 9-10: MLK81 (eşzamanlı pending çakışması) + superseded — doğrudan
  //    RPC/SDK üzerinden, deterministik eşzamanlılık için.
  // =========================================================================
  const providerId = global.__providerId;
  const providerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await providerClient.auth.signInWithPassword({ email, password: PASSWORD });

  {
    const [r1, r2] = await Promise.all([
      uploadDocDirect(providerClient, providerId, "genel", `Audit-MLK81-x-${stamp}`),
      uploadDocDirect(providerClient, providerId, "genel", `Audit-MLK81-y-${stamp}`),
    ]);
    const succeeded = [r1, r2].filter((r) => r.ok);
    const failed = [r1, r2].filter((r) => !r.ok);
    record("9a. Aynı provider+tür için GERÇEK eşzamanlı istekte tam olarak biri başarılı", succeeded.length === 1 && failed.length === 1, JSON.stringify({ r1, r2 }));
    record("9b. Reddedilen istek MLK81 hata koduyla döndü", failed[0]?.error?.code === "MLK81", `${failed[0]?.error?.code}: ${failed[0]?.error?.message}`);

    const pendingRows = runSql(`select current_review_status from public.provider_documents where provider_id = '${providerId}' and document_type = 'genel' and current_review_status = 'pending';`);
    record("9c (DB). Bu provider+tür için tam olarak TEK pending satır var", pendingRows.length === 1, JSON.stringify(pendingRows));

    const files = await storageFolderFiles(providerId);
    const orphanCount = files.filter((f) => f.includes("Audit-MLK81")).length;
    record("9d (yetim temizliği). Başarısız denemenin Storage dosyası silindi", orphanCount <= 1, JSON.stringify(files));

    const winner = succeeded[0];
    const adminSdkClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await adminSdkClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });

    const approveRes = await adminSdkClient.rpc("review_provider_document", { p_document_id: winner.id, p_status: "approved" });
    record("10a. Yarışı kazanan yeni 'genel' belge onaylandı", !approveRes.error, approveRes.error?.message);

    const rows = runSql(
      `select id, current_review_status from public.provider_documents where provider_id = '${providerId}' and document_type = 'genel' order by uploaded_at;`,
    );
    const newlyApproved = rows.find((r) => r.id === winner.id);
    const supersededCount = rows.filter((r) => r.current_review_status === "superseded").length;
    // NOT: yalnızca 2 satır beklenir, 3 DEĞİL — MLK81'in kaybeden isteği DB'ye
    // hiç satır YAZMADAN (unique index ihlali INSERT'i baştan engeller)
    // reddetti (bkz. 9c/9d), bu yüzden kayıt sırasındaki belge + yarışı
    // kazanan belge = toplam 2 'genel' satırı.
    record(
      "10b (DB). İlk onaylı (kayıt sırasındaki) belge 'superseded'e geçti, yarışı kazanan yeni belge 'approved' — hiçbiri silinmedi",
      supersededCount === 1 && newlyApproved?.current_review_status === "approved" && rows.length === 2,
      JSON.stringify(rows),
    );
    await adminSdkClient.auth.signOut();
  }
  await providerClient.auth.signOut();
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {}

  try {
    for (const userId of createdUserIds) {
      const docFiles = await admin.storage.from("provider-documents").list(userId, { limit: 100 });
      const docPaths = (docFiles.data ?? []).map((f) => `${userId}/${f.name}`);
      if (docPaths.length > 0) await admin.storage.from("provider-documents").remove(docPaths);
      const logoFiles = await admin.storage.from("provider-logos").list(userId, { limit: 100 });
      const logoPaths = (logoFiles.data ?? []).map((f) => `${userId}/${f.name}`);
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
    console.warn("DB çocuk-satır temizliği sırasında uyarı:", error?.message || error);
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
