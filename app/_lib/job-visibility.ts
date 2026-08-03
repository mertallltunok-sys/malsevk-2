"use client";

import { useMemo } from "react";
import { getProviderServiceCategoryIds } from "./provider-services";
import {
  GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
  NAKLIYE_SERVICE_CATEGORY_ID,
  resolveLegacyJobCategoryToId,
} from "./service-catalog";
import type { Job, Session } from "./types";
import { useProviderServiceCategoryIds } from "./use-provider-services";

/**
 * İZOLE EDİLMİŞ HİZMETLERE ÖZEL keşif izolasyonu — TEK doğruluk kaynağı.
 * Yalnızca aşağıdaki `ISOLATED_SERVICE_CATEGORY_IDS` listesindeki hizmetlere
 * uygulanır (bugün: Nakliye ve Gümrük Müşavirliği); diğer hizmetlere
 * (Lashing/Gözetim/Depolama/Forklift/Konteyner Dolum/Konteyner Boşaltım/vb.)
 * HİÇ uygulanmaz ve bu bilerek böyledir (görev gereksinimi: "bu özel
 * izolasyon şimdilik diğer hizmetlere uygulanmayacak"). Gümrük Müşavirliği,
 * Nakliye'nin İLK sürümdeki tek-kategorili halinin AYNI mantığının ikinci bir
 * kategoriye genellenmiş hâlidir — Nakliye'nin kendi davranışı bu genellemeyle
 * BİREBİR aynı kalır (bkz. aşağıdaki `resolveVisibility` dokümantasyonu).
 *
 * Kural: `provider-services.ts` (tek doğruluk kaynağı, bkz. o dosya) üzerinde
 * kayıtlı hizmetleri arasında izole edilmiş hizmetlerden EN AZ BİRİ bulunan
 * bir Hizmet Veren, ilan keşfi bakımından yalnızca KENDİ SEÇTİĞİ izole
 * hizmet(ler)in kategorili ilanlarını görebilir — izole olmayan başka
 * hizmetler de seçilmiş olsa bile (Nakliye + Lashing seçiliyse hâlâ yalnızca
 * Nakliye; Gümrük Müşavirliği + Lashing seçiliyse hâlâ yalnızca Gümrük
 * Müşavirliği). Hem Nakliye HEM Gümrük Müşavirliği seçiliyse (görev
 * kapsamında öngörülmeyen ama engellenmeyen bir kombinasyon) bu iki izole
 * kategorinin BİRLEŞİMİ (union) görünür kalır — kesişim değil; bu, tek bir
 * izole kategori seçen mevcut Nakliye sağlayıcılarının davranışını hiç
 * DEĞİŞTİRMEZ (aşağıdaki `getSelectedIsolatedCategoryIds` tek elemanlı bir
 * kümede zaten aynı sonucu üretir), yalnızca iki izole kategoriyi birden
 * seçen yeni/nadir bir durumu makul şekilde ele alır. Hiçbir izole kategori
 * seçili DEĞİLSE bu fonksiyon mevcut davranışı hiç değiştirmez (her ilan
 * görünür kalır, bugüne kadar olduğu gibi).
 *
 * Hizmet Alan/admin/misafir (oturum yok) bu kuraldan HİÇ etkilenmez — kural
 * yalnızca "hizmet-veren" rolü ve yalnızca izole bir hizmet seçili olduğunda
 * devreye girer.
 *
 * BU MODÜL, ilan görünürlüğünün TEK merkezi kapısıdır — hiçbir ekran kendi
 * `job.category === "nakliye"` (ya da "gumruk-musavirligi") kontrolünü
 * yazmamalı, bunun yerine bu dosyadaki fonksiyonlardan/hook'lardan birini
 * kullanmalıdır:
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

/**
 * Keşif izolasyonu uygulanan hizmet kategorisi id'lerinin TEK listesi — yeni
 * bir hizmete bu izolasyon gerekirse TEK eklenmesi gereken yer burasıdır.
 * Sırasız bir küme olarak ele alınır (görüntüleme sırası bu listeden ASLA
 * türetilmez, bkz. service-catalog.ts#getServiceCategoryOrderIndex).
 */
const ISOLATED_SERVICE_CATEGORY_IDS: readonly string[] = [
  NAKLIYE_SERVICE_CATEGORY_ID,
  GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
];

/** Bir Hizmet Veren'in seçtiği hizmetler arasından yalnızca izole edilmiş olanları döner — sırası `serviceCategoryIds`inkiyle aynıdır. */
function getSelectedIsolatedCategoryIds(serviceCategoryIds: string[]): string[] {
  return serviceCategoryIds.filter((id) => ISOLATED_SERVICE_CATEGORY_IDS.includes(id));
}

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
  const isolatedSelected = getSelectedIsolatedCategoryIds(serviceCategoryIds);
  if (isolatedSelected.length === 0) return true;
  const jobCategoryId = resolveJobCategoryId(job);
  return jobCategoryId !== null && isolatedSelected.includes(jobCategoryId);
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
 * yalnızca görünmeyen ilanları eler. Normal (izole bir hizmete kilitlenmemiş)
 * bir oturum için bu her zaman girdiyle AYNI içeriği (referans olarak farklı
 * ama elemanları birebir aynı bir dizi) döner — bu yüzden aşağı akıştaki
 * hiçbir kod bu filtrenin var olup olmadığını bilmek/dallanmak ZORUNDA değildir.
 */
export function filterVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  if (!session || session.role !== "hizmet-veren") return jobs;
  const serviceCategoryIds = getProviderServiceCategoryIds(session.id);
  const isolatedSelected = getSelectedIsolatedCategoryIds(serviceCategoryIds);
  if (isolatedSelected.length === 0) return jobs;
  return jobs.filter((job) => {
    const jobCategoryId = resolveJobCategoryId(job);
    return jobCategoryId !== null && isolatedSelected.includes(jobCategoryId);
  });
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
    const isolatedSelected = getSelectedIsolatedCategoryIds(serviceCategoryIds);
    if (isolatedSelected.length === 0) return jobs;
    return jobs.filter((job) => {
      const jobCategoryId = resolveJobCategoryId(job);
      return jobCategoryId !== null && isolatedSelected.includes(jobCategoryId);
    });
  }, [session, serviceCategoryIds, jobs]);
}
