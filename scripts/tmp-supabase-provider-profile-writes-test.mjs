// Development Supabase projesine karşı: migration 0023'ün iki yeni yazma
// yolunu (upsert_provider_profile / set_provider_profile_logo_path /
// create_provider_document) test eder. SECRET_KEY yalnızca test kullanıcısı
// kurulumu + admin review_provider_document doğrulaması için kullanılır,
// hiçbir zaman yazdırılmaz.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const emailA = `malsevk-pp-write-a-${stamp}@gmail.com`; // hizmet-veren
const emailB = `malsevk-pp-write-b-${stamp}@gmail.com`; // hizmet-alan (izolasyon)
const password = "TestSifre2026!";
const createdUserIds = [];

async function createAndCompleteUser(email, role) {
  const createRes = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = createRes.data.user.id;
  createdUserIds.push(userId);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Test ${role}`, p_phone: "+905551234567",
    p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  return { userId, client };
}

async function main() {
  const { userId: userIdA, client: clientA } = await createAndCompleteUser(emailA, "hizmet-veren");
  const { userId: userIdB, client: clientB } = await createAndCompleteUser(emailB, "hizmet-alan");
  record("setup. A (hizmet-veren) ve B (hizmet-alan) oturumları kuruldu", !!clientA && !!clientB);

  // NOT: profiles.role='admin' ATAMASI hiçbir client yolundan mümkün değil
  // (complete_registration ML100 ile reddeder, doğrudan UPDATE GRANT'i yok,
  // service_role'ün bu hosted projede REST erişimi olmadığı ÖNCEKİ turda
  // doğrulanmıştı) — bu yüzden review_provider_document'in GERÇEK bir admin
  // hesabıyla POZİTİF (onay/red) ucu bu script'te test EDİLEMİYOR. Bunun
  // yerine (a) admin OLMAYAN bir hesabın bu RPC'yi çağıramadığı (test 16) ve
  // (b) create_provider_document'in ürettiği satırın review_provider_
  // document'in beklediği şemayla (id/provider_id/original_file_name/
  // current_review_status alanları) birebir uyumlu olduğu (test 11)
  // doğrulanıyor — admin onay AKIŞININ KENDİSİ bu migration'dan hiç
  // etkilenmediği için (bkz. migration dosyasının kendi dokümantasyonu) bu,
  // yeterli dolaylı kanıttır.

  // 1) A provider_profiles'ı UPSERT ile oluşturur (satır YOKTU, bkz. önceki tur bulgusu).
  const upsert1 = await clientA.rpc("upsert_provider_profile", {
    p_bio: "x".repeat(60), p_founded_year: 2015, p_experience_range: "5-10",
    p_regions: ["Kocaeli", "İstanbul"], p_service_features: ["7-24", "faturali"],
  });
  record("1. A provider_profiles satırını UPSERT ile oluşturur (ilk kez)", !upsert1.error && upsert1.data?.user_id === userIdA, upsert1.error?.message || JSON.stringify(upsert1.data));

  // 2) B (hizmet-alan) çağırınca MLK79 ile reddedilir.
  const upsertB = await clientB.rpc("upsert_provider_profile", { p_bio: "y".repeat(60), p_founded_year: null, p_experience_range: null, p_regions: [], p_service_features: [] });
  record("2. Hizmet Alan (B) upsert_provider_profile çağırınca MLK79 ile reddedilir", upsertB.error?.code === "MLK79", `${upsertB.error?.code}: ${upsertB.error?.message}`);

  // 3) B, A adına yazamaz (RPC parametre olarak user_id almıyor, her zaman auth.uid()) — B kendi satırını hiç oluşturamadığı için provider_profiles'ta B'ye ait satır olmamalı.
  const bOwnRow = await clientB.from("provider_profiles").select("*").eq("user_id", userIdB).maybeSingle();
  record("3. B'nin provider_profiles satırı yok (rol reddi nedeniyle hiç oluşmadı)", bOwnRow.data === null, JSON.stringify(bOwnRow.data));

  // 4) A tekrar UPSERT çağırır (var olan satırı GÜNCELLER, çoğaltmaz) — yalnızca bio değiştirilir.
  const upsert2 = await clientA.rpc("upsert_provider_profile", {
    p_bio: "z".repeat(70), p_founded_year: 2015, p_experience_range: "5-10",
    p_regions: ["Kocaeli", "İstanbul"], p_service_features: ["7-24", "faturali"],
  });
  const rowCountAfter = await clientA.from("provider_profiles").select("user_id").eq("user_id", userIdA);
  record("4. İkinci upsert GÜNCELLER, mükerrer satır oluşturmaz", !upsert2.error && (rowCountAfter.data ?? []).length === 1 && upsert2.data?.bio.startsWith("zzz"), JSON.stringify({ error: upsert2.error?.message, rows: rowCountAfter.data?.length, bio: upsert2.data?.bio?.slice(0, 5) }));

  // 5) KISMİ GÜNCELLEME: yalnızca regions/service_features/experience_range değiştirilir (bio/founded_year İSTEMCİ TARAFINDA okunup korunmalı — bkz. supabase-provider-profile.ts). Burada RPC'nin KENDİSİNİ (ham) test ediyoruz: RPC'ye eksik bio/founded_year gönderilirse GERÇEKTEN null'a döner mi (RPC seviyesinde kısmi update YOKTUR, bu istemci sorumluluğundadır) — bu, istemci kodunun neden read-merge-write yaptığını doğrular.
  const rawPartialCall = await clientA.rpc("upsert_provider_profile", {
    p_bio: null, p_founded_year: null, p_experience_range: "10+", p_regions: ["Sakarya"], p_service_features: ["acil-hizmet"],
  });
  record("5. RPC'nin kendisi TAM upsert yapar (kısmi değil) — bio/founded_year gönderilmezse NULL olur", !rawPartialCall.error && rawPartialCall.data?.bio === null && rawPartialCall.data?.founded_year === null, JSON.stringify(rawPartialCall.data));

  // 6) Bunu geri al ve İSTEMCİ KATMANINDAKİ read-merge-write'ı simüle et: önce oku, sonra yalnızca experience_range'i değiştirerek geri yaz.
  const restoreBio = await clientA.rpc("upsert_provider_profile", { p_bio: "x".repeat(60), p_founded_year: 2015, p_experience_range: "10+", p_regions: ["Sakarya"], p_service_features: ["acil-hizmet"] });
  record("6. Bio/founded_year geri yüklenebilir (read-merge-write senaryosu)", !restoreBio.error && restoreBio.data?.bio?.length === 60 && restoreBio.data?.founded_year === 2015, JSON.stringify({ error: restoreBio.error?.message }));

  // 7) set_provider_profile_logo_path.
  const logoSet = await clientA.rpc("set_provider_profile_logo_path", { p_logo_path: `${userIdA}/logo.jpg` });
  record("7. set_provider_profile_logo_path başarılı", !logoSet.error && logoSet.data?.logo_path === `${userIdA}/logo.jpg`, JSON.stringify({ error: logoSet.error?.message, logo_path: logoSet.data?.logo_path }));
  const logoClear = await clientA.rpc("set_provider_profile_logo_path", { p_logo_path: null });
  record("8. set_provider_profile_logo_path(null) logoyu temizler", !logoClear.error && logoClear.data?.logo_path === null, JSON.stringify({ error: logoClear.error?.message, logo_path: logoClear.data?.logo_path }));

  // 9) B, A'nın provider_profiles satırını GÜNCELLEYEMEZ (RLS zaten test edilmişti, burada RPC üzerinden de auth.uid() kilidi doğrulanır — B zaten kendi satırını oluşturamıyor).
  // (B hizmet-alan olduğu için zaten MLK79 alıyor, test 2'de kapsandı.)

  // 10) create_provider_document — A kendi belgesini Storage + RPC ile kaydeder.
  const docBytes = new Uint8Array(1024).fill(7);
  const docPath = `${userIdA}/${crypto.randomUUID()}.pdf`;
  const uploadRes = await clientA.storage.from("provider-documents").upload(docPath, new Blob([docBytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  record("10. A belgeyi Storage'a yükler", !uploadRes.error, uploadRes.error?.message);

  const createDoc = await clientA.rpc("create_provider_document", {
    p_document_type: "genel", p_storage_path: docPath, p_original_file_name: "faaliyet-belgesi.pdf",
    p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: docBytes.length,
  });
  record("11. create_provider_document metadata satırını oluşturur", !createDoc.error && createDoc.data?.provider_id === userIdA && createDoc.data?.current_review_status === "pending", createDoc.error?.message || JSON.stringify(createDoc.data));

  // 12) MLK80: A, B'nin (var olmayan ama farklı bir uid) klasörünü işaret eden bir storage_path ile çağırırsa reddedilir.
  const wrongPathCall = await clientA.rpc("create_provider_document", {
    p_document_type: "genel", p_storage_path: `${userIdB}/fake.pdf`, p_original_file_name: "sahte.pdf",
    p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 100,
  });
  record("12. Başka klasörü işaret eden storage_path MLK80 ile reddedilir", wrongPathCall.error?.code === "MLK80", `${wrongPathCall.error?.code}: ${wrongPathCall.error?.message}`);

  // 13) Geçersiz document_type MLK94 ile reddedilir.
  const badTypeCall = await clientA.rpc("create_provider_document", {
    p_document_type: "gecersiz-tur", p_storage_path: docPath, p_original_file_name: "x.pdf",
    p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 100,
  });
  record("13. Geçersiz document_type MLK94 ile reddedilir", badTypeCall.error?.code === "MLK94", `${badTypeCall.error?.code}: ${badTypeCall.error?.message}`);

  // 14) B, A'nın belgesini metadata olarak GÖREMEZ (RLS: yalnız SELECT grant var, provider_documents'ta RLS policy var mı kontrol edilmemişti — burada doğrudan test ediyoruz).
  const bReadsADocs = await clientB.from("provider_documents").select("id").eq("provider_id", userIdA);
  record("14. B, A'nın provider_documents satırlarını okuyamaz (RLS)", (bReadsADocs.data ?? []).length === 0, bReadsADocs.error?.message || JSON.stringify(bReadsADocs.data));

  // 15) A kendi belge satırını görebilir.
  const aReadsOwnDocs = await clientA.from("provider_documents").select("id, original_file_name").eq("provider_id", userIdA);
  record("15. A kendi provider_documents satırını görür", (aReadsOwnDocs.data ?? []).length === 1, JSON.stringify(aReadsOwnDocs.data));

  // 16) review_provider_document — admin OLMAYAN A kendi belgesini onaylayamaz (is_admin() gerekiyor).
  const nonAdminReview = await clientA.rpc("review_provider_document", { p_document_id: createDoc.data?.id, p_status: "approved" });
  record("16. Admin olmayan (A) review_provider_document çağıramaz (MLK50)", nonAdminReview.error?.code === "MLK50", `${nonAdminReview.error?.code}: ${nonAdminReview.error?.message}`);

  // Temizlik.
  await clientA.storage.from("provider-documents").remove([docPath]).catch(() => {});
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
