// node scripts/tmp-supabase-development-kapanis-test.mjs
// "Development Kapanış Turu: MERSİS Zorunluluğu, İlan Tutarlılığı ve Eksik
// Gerçek Testler" görevinin gerçek kanıtı. Yalnızca Development
// (trfnmpihcnriqgikglpu). YENİ ADMİN HESABI OLUŞTURULMADI.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-dkt-"));
function runSql(sql, { retries = 3 } = {}) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { encoding: "utf8" });
      return JSON.parse(output).rows ?? [];
    } catch (error) {
      if (attempt >= retries) throw error;
    }
  }
}
async function pollSql(sql, isReady, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = runSql(sql)[0];
    if (isReady(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function clientAs(email) {
  const client = freshClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signInWithPassword(${email}) failed: ${error.message}`);
  return client;
}

const stamp = Date.now();
async function createUser(label, role, { skipComplete = false, companyType = "bireysel", mersisNo } = {}) {
  const email = `malsevk-dkt-${label}-${stamp}@gmail.com`;
  const client = freshClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  if (!skipComplete) {
    const { error: crError } = await client.rpc("complete_registration", {
      p_role: role, p_full_name: `DKT ${label}`, p_phone: "+905551110099",
      p_company_name: `DKT Firma ${label}`, p_company_type: companyType, p_province: "Kocaeli", p_district: "Gebze",
      p_mersis_no: mersisNo ?? null,
    });
    if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  }
  return { id: userId, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    try {
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginAs(${email}) failed after retry`);
      await page.waitForTimeout(500);
    }
  }
}

function randomNoiseBuffer(width, height, channels, seed) {
  const buf = Buffer.alloc(width * height * channels);
  let state = (seed + 1) * 2654435761;
  for (let i = 0; i < buf.length; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = state % 256;
  }
  return buf;
}
async function makeTestJpeg(seed) {
  const width = 320, height = 320, channels = 3;
  return sharp(randomNoiseBuffer(width, height, channels, seed), { raw: { width, height, channels } }).jpeg().toBuffer();
}
async function makeTestPng(seed) {
  const width = 64, height = 64, channels = 4;
  return sharp(randomNoiseBuffer(width, height, channels, seed), { raw: { width, height, channels } }).png().toBuffer();
}

async function uploadTestPhotosToStorage(client, userId, jobId, count, seedBase) {
  const rpcPhotos = [];
  for (let i = 0; i < count; i += 1) {
    const buffer = await makeTestJpeg(seedBase + i);
    const storagePath = `${userId}/${jobId}/${i}.jpg`;
    const { error } = await client.storage.from("job-photos").upload(storagePath, buffer, { contentType: "image/jpeg" });
    if (error) throw new Error(`Storage upload failed (${storagePath}): ${error.message}`);
    rpcPhotos.push({ storage_path: storagePath, original_file_name: `test-${i}.jpg`, mime_type: "image/jpeg", size_bytes: buffer.length, width: null, height: null });
  }
  return rpcPhotos;
}

const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function baseCreateJobPayload(overrides) {
  return {
    p_category_id: "forklift",
    p_title: "DKT test ilanı",
    p_description: "Development Kapanış Turu testi için oluşturulan ilan açıklamasıdır, yeterli uzunlukta.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Tesisi",
    p_work_date: workDate,
    p_photos: [],
    p_facility_id: null,
    p_location_mode: "custom",
    p_address_text: "Test acik adres, Gebze / Kocaeli.",
    p_neighborhood: null,
    p_location_url: null,
    p_directions_note: null,
    // job-edit-form.tsx'in gerçek "Bitiş Tarihi" alanı ZORUNLUDUR — bir işi
    // RPC ile doğrudan (gerçek forma girmeden) oluştururken bunu boş
    // bırakmak, sonradan GERÇEK UI ile düzenlemeye çalışıldığında o formun
    // kendi (doğru) zorunlu-alan doğrulamasına takılır. workDate ile AYNI
    // değer, gerçek formun "tek günlük iş" varsayılan kullanımını taklit eder.
    p_work_end_date: workDate,
    p_product_quantity: null,
    p_product_tonnage: null,
    p_product_type: null,
    p_customs_product_type: null,
    p_customs_transaction_type: null,
    p_customs_requested_services: null,
    p_client_id: randomUUID(),
    p_delivery_province: null,
    p_delivery_district: null,
    p_delivery_location_type: null,
    p_delivery_facility_id: null,
    p_delivery_facility_name: null,
    p_delivery_address_text: null,
    p_recycling_material_category_id: null,
    p_recycling_material_subtype_id: null,
    p_recycling_quantity: null,
    p_recycling_unit: null,
    p_recycling_material_condition: null,
    p_recycling_material_condition_note: null,
    p_recycling_scope_of_work: null,
    p_storage_product_type: null,
    p_storage_product_quantity: null,
    p_storage_product_unit: null,
    p_storage_product_tonnage: null,
    p_storage_container_groups: null,
    p_product_tonnage_unit: null,
    p_nakliye_load_preparation_type: null,
    p_nakliye_load_preparation_custom_text: null,
    p_nakliye_loading_method: null,
    p_nakliye_loading_method_custom_text: null,
    p_nakliye_measurement_info: null,
    p_nakliye_hazmat: null,
    p_nakliye_container_transport: null,
    p_nakliye_cargo_groups: null,
    p_storage_hazardous: null,
    p_storage_risk_groups: null,
    p_recycling_requested_operation: null,
    p_recycling_waste_code: null,
    p_recycling_waste_code_unknown: null,
    p_recycling_hazard_properties: null,
    ...overrides,
  };
}

async function approveJobAsAdmin(jobId) {
  runSql(`update public.jobs set moderation_status = 'approved', moderation_reviewed_at = now() where id = '${jobId}';`);
  const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
  return row?.moderation_status === "approved";
}

async function run() {
  const browser = await chromium.launch();
  try {
    // ================================================================
    // 1) MERSİS ZORUNLULUĞU (migration 0083)
    // ================================================================
    console.log("\n=== 1) MERSİS ZORUNLULUĞU ===");

    const bireysel = await createUser("bireysel", "hizmet-alan", { skipComplete: true });
    const { error: bireyselErr } = await (await clientAs(bireysel.email)).rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "DKT Bireysel", p_phone: "+905551110001",
      p_company_name: "Bireysel", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("1-1) Bireysel + MERSİS yok: kabul edilir", !bireyselErr, bireyselErr?.message);

    const noMersis = await createUser("nomersis", "hizmet-veren", { skipComplete: true });
    const { error: noMersisErr } = await (await clientAs(noMersis.email)).rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "DKT NoMersis", p_phone: "+905551110002",
      p_company_name: "DKT Firma NoMersis", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("1-2) İşletme + MERSİS yok: reddedilir (ML176)", /ML176/.test(noMersisErr?.message ?? ""), noMersisErr?.message);

    const badFormat = await createUser("badformat", "hizmet-veren", { skipComplete: true });
    const { error: badFormatErr } = await (await clientAs(badFormat.email)).rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "DKT BadFormat", p_phone: "+905551110003",
      p_company_name: "DKT Firma BadFormat", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
      p_mersis_no: "12345",
    });
    record("1-3) İşletme + geçersiz biçim: reddedilir (ML174)", /ML174/.test(badFormatErr?.message ?? ""), badFormatErr?.message);

    const MERSIS_A = `9${stamp}`.slice(0, 16).padEnd(16, "1");
    const mersisA = await createUser("mersisa", "hizmet-veren", { companyType: "limited-sirket", mersisNo: MERSIS_A });
    const rowA = runSql(`select mersis_no from public.profiles where id = '${mersisA.id}';`)[0];
    record("1-4) Geçerli MERSİS ile işletme kaydı oluşturulur", rowA?.mersis_no === MERSIS_A, JSON.stringify(rowA));

    const mersisB = await createUser("mersisb", "hizmet-veren", { skipComplete: true });
    const { error: mersisBErr } = await (await clientAs(mersisB.email)).rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "DKT MersisB", p_phone: "+905551110005",
      p_company_name: "DKT Firma B", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
      p_mersis_no: MERSIS_A,
    });
    record("1-5) Aynı MERSİS ile ikinci işletme: reddedilir (ML175)", /ML175/.test(mersisBErr?.message ?? ""), mersisBErr?.message);

    const mersisC = await createUser("mersisc", "hizmet-veren", { skipComplete: true });
    const spacedVariant = `${MERSIS_A.slice(0, 4)} ${MERSIS_A.slice(4, 8)}-${MERSIS_A.slice(8, 12)} ${MERSIS_A.slice(12)}`;
    const { error: mersisCErr } = await (await clientAs(mersisC.email)).rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "DKT MersisC", p_phone: "+905551110006",
      p_company_name: "DKT Firma C", p_company_type: "anonim-sirket", p_province: "Kocaeli", p_district: "Gebze",
      p_mersis_no: spacedVariant,
    });
    record("1-6) Aynı numaranın boşluk/tire varyasyonu: reddedilir", /ML175/.test(mersisCErr?.message ?? ""), `input=${spacedVariant}, err=${mersisCErr?.message}`);

    const MERSIS_D = `8${stamp}`.slice(0, 16).padEnd(16, "2");
    const mersisD = await createUser("mersisd", "hizmet-veren", { companyType: "sahis-isletmesi", mersisNo: MERSIS_D });
    record("1-7) Farklı geçerli MERSİS kabul edilir", true, mersisD.id);

    const mersisE1 = await createUser("mersise1", "hizmet-veren", { skipComplete: true });
    const mersisE2 = await createUser("mersise2", "hizmet-veren", { skipComplete: true });
    const CONCURRENT_MERSIS = `7${stamp}`.slice(0, 16).padEnd(16, "3");
    const [concResult1, concResult2] = await Promise.all([
      (await clientAs(mersisE1.email)).rpc("complete_registration", {
        p_role: "hizmet-veren", p_full_name: "DKT E1", p_phone: "+905551110007",
        p_company_name: "DKT Firma E1", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
        p_mersis_no: CONCURRENT_MERSIS,
      }),
      (await clientAs(mersisE2.email)).rpc("complete_registration", {
        p_role: "hizmet-veren", p_full_name: "DKT E2", p_phone: "+905551110008",
        p_company_name: "DKT Firma E2", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
        p_mersis_no: CONCURRENT_MERSIS,
      }),
    ]);
    const concSuccesses = [concResult1, concResult2].filter((r) => !r.error).length;
    record("1-8) Eşzamanlı aynı MERSİS kaydı: yalnızca biri başarılı", concSuccesses === 1, `basarili=${concSuccesses}`);

    // MERSİS başka kullanıcıya/anonime sızmıyor mu?
    const mersisFClient = await clientAs(mersisD.email);
    const { data: crossReadData } = await mersisFClient.from("profiles").select("mersis_no").eq("id", mersisA.id);
    record("1-9) Başka kullanıcı MERSİS'i okuyamaz (RLS)", Array.isArray(crossReadData) && crossReadData.length === 0, JSON.stringify(crossReadData));

    const anonClient = freshClient();
    const { data: anonReadData, error: anonReadErr } = await anonClient.from("profiles").select("mersis_no").eq("id", mersisA.id);
    record(
      "1-10) Anonim kullanıcı MERSİS'i okuyamaz (RLS)",
      Boolean(anonReadErr) || (Array.isArray(anonReadData) && anonReadData.length === 0),
      `data=${JSON.stringify(anonReadData)}, err=${anonReadErr?.message}`,
    );

    console.log(`=== 1) ARA SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // 2) İLAN DÜZENLEMEDE YEREL-ONLY BAŞARI KALDIRILDI MI
    // ================================================================
    console.log("\n=== 2) İLAN DÜZENLEMEDE YEREL-ONLY BAŞARI ===");

    const reqEdit = await createUser("reqedit", "hizmet-alan");
    const reqEditClient = await clientAs(reqEdit.email);
    const pendingJobId = randomUUID();
    const pendingPhotos = await uploadTestPhotosToStorage(reqEditClient, reqEdit.id, pendingJobId, 4, 100);
    const { error: pendingCreateErr } = await reqEditClient.rpc("create_job", baseCreateJobPayload({
      p_client_id: pendingJobId, p_title: "DKT pending-review test ilanı", p_photos: pendingPhotos,
    }));
    record("2-1) pending_review ilan oluşturuldu", !pendingCreateErr, pendingCreateErr?.message);

    // a) pending_review ilan sahibi tarafından düzenlenebilir (RPC seviyesi)
    const { error: ownerEditPendingErr } = await reqEditClient.rpc("update_job_as_requester", {
      p_job_id: pendingJobId, p_title: "DKT pending-review DUZENLENDI", p_description: "Duzenlenmis aciklama, yeterli uzunlukta metin.",
      p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test Tesisi", p_address_text: "Test acik adres.",
      p_work_date: workDate, p_work_end_date: null, p_product_quantity: null, p_product_tonnage: null, p_product_type: null,
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
    const pendingEditedRow = runSql(`select title from public.jobs where id = '${pendingJobId}';`)[0];
    record("2-2) pending_review ilan sahibi tarafından RPC ile düzenlenebilir", !ownerEditPendingErr && pendingEditedRow?.title === "DKT pending-review DUZENLENDI", `err=${ownerEditPendingErr?.message}, title=${pendingEditedRow?.title}`);

    // b) başka kullanıcı düzenleyemez
    const otherUser = await createUser("otheruser", "hizmet-alan");
    const otherUserClient = await clientAs(otherUser.email);
    const { error: otherUserEditErr } = await otherUserClient.rpc("update_job_as_requester", {
      p_job_id: pendingJobId, p_title: "BASKA KULLANICI DENEMESI", p_description: "Baskasinin ilanini duzenlemeye calisan yetkisiz istek.",
      p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test", p_address_text: "Test.", p_work_date: workDate,
      p_work_end_date: null, p_product_quantity: null, p_product_tonnage: null, p_product_type: null, p_customs_product_type: null,
      p_delivery_facility_name: null, p_delivery_address_text: null, p_operation_details: "", p_neighborhood: null, p_location_url: null,
      p_directions_note: null, p_delivery_province: null, p_delivery_district: null, p_recycling_material_category_id: null,
      p_recycling_material_subtype_id: null, p_recycling_quantity: null, p_recycling_unit: null, p_recycling_material_condition: null,
      p_recycling_material_condition_note: null, p_recycling_scope_of_work: null, p_customs_transaction_type: null,
      p_customs_requested_services: null, p_storage_product_type: null, p_storage_product_quantity: null, p_storage_product_unit: null,
      p_storage_product_tonnage: null, p_storage_container_groups: null, p_product_tonnage_unit: null, p_nakliye_load_preparation_type: null,
      p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: null, p_nakliye_loading_method_custom_text: null,
      p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null, p_nakliye_cargo_groups: null,
      p_storage_hazardous: null, p_storage_risk_groups: null, p_recycling_requested_operation: null, p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: null, p_recycling_hazard_properties: null,
    });
    const afterOtherAttempt = runSql(`select title from public.jobs where id = '${pendingJobId}';`)[0];
    record("2-3) Başka kullanıcı düzenleyemez", Boolean(otherUserEditErr) && afterOtherAttempt?.title === "DKT pending-review DUZENLENDI", `err=${otherUserEditErr?.message}`);

    // c) onaylanmış ilan yerel-only/RPC ile değiştirilemez
    await approveJobAsAdmin(pendingJobId);
    const { error: editApprovedErr } = await reqEditClient.rpc("update_job_as_requester", {
      p_job_id: pendingJobId, p_title: "ONAYLANMIS ILAN DUZENLEME DENEMESI", p_description: "Onaylanmis bir ilani duzenlemeye calisan istek.",
      p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test", p_address_text: "Test.", p_work_date: workDate,
      p_work_end_date: null, p_product_quantity: null, p_product_tonnage: null, p_product_type: null, p_customs_product_type: null,
      p_delivery_facility_name: null, p_delivery_address_text: null, p_operation_details: "", p_neighborhood: null, p_location_url: null,
      p_directions_note: null, p_delivery_province: null, p_delivery_district: null, p_recycling_material_category_id: null,
      p_recycling_material_subtype_id: null, p_recycling_quantity: null, p_recycling_unit: null, p_recycling_material_condition: null,
      p_recycling_material_condition_note: null, p_recycling_scope_of_work: null, p_customs_transaction_type: null,
      p_customs_requested_services: null, p_storage_product_type: null, p_storage_product_quantity: null, p_storage_product_unit: null,
      p_storage_product_tonnage: null, p_storage_container_groups: null, p_product_tonnage_unit: null, p_nakliye_load_preparation_type: null,
      p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: null, p_nakliye_loading_method_custom_text: null,
      p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null, p_nakliye_cargo_groups: null,
      p_storage_hazardous: null, p_storage_risk_groups: null, p_recycling_requested_operation: null, p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: null, p_recycling_hazard_properties: null,
    });
    const afterApprovedAttempt = runSql(`select title, moderation_status from public.jobs where id = '${pendingJobId}';`)[0];
    record("2-4) Onaylanmış ilan RPC ile değiştirilemez (sunucu reddeder)", Boolean(editApprovedErr) && afterApprovedAttempt?.title === "DKT pending-review DUZENLENDI", `err=${editApprovedErr?.message}, row=${JSON.stringify(afterApprovedAttempt)}`);

    // d) askıdaki kullanıcı düzenleyemez (yeni bir pending job üzerinde)
    const suspendEditUser = await createUser("suspendedit", "hizmet-alan");
    const suspendEditClient = await clientAs(suspendEditUser.email);
    const suspendJobId = randomUUID();
    const suspendPhotos = await uploadTestPhotosToStorage(suspendEditClient, suspendEditUser.id, suspendJobId, 4, 200);
    await suspendEditClient.rpc("create_job", baseCreateJobPayload({ p_client_id: suspendJobId, p_title: "DKT askı-düzenleme test ilanı", p_photos: suspendPhotos }));
    runSql(`update public.profiles set account_status = 'suspended' where id = '${suspendEditUser.id}';`);
    const { error: suspendedEditErr } = await suspendEditClient.rpc("update_job_as_requester", {
      p_job_id: suspendJobId, p_title: "ASKIDAKI KULLANICI DENEMESI", p_description: "Askidaki hesaptan duzenleme denemesi, yeterli uzunlukta.",
      p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test", p_address_text: "Test.", p_work_date: workDate,
      p_work_end_date: null, p_product_quantity: null, p_product_tonnage: null, p_product_type: null, p_customs_product_type: null,
      p_delivery_facility_name: null, p_delivery_address_text: null, p_operation_details: "", p_neighborhood: null, p_location_url: null,
      p_directions_note: null, p_delivery_province: null, p_delivery_district: null, p_recycling_material_category_id: null,
      p_recycling_material_subtype_id: null, p_recycling_quantity: null, p_recycling_unit: null, p_recycling_material_condition: null,
      p_recycling_material_condition_note: null, p_recycling_scope_of_work: null, p_customs_transaction_type: null,
      p_customs_requested_services: null, p_storage_product_type: null, p_storage_product_quantity: null, p_storage_product_unit: null,
      p_storage_product_tonnage: null, p_storage_container_groups: null, p_product_tonnage_unit: null, p_nakliye_load_preparation_type: null,
      p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: null, p_nakliye_loading_method_custom_text: null,
      p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null, p_nakliye_cargo_groups: null,
      p_storage_hazardous: null, p_storage_risk_groups: null, p_recycling_requested_operation: null, p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: null, p_recycling_hazard_properties: null,
    });
    record("2-5) Askıdaki kullanıcı düzenleyemez (ML127)", /ML127/.test(suspendedEditErr?.message ?? ""), suspendedEditErr?.message);
    runSql(`update public.profiles set account_status = 'active' where id = '${suspendEditUser.id}';`);

    console.log(`=== 2) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // 2-UI) Aynı kuralın GERÇEK UI üzerinden kanıtı
    // ================================================================
    // pending job (2-2'de düzenlenen) hâlâ pending_review durumundaydı, ama
    // 2-4'te ONAYLANDI — bu yüzden UI testi için TAZE bir pending job (2-1
    // sırasında oluşturulan suspendJobId, askıya alma testinden hâlâ
    // pending_review) ve approved olan pendingJobId'yi kullanıyoruz.
    const ctxUiEdit = await browser.newContext();
    const pageUiApproved = await ctxUiEdit.newPage();
    await loginAs(pageUiApproved, reqEdit.email);
    await pageUiApproved.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${pendingJobId}/duzenle`);
    let approvedBlockedMessageSeen = false;
    try {
      await pageUiApproved.getByText("Bu ilan mevcut durumundayken düzenlenemez.", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
      approvedBlockedMessageSeen = true;
    } catch {
      approvedBlockedMessageSeen = false;
    }
    record("2-6) UI: onaylanmış ilanın düzenleme rotası engelleme mesajı gösterir", approvedBlockedMessageSeen, `seen=${approvedBlockedMessageSeen}`);
    await ctxUiEdit.close();

    const ctxUiPending = await browser.newContext();
    const pageUiPending = await ctxUiPending.newPage();
    await loginAs(pageUiPending, suspendEditUser.email);
    await pageUiPending.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${suspendJobId}/duzenle`);
    let pendingFormReached = false;
    try {
      await pageUiPending.getByLabel("İlan Başlığı").first().waitFor({ state: "visible", timeout: 15000 });
      pendingFormReached = true;
    } catch {
      pendingFormReached = false;
    }
    record("2-7) UI: pending_review ilanın düzenleme formu erişilebilir", pendingFormReached, `reached=${pendingFormReached}`);
    if (pendingFormReached) {
      const titleInput = pageUiPending.getByLabel("İlan Başlığı").first();
      await titleInput.fill("");
      await titleInput.fill("DKT UI pending DUZENLENDI");
      await pageUiPending.getByRole("button", { name: /Kaydet|Güncelle/ }).first().click();
      await pageUiPending.waitForTimeout(3000);
      const editAlertText = await pageUiPending.locator('[role="alert"]').first().innerText().catch(() => "");
      const uiEditedRow = await pollSql(`select title from public.jobs where id = '${suspendJobId}';`, (r) => r?.title === "DKT UI pending DUZENLENDI", 20000);
      record("2-8) UI: pending_review ilan düzenlenince Supabase'de güncellenir", uiEditedRow?.title === "DKT UI pending DUZENLENDI", `row=${JSON.stringify(uiEditedRow)}, alert=${editAlertText}, url=${pageUiPending.url()}`);

      const ctxUiCheck = await browser.newContext();
      const pageUiCheck = await ctxUiCheck.newPage();
      await loginAs(pageUiCheck, suspendEditUser.email);
      await pageUiCheck.goto(`${APP_ORIGIN}/ilanlar/${suspendJobId}`);
      let sawUiEdit = false;
      try {
        await pageUiCheck.getByText("DKT UI pending DUZENLENDI", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
        sawUiEdit = true;
      } catch {
        sawUiEdit = false;
      }
      record("2-9) UI: başka (temiz) oturum güncel ilanı görür", sawUiEdit, `seen=${sawUiEdit}`);
      await ctxUiCheck.close();

      // Ağ/RPC hatasında form korunur, sahte başarı oluşmaz + yeniden deneme mükerrer kayıt oluşturmaz.
      // 2-8'in başarılı kaydından sonra sayfa /panel/hizmet-taleplerim'e yönlendi — bu testin
      // kendi amacı (form hâlâ AÇIKKEN askıya alma) için düzenleme sayfasına GERİ dönülür.
      await pageUiPending.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${suspendJobId}/duzenle`);
      await pageUiPending.getByLabel("İlan Başlığı").first().waitFor({ state: "visible", timeout: 15000 });
      runSql(`update public.profiles set account_status = 'suspended' where id = '${suspendEditUser.id}';`);
      const titleInput2 = pageUiPending.getByLabel("İlan Başlığı").first();
      await titleInput2.fill("");
      await titleInput2.fill("DKT UI pending IKINCI DENEME");
      await pageUiPending.getByRole("button", { name: /Kaydet|Güncelle/ }).first().click();
      await pageUiPending.waitForTimeout(2500);
      const afterFailedEdit = runSql(`select title from public.jobs where id = '${suspendJobId}';`)[0];
      record("2-10) Askıdaki hesapla düzenleme denemesi Supabase'de değişiklik yapmaz", afterFailedEdit?.title === "DKT UI pending DUZENLENDI", JSON.stringify(afterFailedEdit));
      const formStillHasNewTitle = await titleInput2.inputValue().catch(() => "");
      record("2-11) Form verisi korunur (kullanıcının girdiği başlık hâlâ görünüyor)", formStillHasNewTitle === "DKT UI pending IKINCI DENEME", `title=${formStillHasNewTitle}`);
      runSql(`update public.profiles set account_status = 'active' where id = '${suspendEditUser.id}';`);
    }
    await ctxUiPending.close();

    console.log(`=== 2-UI) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // 3) ÇOKLU İLAN / OPERASYON AKIŞI
    // ================================================================
    console.log("\n=== 3) ÇOKLU İLAN / OPERASYON AKIŞI ===");

    const reqOp = await createUser("reqop", "hizmet-alan");
    const reqOpClient = await clientAs(reqOp.email);
    const opServiceAId = randomUUID();
    const opServiceBId = randomUUID();
    const opPhotosA = await uploadTestPhotosToStorage(reqOpClient, reqOp.id, opServiceAId, 4, 300);
    const opPhotosB = await uploadTestPhotosToStorage(reqOpClient, reqOp.id, opServiceBId, 4, 400);
    const opClientOperationId = randomUUID();
    const opServices = [
      { category_id: "forklift", title: "DKT operasyon A", description: "DKT operasyon testi A servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test Tesisi A", location_mode: "custom", address_text: "Test acik adres A.", work_date: workDate, client_id: opServiceAId },
      { category_id: "forklift-operatoru", title: "DKT operasyon B", description: "DKT operasyon testi B servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test Tesisi B", location_mode: "custom", address_text: "Test acik adres B.", work_date: workDate, client_id: opServiceBId },
    ];
    const { data: opCreateData, error: opCreateErr } = await reqOpClient.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli", p_operation_details: "DKT operasyon testi", p_services: opServices,
      p_photos_by_service_index: { 0: opPhotosA, 1: opPhotosB }, p_client_operation_id: opClientOperationId,
    });
    record("3-1) create_operation_with_jobs başarıyla iki ilan oluşturur", !opCreateErr, opCreateErr?.message || JSON.stringify(opCreateData));
    const opRows = runSql(`select id, operation_id, category_id from public.jobs where id in ('${opServiceAId}', '${opServiceBId}');`);
    const sameOperationId = opRows.length === 2 && opRows[0].operation_id && opRows[0].operation_id === opRows[1].operation_id;
    record("3-2) İki ilan da AYNI operation_id'yi paylaşır, ikisi de DB'de var", sameOperationId, JSON.stringify(opRows));

    // Yarım kalma testi: askıya alınmış hesapla YENİ bir operasyon denemesi — hiçbir iş oluşmamalı.
    const reqOpFail = await createUser("reqopfail", "hizmet-alan");
    const reqOpFailClient = await clientAs(reqOpFail.email);
    runSql(`update public.profiles set account_status = 'suspended' where id = '${reqOpFail.id}';`);
    const opFailServiceAId = randomUUID();
    const opFailServiceBId = randomUUID();
    const { error: opFailErr } = await reqOpFailClient.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli", p_operation_details: "DKT basarisiz operasyon testi",
      p_services: [
        { category_id: "forklift", title: "DKT fail A", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceAId },
        { category_id: "forklift-operatoru", title: "DKT fail B", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceBId },
      ],
      p_photos_by_service_index: { 0: [], 1: [] }, p_client_operation_id: randomUUID(),
    });
    const opFailRows = runSql(`select count(*) as n from public.jobs where id in ('${opFailServiceAId}', '${opFailServiceBId}');`)[0];
    record("3-3) Başarısız operasyon denemesinde HİÇBİR ilan oluşmaz (yarım kalma yok)", Boolean(opFailErr) && opFailRows?.n === 0, `err=${opFailErr?.message}, n=${opFailRows?.n}`);
    runSql(`update public.profiles set account_status = 'active' where id = '${reqOpFail.id}';`);
    const opRetryPhotosA = await uploadTestPhotosToStorage(reqOpFailClient, reqOpFail.id, opFailServiceAId, 4, 800);
    const opRetryPhotosB = await uploadTestPhotosToStorage(reqOpFailClient, reqOpFail.id, opFailServiceBId, 4, 850);

    // Mükerrer/yeniden deneme testi: AYNI client_id'lerle ikinci bir çağrı, artık aktif hesapla + gerçek fotoğraflarla.
    const { error: opRetryErr } = await reqOpFailClient.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli", p_operation_details: "DKT basarisiz operasyon testi",
      p_services: [
        { category_id: "forklift", title: "DKT fail A", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceAId },
        { category_id: "forklift-operatoru", title: "DKT fail B", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceBId },
      ],
      p_photos_by_service_index: { 0: opRetryPhotosA, 1: opRetryPhotosB }, p_client_operation_id: randomUUID(),
    });
    const opRetryRows = runSql(`select count(*) as n from public.jobs where id in ('${opFailServiceAId}', '${opFailServiceBId}');`)[0];
    record("3-4) Yeniden deneme (aynı client_id) tam olarak 2 ilan oluşturur, mükerrer üretmez", !opRetryErr && opRetryRows?.n === 2, `err=${opRetryErr?.message}, n=${opRetryRows?.n}`);

    // Aynı çağrının TEKRARI (gerçek çift-gönderim) — client_id çakışması nedeniyle ikinci kez BAŞARISIZ olmalı (mükerrer önlenir).
    const { error: opDoubleSubmitErr } = await reqOpFailClient.rpc("create_operation_with_jobs", {
      p_province: "Kocaeli", p_operation_details: "DKT basarisiz operasyon testi",
      p_services: [
        { category_id: "forklift", title: "DKT fail A", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceAId },
        { category_id: "forklift-operatoru", title: "DKT fail B", description: "Basarisiz olmasi beklenen operasyon servisi aciklamasi, yeterli uzunlukta.", district: "Gebze", work_location_type: "Test", location_mode: "custom", address_text: "Test.", work_date: workDate, client_id: opFailServiceBId },
      ],
      p_photos_by_service_index: { 0: opRetryPhotosA, 1: opRetryPhotosB }, p_client_operation_id: randomUUID(),
    });
    const opDoubleRows = runSql(`select count(*) as n from public.jobs where id in ('${opFailServiceAId}', '${opFailServiceBId}');`)[0];
    record("3-5) Aynı client_id ile üçüncü çağrı reddedilir, hâlâ tam 2 ilan var (mükerrer yok)", Boolean(opDoubleSubmitErr) && opDoubleRows?.n === 2, `err=${opDoubleSubmitErr?.message}, n=${opDoubleRows?.n}`);

    console.log(`=== 3) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // Gerçek UI üzerinden çoklu hizmet oluşturma (createJobsForOperationWithSupabaseSync'in tarayıcı-taraflı kod yolu)
    const reqOpUi = await createUser("reqopui", "hizmet-alan");
    const ctxOpUi = await browser.newContext();
    const pageOpUi = await ctxOpUi.newPage();
    await loginAs(pageOpUi, reqOpUi.email);
    await pageOpUi.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await pageOpUi.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 20000 });
    await pageOpUi.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
    await pageOpUi.waitForTimeout(400);
    await pageOpUi.getByLabel("Başlangıç Tarihi").first().fill(workDate);
    await pageOpUi.getByLabel("Bitiş Tarihi").first().fill(workDate);
    await pageOpUi.getByLabel("İlan Başlığı").first().fill("DKT UI operasyon ana hizmet");
    await pageOpUi.getByLabel("Açıklama", { exact: false }).first().fill("DKT UI operasyon testi ana hizmet aciklamasi yeterli uzunlukta.");
    const opIlceButtons = pageOpUi.getByRole("button", { name: "İlçe", exact: true });
    await opIlceButtons.first().click();
    await pageOpUi.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
    await pageOpUi.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Gebze", exact: true }).first().click();
    const opFacilityButtons = pageOpUi.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true });
    if ((await opFacilityButtons.count()) > 0) {
      await opFacilityButtons.first().click();
      await pageOpUi.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().waitFor({ state: "visible" });
      await pageOpUi.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().getByRole("option", { name: "Listede yok, kendim gireceğim", exact: true }).first().click();
      await pageOpUi.getByLabel("Liman / Sanayi / OSB Adı").first().fill("Test Tesisi UI-OP");
    }
    await pageOpUi.getByLabel("Açık Adres").first().fill("Test acik adres UI operasyon.");
    const opFiles = [];
    for (let i = 0; i < 4; i += 1) opFiles.push({ name: `op-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeTestJpeg(500 + i) });
    await pageOpUi.locator('input[type="file"]').setInputFiles(opFiles);
    await pageOpUi.getByRole("button", { name: "Ek hizmet ekle" }).first().click();
    await pageOpUi.waitForTimeout(500);
    const categorySelects = pageOpUi.getByLabel("Hizmet Kategorisi");
    const categorySelectCount = await categorySelects.count();
    if (categorySelectCount > 1) {
      await categorySelects.nth(1).selectOption("forklift-operatoru");
      await pageOpUi.getByLabel("İlan Başlığı").nth(1).fill("DKT UI operasyon ek hizmet");
      await pageOpUi.getByLabel("Açıklama", { exact: false }).nth(1).fill("DKT UI operasyon testi ek hizmet aciklamasi yeterli uzunlukta.");
      await pageOpUi.getByLabel("Başlangıç Tarihi").nth(1).fill(workDate).catch(() => {});
      await pageOpUi.getByLabel("Bitiş Tarihi").nth(1).fill(workDate).catch(() => {});
    }
    await pageOpUi.waitForFunction(() => { const b = document.querySelector('button[type="submit"]'); return b && !b.disabled; }, { timeout: 15000 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const button = pageOpUi.getByRole("button", { name: /İlanı Yayınla|Hizmet İlanını Yayınla/ });
      if ((await button.count()) === 0) break;
      await button.first().click().catch(() => {});
      await pageOpUi.waitForTimeout(1500);
      if (pageOpUi.url().includes("hizmet-taleplerim") && pageOpUi.url().includes("operasyonIlanSayisi")) break;
      const alertText = await pageOpUi.locator('[role="alert"]').first().innerText().catch(() => "");
      if (alertText.trim().length > 0) break;
    }
    let opUiNavigated = false;
    try {
      await pageOpUi.waitForURL((url) => url.pathname.includes("hizmet-taleplerim") && url.search.includes("operasyonIlanSayisi"), { timeout: 30000 });
      opUiNavigated = true;
    } catch {
      opUiNavigated = false;
    }
    const opUiFinalAlert = await pageOpUi.locator('[role="alert"]').first().innerText().catch(() => "");
    const opUiRows = runSql(`select id, operation_id from public.jobs where requester_id = '${reqOpUi.id}';`);
    const opUiSameOperation = opUiRows.length === 2 && opUiRows[0].operation_id && opUiRows[0].operation_id === opUiRows[1].operation_id;
    record(
      "3-6) UI: gerçek çoklu hizmet formu Supabase'de 2 ilan + paylaşılan operation_id oluşturur",
      opUiNavigated && opUiSameOperation,
      `navigated=${opUiNavigated}, rows=${JSON.stringify(opUiRows)}, categorySelectCount=${categorySelectCount}, alert=${opUiFinalAlert}, url=${pageOpUi.url()}`,
    );
    await ctxOpUi.close();

    console.log(`=== 3-UI) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // 4) KATEGORİYE ÖZEL PAYLOAD ROUND-TRIP TESTLERİ
    // ================================================================
    console.log("\n=== 4) KATEGORİ ROUND-TRIP TESTLERİ ===");

    const reqCat = await createUser("reqcat", "hizmet-alan");
    const reqCatClient = await clientAs(reqCat.email);

    async function categoryRoundTrip(label, createOverrides, editOverrides, dbCheckAfterCreate, dbCheckAfterEdit) {
      const jobId = randomUUID();
      const photos = await uploadTestPhotosToStorage(reqCatClient, reqCat.id, jobId, 4, Math.floor(Math.random() * 900) + 600);
      const { error: createErr } = await reqCatClient.rpc("create_job", baseCreateJobPayload({ p_client_id: jobId, p_photos: photos, ...createOverrides }));
      record(`4-${label}-A) Oluşturma RPC'si başarılı`, !createErr, createErr?.message);
      const createdRow = runSql(dbCheckAfterCreate.sql(jobId))[0];
      record(`4-${label}-B) DB'de doğru değerlerle mevcut`, dbCheckAfterCreate.assert(createdRow), JSON.stringify(createdRow));

      // temiz ikinci oturum (aynı kullanıcı, yeni client) DB'den okur — RLS/round-trip kanıtı
      const secondSessionClient = await clientAs(reqCat.email);
      const { data: secondSessionRow } = await secondSessionClient.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
      record(`4-${label}-C) Temiz ikinci oturumda görüntülenebilir`, Boolean(secondSessionRow), JSON.stringify(secondSessionRow));

      // düzenle
      const { error: editErr } = await reqCatClient.rpc("update_job_as_requester", {
        p_job_id: jobId, p_title: `${createOverrides.p_title} DUZENLENDI`, p_description: "Duzenlenmis kategori testi aciklamasi, yeterli uzunlukta metin.",
        p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: createOverrides.p_work_location_type ?? "Test Tesisi",
        p_address_text: createOverrides.p_address_text ?? "Test acik adres.", p_work_date: workDate, p_work_end_date: null,
        p_product_quantity: null, p_product_tonnage: null, p_product_type: null, p_customs_product_type: editOverrides.p_customs_product_type ?? null,
        p_delivery_facility_name: editOverrides.p_delivery_facility_name ?? null, p_delivery_address_text: editOverrides.p_delivery_address_text ?? null,
        p_operation_details: "", p_neighborhood: null, p_location_url: null, p_directions_note: null,
        p_delivery_province: editOverrides.p_delivery_province ?? null, p_delivery_district: editOverrides.p_delivery_district ?? null,
        p_recycling_material_category_id: editOverrides.p_recycling_material_category_id ?? null, p_recycling_material_subtype_id: editOverrides.p_recycling_material_subtype_id ?? null,
        p_recycling_quantity: editOverrides.p_recycling_quantity ?? null, p_recycling_unit: editOverrides.p_recycling_unit ?? null,
        p_recycling_material_condition: editOverrides.p_recycling_material_condition ?? null, p_recycling_material_condition_note: null,
        p_recycling_scope_of_work: editOverrides.p_recycling_scope_of_work ?? null, p_customs_transaction_type: editOverrides.p_customs_transaction_type ?? null,
        p_customs_requested_services: editOverrides.p_customs_requested_services ?? null, p_storage_product_type: editOverrides.p_storage_product_type ?? null,
        p_storage_product_quantity: editOverrides.p_storage_product_quantity ?? null, p_storage_product_unit: editOverrides.p_storage_product_unit ?? null,
        p_storage_product_tonnage: editOverrides.p_storage_product_tonnage ?? null, p_storage_container_groups: null, p_product_tonnage_unit: editOverrides.p_product_tonnage_unit ?? null,
        p_nakliye_load_preparation_type: null, p_nakliye_load_preparation_custom_text: null, p_nakliye_loading_method: editOverrides.p_nakliye_loading_method ?? null,
        p_nakliye_loading_method_custom_text: null, p_nakliye_measurement_info: null, p_nakliye_hazmat: null, p_nakliye_container_transport: null,
        p_nakliye_cargo_groups: editOverrides.p_nakliye_cargo_groups ?? null, p_storage_hazardous: editOverrides.p_storage_hazardous ?? null,
        p_storage_risk_groups: editOverrides.p_storage_risk_groups ?? null, p_recycling_requested_operation: editOverrides.p_recycling_requested_operation ?? null,
        p_recycling_waste_code: null, p_recycling_waste_code_unknown: editOverrides.p_recycling_waste_code_unknown ?? true,
        p_recycling_hazard_properties: editOverrides.p_recycling_hazard_properties ?? null,
      });
      record(`4-${label}-D) Düzenleme RPC'si başarılı`, !editErr, editErr?.message);
      const editedRow = runSql(dbCheckAfterEdit.sql(jobId))[0];
      record(`4-${label}-E) DB'de düzenlenmiş değerlerle mevcut`, dbCheckAfterEdit.assert(editedRow), JSON.stringify(editedRow));
      const { data: secondSessionAfterEdit } = await secondSessionClient.from("jobs").select("title").eq("id", jobId).maybeSingle();
      record(`4-${label}-F) İkinci oturumda güncel değer görünür`, secondSessionAfterEdit?.title === `${createOverrides.p_title} DUZENLENDI`, JSON.stringify(secondSessionAfterEdit));
      return jobId;
    }

    // Nakliye (rota + Yük Grubu + ADR)
    await categoryRoundTrip(
      "NAKLIYE",
      {
        p_category_id: "nakliye", p_title: "DKT Nakliye kategori testi", p_work_location_type: "Test Yükleme Tesisi",
        p_address_text: "Test yukleme acik adres.", p_delivery_province: "İstanbul", p_delivery_district: "Tuzla",
        p_delivery_location_type: "open_address", p_delivery_facility_name: "Test Teslimat Tesisi", p_delivery_address_text: "Test teslimat acik adres.",
        p_nakliye_loading_method: "forklift",
        p_nakliye_cargo_groups: [{ id: "cg-1", productQuantity: 5, productTonnage: 12, productType: "ADR Test Yükü", productTonnageUnit: "ton", loadPreparationType: "dokme", measurementInfo: { dimensionsUnknown: true }, containerTransport: { status: "hayir" }, hazmat: { status: "evet", adrClass: "3" } }],
      },
      { p_delivery_facility_name: "Test Teslimat Tesisi GUNCEL", p_delivery_address_text: "Test teslimat acik adres GUNCEL.", p_delivery_province: "İstanbul", p_delivery_district: "Tuzla", p_nakliye_loading_method: "vinc", p_nakliye_cargo_groups: [{ id: "cg-1", productQuantity: 7, productTonnage: 14, productType: "ADR Test Yükü Güncel", productTonnageUnit: "ton", loadPreparationType: "dokme", measurementInfo: { dimensionsUnknown: true }, containerTransport: { status: "hayir" }, hazmat: { status: "evet", adrClass: "3" } }] },
      { sql: (id) => `select category_id, delivery_facility_name, nakliye_cargo_groups from public.jobs where id = '${id}';`, assert: (r) => r?.category_id === "nakliye" && r?.delivery_facility_name === "Test Teslimat Tesisi" && r?.nakliye_cargo_groups?.[0]?.hazmat?.adrClass === "3" },
      { sql: (id) => `select delivery_facility_name, nakliye_cargo_groups from public.jobs where id = '${id}';`, assert: (r) => r?.delivery_facility_name === "Test Teslimat Tesisi GUNCEL" && r?.nakliye_cargo_groups?.[0]?.productType === "ADR Test Yükü Güncel" },
    );

    // Depolama (ürün bilgisi + tehlikeli madde/ADR risk grupları)
    await categoryRoundTrip(
      "DEPOLAMA",
      { p_category_id: "tehlikeli-madde-depolama", p_title: "DKT Depolama kategori testi", p_work_location_type: "", p_address_text: "", p_location_mode: "catalog", p_storage_product_type: "Kimyasal Test Ürünü", p_storage_product_quantity: 50, p_storage_product_unit: "adet", p_storage_hazardous: true, p_storage_risk_groups: ["yanici-parlayici-sivilar"] },
      { p_storage_product_type: "Kimyasal Test Ürünü Güncel", p_storage_product_quantity: 75, p_storage_product_unit: "adet", p_storage_hazardous: true, p_storage_risk_groups: ["yanici-parlayici-sivilar", "basincli-gazlar"] },
      { sql: (id) => `select category_id, storage_product_type, storage_hazardous, storage_risk_groups from public.jobs where id = '${id}';`, assert: (r) => r?.category_id === "tehlikeli-madde-depolama" && r?.storage_product_type === "Kimyasal Test Ürünü" && r?.storage_hazardous === true },
      { sql: (id) => `select storage_product_type, storage_risk_groups from public.jobs where id = '${id}';`, assert: (r) => r?.storage_product_type === "Kimyasal Test Ürünü Güncel" && Array.isArray(r?.storage_risk_groups) && r.storage_risk_groups.length === 2 },
    );

    // Gümrük Müşavirliği
    await categoryRoundTrip(
      "GUMRUK",
      { p_category_id: "gumruk-musavirligi", p_title: "DKT Gümrük kategori testi", p_work_location_type: "", p_address_text: "", p_location_mode: "catalog", p_customs_transaction_type: "ithalat", p_customs_product_type: "Test Ürün Cinsi", p_customs_requested_services: ["ithalat-gumrukleme", "t1-islemleri"] },
      { p_customs_transaction_type: "ihracat", p_customs_product_type: "Test Ürün Cinsi Güncel", p_customs_requested_services: ["ihracat-gumrukleme"] },
      { sql: (id) => `select category_id, customs_transaction_type, customs_product_type, customs_requested_services from public.jobs where id = '${id}';`, assert: (r) => r?.category_id === "gumruk-musavirligi" && r?.customs_transaction_type === "ithalat" && r?.customs_product_type === "Test Ürün Cinsi" },
      { sql: (id) => `select customs_transaction_type, customs_product_type, customs_requested_services from public.jobs where id = '${id}';`, assert: (r) => r?.customs_transaction_type === "ihracat" && r?.customs_product_type === "Test Ürün Cinsi Güncel" },
    );

    // Geri Dönüşüm & Atık Tahliye
    await categoryRoundTrip(
      "GERI_DONUSUM",
      { p_category_id: "geri-donusum-atik-tahliye", p_title: "DKT Geri Dönüşüm kategori testi", p_work_location_type: "Test Tesisi", p_address_text: "Test acik adres.", p_recycling_material_category_id: "metal-hurda", p_recycling_material_subtype_id: "demir-celik", p_recycling_quantity: 100, p_recycling_unit: "kg", p_recycling_material_condition: "ayristirilmis", p_recycling_scope_of_work: ["sahadan-toplama", "tasima"], p_recycling_requested_operation: "geri-donusum-geri-kazanim", p_recycling_waste_code_unknown: true },
      { p_recycling_quantity: 150, p_recycling_material_condition: "karisik", p_recycling_scope_of_work: ["tasima", "tesise-teslim"], p_recycling_requested_operation: "bertaraf" },
      { sql: (id) => `select category_id, recycling_material_category_id, recycling_quantity, recycling_material_condition from public.jobs where id = '${id}';`, assert: (r) => r?.category_id === "geri-donusum-atik-tahliye" && r?.recycling_material_category_id === "metal-hurda" && Number(r?.recycling_quantity) === 100 },
      { sql: (id) => `select recycling_quantity, recycling_material_condition, recycling_requested_operation from public.jobs where id = '${id}';`, assert: (r) => Number(r?.recycling_quantity) === 150 && r?.recycling_material_condition === "karisik" && r?.recycling_requested_operation === "bertaraf" },
    );

    // İş Makinesi / Operatör Hizmetleri (plain, özel alanı yok — kategori kendisi doğru yazılıyor mu diye)
    await categoryRoundTrip(
      "IS_MAKINESI_OPERATOR",
      { p_category_id: "forklift-operatoru", p_title: "DKT İş Makinesi Operatör kategori testi" },
      {},
      { sql: (id) => `select category_id from public.jobs where id = '${id}';`, assert: (r) => r?.category_id === "forklift-operatoru" },
      { sql: (id) => `select title from public.jobs where id = '${id}';`, assert: (r) => r?.title === "DKT İş Makinesi Operatör kategori testi DUZENLENDI" },
    );

    console.log(`=== 4) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // 5) LOGO — GERÇEK DOSYAYLA
    // ================================================================
    console.log("\n=== 5) LOGO TESTLERİ ===");

    const logoProv = await createUser("logoprov", "hizmet-veren");
    const logoProvClient = await clientAs(logoProv.email);
    const logoPng1 = await makeTestPng(700);
    const { error: logoUploadErr } = await logoProvClient.storage.from("provider-logos").upload(`${logoProv.id}/logo.png`, logoPng1, { contentType: "image/png" });
    record("5-1) Logo yükleme (gerçek PNG) başarılı", !logoUploadErr, logoUploadErr?.message);
    const { error: logoPathErr } = await logoProvClient.rpc("set_provider_profile_logo_path", { p_logo_path: `${logoProv.id}/logo.png` });
    record("5-2) set_provider_profile_logo_path başarılı", !logoPathErr, logoPathErr?.message);
    const logoRow1 = runSql(`select logo_path from public.provider_profiles where user_id = '${logoProv.id}';`)[0];
    record("5-3) provider_profiles.logo_path güncellendi", logoRow1?.logo_path === `${logoProv.id}/logo.png`, JSON.stringify(logoRow1));
    const { data: logoListAfterUpload } = await logoProvClient.storage.from("provider-logos").list(logoProv.id, { limit: 100 });
    record("5-4) Storage'da tam olarak 1 logo nesnesi var", Array.isArray(logoListAfterUpload) && logoListAfterUpload.length === 1, JSON.stringify(logoListAfterUpload));

    const logoSecondSession = await clientAs(logoProv.email);
    const { data: logoListSecondSession } = await logoSecondSession.storage.from("provider-logos").list(logoProv.id, { limit: 100 });
    record("5-5) Temiz ikinci oturumda logo görünür", Array.isArray(logoListSecondSession) && logoListSecondSession.length === 1, JSON.stringify(logoListSecondSession));

    // Logo değiştirme — eski nesne yetim kalmamalı (aynı ada upsert:true ile yazılır, eski uzantı farklıysa önce klasör temizlenir — burada AYNI uzantı, upsert testi).
    const logoPng2 = await makeTestPng(701);
    const { error: logoChangeErr } = await logoProvClient.storage.from("provider-logos").upload(`${logoProv.id}/logo.png`, logoPng2, { contentType: "image/png", upsert: true });
    record("5-6) Logo değiştirme (aynı yol, upsert) başarılı", !logoChangeErr, logoChangeErr?.message);
    const { data: logoListAfterChange } = await logoProvClient.storage.from("provider-logos").list(logoProv.id, { limit: 100 });
    record("5-7) Logo değiştirdikten sonra hâlâ tam olarak 1 nesne var (yetim yok)", Array.isArray(logoListAfterChange) && logoListAfterChange.length === 1, JSON.stringify(logoListAfterChange));

    // Logo silme
    const logoRemovePaths = (logoListAfterChange ?? []).map((f) => `${logoProv.id}/${f.name}`);
    const { error: logoDeleteErr } = await logoProvClient.storage.from("provider-logos").remove(logoRemovePaths);
    const { error: logoPathClearErr } = await logoProvClient.rpc("set_provider_profile_logo_path", { p_logo_path: null });
    const { data: logoListAfterDelete } = await logoProvClient.storage.from("provider-logos").list(logoProv.id, { limit: 100 });
    const logoRow2 = runSql(`select logo_path from public.provider_profiles where user_id = '${logoProv.id}';`)[0];
    record("5-8) Logo silme: Storage boş, logo_path null", !logoDeleteErr && !logoPathClearErr && (logoListAfterDelete ?? []).length === 0 && logoRow2?.logo_path === null, `storage=${JSON.stringify(logoListAfterDelete)}, row=${JSON.stringify(logoRow2)}`);

    // Askıdaki kullanıcı logo değiştiremez (RPC seviyesi — provider_profiles.logo_path yazımı assert_active_user() ile korunuyor)
    runSql(`update public.profiles set account_status = 'suspended' where id = '${logoProv.id}';`);
    const { error: suspendedLogoErr } = await logoProvClient.rpc("set_provider_profile_logo_path", { p_logo_path: `${logoProv.id}/logo.png` });
    record("5-9) Askıdaki kullanıcı logo_path'i değiştiremez", Boolean(suspendedLogoErr), suspendedLogoErr?.message);
    runSql(`update public.profiles set account_status = 'active' where id = '${logoProv.id}';`);

    // Başka kullanıcı başkasının logosunu değiştiremez (RLS: Storage yazımı KENDİ klasörü dışına asla izin vermez)
    const otherLogoProv = await createUser("otherlogoprov", "hizmet-veren");
    const otherLogoProvClient = await clientAs(otherLogoProv.email);
    const { error: crossLogoWriteErr } = await otherLogoProvClient.storage.from("provider-logos").upload(`${logoProv.id}/logo.png`, logoPng2, { contentType: "image/png", upsert: true });
    record("5-10) Başka kullanıcı başkasının logo klasörüne yazamaz (RLS)", Boolean(crossLogoWriteErr), crossLogoWriteErr?.message);

    // Hata yolunda yetim dosya kalmaz: geçersiz bir yola (başkasının klasörü) yükleme reddedilir, kendi klasöründe yeni bir dosya oluşmaz.
    const { data: logoProvOwnFolderAfterCrossAttempt } = await logoProvClient.storage.from("provider-logos").list(logoProv.id, { limit: 100 });
    record("5-11) Reddedilen çapraz-kullanıcı denemesi hedef klasörde yetim dosya bırakmaz", (logoProvOwnFolderAfterCrossAttempt ?? []).length === 0, JSON.stringify(logoProvOwnFolderAfterCrossAttempt));

    console.log(`=== 5) ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    console.log(`\n=== TOPLAM SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
    if (results.some((r) => !r.pass)) {
      console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
