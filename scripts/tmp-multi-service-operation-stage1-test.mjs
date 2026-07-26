// node scripts/tmp-multi-service-operation-stage1-test.mjs
//
// Çoklu Hizmet Operasyonu — Aşama 1 (veri katmanı: createOperationId,
// getJobsByOperationId, getSiblingJobs, createJobsForOperation) doğrulama
// testi. Aşama 2.2'de createJobsForOperation'ın imzası tekrar değişti:
// başlık/açıklama/konum artık ORTAK değil, HER hizmetin kendi services[]
// girdisinde (bkz. job-store.ts#OperationServiceInput) — yalnızca
// province/operationDetails/photos gerçekten ortak kaldı. Bu betik o yeni
// imzaya güncellenmiştir; altındaki davranışsal garantiler (bağımsız
// ilanlar, aynı operationId, atomik geri alma, kardeş ilan bağımsızlığı
// vb.) AYNEN korunduğu için doğrulamalar hâlâ geçerlidir (imza değişikliği
// görevin kendisi tarafından açıkça istendiği için testler o yeni imzaya
// uyarlanmıştır, davranış garantileri bozulmamıştır).
//
// job-store.ts, plain Node ile doğrudan import EDİLEMEZ: (1) yerel modülleri
// uzantısız çağırır (Next.js'in bundler çözümlemesi buna izin verir, düz Node
// ESM vermez — bkz. test-photo-feature.mjs'teki aynı not) ve (2) gerçek
// `localStorage`/`indexedDB` gerektirir (photo-blob-store.ts). Bu yüzden bu
// test, job-store.ts'i (ve yerel bağımlılık grafiğini) DEĞİŞTİRMEDEN, yalnızca
// uzantısız import'ları çözmek için esbuild ile tek dosyalık bir ESM paketine
// derler (esbuild, projede zaten node_modules'ta transitif olarak mevcuttur;
// package.json'da doğrudan bir devDependency DEĞİLDİR — bu betiği uzun vadeli
// bir regresyon testi olarak tutmak isteyen biri, kırılganlığı azaltmak için
// bunu açık bir devDependency yapmayı düşünebilir), ardından bu paketi
// `npm run dev` çalışan gerçek bir Chromium sayfasına (Playwright) enjekte
// eder — böylece üretim kodu HİÇ değiştirilmeden, gerçek localStorage/
// indexedDB/crypto ile çalıştırılmış olur.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function bundleJobStore() {
  const result = await build({
    stdin: {
      contents: `
        import * as jobStore from "./app/_lib/job-store.ts";
        window.__jobStoreTest = jobStore;
      `,
      resolveDir: PROJECT_ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
  });
  return result.outputFiles[0].text;
}

function makeSession(role = "hizmet-alan") {
  return { id: "tmp-stage1-requester", name: "Test Requester", role };
}

/** Tek hizmetli (createJob) çağrılar için tüm alanlar — bu fonksiyon HİÇ değişmedi (Aşama 2.2 öncesiyle aynı), createJob zaten her zaman per-job'du. */
function makeSingleJobFields(overrides = {}) {
  return {
    title: "Aşama 1 doğrulama ilanı",
    description: "Bu, yalnızca Çoklu Hizmet Operasyonu Aşama 1'ini doğrulamak için oluşturulmuş geçici bir test kaydıdır.",
    province: "Kocaeli",
    district: "Gebze",
    workLocationType: "Test Tesisi",
    addressText: "Test adres metni, en az on karakter.",
    locationMode: "custom",
    workDate: "2026-09-01",
    workEndDate: "2026-09-02",
    operationDetails: "Test operasyon detayı.",
    ...overrides,
  };
}

/** createJobsForOperation çağrıları için GERÇEKTEN ortak alanlar (Aşama 2.2) — yalnızca province/operationDetails/photos. */
function makeSharedOperationFields(overrides = {}) {
  return {
    province: "Kocaeli",
    operationDetails: "Test operasyon detayı.",
    ...overrides,
  };
}

/** Tek bir OperationServiceInput girdisi — category/workDate/workEndDate zorunlu, geri kalanı makul varsayılanlarla doldurulur. */
function makeOperationServiceEntry(overrides = {}) {
  return {
    title: "Aşama 1 doğrulama ilanı",
    description: "Bu, yalnızca Çoklu Hizmet Operasyonu Aşama 1'ini doğrulamak için oluşturulmuş geçici bir test kaydıdır.",
    district: "Gebze",
    workLocationType: "Test Tesisi",
    addressText: "Test adres metni, en az on karakter.",
    locationMode: "custom",
    ...overrides,
  };
}

async function makePhotos(page, count = 1) {
  return page.evaluate((n) => {
    return Array.from({ length: n }, (_, i) => {
      const blob = new Blob([`test-photo-content-${i}`], { type: "image/jpeg" });
      return { blob, fileName: `test-${i}.jpg`, fileSize: blob.size, mimeType: "image/jpeg" };
    });
  }, count);
}

async function main() {
  console.log("[tmp-multi-service-operation-stage1-test] job-store.ts esbuild ile deriliyor...");
  const bundleCode = await bundleJobStore();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(BASE_URL);
  await page.addScriptTag({ content: bundleCode, type: "module" });
  await page.waitForFunction(() => Boolean(window.__jobStoreTest), { timeout: 10000 });
  console.log("[tmp-multi-service-operation-stage1-test] job-store.ts gerçek tarayıcıda yüklendi.\n");

  // Baseline temizliği: bu test kendinden önceki ilanları saymamalı.
  const baselineCount = await page.evaluate(() => window.__jobStoreTest.getAllUserCreatedJobs().length);

  // --- Test 1 & 5 & 6: iki farklı hizmet -> iki bağımsız ilan, kendi başlık/açıklama/konum/tarihleri ---
  const photosForTwo = await makePhotos(page, 1);
  const twoServiceResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      const result = await window.__jobStoreTest.createJobsForOperation(session, {
        ...sharedFields,
        services,
        photos,
      });
      return result;
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [
        makeOperationServiceEntry({
          category: "lashing",
          title: "Lashing hizmeti ilanı",
          description: "Lashing hizmetine özel açıklama, en az yirmi karakter.",
          district: "Gebze",
          workDate: "2026-09-01",
          workEndDate: "2026-09-02",
        }),
        makeOperationServiceEntry({
          category: "unlashing",
          title: "Unlashing hizmeti ilanı",
          description: "Unlashing hizmetine özel açıklama, en az yirmi karakter.",
          district: "Dilovası",
          workDate: "2026-09-05",
          workEndDate: "2026-09-05",
        }),
      ],
      photos: photosForTwo,
    },
  );
  assert.equal(twoServiceResult.ok, true, `İki hizmetli operasyon başarısız oldu: ${JSON.stringify(twoServiceResult)}`);
  assert.equal(twoServiceResult.jobs.length, 2);
  ok("İki farklı hizmet verildiğinde iki bağımsız ilan oluşur (Test 1)");

  assert.equal(twoServiceResult.jobs[0].category, "lashing");
  assert.equal(twoServiceResult.jobs[1].category, "unlashing");
  ok("Her ilan yalnızca kendi hizmet id'sini taşır (Test 5)");

  assert.equal(twoServiceResult.jobs[0].workDate, "2026-09-01");
  assert.equal(twoServiceResult.jobs[0].workEndDate, "2026-09-02");
  assert.equal(twoServiceResult.jobs[1].workDate, "2026-09-05");
  assert.equal(twoServiceResult.jobs[1].workEndDate, "2026-09-05");
  assert.notEqual(twoServiceResult.jobs[0].workDate, twoServiceResult.jobs[1].workDate);
  ok("Her ilan kendi hizmet kartının tarihlerini taşır; kardeş ilanların tarihleri birbirinden bağımsız/farklı olabilir");

  assert.equal(twoServiceResult.jobs[0].title, "Lashing hizmeti ilanı");
  assert.equal(twoServiceResult.jobs[1].title, "Unlashing hizmeti ilanı");
  assert.notEqual(twoServiceResult.jobs[0].description, twoServiceResult.jobs[1].description);
  assert.equal(twoServiceResult.jobs[0].district, "Gebze");
  assert.equal(twoServiceResult.jobs[1].district, "Dilovası");
  ok("Aşama 2.2: her ilan kendi başlığını, açıklamasını ve konumunu (İlçe dahil) taşır");

  for (const job of twoServiceResult.jobs) {
    assert.equal(job.province, "Kocaeli");
    assert.equal(job.operationDetails, "Test operasyon detayı.");
    assert.equal(job.requesterId, "tmp-stage1-requester");
  }
  ok("Gerçekten ortak alanlar (İl/Operasyon Detayları/requesterId) her ilana doğru kopyalanır (Test 6)");

  assert.notEqual(twoServiceResult.jobs[0].photos, twoServiceResult.jobs[1].photos);
  assert.notEqual(twoServiceResult.jobs[0].photos[0].storageKey, twoServiceResult.jobs[1].photos[0].storageKey);
  ok("Kardeş ilanlar arasında fotoğraf dizisi/storageKey mutable referans PAYLAŞMIYOR");

  // --- Test 2: üç farklı hizmet -> üç bağımsız ilan ---
  const photosForThree = await makePhotos(page, 1);
  const threeServices = [
    makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-01", workEndDate: "2026-08-15" }),
    makeOperationServiceEntry({ category: "unlashing", workDate: "2026-08-03", workEndDate: "2026-08-04" }),
    makeOperationServiceEntry({ category: "konteyner-dolum", workDate: "2026-08-03", workEndDate: "2026-08-03" }),
  ];
  const threeServiceResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      const result = await window.__jobStoreTest.createJobsForOperation(session, {
        ...sharedFields,
        services,
        photos,
      });
      return result;
    },
    { session: makeSession(), sharedFields: makeSharedOperationFields(), services: threeServices, photos: photosForThree },
  );
  assert.equal(threeServiceResult.ok, true, `Üç hizmetli operasyon başarısız oldu: ${JSON.stringify(threeServiceResult)}`);
  assert.equal(threeServiceResult.jobs.length, 3);
  ok("Üç farklı hizmet verildiğinde üç bağımsız ilan oluşur (Test 2)");

  // --- Test 3: operationId değerleri aynı ---
  const opIds = new Set(threeServiceResult.jobs.map((job) => job.operationId));
  assert.equal(opIds.size, 1);
  assert.equal([...opIds][0], threeServiceResult.operationId);
  ok("Oluşan ilanların operationId değerleri aynıdır (Test 3)");

  // --- Test 4: id değerleri farklı ---
  const ids = new Set(threeServiceResult.jobs.map((job) => job.id));
  assert.equal(ids.size, 3);
  ok("Oluşan ilanların id değerleri birbirinden farklıdır (Test 4)");

  // --- Test 7: yinelenen hizmet id'si ikinci bir ilan oluşturmaz / açık hata verir ---
  const duplicateResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      return window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services, photos });
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [
        makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-01", workEndDate: "2026-08-01" }),
        makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-02", workEndDate: "2026-08-02" }),
      ],
      photos: await makePhotos(page, 1),
    },
  );
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.error && duplicateResult.error.length > 0);
  ok("Yinelenen hizmet id'si açık bir doğrulama hatasıyla reddedilir, ikinci ilan oluşturulmaz (Test 7)");

  // --- Test 8: boş hizmet listesi hiçbir ilan oluşturmaz ---
  const emptyResult = await page.evaluate(
    async ({ session, sharedFields, photos }) => {
      return window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services: [], photos });
    },
    { session: makeSession(), sharedFields: makeSharedOperationFields(), photos: await makePhotos(page, 1) },
  );
  assert.equal(emptyResult.ok, false);
  ok("Boş hizmet listesi hiçbir ilan oluşturmadan reddedilir (Test 8)");

  // --- Test 9: tek hizmet verildiğinde operasyon grubu oluşturulmaz ---
  const singleResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      return window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services, photos });
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-01", workEndDate: "2026-08-01" })],
      photos: await makePhotos(page, 1),
    },
  );
  assert.equal(singleResult.ok, false);
  ok("Tek hizmet, createJobsForOperation'a verildiğinde AÇIKÇA reddedilir — operasyon grubu oluşturulmaz (Test 9; karar: örtük yönlendirme yerine açık ret — bkz. rapor)");

  // Ek: geçersiz hizmet id'si merkezi kataloğa göre reddedilir.
  const invalidCategoryResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      return window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services, photos });
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [
        makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-01", workEndDate: "2026-08-01" }),
        makeOperationServiceEntry({ category: "bu-katalogda-olmayan-hizmet", workDate: "2026-08-01", workEndDate: "2026-08-01" }),
      ],
      photos: await makePhotos(page, 1),
    },
  );
  assert.equal(invalidCategoryResult.ok, false);
  ok("Merkezi katalogda (service-catalog.ts) bulunmayan bir hizmet id'si reddedilir (ek kontrol)");

  // Ek: bir hizmetin bitiş tarihi kendi başlangıcından önceyse reddedilir (veri katmanı, forma ek savunma).
  const badDateRangeResult = await page.evaluate(
    async ({ session, sharedFields, services, photos }) => {
      return window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services, photos });
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [
        makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-10", workEndDate: "2026-08-01" }),
        makeOperationServiceEntry({ category: "unlashing", workDate: "2026-08-01", workEndDate: "2026-08-01" }),
      ],
      photos: await makePhotos(page, 1),
    },
  );
  assert.equal(badDateRangeResult.ok, false);
  ok("Bir hizmetin bitiş tarihi kendi başlangıcından önceyse veri katmanında reddedilir (ek kontrol)");

  // --- Test 10: hata durumunda yarım operasyon kaydı kalmaz (fotoğraf kaydı 3. serviste başarısız olacak şekilde simüle edilir) ---
  const partialFailureResult = await page.evaluate(
    async ({ session, sharedFields, services }) => {
      const before = window.__jobStoreTest.getAllUserCreatedJobs().length;

      let openCallCount = 0;
      const realOpen = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = (...args) => {
        openCallCount++;
        if (openCallCount === 3) {
          throw new Error("Simüle edilmiş IndexedDB hatası (3. servis)");
        }
        return realOpen(...args);
      };

      const photos = [
        (() => {
          const blob = new Blob(["partial-failure-photo"], { type: "image/jpeg" });
          return { blob, fileName: "partial.jpg", fileSize: blob.size, mimeType: "image/jpeg" };
        })(),
      ];

      let result;
      try {
        result = await window.__jobStoreTest.createJobsForOperation(session, { ...sharedFields, services, photos });
      } finally {
        window.indexedDB.open = realOpen;
      }

      const after = window.__jobStoreTest.getAllUserCreatedJobs().length;
      return { result, before, after };
    },
    {
      session: makeSession(),
      sharedFields: makeSharedOperationFields(),
      services: [
        makeOperationServiceEntry({ category: "lashing", workDate: "2026-08-01", workEndDate: "2026-08-01" }),
        makeOperationServiceEntry({ category: "unlashing", workDate: "2026-08-02", workEndDate: "2026-08-02" }),
        makeOperationServiceEntry({ category: "konteyner-bosaltim", workDate: "2026-08-03", workEndDate: "2026-08-03" }),
      ],
    },
  );
  assert.equal(partialFailureResult.result.ok, false);
  assert.equal(
    partialFailureResult.after,
    partialFailureResult.before,
    "3. serviste simüle edilen hata sonrası ilan sayısı DEĞİŞMEMELİ (yarım operasyon kaydı kalmamalı)",
  );
  ok("3. hizmetin fotoğraf kaydı simüle edilmiş şekilde başarısız olunca, önceki 2 servisin blob'ları geri alınır ve HİÇBİR ilan kaydedilmez (Test 10)");

  // --- Test 11: getJobsByOperationId yalnızca ilgili ilanları döndürür ---
  const byOperationId = await page.evaluate(
    (operationId) => window.__jobStoreTest.getJobsByOperationId(operationId),
    threeServiceResult.operationId,
  );
  assert.equal(byOperationId.length, 3);
  assert.deepEqual(
    new Set(byOperationId.map((job) => job.id)),
    new Set(threeServiceResult.jobs.map((job) => job.id)),
  );
  const byUnrelatedId = await page.evaluate(
    (operationId) => window.__jobStoreTest.getJobsByOperationId(operationId),
    "no-such-operation-id",
  );
  assert.equal(byUnrelatedId.length, 0);
  const byEmptyId = await page.evaluate(() => window.__jobStoreTest.getJobsByOperationId(""));
  assert.equal(byEmptyId.length, 0);
  ok("getJobsByOperationId yalnızca ilgili ilanları döndürür; ilgisiz/boş operationId için boş dizi döner (Test 11)");

  // --- Test 12: operationId olmayan eski ilanlar sorgu/listelemeyi bozmaz ---
  const legacyCheck = await page.evaluate(() => {
    const STORAGE_KEY = "malsevk.jobs.v1";
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const legacyJob = {
      id: crypto.randomUUID(),
      title: "Eski (operationId'siz) ilan",
      category: "lashing",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "Eski Tesis",
      workDate: "2026-08-01",
      description: "Eski ilan açıklaması, operationId alanı hiç yok.",
      operationDetails: "Eski operasyon detayı.",
      status: "yayinda",
      requesterId: null,
      photos: [],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, legacyJob]));

    const all = window.__jobStoreTest.getAllUserCreatedJobs();
    const found = all.find((job) => job.id === legacyJob.id);
    const siblings = window.__jobStoreTest.getSiblingJobs(legacyJob.id);
    const byRandomOperationId = window.__jobStoreTest.getJobsByOperationId("herhangi-bir-operationid");

    return {
      foundAndNormalized: Boolean(found) && found.operationId === undefined && found.workEndDate === undefined,
      siblingsIsEmpty: Array.isArray(siblings) && siblings.length === 0,
      legacyNeverMatchesRandomOperationId: !byRandomOperationId.some((job) => job.id === legacyJob.id),
      legacyJobId: legacyJob.id,
    };
  });
  assert.equal(
    legacyCheck.foundAndNormalized,
    true,
    "operationId/workEndDate'siz eski ilan normalize edilip listelenebilmeli, ikisi de undefined kalmalı",
  );
  assert.equal(legacyCheck.siblingsIsEmpty, true, "operationId'si olmayan bir ilanın getSiblingJobs'u boş dizi dönmeli");
  assert.equal(legacyCheck.legacyNeverMatchesRandomOperationId, true);
  assert.equal(consoleErrors.length, 0, `Konsolda hata olmamalı: ${consoleErrors.join(" | ")}`);
  ok("operationId/workEndDate alanı olmayan eski ilanlar sorgu/listelemeyi bozmadan çalışmaya devam eder (Test 12)");

  // --- Test 13: mevcut tek createJob akışı değişmeden çalışır ---
  const singleCreateJobResult = await page.evaluate(
    async ({ session, fields, photos }) => {
      return window.__jobStoreTest.createJob(session, {
        ...fields,
        category: "lashing",
        photos,
      });
    },
    { session: makeSession(), fields: makeSingleJobFields(), photos: await makePhotos(page, 1) },
  );
  assert.equal(singleCreateJobResult.ok, true, `Tekil createJob başarısız oldu: ${JSON.stringify(singleCreateJobResult)}`);
  assert.equal(singleCreateJobResult.job.operationId, undefined);
  assert.equal(singleCreateJobResult.job.workDate, "2026-09-01");
  assert.equal(singleCreateJobResult.job.workEndDate, "2026-09-02");
  ok("Mevcut tek createJob akışı değişmeden çalışır; operationId yoktur, workEndDate alanı doğru yazılır (Test 13)");

  // --- Test 14: kardeş ilanlardan biri güncellendiğinde diğerleri kendiliğinden değişmez ---
  const updateSiblingCheck = await page.evaluate(
    async ({ operationId, updatedTitle }) => {
      const jobs = window.__jobStoreTest.getJobsByOperationId(operationId);
      const [target, untouched] = jobs;
      const session = { id: target.requesterId, name: "Test Requester", role: "hizmet-alan" };
      const updateResult = await window.__jobStoreTest.updateJob(
        session,
        target.id,
        {
          title: updatedTitle,
          category: target.category,
          province: target.province,
          district: target.district,
          workLocationType: target.workLocationType,
          facilityId: target.facilityId,
          addressText: target.addressText,
          locationMode: target.locationMode,
          neighborhood: target.neighborhood,
          locationUrl: target.locationUrl,
          directionsNote: target.directionsNote,
          workDate: target.workDate,
          description: target.description,
          operationDetails: target.operationDetails,
          keptPhotoIds: target.photos.map((p) => p.id),
          newPhotos: [],
        },
        [],
      );
      const untouchedAfter = window.__jobStoreTest.getAllUserCreatedJobs().find((job) => job.id === untouched.id);
      return {
        updateResult,
        untouchedTitleAfter: untouchedAfter.title,
        untouchedOriginalTitle: untouched.title,
        untouchedWorkDateAfter: untouchedAfter.workDate,
        untouchedOriginalWorkDate: untouched.workDate,
      };
    },
    { operationId: twoServiceResult.operationId, updatedTitle: "Güncellenmiş kardeş ilan başlığı" },
  );
  assert.equal(updateSiblingCheck.updateResult.ok, true, `Kardeş ilan güncellemesi başarısız oldu: ${JSON.stringify(updateSiblingCheck.updateResult)}`);
  assert.equal(updateSiblingCheck.updateResult.job.title, "Güncellenmiş kardeş ilan başlığı");
  assert.equal(updateSiblingCheck.untouchedTitleAfter, updateSiblingCheck.untouchedOriginalTitle);
  assert.equal(updateSiblingCheck.untouchedWorkDateAfter, updateSiblingCheck.untouchedOriginalWorkDate);
  ok("Bir kardeş ilan güncellendiğinde, aynı operasyondaki diğer ilan (başlık VE tarihi dahil) kendiliğinden DEĞİŞMEZ (Test 14)");

  // --- Temizlik: bu testte oluşturulan tüm ilanları kaldır ---
  const afterCount = await page.evaluate(() => window.__jobStoreTest.getAllUserCreatedJobs().length);
  await page.evaluate(() => {
    const STORAGE_KEY = "malsevk.jobs.v1";
    window.localStorage.removeItem(STORAGE_KEY);
  });
  ok(`Test verisi temizlendi (baseline: ${baselineCount}, test sonu: ${afterCount})`);

  await browser.close();
  console.log(`\n[tmp-multi-service-operation-stage1-test] ${passed} test geçti.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
