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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-pwreset-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { encoding: "utf8" });
  return JSON.parse(output).rows ?? [];
}

const stamp = Date.now();
async function run() {
  const email = `malsevk-pwreset-check-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error: signUpError } = await client.auth.signUp({ email, password: PASSWORD });
  if (signUpError) throw new Error(`signUp failed: ${signUpError.message}`);
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${data.user.id}';`);
  }

  const start = Date.now();
  const { data: resetData, error: resetError } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: "http://localhost:3000/sifre-guncelle",
  });
  const elapsedMs = Date.now() - start;

  console.log("resetPasswordForEmail sonucu:");
  console.log("  error:", resetError ? JSON.stringify(resetError) : null);
  console.log("  data:", JSON.stringify(resetData));
  console.log("  yanit suresi (ms):", elapsedMs);

  // GoTrue'nun kendi audit log tablosunu (varsa erişebiliyorsak) kontrol et — yalnızca API çağrısının
  // GERÇEKTEN GoTrue tarafına ulaştığının ek bir dolaylı kanıtı olarak (gerçek e-posta teslimatının KENDİSİ değil).
  try {
    const auditRows = runSql(
      `select payload->>'action' as action, created_at from auth.audit_log_entries where payload->>'actor_username' = '${email}' order by created_at desc limit 5;`,
    );
    console.log("auth.audit_log_entries (varsa):", JSON.stringify(auditRows));
  } catch (e) {
    console.log("auth.audit_log_entries okunamadı (yetki/erişim sınırı):", e.message);
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
