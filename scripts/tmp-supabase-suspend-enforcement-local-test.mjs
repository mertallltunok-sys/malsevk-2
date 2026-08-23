// LOCAL Docker Supabase only (--local) — pre-flight validation of migration
// 0042 (assert_active_user) before touching the real Development project.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + detail : ""));
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

async function signUpAndConfirm(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function signIn(email) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

const stamp = Date.now();
const requesterEmail = `test-requester-${stamp}@example.com`;
const providerEmail = `test-provider-${stamp}@example.com`;
const adminEmail = `test-admin-${stamp}@example.com`;

let requesterId, providerId, adminId, jobId, offerId;

try {
  requesterId = await signUpAndConfirm(requesterEmail);
  providerId = await signUpAndConfirm(providerEmail);
  adminId = await signUpAndConfirm(adminEmail);
  record("Test kullanıcıları oluşturuldu (requester/provider/admin)", true, `${requesterId}/${providerId}/${adminId}`);

  // Bootstrap admin role via direct DB access (docker exec psql) — service_role
  // has no REST access to public-schema tables even locally (documented,
  // known platform-level gap, not something this migration touches), so the
  // established "direct DB access, the only safe method" pattern is used.
  execSync(
    `docker exec supabase_db_malsevk-2 psql -U postgres -c "update public.profiles set role='admin', full_name='Test Admin', onboarding_completed=true where id = '${adminId}';"`,
    { stdio: "pipe" }
  );
  record("Admin bootstrap (doğrudan DB, docker exec psql)", true);

  const requesterClient = await signIn(requesterEmail);
  const providerClient = await signIn(providerEmail);
  const adminClient = await signIn(adminEmail);

  // Complete registration for requester + provider via the real RPC (not direct DB writes)
  {
    const { error } = await requesterClient.rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "Test Requester", p_phone: "+905321110001",
      p_company_name: "Test Requester Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit",
    });
    record("complete_registration (requester)", !error, error?.message);
  }
  {
    const { error } = await providerClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "Test Provider", p_phone: "+905321110002",
      p_company_name: "Test Provider Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("complete_registration (provider)", !error, error?.message);
  }

  // 1) ACTIVE requester -> create_job should PASS
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "Suspend testi ilan 1", p_description: "0042 smoke test job description, en az yirmi karakter.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
      p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }],
    });
    jobId = data?.id;
    record("1) ACTIVE requester create_job", !error && !!jobId, error?.message);
  }

  // 2) admin suspends the requester
  {
    const { error } = await adminClient.rpc("suspend_user", { p_user_id: requesterId, p_reason: "0042 smoke test suspend" });
    record("2) Admin suspend_user(requester)", !error, error?.message);
  }

  // 3) SAME session/JWT, no re-login -> create_job must now FAIL with ML127
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "Suspend testi ilan 2 (should fail)", p_description: "0042 smoke test job description, en az yirmi karakter.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
      p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }],
    });
    const code = error?.message?.includes("ML127");
    record("3) SUSPENDED (same session) create_job FAILS with ML127", !!error && code, error ? error.message : "unexpectedly succeeded: " + JSON.stringify(data));
  }

  // 3b) direct RPC via a fresh anon-keyed client using the SAME access token (simulates raw JWT replay, bypassing app UI)
  {
    const { data: sessionData } = await requesterClient.auth.getSession();
    const rawClient = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
    await rawClient.auth.setSession({ access_token: sessionData.session.access_token, refresh_token: sessionData.session.refresh_token });
    const { error } = await rawClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "Direct RPC replay (should fail)", p_description: "0042 smoke test job description, en az yirmi karakter.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
      p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }],
    });
    record("3b) Direct RPC replay with suspended JWT FAILS with ML127", !!error && error.message.includes("ML127"), error?.message);
  }

  // 4) admin reinstates
  {
    const { error } = await adminClient.rpc("reinstate_user", { p_user_id: requesterId });
    record("4) Admin reinstate_user(requester)", !error, error?.message);
  }

  // 5) SAME session again -> create_job should PASS again
  {
    const { data, error } = await requesterClient.rpc("create_job", {
      p_category_id: "kapali-depolama", p_title: "Suspend testi ilan 3 (reinstated)", p_description: "0042 smoke test job description, en az yirmi karakter.",
      p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
      p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      p_photos: [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }],
    });
    record("5) REINSTATED (same session) create_job PASSES again", !error && !!data?.id, error?.message);
  }

  // Now the same active/suspend/reinstate cycle for a hizmet-veren via create_offer
  {
    const { error } = await providerClient.rpc("set_provider_service_categories", { p_category_ids: ["kapali-depolama"] });
    record("Provider set_provider_service_categories", !error, error?.message);
  }
  {
    const { error } = await adminClient.rpc("authorize_provider_service", { p_provider_id: providerId, p_service_category_id: "kapali-depolama", p_reason: "0042 smoke test authorize" });
    record("Admin authorize_provider_service(provider, kapali-depolama)", !error, error?.message);
  }
  let providerOfferJobId = jobId;
  {
    const { error } = await adminClient.rpc("approve_job_as_admin", { p_job_id: providerOfferJobId });
    record("Admin approve_job_as_admin(job) so it accepts offers", !error, error?.message);
  }
  {
    const { data, error } = await providerClient.rpc("create_offer", { p_job_id: providerOfferJobId, p_amount: 1000, p_currency: "TRY", p_description: "0042 smoke test offer description, en az yirmi karakter." });
    offerId = data?.id;
    record("6) ACTIVE provider create_offer", !error && !!offerId, error?.message);
  }
  {
    const { error } = await adminClient.rpc("suspend_user", { p_user_id: providerId, p_reason: "0042 smoke test suspend provider" });
    record("7) Admin suspend_user(provider)", !error, error?.message);
  }
  {
    const { data, error } = await providerClient.rpc("create_offer", { p_job_id: providerOfferJobId, p_amount: 1200, p_currency: "TRY", p_description: "0042 smoke test offer description 2, en az yirmi karakter." });
    record("8) SUSPENDED provider create_offer FAILS with ML127", !!error && error.message.includes("ML127"), error ? error.message : "unexpectedly succeeded: " + JSON.stringify(data));
  }
  {
    const { error } = await adminClient.rpc("reinstate_user", { p_user_id: providerId });
    record("9) Admin reinstate_user(provider)", !error, error?.message);
  }
  {
    // withdraw the still-pending offer from step 6 first — otherwise the
    // pre-existing offers_one_blocking_per_job_provider constraint (unrelated
    // to this migration) rejects a second offer from the same provider on
    // the same job, which would be a false negative here.
    const { error } = await providerClient.rpc("withdraw_offer", { p_offer_id: offerId });
    record("Withdraw prior pending offer before re-offering", !error, error?.message);
  }
  {
    const { data, error } = await providerClient.rpc("create_offer", { p_job_id: providerOfferJobId, p_amount: 1300, p_currency: "TRY", p_description: "0042 smoke test offer description 3, en az yirmi karakter." });
    record("10) REINSTATED provider create_offer PASSES again", !error && !!data?.id, error?.message);
  }

  // Read behavior must NOT be blocked while active (sanity — not the suspended state, just confirming reads are untouched by this migration)
  {
    const { data, error } = await requesterClient.from("jobs").select("id").eq("requester_id", requesterId);
    record("11) Read (SELECT jobs) works normally for requester", !error && Array.isArray(data), error?.message);
  }

} catch (e) {
  record("UNEXPECTED EXCEPTION", false, e?.message || String(e));
} finally {
  // cleanup
  try { if (requesterId) await admin.auth.admin.deleteUser(requesterId); } catch {}
  try { if (providerId) await admin.auth.admin.deleteUser(providerId); } catch {}
  try { if (adminId) await admin.auth.admin.deleteUser(adminId); } catch {}
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
