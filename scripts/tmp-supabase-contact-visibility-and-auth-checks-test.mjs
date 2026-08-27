// node scripts/tmp-supabase-contact-visibility-and-auth-checks-test.mjs
//
// GÖREV 6 regresyon kontrolleri (Resend teklif e-postaları görevi):
//   A) İletişim bilgileri YALNIZCA kabul sonrasında görünür mü
//      (get_offer_contact / can_view_offer_contact, 0078/0012) — bu
//      oturumda DOKUNULMAYAN bir mekanizma, gerçek kanıtla yeniden doğrulanır.
//   B) Yetkisiz kategori: kategoriye yetkilendirilmemiş bir provider
//      create_offer çağıramaz mı (MLK60).
//   C) Başkasının ilanı: ilanın sahibi OLMAYAN bir hizmet-alan accept_offer
//      çağıramaz mı (MLK56).
//   D) Askıya alınmış hesap: account_status='suspended' bir kullanıcı hiçbir
//      mutation RPC'sini çalıştıramaz mı (ML127, assert_active_user — bu
//      oturumda YENİ eklenen claim_offer_email_notification/
//      mark_offer_email_delivery da assert_active_user() çağırdığı için
//      DOĞRUDAN ilgili).
// Playwright kullanılmaz (yalnızca RPC/SQL) — hızlı, self-contained.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";
const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` -- ${extra}` : "")); console.log(`FAIL  ${name}${extra ? " -- " + extra : ""}`); }
}

async function runSql(sql) {
  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const sqlPath = path.join(tmpdir(), `contact-auth-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(sqlPath, sql);
  const out = execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" }).toString();
  return JSON.parse(out).rows ?? [];
}

async function makeRealAccount(label, role) {
  const email = `malsevk-authcheck-${label}-${stamp}@gmail.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  createdUserIds.push(created.data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  const reg = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Test ${label}`, p_phone: "+905551239900",
    p_company_name: `Test ${label} Firma`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (reg.error) throw new Error(`${label} complete_registration: ${reg.error.message}`);
  return { email, id: created.data.user.id, client };
}

let jobId = null;

async function main() {
  console.log("=== Kurulum: requester + authorized provider + unauthorized provider + ilgisiz requester + suspend edilecek hesap ===");
  const requester = await makeRealAccount("req", "hizmet-alan");
  const authorizedProvider = await makeRealAccount("authprov", "hizmet-veren");
  const unauthorizedProvider = await makeRealAccount("unauthprov", "hizmet-veren");
  const otherRequester = await makeRealAccount("otherreq", "hizmet-alan");
  const toSuspend = await makeRealAccount("suspend", "hizmet-veren");
  check("setup: 5 gerçek hesap oluşturuldu", createdUserIds.length === 5);

  // Yalnızca authorizedProvider "forklift" için yetkilendirilir — unauthorizedProvider BİLEREK yetkilendirilmez.
  await runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorize_reason) values ('${authorizedProvider.id}', 'forklift', 'regresyon testi');`);

  console.log("\n=== İlan oluştur (requester, doğrudan create_job RPC'siyle -- gerçek uygulama akışı zaten offer-lifecycle testinde ayrıca doğrulandı) ===");
  const { data: jobRow, error: jobError } = await requester.client.rpc("create_job", {
    p_category_id: "forklift",
    p_title: `Yetki Regresyon Testi ${stamp.toString(36)}`,
    p_description: "Kontrol testi için oluşturulan gerçek ilan, en az yirmi karakter açıklama.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Sahası",
    p_work_date: "2026-12-15",
    p_photos: [
      { storage_path: `${requester.id}/placeholder/regresyon-test.jpg`, original_file_name: "regresyon-test.jpg", mime_type: "image/jpeg", size_bytes: 1024 },
    ],
    p_location_mode: "custom",
    p_address_text: "Test açık adresi, en az on karakter.",
  }).single();
  if (jobError) throw new Error(`create_job: ${jobError.message}`);
  jobId = jobRow.id;
  await runSql(`update public.jobs set moderation_status = 'approved' where id = '${jobId}';`);
  check("setup: ilan oluşturuldu ve onaylandı", !!jobId, jobId);

  console.log("\n=== B) Yetkisiz kategori: yetkilendirilmemiş provider create_offer çağıramaz mı ===");
  const { error: unauthorizedOfferError } = await unauthorizedProvider.client.rpc("create_offer", {
    p_job_id: jobId, p_amount: 5000, p_currency: "TRY", p_description: "Yetkisiz teklif denemesi, en az yirmi karakter.",
  });
  check("B1. Yetkisiz kategori provider'ı reddedildi (MLK60)", !!unauthorizedOfferError && String(unauthorizedOfferError.message).includes("MLK60"), unauthorizedOfferError?.message);

  console.log("\n=== Yetkili provider gerçek teklif veriyor (iletişim/kabul testleri için önkoşul) ===");
  const { data: offerRow, error: offerError } = await authorizedProvider.client.rpc("create_offer", {
    p_job_id: jobId, p_amount: 6000, p_currency: "TRY", p_description: "Yetkili gerçek teklif, en az yirmi karakter açıklama.",
  }).single();
  if (offerError) throw new Error(`create_offer (authorized): ${offerError.message}`);
  const offerId = offerRow.id;
  check("setup: yetkili provider gerçek teklif verdi", !!offerId, offerId);

  console.log("\n=== A) Kabul ÖNCESİ: get_offer_contact HİÇBİR satır döndürmemeli ===");
  const { data: contactBefore, error: contactBeforeError } = await requester.client.rpc("get_offer_contact", { p_offer_id: offerId });
  check("A1. Kabul öncesi get_offer_contact boş döndü (iletişim gizli)", !contactBeforeError && Array.isArray(contactBefore) && contactBefore.length === 0, JSON.stringify({ contactBefore, contactBeforeError }));

  console.log("\n=== C) Başkasının ilanı: ilgisiz bir hizmet-alan accept_offer çağıramaz mı ===");
  const { error: wrongOwnerAcceptError } = await otherRequester.client.rpc("accept_offer", { p_offer_id: offerId });
  check("C1. İlan sahibi olmayan kullanıcı reddedildi (MLK56)", !!wrongOwnerAcceptError && String(wrongOwnerAcceptError.message).includes("MLK56"), wrongOwnerAcceptError?.message);

  console.log("\n=== Gerçek ilan sahibi teklifi kabul ediyor ===");
  const { error: acceptError } = await requester.client.rpc("accept_offer", { p_offer_id: offerId });
  if (acceptError) throw new Error(`accept_offer: ${acceptError.message}`);
  check("setup: teklif gerçekten kabul edildi", true);

  console.log("\n=== A) Kabul SONRASI: get_offer_contact GERÇEK iletişim bilgisini döndürmeli ===");
  const { data: contactAfter, error: contactAfterError } = await requester.client.rpc("get_offer_contact", { p_offer_id: offerId });
  const afterRow = Array.isArray(contactAfter) ? contactAfter[0] : contactAfter;
  check("A2. Kabul sonrası get_offer_contact GERÇEK provider e-postasını döndürdü", !contactAfterError && !!afterRow?.provider_email, JSON.stringify({ afterRow, contactAfterError }));
  check("A3. Kabul sonrası get_offer_contact GERÇEK requester e-postasını da döndürdü", !!afterRow?.requester_email);

  console.log("\n=== D) Askıya alınmış hesap: hiçbir mutation RPC'sini çalıştıramaz mı ===");
  await runSql(`update public.profiles set account_status = 'suspended' where id = '${toSuspend.id}';`);
  // toSuspend zaten hizmet-veren, forklift'e yetkili değil ama assert_active_user() KATEGORİ
  // kontrolünden ÖNCE çalışır (bkz. create_offer RPC gövdesi) -- bu yüzden ML127 (askıya
  // alınmış), MLK60 (yetkisiz kategori) DEĞİL, ilk hata olarak beklenir.
  const { error: suspendedError } = await toSuspend.client.rpc("create_offer", {
    p_job_id: jobId, p_amount: 4000, p_currency: "TRY", p_description: "Askıya alınmış hesap denemesi, en az yirmi karakter.",
  });
  check("D1. Askıya alınmış hesap reddedildi (ML127)", !!suspendedError && String(suspendedError.message).includes("ML127"), suspendedError?.message);

  console.log("\n=== D2) Askıya alınmış hesap, YENİ e-posta RPC'lerini de çalıştıramaz mı (bu oturumun kendi assert_active_user() bağımlılığı) ===");
  const { error: suspendedClaimError } = await toSuspend.client.rpc("claim_offer_email_notification", { p_offer_id: offerId, p_event: "new_offer" });
  check("D2. Askıya alınmış hesap claim_offer_email_notification'ı da çalıştıramadı (ML127)", !!suspendedClaimError && String(suspendedClaimError.message).includes("ML127"), suspendedClaimError?.message);
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      await runSql(
        `delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList}) or offer_id in (select id from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList})));` +
          `delete from public.ratings where provider_id in (${idList}) or rater_id in (${idList});` +
          `delete from public.provider_service_authorizations where provider_id in (${idList});` +
          `delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.offer_status_history where offer_id in (select id from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList})));` +
          `delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.offers where provider_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));` +
          `delete from public.jobs where requester_id in (${idList});`,
      );
    } catch (e) {
      console.error("SQL cleanup failed:", e.message);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch((e) => console.error(`deleteUser(${id}) failed:`, e.message));
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
    console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) {
      console.log("Başarısız testler:");
      for (const f of failures) console.log(` - ${f}`);
      process.exitCode = 1;
    }
  });
