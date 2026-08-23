// Migration 0059 doğrulama — "Konteyner Depolama faaliyet alanları + çoklu
// IMO + ilan-depocu uygunluk eşleştirmesi" görevinin BACKEND/RPC seviyesinde
// GERÇEK doğrulaması (UI katmanı henüz yazılmadı — bu script yalnızca SQL/
// RPC katmanını, kullanıcının bu ara mesajda istediği 4 kontrolü hedefler):
//   1) Migration 0059 gerçekten uygulandı mı (şema/fonksiyon kontrolü, ayrı
//      olarak zaten doğrulandı, burada yalnızca fonksiyonel etkisi test edilir)
//   2) Konteyner Depolama eşleştirmesi çalışıyor mu (kısmi kapsam=red, tam
//      kapsam=kabul, NULL kapsam=sınırsız/geriye-uyumlu)
//   3) Eski 19 hizmet kategorisi etkilenmedi mi (düz kategori-yetkisi hâlâ
//      tek başına yeterli, provider_can_view_job === provider_can_view_category)
//   4) Belgesiz/yetkisiz kullanıcı teklif verebiliyor mu (vermemeli — MLK60)
// Development projesine (trfnmpihcnriqgikglpu) karşı çalışır.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
function envVar(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : process.env[name];
}
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "TestSifre2026!";

const results = [];
function check(label, cond, extra) {
  results.push({ label, cond });
  console.log((cond ? "PASS" : "FAIL") + " - " + label + (extra ? " :: " + String(extra).slice(0, 250) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
let jobId, nakliyeJobId;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `eligtest-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `EligTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `EligTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const adminUser = await createUser("adm", "hizmet-alan");
  const providerNoAuth = await createUser("provA-noauth", "hizmet-veren");
  const providerPartial = await createUser("provB-partial", "hizmet-veren");
  const providerFull = await createUser("provC-full", "hizmet-veren");
  const providerGrandfathered = await createUser("provD-grandfathered", "hizmet-veren");
  const providerOtherCategory = await createUser("provE-nakliye", "hizmet-veren");

  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  // ===========================================================================
  // Konteyner Depolama ilanı: bos + dolu-tehlikesiz + dolu-tehlikeli(IMO 4.2).
  // ===========================================================================
  const { data: job, error: jobError } = await requester.client.rpc("create_job", {
    p_category_id: "konteyner-depolama",
    p_title: "Eligibility Backend Verify — Konteyner",
    p_description: "0059 doğrulama",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_work_date: WORK_DATE,
    p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    p_storage_container_groups: [
      { id: "g1", quantity: 10, size: "20", type: "standart", status: "bos" },
      { id: "g2", quantity: 5, size: "40", type: "standart", status: "dolu", hazardous: false, content: "Tekstil" },
      { id: "g3", quantity: 3, size: "40", type: "standart", status: "dolu", hazardous: true, content: "Kimyasal", unNumber: "UN3077", imoClass: "4.2" },
    ],
  });
  check("Kurulum: Konteyner Depolama test ilanı oluşturuldu", !jobError && Boolean(job?.id), jobError?.message);
  jobId = job?.id;
  const { error: approveError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  check("Kurulum: ilan admin tarafından onaylandı (approved)", !approveError, approveError?.message);

  // Regresyon karşılaştırma ilanı: Nakliye (eski, container-dışı kategori).
  const { data: nakliyeJob, error: nakliyeJobError } = await requester.client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "Eligibility Backend Verify — Nakliye Regresyon",
    p_description: "0059 regresyon",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test",
    p_work_date: WORK_DATE,
    p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
  });
  check("Kurulum: Nakliye (regresyon) test ilanı oluşturuldu", !nakliyeJobError && Boolean(nakliyeJob?.id), nakliyeJobError?.message);
  nakliyeJobId = nakliyeJob?.id;
  const { error: approveNakliyeError } = await adminClient.rpc("approve_job_as_admin", { p_job_id: nakliyeJobId });
  check("Kurulum: Nakliye ilanı admin tarafından onaylandı", !approveNakliyeError, approveNakliyeError?.message);

  // ===========================================================================
  // KONTROL 4 — Belgesiz/yetkisiz kullanıcı (hiç authorize edilmemiş) teklif
  // veremiyor mu?
  // ===========================================================================
  {
    const { error } = await providerNoAuth.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — yetkisiz sağlayıcı testi.",
    });
    check(
      "KONTROL 4: Hiç yetkilendirmesi olmayan provider Konteyner Depolama ilanına teklif VEREMİYOR (MLK60)",
      error?.code === "MLK60" || /MLK60/.test(error?.message ?? ""),
      error?.message ?? "HATA: teklif başarıyla oluşturuldu — bu ciddi bir güvenlik açığı olurdu",
    );
  }

  // ===========================================================================
  // KONTROL 2a — Kategori yetkisi VAR ama kapsam EKSİK/YANLIŞ (yalnızca "boş"
  // kapsamı onaylı) — hâlâ teklif veremiyor mu? (kısmi eşleşme reddedilmeli)
  // ===========================================================================
  {
    const { error: authError } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerPartial.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059 doğrulama — kısmi kapsam",
      p_storage_activity_scopes: ["bos-konteyner-depolama"],
      p_imo_class_codes: [],
    });
    check("Kurulum: providerPartial yalnızca 'Boş Konteyner Depolama' kapsamıyla yetkilendirildi", !authError, authError?.message);

    const { error } = await providerPartial.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — kısmi kapsam testi.",
    });
    check(
      "KONTROL 2a: Yalnızca 'Boş' kapsamı olan provider (ilanda dolu-tehlikesiz/tehlikeli gruplar da VAR) teklif VEREMİYOR (MLK60)",
      error?.code === "MLK60" || /MLK60/.test(error?.message ?? ""),
      error?.message ?? "HATA: kısmi kapsamla teklif başarıyla oluşturuldu",
    );
  }

  // ===========================================================================
  // KONTROL 2b — Kategori + TÜM gerekli kapsamlar + doğru IMO sınıfı VAR —
  // teklif verebiliyor mu?
  // ===========================================================================
  {
    const { error: authError } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerFull.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059 doğrulama — tam kapsam",
      p_storage_activity_scopes: ["bos-konteyner-depolama", "dolu-tehlikesiz-konteyner-depolama", "dolu-tehlikeli-konteyner-depolama"],
      p_imo_class_codes: ["4.2"],
    });
    check("Kurulum: providerFull TÜM gerekli kapsam+IMO 4.2 ile yetkilendirildi", !authError, authError?.message);

    const { data: offer, error } = await providerFull.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — tam kapsam testi.",
    });
    check("KONTROL 2b: Tüm gerekli kapsam+IMO'ya sahip provider Konteyner Depolama ilanına BAŞARIYLA teklif VEREBİLİYOR", !error && Boolean(offer?.id), error?.message);

    // Bu ilan artık kapanmış olmayacak (yalnızca bu offer pending), ama ikinci bir provider'ın teklif verebilmesi için işin başlamamış olması gerekir — zaten öyle.
  }

  // ===========================================================================
  // KONTROL 2c — YANLIŞ IMO sınıfına sahip (kapsam doğru ama IMO 3 onaylı,
  // ilan IMO 4.2 istiyor) provider hâlâ reddediliyor mu?
  // ===========================================================================
  {
    const providerWrongImo = await createUser("provF-wrongimo", "hizmet-veren");
    const { error: authError } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerWrongImo.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059 doğrulama — yanlış IMO",
      p_storage_activity_scopes: ["bos-konteyner-depolama", "dolu-tehlikesiz-konteyner-depolama", "dolu-tehlikeli-konteyner-depolama"],
      p_imo_class_codes: ["3"],
    });
    check("Kurulum: providerWrongImo doğru kapsamlarla ama YANLIŞ IMO (3, ilan 4.2 istiyor) ile yetkilendirildi", !authError, authError?.message);

    const { error } = await providerWrongImo.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — yanlış IMO sınıfı testi.",
    });
    check(
      "KONTROL 2c: Doğru kapsamlar ama YANLIŞ IMO sınıfına sahip provider teklif VEREMİYOR (MLK60)",
      error?.code === "MLK60" || /MLK60/.test(error?.message ?? ""),
      error?.message ?? "HATA: yanlış IMO ile teklif başarıyla oluşturuldu",
    );
  }

  // ===========================================================================
  // KONTROL 2d — GERİYE DÖNÜK UYUMLULUK: NULL kapsam (kapsam seçmeden, eski
  // "Yetkilendir" butonu tarzı) = SINIRSIZ, ilana teklif verebiliyor mu?
  // ===========================================================================
  {
    const { error: authError } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerGrandfathered.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059 doğrulama — eski tarz (kapsamsız) yetkilendirme",
      // storage_activity_scopes/imo_class_codes BİLEREK gönderilmiyor (default null) — eski "Yetkilendir" butonunun davranışını simüle eder.
    });
    check("Kurulum: providerGrandfathered kapsam belirtilmeden (NULL) yetkilendirildi", !authError, authError?.message);

    // provider_service_authorizations RLS: yalnızca SAHİBİ provider ya da
    // admin okuyabilir (bkz. CLAUDE.md "Service Authorization") — bu yüzden
    // `requester.client` (bir hizmet-alan) DEĞİL, sahibinin kendi client'ı
    // kullanılır.
    const { data: row } = await providerGrandfathered.client
      .from("provider_service_authorizations")
      .select("storage_activity_scopes, imo_class_codes")
      .eq("provider_id", providerGrandfathered.id)
      .eq("service_category_id", "konteyner-depolama")
      .maybeSingle();
    check("KONTROL 2d ön-koşul: DB'de gerçekten storage_activity_scopes=NULL kaydedildi", row?.storage_activity_scopes === null && row?.imo_class_codes === null, JSON.stringify(row));

    const { data: offer, error } = await providerGrandfathered.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — sınırsız/eski tarz yetki testi.",
    });
    check(
      "KONTROL 2d: NULL kapsamlı (eski tarz/sınırsız) provider TÜM konteyner gruplarına (dolu-tehlikeli DAHİL) teklif VEREBİLİYOR",
      !error && Boolean(offer?.id),
      error?.message,
    );
  }

  // ===========================================================================
  // KONTROL 3 — Eski 19 hizmet kategorisi etkilenmedi mi? Nakliye'de düz
  // kategori-yetkisi (kapsam kavramı YOK) hâlâ tek başına yeterli mi?
  // ===========================================================================
  {
    const { error: authError } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: providerOtherCategory.id,
      p_service_category_id: "nakliye",
      p_reason: "0059 regresyon doğrulaması",
    });
    check("Kurulum: providerOtherCategory Nakliye için düz (kapsamsız) yetkilendirildi", !authError, authError?.message);

    const { data: offer, error } = await providerOtherCategory.client.rpc("create_offer", {
      p_job_id: nakliyeJobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — Nakliye regresyon testi.", p_estimated_duration: 5,
    });
    check(
      "KONTROL 3a: Nakliye'de düz kategori-yetkisi (0059 ÖNCESİYLE BİREBİR AYNI) hâlâ tek başına yeterli — teklif BAŞARIYLA verildi",
      !error && Boolean(offer?.id),
      error?.message,
    );

    // Aynı provider'ın Konteyner Depolama ilanına (yetkisi olmayan kategori) teklif VEREMEMESİ gerekir — kategori izolasyonu bozulmamalı.
    const { error: crossError } = await providerOtherCategory.client.rpc("create_offer", {
      p_job_id: jobId, p_amount: 1000, p_currency: "TRY", p_description: "Doğrulama teklifi — çapraz kategori denemesi testi.",
    });
    check(
      "KONTROL 3b: Yalnızca Nakliye yetkisi olan provider Konteyner Depolama ilanına teklif VEREMİYOR (kategori izolasyonu korunuyor)",
      crossError?.code === "MLK60" || /MLK60/.test(crossError?.message ?? ""),
      crossError?.message,
    );

    // provider_can_view_job === provider_can_view_category davranış eşdeğerliği — doğrudan SQL karşılaştırması.
    const equivRows = runSql(
      `select public.provider_can_view_category('${providerOtherCategory.id}', 'nakliye') as via_category, public.provider_can_view_job('${providerOtherCategory.id}', 'nakliye', null) as via_job;`,
    );
    check(
      "KONTROL 3c: Container-dışı kategoride provider_can_view_job === provider_can_view_category (davranış BİREBİR AYNI)",
      equivRows[0]?.via_category === true && equivRows[0]?.via_job === true,
      JSON.stringify(equivRows[0]),
    );
  }

  // ===========================================================================
  // KONTROL 2e — İlan görünürlüğü (get_visible_job / jobs_select_visible RLS)
  // de aynı eşleştirmeyi uyguluyor mu (yalnızca teklif değil, GÖRME de)?
  // ===========================================================================
  {
    // NOT: PostgREST, tek-satır bir composite (jobs) döndüren bir RPC SQL
    // NULL döndürdüğünde bunu literal JSON `null` DEĞİL, tüm alanları null
    // olan bir NESNE olarak serileştirebilir (doğrudan SQL'de `... is null`
    // sorgusuyla ayrıca doğrulandı — bu bir PostgREST seri hale getirme
    // ayrıntısıdır, RPC'nin kendi erişim kararı GERÇEKTEN doğru). Bu yüzden
    // `=== null` yerine `?.id == null` ile kontrol edilir.
    const { data: visibleToPartial, error: e1 } = await providerPartial.client.rpc("get_visible_job", { p_job_id: jobId });
    check("KONTROL 2e: Kısmi kapsamlı provider için get_visible_job ilanı DÖNDÜRMÜYOR (ilan GÖRÜNMÜYOR — yalnızca teklif değil, görme de engelli)", !e1 && visibleToPartial?.id == null, JSON.stringify(visibleToPartial));

    const { data: visibleToFull, error: e2 } = await providerFull.client.rpc("get_visible_job", { p_job_id: jobId });
    check("KONTROL 2e: Tam kapsamlı provider için get_visible_job ilanı DÖNÜYOR (görünür)", !e2 && visibleToFull?.id === jobId, e2?.message);
  }

  console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.filter((r) => r.cond).length}, Başarısız: ${results.filter((r) => !r.cond).length}`);
  if (results.some((r) => !r.cond)) {
    console.log("Başarısız:", results.filter((r) => !r.cond).map((r) => r.label).join("; "));
    process.exitCode = 1;
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  try {
    if (idList) {
      runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.notifications where offer_id in (select o.id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`);
      runSql(`delete from public.offer_status_history where offer_id in (select o.id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`);
      runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    }
  } catch (error) {
    console.error("cleanup sql failed (continuing):", error?.message || error);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
