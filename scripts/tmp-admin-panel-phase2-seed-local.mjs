// MALSEVK — Admin Paneli Faz 2 (Rozet Yönetimi / İlan Yönetimi / Operasyon
// Yönetimi) manuel doğrulaması için yerel Docker Supabase'e gerçekçi test
// verisi tohumlar. SADECE yerel Docker (127.0.0.1:54321) — hosted dev/prod'a
// hiç dokunmaz. tmp-admin-panel-seed-local.mjs ile AYNI desen, üzerine iş
// ilanları/teklifler/durum geçişleri ve rozet ver-kaldır-yeniden ver
// döngüsü ekler.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const DB_CONTAINER = "supabase_db_malsevk-2";

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${escaped}"`, { encoding: "utf-8" }).trim();
}
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error("Refusing: not local");

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
const ts = Date.now();

async function makeUser(email) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`createUser ${email}: ${created.error.message}`);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn ${email}: ${signIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

function check(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message} (code=${result.error.code})`);
  return result.data;
}

console.log("Creating admin user...");
const adminUser = await makeUser(`p2-admin-${ts}@example.com`);
check(
  "complete_registration(admin)",
  await adminUser.client.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: "Faz2 Admin", p_phone: "+905550001001",
    p_company_name: "Admin", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  }),
);
psql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
console.log(`Admin: ${adminUser.email} / ${PASSWORD} (id=${adminUser.id})`);

console.log("Creating requesters (hizmet-alan)...");
const requester1 = await makeUser(`p2-req1-${ts}@example.com`);
check(
  "complete_registration(req1)",
  await requester1.client.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: "Ayşe Yılmaz", p_phone: "+905550002001",
    p_company_name: "Kocaeli Sanayi A.Ş.", p_company_type: "anonim-sirket", p_province: "Kocaeli", p_district: "Gebze",
  }),
);
const requester2 = await makeUser(`p2-req2-${ts}@example.com`);
check(
  "complete_registration(req2)",
  await requester2.client.rpc("complete_registration", {
    p_role: "hizmet-alan", p_full_name: "Mehmet Kaya", p_phone: "+905550002002",
    p_company_name: "Derince Lojistik Ltd.", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Derince",
  }),
);

console.log("Creating providers (hizmet-veren)...");
async function makeProvider(label, fullName, companyName, services) {
  const user = await makeUser(`p2-${label}-${ts}@example.com`);
  check(
    `complete_registration(${label})`,
    await user.client.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: fullName, p_phone: "+905550003000",
      p_company_name: companyName, p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
    }),
  );
  check(`set_provider_service_categories(${label})`, await user.client.rpc("set_provider_service_categories", { p_category_ids: services }));
  return user;
}
const provider1 = await makeProvider("prov1", "Ali Demir", "Gebze Nakliyat A.Ş.", ["nakliye"]);
const provider2 = await makeProvider("prov2", "Zeynep Arslan", "Kocaeli Forklift Hizmetleri", ["forklift"]);
const provider3 = await makeProvider("prov3", "Hüseyin Aydın", "İzmit Depo Hizmetleri", ["genel-depolama"]);
console.log(`  provider1=${provider1.id} provider2=${provider2.id} provider3=${provider3.id}`);

console.log("\nCreating jobs...");
async function createJob(requester, categoryId, title) {
  const data = check(
    `create_job(${title})`,
    await requester.client.rpc("create_job", {
      p_category_id: categoryId,
      p_title: title,
      p_description: "Faz 2 admin paneli doğrulaması için tohumlanmış test ilanı. Açıklama en az 20 karakter olmalı.",
      p_operation_details: "Test operasyon detayları — Faz 2 seed script.",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Lojistik Merkezi",
      p_work_date: "2026-09-01",
      p_photos: [{ storage_path: `${requester.id}/seed-photo.jpg`, original_file_name: "seed.jpg", mime_type: "image/jpeg", size_bytes: 12345, width: 800, height: 600 }],
    }),
  );
  return data;
}

const job1 = await createJob(requester1, "nakliye", "[Faz2] Bekleyen teklif testi — Nakliye");
const job2 = await createJob(requester1, "forklift", "[Faz2] Devam eden (kabul edildi) — Forklift");
const job3 = await createJob(requester1, "genel-depolama", "[Faz2] Devam eden (iş başladı) — Depolama");
const job4 = await createJob(requester2, "nakliye", "[Faz2] Tamamlanan operasyon — Nakliye");
const job5 = await createJob(requester2, "forklift", "[Faz2] Anlaşmazlık testi — Forklift");
const job6 = await createJob(requester1, "genel-depolama", "[Faz2] Reddedilen teklif — Depolama");
const job7 = await createJob(requester1, "nakliye", "[Faz2] Admin tarafından kapatılacak ilan — Nakliye");
console.log(`  jobs: ${[job1, job2, job3, job4, job5, job6, job7].map((j) => j.id).join(", ")}`);

console.log("\nCreating offers and driving lifecycle transitions...");
async function createOffer(provider, jobId, amount, description, estimatedDuration) {
  return check(
    `create_offer(job=${jobId})`,
    await provider.client.rpc("create_offer", {
      p_job_id: jobId,
      p_amount: amount,
      p_currency: "TRY",
      p_description: description,
      p_estimated_duration: estimatedDuration ?? null,
    }),
  );
}

// job1: teklif verilir, hiçbir aksiyon alınmaz -> Bekleyen / Teklif Bekliyor (Nakliye: estimated_duration zorunlu)
const offer1 = await createOffer(provider1, job1.id, 15000, "Faz 2 seed: bekleyen teklif, en az 20 karakter açıklama.", 5);

// job2: teklif verilir + kabul edilir (iş başlamaz) -> Devam Eden (accepted)
const offer2 = await createOffer(provider2, job2.id, 8000, "Faz 2 seed: kabul edilecek teklif, en az 20 karakter açıklama.");
check("accept_offer(offer2)", await requester1.client.rpc("accept_offer", { p_offer_id: offer2.id }));

// job3: kabul edilir + iş başlar -> Devam Eden (in_progress)
// NOT: provider1 yalnızca "nakliye" (izole kategori) seçtiği için genel-
// depolama ilanlarını göremez (job-visibility.ts izolasyon kuralı, RPC
// tarafında jobs_select_visible RLS ile aynı) — bu yüzden provider3 kullanılıyor.
const offer3 = await createOffer(provider3, job3.id, 22000, "Faz 2 seed: iş başlayacak teklif, en az 20 karakter açıklama.");
check("accept_offer(offer3)", await requester1.client.rpc("accept_offer", { p_offer_id: offer3.id }));
check("start_work(offer3)", await requester1.client.rpc("start_work", { p_offer_id: offer3.id }));

// job4: kabul + başla + tamamlanma iste + onayla -> Tamamlandı
const offer4 = await createOffer(provider3, job4.id, 30000, "Faz 2 seed: tamamlanacak teklif, en az 20 karakter açıklama.", 10);
check("accept_offer(offer4)", await requester2.client.rpc("accept_offer", { p_offer_id: offer4.id }));
check("start_work(offer4)", await requester2.client.rpc("start_work", { p_offer_id: offer4.id }));
check("request_completion(offer4)", await provider3.client.rpc("request_completion", { p_offer_id: offer4.id }));
check("confirm_completion(offer4)", await requester2.client.rpc("confirm_completion", { p_offer_id: offer4.id }));

// job5: kabul + başla + tamamlanma iste + itiraz et -> Anlaşmazlık
const offer5 = await createOffer(provider2, job5.id, 12000, "Faz 2 seed: itiraz edilecek teklif, en az 20 karakter açıklama.");
check("accept_offer(offer5)", await requester2.client.rpc("accept_offer", { p_offer_id: offer5.id }));
check("start_work(offer5)", await requester2.client.rpc("start_work", { p_offer_id: offer5.id }));
check("request_completion(offer5)", await provider2.client.rpc("request_completion", { p_offer_id: offer5.id }));
check(
  "dispute_completion(offer5)",
  await requester2.client.rpc("dispute_completion", { p_offer_id: offer5.id, p_note: "İş eksik yapıldı, sahada kontrol istiyoruz." }),
);

// job6: teklif reddedilir -> İptal
const offer6 = await createOffer(provider3, job6.id, 9000, "Faz 2 seed: reddedilecek teklif, en az 20 karakter açıklama.");
check("reject_offer(offer6)", await requester1.client.rpc("reject_offer", { p_offer_id: offer6.id }));

// job7: yalnız bekleyen teklif kalır -> admin bunu close_job_as_admin ile kapatacak (aşağıda)
const offer7 = await createOffer(provider1, job7.id, 17500, "Faz 2 seed: admin kapatma testi için bekleyen teklif.", 3);

console.log("\nGranting/revoking badges (Rozet Yönetimi test verisi)...");
check(
  "grant_provider_badge(provider1, mavi-tik)",
  await adminUser.client.rpc("grant_provider_badge", { p_provider_id: provider1.id, p_badge_type_id: "mavi-tik", p_reason: "Faz2 seed: zorunlu belgeler onaylandı varsayımıyla verildi." }),
);
check(
  "grant_provider_badge(provider2, mavi-tik)",
  await adminUser.client.rpc("grant_provider_badge", { p_provider_id: provider2.id, p_badge_type_id: "mavi-tik", p_reason: "Faz2 seed: ilk verilme." }),
);
check(
  "grant_provider_badge(provider2, altin-tik)",
  await adminUser.client.rpc("grant_provider_badge", { p_provider_id: provider2.id, p_badge_type_id: "altin-tik", p_reason: "Faz2 seed: iki aktif rozet senaryosu (provider2 hem Mavi hem Altın)." }),
);
check(
  "revoke_provider_badge(provider2, mavi-tik)",
  await adminUser.client.rpc("revoke_provider_badge", { p_provider_id: provider2.id, p_badge_type_id: "mavi-tik", p_reason: "Faz2 seed: tarihçe testi için kaldırıldı." }),
);
check(
  "grant_provider_badge(provider2, mavi-tik) yeniden",
  await adminUser.client.rpc("grant_provider_badge", { p_provider_id: provider2.id, p_badge_type_id: "mavi-tik", p_reason: "Faz2 seed: yeniden verildi (aynı türde ikinci aktif kayıt geçmişte var, şimdi yeni aktif)." }),
);
// MLK81 doğrulaması: aynı aktif rozeti ikinci kez vermeye çalış, reddedilmeli.
const duplicateGrant = await adminUser.client.rpc("grant_provider_badge", { p_provider_id: provider1.id, p_badge_type_id: "mavi-tik", p_reason: "İkinci kez deneme" });
if (!duplicateGrant.error || duplicateGrant.error.code !== "MLK81") {
  throw new Error(`Beklenen MLK81 hatası alınmadı: ${JSON.stringify(duplicateGrant.error)}`);
}
console.log("  OK: aynı aktif rozetin ikinci kez verilmesi MLK81 ile reddedildi (kural doğrulandı).");
// provider3 kasıtlı olarak rozetsiz bırakıldı (Rozetsiz filtre testi için).

console.log("\nClosing job7 via close_job_as_admin (İlan Yönetimi 'Yayından Kaldır' RPC testi)...");
const closeResult = await adminUser.client.rpc("close_job_as_admin", { p_job_id: job7.id, p_reason: "hizmete-ihtiyac-kalmadi" });
if (closeResult.error) throw new Error(`close_job_as_admin(job7): ${closeResult.error.message}`);
const { data: closedOffer7 } = await adminUser.client.from("offers").select("status").eq("id", offer7.id).maybeSingle();
if (closedOffer7?.status !== "rejected") throw new Error(`Beklenen: offer7 status=rejected, gerçek=${closedOffer7?.status}`);
console.log("  OK: job7 kapatıldı, offer7 otomatik olarak 'rejected' durumuna geçti.");

// Non-admin guard doğrulaması: normal kullanıcı close_job_as_admin çağıramamalı.
const nonAdminAttempt = await requester1.client.rpc("close_job_as_admin", { p_job_id: job1.id, p_reason: "diger" });
if (!nonAdminAttempt.error || nonAdminAttempt.error.code !== "MLK84") {
  throw new Error(`Beklenen MLK84 (admin required) hatası alınmadı: ${JSON.stringify(nonAdminAttempt.error)}`);
}
console.log("  OK: admin olmayan kullanıcının close_job_as_admin çağrısı MLK84 ile reddedildi.");

console.log("\n=== Seed complete ===");
console.log(
  JSON.stringify(
    {
      admin: { email: adminUser.email, password: PASSWORD },
      requesters: { requester1: requester1.email, requester2: requester2.email },
      providers: { provider1: provider1.id, provider2: provider2.id, provider3: provider3.id },
      jobs: {
        job1_bekleyen: job1.id,
        job2_devam_eden_accepted: job2.id,
        job3_devam_eden_in_progress: job3.id,
        job4_tamamlandi: job4.id,
        job5_anlasmazlik: job5.id,
        job6_iptal_rejected: job6.id,
        job7_kapatildi_admin: job7.id,
      },
    },
    null,
    2,
  ),
);
