// "Faaliyet Kapsamı Uygun" sadeleştirme görevinin GERÇEK TARAYICI testi —
// çerçevesiz/kutusuz yeni tasarımın doğru metinlerle, gerçek eşleştirme
// verisiyle render edildiğini ve diğer kategorilerde/akışlarda regresyon
// olmadığını doğrular. Development'a karşı çalışır, demo hesaba dokunulmaz.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 300) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `redesign-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `RedesignTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `RedesignTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) break;
  }
  await page.waitForTimeout(1000);
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  await adminClient.rpc("authorize_provider_service", {
    p_provider_id: provider.id,
    p_service_category_id: "konteyner-depolama",
    p_reason: "Tasarım sadeleştirme testi",
    p_storage_activity_scopes: ["bos-konteyner-depolama", "dolu-tehlikeli-konteyner-depolama", "reefer-konteyner-depolama"],
    p_imo_class_codes: ["4.2"],
  });

  const { data: job } = await requester.client.rpc("create_job", {
    p_category_id: "konteyner-depolama",
    p_title: "RedesignTest — Sadeleştirilmiş Uygunluk Alanı",
    p_description: "Faaliyet Kapsamı Uygun tasarımının sadeleştirildiğini doğrulayan test ilanı.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_work_date: WORK_DATE,
    p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    p_storage_container_groups: [
      { id: "g1", quantity: 6, size: "20", type: "standart", status: "bos" },
      { id: "g2", quantity: 2, size: "40", type: "reefer", status: "dolu", hazardous: true, content: "Kimyasal", unNumber: "UN3077", imoClass: "4.2" },
    ],
  });
  const jobId = job?.id;
  await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  record("Kurulum: ilan oluşturuldu ve onaylandı", Boolean(jobId));

  const { data: offer, error: offerError } = await provider.client.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 4200,
    p_currency: "TRY",
    p_description: "RedesignTest doğrulama teklifi — tasarım sadeleştirme testi.",
  });
  record("Kurulum: provider gerçek bir teklif verdi", !offerError && Boolean(offer?.id), offerError?.message);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate(
      ({ offerId, jobId, providerId }) => {
        const now = new Date().toISOString();
        const localOffer = {
          id: offerId,
          jobId,
          providerId,
          amount: 4200,
          currency: "TRY",
          description: "RedesignTest doğrulama teklifi — tasarım sadeleştirme testi.",
          status: "pending",
          createdAt: now,
          updatedAt: now,
          supabaseOfferId: offerId,
        };
        const existingRaw = window.localStorage.getItem("malsevk.offers.v1");
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        window.localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existing, localOffer]));
      },
      { offerId: offer.id, jobId, providerId: provider.id },
    );

    // =========================================================================
    // 1) MASAÜSTÜ (1366×768) — yeni tasarım metinleri + eski tasarımın
    //    tamamen kalktığı doğrulanır.
    // =========================================================================
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler?ilanId=${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("text=Faaliyet Kapsamı Uygun", { timeout: 30000 }).catch(() => {});
    const desktopText = await page.locator("body").innerText();

    record("1a. Yeni başlık 'Faaliyet Kapsamı Uygun' görünüyor", desktopText.includes("Faaliyet Kapsamı Uygun"), desktopText.slice(0, 600));
    record("1b. Eski başlık 'Bu İlana Uygun' ARTIK HİÇ görünmüyor", !desktopText.includes("Bu İlana Uygun"));
    record(
      "1c. Açıklama metni birebir doğru: 'Firmanın onaylı faaliyet alanları ilan gereksinimleriyle eşleşiyor.'",
      desktopText.includes("Firmanın onaylı faaliyet alanları ilan gereksinimleriyle eşleşiyor."),
    );
    record(
      "1d. Alt bilgilendirme metni birebir doğru: 'Nihai kapasite ve müsaitlik teklif sahibiyle teyit edilmelidir.'",
      desktopText.includes("Nihai kapasite ve müsaitlik teklif sahibiyle teyit edilmelidir."),
    );
    record(
      "1e. Gerçek eşleşen faaliyetler listeleniyor (Boş Konteyner Depolama, Dolu Tehlikeli Konteyner Depolama, Reefer Konteyner Depolama)",
      desktopText.includes("Boş Konteyner Depolama") && desktopText.includes("Dolu Tehlikeli Konteyner Depolama") && desktopText.includes("Reefer Konteyner Depolama"),
    );
    record("1f. IMO sınıfı da listede (IMO 4.2 – Kendiliğinden yanmaya yatkın maddeler)", /IMO 4\.2 – Kendiliğinden yanmaya yatkın maddeler/.test(desktopText));

    // Görsel/DOM yapı kontrolü — bölümün KENDİSİ artık çerçeve/arka plan/rounded taşımıyor.
    const sectionBox = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === "Faaliyet Kapsamı Uygun");
      if (!heading) return null;
      // En yakın "max-w-[260px]" sarmalayıcıyı bul (bileşenin kök div'i).
      let node = heading.parentElement;
      const style = node ? getComputedStyle(node) : null;
      return style
        ? {
            borderWidth: style.borderTopWidth,
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
          }
        : null;
    });
    record(
      "1g. Yeni bölümün kök kabı çerçevesiz (border-width: 0px)",
      sectionBox?.borderWidth === "0px",
      JSON.stringify(sectionBox),
    );
    record(
      "1h. Yeni bölümün kök kabı arka plansız (transparent/rgba(0,0,0,0))",
      sectionBox?.backgroundColor === "rgba(0, 0, 0, 0)" || sectionBox?.backgroundColor === "transparent",
      sectionBox?.backgroundColor,
    );
    record("1i. Yeni bölümün kök kabında gölge yok (box-shadow: none)", sectionBox?.boxShadow === "none", sectionBox?.boxShadow);

    const overflowCheck = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    record("1j. 1366×768'de yatay taşma YOK", !overflowCheck);

    const screenshotPath = path.join(os.tmpdir(), "eligibility-redesign-desktop.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log("Masaüstü ekran görüntüsü:", screenshotPath);

    // =========================================================================
    // 2) MOBİL (375px) — bölüm karta göre alta geçiyor, yatay taşma yok.
    // =========================================================================
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForTimeout(500);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    record("2a. 375px mobil genişlikte yatay taşma YOK", !mobileOverflow);
    const mobileScreenshotPath = path.join(os.tmpdir(), "eligibility-redesign-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
    console.log("Mobil ekran görüntüsü:", mobileScreenshotPath);

    // =========================================================================
    // 3) TEKLİF KABUL/RED AKIŞI BOZULMADI — Kabul Et/Reddet butonları hâlâ çalışır durumda.
    // =========================================================================
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    const acceptButton = page.getByRole("button", { name: "Kabul Et" });
    const rejectButton = page.getByRole("button", { name: "Reddet" });
    record("3a. 'Kabul Et' butonu mevcut ve etkileşimli (devre dışı değil)", (await acceptButton.count()) > 0 && !(await acceptButton.isDisabled()));
    record("3b. 'Reddet' butonu mevcut ve etkileşimli", (await rejectButton.count()) > 0 && !(await rejectButton.isDisabled()));

    // =========================================================================
    // 4) REGRESYON — Nakliye kategorisinde bu bölüm hiç görünmüyor, kart normal.
    // =========================================================================
    const { data: nakliyeJob } = await requester.client.rpc("create_job", {
      p_category_id: "nakliye",
      p_title: "RedesignTest — Nakliye Regresyon",
      p_description: "Regresyon kontrolü.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    });
    await adminClient.rpc("approve_job_as_admin", { p_job_id: nakliyeJob.id });
    await adminClient.rpc("authorize_provider_service", { p_provider_id: provider.id, p_service_category_id: "nakliye", p_reason: "regresyon" });
    const { data: nakliyeOffer } = await provider.client.rpc("create_offer", {
      p_job_id: nakliyeJob.id,
      p_amount: 3000,
      p_currency: "TRY",
      p_description: "RedesignTest doğrulama teklifi — Nakliye regresyon testi.",
      p_estimated_duration: 5,
    });
    await page.evaluate(
      ({ offerId, jobId, providerId }) => {
        const now = new Date().toISOString();
        const localOffer = {
          id: offerId,
          jobId,
          providerId,
          amount: 3000,
          currency: "TRY",
          description: "RedesignTest doğrulama teklifi — Nakliye regresyon testi.",
          estimatedDuration: 5,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          supabaseOfferId: offerId,
        };
        const existingRaw = window.localStorage.getItem("malsevk.offers.v1");
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        window.localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existing, localOffer]));
      },
      { offerId: nakliyeOffer.id, jobId: nakliyeJob.id, providerId: provider.id },
    );
    await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler?ilanId=${nakliyeJob.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const nakliyeText = await page.locator("body").innerText();
    record("4a. Nakliye teklif kartında 'Faaliyet Kapsamı Uygun' bölümü HİÇ görünmüyor (regresyon yok)", !nakliyeText.includes("Faaliyet Kapsamı Uygun"), nakliyeText.slice(0, 300));
    record("4b. Nakliye teklif kartı normal render edildi (Kabul Et mevcut)", nakliyeText.includes("Kabul Et"));

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  try {
    if (idList) {
      runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.notifications where offer_id in (select o.id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
      runSql(`delete from public.offer_status_history where offer_id in (select o.id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`);
      runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
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
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
