// LOCAL Docker Supabase only — validates migration 0043 (profiles(id) FK
// delete-lifecycle): group-2/3 columns (SET NULL / CASCADE) let a "clean"
// account be deleted with a single `delete from auth.users`, while group-1
// (real content ownership: jobs/operations/offers/ratings/documents/badges/
// authorizations) still correctly RESTRICTs deletion — and, critically, that
// an admin's SET NULL columns (audit_logs.actor_id, provider_document_reviews
// .admin_id, provider_service_authorizations.authorized_by, ...) survive with
// a NULL actor rather than deleting the audit/history row itself.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}
function psql(sql) {
  return execSync(`docker exec supabase_db_malsevk-2 psql -U postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now();
const requesterEmail = `fktest-requester-${stamp}@example.com`;
const adminEmail = `fktest-admin-${stamp}@example.com`;

let requesterId, adminId;
try {
  const { data: rdata, error: rerr } = await admin.auth.admin.createUser({ email: requesterEmail, password: PASSWORD, email_confirm: true });
  if (rerr) throw rerr;
  requesterId = rdata.user.id;
  const { data: adata, error: aerr } = await admin.auth.admin.createUser({ email: adminEmail, password: PASSWORD, email_confirm: true });
  if (aerr) throw aerr;
  adminId = adata.user.id;
  record("2 test hesabı oluşturuldu", true, `${requesterId}/${adminId}`);

  psql(`update public.profiles set role='admin', full_name='FK Test Admin', onboarding_completed=true where id = '${adminId}';`);

  const requesterClient = client();
  await requesterClient.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });
  const adminClient = client();
  await adminClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });

  await requesterClient.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "FK Test Requester", p_phone: "+905321119001", p_company_name: "FK Test Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });

  // Requester: pure "clean" data first — legal consent, recently viewed (no
  // content ownership yet) — should be fully auto-deletable.
  await requesterClient.rpc("record_legal_consent", { p_document_id: "gizlilik-politikasi", p_version: "1.0" });

  // Admin performs an action that writes audit_logs.actor_id = adminId (suspend then reinstate).
  await adminClient.rpc("suspend_user", { p_user_id: requesterId, p_reason: "0043 fk lifecycle test" });
  await adminClient.rpc("reinstate_user", { p_user_id: requesterId });

  const auditCountBefore = psql(`select count(*) from public.audit_logs where actor_id = '${adminId}';`);
  record("Admin'in audit_logs satırları gerçekten yazıldı", Number(auditCountBefore) >= 2, auditCountBefore);

  // Now delete the ADMIN directly (single statement — no manual pre-cleanup) —
  // admin only has SET NULL-class rows (audit_logs.actor_id), no group-1 content.
  let deleteAdminError = null;
  try {
    psql(`delete from auth.users where id = '${adminId}';`);
  } catch (e) {
    deleteAdminError = e.message;
  }
  record("Admin hesabı TEK bir 'delete from auth.users' ile silinebildi (grup-2 kolonları artık engel olmuyor)", !deleteAdminError, deleteAdminError);

  const auditCountAfter = psql(`select count(*) from public.audit_logs where actor_id is null;`);
  const auditRowsSurvived = Number(psql(`select count(*) from public.audit_logs;`)) >= Number(auditCountBefore);
  record("Admin silindikten SONRA audit_logs satırları KAYBOLMADI, actor_id NULL oldu (SET NULL doğrulandı)", Number(auditCountAfter) >= Number(auditCountBefore) && auditRowsSurvived, `null-actor rows=${auditCountAfter}`);

  // Requester: give them REAL content (a job) — group-1, must now RESTRICT.
  const photos = [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 111, width: 10, height: 10 }];
  const { data: job, error: jobErr } = await requesterClient.rpc("create_job", {
    p_category_id: "kapali-depolama", p_title: "0043 fk lifecycle job", p_description: "0043 fk lifecycle test job description, en az yirmi karakter.",
    p_operation_details: "", p_province: "Kocaeli", p_district: "İzmit", p_work_location_type: "Test Depo",
    p_work_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), p_photos: photos, p_address_text: "Test adres, en az yirmi karakter uzunlukta.",
  });
  record("Requester create_job (grup-1 içerik sahipliği oluşturuldu)", !jobErr && !!job?.id, jobErr?.message);

  let deleteRequesterError = null;
  try {
    psql(`delete from auth.users where id = '${requesterId}';`);
  } catch (e) {
    deleteRequesterError = e.message;
  }
  record("İçerik sahibi (job'u olan) requester hesabı HÂLÂ doğrudan silinemiyor (grup-1 RESTRICT korunuyor, bilerek)", !!deleteRequesterError && /jobs_requester_id_fkey|foreign key/i.test(deleteRequesterError), deleteRequesterError);

} catch (e) {
  record("BEKLENMEYEN İSTİSNA", false, e?.message || String(e));
} finally {
  // cleanup: delete the job first (group-1), then the requester.
  try {
    psql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id = '${requesterId}');`);
    psql(`delete from public.jobs where requester_id = '${requesterId}';`);
    psql(`delete from auth.users where id = '${requesterId}';`);
  } catch {}
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
