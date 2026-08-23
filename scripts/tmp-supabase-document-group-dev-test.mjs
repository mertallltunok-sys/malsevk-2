// Real Development project (trfnmpihcnriqgikglpu) — validates migration 0044
// against the REAL hosted database using fresh, dedicated test accounts (no
// existing real user data touched). Mirrors tmp-supabase-document-group-local-test.mjs.
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
  const file = path.join(tmpdir(), `malsevk-0044-devtest-${process.pid}-${c++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).rows;
  } finally { try { unlinkSync(file); } catch {} }
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}
const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const STORAGE_CATEGORIES = ["ellecleme", "genel-depolama", "acik-saha-depolama", "kapali-depolama", "antrepo-gumruklu", "gecici-depolama", "konteyner-depolama", "dokme-yuk-depolama", "proje-yuku-depolama", "soguk-hava-depolama", "kimyasal-depolama", "tehlikeli-madde-depolama"];
const EQUIPMENT_CATEGORIES = ["forklift", "reach-stacker", "vinc", "manlift", "forklift-operatoru", "reach-stacker-operatoru", "vinc-operatoru", "manlift-operatoru"];

const stamp = Date.now();
const adminEmail = `malsevk-test-grpadm-${stamp}@mailinator.com`;
const providerAEmail = `malsevk-test-grpprovA-${stamp}@mailinator.com`;
const providerBEmail = `malsevk-test-grpprovB-${stamp}@mailinator.com`;
let adminId, providerAId, providerBId;

async function signUp(cli, email) {
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(email + ": " + error.message);
  return data.user.id;
}

try {
  const ac = client(); adminId = await signUp(ac, adminEmail);
  const pac = client(); providerAId = await signUp(pac, providerAEmail);
  const pbc = client(); providerBId = await signUp(pbc, providerBEmail);
  sql(`update auth.users set email_confirmed_at = now() where id in ('${adminId}','${providerAId}','${providerBId}');`);
  await ac.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
  await pac.auth.signInWithPassword({ email: providerAEmail, password: PASSWORD });
  await pbc.auth.signInWithPassword({ email: providerBEmail, password: PASSWORD });
  record("3 gerçek Development test hesabı oluşturuldu", true, `${adminId}/${providerAId}/${providerBId}`);

  await ac.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Group Dev Test Admin", p_phone: "+905321119101", p_company_name: "Group Dev Test Admin Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
  sql(`update public.profiles set role='admin', onboarding_completed=true where id='${adminId}';`);
  await pac.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Group Dev Provider A", p_phone: "+905321119102", p_company_name: "Group Dev Provider A Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze" });
  await pbc.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Group Dev Provider B", p_phone: "+905321119103", p_company_name: "Group Dev Provider B Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Darıca" });

  // TEST A: Depo Hizmetleri
  const { data: depoDoc, error: depoErr } = await pac.rpc("create_provider_document", {
    p_document_type: "depo-hizmetleri-belgesi", p_storage_path: `${providerAId}/depo-belgesi.pdf`,
    p_original_file_name: "depo-belgesi.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 12345,
  });
  record("A1) Provider A depo-hizmetleri-belgesi yüklüyor (real Development)", !depoErr && !!depoDoc?.id, depoErr?.message);

  const { error: dupErr } = await pac.rpc("create_provider_document", {
    p_document_type: "depo-hizmetleri-belgesi", p_storage_path: `${providerAId}/depo-belgesi-2.pdf`,
    p_original_file_name: "depo-belgesi-2.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 111,
  });
  record("A2) İkinci pending depo belgesi reddediliyor (duplicate koruması, real Development)", !!dupErr && /duplicate key|unique/i.test(dupErr.message), dupErr?.message);

  const { error: approveErr } = await ac.rpc("review_provider_document", { p_document_id: depoDoc.id, p_status: "approved" });
  record("A3) Admin depo belgesini onaylıyor (real Development)", !approveErr, approveErr?.message);

  const authRowsA = sql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerAId}' and revoked_at is null order by service_category_id;`).map((r) => r.service_category_id);
  const allPresentA = STORAGE_CATEGORIES.every((c2) => authRowsA.includes(c2)) && authRowsA.length === STORAGE_CATEGORIES.length;
  record("A4) Onay sonrası Provider A'nın TAM 12 depo kategorisi authorize edildi (real Development DB satırları)", allPresentA, authRowsA.join(","));

  const visA = sql(`select public.provider_can_view_category('${providerAId}', 'forklift') as f, public.provider_can_view_category('${providerAId}', 'kapali-depolama') as s;`)[0];
  record("A5) Provider A forklift GÖREMİYOR, kapali-depolama GÖREBİLİYOR (real Development)", visA.f === false && visA.s === true, JSON.stringify(visA));

  // TEST B: Operatör / İş Makinesi
  const { data: opDoc, error: opErr } = await pbc.rpc("create_provider_document", {
    p_document_type: "operator-is-makinesi-belgesi", p_storage_path: `${providerBId}/operator-belgesi.pdf`,
    p_original_file_name: "operator-belgesi.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 12345,
  });
  record("B1) Provider B operator-is-makinesi-belgesi yüklüyor (real Development)", !opErr && !!opDoc?.id, opErr?.message);

  const { error: opApproveErr } = await ac.rpc("review_provider_document", { p_document_id: opDoc.id, p_status: "approved" });
  record("B2) Admin operatör belgesini onaylıyor (real Development)", !opApproveErr, opApproveErr?.message);

  const authRowsB = sql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerBId}' and revoked_at is null order by service_category_id;`).map((r) => r.service_category_id);
  const allPresentB = EQUIPMENT_CATEGORIES.every((c2) => authRowsB.includes(c2)) && authRowsB.length === EQUIPMENT_CATEGORIES.length;
  record("B3) Onay sonrası Provider B'nin TAM 8 operatör/iş makinesi kategorisi authorize edildi (real Development)", allPresentB, authRowsB.join(","));

  const visB = sql(`select public.provider_can_view_category('${providerBId}', 'kapali-depolama') as s, public.provider_can_view_category('${providerBId}', 'lashing-unlashing') as l, public.provider_can_view_category('${providerBId}', 'forklift') as f;`)[0];
  record("B4) Provider B depo/lashing GÖREMİYOR, forklift GÖREBİLİYOR (real Development)", visB.s === false && visB.l === false && visB.f === true, JSON.stringify(visB));

  // Verify existing 6 legacy accounts' data untouched (read-only check)
  const legacyCount = sql(`select count(*) as c from public.provider_documents where document_type = 'genel' and service_category_id is null;`)[0].c;
  record("LEGACY) 6 eski 'genel'+NULL-kategori belge hâlâ mevcut, sayısı değişmedi", Number(legacyCount) === 6, `count=${legacyCount}`);

} catch (e) {
  record("BEKLENMEYEN İSTİSNA", false, e?.message || String(e));
} finally {
  for (const id of [adminId, providerAId, providerBId].filter(Boolean)) {
    try {
      sql(`delete from public.provider_service_authorizations where provider_id = '${id}' or authorized_by = '${id}';
           delete from public.provider_document_reviews where provider_id = '${id}' or admin_id = '${id}';
           delete from public.notifications where actor_id = '${id}' or recipient_id = '${id}';
           delete from public.provider_documents where provider_id = '${id}';
           delete from public.provider_services where provider_id = '${id}';
           delete from public.profiles where id = '${id}';
           delete from auth.users where id = '${id}';`);
    } catch (e) { record(`Cleanup ${id}`, false, e.message); }
  }
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
