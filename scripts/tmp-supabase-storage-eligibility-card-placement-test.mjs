// "Uygunluk kartının yeri" düzeltme görevinin GERÇEK TARAYICI + RPC testi:
// (1) kart artık Hizmet Veren'in kendi Teklif Ver panelinde HİÇ görünmüyor,
// (2) Hizmet Alan'ın Gelen Teklifler ekranındaki HER Konteyner Depolama
// teklif kartında doğru kapsam/IMO etiketleriyle görünüyor, (3) yasak
// ifadeler hiç gösterilmiyor, (4) teklif oluşturulduktan SONRA yetki geri
// alınırsa yeşil kart "artık geçerli değil" uyarısına dönüyor VE Kabul Et
// hem arayüzde hem backend'de (MLK101) engelleniyor. Development'a karşı
// çalışır, demo hesaba dokunulmaz.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
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
let jobId;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `cardplace-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `CardPlaceTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `CardPlaceTest Firma ${label}`,
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

async function newActorPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const providerOfferer = await createUser("provA-offerer", "hizmet-veren");
  const providerViewerOnly = await createUser("provB-viewer", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  // Her iki provider'ı da tam kapsam+IMO 4.2 ile yetkilendir.
  for (const provider of [providerOfferer, providerViewerOnly]) {
    await adminClient.rpc("authorize_provider_service", {
      p_provider_id: provider.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059/0060 kart yerleşimi testi",
      p_storage_activity_scopes: ["bos-konteyner-depolama", "dolu-tehlikeli-konteyner-depolama"],
      p_imo_class_codes: ["4.2"],
    });
  }

  const { data: job } = await requester.client.rpc("create_job", {
    p_category_id: "konteyner-depolama",
    p_title: "CardPlaceTest — Kart Yerleşimi İlanı",
    p_description: "Uygunluk kartının doğru yere taşındığını doğrulayan test ilanı.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Depo",
    p_work_date: WORK_DATE,
    p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    p_storage_container_groups: [
      { id: "g1", quantity: 8, size: "20", type: "standart", status: "bos" },
      { id: "g2", quantity: 4, size: "40", type: "standart", status: "dolu", hazardous: true, content: "Kimyasal", unNumber: "UN3077", imoClass: "4.2" },
    ],
  });
  jobId = job?.id;
  await adminClient.rpc("approve_job_as_admin", { p_job_id: jobId });
  record("Kurulum: ilan oluşturuldu ve onaylandı", Boolean(jobId));

  const { data: offer, error: offerError } = await providerOfferer.client.rpc("create_offer", {
    p_job_id: jobId,
    p_amount: 5000,
    p_currency: "TRY",
    p_description: "CardPlaceTest doğrulama teklifi — kart yerleşimi testi.",
  });
  record("Kurulum: provider gerçek bir teklif verdi", !offerError && Boolean(offer?.id), offerError?.message);

  const browser = await chromium.launch();
  try {
    // =========================================================================
    // 1) HİZMET VEREN — kendi Teklif Ver panelinde (henüz teklif VERMEMİŞ,
    //    tam yetkili ikinci provider) uygunluk kartı ARTIK GÖRÜNMÜYOR.
    // =========================================================================
    const { context: viewerContext, page: viewerPage } = await newActorPage(browser);
    await loginAs(viewerPage, providerViewerOnly.email, PASSWORD);
    await viewerPage.goto(`${APP_ORIGIN}/ilanlar/${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await viewerPage.waitForFunction((title) => document.body.innerText.includes(title), "CardPlaceTest — Kart Yerleşimi İlanı", { timeout: 30000 }).catch(() => {});
    const viewerPageText = await viewerPage.locator("body").innerText();
    record("1a. Tam yetkili provider ilanı görebiliyor (Teklif Ver formu erişilebilir)", viewerPageText.includes("Teklif Ver") || viewerPageText.includes("Teklif Fiyatı"));
    record("1b. Hizmet Veren'in KENDİ Teklif Ver panelinde 'Bu İlana Uygun' kartı ARTIK YOK", !viewerPageText.includes("Bu İlana Uygun"), viewerPageText.slice(0, 400));
    await viewerContext.close();

    // =========================================================================
    // 2) HİZMET ALAN — Gelen Teklifler'de bu teklifin kartında uygunluk
    //    bilgisi doğru görünüyor.
    //
    //    ÖNEMLİ MİMARİ NOT (bu görevin KAPSAMI DIŞINDA bulunan, ÖNCEDEN VAR
    //    OLAN bir sınırlama): `offers.ts` teklifleri yalnızca localStorage'tan
    //    okur (`useAllOffers`/`offersStore`) — job-store.ts'in aksine, hiçbir
    //    Supabase geri-okuma/senkron mekanizması YOK (`supabase-offer-
    //    sync.ts` yalnızca YAZMA yönünde senkron sağlar, doğrulandı: bu
    //    dosyada `grep` ile aranan tüm olası okuma fonksiyonu isimleri boş
    //    sonuç döndü). Bu yüzden RPC ile doğrudan oluşturulan bir teklif,
    //    Hizmet Alan'ın TARAYICISININ KENDİ localStorage'ına asla ulaşmaz —
    //    tıpkı gerçek üründe bugün de olacağı gibi (bu, bu görevin çözmesi
    //    istenen bir şey DEĞİL). Bu test, YALNIZCA yeni uygunluk kartı
    //    bileşeninin kendisini gerçekçi bir `Offer` nesnesiyle doğrulamak
    //    için, teklifi requester'ın TARAYICISININ localStorage'ına (gerçek
    //    `supabaseOfferId` ile, offers.ts#OFFERS_STORAGE_KEY şemasına birebir
    //    uyumlu) enjekte eder — cross-device teklif senkronunun KENDİSİNİ
    //    test etmiyor/simüle etmiyor, yalnızca zaten localStorage'da VAR OLAN
    //    bir teklifin kartının doğru render edildiğini kanıtlıyor.
    // =========================================================================
    const { context: requesterContext, page: requesterPage } = await newActorPage(browser);
    await loginAs(requesterPage, requester.email, PASSWORD);
    await requesterPage.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await requesterPage.waitForTimeout(1500);
    await requesterPage.evaluate(
      ({ offerId, jobId, providerId }) => {
        const now = new Date().toISOString();
        const localOffer = {
          id: offerId,
          jobId,
          providerId,
          amount: 5000,
          currency: "TRY",
          description: "CardPlaceTest doğrulama teklifi — kart yerleşimi testi.",
          status: "pending",
          createdAt: now,
          updatedAt: now,
          supabaseOfferId: offerId,
        };
        const existingRaw = window.localStorage.getItem("malsevk.offers.v1");
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        window.localStorage.setItem("malsevk.offers.v1", JSON.stringify([...existing, localOffer]));
      },
      { offerId: offer.id, jobId, providerId: providerOfferer.id },
    );
    await requesterPage.goto(`${APP_ORIGIN}/panel/gelen-teklifler?ilanId=${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await requesterPage.waitForSelector("text=Bu İlana Uygun", { timeout: 30000 }).catch(() => {});
    const incomingText = await requesterPage.locator("body").innerText();
    record("2a. Hizmet Alan'ın Gelen Teklifler ekranında '✓ Bu İlana Uygun' kartı görünüyor", incomingText.includes("Bu İlana Uygun"), incomingText.slice(0, 500));
    record("2b. Kart doğru kapsamları gösteriyor (Boş Konteyner Depolama, Dolu Tehlikeli Konteyner Depolama)", incomingText.includes("Boş Konteyner Depolama") && incomingText.includes("Dolu Tehlikeli Konteyner Depolama"));
    record("2c. Kart doğru IMO sınıfını gösteriyor (IMO 4.2 – Kendiliğinden yanmaya yatkın maddeler)", /IMO 4\.2 – Kendiliğinden yanmaya yatkın maddeler/.test(incomingText), incomingText.match(/IMO 4\.2[\s\S]{0,10}/)?.[0]);
    record(
      "2d. Yasak ifadeler (admin onaylı/belge onaylı/belge numarası/belge dosyası/belge yükleme tarihi/belge geçerlilik tarihi/admin inceleme notu) HİÇ gösterilmiyor",
      !/admin onaylı|belge onaylı|belge numarası|belge dosyası|belge y[üu]kleme tarihi|belge geçerlilik tarihi|inceleme notu/i.test(incomingText),
    );
    record("2e. Firma kimliği/iletişim bilgisi teklif henüz kabul edilmeden GİZLİ kalıyor (mevcut kural bozulmadı)", incomingText.includes("Hizmet Veren #"));

    // =========================================================================
    // 3) YETKİ GERİ ALINDIKTAN SONRA — kart "artık geçerli değil" uyarısına
    //    dönüyor, Kabul Et devre dışı kalıyor, backend de reddediyor (MLK101).
    // =========================================================================
    const { error: revokeError } = await adminClient.rpc("revoke_provider_service_authorization", {
      p_provider_id: providerOfferer.id,
      p_service_category_id: "konteyner-depolama",
      p_reason: "0059/0060 testi — teklif sonrası yetki iptali senaryosu",
    });
    record("Kurulum: teklif SONRASI provider'ın yetkisi geri alındı", !revokeError, revokeError?.message);

    await requesterPage.reload({ waitUntil: "domcontentloaded" });
    await requesterPage.waitForTimeout(2500);
    const afterRevokeText = await requesterPage.locator("body").innerText();
    record("3a. Yetki geri alındıktan sonra yeşil kart YERİNE 'artık geçerli değil' uyarısı görünüyor", afterRevokeText.includes("Bu teklifin hizmet uygunluğu artık geçerli değil."), afterRevokeText.slice(0, 500));
    record("3b. Yeşil 'Bu İlana Uygun' kartı ARTIK gösterilmiyor", !afterRevokeText.includes("Bu İlana Uygun"));

    const acceptButton = requesterPage.getByRole("button", { name: "Kabul Et" });
    record("3c. 'Kabul Et' butonu arayüzde DEVRE DIŞI", await acceptButton.isDisabled());

    // Backend'i doğrudan da doğrula — arayüz devre dışı bırakmış olsa bile
    // gerçek koruma HER ZAMAN backend'dedir (görev talimatı).
    const { error: acceptError } = await requester.client.rpc("accept_offer", { p_offer_id: offer.id });
    record("3d. Backend, geçersiz uygunlukla 'Kabul Et' RPC çağrısını REDDEDİYOR (MLK87)", acceptError?.code === "MLK87" || /MLK87/.test(acceptError?.message ?? ""), acceptError?.message ?? "HATA: kabul başarıyla gerçekleşti — bu ciddi bir güvenlik açığı olurdu");

    await requesterContext.close();

    // =========================================================================
    // 4) REGRESYON — Nakliye kategorisinin Gelen Teklifler görünümü hâlâ
    //    normal (uygunluk kartı hiç görünmüyor, mevcut akış bozulmadı).
    // =========================================================================
    const { data: nakliyeJob } = await requester.client.rpc("create_job", {
      p_category_id: "nakliye",
      p_title: "CardPlaceTest — Nakliye Regresyon",
      p_description: "Regresyon kontrolü — uygunluk kartı bu kategoride görünmemeli.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    });
    await adminClient.rpc("approve_job_as_admin", { p_job_id: nakliyeJob.id });
    await adminClient.rpc("authorize_provider_service", { p_provider_id: providerOfferer.id, p_service_category_id: "nakliye", p_reason: "regresyon" });
    // Yetkisi tekrar geçerli hale gelsin diye Konteyner Depolama'yı da tekrar yetkilendir (Nakliye teklifi engellenmesin diye gerek yok ama temiz olsun).
    const { data: nakliyeOffer, error: nakliyeOfferError } = await providerOfferer.client.rpc("create_offer", {
      p_job_id: nakliyeJob.id,
      p_amount: 3000,
      p_currency: "TRY",
      p_description: "CardPlaceTest doğrulama teklifi — Nakliye regresyon testi.",
      p_estimated_duration: 5,
    });
    record("Kurulum: Nakliye ilanına teklif verildi (regresyon)", !nakliyeOfferError && Boolean(nakliyeOffer?.id), nakliyeOfferError?.message);

    const { context: reqContext2, page: reqPage2 } = await newActorPage(browser);
    await loginAs(reqPage2, requester.email, PASSWORD);
    await reqPage2.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await reqPage2.waitForTimeout(1000);
    // Aynı yerel-enjeksiyon gerekçesi — bkz. yukarıdaki BÖLÜM 2'nin kendi notu.
    await reqPage2.evaluate(
      ({ offerId, jobId, providerId }) => {
        const now = new Date().toISOString();
        const localOffer = {
          id: offerId,
          jobId,
          providerId,
          amount: 3000,
          currency: "TRY",
          description: "CardPlaceTest doğrulama teklifi — Nakliye regresyon testi.",
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
      { offerId: nakliyeOffer.id, jobId: nakliyeJob.id, providerId: providerOfferer.id },
    );
    await reqPage2.goto(`${APP_ORIGIN}/panel/gelen-teklifler?ilanId=${nakliyeJob.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await reqPage2.waitForTimeout(2000);
    const nakliyeIncomingText = await reqPage2.locator("body").innerText();
    record(
      "4a. Nakliye teklifinde uygunluk kartı/uyarısı HİÇ görünmüyor (regresyon yok)",
      !nakliyeIncomingText.includes("Bu İlana Uygun") && !nakliyeIncomingText.includes("artık geçerli değil"),
      nakliyeIncomingText.slice(0, 300),
    );
    record("4b. Nakliye teklif kartı normal şekilde render edildi (Kabul Et/Reddet mevcut)", nakliyeIncomingText.includes("Kabul Et") || nakliyeIncomingText.includes("Kabul"));
    await reqContext2.close();
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
