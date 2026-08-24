// node scripts/tmp-cleanup-development-kapanis-test-data.mjs
// "Development Kapanış Turu" görevinin test verilerini temizler:
// malsevk-dkt-*, malsevk-diag-*, ve stale tmp-supabase-suspend-enforcement-
// dev-test.mjs'nin kendi temizliği başarısız olan tek artakalan hesabı.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-dkt-cleanup-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { encoding: "utf8" });
  return JSON.parse(output).rows ?? [];
}
function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function removeAllUnderFolder(client, bucket, folder) {
  const { data: topEntries, error: listErr } = await client.storage.from(bucket).list(folder, { limit: 1000 });
  if (listErr || !topEntries) return;
  const filesAtTop = topEntries.filter((e) => e.id !== null).map((e) => `${folder}/${e.name}`);
  const subfolders = topEntries.filter((e) => e.id === null).map((e) => e.name);
  if (filesAtTop.length > 0) await client.storage.from(bucket).remove(filesAtTop);
  for (const sub of subfolders) {
    const { data: subEntries } = await client.storage.from(bucket).list(`${folder}/${sub}`, { limit: 1000 });
    const files = (subEntries ?? []).map((e) => `${folder}/${sub}/${e.name}`);
    if (files.length > 0) await client.storage.from(bucket).remove(files);
  }
}

const EMAIL_PATTERNS = ["malsevk-dkt-%@gmail.com", "malsevk-diag-%@gmail.com", "malsevk-contactviz-%@gmail.com"];
const EXTRA_USER_IDS = ["320323f6-adf1-4176-85b4-d934e0707a27"]; // stale tmp-supabase-suspend-enforcement-dev-test.mjs leftover (role hizmet-alan, confirmed no admin)

async function run() {
  const patternClauses = EMAIL_PATTERNS.map((p) => `email ilike '${p}'`).join(" or ");
  const idClause = EXTRA_USER_IDS.map((id) => `'${id}'`).join(", ");
  const whereUsers = `(${patternClauses}) or id in (${idClause})`;

  console.log("--- Test kullanıcıları listeleniyor ---");
  const users = runSql(`select id, email from auth.users where ${whereUsers} order by email;`);
  console.log(`${users.length} test hesabı bulundu.`);
  if (users.length === 0) {
    console.log("Temizlenecek bir şey yok.");
  } else {
    console.log("--- Storage (job-photos, provider-logos) temizleniyor ---");
    let storageCleaned = 0;
    for (const user of users) {
      const client = freshClient();
      const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
      if (error) {
        console.log(`  (uyarı) ${user.email} için giriş başarısız, Storage temizliği atlandı: ${error.message}`);
        continue;
      }
      await removeAllUnderFolder(client, "job-photos", user.id);
      await removeAllUnderFolder(client, "provider-logos", user.id);
      storageCleaned += 1;
      await client.auth.signOut();
    }
    console.log(`${storageCleaned}/${users.length} kullanıcı için Storage temizliği denendi.`);

    console.log("--- Veritabanı satırları FK-güvenli sırayla siliniyor ---");
    runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers}));`);
    runSql(`delete from public.ratings where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers})) or provider_id in (select id from auth.users where ${whereUsers}) or rater_id in (select id from auth.users where ${whereUsers});`);
    // offer_status_history.offer_id -> offers.id (NO ACTION) — bu turun gerçek
    // teklif yaşam döngüsü testleri (accept/start/complete) gerçek geçmiş
    // satırları yazdı, offers'tan ÖNCE silinmesi gerekiyor.
    runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers})) or provider_id in (select id from auth.users where ${whereUsers}));`);
    // notifications.offer_id -> offers.id de NO ACTION — aynı nedenle offers'tan önce.
    runSql(`delete from public.notifications where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers})) or provider_id in (select id from auth.users where ${whereUsers}));`);
    runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers})) or provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.notifications where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers}));`);
    runSql(`delete from public.recently_viewed_jobs where job_id in (select id from public.jobs where requester_id in (select id from auth.users where ${whereUsers}));`);
    runSql(`update public.jobs set republished_from_job_id = null, republished_to_job_id = null where requester_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.jobs where requester_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.operations where requester_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_document_reviews where provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_documents where provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_badges where provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_recycling_waste_code_authorizations where provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_storage_risk_authorizations where provider_id in (select id from auth.users where ${whereUsers});`);
    runSql(`delete from public.provider_service_authorizations where provider_id in (select id from auth.users where ${whereUsers});`);

    console.log("--- auth.users siliniyor (profiles + CASCADE/SET NULL alanlar otomatik) ---");
    for (const user of users) {
      try {
        runSql(`delete from auth.users where id = '${user.id}';`);
      } catch (e) {
        console.error(`  HATA: ${user.email} silinemedi: ${e.message}`);
      }
    }
  }

  console.log("--- Doğrulama ---");
  const final = runSql(
    `select
      (select count(*) from auth.users where ${whereUsers}) as remaining_users,
      (select count(*) from public.profiles where role = 'admin') as admin_count,
      (select count(*) from public.profiles where role = 'hizmet-alan') as hizmet_alan_count,
      (select count(*) from public.profiles where role = 'hizmet-veren') as hizmet_veren_count,
      (select count(*) from public.jobs) as total_jobs,
      (select count(*) from public.offers) as total_offers,
      (select count(*) from public.operations) as total_operations,
      (select count(*) from public.ratings) as total_ratings;
    `,
  )[0];
  console.log(JSON.stringify(final, null, 2));
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
