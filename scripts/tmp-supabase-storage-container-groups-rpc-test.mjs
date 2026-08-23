// Konteyner Depolama "Konteyner Grupları" (tekrarlanabilir alan grubu,
// storage_container_groups jsonb) — RPC + DB seviyesinde doğrudan
// doğrulama. Playwright DEĞİL (bkz. CLAUDE.md "tmp-supabase-*.mjs" kalıbı):
// gerçek create_job/update_job_as_admin/approve_job_as_admin RPC'lerini
// gerçek bir Supabase Auth oturumuyla çağırır, sonucu doğrudan Postgres'ten
// (pooler) okuyarak kanıtlar. Development projesine (trfnmpihcnriqgikglpu)
// karşı çalışır.
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

const RUN_SQL_PATH =
  "C:/Users/merta/AppData/Local/Temp/claude/c--Users-merta-malsevk-2/9e4157e5-e75d-4ce8-b194-55c7c3eac189/scratchpad/pg-scratch/run-sql.mjs";
function runSql(sql) {
  const out = execFileSync("node", [RUN_SQL_PATH, sql], { encoding: "utf8" });
  return JSON.parse(out);
}

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

function fetchJobGroups(jobId) {
  const rows = runSql(`select storage_container_groups, category_id, moderation_status from public.jobs where id = '${jobId}';`);
  return rows[0];
}

const requesterClient = createClient(SUPABASE_URL, ANON_KEY);
{
  const { error } = await requesterClient.auth.signInWithPassword({ email: "ilanveren@demo.test", password: DEMO_PASSWORD });
  if (error) throw new Error(`ilanveren@demo.test giriş başarısız: ${error.message}`);
}

const basePayload = {
  p_category_id: "konteyner-depolama",
  p_title: "RPC Grup Test — Konteyner Depolama",
  p_description: "tmp-supabase-storage-container-groups-rpc-test.mjs tarafından oluşturuldu.",
  p_operation_details: "",
  p_province: "Kocaeli",
  p_district: "Gebze",
  p_work_location_type: "Test Depo",
  p_work_date: "2026-09-01",
  p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
};

console.log("\n=== Senaryo 1: 3 grup — 20x20ft(Boş) + 15x40ft(Dolu, Rulo Sac) + 65x45ft(Dolu, Tehlikeli:UN1230/IMO3) — toplam 100 ===");
let jobId;
{
  const groups = [
    { id: "g1", quantity: 20, size: "20", type: "standart", status: "bos" },
    { id: "g2", quantity: 15, size: "40", type: "standart", status: "dolu", content: "Rulo Sac", grossWeight: 12.5 },
    { id: "g3", quantity: 65, size: "45", type: "high-cube", status: "dolu", content: "Kimyasal Varil", hazardous: true, unNumber: "UN1230", imoClass: "3" },
  ];
  const { data, error } = await requesterClient.rpc("create_job", { ...basePayload, p_storage_container_groups: groups });
  check("create_job hata vermedi", !error, error?.message);
  jobId = data?.id;
  const row = jobId ? fetchJobGroups(jobId) : null;
  const savedGroups = row?.storage_container_groups ?? [];
  check("3 grup da kaydedildi", savedGroups.length === 3, JSON.stringify(savedGroups));
  const total = savedGroups.reduce((sum, g) => sum + (g.quantity ?? 0), 0);
  check("toplam adet = 100 (20+15+65)", total === 100, total);
  const g2 = savedGroups.find((g) => g.id === "g2");
  const g3 = savedGroups.find((g) => g.id === "g3");
  check("g2 (Dolu) içeriği doğru kaydedildi", g2?.content === "Rulo Sac" && g2?.grossWeight === 12.5, JSON.stringify(g2));
  check("g3 (Dolu+Tehlikeli) UN/IMO doğru kaydedildi", g3?.hazardous === true && g3?.unNumber === "UN1230" && g3?.imoClass === "3", JSON.stringify(g3));
  check("moderation_status = 'pending_review'", row?.moderation_status === "pending_review", row?.moderation_status);
}

console.log("\n=== Senaryo 2: Boş grup (g1) içerik/tehlikeli madde bilgisi TAŞIMIYOR (izolasyon — başka grupla karışmadı) ===");
{
  const row = fetchJobGroups(jobId);
  const g1 = (row?.storage_container_groups ?? []).find((g) => g.id === "g1");
  check("g1 (Boş) content/hazardous alanları yok/null", !g1?.content && !g1?.hazardous, JSON.stringify(g1));
}

console.log("\n=== Senaryo 3: Admin — bir grubu düzenler, yeni grup ekler, bir grubu siler ===");
let adminClient;
{
  const adminEmail = `tmp-ctnr-groups-admin-${Date.now()}@example.com`;
  const adminPassword = "TestAdmin123!";
  const signUpResult = await requesterClient.auth.signUp({ email: adminEmail, password: adminPassword });
  if (signUpResult.error) throw new Error(`admin signUp başarısız: ${signUpResult.error.message}`);
  const adminUserId = signUpResult.data.user?.id;
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUserId}';`);

  adminClient = createClient(SUPABASE_URL, ANON_KEY);
  const signInResult = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (signInResult.error) throw new Error(`admin signIn başarısız: ${signInResult.error.message}`);

  // g1 (20x20ft Boş) -> 25 adede çıkar (düzenle), g2/g3 korunur, YENİ bir g4 eklenir, g3 SİLİNİR.
  const editedGroups = [
    { id: "g1", quantity: 25, size: "20", type: "standart", status: "bos" },
    { id: "g2", quantity: 15, size: "40", type: "standart", status: "dolu", content: "Rulo Sac", grossWeight: 12.5 },
    { id: "g4", quantity: 10, size: "45", type: "reefer", status: "dolu", content: "Dondurulmuş Gıda", reeferTemperature: -18, reeferElectrical: true },
  ];
  const before = fetchJobGroups(jobId);
  const { error: editError } = await adminClient.rpc("update_job_as_admin", {
    p_job_id: jobId,
    p_title: "RPC Grup Test — Konteyner Depolama (admin düzenledi)",
    p_description: "Admin: g1 düzenlendi, g3 silindi, g4 (reefer) eklendi",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_address_text: "",
    p_work_date: "2026-09-01",
    p_storage_container_groups: editedGroups,
  });
  check("update_job_as_admin (grup düzenleme) hata vermedi", !editError, editError?.message);
  const after = fetchJobGroups(jobId);
  const afterGroups = after?.storage_container_groups ?? [];
  check("admin düzenlemesinden sonra TAM OLARAK 3 grup var (g1 düzenlendi, g3 silindi, g4 eklendi)", afterGroups.length === 3, JSON.stringify(afterGroups));
  const g1After = afterGroups.find((g) => g.id === "g1");
  const g3After = afterGroups.find((g) => g.id === "g3");
  const g4After = afterGroups.find((g) => g.id === "g4");
  check("g1 adedi 25'e güncellendi", g1After?.quantity === 25, JSON.stringify(g1After));
  check("g3 gerçekten silindi", g3After === undefined);
  check("g4 (reefer) doğru eklendi (sıcaklık -18, elektrik true)", g4After?.reeferTemperature === -18 && g4After?.reeferElectrical === true, JSON.stringify(g4After));
  const totalAfter = afterGroups.reduce((sum, g) => sum + (g.quantity ?? 0), 0);
  check("yeni toplam = 50 (25+15+10)", totalAfter === 50, totalAfter);
}

console.log("\n=== Senaryo 4: Admin onayı SONRASI tüm grup bilgileri kayıpsız (approve_job_as_admin) ===");
{
  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  check("approve_job_as_admin hata vermedi", !approveError, approveError?.message);
  const row = fetchJobGroups(jobId);
  check("onay sonrası moderation_status = 'approved'", row?.moderation_status === "approved", row?.moderation_status);
  const groups = row?.storage_container_groups ?? [];
  check("onay sonrası hâlâ 3 grup, veri BOZULMADI", groups.length === 3, JSON.stringify(groups));
}

console.log("\n=== Senaryo 5: CHECK kısıtı — jsonb dizi olmayan bir değer doğrudan SQL ile bile reddediliyor ===");
{
  try {
    runSql(`update public.jobs set storage_container_groups = '{"not":"an array"}'::jsonb where id = '${jobId}';`);
    check("dizi olmayan jsonb CHECK tarafından reddedildi", false, "beklenmedik şekilde başarılı oldu");
  } catch (err) {
    check("dizi olmayan jsonb CHECK tarafından reddedildi", /jobs_storage_container_groups_is_array/.test(String(err.message ?? err)), err.message);
  }
}

console.log("\n=== Senaryo 6: Regresyon — Nakliye kategorisi container parametresi olmadan hâlâ çalışıyor ===");
{
  // Node'da @supabase/supabase-js'in varsayılan bellek-içi auth storage'ı
  // proje referansına göre anahtarlanır — Senaryo 3'te AYRI bir adminClient
  // ile signIn yapmak requesterClient'ın oturumunun ÜZERİNE yazar (ikisi de
  // aynı storage anahtarını paylaşır) — bkz. tmp-supabase-storage-container-
  // browser-test.mjs'teki AYNI, daha önce bulunan sorun. Basitçe yeniden
  // oturum açarak düzeltiyoruz.
  const { error: reAuthError } = await requesterClient.auth.signInWithPassword({ email: "ilanveren@demo.test", password: DEMO_PASSWORD });
  if (reAuthError) throw new Error(`ilanveren@demo.test yeniden giriş başarısız: ${reAuthError.message}`);
  const { error } = await requesterClient.rpc("create_job", { ...basePayload, p_category_id: "nakliye", p_title: "RPC Grup Test — Nakliye (regresyon)" });
  check("Nakliye job'u storage_container_groups olmadan hatasız oluşturuldu", !error, error?.message);
}

console.log(`\n=== SONUÇ: ${passCount} geçti, ${failCount} başarısız ===`);
process.exit(failCount > 0 ? 1 : 0);
