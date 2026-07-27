// node scripts/tmp-operation-service-lifecycle-notification-test.mjs
//
// "Operasyon Hizmet Kalemi Yaşam Döngüsü Senkronizasyonu" görevinin
// bildirim türetme mantığını (notifications.ts#getNotificationsForSession)
// GERÇEK üretim fonksiyonuna karşı, statik metin araması OLMADAN, doğrudan
// import ederek test eder:
//   - Bir hizmet kalemi (Job) manuel silindiğinde, o ilana ait "pending"
//     teklif "rejected"e çevrilir (bkz. offers.ts#deleteJobWithOffers) AMA
//     silinmez — bu, "İlan sahibi ilgili hizmet talebini yayından kaldırdı"
//     bildiriminin GERÇEKTEN türetilebilmesi (Offer kaydı hâlâ var) VE genel
//     "teklif_reddedildi" bildirimiyle ÇAKIŞMAMASI (ilan artık `jobs`
//     içinde yok) için gereklidir.
//   - "baska_hizmet_verenle_anlasildi" (mevcut, DEĞİŞTİRİLMEMİŞ bildirim)
//     hâlâ doğru çalışıyor mu (regresyon).
//
// notifications.ts kendi içinde uzantısız yerel importlar kullanır
// (`from "./job-requests"`) — Next.js'in bundler çözümlemesi buna izin
// verir, düz Node ESM vermez (bkz. önceki görevlerdeki AYNI kısıtlama
// notu). Bu yüzden burada da YALNIZCA bu test script'i içinde çalışan,
// hiçbir üretim kodunu DEĞİŞTİRMEYEN küçük bir `node:module` çözümleme
// kancası kaydedilir.

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

const { getNotificationsForSession } = await import("../app/_lib/notifications.ts");

let passed = 0;
function check(description, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${description}`);
}

function job(id, overrides = {}) {
  return {
    id,
    category: "lashing",
    title: `İlan ${id}`,
    requesterId: "requester-1",
    province: "Kocaeli",
    district: "Dilovası",
    workLocationType: "Beldeport",
    workDate: "2026-09-01",
    status: "yayinda",
    photos: [],
    ...overrides,
  };
}

function offer(id, jobId, providerId, status, createdAt, updatedAt = createdAt) {
  return {
    id,
    jobId,
    providerId,
    status,
    createdAt,
    updatedAt,
    amount: 1000,
    currency: "TRY",
    estimatedDuration: "1 gün",
    description: "test",
  };
}

const providerSession = { id: "provider-1", name: "Sağlayıcı Bir", role: "hizmet-veren" };

console.log("[tmp-operation-service-lifecycle-notification-test] notifications.ts#getNotificationsForSession saf mantık testleri\n");

check("Hizmet kalemi manuel silinince (ilan artık `jobs`de yok, teklif 'rejected'e çevrilmiş): 'hizmet_kalemi_kaldirildi' bildirimi doğru mesajla türetilir", () => {
  const jobs = []; // ilan SİLİNMİŞ — artık jobs listesinde yok
  const offers = [offer("o1", "job-deleted", "provider-1", "rejected", "2026-07-01T10:00:00.000Z")];
  const notifications = getNotificationsForSession(providerSession, jobs, offers);
  const removed = notifications.find((n) => n.notificationType === "hizmet_kalemi_kaldirildi");
  assert.ok(removed, "hizmet_kalemi_kaldirildi bildirimi üretilmeli");
  assert.equal(removed.message, "İlan sahibi ilgili hizmet talebini yayından kaldırdı.");
  assert.equal(removed.offerId, "o1");
});

check("AYNI senaryoda genel 'teklif_reddedildi' bildirimi ÜRETİLMEZ (çakışan/çelişkili iki bildirim olmamalı)", () => {
  const jobs = [];
  const offers = [offer("o1", "job-deleted", "provider-1", "rejected", "2026-07-01T10:00:00.000Z")];
  const notifications = getNotificationsForSession(providerSession, jobs, offers);
  const generic = notifications.find((n) => n.notificationType === "teklif_reddedildi");
  assert.equal(generic, undefined, "aynı teklif için hem 'hizmet_kalemi_kaldirildi' hem 'teklif_reddedildi' ASLA birlikte üretilmemeli");
});

check("İlan HÂLÂ varsa, aynı 'rejected' durumu normal şekilde 'teklif_reddedildi' üretir (regresyon — genel red mesajı bozulmadı)", () => {
  const jobs = [job("job-1")];
  const offers = [offer("o1", "job-1", "provider-1", "rejected", "2026-07-01T10:00:00.000Z")];
  const notifications = getNotificationsForSession(providerSession, jobs, offers);
  const generic = notifications.find((n) => n.notificationType === "teklif_reddedildi");
  assert.ok(generic, "ilan hâlâ varken normal red bildirimi üretilmeli");
  assert.equal(generic.message, "Hizmet Alan teklifinizi kabul etmedi.");
  const removed = notifications.find((n) => n.notificationType === "hizmet_kalemi_kaldirildi");
  assert.equal(removed, undefined, "ilan hâlâ varken 'hizmet_kalemi_kaldirildi' ASLA üretilmemeli");
});

check("Bildirim href'i GÜVENLİ, mevcut bir route'a (Verdiğim Teklifler) gider — 404 riski yok", () => {
  const jobs = [];
  const offers = [offer("o1", "job-deleted", "provider-1", "rejected", "2026-07-01T10:00:00.000Z")];
  const notifications = getNotificationsForSession(providerSession, jobs, offers);
  const removed = notifications.find((n) => n.notificationType === "hizmet_kalemi_kaldirildi");
  assert.ok(removed.href.startsWith("/panel/tekliflerim"), `href '/panel/tekliflerim' ile başlamalı, gelen: ${removed.href}`);
});

check("Farklı bir sağlayıcının (provider-2) teklifi bu bildirimi TETİKLEMEZ — yalnızca KENDİ teklifi olan sağlayıcı görür", () => {
  const jobs = [];
  const offers = [offer("o1", "job-deleted", "provider-1", "rejected", "2026-07-01T10:00:00.000Z")];
  const otherProviderSession = { id: "provider-2", name: "Sağlayıcı İki", role: "hizmet-veren" };
  const notifications = getNotificationsForSession(otherProviderSession, jobs, offers);
  assert.equal(notifications.find((n) => n.notificationType === "hizmet_kalemi_kaldirildi"), undefined);
});

check("REGRESYON: 'baska_hizmet_verenle_anlasildi' (mevcut, değiştirilmemiş) hâlâ doğru çalışıyor — settled teklif in_progress olunca pending kardeş bildirim alır", () => {
  const jobs = [job("job-1")];
  const offers = [
    offer("winner", "job-1", "provider-winner", "in_progress", "2026-07-01T10:00:00.000Z", "2026-07-05T10:00:00.000Z"),
    offer("sibling", "job-1", "provider-1", "pending", "2026-07-02T10:00:00.000Z"),
  ];
  const notifications = getNotificationsForSession(providerSession, jobs, offers);
  const closed = notifications.find((n) => n.notificationType === "baska_hizmet_verenle_anlasildi");
  assert.ok(closed, "kardeş teklif kapanma bildirimi üretilmeli (regresyon — dokunulmadı)");
  assert.equal(closed.message, "Teklif verdiğiniz ilan için başka bir Hizmet Verenle işe başlandı.");
});

console.log(`\n[tmp-operation-service-lifecycle-notification-test] ${passed} test geçti.`);
