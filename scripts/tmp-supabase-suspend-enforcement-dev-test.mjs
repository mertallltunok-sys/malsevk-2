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
//
// "Son Açıkları Kapat" görevi GÖREV 3 güncellemesi:
//  - İşletme test hesaplarına (provider/provider2) geçerli, benzersiz 16
//    haneli MERSİS numaraları verildi (migration 0083 — bireysel DIŞINDAKİ
//    company_type'larda artık ZORUNLU, bkz. ML176). Bu, önceki koşuda
//    complete_registration(provider/provider2)'ın FAIL olmasının ve buna
//    bağlı KASKAD (create_offer/accept_offer/start_work/... "could not find
//    the function ... without parameters") hatalarının TEK kök nedeniydi —
//    offerId/jobId hiç set olmadığı için sonraki .rpc(name, {p_offer_id:
//    undefined}) çağrıları JSON.stringify ile parametreyi tamamen düşürüyordu.
//  - create_job/create_offer/authorize_provider_service'in KENDİ RPC
//    imzaları (canlı DB'den pg_proc ile doğrulandı) DEĞİŞMEMİŞ — eski
//    "could not find the function" hataları bir imza uyumsuzluğu DEĞİL, tam
//    olarak yukarıdaki kaskaddı.
//  - Askıya alınmış kullanıcının YALNIZCA ilan oluşturmasının değil; ilan
//    DÜZENLEMESİNİN, teklif VERMESİNİN, teklif İŞLEMLERİNİN (kabul/işe
//    başlama/tamamlama talebi/tamamlama onayı), PROFİL güncellemesinin ve
//    PUANLAMANIN da reddedildiği artık ayrı ayrı test ediliyor — her biri
//    "askıdayken FAIL -> reinstate -> aktifken PASS" desenini izliyor, aynı
//    offer/job üzerinde ZATEN var olan A-D akışını BOZMADAN, ilgili adımın
//    hemen ÖNÜNE eklendi.
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

/** Askıya alınmış bir kullanıcı için "beklenen FAIL" kaydı — ML127 dışında BAŞKA bir kod ile reddedilmiş olması bile (askıdayken hiçbir yazma işlemi geçmemeli) kabul edilir, ama ML127 GÖRÜLMESİ tercih edilen/beklenen sonuçtur. */
function recordSuspendedRejected(name, error, unexpectedData) {
  record(name, Boolean(error), error ? error.message : `beklenmedik başarı: ${JSON.stringify(unexpectedData)}`);
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

function suspend(userId) {
  sql(`update public.profiles set account_status = 'suspended' where id = '${userId}';`);
}
function reinstate(userId) {
  sql(`update public.profiles set account_status = 'active' where id = '${userId}';`);
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

  // MERSİS / İşletme Tekilliği (migration 0083) — bireysel DIŞINDAKİ company_type'larda
  // artık ZORUNLU. provider/provider2 için GEÇERLİ (16 hane) ve BENZERSİZ numaralar.
  const PROVIDER_MERSIS = `9${stamp}`.slice(0, 16).padEnd(16, "1");
  const PROVIDER2_MERSIS = `8${stamp}`.slice(0, 16).padEnd(16, "2");

  const reg = async (cli, role, name, phoneSuffix, companyType, mersisNo) => {
    const { error } = await cli.rpc("complete_registration", {
      p_role: role, p_full_name: name, p_phone: `+90532222${phoneSuffix}`,
      p_company_name: name + " Co", p_company_type: companyType, p_province: "Kocaeli", p_district: "İzmit",
      p_mersis_no: mersisNo ?? null,
    });
    return error;
  };
  record("complete_registration (requester, bireysel, MERSİS'siz)", !(await reg(requesterClient, "hizmet-alan", "Dev Test Requester", "0001", "bireysel")));
  record("complete_registration (provider, limited-sirket + geçerli MERSİS)", !(await reg(providerClient, "hizmet-veren", "Dev Test Provider", "0002", "limited-sirket", PROVIDER_MERSIS)));
  record("complete_registration (provider2/unauthorized 3rd party, limited-sirket + geçerli MERSİS)", !(await reg(provider2Client, "hizmet-veren", "Dev Test Provider 2", "0003", "limited-sirket", PROVIDER2_MERSIS)));

  const photos = [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }];
  const workDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);

  function createJobPayload(titleSuffix) {
    return {
      p_category_id: "kapali-depolama", p_title: `0042 dev test job ${titleSuffix}`, p_description: "0042 dev test job description, en az yirmi karakter uzunlugunda.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo",
      p_work_date: workDate, p_photos: photos, p_address_text: "Test adres, en az yirmi karakter.",
    };
  }

  // ===== A) SUSPEND / REINSTATE ENFORCEMENT — create_job =====
  {
    const { data, error } = await requesterClient.rpc("create_job", createJobPayload("(A1)"));
    jobId = data?.id;
    record("A1) ACTIVE requester create_job PASSES", !error && !!jobId, error?.message);
  }
  {
    const { error } = await adminClient.rpc("suspend_user", { p_user_id: requesterId, p_reason: "0042 dev test suspend" });
    record("A2) Admin suspend_user(requester)", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.rpc("create_job", createJobPayload("(A3, should fail)"));
    record("A3) SUSPENDED (aynı oturum, re-login YOK) create_job ML127 ile FAIL", !!error && error.message.includes("ML127"), error ? error.message : "beklenmedik başarı: " + JSON.stringify(data));
  }
  {
    const { data: s } = await requesterClient.auth.getSession();
    const raw = client();
    await raw.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });
    const { error } = await raw.rpc("create_job", createJobPayload("(A4, direct replay)"));
    record("A4) Askıya alınmış JWT ile DOĞRUDAN RPC replay ML127 ile FAIL", !!error && error.message.includes("ML127"), error?.message);
  }
  // YENİ — askıdayken ilan DÜZENLEME de reddedilmeli (A1'de oluşturulan pending_review job üzerinde).
  {
    const { error } = await requesterClient.rpc("update_job_as_requester", {
      p_job_id: jobId, p_title: "0042 SUSPENDED EDIT DENEMESI", p_description: "Askidayken duzenleme denemesi, yeterli uzunlukta aciklama metni.",
      p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo", p_address_text: "Test adres, en az yirmi karakter.",
      p_work_date: workDate, p_work_end_date: workDate, p_product_quantity: null, p_product_tonnage: null, p_product_type: null,
      p_customs_product_type: null, p_delivery_facility_name: null, p_delivery_address_text: null, p_operation_details: "",
      p_neighborhood: null, p_location_url: null, p_directions_note: null, p_delivery_province: null, p_delivery_district: null,
      p_recycling_material_category_id: null, p_recycling_material_subtype_id: null, p_recycling_quantity: null, p_recycling_unit: null,
      p_recycling_material_condition: null, p_recycling_material_condition_note: null, p_recycling_scope_of_work: null,
      p_customs_transaction_type: null, p_customs_requested_services: null, p_storage_product_type: null, p_storage_product_quantity: null,
      p_storage_product_unit: null, p_storage_product_tonnage: null, p_storage_container_groups: null, p_product_tonnage_unit: null,
      p_nakliye_load_preparation_type: null, p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: null,
      p_nakliye_loading_method_custom_text: null, p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null,
      p_nakliye_cargo_groups: null, p_storage_hazardous: null, p_storage_risk_groups: null, p_recycling_requested_operation: null,
      p_recycling_waste_code: null, p_recycling_waste_code_unknown: null, p_recycling_hazard_properties: null,
    });
    recordSuspendedRejected("A3b) SUSPENDED requester ilan DÜZENLEYEMEZ (ML127)", error, null);
  }
  {
    const { error } = await adminClient.rpc("reinstate_user", { p_user_id: requesterId });
    record("A5) Admin reinstate_user(requester)", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.rpc("create_job", createJobPayload("(A6, reinstated)"));
    record("A6) REINSTATED (aynı oturum) create_job tekrar PASSES", !error && !!data?.id, error?.message);
  }
  // YENİ — reinstate SONRASI ilan düzenleme de gerçekten PASS olmalı (aynı jobId, hâlâ pending_review).
  {
    const { error } = await requesterClient.rpc("update_job_as_requester", {
      p_job_id: jobId, p_title: "0042 dev test job (REINSTATED EDIT)", p_description: "Aktif hesapla basarili duzenleme denemesi, yeterli uzunlukta.",
      p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Dev Test Depo", p_address_text: "Test adres, en az yirmi karakter.",
      p_work_date: workDate, p_work_end_date: workDate, p_product_quantity: null, p_product_tonnage: null, p_product_type: null,
      p_customs_product_type: null, p_delivery_facility_name: null, p_delivery_address_text: null, p_operation_details: "",
      p_neighborhood: null, p_location_url: null, p_directions_note: null, p_delivery_province: null, p_delivery_district: null,
      p_recycling_material_category_id: null, p_recycling_material_subtype_id: null, p_recycling_quantity: null, p_recycling_unit: null,
      p_recycling_material_condition: null, p_recycling_material_condition_note: null, p_recycling_scope_of_work: null,
      p_customs_transaction_type: null, p_customs_requested_services: null, p_storage_product_type: null, p_storage_product_quantity: null,
      p_storage_product_unit: null, p_storage_product_tonnage: null, p_storage_container_groups: null, p_product_tonnage_unit: null,
      p_nakliye_load_preparation_type: null, p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: null,
      p_nakliye_loading_method_custom_text: null, p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null,
      p_nakliye_cargo_groups: null, p_storage_hazardous: null, p_storage_risk_groups: null, p_recycling_requested_operation: null,
      p_recycling_waste_code: null, p_recycling_waste_code_unknown: null, p_recycling_hazard_properties: null,
    });
    record("A6b) ACTIVE (reinstated) requester ilan DÜZENLEYEBİLİR", !error, error?.message);
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

  // YENİ — askıdaki (ama YETKİLİ) provider teklif VEREMEZ.
  suspend(providerId);
  {
    const { error, data } = await providerClient.rpc("create_offer", { p_job_id: jobId, p_amount: 1500, p_currency: "TRY", p_description: "0042 suspended teklif denemesi, en az yirmi karakter." });
    recordSuspendedRejected("B0c) SUSPENDED (yetkili) provider create_offer YAPAMAZ (ML127)", error, data);
  }
  reinstate(providerId);

  // ===== B) OFFER FLOW: create -> accept -> contact reveal timing -> 3rd party check =====
  {
    const { data, error } = await providerClient.rpc("create_offer", { p_job_id: jobId, p_amount: 1500, p_currency: "TRY", p_description: "0042 dev test offer description, en az yirmi karakter." });
    offerId = data?.id;
    record("B1) Yetkili (ACTIVE) provider create_offer PASSES", !error && !!offerId, error?.message);
  }
  // DÜZELTME ("Son Açıkları Kapat" GÖREV 3) — get_offer_provider_display'ın
  // GERÇEK, canlı tanımı (pg_get_functiondef ile doğrulandı) 3. tarafı
  // (ne job sahibi ne offer'ın provider'ı ne admin) AÇIKÇA MLK56 ile
  // reddediyor — eski script'in "RLS engellemiyor okumayı" varsayımı artık
  // (belki hiç) doğru değil; bu bilinçli, doğru bir güvenlik davranışıdır,
  // beklenen sonuç REDDEDİLMEsidir.
  {
    const { error } = await provider2Client.rpc("get_offer_provider_display", { p_offer_id: offerId });
    record("B2) Yetkisiz 3. taraf get_offer_provider_display ÇAĞIRAMAZ (MLK56)", Boolean(error) && /MLK56/.test(error.message), error?.message);
  }
  {
    const { error } = await adminClient.rpc("get_job_address", { p_job_id: jobId });
    record("B3 sanity) Admin get_job_address her zaman görebilir", !error, error?.message);
  }
  // DÜZELTME — can_view_offer_contact'ın `authenticated` rolüne HİÇ EXECUTE
  // grant'ı yok (yalnızca `postgres` — pg_proc/information_schema ile canlı
  // doğrulandı); bu bilerek İÇ (internal-only) bir yardımcı fonksiyon, gerçek
  // dış API'si get_offer_contact'tır (kendi içinde can_view_offer_contact'ı
  // SECURITY DEFINER olarak çağırır). Eski script doğrudan can_view_offer_
  // contact'ı çağırıyordu — bu artık "permission denied for function" ile
  // HER ZAMAN reddedilir (yetkili/yetkisiz fark etmez), bu bir regresyon
  // DEĞİL, kasıtlı bir API sadeleştirmesi. get_offer_contact'a geçildi.
  {
    const { data, error } = await provider2Client.rpc("get_offer_contact", { p_offer_id: offerId });
    const noneRevealed = Array.isArray(data) ? data.length === 0 || (data[0] && !data[0].provider_phone && !data[0].provider_email && !data[0].requester_phone && !data[0].requester_email) : !data;
    record("B4) Yetkisiz 3. taraf get_offer_contact ile iletişim bilgisi ALAMAZ (kabulden ÖNCE)", !error && noneRevealed, error?.message || JSON.stringify(data));
  }
  // YENİ — askıdaki requester teklifi KABUL EDEMEZ.
  suspend(requesterId);
  {
    const { error, data } = await requesterClient.rpc("accept_offer", { p_offer_id: offerId });
    recordSuspendedRejected("B4b) SUSPENDED requester accept_offer YAPAMAZ (ML127)", error, data);
  }
  reinstate(requesterId);
  {
    const { error } = await requesterClient.rpc("accept_offer", { p_offer_id: offerId });
    record("B5) ACTIVE (reinstated) requester accept_offer PASSES", !error, error?.message);
  }
  {
    const { data: providerSees, error: e1 } = await providerClient.rpc("get_offer_contact", { p_offer_id: offerId });
    const { data: requesterSees, error: e2 } = await requesterClient.rpc("get_offer_contact", { p_offer_id: offerId });
    const { data: outsiderSees, error: e3 } = await provider2Client.rpc("get_offer_contact", { p_offer_id: offerId });
    const providerGotContact = Array.isArray(providerSees) && providerSees[0] && (providerSees[0].requester_phone || providerSees[0].requester_email);
    const requesterGotContact = Array.isArray(requesterSees) && requesterSees[0] && (requesterSees[0].provider_phone || requesterSees[0].provider_email);
    const outsiderGotNothing = !Array.isArray(outsiderSees) || outsiderSees.length === 0 || (outsiderSees[0] && !outsiderSees[0].provider_phone && !outsiderSees[0].provider_email && !outsiderSees[0].requester_phone && !outsiderSees[0].requester_email);
    record("B6) Kabul SONRASI: taraflar (provider+requester) get_offer_contact ile iletişim görebiliyor, 3. taraf GÖREMİYOR",
      !e1 && !e2 && !e3 && providerGotContact && requesterGotContact && outsiderGotNothing,
      `provider=${JSON.stringify(providerSees)} requester=${JSON.stringify(requesterSees)} outsider=${JSON.stringify(outsiderSees)}`);
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
  // DÜZELTME ("Son Açıkları Kapat" GÖREV 3) — start_work'ün GERÇEK, canlı
  // tanımı (pg_get_functiondef ile doğrulandı) `v_job_requester_id <>
  // auth.uid()` kontrolü yapıyor — yani start_work AÇIKÇA ve KASITLI olarak
  // REQUESTER-only bir işlemdir (bkz. CLAUDE.md "startWorkForOffer... hem de
  // requester-only" notu — "Hizmet Alan işin başladığını onaylıyor"). Eski
  // script bunun TERSİNİ varsayıyordu (provider-only) — bu bir regresyon
  // DEĞİL, script'in başından beri yanlış bir varsayımıydı; roller
  // düzeltildi.
  {
    const { error } = await providerClient.rpc("start_work", { p_offer_id: offerId });
    record("C1) Provider (yanlış rol) start_work çağırıyor -> FAIL (MLK56)", Boolean(error) && /MLK56/.test(error.message), error?.message);
  }
  // YENİ — askıdaki requester işi BAŞLATAMAZ.
  suspend(requesterId);
  {
    const { error, data } = await requesterClient.rpc("start_work", { p_offer_id: offerId });
    recordSuspendedRejected("C1b) SUSPENDED requester start_work YAPAMAZ (ML127)", error, data);
  }
  reinstate(requesterId);
  {
    const { error } = await requesterClient.rpc("start_work", { p_offer_id: offerId });
    record("C2) Requester (doğru rol, ACTIVE) start_work PASSES", !error, error?.message);
  }
  // YENİ — askıdaki provider tamamlama TALEP EDEMEZ.
  suspend(providerId);
  {
    const { error, data } = await providerClient.rpc("request_completion", { p_offer_id: offerId });
    recordSuspendedRejected("C2b) SUSPENDED provider request_completion YAPAMAZ (ML127)", error, data);
  }
  reinstate(providerId);
  {
    const { error } = await providerClient.rpc("request_completion", { p_offer_id: offerId });
    record("C3) Provider (ACTIVE) request_completion PASSES", !error, error?.message);
  }
  {
    const { error } = await providerClient.rpc("confirm_completion", { p_offer_id: offerId });
    record("C4) Tamamlamayı İSTEYEN (provider) kendi isteğini confirm edemiyor -> FAIL", !!error, error?.message);
  }
  // YENİ — askıdaki requester tamamlamayı ONAYLAYAMAZ.
  suspend(requesterId);
  {
    const { error, data } = await requesterClient.rpc("confirm_completion", { p_offer_id: offerId });
    recordSuspendedRejected("C4b) SUSPENDED requester confirm_completion YAPAMAZ (ML127)", error, data);
  }
  reinstate(requesterId);
  {
    const { error } = await requesterClient.rpc("confirm_completion", { p_offer_id: offerId });
    record("C5) Requester (doğru taraf, ACTIVE) confirm_completion PASSES", !error, error?.message);
  }
  {
    const { data, error } = await requesterClient.from("offers").select("status").eq("id", offerId).single();
    record("C6) offer.status = 'completed' (gerçek DB satırı doğrulandı)", !error && data?.status === "completed", error?.message || data?.status);
  }
  // YENİ — askıdaki requester PUANLAYAMAZ.
  suspend(requesterId);
  {
    const { error, data } = await requesterClient.rpc("submit_rating", { p_offer_id: offerId, p_stars: 5, p_comment: "0042 suspended rating denemesi" });
    recordSuspendedRejected("C6b) SUSPENDED requester submit_rating YAPAMAZ (ML127)", error, data);
  }
  reinstate(requesterId);
  {
    const { error } = await requesterClient.rpc("submit_rating", { p_offer_id: offerId, p_stars: 5, p_comment: "0042 dev test rating" });
    record("C7) Tamamlanan teklif için ACTIVE requester submit_rating PASSES", !error, error?.message);
  }

  // YENİ — askıdaki provider PROFİL güncelleyemez; reinstate sonrası edebilir.
  suspend(providerId);
  {
    const { error, data } = await providerClient.rpc("upsert_provider_profile", {
      p_bio: "0042 suspended profil guncelleme denemesi, en az elli karakter uzunlugunda olmasi gereken bir metin.",
      p_founded_year: 2015, p_experience_range: null, p_regions: null, p_service_features: null,
    });
    recordSuspendedRejected("E1) SUSPENDED provider upsert_provider_profile YAPAMAZ (ML127)", error, data);
  }
  reinstate(providerId);
  {
    const { error } = await providerClient.rpc("upsert_provider_profile", {
      p_bio: "0042 aktif hesapla basarili profil guncelleme denemesi, en az elli karakter uzunlugunda bir metin.",
      p_founded_year: 2015, p_experience_range: null, p_regions: null, p_service_features: null,
    });
    record("E2) ACTIVE (reinstated) provider upsert_provider_profile PASSES", !error, error?.message);
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
  // Bu betik yalnızca SAHTE fotoğraf metadata'sı yazıyor (gerçek Storage
  // yüklemesi hiç yapılmıyor, bkz. `photos` sabiti) — bu yüzden GÖREV 1'in
  // "Storage'ı kullanıcıdan önce sil" kuralı burada devreye girmiyor (silinecek
  // gerçek bir Storage nesnesi yok). Ama jobs.requester_id/offers.provider_id
  // (ve offer_status_history.offer_id/ratings.offer_id/notifications.offer_id)
  // `profiles(id)`e NO ACTION ile referans verir (migration 0043) — bu betik
  // GERÇEK bir teklif yaşam döngüsü (kabul->işe başla->tamamla->puanla)
  // çalıştırdığı için, auth.users'tan ÖNCE bu satırların FK-güvenli sırayla
  // silinmesi gerekir (aksi hâlde 23503 ile auth.users silme adımı başarısız
  // olur ve kullanıcı sonsuza dek kalır — GÖREV 1'in "yetim veri bırakma"
  // ilkesiyle AYNI kök neden, bu betik için de düzeltildi).
  const idList = createdIds.map((id) => `'${id}'`).join(",");
  if (idList.length > 0) {
    try {
      sql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      sql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
      sql(`delete from public.notifications where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
      sql(`delete from public.ratings where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}) or rater_id in (${idList});`);
      sql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
      sql(`delete from public.notifications where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      sql(`delete from public.recently_viewed_jobs where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      sql(`update public.jobs set republished_from_job_id = null, republished_to_job_id = null where requester_id in (${idList});`);
      sql(`delete from public.jobs where requester_id in (${idList});`);
      sql(`delete from public.operations where requester_id in (${idList});`);
      sql(`delete from public.provider_document_reviews where provider_id in (${idList});`);
      sql(`delete from public.provider_documents where provider_id in (${idList});`);
      sql(`delete from public.provider_badges where provider_id in (${idList});`);
      sql(`delete from public.provider_recycling_waste_code_authorizations where provider_id in (${idList});`);
      sql(`delete from public.provider_storage_risk_authorizations where provider_id in (${idList});`);
      sql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
    } catch (e) {
      record("Cleanup: DB satırları silinemedi", false, e.message);
    }
  }
  for (const id of createdIds) {
    try { sql(`delete from auth.users where id = '${id}';`); } catch (e) { record(`Cleanup delete auth.users ${id}`, false, e.message); }
  }
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
