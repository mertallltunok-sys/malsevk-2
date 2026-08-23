// node scripts/tmp-supabase-job-moderation-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna (http://localhost:3000, npm run dev zaten çalışıyor olmalı)
// karşı: İlan Onayı (admin moderasyonu) özelliğini iki katmanda da doğrular:
//
// BÖLÜM A — Supabase/RLS/RPC + Admin Paneli (100% Supabase, admin panelinin
// gerçek yetkilendirme sınırı): create_job varsayılan pending_review, admin
// panel UI'ından (Playwright) Onayla/Reddet/Düzenle, RLS'in onay öncesi/
// sonrası davranışı, non-admin reddi, race condition (ML118).
//
// BÖLÜM B — Canlı uygulama / localStorage (bugünkü GERÇEK Hizmet Alan/
// Hizmet Veren akışının kendisi, bkz. CLAUDE.md "No real backend"): bir ilan
// doğrudan tarayıcının paylaşılan localStorage'ına seed edilir (job-store.ts'in
// gerçek create_job'unun ürettiği ile AYNI şekilde), sonra GERÇEK sayfalar
// (panel/hizmet-taleplerim, /ilanlar, /ilanlar/[id]) TEK paylaşılan
// context'te sırayla farklı hesaplarla ziyaret edilerek rozet/gizleme/engelleme
// doğrulanır — bu, job-store.ts'in "aynı origin'i paylaşan tarayıcı" mimarisiyle
// BİREBİR aynı test tekniği (gerçek create_job çağrısını Playwright'ta
// simüle etmek yerine, onun ürettiği VERİ ŞEKLİNİ doğrudan yazmak — böylece
// asıl test edilen şey render/enforcement katmanı olur, form doldurma
// mekaniği değil).
//
// BİLİNÇLİ SINIR (proje raporunda ayrıntılı): NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC
// bu dev ortamında varsayılan (false) bırakıldı — bu oturumun DIŞINDA
// başlatılmış görünen paylaşılan dev sunucusunu (port 3000) yeniden
// başlatmadan test etmek için. Bu yüzden bayrak AÇIKKEN tek bir ilanın uçtan
// uca (Hizmet Alan oluşturur -> admin panelinde görünür -> onaylanır ->
// Hizmet Veren havuzunda görünür) TAM kapalı döngüsü bu çalıştırmada
// gösterilmiyor — BÖLÜM A ve B birbirinden bağımsız, kendi gerçek sınırında
// doğrulanıyor. job-store.ts#applyAdminModerationDecision/applyAdminJobEdit
// (bağlayıcı ayna-yazma fonksiyonları) ve updateJob'un yeniden-inceleme
// tetikleyicisi (didCriticalJobContentChange) bu yüzden yalnızca tip
// kontrolünden geçmiş kod incelemesiyle doğrulandı, bu script'te DEĞİL —
// proje raporunun kendisinde açıkça belirtilmiştir.
//
// Gerekli ortam değişkenleri: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SB_SECRET_KEY_FOR_TEST (yalnızca test kullanıcısı kurulumu/temizliği +
// admin bootstrap/DB doğrulaması için, hiçbir zaman yazdırılmaz).
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SB_SECRET_KEY_FOR_TEST)");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi (trfnmpihcnriqgikglpu) işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-job-moderation-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}

const createdUserIds = [];
async function createUser(label, role, extra) {
  const stamp = Date.now();
  const email = `malsevk-jobmod-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `E2E ${label}`, p_phone: "+905551234567",
    p_company_name: `E2E Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  if (extra) await extra(client);
  // NOT: burada signOut() ÇAĞRILMAZ (tmp-supabase-provider-document-review-test.mjs'in
  // AYNI adı taşıyan yardımcı fonksiyonundan farklı olarak) — bu script'te
  // `client`, BÖLÜM A boyunca doğrudan RPC çağrıları için TEKRAR kullanılıyor;
  // erken bir signOut, sonraki her .rpc() çağrısının `anon` rolüyle (oturum
  // yokken) çalışmasına ve "permission denied" ile başarısız olmasına yol
  // açardı (ilk taslakta gerçekten bulunan bir hata).
  return { id: data.user.id, email, client };
}

async function loginInPage(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.includes("giris-yap"), { timeout: 15000 });
}

let browser;
async function main() {
  // ---------------------------------------------------------------------
  // KURULUM
  // ---------------------------------------------------------------------
  const adminEmail = `malsevk-jobmod-admin-${Date.now()}@gmail.com`;
  const { data: adminCreate, error: adminCreateError } = await admin.auth.admin.createUser({ email: adminEmail, password: PASSWORD, email_confirm: true });
  if (adminCreateError) throw new Error(`admin createUser failed: ${adminCreateError.message}`);
  const adminUserId = adminCreate.user.id;
  createdUserIds.push(adminUserId);
  runSql(`update public.profiles set role = 'admin', account_status = 'active', onboarding_completed = true, full_name = 'E2E Job Moderation Admin' where id = '${adminUserId}';`);
  const adminCheck = runSql(`select role from public.profiles where id = '${adminUserId}';`);
  record("0. Admin bootstrap başarılı", adminCheck[0]?.role === "admin", JSON.stringify(adminCheck[0]));

  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren", async (client) => {
    await client.rpc("set_provider_service_categories", { p_category_ids: ["nakliye"] });
  });

  browser = await chromium.launch();

  // =======================================================================
  // BÖLÜM A — Supabase/RLS/RPC + Admin Paneli
  // =======================================================================
  const createJob1 = await requester.client.rpc("create_job", {
    p_category_id: "nakliye", p_title: "[E2E-Moderasyon] Onaylanacak ilan",
    p_description: "Job moderation E2E testi için oluşturulmuş açıklama, en az 20 karakter.",
    p_operation_details: "E2E test operasyon detayları.",
    p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "E2E Test Lojistik Merkezi",
    p_work_date: "2026-09-10",
    p_photos: [{ storage_path: `${requester.id}/e2e1.jpg`, original_file_name: "e2e1.jpg", mime_type: "image/jpeg", size_bytes: 1234, width: 800, height: 600 }],
  });
  if (createJob1.error) throw new Error(`create_job(job1): ${createJob1.error.message}`);
  const job1Id = createJob1.data.id;
  record("1. create_job -> moderation_status='pending_review' (RPC seviyesi)", createJob1.data.moderation_status === "pending_review", createJob1.data.moderation_status);

  const adminContext = await browser.newContext();
  const admPage = await adminContext.newPage();
  await loginInPage(admPage, adminEmail);

  await admPage.goto(`${APP_ORIGIN}/admin/ilanlar`);
  await assert.doesNotReject(admPage.getByText("Onay Bekleyen").waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(admPage.getByText("[E2E-Moderasyon] Onaylanacak ilan").waitFor({ state: "visible", timeout: 15000 }));
  record("6a. Admin panelinde 'Onay Bekleyen' sekmesinde yeni ilan görünüyor", true);

  await admPage.locator("tr", { has: admPage.getByText("[E2E-Moderasyon] Onaylanacak ilan") }).getByRole("link", { name: "Detay" }).click();
  await admPage.waitForURL((url) => url.pathname.includes(`/admin/ilanlar/${job1Id}`), { timeout: 15000 });
  await assert.doesNotReject(admPage.getByText("İlan Moderasyonu").waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(admPage.getByText("Admin Onayı Bekleniyor").waitFor({ state: "visible", timeout: 10000 }));
  record("6b. İlan detayında 'İlan Moderasyonu' kartı + 'Admin Onayı Bekleniyor' rozeti", true);

  // 7) Admin ilanı düzenler.
  await admPage.getByRole("button", { name: "İlanı Düzenle" }).click();
  const editedTitle = "[E2E-Moderasyon] Onaylanacak ilan (admin düzeltti)";
  const titleField = admPage.locator("label", { hasText: "İlan Başlığı" }).locator("input");
  await titleField.fill(editedTitle);
  await admPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).click();
  await assert.doesNotReject(admPage.getByText(editedTitle).waitFor({ state: "visible", timeout: 15000 }));
  record("7. Admin ilanı düzenleyebiliyor (başlık güncellendi, UI'da görünüyor)", true);

  const dbJob1AfterEdit = runSql(`select title from public.jobs where id = '${job1Id}';`);
  record("7b. DB'de başlık gerçekten güncellendi", dbJob1AfterEdit[0]?.title === editedTitle, JSON.stringify(dbJob1AfterEdit[0]));

  // 8) Admin onaylar.
  await admPage.getByRole("button", { name: "Onayla ve Yayınla" }).click();
  await assert.doesNotReject(admPage.getByText("Onaylandı", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 }));
  record("8. UI: Onayla sonrası rozet ANINDA 'Onaylandı' oldu (sayfa yenilenmeden)", true);

  const dbJob1Approved = runSql(`select moderation_status, moderation_reviewed_by from public.jobs where id = '${job1Id}';`);
  record(
    "8b. DB: moderation_status='approved', moderation_reviewed_by=admin id",
    dbJob1Approved[0]?.moderation_status === "approved" && dbJob1Approved[0]?.moderation_reviewed_by === adminUserId,
    JSON.stringify(dbJob1Approved[0]),
  );

  // 9) RLS: provider artık görebiliyor.
  const providerSeeAfter = await provider.client.from("jobs").select("id").eq("id", job1Id).maybeSingle();
  record("9. RLS: provider onay sonrası ilanı görebiliyor", !!providerSeeAfter.data, JSON.stringify(providerSeeAfter.error));

  // 10) Hizmet Veren teklif verebiliyor.
  const offerRes = await provider.client.rpc("create_offer", {
    p_job_id: job1Id, p_amount: 5000, p_currency: "TRY", p_description: "E2E teklif açıklaması, en az 20 karakter uzunluğunda.", p_estimated_duration: 5,
  });
  record("10. RPC: Hizmet Veren onaylı ilana teklif verebiliyor", !offerRes.error, JSON.stringify(offerRes.error));

  // 11) İkinci ilan: admin reddeder.
  const createJob2 = await requester.client.rpc("create_job", {
    p_category_id: "nakliye", p_title: "[E2E-Moderasyon] Reddedilecek ilan",
    p_description: "İkinci E2E test ilanı, reddetme akışı için, en az 20 karakter.",
    p_operation_details: "E2E test operasyon detayları 2.",
    p_province: "Kocaeli", p_district: "Gebze", p_work_location_type: "E2E Test Lojistik Merkezi 2",
    p_work_date: "2026-09-11",
    p_photos: [{ storage_path: `${requester.id}/e2e2.jpg`, original_file_name: "e2e2.jpg", mime_type: "image/jpeg", size_bytes: 1234, width: 800, height: 600 }],
  });
  const job2Id = createJob2.data.id;

  await admPage.goto(`${APP_ORIGIN}/admin/ilanlar/${job2Id}`);
  const rejectButton = admPage.getByRole("button", { name: "İlanı Reddet" });
  await assert.doesNotReject(rejectButton.waitFor({ state: "visible", timeout: 15000 }));
  await rejectButton.click();
  const submitButton = admPage.getByRole("button", { name: "Reddet", exact: true });
  await assert.doesNotReject(submitButton.waitFor({ state: "visible", timeout: 5000 }));
  record("11a. Boş nedenle 'Reddet' butonu devre dışı (istemci tarafı zorunluluk)", await submitButton.isDisabled());
  const rejectionReason = "Fotoğraflar belge doğrulaması için yetersiz (E2E test notu).";
  await admPage.locator("#admin-job-reject-reason").fill(rejectionReason);
  await submitButton.click();
  await assert.doesNotReject(admPage.getByText("Admin Tarafından Reddedildi").waitFor({ state: "visible", timeout: 15000 }));
  await assert.doesNotReject(admPage.getByText(rejectionReason).waitFor({ state: "visible", timeout: 5000 }));
  record("11b. Admin ilanı reddedebiliyor, neden UI'da görünüyor", true);

  const providerSeeRejected = await provider.client.from("jobs").select("id").eq("id", job2Id).maybeSingle();
  record("11c. RLS: reddedilen ilan provider'a görünmüyor", !providerSeeRejected.data, JSON.stringify(providerSeeRejected.data));

  // 12) İlan sahibi red nedenini görebiliyor (RLS).
  const requesterSeeReason = await requester.client.from("jobs").select("moderation_rejection_reason").eq("id", job2Id).maybeSingle();
  record("12. RLS: ilan sahibi red nedenini görebiliyor", requesterSeeReason.data?.moderation_rejection_reason === rejectionReason, JSON.stringify(requesterSeeReason.data));

  // 13) Normal kullanıcı kendini approved yapmaya çalışıyor — RPC + doğrudan UPDATE.
  const selfApproveAttempt = await requester.client.rpc("approve_job_as_admin", { p_job_id: job2Id });
  record("13a. Normal kullanıcı approve_job_as_admin çağıramaz (ML115)", selfApproveAttempt.error?.code === "ML115", `${selfApproveAttempt.error?.code}: ${selfApproveAttempt.error?.message}`);
  const directUpdateAttempt = await requester.client.from("jobs").update({ moderation_status: "approved" }).eq("id", job2Id);
  record(
    "13b. Normal kullanıcı jobs.moderation_status'u DOĞRUDAN UPDATE ile değiştiremez",
    !!directUpdateAttempt.error || (Array.isArray(directUpdateAttempt.data) && directUpdateAttempt.data.length === 0),
    directUpdateAttempt.error?.message ?? JSON.stringify(directUpdateAttempt.data),
  );

  // 14) Race condition: eski (stale) p_expected_updated_at ile reject reddedilir.
  // NOT: `admin` (üst kapsam) service_role/secret anahtarıyla oluşturulmuş
  // kurulum/temizlik client'ıdır, GERÇEK bir admin KULLANICI oturumu DEĞİL —
  // service_role'e hiçbir RPC için blanket grant verilmediğinden (bu
  // projenin kendi güvenlik ilkesi, bkz. CLAUDE.md) doğrudan admin.rpc(...)
  // "permission denied" ile başarısız olurdu (ilk taslakta gerçekten
  // bulunan bir hata) — bunun yerine GERÇEK admin kullanıcı oturumuyla
  // (adminEmail ile giriş yapmış ayrı bir SDK client'ı) çağrılır.
  const adminSdkClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminSdkClient.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
  const staleReject = await adminSdkClient.rpc("reject_job_as_admin", { p_job_id: job1Id, p_reason: "stale test", p_expected_updated_at: "2020-01-01T00:00:00Z" });
  record("14. Race condition: eski updated_at ile reject_job_as_admin reddediliyor (ML118)", staleReject.error?.code === "ML118", `${staleReject.error?.code}: ${staleReject.error?.message}`);
  await adminSdkClient.auth.signOut({ scope: "local" });

  await adminContext.close();

  // =======================================================================
  // BÖLÜM B — Canlı uygulama / localStorage (TEK paylaşılan sayfa/context)
  // =======================================================================
  const liveContext = await browser.newContext();
  const livePage = await liveContext.newPage();

  await loginInPage(livePage, requester.email);

  const localJobId = "e2e-local-" + Date.now();
  const localJobTitle = `[E2E-Moderasyon-Local] Pending ilan ${Date.now()}`;
  const nowIso = new Date().toISOString();
  const publishEndAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // job-store.ts#createJob'un gerçekte ürettiği Job şekliyle BİREBİR aynı
  // alan kümesi (types.ts#Job) — "malsevk.jobs.v1" paylaşılan localStorage
  // anahtarına doğrudan seed edilir. Bu, gerçek create_job çağrısının UI
  // üzerinden simüle edilmesi yerine, onun ÜRETTİĞİ veri şeklini doğrudan
  // yazar — asıl test edilen şey (render/enforcement katmanı) formun kendisi
  // değil.
  await livePage.evaluate(
    ({ id, title, requesterId, now, endAt }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id, title, category: "nakliye", province: "Kocaeli", district: "Gebze",
        workLocationType: "E2E Test Lojistik Merkezi", workDate: "2026-09-15",
        description: "E2E localStorage seed testi için açıklama, en az yirmi karakter.",
        operationDetails: "E2E test operasyon detayları.", status: "yayinda",
        requesterId, photos: [], createdAt: now, publishEndAt: endAt,
        moderationStatus: "pending_review",
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id: localJobId, title: localJobTitle, requesterId: requester.id, now: nowIso, endAt: publishEndAt },
  );

  // 2) İlan sahibi kendi ilanını görür -> "Admin Onayı Bekleniyor".
  await livePage.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(livePage.getByText(localJobTitle).waitFor({ state: "visible", timeout: 15000 }));
  const ownCard = livePage.locator("li", { has: livePage.getByText(localJobTitle) }).first();
  await assert.doesNotReject(ownCard.getByText("Admin Onayı Bekleniyor").waitFor({ state: "visible", timeout: 10000 }));
  record("2. Hizmet Alan kendi hesabında 'Admin Onayı Bekleniyor' rozetini görüyor", true);

  // Hizmet Veren'e geç (AYNI paylaşılan context/localStorage — job-store.ts
  // mimarisinin tam olarak test etmek istediği "aynı origin" senaryosu).
  await loginInPage(livePage, provider.email);

  // 3) Başka Hizmet Veren ilan listesini açar -> pending ilan görünmez.
  await livePage.goto(`${APP_ORIGIN}/ilanlar`);
  await livePage.waitForTimeout(1000);
  const visibleInList = await livePage.getByText(localJobTitle).count();
  record("3. Hizmet Veren ilan listesinde pending ilan görünmüyor", visibleInList === 0, `count=${visibleInList}`);

  // 4) Pending ilan ID'si doğrudan sorgulanır -> yetkisiz erişim engellenir.
  await livePage.goto(`${APP_ORIGIN}/ilanlar/${localJobId}`);
  await assert.doesNotReject(livePage.getByText(/İlan bulunamadı/i).waitFor({ state: "visible", timeout: 15000 }));
  const offerPanelVisible = await livePage.getByText("Teklif Ver", { exact: false }).count();
  record("4. Pending ilana doğrudan URL erişimi engelleniyor ('İlan bulunamadı')", true);
  // 5) Aynı sayfa "bulunamadı" gösterdiği için gerçek bir Teklif Ver formu hiç render edilmiyor.
  record("5. Pending ilan için Teklif Ver formu/butonu hiç render edilmiyor (sayfa erişimi zaten engelli)", offerPanelVisible === 0, `count=${offerPanelVisible}`);

  await liveContext.close();
  await browser.close();
  browser = null;
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (browser) await browser.close();
    } catch {}
    try {
      const idList = createdUserIds.map((id) => `'${id}'`).join(", ");
      if (idList) {
        runSql(`delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList}) or job_id in (select id from public.jobs where requester_id in (${idList})) or offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
        runSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));`);
        runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList}));`);
        runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})) or provider_id in (${idList});`);
        runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
        runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
        runSql(`delete from public.jobs where requester_id in (${idList});`);
        runSql(`delete from public.provider_services where provider_id in (${idList});`);
      }
    } catch (error) {
      console.warn("DB temizliği sırasında uyarı:", error?.message || error);
    }
    for (const id of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.warn(`Kullanıcı silinemedi (${id}): ${error.message}`);
    }
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {}

    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((f) => f.name).join(" | "));
      process.exitCode = 1;
    }
  });
