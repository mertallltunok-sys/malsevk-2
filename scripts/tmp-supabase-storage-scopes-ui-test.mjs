// "Depocu Faaliyet Alanları + çoklu IMO + kısmi onay + uygunluk kartı"
// görevinin GERÇEK TARAYICI testi (backend/RPC katmanı zaten
// tmp-supabase-storage-eligibility-backend-verify.mjs ile 20/20 doğrulandı —
// bu script özellikle YENİ UI akışlarını hedefler: /panel/belge-yukleme'deki
// çoklu-seçim faaliyet alanı + IMO picker'ı, admin'in KISMİ onay checklist'i,
// ve teklif panelindeki "✓ Bu İlana Uygun" kartı). Development'a karşı
// çalışır. Demo hesaba HİÇ dokunulmaz — tüm hesaplar bu script tarafından
// oluşturulan, tek kullanımlık, temiz test hesaplarıdır.
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
let jobFullId, jobPartialGapId;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `scopesui-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `ScopesUiTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `ScopesUiTest Firma ${label}`,
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
  const provider = await createUser("prov", "hizmet-veren");
  const requester = await createUser("req", "hizmet-alan");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);
  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  const browser = await chromium.launch();
  let documentId;
  try {
    // =========================================================================
    // 1) PROVIDER — /panel/belge-yukleme: Konteyner Depolama seç, çoklu
    //    faaliyet alanı + çoklu IMO sınıfı seç, belge yükle.
    // =========================================================================
    const { context: providerContext, page } = await newActorPage(browser);
    await loginAs(page, provider.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/panel/belge-yukleme`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("text=Hangi hizmeti veriyorsunuz?", { timeout: 30000 });

    // Konteyner Depolama, "Depo Hizmetleri" sadeleştirilmiş GRUBUNUN bir
    // parçasıdır (bkz. service-catalog.ts#PROVIDER_AUTHORIZATION_GROUPS) —
    // bu ekranda TEK BAŞINA seçilebilir bir kategori DEĞİLDİR, yalnızca
    // "Depo Hizmetleri Veriyorum" grup butonuyla ulaşılabilir (document-
    // upload-content.tsx#CONSOLIDATED_CATEGORY_IDS onu per-kategori
    // listeden çıkarır).
    await page.getByRole("button", { name: "Depo Hizmetleri Veriyorum", exact: true }).click();
    await page.waitForTimeout(500);

    const uploadStepText = await page.locator("body").innerText();
    record("1a. Konteyner Depolama seçilince 'Depocu Faaliyet Alanları' seçici görünüyor", uploadStepText.includes("Depocu Faaliyet Alanları"));
    record("1b. IMO Sınıfları seçici HENÜZ görünmüyor (Dolu Tehlikeli seçilmedi)", !uploadStepText.includes("IMO Sınıfları"));

    // 3 faaliyet alanı seç: Boş + Dolu Tehlikesiz + Dolu Tehlikeli.
    await page.getByRole("button", { name: "Boş Konteyner Depolama", exact: true }).click();
    await page.getByRole("button", { name: "Dolu Tehlikesiz Konteyner Depolama", exact: true }).click();
    await page.getByRole("button", { name: "Dolu Tehlikeli Konteyner Depolama", exact: true }).click();
    await page.waitForTimeout(300);

    const afterHazardousScopeText = await page.locator("body").innerText();
    record("1c. 'Dolu Tehlikeli' seçilince IMO Sınıfları seçici CANLI açılıyor", afterHazardousScopeText.includes("IMO Sınıfları"));

    // 2 IMO sınıfı seç: 4.2 ve 8.
    const imoSearchInput = page.getByPlaceholder("IMO sınıfı ara...");
    await imoSearchInput.fill("4.2");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^4\.2/ }).click();
    await imoSearchInput.fill("");
    await imoSearchInput.fill("8 —");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^8 —/ }).click();
    await imoSearchInput.fill("");
    await page.waitForTimeout(200);

    const afterImoPickText = await page.locator("body").innerText();
    record("1d. '2 seçildi' IMO seçim sayacı görünüyor", /2 seçildi/.test(afterImoPickText));

    // "Dolu Tehlikeli" kapsamını KALDIR — IMO seçimleri temizlenmeli.
    await page.getByRole("button", { name: "Dolu Tehlikeli Konteyner Depolama", exact: true }).click();
    await page.waitForTimeout(300);
    const afterRemoveHazardousText = await page.locator("body").innerText();
    record("1e. 'Dolu Tehlikeli' kaldırılınca IMO Sınıfları seçici KAYBOLUYOR (seçimler temizlendi)", !afterRemoveHazardousText.includes("IMO Sınıfları"));

    // Tekrar ekle (gerçek senaryoya devam) — IMO'ları yeniden seçmemiz gerekecek.
    await page.getByRole("button", { name: "Dolu Tehlikeli Konteyner Depolama", exact: true }).click();
    await page.waitForTimeout(300);
    const submitButtonForValidation = page.getByRole("button", { name: "Belgeyi Gönder" });
    record("1f. IMO seçilmeden 'Belgeyi Gönder' butonu DEVRE DIŞI (Dolu Tehlikeli seçiliyken IMO zorunlu)", await submitButtonForValidation.isDisabled());

    await imoSearchInput.fill("4.2");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^4\.2/ }).click();
    await imoSearchInput.fill("");
    await imoSearchInput.fill("8 —");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^8 —/ }).click();
    await imoSearchInput.fill("");
    await page.waitForTimeout(200);

    // Belge dosyasını yükle.
    const tmp = os.tmpdir();
    const fixtureFile = path.join(tmp, "fixture-valid-1.jpg");
    readFileSync(fixtureFile);
    await page.locator('input[type="file"]').setInputFiles([fixtureFile]);
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Belgeyi Gönder" }).click();
    await page.waitForSelector("text=belgeniz yüklendi", { timeout: 30000 }).catch(() => {});
    const afterSubmitText = await page.locator("body").innerText();
    record("1g. Belge başarıyla gönderildi ('belgeniz yüklendi' mesajı göründü)", afterSubmitText.includes("belgeniz yüklendi"), afterSubmitText.slice(0, 300));

    await providerContext.close();

    // DB'den bu belgenin id'sini + gerçekten kaydedilen scope/IMO'yu al.
    const { data: docRows } = await adminClient
      .from("provider_documents")
      .select("id, storage_activity_scopes, imo_class_codes")
      .eq("provider_id", provider.id)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    documentId = docRows?.[0]?.id;
    record("2a. Belge DB'de 3 faaliyet alanı ile kaydedildi", (docRows?.[0]?.storage_activity_scopes ?? []).length === 3, JSON.stringify(docRows?.[0]));
    record("2b. Belge DB'de 2 IMO sınıfı (4.2, 8) ile kaydedildi", JSON.stringify((docRows?.[0]?.imo_class_codes ?? []).sort()) === JSON.stringify(["4.2", "8"]), JSON.stringify(docRows?.[0]?.imo_class_codes));

    // =========================================================================
    // 3) ADMIN — /admin/firma-belgeleri/{id}: talep edilen kapsam/IMO'yu
    //    görsün, KISMİ onaylasın (Dolu Tehlikeli kapsamını VE onun IMO'larını
    //    ONAYLAMA DIŞI bırak — yalnızca Boş + Dolu Tehlikesiz onaylansın).
    // =========================================================================
    const { context: adminContext, page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminUser.email, PASSWORD);
    await adminPage.goto(`${APP_ORIGIN}/admin/firma-belgeleri/${documentId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await adminPage.waitForSelector("text=Talep Edilen Faaliyet Alanları", { timeout: 30000 }).catch(() => {});
    const adminDetailText = await adminPage.locator("body").innerText();
    record(
      "3a. Admin, belgenin talep ettiği 3 faaliyet alanını + 2 IMO sınıfını görüyor",
      adminDetailText.includes("Boş Konteyner Depolama") &&
        adminDetailText.includes("Dolu Tehlikesiz Konteyner Depolama") &&
        adminDetailText.includes("Dolu Tehlikeli Konteyner Depolama") &&
        /IMO 4\.2/.test(adminDetailText) &&
        /IMO 8/.test(adminDetailText),
      adminDetailText.slice(0, 500),
    );

    // "Onaylanacak Faaliyet Alanları" checklist'inde "Dolu Tehlikeli Konteyner
    // Depolama" işaretini KALDIR — kısmi onay.
    const approveScopesGroup = adminPage.locator("#approved-storage-activity-scopes");
    await approveScopesGroup.getByRole("button", { name: "Dolu Tehlikeli Konteyner Depolama", exact: true }).click();
    await adminPage.waitForTimeout(300);
    const afterUncheckText = await adminPage.locator("body").innerText();
    record("3b. 'Dolu Tehlikeli' işareti kaldırılınca 'Onaylanacak IMO Sınıfları' checklist'i KAYBOLUYOR", !afterUncheckText.includes("Onaylanacak IMO Sınıfları"));

    await adminPage.getByRole("button", { name: "Onayla", exact: true }).click();
    await adminPage.waitForTimeout(1500);
    const afterApproveText = await adminPage.locator("body").innerText();
    record("3c. Belge onaylandı ('Onaylandı' durumu göründü)", afterApproveText.includes("Onaylandı"));

    await adminContext.close();

    // =========================================================================
    // 4) DB — kısmi onay GERÇEKTEN yansıdı mı (yetki satırında yalnızca 2
    //    kapsam, IMO'lar TAMAMEN boş)?
    // =========================================================================
    const { data: authRows } = await adminClient
      .from("provider_service_authorizations")
      .select("storage_activity_scopes, imo_class_codes")
      .eq("provider_id", provider.id)
      .eq("service_category_id", "konteyner-depolama")
      .is("revoked_at", null)
      .maybeSingle();
    record(
      "4a. Yetki satırında YALNIZCA 2 kapsam var (Dolu Tehlikeli HARİÇ tutuldu — kısmi onay gerçekten uygulandı)",
      JSON.stringify((authRows?.storage_activity_scopes ?? []).sort()) === JSON.stringify(["bos-konteyner-depolama", "dolu-tehlikesiz-konteyner-depolama"]),
      JSON.stringify(authRows),
    );
    record("4b. Yetki satırında IMO sınıfı YOK (boş dizi — Dolu Tehlikeli hiç onaylanmadığı için)", (authRows?.imo_class_codes ?? []).length === 0, JSON.stringify(authRows?.imo_class_codes));

    // =========================================================================
    // 5) İki test ilanı oluştur: (A) yalnızca onaylı kapsamlarla TAM eşleşen
    //    (Boş + Dolu Tehlikesiz), (B) onaylanmayan Dolu Tehlikeli grup içeren.
    // =========================================================================
    const { data: jobFull } = await requester.client.rpc("create_job", {
      p_category_id: "konteyner-depolama",
      p_title: "ScopesUiTest — Tam Eşleşen İlan",
      p_description: "Kısmi onay sonrası tam eşleşme testi.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Depo",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
      p_storage_container_groups: [
        { id: "g1", quantity: 5, size: "20", type: "standart", status: "bos" },
        { id: "g2", quantity: 5, size: "40", type: "standart", status: "dolu", hazardous: false, content: "Tekstil" },
      ],
    });
    jobFullId = jobFull?.id;
    await adminClient.rpc("approve_job_as_admin", { p_job_id: jobFullId });

    const { data: jobGap } = await requester.client.rpc("create_job", {
      p_category_id: "konteyner-depolama",
      p_title: "ScopesUiTest — Onaylanmayan Kapsam İçeren İlan",
      p_description: "Kısmi onay sonrası eksik kapsam testi.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Depo",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
      p_storage_container_groups: [
        { id: "g1", quantity: 5, size: "20", type: "standart", status: "bos" },
        { id: "g2", quantity: 3, size: "40", type: "standart", status: "dolu", hazardous: true, content: "Kimyasal", unNumber: "UN3077", imoClass: "4.2" },
      ],
    });
    jobPartialGapId = jobGap?.id;
    await adminClient.rpc("approve_job_as_admin", { p_job_id: jobPartialGapId });
    record("5a. İki test ilanı oluşturuldu ve onaylandı", Boolean(jobFullId) && Boolean(jobPartialGapId));

    // =========================================================================
    // 6) PROVIDER — /ilanlar: tam eşleşen ilanı GÖRÜR + "✓ Bu İlana Uygun"
    //    kartı doğru etiketlerle görünür; eksik-kapsamlı ilan HİÇ görünmez.
    // =========================================================================
    const { context: providerContext2, page: providerPage } = await newActorPage(browser);
    await loginAs(providerPage, provider.email, PASSWORD);

    await providerPage.goto(`${APP_ORIGIN}/ilanlar/${jobFullId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await providerPage.waitForFunction((title) => document.body.innerText.includes(title), "ScopesUiTest — Tam Eşleşen İlan", { timeout: 30000 }).catch(() => {});
    const fullJobText = await providerPage.locator("body").innerText();
    record("6a. Tam eşleşen ilan görünüyor (onaylı 2 kapsamla tam örtüşüyor)", fullJobText.includes("ScopesUiTest — Tam Eşleşen İlan"), fullJobText.slice(0, 300));
    record("6b. '✓ Bu İlana Uygun' kartı görünüyor", fullJobText.includes("Bu İlana Uygun"));
    record("6c. Uygunluk kartında 'Boş Konteyner Depolama' VE 'Dolu Tehlikesiz Konteyner Depolama' etiketleri var", fullJobText.includes("Boş Konteyner Depolama") && fullJobText.includes("Dolu Tehlikesiz Konteyner Depolama"));
    record(
      "6d. Kullanıcıya YASAK ifadeler (admin onaylı/belge onaylı/belge numarası/belge dosyası/belge geçerlilik tarihi) HİÇ gösterilmiyor",
      !/admin onaylı|belge onaylı|belge numarası|belge dosyası|belge geçerlilik tarihi/i.test(fullJobText),
    );

    await providerPage.goto(`${APP_ORIGIN}/ilanlar/${jobPartialGapId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await providerPage.waitForTimeout(2000);
    const gapJobText = await providerPage.locator("body").innerText();
    record(
      "6e. Onaylanmayan (Dolu Tehlikeli) kapsam içeren ilan GÖRÜNMÜYOR ('İlan bulunamadı')",
      gapJobText.includes("İlan bulunamadı") && !gapJobText.includes("ScopesUiTest — Onaylanmayan Kapsam İçeren İlan"),
      gapJobText.slice(0, 300),
    );

    await providerContext2.close();
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
      runSql(`delete from public.provider_document_reviews where provider_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
      runSql(`delete from public.provider_services where provider_id in (${idList});`);
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
