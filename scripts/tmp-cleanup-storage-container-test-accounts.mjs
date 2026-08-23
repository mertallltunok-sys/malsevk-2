import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const ids = ["4a78ce1a-2323-4cbd-8ead-32c9f1421b67", "16729a7c-1826-4557-ae35-09468d7136d3"];

for (const id of ids) {
  const { error } = await admin.auth.admin.deleteUser(id);
  console.log(id, error ? `FAILED: ${error.message}` : "deleted");
}
