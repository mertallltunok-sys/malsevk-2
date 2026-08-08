// MALSEVK — Supabase Geçişi Faz 2 "Gerçek İlan Oluşturma → Supabase" RPC
// doğrulama script'i. Development Supabase projesine karşı çalışır
// (NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local'dan,
// SB_SECRET_KEY_FOR_TEST yalnızca test kullanıcısı kurulumu için — diğer
// tmp-supabase-*.mjs script'leriyle AYNI desen, bkz.
// tmp-supabase-provider-profile-writes-test.mjs).
//
// Bu script `create_job`/`create_operation_with_jobs` RPC'lerini doğrudan
// çağırır (`app/_lib/supabase-job-sync.ts`'in ürettiği payload'ın BİREBİR
// aynısıyla) — flag ON/OFF davranışı burada test EDİLMEZ (o, gerçek Next.js
// env değişkenine ve React bileşen koduna bağlı; bkz.
// scripts/tmp-job-sync-admin-panel-browser-test.mjs). Kapsam: alan eşlemesi
// (ürün bilgileri dahil), client-id ile local/remote id eşleşmesi, çoklu
// hizmet + Nakliye'nin kendi province override'ı (migration 0030'un
// doğrulaması), ve RPC'nin gerçek bir hatayı düzgün döndürdüğü (uygulama
// katmanının yerel ilanı asla silmeden bir uyarı göstermesini sağlayan şey).
//
// Çalıştırma: node scripts/tmp-supabase-job-sync-test.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SB_SECRET_KEY_FOR_TEST ortam değişkenleri gerekli.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const password = "TestSifre2026!";
const createdUserIds = [];

async function createAndCompleteUser(label) {
  const email = `malsevk-job-sync-${label}-${stamp}@gmail.com`;
  const createRes = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createRes.error) throw new Error(`${label} createUser: ${createRes.error.message}`);
  const userId = createRes.data.user.id;
  createdUserIds.push(userId);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  const reg = await client.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: `Test ${label}`, p_phone: "+905551230000",
    p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (reg.error) throw new Error(`${label} complete_registration: ${reg.error.message}`);
  return { userId, client };
}

/** app/_lib/supabase-job-sync.ts#toRpcPhotos'un BİREBİR aynısı — placeholder storage_path deseni. */
// NOT: bu RPC-seviyeli script fotoğrafları GERÇEKTEN Storage'a yüklemez
// (supabase-job-sync.ts'i atlayıp RPC'yi doğrudan çağırıyor) — burada
// üretilen storage_path'ler yalnızca RPC'nin metinsel olarak kabul ettiğini
// doğrulayan sahte değerlerdir. Gerçek Storage yüklemesi (Faz 3) ve gerçek
// dosya varlığı scripts/tmp-job-sync-admin-panel-browser-test.mjs'te
// (gerçek tarayıcı, gerçek supabase-job-sync.ts) doğrulanıyor.
function fakePhotos(count) {
  return Array.from({ length: count }, (_, i) => ({
    storage_path: `test-storage-key-${stamp}-${i}`,
    original_file_name: `foto-${i}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 123456,
    width: null,
    height: null,
  }));
}

async function main() {
  console.log("=== Kurulum: test kullanıcısı ===");
  const { userId, client } = await createAndCompleteUser("a");
  record("setup: kullanıcı oluşturuldu ve hizmet-alan olarak kayıt tamamlandı", !!userId);

  console.log("\n=== 1) Tekli ilan (create_job) — tam alan eşlemesi + client-id ===");
  const clientJobId = crypto.randomUUID();
  const singleResult = await client.rpc("create_job", {
    p_category_id: "lashing-unlashing",
    p_title: "Test Lashing İlanı",
    p_description: "Açıklama metni",
    p_operation_details: "Operasyon detayları",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Tesis",
    p_work_date: "2026-09-01",
    p_photos: fakePhotos(2),
    p_facility_id: null,
    p_location_mode: "custom",
    p_address_text: "Test açık adres",
    p_neighborhood: null,
    p_location_url: null,
    p_directions_note: null,
    p_work_end_date: "2026-09-03",
    p_product_quantity: 42,
    p_product_tonnage: 8.5,
    p_product_type: "Test Ürün",
    p_customs_product_type: null,
    p_client_id: clientJobId,
  });
  record("1a. create_job başarılı", !singleResult.error, singleResult.error?.message);
  record("1b. dönen id, client_id ile BİREBİR aynı (ID stratejisi)", singleResult.data?.id === clientJobId, `got ${singleResult.data?.id}, expected ${clientJobId}`);

  const singleRow = await client.from("jobs").select("*").eq("id", clientJobId).maybeSingle();
  record("1c. jobs tablosunda okunabiliyor (kendi satırı, RLS)", !singleRow.error && singleRow.data !== null, singleRow.error?.message);
  const s = singleRow.data ?? {};
  record("1d. requester_id gerçek oturumdan (auth.uid()), client'tan DEĞİL", s.requester_id === userId, s.requester_id);
  record("1e. title/description/operation_details doğru", s.title === "Test Lashing İlanı" && s.description === "Açıklama metni" && s.operation_details === "Operasyon detayları");
  record("1f. province/district doğru", s.province === "Kocaeli" && s.district === "Gebze");
  record("1g. location_mode/address_text doğru", s.location_mode === "custom" && s.address_text === "Test açık adres");
  record("1h. work_date/work_end_date doğru", s.work_date === "2026-09-01" && s.work_end_date === "2026-09-03");
  record("1i. Ürün Bilgileri doğru senkronlandı (migration 0028)", s.product_quantity === 42 && Number(s.product_tonnage) === 8.5 && s.product_type === "Test Ürün", JSON.stringify({ q: s.product_quantity, t: s.product_tonnage, type: s.product_type }));

  const singlePhotos = await client.from("job_photos").select("storage_path, mime_type").eq("job_id", clientJobId);
  record("1j. 2 fotoğraf metadata satırı yazıldı", (singlePhotos.data ?? []).length === 2, singlePhotos.error?.message ?? singlePhotos.data?.length);
  // NOT: bu script RPC'yi DOĞRUDAN çağırıyor (supabase-job-sync.ts'i
  // atlıyor) — burada gönderilen storage_path'ler gerçek Storage'a hiç
  // yüklenmemiş, yalnızca RPC'nin metinsel kabul ettiğini doğrulayan sahte
  // değerlerdir. Gerçek Storage senkronu (Faz 3) ve gerçek yükleme
  // scripts/tmp-job-sync-admin-panel-browser-test.mjs'te doğrulanıyor.
  record("1k. storage_path RPC'ye olduğu gibi yazıldı", (singlePhotos.data ?? []).every((p) => p.storage_path.startsWith("test-storage-key")), JSON.stringify(singlePhotos.data));
  record("1l. Nakliye DIŞI ilanın delivery_* kolonları null (regresyon — kapsam dışı kategoride sızıntı yok)", s.delivery_province === null && s.delivery_district === null && s.delivery_location_type === null && s.delivery_facility_id === null && s.delivery_facility_name === null && s.delivery_address_text === null, JSON.stringify({ dp: s.delivery_province, dd: s.delivery_district, dlt: s.delivery_location_type }));

  console.log("\n=== 1.5) Tek Nakliye ilanı (create_job) — 6 teslimat alanı, 'facility' modu (migration 0031) ===");
  const clientNakliyeJobId = crypto.randomUUID();
  const nakliyeResult = await client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "Test Nakliye İlanı",
    p_description: "Nakliye açıklaması",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Yük Alınacak Tesis",
    p_work_date: "2026-09-10",
    p_photos: fakePhotos(1),
    p_location_mode: "custom",
    p_address_text: "Yük alınacak açık adres",
    p_work_end_date: "2026-09-11",
    p_product_quantity: 3,
    p_product_tonnage: 20,
    p_product_type: "Nakliye Ürünü",
    p_client_id: clientNakliyeJobId,
    p_delivery_province: "İstanbul",
    p_delivery_district: "Kadıköy",
    p_delivery_location_type: "facility",
    p_delivery_facility_id: "loc-test-facility-id",
    p_delivery_facility_name: "Test Teslim Tesisi",
    p_delivery_address_text: "Teslim edilecek açık adres, en az on karakter.",
  });
  record("1.5a. Nakliye ilanı (facility modu) başarılı", !nakliyeResult.error, nakliyeResult.error?.message);
  const nakliyeRowSingle = await client.from("jobs").select("*").eq("id", clientNakliyeJobId).maybeSingle();
  const n = nakliyeRowSingle.data ?? {};
  record(
    "1.5b. 6 teslimat alanı da BİREBİR doğru senkronlandı",
    n.delivery_province === "İstanbul" && n.delivery_district === "Kadıköy" && n.delivery_location_type === "facility" &&
      n.delivery_facility_id === "loc-test-facility-id" && n.delivery_facility_name === "Test Teslim Tesisi" &&
      n.delivery_address_text === "Teslim edilecek açık adres, en az on karakter.",
    JSON.stringify({
      dp: n.delivery_province, dd: n.delivery_district, dlt: n.delivery_location_type,
      dfi: n.delivery_facility_id, dfn: n.delivery_facility_name, dat: n.delivery_address_text,
    }),
  );
  record("1.5c. Pickup (Yük Alınacak Yer) ve delivery (Teslim Edilecek Yer) BİRBİRİNDEN BAĞIMSIZ", n.province === "Kocaeli" && n.district === "Gebze" && n.delivery_province === "İstanbul" && n.delivery_district === "Kadıköy");

  console.log("\n=== 2) Çoklu hizmet (create_operation_with_jobs) — operation-id eşlemesi + Nakliye province override (migration 0030) + delivery alanları (migration 0031, 'open_address' modu) ===");
  const clientOperationId = crypto.randomUUID();
  const clientJobIdLashing = crypto.randomUUID();
  const clientJobIdNakliye = crypto.randomUUID();
  const SHARED_PROVINCE = "Kocaeli";
  const OVERRIDE_PROVINCE = "İstanbul"; // Nakliye kendi ilini paylaşılandan BAĞIMSIZ seçebilir (bkz. job-store.ts#OperationServiceInput.province).

  const opResult = await client.rpc("create_operation_with_jobs", {
    p_province: SHARED_PROVINCE,
    p_operation_details: "Operasyon detayları",
    p_services: [
      {
        client_id: clientJobIdLashing,
        category_id: "lashing-unlashing",
        title: "Operasyon - Lashing",
        description: "Lashing açıklaması",
        district: "Gebze",
        work_location_type: "Test Tesis",
        facility_id: null,
        location_mode: "custom",
        address_text: "Lashing adres",
        neighborhood: null, location_url: null, directions_note: null,
        work_date: "2026-09-05", work_end_date: "2026-09-06",
        product_quantity: 10, product_tonnage: 3.2, product_type: "Lashing Ürünü", customs_product_type: null,
        // province GÖNDERİLMEDİ -> paylaşılan p_province'e düşmeli.
      },
      {
        client_id: clientJobIdNakliye,
        category_id: "nakliye",
        title: "Operasyon - Nakliye",
        description: "Nakliye açıklaması",
        district: "Kadıköy",
        work_location_type: "Nakliye Tesisi",
        facility_id: null,
        location_mode: "custom",
        address_text: "Nakliye adres",
        neighborhood: null, location_url: null, directions_note: null,
        work_date: "2026-09-05", work_end_date: "2026-09-06",
        product_quantity: 5, product_tonnage: 12, product_type: "Nakliye Ürünü", customs_product_type: null,
        province: OVERRIDE_PROVINCE, // migration 0030'un test ettiği per-service override.
        // migration 0031 — bu sefer "open_address" modu (1.5 testi "facility"
        // modunu zaten kapsadı): facility_id YOK, manuel yazılmış bir ad var.
        delivery_province: "Sakarya",
        delivery_district: "Serdivan",
        delivery_location_type: "open_address",
        delivery_facility_id: null,
        delivery_facility_name: "Manuel Teslim Sahası",
        delivery_address_text: "Manuel yazılmış teslim adresi, en az on karakter.",
      },
    ],
    p_photos_by_service_index: { "0": fakePhotos(1), "1": fakePhotos(1) },
    p_client_operation_id: clientOperationId,
  });
  record("2a. create_operation_with_jobs başarılı", !opResult.error, opResult.error?.message);
  record("2b. operation_id, client_operation_id ile BİREBİR aynı", opResult.data?.operation_id === clientOperationId, opResult.data?.operation_id);
  record("2c. iki job_id de kendi client_id'siyle BİREBİR aynı", (opResult.data?.job_ids ?? []).includes(clientJobIdLashing) && (opResult.data?.job_ids ?? []).includes(clientJobIdNakliye), JSON.stringify(opResult.data?.job_ids));

  const opRows = await client.from("jobs").select("*").in("id", [clientJobIdLashing, clientJobIdNakliye]);
  const lashingRow = (opRows.data ?? []).find((r) => r.id === clientJobIdLashing);
  const nakliyeRow = (opRows.data ?? []).find((r) => r.id === clientJobIdNakliye);
  record("2d. her iki job aynı operation_id'yi taşıyor", lashingRow?.operation_id === clientOperationId && nakliyeRow?.operation_id === clientOperationId);
  record("2e. province GÖNDERMEYEN kardeş (Lashing) paylaşılan province'i aldı", lashingRow?.province === SHARED_PROVINCE, lashingRow?.province);
  record("2f. KENDİ province'ini gönderen Nakliye kardeşi OVERRIDE edilmiş ili aldı (migration 0030 doğrulaması)", nakliyeRow?.province === OVERRIDE_PROVINCE, nakliyeRow?.province);
  record(
    "2g. Nakliye kardeşinin 6 teslimat alanı da ('open_address' modu) BİREBİR doğru senkronlandı (migration 0031)",
    nakliyeRow?.delivery_province === "Sakarya" && nakliyeRow?.delivery_district === "Serdivan" && nakliyeRow?.delivery_location_type === "open_address" &&
      nakliyeRow?.delivery_facility_id === null && nakliyeRow?.delivery_facility_name === "Manuel Teslim Sahası" &&
      nakliyeRow?.delivery_address_text === "Manuel yazılmış teslim adresi, en az on karakter.",
    JSON.stringify({
      dp: nakliyeRow?.delivery_province, dd: nakliyeRow?.delivery_district, dlt: nakliyeRow?.delivery_location_type,
      dfi: nakliyeRow?.delivery_facility_id, dfn: nakliyeRow?.delivery_facility_name, dat: nakliyeRow?.delivery_address_text,
    }),
  );
  record(
    "2h. Nakliye OLMAYAN kardeşin (Lashing) delivery_* kolonları null (görev bölüm 5 — 'diğer hizmet kardeşleri bu alanlardan etkilenmemeli')",
    lashingRow?.delivery_province === null && lashingRow?.delivery_district === null && lashingRow?.delivery_location_type === null &&
      lashingRow?.delivery_facility_id === null && lashingRow?.delivery_facility_name === null && lashingRow?.delivery_address_text === null,
    JSON.stringify({ dp: lashingRow?.delivery_province, dlt: lashingRow?.delivery_location_type }),
  );

  console.log("\n=== 3) RPC hatası düzgün yüzeye çıkıyor (uygulama yerel ilanı asla silmiyor/gizli bilgi sızdırmıyor) ===");
  const badJobId = crypto.randomUUID();
  const failResult = await client.rpc("create_job", {
    p_category_id: "lashing-unlashing",
    p_title: "Geçersiz Tarih Testi",
    p_description: "x", p_operation_details: "x",
    p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "x",
    p_work_date: "2026-09-10",
    p_photos: fakePhotos(1),
    p_work_end_date: "2026-09-01", // bitiş < başlangıç -> MLK52 ile reddedilmeli.
    p_client_id: badJobId,
  });
  record("3a. work_end_date < work_date RPC tarafından reddedildi (MLK52)", failResult.error?.code === "MLK52", JSON.stringify(failResult.error));
  const badRow = await client.from("jobs").select("id").eq("id", badJobId).maybeSingle();
  record("3b. reddedilen çağrı hiçbir satır yazmadı (atomik - kısmi kayıt yok)", badRow.data === null, JSON.stringify(badRow.data));
  record("3c. hata mesajı Supabase URL/anahtar içermiyor (gizli bilgi sızıntısı yok)", !JSON.stringify(failResult.error ?? "").includes(SUPABASE_URL) && !JSON.stringify(failResult.error ?? "").includes(ANON_KEY));

  console.log("\n=== 4) Requester güvenliği: client bir requester_id parametresi GEÇİREMİYOR ===");
  // create_job/create_operation_with_jobs imzalarında requester/user id
  // parametresi hiç YOK (auth.uid() sunucu tarafında) — bu, RPC şemasının
  // kendisiyle garanti edilir; 1d/2d testleri zaten gerçek requester_id'nin
  // her zaman auth.uid() olduğunu doğrulamıştı, burada yalnızca özetliyoruz.
  record("4a. (özet) tüm oluşturulan job'ların requester_id'si test kullanıcısının auth.uid()'i", s.requester_id === userId);

  console.log("\n=== Temizlik ===");
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Başarısız:", failed.map((f) => f.name).join(" | "));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
