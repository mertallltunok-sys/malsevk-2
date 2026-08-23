// Konteyner Depolama "Konteyner Bilgileri" (storage_container_count/size/
// status/content) — RPC + DB seviyesinde doğrudan doğrulama. Playwright DEĞİL
// (bkz. CLAUDE.md "tmp-supabase-*.mjs" kalıbı): gerçek create_job/
// update_job_as_admin/update_job_as_requester RPC'lerini gerçek bir
// Supabase Auth oturumuyla çağırır, sonucu doğrudan Postgres'ten (pooler)
// okuyarak kanıtlar. Development projesine (trfnmpihcnriqgikglpu) karşı
// çalışır. Gerekli env: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY,
// NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD, SUPABASE_DB_PASSWORD (.env.local).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
function envVar(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const DEMO_PASSWORD = envVar("NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD");

// Bu proje `pg`yi bir bağımlılık olarak taşımıyor (yalnızca test scaffolding
// scratchpad'inde var) — doğrudan SQL, aynı scratchpad'deki `run-sql.mjs`
// process olarak çağrılarak çalıştırılır (ikinci bir DB istemcisi
// İCAT EDİLMEDİ, mevcut olan yeniden kullanılır).
const RUN_SQL_PATH = "C:/Users/merta/AppData/Local/Temp/claude/c--Users-merta-malsevk-2/9e4157e5-e75d-4ce8-b194-55c7c3eac189/scratchpad/pg-scratch/run-sql.mjs";
const pgClient = {
  async query(sql, params = []) {
    let finalSql = sql;
    params.forEach((value, index) => {
      const literal = value === null ? "null" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
      finalSql = finalSql.replaceAll(`$${index + 1}`, literal);
    });
    const output = execFileSync("node", [RUN_SQL_PATH, finalSql], { encoding: "utf8" });
    return { rows: JSON.parse(output) };
  },
  async end() {},
};

let passCount = 0;
let failCount = 0;
function check(label, condition, extra) {
  if (condition) {
    passCount++;
    console.log(`  OK   ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL ${label}`, extra ?? "");
  }
}

async function fetchJobRow(jobId) {
  const result = await pgClient.query(
    `select id, category_id, storage_container_count, storage_container_size,
            storage_container_status, storage_container_content, moderation_status
       from public.jobs where id = $1`,
    [jobId],
  );
  return result.rows[0];
}

const requesterClient = createClient(SUPABASE_URL, ANON_KEY);
{
  const { error } = await requesterClient.auth.signInWithPassword({
    email: "ilanveren@demo.test",
    password: DEMO_PASSWORD,
  });
  if (error) throw new Error(`ilanveren@demo.test giriş başarısız: ${error.message}`);
}

const basePayload = {
  p_category_id: "konteyner-depolama",
  p_title: "RPC Test — Konteyner Depolama",
  p_description: "tmp-supabase-storage-container-rpc-test.mjs tarafından oluşturuldu — otomatik test job'u.",
  p_operation_details: "",
  p_province: "Kocaeli",
  p_district: "Gebze",
  p_work_location_type: "Test Depo",
  p_work_date: "2026-09-01",
  p_photos: [
    { storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 },
  ],
};

console.log("\n=== Senaryo 1: Tam değerli gönderim (75 + 40ft + Dolu + Rulo Sac) ===");
let job1Id;
{
  const { data, error } = await requesterClient.rpc("create_job", {
    ...basePayload,
    p_storage_container_count: 75,
    p_storage_container_size: "40",
    p_storage_container_status: "dolu",
    p_storage_container_content: "Rulo Sac",
  });
  check("create_job hata vermedi", !error, error?.message);
  job1Id = data?.id;
  const row = job1Id ? await fetchJobRow(job1Id) : null;
  check("storage_container_count = 75", row?.storage_container_count === 75, row?.storage_container_count);
  check("storage_container_size = '40'", row?.storage_container_size === "40", row?.storage_container_size);
  check("storage_container_status = 'dolu'", row?.storage_container_status === "dolu", row?.storage_container_status);
  check("storage_container_content = 'Rulo Sac'", row?.storage_container_content === "Rulo Sac", row?.storage_container_content);
  check("moderation_status = 'pending_review'", row?.moderation_status === "pending_review", row?.moderation_status);
}

console.log("\n=== Senaryo 2: Boş gönderim (4 alan da girilmedi) ===");
let job2Id;
{
  const { data, error } = await requesterClient.rpc("create_job", {
    ...basePayload,
    p_title: "RPC Test — Konteyner Depolama (boş alanlar)",
  });
  check("create_job hata vermedi (boş alanlarla)", !error, error?.message);
  job2Id = data?.id;
  const row = job2Id ? await fetchJobRow(job2Id) : null;
  check("storage_container_count = null", row?.storage_container_count === null, row?.storage_container_count);
  check("storage_container_size = null", row?.storage_container_size === null, row?.storage_container_size);
  check("storage_container_status = null", row?.storage_container_status === null, row?.storage_container_status);
  check("storage_container_content = null", row?.storage_container_content === null, row?.storage_container_content);
}

console.log("\n=== Senaryo 3: RPC seviyesinde INSERT-anı 'dolu değilse içerik asla yazılmaz' güvenlik ağı ===");
{
  const { data, error } = await requesterClient.rpc("create_job", {
    ...basePayload,
    p_title: "RPC Test — status=bos ama content gönderildi",
    p_storage_container_status: "bos",
    p_storage_container_content: "Bu içerik asla kaydedilmemeli",
  });
  check("create_job hata vermedi", !error, error?.message);
  const row = data?.id ? await fetchJobRow(data.id) : null;
  check("status='bos' iken content INSERT anında null'a düştü", row?.storage_container_content === null, row?.storage_container_content);
}

console.log("\n=== Senaryo 4: update_job_as_requester ile Dolu -> Boş geçişinde İçerik temizleniyor mu (coalesce tuzağı) ===");
{
  // job1Id hâlâ 'dolu' + 'Rulo Sac' taşıyor (Senaryo 1'den). Admin onayından
  // önce (moderation_status hâlâ pending_review) requester kendi ilanını
  // update_job_as_requester ile düzenleyebilir.
  const before = await fetchJobRow(job1Id);
  check("ön koşul: job1 hâlâ dolu + Rulo Sac taşıyor", before?.storage_container_status === "dolu" && before?.storage_container_content === "Rulo Sac");

  const { error } = await requesterClient.rpc("update_job_as_requester", {
    p_job_id: job1Id,
    p_title: before.title ?? "RPC Test — Konteyner Depolama",
    p_description: "Dolu->Boş geçiş testi",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_address_text: "",
    p_work_date: "2026-09-01",
    p_storage_container_count: 75,
    p_storage_container_size: "40",
    p_storage_container_status: "bos",
    p_storage_container_content: null,
  });
  check("update_job_as_requester hata vermedi", !error, error?.message);
  const after = await fetchJobRow(job1Id);
  check("status artık 'bos'", after?.storage_container_status === "bos", after?.storage_container_status);
  check("İçerik gerçekten temizlendi (coalesce eski değeri geri getirmedi)", after?.storage_container_content === null, after?.storage_container_content);
  check("count/size korundu (yalnızca status/content değişti)", after?.storage_container_count === 75 && after?.storage_container_size === "40");
}

console.log("\n=== Senaryo 5: Admin onayı + admin edit ile Dolu -> Boş (asıl yetkili yol, localStorage fallback'i YOK) ===");
let adminClient;
let job5Id;
{
  // Taze bir test admin hesabı oluştur (gerçek admin şifrelerini bilmiyoruz).
  const adminEmail = `tmp-storage-container-admin-${Date.now()}@example.com`;
  const adminPassword = "TestAdmin123!";
  const signUpResult = await requesterClient.auth.signUp({ email: adminEmail, password: adminPassword });
  if (signUpResult.error) throw new Error(`admin signUp başarısız: ${signUpResult.error.message}`);
  const adminUserId = signUpResult.data.user?.id;
  await pgClient.query("update public.profiles set role = 'admin', onboarding_completed = true where id = $1", [adminUserId]);

  adminClient = createClient(SUPABASE_URL, ANON_KEY);
  const signInResult = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (signInResult.error) throw new Error(`admin signIn başarısız: ${signInResult.error.message}`);

  // job1Id üzerinde devam: önce admin onaylasın (approve_job_as_admin),
  // sonra Dolu'ya geri alıp içerik yazsın, sonra tekrar Boş'a çevirip
  // içeriğin GERÇEKTEN kaybolduğunu (onay SONRASI da) kanıtlasın.
  job5Id = job1Id;
  const approveResult = await adminClient.rpc("approve_job_as_admin", { p_job_id: job5Id });
  check("approve_job_as_admin hata vermedi", !approveResult.error, approveResult.error?.message);
  const afterApprove = await fetchJobRow(job5Id);
  check("moderation_status artık 'approved'", afterApprove?.moderation_status === "approved", afterApprove?.moderation_status);

  const setDoluResult = await adminClient.rpc("update_job_as_admin", {
    p_job_id: job5Id,
    p_title: afterApprove.title ?? "RPC Test — Konteyner Depolama",
    p_description: "Admin: Boş->Dolu",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_address_text: "",
    p_work_date: "2026-09-01",
    p_storage_container_count: 12,
    p_storage_container_size: "20",
    p_storage_container_status: "dolu",
    p_storage_container_content: "Admin sonrası içerik",
  });
  check("admin update (Boş->Dolu) hata vermedi", !setDoluResult.error, setDoluResult.error?.message);
  const doluRow = await fetchJobRow(job5Id);
  check("admin yazımından sonra status='dolu' ve content dolu", doluRow?.storage_container_status === "dolu" && doluRow?.storage_container_content === "Admin sonrası içerik");

  const setBosResult = await adminClient.rpc("update_job_as_admin", {
    p_job_id: job5Id,
    p_title: doluRow.title ?? "RPC Test — Konteyner Depolama",
    p_description: "Admin: Dolu->Boş (onay SONRASI)",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_address_text: "",
    p_work_date: "2026-09-01",
    p_storage_container_count: 12,
    p_storage_container_size: "20",
    p_storage_container_status: "bos",
    p_storage_container_content: null,
  });
  check("admin update (Dolu->Boş) hata vermedi", !setBosResult.error, setBosResult.error?.message);
  const finalRow = await fetchJobRow(job5Id);
  check("ONAY SONRASI admin Dolu->Boş: içerik GERÇEKTEN temizlendi", finalRow?.storage_container_content === null, finalRow?.storage_container_content);
  check("ONAY SONRASI admin Dolu->Boş: status='bos' kalıcı", finalRow?.storage_container_status === "bos", finalRow?.storage_container_status);
  check("count/size admin yazımından sonra da korunuyor", finalRow?.storage_container_count === 12 && finalRow?.storage_container_size === "20");
}

console.log("\n=== Senaryo 6: CHECK kısıtları — geçersiz değerler doğrudan SQL ile bile reddediliyor mu ===");
{
  try {
    await pgClient.query(
      "update public.jobs set storage_container_size = '30' where id = $1",
      [job2Id],
    );
    check("geçersiz size ('30') CHECK tarafından reddedildi", false, "beklenmedik şekilde başarılı oldu");
  } catch (err) {
    check("geçersiz size ('30') CHECK tarafından reddedildi", /jobs_storage_container_size_valid/.test(String(err.message ?? err)), err.message);
  }
  try {
    await pgClient.query(
      "update public.jobs set storage_container_status = 'bos', storage_container_content = 'zorla yazıldı' where id = $1",
      [job2Id],
    );
    check("status != 'dolu' iken content CHECK tarafından reddedildi", false, "beklenmedik şekilde başarılı oldu");
  } catch (err) {
    check("status != 'dolu' iken content CHECK tarafından reddedildi", /jobs_storage_container_content_requires_dolu/.test(String(err.message ?? err)), err.message);
  }
  try {
    await pgClient.query("update public.jobs set storage_container_count = -5 where id = $1", [job2Id]);
    check("negatif count CHECK tarafından reddedildi", false, "beklenmedik şekilde başarılı oldu");
  } catch (err) {
    check("negatif count CHECK tarafından reddedildi", /jobs_storage_container_count_positive/.test(String(err.message ?? err)), err.message);
  }
}

console.log("\n=== Senaryo 7: create_operation_with_jobs — çoklu hizmet izolasyonu (Konteyner Depolama + Nakliye) ===");
{
  // Node'da @supabase/supabase-js'in varsayılan bellek-içi auth storage'ı
  // proje referansına göre anahtarlanır — Senaryo 5'te AYRI bir adminClient
  // ile signIn yapmak requesterClient'ın oturumunun ÜZERİNE yazar (ikisi de
  // aynı storage anahtarını paylaşır). Bu YALNIZCA bu test script'inin kendi
  // bir kısıtı, RPC/migration'ın kendisiyle ilgisi yok — burada basitçe
  // requesterClient'ı yeniden oturum açarak düzeltiyoruz.
  const { error: reAuthError } = await requesterClient.auth.signInWithPassword({
    email: "ilanveren@demo.test",
    password: DEMO_PASSWORD,
  });
  if (reAuthError) throw new Error(`ilanveren@demo.test yeniden giriş başarısız: ${reAuthError.message}`);
  const clientOperationId = crypto.randomUUID();
  const services = [
    {
      category_id: "konteyner-depolama",
      title: "Operasyon — Konteyner Depolama servisi",
      description: "izolasyon testi",
      district: "Gebze",
      work_location_type: "Test Depo",
      location_mode: "catalog",
      address_text: "",
      work_date: "2026-09-05",
      storage_container_count: "30",
      storage_container_size: "45",
      storage_container_status: "dolu",
      storage_container_content: "Operasyon içeriği",
    },
    {
      category_id: "nakliye",
      title: "Operasyon — Nakliye servisi",
      description: "izolasyon testi (Konteyner alanları OLMAMALI)",
      district: "Gebze",
      work_location_type: "Test Depo",
      location_mode: "catalog",
      address_text: "",
      work_date: "2026-09-05",
    },
  ];
  const photosByServiceIndex = {
    0: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    1: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
  };
  const { data, error } = await requesterClient.rpc("create_operation_with_jobs", {
    p_province: "Kocaeli",
    p_operation_details: "",
    p_services: services,
    p_photos_by_service_index: photosByServiceIndex,
    p_client_operation_id: clientOperationId,
  });
  check("create_operation_with_jobs hata vermedi", !error, error?.message);
  const jobIds = data?.job_ids ?? [];
  check("2 job oluşturuldu", jobIds.length === 2, jobIds.length);
  if (jobIds.length === 2) {
    const rowA = await fetchJobRow(jobIds[0]);
    const rowB = await fetchJobRow(jobIds[1]);
    const konteynerRow = rowA.category_id === "konteyner-depolama" ? rowA : rowB;
    const nakliyeRow = rowA.category_id === "konteyner-depolama" ? rowB : rowA;
    check("Konteyner Depolama servisi kendi 4 alanını taşıyor", konteynerRow.storage_container_count === 30 && konteynerRow.storage_container_size === "45" && konteynerRow.storage_container_status === "dolu" && konteynerRow.storage_container_content === "Operasyon içeriği");
    check("Nakliye kardeşine SIZMADI (4 alan da null)", nakliyeRow.storage_container_count === null && nakliyeRow.storage_container_size === null && nakliyeRow.storage_container_status === null && nakliyeRow.storage_container_content === null);
  }
}

console.log("\n=== Senaryo 8: Regresyon — Nakliye/genel Depolama gibi ilgisiz kategoriler container param olmadan hâlâ çalışıyor ===");
{
  const { error } = await requesterClient.rpc("create_job", {
    ...basePayload,
    p_category_id: "nakliye",
    p_title: "RPC Test — Nakliye (regresyon)",
  });
  check("Nakliye job'u container parametreleri olmadan hatasız oluşturuldu", !error, error?.message);
}

console.log(`\n=== SONUÇ: ${passCount} geçti, ${failCount} başarısız ===`);
await pgClient.end();
process.exit(failCount > 0 ? 1 : 0);
