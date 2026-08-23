// node scripts/tmp-supabase-provider-document-lifecycle-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev server'a
// (http://localhost:3001, ayrı bir "npm run dev -- -p 3001" gerektirir) karşı:
// migration 0024'ün (provider_documents belge yaşam döngüsü) getirdiği
// davranışı doğrular — aynı provider+document_type için tek pending,
// onaylanan yeni belgenin eskisini 'superseded'e çevirmesi, eşzamanlı/çift
// yükleme isteklerinde mükerrer kayıt oluşmaması + yetim Storage dosyası
// temizliği, reddedilen belgelerin tarihçesinin bu yeni mantıktan hiç
// etkilenmemesi, ve her iki document_type ('genel'/'gumruk-musaviri-izin-
// belgesi') için de aynı garantiler.
//
// Gerekli ortam değişkenleri (shell tarafından export edilir, hiçbir zaman
// diske yazılmaz/loglanmaz): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST. Admin bootstrap için `npx supabase db query --linked`
// (CLI'nin bu makinede projeye `supabase link` ile bağlı olması ön koşuldur) —
// bkz. tmp-supabase-provider-document-review-test.mjs'in AYNI ön koşulu.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-doc-lifecycle-"));

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
  const email = `malsevk-doclife-${label}-${stamp}@gmail.com`;
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
  return { userId, email, client };
}

/**
 * `app/_lib/supabase-provider-documents.ts#uploadAndRegisterProviderDocument`
 * ile BİREBİR AYNI algoritma (Storage'a yükle -> RPC ile metadata kaydet ->
 * RPC hata verirse Storage'daki dosyayı sil) — o dosya `createSupabaseBrowserClient`
 * (tarayıcıya özgü, `window` gerektirir) kullandığı için düz bir Node
 * script'ten doğrudan import edilemez; bu yüzden AYNI mantık burada, düz
 * `@supabase/supabase-js` ile yeniden üretilir. Gerçek UI üzerinden (Playwright)
 * ayrıca en az bir kez birebir aynı yol test edilir (bkz. aşağıdaki "GERÇEK UI"
 * bölümü) — bu fonksiyon yalnızca DB-seviyesi/eşzamanlılık testleri için hız
 * amaçlı bir eşdeğerdir, GERÇEK kodun YERİNE geçmez.
 */
async function uploadWithCleanup(client, userId, documentType, label) {
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
  return { ok: true, id: createRes.data.id, storagePath, originalFileName: `${label}.pdf` };
}

async function approveDoc(client, documentId) {
  return client.rpc("review_provider_document", { p_document_id: documentId, p_status: "approved" });
}
async function rejectDoc(client, documentId, note) {
  return client.rpc("review_provider_document", { p_document_id: documentId, p_status: "rejected", p_note: note });
}

async function storageFolderFiles(userId) {
  const { data } = await admin.storage.from("provider-documents").list(userId, { limit: 100 });
  return (data ?? []).map((f) => f.name);
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

async function waitForEnabled(locator, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await locator.isDisabled())) return true;
    await locator.page().waitForTimeout(250);
  }
  return false;
}

const createdUserIds = [];
let browser;

async function main() {
  // ---------------------------------------------------------------------
  // KURULUM
  // ---------------------------------------------------------------------
  const adminEmail = `malsevk-doclife-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(
    `update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Test Admin' where id = '${adminUserId}';`,
  );
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap doğrudan DB erişimiyle başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck));

  const providerA = await createHizmetVeren("a");
  createdUserIds.push(providerA.userId);
  const providerB = await createHizmetVeren("b");
  createdUserIds.push(providerB.userId);

  const adminSdkClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminSdkClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });

  const stamp = Date.now();

  // ---------------------------------------------------------------------
  // GRUP 1 — Q1/Q4 + Kısıt (a)+(d): eşzamanlı istekte aynı provider+type için
  // en fazla bir pending, veritabanı seviyesinde.
  // ---------------------------------------------------------------------
  {
    const [r1, r2] = await Promise.all([
      uploadWithCleanup(providerA.client, providerA.userId, "genel", `G1-${stamp}-x`),
      uploadWithCleanup(providerA.client, providerA.userId, "genel", `G1-${stamp}-y`),
    ]);
    const succeeded = [r1, r2].filter((r) => r.ok);
    const failed = [r1, r2].filter((r) => !r.ok);
    record(
      "1. Aynı provider+type için GERÇEK eşzamanlı istek: tam olarak biri başarılı, diğeri reddedildi",
      succeeded.length === 1 && failed.length === 1,
      JSON.stringify({ r1, r2 }),
    );
    record(
      "1b. Reddedilen istek MLK81 hata koduyla döndü",
      failed[0]?.error?.code === "MLK81",
      `${failed[0]?.error?.code}: ${failed[0]?.error?.message}`,
    );

    const dbRows = runSql(
      `select id, current_review_status from public.provider_documents where provider_id = '${providerA.userId}' and document_type = 'genel';`,
    );
    record("1c. DB'de bu provider+type için TEK pending satır var", dbRows.length === 1 && dbRows[0]?.current_review_status === "pending", JSON.stringify(dbRows));

    const files = await storageFolderFiles(providerA.userId);
    record(
      "1d (yetim temizliği). Başarısız denemenin Storage dosyası silindi, yalnızca başarılı olanınki kaldı",
      files.length === 1,
      JSON.stringify(files),
    );

    var docA1 = succeeded[0];
  }

  // ---------------------------------------------------------------------
  // GRUP 2 — Farklı document_type çakışmaz (kısıt provider+type BİRLEŞİK).
  // ---------------------------------------------------------------------
  {
    const rGumruk = await uploadWithCleanup(providerA.client, providerA.userId, "gumruk-musaviri-izin-belgesi", `G2-gumruk-${stamp}`);
    record(
      "2. 'genel' pending varken AYNI provider için 'gumruk-musaviri-izin-belgesi' pending yüklenebiliyor (farklı tür, çakışma yok)",
      rGumruk.ok === true,
      JSON.stringify(rGumruk),
    );
    const dbRows = runSql(
      `select document_type, current_review_status from public.provider_documents where provider_id = '${providerA.userId}' order by document_type;`,
    );
    record(
      "2b. DB'de A için iki farklı türde birer pending satır var (2 satır)",
      dbRows.length === 2 && dbRows.every((r) => r.current_review_status === "pending"),
      JSON.stringify(dbRows),
    );
    var docA1Gumruk = rGumruk;
  }

  // ---------------------------------------------------------------------
  // GRUP 3 — Q2 (approved varken yükleme serbest) + Q3/Kısıt (b): yeni belge
  // onaylandığında eski approved 'superseded'e geçer, silinmez.
  // ---------------------------------------------------------------------
  {
    const approve1 = await approveDoc(adminSdkClient, docA1.id);
    record("3a. A'nın ilk 'genel' belgesi onaylandı", !approve1.error && approve1.data?.current_review_status === "approved", approve1.error?.message);

    // Q2: approved belge varken YENİ belge yüklenebiliyor mu? — EVET, kasıtlı
    // olarak serbest (yıllık belge yenileme senaryosu) — yalnızca PENDING
    // tekilliği zorlanıyor, approved'la çakışma diye bir kural YOK.
    const docA2Result = await uploadWithCleanup(providerA.client, providerA.userId, "genel", `G3-yeni-${stamp}`);
    record("3b (Q2). 'genel' zaten approved iken A YENİ bir 'genel' belge yükleyebiliyor", docA2Result.ok === true, JSON.stringify(docA2Result));

    const approve2 = await approveDoc(adminSdkClient, docA2Result.id);
    record("3c. A'nın YENİ 'genel' belgesi de onaylandı", !approve2.error && approve2.data?.current_review_status === "approved", approve2.error?.message);

    const dbAfter = runSql(
      `select id, current_review_status from public.provider_documents where id in ('${docA1.id}', '${docA2Result.id}');`,
    );
    const oldRow = dbAfter.find((r) => r.id === docA1.id);
    const newRow = dbAfter.find((r) => r.id === docA2Result.id);
    record(
      "3d (Q3). Eski belge SİLİNMEDİ, 'superseded'e geçti; yeni belge 'approved' — ikisi de DB'de mevcut",
      oldRow?.current_review_status === "superseded" && newRow?.current_review_status === "approved",
      JSON.stringify({ oldRow, newRow }),
    );

    // Gümrük türü hâlâ pending, bu supersede işleminden HİÇ etkilenmemeli (farklı document_type).
    const gumrukStillPending = runSql(`select current_review_status from public.provider_documents where id = '${docA1Gumruk.id}';`);
    record(
      "3e. Farklı türdeki (gümrük) pending belge bu supersede işleminden etkilenmedi",
      gumrukStillPending[0]?.current_review_status === "pending",
      JSON.stringify(gumrukStillPending[0]),
    );

    var lifecycleDocOldId = docA1.id;
    var lifecycleDocNewId = docA2Result.id;
    // NOT: docA1, Grup 1'deki GERÇEK eşzamanlı yarışın rastgele kazananıdır
    // (r1/r2'den hangisi önce commit edilirse) — bu yüzden dosya adı ASLA
    // sabit varsayılmaz, `uploadWithCleanup`'ın döndürdüğü GERÇEK
    // `originalFileName`'den okunur (bir önceki sürümde "-x" sabit
    // varsayılmıştı, bu YANLIŞTI — yarışı bazen "-y" kazanıyor, o zaman
    // "-x" hiç DB'ye yazılmıyor ve Playwright doğrulaması sahte-FAIL veriyordu).
    var lifecycleFileOld = docA1.originalFileName;
    var lifecycleFileNew = docA2Result.originalFileName;
  }

  // ---------------------------------------------------------------------
  // GRUP 4 — Reddedilen belgelerin tarihçesi korunuyor VE supersede
  // mantığından hiç etkilenmiyor (yalnızca 'approved' sibling'ler hedeflenir).
  // ---------------------------------------------------------------------
  {
    const docB1 = await uploadWithCleanup(providerB.client, providerB.userId, "genel", `G4-red-${stamp}`);
    record("4a. B'nin ilk 'genel' belgesi yüklendi", docB1.ok === true, JSON.stringify(docB1));

    const rejectNote = "E2E test: belge okunaksız, lütfen yeniden yükleyin.";
    const reject1 = await rejectDoc(adminSdkClient, docB1.id, rejectNote);
    record("4b. B'nin belgesi reddedildi", !reject1.error && reject1.data?.current_review_status === "rejected", reject1.error?.message);

    const docB2 = await uploadWithCleanup(providerB.client, providerB.userId, "genel", `G4-yeni1-${stamp}`);
    record("4c. Reddedilen belgenin yerine yenisi yüklenebiliyor (rejected, pending'i işgal etmiyor)", docB2.ok === true, JSON.stringify(docB2));

    const approveB2 = await approveDoc(adminSdkClient, docB2.id);
    record("4d. B'nin ikinci belgesi onaylandı", !approveB2.error, approveB2.error?.message);

    const docB3 = await uploadWithCleanup(providerB.client, providerB.userId, "genel", `G4-yeni2-${stamp}`);
    const approveB3 = await approveDoc(adminSdkClient, docB3.id);
    record("4e. B, approved iken üçüncü kez yükleyip onaylatabiliyor (ikinci supersede olayı)", docB3.ok === true && !approveB3.error, JSON.stringify({ docB3, err: approveB3.error?.message }));

    const finalRows = runSql(
      `select id, current_review_status from public.provider_documents where id in ('${docB1.id}', '${docB2.id}', '${docB3.id}');`,
    );
    const b1 = finalRows.find((r) => r.id === docB1.id);
    const b2 = finalRows.find((r) => r.id === docB2.id);
    const b3 = finalRows.find((r) => r.id === docB3.id);
    record(
      "5 (Q5 + kısıt c). Reddedilen belge (B1) İKİ AYRI supersede olayından SONRA bile hâlâ 'rejected' — hiç silinmedi/dokunulmadı",
      b1?.current_review_status === "rejected",
      JSON.stringify({ b1, b2, b3 }),
    );
    record(
      "5b. İlk onaylı belge (B2) ikinci onaydan (B3) sonra 'superseded'e geçti, B3 'approved'",
      b2?.current_review_status === "superseded" && b3?.current_review_status === "approved",
      JSON.stringify({ b2, b3 }),
    );

    var docB1Id = docB1.id;
    var docB1Note = rejectNote;
  }

  // ---------------------------------------------------------------------
  // TARAYICI AKIŞI — mevcut admin paneli/"Belgelerim" bozulmadı + yeni
  // durumlar (superseded rozeti, aksiyon butonlarının gizlenmesi) doğru
  // yansıyor + MLK81 GERÇEK UI üzerinden (yetim temizliğiyle birlikte).
  // ---------------------------------------------------------------------
  browser = await chromium.launch();

  {
    const { context, page } = await loginInNewContext(browser, adminEmail);
    await page.goto(`${APP_ORIGIN}/admin`);
    await assert.doesNotReject(
      page.getByText("Hizmet Veren Belge Kontrolü (Supabase — Gerçek Veri)").waitFor({ state: "visible", timeout: 15000 }),
    );

    const oldRowContainer = page.locator("div.rounded-md.border").filter({ has: page.getByText(lifecycleFileOld) }).first();
    await assert.doesNotReject(oldRowContainer.getByText("Yenisiyle Değiştirildi").waitFor({ state: "visible", timeout: 15000 }));
    record("6a. Admin panelinde 'superseded' belge doğru Türkçe rozetle görünüyor", true);
    const oldRowActionButtons = await oldRowContainer.getByRole("button", { name: /Onayla|^Reddet$|Yeniden Belge İste/ }).count();
    record("6b. 'superseded' satırda ARTIK inceleme aksiyon butonu yok (yalnızca Görüntüle)", oldRowActionButtons === 0, `buton sayısı: ${oldRowActionButtons}`);
    await assert.doesNotReject(oldRowContainer.getByRole("button", { name: "Görüntüle" }).waitFor({ state: "visible", timeout: 5000 }));

    const newRowContainer = page.locator("div.rounded-md.border").filter({ has: page.getByText(lifecycleFileNew) }).first();
    await assert.doesNotReject(newRowContainer.getByText("Onaylandı").waitFor({ state: "visible", timeout: 15000 }));
    record("6c. Yeni (güncel) onaylı belge admin panelinde 'Onaylandı' gösteriyor — mevcut akış bozulmadı", true);

    await context.close();
  }

  {
    const { context, page } = await loginInNewContext(browser, providerA.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    await assert.doesNotReject(page.getByText("Belgelerim").waitFor({ state: "visible", timeout: 15000 }));

    const oldRow = page.locator("div.rounded-md.border").filter({ has: page.getByText(lifecycleFileOld) }).first();
    await assert.doesNotReject(oldRow.getByText("Yenisiyle Değiştirildi").waitFor({ state: "visible", timeout: 15000 }));
    const oldRowUploadButton = await oldRow.getByRole("button", { name: "Yeni Belge Yükle" }).count();
    record(
      "7a. Hizmet Veren kendi 'superseded' belgesini görüyor, 'Yeni Belge Yükle' butonu YOK (yalnızca rejected/revision_requested'ta var)",
      oldRowUploadButton === 0,
      `buton sayısı: ${oldRowUploadButton}`,
    );

    const newRow = page.locator("div.rounded-md.border").filter({ has: page.getByText(lifecycleFileNew) }).first();
    await assert.doesNotReject(newRow.getByText("Onaylandı").waitFor({ state: "visible", timeout: 5000 }));
    record("7b. Hizmet Veren güncel onaylı belgesini 'Onaylandı' olarak görüyor — mevcut 'Belgelerim' akışı bozulmadı", true);

    await context.close();
  }

  // GERÇEK UI üzerinden MLK81 + yetim Storage temizliği: B'nin reddedilen
  // belgesi (docB1Id, hâlâ "Reddedildi") üzerinde "Yeni Belge Yükle"ye
  // basıp dosya seçmeden HEMEN ÖNCE, B'nin AYNI türü ('genel') için ayrı bir
  // pending satırı doğrudan SDK ile oluşturulur — böylece gerçek UI'ın
  // göndereceği istek, sunucu tarafında MLK81 ile GERÇEKTEN çakışır (yarış
  // durumunu taklit eden en gerçekçi yol: pending slotu UI aksiyonundan HEMEN
  // önce başka biri/başka bir sekme tarafından doldurulmuş gibi davranır).
  {
    const blockerUpload = await uploadWithCleanup(providerB.client, providerB.userId, "genel", `G8-blocker-${stamp}`);
    record("8-ön. B için 'genel' pending slotunu dolduran engelleyici belge yüklendi", blockerUpload.ok === true, JSON.stringify(blockerUpload));

    const { context, page } = await loginInNewContext(browser, providerB.email);
    await page.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const rejectedRow = page.locator("div.rounded-md.border").filter({ has: page.getByText(`G4-red-${stamp}.pdf`) }).first();
    await assert.doesNotReject(rejectedRow.getByText("Reddedildi").waitFor({ state: "visible", timeout: 15000 }));
    await rejectedRow.getByRole("button", { name: "Yeni Belge Yükle" }).click();

    const replacementFileName = `G8-cakisma-${stamp}.pdf`;
    const replacementFilePath = path.join(scratchDir, replacementFileName);
    writeFileSync(replacementFilePath, `%PDF-1.4\n% G8 çakışma denemesi\n%%EOF`, "utf8");
    await rejectedRow.locator('input[type="file"]').setInputFiles(replacementFilePath);
    const sendButton = rejectedRow.getByRole("button", { name: "Belgeyi Gönder" });
    const becameEnabled = await waitForEnabled(sendButton, 15000);
    record("8a. Dosya doğrulaması tamamlanınca 'Belgeyi Gönder' aktifleşiyor", becameEnabled);
    await sendButton.click();

    await assert.doesNotReject(
      rejectedRow.getByText("Bu belge türü için zaten inceleme bekleyen bir belgeniz var").waitFor({ state: "visible", timeout: 15000 }),
    );
    record("8b. GERÇEK UI üzerinden MLK81'in Türkçe, anlaşılır mesajı gösteriliyor", true);

    await context.close();
  }

  const filesAfterConflict = await storageFolderFiles(providerB.userId);
  const conflictFileStillThere = filesAfterConflict.some((name) => name.includes("G8-cakisma"));
  record(
    "8c (yetim temizliği, GERÇEK UI). Başarısız UI yükleme denemesinin Storage dosyası kalmadı",
    !conflictFileStillThere,
    JSON.stringify(filesAfterConflict),
  );
  const dbRowsAfterConflict = runSql(
    `select count(*) as n from public.provider_documents where provider_id = '${providerB.userId}' and document_type = 'genel' and current_review_status = 'pending';`,
  );
  record(
    "8d. DB'de B için 'genel' pending satır sayısı hâlâ tam olarak 1 (mükerrer satır oluşmadı)",
    Number(dbRowsAfterConflict[0]?.n) === 1,
    JSON.stringify(dbRowsAfterConflict[0]),
  );

  // ---------------------------------------------------------------------
  // RLS + yetkisiz erişim testleri (tekrar doğrulama)
  // ---------------------------------------------------------------------
  const crossReadAttempt = await providerA.client
    .from("provider_documents")
    .select("id")
    .eq("provider_id", providerB.userId);
  record(
    "9a (RLS). A, B'nin provider_documents satırlarını okuyamaz",
    (crossReadAttempt.data ?? []).length === 0,
    crossReadAttempt.error?.message ?? JSON.stringify(crossReadAttempt.data),
  );

  const directInsertAttempt = await providerA.client.from("provider_documents").insert({
    provider_id: providerA.userId,
    document_type: "genel",
    storage_path: `${providerA.userId}/hile.pdf`,
    original_file_name: "hile.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 10,
  });
  record(
    "9b (RLS/GRANT). Provider, provider_documents'a RPC'yi baypas edip DOĞRUDAN INSERT yapamaz (GRANT yok)",
    !!directInsertAttempt.error,
    directInsertAttempt.error?.message ?? "(hata bekleniyordu ama yoktu)",
  );

  const nonAdminReviewAttempt = await providerA.client.rpc("review_provider_document", {
    p_document_id: lifecycleDocNewId,
    p_status: "rejected",
    p_note: "deneme",
  });
  record(
    "9c. Admin olmayan hesap (A) review_provider_document çağıramaz (MLK50) — migration sonrası tekrar doğrulandı",
    nonAdminReviewAttempt.error?.code === "MLK50",
    `${nonAdminReviewAttempt.error?.code}: ${nonAdminReviewAttempt.error?.message}`,
  );

  // Reddetme notunun (Q7/görev 7) hâlâ zorunlu VE kalıcı olduğunu (migration
  // 0024'ten sonra da) tekrar doğrula — 0024 review_provider_document'i
  // CREATE OR REPLACE ile değiştirdiği için bu davranışın KORUNDUĞUNU
  // doğrulamak KRİTİK bir regresyon kontrolüdür.
  const emptyNoteAttempt = await adminSdkClient.rpc("review_provider_document", { p_document_id: lifecycleDocOldId, p_status: "rejected" });
  record(
    "9d (regresyon). Açıklamasız reddetme hâlâ MLK75 ile reddediliyor (0024 sonrası bozulmadı)",
    emptyNoteAttempt.error?.code === "MLK75",
    `${emptyNoteAttempt.error?.code}: ${emptyNoteAttempt.error?.message}`,
  );
  const reviewLogRow = runSql(`select note from public.provider_document_reviews where document_id = '${docB1Id}' order by created_at desc limit 1;`);
  record(
    "9e (kalıcılık). B1'in red notu provider_document_reviews'de hâlâ değişmeden duruyor",
    reviewLogRow[0]?.note === docB1Note,
    JSON.stringify(reviewLogRow[0]),
  );
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {}

  try {
    const providerIds = createdUserIds.slice(1); // admin hariç
    for (const providerId of providerIds) {
      const files = await storageFolderFiles(providerId);
      const paths = files.map((name) => `${providerId}/${name}`);
      if (paths.length > 0) await admin.storage.from("provider-documents").remove(paths);
    }
  } catch (error) {
    console.warn("Storage temizliği sırasında uyarı:", error?.message || error);
  }

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
