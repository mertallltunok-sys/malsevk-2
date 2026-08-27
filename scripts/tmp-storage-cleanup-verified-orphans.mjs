// Yalnızca DOĞRULANMIŞ (auth.users'ta karşılığı SİLİNMİŞ) hesaplara ait
// job-photos nesnelerini temizler. Önce TAM listeyi çıkarır, silme
// sonrasında bucket'ın gerçekten boşaldığını doğrular.
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
  if (error) { console.error(`list error ${bucket}/${prefix}:`, error.message); return results; }
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) results.push(...(await listAllRecursive(bucket, fullPath)));
    else results.push(fullPath);
  }
  return results;
}

const bucket = "job-photos";
const verifiedOrphanFolders = new Set([
  "0122898c-8a11-409c-8297-1405226db7ff","04c8086e-22e9-445d-bd72-47dd04b147c3","0a9b73fc-d936-44a6-b578-f0df9e376e64",
  "1455d04c-0575-4b40-8702-d07e0744b1e7","2e73e951-974b-429b-b04c-c9e3a553faf3","524df4ac-9f1c-4cdf-af71-5b8e078c6874",
  "53dffdef-e317-40e7-b6ea-770243aa01ea","75d0051a-15f9-453c-a3f9-63cb596ccd82","78274122-bd0b-4344-9d0c-5a0f170278f6",
  "89f05b97-03c7-4a32-8411-58d82a3dd23a","93766ef5-11ef-4c89-b1b7-b9583be3ac98","a0017625-820e-43f8-93eb-28c2045afd62",
  "a90ad193-ad7d-479e-807c-badbceee83f8","ace40dda-1f26-414d-af9b-0c81b543e3f6","b6a7a590-3121-433f-89c1-6c887482d2bb",
  "c2409007-ad94-40bc-81f9-49f6fb12a3da","c82ce6ca-2a71-4413-8274-52ad68274896","f0c944e7-2a82-46f5-be51-b40394789dc5",
  "f1974bb2-2fff-45e5-b02c-7c29f65bf9c4","f958195d-4725-41d6-8007-d1dd8c269c70",
]);

const allPaths = await listAllRecursive(bucket);
console.log("Silme öncesi toplam nesne:", allPaths.length);

// Güvenlik: yalnızca ilk segmenti (klasör/provider id) DOĞRULANMIŞ silinmiş
// hesaplar listesinde olan yollar silinir — beklenmedik bir klasör varsa
// (yeni bir hesap, DB sorgusundan SONRA oluşmuş olabilir) o ATLANIR.
const toDelete = allPaths.filter((p) => verifiedOrphanFolders.has(p.split("/")[0]));
const skipped = allPaths.filter((p) => !verifiedOrphanFolders.has(p.split("/")[0]));
console.log("Silinecek (doğrulanmış yetim) nesne sayısı:", toDelete.length);
console.log("Atlanan (doğrulanmamış klasör) nesne sayısı:", skipped.length);
if (skipped.length > 0) console.log("Atlanan yollar:", JSON.stringify(skipped));

if (toDelete.length === 0) {
  console.log("Silinecek doğrulanmış nesne yok.");
  process.exit(0);
}

// Supabase Storage remove() büyük listelerde parçalanarak çağrılır (güvenli sınır: 100/istek).
const BATCH = 100;
let deletedCount = 0;
for (let i = 0; i < toDelete.length; i += BATCH) {
  const batch = toDelete.slice(i, i + BATCH);
  const { data, error } = await admin.storage.from(bucket).remove(batch);
  if (error) {
    console.error(`Silme hatası (batch ${i}):`, error.message);
  } else {
    deletedCount += data?.length ?? 0;
    console.log(`Batch ${i / BATCH + 1}: ${data?.length ?? 0} nesne silindi.`);
  }
}
console.log("\nToplam silinen nesne:", deletedCount);

const remaining = await listAllRecursive(bucket);
console.log("Silme sonrası KALAN nesne sayısı:", remaining.length);
if (remaining.length > 0) console.log("Kalan yollar:", JSON.stringify(remaining));
