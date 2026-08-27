// Salt-okuma Storage denetimi — job-photos bucket'ının GERÇEK mevcut
// durumunu (klasör/nesne sayısı) raporlar, HİÇBİR ŞEY silmez/değiştirmez.
// Anahtar bir yerel geçici dosyadan okunur, hiçbir zaman loglanmaz/yazılmaz.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error("FAIL: development projeyi işaret etmiyor");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function listAllRecursive(bucket, prefix = "") {
  const results = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    console.error(`list error for ${bucket}/${prefix}:`, error.message);
    return results;
  }
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase Storage: bir "klasör" id'si null olan bir placeholder girdisidir.
    if (entry.id === null) {
      const nested = await listAllRecursive(bucket, fullPath);
      results.push(...nested);
    } else {
      results.push({ path: fullPath, size: entry.metadata?.size ?? null, created_at: entry.created_at });
    }
  }
  return results;
}

async function listTopLevelFolders(bucket) {
  const { data, error } = await admin.storage.from(bucket).list("", { limit: 1000 });
  if (error) {
    console.error(`list error for ${bucket}:`, error.message);
    return [];
  }
  return (data ?? []).filter((e) => e.id === null).map((e) => e.name);
}

const bucket = "job-photos";
const topFolders = await listTopLevelFolders(bucket);
const allObjects = await listAllRecursive(bucket);

console.log("=== job-photos bucket — GERÇEK MEVCUT DURUM (salt-okuma) ===");
console.log("Üst düzey klasör sayısı:", topFolders.length);
console.log("Toplam nesne (dosya) sayısı:", allObjects.length);
console.log("\n--- Klasör listesi (provider/requester id'leri) ---");
console.log(JSON.stringify(topFolders, null, 2));
