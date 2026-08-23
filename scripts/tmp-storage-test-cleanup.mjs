// Önceki başarısız (browser.close() öncesi çöken) test koşularından kalan
// depotest-* hesaplarını ve ilanlarını temizler.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

async function main() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const testUsers = data.users.filter((u) => u.email?.startsWith("depotest-"));
  console.log(`Bulunan depotest-* hesap sayısı: ${testUsers.length}`);
  const ids = testUsers.map((u) => u.id);
  if (ids.length > 0) {
    const idList = ids.map((id) => `'${id}'`).join(",");
    runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})));`);
    runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    runSql(`delete from public.jobs where requester_id in (${idList});`);
    runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
    runSql(`delete from public.audit_logs where actor_id in (${idList});`);
    runSql(`delete from public.notifications where recipient_id in (${idList});`);
    for (const id of ids) {
      await admin.auth.admin.deleteUser(id).catch((e) => console.error(`deleteUser(${id}) failed:`, e.message));
    }
  }
  console.log("Temizlik tamamlandı.");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exitCode = 1;
});
