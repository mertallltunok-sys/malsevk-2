// node scripts/browser-test-job-photos.mjs
//
// "Hizmet Talebi Oluştur" formundaki zorunlu operasyon fotoğrafı yükleme
// sistemi için gerçek tarayıcı testleri (TEST 1-10 + mobil TEST 10 + HEIC
// TEST 11/12 uçtan uca UI akışı). Ön koşul: `npm run dev`
// http://localhost:3000 üzerinde çalışıyor olmalı.
//
// "Son Açıkları Kapat" GÖREV 5 düzeltmesi: bu betik eskiden SABİT, artık
// Supabase Auth'ta var olmayan localStorage-seed hesapları (zeynep@test.com/
// mert@test.com) kullanıyordu (bkz. browser-test-regression.mjs'deki aynı
// kök neden notu). Artık KENDİ gerçek Supabase Auth hesaplarını (signUp +
// complete_registration) oluşturuyor. Ayrıca: job-store.ts#createJob artık
// HER yeni ilanı `moderationStatus: "pending_review"` ile yazıyor (bkz.
// CLAUDE.md "İlan Moderasyonu") — TEST 9 provider'ın ilanı görebilmesini
// beklediği için, o ilan admin tarafından onaylanmış GİBİ işaretlenmeli
// (doğrudan localStorage'a admin RPC'si taklit edilerek yazılır, gerçek bir
// admin oturumu gerekmez — bkz. aşağıdaki approveJobLocally).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";
const FIX = (name) => path.join(os.tmpdir(), name);
const PROGRESS_LOG = path.join(os.tmpdir(), "browser-test-job-photos-progress.log");
writeFileSync(PROGRESS_LOG, "");
let passed = 0;

if (!SUPABASE_URL || !/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`[browser-test-job-photos] FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(os.tmpdir(), "malsevk-phototest-"));
function runSql(query) {
  const file = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, query, "utf8");
  const out = execSync(`npx supabase db query --linked --file ${file} --output json`, { encoding: "utf8" });
  return JSON.parse(out).rows ?? [];
}

function ok(description) {
  passed++;
  const line = `  ✓ ${description}`;
  console.log(line);
  appendFileSync(PROGRESS_LOG, line + "\n");
}

async function createRealTestUser(label, role) {
  const email = `malsevk-phototest-${label}-${Date.now()}@gmail.com`;
  const cli = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    // `confirmed_at` artık bu Supabase projesinde GENERATED bir sütun
    // (email_confirmed_at/phone_confirmed_at'ten türetiliyor) — doğrudan
    // SET edilemiyor, GoTrue şema güncellemesiyle geldi. email_confirmed_at
    // tek başına yeterli, confirmed_at otomatik türer.
    runSql(`update auth.users set email_confirmed_at = now() where id = '${userId}';`);
    // Proje artık e-posta onayını ZORUNLU kılıyor (bkz. Production migration
    // 0089/mailer_autoconfirm) — signUp() bu yüzden bir oturum DÖNDÜRMEZ,
    // yukarıdaki zorla-onaylama da `cli`'ı oturum açmış hâle GETİRMEZ. Bir
    // sonraki `complete_registration` çağrısının `auth.uid()`e sahip olması
    // için gerçek bir giriş gerekir, yoksa RPC anonim (yetkisiz) çalışır.
    const { error: signInError } = await cli.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signInWithPassword(${label}) failed: ${signInError.message}`);
  }
  const { error: crError } = await cli.rpc("complete_registration", {
    p_role: role, p_full_name: `Foto Test ${label}`, p_phone: "+905551110099",
    p_company_name: `Foto Test Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Dilovası",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email, client: cli };
}

// GÖREV 1 kök neden düzeltmesi: `npx supabase storage rm` (CLI/anon yol)
// bu projede doğrulanmış şekilde işlevsiz (service_role'ün public şema
// REST erişimi olmadığı platform kısıtlamasıyla tutarlı, sessizce
// `{"deleted":[]}` döner). Ama Storage RLS (job_photos_bucket_delete_own_folder)
// SAHİBİNİN KENDİ oturumuna silme izni veriyor — bu yüzden hesap silinmeden
// ÖNCE, o hesabın KENDİ signUp() istemcisiyle (hâlâ oturumu açık) kendi
// klasörünü siliyoruz. Hesap zaten silinmişse (ör. daha önceki hatalı bir
// çalıştırmadan kalan yetim) bu artık mümkün değildir — GÖREV 2'nin
// karşılaştığı, kalıcı olarak engellenmiş 180 nesnelik durum tam olarak budur.
async function deleteOwnStorageFolder(client, userId) {
  const jobsBucketObjects = runSql(`select name from storage.objects where bucket_id = 'job-photos' and name like '${userId}/%';`);
  if (jobsBucketObjects.length > 0) {
    const { error } = await client.storage.from("job-photos").remove(jobsBucketObjects.map((o) => o.name));
    if (error) throw new Error(`job-photos Storage temizliği başarısız: ${error.message}`);
  }
  return jobsBucketObjects.length;
}

async function login(page, email, password) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`);
}

// job-store.ts#createJob her yeni ilanı moderationStatus: "pending_review" ile
// yazar (bkz. CLAUDE.md "İlan Moderasyonu") — TEST 9'un provider'ın ilanı
// görebilmesi için bu ilan onaylanmış olmalı. Gerçek bir admin oturumu/RPC
// akışı kurmak yerine, TAM OLARAK admin onayının bu tarayıcıda yapacağı yerel
// yamayı (job-store.ts#applyAdminModerationDecision'ın kendisi) doğrudan
// localStorage üzerinde uyguluyoruz — aynı `malsevk.jobs.v1` anahtarı,
// approved durumu.
async function approveJobLocally(page, jobId) {
  await page.evaluate((id) => {
    const raw = window.localStorage.getItem("malsevk.jobs.v1");
    if (!raw) return;
    const jobs = JSON.parse(raw);
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    job.moderationStatus = "approved";
    job.moderationReviewedAt = new Date().toISOString();
    window.localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  }, jobId);
}

// DÜZELTME (Y7, veritabanı geçişi öncesi denetim): bu yardımcı, MALSEVK'in
// sonradan yaptığı birkaç bağımsız değişiklikten dolayı eskimişti — "Depo
// Personeli" kategorisi kaldırılmış (bkz. service-catalog.ts#
// REMOVED_CATEGORY_IDS), "İş Tarihi" tek alanı "Başlangıç/Bitiş Tarihi"
// aralığına dönüşmüş, "İş Açıklaması" "Hizmete Özel Açıklama" olmuş,
// "Firma / Fabrika Adı" ve "Operasyon Detayları" alanları formdan tamamen
// kaldırılmış. "vinc-operatoru" kategorisi bilerek seçildi: Liman
// Hizmetleri/Nakliye/Depolama/Gümrük Müşavirliği'nin hiçbirine dahil değil,
// bu yüzden ne "Ürün Bilgileri" ne de sadeleştirilmiş konum/özel alan
// blokları tetiklenir — bu test dosyasının asıl konusu (fotoğraf yükleme)
// için en sade, ilgisiz kategori.
async function fillBaseFormFields(page, titleSuffix) {
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("vinc-operatoru");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-15");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-15");
  await page.getByLabel("İlan Başlığı").first().fill(`Foto Test İlanı ${titleSuffix}`);
  await page
    .getByLabel("Hizmete Özel Açıklama")
    .first()
    .fill("Bu test ilanı otomatik tarayıcı testinden oluşturulmuştur ve en az yirmi karakter içerir.");

  await page.getByRole("button", { name: "İl", exact: true }).first().click();
  await page.locator('ul[aria-label="İl"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İl"]').first().getByRole("option", { name: "Kocaeli", exact: true }).click();

  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();

  // 2026-07-25: "İşin Yapılacağı Yer Türü" ayrı adımı kaldırıldı, tek bir
  // "Liman / Sanayi / OSB" seçiciyle birleştirildi (bkz. job-location.ts).
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
  await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Liman / Sanayi / OSB"]')
    .first()
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();

  await page.getByLabel("Açık Adres").first().fill("Deneme Mahallesi, Test Sokak No:1, Dilovası/Kocaeli");
}

// DÜZELTME (Y7): "İlanı Yayınla" artık tek tıklamayla yayınlamıyor —
// Operasyon Önizlemesi (preview) modu araya girdi (bkz. CLAUDE.md "Çoklu
// Hizmet Operasyonu"): ilk tıklama yalnızca doğrular ve önizlemeye geçer,
// asıl yayınlama (createJob/createJobsForOperation) yalnızca önizlemenin
// KENDİ "İlanı Yayınla" butonuna (handlePublish) tıklanınca gerçekleşir.
async function publishJob(page) {
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
}

async function waitForPhotosReady(page, expectedCount) {
  // Kart sayısı hedefe ulaşmalı VE hiçbir kart hala "processing" (dönen spinner,
  // .animate-spin) durumunda olmamalı — aksi halde henüz sunucudan yanıt
  // gelmeden (önizleme/gönderim hazır olmadan) devam edip yanlış pozitif
  // sonuç alınabilir.
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === count &&
      document.querySelectorAll(".animate-spin").length === 0,
    expectedCount,
    { timeout: 20000 },
  );
}

async function main() {
  const storageCountBefore = runSql(
    `select count(*) as n from storage.objects where bucket_id = 'job-photos';`,
  )[0]?.n ?? 0;
  console.log(`Başlangıç Storage nesne sayısı (job-photos): ${storageCountBefore}`);

  const requester = await createRealTestUser("req", "hizmet-alan");
  const provider = await createRealTestUser("prov", "hizmet-veren");
  // job-detail-content.tsx bir ilanı doğrudan URL ile bile yalnızca
  // useIsJobVisibleToSession true dönerse gösterir (bkz. dosya başlığı) —
  // fillBaseFormFields "vinc-operatoru" kategorisini kullanıyor, provider bu
  // kategoriye açıkça yetkilendirilmeden TEST 9 ilan sayfasını hiç göremez.
  runSql(
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provider.id}', 'vinc-operatoru', now()) on conflict do nothing;`,
  );
  console.log(`requester=${requester.email} provider=${provider.email} (vinc-operatoru için yetkilendirildi)`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // Testlerden herhangi biri başarısız olup fırlatırsa bile (assert.*,
  // .waitFor timeout vb.) tarayıcının kapanmasını garanti eder — aksi
  // halde açık kalan bir Chromium bağlantısı Node sürecinin asla
  // çıkmamasına (sonsuza kadar "takılı" görünmesine) yol açar; hata zaten
  // aşağıdaki main().catch()'te raporlanır, yalnızca süreç düzgün sona ermezdi.
  try {
    await runTests();
  } finally {
    await browser.close();
    console.log("--- Test hesapları temizleniyor ---");
    try {
      // Bu test formu gerçek UI'dan yayınladığı için oluşturulan ilanlar
      // job-request-form.tsx üzerinden best-effort Supabase'e de senkronlanmış
      // olabilir (bkz. CLAUDE.md "Faz 2") — requester hesabı silinmeden önce
      // FK-safe sırayla temizlenir (bkz. job_activity_events/jobs_requester_id_fkey).
      const deletedStorageCount = await deleteOwnStorageFolder(requester.client, requester.id);
      console.log(`Storage temizliği: ${deletedStorageCount} nesne (requester kendi oturumuyla) silindi.`);
      const jobRows = runSql(`select id from public.jobs where requester_id = '${requester.id}';`);
      for (const { id: jobId } of jobRows) {
        runSql(`delete from public.job_activity_events where job_id = '${jobId}';`);
        runSql(`delete from public.notifications where job_id = '${jobId}';`);
        runSql(`delete from public.offers where job_id = '${jobId}';`);
        runSql(`delete from public.job_photos where job_id = '${jobId}';`);
        runSql(`delete from public.jobs where id = '${jobId}';`);
      }
      runSql(`delete from public.provider_service_authorizations where provider_id = '${provider.id}';`);
    } catch (e) {
      console.error(`  (uyarı) senkronlanmış ilanlar/yetkiler temizlenemedi: ${e.message}`);
    }
    for (const id of [requester.id, provider.id]) {
      try {
        runSql(`delete from auth.users where id = '${id}';`);
      } catch (e) {
        console.error(`  (uyarı) ${id} temizlenemedi: ${e.message}`);
      }
    }
    const remaining = runSql(`select count(*) as n from auth.users where email ilike 'malsevk-phototest-%@gmail.com';`)[0]?.n ?? 0;
    console.log(`Temizlik sonrası kalan test hesabı: ${remaining}`);
    const storageCountAfter = runSql(
      `select count(*) as n from storage.objects where bucket_id = 'job-photos';`,
    )[0]?.n ?? 0;
    console.log(`Bitiş Storage nesne sayısı (job-photos): ${storageCountAfter} (başlangıç: ${storageCountBefore})`);
    if (storageCountAfter > storageCountBefore) {
      console.error(`  UYARI: bu çalıştırma ${storageCountAfter - storageCountBefore} yetim Storage nesnesi bırakmış olabilir.`);
    }
  }

  console.log(`\n[browser-test-job-photos] ${passed}/${passed} test geçti.`);

  async function runTests() {
  console.log("[browser-test-job-photos] Hizmet Alan olarak giriş yapılıyor...");
  await login(page, requester.email, PASSWORD);
  ok(`Giriş başarılı (${requester.email} / hizmet-alan, gerçek Supabase Auth hesabı)`);

  // TEST 1: Fotoğraf yüklemeden formu göndermeye çalış
  await fillBaseFormFields(page, "1");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await assert.doesNotReject(
    page.getByText("Devam edebilmek için en az 1 fotoğraf yüklemelisiniz.").waitFor({
      state: "visible",
      timeout: 5000,
    }),
  );
  assert.equal(page.url(), `${BASE_URL}/hizmet-talebi-olustur`);
  ok("TEST 1: Fotoğrafsız gönderim reddedildi, Türkçe hata gösterildi, form gönderilmedi");

  // TEST 2: Tek geçerli fotoğrafla ilan oluştur
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg")]);
  await waitForPhotosReady(page, 1);
  await assert.doesNotReject(page.getByText("1 / 15 fotoğraf yüklendi").waitFor({ state: "visible" }));
  await publishJob(page);
  const firstJobUrl = page.url();
  const firstJobId = firstJobUrl.split("/ilanlar/")[1];
  await assert.doesNotReject(page.locator("img[alt*=' - fotoğraf ']").waitFor({ state: "visible", timeout: 10000 }));
  // TEST 9 (aşağıda) provider'ın bu ilanı görebilmesini bekliyor — yeni
  // ilanlar artık pending_review ile başlıyor (bkz. dosya başlığı notu),
  // bu yüzden admin onayı burada yerel olarak taklit edilir.
  await approveJobLocally(page, firstJobId);
  ok("TEST 2: 1 geçerli fotoğrafla ilan başarıyla oluşturuldu, detay sayfasında kapak fotoğrafı görünüyor");

  // TEST 3: Birden fazla fotoğraf, sıralama değiştir, birini sil
  await login(page, requester.email, PASSWORD);
  await fillBaseFormFields(page, "3");
  await page.setInputFiles('input[type="file"]', [
    FIX("fixture-valid-1.jpg"),
    FIX("fixture-valid-2.jpg"),
    FIX("fixture-valid-3.jpg"),
  ]);
  await waitForPhotosReady(page, 3);

  async function currentOrder() {
    return page.locator("[data-photo-filename]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-photo-filename")),
    );
  }

  assert.deepEqual(await currentOrder(), [
    "fixture-valid-1.jpg",
    "fixture-valid-2.jpg",
    "fixture-valid-3.jpg",
  ]);

  // valid-1 kartını (o an kapak) bir kez aşağı taşı -> sıra: valid-2, valid-1, valid-3
  await page
    .locator('[data-photo-filename="fixture-valid-1.jpg"]')
    .getByRole("button", { name: "Sırada geri al" })
    .click();
  await assert.doesNotReject(
    (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const order = await currentOrder();
        if (order[1] === "fixture-valid-1.jpg") return;
        await page.waitForTimeout(100);
      }
      throw new Error("Sıralama değişikliği yansımadı");
    })(),
  );
  assert.deepEqual(await currentOrder(), [
    "fixture-valid-2.jpg",
    "fixture-valid-1.jpg",
    "fixture-valid-3.jpg",
  ]);

  // valid-3 kartını sil -> kalan sıra: valid-2, valid-1
  await page
    .locator('[data-photo-filename="fixture-valid-3.jpg"]')
    .getByRole("button", { name: /fotoğrafını sil/ })
    .click();
  await waitForPhotosReady(page, 2);
  assert.deepEqual(await currentOrder(), ["fixture-valid-2.jpg", "fixture-valid-1.jpg"]);

  await publishJob(page);
  // IndexedDB'den blob okuma + object URL oluşturma asenkrondur; <img>
  // etiketi DOM'a yalnızca çözüldükten sonra eklenir — önce kapak
  // görselinin göründüğünü bekle, sonra küçük resmi say.
  await page.locator("img[alt*=' - fotoğraf ']").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("img[alt*='fotoğraf 2']").waitFor({ state: "visible", timeout: 10000 });
  const thumbnailCount = await page.locator("img[alt*='fotoğraf 2']").count();
  assert.equal(thumbnailCount, 1, "Beklenen tam olarak 2 fotoğraf (1 kapak + 1 küçük resim) kalmalı");
  ok("TEST 3: Çoklu fotoğraf yüklendi, sıralandı (valid-2, valid-1), valid-3 silindi; son sıra doğru kaydedildi");

  // TEST 4: 15'ten fazla fotoğraf yüklemeye çalış
  await login(page, requester.email, PASSWORD);
  await fillBaseFormFields(page, "4");
  const sixteenDistinctFiles = Array.from({ length: 16 }, (_, i) => FIX(`fixture-valid-${i + 1}.jpg`));
  await page.setInputFiles('input[type="file"]', sixteenDistinctFiles);
  await waitForPhotosReady(page, 15);
  await assert.doesNotReject(page.getByText(/En fazla 15 fotoğraf/).waitFor({ state: "visible", timeout: 5000 }));
  const cardCountAfter16 = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.ok(cardCountAfter16 <= 15, `15'ten fazla kart eklendi: ${cardCountAfter16}`);
  ok(`TEST 4: 16 dosya seçilince en fazla ${cardCountAfter16} kabul edildi (≤15), Türkçe uyarı gösterildi`);

  // TEST 5: 10MB üzeri dosya
  await login(page, requester.email, PASSWORD);
  await fillBaseFormFields(page, "5");
  await page.setInputFiles('input[type="file"]', [FIX("fixture-oversized.jpg")]);
  await assert.doesNotReject(
    page.getByText("Fotoğraf boyutu 10 MB'ı geçemez.").waitFor({ state: "visible", timeout: 5000 }),
  );
  const cardCountAfterOversized = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(cardCountAfterOversized, 0, "10MB üzeri dosya kart olarak eklenmemeli");
  ok("TEST 5: 10MB üzeri dosya reddedildi, Türkçe hata gösterildi, kart eklenmedi");

  // TEST 6: Sahte/gerçek olmayan dosya (uzantı .jpg ama içerik düz metin) + gerçek PDF
  await page.setInputFiles('input[type="file"]', [FIX("fixture-fake.jpg")]);
  await assert.doesNotReject(
    page.getByText(/Desteklenmeyen dosya biçimi/).waitFor({ state: "visible", timeout: 5000 }),
  );
  const cardCountAfterFake = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(cardCountAfterFake, 0, "Sahte dosya kart olarak eklenmemeli");
  ok("TEST 6: Gerçek içeriği resim olmayan sahte dosya (.jpg uzantılı düz metin) reddedildi");

  // TEST 11/12 (UI akışı): Gerçek HEIC dosyası yükle, işlensin, önizlensin.
  // NOT: `%TEMP%\sample-test.heic` bu repoda hiçbir betik tarafından
  // üretilmiyor (generate-photo-test-fixtures.mjs de dahil) — gerçek bir HEIC
  // konteynerini sıfırdan sentezlemek pratik değil, bu yüzden bu tek dosya
  // önceden bir insan tarafından o yola elle kopyalanmış olmalı. Yoksa bu
  // alt testi sahte veriyle "geçmiş" GÖSTERMEK yerine açıkça ATLA.
  const heicFixturePath = FIX("sample-test.heic");
  let heicFixtureExists = true;
  try {
    await (await import("node:fs/promises")).stat(heicFixturePath);
  } catch {
    heicFixtureExists = false;
  }
  if (!heicFixtureExists) {
    console.log(`  ⚠ TEST 11/12 ATLANDI: ${heicFixturePath} bulunamadı (bu ortamda önceden yerleştirilmiş gerçek bir HEIC örneği yok, repo'daki hiçbir betik bunu üretmiyor)`);
  } else {
  await page.setInputFiles('input[type="file"]', [FIX("sample-test.heic")]);
  await waitForPhotosReady(page, 1);
  const heicPreviewImg = page.locator("img").first();
  await assert.doesNotReject(heicPreviewImg.waitFor({ state: "visible", timeout: 15000 }));
  const naturalWidth = await heicPreviewImg.evaluate((img) => img.naturalWidth);
  assert.ok(naturalWidth > 0, "HEIC önizlemesi gerçek bir görüntü olarak yüklenemedi");
  await publishJob(page);
  const detailCoverImg = page.locator("img[alt*=' - fotoğraf ']");
  await assert.doesNotReject(detailCoverImg.waitFor({ state: "visible", timeout: 10000 }));
  const detailNaturalWidth = await detailCoverImg.evaluate((img) => img.naturalWidth);
  assert.ok(detailNaturalWidth > 0, "İlan detayında HEIC'ten dönüştürülen fotoğraf açılmadı");
  ok("TEST 11/12: Gerçek HEIC fotoğraf yüklendi, önizlendi, ilan detayında doğru şekilde açıldı");
  }

  // TEST 9: Hizmet Veren hesabıyla ilan detayını aç, fotoğrafları gör, düzenleme kontrolü olmasın
  // NOT: localStorage temizlenmez — bu, zeynep'in daha önce oluşturduğu ilan
  // kayıtlarını (malsevk.jobs.v1) da silerdi. Giriş yapmak zaten oturum
  // anahtarının üzerine yazar, başka bir temizliğe gerek yoktur.
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill(provider.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(BASE_URL + "/");
  await page.goto(firstJobUrl);
  await assert.doesNotReject(page.locator("img[alt*=' - fotoğraf ']").waitFor({ state: "visible", timeout: 10000 }));
  const deleteButtonsVisibleToProvider = await page.locator('[aria-label$="fotoğrafını sil"]').count();
  assert.equal(deleteButtonsVisibleToProvider, 0, "Hizmet Veren'e silme kontrolü gösterilmemeli");
  ok("TEST 9: Hizmet Veren, ilan detayında fotoğrafları görüyor; düzenleme/silme kontrolü yok");

  // TEST 7 (UI seviyesi): Hizmet Veren, ilan oluşturma formunu (ve fotoğraf yükleme alanını) hiç göremez
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await assert.doesNotReject(
    page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({ state: "visible" }),
  );
  const fileInputCountForProvider = await page.locator('input[type="file"]').count();
  assert.equal(fileInputCountForProvider, 0, "Hizmet Veren'e fotoğraf yükleme alanı hiç gösterilmemeli");
  ok("TEST 7 (UI): Hizmet Veren, fotoğraf yükleme alanını içeren formu hiç göremiyor");

  // TEST 10: Mobil responsive (2 sütun önizleme + yükleme akışı)
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, requester.email, PASSWORD);
  await fillBaseFormFields(page, "mobil");
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg"), FIX("fixture-valid-2.jpg")]);
  await waitForPhotosReady(page, 2);
  const gridColumnCount = await page.evaluate(() => {
    const grid = document.querySelector('[aria-label$="fotoğrafını sil"]')?.closest(".grid");
    if (!grid) return null;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });
  assert.equal(gridColumnCount, 2, `Mobilde önizleme kartları 2 sütun olmalı, ölçülen: ${gridColumnCount}`);
  await page.getByRole("button", { name: /fotoğrafını sil/ }).first().click();
  await waitForPhotosReady(page, 1);
  ok("TEST 10: Mobil görünümde (390px) önizleme kartları 2 sütun; yükleme/silme çalışıyor");

  if (consoleErrors.length > 0) {
    console.log("\n[browser-test-job-photos] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[browser-test-job-photos] Konsolda hiç JS hatası yakalanmadı.");
  }
  }
}

main().catch((error) => {
  console.error("[browser-test-job-photos] HATA:", error);
  process.exitCode = 1;
});
