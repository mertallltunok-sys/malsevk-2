import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();
const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function listAllRecursive(bucket, prefix = "") {
  const results = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) { console.error(`list error ${bucket}/${prefix}:`, error.message); return results; }
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) results.push(...(await listAllRecursive(bucket, fullPath)));
    else results.push(fullPath);
  }
  return results;
}

const objects = await listAllRecursive("provider-logos");
console.log("provider-logos toplam nesne:", objects.length);
console.log(JSON.stringify(objects, null, 2));
