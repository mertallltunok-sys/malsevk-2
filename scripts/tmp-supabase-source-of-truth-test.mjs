// node scripts/tmp-supabase-source-of-truth-test.mjs
// "İlanları ve Firma Profillerini Supabase'e Tam Bağla, MERSİS Tekilliğini
// Uygula" görevinin gerçek kanıtı — GÖREV 1 (ilan oluşturma/düzenleme artık
// Supabase-bloklayan), GÖREV 2 (firma profili artık Supabase-bloklayan),
// GÖREV 3 (MERSİS tekilliği). YENİ ADMİN HESABI OLUŞTURULMADI. Yalnızca
// Development.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-sot-"));
function runSql(sql, { retries = 3 } = {}) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { encoding: "utf8" });
      return JSON.parse(output).rows ?? [];
    } catch (error) {
      if (attempt >= retries) throw error;
    }
  }
}
async function pollSql(sql, isReady, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = runSql(sql)[0];
    if (isReady(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function clientAs(email) {
  const client = freshClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signInWithPassword(${email}) failed: ${error.message}`);
  return client;
}

const stamp = Date.now();
async function createUser(label, role, { skipComplete = false } = {}) {
  const email = `malsevk-sot-${label}-${stamp}@gmail.com`;
  const client = freshClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  if (!skipComplete) {
    const { error: crError } = await client.rpc("complete_registration", {
      p_role: role, p_full_name: `SOT ${label}`, p_phone: "+905551110055",
      p_company_name: `SOT Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  }
  return { id: userId, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    try {
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginAs(${email}) failed after retry`);
      await page.waitForTimeout(500);
    }
  }
}

async function selectSearchable(page, label, index, optionName) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact: true }).first().click();
}

// Düz/yakın renkli test görüntüleri JPEG kuantalamasından sonra AYNI byte
// içeriğine sıkışabiliyor (küçük RGB farkları kaybolur) — bu da
// photo-validation.ts'in gerçek SHA-256 içerik-yinelenme korumasını
// (kasıtlı bir anti-fraud özelliği) yanlışlıkla tetikliyordu. Her görüntü
// için gerçek rastgele piksel gürültüsü üretmek, sıkıştırma sonrası bile
// pratikte benzersiz byte içeriği garanti eder.
function randomNoiseBuffer(width, height, channels, seed) {
  const buf = Buffer.alloc(width * height * channels);
  let state = (seed + 1) * 2654435761;
  for (let i = 0; i < buf.length; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = state % 256;
  }
  return buf;
}
async function makeTestJpeg(seed) {
  const width = 320;
  const height = 320;
  const channels = 3;
  return sharp(randomNoiseBuffer(width, height, channels, seed), { raw: { width, height, channels } }).jpeg().toBuffer();
}

async function fillJobFormBase(page, categoryValue, titleSuffix, seed) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 20000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption(categoryValue);
  await page.waitForTimeout(500);
  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);
  await page.getByLabel("İlan Başlığı").first().fill(`SOT testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu Supabase gercek kaynak testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.");
  await selectSearchable(page, "İlçe", 0, "Gebze");
  const facilityButtons = page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true });
  if ((await facilityButtons.count()) > 0) {
    await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Listede yok, kendim gireceğim");
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill(`Test Tesisi ${titleSuffix}`);
  }
  await page.getByLabel("Açık Adres").first().fill("Test acik adres, Gebze / Kocaeli.");
  const fileInput = page.locator('input[type="file"]');
  // Nakliye ve Depolama kategorileri artık 4-15 fotoğraf gerektiriyor
  // (photo-validation.ts#requiresWiderPhotoRange, "Nakliye Yeniden Tasarımı").
  // Her kategori için 4 fotoğraf yüklemek genel 1-10 aralığını da karşılar.
  const files = [];
  for (let i = 0; i < 4; i += 1) {
    files.push({ name: `test-${seed}-${i}.jpg`, mimeType: "image/jpeg", buffer: await makeTestJpeg(seed * 10 + i) });
  }
  await fileInput.setInputFiles(files);
  await page.waitForFunction(
    () => { const b = document.querySelector('button[type="submit"]'); return b && !b.disabled; },
    { timeout: 15000 },
  );
}

// Form iki AŞAMALIDIR (mode "form" -> "preview" -> gerçek yayınlama, bkz.
// job-request-form.tsx#handleSubmit/handlePublish, ikisi de AYNI "İlanı
// Yayınla" metnini taşır). Bu fonksiyon İLK kez çağrıldığında form modundan
// başlar (iki tıklama gerekir: doğrula+önizlemeye geç, sonra gerçek
// yayınla) — ama bir ÖNCEKİ çağrı zaten önizleme modunda bir hatayla
// SONUÇLANMIŞSA (ör. askıya alma testi), sayfa HÂLÂ önizleme modundadır ve
// tek bir tıklama yeterlidir. Sabit "her zaman 2 tıklama" varsayımı, ikinci
// tıklamanın zaten-navigasyon-yapılmış/koptu bir düğmeye denk gelmesine
// (Playwright "element was detached from the DOM" hatası) yol açıyordu —
// bunun yerine her tıklamadan SONRA gerçekten navigasyon ya da hata oluştu
// mu diye kontrol edilip, öyleyse döngü hemen durduruluyor.
async function publishAndCapture(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const button = page.getByRole("button", { name: "İlanı Yayınla" });
    if ((await button.count()) === 0) break;
    await button.click().catch(() => {});
    await page.waitForTimeout(900);
    if (/\/ilanlar\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) break;
    // Yalnızca GERÇEK, metin taşıyan bir hata durdurma sebebidir — boş/DOM'da
    // her zaman var olan bir role="alert" konteynerinin kendisi (form doğrulama
    // ilk tıklamada başarılıysa hiç dolmaz) yanlış pozitif "hata oluştu"
    // durdurmasına yol açıyordu (A/G testlerinin ikinci -gerçek yayınlama-
    // tıklamasını hiç yapmadan erken çıkması).
    const alertText = await page.locator('[role="alert"]').first().innerText().catch(() => "");
    if (alertText.trim().length > 0) break;
  }
  try {
    // Gerçek yayınlama tıklaması 4 gerçek fotoğrafı Storage'a yükleyip ardından
    // gerçek bir RPC çağrısı yapar — ağ gecikmesi değişken olabilir, bu yüzden
    // bu son bekleme cömert tutulur (navigasyon olur olmaz zaten erken döner).
    await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 45000 });
    const match = page.url().match(/\/ilanlar\/([0-9a-f-]{36})/);
    return { navigated: true, jobId: match ? match[1] : null, errorText: null };
  } catch {
    const errorEl = page.locator('[role="alert"]').first();
    const errorText = (await errorEl.count()) > 0 ? await errorEl.innerText().catch(() => null) : null;
    return { navigated: false, jobId: null, errorText };
  }
}

async function approveJobAsAdmin(jobId) {
  runSql(`update public.jobs set moderation_status = 'approved', moderation_reviewed_at = now() where id = '${jobId}';`);
  const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
  return row?.moderation_status === "approved";
}

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Kullanicilar olusturuluyor ---");
    const reqA = await createUser("reqA", "hizmet-alan");
    const provPlain = await createUser("provPlain", "hizmet-veren");
    console.log(`reqA=${reqA.email} provPlain=${provPlain.email}`);
    // A/B/C/D/G/H/I gibi GENEL mekanizma testleri (Supabase-bloklayan oluşturma,
    // sahte-başarı yok, çift-tıklama, çapraz cihaz görünürlüğü) kategoriden
    // BAĞIMSIZDIR — "forklift" (İş Makinesi Hizmetleri) kasıtlı olarak seçildi
    // çünkü tek başına hiçbir kategoriye-özel zorunlu alt-form taşımıyor
    // (Nakliye'nin rota+Yük Grubu kartları, Depolama/Liman'ın ürün bilgisi,
    // Gümrük/Geri Dönüşüm'ün kendi alanları YOK) — bu yüzden generic
    // fillJobFormBase'in doldurduğu temel alanlar tek başına yeterli.
    // Nakliye/Depolama'ya ÖZGÜ alanların Supabase'e gerçekten ulaştığı ayrıca,
    // AŞAĞIDA (J bloğu), gerçek create_job RPC'sine doğrudan, kimliği
    // doğrulanmış bir istemciyle yazılıp DB'den okunarak kanıtlanıyor.
    runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provPlain.id}', 'forklift', now()) on conflict do nothing;`);

    // ================================================================
    // GÖREV 1 — A/B/C/D: gerçek ilan oluşturma, Supabase RPC, admin moderasyon, çapraz cihaz
    // ================================================================
    const ctxCreate = await browser.newContext();
    const pageCreate = await ctxCreate.newPage();
    await loginAs(pageCreate, reqA.email);
    await fillJobFormBase(pageCreate, "forklift", "J1-PLAIN", 1);
    const publishResult1 = await publishAndCapture(pageCreate);
    record("A) Hizmet Alan farklı bir tarayıcıda ilan oluşturur (gerçek form)", publishResult1.navigated, JSON.stringify(publishResult1));
    await ctxCreate.close();

    const jobId1 = publishResult1.jobId;
    const remoteJob1 = jobId1 ? runSql(`select id, moderation_status, category_id from public.jobs where id = '${jobId1}';`)[0] : null;
    record("B) Supabase kaydı SQL ile doğrulanır (jobs tablosunda gerçekten var)", Boolean(remoteJob1), JSON.stringify(remoteJob1));
    record("C) Admin moderasyon kaydı oluşur (moderation_status = pending_review)", remoteJob1?.moderation_status === "pending_review", JSON.stringify(remoteJob1));

    if (jobId1) {
      await approveJobAsAdmin(jobId1);
      const ctxProvPlain = await browser.newContext();
      const pageProvPlain = await ctxProvPlain.newPage();
      await loginAs(pageProvPlain, provPlain.email);
      await pageProvPlain.goto(`${APP_ORIGIN}/ilanlar/${jobId1}`);
      let seenOnOtherDevice = false;
      try {
        await pageProvPlain.locator("textarea").first().waitFor({ state: "visible", timeout: 15000 });
        seenOnOtherDevice = true;
      } catch {
        seenOnOtherDevice = false;
      }
      record("D) İlan onaylandıktan sonra yetkili Hizmet Veren başka cihazda görür (gerçek teklif formu render edildi)", seenOnOtherDevice, `seen=${seenOnOtherDevice}`);
      await ctxProvPlain.close();
    }

    // ================================================================
    // GÖREV 1 — J: Nakliye + Depolama'ya özgü alanların GERÇEKTEN Supabase'e
    // ulaştığının RPC/DB seviyesinde kanıtı. supabase-job-sync.ts'in kendisi
    // zaten kod okumasıyla doğrulandı (her kategoriye özel alan create_job
    // RPC çağrısına ekleniyor) — burada AYNI RPC'yi gerçek, kimliği
    // doğrulanmış bir istemciyle DOĞRUDAN çağırıp DB'de gerçekten
    // karşılığını doğruluyoruz. Nakliye'nin çok katmanlı "Yük Grubu"
    // kartlarını Playwright ile birebir sürmek (rota + her grubun kendi
    // ürün/ölçü/ADR alt-formu) orantısız bir mühendislik yükü olurdu; RPC'yi
    // doğrudan çağırmak UI-otomasyon kırılganlığı olmadan AYNI gerçek
    // RPC/RLS/DB katmanından geçer.
    // ================================================================
    const reqAClient = await clientAs(reqA.email);

    async function uploadTestPhotosToStorage(client, userId, jobId, count) {
      const rpcPhotos = [];
      for (let i = 0; i < count; i += 1) {
        const buffer = await makeTestJpeg(9000 + i);
        const storagePath = `${userId}/${jobId}/${i}.jpg`;
        const { error } = await client.storage.from("job-photos").upload(storagePath, buffer, { contentType: "image/jpeg" });
        if (error) throw new Error(`Storage upload failed (${storagePath}): ${error.message}`);
        rpcPhotos.push({ storage_path: storagePath, original_file_name: `test-${i}.jpg`, mime_type: "image/jpeg", size_bytes: buffer.length, width: null, height: null });
      }
      return rpcPhotos;
    }

    const workDateJ = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const nakliyeJobId = randomUUID();
    const nakliyePhotos = await uploadTestPhotosToStorage(reqAClient, reqA.id, nakliyeJobId, 4);
    const { error: nakliyeRpcError } = await reqAClient.rpc("create_job", {
      p_category_id: "nakliye",
      p_title: "SOT testi J-NAKLIYE RPC",
      p_description: "Nakliye kategoriye özel alanların Supabase'e ulaştığını doğrudan RPC ile doğrulayan test ilanıdır.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Yükleme Tesisi",
      p_work_date: workDateJ,
      p_photos: nakliyePhotos,
      p_facility_id: null,
      p_location_mode: "custom",
      p_address_text: "Test yukleme acik adres, Gebze / Kocaeli.",
      p_neighborhood: null,
      p_location_url: null,
      p_directions_note: null,
      p_work_end_date: null,
      p_product_quantity: null,
      p_product_tonnage: null,
      p_product_type: null,
      p_customs_product_type: null,
      p_customs_transaction_type: null,
      p_customs_requested_services: null,
      p_client_id: nakliyeJobId,
      p_delivery_province: "İstanbul",
      p_delivery_district: "Tuzla",
      p_delivery_location_type: "open_address",
      p_delivery_facility_id: null,
      p_delivery_facility_name: "Test Teslimat Tesisi",
      p_delivery_address_text: "Test teslimat acik adres, Tuzla / Istanbul.",
      p_recycling_material_category_id: null,
      p_recycling_material_subtype_id: null,
      p_recycling_quantity: null,
      p_recycling_unit: null,
      p_recycling_material_condition: null,
      p_recycling_material_condition_note: null,
      p_recycling_scope_of_work: null,
      p_storage_product_type: null,
      p_storage_product_quantity: null,
      p_storage_product_unit: null,
      p_storage_product_tonnage: null,
      p_storage_container_groups: null,
      p_product_tonnage_unit: null,
      p_nakliye_load_preparation_type: null,
      p_nakliye_load_preparation_custom_text: null,
      p_nakliye_loading_method: "forklift",
      p_nakliye_loading_method_custom_text: null,
      p_nakliye_measurement_info: null,
      p_nakliye_hazmat: null,
      p_nakliye_container_transport: null,
      p_nakliye_cargo_groups: [
        {
          id: "cg-1",
          productQuantity: 10,
          productTonnage: 5,
          productType: "Genel Kargo",
          productTonnageUnit: "ton",
          loadPreparationType: "dokme",
          measurementInfo: { dimensionsUnknown: true },
          containerTransport: { status: "hayir" },
          hazmat: { status: "hayir" },
        },
      ],
      p_storage_hazardous: null,
      p_storage_risk_groups: null,
      p_recycling_requested_operation: null,
      p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: null,
      p_recycling_hazard_properties: null,
    });
    record("J-1) Nakliye create_job RPC'si başarıyla yazılır (rota/yük grubu alanları dahil)", !nakliyeRpcError, nakliyeRpcError?.message);
    const nakliyeRow = runSql(
      `select category_id, delivery_province, delivery_district, delivery_facility_name, delivery_address_text, nakliye_loading_method, nakliye_cargo_groups from public.jobs where id = '${nakliyeJobId}';`,
    )[0];
    record(
      "J-2) Nakliye rota (teslimat) + Yük Grubu alanları Supabase'de doğru şekilde okunur",
      nakliyeRow?.category_id === "nakliye" &&
        nakliyeRow?.delivery_province === "İstanbul" &&
        nakliyeRow?.delivery_district === "Tuzla" &&
        nakliyeRow?.delivery_facility_name === "Test Teslimat Tesisi" &&
        nakliyeRow?.nakliye_loading_method === "forklift" &&
        Array.isArray(nakliyeRow?.nakliye_cargo_groups) &&
        nakliyeRow.nakliye_cargo_groups[0]?.productType === "Genel Kargo",
      JSON.stringify(nakliyeRow),
    );

    const depoJobId = randomUUID();
    const depoPhotos = await uploadTestPhotosToStorage(reqAClient, reqA.id, depoJobId, 4);
    const { error: depoRpcError } = await reqAClient.rpc("create_job", {
      p_category_id: "kapali-depolama",
      p_title: "SOT testi J-DEPOLAMA RPC",
      p_description: "Depolama kategoriye özel alanların Supabase'e ulaştığını doğrudan RPC ile doğrulayan test ilanıdır.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "",
      p_work_date: workDateJ,
      p_photos: depoPhotos,
      p_facility_id: null,
      p_location_mode: "catalog",
      p_address_text: "",
      p_neighborhood: null,
      p_location_url: null,
      p_directions_note: null,
      p_work_end_date: null,
      p_product_quantity: null,
      p_product_tonnage: null,
      p_product_type: null,
      p_customs_product_type: null,
      p_customs_transaction_type: null,
      p_customs_requested_services: null,
      p_client_id: depoJobId,
      p_delivery_province: null,
      p_delivery_district: null,
      p_delivery_location_type: null,
      p_delivery_facility_id: null,
      p_delivery_facility_name: null,
      p_delivery_address_text: null,
      p_recycling_material_category_id: null,
      p_recycling_material_subtype_id: null,
      p_recycling_quantity: null,
      p_recycling_unit: null,
      p_recycling_material_condition: null,
      p_recycling_material_condition_note: null,
      p_recycling_scope_of_work: null,
      p_storage_product_type: "Genel Ürün",
      p_storage_product_quantity: 10,
      p_storage_product_unit: "adet",
      p_storage_product_tonnage: 5,
      p_storage_container_groups: null,
      p_product_tonnage_unit: null,
      p_nakliye_load_preparation_type: null,
      p_nakliye_load_preparation_custom_text: null,
      p_nakliye_loading_method: null,
      p_nakliye_loading_method_custom_text: null,
      p_nakliye_measurement_info: null,
      p_nakliye_hazmat: null,
      p_nakliye_container_transport: null,
      p_nakliye_cargo_groups: null,
      p_storage_hazardous: false,
      p_storage_risk_groups: null,
      p_recycling_requested_operation: null,
      p_recycling_waste_code: null,
      p_recycling_waste_code_unknown: null,
      p_recycling_hazard_properties: null,
    });
    record("J-3) Depolama create_job RPC'si başarıyla yazılır (ürün bilgisi alanları dahil)", !depoRpcError, depoRpcError?.message);
    const depoRow = runSql(
      `select category_id, storage_product_type, storage_product_quantity, storage_product_unit, storage_hazardous from public.jobs where id = '${depoJobId}';`,
    )[0];
    record(
      "J-4) Depolama ürün bilgisi alanları Supabase'de doğru şekilde okunur",
      depoRow?.category_id === "kapali-depolama" &&
        depoRow?.storage_product_type === "Genel Ürün" &&
        Number(depoRow?.storage_product_quantity) === 10 &&
        depoRow?.storage_product_unit === "adet" &&
        depoRow?.storage_hazardous === false,
      JSON.stringify(depoRow),
    );

    // ================================================================
    // GÖREV 1 — E/F: İlan düzenleme
    // ================================================================
    if (jobId1) {
      // Onaylanmış bir ilan düzenlemenin pending_review'a düşürdüğü BİLİNEN/belgelenmiş
      // davranış (update_job_as_requester yalnızca pending_review'ı kabul eder) — bu
      // yüzden düzenleme testini YENİ, henüz onaylanmamış bir ilan üzerinde yapıyoruz.
      const ctxJob2 = await browser.newContext();
      const pageJob2 = await ctxJob2.newPage();
      await loginAs(pageJob2, reqA.email);
      await fillJobFormBase(pageJob2, "forklift", "J2-EDIT", 2);
      const publishResult2 = await publishAndCapture(pageJob2);
      await ctxJob2.close();
      record("0) İkinci (düzenleme testi) ilan oluşturuldu", publishResult2.navigated, JSON.stringify(publishResult2));

      if (publishResult2.jobId) {
        const jobId2 = publishResult2.jobId;
        const ctxEdit = await browser.newContext();
        const pageEdit = await ctxEdit.newPage();
        await loginAs(pageEdit, reqA.email);
        await pageEdit.goto(`${APP_ORIGIN}/panel/hizmet-taleplerim/${jobId2}/duzenle`);
        const titleInput = pageEdit.getByLabel("İlan Başlığı").first();
        await titleInput.waitFor({ state: "visible", timeout: 15000 });
        await titleInput.fill("");
        await titleInput.fill("SOT testi J2-EDIT DUZENLENDI");
        await pageEdit.getByRole("button", { name: /Kaydet|Güncelle/ }).first().click();
        const editedRow = await pollSql(`select title from public.jobs where id = '${jobId2}';`, (r) => r?.title === "SOT testi J2-EDIT DUZENLENDI");
        const editErrorEl = pageEdit.locator('[role="alert"]').first();
        const editErrorText = (await editErrorEl.count().catch(() => 0)) > 0 ? await editErrorEl.innerText().catch(() => null) : null;
        record(
          "E) İlan düzenlenince alan Supabase'de güncellenir",
          editedRow?.title === "SOT testi J2-EDIT DUZENLENDI",
          `${JSON.stringify(editedRow)} pageError=${editErrorText} pageUrl=${pageEdit.url()}`,
        );
        await ctxEdit.close();

        const ctxCheckEdit = await browser.newContext();
        const pageCheckEdit = await ctxCheckEdit.newPage();
        await loginAs(pageCheckEdit, reqA.email);
        await pageCheckEdit.goto(`${APP_ORIGIN}/ilanlar/${jobId2}`);
        let sawEditedTitle = false;
        try {
          await pageCheckEdit.getByText("SOT testi J2-EDIT DUZENLENDI").first().waitFor({ state: "visible", timeout: 15000 });
          sawEditedTitle = true;
        } catch {
          sawEditedTitle = false;
        }
        record("F) Başka cihazdaki (temiz) ekran güncel ilanı görür", sawEditedTitle, `seen=${sawEditedTitle}`);
        await ctxCheckEdit.close();
      }
    }

    // ================================================================
    // GÖREV 1 — G/H: Supabase yazımı kontrollü başarısız kılındığında sahte başarı YOK, form verisi kaybolmaz
    // ================================================================
    // ÖNEMLİ: hesap giriş yapılmadan ÖNCE askıya alınırsa login-form.tsx
    // kendisi (satır ~240) girişi TAMAMEN reddedip oturumu kapatıyor ve
    // /giris-yap'ta kalıyor — bu, RPC/Supabase-yazım hatasını hiç test etmeden
    // (login-form.tsx'in kendi, ayrı, istemci-taraflı account_status kapısını
    // test eder). Gerçek "Supabase yazımı kontrollü başarısız kılınır" testi
    // için: önce AKTİFKEN giriş yap ve formu doldur (geçerli oturum/JWT
    // tarayıcıda kalır), SONRA hesabı askıya al, SONRA yayınla — bu, RPC
    // katmanının (assert_active_user(), migration 0042) create_job içinde
    // gerçekten devreye girdiğini kanıtlar.
    const failUser = await createUser("failUser", "hizmet-alan");
    const ctxFail = await browser.newContext();
    const pageFail = await ctxFail.newPage();
    await loginAs(pageFail, failUser.email);
    await fillJobFormBase(pageFail, "forklift", "J3-FAIL", 3);
    runSql(`update public.profiles set account_status = 'suspended' where id = '${failUser.id}';`);
    const failResult = await publishAndCapture(pageFail);
    record(
      "G) Supabase yazımı kontrollü başarısız kılındığında (askıya alınmış hesap) sahte başarı mesajı verilmiyor",
      !failResult.navigated && Boolean(failResult.errorText),
      JSON.stringify(failResult),
    );
    const orphanCheck = runSql(`select count(*) as n from public.jobs where requester_id = '${failUser.id}';`)[0];
    record("G-2) Başarısız denemede yerelde/sunucuda sahte yayımlanmış ilan oluşmadı", orphanCheck?.n === 0, JSON.stringify(orphanCheck));
    // Form verisi kaybolmadı mı (H)? handleSubmit doğrulamayı geçince form
    // ÖNİZLEME moduna geçer (bkz. publishAndCapture'ın kendi dokümanı) — bu
    // yüzden başarısız yayınlama denemesinden SONRA artık düzenlenebilir bir
    // <input> değil, önizlemenin salt-okunur özet kartı görünür durumdadır
    // (service.title, job-request-form.tsx'in kendi <h3> öğesi). Kullanıcının
    // girdiği veri hâlâ EKRANDA duruyor olması (kaybolmamış olması) budur —
    // "← Düzenlemeye Dön" ile forma geri dönüp yeniden deneyebilir.
    const titleVisibleInPreview = await pageFail.getByText("SOT testi J3-FAIL", { exact: false }).first().isVisible().catch(() => false);
    record("H) Form verileri kaybolmadı (önizlemede başlık hâlâ görünüyor)", titleVisibleInPreview, `visible=${titleVisibleInPreview}`);

    // Hesabı aktif hale getirip AYNI formdan yeniden dene — şimdi başarmalı.
    runSql(`update public.profiles set account_status = 'active' where id = '${failUser.id}';`);
    const retryResult = await publishAndCapture(pageFail);
    record("H-2) Kullanıcı aynı formdan yeniden deneyebiliyor ve şimdi başarıyor", retryResult.navigated, JSON.stringify(retryResult));
    await ctxFail.close();

    // ================================================================
    // GÖREV 1 — I: çift tıklama mükerrer ilan oluşturmuyor
    // ================================================================
    const dblUser = await createUser("dblUser", "hizmet-alan");
    const ctxDbl = await browser.newContext();
    const pageDbl = await ctxDbl.newPage();
    await loginAs(pageDbl, dblUser.email);
    await fillJobFormBase(pageDbl, "forklift", "J4-DOUBLE", 4);
    // Form iki AŞAMALIDIR (bkz. publishAndCapture'ın kendi dokümanı) — gerçek
    // mutasyon (create_job RPC'si) yalnızca ÖNİZLEME aşamasındaki tıklamada
    // olur. Gerçekçi bir "sabırsız çift tıklama"yı simüle etmek için: ÖNCE
    // TEK bir tıklamayla form->önizleme geçişi yapılır (bu, saf istemci-taraflı
    // doğrulamadır, hiçbir mutasyon tetiklemez, bu yüzden ne kadar çok
    // tıklanırsa tıklansın zaten yinelenemez) ve önizlemenin render olması
    // beklenir; SONRA gerçek yayınlama düğmesine, submitLockRef'in senkron
    // kilidini gerçekten sınayacak şekilde NEREDEYSE EŞZAMANLI iki tıklama
    // (Promise.all) gönderilir.
    await pageDbl.getByRole("button", { name: "İlanı Yayınla" }).click();
    await pageDbl.getByText("Operasyon Özeti", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    const publishBtn = pageDbl.getByRole("button", { name: "İlanı Yayınla" });
    await Promise.all([publishBtn.click().catch(() => {}), publishBtn.click().catch(() => {})]);
    await pageDbl.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
    await ctxDbl.close();
    const dblCount = runSql(`select count(*) as n from public.jobs where requester_id = '${dblUser.id}';`)[0];
    record("I) Çift/mükerrer tıklama mükerrer ilan oluşturmuyor (tam olarak 1 ilan var)", dblCount?.n === 1, JSON.stringify(dblCount));

    console.log("");
    console.log(`=== GÖREV 1 ARA SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // GÖREV 2 — Firma Profili
    // ================================================================
    const provProfile = await createUser("provProfile", "hizmet-veren");
    const ctxProfile = await browser.newContext();
    const pageProfile = await ctxProfile.newPage();
    await loginAs(pageProfile, provProfile.email);
    await pageProfile.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    const bioField = pageProfile.getByLabel("Kısa Firma Tanıtımı");
    await bioField.waitFor({ state: "visible", timeout: 15000 });
    await bioField.fill("Bu firma SOT testi icin yazilmis, en az elli karakter uzunlugunda bir tanitim metnidir gercekten.");
    await pageProfile.getByLabel("Kuruluş Yılı").fill("2015");
    await pageProfile.getByRole("button", { name: "Kaydet", exact: false }).first().click();
    const profileSaved = await pollSql(
      `select bio, founded_year from public.provider_profiles where user_id = '${provProfile.id}';`,
      (r) => r?.founded_year === 2015,
    );
    record("GÖREV2-1) Aktif hizmet veren profilini günceller, veritabanı kaydı doğrulanır", profileSaved?.founded_year === 2015, JSON.stringify(profileSaved));
    await ctxProfile.close();

    const ctxProfileCheck = await browser.newContext();
    const pageProfileCheck = await ctxProfileCheck.newPage();
    await loginAs(pageProfileCheck, provProfile.email);
    await pageProfileCheck.goto(`${APP_ORIGIN}/panel/hesap-ayarlari`);
    let bioVisibleOnOtherDevice = false;
    try {
      await pageProfileCheck.getByText("Bu firma SOT testi icin", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
      bioVisibleOnOtherDevice = true;
    } catch {
      bioVisibleOnOtherDevice = false;
    }
    record("GÖREV2-2) Temiz ikinci tarayıcıda aynı profil görünür", bioVisibleOnOtherDevice, `seen=${bioVisibleOnOtherDevice}`);
    await ctxProfileCheck.close();

    // Askıya alınmış kullanıcı profilini değiştiremiyor (GERÇEK PostgREST/RPC denemesi).
    runSql(`update public.profiles set account_status = 'suspended' where id = '${provProfile.id}';`);
    const suspendedProfileClient = await clientAs(provProfile.email);
    const { error: suspendedProfileError } = await suspendedProfileClient.rpc("upsert_provider_profile", {
      p_bio: "Askida hesap tarafindan degistirilmeye calisilan bio metni.",
      p_founded_year: 1999, p_experience_range: null, p_regions: null, p_service_features: null,
    });
    const profileAfterSuspendedAttempt = runSql(`select founded_year from public.provider_profiles where user_id = '${provProfile.id}';`)[0];
    record(
      "GÖREV2-3) Askıya alınmış kullanıcı firma profilini değiştiremiyor",
      Boolean(suspendedProfileError) && profileAfterSuspendedAttempt?.founded_year === 2015,
      `error=${suspendedProfileError?.message}, founded_year_degismedi=${profileAfterSuspendedAttempt?.founded_year === 2015}`,
    );
    runSql(`update public.profiles set account_status = 'active' where id = '${provProfile.id}';`);

    // Başka kullanıcı başkasının firma profilini değiştiremiyor.
    const otherProv = await createUser("otherProv", "hizmet-veren");
    const otherProvClient = await clientAs(otherProv.email);
    const { error: crossUserProfileError } = await otherProvClient.rpc("upsert_provider_profile", {
      p_bio: "Baskasinin profilini degistirmeye calisan yetkisiz istek.",
      p_founded_year: 2000, p_experience_range: null, p_regions: null, p_service_features: null,
    });
    // Not: upsert_provider_profile HER ZAMAN auth.uid()'in KENDİ satırını yazar (RPC
    // parametre olarak hedef user_id ALMAZ) — bu yüzden bu çağrı aslında otherProv'un
    // KENDİ profilini oluşturur, provProfile'ınkini DEĞİL. Gerçek izolasyon kanıtı:
    // provProfile'ın satırı bu çağrıdan etkilenmiyor.
    void crossUserProfileError;
    const provProfileUnaffected = runSql(`select founded_year from public.provider_profiles where user_id = '${provProfile.id}';`)[0];
    record(
      "GÖREV2-4) Başka kullanıcının RPC çağrısı hedef kullanıcının profilini etkilemiyor (auth.uid()-scoped)",
      provProfileUnaffected?.founded_year === 2015,
      JSON.stringify(provProfileUnaffected),
    );

    console.log("");
    console.log(`=== GÖREV 2 ARA SONUÇ (kümülatif): ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);

    // ================================================================
    // GÖREV 3 — MERSİS
    // ================================================================
    const mersisA = await createUser("mersisA", "hizmet-veren", { skipComplete: true });
    const mersisAClient = await clientAs(mersisA.email);
    const MERSIS_VALUE = `9${stamp}`.slice(0, 16).padEnd(16, "1");
    const { error: mersisAError } = await mersisAClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "MERSİS Test A", p_phone: "+905551110044",
      p_company_name: "MERSİS Test Firma A", p_company_type: "limited-sirket",
      p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: MERSIS_VALUE,
    });
    record("GÖREV3-1) Geçerli MERSİS ile işletme kaydı oluşturulur", !mersisAError, mersisAError?.message);

    const mersisB = await createUser("mersisB", "hizmet-veren", { skipComplete: true });
    const mersisBClient = await clientAs(mersisB.email);
    const { error: mersisBError } = await mersisBClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "MERSİS Test B", p_phone: "+905551110033",
      p_company_name: "MERSİS Test Firma B", p_company_type: "limited-sirket",
      p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: MERSIS_VALUE,
    });
    record("GÖREV3-2) Aynı MERSİS numarasıyla ikinci işletme oluşturulamaz", /ML175/.test(mersisBError?.message ?? ""), mersisBError?.message);

    const mersisC = await createUser("mersisC", "hizmet-veren", { skipComplete: true });
    const mersisCClient = await clientAs(mersisC.email);
    const spacedVariant = `${MERSIS_VALUE.slice(0, 4)} ${MERSIS_VALUE.slice(4, 8)}-${MERSIS_VALUE.slice(8, 12)} ${MERSIS_VALUE.slice(12)}`;
    const { error: mersisCError } = await mersisCClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "MERSİS Test C", p_phone: "+905551110022",
      p_company_name: "MERSİS Test Firma C", p_company_type: "anonim-sirket",
      p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: spacedVariant,
    });
    record(
      "GÖREV3-3) Aynı numaranın boşluk/tire ile yazılmış varyasyonu da reddedilir",
      /ML175/.test(mersisCError?.message ?? ""),
      `input=${spacedVariant}, error=${mersisCError?.message}`,
    );

    const mersisD = await createUser("mersisD", "hizmet-veren", { skipComplete: true });
    const mersisDClient = await clientAs(mersisD.email);
    const DIFFERENT_MERSIS = `8${stamp}`.slice(0, 16).padEnd(16, "2");
    const { error: mersisDError } = await mersisDClient.rpc("complete_registration", {
      p_role: "hizmet-veren", p_full_name: "MERSİS Test D", p_phone: "+905551110011",
      p_company_name: "MERSİS Test Firma D", p_company_type: "sahis-isletmesi",
      p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: DIFFERENT_MERSIS,
    });
    record("GÖREV3-4) Farklı MERSİS numarası kabul edilir", !mersisDError, mersisDError?.message);

    // Eşzamanlı mükerrer kayıt girişimi.
    const mersisE1 = await createUser("mersisE1", "hizmet-veren", { skipComplete: true });
    const mersisE2 = await createUser("mersisE2", "hizmet-veren", { skipComplete: true });
    const mersisE1Client = await clientAs(mersisE1.email);
    const mersisE2Client = await clientAs(mersisE2.email);
    const CONCURRENT_MERSIS = `7${stamp}`.slice(0, 16).padEnd(16, "3");
    const [concResult1, concResult2] = await Promise.all([
      mersisE1Client.rpc("complete_registration", {
        p_role: "hizmet-veren", p_full_name: "MERSİS Test E1", p_phone: "+905551110001",
        p_company_name: "MERSİS Test Firma E1", p_company_type: "limited-sirket",
        p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: CONCURRENT_MERSIS,
      }),
      mersisE2Client.rpc("complete_registration", {
        p_role: "hizmet-veren", p_full_name: "MERSİS Test E2", p_phone: "+905551110002",
        p_company_name: "MERSİS Test Firma E2", p_company_type: "limited-sirket",
        p_province: "Kocaeli", p_district: "Gebze", p_mersis_no: CONCURRENT_MERSIS,
      }),
    ]);
    const concSuccesses = [concResult1, concResult2].filter((r) => !r.error).length;
    record(
      "GÖREV3-5) Eşzamanlı mükerrer kayıt girişiminde yalnızca BİRİ başarılı olur",
      concSuccesses === 1,
      `basarili_sayisi=${concSuccesses}, e1_error=${concResult1.error?.message}, e2_error=${concResult2.error?.message}`,
    );

    // Bireysel akış bozulmadı.
    const bireysel = await createUser("bireysel", "hizmet-alan", { skipComplete: true });
    const bireyselClient = await clientAs(bireysel.email);
    const { error: bireyselError } = await bireyselClient.rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "Bireysel Test", p_phone: "+905551110000",
      p_company_name: "Bireysel", p_company_type: "bireysel",
      p_province: "Kocaeli", p_district: "Gebze",
      // p_mersis_no hiç gönderilmiyor — bireysel akışın MERSİS olmadan da çalıştığını doğrular.
    });
    record("GÖREV3-6) Bireysel operatör akışı (MERSİS olmadan) bozulmadı", !bireyselError, bireyselError?.message);

    // Doğrudan tablo yazımıyla tekillik aşılamıyor.
    const directWriteClient = await clientAs(mersisD.email);
    const { error: directWriteError } = await directWriteClient.from("profiles").update({ mersis_no: DIFFERENT_MERSIS }).eq("id", mersisD.id);
    record(
      "GÖREV3-7) Doğrudan tablo yazımıyla mersis_no değiştirilemez (yalnızca RPC yolu var)",
      /permission denied/i.test(directWriteError?.message ?? ""),
      directWriteError?.message,
    );

    console.log("");
    console.log(`=== TOPLAM SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
    if (results.some((r) => !r.pass)) {
      console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
