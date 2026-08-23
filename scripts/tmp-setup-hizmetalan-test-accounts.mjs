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
  const file = path.join(tmpdir(), `malsevk-0043-setup-${process.pid}-${c++}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, { encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).rows;
  } finally { try { unlinkSync(file); } catch {} }
}

const stamp = Date.now();
const adminEmail = `malsevk-test-halanadm-${stamp}@mailinator.com`;
const requesterEmail = `malsevk-test-halanreq-${stamp}@mailinator.com`;

const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const ac = client();
const { data: adata, error: aerr } = await ac.auth.signUp({ email: adminEmail, password: PASSWORD });
if (aerr) throw aerr;
const adminId = adata.user.id;

const rc = client();
const { data: rdata, error: rerr } = await rc.auth.signUp({ email: requesterEmail, password: PASSWORD });
if (rerr) throw rerr;
const requesterId = rdata.user.id;

sql(`update auth.users set email_confirmed_at = now() where id in ('${adminId}', '${requesterId}');`);

await ac.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
await rc.auth.signInWithPassword({ email: requesterEmail, password: PASSWORD });

await ac.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Hizmet Alanlar Test Admin Owner", p_phone: "+905329991001", p_company_name: "Hizmet Alanlar Test Admin Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "İzmit" });
sql(`update public.profiles set role='admin', onboarding_completed=true where id='${adminId}';`);
await rc.rpc("complete_registration", { p_role: "hizmet-alan", p_full_name: "Hizmet Alanlar Test Requester", p_phone: "+905329991002", p_company_name: "Hizmet Alanlar Test Requester Co", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze" });

console.log(JSON.stringify({ adminEmail, requesterEmail, adminId, requesterId, password: PASSWORD }));
