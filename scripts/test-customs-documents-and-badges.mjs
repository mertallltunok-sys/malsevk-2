// MALSEVK — provider_documents (firma doğrulama belgeleri) +
// badge_types/provider_badges güvenlik regresyon testi.
//
// Bu, diğer scripts/tmp-*.mjs dosyalarının aksine KALICI bir güvenlik
// regresyon testidir (bu yüzden "tmp-" önekini taşımaz).
//
// KAPSAM GEÇMİŞİ (önemli): bu script başlangıçta job_customs_documents +
// job-customs-documents Storage bucket'ı (0025/0026) için yazılmıştı. Bir
// kapsam düzeltmesiyle bu altyapı YANLIŞ olduğu için 0027 ile tamamen
// kaldırıldı — MALSEVK'te ilan/teklif/operasyon sırasında hiçbir gümrük
// destekleyici belgesi (konşimento, fatura, çeki listesi, menşe belgesi vb.)
// TUTULMAZ; belge yükleme yalnızca hizmet veren FİRMANIN kendi doğrulama
// belgeleri (provider_documents, 0007) içindir. Bu script şimdi üç şeyi
// doğrular: (1) job_customs_documents altyapısının GERÇEKTEN geri
// gelmediğini (regresyon bekçisi — 0027'nin kalıcı olduğunu garanti eder),
// (2) provider_documents'ın firma-yalnız + admin görünürlük kuralının
// çalıştığını, (3) badge_types/provider_badges rozet sisteminin (Mavi Tik/
// Altın Tik, admin-only grant/revoke, tam tarihçe) çalıştığını.
//
// Bu script SADECE yerel, izole Docker Supabase yığınına karşı çalışır
// (`npx supabase start`, supabase/config.toml#project_id = "malsevk-2").
// .env.local'daki NEXT_PUBLIC_SUPABASE_URL (hosted dev projesi) HİÇ
// OKUNMAZ — URL/anahtarlar aşağıda `npx supabase status` çıktısından
// alınarak SABİT yazılmıştır, kazara hosted/prod'a bağlanma riski yok.
//
// Çalıştırma: node scripts/test-customs-documents-and-badges.mjs
// Önkoşul: `npx supabase start` çalışıyor olmalı (bu script onu başlatmaz).

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

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` -- ${extra}` : ""));
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, {
    encoding: "utf-8",
  }).trim();
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "TestSifre2026!";
const ts = Date.now();

async function makeUser(label, email) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  return { label, id: created.data.user.id, client };
}

console.log("=== Setup: test users ===");
const userB = await makeUser("B(unrelated)", `docbadge-b-${ts}@example.com`);
const userP = await makeUser("P(provider)", `docbadge-p-${ts}@example.com`);
const userAdmin = await makeUser("Admin", `docbadge-admin-${ts}@example.com`);

const regB = await userB.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test B", p_phone: "+905551110002",
  p_company_name: "B Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: B completes registration (hizmet-alan)", !regB.error, regB.error?.message);

const regP = await userP.client.rpc("complete_registration", {
  p_role: "hizmet-veren", p_full_name: "Test P", p_phone: "+905551110003",
  p_company_name: "P Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: P completes registration (hizmet-veren)", !regP.error, regP.error?.message);

const regAdmin = await userAdmin.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test Admin", p_phone: "+905551110004",
  p_company_name: "Admin", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: Admin completes registration (placeholder role)", !regAdmin.error, regAdmin.error?.message);

psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${userAdmin.id}';`);
const adminRoleCheck = psql(`select role from public.profiles where id = '${userAdmin.id}';`);
check("setup: Admin promoted to role='admin' via direct SQL (sandbox-only)", adminRoleCheck === "admin", adminRoleCheck);

console.log("\n=== Section 1: job_customs_documents infra must stay REMOVED (0027 regression guard) ===");

const tableGone = psql(`select exists(select 1 from information_schema.tables where table_schema='public' and table_name='job_customs_documents');`);
check("job_customs_documents table does not exist", tableGone === "f", tableGone);

const createFnGone = psql(`select exists(select 1 from pg_proc where proname='create_job_customs_document');`);
check("create_job_customs_document function does not exist", createFnGone === "f", createFnGone);

const deleteFnGone = psql(`select exists(select 1 from pg_proc where proname='delete_job_customs_document');`);
check("delete_job_customs_document function does not exist", deleteFnGone === "f", deleteFnGone);

const bucketPolicyCount = psql(`select count(*) from pg_policies where schemaname='storage' and policyname like 'job_customs_documents%';`);
check("job-customs-documents Storage policies do not exist (0 count)", bucketPolicyCount === "0", bucketPolicyCount);

const rpcCallFails = await userP.client.rpc("create_job_customs_document", {
  p_job_id: "00000000-0000-0000-0000-000000000000", p_storage_path: "x", p_original_file_name: "x",
  p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 1,
});
check("Calling create_job_customs_document via the API fails (function not found)", !!rpcCallFails.error, JSON.stringify(rpcCallFails.error));

const tableQueryFails = await userP.client.from("job_customs_documents").select("id");
check("Querying job_customs_documents via the API fails (table not found)", !!tableQueryFails.error, JSON.stringify(tableQueryFails.error));

const bucketUploadFails = await userP.client.storage
  .from("job-customs-documents")
  .upload(`${userP.id}/x/x.pdf`, Buffer.from("x"), { contentType: "application/pdf" });
check("Uploading to job-customs-documents bucket fails (no policies / gone)", !!bucketUploadFails.error, JSON.stringify(bucketUploadFails.error));

console.log("\n=== Section 2: provider_documents (firma doğrulama belgeleri) — değişmedi, hâlâ çalışıyor ===");

const createDoc = await userP.client.rpc("create_provider_document", {
  p_document_type: "genel",
  p_storage_path: `${userP.id}/faaliyet-belgesi.pdf`,
  p_original_file_name: "faaliyet-belgesi.pdf",
  p_mime_type: "application/pdf",
  p_extension: "pdf",
  p_size_bytes: 20000,
});
check("P uploads a company document via create_provider_document (0023, unchanged)", !createDoc.error, createDoc.error?.message);
const providerDocId = createDoc.data?.id;

const selfSeesOwnDoc = await userP.client.from("provider_documents").select("id").eq("id", providerDocId);
check("P sees own company document", selfSeesOwnDoc.data?.length === 1, JSON.stringify(selfSeesOwnDoc));

const otherCannotSeeDoc = await userB.client.from("provider_documents").select("id").eq("id", providerDocId);
check("B (unrelated) cannot see P's company document", (otherCannotSeeDoc.data?.length ?? -1) === 0, JSON.stringify(otherCannotSeeDoc));

const adminSeesDoc = await userAdmin.client.from("provider_documents").select("id, current_review_status").eq("id", providerDocId);
check("Admin can see P's company document", adminSeesDoc.data?.length === 1, JSON.stringify(adminSeesDoc));

const adminApproves = await userAdmin.client.rpc("review_provider_document", {
  p_document_id: providerDocId, p_status: "approved",
});
check("Admin can approve P's company document (review_provider_document, unchanged)", !adminApproves.error, adminApproves.error?.message);

const statusAfterApproval = psql(`select current_review_status from public.provider_documents where id = '${providerDocId}';`);
check("Company document status is now 'approved'", statusAfterApproval === "approved", statusAfterApproval);

console.log("\n=== Section 3: badge_types catalog ===");

const anon = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const badgeTypesAnon = await anon.from("badge_types").select("id, is_purchasable").order("sort_order");
check("Anon can read badge_types catalog", badgeTypesAnon.data?.length === 2, JSON.stringify(badgeTypesAnon));
check("mavi-tik and altin-tik both seeded, neither purchasable",
  badgeTypesAnon.data?.every((r) => r.is_purchasable === false) &&
  badgeTypesAnon.data?.map((r) => r.id).sort().join(",") === "altin-tik,mavi-tik",
  JSON.stringify(badgeTypesAnon.data));

console.log("\n=== Section 4: grant_provider_badge / revoke_provider_badge RPCs ===");

const grantByNonAdmin = await userB.client.rpc("grant_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik" });
check("MLK50: grant rejected for non-admin caller", grantByNonAdmin.error?.code === "MLK50", JSON.stringify(grantByNonAdmin.error));

const grantUnknownType = await userAdmin.client.rpc("grant_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "does-not-exist" });
check("MLK94: grant rejected for unknown badge_type_id", grantUnknownType.error?.code === "MLK94", JSON.stringify(grantUnknownType.error));

const grantNonProvider = await userAdmin.client.rpc("grant_provider_badge", { p_provider_id: userB.id, p_badge_type_id: "mavi-tik" });
check("ML106: grant rejected for a non-hizmet-veren target (B)", grantNonProvider.error?.code === "ML106", JSON.stringify(grantNonProvider.error));

const grantOk = await userAdmin.client.rpc("grant_provider_badge", {
  p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "Zorunlu firma belgeleri onaylandı (test).",
});
check("Admin grants mavi-tik to P", !grantOk.error, grantOk.error?.message);

const grantDuplicate = await userAdmin.client.rpc("grant_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik" });
check("MLK81: duplicate active grant rejected", grantDuplicate.error?.code === "MLK81", JSON.stringify(grantDuplicate.error));

const selfSelectP = await userP.client.from("provider_badges").select("id, badge_type_id, revoked_at").eq("provider_id", userP.id);
check("P can see own badge", selfSelectP.data?.length === 1 && selfSelectP.data[0].revoked_at === null, JSON.stringify(selfSelectP));

const selectByB = await userB.client.from("provider_badges").select("id").eq("provider_id", userP.id);
check("B (unrelated) cannot see P's badge", (selectByB.data?.length ?? -1) === 0, JSON.stringify(selectByB));

const selectByAdmin = await userAdmin.client.from("provider_badges").select("id").eq("provider_id", userP.id);
check("Admin can see P's badge", selectByAdmin.data?.length === 1, JSON.stringify(selectByAdmin));

const revokeNoReason = await userAdmin.client.rpc("revoke_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik" });
check("ML107: revoke without reason rejected", revokeNoReason.error?.code === "ML107", JSON.stringify(revokeNoReason.error));

const revokeByNonAdmin = await userB.client.rpc("revoke_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "x" });
check("MLK50: revoke rejected for non-admin caller", revokeByNonAdmin.error?.code === "MLK50", JSON.stringify(revokeByNonAdmin.error));

const revokeOk = await userAdmin.client.rpc("revoke_provider_badge", {
  p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "Test: belge süresi doldu.",
});
check("Admin revokes P's badge with a reason", !revokeOk.error, revokeOk.error?.message);

const revokeAgain = await userAdmin.client.rpc("revoke_provider_badge", {
  p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "Test: ikinci deneme.",
});
check("ML105: revoking an already-revoked badge rejected", revokeAgain.error?.code === "ML105", JSON.stringify(revokeAgain.error));

const regrant = await userAdmin.client.rpc("grant_provider_badge", {
  p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "Test: yeniden onaylandı.",
});
check("Re-grant after revoke succeeds (history preserved, new row)", !regrant.error, regrant.error?.message);

const historyCount = psql(`select count(*) from public.provider_badges where provider_id = '${userP.id}' and badge_type_id = 'mavi-tik';`);
check("Full grant/revoke/re-grant history retained (2 rows, none deleted)", historyCount === "2", historyCount);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
