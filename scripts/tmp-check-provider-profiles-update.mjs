import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const email = `malsevk-pp-check-${Date.now()}@gmail.com`;
const password = "TestSifre2026!";
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = created.data.user.id;
const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await client.auth.signInWithPassword({ email, password });
await client.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Test", p_phone: "+905551234567", p_company_name: "Test", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze" });

const preCheck = await client.from("provider_profiles").select("*").eq("user_id", userId).maybeSingle();
console.log("PRE-CHECK provider_profiles row exists?", preCheck.data !== null, preCheck.error?.message);

const updateAttempt = await client.from("provider_profiles").update({ bio: "x".repeat(60) }).eq("user_id", userId).select();
console.log("UPDATE attempt error:", updateAttempt.error?.message || "none");
console.log("UPDATE attempt data (rows affected):", JSON.stringify(updateAttempt.data));

const profilesUpdate = await client.from("profiles").update({ full_name: "Yeni Ad", phone: "+905559998877" }).eq("id", userId).select();
console.log("profiles UPDATE (full_name/phone) error:", profilesUpdate.error?.message || "none");
console.log("profiles UPDATE data:", JSON.stringify(profilesUpdate.data));

const mixedUpdate = await client.from("profiles").update({ full_name: "X", role: "admin" }).eq("id", userId).select();
console.log("Mixed (full_name+role) UPDATE error:", mixedUpdate.error?.message || "none (SECURITY CONCERN if none)");

const roleAfterMixed = await client.from("profiles").select("role, full_name").eq("id", userId).maybeSingle();
console.log("Role after mixed attempt:", JSON.stringify(roleAfterMixed.data));

await admin.auth.admin.deleteUser(userId).catch(() => {});
