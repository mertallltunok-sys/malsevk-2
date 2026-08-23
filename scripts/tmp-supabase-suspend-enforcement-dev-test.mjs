// Real Development project (trfnmpihcnriqgikglpu) test — NOT local. Uses only
// the public anon key (@supabase/supabase-js signUp/signInWithPassword) plus
// `npx supabase db query --linked` (already-authenticated CLI, Management API,
// no separate DB password) for: (a) confirming test-account emails, since this
// project requires email confirmation and there is no service_role key
// available to this script, (b) admin-role bootstrap (service_role has no REST
// access to public-schema tables on this project — documented, known gap, see
// docs/database/admin-permissions.md), (c) cleanup. Never touches production
// (pltjquhskyckrgtbvgog) — `db query --linked` only ever targets the CLI's
// currently linked project, verified separately before running this script.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const URL = "https://trfnmpihcnriqgikglpu.supabase.co";
const ANON = "sb_publishable_fRjAnKgqDtDsxR5au68D2Q_0WYDsYvX";
const PASSWORD = "TestSifre2026!Dev";

let sqlFileCounter = 0;
function sql(query) {
  const file = path.join(tmpdir(), `malsevk-0042-devtest-${process.pid}-${sqlFileCounter++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    const parsed = JSON.parse(out.slice(out.indexOf("{")));
    return parsed.rows;
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}

function client() {
  return createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
}

const stamp = Date.now();
const requesterEmail = `malsevk-test-req-${stamp}@mailinator.com`;
const providerEmail = `malsevk-test-prov-${stamp}@mailinator.com`;
const provider2Email = `malsevk-test-prov2-${stamp}@mailinator.com`;
const adminEmail = `malsevk-test-admin-${stamp}@mailinator.com`;

let requesterId, providerId, provider2Id, adminId, jobId, offerId;
const createdIds = [];

async function signUp(cli, email) {
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(email + " signUp: " + error.message);
  return data.user.id;
}

async function confirmAndSignIn(email) {
  sql(`update auth.users set email_confirmed_at = now() where email = '${email}';`);
  const cli = client();
  const { data, error } = await cli.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(email + " signIn: " + error.message);
  return cli;
}

try {
  const rc0 = client(); requesterId = await signUp(rc0, requesterEmail); createdIds.push(requesterId);
  const pc0 = client(); providerId = await signUp(pc0, providerEmail); createdIds.push(providerId);
  const pc20 = client(); provider2Id = await signUp(pc20, provider2Email); createdIds.push(provider2Id);
  const ac0 = client(); adminId = await signUp(ac0, adminEmail); createdIds.push(adminId);
  record("4 test hesabı gerçek signUp() ile oluşturuldu", true, `${requesterId}/${providerId}/${provider2Id}/${adminId}`);

  sql(`update public.profiles set role='admin', full_name='Dev Test Admin', onboarding_completed=true where id='${adminId}';`);
  record("Admin bootstrap (db query --linked, doğrudan DB)", true);

  const requesterClient = await confirmAndSignIn(requesterEmail);
  const providerClient = await confirmAndSignIn(providerEmail);
  const provider2Client = await confirmAndSignIn(provider2Email);
  const adminClient = await confirmAndSignIn(adminEmail);
  record("4 hesap da email onaylanıp signInWithPassword ile giriş yaptı", true);

  const reg = async (cli, role, name, phoneSuffix, companyType) => {
    const { error } = await cli.rpc("complete_registration", {
      p_role: role, p_full_name: name, p_phone: `+90532222${phoneSuffix}`,
      p_company_name: name + " Co", p_company_type: companyType, p_province: "Kocaeli", p_district: "İzmit",
    });
    return error;
  };
  record("complete_registration (requester)", !(await reg(requesterClient, "hizmet-alan", "Dev Test Requester", "0001", "bireysel")));
  record("complete_registration (provider)", !(await reg(providerClient, "hizmet-veren", "Dev Test Provider", "0002", "limited-sirket")));
  record("complete_registration (provider2/unauthorized 3rd party)", !(await reg(provider2Client, "hizmet-veren", "Dev Test Provider 2", "0003", "limited-sirket")));

  const photos = [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }];
  const workDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);

  // ===== A) SUSPEND / REINSTATE ENFORCEMENT =====
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "0042 dev test job", p_description: "0042 dev test job description, en az yirmi karakter uzunlugunda.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo",
      p_work_date: workDate, p_photos: photos, p_address_text: "Test adres, en az yirmi karakter.",
    });
    jobId = data?.id;
    record("A1) ACTIVE requester create_job PASSES", !error && !!jobId, error?.message);
  }
  {
    const { error } = await adminClient.rpc("suspend_user", { p_user_id: requesterId, p_reason: "0042 dev test suspend" });
    record("A2) Admin suspend_user(requester)", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "0042 dev test job 2 (should fail)", p_description: "0042 dev test job description, en az yirmi karakter uzunlugunda.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo",
      p_work_date: workDate, p_photos: photos, p_address_text: "Test adres, en az yirmi karakter.",
    });
    record("A3) SUSPENDED (aynı oturum, re-login YOK) create_job ML127 ile FAIL", !!error && error.message.includes("ML127"), error ? error.message : "beklenmedik başarı: " + JSON.stringify(data));
  }
  {
    const { data: s } = await requesterClient.auth.getSession();
    const raw = client();
    await raw.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });
    const { error } = await raw.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "0042 direct RPC replay", p_description: "0042 dev test job description, en az yirmi karakter uzunlugunda.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo",
      p_work_date: workDate, p_photos: photos, p_address_text: "Test adres, en az yirmi karakter.",
    });
    record("A4) Askıya alınmış JWT ile DOĞRUDAN RPC replay ML127 ile FAIL", !!error && error.message.includes("ML127"), error?.message);
  }
  {
    const { error } = await adminClient.rpc("reinstate_user", { p_user_id: requesterId });
    record("A5) Admin reinstate_user(requester)", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "0042 dev test job 3 (reinstated)", p_description: "0042 dev test job description, en az yirmi karakter uzunlugunda.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo",
      p_work_date: workDate, p_photos: photos, p_address_text: "Test adres, en az yirmi karakter.",
    });
    record("A6) REINSTATED (aynı oturum) create_job tekrar PASSES", !error && !!data?.id, error?.message);
  }

  // provider service auth + job moderation approval so offer flow works
  await providerClient.rpc("set_provider_service_categories", { p_category_ids: ["kapali-depolama"] });
  await provider2Client.rpc("set_provider_service_categories", { p_category_ids: ["kapali-depolama"] });
  {
    const { error } = await adminClient.rpc("authorize_provider_service", { p_provider_id: providerId, p_service_category_id: "kapali-depolama", p_reason: "0042 dev test" });
    record("Admin authorize_provider_service(provider)", !error, error?.message);
  }
  {
    const { error } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
    record("Admin approve_job_as_admin(job)", !error, error?.message);
  }

  // provider2 is NOT authorized -> should not be able to offer, and should not see the job via RLS
  {
    const { data, error } = await provider2Client.from("jobs").select("id").eq("id", jobId);
    record("B0) Yetkisiz provider2 RLS ile ilanı GÖREMİYOR (jobs select boş)", !error && Array.isArray(data) && data.length === 0, error?.message || JSON.stringify(data));
  }
  {
    const { error } = await provider2Client.rpc("create_offer", { p_job_id: jobId, p_amount: 500, p_currency: "TRY", p_description: "0042 dev test unauthorized offer, en az yirmi karakter." });
    record("B0b) Yetkisiz provider2 create_offer FAIL (visibility/authorization gate)", !!error, error?.message);
  }

  // ===== B) OFFER FLOW: create -> accept -> contact reveal timing -> 3rd party check =====
  {
    const { data, error } = await providerClient.rpc("create_offer", { p_job_id: jobId, p_amount: 1500, p_currency: "TRY", p_description: "0042 dev test offer description, en az yirmi karakter." });
    offerId = data?.id;
    record("B1) Yetkili provider create_offer PASSES", !error && !!offerId, error?.message);
  }
  {
    const { data, error } = await provider2Client.rpc("get_offer_provider_display", { p_offer_id: offerId });
    // provider2 is not a party to this offer -- function should not reveal true identity regardless
    record("B2) 3. taraf get_offer_provider_display çağrılabiliyor (RLS engellemiyor okumayı ama identity reveal olmamalı)", !error, error?.message);
  }
  {
    const { data, error } = await adminClient.rpc("get_job_address", { p_job_id: jobId });
    record("B3 sanity) Admin get_job_address her zaman görebilir", !error, error?.message);
  }
  {
    const { data: before, error: e1 } = await provider2Client.rpc("can_view_offer_contact", { p_offer_id: offerId });
    record("B4) Yetkisiz 3. taraf can_view_offer_contact = false (kabulden ÖNCE)", !e1 && before === false, e1?.message || `got ${before}`);
  }
  {
    const { error } = await requesterClient.rpc("accept_offer", { p_offer_id: offerId });
    record("B5) Requester accept_offer PASSES", !error, error?.message);
  }
  {
    const { data: providerCanSee, error: e1 } = await providerClient.rpc("can_view_offer_contact", { p_offer_id: offerId });
    const { data: requesterCanSee, error: e2 } = await requesterClient.rpc("can_view_offer_contact", { p_offer_id: offerId });
    const { data: outsiderCanSee, error: e3 } = await provider2Client.rpc("can_view_offer_contact", { p_offer_id: offerId });
    record("B6) Kabul SONRASI: taraflar (provider+requester) contact görebiliyor, 3. taraf GÖREMİYOR",
      !e1 && !e2 && !e3 && providerCanSee === true && requesterCanSee === true && outsiderCanSee === false,
      `provider=${providerCanSee} requester=${requesterCanSee} outsider=${outsiderCanSee}`);
  }
  // duplicate accept (idempotency)
  {
    const { error } = await requesterClient.rpc("accept_offer", { p_offer_id: offerId });
    record("K1) Aynı teklifi İKİNCİ kez accept_offer -> temiz FAIL (duplicate/state bozulmuyor)", !!error && /MLK68|already/i.test(error.message), error?.message);
  }
  // duplicate offer from same provider on same job (unique constraint)
  {
    const { error } = await providerClient.rpc("create_offer", { p_job_id: jobId, p_amount: 1600, p_currency: "TRY", p_description: "0042 dev test duplicate offer, en az yirmi karakter." });
    record("K2) Aynı provider aynı job'a İKİNCİ teklif -> temiz FAIL (offers_one_blocking_per_job_provider)", !!error, error?.message);
  }

  // ===== C) OPERATION STATE CHAIN — role checks + invalid transitions =====
  {
    const { error } = await providerClient.rpc("request_completion", { p_offer_id: offerId });
    record("C0) start_work atlanmış teklifte request_completion -> FAIL (geçersiz atlama engellendi)", !!error, error?.message);
  }
  {
    const { error } = await requesterClient.rpc("start_work", { p_offer_id: offerId });
    record("C1) Requester (yanlış rol) start_work çağırıyor -> FAIL", !!error, error?.message);
  }
  {
    const { error } = await providerClient.rpc("start_work", { p_offer_id: offerId });
    record("C2) Provider (doğru rol) start_work PASSES", !error, error?.message);
  }
  {
    const { error } = await providerClient.rpc("request_completion", { p_offer_id: offerId });
    record("C3) Provider request_completion PASSES", !error, error?.message);
  }
  {
    const { error } = await providerClient.rpc("confirm_completion", { p_offer_id: offerId });
    record("C4) Tamamlamayı İSTEYEN (provider) kendi isteğini confirm edemiyor -> FAIL", !!error, error?.message);
  }
  {
    const { error } = await requesterClient.rpc("confirm_completion", { p_offer_id: offerId });
    record("C5) Requester confirm_completion PASSES (doğru taraf)", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.from("offers").select("status").eq("id", offerId).single();
    record("C6) offer.status = 'completed' (gerçek DB satırı doğrulandı)", !error && data?.status === "completed", error?.message || data?.status);
  }
  {
    const { error } = await requesterClient.rpc("submit_rating", { p_offer_id: offerId, p_stars: 5, p_comment: "0042 dev test rating" });
    record("C7) Tamamlanan teklif için submit_rating PASSES", !error, error?.message);
  }

  // ===== D) MULTI-SERVICE OPERATION =====
  {
    const services = [
      { category_id: "kapali-depolama", title: "0042 multi-service A", description: "0042 dev test multi-service A description, yirmi karakter.", district: "İzmit", work_location_type: "Dev Test Depo A", location_mode: "catalog", address_text: "", work_date: workDate, client_id: crypto.randomUUID() },
      { category_id: "acik-saha-depolama", title: "0042 multi-service B", description: "0042 dev test multi-service B description, yirmi karakter.", district: "Gebze", work_location_type: "Dev Test Depo B", location_mode: "catalog", address_text: "", work_date: workDate, client_id: crypto.randomUUID() },
    ];
    const { data, error } = await requesterClient.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli", p_operation_details: "0042 dev test operation details", p_services: services, p_photos_by_service_index: { 0: photos, 1: photos },
    });
    const jobIds = data?.job_ids || data?.jobIds;
    record("D1) create_operation_with_jobs (2 servis) PASSES, iki ayrı job_id döner", !error && Array.isArray(jobIds) && jobIds.length === 2 && jobIds[0] !== jobIds[1], error ? error.message : JSON.stringify(data));
    if (Array.isArray(jobIds) && jobIds.length === 2) {
      const { data: rows } = await adminClient.from("jobs").select("id, operation_id, moderation_status").in("id", jobIds);
      const sameOp = rows && rows[0]?.operation_id && rows[0].operation_id === rows[1]?.operation_id;
      record("D2) İki job da AYNI operation_id'yi paylaşıyor", !!sameOp, JSON.stringify(rows));
      const { error: appErr } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobIds[0] });
      record("D3) Admin bir servisi (job) BAĞIMSIZ olarak onaylayabiliyor, diğeri pending kalıyor", !appErr);
      const { data: rows2 } = await adminClient.from("jobs").select("id, moderation_status").in("id", jobIds);
      const oneApproved = rows2?.find((r) => r.id === jobIds[0])?.moderation_status === "approved";
      const otherPending = rows2?.find((r) => r.id === jobIds[1])?.moderation_status === "pending_review";
      record("D4) Onaylanan servis approved, diğeri hâlâ pending_review (bağımsız moderasyon doğrulandı)", oneApproved && otherPending, JSON.stringify(rows2));
    }
  }

} catch (e) {
  record("BEKLENMEYEN İSTİSNA", false, e?.message || String(e));
} finally {
  for (const id of createdIds) {
    try { sql(`delete from auth.users where id = '${id}';`); } catch (e) { record(`Cleanup delete auth.users ${id}`, false, e.message); }
  }
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
