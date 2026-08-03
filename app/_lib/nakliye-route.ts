import { FACILITY_FREE_TEXT_VALUE, STANDARD_MANUAL_FACILITY_OPTION_LABEL } from "./job-location";
import { isTransportationCategory } from "./product-catalog";
import {
  getDistrictId,
  getFacilitiesByProvinceAndDistrict,
  getFacilityTypeLabel,
  getProvinceCodeByName,
  getProvinceIdByCode,
  type Facility,
} from "./turkey-locations";
import type { Job } from "./types";

export { isTransportationCategory };
export { FACILITY_FREE_TEXT_VALUE as PICKUP_MANUAL_LOCATION_VALUE };

/** Bkz. types.ts#Job.deliveryLocationType — merkezi sabit, hiçbir dosya "facility"/"open_address" değerlerini kendi başına elle yazmaz. */
export type NakliyeLocationType = "facility" | "open_address";

/**
 * "Teslim Edilecek Yer" Liman/Sanayi/OSB combobox'ındaki sentetik seçeneğin
 * value'su — job-location.ts#FACILITY_FREE_TEXT_VALUE ile AYNI desen (gerçek
 * Facility.id'lerle asla çakışmaz), pickup'ınkinden AYRI bir sabit çünkü
 * delivery job.facilityId'yi DEĞİL job.deliveryFacilityId'yi kullanır — ikisi
 * farklı Job alanlarına yazıldığı için aynı sentinel'i paylaşmaları
 * gerekmez/gerekse de sorun olmaz, ayrı tutulması yalnızca okunabilirlik
 * içindir. Seçildiğinde deliveryLocationType "open_address" olarak kaydedilir.
 */
export const DELIVERY_MANUAL_LOCATION_VALUE = "__nakliye_teslim_manuel__";

/**
 * Nakliye'nin Yük Alınacak Yer/Teslim Edilecek Yer combobox'larındaki
 * sentetik "manuel adres" seçeneğinin GÖRÜNEN etiketi — Nakliye dışındaki
 * (Gümrük Müşavirliği HARİÇ) kategorilerin kendi "Liman / Sanayi / OSB"
 * alanıyla (job-location.ts#STANDARD_MANUAL_FACILITY_OPTION_LABEL) AYNI
 * metni paylaşır, bu yüzden ayrı bir string literal TUTULMAZ; doğruluk
 * kaynağı job-location.ts'tedir, burada yalnızca yeniden dışa aktarılır.
 */
export const NAKLIYE_MANUAL_LOCATION_OPTION_LABEL = STANDARD_MANUAL_FACILITY_OPTION_LABEL;

export type FacilitySelectOption = { value: string; label: string; hint?: string; keywords?: string[] };

/**
 * job-location.ts#toFacilitySelectOptions'ın Nakliye için karşılığı — sentetik
 * seçeneğin etiketi ARTIK job-location.ts#STANDARD_MANUAL_FACILITY_OPTION_LABEL
 * ile BİREBİR aynıdır (bkz. NAKLIYE_MANUAL_LOCATION_OPTION_LABEL). Ayrı bir
 * fonksiyon olarak kalmasının TEK nedeni sentinel `value`sinin çağırandan
 * (`manualValue`) gelmesidir: pickup PICKUP_MANUAL_LOCATION_VALUE, delivery
 * DELIVERY_MANUAL_LOCATION_VALUE kullanır — ikisi ayrı Job alanlarına
 * yazıldığı için çakışma riski yoktur.
 */
export function toNakliyeFacilitySelectOptions(facilities: Facility[], manualValue: string): FacilitySelectOption[] {
  return [
    ...facilities
      .map((facility) => ({
        value: facility.id,
        label: facility.name,
        hint: getFacilityTypeLabel(facility.type),
        keywords: facility.aliases,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr")),
    { value: manualValue, label: NAKLIYE_MANUAL_LOCATION_OPTION_LABEL },
  ];
}

/**
 * Veri kayıt katmanı (job-store.ts) için: verilen il/ilçe kapsamında GERÇEKTEN
 * var olan bir Facility.id mi — görev tanımı madde 5 "Bu doğrulama yalnızca
 * form arayüzünde değil, veri kayıt katmanında da yapılmalıdır"ın uygulama
 * noktası. Yalnızca Nakliye'nin pickup/delivery alanları için çağrılır (bkz.
 * job-store.ts#resolveDeliveryLocationFields/resolveNakliyePickupOverrides) —
 * il/ilçe adı geçersizse ya da tesis o kapsamda bulunamıyorsa false döner;
 * çağıran taraf bu durumda facilityId'yi SESSİZCE reddeder (kaydetmez),
 * "başka ilçeye ait tesis kesinlikle kaydedilememeli" kuralının veri
 * katmanındaki karşılığı.
 */
export function isFacilityInProvinceDistrict(provinceName: string, districtName: string, facilityId: string): boolean {
  const provinceCode = getProvinceCodeByName(provinceName);
  if (!provinceCode) return false;
  const provinceId = getProvinceIdByCode(provinceCode);
  if (!provinceId) return false;
  return getFacilitiesByProvinceAndDistrict(provinceId, getDistrictId(districtName)).some(
    (facility) => facility.id === facilityId,
  );
}

/** Bir ilanda tam (province+district+locationType'a göre facility/adres) teslimat bilgisinin gerçekten girilmiş olup olmadığı — yalnızca Nakliye kategorisinde ve tüm zorunlu alanlar doluysa true. Eski/kapsam dışı kalıntı veriyi (bkz. product-catalog.ts#hasProductInfo ile AYNI ilke) yanlışlıkla göstermemek için her okuma noktası bunu kontrol eder. */
export function hasNakliyeRouteInfo(job: Pick<Job, "category" | "deliveryProvince" | "deliveryDistrict" | "deliveryLocationType">): boolean {
  if (!isTransportationCategory(job.category)) return false;
  return Boolean(job.deliveryProvince && job.deliveryDistrict && job.deliveryLocationType);
}

export type NakliyeRouteSide = {
  province: string;
  district: string;
  locationType: NakliyeLocationType;
  /**
   * Katalogdan seçilmiş tesisin adı YA DA kullanıcının serbestçe yazdığı
   * liman/sanayi/OSB adı — kaynağı ne olursa olsun HER ZAMAN doludur (bkz.
   * görev tanımı madde 1/9/10/11: manuel girilen ad, "Listede yok, kendim
   * gireceğim" METNİ değil, kullanıcının yazdığı GERÇEK ad olarak gösterilir).
   * `null` yalnızca bu alandan ÖNCE oluşturulmuş, hiç ad taşımayan eski
   * kayıtlarda görülür (geriye dönük uyumluluk — bkz. hasNakliyeRouteInfo'nun
   * kendisi bu durumu bir hata saymaz).
   */
  facilityName: string | null;
  /** Açık adres metni — GİZLİ alan (bkz. types.ts#Job.addressText/deliveryAddressText dokümanı), çağıran taraf kendi gizlilik kontrolünü (job-requests.ts#canViewJobAddress) uygular. Artık locationType'a bakılmaksızın (facility ya da open_address) HER ZAMAN doludur (bkz. görev tanımı madde 2/3). */
  addressText: string | null;
};

/**
 * Bir Nakliye ilanının güzergâhını (pickup + delivery) TEK, tutarlı bir
 * şekle çözer — job-detail-content.tsx (Taşıma Güzergâhı kartı) ve
 * job-listing-row.ts (kısa güzergâh) HEPSİ bu fonksiyonu kullanır, hiçbiri
 * kendi çözümlemesini yapmaz (bkz. görev tanımı madde 13 "Ortak Gösterim
 * Mantığı"). "Yük Alınacak Yer" (pickup) mevcut job.province/district/
 * workLocationType/addressText/locationMode alanlarından, "Teslim Edilecek
 * Yer" (delivery) delivery* alanlarından türetilir — facilityName/addressText
 * İKİSİ DE artık locationType'tan (facility/open_address) BAĞIMSIZ olarak
 * doğrudan job.workLocationType|job.deliveryFacilityName / job.addressText|
 * job.deliveryAddressText'ten okunur, çünkü her iki alan da artık seçilen
 * yönteme bakılmaksızın doldurulur (bkz. job-store.ts#resolveLocationFields/
 * resolveDeliveryLocationFields). Nakliye değilse ya da teslimat bilgisi
 * eksikse (bkz. hasNakliyeRouteInfo) null döner.
 */
export function getNakliyeRouteInfo(job: Job): { pickup: NakliyeRouteSide; delivery: NakliyeRouteSide } | null {
  if (!hasNakliyeRouteInfo(job)) return null;

  const pickup: NakliyeRouteSide = {
    province: job.province,
    district: job.district,
    locationType: job.locationMode === "custom" ? "open_address" : "facility",
    facilityName: job.workLocationType || null,
    addressText: job.addressText ?? null,
  };

  const delivery: NakliyeRouteSide = {
    province: job.deliveryProvince!,
    district: job.deliveryDistrict!,
    locationType: job.deliveryLocationType!,
    facilityName: job.deliveryFacilityName ?? null,
    addressText: job.deliveryAddressText ?? null,
  };

  return { pickup, delivery };
}

/** Aktif ilanlar ekranındaki (job-listing-row.ts/job-listing-table.tsx/job-listing-cards.tsx) KISA güzergâh gösterimi için tek bir tarafın "İl / İlçe" + tesis-ya-da-manuel-ad çifti — tam açık adres KESİNLİKLE taşınmaz (bkz. görev tanımı madde 11 "Tam açık adresi ilan kartında gösterme"). */
export type NakliyeShortRouteSide = { locationLabel: string; nameLabel: string };

/**
 * Aktif ilanlar ekranındaki KISA güzergâh gösterimi — `locationLabel`
 * ("{İl} / {İlçe}") ve `nameLabel` (katalog tesis adı ya da kullanıcının
 * yazdığı manuel ad, kaynağına bakılmaksızın) her zaman AYRI iki parça
 * olarak döner (bkz. görev tanımı madde 11 örneği: "İzmir / Aliağa" +
 * "İzmir Aliağa Limanı" iki ayrı satır). `nameLabel`, bu alandan ÖNCE
 * oluşturulmuş (hiç ad taşımayan) eski kayıtlarda BOŞ olabilir — bu durumda
 * çağıran taraf yalnızca `locationLabel`i gösterir.
 */
function formatNakliyeShortRouteSide(side: NakliyeRouteSide): NakliyeShortRouteSide {
  return {
    locationLabel: `${side.province} / ${side.district}`,
    nameLabel: side.facilityName ?? "",
  };
}

/** buildJobListingRows'un tek çağırdığı yardımcı — bkz. formatNakliyeShortRouteSide. */
export function getNakliyeShortRoute(job: Job): { pickup: NakliyeShortRouteSide; delivery: NakliyeShortRouteSide } | null {
  const route = getNakliyeRouteInfo(job);
  if (!route) return null;
  return {
    pickup: formatNakliyeShortRouteSide(route.pickup),
    delivery: formatNakliyeShortRouteSide(route.delivery),
  };
}
