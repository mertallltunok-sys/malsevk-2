// node scripts/tmp-supabase-document-approval-authorization-gap-test.mjs [--phase=1|2]
//
// KÖK NEDEN İSPATI + DÜZELTME DOĞRULAMASI: "Belge Onayı / Hizmet
// Yetkilendirme Senkron Sorunu" — bir admin bir provider belgesini
// onayladığında (review_provider_document), provider'ın GERÇEK hizmet
// yetkisi (provider_service_authorizations) DEĞİŞMİYORDU; provider
// "/ilanlar"da "Henüz hiçbir hizmet için yetkilendirilmediniz" görmeye
// devam ediyordu. migration 0041 bunu review_provider_document'in
// approved dalına authorize_provider_service çağrısı ekleyerek + geçmiş
// veriyi bir kerelik backfill ederek düzeltir.
//
// Bu script SADECE yerel, izole Docker Supabase yığınına karşı çalışır
// (`npx supabase start`, supabase/config.toml#project_id = "malsevk-2").
// .env.local'daki NEXT_PUBLIC_SUPABASE_URL (hosted dev projesi) HİÇ
// OKUNMAZ — URL/anahtarlar `npx supabase status` çıktısından alınarak
// SABİT yazılmıştır (test-customs-documents-and-badges.mjs ile AYNI desen).
//
// İKİ AŞAMALI ÇALIŞTIRMA (kök nedeni GERÇEKTEN kanıtlamak için):
//   1) `npx supabase db reset` (migration 0041 dosyası GEÇİCİ OLARAK
//      migrations klasöründen çıkarılmış halde) — yalnızca 0001-0040 uygulanır.
//   2) node scripts/tmp-supabase-document-approval-authorization-gap-test.mjs --phase=1
//      -> provider belge yükler, admin onaylar, DB'de "onaylı ama yetkisiz"
//      durumu GERÇEK satırlarla kanıtlanır (BUG PROVEN).
//   3) migration 0041 dosyası geri konur, `npx supabase migration up`
//      (mevcut veriyi SİLMEDEN yalnızca 0041'i uygular — backfill BURADA,
//      tam olarak faz 1'in ürettiği veri üzerinde çalışır).
//   4) node scripts/tmp-supabase-document-approval-authorization-gap-test.mjs --phase=2
//      -> AYNI provider/belge artık yetkilendirilmiş (BACKFILL PROVEN),
//      + yeni bir belge/kategori için CANLI (backfill'siz) otomatik
//      yetkilendirme test edilir (RUNTIME FIX PROVEN),
//      + test matrisi (birden çok kategori), cross-device okuma, ve
//      provider'ın kendi kendine yetki veremediği güvenlik kontrolü.
//
// Önkoşul: `npx supabase start` çalışıyor olmalı (bu script onu başlatmaz).
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = "supabase_db_malsevk-2";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Refusing to run: target URL is not local (safety guard).");
}

const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.split("=")[1] : "1";

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` -- ${extra}` : ""));
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

function psql(sql) {
  // KRİTİK: execSync Windows'ta VARSAYILAN olarak cmd.exe kullanır (Node'un
  // kendi davranışı, bu script'i çağıran Git Bash kabuğundan BAĞIMSIZ) —
  // cmd.exe çok satırlı, tırnak içi bir komut dizesindeki GERÇEK satır
  // sonlarını bash'in aksine doğru işlemez (komutu sessizce keser, boş çıktı
  // üretir — canlı olarak gözlemlendi). Bu yüzden SQL'deki tüm boşluk/satır
  // sonu dizileri TEK boşluğa indirgenir — semantik olarak SQL için hiçbir
  // fark yaratmaz, yalnızca kabuk aktarımını güvenli hale getirir.
  const oneLine = sql.replace(/\s+/g, " ").trim();
  const escaped = oneLine.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -F"|" -c "${escaped}"`, {
    encoding: "utf-8",
    shell: process.platform === "win32" ? undefined : "/bin/sh",
  })
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}
function psqlRows(sql) {
  const out = psql(sql);
  if (out === "") return [];
  return out.split("\n").map((line) => line.split("|"));
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
// Sabit bir tohum kimliği: faz 1 ve faz 2 AYNI kullanıcı/belge üzerinde
// çalışmalı (backfill'i gerçek anlamda kanıtlamak için) — bu yüzden zaman
// damgası yerine SABİT bir etiket kullanılır, faz 1 kaydını STATE dosyasına
// yazar, faz 2 okur.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const STATE_PATH = process.env.MALSEVK_TEST_STATE_PATH || "./malsevk-doc-auth-gap-state.json";

async function makeUser(label, email) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  return { label, id: created.data.user.id, email, client };
}

async function completeRegistration(user, role, fullName) {
  const { error } = await user.client.rpc("complete_registration", {
    p_role: role,
    p_full_name: fullName,
    p_phone: "+905551110099",
    p_company_name: `Test Firma ${user.label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (error) throw new Error(`complete_registration(${user.label}) failed: ${error.message}`);
}

async function uploadAndApprove(provider, adminUser, categoryId, documentType, label) {
  const storagePath = `${provider.id}/${label}-${Date.now()}.pdf`;
  const { data: docData, error: docError } = await provider.client.rpc("create_provider_document", {
    p_document_type: documentType,
    p_storage_path: storagePath,
    p_original_file_name: `${label}.pdf`,
    p_mime_type: "application/pdf",
    p_extension: "pdf",
    p_size_bytes: 12345,
    p_service_category_id: categoryId,
  });
  if (docError) throw new Error(`create_provider_document(${label}) failed: ${docError.message}`);

  const { data: reviewData, error: reviewError } = await adminUser.client.rpc("review_provider_document", {
    p_document_id: docData.id,
    p_status: "approved",
    p_note: null,
  });
  if (reviewError) throw new Error(`review_provider_document(${label}) failed: ${reviewError.message}`);
  return { documentId: docData.id, reviewedRow: reviewData };
}

function activeAuthRow(providerId, categoryId) {
  const rows = psqlRows(
    `select service_category_id, authorized_by, source_document_id, authorize_reason from public.provider_service_authorizations where provider_id = '${providerId}' and service_category_id = '${categoryId}' and revoked_at is null;`,
  );
  return rows[0] ?? null;
}

async function canViewCategory(client, providerId, categoryId) {
  const { data, error } = await client.rpc("provider_can_view_category", { p_provider_id: providerId, p_category_id: categoryId });
  if (error) throw new Error(`provider_can_view_category failed: ${error.message}`);
  return data === true;
}

async function phase1() {
  console.log("\n=== FAZ 1: KÖK NEDENİ KANITLA (yalnızca migration 0001-0040 uygulanmış olmalı) ===");

  const migCount = psql(`select count(*)::int from supabase_migrations.schema_migrations where version like '00%';`);
  console.log(`Uygulanmış migration sayısı: ${migCount}`);
  check(
    "0. review_provider_document henüz OTOMATİK yetkilendirme yapmıyor (migration 0041 UYGULANMAMIŞ)",
    !(psql(`select prosrc from pg_proc where proname = 'review_provider_document';`) || "").includes("authorize_provider_service"),
  );

  const ts = Date.now();
  const requester = await makeUser("req", `docauth-req-${ts}@example.com`);
  const provider = await makeUser("prov", `docauth-prov-${ts}@example.com`);
  const adminU = await makeUser("adm", `docauth-adm-${ts}@example.com`);
  await completeRegistration(requester, "hizmet-alan", "Doc Auth Requester");
  await completeRegistration(provider, "hizmet-veren", "Doc Auth Provider");
  await completeRegistration(adminU, "hizmet-alan", "Doc Auth Admin");
  psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminU.id}';`);

  const { error: selectError } = await provider.client.rpc("set_provider_service_categories", { p_category_ids: ["gumruk-musavirligi"] });
  if (selectError) throw new Error(`set_provider_service_categories failed: ${selectError.message}`);
  check("1. Provider Gümrük Müşavirliği hizmetini SEÇTİ", true);

  const { documentId } = await uploadAndApprove(provider, adminU, "gumruk-musavirligi", "gumruk-musaviri-izin-belgesi", "gumruk-gercek-test");

  const docRow = psqlRows(`select current_review_status, service_category_id, reviewed_by from public.provider_documents where id = '${documentId}';`)[0];
  console.log(`DB: provider_documents satırı -> current_review_status=${docRow[0]}, service_category_id=${docRow[1]}, reviewed_by=${docRow[2]}`);
  check("2. GERÇEK DB satırı: belge current_review_status = 'approved'", docRow[0] === "approved");

  const authRow = activeAuthRow(provider.id, "gumruk-musavirligi");
  console.log(`DB: provider_service_authorizations aktif satır -> ${authRow ? JSON.stringify(authRow) : "YOK (0 satır)"}`);
  check(
    "3. KÖK NEDEN KANITLANDI: belge approved OLMASINA RAĞMEN provider_service_authorizations'ta aktif satır YOK",
    authRow === null,
  );

  // NOT: `provider_can_view_category` yalnızca `authenticated`/`anon`e grant
  // edilmiş (SERVICE_ROLE'e DEĞİL — SERVICE_ROLE burada RLS'i bypass eder
  // ama fonksiyon EXECUTE izni ayrı bir kavramdır) — bu yüzden gerçek bir
  // authenticated client (adminU.client) kullanılır, `admin` (service role)
  // değil.
  const canView = await canViewCategory(adminU.client, provider.id, "gumruk-musavirligi");
  console.log(`provider_can_view_category(provider, 'gumruk-musavirligi') = ${canView}`);
  check("4. provider_can_view_category FALSE dönüyor (approved belgeye rağmen) — /ilanlar'daki ret mesajının GERÇEK backend nedeni budur", canView === false);

  // Gerçek bir ilan (job) satırı ve create_offer RPC'si ile UÇTAN UCA kanıt.
  const jobId = psql(`
    insert into public.jobs (requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date)
    values ('${requester.id}', 'gumruk-musavirligi', 'DOCAUTH TEST İLAN ${ts}', 'Kok neden kanit testi ilanı, en az yirmi karakter.', 'Operasyon detayları, en az on karakter.', 'Kocaeli', 'Gebze', 'Test Sahası', current_date + 5)
    returning id;
  `);
  console.log(`Gerçek ilan oluşturuldu: ${jobId} (category_id=gumruk-musavirligi, moderation_status default=approved)`);

  const providerRpcClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await providerRpcClient.auth.signInWithPassword({ email: provider.email, password: PASSWORD });
  const offerAttempt = await providerRpcClient.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 1000,
    p_currency: "TRY",
    p_description: "Kok neden kanit testi teklifi, en az yirmi karakter.",
    p_estimated_duration: 5,
  });
  console.log(`create_offer sonucu -> error.code=${offerAttempt.error?.code}, message=${offerAttempt.error?.message}`);
  check(
    "5. create_offer RPC'si GERÇEKTEN reddediyor (MLK60) — belge onaylı olsa da provider teklif VEREMİYOR",
    offerAttempt.error?.code === "MLK60",
    `${offerAttempt.error?.code}: ${offerAttempt.error?.message}`,
  );

  writeFileSync(
    STATE_PATH,
    JSON.stringify({ ts, requesterId: requester.id, providerId: provider.id, providerEmail: provider.email, adminId: adminU.id, adminEmail: adminU.email, documentId, jobId }),
    "utf8",
  );
  console.log(`\nState kaydedildi: ${STATE_PATH} (faz 2 bu AYNI kullanıcı/belge/ilan üzerinde devam edecek)`);
}

async function phase2() {
  console.log("\n=== FAZ 2: DÜZELTMEYİ DOĞRULA (migration 0041 UYGULANMIŞ olmalı — `npx supabase migration up` sonrası) ===");
  if (!existsSync(STATE_PATH)) throw new Error(`State dosyası yok: ${STATE_PATH} — önce --phase=1 çalıştırılmalı.`);
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));

  check(
    "0. review_provider_document artık OTOMATİK yetkilendirme çağırıyor (migration 0041 UYGULANDI)",
    (psql(`select prosrc from pg_proc where proname = 'review_provider_document';`) || "").includes("authorize_provider_service"),
  );

  console.log("\n--- Backfill kanıtı: FAZ 1'de onaylanan AYNI belge şimdi yetkilendirilmiş mi? ---");
  const backfillAuthRow = activeAuthRow(state.providerId, "gumruk-musavirligi");
  console.log(`DB: provider_service_authorizations aktif satır -> ${backfillAuthRow ? JSON.stringify(backfillAuthRow) : "YOK"}`);
  check("6. BACKFILL KANITLANDI: geçmişte onaylanmış belge artık aktif bir yetki satırına sahip", backfillAuthRow !== null);
  check("7. Backfill satırının source_document_id'si GERÇEKTEN o belge (uydurma veri değil)", backfillAuthRow?.[2] === state.documentId);

  const providerRpcClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await providerRpcClient.auth.signInWithPassword({ email: state.providerEmail, password: PASSWORD });

  const canViewAfterBackfill = await canViewCategory(providerRpcClient, state.providerId, "gumruk-musavirligi");
  check("8. provider_can_view_category artık TRUE (backfill sonrası)", canViewAfterBackfill === true);

  const offerAfterBackfill = await providerRpcClient.rpc("create_offer", {
    p_job_id: state.jobId,
    p_amount: 1200,
    p_currency: "TRY",
    p_description: "Duzeltme sonrasi teklif, en az yirmi karakter buraya.",
    p_estimated_duration: 5,
  });
  check(
    "9. AYNI ilana create_offer artık BAŞARILI (backfill sonrası, aynı job/provider)",
    !offerAfterBackfill.error,
    offerAfterBackfill.error ? `${offerAfterBackfill.error.code}: ${offerAfterBackfill.error.message}` : "ok",
  );

  const gapRowsForProvider = psqlRows(
    `select document_id from public.provider_document_authorization_gaps where provider_id = '${state.providerId}';`,
  );
  check("10. Sağlık kontrolü view'ı (provider_document_authorization_gaps) bu provider için ARTIK BOŞ", gapRowsForProvider.length === 0);

  console.log("\n--- Canlı (backfill'siz) otomatik yetkilendirme kanıtı: YENİ bir belge/kategori ---");
  const adminClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: state.adminEmail, password: PASSWORD });
  const providerFullClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await providerFullClient.auth.signInWithPassword({ email: state.providerEmail, password: PASSWORD });
  const providerHandle = { id: state.providerId, client: providerFullClient };
  const adminHandle = { client: adminClient };

  const TEST_MATRIX = ["nakliye", "gozetim-hizmetleri", "lashing-unlashing"];
  for (const categoryId of TEST_MATRIX) {
    const { error: selErr } = await providerFullClient.rpc("set_provider_service_categories", {
      p_category_ids: [...TEST_MATRIX.slice(0, TEST_MATRIX.indexOf(categoryId) + 1), "gumruk-musavirligi"],
    });
    if (selErr) throw new Error(`set_provider_service_categories(${categoryId}) failed: ${selErr.message}`);
    const { documentId: newDocId } = await uploadAndApprove(providerHandle, adminHandle, categoryId, "genel", `matrix-${categoryId}`);
    const row = activeAuthRow(state.providerId, categoryId);
    check(
      `11.${categoryId}: belge onaylanır onaylanmaz (backfill YOK, CANLI RPC) yetki OTOMATİK açıldı`,
      row !== null && row[2] === newDocId,
      row ? JSON.stringify(row) : "yok",
    );
  }

  // Negatif kontrol: hiç dokunulmayan bir kategori ('depolama') hâlâ yetkisiz olmalı.
  const untouched = activeAuthRow(state.providerId, "depolama");
  check("12. Negatif kontrol: hiç belge yüklenmeyen 'depolama' kategorisi hâlâ YETKİSİZ (blanket-authorize YOK)", untouched === null);

  console.log("\n--- Güvenlik: provider kendi kendine yetki veremez (0038'in mevcut kuralı, bu migration'la DEĞİŞMEDİ) ---");
  const selfAuth = await providerFullClient.rpc("authorize_provider_service", { p_provider_id: state.providerId, p_service_category_id: "depolama" });
  check("13. Provider self-authorize DENEMESİ reddediliyor (MLK50)", selfAuth.error?.code === "MLK50", `${selfAuth.error?.code}: ${selfAuth.error?.message}`);

  console.log("\n--- Cross-device: tamamen ayrı/taze bir Supabase client'tan doğrulama ---");
  const freshClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await freshClient.auth.signInWithPassword({ email: state.providerEmail, password: PASSWORD });
  const freshRead = await freshClient
    .from("provider_service_authorizations")
    .select("service_category_id")
    .eq("provider_id", state.providerId)
    .is("revoked_at", null);
  const freshCategoryIds = (freshRead.data ?? []).map((r) => r.service_category_id).sort();
  check(
    "14. Cross-device: TAMAMEN AYRI bir client'tan (localStorage'a hiç dokunmadan) gerçek Supabase satırları okunabiliyor",
    freshCategoryIds.length === 4 && freshCategoryIds.includes("gumruk-musavirligi") && freshCategoryIds.includes("nakliye"),
    JSON.stringify(freshCategoryIds),
  );

  console.log("\n--- Cleanup ---");
  const idList = [state.requesterId, state.providerId, state.adminId].map((id) => `'${id}'`).join(",");
  psql(`delete from public.notifications where offer_id in (select id from public.offers where job_id = '${state.jobId}' or provider_id in (${idList}));`);
  psql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${state.jobId}' or provider_id in (${idList}));`);
  psql(`delete from public.offers where job_id = '${state.jobId}' or provider_id in (${idList});`);
  psql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.provider_service_authorizations where provider_id in (${idList})) or entity_id = '${state.jobId}';`);
  psql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList});`);
  psql(`delete from public.jobs where id = '${state.jobId}';`);
  // FK sırası kritik: provider_service_authorizations/provider_document_reviews
  // ikisi de provider_documents'a referans verir — bu yüzden provider_documents
  // SİLİNMEDEN ÖNCE ikisi de silinmeli (her `psql()` çağrısı AYRI bir docker
  // exec/transaction olduğu için, tek bir çok-ifadeli komuttaki gibi
  // "tümü ya da hiçbiri" geri alma riski YOK — bkz. bu script'in geliştirme
  // sürecinde canlı gözlemlenen gerçek hata).
  psql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
  psql(`delete from public.provider_document_reviews where provider_id in (${idList});`);
  psql(`delete from public.provider_documents where provider_id in (${idList});`);
  psql(`delete from public.provider_services where provider_id in (${idList});`);
  for (const id of [state.requesterId, state.providerId, state.adminId]) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log("Cleanup tamam.");
}

(async () => {
  if (PHASE === "1") await phase1();
  else if (PHASE === "2") await phase2();
  else throw new Error(`Bilinmeyen faz: ${PHASE}`);

  console.log(`\n=== ÖZET (faz ${PHASE}) === Toplam: ${pass + fail}, Başarılı: ${pass}, Başarısız: ${fail}`);
  if (fail > 0) {
    console.log("Başarısız:", failures.join("; "));
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
