// node scripts/tmp-provider-documents-real-session-rls-test.mjs
//
// "Production Fotoğraf Yükleme Hatası ve Minimum 1 Fotoğraf Kuralı" görevinin
// eksik kalan private-belge güvenlik testi: provider_documents tablosu VE
// provider-documents Storage bucket'ının RLS sınırlarını GERÇEK, bağımsız
// Supabase Auth oturumlarıyla doğrular — service_role KULLANILMAZ (yalnız
// test hesaplarını Development projesinde signUp/complete_registration ile
// oluşturmak ve admin rolünü SQL ile atamak için `npx supabase db query
// --linked` kullanılır, ki bu da GERÇEK kullanıcı oturumunun kendisini
// TAKLİT ETMEZ — yalnızca test kurulumudur, aynı browser-test-*.mjs
// betiklerinin zaten kullandığı desen).
//
// Kanıtlanan üç iddia:
//  1. Belge sahibi (Provider A) kendi belgesini görebiliyor.
//  2. Başka bir Hizmet Veren (Provider B) — GERÇEK kendi oturumuyla —
//     A'nın belgesini ne tablo satırı olarak ne de Storage nesnesi olarak
//     göremiyor/indiremiyor, ve tabloyu DOĞRUDAN (RPC olmadan) güncelleyemiyor.
//  3. Admin (GERÇEK kendi oturumuyla, role='admin' SQL ile atanmış bir test
//     hesabı) A'nın belgesini görebiliyor VE indirebiliyor.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`[provider-documents-rls-test] FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(os.tmpdir(), "malsevk-docrls-"));
function runSql(query) {
  const file = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, query, "utf8");
  const out = execSync(`npx supabase db query --linked --file ${file} --output json`, { encoding: "utf8" });
  return JSON.parse(out).rows ?? [];
}

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}
function fail(description) {
  console.error(`  ✗ ${description}`);
  process.exitCode = 1;
}

function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createRealTestUser(label, role) {
  const email = `malsevk-docrls-${label}-${Date.now()}@gmail.com`;
  const cli = freshClient();
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await cli.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signInWithPassword(${label}) failed: ${signInError.message}`);
  }
  const { error: crError } = await cli.rpc("complete_registration", {
    p_role: role, p_full_name: `Belge RLS Test ${label}`, p_phone: "+905551110066",
    p_company_name: `Belge RLS Test Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Dilovası",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email, client: cli };
}

const MINIMAL_VALID_PDF = new Blob(
  [
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n" +
      "startxref\n0\n%%EOF",
  ],
  { type: "application/pdf" },
);

async function main() {
  const providerA = await createRealTestUser("provA", "hizmet-veren");
  const providerB = await createRealTestUser("provB", "hizmet-veren");
  const adminUser = await createRealTestUser("admin", "hizmet-alan");
  // Admin rolü kayıt formunda hiç SEÇİLEMEZ (bkz. CLAUDE.md) — test kurulumu
  // için doğrudan SQL ile atanır, bu GERÇEK kullanıcı oturumunun/RLS'in
  // kendisini taklit etmez, yalnızca test verisi hazırlar (browser-test-
  // job-photos.mjs#approveJobLocally İLE AYNI, zaten kabul görmüş desen).
  runSql(`update public.profiles set role = 'admin' where id = '${adminUser.id}';`);
  console.log(`providerA=${providerA.email} providerB=${providerB.email} admin=${adminUser.email}`);

  // --- Provider A kendi belgesini yükler (GERÇEK kendi oturumu) ---
  const documentId = crypto.randomUUID();
  const storagePath = `${providerA.id}/${documentId}.pdf`;
  const { error: uploadError } = await providerA.client.storage
    .from("provider-documents")
    .upload(storagePath, MINIMAL_VALID_PDF, { contentType: "application/pdf" });
  if (uploadError) throw new Error(`Provider A kendi klasörüne yükleyemedi (BEKLENMEDİK): ${uploadError.message}`);
  ok("Provider A, kendi klasörüne (RLS ile izinli) belge yükledi");

  const { error: rpcError } = await providerA.client.rpc("create_provider_document", {
    p_document_type: "genel",
    p_storage_path: storagePath,
    p_original_file_name: "faaliyet-belgesi.pdf",
    p_mime_type: "application/pdf",
    p_extension: "pdf",
    p_size_bytes: MINIMAL_VALID_PDF.size,
    p_service_category_id: null,
    p_storage_activity_scopes: null,
    p_imo_class_codes: null,
    p_requested_storage_risk_groups: null,
    p_requested_recycling_activities: null,
    p_requested_recycling_waste_codes: null,
  });
  if (rpcError) throw new Error(`create_provider_document (Provider A, BEKLENMEDİK): ${rpcError.message}`);
  ok("Provider A, create_provider_document RPC'siyle belge kaydını oluşturdu");

  // --- İDDİA 1: sahibi kendi belgesini görebiliyor ---
  const { data: ownRows, error: ownSelectError } = await providerA.client
    .from("provider_documents")
    .select("id, provider_id, storage_path")
    .eq("storage_path", storagePath);
  if (ownSelectError) throw new Error(`Provider A kendi belgesini SELECT edemedi (BEKLENMEDİK): ${ownSelectError.message}`);
  if (ownRows.length !== 1) fail(`İDDİA 1: Provider A kendi belgesini görebilmeli, bulunan satır: ${ownRows.length}`);
  else ok("İDDİA 1: Provider A, kendi provider_documents satırını GERÇEK oturumuyla görebiliyor");

  const { data: ownDownload, error: ownDownloadError } = await providerA.client.storage
    .from("provider-documents")
    .download(storagePath);
  if (ownDownloadError || !ownDownload) fail(`İDDİA 1: Provider A kendi Storage nesnesini indirebilmeli: ${ownDownloadError?.message}`);
  else ok("İDDİA 1: Provider A, kendi Storage nesnesini GERÇEK oturumuyla indirebiliyor");

  // --- İDDİA 2: başka bir Hizmet Veren (Provider B, KENDİ gerçek oturumu) göremez/indiremez/değiştiremez ---
  const { data: bRows, error: bSelectError } = await providerB.client
    .from("provider_documents")
    .select("id, provider_id, storage_path")
    .eq("storage_path", storagePath);
  // RLS bir hata FIRLATMAZ — yetkisiz satırları sessizce filtreler (0 satır).
  if (bSelectError) throw new Error(`Provider B'nin SELECT sorgusu beklenmedik şekilde hata verdi: ${bSelectError.message}`);
  if (bRows.length !== 0) fail(`İDDİA 2: Provider B, A'nın belgesini GÖREMEMELİ, bulunan satır: ${bRows.length}`);
  else ok("İDDİA 2: Provider B (GERÇEK kendi oturumu), A'nın provider_documents satırını RLS nedeniyle göremiyor (0 satır)");

  const { data: bDownload, error: bDownloadError } = await providerB.client.storage
    .from("provider-documents")
    .download(storagePath);
  if (!bDownloadError && bDownload) fail("İDDİA 2: Provider B, A'nın Storage nesnesini İNDİREBİLMEMELİYDİ ama indirdi");
  else ok(`İDDİA 2: Provider B (GERÇEK kendi oturumu), A'nın Storage nesnesini indiremiyor (RLS reddi: ${bDownloadError?.message ?? "boş sonuç"})`);

  const { data: bUpdateData, error: bUpdateError } = await providerB.client
    .from("provider_documents")
    .update({ current_review_status: "approved" })
    .eq("storage_path", storagePath)
    .select();
  if (bUpdateError) {
    ok(`İDDİA 2: Provider B, A'nın belgesini DOĞRUDAN güncelleyemiyor (RLS/politika reddi: ${bUpdateError.message})`);
  } else if (!bUpdateData || bUpdateData.length === 0) {
    ok("İDDİA 2: Provider B'nin doğrudan UPDATE denemesi hiçbir satırı etkilemedi (RLS satırı filtreledi)");
  } else {
    fail("İDDİA 2: Provider B, A'nın belgesini DOĞRUDAN güncelleyebildi — bu KRİTİK bir güvenlik açığı");
  }

  // --- İDDİA 3: admin (GERÇEK kendi oturumu) görebiliyor ve indirebiliyor ---
  const { data: adminRows, error: adminSelectError } = await adminUser.client
    .from("provider_documents")
    .select("id, provider_id, storage_path")
    .eq("storage_path", storagePath);
  if (adminSelectError) throw new Error(`Admin'in SELECT sorgusu beklenmedik şekilde hata verdi: ${adminSelectError.message}`);
  if (adminRows.length !== 1) fail(`İDDİA 3: Admin, A'nın belgesini GÖREBİLMELİ, bulunan satır: ${adminRows.length}`);
  else ok("İDDİA 3: Admin (GERÇEK kendi oturumu, role SQL ile atanmış), A'nın provider_documents satırını görebiliyor");

  const { data: adminDownload, error: adminDownloadError } = await adminUser.client.storage
    .from("provider-documents")
    .download(storagePath);
  if (adminDownloadError || !adminDownload) fail(`İDDİA 3: Admin, A'nın Storage nesnesini indirebilmeli: ${adminDownloadError?.message}`);
  else ok("İDDİA 3: Admin (GERÇEK kendi oturumu), A'nın Storage nesnesini indirebiliyor");

  // --- Temizlik: A kendi belgesini/nesnesini siler (kendi RLS izniyle) ---
  await providerA.client.storage.from("provider-documents").remove([storagePath]);
  await runSql(`delete from public.provider_documents where storage_path = '${storagePath}';`);
  console.log("Test belgesi ve Storage nesnesi temizlendi.");

  console.log(`\n[provider-documents-rls-test] ${passed}/${passed + (process.exitCode ? 1 : 0)} test geçti${process.exitCode ? " (BAZI TESTLER BAŞARISIZ)" : ""}.`);
}

main().catch((error) => {
  console.error("[provider-documents-rls-test] HATA:", error);
  process.exitCode = 1;
});
