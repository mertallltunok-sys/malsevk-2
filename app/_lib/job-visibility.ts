"use client";

import { useMemo } from "react";
import { getProviderServiceCategoryIds } from "./provider-services";
import { NAKLIYE_SERVICE_CATEGORY_ID, resolveLegacyJobCategoryToId } from "./service-catalog";
import type { Job, Session } from "./types";
import { useProviderServiceCategoryIds } from "./use-provider-services";

/**
 * NAKLİYE'YE ÖZEL keşif izolasyonu — TEK doğruluk kaynağı. Diğer altı hizmete
 * (Lashing/Gözetim/Depolama/Forklift/Konteyner Dolum/Konteyner Boşaltım) HİÇ
 * uygulanmaz ve bu bilerek böyledir (görev gereksinimi: "bu özel izolasyon
 * şimdilik diğer hizmetlere uygulanmayacak").
 *
 * Kural: `provider-services.ts` (tek doğruluk kaynağı, bkz. o dosya) üzerinde
 * kayıtlı hizmetleri arasında Nakliye BULUNAN bir Hizmet Veren, ilan keşfi
 * bakımından yalnızca Nakliye kategorili ilanları görebilir — başka hizmetler
 * de seçilmiş olsa bile (Nakliye + Lashing seçiliyse hâlâ yalnızca Nakliye).
 * Nakliye seçili DEĞİLSE bu fonksiyon mevcut davranışı hiç değiştirmez (her
 * ilan görünür kalır, bugüne kadar olduğu gibi).
 *
 * Hizmet Alan/admin/misafir (oturum yok) bu kuraldan HİÇ etkilenmez — kural
 * yalnızca "hizmet-veren" rolü ve yalnızca Nakliye seçili olduğunda devreye
 * girer.
 *
 * BU MODÜL, ilan görünürlüğünün TEK merkezi kapısıdır — hiçbir ekran kendi
 * `job.category === "nakliye"` kontrolünü yazmamalı, bunun yerine bu dosyadaki
 * fonksiyonlardan/hook'lardan birini kullanmalıdır:
 *  - `isJobVisibleToSession`/`filterVisibleJobs`: DÜZ (reaktif olmayan)
 *    fonksiyonlar — her çağrıda localStorage'ı TAZE okur ama bir React
 *    bileşenini OTOMATİK yeniden render ETMEZ. Bileşen dışı, tek seferlik
 *    kontroller için (ör. offers.ts#createOffer/canProviderSubmitNewOffer —
 *    bunlar zaten her tıklamada yeniden çağrılır, süregelen bir render'a
 *    abone olmaları gerekmez).
 *  - `useIsJobVisibleToSession`/`useFilterVisibleJobs`: AYNI mantığın
 *    `useProviderServiceCategoryIds` (bkz. use-provider-services.ts) üzerinden
 *    REAKTİF hâli — bir React bileşeninin SÜREGELEN render'ında kullanılmalı
 *    (provider-job-listing.tsx, job-detail-content.tsx, operation-status-card.tsx).
 *    Hizmet seçimi değiştiğinde (aynı sekmede ya da `storage` olayıyla farklı
 *    bir sekmede) bu hook'u kullanan bileşen SAYFA YENİLENMEDEN otomatik
 *    yeniden render olur — "provider hizmetleri değiştiğinde açık sekmede
 *    görünürlük anında güncellensin" gereksinimi budur.
 *  İkisi de AYNI saf `resolveVisibility` mantığını paylaşır — mantık iki
 *  yerde tekrar yazılmaz, yalnızca hizmet id'lerinin NASIL elde edildiği
 *  (düz okuma vs. reaktif hook) farklıdır.
 *
 * Süzme EN ERKEN noktada (veri okunduğu an, ör. `useAllJobs()`'tan hemen
 * sonra) yapılmalıdır — bu sayede aşağı akıştaki TÜM hesaplamalar (operasyon
 * gruplama toplamları, teklif sayıları, filtre sonuçları vb.) hiçbir ek
 * değişikliğe gerek kalmadan otomatik olarak doğru/izole sonuç üretir (bkz.
 * job-listing-row.ts#groupJobListingRowsByOperation'ın "rows TÜM ilanlar
 * olmalı" varsayımı — bu varsayım hâlâ doğrudur, yalnızca "TÜM" artık bu
 * view'cı için "TÜM GÖRÜNÜR" anlamına gelir).
 *
 * MİMARİ SINIRLAMA: bu projede gerçek bir backend/sunucu tarafı oturum
 * doğrulaması yok (bkz. CLAUDE.md "No real backend") — tüm veri (jobs,
 * provider-services) tarayıcının kendi localStorage'ında düz metin olarak
 * durur. Bu fonksiyon (ve onu çağıran her ekran) tarayıcı geliştirici
 * konsolundan doğrudan localStorage/JS state manipülasyonuna karşı MUTLAK bir
 * güvenlik sağlayamaz — teknik olarak yetkili bir kullanıcı kendi
 * tarayıcısında bu kısıtlamayı atlatabilir. Sağlanan garanti, UYGULAMANIN
 * KENDİ NORMAL kullanım yüzeyinin (linkler, doğrudan URL, bildirimler, teklif
 * formu, "Verdiğim Teklifler" geçmişi vb.) HİÇBİRİNİN gizli ilan bilgisini
 * sızdırmamasıdır — sunucu tarafı bir yetkilendirme sınırı değildir.
 */

/** Bir ilanın kararlı katalog kategori id'sini çözer — eski (düz metin) ve yeni (id) kayıtların ikisiyle de çalışır. */
function resolveJobCategoryId(job: Job): string | null {
  return resolveLegacyJobCategoryToId(job.category);
}

/**
 * Saf karar mantığı — hem düz fonksiyonlar hem reaktif hook'lar tarafından
 * paylaşılır. `serviceCategoryIds`, çağıranın (düz okuma ya da reaktif hook)
 * elde ettiği, ZATEN `isServiceCategoryId` ile süzülmüş (bkz.
 * provider-services.ts/use-provider-services.ts) güncel hizmet kümesidir.
 */
/** `job` yoksa (zaten "bulunamadı" olarak ele alınacak) bilerek `true` döner — bu fonksiyon yalnızca VAR OLAN bir ilanın gizlenip gizlenmeyeceğine karar verir. */
function resolveVisibility(session: Session | null, serviceCategoryIds: string[], job: Job | null): boolean {
  if (!job) return true;
  if (!session || session.role !== "hizmet-veren") return true;
  if (!serviceCategoryIds.includes(NAKLIYE_SERVICE_CATEGORY_ID)) return true;
  return resolveJobCategoryId(job) === NAKLIYE_SERVICE_CATEGORY_ID;
}

/**
 * Tek bir ilan için görünürlük kontrolü — DÜZ (reaktif olmayan), her
 * çağrıda localStorage'ı taze okur. Bileşen içinde SÜREGELEN bir render
 * bağlamında kullanılacaksa bunun yerine `useIsJobVisibleToSession` tercih
 * edilmelidir (bkz. bu dosyanın üstündeki dokümantasyon).
 */
export function isJobVisibleToSession(session: Session | null, job: Job | null): boolean {
  if (!job) return true;
  if (!session || session.role !== "hizmet-veren") return true;
  const serviceCategoryIds = getProviderServiceCategoryIds(session.id);
  return resolveVisibility(session, serviceCategoryIds, job);
}

/**
 * `isJobVisibleToSession`in dizi üzerindeki kısayolu — sıralamayı korur,
 * yalnızca görünmeyen ilanları eler. Normal (Nakliye'ye kilitlenmemiş) bir
 * oturum için bu her zaman girdiyle AYNI içeriği (referans olarak farklı ama
 * elemanları birebir aynı bir dizi) döner — bu yüzden aşağı akıştaki hiçbir
 * kod bu filtrenin var olup olmadığını bilmek/dallanmak ZORUNDA değildir.
 */
export function filterVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  if (!session || session.role !== "hizmet-veren") return jobs;
  const serviceCategoryIds = getProviderServiceCategoryIds(session.id);
  if (!serviceCategoryIds.includes(NAKLIYE_SERVICE_CATEGORY_ID)) return jobs;
  return jobs.filter((job) => resolveJobCategoryId(job) === NAKLIYE_SERVICE_CATEGORY_ID);
}

/** `isJobVisibleToSession`in REAKTİF hâli — bkz. bu dosyanın üstündeki dokümantasyon. `job` henüz çözülmemişse (`null`) `true` döner, çağıran taraf ayrıca kendi "bulunamadı" kontrolünü uygular. */
export function useIsJobVisibleToSession(session: Session | null, job: Job | null): boolean {
  const serviceCategoryIds = useProviderServiceCategoryIds(session?.role === "hizmet-veren" ? session.id : undefined);
  return resolveVisibility(session, serviceCategoryIds, job);
}

/** `filterVisibleJobs`in REAKTİF hâli — bkz. bu dosyanın üstündeki dokümantasyon. */
export function useFilterVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  const serviceCategoryIds = useProviderServiceCategoryIds(session?.role === "hizmet-veren" ? session.id : undefined);
  return useMemo(() => {
    if (!session || session.role !== "hizmet-veren") return jobs;
    if (!serviceCategoryIds.includes(NAKLIYE_SERVICE_CATEGORY_ID)) return jobs;
    return jobs.filter((job) => resolveJobCategoryId(job) === NAKLIYE_SERVICE_CATEGORY_ID);
  }, [session, serviceCategoryIds, jobs]);
}
