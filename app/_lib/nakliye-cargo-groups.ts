import type { Job, NakliyeCargoGroup, NakliyeCargoGroupHazmat, NakliyeContainerTransport, NakliyeMeasurementInfo } from "./types";

/**
 * "Nakliye Çoklu Yük Grubu" görevi — Job.nakliyeCargoGroups[] (bkz. o alanın
 * types.ts üstündeki doküman) ile eski tekil alanlar (productQuantity/vb.,
 * nakliyeDetails.loadPreparationType/measurementInfo/containerTransport)
 * arasındaki TEK dönüştürme köprüsü. Hem localStorage (job-store.ts) hem
 * Supabase (admin-jobs.ts/supabase-job-sync.ts) yazma/okuma yolları BU
 * modülden geçer — ikinci bir kopya İCAT EDİLMEZ.
 */

/**
 * Bir ilanın "Yük Bilgileri"ni HER ZAMAN en az bir grup içeren bir dizi
 * olarak döndürür — gerçek nakliyeCargoGroups doluysa AYNEN, boşsa/yoksa
 * eski tekil alanlardan SALT OKUNUR tek elemanlı bir dizi ("Yük Grubu 1")
 * sentezler. Bu sentez depolanan job'u ASLA geriye yazmaz/mutasyona uğratmaz
 * — yalnızca gösterim/düzenleme formunun başlangıç değeridir.
 */
export function getJobCargoGroups(
  job: Pick<Job, "nakliyeCargoGroups" | "productQuantity" | "productTonnage" | "productType" | "productTonnageUnit" | "nakliyeDetails">,
): NakliyeCargoGroup[] {
  if (job.nakliyeCargoGroups && job.nakliyeCargoGroups.length > 0) return job.nakliyeCargoGroups;
  const legacyContainer = job.nakliyeDetails?.containerTransport;
  const legacyHazmat = job.nakliyeDetails?.hazmat;
  // "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — eski
  // toggle-tabanlı bir konteyner kaydının productType'ı hiç yoktur (o
  // dönemde bu alan konteyner modunda hiç doldurulmuyordu); yeni tetikleyici
  // mekanizmasının onu doğru tanıması için burada "Konteyner" SENTEZLENİR.
  const synthesized: NakliyeCargoGroup = {
    id: "legacy-group-1",
    productQuantity: job.productQuantity,
    productTonnage: job.productTonnage,
    productType: job.productType ?? (legacyContainer?.status === "evet" ? "Konteyner" : undefined),
    productTonnageUnit: job.productTonnageUnit,
    loadPreparationType: job.nakliyeDetails?.loadPreparationType,
    loadPreparationCustomText: job.nakliyeDetails?.loadPreparationCustomText,
    measurementInfo: job.nakliyeDetails?.measurementInfo,
    containerTransport: legacyContainer ?? { status: "hayir" },
    // Eski (bu görevden önce kaydedilmiş) job-seviyeli dört alanlı/tri-state
    // hazmat kaydı burada grup-seviyeli sade şekle GÜVENLİ GÖRÜNÜM olarak
    // indirgenir — "emin-degil" "hayir"a normalize edilir, unNumber/
    // properShippingName/packingGroup hiç taşınmaz (yeni grup tipinde zaten
    // yok, bkz. types.ts#NakliyeCargoGroupHazmat).
    hazmat: legacyHazmat ? ({ status: legacyHazmat.status === "evet" ? "evet" : "hayir", adrClass: legacyHazmat.adrClass } satisfies NakliyeCargoGroupHazmat) : undefined,
  };
  return [synthesized];
}

export type NakliyeCargoGroupsLegacyMirror = {
  productQuantity?: number;
  productTonnage?: number;
  productType?: string;
  productTonnageUnit?: "ton" | "kg";
  nakliyeLoadPreparationType?: string;
  nakliyeLoadPreparationCustomText?: string;
  nakliyeMeasurementInfo?: NakliyeMeasurementInfo;
  nakliyeContainerTransport: NakliyeContainerTransport;
  /** Grup başına ADR'ın (bkz. types.ts#NakliyeCargoGroupHazmat) İLK grubun aynası — job-seviyeli eski `NakliyeDetails.hazmat` alanının YENİ tek yazma kaynağı. */
  nakliyeHazmat?: NakliyeCargoGroupHazmat;
};

/**
 * Yazma anında (job-store.ts#resolveNakliyeCargoGroups, admin-jobs.ts,
 * supabase-job-sync.ts) gerçek grup dizisinin İLK elemanını eski tekil
 * alanların şekline "aynalar" — cargo-groups-farkında OLMAYAN eski
 * okuyucuların (job-listing-row.ts, product-catalog.ts#hasProductInfo vb.)
 * en azından ilk grubu doğru göstermeye devam etmesi içindir (bkz.
 * Job.nakliyeCargoGroups üstündeki doküman). `groups` her zaman en az bir
 * eleman içerir (bkz. getJobCargoGroups/form katmanının kendi "en az 1 grup"
 * kısıtı) — yine de savunmacı bir "hayir" varsayılanı döner.
 */
export function deriveLegacyMirrorFields(groups: NakliyeCargoGroup[]): NakliyeCargoGroupsLegacyMirror {
  const first = groups[0];
  if (!first) return { nakliyeContainerTransport: { status: "hayir" } };
  return {
    productQuantity: first.productQuantity,
    productTonnage: first.productTonnage,
    productType: first.productType,
    productTonnageUnit: first.productTonnageUnit,
    nakliyeLoadPreparationType: first.loadPreparationType,
    nakliyeLoadPreparationCustomText: first.loadPreparationCustomText,
    nakliyeMeasurementInfo: first.measurementInfo,
    nakliyeContainerTransport: first.containerTransport,
    nakliyeHazmat: first.hazmat,
  };
}

/** Görüntüleme katmanının (job-detail-content.tsx/admin-job-detail.tsx) paylaştığı tek başlık üretimi — "Yük Grubu N" biçimi, hiçbir yerde elle tekrarlanmaz. */
export function formatCargoGroupTitle(index: number): string {
  return `Yük Grubu ${index + 1}`;
}
