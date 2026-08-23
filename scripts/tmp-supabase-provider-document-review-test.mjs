// node scripts/tmp-supabase-provider-document-review-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev server'a
// (http://localhost:3001, ayrı bir "npm run dev -- -p 3001" gerektirir) karşı:
// `provider_documents` belge inceleme akışını GERÇEK bir admin hesabıyla
// uçtan uca doğrular — `tmp-supabase-provider-profile-writes-test.mjs`'in
// kendi yorumunda (madde 43-54) "review_provider_document'in GERÇEK bir admin
// hesabıyla POZİTİF (onay/red) ucu test EDİLEMİYOR" dediği eksik ucu tamamlar.
//
// Gerekli ortam değişkenleri (shell tarafından export edilir, hiçbir zaman
// diske yazılmaz/loglanmaz): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST (yalnızca test kullanıcısı kurulumu/temizliği için).
//
// `profiles.role='admin'` ataması hiçbir client-callable RPC/GRANT ile mümkün
// değildir (bkz. SUPABASE-MIGRATION-VALIDATION.md paragraf 20 civarı, "Admin
// rolünün atanması") — bu script bunu `npx supabase db query --linked --file`
// ile DOĞRUDAN DB erişimiyle (Management API üzerinden, PostgREST/service_role
// REST kısıtından bağımsız) yapar; supabase CLI'nin bu makinede `trfnmpihcnriqgikglpu`
// projesine `supabase link` ile bağlı olması ÖN KOŞULDUR.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-doc-review-"));

/** Doğrudan DB erişimi — yalnızca (a) admin bootstrap, (b) DB-seviyesi doğrulama, (c) temizlik için. */
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

async function createHizmetVeren(label) {
  const stamp = Date.now();
  const email = `malsevk-docreview-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-veren",
    p_full_name: `E2E ${label}`,
    p_phone: "+905551234567",
    p_company_name: `E2E Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  await client.auth.signOut();
  return { userId, email, client };
}

async function uploadDocument(email, originalFileName) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const {
    data: { user },
  } = await client.auth.getUser();
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% E2E test dosyası ${originalFileName}\n%%EOF`);
  const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
  const uploadRes = await client.storage
    .from("provider-documents")
    .upload(storagePath, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (uploadRes.error) throw new Error(`storage upload failed: ${uploadRes.error.message}`);
  const createRes = await client.rpc("create_provider_document", {
    p_document_type: "genel",
    p_storage_path: storagePath,
    p_original_file_name: originalFileName,
    p_mime_type: "application/pdf",
    p_extension: "pdf",
    p_size_bytes: bytes.length,
  });
  await client.auth.signOut();
  if (createRes.error) throw new Error(`create_provider_document failed: ${createRes.error.message}`);
  return createRes.data;
}

async function waitForEnabled(locator, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await locator.isDisabled())) return true;
    await locator.page().waitForTimeout(250);
  }
  return false;
}

async function loginInNewContext(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
  return { context, page };
}

const createdUserIds = [];
const createdDocumentIds = [];
let browser;

async function main() {
  // ---------------------------------------------------------------------
  // KURULUM: admin + iki hizmet-veren hesabı, her biri kendi belgesiyle.
  // ---------------------------------------------------------------------
  const adminEmail = `malsevk-docreview-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);

  // Admin'in kendi profiles satırı auth trigger'ıyla (handle_new_auth_user,
  // 0022) role=NULL olarak zaten oluşmuştur — complete_registration'a HİÇ
  // gerek yok (admin zaten "Hesap Türü" olarak seçilemez, bkz. CLAUDE.md),
  // role='admin' DOĞRUDAN DB erişimiyle atanır (tek yol, yukarı bkz.).
  runSql(
    `update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Test Admin' where id = '${adminUserId}';`,
  );
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap doğrudan DB erişimiyle başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck));

  const providerA = await createHizmetVeren("a");
  createdUserIds.push(providerA.userId);
  const providerB = await createHizmetVeren("b");
  createdUserIds.push(providerB.userId);

  const stamp = Date.now();
  const fileNameA = `E2E-Onay-${stamp}.pdf`;
  const fileNameB = `E2E-Red-${stamp}.pdf`;
  const docA = await uploadDocument(providerA.email, fileNameA);
  const docB = await uploadDocument(providerB.email, fileNameB);
  createdDocumentIds.push(docA.id, docB.id);

  // 1 & 2) Hizmet veren hesabıyla belge yükle + provider_documents pending oluştuğunu doğrula.
  record(
    "1-2. A'nın belgesi create_provider_document ile yüklendi ve pending durumda",
    docA.current_review_status === "pending" && docA.provider_id === providerA.userId,
    JSON.stringify({ id: docA.id, status: docA.current_review_status }),
  );
  record(
    "1-2. B'nin belgesi create_provider_document ile yüklendi ve pending durumda",
    docB.current_review_status === "pending" && docB.provider_id === providerB.userId,
    JSON.stringify({ id: docB.id, status: docB.current_review_status }),
  );

  // 10 (ön-doğrulama, tarayıcıdan önce API seviyesinde) — admin OLMAYAN (A
  // kendi belgesi için bile) review_provider_document çağıramaz.
  const nonAdminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await nonAdminClient.auth.signInWithPassword({ email: providerA.email, password: PASSWORD });
  const nonAdminAttempt = await nonAdminClient.rpc("review_provider_document", {
    p_document_id: docA.id,
    p_status: "approved",
  });
  record(
    "10a. Admin olmayan hesap (A) review_provider_document çağıramaz (MLK50)",
    nonAdminAttempt.error?.code === "MLK50",
    `${nonAdminAttempt.error?.code}: ${nonAdminAttempt.error?.message}`,
  );
  // Ek: admin olmayan bir hesap provider_documents'ı RPC'yi baypas edip
  // DOĞRUDAN UPDATE ile de değiştiremez (tablo üzerinde hiçbir UPDATE GRANT'i
  // yok, yalnızca SELECT — bkz. 0007).
  const nonAdminDirectUpdate = await nonAdminClient.from("provider_documents").update({ current_review_status: "approved" }).eq("id", docA.id);
  record(
    "10b. Admin olmayan hesap provider_documents'ı DOĞRUDAN UPDATE ile de değiştiremez (GRANT yok)",
    !!nonAdminDirectUpdate.error,
    nonAdminDirectUpdate.error?.message ?? "(hata bekleniyordu ama yoktu)",
  );
  await nonAdminClient.auth.signOut();

  // ---------------------------------------------------------------------
  // TARAYICI AKIŞI
  // ---------------------------------------------------------------------
  browser = await chromium.launch();

  // 3 & 4) Admin panelinden A'nın belgesini görüntüle, onayla.
  {
    const { context, page } = await loginInNewContext(browser, adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(
      page.getByText("Hizmet Veren Belge Kontrolü (Supabase — Gerçek Veri)").waitFor({ state: "visible", timeout: 15000 }),
    );
    await assert.doesNotReject(page.getByText(fileNameA).waitFor({ state: "visible", timeout: 15000 }));
    record("3a. Admin panelinde A'nın belgesi (gerçek Supabase verisi) listeleniyor", true);

    const rowContainer = page
      .locator("div.rounded-md.border")
      .filter({ has: page.getByText(fileNameA) })
      .first();
    // window.open, `createSignedUrl`in ASENKRON dönüşünden SONRA çağrıldığı
    // için (senkron bir tıklama işleyicisi değil), başsız Chromium'da
    // popup-engelleme davranışı ortam bağımlı olabilir — bu yüzden bu adım
    // en iyi çaba olarak denenir (başarısız olursa TÜM script'i çökertmez),
    // asıl/kalıcı kanıt hemen altındaki doğrudan SDK kontrolüdür.
    try {
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 8000 }),
        rowContainer.getByRole("button", { name: "Görüntüle" }).click(),
      ]);
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      const popupUrl = popup.url();
      record(
        "3b. 'Görüntüle' gerçek bir imzalı Storage URL'i açıyor (tarayıcı popup'ı)",
        popupUrl.includes("supabase.co") && popupUrl.includes("provider-documents"),
        popupUrl,
      );
      await popup.close();
    } catch (error) {
      console.warn("3b uyarı: popup yakalanamadı (başsız tarayıcı popup engelleme farkı olabilir):", error?.message || error);
    }

    // Kalıcı/ortamdan bağımsız kanıt: admin'in KENDİ oturumuyla, admin'in
    // Storage RLS politikası (provider_documents_bucket_read_own_or_admin,
    // 0019) sayesinde A'nın kendi klasörü DIŞINDAKİ bu belgeyi gerçekten
    // imzalı URL ile görüntüleyebildiğini doğrudan SDK üzerinden doğrular.
    const adminViewClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await adminViewClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const signedUrlResult = await adminViewClient.storage.from("provider-documents").createSignedUrl(docA.storage_path, 300);
    record(
      "3c. Admin, Storage RLS sayesinde A'nın belgesi için imzalı URL üretebiliyor (doğrudan SDK)",
      !signedUrlResult.error && !!signedUrlResult.data?.signedUrl,
      signedUrlResult.error?.message,
    );
    await adminViewClient.auth.signOut();

    await rowContainer.getByRole("button", { name: "Onayla" }).click();
    await assert.doesNotReject(rowContainer.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("4. Admin, A'nın belgesini panelden onayladı — durum 'Onaylandı' olarak güncellendi", true);

    await context.close();
  }

  // 5) Durumun approved olduğunu (DB) ve hizmet veren ekranına yansıdığını doğrula.
  const dbDocA = runSql(`select current_review_status, reviewed_by, reviewed_at from public.provider_documents where id = '${docA.id}';`);
  record(
    "5a. DB'de A'nın belgesi current_review_status='approved'",
    dbDocA[0]?.current_review_status === "approved",
    JSON.stringify(dbDocA[0]),
  );

  {
    const { context, page } = await loginInNewContext(browser, providerA.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    await assert.doesNotReject(page.getByText("Belgelerim").waitFor({ state: "visible", timeout: 15000 }));
    const rowContainer = page
      .locator("div.rounded-md.border")
      .filter({ has: page.getByText(fileNameA) })
      .first();
    await assert.doesNotReject(rowContainer.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("5b. Hizmet Veren (A) kendi Hesap Ayarları ekranında 'Onaylandı' durumunu görüyor", true);
    await context.close();
  }

  // 6 & 7) Ayrı bir belgeyle (B) red akışı — açıklama zorunlu, kalıcı.
  {
    const { context, page } = await loginInNewContext(browser, adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(page.getByText(fileNameB).waitFor({ state: "visible", timeout: 15000 }));
    const rowContainer = page
      .locator("div.rounded-md.border")
      .filter({ has: page.getByText(fileNameB) })
      .first();

    await rowContainer.getByRole("button", { name: "Reddet" }).click();
    const submitButton = rowContainer.getByRole("button", { name: "Gönder" });
    record("7a. Boş açıklamayla 'Gönder' butonu devre dışı (istemci tarafı zorunluluk)", await submitButton.isDisabled());

    const rejectionNote = "Belge okunaklı değil, lütfen daha net bir tarama yükleyin (E2E test notu).";
    await rowContainer.locator("textarea").fill(rejectionNote);
    await submitButton.click();
    await assert.doesNotReject(rowContainer.getByText("Reddedildi").waitFor({ state: "visible", timeout: 15000 }));
    record("6. Admin, B'nin belgesini ayrı bir akışta reddetti — durum 'Reddedildi'", true);
    await assert.doesNotReject(rowContainer.getByText(rejectionNote).waitFor({ state: "visible", timeout: 5000 }));
    record("7b. Red açıklaması admin panelinde (aynı satırda) görünür şekilde kaydedildi", true);

    await context.close();
  }

  // 7c) Sunucu tarafı: açıklamasız reddetme RPC seviyesinde de reddedilir (MLK75) — yalnızca UI kısıtı değil.
  const adminSdkClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminSdkClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
  const emptyNoteAttempt = await adminSdkClient.rpc("review_provider_document", {
    p_document_id: docB.id,
    p_status: "rejected",
  });
  record(
    "7d. Açıklamasız reddetme RPC seviyesinde de MLK75 ile reddediliyor (server-side zorunluluk)",
    emptyNoteAttempt.error?.code === "MLK75",
    `${emptyNoteAttempt.error?.code}: ${emptyNoteAttempt.error?.message}`,
  );

  // 7e) "Kalıcı": provider_document_reviews satırı hiçbir client tarafından UPDATE/DELETE edilemez (yalnızca SELECT GRANT'i var).
  const reviewRows = runSql(`select id, admin_id, action, note, created_at from public.provider_document_reviews where document_id = '${docB.id}' order by created_at desc limit 1;`);
  const reviewRowId = reviewRows[0]?.id;
  const tamperAttempt = reviewRowId
    ? await adminSdkClient.from("provider_document_reviews").update({ note: "TAMPERED" }).eq("id", reviewRowId)
    : { error: { message: "review row not found" } };
  record(
    "7f. provider_document_reviews satırı sonradan değiştirilemez (kalıcı log — GRANT yok)",
    !!tamperAttempt.error,
    tamperAttempt.error?.message,
  );
  await adminSdkClient.auth.signOut();

  // 9) İşlemi yapan admin ve işlem zamanı kaydedildi mi?
  const dbDocB = runSql(`select current_review_status, reviewed_by, reviewed_at, current_review_note from public.provider_documents where id = '${docB.id}';`);
  record(
    "9a. provider_documents.reviewed_by GERÇEK admin id'sine eşit, reviewed_at dolu",
    dbDocB[0]?.reviewed_by === adminUserId && !!dbDocB[0]?.reviewed_at,
    JSON.stringify(dbDocB[0]),
  );
  record(
    "9b. provider_document_reviews append-only log satırı doğru admin_id/action/note ile mevcut",
    reviewRows[0]?.admin_id === adminUserId && reviewRows[0]?.action === "rejected" && !!reviewRows[0]?.note,
    JSON.stringify(reviewRows[0]),
  );
  const dbDocAReview = runSql(`select admin_id, action from public.provider_document_reviews where document_id = '${docA.id}' order by created_at desc limit 1;`);
  record(
    "9c. A'nın onay kaydında da doğru admin_id/action mevcut",
    dbDocAReview[0]?.admin_id === adminUserId && dbDocAReview[0]?.action === "approved",
    JSON.stringify(dbDocAReview[0]),
  );

  // 8) Kullanıcının reddedilen belge yerine yenisini yükleyebildiğini test et (gerçek UI üzerinden).
  const replacementFileName = `E2E-Red-Yenisi-${stamp}.pdf`;
  const replacementFilePath = path.join(scratchDir, replacementFileName);
  writeFileSync(replacementFilePath, `%PDF-1.4\n% E2E replacement test dosyası\n%%EOF`, "utf8");
  {
    const { context, page } = await loginInNewContext(browser, providerB.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const rejectedRow = page
      .locator("div.rounded-md.border")
      .filter({ has: page.getByText(fileNameB) })
      .first();
    await assert.doesNotReject(rejectedRow.getByText("Reddedildi").waitFor({ state: "visible", timeout: 15000 }));
    await rejectedRow.getByRole("button", { name: "Yeni Belge Yükle" }).click();
    await rejectedRow.locator('input[type="file"]').setInputFiles(replacementFilePath);
    await assert.doesNotReject(rejectedRow.getByText(replacementFileName).waitFor({ state: "visible", timeout: 15000 }));
    const sendButton = rejectedRow.getByRole("button", { name: "Belgeyi Gönder" });
    const becameEnabled = await waitForEnabled(sendButton, 15000);
    record("8-ön. Dosya doğrulaması (istemci + sunucu) tamamlanınca 'Belgeyi Gönder' aktifleşiyor", becameEnabled);
    await sendButton.click();

    await assert.doesNotReject(page.getByText(replacementFileName).waitFor({ state: "visible", timeout: 15000 }));
    const newRow = page
      .locator("div.rounded-md.border")
      .filter({ has: page.getByText(replacementFileName) })
      .first();
    await assert.doesNotReject(newRow.getByText("İnceleniyor").waitFor({ state: "visible", timeout: 15000 }));
    record("8a. B, reddedilen belgesinin yerine gerçek UI üzerinden yeni bir belge yükledi (yeni satır: İnceleniyor)", true);

    const oldRowStillThere = page.locator("div.rounded-md.border").filter({ has: page.getByText(fileNameB) }).first();
    await assert.doesNotReject(oldRowStillThere.getByText("Reddedildi").waitFor({ state: "visible", timeout: 5000 }));
    record("8b. Eski reddedilen belge satırı geçmiş olarak (Reddedildi) korunuyor, silinmiyor", true);

    await context.close();
  }

  const replacementDocs = runSql(
    `select id, current_review_status from public.provider_documents where provider_id = '${providerB.userId}' and original_file_name = '${replacementFileName}';`,
  );
  if (replacementDocs[0]?.id) createdDocumentIds.push(replacementDocs[0].id);
  record(
    "8c. Yeni belge gerçekten provider_documents'ta ayrı bir satır olarak pending oluştu",
    replacementDocs.length === 1 && replacementDocs[0]?.current_review_status === "pending",
    JSON.stringify(replacementDocs),
  );

  // 10) Admin olmayan hesabın onay/red yapamadığını TEKRAR doğrula — bu kez B (kendi reddedilen belgesi üzerinde bile).
  const nonAdminClientB = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await nonAdminClientB.auth.signInWithPassword({ email: providerB.email, password: PASSWORD });
  const nonAdminRetryAttempt = await nonAdminClientB.rpc("review_provider_document", {
    p_document_id: replacementDocs[0]?.id,
    p_status: "approved",
  });
  record(
    "10c. Admin olmayan hesap (B, kendi yeni belgesi için bile) review_provider_document çağıramaz (MLK50)",
    nonAdminRetryAttempt.error?.code === "MLK50",
    `${nonAdminRetryAttempt.error?.code}: ${nonAdminRetryAttempt.error?.message}`,
  );
  await nonAdminClientB.auth.signOut();
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {}

  // Storage nesnelerini sil.
  try {
    const providerIds = createdUserIds.filter((id, index) => index > 0); // admin hariç (kendi belgesi yok)
    for (const providerId of providerIds) {
      const list = await admin.storage.from("provider-documents").list(providerId, { limit: 100 });
      const paths = (list.data ?? []).map((f) => `${providerId}/${f.name}`);
      if (paths.length > 0) await admin.storage.from("provider-documents").remove(paths);
    }
  } catch (error) {
    console.warn("Storage temizliği sırasında uyarı:", error?.message || error);
  }

  // DB'de çocuk satırları (FK cascade OLMAYAN tablolar) sil, SONRA auth
  // kullanıcılarını sil — aksi halde profiles.id'ye FK ile bağlı bu satırlar
  // (provider_documents/provider_document_reviews/notifications/audit_logs,
  // hiçbiri "on delete cascade" DEĞİL, bkz. 0007/0009/0010) auth.users
  // silmesini engeller (yalnızca profiles/provider_profiles/provider_services
  // "on delete cascade" — bkz. 0003).
  try {
    const idList = createdUserIds.map((id) => `'${id}'`).join(", ");
    if (idList) {
      runSql(`delete from public.provider_document_reviews where admin_id in (${idList}) or provider_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
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
