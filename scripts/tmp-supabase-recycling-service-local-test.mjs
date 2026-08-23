// LOCAL Docker Supabase only (npx supabase db reset / start gerekir) —
// Geri Dönüşüm & Atık Tahliye hizmetinin uçtan uca RPC/RLS doğrulaması:
// migration 0045 (service_categories satırı), 0046 (jobs.recycling_* +
// create_job/create_operation_with_jobs), 0047 (update_job_as_admin).
//
// Doğrulanan senaryolar (görevin "SON KONTROL" listesiyle birebir):
//   1. create_job ile normal bir Geri Dönüşüm & Atık Tahliye ilanı oluşur,
//      moderation_status='pending_review' ile başlar (diğer TÜM kategorilerle
//      AYNI kural — özel bir moderasyon dalı yok).
//   2. Admin onaylamadan önce hiçbir Hizmet Veren (yetkili olsa bile) ilanı
//      RLS üzerinden GÖREMEZ.
//   3. Admin onayladıktan sonra bile, kategori için AYRICA yetkilendirilmemiş
//      bir Hizmet Veren ilanı hâlâ göremez (provider_service_authorizations,
//      0038 — ikinci, bağımsız bir görünürlük katmanı).
//   4. Yetkilendirilen Hizmet Veren ilanı görür VE normal create_offer ile
//      TEK toplam hizmet bedeli teklif verebilir — offers tablosunda/RPC'sinde
//      HİÇBİR yeni alan/mantık yok, gönderilen amount aynen kaydedilir (ters
//      teklif/alım-satım mantığından hiçbir iz kalmadığının kanıtı).
//   5. Çoklu operasyon: aynı çağrıda Geri Dönüşüm + Forklift birlikte
//      oluşturulabiliyor, recycling_* alanları YALNIZCA doğru kardeşte dolu.
//   6. CHECK kısıtları (recycling_unit/recycling_material_condition/
//      recycling_scope_of_work) geçersiz değerleri reddediyor.
//   7. update_job_as_admin ile admin recycling alanlarını düzenleyebiliyor.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "TestSifre2026!";
const CATEGORY = "geri-donusum-atik-tahliye";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 220) : ""));
}
function psql(sql) {
  return execSync(`docker exec supabase_db_malsevk-2 psql -U postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
  }).trim();
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now();
const createdUserIds = [];

/** create_job/create_operation_with_jobs 1-10 fotoğraf zorunlu kılar (MLK51) — gerçek dosya gerekmez, yalnızca doğru şekilli JSON. */
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

async function createUser(label, role) {
  const email = `recytest-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const c = client();
  await c.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await c.rpc("complete_registration", {
    p_role: role,
    p_full_name: `RecyTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `RecyTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client: c };
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const authorizedProvider = await createUser("authprov", "hizmet-veren");
  const unauthorizedProvider = await createUser("unauthprov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminClient = client();
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });
  record("Kurulum: 4 test hesabı oluşturuldu (1 admin)", true);

  // -------------------------------------------------------------------
  // 1) create_job — normal bir Geri Dönüşüm & Atık Tahliye ilanı.
  // -------------------------------------------------------------------
  const { data: job, error: jobError } = await requester.client.rpc("create_job", {
    p_category_id: CATEGORY,
    p_title: "RecyTest — Fabrika Atık Tahliyesi",
    p_description: "Test ilanı — otomasyonla oluşturuldu.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Sahası",
    p_work_date: "2026-12-01",
    p_photos: fakePhotos(),
    p_address_text: "Test Mahallesi, Test Caddesi No:1, Gebze",
    p_recycling_material_category_id: "metal-hurda",
    p_recycling_material_subtype_id: "demir-celik",
    p_recycling_quantity: 8,
    p_recycling_unit: "ton",
    p_recycling_material_condition: "karisik",
    p_recycling_scope_of_work: ["sahadan-toplama", "yukleme", "tesisten-tahliye", "tasima"],
  });
  record("1a. create_job başarılı (Geri Dönüşüm & Atık Tahliye)", !jobError, jobError?.message);
  record("1b. moderation_status = 'pending_review' (diğer kategorilerle AYNI kural)", job?.moderation_status === "pending_review", job?.moderation_status);
  record(
    "1c. recycling_* alanları doğru kaydedildi",
    job?.recycling_material_category_id === "metal-hurda" &&
      job?.recycling_material_subtype_id === "demir-celik" &&
      Number(job?.recycling_quantity) === 8 &&
      job?.recycling_unit === "ton" &&
      job?.recycling_material_condition === "karisik" &&
      Array.isArray(job?.recycling_scope_of_work) &&
      job.recycling_scope_of_work.length === 4,
    JSON.stringify({
      cat: job?.recycling_material_category_id,
      sub: job?.recycling_material_subtype_id,
      qty: job?.recycling_quantity,
      unit: job?.recycling_unit,
      cond: job?.recycling_material_condition,
      scope: job?.recycling_scope_of_work,
    }),
  );
  const jobId = job?.id;

  // -------------------------------------------------------------------
  // 2) Admin onaylamadan önce: yetkili olsa bile hiç kimse göremez.
  // -------------------------------------------------------------------
  await adminClient.rpc("authorize_provider_service", { p_provider_id: authorizedProvider.id, p_service_category_id: CATEGORY, p_reason: "test" });
  const { data: beforeApproval } = await authorizedProvider.client.from("jobs").select("id").eq("id", jobId).maybeSingle();
  record("2. Admin onaylamadan önce yetkili firma bile ilanı GÖREMİYOR (moderation gate)", !beforeApproval, JSON.stringify(beforeApproval));

  // -------------------------------------------------------------------
  // 3) Admin onaylar; yetkisiz firma HÂLÂ göremez (authorization gate, ayrı katman).
  // -------------------------------------------------------------------
  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  record("3a. Admin onayı başarılı", !approveError, approveError?.message);
  const { data: unauthorizedView } = await unauthorizedProvider.client.from("jobs").select("id").eq("id", jobId).maybeSingle();
  record("3b. Admin onayından SONRA bile yetkisiz firma ilanı GÖREMİYOR (service authorization gate)", !unauthorizedView, JSON.stringify(unauthorizedView));

  // -------------------------------------------------------------------
  // 4) Yetkili firma artık görebilir ve NORMAL create_offer ile teklif verebilir.
  // -------------------------------------------------------------------
  const { data: authorizedView } = await authorizedProvider.client.from("jobs").select("id, category_id").eq("id", jobId).maybeSingle();
  record("4a. Yetkilendirilmiş firma admin onayından sonra ilanı görüyor", authorizedView?.id === jobId, JSON.stringify(authorizedView));

  const { data: offer, error: offerError } = await authorizedProvider.client.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 24000,
    p_currency: "TRY",
    p_description: "Bu işi 24.000 TL'ye gerçekleştiririm. Ekip ve ekipmanımız hazır, sahadan toplama dahil tüm kapsamı karşılıyoruz.",
  });
  record("4b. Normal create_offer başarılı (mevcut hizmet teklifi, hiçbir özel dal yok)", !offerError, offerError?.message);
  record(
    "4c. Teklif tutarı TAM gönderildiği gibi kaydedildi (24000 TL, ters/alım-teklifi hesaplaması YOK)",
    Number(offer?.amount) === 24000 && offer?.currency === "TRY" && offer?.status === "pending",
    JSON.stringify({ amount: offer?.amount, currency: offer?.currency, status: offer?.status }),
  );
  const offerColumns = psql(`select string_agg(column_name, ',') from information_schema.columns where table_schema='public' and table_name='offers';`);
  record(
    "4d. offers tablosunda unit_price/purchase_price/offer_direction gibi HİÇBİR yeni kolon yok",
    !/unit_price|purchase_price|offer_direction/.test(offerColumns),
    offerColumns,
  );

  // -------------------------------------------------------------------
  // 5) Çoklu operasyon: Geri Dönüşüm & Atık Tahliye + Forklift birlikte.
  // -------------------------------------------------------------------
  const { data: operation, error: opError } = await requester.client.rpc("create_operation_with_jobs", {
    p_province: "Kocaeli",
    p_operation_details: "",
    p_services: [
      {
        category_id: CATEGORY,
        title: "RecyTest Operasyon — Geri Dönüşüm",
        description: "Operasyon test açıklaması — Geri Dönüşüm hizmeti.",
        district: "Gebze",
        work_location_type: "Test Sahası",
        address_text: "Test Adresi, Gebze",
        work_date: "2026-12-05",
        recycling_material_category_id: "plastik",
        recycling_material_subtype_id: "pe",
        recycling_quantity: 500,
        recycling_unit: "kg",
        recycling_material_condition: "ayristirilmis",
        recycling_scope_of_work: ["sahadan-toplama", "tasima"],
      },
      {
        category_id: "forklift",
        title: "RecyTest Operasyon — Forklift",
        description: "Operasyon test açıklaması — Forklift hizmeti.",
        district: "Gebze",
        work_location_type: "Test Sahası",
        address_text: "Test Adresi, Gebze",
        work_date: "2026-12-05",
      },
    ],
    p_photos_by_service_index: { "0": fakePhotos(), "1": fakePhotos() },
  });
  record("5a. create_operation_with_jobs başarılı (Geri Dönüşüm + Forklift)", !opError, opError?.message);
  const opJobIds = operation?.job_ids ?? [];
  record("5b. İki bağımsız Job oluştu", opJobIds.length === 2, JSON.stringify(opJobIds));
  if (opJobIds.length === 2) {
    const rows = psql(
      `select category_id, recycling_material_category_id, recycling_scope_of_work from public.jobs where id in ('${opJobIds[0]}','${opJobIds[1]}') order by category_id;`,
    );
    record(
      "5c. recycling_* alanları YALNIZCA Geri Dönüşüm kardeşinde dolu, Forklift kardeşinde NULL",
      /geri-donusum-atik-tahliye\|plastik/.test(rows) && /forklift\|\|/.test(rows.replace(/\|(NULL)?$/gm, "|")),
      rows,
    );
  }

  // -------------------------------------------------------------------
  // 6) CHECK kısıtları geçersiz değerleri reddediyor.
  // -------------------------------------------------------------------
  const { error: invalidUnitError } = await requester.client.rpc("create_job", {
    p_category_id: CATEGORY,
    p_title: "RecyTest — Geçersiz Birim",
    p_description: "Bu ilan asla oluşmamalı.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Sahası",
    p_work_date: "2026-12-01",
    p_photos: fakePhotos(),
    p_address_text: "Test Adresi",
    p_recycling_unit: "litre",
  });
  record("6a. Geçersiz recycling_unit ('litre') CHECK ihlaliyle reddedildi", Boolean(invalidUnitError), invalidUnitError?.message);

  const { error: invalidScopeError } = await requester.client.rpc("create_job", {
    p_category_id: CATEGORY,
    p_title: "RecyTest — Geçersiz Kapsam",
    p_description: "Bu ilan asla oluşmamalı.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Sahası",
    p_work_date: "2026-12-01",
    p_photos: fakePhotos(),
    p_address_text: "Test Adresi",
    p_recycling_scope_of_work: ["ucma"],
  });
  record("6b. Geçersiz recycling_scope_of_work (['ucma']) CHECK ihlaliyle reddedildi", Boolean(invalidScopeError), invalidScopeError?.message);

  // -------------------------------------------------------------------
  // 7) update_job_as_admin ile admin recycling alanlarını düzenleyebiliyor.
  // -------------------------------------------------------------------
  const { data: updated, error: updateError } = await adminClient.rpc("update_job_as_admin", {
    p_job_id: jobId,
    p_title: job.title,
    p_description: job.description,
    p_province: job.province,
    p_district: job.district,
    p_work_location_type: job.work_location_type,
    p_address_text: job.address_text,
    p_work_date: job.work_date,
    p_recycling_material_condition: "diger",
    p_recycling_material_condition_note: "Admin tarafından düzeltildi (test).",
  });
  record("7a. update_job_as_admin başarılı", !updateError, updateError?.message);
  record(
    "7b. recycling_material_condition güncellendi, DOKUNULMAYAN diğer recycling alanları (coalesce) KORUNDU",
    updated?.recycling_material_condition === "diger" &&
      updated?.recycling_material_condition_note === "Admin tarafından düzeltildi (test)." &&
      updated?.recycling_material_category_id === "metal-hurda" &&
      Number(updated?.recycling_quantity) === 8,
    JSON.stringify({
      cond: updated?.recycling_material_condition,
      note: updated?.recycling_material_condition_note,
      cat: updated?.recycling_material_category_id,
      qty: updated?.recycling_quantity,
    }),
  );
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      psql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})));`);
      psql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      psql(`delete from public.notifications where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})));`);
      psql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      psql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      psql(`delete from public.audit_logs where actor_id in (${idList});`);
      psql(`delete from public.jobs where requester_id in (${idList});`);
      psql(`delete from public.notifications where recipient_id in (${idList});`);
    } catch (error) {
      console.error("cleanup sql failed (continuing):", error?.message || error);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
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
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
