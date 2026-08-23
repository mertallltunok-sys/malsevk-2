// MALSEVK — Admin panel (Dashboard/Firmalar/Firma Belgeleri) manuel/Playwright
// doğrulaması için yerel Docker Supabase'e gerçekçi test verisi tohumlar.
// SADECE yerel Docker (127.0.0.1:54321) — hosted dev/prod'a hiç dokunmaz.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = "supabase_db_malsevk-2";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error("Refusing: not local");

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, { encoding: "utf-8" }).trim();
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
const ts = Date.now();

async function makeUser(email) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`createUser ${email}: ${created.error.message}`);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn ${email}: ${signIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

console.log("Creating admin user...");
const adminUser = await makeUser(`admin-seed-${ts}@example.com`);
await adminUser.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Admin Seed", p_phone: "+905550000001",
  p_company_name: "Admin", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
console.log(`Admin: ${adminUser.email} / ${PASSWORD} (id=${adminUser.id})`);

console.log("Creating normal (non-admin) user...");
const normalUser = await makeUser(`normal-seed-${ts}@example.com`);
await normalUser.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Normal Kullanıcı", p_phone: "+905550000002",
  p_company_name: "Normal Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
console.log(`Normal user: ${normalUser.email} / ${PASSWORD} (id=${normalUser.id})`);

const companySpecs = [
  { label: "A (pending belge)", companyName: "Kocaeli Nakliyat A.Ş.", services: ["nakliye"], docStatus: "pending" },
  { label: "B (approved belge + badge)", companyName: "Gebze Lojistik Ltd.", services: ["nakliye"], docStatus: "approved", grantBadge: true },
  { label: "C (rejected belge)", companyName: "Derince Depo Hizmetleri", services: [], docStatus: "rejected" },
  { label: "D (revizyon bekleyen)", companyName: "İzmit Gümrük Müşavirliği", services: ["gumruk-musavirligi"], docStatus: "revision_requested" },
  { label: "E (pending, onayla testi için)", companyName: "Darıca Forklift Hizmetleri", services: [], docStatus: "pending" },
];

const createdCompanies = [];
let companyIndex = 0;
for (const spec of companySpecs) {
  companyIndex += 1;
  console.log(`Creating company: ${spec.label}...`);
  const user = await makeUser(`firma-seed-${companyIndex}-${spec.docStatus}-${ts}@example.com`);
  await user.client.rpc("complete_registration", {
    p_role: "hizmet-veren", p_full_name: `${spec.companyName} Yetkilisi`, p_phone: "+905551112233",
    p_company_name: spec.companyName, p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
  });

  if (spec.services.length > 0) {
    await user.client.rpc("set_provider_service_categories", { p_category_ids: spec.services });
  }

  const upload = await user.client.rpc("create_provider_document", {
    p_document_type: "genel",
    p_storage_path: `${user.id}/faaliyet-belgesi.pdf`,
    p_original_file_name: "faaliyet-belgesi.pdf",
    p_mime_type: "application/pdf",
    p_extension: "pdf",
    p_size_bytes: 30000,
  });
  if (upload.error) throw new Error(`create_provider_document (${spec.label}): ${upload.error.message}`);
  const documentId = upload.data.id;

  if (spec.docStatus !== "pending") {
    const review = await adminUser.client.rpc("review_provider_document", {
      p_document_id: documentId,
      p_status: spec.docStatus,
      p_note: spec.docStatus === "rejected" ? "Belge okunaksız, lütfen net bir tarama yükleyin." : spec.docStatus === "revision_requested" ? "Belge süresi dolmuş görünüyor, güncel belge yükleyin." : null,
    });
    if (review.error) throw new Error(`review_provider_document (${spec.label}): ${review.error.message}`);
  }

  if (spec.grantBadge) {
    const grant = await adminUser.client.rpc("grant_provider_badge", {
      p_provider_id: user.id, p_badge_type_id: "mavi-tik", p_reason: "Seed: zorunlu belgeler onaylandı.",
    });
    if (grant.error) throw new Error(`grant_provider_badge (${spec.label}): ${grant.error.message}`);
  }

  createdCompanies.push({ label: spec.label, id: user.id, companyName: spec.companyName, documentId });
  console.log(`  -> provider_id=${user.id} document_id=${documentId} status=${spec.docStatus}`);
}

console.log("\n=== Seed complete ===");
console.log(JSON.stringify({ admin: { email: adminUser.email, password: PASSWORD }, normal: { email: normalUser.email, password: PASSWORD }, companies: createdCompanies }, null, 2));
