// MALSEVK — 0025/0026 (job_customs_documents + badge_types/provider_badges)
// RLS + RPC + Storage güvenlik regresyon testi.
//
// Bu, diğer scripts/tmp-*.mjs dosyalarının aksine KALICI bir güvenlik
// regresyon testidir (bu yüzden "tmp-" önekini taşımaz) — Karar #1'in
// ("Gümrük destekleyici belgeleri tamamen gizli") ve rozet sisteminin admin-
// only yazma kurallarının gelecekte bir refactor'la sessizce bozulmadığını
// doğrulamak için projede tutulmalıdır.
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
const anon = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

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
const userA = await makeUser("A(job owner)", `customs-a-${ts}@example.com`);
const userB = await makeUser("B(unrelated)", `customs-b-${ts}@example.com`);
const userP = await makeUser("P(provider)", `customs-p-${ts}@example.com`);
const userAdmin = await makeUser("Admin", `customs-admin-${ts}@example.com`);

const regA = await userA.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test A", p_phone: "+905551110001",
  p_company_name: "A Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: A completes registration (hizmet-alan)", !regA.error, regA.error?.message);

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

// Yalnizca yerel, izole sandbox'ta: dogrudan psql ile role='admin' yapiyoruz
// (uygulamada gercek admin hesabi hicbir self-service yoldan olusmaz).
psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${userAdmin.id}';`);
const adminRoleCheck = psql(`select role from public.profiles where id = '${userAdmin.id}';`);
check("setup: Admin promoted to role='admin' via direct SQL (sandbox-only)", adminRoleCheck === "admin", adminRoleCheck);

console.log("\n=== Setup: jobs ===");
const fakePhoto = { storage_path: "dummy/photo.jpg", original_file_name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 };

const gumrukJob = await userA.client.rpc("create_job", {
  p_category_id: "gumruk-musavirligi",
  p_title: "Test Gümrük İşlemi",
  p_description: "Test açıklama metni, yeterli uzunlukta.",
  p_operation_details: "Test operasyon detayları metni.",
  p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test Tesis",
  p_work_date: "2026-09-01",
  p_photos: [fakePhoto],
});
check("setup: A creates gumruk-musavirligi job", !gumrukJob.error, gumrukJob.error?.message);
const gumrukJobId = gumrukJob.data?.id;

const nakliyeJob = await userA.client.rpc("create_job", {
  p_category_id: "nakliye",
  p_title: "Test Nakliye İşi",
  p_description: "Test açıklama metni, yeterli uzunlukta.",
  p_operation_details: "Test operasyon detayları metni.",
  p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "Test Tesis",
  p_work_date: "2026-09-01",
  p_photos: [fakePhoto],
});
check("setup: A creates nakliye (non-customs) job", !nakliyeJob.error, nakliyeJob.error?.message);
const nakliyeJobId = nakliyeJob.data?.id;

console.log("\n=== Section 1: create_job_customs_document RPC ===");

const createOnNonCustomsJob = await userA.client.rpc("create_job_customs_document", {
  p_job_id: nakliyeJobId, p_storage_path: `${userA.id}/${nakliyeJobId}/doc.pdf`,
  p_original_file_name: "doc.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 1000,
});
check("ML104: rejects non-gumruk-musavirligi job", createOnNonCustomsJob.error?.code === "ML104", JSON.stringify(createOnNonCustomsJob.error));

const createByNonOwner = await userB.client.rpc("create_job_customs_document", {
  p_job_id: gumrukJobId, p_storage_path: `${userB.id}/${gumrukJobId}/doc.pdf`,
  p_original_file_name: "doc.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 1000,
});
check("MLK56: rejects non-owner (B on A's job)", createByNonOwner.error?.code === "MLK56", JSON.stringify(createByNonOwner.error));

const createWrongFolder = await userA.client.rpc("create_job_customs_document", {
  p_job_id: gumrukJobId, p_storage_path: `${userB.id}/${gumrukJobId}/doc.pdf`,
  p_original_file_name: "doc.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 1000,
});
check("MLK80: rejects storage_path outside caller's own folder", createWrongFolder.error?.code === "MLK80", JSON.stringify(createWrongFolder.error));

const createBadExtension = await userA.client.rpc("create_job_customs_document", {
  p_job_id: gumrukJobId, p_storage_path: `${userA.id}/${gumrukJobId}/doc.exe`,
  p_original_file_name: "doc.exe", p_mime_type: "application/octet-stream", p_extension: "exe", p_size_bytes: 1000,
});
check("CHECK: rejects disallowed extension (23514)", createBadExtension.error?.code === "23514", JSON.stringify(createBadExtension.error));

const createOk = await userA.client.rpc("create_job_customs_document", {
  p_job_id: gumrukJobId, p_storage_path: `${userA.id}/${gumrukJobId}/beyanname.pdf`,
  p_original_file_name: "beyanname.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 45000,
});
check("A successfully uploads a valid customs document", !createOk.error, createOk.error?.message);
const docId = createOk.data?.id;

console.log("\n=== Section 2: job_customs_documents visibility (Karar #1) ===");

const selA = await userA.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Owner (A) sees own document via SELECT", selA.data?.length === 1, JSON.stringify(selA));

const selB = await userB.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Unrelated user (B) sees 0 documents", (selB.data?.length ?? -1) === 0, JSON.stringify(selB));

// P, gumrukJob uzerine GERCEK bir teklif verir (hatta accepted'a tasinir) --
// "teklif veren/isi alan hizmet veren" karsi-taraf istisnasinin GERCEKTEN
// olmadigini kanitlamak icin en gucumu senaryo.
const offer = await userP.client.rpc("create_offer", {
  p_job_id: gumrukJobId, p_amount: 15000, p_currency: "TRY", p_description: "Test teklif açıklaması.",
});
check("setup: P submits a real (pending) offer on the customs job", !offer.error, offer.error?.message);
const offerId = offer.data?.id;

const selPPending = await userP.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Offer holder P (pending) sees 0 documents", (selPPending.data?.length ?? -1) === 0, JSON.stringify(selPPending));

if (offerId) {
  const accept = await userA.client.rpc("accept_offer", { p_offer_id: offerId });
  check("setup: A accepts P's offer (now ENGAGED, strongest case)", !accept.error, accept.error?.message);
}
const selPEngaged = await userP.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Offer holder P (accepted/ENGAGED) STILL sees 0 documents (Karar #1)", (selPEngaged.data?.length ?? -1) === 0, JSON.stringify(selPEngaged));

const selAdmin = await userAdmin.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Admin sees the document regardless of ownership", selAdmin.data?.length === 1, JSON.stringify(selAdmin));

const selAnon = await anon.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Anonymous (anon key, no session) sees 0 documents / is denied", (selAnon.data?.length ?? 0) === 0, JSON.stringify(selAnon));

console.log("\n=== Section 3: delete_job_customs_document RPC ===");

const deleteByNonOwner = await userB.client.rpc("delete_job_customs_document", { p_document_id: docId });
check("MLK56: delete rejected for non-owner", deleteByNonOwner.error?.code === "MLK56", JSON.stringify(deleteByNonOwner.error));

const deleteMissing = await userA.client.rpc("delete_job_customs_document", { p_document_id: "00000000-0000-0000-0000-000000000000" });
check("MLK76: delete rejected for nonexistent document", deleteMissing.error?.code === "MLK76", JSON.stringify(deleteMissing.error));

const deleteOk = await userA.client.rpc("delete_job_customs_document", { p_document_id: docId });
check("Owner successfully soft-deletes own document", !deleteOk.error, deleteOk.error?.message);

const selAfterDelete = await userA.client.from("job_customs_documents").select("id").eq("job_id", gumrukJobId);
check("Deleted document no longer visible even to owner", (selAfterDelete.data?.length ?? -1) === 0, JSON.stringify(selAfterDelete));

const selAdminAfterDelete = await userAdmin.client.from("job_customs_documents").select("id, deleted_at").eq("id", docId);
check("Admin CAN still see the soft-deleted document (history review)", selAdminAfterDelete.data?.length === 1 && selAdminAfterDelete.data[0].deleted_at !== null, JSON.stringify(selAdminAfterDelete));

console.log("\n=== Section 4: badge_types catalog ===");

const badgeTypesAnon = await anon.from("badge_types").select("id, is_purchasable").order("sort_order");
check("Anon can read badge_types catalog", badgeTypesAnon.data?.length === 2, JSON.stringify(badgeTypesAnon));
check("mavi-tik and altin-tik both seeded, neither purchasable",
  badgeTypesAnon.data?.every((r) => r.is_purchasable === false) &&
  badgeTypesAnon.data?.map((r) => r.id).sort().join(",") === "altin-tik,mavi-tik",
  JSON.stringify(badgeTypesAnon.data));

console.log("\n=== Section 5: grant_provider_badge / revoke_provider_badge RPCs ===");

const grantByNonAdmin = await userA.client.rpc("grant_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik" });
check("MLK50: grant rejected for non-admin caller", grantByNonAdmin.error?.code === "MLK50", JSON.stringify(grantByNonAdmin.error));

const grantUnknownType = await userAdmin.client.rpc("grant_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "does-not-exist" });
check("MLK94: grant rejected for unknown badge_type_id", grantUnknownType.error?.code === "MLK94", JSON.stringify(grantUnknownType.error));

const grantNonProvider = await userAdmin.client.rpc("grant_provider_badge", { p_provider_id: userA.id, p_badge_type_id: "mavi-tik" });
check("ML106: grant rejected for a non-hizmet-veren target (A)", grantNonProvider.error?.code === "ML106", JSON.stringify(grantNonProvider.error));

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

const revokeByNonAdmin = await userA.client.rpc("revoke_provider_badge", { p_provider_id: userP.id, p_badge_type_id: "mavi-tik", p_reason: "x" });
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

console.log("\n=== Section 6: job-customs-documents Storage bucket (0026) ===");

const bucketRow = psql(`select public, file_size_limit from storage.buckets where id = 'job-customs-documents';`);
check("Bucket exists and is private (public=false)", bucketRow.startsWith("f|"), bucketRow);

const storagePath = `${userA.id}/${gumrukJobId}/storage-test.pdf`;
const fileBytes = Buffer.from("%PDF-1.4 test content for MALSEVK 0026 verification");

const uploadOwn = await userA.client.storage.from("job-customs-documents").upload(storagePath, fileBytes, { contentType: "application/pdf" });
check("A uploads to own folder", !uploadOwn.error, uploadOwn.error?.message);

const uploadOtherFolder = await userB.client.storage.from("job-customs-documents")
  .upload(`${userA.id}/${gumrukJobId}/intruder.pdf`, fileBytes, { contentType: "application/pdf" });
check("B is denied uploading into A's folder", !!uploadOtherFolder.error, JSON.stringify(uploadOtherFolder));

const downloadOwn = await userA.client.storage.from("job-customs-documents").download(storagePath);
check("A can download own uploaded object", !downloadOwn.error, downloadOwn.error?.message);

const downloadByB = await userB.client.storage.from("job-customs-documents").download(storagePath);
check("B is denied downloading A's object", !!downloadByB.error, JSON.stringify(downloadByB));

const downloadByAdmin = await userAdmin.client.storage.from("job-customs-documents").download(storagePath);
check("Admin can download A's object", !downloadByAdmin.error, downloadByAdmin.error?.message);

const downloadAnon = await anon.storage.from("job-customs-documents").download(storagePath);
check("Anonymous is denied downloading (private bucket)", !!downloadAnon.error, JSON.stringify(downloadAnon));

const deleteByB = await userB.client.storage.from("job-customs-documents").remove([storagePath]);
const stillThereAfterBDelete = await userA.client.storage.from("job-customs-documents").download(storagePath);
check("B's delete attempt does not remove A's object", !stillThereAfterBDelete.error, JSON.stringify({ deleteByB, stillThereAfterBDelete: stillThereAfterBDelete.error }));

const deleteOwn = await userA.client.storage.from("job-customs-documents").remove([storagePath]);
check("A deletes own object", !deleteOwn.error && deleteOwn.data?.length === 1, JSON.stringify(deleteOwn));

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
