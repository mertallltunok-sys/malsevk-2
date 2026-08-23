"use client";

import { useMemo } from "react";
import { isProviderEligibleForRecyclingJob, isRecyclingCategory } from "./recycling-catalog";
import { resolveLegacyJobCategoryToId } from "./service-catalog";
import { isProviderEligibleForContainerJob, STORAGE_CONTAINER_CATEGORY_ID, type ContainerStorageAuthorization } from "./storage-container-catalog";
import { isHazardousStorageCategory, isProviderEligibleForHazardousStorageJob } from "./storage-hazard-catalog";
import type { Job, Session } from "./types";
import {
  getAuthorizedContainerScopesSync,
  getAuthorizedServiceCategoryIdsSync,
} from "./supabase-provider-service-authorizations";
import { getAuthorizedRecyclingActivityIdsSync, getAuthorizedRecyclingWasteCodesSync } from "./supabase-recycling-authorizations";
import { getAuthorizedStorageRiskGroupIdsSync } from "./supabase-storage-risk-authorizations";
import { useAuthorizedContainerScopes } from "./use-authorized-container-scopes";
import { useAuthorizedRecyclingScopes } from "./use-recycling-authorizations";
import { useAuthorizedServiceCategoryIds } from "./use-authorized-services";
import { useAuthorizedStorageRiskGroupIds } from "./use-storage-risk-authorizations";

/**
 * HİZMET BAZLI PROVIDER YETKİLENDİRMESİ — ilan görünürlüğünün TEK merkezi
 * kapısı (bu modülün adı/rolü DEĞİŞMEDİ, YALNIZCA karar mantığı genelleşti).
 *
 * ÖNCEKİ DAVRANIŞ (0038'den önce): yalnızca "izole" kategorilerde (Nakliye/
 * Gümrük Müşavirliği) "seçim = görünürlük" kuralı vardı — provider bu
 * kategorilerden birini SEÇMİŞ olması yeterliydi, admin onayı hiç
 * aranmıyordu; izole olmayan kategorilerde (Lashing/Depolama/Forklift/
 * Gözetim/Konteyner/vb.) HİÇBİR kısıtlama yoktu.
 *
 * YENİ DAVRANIŞ (görev: "hizmet bazlı provider yetkilendirme"): SEÇİM ARTIK
 * YETKİ VERMEZ. Her kategori için provider'ın GERÇEKTEN admin-onaylı bir
 * yetkilendirmesi (bkz. supabase-provider-service-authorizations.ts) olması
 * gerekir — hiç yetkilendirme yoksa (yeni kayıtlı bir provider, ya da hiçbir
 * hizmeti onaylanmamış biri) HİÇBİR ilan görünmez (görev bölüm 30, "No-
 * Authorization Scenario"). Bu, önceki "varsayılan açık" davranışın TAM
 * TERSİDİR — bilinçli, görev gereksinimi.
 *
 * Yetki kaynağı artık `provider-services.ts` (localStorage, "SEÇTİĞİ
 * hizmetler") DEĞİL, `supabase-provider-service-authorizations.ts`
 * (GERÇEK Supabase, "ONAYLANMIŞ hizmetler") — bkz. o modülün kendi
 * "cross-device" dokümantasyonu (localStorage bu iş için YETERSİZ, çünkü
 * cihazlar arası paylaşılamaz).
 *
 * Hizmet Alan/admin/misafir (oturum yok) bu kuraldan HİÇ etkilenmez.
 *
 * BU MODÜL, ilan görünürlüğünün TEK merkezi kapısıdır — hiçbir ekran kendi
 * `job.category === "nakliye"` kontrolünü yazmamalı, aşağıdaki fonksiyon/
 * hook'lardan birini kullanmalıdır:
 *  - `isJobVisibleToSession`/`filterVisibleJobs`: DÜZ (reaktif olmayan)
 *    fonksiyonlar — önceden doldurulmuş önbelleği senkron okur, kendisi ağ
 *    isteği yapmaz (bkz. supabase-provider-service-authorizations.ts).
 *    Bileşen dışı, tek seferlik kontroller için (offers.ts#createOffer/
 *    canProviderSubmitNewOffer).
 *  - `useIsJobVisibleToSession`/`useFilterVisibleJobs`: REAKTİF hâli —
 *    mount olduğunda GERÇEK bir Supabase fetch'i tetikler VE önbellek
 *    güncellendiğinde bileşeni yeniden render eder (provider-job-listing.tsx,
 *    job-detail-content.tsx, operation-status-card.tsx).
 *
 * MİMARİ SINIRLAMA (job/offer verisiyle AYNI, bkz. proje raporu): bu
 * fonksiyon(lar) tarayıcı geliştirici konsolundan doğrudan JS state
 * manipülasyonuna karşı MUTLAK bir güvenlik sağlayamaz — ama artık yetki
 * verisinin KENDİSİ (localStorage'ın aksine) gerçek bir Supabase RLS
 * sınırının (provider_service_authorizations, `provider_id = auth.uid()
 * or is_admin()`) arkasındadır, bu yüzden bu modülü atlatan bir kullanıcı
 * bile KENDİ yetkisini asla DEĞİŞTİREMEZ — yalnızca (teorik olarak) zaten
 * doğru olan veriyi render etmemeyi seçebilir. Gerçek yetkilendirme sınırı
 * her zaman olduğu gibi Supabase RLS/RPC katmanıdır (provider_can_view_
 * category, create_offer/accept_offer — bkz. migration 0038).
 */

/** Bir ilanın kararlı katalog kategori id'sini çözer — eski (düz metin) ve yeni (id) kayıtların ikisiyle de çalışır. */
function resolveJobCategoryId(job: Job): string | null {
  return resolveLegacyJobCategoryToId(job.category);
}

/**
 * "Ortak İlan Görünürlüğü" görevi — İş Makinesi Hizmetleri (forklift/reach-
 * stacker/vinç/manlift) ve Operatör Hizmetleri (bunların operatörlü
 * karşılıkları) — supabase/migrations/0076'daki
 * `provider_can_view_category_or_group`in AYNI 8 kategori id'si (SQL bunu
 * elle senkron tutar, migration 0044'ün PROVIDER_AUTHORIZATION_GROUPS
 * kuralıyla AYNI ilke). BU LİSTE YALNIZCA GÖRÜNÜRLÜK içindir — teklif verme
 * yetkisi (offers.ts#canProviderSubmitNewOffer/createOffer) BUNU HİÇ
 * OKUMAZ, hâlâ tek kategoriye tam eşleşme arar (bkz. o dosyanın kendi
 * dokümanı) — gerçek sınır zaten RLS/RPC'de aynı şekilde ayrıldı
 * (provider_can_view_job vs. değişmeyen provider_can_view_category).
 */
const SHARED_HEAVY_EQUIPMENT_OPERATOR_CATEGORY_IDS: readonly string[] = [
  "forklift",
  "reach-stacker",
  "vinc",
  "manlift",
  "forklift-operatoru",
  "reach-stacker-operatoru",
  "vinc-operatoru",
  "manlift-operatoru",
];

/**
 * Bir provider'ın GÖRÜNÜRLÜK amaçlı yetkili sayılıp sayılmadığını kontrol
 * eder — `jobCategoryId` paylaşılan İş Makinesi/Operatör grubundaysa,
 * `authorizedServiceCategoryIds`in GRUP İÇİNDEKİ HERHANGİ BİR kategoriyi
 * içermesi yeterlidir; değilse (her zamanki gibi) tam eşleşme aranır.
 */
function isAuthorizedForVisibility(jobCategoryId: string, authorizedServiceCategoryIds: string[]): boolean {
  if (SHARED_HEAVY_EQUIPMENT_OPERATOR_CATEGORY_IDS.includes(jobCategoryId)) {
    return authorizedServiceCategoryIds.some((id) => SHARED_HEAVY_EQUIPMENT_OPERATOR_CATEGORY_IDS.includes(id));
  }
  return authorizedServiceCategoryIds.includes(jobCategoryId);
}

/**
 * Saf karar mantığı — hem düz fonksiyonlar hem reaktif hook'lar tarafından
 * paylaşılır (dört dış API de artık BU TEK fonksiyona delege eder — önceden
 * `filterVisibleJobs`/`useFilterVisibleJobs` aynı kontrolü KENDİ İÇLERİNDE
 * ayrı ayrı tekrar ediyordu, bu bir tutarsızlık riskiydi). `authorizedService
 * CategoryIds`, çağıranın (düz okuma ya da reaktif hook) elde ettiği GÜNCEL,
 * admin-onaylı hizmet kümesidir.
 *
 * "İlan–Depocu Uygunluk Eşleştirmesi" (migration 0059, görev bölüm 7):
 * kategori-seviyesi üyelik ARTIK Konteyner Depolama için YETERLİ DEĞİL —
 * kategori yetkisi geçtikten SONRA, `containerAuthorization` ile İLANIN HER
 * KONTEYNER GRUBUNUN gereksinimi ayrıca karşılaştırılır (bkz. storage-
 * container-catalog.ts#isProviderEligibleForContainerJob, migration 0059'daki
 * `provider_can_view_job` SQL fonksiyonu İLE ELLE SENKRON tutulan AYNI
 * mantık — bu istemci tarafı kontrol yalnızca UI'ı erken gizlemek içindir,
 * GERÇEK yetkilendirme sınırı her zaman olduğu gibi RLS/RPC katmanıdır, bkz.
 * bu dosyanın üstündeki "MİMARİ SINIRLAMA" notu).
 */
function resolveVisibility(
  session: Session | null,
  authorizedServiceCategoryIds: string[],
  containerAuthorization: ContainerStorageAuthorization | null,
  authorizedStorageRiskGroupIds: string[],
  recyclingActivityIds: string[],
  recyclingWasteCodes: string[],
  job: Job | null,
  // "Ortak İlan Görünürlüğü" görevi — bulunan gerçek açık: offers.ts#
  // canProviderSubmitNewOffer/createOffer bu fonksiyonun (isJobVisibleToSession
  // üzerinden) SONUCUNU doğrudan "teklif verebilir mi" kapısı olarak
  // kullanıyordu — İş Makinesi/Operatör grubu görünürlüğü genelleşince bu
  // TEKLİF yetkisini de İSTEMEDEN genişletirdi (görev talimatının kendi
  // açık uyardığı tam senaryo). `forOffer: true` iken grup genişlemesi
  // uygulanmaz, yalnızca TAM kategori eşleşmesi aranır — SQL tarafında
  // provider_can_view_job (grup-farkında) ile değişmeyen
  // provider_can_view_category (tam eşleşme) arasındaki AYNI ayrım.
  forOffer: boolean = false,
): boolean {
  if (!job) return true;
  if (!session || session.role !== "hizmet-veren") return true;
  const jobCategoryId = resolveJobCategoryId(job);
  const isAuthorized = forOffer
    ? authorizedServiceCategoryIds.includes(jobCategoryId ?? "")
    : jobCategoryId !== null && isAuthorizedForVisibility(jobCategoryId, authorizedServiceCategoryIds);
  if (jobCategoryId === null || !isAuthorized) return false;
  if (jobCategoryId === STORAGE_CONTAINER_CATEGORY_ID) {
    return isProviderEligibleForContainerJob(job.storageContainerGroups, containerAuthorization);
  }
  if (isHazardousStorageCategory(jobCategoryId)) {
    return isProviderEligibleForHazardousStorageJob(job.storageHazardous, job.storageRiskGroups, authorizedStorageRiskGroupIds);
  }
  if (isRecyclingCategory(jobCategoryId)) {
    return isProviderEligibleForRecyclingJob(job, recyclingActivityIds, recyclingWasteCodes);
  }
  return true;
}

/**
 * Tek bir ilan için görünürlük kontrolü — DÜZ (reaktif olmayan), önceden
 * doldurulmuş önbelleği senkron okur. Bileşen içinde SÜREGELEN bir render
 * bağlamında kullanılacaksa bunun yerine `useIsJobVisibleToSession` tercih
 * edilmelidir (bkz. bu dosyanın üstündeki dokümantasyon).
 */
export function isJobVisibleToSession(session: Session | null, job: Job | null): boolean {
  if (!job) return true;
  if (!session || session.role !== "hizmet-veren") return true;
  const authorizedServiceCategoryIds = getAuthorizedServiceCategoryIdsSync(session.id);
  const containerAuthorization = getAuthorizedContainerScopesSync(session.id);
  const authorizedStorageRiskGroupIds = getAuthorizedStorageRiskGroupIdsSync(session.id);
  const recyclingActivityIds = getAuthorizedRecyclingActivityIdsSync(session.id);
  const recyclingWasteCodes = getAuthorizedRecyclingWasteCodesSync(session.id);
  return resolveVisibility(
    session,
    authorizedServiceCategoryIds,
    containerAuthorization,
    authorizedStorageRiskGroupIds,
    recyclingActivityIds,
    recyclingWasteCodes,
    job,
  );
}

/**
 * "Ortak İlan Görünürlüğü" görevi — `isJobVisibleToSession` İLE AYNI alt
 * yapıyı (kategori yetkisi + konteyner/tehlikeli-depolama/geri-dönüşüm
 * uygunluğu) paylaşır, ama İş Makinesi/Operatör GRUP genişlemesi UYGULANMAZ
 * — yalnızca gerçekten yetkili olunan TEK kategori `true` döner. Teklif
 * verilebilirliğinin (offers.ts#canProviderSubmitNewOffer/createOffer) TEK
 * doğru kaynağı budur; `isJobVisibleToSession` artık YALNIZCA "bu ilan
 * ekranda görünsün mü" sorusuna cevap verir, teklif yetkisiyle
 * KARIŞTIRILMAMALIDIR.
 */
export function isProviderAuthorizedToOfferOnJob(session: Session | null, job: Job | null): boolean {
  if (!job) return true;
  if (!session || session.role !== "hizmet-veren") return true;
  const authorizedServiceCategoryIds = getAuthorizedServiceCategoryIdsSync(session.id);
  const containerAuthorization = getAuthorizedContainerScopesSync(session.id);
  const authorizedStorageRiskGroupIds = getAuthorizedStorageRiskGroupIdsSync(session.id);
  const recyclingActivityIds = getAuthorizedRecyclingActivityIdsSync(session.id);
  const recyclingWasteCodes = getAuthorizedRecyclingWasteCodesSync(session.id);
  return resolveVisibility(
    session,
    authorizedServiceCategoryIds,
    containerAuthorization,
    authorizedStorageRiskGroupIds,
    recyclingActivityIds,
    recyclingWasteCodes,
    job,
    true,
  );
}

/** `isJobVisibleToSession`in dizi üzerindeki kısayolu — sıralamayı korur, yalnızca görünmeyen ilanları eler. */
export function filterVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  if (!session || session.role !== "hizmet-veren") return jobs;
  const authorizedServiceCategoryIds = getAuthorizedServiceCategoryIdsSync(session.id);
  const containerAuthorization = getAuthorizedContainerScopesSync(session.id);
  const authorizedStorageRiskGroupIds = getAuthorizedStorageRiskGroupIdsSync(session.id);
  const recyclingActivityIds = getAuthorizedRecyclingActivityIdsSync(session.id);
  const recyclingWasteCodes = getAuthorizedRecyclingWasteCodesSync(session.id);
  return jobs.filter((job) =>
    resolveVisibility(
      session,
      authorizedServiceCategoryIds,
      containerAuthorization,
      authorizedStorageRiskGroupIds,
      recyclingActivityIds,
      recyclingWasteCodes,
      job,
    ),
  );
}

/** `isJobVisibleToSession`in REAKTİF hâli — bkz. bu dosyanın üstündeki dokümantasyon. `job` henüz çözülmemişse (`null`) `true` döner, çağıran taraf ayrıca kendi "bulunamadı" kontrolünü uygular. */
export function useIsJobVisibleToSession(session: Session | null, job: Job | null): boolean {
  const providerId = session?.role === "hizmet-veren" ? session.id : undefined;
  const authorizedServiceCategoryIds = useAuthorizedServiceCategoryIds(providerId);
  const containerAuthorization = useAuthorizedContainerScopes(providerId);
  const authorizedStorageRiskGroupIds = useAuthorizedStorageRiskGroupIds(providerId);
  const { activityIds: recyclingActivityIds, wasteCodes: recyclingWasteCodes } = useAuthorizedRecyclingScopes(providerId);
  return resolveVisibility(
    session,
    authorizedServiceCategoryIds,
    containerAuthorization,
    authorizedStorageRiskGroupIds,
    recyclingActivityIds,
    recyclingWasteCodes,
    job,
  );
}

/** `filterVisibleJobs`in REAKTİF hâli — bkz. bu dosyanın üstündeki dokümantasyon. */
export function useFilterVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  const providerId = session?.role === "hizmet-veren" ? session.id : undefined;
  const authorizedServiceCategoryIds = useAuthorizedServiceCategoryIds(providerId);
  const containerAuthorization = useAuthorizedContainerScopes(providerId);
  const authorizedStorageRiskGroupIds = useAuthorizedStorageRiskGroupIds(providerId);
  const { activityIds: recyclingActivityIds, wasteCodes: recyclingWasteCodes } = useAuthorizedRecyclingScopes(providerId);
  return useMemo(
    () =>
      jobs.filter((job) =>
        resolveVisibility(
          session,
          authorizedServiceCategoryIds,
          containerAuthorization,
          authorizedStorageRiskGroupIds,
          recyclingActivityIds,
          recyclingWasteCodes,
          job,
        ),
      ),
    [session, authorizedServiceCategoryIds, containerAuthorization, authorizedStorageRiskGroupIds, recyclingActivityIds, recyclingWasteCodes, jobs],
  );
}
