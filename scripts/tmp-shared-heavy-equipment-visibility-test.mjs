// node scripts/tmp-shared-heavy-equipment-visibility-test.mjs
//
// "Ortak İlan Görünürlüğü" görevinin gerçek RPC/Supabase kanıtı: forklift'te
// yetkili bir sağlayıcının vinç operatörü ilanını GÖREBİLDİĞİNİ (yeni,
// paylaşılan görünürlük) AMA ona GERÇEK RPC ile teklif VEREMEDİĞİNİ
// (değişmeyen, tam-eşleşme yetki sınırı) kanıtlar — görev talimatının kendi
// açık uyardığı "ortak görünürlük teklif-bypass açığı oluşturmasın" riskine
// karşı doğrudan kanıt.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-groupvis-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-groupvis-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signIn(${label}) after confirm failed: ${signInError.message}`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Group Vis ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Group Vis Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email, client };
}

async function run() {
  console.log("--- Test kullanıcıları oluşturuluyor ---");
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  console.log(`requester=${requester.email} provider(forklift-only)=${provider.email}`);

  // Provider'ı YALNIZCA forklift için yetkilendir (admin onayını simüle
  // eder — gerçek RPC'nin ürettiği satırla AYNI şekle).
  runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provider.id}', 'forklift', now()) on conflict do nothing;`);

  // "vinc-operatoru" kategorisinde, admin onaylı, gerçek bir ilan (raw
  // INSERT — create_job RPC'nin fotoğraf zorunluluğu bu testin konusu
  // değil, bkz. tmp-general-security-hardening-test.mjs'in AYNI deseni).
  const jobId = randomUUID();
  const workDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  runSql(
    `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
     values ('${jobId}', '${requester.id}', 'vinc-operatoru', 'Vinc operatoru test ilani', 'Bu güvenlik testi için oluşturulan bir ilan açıklamasıdır yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${workDate}', 'approved');`,
  );

  // A) GÖRÜNÜRLÜK: provider_can_view_job (RLS'in gerçek kullandığı fonksiyon) forklift-only sağlayıcı için TRUE dönmeli.
  const [{ can_view: canView }] = runSql(
    `select public.provider_can_view_job_for_listing('${provider.id}', 'vinc-operatoru', null, null, null, null, null, null) as can_view;`,
  );
  record("A) forklift-yetkili sağlayıcı vinç operatörü ilanını GÖREBİLİYOR (provider_can_view_job_for_listing)", canView === true, `can_view=${canView}`);

  // B) RLS üzerinden GERÇEK select — provider'ın kendi client'ıyla.
  const { data: seenJobs, error: selectError } = await provider.client
    .from("jobs")
    .select("id")
    .eq("id", jobId);
  record(
    "B) Provider kendi RLS oturumuyla ilanı GERÇEKTEN select edebiliyor",
    !selectError && seenJobs?.length === 1,
    selectError ? selectError.message : `${seenJobs?.length ?? 0} satır döndü`,
  );

  // C) TEKLİF YETKİSİ: aynı sağlayıcı GERÇEK create_offer RPC'siyle bu ilana teklif vermeyi dener — REDDEDİLMELİ.
  const { error: offerError } = await provider.client.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 5000,
    p_currency: "TRY",
    p_description: "Bu bir test teklif açıklamasıdır yeterli uzunlukta gerçekten.",
  });
  record(
    "C) Aynı sağlayıcı GERÇEK create_offer RPC'siyle vinç operatörü ilanına teklif VEREMİYOR",
    !!offerError && /MLK60/.test(offerError.message ?? ""),
    offerError ? offerError.message : "HATA: teklif başarıyla oluşturuldu (BEKLENMEYEN)",
  );

  // D) Kontrol: aynı sağlayıcı GERÇEKTEN yetkili olduğu forklift kategorisine teklif verebiliyor mu?
  const forkliftJobId = randomUUID();
  runSql(
    `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
     values ('${forkliftJobId}', '${requester.id}', 'forklift', 'Forklift test ilani', 'Bu güvenlik testi için oluşturulan bir ilan açıklamasıdır yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${workDate}', 'approved');`,
  );
  const { error: forkliftOfferError } = await provider.client.rpc("create_offer", {
    p_job_id: forkliftJobId,
    p_amount: 5000,
    p_currency: "TRY",
    p_description: "Bu bir test teklif açıklamasıdır yeterli uzunlukta gerçekten.",
  });
  record("D) Aynı sağlayıcı GERÇEKTEN yetkili olduğu forklift ilanına teklif VEREBİLİYOR", !forkliftOfferError, forkliftOfferError ? forkliftOfferError.message : "başarılı");

  // E) İzole kontrol: yalnız Nakliye/Depolama gibi tamamen ilgisiz bir kategoriye hâlâ erişemiyor.
  const [{ can_view: canViewUnrelated }] = runSql(
    `select public.provider_can_view_job_for_listing('${provider.id}', 'nakliye', null, null, null, null, null, null) as can_view;`,
  );
  record("E) forklift-yetkili sağlayıcı ilgisiz kategoriye (Nakliye) hâlâ ERİŞEMİYOR", canViewUnrelated === false, `can_view=${canViewUnrelated}`);

  console.log("");
  console.log(`=== SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
  if (results.some((r) => !r.pass)) {
    console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
