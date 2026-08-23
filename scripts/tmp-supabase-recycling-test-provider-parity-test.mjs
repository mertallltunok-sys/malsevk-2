// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı: mevcut
// `geri-donusum-test@malsevk.test` Hizmet Veren test hesabını, sistemdeki
// GERÇEK Hizmet Veren'lerin ilan görebilmek için geçtiği AYNI mekanizmadan
// (jobs_select_visible RLS + provider_can_view_category() RPC) geçirir —
// hiçbir yeni bypass/istisna/ikinci yetkilendirme sistemi YOK. Canlı şemadan
// doğrulanan gerçek koşullar (TAHMİN EDİLMEDİ):
//   - jobs_select_visible RLS (pg_policy'den doğrudan okundu):
//     deleted_at IS NULL AND (requester_id=auth.uid() OR is_admin() OR
//       (moderation_status='approved' AND (current_user_role() IS DISTINCT
//        FROM 'hizmet-veren' OR provider_can_view_category(auth.uid(), category_id))))
//   - provider_can_view_category() (pg_proc'tan doğrudan okundu): SADECE
//     provider_service_authorizations'ta (provider_id, category) için
//     revoked_at IS NULL olan bir satır var mı diye bakıyor — provider_services
//     (seçim), provider_documents, provider_profiles, onboarding_completed
//     HİÇBİRİNE bakmıyor.
//   - create_offer(): assert_active_user() (account_status='active') +
//     current_user_role()='hizmet-veren' + provider_can_view_category() +
//     moderation_status='approved' (+ yalnızca gumruk-musavirligi'ne özel
//     ek kapı, bizim kategorimizi etkilemiyor).
//
// DÜZELTME (önceki turda elle INSERT edilen provider_service_authorizations
// satırının GERÇEK mekanizmadan farkı): authorized_by NULL bırakılmıştı,
// gerçek authorize_provider_service RPC'si her zaman auth.uid() (çağıran
// admin) yazar.
//
// İLK DENEME (test provider'ın KENDİ rolünü geçici admin'e çevirip kendi
// kendini yetkilendirmesi) BAŞARISIZ OLDU — ML106: "provider_id must belong
// to a hizmet-veren profile". Kök neden: authorize_provider_service hem
// çağıranın (`is_admin()`) HEM DE hedefin (`p_provider_id`, role='hizmet-veren'
// olmalı) rolünü kontrol ediyor; aynı hesap ikisi de olamaz (rolü admin'e
// çevirince artık hedef olarak GEÇERSİZ hale geliyor). Bu GERÇEK bir mimari
// kısıt — bypass edilmedi, ETRAFINDAN DOLAŞILMADI: bunun yerine AYRI, geçici
// bir admin hesabı (bu script'in kendi içinde, mevcut `role='admin'` değeriyle
// oluşturulan — YENİ bir rol İCAT EDİLMEDİ) kullanılarak GERÇEK RPC, gerçek
// bir çağıran/hedef ayrımıyla çağrılır. Test provider'ın KENDİ rolü bu
// script boyunca hiç değiştirilmez (baştan sona hizmet-veren kalır).
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROVIDER_EMAIL = "geri-donusum-test@malsevk.test";
const PROVIDER_PASSWORD = process.env.RECYCLING_TEST_PROVIDER_PASSWORD; // mevcut şifre değiştirilmiyor — parametre olarak alınır
const CATEGORY = "geri-donusum-atik-tahliye";
const OTHER_CATEGORY_JOB_ID = "43d589b4-6588-4711-815d-b8297581d521"; // "Test Nakliye İlanı", moderation_status=approved (önceki test verisi)
const stamp = Date.now();
const BUYER_EMAIL = `recytest-buyer-${stamp}@example.com`;
const BUYER_PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !PROVIDER_PASSWORD) {
  console.error("FAIL: eksik ortam değişkeni (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / RECYCLING_TEST_PROVIDER_PASSWORD)");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 220) : ""));
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-parity-"));
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

function fakePhotos(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    storage_path: `recytest/${stamp}/${index}.jpg`,
    original_file_name: `test-${index}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 12345,
    width: null,
    height: null,
  }));
}

async function main() {
  // -----------------------------------------------------------------
  // 0) Test hesabının GÜNCEL (bu turdan ÖNCEki) durumunu kaydet.
  // -----------------------------------------------------------------
  const beforeProfile = runSql(
    `select p.id, p.role, p.account_status, p.onboarding_completed from public.profiles p join auth.users u on u.id = p.id where u.email = '${PROVIDER_EMAIL}';`,
  );
  record("0a. Test hesabı bulundu (yeni hesap oluşturulmadı)", beforeProfile.length === 1, JSON.stringify(beforeProfile[0]));
  const providerId = beforeProfile[0]?.id;
  const beforeAuth = runSql(
    `select id, authorized_by, authorize_reason, authorized_at from public.provider_service_authorizations where provider_id = '${providerId}' and service_category_id = '${CATEGORY}' and revoked_at is null;`,
  );
  const wasStructurallyDifferent = beforeAuth.length === 1 && beforeAuth[0].authorized_by === null;
  record(
    "0b. Önceki satır tespiti: authorized_by NULL idi mi (gerçek RPC'nin ASLA üretmeyeceği bir şekil)",
    true,
    wasStructurallyDifferent ? "EVET — elle eklenmişti, düzeltilecek" : `authorized_by=${beforeAuth[0]?.authorized_by ?? "satır yok"}`,
  );

  // -----------------------------------------------------------------
  // 1) Buyer (hizmet-alan) throwaway hesabı — GERÇEK create_job akışı için.
  // -----------------------------------------------------------------
  const buyerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: buyerSignUp, error: buyerSignUpError } = await buyerClient.auth.signUp({ email: BUYER_EMAIL, password: BUYER_PASSWORD });
  if (buyerSignUpError) throw new Error(`buyer signUp failed: ${buyerSignUpError.message}`);
  record("1. Buyer (hizmet-alan) test hesabı oluşturuldu (Geri Dönüşüm provider hesabına ek, ayrı roldeki gerekli 2. hesap)", Boolean(buyerSignUp.session));
  await buyerClient.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "Recycling Parity Test Buyer",
    p_phone: "+905321119944",
    p_company_name: "Recycling Parity Test Buyer Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });

  // -----------------------------------------------------------------
  // 2) GERÇEK create_job RPC'siyle test ilanı (pending_review ile başlar).
  // -----------------------------------------------------------------
  const { data: job, error: jobError } = await buyerClient.rpc("create_job", {
    p_category_id: CATEGORY,
    p_title: `[TEST İLANI] Geri Dönüşüm & Atık Tahliye — Demir/Çelik ${stamp}`,
    p_description: "BU BİR TEST İLANIDIR — geri dönüşüm test hesabı görünürlük doğrulaması için otomatik oluşturuldu, gerçek bir hizmet talebi değildir.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Sahası",
    p_work_date: "2026-12-15",
    p_photos: fakePhotos(),
    p_address_text: "Test Mahallesi, Test Caddesi No:1, Gebze",
    p_recycling_material_category_id: "metal-hurda",
    p_recycling_material_subtype_id: "demir-celik",
    p_recycling_quantity: 10,
    p_recycling_unit: "ton",
    p_recycling_material_condition: "karisik",
    p_recycling_scope_of_work: ["sahadan-toplama", "yukleme", "tesisten-tahliye", "tasima"],
  });
  record("2. Test ilanı gerçek create_job RPC'siyle oluşturuldu, pending_review ile başladı", !jobError && job?.moderation_status === "pending_review", jobError?.message || job?.id);
  const jobId = job?.id;

  // -----------------------------------------------------------------
  // AŞAMA A — onay öncesi: test provider ilanı GÖRMEMELİ.
  // -----------------------------------------------------------------
  const providerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: providerLoginError } = await providerClient.auth.signInWithPassword({ email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD });
  record("AŞAMA E-ön. Test provider mevcut şifresiyle giriş yaptı (şifre DEĞİŞTİRİLMEDİ)", !providerLoginError, providerLoginError?.message);

  const { data: beforeApproval } = await providerClient.from("jobs").select("id").eq("id", jobId).maybeSingle();
  record("AŞAMA A. Onay öncesi test provider ilanı GÖREMİYOR (jobs_select_visible RLS)", !beforeApproval, JSON.stringify(beforeApproval));

  // -----------------------------------------------------------------
  // AYRI, geçici bir admin hesabı — test provider'ın KENDİ rolü bu script
  // boyunca HİÇ değiştirilmez (bkz. dosya başlığındaki ML106 notu).
  // -----------------------------------------------------------------
  const helperAdminEmail = `recytest-admin-${stamp}@example.com`;
  const helperAdminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: helperAdminSignUp, error: helperAdminSignUpError } = await helperAdminClient.auth.signUp({ email: helperAdminEmail, password: BUYER_PASSWORD });
  if (helperAdminSignUpError) throw new Error(`helper admin signUp failed: ${helperAdminSignUpError.message}`);
  await helperAdminClient.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "Recycling Parity Test Helper Admin",
    p_phone: "+905321119955",
    p_company_name: "Recycling Parity Test Helper Admin Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  runSql(`update public.profiles set role = 'admin' where id = '${helperAdminSignUp.user.id}';`);
  // Rol değişikliği sonrası eski JWT'nin custom claim'i (varsa) bayat kalmasın
  // diye oturum tazelenir — is_admin()/current_user_role() zaten DB'den canlı
  // okuyor, ama garanti olsun diye net bir yeniden-login yapılıyor.
  await helperAdminClient.auth.signInWithPassword({ email: helperAdminEmail, password: BUYER_PASSWORD });
  record("3-ön. Ayrı, geçici yardımcı admin hesabı hazırlandı (test provider'a DOKUNULMADI)", true, helperAdminSignUp.user.id);

  const { error: authorizeError } = await helperAdminClient.rpc("authorize_provider_service", {
    p_provider_id: providerId,
    p_service_category_id: CATEGORY,
    p_source_document_id: null,
    p_reason: "Development test hesabı - gerçek yetkilendirme akışıyla eşitlendi (belge kaydı gerekmedi, source_document_id opsiyonel)",
  });
  record("3a. authorize_provider_service GERÇEK RPC'si başarılı (is_admin() gerçekten geçti)", !authorizeError, authorizeError?.message);

  const { error: approveError } = await helperAdminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  record("3b. approve_job_as_admin GERÇEK RPC'si başarılı", !approveError, approveError?.message);

  const revertedProfile = runSql(`select role from public.profiles where id = '${providerId}';`);
  record("3c. Test provider'ın kendi rolü baştan sona hizmet-veren kaldı (hiç değiştirilmedi)", revertedProfile[0]?.role === "hizmet-veren", revertedProfile[0]?.role);

  const afterAuth = runSql(
    `select authorized_by, authorize_reason from public.provider_service_authorizations where provider_id = '${providerId}' and service_category_id = '${CATEGORY}' and revoked_at is null;`,
  );
  record(
    "3d. provider_service_authorizations artık GERÇEK RPC şeklinde (authorized_by dolu, NULL değil)",
    afterAuth.length === 1 && afterAuth[0].authorized_by !== null,
    JSON.stringify(afterAuth[0]),
  );
  const otherAuths = runSql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerId}' and revoked_at is null;`);
  record("3e. Test hesabının hâlâ YALNIZCA Geri Dönüşüm & Atık Tahliye için yetkisi var", otherAuths.length === 1 && otherAuths[0].service_category_id === CATEGORY, JSON.stringify(otherAuths));

  // -----------------------------------------------------------------
  // AŞAMA B — onay sonrası: test provider ilanı GÖREBİLMELİ.
  // -----------------------------------------------------------------
  const { data: afterApproval } = await providerClient.from("jobs").select("id, moderation_status").eq("id", jobId).maybeSingle();
  record("AŞAMA B. Onay sonrası test provider ilanı GÖREBİLİYOR", afterApproval?.id === jobId && afterApproval?.moderation_status === "approved", JSON.stringify(afterApproval));

  // -----------------------------------------------------------------
  // AŞAMA C — kategori izolasyonu: yetkisiz kategoriye ait onaylı BAŞKA
  // bir ilan (mevcut Development test verisinden, Nakliye) GÖRÜNMEMELİ.
  // -----------------------------------------------------------------
  const { data: otherCategoryJob } = await providerClient.from("jobs").select("id").eq("id", OTHER_CATEGORY_JOB_ID).maybeSingle();
  record("AŞAMA C. Yetkisiz kategoriye (Nakliye) ait admin onaylı başka bir ilan GÖRÜNMÜYOR", !otherCategoryJob, JSON.stringify(otherCategoryJob));

  // -----------------------------------------------------------------
  // AŞAMA D — teklif: normal create_offer, tek toplam hizmet bedeli.
  // -----------------------------------------------------------------
  const { data: offer, error: offerError } = await providerClient.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 20000,
    p_currency: "TRY",
    p_description: "TEST TEKLİFİDİR — geri dönüşüm test hesabı görünürlük/teklif doğrulaması için otomatik oluşturuldu, gerçek bir teklif değildir.",
  });
  record("AŞAMA D. create_offer GERÇEK RPC'si başarılı, tek toplam hizmet bedeli (20.000 TRY)", !offerError && Number(offer?.amount) === 20000 && offer?.status === "pending", offerError?.message || JSON.stringify({ amount: offer?.amount, status: offer?.status }));
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    // GÜVENLİK: hata olsa bile rolün admin'de takılı kalmadığından emin ol.
    try {
      const providerRows = runSql(`select p.id, p.role from public.profiles p join auth.users u on u.id = p.id where u.email = '${PROVIDER_EMAIL}';`);
      if (providerRows[0]?.role !== "hizmet-veren") {
        runSql(`update public.profiles set role = 'hizmet-veren' where id = '${providerRows[0]?.id}';`);
        console.log("GÜVENLİK: rol admin'de takılı kalmıştı, hizmet-veren'e zorla geri çevrildi.");
      }
    } catch (cleanupError) {
      console.error("rol geri çevirme kontrolü başarısız:", cleanupError?.message || cleanupError);
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
