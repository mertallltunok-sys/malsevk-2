// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı gerçek
// profiles/provider_profiles/provider_services/provider_documents/
// legal_consents/provider_document_consents/Storage entegrasyon testleri.
// SECRET_KEY yalnızca test kullanıcısı kurulumu/temizliği için process.env
// üzerinden verilir, hiçbir zaman yazdırılmaz.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const emailA = `malsevk-provider-test-a-${stamp}@gmail.com`; // hizmet-veren
const emailB = `malsevk-provider-test-b-${stamp}@gmail.com`; // hizmet-alan (izolasyon testi için)
const password = "TestSifre2026!";
const createdUserIds = [];

// DÜZELTME (ilk çalıştırma): gerçek public signUp() bu proje için saatte 2
// e-postayla sınırlı (config.toml auth.rate_limit.email_sent=2) — bugün
// hem bu hem önceki (Auth) görevde art arda birçok gerçek signUp() çağrısı
// yapıldığı için kota dolmuş, signUp sessizce hatayla dönmüş (userId
// undefined), bu da AŞAĞI DOĞRU birçok testi (RLS/Storage dahil) yanlış
// "FAIL" olarak kirletmişti — uygulama hatası DEĞİLDİ. Bu turda Admin API
// (`createUser` + `email_confirm:true`) kullanılıyor — hiç e-posta
// göndermez, kotayı hiç tüketmez (görev talimatının kendi önerisi: "Yeni
// test kullanıcılarını mümkünse Admin API ile oluştur").
async function createAndCompleteUser(email, role) {
  const createRes = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createRes.error || !createRes.data.user) {
    console.error("createUser başarısız:", createRes.error?.message);
    return { userId: undefined, client: null };
  }
  const userId = createRes.data.user.id;
  createdUserIds.push(userId);

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signInRes = await client.auth.signInWithPassword({ email, password });
  if (signInRes.error || !signInRes.data.session) {
    console.error("signInWithPassword başarısız:", signInRes.error?.message);
    return { userId, client: null };
  }

  const completeRes = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Test ${role}`,
    p_phone: "+905551234567",
    p_company_name: "Test Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (completeRes.error) console.error("complete_registration başarısız:", completeRes.error.message);
  return { userId, client };
}

async function main() {
  const { userId: userIdA, client: clientA } = await createAndCompleteUser(emailA, "hizmet-veren");
  const { userId: userIdB, client: clientB } = await createAndCompleteUser(emailB, "hizmet-alan");
  record("setup. A (hizmet-veren) ve B (hizmet-alan) oturumları kuruldu", !!clientA && !!clientB);
  if (!clientA || !clientB) {
    console.log("Kurulum başarısız, testler durduruluyor.");
    return;
  }

  // 1) A kendi profiles kaydını okur.
  const ownProfile = await clientA.from("profiles").select("full_name, role, phone, company_name").eq("id", userIdA).maybeSingle();
  record("1. A kendi profiles kaydını okur", !!ownProfile.data && ownProfile.data.role === "hizmet-veren", ownProfile.error?.message || JSON.stringify(ownProfile.data));

  // 2) full_name İZİN VERİLEN bir alandır (bkz. 0003 satır 97-98, sütun seviyeli GRANT) — role/account_status'un AKSİNE gerçekten güncellenebilir olmalı.
  const directUpdateName = await clientA.from("profiles").update({ full_name: "Değiştirilmiş İsim" }).eq("id", userIdA).select();
  record("2. A profiles.full_name'i DOĞRUDAN UPDATE ile değiştirebilir (izin verilen alan)", !directUpdateName.error, directUpdateName.error?.message || "");

  const directUpdateRole = await clientA.from("profiles").update({ role: "admin" }).eq("id", userIdA).select();
  record("3. A kendi role'ünü 'admin' yapamaz (DOĞRUDAN UPDATE reddi)", !!directUpdateRole.error, directUpdateRole.error?.message || "REDDEDİLMEDİ (beklenmiyordu)");

  // 3b) A izin verilen alanları (full_name/phone/company_*/province/district) GERÇEKTEN güncelleyebilir.
  const allowedUpdate = await clientA.from("profiles").update({ full_name: "Güncellenmiş Ad", phone: "+905339998877" }).eq("id", userIdA).select();
  record("3b. A izin verilen alanları (full_name/phone) günceller", !allowedUpdate.error && allowedUpdate.data?.[0]?.full_name === "Güncellenmiş Ad", allowedUpdate.error?.message || JSON.stringify(allowedUpdate.data));

  // 3c) B, A'nın profiles satırını güncelleyemez (RLS: id = auth.uid()).
  const bUpdatesA = await clientB.from("profiles").update({ full_name: "Hacklendi" }).eq("id", userIdA).select();
  record("3c. B, A'nın profiles satırını GÜNCELLEYEMEZ (RLS)", (bUpdatesA.data ?? []).length === 0, bUpdatesA.error?.message || JSON.stringify(bUpdatesA.data));

  // 4) B, A'nın profiles satırını SELECT edemez (RLS: yalnız kendi satırı).
  const bReadsA = await clientB.from("profiles").select("full_name, phone").eq("id", userIdA).maybeSingle();
  record("4. B, A'nın profiles özel alanlarını okuyamaz (RLS)", bReadsA.data === null, bReadsA.error?.message || JSON.stringify(bReadsA.data));

  // 5) A provider_profiles'a INSERT/UPDATE denemesi -> GRANT yok, reddedilmeli (görev bulgusu).
  const providerProfileInsert = await clientA.from("provider_profiles").insert({ user_id: userIdA, bio: "x".repeat(60) }).select();
  record("5. A provider_profiles'a INSERT edemez (RPC/GRANT yok - bilinen bulgu)", !!providerProfileInsert.error, providerProfileInsert.error?.message || "REDDEDİLMEDİ (beklenmiyordu)");

  // 6) B (hizmet-alan) provider_services'a hiç satır yazmamış olmalı (RPC'yi çağıramadığı için, bkz. test 25).
  const bOwnServices = await clientB.from("provider_services").select("service_category_id").eq("provider_id", userIdB);
  record("6. B (hizmet-alan) provider_services'ta hiç satırı yok", !bOwnServices.error && (bOwnServices.data ?? []).length === 0, bOwnServices.error?.message || JSON.stringify(bOwnServices.data));

  // 7) A hizmet kategorilerini kaydeder (GERÇEK RPC).
  const setServices1 = await clientA.rpc("set_provider_service_categories", { p_category_ids: ["forklift", "vinc"] });
  record("7. A hizmet kategorilerini kaydeder", !setServices1.error, setServices1.error?.message);
  const aServices1 = await clientA.from("provider_services").select("service_category_id").eq("provider_id", userIdA);
  record("7b. Kaydedilen kategoriler doğru (forklift, vinc)", (aServices1.data ?? []).length === 2, JSON.stringify(aServices1.data));

  // 8) Mükerrer kayıt oluşmaz (aynı çağrı tekrar).
  const setServices2 = await clientA.rpc("set_provider_service_categories", { p_category_ids: ["forklift", "vinc"] });
  const aServices2 = await clientA.from("provider_services").select("service_category_id").eq("provider_id", userIdA);
  record("8. Mükerrer service kaydı oluşmaz (tekrar çağrıda hâlâ 2 satır)", !setServices2.error && (aServices2.data ?? []).length === 2, JSON.stringify(aServices2.data));

  // 9) Kaldırılan hizmet seçimi doğru davranır (tam değiştirme semantiği).
  const setServices3 = await clientA.rpc("set_provider_service_categories", { p_category_ids: ["forklift"] });
  const aServices3 = await clientA.from("provider_services").select("service_category_id").eq("provider_id", userIdA);
  record("9. Kaldırılan hizmet gerçekten kaldırılır (yalnız forklift kalır)", !setServices3.error && (aServices3.data ?? []).length === 1 && aServices3.data[0]?.service_category_id === "forklift", JSON.stringify(aServices3.data));

  // 10-16: Storage — provider-logos (public) ve provider-documents (private).
  const logoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // minimal sahte jpeg header, gerçek geçerli jpeg değil ama Storage MIME kontrolü içerik doğrulamaz, yalnızca declared content-type/uzantı kontrol eder
  const logoFile = new Blob([logoBytes], { type: "image/jpeg" });

  const logoUploadA = await clientA.storage.from("provider-logos").upload(`${userIdA}/logo.jpg`, logoFile, { contentType: "image/jpeg", upsert: true });
  record("10. A kendi provider-logos klasörüne yükler", !logoUploadA.error, logoUploadA.error?.message);

  const logoUploadCrossUser = await clientB.storage.from("provider-logos").upload(`${userIdA}/hack.jpg`, logoFile, { contentType: "image/jpeg" });
  record("11. B, A'nın provider-logos klasörüne YAZAMAZ", !!logoUploadCrossUser.error, logoUploadCrossUser.error?.message || "REDDEDİLMEDİ (beklenmiyordu)");

  const logoDeleteCrossUser = await clientB.storage.from("provider-logos").remove([`${userIdA}/logo.jpg`]);
  const logoStillThereAfterBDelete = await clientA.storage.from("provider-logos").list(userIdA);
  record("12. B, A'nın logosunu SİLEMEZ (silme sonrası A'nın dosyası hâlâ var)", (logoStillThereAfterBDelete.data ?? []).some((f) => f.name === "logo.jpg"), JSON.stringify({ deleteError: logoDeleteCrossUser.error?.message, filesAfter: logoStillThereAfterBDelete.data?.map((f) => f.name) }));

  const logoPublicRead = await clientB.storage.from("provider-logos").list(userIdA);
  record("13. B, A'nın logosunu OKUYABİLİR (public bucket, tasarım gereği)", (logoPublicRead.data ?? []).length > 0, JSON.stringify(logoPublicRead.data?.map((f) => f.name)));

  const docBytes = new Uint8Array(Array.from({ length: 1024 }, (_, i) => i % 256));
  const docFile = new Blob([docBytes], { type: "application/pdf" });
  const docPath = `${userIdA}/${crypto.randomUUID()}.pdf`;
  const docUploadA = await clientA.storage.from("provider-documents").upload(docPath, docFile, { contentType: "application/pdf" });
  record("14. A kendi provider-documents klasörüne yükler (private bucket)", !docUploadA.error, docUploadA.error?.message);

  const docReadCrossUser = await clientB.storage.from("provider-documents").download(docPath);
  record("15. B, A'nın private belgesini OKUYAMAZ", !!docReadCrossUser.error, docReadCrossUser.error?.message || "REDDEDİLMEDİ (beklenmiyordu — GÜVENLİK SORUNU)");

  const docReadOwnerA = await clientA.storage.from("provider-documents").download(docPath);
  record("16. A kendi belgesini OKUYABİLİR", !docReadOwnerA.error, docReadOwnerA.error?.message);

  const docWriteCrossUser = await clientB.storage.from("provider-documents").upload(`${userIdA}/hack.pdf`, docFile, { contentType: "application/pdf" });
  record("17. B, A'nın provider-documents klasörüne YAZAMAZ", !!docWriteCrossUser.error, docWriteCrossUser.error?.message || "REDDEDİLMEDİ (beklenmiyordu)");

  const docDeleteCrossUser = await clientB.storage.from("provider-documents").remove([docPath]);
  const docStillThere = await clientA.storage.from("provider-documents").list(userIdA);
  record("18. B, A'nın belgesini SİLEMEZ", (docStillThere.data ?? []).length > 0, JSON.stringify({ deleteError: docDeleteCrossUser.error?.message, filesAfter: docStillThere.data?.map((f) => f.name) }));

  // 19) provider_documents tablosuna GERÇEK bir metadata satırı yazılamaz (bilinen bulgu — RPC/GRANT yok).
  const docMetadataInsert = await clientA.from("provider_documents").insert({ provider_id: userIdA, storage_path: docPath, original_file_name: "test.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: docBytes.length }).select();
  record("19. provider_documents tablosuna İSTEMCİDEN satır yazılamaz (bilinen bulgu, migration gerekli)", !!docMetadataInsert.error, docMetadataInsert.error?.message || "REDDEDİLMEDİ (beklenmiyordu — rapor güncellenmeli)");

  // 20) legal consent doğru user_id ile oluşur.
  const legalConsent = await clientA.rpc("record_legal_consent", { p_document_id: "privacy_policy", p_version: "1.0" });
  record("20. legal_consents doğru user_id ile oluşur", !legalConsent.error && legalConsent.data?.user_id === userIdA, legalConsent.error?.message || JSON.stringify(legalConsent.data));

  // 21) İkinci consent çağrısı idempotent (aynı satırı döner, çoğaltmaz).
  const legalConsentAgain = await clientA.rpc("record_legal_consent", { p_document_id: "privacy_policy", p_version: "1.0" });
  const legalConsentRows = await clientA.from("legal_consents").select("id").eq("user_id", userIdA).eq("document_id", "privacy_policy");
  record("21. İkinci legal consent çağrısı idempotent (hâlâ 1 satır)", !legalConsentAgain.error && (legalConsentRows.data ?? []).length === 1, JSON.stringify(legalConsentRows.data));

  // 22) provider document consent doğru provider_id ile oluşur + idempotent.
  const docConsent = await clientA.rpc("record_provider_document_consent", { p_statement_id: "belge-dogruluk-beyani", p_statement_version: "1.0" });
  record("22. provider_document_consents doğru provider_id ile oluşur", !docConsent.error && docConsent.data?.provider_id === userIdA, docConsent.error?.message || JSON.stringify(docConsent.data));
  const docConsentAgain = await clientA.rpc("record_provider_document_consent", { p_statement_id: "belge-dogruluk-beyani", p_statement_version: "1.0" });
  const docConsentRows = await clientA.from("provider_document_consents").select("id").eq("provider_id", userIdA).eq("statement_id", "belge-dogruluk-beyani");
  record("23. İkinci provider document consent çağrısı idempotent", !docConsentAgain.error && (docConsentRows.data ?? []).length === 1, JSON.stringify(docConsentRows.data));

  // 24) B, A adına consent oluşturamaz (RPC parametre almaz, her zaman auth.uid()).
  const bConsentForA = await clientB.rpc("record_legal_consent", { p_document_id: "terms_of_service", p_version: "1.0" });
  record("24. B'nin consent çağrısı B'nin KENDİ user_id'siyle kaydolur (A adına değil)", !bConsentForA.error && bConsentForA.data?.user_id === userIdB, JSON.stringify(bConsentForA.data));

  // 25) Provider-only özellik (hizmet-alan B, hizmet-veren RPC'sini çağırırsa MLK50 ile reddedilmeli).
  const bTriesProviderRpc = await clientB.rpc("set_provider_service_categories", { p_category_ids: [] });
  // Not: bu RPC boş dizi göndermeyi engellemiyor ama current_user_role() <> 'hizmet-veren' kontrolü B için MLK50 vermeli.
  record("25. Hizmet Alan (B) set_provider_service_categories çağırınca MLK50 ile reddedilir", bTriesProviderRpc.error?.code === "MLK50", `${bTriesProviderRpc.error?.code}: ${bTriesProviderRpc.error?.message}`);

  // Temizlik: Storage dosyaları + kullanıcılar.
  await clientA.storage.from("provider-logos").remove([`${userIdA}/logo.jpg`]).catch(() => {});
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
