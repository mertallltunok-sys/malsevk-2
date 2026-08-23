import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const URL = "https://trfnmpihcnriqgikglpu.supabase.co";
const ANON = "sb_publishable_fRjAnKgqDtDsxR5au68D2Q_0WYDsYvX";
const PASSWORD = "TestSifre2026!Dev";

let c = 0;
function sql(query) {
  const file = path.join(tmpdir(), `malsevk-0043-opsetup-${process.pid}-${c++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).rows;
  } finally { try { unlinkSync(file); } catch {} }
}

const stamp = Date.now();
const adminEmail = `malsevk-test-opsadm-${stamp}@mailinator.com`;
const requesterEmail = `malsevk-test-opsreq-${stamp}@mailinator.com`;
const providerEmail = `malsevk-test-opsprov-${stamp}@mailinator.com`;

const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

async function makeUser(email) {
  const cl = client();
  const { data, error } = await cl.auth.signUp({ email, password: PASSWORD });
  if (error) throw error;
  return { client: cl, id: data.user.id };
}

const admin = await makeUser(adminEmail);
const requester = await makeUser(requesterEmail);
const provider = await makeUser(providerEmail);

sql(`update auth.users set email_confirmed_at = now() where id in ('${admin.id}', '${requester.id}', '${provider.id}');`);

await admin.client.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
await requester.client.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });
await provider.client.auth.signInWithPassword({ email: providerEmail, password: PASSWORD });

await admin.client.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Operasyon Test Admin Owner", p_phone: "+905329992001", p_company_name: "Operasyon Test Admin Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
sql(`update public.profiles set role='admin', onboarding_completed=true where id='${admin.id}';`);
await requester.client.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Operasyon Test Requester Kisi", p_phone: "+905329992002", p_company_name: "Operasyon Test Requester Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze" });
await provider.client.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Operasyon Test Provider Kisi", p_phone: "+905329992003", p_company_name: "Operasyon Test Provider Firma", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Darıca" });

await provider.client.rpc("set_provider_service_categories", { p_category_ids: ["kapali-depolama", "acik-saha-depolama"] });
await admin.client.rpc("authorize_provider_service", { p_provider_id: provider.id, p_service_category_id: "kapali-depolama", p_reason: "operasyon test" });
await admin.client.rpc("authorize_provider_service", { p_provider_id: provider.id, p_service_category_id: "acik-saha-depolama", p_reason: "operasyon test" });

const photos = [{ storage_path: "test/fake.jpg", original_file_name: "fake.jpg", mime_type: "image/jpeg", size_bytes: 111, width: 10, height: 10 }];
const workDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
const services = [
  { category_id: "kapali-depolama", title: "Operasyon Testi Hizmet A — Kapalı Depolama", description: "Operasyon testi servis A açıklaması, en az yirmi karakter uzunlukta.", district: "İzmit", work_location_type: "Test Depo A", location_mode: "catalog", address_text: "", work_date: workDate, client_id: crypto.randomUUID() },
  { category_id: "acik-saha-depolama", title: "Operasyon Testi Hizmet B — Açık Saha Depolama", description: "Operasyon testi servis B açıklaması, en az yirmi karakter uzunlukta.", district: "Gebze", work_location_type: "Test Depo B", location_mode: "catalog", address_text: "", work_date: workDate, client_id: crypto.randomUUID() },
];
const { data: opData, error: opErr } = await requester.client.rpc("create_operation_with_jobs", {
  p_province: "Kocaeli", p_operation_details: "Operasyon testi ortak detay metni", p_services: services, p_photos_by_service_index: { 0: photos, 1: photos },
});
if (opErr) throw opErr;
const [jobIdA, jobIdB] = opData.job_ids;

await admin.client.rpc("approve_job_as_admin", { p_job_id: jobIdA });
await admin.client.rpc("approve_job_as_admin", { p_job_id: jobIdB });

const { data: offerA, error: offerAErr } = await provider.client.rpc("create_offer", { p_job_id: jobIdA, p_amount: 12500, p_currency: "TRY", p_description: "Operasyon testi teklif A açıklaması, en az yirmi karakter." });
if (offerAErr) throw offerAErr;
const { data: offerB, error: offerBErr } = await provider.client.rpc("create_offer", { p_job_id: jobIdB, p_amount: 8750, p_currency: "TRY", p_description: "Operasyon testi teklif B açıklaması, en az yirmi karakter." });
if (offerBErr) throw offerBErr;

const { error: acceptErr } = await requester.client.rpc("accept_offer", { p_offer_id: offerA.id });
if (acceptErr) throw acceptErr;

console.log(JSON.stringify({
  adminEmail, requesterEmail, providerEmail, password: PASSWORD,
  adminId: admin.id, requesterId: requester.id, providerId: provider.id,
  operationId: opData.operation_id, jobIdA, jobIdB, offerAId: offerA.id, offerBId: offerB.id,
}, null, 2));
