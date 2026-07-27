// node scripts/tmp-incoming-offers-sort-agreement-failed-test.mjs
//
// "Gelen Teklifler" panelinin (incoming-offers-panel.tsx) sıralama kuralını
// GERÇEK üretim fonksiyonuna (job-requests.ts#sortIncomingOffersForDisplay)
// karşı, statik metin araması OLMADAN, doğrudan import ederek test eder.
//
// KAPSAM GENİŞLEMESİ NOTU: bu script başlangıçta yalnızca "agreement_failed
// aynı ilanın diğer tekliflerinin altına iner" TEK istisnasını test
// ediyordu (`incomingOfferSortWeight` o zaman yalnızca 2 kademeliydi: 0/1).
// "Gelen Teklifler kart sıralaması" göreviyle bu ağırlık fonksiyonu TAM
// 7 kademeli bir iş-öncelik sırasına genişletildi (Beklemede -> Kabul
// Edildi -> İşe Başlandı/Devam Eden -> Tamamlanma Süreci -> Tamamlandı ->
// Anlaşma Sağlanamadı/İptal -> Reddedildi) — ALGORİTMANIN KENDİSİ (deterministik
// slot-yeniden-yerleştirme) DEĞİŞMEDİ, yalnızca ağırlık tablosu genişledi.
// Bu yüzden aşağıda: (a) ESKİ "agreement_failed" testleri AYNEN geçerli
// kalır ve DEĞİŞTİRİLMEDİ (agreement_failed hâlâ pending/accepted'ın altında);
// (b) yalnızca "pending/accepted'ın EŞİT öncelikli olduğu" varsayımına
// dayanan TEK eski test, artık YANLIŞ olduğu için (görev gereği pending
// artık accepted'dan daha yüksek öncelikli) güncellendi; (c) yeni kademeler
// (in_progress/completion_requested/completion_disputed/completed/
// cancelled/rejected) için yeni testler eklendi.
//
// job-requests.ts hiçbir tarayıcı-only API (window/localStorage/indexedDB)
// KULLANMAZ (yalnızca ./jobs ve ./types'ı import eder), bu yüzden saf mantık
// olarak Node'da çalıştırılabilir GİBİ görünür — ANCAK kendi iç importu
// (`from "./jobs"`) uzantısız'dır (Next.js'in bundler çözümlemesi buna izin
// verir, düz Node ESM vermez — bkz. test-photo-feature.mjs'teki AYNI
// kısıtlama notu, job-store.ts için). Bu yüzden aşağıda, YALNIZCA bu test
// script'i içinde çalışan, hiçbir üretim kodunu DEĞİŞTİRMEYEN küçük bir
// `node:module` çözümleme kancası (resolve hook) kaydedilir: uzantısız bir
// yerel (`./...`) specifier çözülemezse `.ts` eklenerek tekrar denenir.
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

const { sortIncomingOffersForDisplay } = await import("../app/_lib/job-requests.ts");

let passed = 0;
function check(description, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${description}`);
}

/** Testte yalnızca sıralamaya etki eden alanlar (jobId, status, createdAt) önemlidir; diğerleri saf mantık testi için önemsizdir. */
function offer(id, jobId, status, createdAt) {
  return { id, jobId, status, createdAt, providerId: `provider-${id}`, amount: 100, currency: "TRY", estimatedDuration: "1 gün", description: "" };
}

console.log("[tmp-incoming-offers-sort-agreement-failed-test] job-requests.ts#sortIncomingOffersForDisplay saf mantık testleri\n");

check("Aynı ilanda 2 bekleyen + 1 anlaşma sağlanamadı: anlaşma sağlanamadı en altta", () => {
  // agreement_failed olan teklif (o2) en YENİ createdAt'e sahip — eski
  // (yalnızca recency'e göre sıralayan) davranış onu en üste koyardı.
  const o1 = offer("o1", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const o2 = offer("o2", "job-1", "agreement_failed", "2026-07-03T10:00:00.000Z");
  const o3 = offer("o3", "job-1", "pending", "2026-07-02T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([o1, o2, o3]);
  assert.deepEqual(result.map((o) => o.id), ["o3", "o1", "o2"], "o2 (agreement_failed) en altta olmalı, o3/o1 kendi recency sırasını korumalı");
});

check("Orijinal dizi mutate edilmiyor", () => {
  const o1 = offer("o1", "job-1", "agreement_failed", "2026-07-03T10:00:00.000Z");
  const o2 = offer("o2", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const original = [o1, o2];
  const originalOrderIds = original.map((o) => o.id);
  sortIncomingOffersForDisplay(original);
  assert.deepEqual(original.map((o) => o.id), originalOrderIds, "girdi dizisinin sırası değişmemeli");
});

check("Birden fazla anlaşma sağlanamadı teklif: kendi aralarında mevcut tarih sırası korunur, ikisi de bekleyenlerin altında", () => {
  const pending = offer("pending", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const failedNewer = offer("failed-newer", "job-1", "agreement_failed", "2026-07-05T10:00:00.000Z");
  const failedOlder = offer("failed-older", "job-1", "agreement_failed", "2026-07-02T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([failedOlder, pending, failedNewer]);
  assert.deepEqual(
    result.map((o) => o.id),
    ["pending", "failed-newer", "failed-older"],
    "iki agreement_failed kendi recency sırasını (yeni->eski) korumalı, ikisi de pending'in altında olmalı",
  );
});

check("İki 'pending' teklif kendi aralarında recency sırasını korur (aynı ağırlık kademesi)", () => {
  const a = offer("a", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const c = offer("c", "job-1", "pending", "2026-07-02T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([a, c]);
  assert.deepEqual(result.map((o) => o.id), ["c", "a"], "aynı kademedeki (pending) teklifler arasında sıralama SADECE recency'e göre olmalı");
});

check("'pending' artık 'accepted'dan HER ZAMAN daha yüksek öncelikli — recency'den bağımsız (görev: Beklemede -> Kabul Edildi sırası)", () => {
  const a = offer("a", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const b = offer("b", "job-1", "accepted", "2026-07-03T10:00:00.000Z");
  const c = offer("c", "job-1", "pending", "2026-07-02T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([a, b, c]);
  assert.deepEqual(
    result.map((o) => o.id),
    ["c", "a", "b"],
    "b (accepted) en yeni olsa bile pending'lerin (c, a — kendi recency sırasıyla) ALTINA inmeli",
  );
});

check("Tam 7 kademeli öncelik sırası: pending -> accepted -> in_progress -> tamamlanma süreci -> completed -> agreement_failed/cancelled -> rejected", () => {
  // Girdi KASITLI OLARAK ters/karışık sırada (recency önceliği sırasıyla ÇAKIŞMAYACAK
  // şekilde) verilir — sonucun SADECE öncelik ağırlığına göre kurulduğunu kanıtlamak için.
  const rejected = offer("rejected", "job-1", "rejected", "2026-07-01T10:00:00.000Z");
  const cancelled = offer("cancelled", "job-1", "cancelled", "2026-07-02T10:00:00.000Z");
  const agreementFailed = offer("agreement_failed", "job-1", "agreement_failed", "2026-07-03T10:00:00.000Z");
  const completed = offer("completed", "job-1", "completed", "2026-07-04T10:00:00.000Z");
  const completionDisputed = offer("completion_disputed", "job-1", "completion_disputed", "2026-07-05T10:00:00.000Z");
  const completionRequested = offer("completion_requested", "job-1", "completion_requested", "2026-07-06T10:00:00.000Z");
  const inProgress = offer("in_progress", "job-1", "in_progress", "2026-07-07T10:00:00.000Z");
  const accepted = offer("accepted", "job-1", "accepted", "2026-07-08T10:00:00.000Z");
  const pending = offer("pending", "job-1", "pending", "2026-07-09T10:00:00.000Z");

  const result = sortIncomingOffersForDisplay([
    rejected,
    cancelled,
    agreementFailed,
    completed,
    completionDisputed,
    completionRequested,
    inProgress,
    accepted,
    pending,
  ]);

  assert.deepEqual(
    result.map((o) => o.id),
    [
      "pending",
      "accepted",
      "in_progress",
      "completion_requested",
      "completion_disputed",
      "completed",
      "agreement_failed",
      "cancelled",
      "rejected",
    ],
    "yedi kademeli iş-öncelik sırası (Beklemede -> Kabul Edildi -> İşe Başlandı/Devam Eden -> Tamamlanma Süreci -> Tamamlandı -> Anlaşma Sağlanamadı/İptal -> Reddedildi) birebir uygulanmalı",
  );
});

check("'rejected' HER ZAMAN en altta — 'agreement_failed'den bile daha düşük öncelikli", () => {
  const rejected = offer("rejected", "job-1", "rejected", "2026-07-05T10:00:00.000Z");
  const agreementFailed = offer("agreement_failed", "job-1", "agreement_failed", "2026-07-01T10:00:00.000Z");
  const pending = offer("pending", "job-1", "pending", "2026-07-02T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([rejected, agreementFailed, pending]);
  assert.deepEqual(
    result.map((o) => o.id),
    ["pending", "agreement_failed", "rejected"],
    "rejected en yeni (07-05) olmasına rağmen en altta kalmalı — agreement_failed'in bile altında",
  );
});

check("'completion_requested' ve 'completion_disputed' AYNI ağırlık kademesini (Tamamlanma Süreci) paylaşır", () => {
  const requested = offer("requested", "job-1", "completion_requested", "2026-07-01T10:00:00.000Z");
  const disputed = offer("disputed", "job-1", "completion_disputed", "2026-07-03T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([requested, disputed]);
  assert.deepEqual(result.map((o) => o.id), ["disputed", "requested"], "aynı kademedeki iki durum arasında sıralama SADECE recency'e göre olmalı");
});

check("Farklı ilanlara ait teklifler birbirine karışmıyor — çapraz-ilan göreli sırası recency sıralamasından bozulmuyor", () => {
  // job-2'nin tek teklifi agreement_failed VE en yeni createdAt'e sahip.
  // Eğer sıralama "global" olsaydı (ilan bazında izole değil), bu teklif
  // TÜM listenin en altına inerdi. Doğru davranış: yalnızca kendi ilanının
  // (job-2, tek başına) içinde en altta olması yeterli — job-1'in
  // tekliflerine göre YERİ hâlâ orijinal recency sırasıyla belirlenir.
  const jobAPending = offer("job-a-pending", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const jobBFailed = offer("job-b-failed", "job-2", "agreement_failed", "2026-07-10T10:00:00.000Z");
  const jobAOlder = offer("job-a-older", "job-1", "pending", "2026-06-01T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([jobAPending, jobBFailed, jobAOlder]);
  assert.deepEqual(
    result.map((o) => o.id),
    ["job-b-failed", "job-a-pending", "job-a-older"],
    "job-2'nin tek teklifi kendi ilanı içinde zaten 'en altta' (tek başına) — çapraz-ilan sırası hâlâ saf recency",
  );
});

check("İki ilanın teklifleri temel dizide iç içe geçmişken: yalnızca job-1'in KENDİ slotları (0 ve 2) kendi aralarında yer değiştirir, job-2'nin slotu (1) HİÇ dokunulmadan kalır", () => {
  const job1Pending = offer("job1-pending", "job-1", "pending", "2026-07-01T10:00:00.000Z");
  const job1Failed = offer("job1-failed", "job-1", "agreement_failed", "2026-07-09T10:00:00.000Z");
  const job2Pending = offer("job2-pending", "job-2", "pending", "2026-07-05T10:00:00.000Z");
  const result = sortIncomingOffersForDisplay([job1Failed, job2Pending, job1Pending]);
  // Temel recency sırası (yeniden sıralamadan ÖNCE): job1Failed(07-09, slot 0)
  // > job2Pending(07-05, slot 1) > job1Pending(07-01, slot 2). job-1'in
  // rezerve slotları {0, 2}'dir — algoritma SADECE bu iki slotun içeriğini
  // (job1Pending <-> job1Failed) kendi aralarında öncelik sırasına göre
  // permüte eder; slot 1 (job-2'ye ait) hiçbir zaman bu permütasyona dahil
  // edilmez, job2Pending kesinlikle konum 1'de (ortada) kalır. Sonuç olarak
  // job1-pending job-1'in kendi en iyi slotuna (0) yükselir, job1-failed
  // job-1'in kendi en kötü slotuna (2, dizinin sonu) iner — ikisi de SADECE
  // birbirlerine göredir, job2-pending'in mutlak konumu bundan bağımsızdır.
  assert.deepEqual(
    result.map((o) => o.id),
    ["job1-pending", "job2-pending", "job1-failed"],
    "job-1'in iki teklifi yalnızca kendi aralarında (slot 0 <-> slot 2) yer değiştirmeli; job2-pending slot 1'de sabit kalmalı",
  );
});

check("Deterministiklik: aynı girdi için fonksiyon her çağrıda BİREBİR aynı sonucu üretir (100 tekrar)", () => {
  const base = [
    offer("a", "job-1", "agreement_failed", "2026-07-09T10:00:00.000Z"),
    offer("b", "job-2", "pending", "2026-07-05T10:00:00.000Z"),
    offer("c", "job-1", "pending", "2026-07-01T10:00:00.000Z"),
    offer("d", "job-3", "agreement_failed", "2026-07-08T10:00:00.000Z"),
    offer("e", "job-1", "agreement_failed", "2026-07-04T10:00:00.000Z"),
    offer("f", "job-2", "accepted", "2026-07-02T10:00:00.000Z"),
  ];
  const first = sortIncomingOffersForDisplay(base).map((o) => o.id);
  for (let i = 0; i < 100; i++) {
    const repeat = sortIncomingOffersForDisplay(base).map((o) => o.id);
    assert.deepEqual(repeat, first, `çağrı #${i} öncekiyle birebir aynı olmalı (motor/algoritma davranışına bağlı bir belirsizlik olmamalı)`);
  }
});

console.log(`\n[tmp-incoming-offers-sort-agreement-failed-test] ${passed} test geçti.`);
