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
  const file = path.join(tmpdir(), `malsevk-0042-browsersetup-${process.pid}-${c++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).rows;
  } finally { try { unlinkSync(file); } catch {} }
}

const stamp = Date.now();
const adminEmail = `malsevk-test-browseradm-${stamp}@mailinator.com`;
const providerEmail = `malsevk-test-browserprov-${stamp}@mailinator.com`;

const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const ac = client();
const { data: adata, error: aerr } = await ac.auth.signUp({ email: adminEmail, password: PASSWORD });
if (aerr) throw aerr;
const adminId = adata.user.id;

const pc = client();
const { data: pdata, error: perr } = await pc.auth.signUp({ email: providerEmail, password: PASSWORD });
if (perr) throw perr;
const providerId = pdata.user.id;

sql(`update auth.users set email_confirmed_at = now() where id in ('${adminId}', '${providerId}');`);

const { error: signInAdminErr } = await ac.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
if (signInAdminErr) throw signInAdminErr;
const { error: signInProvErr } = await pc.auth.signInWithPassword({ email: providerEmail, password: PASSWORD });
if (signInProvErr) throw signInProvErr;

await ac.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Browser Test Admin Owner", p_phone: "+905329990001", p_company_name: "Browser Test Admin Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
sql(`update public.profiles set role='admin', onboarding_completed=true where id='${adminId}';`);
await pc.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Browser Test Provider", p_phone: "+905329990002", p_company_name: "Browser Test Provider Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze" });

console.log(JSON.stringify({ adminEmail, providerEmail, adminId, providerId, password: PASSWORD }));
