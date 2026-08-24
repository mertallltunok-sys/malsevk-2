// node scripts/tmp-cleanup-source-of-truth-test-data.mjs
// Tek seferlik temizlik betiği — "İlanları ve Firma Profillerini Supabase'e
// Tam Bağla, MERSİS Tekilliğini Uygula" görevinin test koşularında (birden
// fazla stamp/run) oluşan TÜM malsevk-sot-*@gmail.com test hesaplarını ve
// bunlara bağlı ilan/Storage/yetki verilerini siler. Yalnızca Development.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-sot-cleanup-"));
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

async function run() {
  console.log("--- Test kullanıcıları listeleniyor ---");
  const users = runSql(`select id, email from auth.users where email ilike 'malsevk-sot-%@gmail.com' order by email;`);
  console.log(`${users.length} test hesabı bulundu.`);
  if (users.length === 0) {
    console.log("Temizlenecek bir şey yok.");
    return;
  }

  console.log("--- Storage (job-photos) temizleniyor (her kullanıcı kendi RLS izniyle) ---");
  let storageCleaned = 0;
  for (const user of users) {
    const client = freshClient();
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
    if (error) {
      // Bazı test hesapları (ör. eşzamanlı MERSİS testinin kaybeden tarafı,
      // ya da complete_registration hiç çağrılmamış bir hesap) hâlâ giriş
      // yapabilir olmalı (signUp zaten başarılıydı) — yine de olası bir
      // giriş hatası burada TÜM betiği durdurmasın, yalnızca bu kullanıcının
      // Storage temizliği atlanır (DB satırları aşağıda yine de silinecek).
      console.log(`  (uyarı) ${user.email} için giriş başarısız, Storage temizliği atlandı: ${error.message}`);
      continue;
    }
    await removeAllUnderFolder(client, "job-photos", user.id);
    storageCleaned += 1;
    await client.auth.signOut();
  }
  console.log(`${storageCleaned}/${users.length} kullanıcı için Storage temizliği denendi.`);

  const remainingStorage = runSql(
    `select count(*) as n from storage.objects where (storage.foldername(name))[1] in (select id::text from auth.users where email ilike 'malsevk-sot-%@gmail.com');`,
  )[0];
  console.log(`Kalan test Storage nesnesi: ${remainingStorage?.n}`);

  console.log("--- Veritabanı satırları FK-güvenli sırayla siliniyor ---");
  // Sıra, public.profiles(id) ve public.jobs(id)'ye NO ACTION ile referans
  // veren her tablo için information_schema sorgusuyla doğrulandı (bkz.
  // görüşme geçmişi) — CASCADE/SET NULL olan tablolar auth.users silmesiyle
  // otomatik halledilir, burada yalnızca NO ACTION olanlar elle silinir.
  runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com'));`);
  runSql(`delete from public.ratings where job_id in (select id from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com')) or provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com') or rater_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com')) or provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.notifications where job_id in (select id from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com'));`);
  runSql(`delete from public.recently_viewed_jobs where job_id in (select id from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com'));`);
  runSql(`update public.jobs set republished_from_job_id = null, republished_to_job_id = null where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.jobs where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.operations where requester_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_document_reviews where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_documents where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_badges where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_recycling_waste_code_authorizations where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_storage_risk_authorizations where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);
  runSql(`delete from public.provider_service_authorizations where provider_id in (select id from auth.users where email ilike 'malsevk-sot-%@gmail.com');`);

  console.log("--- auth.users siliniyor (profiles + CASCADE/SET NULL alanlar otomatik) ---");
  for (const user of users) {
    try {
      runSql(`delete from auth.users where id = '${user.id}';`);
    } catch (e) {
      console.error(`  HATA: ${user.email} silinemedi: ${e.message}`);
    }
  }

  console.log("--- Doğrulama ---");
  const final = runSql(
    `select
      (select count(*) from auth.users where email ilike 'malsevk-sot-%@gmail.com') as remaining_users,
      (select count(*) from public.profiles where id not in (select id from auth.users)) as orphan_profiles,
      (select count(*) from storage.objects where bucket_id = 'job-photos' and (storage.foldername(name))[1] not in (select id::text from auth.users)) as orphan_storage_all_time;
    `,
  )[0];
  console.log(JSON.stringify(final, null, 2));
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
