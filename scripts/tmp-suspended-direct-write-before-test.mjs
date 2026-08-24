// node scripts/tmp-suspended-direct-write-before-test.mjs
// "Askıya Alınmış Hesap Güvenliği" görevi — BEFORE (düzeltme öncesi) kanıtı.
// Gerçek bir hesap oluşturur, askıya alır, GERÇEK PostgREST/Supabase-js
// istemcisiyle (uygulama arayüzü değil, doğrudan REST katmanı) doğrudan
// profiles/jobs/provider_profiles UPDATE denemeleri yapar ve sonucu
// veritabanında GERÇEKTEN doğrular. Development dışına hiç bağlanmaz.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-suspwrite-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { encoding: "utf8" });
  return JSON.parse(output).rows ?? [];
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
async function createUser(label, role) {
  const email = `malsevk-suspwrite-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Susp Write ${label}`, p_phone: "+905551110077",
    p_company_name: `Susp Write Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email };
}

async function clientAs(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signInWithPassword(${email}) failed: ${error.message}`);
  return client;
}

async function run() {
  const userA = await createUser("userA", "hizmet-alan");
  const userB = await createUser("userB", "hizmet-alan"); // "başkasının profilini değiştiremiyor" testi için
  console.log("userA:", userA.email, "userB:", userB.email);

  // --- Test A: aktif kullanıcı izinli alanı güncelleyebiliyor (baseline) ---
  const clientActive = await clientAs(userA.email);
  const { error: activeUpdateError } = await clientActive
    .from("profiles").update({ full_name: "Susp Write userA AKTIF" }).eq("id", userA.id);
  const afterActive = runSql(`select full_name from public.profiles where id = '${userA.id}';`)[0];
  record(
    "A) Aktif kullanıcı izinli profil alanını (full_name) güncelleyebiliyor",
    !activeUpdateError && afterActive?.full_name === "Susp Write userA AKTIF",
    `error=${activeUpdateError?.message}, db_full_name=${afterActive?.full_name}`,
  );

  // --- D/E baseline (aktifken de zaten engellenmeli — sütun grant'i hiç yok) ---
  const { error: roleEscError } = await clientActive.from("profiles").update({ role: "admin" }).eq("id", userA.id);
  const roleAfter = runSql(`select role from public.profiles where id = '${userA.id}';`)[0];
  record(
    "D) Kullanıcı (aktifken de) kendi rolünü admin yapamıyor",
    roleAfter?.role !== "admin",
    `error=${roleEscError?.message}, db_role=${roleAfter?.role}`,
  );

  const { error: statusEscError } = await clientActive.from("profiles").update({ account_status: "banned" }).eq("id", userA.id);
  const statusAfter = runSql(`select account_status from public.profiles where id = '${userA.id}';`)[0];
  record(
    "baseline) Kullanıcı (aktifken de) kendi account_status'unu değiştiremiyor",
    statusAfter?.account_status === "active",
    `error=${statusEscError?.message}, db_status=${statusAfter?.account_status}`,
  );

  // --- F: başkasının profilini değiştiremiyor ---
  const { error: crossUserError } = await clientActive.from("profiles").update({ full_name: "HACKED" }).eq("id", userB.id);
  const userBAfter = runSql(`select full_name from public.profiles where id = '${userB.id}';`)[0];
  record(
    "F) Kullanıcı başkasının (userB) profilini değiştiremiyor",
    userBAfter?.full_name !== "HACKED",
    `error=${crossUserError?.message}, db_full_name=${userBAfter?.full_name}`,
  );

  // --- Şimdi userA'yı askıya al (test kurulumu, gerçek admin hesabı KULLANILMADI) ---
  runSql(`update public.profiles set account_status = 'suspended' where id = '${userA.id}';`);
  const suspendedCheck = runSql(`select account_status from public.profiles where id = '${userA.id}';`)[0];
  record("kurulum) userA askıya alındı (test verisi hazırlığı)", suspendedCheck?.account_status === "suspended", JSON.stringify(suspendedCheck));

  // --- B: (DÜZELTME ÖNCESİ) askıya alınmış kullanıcı hâlâ AYNI JWT ile profilini güncelleyebiliyor mu? ---
  const { error: suspendedUpdateError } = await clientActive
    .from("profiles").update({ full_name: "Susp Write userA ASKIDA-YAZILDI" }).eq("id", userA.id);
  const afterSuspendedWrite = runSql(`select full_name from public.profiles where id = '${userA.id}';`)[0];
  record(
    "B) [DÜZELTME ÖNCESİ DURUM] Askıya alınmış kullanıcı aynı alanı GÜNCELLEYEBİLİYOR (bu, düzeltilmesi gereken açığın kendisi)",
    afterSuspendedWrite?.full_name === "Susp Write userA ASKIDA-YAZILDI",
    `error=${suspendedUpdateError?.message}, db_full_name=${afterSuspendedWrite?.full_name}`,
  );

  // --- C: askıya alınmış kullanıcı iletişim gizliliği tercihini değiştirebiliyor mu? ---
  const { error: suspendedVisError } = await clientActive
    .from("profiles").update({ show_phone_after_agreement: false }).eq("id", userA.id);
  const afterVis = runSql(`select show_phone_after_agreement from public.profiles where id = '${userA.id}';`)[0];
  record(
    "C) [DÜZELTME ÖNCESİ DURUM] Askıya alınmış kullanıcı iletişim gizliliği tercihini DEĞİŞTİREBİLİYOR",
    afterVis?.show_phone_after_agreement === false,
    `error=${suspendedVisError?.message}, db_value=${afterVis?.show_phone_after_agreement}`,
  );

  // --- jobs/provider_profiles doğrudan yazım (aynı açık) ---
  const testJobId = "00000000-0000-4000-8000-000000000001";
  runSql(
    `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
     values ('${testJobId}', '${userA.id}', 'forklift', 'Susp Write test ilani ORIJINAL', 'Bu askiya alinmis hesap dogrudan yazim testi icin olusturulan bir ilan aciklamasidir.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)}', 'approved')
     on conflict (id) do update set title = excluded.title, moderation_status = excluded.moderation_status;`,
  );
  const { error: jobDirectWriteError } = await clientActive
    .from("jobs").update({ title: "HACKED — moderasyonu atlayarak degistirildi" }).eq("id", testJobId);
  const jobAfter = runSql(`select title, moderation_status from public.jobs where id = '${testJobId}';`)[0];
  record(
    "[jobs açığı] [DÜZELTME ÖNCESİ DURUM] Sahipsiz UPDATE grant'i ile ilan başlığı, moderasyona düşürülmeden doğrudan değiştirilebiliyor",
    jobAfter?.title === "HACKED — moderasyonu atlayarak degistirildi" && jobAfter?.moderation_status === "approved",
    `error=${jobDirectWriteError?.message}, ${JSON.stringify(jobAfter)}`,
  );

  console.log("");
  console.log(`=== BEFORE-TEST SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} ===`);
  console.log("Not: B/C/jobs testlerindeki PASS = açığın GERÇEKTEN VAR OLDUĞUNUN kanıtı (düzeltmeden ÖNCE beklenen sonuç budur).");
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
