// node scripts/tmp-suspended-direct-write-after-test.mjs
// "Askıya Alınmış Hesap Güvenliği" görevi — AFTER (düzeltme sonrası) kanıtı,
// migration 0081 uygulandıktan sonra. Aynı userA/userB (before-test'ten kalan,
// hâlâ askıya alınmış durumda) ve YENİ bir aktif kullanıcı ile gerçek
// PostgREST istemcisiyle test A-I'yi tekrar çalıştırır.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-suspwrite-after-"));
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
  const email = `malsevk-suspwrite-after-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Susp Write After ${label}`, p_phone: "+905551110066",
    p_company_name: `Susp Write After Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
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
  // Önceki (before-test) userA hâlâ askıya alınmış durumda olmalı.
  const [prevUserA] = runSql(
    `select p.id, u.email from public.profiles p join auth.users u on u.id = p.id where u.email ilike 'malsevk-suspwrite-usera-%' order by p.created_at desc limit 1;`,
  );
  if (!prevUserA) throw new Error("Önceki before-test kullanıcısı (userA) bulunamadı — before-test script'i önce çalıştırılmalı.");
  const suspCheck = runSql(`select account_status from public.profiles where id = '${prevUserA.id}';`)[0];
  record("kurulum) Önceki userA hâlâ askıya alınmış", suspCheck?.account_status === "suspended", JSON.stringify(suspCheck));

  const suspendedClient = await clientAs(prevUserA.email);

  // --- B (AFTER): askıya alınmış kullanıcı artık profilini GÜNCELLEYEMİYOR ---
  const beforeName = runSql(`select full_name from public.profiles where id = '${prevUserA.id}';`)[0]?.full_name;
  const { error: suspendedUpdateError } = await suspendedClient
    .from("profiles").update({ full_name: "Susp Write userA IKINCI-DENEME-DUZELTME-SONRASI" }).eq("id", prevUserA.id);
  const afterAttempt = runSql(`select full_name from public.profiles where id = '${prevUserA.id}';`)[0];
  record(
    "B) [DÜZELTME SONRASI] Askıya alınmış kullanıcı artık aynı alanı güncelleyemiyor (satır değişmedi)",
    afterAttempt?.full_name === beforeName && afterAttempt?.full_name !== "Susp Write userA IKINCI-DENEME-DUZELTME-SONRASI",
    `error=${suspendedUpdateError?.message ?? "(hata yok ama 0 satır etkilendi — RLS satırı gizler)"}, db_full_name_degismedi=${afterAttempt?.full_name === beforeName}`,
  );

  // --- C (AFTER): iletişim gizliliği tercihini de değiştiremiyor ---
  const beforeVis = runSql(`select show_email_after_agreement from public.profiles where id = '${prevUserA.id}';`)[0]?.show_email_after_agreement;
  const { error: suspendedVisError } = await suspendedClient
    .from("profiles").update({ show_email_after_agreement: !beforeVis }).eq("id", prevUserA.id);
  const afterVis = runSql(`select show_email_after_agreement from public.profiles where id = '${prevUserA.id}';`)[0];
  record(
    "C) [DÜZELTME SONRASI] Askıya alınmış kullanıcı iletişim gizliliği tercihini artık değiştiremiyor",
    afterVis?.show_email_after_agreement === beforeVis,
    `error=${suspendedVisError?.message ?? "(satır değişmedi)"}`,
  );

  // --- jobs açığı (AFTER): grant geri alındı mı ---
  const testJobId = "00000000-0000-4000-8000-000000000001";
  const jobBefore = runSql(`select title from public.jobs where id = '${testJobId}';`)[0];
  // Bu deneme artık askıda-OLMAYAN bir aktif kullanıcı ile de yapılabilir —
  // grant'in kendisi tamamen kaldırıldığı için AKTİF/askıda farketmez.
  const { error: jobDirectWriteError } = await suspendedClient
    .from("jobs").update({ title: "IKINCI-HACKED-DENEME" }).eq("id", testJobId);
  const jobAfter = runSql(`select title from public.jobs where id = '${testJobId}';`)[0];
  record(
    "[jobs açığı] [DÜZELTME SONRASI] Sahipsiz UPDATE grant'i kaldırıldı — doğrudan yazım artık reddediliyor",
    /permission denied/i.test(jobDirectWriteError?.message ?? "") && jobAfter?.title === jobBefore?.title,
    `error=${jobDirectWriteError?.message}, title_degismedi=${jobAfter?.title === jobBefore?.title}`,
  );

  // --- provider_profiles açığı (AFTER): grant geri alındı mı ---
  const provUser = await createUser("provCheck", "hizmet-veren");
  runSql(`insert into public.provider_profiles (user_id, bio) values ('${provUser.id}', 'Orijinal bio metni, en az elli karakter olmasi gerekiyor test icin.') on conflict (user_id) do nothing;`);
  const provClient = await clientAs(provUser.email);
  const { error: provDirectWriteError } = await provClient
    .from("provider_profiles").update({ bio: "HACKED bio doğrudan yazım" }).eq("user_id", provUser.id);
  const provAfter = runSql(`select bio from public.provider_profiles where user_id = '${provUser.id}';`)[0];
  record(
    "[provider_profiles açığı] [DÜZELTME SONRASI] Sahipsiz UPDATE grant'i kaldırıldı — doğrudan yazım artık reddediliyor",
    /permission denied/i.test(provDirectWriteError?.message ?? "") && !provAfter?.bio?.includes("HACKED"),
    `error=${provDirectWriteError?.message}`,
  );
  // Gerçek yazma yolu (RPC) hâlâ çalışıyor mu — regresyon kontrolü.
  const { error: rpcWriteError } = await provClient.rpc("upsert_provider_profile", {
    p_bio: "RPC ile guncellenen gercek bio metni, elli karakterden uzun olacak sekilde yazildi.",
    p_founded_year: null, p_experience_range: null, p_regions: null, p_service_features: null,
  });
  const provAfterRpc = runSql(`select bio from public.provider_profiles where user_id = '${provUser.id}';`)[0];
  record(
    "[regresyon] upsert_provider_profile RPC'si (gerçek yazma yolu) hâlâ çalışıyor",
    !rpcWriteError && provAfterRpc?.bio?.startsWith("RPC ile"),
    `error=${rpcWriteError?.message}, bio=${provAfterRpc?.bio}`,
  );

  // --- A (AFTER, regresyon): YENİ, aktif bir kullanıcı hâlâ kendi profilini güncelleyebiliyor mu ---
  const activeUser = await createUser("activeCheck", "hizmet-alan");
  const activeClient = await clientAs(activeUser.email);
  const { error: activeUpdateError } = await activeClient
    .from("profiles").update({ full_name: "Aktif Kullanici Basarili Guncelleme" }).eq("id", activeUser.id);
  const activeAfter = runSql(`select full_name from public.profiles where id = '${activeUser.id}';`)[0];
  record(
    "A) [DÜZELTME SONRASI, REGRESYON] Aktif kullanıcı izinli profil alanını hâlâ güncelleyebiliyor",
    !activeUpdateError && activeAfter?.full_name === "Aktif Kullanici Basarili Guncelleme",
    `error=${activeUpdateError?.message}, db_full_name=${activeAfter?.full_name}`,
  );
  const { error: activeVisError } = await activeClient
    .from("profiles").update({ show_phone_after_agreement: false }).eq("id", activeUser.id);
  const activeVisAfter = runSql(`select show_phone_after_agreement from public.profiles where id = '${activeUser.id}';`)[0];
  record(
    "[regresyon] Aktif kullanıcı iletişim gizliliği tercihini hâlâ güncelleyebiliyor",
    !activeVisError && activeVisAfter?.show_phone_after_agreement === false,
    `error=${activeVisError?.message}`,
  );

  // --- G: gerçek admin hesabı ve yetkisi korunuyor mu ---
  const adminCheck = runSql(
    `select role, account_status from public.profiles where id = '3c790d46-b923-4363-9955-14b849fcd122';`,
  )[0];
  record(
    "G) Gerçek admin hesabı (mertaltunokk@gmail.com) rolü/durumu korunuyor",
    adminCheck?.role === "admin" && adminCheck?.account_status === "active",
    JSON.stringify(adminCheck),
  );
  // is_admin()/suspend_user/reinstate_user hâlâ SECURITY DEFINER olarak RLS'e tabi değil mi (fonksiyon tanımından doğrula).
  const suspendUserDef = runSql(
    `select prosecdef from pg_proc where proname = 'suspend_user' and pronamespace = 'public'::regnamespace;`,
  )[0];
  record("G) suspend_user RPC'si hâlâ SECURITY DEFINER (RLS'e tabi değil, admin akışı bozulmadı)", suspendUserDef?.prosecdef === true, JSON.stringify(suspendUserDef));

  // --- I: RPC dışından doğrudan yapılan saldırı çağrıları reddediliyor (role/account_status escalation, halihazırda test edildi ama tekrar) ---
  const { error: roleEscAfter } = await suspendedClient.from("profiles").update({ role: "admin" }).eq("id", prevUserA.id);
  record("I) Askıda kullanıcı rol yükseltme saldırısı hâlâ reddediliyor", /permission denied/i.test(roleEscAfter?.message ?? ""), roleEscAfter?.message);
  const { error: statusEscAfter } = await suspendedClient.from("profiles").update({ account_status: "active" }).eq("id", prevUserA.id);
  const statusEscCheck = runSql(`select account_status from public.profiles where id = '${prevUserA.id}';`)[0];
  record(
    "E/I) Askıda kullanıcı kendisini 'active' yapamıyor",
    statusEscCheck?.account_status === "suspended",
    `error=${statusEscAfter?.message}, db_status=${statusEscCheck?.account_status}`,
  );

  console.log("");
  console.log(`=== AFTER-TEST SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} ===`);
  if (results.some((r) => !r.pass)) {
    console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
