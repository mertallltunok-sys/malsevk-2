// node scripts/tmp-job-publish-window-test.mjs
//
// app/_lib/job-publish-window.ts'in (İlan Yayın Süresi Yönetimi'nin TEK
// doğruluk kaynağı) saf mantığını sunucusuz doğrular — hiçbir localStorage/
// tarayıcı bağımlılığı olmadığı için (Job/Offer[] doğrudan parametre olarak
// alınır) doğrudan Node'un yerleşik TypeScript desteğiyle import edilir.
//
// ÇALIŞTIRMA NOTU: bu dosyanın aksine test-photo-feature.mjs'in test ettiği
// photo-validation.ts'in HİÇ iç `_lib` import'u yoktur — job-publish-window.ts
// ise (tek doğruluk kaynağı olması gereği) job-requests.ts'ten
// getSettledOfferForJob'ı import eder, o da ./jobs'u import eder; ikisi de
// projenin genel konvansiyonuna uygun UZANTISIZ (extensionless) relative
// import kullanır (bkz. CLAUDE.md). Next'in bundler'ı bunu sorunsuz çözer,
// ama Node'un çıplak ESM çözücüsü extensionless bir specifier'ı ÇÖZEMEZ —
// bu yüzden `node scripts/tmp-job-publish-window-test.mjs` TEK BAŞINA
// `ERR_MODULE_NOT_FOUND` ile başarısız olur (kaynak dosyalarda bir hata
// DEĞİLDİR). Bu saf mantık zaten `npm run build`ın TypeScript kontrolünden
// (gerçek modül çözümlemesiyle) geçer; bu script'i GERÇEKTEN çalıştırmak
// için ya extensionless specifier'lara `.ts` ekleyen küçük bir Node
// `--loader` kancası kullanın ya da doğrudan bir Next/bundler bağlamında
// çalıştırın.
//
// Kapsam: 14 günlük süre hesabı (milisaniye hassasiyeti, saat dilimi
// güvenliği), sınır davranışı (13g23s aktif / tam 14 gün dolmuş), legacy
// (createdAt/publishEndAt'siz) kayıtların güvenli muafiyeti, iş akışı
// istisnası (kabul edilmiş/işe başlanmış/tamamlanma sürecinde/tamamlanmış
// bir teklifin süre kuralından muaf tutulması), "zaten yeniden yayınlanmış"
// ayrımı ve republish için yeni pencere üretimi.

import assert from "node:assert/strict";
import {
  JOB_PUBLISH_WINDOW_DAYS,
  computePublishEndAt,
  createPublishWindow,
  getJobPublishEndAt,
  getJobPublishStartAt,
  isExpiredListingAwaitingAction,
  isJobListingActiveForOffers,
  isJobListingExpired,
  isJobPublishWindowExpired,
} from "../app/_lib/job-publish-window.ts";

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function baseJob(overrides = {}) {
  return {
    id: "job-1",
    title: "Test İlanı",
    category: "lashing",
    province: "Kocaeli",
    district: "Dilovası",
    workLocationType: "Test Tesis",
    workDate: "2026-08-01",
    description: "Açıklama, en az yirmi karakter içerir gerçekten.",
    operationDetails: "Operasyon detayları, en az on karakter.",
    status: "yayinda",
    requesterId: "requester-1",
    photos: [],
    ...overrides,
  };
}

function offer(overrides = {}) {
  return {
    id: "offer-1",
    jobId: "job-1",
    providerId: "provider-1",
    amount: 1000,
    currency: "TRY",
    description: "Teklif açıklaması, yirmi karakterden uzun bir metin.",
    estimatedDuration: "2 gün",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function main() {
  // =====================================================================
  // TEST 1: computePublishEndAt — TAM 14 gün sonrası, milisaniye hassasiyetiyle.
  // =====================================================================
  assert.equal(JOB_PUBLISH_WINDOW_DAYS, 14, "TEST 1: yayın süresi sabiti 14 gün olmalı");
  const createdAt = "2026-01-01T10:00:00.000Z";
  const publishEndAt = computePublishEndAt(createdAt);
  const diffMs = new Date(publishEndAt).getTime() - new Date(createdAt).getTime();
  assert.equal(diffMs, 14 * DAY_MS, "TEST 1: yayın bitişi oluşturulmadan TAM 14×24×60×60×1000 ms sonra olmalı");
  assert.equal(publishEndAt, "2026-01-15T10:00:00.000Z", "TEST 1: saat/dakika/saniye korunarak yalnızca gün ilerlemeli");
  ok("TEST 1: computePublishEndAt tam 14 gün sonrasını, milisaniye hassasiyetiyle üretiyor");

  // =====================================================================
  // TEST 2: sınır davranışı — 13g23s aktif, tam 14 günde (ve sonrasında) süresi dolmuş.
  // =====================================================================
  const job2 = baseJob({ createdAt, publishEndAt });
  const almostThere = new Date(new Date(publishEndAt).getTime() - 60 * 60 * 1000); // 1 saat önce (13g23s)
  assert.equal(isJobPublishWindowExpired(job2, almostThere), false, "TEST 2: tam bitişten 1 saat önce (13g23s) hâlâ AKTİF olmalı");
  const exactBoundary = new Date(publishEndAt);
  assert.equal(isJobPublishWindowExpired(job2, exactBoundary), true, "TEST 2: TAM bitiş anında süresi DOLMUŞ sayılmalı (>= karşılaştırması)");
  const oneMsAfter = new Date(new Date(publishEndAt).getTime() + 1);
  assert.equal(isJobPublishWindowExpired(job2, oneMsAfter), true, "TEST 2: bitişten 1ms sonra da süresi dolmuş kalmalı");
  ok("TEST 2: 13g23s'de aktif, tam 14 günde ve sonrasında süresi dolmuş — sınır davranışı doğru");

  // =====================================================================
  // TEST 3: saat dilimi güvenliği — ham UTC milisaniye karşılaştırması,
  // JS Date nesnesinin YEREL saat dilimi temsilinden ETKİLENMEMELİ.
  // =====================================================================
  const farEastCreatedAt = "2026-06-15T23:30:00.000+14:00"; // UTC+14 (en ileri saat dilimi)
  const farWestNow = new Date(new Date(farEastCreatedAt).getTime() + 14 * DAY_MS - 1000); // tam bitişten 1sn önce
  const jobTz = baseJob({ createdAt: farEastCreatedAt, publishEndAt: computePublishEndAt(farEastCreatedAt) });
  assert.equal(isJobPublishWindowExpired(jobTz, farWestNow), false, "TEST 3: farklı saat dilimli bir oluşturulma zamanında bile 1sn öncesi hâlâ aktif olmalı");
  assert.equal(
    isJobPublishWindowExpired(jobTz, new Date(farWestNow.getTime() + 1000)),
    true,
    "TEST 3: tam 1 saniye sonra (gerçek 14 gün dolduğunda) süresi dolmuş olmalı — saat dilimi kayması YOK",
  );
  ok("TEST 3: 14 günlük hesap saat dilimi farklarından etkilenmiyor (ham UTC milisaniye karşılaştırması)");

  // =====================================================================
  // TEST 4: LEGACY güvenli muafiyet — createdAt/publishEndAt'i olmayan eski
  // kayıtlar ASLA otomatik süresi dolmuş sayılmaz.
  // =====================================================================
  const legacyJob = baseJob({ createdAt: undefined, publishEndAt: undefined });
  assert.equal(getJobPublishStartAt(legacyJob), null, "TEST 4: createdAt'siz ilanda yayın başlangıcı null olmalı (sahte tarih üretilmez)");
  assert.equal(getJobPublishEndAt(legacyJob), null, "TEST 4: createdAt/publishEndAt'siz ilanda yayın bitişi de null olmalı");
  assert.equal(
    isJobPublishWindowExpired(legacyJob, new Date("2099-01-01")),
    false,
    "TEST 4: uzak gelecekte bile createdAt'siz eski ilan süresi dolmuş SAYILMAMALI",
  );
  assert.equal(isJobListingExpired(legacyJob, []), false, "TEST 4: aynı muafiyet isJobListingExpired için de geçerli");
  ok("TEST 4: createdAt/publishEndAt'i olmayan eski kayıtlar yayın süresi kuralından güvenle muaf");

  // TEST 4b: publishEndAt bozuksa ama createdAt sağlamsa, getJobPublishEndAt türetir.
  const derivedJob = baseJob({ createdAt, publishEndAt: undefined });
  assert.equal(getJobPublishEndAt(derivedJob), publishEndAt, "TEST 4b: publishEndAt eksikse createdAt'ten güvenle türetilmeli");
  ok("TEST 4b: publishEndAt eksik ama createdAt sağlamsa doğru şekilde türetiliyor");

  // TEST 4c: Invalid Date güvenli ele alınır.
  const invalidJob = baseJob({ createdAt: "gecersiz-tarih", publishEndAt: "de-gecersiz" });
  assert.equal(isJobPublishWindowExpired(invalidJob), false, "TEST 4c: geçersiz tarih string'leri güvenli biçimde 'süresi dolmamış' sayılmalı, çökmemeli");
  ok("TEST 4c: geçersiz (Invalid Date) tarih değerleri güvenli şekilde ele alınıyor, çökme yok");

  // =====================================================================
  // TEST 5: İŞ AKIŞI İSTİSNASI — kabul edilmiş/işe başlanmış/tamamlanma
  // sürecinde/tamamlanmış bir teklifi olan ilan, 14 gün dolsa bile ASLA
  // süresi dolmuş sayılmaz.
  // =====================================================================
  const expiredJobBase = baseJob({ id: "job-exempt", createdAt, publishEndAt });
  const farFuture = new Date(new Date(publishEndAt).getTime() + 30 * DAY_MS);
  for (const status of ["accepted", "in_progress", "completion_requested", "completion_disputed", "completed"]) {
    const offers = [offer({ jobId: "job-exempt", status })];
    assert.equal(
      isJobListingExpired(expiredJobBase, offers, farFuture),
      false,
      `TEST 5: '${status}' durumundaki bir teklifi olan ilan 14 gün+30 gün geçmiş olsa bile süresi dolmuş SAYILMAMALI`,
    );
  }
  ok("TEST 5: kabul edilmiş/işe başlanmış/tamamlanma sürecinde/tamamlanmış ilanlar yayın süresi kuralından tamamen muaf");

  // TEST 5b: yalnızca pending/rejected/withdrawn/agreement_failed/cancelled
  // varsa (hiçbiri "settled" saymaz) ilan NORMAL şekilde süresi dolar.
  for (const status of ["pending", "rejected", "withdrawn", "agreement_failed", "cancelled"]) {
    const offers = [offer({ jobId: "job-exempt", status })];
    assert.equal(
      isJobListingExpired(expiredJobBase, offers, farFuture),
      true,
      `TEST 5b: yalnızca '${status}' durumunda teklifi olan ilan 14 gün dolunca NORMAL şekilde süresi dolmalı`,
    );
  }
  assert.equal(isJobListingExpired(expiredJobBase, [], farFuture), true, "TEST 5b: hiç teklifi olmayan bir ilan da 14 gün dolunca süresi dolmuş sayılmalı");
  ok("TEST 5b: bekleyen/reddedilmiş/geri çekilmiş/anlaşma sağlanamamış/iptal edilmiş teklifler veya hiç teklif olmaması, süre kuralını ENGELLEMEZ");
  assert.equal(isJobListingActiveForOffers(expiredJobBase, [], farFuture), false, "TEST 5b: isJobListingActiveForOffers, isJobListingExpired'ın DOĞRU tersini üretmeli");

  // =====================================================================
  // TEST 6: "zaten yeniden yayınlanmış" ayrımı (isExpiredListingAwaitingAction).
  // =====================================================================
  assert.equal(
    isExpiredListingAwaitingAction(expiredJobBase, [], farFuture),
    true,
    "TEST 6: süresi dolmuş VE henüz yeniden yayınlanmamış bir ilan aksiyon bekliyor sayılmalı",
  );
  const republishedJob = { ...expiredJobBase, republishedToJobId: "job-new" };
  assert.equal(
    isExpiredListingAwaitingAction(republishedJob, [], farFuture),
    false,
    "TEST 6: republishedToJobId doluysa artık aksiyon bekleyen sayılmamalı (salt geçmiş kaydı)",
  );
  assert.equal(
    isJobListingExpired(republishedJob, [], farFuture),
    true,
    "TEST 6: buna rağmen isJobListingExpired GERÇEĞİ (süresi dolmuş olduğu) hâlâ true dönmeli — 'Süresi Dolan İlanlar' sekmesi bu kaydı geçmiş olarak listelemeye devam eder",
  );
  ok("TEST 6: 'aksiyon bekliyor' ile 'gerçekten süresi dolmuş' ayrımı doğru — yeniden yayınlanan kayıt geçmiş olarak kalır ama aksiyon istemez");

  // =====================================================================
  // TEST 7: createPublishWindow — yeni pencere üretimi (ilk oluşturma VE
  // yeniden yayınlama için ortak).
  // =====================================================================
  const fixedNow = new Date("2026-03-10T12:00:00.000Z");
  const window7 = createPublishWindow(fixedNow);
  assert.equal(window7.createdAt, fixedNow.toISOString(), "TEST 7: createdAt tam olarak verilen 'now' anı olmalı");
  assert.equal(window7.publishEndAt, computePublishEndAt(window7.createdAt), "TEST 7: publishEndAt, computePublishEndAt ile TUTARLI üretilmeli");
  ok("TEST 7: createPublishWindow tutarlı bir createdAt/publishEndAt çifti üretiyor");

  console.log(`\n[tmp-job-publish-window-test] ${passed} test geçti.`);
}

main();
