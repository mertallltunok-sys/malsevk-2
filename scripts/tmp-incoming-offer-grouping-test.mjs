// node scripts/tmp-incoming-offer-grouping-test.mjs
//
// "Gelen Teklifler" ekranının yeni Hizmet Türü -> İlan -> Teklifler
// hiyerarşisini üreten GERÇEK üretim fonksiyonuna
// (incoming-offer-grouping.ts#groupIncomingOffersByCategoryAndJob) karşı,
// statik metin araması OLMADAN, doğrudan import ederek test eder.
//
// incoming-offer-grouping.ts kendi içinde uzantısız yerel importlar
// kullanır (`from "./service-catalog"` -> o da `from "./jobs"`) — Next.js'in
// bundler çözümlemesi buna izin verir, düz Node ESM vermez (bkz.
// tmp-incoming-offers-sort-agreement-failed-test.mjs'teki AYNI kısıtlama
// notu). Bu yüzden burada da YALNIZCA bu test script'i içinde çalışan,
// hiçbir üretim kodunu DEĞİŞTİRMEYEN küçük bir `node:module` çözümleme
// kancası kaydedilir: uzantısız bir yerel (`./...`) specifier çözülemezse
// `.ts` eklenerek tekrar denenir.
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !specifier.endsWith(".ts")) {
          try {
            return await nextResolve(specifier + ".ts", context);
          } catch {
            // yok say, orijinal hatayı fırlat
          }
        }
        throw err;
      }
    }
  `)}`,
);

const { groupIncomingOffersByCategoryAndJob } = await import("../app/_lib/incoming-offer-grouping.ts");

let passed = 0;
function check(description, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${description}`);
}

/** Testte yalnızca gruplamaya etki eden alanlar önemlidir. */
function job(id, category, title = `İlan ${id}`) {
  return {
    id,
    category,
    title,
    requesterId: "requester-1",
    province: "Kocaeli",
    district: "Dilovası",
    workLocationType: "Beldeport",
    workDate: "2026-09-01",
    status: "yayinda",
    photos: [],
  };
}

function offer(id, jobId, status = "pending", createdAt = "2026-07-01T10:00:00.000Z") {
  return { id, jobId, status, createdAt, providerId: `provider-${id}`, amount: 100, currency: "TRY", estimatedDuration: "1 gün", description: "" };
}

console.log("[tmp-incoming-offer-grouping-test] incoming-offer-grouping.ts#groupIncomingOffersByCategoryAndJob saf mantık testleri\n");

check("A) Tek hizmet türünde tek ilan, tek teklif: doğru kategori + ilan adı görünüyor", () => {
  const jobA = job("job-a", "lashing", "Lashing İlanı A");
  const jobById = new Map([[jobA.id, jobA]]);
  const groups = groupIncomingOffersByCategoryAndJob([offer("o1", "job-a")], jobById);
  assert.equal(groups.length, 1, "tek kategori grubu olmalı");
  assert.equal(groups[0].categoryLabel, "Lashing", "kategori etiketi merkezi katalogdan (Lashing) gelmeli");
  assert.equal(groups[0].jobGroups.length, 1, "tek ilan grubu olmalı");
  assert.equal(groups[0].jobGroups[0].job?.title, "Lashing İlanı A", "ilan adı doğru gelmeli");
  assert.equal(groups[0].jobGroups[0].offers.length, 1);
  assert.equal(groups[0].offerCount, 1);
});

check("B) Tek hizmet türünde aynı ilana üç teklif: tek ilan başlığı altında üç teklif", () => {
  const jobA = job("job-a", "lashing");
  const jobById = new Map([[jobA.id, jobA]]);
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-a"), offer("o2", "job-a"), offer("o3", "job-a")],
    jobById,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobGroups.length, 1, "hâlâ TEK ilan grubu olmalı (üç teklif de aynı ilana)");
  assert.deepEqual(groups[0].jobGroups[0].offers.map((o) => o.id), ["o1", "o2", "o3"]);
  assert.equal(groups[0].offerCount, 3);
});

check("C) Aynı hizmet türünde iki farklı ilan: aynı kategori altında iki AYRI ilan grubu", () => {
  const jobA = job("job-a", "lashing", "Lashing İlanı A");
  const jobB = job("job-b", "lashing", "Lashing İlanı B");
  const jobById = new Map([[jobA.id, jobA], [jobB.id, jobB]]);
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-a"), offer("o2", "job-b")],
    jobById,
  );
  assert.equal(groups.length, 1, "tek kategori (lashing) olmalı");
  assert.equal(groups[0].jobGroups.length, 2, "iki ayrı ilan grubu olmalı");
  assert.deepEqual(groups[0].jobGroups.map((g) => g.jobId), ["job-a", "job-b"]);
});

check("D) Lashing ve depolama teklifleri birlikte: AYRI hizmet kutularında görünüyor", () => {
  const jobLashing = job("job-lashing", "lashing");
  const jobDepo = job("job-depo", "genel-depolama");
  const jobById = new Map([[jobLashing.id, jobLashing], [jobDepo.id, jobDepo]]);
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-lashing"), offer("o2", "job-depo")],
    jobById,
  );
  assert.equal(groups.length, 2, "iki AYRI kategori kutusu olmalı");
  assert.deepEqual(groups.map((g) => g.categoryLabel).sort(), ["Genel Depolama", "Lashing"]);
});

check("H) Eksik jobId: çökmeden güvenli fallback kategorisinde gösteriliyor, gerçek ilanlar etkilenmiyor", () => {
  const jobA = job("job-a", "lashing", "Lashing İlanı A");
  const jobById = new Map([[jobA.id, jobA]]); // "job-missing" KASITLI OLARAK map'te yok
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-a"), offer("o2", "job-missing")],
    jobById,
  );
  assert.equal(groups.length, 2, "gerçek ilan + eksik ilan için AYRI iki kategori grubu olmalı");
  const missingGroup = groups.find((g) => g.jobGroups.some((jg) => jg.jobId === "job-missing"));
  assert.ok(missingGroup, "eksik ilana ait teklif KAYBOLMAMALI, bir grupta bulunmalı");
  assert.equal(missingGroup.jobGroups[0].job, undefined, "job alanı undefined olmalı (kart bunu güvenle işler)");
  const realGroup = groups.find((g) => g.categoryLabel === "Lashing");
  assert.ok(realGroup, "gerçek ilanın kategorisi ETKİLENMEMİŞ olmalı");
  assert.equal(realGroup.jobGroups[0].job?.title, "Lashing İlanı A");
});

check("İki FARKLI eksik jobId birbirine karışmıyor (aynı sentinel kategoride ama ayrı ilan grupları)", () => {
  const jobById = new Map();
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-missing-1"), offer("o2", "job-missing-2")],
    jobById,
  );
  assert.equal(groups.length, 1, "her iki eksik ilan da AYNI sentinel kategoriye düşmeli");
  assert.equal(groups[0].jobGroups.length, 2, "ama İKİ ayrı ilan grubu olarak kalmalı (birleşmemeli)");
});

check("Grup sırası, girdi dizisindeki İLK GÖRÜNME sırasını yansıtır (yeniden sıralama yapılmaz)", () => {
  const jobLashing = job("job-lashing", "lashing");
  const jobDepo = job("job-depo", "genel-depolama");
  const jobById = new Map([[jobLashing.id, jobLashing], [jobDepo.id, jobDepo]]);
  // Girdi ÖNCE depo, SONRA lashing teklifi içeriyor — bu, sortIncomingOffersForDisplay'in
  // ürettiği ÖNCELİK sırasını simüle eder; gruplama bunu KORUMALI, kendi başına yeniden sıralamamalı.
  const groups = groupIncomingOffersByCategoryAndJob(
    [offer("o1", "job-depo"), offer("o2", "job-lashing")],
    jobById,
  );
  assert.deepEqual(groups.map((g) => g.categoryLabel), ["Genel Depolama", "Lashing"], "kategori sırası girdi sırasını (depo önce) yansıtmalı");
});

check("Orijinal offers dizisi mutate edilmiyor", () => {
  const jobA = job("job-a", "lashing");
  const jobById = new Map([[jobA.id, jobA]]);
  const input = [offer("o1", "job-a"), offer("o2", "job-a")];
  const inputIds = input.map((o) => o.id);
  groupIncomingOffersByCategoryAndJob(input, jobById);
  assert.deepEqual(input.map((o) => o.id), inputIds, "girdi dizisi değişmemeli");
});

console.log(`\n[tmp-incoming-offer-grouping-test] ${passed} test geçti.`);
