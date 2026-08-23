// node scripts/tmp-supabase-nakliye-visibility-diagnostic.mjs <hizmet-veren-email> [job-id-or-title]
//
// Rapor edilen "Nakliye yetkili Hizmet Veren, mevcut Nakliye ilanlarını
// göremiyor" şikayetini GERÇEK verilerle teşhis eder — kod DEĞİŞTİRMEZ,
// yalnızca OKUR. Görev tanımının 6 aşamalı zincirinin (hesap → belge/
// yetkilendirme → kategori → ilan yayın durumu → backend görünürlük →
// frontend filtre) her adımını sırayla yazdırır ve TAM OLARAK hangi adımda
// (varsa) kırıldığını gösterir.
//
// `service_role`/gizli anahtar GEREKTİRİR (RLS korumalı tablolar —
// provider_service_authorizations/provider_documents/profiles — başka bir
// kullanıcının satırlarını okumak için) — proje konvansiyonuna uygun olarak
// yalnızca `SB_SECRET_KEY_FOR_TEST` ortam değişkeninden okunur, hiçbir
// dosyaya yazılmaz/commit edilmez. Salt-okunur: hiçbir INSERT/UPDATE/DELETE
// yapmaz, yalnızca SELECT.
//
// Kullanım:
//   SB_SECRET_KEY_FOR_TEST=... node scripts/tmp-supabase-nakliye-visibility-diagnostic.mjs saha@ornek.com
//   SB_SECRET_KEY_FOR_TEST=... node scripts/tmp-supabase-nakliye-visibility-diagnostic.mjs saha@ornek.com "İstanbul-Kocaeli Konteyner Nakliyesi"
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const email = process.argv[2];
const jobHint = process.argv[3];

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error("FAIL: NEXT_PUBLIC_SUPABASE_URL ve SB_SECRET_KEY_FOR_TEST ortam değişkenleri gerekli.");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}
if (!email) {
  console.error("Kullanım: node scripts/tmp-supabase-nakliye-visibility-diagnostic.mjs <email> [ilan-basligi-ipucu]");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const NAKLIYE_ID = "nakliye";

function section(title) {
  console.log(`\n=== ${title} ===`);
}
function line(label, value, ok) {
  const mark = ok === undefined ? "  " : ok ? "✓ " : "✗ ";
  console.log(`  ${mark}${label}: ${value}`);
}

async function main() {
  // 1) Hesap
  section("1) Hizmet Veren hesabı");
  const { data: authUser, error: authUserErr } = await admin.auth.admin.listUsers();
  const matchedAuthUser = authUserErr ? null : authUser.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!matchedAuthUser) {
    line("auth.users kaydı", `BULUNAMADI (${authUserErr?.message ?? "eşleşen e-posta yok"})`, false);
    console.log("\nSONUÇ: Bu e-posta ile gerçek bir Supabase Auth kullanıcısı yok — devam edilemiyor.");
    process.exit(1);
  }
  const uid = matchedAuthUser.id;
  line("auth.uid()", uid, true);

  const { data: profile } = await admin.from("profiles").select("id, role, account_status, full_name, company_name").eq("id", uid).maybeSingle();
  if (!profile) {
    line("profiles kaydı", "BULUNAMADI — kayıt tamamlanmamış olabilir (complete_registration hiç çalışmamış)", false);
    process.exit(1);
  }
  line("profiles.role", profile.role, profile.role === "hizmet-veren");
  line("profiles.account_status", profile.account_status, profile.account_status === "active");
  line("profiles.company_name", profile.company_name ?? "(boş)");
  if (profile.role !== "hizmet-veren") {
    console.log("\nSONUÇ: Bu hesap Hizmet Veren değil — Nakliye ilan görünürlüğü zaten bu role uygulanmıyor (job-visibility.ts erken çıkış).");
    process.exit(0);
  }
  if (profile.account_status !== "active") {
    console.log("\nSONUÇ: Hesap aktif değil (askıya alınmış/yasaklı) — assert_active_user() (migration 0042) mutasyonları engeller; salt görünürlük RLS SELECT'i bundan etkilenmez ama gerçek kullanım (teklif verme) engellenir.");
  }

  // 2) provider_services (seçim) + provider_documents + provider_service_authorizations
  section("2) Nakliye belge ve hizmet yetkilendirmesi");
  const { data: services } = await admin.from("provider_services").select("service_category_id").eq("provider_id", uid);
  const selectedNakliye = (services ?? []).some((s) => s.service_category_id === NAKLIYE_ID);
  line("provider_services içinde 'nakliye' seçili mi", selectedNakliye ? "EVET" : "HAYIR", selectedNakliye);

  const { data: docs } = await admin
    .from("provider_documents")
    .select("id, document_type, service_category_id, current_review_status, current_review_note, uploaded_at, reviewed_at, deleted_at")
    .eq("provider_id", uid)
    .order("uploaded_at", { ascending: false });
  const nakliyeDocs = (docs ?? []).filter((d) => d.service_category_id === NAKLIYE_ID && !d.deleted_at);
  if (nakliyeDocs.length === 0) {
    line("service_category_id='nakliye' olan belge", "YOK", false);
  } else {
    for (const d of nakliyeDocs) {
      line(`belge ${d.id}`, `durum=${d.current_review_status}, yüklendi=${d.uploaded_at}, incelendi=${d.reviewed_at ?? "-"}, not=${d.current_review_note ?? "-"}`, d.current_review_status === "approved");
    }
  }

  const { data: auths } = await admin
    .from("provider_service_authorizations")
    .select("id, service_category_id, authorized_at, revoked_at, revoke_reason, source_document_id")
    .eq("provider_id", uid)
    .eq("service_category_id", NAKLIYE_ID)
    .order("authorized_at", { ascending: false });
  const activeAuth = (auths ?? []).find((a) => a.revoked_at === null);
  if (!auths || auths.length === 0) {
    line("provider_service_authorizations (nakliye)", "HİÇ SATIR YOK — provider_can_view_category() Nakliye için HER ZAMAN false döner", false);
  } else if (activeAuth) {
    line("aktif yetkilendirme satırı", `id=${activeAuth.id}, authorized_at=${activeAuth.authorized_at}, source_document_id=${activeAuth.source_document_id ?? "(manuel/belgesiz)"}`, true);
  } else {
    const last = auths[0];
    line("son satır REVOKE EDİLMİŞ", `revoked_at=${last.revoked_at}, sebep=${last.revoke_reason}`, false);
  }
  const providerCanViewNakliye = Boolean(activeAuth);

  // 0041 sağlık kontrolü — bu provider için "onaylı belge var ama yetki yok" tutarsızlığı var mı?
  const { data: gaps } = await admin.from("provider_document_authorization_gaps").select("*").eq("provider_id", uid);
  if (gaps && gaps.length > 0) {
    line("provider_document_authorization_gaps", `${gaps.length} tutarsız satır bulundu (belge onaylı, yetki yok) — bkz. migration 0041`, false);
    console.log("    ", JSON.stringify(gaps));
  }

  // 3) Nakliye kategorisinin kendisi
  section("3) Nakliye hizmet kategorisi (service_categories)");
  const { data: category } = await admin.from("service_categories").select("*").eq("id", NAKLIYE_ID).maybeSingle();
  if (!category) {
    line("service_categories.id='nakliye'", "BULUNAMADI — beklenmeyen, katalog bozulmuş olabilir", false);
  } else {
    line("id/slug/name/is_active", `${category.id} / ${category.slug} / ${category.name} / is_active=${category.is_active}`, category.is_active);
  }

  // 4) İlan(lar)
  section("4) Nakliye ilanları (jobs, moderasyon/yayın durumu)");
  let jobQuery = admin
    .from("jobs")
    .select("id, title, category_id, moderation_status, deleted_at, work_date, work_end_date, closed_at, operation_id")
    .eq("category_id", NAKLIYE_ID)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: nakliyeJobs } = await jobQuery;
  const filtered = jobHint
    ? (nakliyeJobs ?? []).filter((j) => j.id === jobHint || j.title?.toLowerCase().includes(jobHint.toLowerCase()))
    : nakliyeJobs ?? [];
  if (!nakliyeJobs || nakliyeJobs.length === 0) {
    line("Supabase jobs tablosunda category_id='nakliye' ilan sayısı", "0 — DİKKAT: bu app'in asıl veri kaynağı localStorage'dır (bkz. CLAUDE.md 'No real backend'); Supabase job senkronu yalnızca NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true iken ve yalnızca senkron edilmiş ilanlar için buradadır. İlanın kendisi localStorage'da olup burada hiç görünmeyebilir — bu durumda bu bölüm bilgi vermez, ilanı doğrudan tarayıcıda (o hesabın kendi localStorage'ında) kontrol etmek gerekir.", undefined);
  } else {
    console.log(`  (toplam ${nakliyeJobs.length} Nakliye ilanı bulundu, ${jobHint ? filtered.length + " tanesi ipucuyla eşleşti" : "hepsi listeleniyor"})`);
    for (const j of (jobHint ? filtered : nakliyeJobs).slice(0, 10)) {
      const approved = j.moderation_status === "approved" || j.moderation_status === null;
      line(`ilan ${j.id} — "${j.title}"`, `moderation=${j.moderation_status ?? "(approved varsayılan)"}, closed_at=${j.closed_at ?? "-"}, work_date=${j.work_date}`, approved && !j.closed_at);
    }
  }

  // 5) Backend görünürlük — provider_can_view_category'yi GERÇEKTEN çağır
  section("5) Backend görünürlük fonksiyonu (provider_can_view_category)");
  const { data: rpcResult, error: rpcError } = await admin.rpc("provider_can_view_category", {
    p_provider_id: uid,
    p_category_id: NAKLIYE_ID,
  });
  if (rpcError) {
    line("provider_can_view_category(uid, 'nakliye') RPC çağrısı", `HATA: ${rpcError.message}`, false);
  } else {
    line("provider_can_view_category(uid, 'nakliye') dönüş değeri", String(rpcResult), rpcResult === true);
  }

  // Özet
  section("ÖZET");
  line("2) Aktif Nakliye yetkilendirmesi var mı", providerCanViewNakliye ? "EVET" : "HAYIR", providerCanViewNakliye);
  line("5) Backend RPC sonucu ile 2) tutarlı mı", rpcError ? "RPC HATASI" : String(rpcResult) === String(providerCanViewNakliye), !rpcError && String(rpcResult) === String(providerCanViewNakliye));
  if (!providerCanViewNakliye) {
    console.log("\n  KÖK NEDEN ADAYI: provider_service_authorizations'ta bu provider+'nakliye' için AKTİF (revoked_at IS NULL) bir satır yok.");
    console.log("  Bu VERİ eksikliği mi yoksa bir AKIŞ hatası mı olduğunu ayırt etmek için yukarıdaki 2) bölümündeki belge durumunu kontrol edin:");
    console.log("    - Belge hiç yok  -> provider hiç yüklememiş (normal akış, kod hatası değil).");
    console.log("    - Belge 'pending'/'revision_requested' -> admin henüz onaylamamış (normal akış, kod hatası değil).");
    console.log("    - Belge 'approved' AMA aktif yetki satırı yok -> migration 0041'in otomatik yetkilendirme zincirinde GERÇEK bir kopukluk; provider_document_authorization_gaps'e bakın, gerekirse authorize_provider_service RPC'sini admin panelinden manuel çalıştırın.");
  }
}

main().catch((err) => {
  console.error("Script hata verdi:", err);
  process.exit(1);
});
