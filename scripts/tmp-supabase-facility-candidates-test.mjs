// MALSEVK — Admin Paneli Faz 3 "Sistem Beslemesi" (facility_candidates,
// migration 0029) doğrulama script'i.
//
// Diğer scripts/tmp-supabase-*.mjs dosyalarıyla AYNI desen: sade
// @supabase/supabase-js, çalışan bir dev server GEREKTİRMEZ (RPC'ler
// doğrudan test ediliyor), yalnızca yerel, izole Docker Supabase yığınına
// karşı çalışır (`npx supabase start`/`db reset`, supabase/config.toml
// project_id = "malsevk-2"). URL/anahtarlar `npx supabase status`
// çıktısından SABİT yazılmıştır — test-customs-documents-and-badges.mjs ile
// AYNI güvenlik gerekçesi (hosted/prod'a kazara bağlanma riski yok).
// Dahili DB durumu doğrulaması (admin rolüne yükseltme, tablo satırlarını
// okuma) da o script'in AYNI `psql()` (docker exec) desenini kullanır —
// service_role JS client'ının bu projede public şema tablolarına blanket
// SELECT/UPDATE grant'i YOK (yalnızca `authenticated`e taşınan grant'ler
// var, bkz. 0029'un kendi RLS/grant bloğu), o yüzden gerçek doğrulama
// doğrudan SQL üzerinden yapılır — tıpkı mevcut testin zaten yaptığı gibi.
//
// Çalıştırma: node scripts/tmp-supabase-facility-candidates-test.mjs
// Önkoşul: `npx supabase db reset` (0029 dahil tüm migration'lar uygulanmış olmalı).

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
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, {
    encoding: "utf-8",
  }).trim();
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
const userA = await makeUser("A(hizmet-alan)", `fc-a-${ts}@example.com`);
const userA2 = await makeUser("A2(hizmet-alan, farklı kullanıcı)", `fc-a2-${ts}@example.com`);
const userP = await makeUser("P(hizmet-veren)", `fc-p-${ts}@example.com`);
const userAdmin = await makeUser("Admin", `fc-admin-${ts}@example.com`);

const regA = await userA.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test A", p_phone: "+905551110011",
  p_company_name: "A Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: A completes registration (hizmet-alan)", !regA.error, regA.error?.message);

const regA2 = await userA2.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test A2", p_phone: "+905551110012",
  p_company_name: "A2 Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: A2 completes registration (hizmet-alan)", !regA2.error, regA2.error?.message);

const regP = await userP.client.rpc("complete_registration", {
  p_role: "hizmet-veren", p_full_name: "Test P", p_phone: "+905551110013",
  p_company_name: "P Ltd", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: P completes registration (hizmet-veren)", !regP.error, regP.error?.message);

const regAdmin = await userAdmin.client.rpc("complete_registration", {
  p_role: "hizmet-alan", p_full_name: "Test Admin", p_phone: "+905551110014",
  p_company_name: "Admin Ltd", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
});
check("setup: Admin completes registration (placeholder role)", !regAdmin.error, regAdmin.error?.message);

psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${userAdmin.id}';`);
const adminRoleCheck = psql(`select role from public.profiles where id = '${userAdmin.id}';`);
check("setup: Admin promoted to role='admin' via direct SQL (sandbox-only)", adminRoleCheck === "admin", adminRoleCheck);

console.log("\n=== 1) Erişim kontrolü ===");
const providerSubmit = await userP.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "Evyap Port", p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
});
check("hizmet-veren aday gönderemez (ML108)", providerSubmit.error?.code === "ML108", JSON.stringify(providerSubmit.error));

const providerSeesList = await userP.client.from("facility_candidates").select("id");
check("hizmet-veren aday listesini göremez (RLS boş döner)", !providerSeesList.error && providerSeesList.data.length === 0, providerSeesList.error?.message);

const nonAdminApprove = await userA.client.rpc("approve_facility_candidate", {
  p_candidate_id: "00000000-0000-0000-0000-000000000000", p_name: "x", p_province: "Kocaeli", p_district: null, p_types: [],
});
check("admin olmayan onaylayamaz (ML110)", nonAdminApprove.error?.code === "ML110", JSON.stringify(nonAdminApprove.error));

console.log("\n=== 2) Ham aday oluşuyor + benzer yazımlar gruplanıyor ===");
const spellings = ["Evyap Port", "evyapport", "ev yap port", "evyap port dilovası"];
let groupCandidateId = null;
for (const raw of spellings) {
  const res = await userA.client.rpc("submit_facility_candidate_entry", {
    p_raw_text: raw, p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
  });
  check(`submit("${raw}") başarılı`, !res.error, res.error?.message);
  if (!res.error) {
    if (groupCandidateId === null) groupCandidateId = res.data;
    else check(`submit("${raw}") aynı gruba eşleşti`, res.data === groupCandidateId, `got ${res.data}, expected ${groupCandidateId}`);
  }
}

const groupRow = JSON.parse(psql(`select row_to_json(fc) from public.facility_candidates fc where id = '${groupCandidateId}';`));
check("grup satırı bulunabildi", groupRow !== null, groupRow);
check("kullanım sayısı doğru arttı (4)", groupRow?.usage_count === 4, `got ${groupRow?.usage_count}`);
check("güven seviyesi medium/high", ["medium", "high"].includes(groupRow?.confidence), groupRow?.confidence);
check("il doğru", groupRow?.suggested_province === "Kocaeli");
check("tip tahmini LIMAN içeriyor", groupRow?.suggested_types?.includes("LIMAN"), JSON.stringify(groupRow?.suggested_types));
check("durum hâlâ pending", groupRow?.status === "pending");

const rawEntryCount = Number(psql(`select count(*) from public.facility_candidate_raw_entries where candidate_id = '${groupCandidateId}';`));
check("4 ham girdi kaydedildi", rawEntryCount === 4, rawEntryCount);

console.log("\n=== 3) Farklı il -> ayrı grup ===");
const otherProvince = await userA.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "Evyap Port", p_province: "İstanbul", p_district: "Tuzla", p_source: "job_pickup_location",
});
check("aynı metin farklı ilde AYRI grup açar", !otherProvince.error && otherProvince.data !== groupCandidateId, otherProvince.error?.message);

console.log("\n=== 4) Anlamsız girdi sessizce yok sayılıyor ===");
const junk = await userA.client.rpc("submit_facility_candidate_entry", { p_raw_text: "a", p_province: "Kocaeli", p_district: null, p_source: null });
check("çok kısa/anlamsız girdi hata vermeden null döner", !junk.error && junk.data === null, JSON.stringify(junk));

console.log("\n=== 5) Admin ONAYLA (tek tuşla) ===");
const approve = await userAdmin.client.rpc("approve_facility_candidate", {
  p_candidate_id: groupCandidateId, p_name: "Evyap Port", p_province: "Kocaeli", p_district: "Dilovası", p_types: ["LIMAN"],
});
check("onay başarılı", !approve.error, approve.error?.message);
check("durum approved oldu", approve.data?.status === "approved", approve.data?.status);
check("reviewed_by admin", approve.data?.reviewed_by === userAdmin.id);

const historyCountAfterApprove = Number(psql(`select count(*) from public.facility_candidate_raw_entries where candidate_id = '${groupCandidateId}';`));
check("onay sonrası geçmiş kayıt silinmedi (hâlâ 4)", historyCountAfterApprove === 4, historyCountAfterApprove);

console.log("\n=== 6) Onaylanmış alias davranışı: aynı yazım tekrar girildiğinde yeni aday oluşturmuyor ===");
const resubmitSameProvince = await userA2.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "evyapport", p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
});
check("aynı yazım (farklı kullanıcı) mevcut ONAYLI gruba eşleşti", !resubmitSameProvince.error && resubmitSameProvince.data === groupCandidateId, resubmitSameProvince.error?.message ?? resubmitSameProvince.data);

const groupsForCompactKey = Number(psql(`select count(*) from public.facility_candidates where suggested_province = 'Kocaeli' and suggested_compact_key = 'evyapport';`));
check("Kocaeli ilinde hâlâ tek grup var (yeni pending doğmadı)", groupsForCompactKey === 1, groupsForCompactKey);

console.log("\n=== 7) Farklı ilçeyle aynı metin -> onaylıya körlemesine birleşmiyor ===");
const differentDistrict = await userA.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "Evyap Port", p_province: "Kocaeli", p_district: "Gebze", p_source: "job_pickup_location",
});
check("farklı ilçe -> yeni ayrı grup (güvenlik kuralı)", !differentDistrict.error && differentDistrict.data !== groupCandidateId, differentDistrict.error?.message);

console.log("\n=== 8) Sibling-merge: onay sırasında benzer bekleyen gruplar katlanıyor ===");
// Kısa ("Beldeport") ve uzun/resmî ("Beldeport Uluslararası Konteyner
// Terminali İşletmeciliği A.Ş.") yazımların benzerliği ~0.14 — 0.28 eşiğinin
// ALTINDA, yani ingestion sırasında (tier 2) BİRLEŞMEZ, iki AYRI pending
// grup olarak kalır (deterministik). Admin birini onaylarken suggested_name'i
// tam olarak diğerinin adına EŞİTLERSE (similarity=1.0), sibling-merge
// eşikten bağımsız, kesin olarak tetiklenir — bu, admin'in "doğru/temiz" adı
// seçtiği ama iki grubun ingestion'da hiç karşılaştırılmadığı gerçek senaryoyu
// (bölüm 3'ün "yüzlerce farklı yazım") izole ve deterministik test eder.
const siblingRaw = await userA2.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "Beldeport", p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
});
check("Beldeport aday oluşturdu", !siblingRaw.error, siblingRaw.error?.message);
const siblingId1 = siblingRaw.data;
const LONG_NAME = "Beldeport Uluslararası Konteyner Terminali İşletmeciliği A.Ş.";
const siblingRaw2 = await userA2.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: LONG_NAME, p_province: "Kocaeli", p_district: "Dilovası", p_source: "job_pickup_location",
});
const siblingId2 = siblingRaw2.data;
check("İkinci (uzun/resmî) varyasyon ayrı bir pending grup olarak kaldı (ingestion'da birleşmedi)", !siblingRaw2.error && siblingId2 !== siblingId1, siblingRaw2.error?.message);

const approveSibling = await userAdmin.client.rpc("approve_facility_candidate", {
  p_candidate_id: siblingId1, p_name: LONG_NAME, p_province: "Kocaeli", p_district: "Dilovası", p_types: ["LIMAN"],
});
check("Beldeport onaylandı (admin, siblingId2'nin adıyla BİREBİR aynı temiz adı seçti)", !approveSibling.error, approveSibling.error?.message);

const mergedAwayExists = psql(`select exists(select 1 from public.facility_candidates where id = '${siblingId2}');`);
check("benzer pending grup onay sırasında katlandı (silindi)", mergedAwayExists === "f", mergedAwayExists);
const mergedEntryCount = Number(psql(`select count(*) from public.facility_candidate_raw_entries where candidate_id = '${siblingId1}';`));
check("katlanan grubun ham girdisi de ana gruba taşındı (2 girdi)", mergedEntryCount === 2, mergedEntryCount);

console.log("\n=== 9) Admin bir tesisi birden fazla türle onaylayabiliyor / düzenleyebiliyor ===");
const multiType = await userAdmin.client.rpc("update_facility_candidate_suggestion", {
  p_candidate_id: siblingId1, p_name: LONG_NAME, p_province: "Kocaeli", p_district: "Dilovası", p_types: ["LIMAN", "ANTREPO"],
});
check("düzenle: birden fazla tip kaydedilebiliyor", !multiType.error && multiType.data?.suggested_types?.length === 2, JSON.stringify(multiType.data?.suggested_types ?? multiType.error));

console.log("\n=== 10) Reddet + reddedilen tekrar gereksiz pending oluşturmuyor ===");
const junkGroup = await userA.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "asdadasd", p_province: "Kocaeli", p_district: null, p_source: null,
});
check("anlamsız ama >=2 karakter girdi bir aday oluşturur (admin karar versin diye)", !junkGroup.error && junkGroup.data !== null, junkGroup.error?.message);
const rejectNoReason = await userAdmin.client.rpc("reject_facility_candidate", { p_candidate_id: junkGroup.data, p_reason: "" });
check("boş gerekçeyle reddedemez (ML114)", rejectNoReason.error?.code === "ML114", JSON.stringify(rejectNoReason.error));
const reject = await userAdmin.client.rpc("reject_facility_candidate", { p_candidate_id: junkGroup.data, p_reason: "Anlamsız girdi" });
check("reddet başarılı", !reject.error && reject.data?.status === "rejected", reject.error?.message);

const resubmitJunk = await userA2.client.rpc("submit_facility_candidate_entry", {
  p_raw_text: "asdadasd", p_province: "Kocaeli", p_district: null, p_source: null,
});
check("reddedilen metin tekrar girildiğinde AYNI (reddedilmiş) gruba eklendi, yeni pending değil", !resubmitJunk.error && resubmitJunk.data === junkGroup.data, resubmitJunk.error?.message ?? resubmitJunk.data);
const junkStatusAfter = psql(`select status from public.facility_candidates where id = '${junkGroup.data}';`);
check("grup hâlâ rejected (yeniden pending'e dönmedi)", junkStatusAfter === "rejected", junkStatusAfter);

const pendingCountForJunk = Number(psql(`select count(*) from public.facility_candidates where suggested_compact_key = 'asdadasd' and status = 'pending';`));
check("reddedilen metin için ayrıca yeni bir pending grup DOĞMADI", pendingCountForJunk === 0, pendingCountForJunk);

console.log("\n=== 11) audit_logs'a admin kararları yazıldı ===");
// Bu noktaya kadar 4 admin kararı verildi: approve(groupCandidateId),
// approve(siblingId1), update(siblingId1), reject(junkGroup).
const auditCount = Number(psql(`select count(*) from public.audit_logs where entity_type = 'facility_candidates';`));
check("audit_logs approve/reject/update kayıtları içeriyor (>=4)", auditCount >= 4, auditCount);

console.log("\n=== 12) Admin listeyi görebiliyor (gerçek admin oturumu, RLS) ===");
const adminList = await userAdmin.client.from("facility_candidates").select("id, status");
check("admin aday listesini görebiliyor", !adminList.error && adminList.data.length > 0, adminList.error?.message);
const adminRawEntries = await userAdmin.client.from("facility_candidate_raw_entries").select("id").limit(1);
check("admin ham girdi tablosunu görebiliyor", !adminRawEntries.error, adminRawEntries.error?.message);

console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Başarısız testler:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
