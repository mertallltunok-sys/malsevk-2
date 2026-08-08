// MALSEVK — Admin Paneli Faz 3 "Sistem Beslemesi" Playwright doğrulaması için
// yerel Docker Supabase seed script'i. tmp-admin-panel-phase2-seed-local.mjs
// İLE AYNI desen: gerçek auth kullanıcıları + gerçek RPC çağrılarıyla
// facility_candidates satırları oluşturur, sonucu JSON olarak stdout'a yazar
// (bir sonraki Playwright script'i bunu argüman olarak kullanır).
//
// Çalıştırma: node scripts/tmp-facility-candidates-seed-local.mjs
// Önkoşul: `npx supabase db reset` (0029 dahil).

import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = "supabase_db_malsevk-2";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Refusing to run: target URL is not local (safety guard).");
}

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, { encoding: "utf-8" }).trim();
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
const ts = Date.now();

async function makeUser(email) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`createUser(${email}): ${created.error.message}`);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn(${email}): ${signIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

const requester = await makeUser(`fc-seed-a-${ts}@example.com`);
const adminUser = await makeUser(`fc-seed-admin-${ts}@example.com`);

const regRequester = await requester.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Seed Requester", p_phone: "+905551119911",
  p_company_name: "Seed Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
if (regRequester.error) throw new Error(`requester registration: ${regRequester.error.message}`);

const regAdmin = await adminUser.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Seed Admin", p_phone: "+905551119912",
  p_company_name: "Seed Admin Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
if (regAdmin.error) throw new Error(`admin registration: ${regAdmin.error.message}`);
psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);

// Grup 1: 3 benzer yazım (liste + onay akışı için) — tier-1/tier-2 gruplama
// gerçek RPC üzerinden test edilmiş zaten (bkz. tmp-supabase-facility-
// candidates-test.mjs); burada amaç YALNIZCA tarayıcı UI'sinin doğru veriyi
// gösterip doğru aksiyonu tetiklediğini doğrulamak.
const spellings1 = ["Playwright Test Port", "playwrighttestport", "Playwright Test Port İşletmesi"];
let candidate1Id = null;
for (const raw of spellings1) {
  const res = await requester.client.rpc("submit_facility_candidate_entry", {
    p_raw_text: raw, p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
  });
  if (res.error) throw new Error(`submit(${raw}): ${res.error.message}`);
  candidate1Id = res.data;
}

// Grup 2: reddedilecek anlamsız girdi.
const junk = await requester.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "zzxxzzxx", p_province: "Kocaeli", p_district: null, p_source: "job_pickup_location",
});
if (junk.error) throw new Error(`submit(junk): ${junk.error.message}`);
const candidate2Id = junk.data;

console.log("\n=== Seed complete ===");
console.log(
  JSON.stringify(
    { admin: { email: adminUser.email, password: PASSWORD }, candidates: { toApprove: candidate1Id, toReject: candidate2Id } },
    null,
    2,
  ),
);
