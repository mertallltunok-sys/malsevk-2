/**
 * "Nakliye Yeniden Tasarımı" — Nakliye'nin (karayolu taşımacılığı) tüm YENİ
 * yapılandırılmış alanlarının TEK merkezi kaynağı: Yükün Hazırlanış Biçimi,
 * Araç/Kasa Tercihi, Yükleme/Teslimat operasyon detayları, Özel Taşıma
 * Koşulları (ADR/Konteyner). Bu modülün ürettiği TEK obje (`NakliyeDetails`)
 * `Job.nakliyeDetails` alanında saklanır.
 *
 * "Nakliye Alan Sadeleştirmesi" görevi (bu dosyanın ikinci büyük revizyonu):
 * Taşıma Şekli, Sevkiyat Yapısı (ve ona bağlı tüm sefer/tekrar alt alanları),
 * Boşaltma Yöntemi, Sıcaklık Kontrollü ve Gabari Dışı/Ağır Yük bölümleri
 * TAMAMEN kaldırıldı — görev talimatının kendi kesin kararı. Yükün
 * Hazırlanış Biçimi (eskiden çoklu seçim + tipe özel zengin alt-form
 * kartları) ve Yükleme Yöntemi (eskiden çoklu seçim chip'leri) artık TEK
 * seçimli birer aşağı açılır menüye indirgendi — "Listede yok / Kendim
 * gireceğim" seçilirse hemen altında serbest metin alanı açılır (job-
 * location.ts#FACILITY_FREE_TEXT_VALUE İLE AYNI sentinel+manuel-alan deseni,
 * ikinci bir kalıp İCAT EDİLMEDİ). Araç Tercihi, Yükleme/Teslimat operasyon
 * detayları (Yer Tipi/Randevu/Saat/Kantar/Erişim/PPE/Süre/Bekleme/POD),
 * Tehlikeli Madde/ADR ve Konteyner Taşıması bölümleri bu görevin kapsamı
 * DIŞINDA — değişmeden kalır.
 */
import type {
  Job,
  NakliyeCargoGroup,
  NakliyeCargoGroupHazmat,
  NakliyeContainerTransport,
  NakliyeDetails,
  NakliyeHazmatDetail,
  NakliyeMeasurementInfo,
  NakliyeVehiclePreference,
} from "./types";
import {
  isProductTonnageUnit,
  isTransportationCategory,
  parseProductQuantity,
  parseProductTonnage,
  PRODUCT_TYPE_CUSTOM_VALUE,
} from "./product-catalog";
import { getImoClassOptionLabel, IMO_CLASS_OPTIONS } from "./storage-container-catalog";
import {
  MAX_CARGO_GROUPS,
  MAX_CONTAINER_QUANTITY,
  MAX_DIAMETER_CM,
  MAX_HEIGHT_CM,
  MAX_LENGTH_CM,
  MAX_PRODUCT_QUANTITY,
  MAX_ROLL_WIDTH_CM,
  MAX_STACK_COUNT,
  MAX_TONNAGE_KG,
  MAX_TONNAGE_TON,
  MAX_VOLUME_M3,
  MAX_WIDTH_CM,
  MANUAL_ENTRY_TEXT_MAX_LENGTH,
  MEASUREMENT_DECIMAL_PLACES,
} from "./field-limits";

export { isTransportationCategory };

/**
 * "Listede yok / Kendim gireceğim" sentinel değeri — hem Yükün Hazırlanış
 * Biçimi hem Yükleme Yöntemi dropdown'ları paylaşır (job-location.ts#
 * FACILITY_FREE_TEXT_VALUE İLE AYNI isimlendirme kuralı: gerçek katalog
 * id'leriyle asla çakışmayan `__`-önekli bir sentinel).
 */
export const NAKLIYE_MANUAL_ENTRY_VALUE = "__diger__";
export const NAKLIYE_MANUAL_ENTRY_OPTION_LABEL = "Listede yok / Kendim gireceğim";

/**
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — konteyner
 * akışının TEK tetikleyicisi. Eski bağımsız "Yük konteyner olarak mı
 * taşınacak?" Hayır/Evet sorusu TAMAMEN kaldırıldı; artık bir Yük Grubu'nun
 * konteyner modunda olup olmadığı doğrudan "Ürün/Yük Cinsi" alanının kendi
 * değerinden okunur. `productType` product-type-combobox.tsx'in serbest
 * metin alanı olduğu için (product-catalog.ts#NAKLIYE_PRODUCT_TYPE_SUGGESTIONS'ın
 * ilk/pinlenmiş seçeneği "Konteyner" olsa da kullanıcı bunu manuel de
 * yazabilir/farklı büyük-küçük harfle girebilir) karşılaştırma BİLEREK
 * kırpılmış+büyük/küçük harf duyarsız — yalnızca listeden TIKLANARAK
 * seçildiğinde değil, aynı kelimeyi elle yazan bir kullanıcı için de
 * güvenilir çalışsın diye (görev talimatının "Konteyner seçilince" ifadesini
 * en cömert biçimde karşılar). "Listede yok / Kendim gireceğim" (product-
 * catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE) modundaki serbest metin ASLA bu
 * kontrole girmez — konteyner yalnızca GERÇEK "Ürün/Yük Cinsi" alanının
 * kendi değeriyle tetiklenir, manuel/özel giriş yolundan DEĞİL.
 */
export const NAKLIYE_CONTAINER_PRODUCT_TYPE_VALUE = "Konteyner";
export function isNakliyeContainerProductType(productType: string | undefined): boolean {
  return typeof productType === "string" && productType.trim().toLocaleLowerCase("tr-TR") === NAKLIYE_CONTAINER_PRODUCT_TYPE_VALUE.toLocaleLowerCase("tr-TR");
}

/* ========================================================================
 * Yükün Hazırlanış Biçimi (TEK seçimli)
 * ==================================================================== */
export type LoadPreparationTypeId =
  | "paletli"
  | "kasali-sandikli"
  | "kolili-paketli"
  | "cuvalli"
  | "big-bag"
  | "balya"
  | "varil-bidon"
  | "rulo-bobin"
  | "demet-bag"
  | "dokme"
  | "konteyner-icinde"
  | "ambalajsiz";

export const LOAD_PREPARATION_TYPE_OPTIONS: readonly { id: LoadPreparationTypeId; label: string }[] = [
  { id: "paletli", label: "Paletli" },
  { id: "kasali-sandikli", label: "Kasalı / Sandıklı" },
  { id: "kolili-paketli", label: "Kolili / Paketli" },
  { id: "cuvalli", label: "Çuvallı" },
  { id: "big-bag", label: "Big Bag" },
  { id: "balya", label: "Balya" },
  { id: "varil-bidon", label: "Varil / Bidon" },
  { id: "rulo-bobin", label: "Rulo / Bobin" },
  { id: "demet-bag", label: "Demet / Bağ" },
  { id: "dokme", label: "Dökme" },
  { id: "ambalajsiz", label: "Ambalajsız" },
];
/**
 * "Konteyner İçinde" görevi — bu seçenek "Yükün Hazırlanış Biçimi"
 * dropdown'ından (LOAD_PREPARATION_TYPE_OPTIONS, yeni seçimler için TEK
 * kaynak) BİLEREK ÇIKARILDI: konteyner taşıması artık her Yük Grubu'nun
 * kendi bağımsız Hayır/Evet sorusuyla (NakliyeCargoGroup.containerTransport)
 * yönetiliyor, bu yüzden aynı bilgiyi ikinci kez soran bu seçenek gereksiz
 * hâle geldi. Development'ta bu değeri kullanan GERÇEK kayıtlar bulundu
 * (4 ilan, `npx supabase db query --linked` ile doğrulandı — bkz. görev
 * raporu) — kanıtsız silinmedi/dönüştürülmedi: eski bir kaydın
 * `loadPreparationType` alanı hâlâ "konteyner-icinde" olabilir, bu sabit
 * YALNIZCA o durumda `isLoadPreparationTypeId`in onu SESSİZCE silmemesi
 * (sanitizeNakliyeCargoGroup/sanitizeNakliyeDetails okurken)/
 * `getLoadPreparationTypeLabel`in onu doğru etiketle göstermeye devam
 * etmesi içindir — LOAD_PREPARATION_TYPE_OPTIONS'a (dropdown'a) BİR DAHA
 * EKLENMEZ. Eski bir kayıt düzenlenmek üzere açıldığında `<select>` bu
 * değerle eşleşen bir `<option>` bulamadığı için görsel olarak BOŞ
 * görünür — AMA React'in kontrollü `<select>`i kullanıcı hiç dokunmazsa
 * state'te "konteyner-icinde" DEĞİŞMEDEN kalabilir (salt boşluk-doğrulaması
 * bunu YAKALAMAZ). Bu yüzden `isSelectableLoadPreparationTypeId` (aşağıda)
 * `isLoadPreparationTypeId`den BİLEREK AYRI, DAR bir kontrol: yalnızca
 * GERÇEKTEN dropdown'da sunulan bir id mi diye bakar (legacy DAHİL DEĞİL) —
 * job-form-validation.ts#validateNakliyeCargoGroup bunu kullanarak eski
 * değeri "seçilmemiş" sayar ve kullanıcıyı kaydetmeden önce geçerli/yeni
 * bir hazırlanış biçimi seçmeye ZORLAR (görev talimatı).
 */
const LEGACY_LOAD_PREPARATION_TYPE_OPTIONS: readonly { id: LoadPreparationTypeId; label: string }[] = [
  { id: "konteyner-icinde", label: "Konteyner İçinde" },
];
export function isLoadPreparationTypeId(value: unknown): value is LoadPreparationTypeId {
  return (
    typeof value === "string" &&
    (LOAD_PREPARATION_TYPE_OPTIONS.some((option) => option.id === value) ||
      LEGACY_LOAD_PREPARATION_TYPE_OPTIONS.some((option) => option.id === value))
  );
}
/** Bkz. yukarıdaki doküman — `isLoadPreparationTypeId`den FARKLI olarak legacy id'leri (bugün yalnızca "konteyner-icinde") GEÇERSİZ sayar. Yalnızca form doğrulamasında "kullanıcı gerçekten yeni bir değer mi seçti" kontrolü için. */
export function isSelectableLoadPreparationTypeId(value: unknown): value is LoadPreparationTypeId {
  return typeof value === "string" && LOAD_PREPARATION_TYPE_OPTIONS.some((option) => option.id === value);
}
export function getLoadPreparationTypeLabel(id: string): string | undefined {
  return (
    LOAD_PREPARATION_TYPE_OPTIONS.find((option) => option.id === id)?.label ??
    LEGACY_LOAD_PREPARATION_TYPE_OPTIONS.find((option) => option.id === id)?.label
  );
}

/**
 * "MALSEVK Nakliye — Dinamik Ürün Adedi" görevi — paylaşılan "Ürün Adedi"
 * alanının (Job.productQuantity, TEK veri kaynağı — ikinci bir adet alanı
 * İCAT EDİLMEDİ) seçilen Yükün Hazırlanış Biçimi'ne göre etiketini/
 * placeholder'ını/sağ birimini belirleyen TEK merkezi eşleştirme. "dokme"
 * İSTİSNASI: `useVolumeInstead: true` iken adet alanı TAMAMEN gizlenir,
 * yerine AYNI `measurement.volumeM3` alanı ("Ölçü ve Yerleşim Bilgileri"yle
 * PAYLAŞILAN, TEK veri kaynağı — ikinci bir hacim alanı İCAT EDİLMEDİ)
 * "Yaklaşık Hacim (m³)" olarak gösterilir. Manuel hazırlanış biçiminde
 * kullanıcının yazdığı GERÇEK metin ("Sepetli" gibi) hiçbir Türkçe ek
 * ayrıştırması YAPILMADAN olduğu gibi kullanılır (bilinçli sadeleştirme —
 * güvenilir bir "çoğul eki kaldır" algoritması yok, yanlış bir dönüşüm
 * literal metinden daha kötü olurdu).
 */
export type ProductQuantityFieldConfig = {
  label: string;
  unit: string;
  placeholder: string;
  /** true iken Ürün Adedi alanı GİZLENİR, yerine "Yaklaşık Hacim (m³)" (measurement.volumeM3) gösterilir — yalnızca "dokme". */
  useVolumeInstead: boolean;
};

const PRODUCT_QUANTITY_FIELD_PRESETS: Partial<Record<LoadPreparationTypeId, { label: string; unit: string; placeholder: string }>> = {
  paletli: { label: "Palet Adedi", unit: "palet", placeholder: "Örn. 20" },
  "kasali-sandikli": { label: "Kasa / Sandık Adedi", unit: "kasa/sandık", placeholder: "Örn. 10" },
  "kolili-paketli": { label: "Koli / Paket Adedi", unit: "koli/paket", placeholder: "Örn. 120" },
  cuvalli: { label: "Çuval Adedi", unit: "çuval", placeholder: "Örn. 50" },
  "big-bag": { label: "Big Bag Adedi", unit: "big bag", placeholder: "Örn. 24" },
  balya: { label: "Balya Adedi", unit: "balya", placeholder: "Örn. 30" },
  "varil-bidon": { label: "Varil / Bidon Adedi", unit: "varil/bidon", placeholder: "Örn. 40" },
  "rulo-bobin": { label: "Rulo / Bobin Adedi", unit: "rulo/bobin", placeholder: "Örn. 12" },
  "demet-bag": { label: "Demet / Bağ Adedi", unit: "demet/bağ", placeholder: "Örn. 18" },
  "konteyner-icinde": { label: "Konteyner Adedi", unit: "konteyner", placeholder: "Örn. 2" },
  ambalajsiz: { label: "Ürün Adedi", unit: "adet", placeholder: "Örn. 15" },
};

const DEFAULT_PRODUCT_QUANTITY_FIELD_CONFIG: ProductQuantityFieldConfig = {
  label: "Ürün Adedi",
  unit: "adet",
  placeholder: "Örn. 120",
  useVolumeInstead: false,
};

/** Detay ekranlarında ("Palet Adedi: 20 palet" gibi) ham sayıyı hazırlanış biçimine göre GERÇEK birimle birlikte göstermek için — product-catalog.ts#formatProductQuantity'nin sabit "adet" son ekinin Nakliye'ye özel karşılığı. */
export function formatNakliyeQuantity(value: number, unit: string): string {
  return `${new Intl.NumberFormat("tr-TR").format(value)} ${unit}`;
}

export function getProductQuantityFieldConfig(loadPreparationType: string, manualCustomText?: string): ProductQuantityFieldConfig {
  if (loadPreparationType === "dokme") {
    return { label: "Yaklaşık Hacim", unit: "m³", placeholder: "Örn. 35", useVolumeInstead: true };
  }
  if (loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE) {
    const trimmed = manualCustomText?.trim();
    return trimmed
      ? { label: `${trimmed} Adedi`, unit: trimmed.toLocaleLowerCase("tr-TR"), placeholder: "Örn. 10", useVolumeInstead: false }
      : { label: "Birim Adedi", unit: "adet", placeholder: "Örn. 10", useVolumeInstead: false };
  }
  const preset = PRODUCT_QUANTITY_FIELD_PRESETS[loadPreparationType as LoadPreparationTypeId];
  return preset ? { ...preset, useVolumeInstead: false } : DEFAULT_PRODUCT_QUANTITY_FIELD_CONFIG;
}

/* ========================================================================
 * Yükleme Yöntemi (TEK seçimli)
 * ==================================================================== */
export type LoadingMethodId =
  | "forklift"
  | "vinc"
  | "mobil-vinc"
  | "kopru-vinc"
  | "reach-stacker"
  | "rampa"
  | "konveyor"
  | "pompa"
  | "silo-pnomatik"
  | "insan-gucu"
  | "arac-uzeri-vinc"
  | "gonderici-yukleyecek"
  | "henuz-belli-degil";

export const LOADING_METHOD_OPTIONS: readonly { id: LoadingMethodId; label: string }[] = [
  { id: "forklift", label: "Forklift ile" },
  { id: "vinc", label: "Vinç ile" },
  { id: "mobil-vinc", label: "Mobil vinç ile" },
  { id: "kopru-vinc", label: "Köprülü vinç ile" },
  { id: "reach-stacker", label: "Reach Stacker ile" },
  { id: "rampa", label: "Rampadan" },
  { id: "konveyor", label: "Konveyör ile" },
  { id: "pompa", label: "Pompa ile" },
  { id: "silo-pnomatik", label: "Silo / Pnömatik sistem ile" },
  { id: "insan-gucu", label: "İnsan gücüyle" },
  { id: "arac-uzeri-vinc", label: "Araç üzeri vinç ile" },
  { id: "gonderici-yukleyecek", label: "Gönderici tarafından yüklenecek" },
  { id: "henuz-belli-degil", label: "Henüz belli değil" },
];
export function isLoadingMethodId(value: unknown): value is LoadingMethodId {
  return typeof value === "string" && LOADING_METHOD_OPTIONS.some((option) => option.id === value);
}
export function getLoadingMethodLabel(id: string): string | undefined {
  return LOADING_METHOD_OPTIONS.find((option) => option.id === id)?.label;
}

/** İlan detay/admin görüntüleme için tek satır özet — sentinel seçiliyse gerçek serbest metni, değilse katalog etiketini döner. */
export function formatLoadPreparationSummary(type: string | undefined, customText: string | undefined): string | undefined {
  if (!type) return undefined;
  if (type === NAKLIYE_MANUAL_ENTRY_VALUE) return customText?.trim() || undefined;
  return getLoadPreparationTypeLabel(type) ?? type;
}
export function formatLoadingMethodSummary(method: string | undefined, customText: string | undefined): string | undefined {
  if (!method) return undefined;
  if (method === NAKLIYE_MANUAL_ENTRY_VALUE) return customText?.trim() || undefined;
  return getLoadingMethodLabel(method) ?? method;
}

/* ========================================================================
 * Ölçü ve Yerleşim Bilgileri — "Yükün Hazırlanış Biçimi" seçilince
 * `LOAD_PREPARATION_TYPE_OPTIONS` kartının içinde açılan, TAMAMEN isteğe
 * bağlı sade bir alt kart (görev: "MALSEVK Nakliye Ölçü ve Yerleşim
 * Bilgileri"). Eski, kaldırılmış zengin `NakliyePackagingEntry` alt-form
 * sisteminin YERİNE GEÇMEZ — o sistem (palet/kasa/rulo/vb. için onlarca
 * zorunlu-olabilen alan, ayrı kartlar) kalıcı olarak kaldırıldı; bu, tek
 * düz `NakliyeMeasurementInfo` objesi (storage-container-catalog.ts#
 * StorageContainerGroup İLE AYNI "tek düz obje, koşullu alt alanlar" ilkesi)
 * üzerinden yalnızca birkaç GERÇEKTEN opsiyonel ölçü/yerleşim alanı sunar.
 * `getMeasurementFieldGroup(type)` hangi tipin hangi alan/yerleşim seçenek
 * kümesini kullandığına karar verir — TEK doğruluk kaynağı.
 * ==================================================================== */
export type NakliyeMeasurementFieldGroup =
  | "pallet" | "box" | "sack" | "bigbag" | "bale" | "drum" | "roll" | "bundle" | "bulk" | "container" | "unpackaged" | "manual";

export function getMeasurementFieldGroup(type: string): NakliyeMeasurementFieldGroup | undefined {
  switch (type) {
    case "paletli": return "pallet";
    case "kasali-sandikli":
    case "kolili-paketli": return "box";
    case "cuvalli": return "sack";
    case "big-bag": return "bigbag";
    case "balya": return "bale";
    case "varil-bidon": return "drum";
    case "rulo-bobin": return "roll";
    case "demet-bag": return "bundle";
    case "dokme": return "bulk";
    case "konteyner-icinde": return "container";
    case "ambalajsiz": return "unpackaged";
    case NAKLIYE_MANUAL_ENTRY_VALUE: return "manual";
    default: return undefined;
  }
}

export type PalletSizeId = "euro" | "standart" | "ozel" | "bilinmiyor";
export const PALLET_SIZE_OPTIONS: readonly { id: PalletSizeId; label: string; widthCm?: number; lengthCm?: number }[] = [
  { id: "euro", label: "Euro Palet — 80 × 120 cm", widthCm: 80, lengthCm: 120 },
  { id: "standart", label: "Standart Palet — 100 × 120 cm", widthCm: 100, lengthCm: 120 },
  { id: "ozel", label: "Özel Ölçü" },
  { id: "bilinmiyor", label: "Ölçüsünü bilmiyorum" },
];
export function isPalletSizeId(value: unknown): value is PalletSizeId {
  return typeof value === "string" && PALLET_SIZE_OPTIONS.some((option) => option.id === value);
}

/** Yerleşim biçimi seçenek kümeleri — tip başına TEK dropdown, seçenekler `getMeasurementFieldGroup`e göre değişir. */
export const PLACEMENT_OPTIONS_FULL: readonly { id: string; label: string }[] = [
  { id: "ust-uste", label: "Üst üste istiflenebilir" },
  { id: "tek-kat", label: "Tek kat yerleştirilmeli" },
  { id: "yan-yana", label: "Yan yana yerleştirilmeli" },
  { id: "farketmez", label: "Yerleşim fark etmez" },
  { id: NAKLIYE_MANUAL_ENTRY_VALUE, label: NAKLIYE_MANUAL_ENTRY_OPTION_LABEL },
];
export const PLACEMENT_OPTIONS_BASIC: readonly { id: string; label: string }[] = [
  { id: "ust-uste", label: "Üst üste istiflenebilir" },
  { id: "tek-kat", label: "Tek kat" },
  { id: "farketmez", label: "Fark etmez" },
];
export const PLACEMENT_OPTIONS_BIGBAG: readonly { id: string; label: string }[] = [
  { id: "tek-kat", label: "Tek kat" },
  { id: "ust-uste", label: "Üst üste istiflenebilir" },
  { id: "farketmez", label: "Fark etmez" },
];
export const PLACEMENT_OPTIONS_BALE_STACK: readonly { id: string; label: string }[] = [
  { id: "ust-uste", label: "Üst üste istiflenebilir" },
  { id: "tek-kat", label: "Tek kat" },
];
export const ORIENTATION_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "yatay", label: "Yatay" },
  { id: "dikey", label: "Dikey" },
];
export const PLACEMENT_OPTIONS_DRUM: readonly { id: string; label: string }[] = [
  { id: "dikey", label: "Dikey taşınmalı" },
  { id: "yatay", label: "Yatay taşınmalı" },
  { id: "sabit", label: "Sabitlenerek taşınmalı" },
  { id: "farketmez", label: "Yerleşim fark etmez" },
];
export const PLACEMENT_OPTIONS_ROLL: readonly { id: string; label: string }[] = [
  { id: "yatay", label: "Yatay taşınmalı" },
  { id: "dikey", label: "Dikey taşınmalı" },
  { id: "besik", label: "Beşik/sehpa üzerinde taşınmalı" },
  { id: "sabit", label: "Sabitlenerek taşınmalı" },
  { id: "farketmez", label: "Yerleşim fark etmez" },
];
export const PLACEMENT_OPTIONS_BUNDLE: readonly { id: string; label: string }[] = [
  { id: "yatay", label: "Yatay" },
  { id: "ust-uste", label: "Üst üste istiflenebilir" },
  { id: "sabit", label: "Sabitlenerek taşınmalı" },
  { id: "farketmez", label: "Yerleşim fark etmez" },
];
export const PLACEMENT_OPTIONS_UNPACKAGED: readonly { id: string; label: string }[] = [
  { id: "tek-kat", label: "Tek kat" },
  { id: "sabit", label: "Sabitlenerek taşınmalı" },
  { id: "farketmez", label: "Yerleşim fark etmez" },
  { id: NAKLIYE_MANUAL_ENTRY_VALUE, label: NAKLIYE_MANUAL_ENTRY_OPTION_LABEL },
];

/** Bir grubun yerleşim dropdown'ında hangi seçenek kümesinin kullanılacağı — TEK doğruluk kaynağı. */
export function getPlacementOptionsForGroup(group: NakliyeMeasurementFieldGroup): readonly { id: string; label: string }[] {
  switch (group) {
    case "pallet":
    case "manual":
      return PLACEMENT_OPTIONS_FULL;
    case "box":
    case "sack":
      return PLACEMENT_OPTIONS_BASIC;
    case "bigbag":
      return PLACEMENT_OPTIONS_BIGBAG;
    case "bale":
      return PLACEMENT_OPTIONS_BALE_STACK;
    case "drum":
      return PLACEMENT_OPTIONS_DRUM;
    case "roll":
      return PLACEMENT_OPTIONS_ROLL;
    case "bundle":
      return PLACEMENT_OPTIONS_BUNDLE;
    case "unpackaged":
      return PLACEMENT_OPTIONS_UNPACKAGED;
    case "bulk":
    case "container":
      return [];
  }
}

/** "Üst üste istiflenebilir" seçilince En Fazla İstif Katı alanının açılıp açılmayacağı — hangi grup olursa olsun, seçilen DEĞER "ust-uste" olduğunda tutarlı biçimde açılır. */
export function placementAllowsMaxStackCount(placementType: string): boolean {
  return placementType === "ust-uste";
}

export function formatMeasurementSummary(info: {
  palletType?: string;
  widthCm?: number;
  lengthCm?: number;
  heightCm?: number;
  outerDiameterCm?: number;
  innerDiameterCm?: number;
  diameterCm?: number;
  rollWidthCm?: number;
  volumeM3?: number;
  orientation?: string;
  placementType?: string;
  placementCustomText?: string;
  maxStackCount?: number;
} | undefined): { dimensionsLabel?: string; placementLabel?: string; maxStackLabel?: string } {
  if (!info) return {};
  const dims: string[] = [];
  if (info.widthCm !== undefined) dims.push(`${info.widthCm}`);
  if (info.lengthCm !== undefined) dims.push(`${info.lengthCm}`);
  if (info.heightCm !== undefined) dims.push(`${info.heightCm}`);
  let dimensionsLabel = dims.length > 0 ? `${dims.join(" × ")} cm` : undefined;
  if (!dimensionsLabel && info.diameterCm !== undefined) {
    dimensionsLabel = info.heightCm !== undefined ? `Ø${info.diameterCm} × ${info.heightCm} cm` : `Ø${info.diameterCm} cm`;
  }
  if (!dimensionsLabel && (info.outerDiameterCm !== undefined || info.innerDiameterCm !== undefined)) {
    const parts: string[] = [];
    if (info.outerDiameterCm !== undefined) parts.push(`Dış Ø${info.outerDiameterCm}`);
    if (info.innerDiameterCm !== undefined) parts.push(`İç Ø${info.innerDiameterCm}`);
    if (info.rollWidthCm !== undefined) parts.push(`Genişlik ${info.rollWidthCm}`);
    dimensionsLabel = parts.length > 0 ? `${parts.join(" · ")} cm` : undefined;
  }
  if (!dimensionsLabel && info.volumeM3 !== undefined) {
    dimensionsLabel = `${info.volumeM3} m³`;
  }
  let placementLabel: string | undefined;
  if (info.placementType === NAKLIYE_MANUAL_ENTRY_VALUE) {
    placementLabel = info.placementCustomText?.trim() || undefined;
  } else if (info.placementType) {
    placementLabel =
      [PLACEMENT_OPTIONS_FULL, PLACEMENT_OPTIONS_BASIC, PLACEMENT_OPTIONS_BIGBAG, PLACEMENT_OPTIONS_BALE_STACK, PLACEMENT_OPTIONS_DRUM, PLACEMENT_OPTIONS_ROLL, PLACEMENT_OPTIONS_BUNDLE, PLACEMENT_OPTIONS_UNPACKAGED]
        .flatMap((options) => options)
        .find((option) => option.id === info.placementType)?.label ?? undefined;
  }
  if (info.orientation) {
    const orientationLabel = ORIENTATION_OPTIONS.find((option) => option.id === info.orientation)?.label;
    placementLabel = orientationLabel && placementLabel ? `${orientationLabel} · ${placementLabel}` : orientationLabel ?? placementLabel;
  }
  const maxStackLabel = info.maxStackCount !== undefined ? `${info.maxStackCount} kat` : undefined;
  return { dimensionsLabel, placementLabel, maxStackLabel };
}

/**
 * Form-state (string tabanlı) karşılığı ve HER İKİ yöndeki dönüştürücüler —
 * BİLEREK `_components`de değil burada tanımlıdır: nakliye-measurement-
 * fields.tsx (görsel bileşen) ve nakliye-transport-fields.tsx (NakliyeDetails-
 * FieldValues.measurement alanı için AYNI dönüştürücüleri çağırır) birbirini
 * İÇE AKTARSAYDI dairesel bağımlılık oluşurdu — saf fonksiyonlar (JSX YOK)
 * burada, TEK yönlü `_components -> _lib` kuralına uygun şekilde yaşar.
 */
export type NakliyeMeasurementFieldValues = {
  dimensionsUnknown: boolean;
  palletType: string;
  widthCm: string;
  lengthCm: string;
  heightCm: string;
  outerDiameterCm: string;
  innerDiameterCm: string;
  diameterCm: string;
  rollWidthCm: string;
  volumeM3: string;
  orientation: string;
  placementType: string;
  placementCustomText: string;
  maxStackCount: string;
};

export function createEmptyMeasurementFields(): NakliyeMeasurementFieldValues {
  return {
    dimensionsUnknown: false,
    palletType: "",
    widthCm: "",
    lengthCm: "",
    heightCm: "",
    outerDiameterCm: "",
    innerDiameterCm: "",
    diameterCm: "",
    rollWidthCm: "",
    volumeM3: "",
    orientation: "",
    placementType: "",
    placementCustomText: "",
    maxStackCount: "",
  };
}

export function toMeasurementFields(info: NakliyeMeasurementInfo | undefined): NakliyeMeasurementFieldValues {
  const empty = createEmptyMeasurementFields();
  if (!info) return empty;
  return {
    dimensionsUnknown: info.dimensionsUnknown ?? false,
    palletType: info.palletType ?? "",
    widthCm: info.widthCm !== undefined ? String(info.widthCm) : "",
    lengthCm: info.lengthCm !== undefined ? String(info.lengthCm) : "",
    heightCm: info.heightCm !== undefined ? String(info.heightCm) : "",
    outerDiameterCm: info.outerDiameterCm !== undefined ? String(info.outerDiameterCm) : "",
    innerDiameterCm: info.innerDiameterCm !== undefined ? String(info.innerDiameterCm) : "",
    diameterCm: info.diameterCm !== undefined ? String(info.diameterCm) : "",
    rollWidthCm: info.rollWidthCm !== undefined ? String(info.rollWidthCm) : "",
    volumeM3: info.volumeM3 !== undefined ? String(info.volumeM3) : "",
    orientation: info.orientation ?? "",
    placementType: info.placementType ?? "",
    placementCustomText: info.placementCustomText ?? "",
    maxStackCount: info.maxStackCount !== undefined ? String(info.maxStackCount) : "",
  };
}

// "Tüm İlan Formlarında... Aşılamaz Giriş Sınırları" görevi — bulunan
// gerçek açık: bu fonksiyon (form katmanının ölçü alanları çevirici) hiçbir
// üst sınıra sahip değildi VE `Number(trimmed)` bilimsel gösterimi ("1e5")
// hiç reddetmiyordu. Artık her çağıran kendi alanına uygun bir `max` verir
// (job-form-validation.ts#validatePositiveNumberIfFilled İLE AYNI regex/
// ondalık-basamak ilkesi — form doğrulaması zaten aynı üst sınırı UI'da
// gösterir, bu fonksiyon o kontrolün DB-yazma anındaki güvenlik ağıdır).
function toPositiveNumberField(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (!new RegExp(`^\\d+([.,]\\d{1,${MEASUREMENT_DECIMAL_PLACES}})?$`).test(trimmed)) return undefined;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}

/** `maxStackCount` — yalnızca pozitif TAM SAYI (bkz. job-form-validation.ts#validatePositiveIntegerIfFilled'in AYNI gerekçesi). */
function toPositiveIntegerField(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}

/**
 * `loadPreparationType`e göre YALNIZCA anlamlı alanları `NakliyeMeasurementInfo`
 * nesnesine çevirir — `dimensionsUnknown` true iken (ya da grup tanınmıyorsa/
 * "container" ise) TÜM ölçü/yerleşim alanları `undefined` gönderilir, önceki
 * türe ait ilgisiz değerler asla payload'a sızmaz (görev talimatı madde 10).
 */
export function fromMeasurementFields(loadPreparationType: string, fields: NakliyeMeasurementFieldValues): NakliyeMeasurementInfo | undefined {
  const group = getMeasurementFieldGroup(loadPreparationType);
  if (!group || group === "container") return undefined;
  if (fields.dimensionsUnknown) return { dimensionsUnknown: true };

  const placementType = fields.placementType || undefined;
  const base: NakliyeMeasurementInfo = {
    placementType,
    placementCustomText:
      group === "manual" || placementType === NAKLIYE_MANUAL_ENTRY_VALUE
        ? fields.placementCustomText.trim().slice(0, MANUAL_ENTRY_TEXT_MAX_LENGTH) || undefined
        : undefined,
    maxStackCount: placementType && placementAllowsMaxStackCount(placementType) ? toPositiveIntegerField(fields.maxStackCount, MAX_STACK_COUNT) : undefined,
  };

  let shaped: NakliyeMeasurementInfo;
  switch (group) {
    case "pallet":
      shaped = {
        ...base,
        palletType: isPalletSizeId(fields.palletType) ? fields.palletType : undefined,
        widthCm: toPositiveNumberField(fields.widthCm, MAX_WIDTH_CM),
        lengthCm: toPositiveNumberField(fields.lengthCm, MAX_LENGTH_CM),
        heightCm: toPositiveNumberField(fields.heightCm, MAX_HEIGHT_CM),
      };
      break;
    case "box":
    case "sack":
    case "bigbag":
    case "bundle":
    case "unpackaged":
    case "manual":
      shaped = {
        ...base,
        widthCm: toPositiveNumberField(fields.widthCm, MAX_WIDTH_CM),
        lengthCm: toPositiveNumberField(fields.lengthCm, MAX_LENGTH_CM),
        heightCm: toPositiveNumberField(fields.heightCm, MAX_HEIGHT_CM),
      };
      break;
    case "bale":
      shaped = {
        ...base,
        widthCm: toPositiveNumberField(fields.widthCm, MAX_WIDTH_CM),
        lengthCm: toPositiveNumberField(fields.lengthCm, MAX_LENGTH_CM),
        heightCm: toPositiveNumberField(fields.heightCm, MAX_HEIGHT_CM),
        orientation: fields.orientation === "yatay" || fields.orientation === "dikey" ? fields.orientation : undefined,
      };
      break;
    case "drum":
      shaped = {
        ...base,
        diameterCm: toPositiveNumberField(fields.diameterCm, MAX_DIAMETER_CM),
        heightCm: toPositiveNumberField(fields.heightCm, MAX_HEIGHT_CM),
      };
      break;
    case "roll":
      shaped = {
        ...base,
        outerDiameterCm: toPositiveNumberField(fields.outerDiameterCm, MAX_DIAMETER_CM),
        innerDiameterCm: toPositiveNumberField(fields.innerDiameterCm, MAX_DIAMETER_CM),
        rollWidthCm: toPositiveNumberField(fields.rollWidthCm, MAX_ROLL_WIDTH_CM),
      };
      break;
    case "bulk":
      shaped = { volumeM3: toPositiveNumberField(fields.volumeM3, MAX_VOLUME_M3) };
      break;
  }

  const hasAnyField = Object.values(shaped).some((field) => field !== undefined);
  return hasAnyField ? shaped : undefined;
}

/* ========================================================================
 * Araç Tipi / Kasa-Dorse Tipi (değişmedi)
 * ==================================================================== */
export type VehicleTypeId =
  | "panelvan" | "kamyonet" | "kamyon" | "kirkayak-kamyon" | "cekici-yari-romork"
  | "konteyner-sasisi" | "lowbed" | "tanker" | "damperli-arac" | "silo-arac";
export const VEHICLE_TYPE_OPTIONS: readonly { id: VehicleTypeId; label: string }[] = [
  { id: "panelvan", label: "Panelvan" },
  { id: "kamyonet", label: "Kamyonet" },
  { id: "kamyon", label: "Kamyon" },
  { id: "kirkayak-kamyon", label: "Kırkayak Kamyon" },
  { id: "cekici-yari-romork", label: "Çekici + Yarı Römork/TIR" },
  { id: "konteyner-sasisi", label: "Konteyner Şasisi" },
  { id: "lowbed", label: "Lowbed" },
  { id: "tanker", label: "Tanker" },
  { id: "damperli-arac", label: "Damperli Araç" },
  { id: "silo-arac", label: "Silo Araç" },
];
export function isVehicleTypeId(value: unknown): value is VehicleTypeId {
  return typeof value === "string" && VEHICLE_TYPE_OPTIONS.some((option) => option.id === value);
}
export function getVehicleTypeLabel(id: string): string | undefined {
  return VEHICLE_TYPE_OPTIONS.find((option) => option.id === id)?.label;
}

export type TrailerTypeId =
  | "tenteli" | "kayar-perdeli" | "kapali-kasa" | "acik-kasa" | "platform" | "frigorifik"
  | "mega" | "jumbo" | "lowbed" | "damper" | "tank" | "silo" | "konteyner-sasisi" | "hareketli-taban";
export const TRAILER_TYPE_OPTIONS: readonly { id: TrailerTypeId; label: string }[] = [
  { id: "tenteli", label: "Tenteli" },
  { id: "kayar-perdeli", label: "Kayar Perdeli" },
  { id: "kapali-kasa", label: "Kapalı Kasa" },
  { id: "acik-kasa", label: "Açık Kasa" },
  { id: "platform", label: "Platform" },
  { id: "frigorifik", label: "Frigorifik" },
  { id: "mega", label: "Mega" },
  { id: "jumbo", label: "Jumbo" },
  { id: "lowbed", label: "Lowbed" },
  { id: "damper", label: "Damper" },
  { id: "tank", label: "Tank" },
  { id: "silo", label: "Silo" },
  { id: "konteyner-sasisi", label: "Konteyner Şasisi" },
  { id: "hareketli-taban", label: "Hareketli Taban" },
];
export function isTrailerTypeId(value: unknown): value is TrailerTypeId {
  return typeof value === "string" && TRAILER_TYPE_OPTIONS.some((option) => option.id === value);
}
export function getTrailerTypeLabel(id: string): string | undefined {
  return TRAILER_TYPE_OPTIONS.find((option) => option.id === id)?.label;
}

/** Genel amaçlı "Evet/Hayır". */
export const YES_NO_OPTIONS: readonly { id: "evet" | "hayir"; label: string }[] = [
  { id: "evet", label: "Evet" },
  { id: "hayir", label: "Hayır" },
];
export function isYesNoValue(value: unknown): value is "evet" | "hayir" {
  return value === "evet" || value === "hayir";
}
export function yesNoToBoolean(value: string | undefined): boolean | undefined {
  if (value === "evet") return true;
  if (value === "hayir") return false;
  return undefined;
}
export function booleanToYesNo(value: boolean | undefined): "evet" | "hayir" | "" {
  if (value === true) return "evet";
  if (value === false) return "hayir";
  return "";
}

/* ========================================================================
 * Yükleme/Teslimat operasyon detayları — Yer Tipi (değişmedi)
 * ==================================================================== */
export type SiteTypeId = "fabrika" | "depo" | "liman" | "antrepo" | "osb-sanayi" | "santiye" | "acik-saha" | "diger";
export const SITE_TYPE_OPTIONS: readonly { id: SiteTypeId; label: string }[] = [
  { id: "fabrika", label: "Fabrika" },
  { id: "depo", label: "Depo" },
  { id: "liman", label: "Liman" },
  { id: "antrepo", label: "Antrepo" },
  { id: "osb-sanayi", label: "OSB/Sanayi tesisi" },
  { id: "santiye", label: "Şantiye" },
  { id: "acik-saha", label: "Açık saha" },
  { id: "diger", label: "Diğer" },
];
export function getSiteTypeLabel(id: string): string | undefined {
  return SITE_TYPE_OPTIONS.find((option) => option.id === id)?.label;
}

/* ========================================================================
 * Konteyner Taşıması / Tehlikeli Madde-ADR — "Konteyner Taşıması ve ADR
 * Bağımsız Bölümleri" görevi: eskiden TEK "Özel Taşıma Koşulları" kartının
 * iki alt bölümüydü, artık her biri kendi bağımsız numaralı bölümü (bkz.
 * job-request-form.tsx/job-edit-form.tsx/admin-job-edit-form.tsx) — bu
 * dosyadaki katalog/sanitizer/format yardımcıları TEK doğruluk kaynağı
 * olmaya devam eder.
 * ==================================================================== */
export type TriStateId = "evet" | "hayir" | "emin-degil";
export const TRI_STATE_OPTIONS: readonly { id: TriStateId; label: string }[] = [
  { id: "hayir", label: "Hayır" },
  { id: "evet", label: "Evet" },
  { id: "emin-degil", label: "Emin Değilim" },
];
export function isTriStateId(value: unknown): value is TriStateId {
  return typeof value === "string" && TRI_STATE_OPTIONS.some((option) => option.id === value);
}
export function getTriStateLabel(id: string): string | undefined {
  return TRI_STATE_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * İki durumlu ("Emin Değilim" YOK) Hayır/Evet seçenek çifti — `TRI_STATE_OPTIONS`'un
 * AYRI ve DOKUNULMAMIŞ bir kopyası. Eskiden yalnızca artık kaldırılmış "Yük
 * konteyner olarak mı taşınacak?" sorusu içindi; "Konteyner Tetikleyicisi
 * Ürün/Yük Cinsi'ne Taşındı" göreviyle o UI kontrolü TAMAMEN kaldırıldığı
 * için şimdi grup başına "Yük tehlikeli madde / ADR kapsamında mı?" sorusu
 * (bkz. HazmatFields, nakliye-cargo-group-fields.tsx) PAYLAŞIR — ikinci bir
 * aynı-şekilli dizi İCAT EDİLMEDİ. Eski (bu görevlerden önce kaydedilmiş)
 * "emin-degil" değerleri kanıtsız silinmez — yalnızca artık bu iki seçenekli
 * kontrollerde bir seçenek olarak SUNULMAZ; okuma tarafındaki dönüştürücüler
 * böyle bir kaydı güvenli görünüm olarak "hayir"a normalize eder.
 */
export type ContainerToggleId = "hayir" | "evet";
export const CONTAINER_TOGGLE_OPTIONS: readonly { id: ContainerToggleId; label: string }[] = [
  { id: "hayir", label: "Hayır" },
  { id: "evet", label: "Evet" },
];

/** ADR 2025 tehlike sınıfı 1-9 — storage-container-catalog.ts#IMO_CLASS_OPTIONS İLE AYNI 20-kodluk BM/IMO listesi. */
export {
  IMO_CLASS_OPTIONS as ADR_HAZARD_CLASS_OPTIONS,
  isImoClassCode as isAdrHazardClassCode,
  getImoClassOptionLabel as getAdrHazardClassOptionLabel,
  IMO_CLASS_SELECT_ITEMS as ADR_HAZARD_CLASS_SELECT_ITEMS,
} from "./storage-container-catalog";

export type PackingGroupId = "I" | "II" | "III" | "uygulanmaz" | "bilinmiyor";
export const PACKING_GROUP_OPTIONS: readonly { id: PackingGroupId; label: string }[] = [
  { id: "I", label: "I — Yüksek Tehlike" },
  { id: "II", label: "II — Orta Tehlike" },
  { id: "III", label: "III — Düşük Tehlike" },
  { id: "uygulanmaz", label: "Uygulanmaz" },
  { id: "bilinmiyor", label: "Emin Değilim" },
];
export function isPackingGroupId(value: unknown): value is PackingGroupId {
  return typeof value === "string" && PACKING_GROUP_OPTIONS.some((option) => option.id === value);
}
export function getPackingGroupLabel(id: string): string | undefined {
  return PACKING_GROUP_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * "Tehlikeli Madde / ADR Kartı Sadeleştirmesi" görevi — ADR kartı artık
 * yalnızca tri-state soru + (Evet iken) TEK bir "ADR Sınıfı" dropdown'ı
 * taşır. UN Numarası, Resmî Taşımacılık Adı (bunun otomatik doldurulması
 * dahil) ve Ambalaj Grubu form alanları TAMAMEN kaldırıldı — bu üçü artık
 * hiçbir formda toplanmaz/gösterilmez/gönderilmez. Eski (bu görevden önce
 * kaydedilmiş) unNumber/properShippingName/packingGroup değerleri kanıtsız
 * silinmez (bkz. NakliyeHazmatDetail üstündeki doküman) — yalnızca artık
 * hiçbir yeni yazımda üretilmez/hiçbir ekranda gösterilmez. Bu yüzden eski
 * UN/PSN veri kaynağı (`ADR_UN_REFERENCE_ENTRIES`, `findAdrUnEntry`,
 * `searchAdrUnEntries`) ve UN format doğrulaması TAMAMEN silindi — tek
 * amaçları UN→PSN otomatik doldurmaydı, o özellik artık yok.
 *
 * ADR Sınıfı dropdown'ının kendisi hâlâ `ADR_HAZARD_CLASS_OPTIONS`
 * (storage-container-catalog.ts#IMO_CLASS_OPTIONS İLE AYNI 20 kanonik kod) —
 * listenin SONUNA, kullanıcının sınıfı bilmediği durumlar için gerçek bir
 * seçenek olarak `ADR_CLASS_UNKNOWN_VALUE` eklenir (NAKLIYE_MANUAL_ENTRY_VALUE
 * İLE AYNI "sentinel değer" ilkesi — gerçek IMO kodlarıyla asla çakışmaz).
 */
export const ADR_CLASS_UNKNOWN_VALUE = "bilinmiyor";
export const ADR_CLASS_UNKNOWN_LABEL = "Sınıfını bilmiyorum";

/**
 * Görev talimatının kendi metni, BİREBİR — ADR kartının EN ALTINDA, seçilen
 * durumdan (Hayır/Evet/Emin Değilim) BAĞIMSIZ olarak her zaman gösterilir.
 * Hem nakliye-transport-fields.tsx#HazmatFields (Hizmet Alan) hem
 * admin-job-edit-form.tsx (admin) PAYLAŞIR — ikinci bir kopya İCAT EDİLMEDİ.
 */
export const ADR_CLASS_DISCLAIMER_TEXT =
  "ADR sınıfı ilan aşamasında ön bilgilendirme amacıyla alınır. Taşıma bilgileri operasyon başlamadan önce yetkili taraflarca doğrulanmalıdır.";

/**
 * Konteyner Tipi — "Konteyner Taşıması ve ADR Bağımsız Bölümleri" göreviyle
 * yeniden tanımlandı: eski "20/40 Open Top"/"20/40 Flat Rack" birleşik
 * seçenekleri 20'/40' olarak İKİYE ayrıldı, "Emin Değilim" gerçek bir
 * seçenek olarak eklendi, "Listede yok / Kendim gireceğim" manuel girişi
 * DropdownWithManualEntry üzerinden desteklenir (bkz. ContainerTypeField).
 * Eski id'ler (20dc/40dc/40hc/45hc/open-top/flat-rack/diger) YENİ formda
 * hiç seçenek olarak SUNULMAZ, ama `NakliyeContainerTransport.containerType`
 * tipi düz `string` olduğu için eski kayıtlar sessizce korunur —
 * `getContainerTypeLabel` bu eski id'leri de (LEGACY_CONTAINER_TYPE_LABELS
 * üzerinden) okunabilir bir etikete çevirir, ham slug asla kullanıcıya
 * yansıtılmaz.
 */
export type ContainerTypeId =
  | "20-standart"
  | "40-standart"
  | "40-high-cube"
  | "45-high-cube"
  | "20-open-top"
  | "40-open-top"
  | "20-flat-rack"
  | "40-flat-rack"
  | "reefer"
  | "tank"
  | "emin-degil";
export const CONTAINER_TYPE_OPTIONS: readonly { id: ContainerTypeId; label: string }[] = [
  { id: "20-standart", label: "20' Standart" },
  { id: "40-standart", label: "40' Standart" },
  { id: "40-high-cube", label: "40' High Cube" },
  { id: "45-high-cube", label: "45' High Cube" },
  { id: "20-open-top", label: "20' Open Top" },
  { id: "40-open-top", label: "40' Open Top" },
  { id: "20-flat-rack", label: "20' Flat Rack" },
  { id: "40-flat-rack", label: "40' Flat Rack" },
  { id: "reefer", label: "Reefer / Soğutuculu Konteyner" },
  { id: "tank", label: "Tank Konteyner" },
  { id: "emin-degil", label: "Emin Değilim" },
];
export function isContainerTypeId(value: unknown): value is ContainerTypeId {
  return typeof value === "string" && CONTAINER_TYPE_OPTIONS.some((option) => option.id === value);
}
/** Bu görevden ÖNCE kaydedilmiş eski konteyner tipi id'lerinin okunabilir karşılığı — yeni formda hiç sunulmaz, yalnızca geriye dönük GÖRÜNTÜLEME içindir. */
const LEGACY_CONTAINER_TYPE_LABELS: Record<string, string> = {
  "20dc": "20 DC (eski kayıt)",
  "40dc": "40 DC (eski kayıt)",
  "40hc": "40 HC (eski kayıt)",
  "45hc": "45 HC (eski kayıt)",
  "open-top": "20/40 Open Top (eski kayıt)",
  "flat-rack": "20/40 Flat Rack (eski kayıt)",
  diger: "Diğer (eski kayıt)",
};
export function getContainerTypeLabel(id: string): string | undefined {
  return CONTAINER_TYPE_OPTIONS.find((option) => option.id === id)?.label ?? LEGACY_CONTAINER_TYPE_LABELS[id];
}

/** "Konteyner İçindeki Yük" — yalnızca Dolu Konteyner Bilgileri alt kartında, "Listede yok / Kendim gireceğim" manuel girişi destekler. */
export type ContainerContentId =
  | "makine-ekipman"
  | "otomotiv-yedek-parca"
  | "metal-celik-urunleri"
  | "insaat-malzemeleri"
  | "gida-icecek"
  | "tarim-urunleri"
  | "tekstil-konfeksiyon"
  | "mobilya-ev-esyasi"
  | "elektronik-beyaz-esya"
  | "plastik-kaucuk-urunleri"
  | "kagit-karton"
  | "kimyasal-urun"
  | "ilac-medikal-urun"
  | "maden-mineral"
  | "atik-geri-donusum-malzemesi";
export const CONTAINER_CONTENT_OPTIONS: readonly { id: ContainerContentId; label: string }[] = [
  { id: "makine-ekipman", label: "Makine / Ekipman" },
  { id: "otomotiv-yedek-parca", label: "Otomotiv / Yedek Parça" },
  { id: "metal-celik-urunleri", label: "Metal / Çelik Ürünleri" },
  { id: "insaat-malzemeleri", label: "İnşaat Malzemeleri" },
  { id: "gida-icecek", label: "Gıda / İçecek" },
  { id: "tarim-urunleri", label: "Tarım Ürünleri" },
  { id: "tekstil-konfeksiyon", label: "Tekstil / Konfeksiyon" },
  { id: "mobilya-ev-esyasi", label: "Mobilya / Ev Eşyası" },
  { id: "elektronik-beyaz-esya", label: "Elektronik / Beyaz Eşya" },
  { id: "plastik-kaucuk-urunleri", label: "Plastik / Kauçuk Ürünleri" },
  { id: "kagit-karton", label: "Kağıt / Karton" },
  { id: "kimyasal-urun", label: "Kimyasal Ürün" },
  { id: "ilac-medikal-urun", label: "İlaç / Medikal Ürün" },
  { id: "maden-mineral", label: "Maden / Mineral" },
  { id: "atik-geri-donusum-malzemesi", label: "Atık / Geri Dönüşüm Malzemesi" },
];
export function isContainerContentId(value: unknown): value is ContainerContentId {
  return typeof value === "string" && CONTAINER_CONTENT_OPTIONS.some((option) => option.id === value);
}
export function getContainerContentLabel(id: string): string | undefined {
  return CONTAINER_CONTENT_OPTIONS.find((option) => option.id === id)?.label;
}

/* ========================================================================
 * Yardımcılar
 * ==================================================================== */
export const HAZMAT_UNCERTAIN_WARNING =
  "Yükün tehlikeli madde sınıflandırması teklif kabulünden ve taşımadan önce gönderen tarafından kesinleştirilmelidir.";
export const HAZMAT_SDS_DISCLAIMER = "SDS/GBF, ADR taşıma evrakı değildir.";


export function hasHazmatDetails(job: Pick<Job, "nakliyeDetails">): boolean {
  return job.nakliyeDetails?.hazmat?.status === "evet" || job.nakliyeDetails?.hazmat?.status === "emin-degil";
}

/**
 * "Tehlikeli Madde / ADR Kartı Sadeleştirmesi" görevi — UN Numarası/Resmî
 * Taşımacılık Adı/Ambalaj Grubu BİLEREK bu özete hiç dahil edilmez (kaldırılan
 * alanlar hiçbir ekranda gösterilmez) — yalnızca durum + (varsa) ADR Sınıfı.
 * `ADR_CLASS_UNKNOWN_VALUE` sentineli ayrıca, insan-okur bir etikete çevrilir.
 */
export function formatHazmatSummary(hazmat: NakliyeHazmatDetail | undefined): string | null {
  if (!hazmat || hazmat.status === "hayir") return null;
  if (hazmat.status === "emin-degil") return "Emin Değilim";
  if (!hazmat.adrClass) return "Evet";
  if (hazmat.adrClass === ADR_CLASS_UNKNOWN_VALUE) return ADR_CLASS_UNKNOWN_LABEL;
  const match = IMO_CLASS_OPTIONS.find((option) => option.id === hazmat.adrClass);
  return match ? getImoClassOptionLabel(match) : `ADR Sınıf ${hazmat.adrClass}`;
}

/** Konteyner Taşıması kartı için detay/admin görüntüleme tek satır özeti — "Ürün Adedi"nde olduğu gibi ham anahtar/slug asla kullanıcıya yansıtılmaz. */
export function formatContainerTransportSummary(container: NakliyeContainerTransport | undefined): string | null {
  if (!container || container.status === "hayir") return null;
  if (container.status === "emin-degil") return "Emin Değilim";
  const parts: string[] = [];
  const typeLabel =
    container.containerType === NAKLIYE_MANUAL_ENTRY_VALUE
      ? container.containerTypeCustomText?.trim()
      : container.containerType
        ? getContainerTypeLabel(container.containerType)
        : undefined;
  if (typeLabel) parts.push(typeLabel);
  if (container.loadStatus) parts.push(container.loadStatus === "dolu" ? "Dolu" : "Boş");
  if (container.quantity !== undefined) parts.push(formatNakliyeQuantity(container.quantity, "konteyner"));
  // grossWeightTon Dolu iken "Dolu Konteyner Bilgileri" alt kartının kendi
  // özetinde (formatContainerContentSummary) gösterilir — burada TEKRAR
  // gösterilmez; Boş/bilinmiyor durumda ise TEK gösterileceği yer burasıdır.
  if (container.loadStatus !== "dolu" && container.grossWeightTon !== undefined) parts.push(`${container.grossWeightTon} ton`);
  return parts.length > 0 ? parts.join(" · ") : "Evet";
}

/** "Dolu Konteyner Bilgileri" alt kartının kendi özeti — Konteyner İçindeki Yük + Yük Açıklaması. */
export function formatContainerContentSummary(container: NakliyeContainerTransport | undefined): string | null {
  if (!container || container.status !== "evet" || container.loadStatus !== "dolu") return null;
  const contentLabel =
    container.content === NAKLIYE_MANUAL_ENTRY_VALUE ? container.contentCustomText?.trim() : container.content ? getContainerContentLabel(container.content) : undefined;
  const parts: string[] = [];
  if (contentLabel) parts.push(contentLabel);
  if (container.grossWeightTon !== undefined) parts.push(`${container.grossWeightTon} ton`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ========================================================================
 * SANİTİZASYON — job-store.ts'in sunucu-tarafı GÜVENLİK AĞI (bileşenin
 * kendi form doğrulamasından BAĞIMSIZ, ikinci bir savunma katmanı). Alan
 * bazında typeof/enum kontrolü — TAM bir iş-kuralı doğrulaması İCAT
 * EDİLMEDİ (o, job-form-validation.ts'in işi), yalnızca "veritabanına asla
 * YANLIŞ TİPTE bir değer yazılmasın" garantisi.
 * ==================================================================== */
function sanitizeString(value: unknown, maxLength = 500): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : undefined;
}
// "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu, DB-yazma
// anındaki SON güvenlik ağıydı (kod başındaki SANİTİZASYON notuna bkz.) ve
// hiçbir üst sınırı yoktu — RPC'yi bypass eden bir istek (ya da localStorage'ı
// doğrudan düzenleyen bir kullanıcı) `Number.MAX_SAFE_INTEGER`e kadar herhangi
// bir "pozitif" değeri sessizce geçirebiliyordu. `max` artık ZORUNLU (varsayılan
// YOK) — her çağıran kendi alanına uygun bir field-limits.ts sabiti geçmek
// zorunda, "unutulan bir çağıran sınırsız kalır" riski böylece ortadan kalkar.
function sanitizePositiveNumber(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}
/** Adet/kat gibi TAM SAYI alanları için — `sanitizePositiveNumber`in AYNI ilke, ek `Number.isInteger` şartıyla. */
function sanitizePositiveInteger(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 && value <= max ? value : undefined;
}
function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
function sanitizeStringArray(value: unknown, maxLength = 50): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, maxLength);
  return strings.length > 0 ? strings : undefined;
}

function sanitizeVehiclePreference(value: unknown): NakliyeVehiclePreference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.suggestByProvider !== "boolean") return undefined;
  return {
    suggestByProvider: raw.suggestByProvider,
    vehicleTypes: sanitizeStringArray(raw.vehicleTypes)?.filter(isVehicleTypeId),
    trailerTypes: sanitizeStringArray(raw.trailerTypes)?.filter(isTrailerTypeId),
  };
}

/** Yükleme Yöntemi'nin (loadingMethod/loadingMethodCustomText) tek başına, geçerli değer sanitizasyonu — "+ Ek yükleme koşulları" paneli (Yer Tipi/Randevu/Saat/Kantar/Erişim/PPE/Süre/Bekleme) TAMAMEN kaldırıldığı için artık sarmalayan bir obje YOK, iki değer doğrudan döner. */
function sanitizeLoadingMethod(rawType: unknown, rawCustomText: unknown): { loadingMethod?: string; loadingMethodCustomText?: string } {
  const loadingMethod = sanitizeString(rawType, 50);
  return {
    loadingMethod: loadingMethod && (isLoadingMethodId(loadingMethod) || loadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE) ? loadingMethod : undefined,
    loadingMethodCustomText: loadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(rawCustomText, 100) : undefined,
  };
}

/**
 * "Konteyner Taşıması ve ADR Bağımsız Bölümleri" görevi — eski zengin alan
 * kümesi (subsidiaryRisk/totalQuantity/carryForm/isWaste/tunnelRestrictionCode/
 * limitedQuantityException/sdsStorageKey/additionalSafetyNote) BİLEREK artık
 * hiç okunmaz/üretilmez — "sade ADR Bilgileri kartı" yalnızca dört alan
 * taşır. Bu, eski bir kaydın localStorage/Supabase'teki ham JSON'unda o
 * alanların hâlâ durması ihtimalini ETKİLEMEZ (kanıtsız silme yok, bkz. görev
 * talimatı) — sanitizer bu fazladan anahtarları basitçe YOK SAYAR, bir
 * sonraki kayıtta `nakliyeDetails` bütün obje olarak yeniden yazıldığında
 * doğal olarak düşerler.
 */
export function sanitizeHazmatDetail(value: unknown): NakliyeHazmatDetail | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "evet" && raw.status !== "hayir" && raw.status !== "emin-degil") return undefined;
  if (raw.status === "hayir") return { status: "hayir" };
  return {
    status: raw.status,
    unNumber: sanitizeString(raw.unNumber, 20),
    properShippingName: sanitizeString(raw.properShippingName, 200),
    adrClass: typeof raw.adrClass === "string" ? raw.adrClass : undefined,
    packingGroup: isPackingGroupId(raw.packingGroup) ? raw.packingGroup : undefined,
  };
}

/**
 * Grup başına sade ADR bloğunun (types.ts#NakliyeCargoGroupHazmat) TEK
 * güvenli sanitizasyonu — `sanitizeHazmatDetail`den BİLEREK FARKLI/DAHA DAR:
 * "emin-degil" burada asla ÜRETİLMEZ (typeof kontrolü onu doğrudan reddeder,
 * "hayir"a sessizce dönüştürmez — çağıran taraf zaten yalnızca "evet"/"hayir"
 * gönderir, üçüncü bir ham değer gelirse bu tip güvenliği görevi bunu
 * TÜMÜYLE reddetmesi daha doğrudur), unNumber/properShippingName/packingGroup
 * hiç okunmaz/taşınmaz.
 */
function sanitizeCargoGroupHazmat(value: unknown): NakliyeCargoGroupHazmat | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "evet" && raw.status !== "hayir") return undefined;
  if (raw.status === "hayir") return { status: "hayir" };
  return { status: "evet", adrClass: typeof raw.adrClass === "string" ? raw.adrClass : undefined };
}

/**
 * `NakliyeContainerTransport` artık NakliyeHazmatDetail İLE AYNI üç durumlu
 * (`status`) yapı — "hayir"/"emin-degil" iken diğer alanlar hiç okunmaz.
 * `containerType` (ve `content`) düz `string` olarak sanitize edilir, katalog
 * enum'una göre DOĞRULANMAZ — bu BİLEREK böyledir: eski id'ler (20dc/diger/
 * vb.) ve gelecekte kataloğa eklenebilecek yeni id'ler sessizce korunur,
 * gerçek "geçerli mi" kontrolü yalnızca FORM tarafında (job-form-validation.ts)
 * yapılır, DB'ye asla yanlış TİPTE bir değer yazılmaz garantisi burada
 * yeterlidir (dosyanın üstündeki SANİTİZASYON notuyla AYNI ilke).
 */
export function sanitizeContainerTransport(value: unknown): NakliyeContainerTransport | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "evet" && raw.status !== "hayir" && raw.status !== "emin-degil") return undefined;
  if (raw.status !== "evet") return { status: raw.status };
  const loadStatus = raw.loadStatus === "dolu" || raw.loadStatus === "bos" ? raw.loadStatus : undefined;
  return {
    status: "evet",
    containerType: sanitizeString(raw.containerType, 50),
    containerTypeCustomText: raw.containerType === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(raw.containerTypeCustomText, 100) : undefined,
    loadStatus,
    quantity: sanitizePositiveNumber(raw.quantity, MAX_CONTAINER_QUANTITY),
    grossWeightTon: sanitizePositiveNumber(raw.grossWeightTon, MAX_TONNAGE_TON),
    content: loadStatus === "dolu" ? sanitizeString(raw.content, 50) : undefined,
    contentCustomText: loadStatus === "dolu" && raw.content === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(raw.contentCustomText, 100) : undefined,
    contentDescription: loadStatus === "dolu" ? sanitizeString(raw.contentDescription, 500) : undefined,
  };
}

/**
 * "Nakliye Çoklu Yük Grubu" görevi — `Job.nakliyeCargoGroups`in TEK güvenli
 * okuma/yazma yeri, `sanitizeNakliyeDetails` İLE AYNI ilke: yalnızca TİP
 * güvenliği (DB'ye yanlış tipte bir değer asla yazılmaz), gerçek "geçerli
 * mi" kontrolü FORM tarafında (job-form-validation.ts). `sanitizeContainerTransport`
 * (mevcut, tek-grup sanitizer'ı) doğrudan yeniden kullanılır — ikinci bir
 * kopya İCAT EDİLMEZ. Geçersiz (obje olmayan) bir grup dizideki YERİNDEN
 * ATLANIR, tüm dizi reddedilmez.
 */
function sanitizeNakliyeCargoGroup(value: unknown): NakliyeCargoGroup | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const loadPreparationType = sanitizeString(raw.loadPreparationType, 50);
  const productTonnageUnit = raw.productTonnageUnit === "kg" ? "kg" : raw.productTonnageUnit === "ton" ? "ton" : undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : crypto.randomUUID(),
    productQuantity: sanitizePositiveNumber(raw.productQuantity, MAX_PRODUCT_QUANTITY),
    // Birim-farkında üst sınır — Kg biriminde bir değer Ton'dan ~1000× büyük
    // olabilir (bkz. product-catalog.ts#parseProductTonnage'ın AYNI gerekçesi).
    productTonnage: sanitizePositiveNumber(raw.productTonnage, productTonnageUnit === "kg" ? MAX_TONNAGE_KG : MAX_TONNAGE_TON),
    productType: sanitizeString(raw.productType, MANUAL_ENTRY_TEXT_MAX_LENGTH),
    productTonnageUnit,
    loadPreparationType:
      loadPreparationType && (isLoadPreparationTypeId(loadPreparationType) || loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE)
        ? loadPreparationType
        : undefined,
    loadPreparationCustomText:
      loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(raw.loadPreparationCustomText, 100) : undefined,
    measurementInfo: sanitizeMeasurementInfo(raw.measurementInfo),
    containerTransport: sanitizeContainerTransport(raw.containerTransport) ?? { status: "hayir" },
    hazmat: sanitizeCargoGroupHazmat(raw.hazmat),
  };
}

/**
 * `sanitizeNakliyeCargoGroup`in dizi hâli — dizi değilse ya da hiçbir elemanı
 * sanitize edilemezse `undefined` döner (Job.nakliyeCargoGroups boş bir dizi
 * `[]` olarak asla saklanmaz, storage_container_groups İLE AYNI ilke).
 * "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: dizi uzunluğuna
 * hiçbir üst sınır YOKTU; `value.slice(0, MAX_CARGO_GROUPS)` fazla elemanları
 * SESSİZCE atmak yerine önce diziyi kırpar (görev talimatı: "İlan başına
 * maksimum 20 yük grubu") — bu DB-yazma anındaki güvenlik ağıdır, gerçek
 * kullanıcı akışı zaten UI'da (nakliye-cargo-group-fields.tsx) 20'de durur.
 */
export function sanitizeNakliyeCargoGroups(value: unknown): NakliyeCargoGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = value
    .slice(0, MAX_CARGO_GROUPS)
    .map(sanitizeNakliyeCargoGroup)
    .filter((group): group is NakliyeCargoGroup => group !== undefined);
  return groups.length > 0 ? groups : undefined;
}

/**
 * `Job.nakliyeDetails`in TEK güvenli okuma/yazma yeri. Alt bloklar
 * BAĞIMSIZ olarak sanitize edilir; biri geçersizse yalnız O BLOK
 * `undefined` olur, diğerleri etkilenmez. Hiçbir blok anlamlı değilse
 * (hepsi undefined) `undefined` döner — `Job.nakliyeDetails` boş bir obje
 * `{}` olarak asla saklanmaz.
 */
export function sanitizeMeasurementInfo(value: unknown): NakliyeDetails["measurementInfo"] {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const placementType = sanitizeString(raw.placementType, 30);
  const orientationValue: "yatay" | "dikey" | undefined =
    raw.orientation === "yatay" ? "yatay" : raw.orientation === "dikey" ? "dikey" : undefined;
  const result = {
    dimensionsUnknown: sanitizeBoolean(raw.dimensionsUnknown),
    palletType: isPalletSizeId(raw.palletType) ? raw.palletType : undefined,
    widthCm: sanitizePositiveNumber(raw.widthCm, MAX_WIDTH_CM),
    lengthCm: sanitizePositiveNumber(raw.lengthCm, MAX_LENGTH_CM),
    heightCm: sanitizePositiveNumber(raw.heightCm, MAX_HEIGHT_CM),
    outerDiameterCm: sanitizePositiveNumber(raw.outerDiameterCm, MAX_DIAMETER_CM),
    innerDiameterCm: sanitizePositiveNumber(raw.innerDiameterCm, MAX_DIAMETER_CM),
    diameterCm: sanitizePositiveNumber(raw.diameterCm, MAX_DIAMETER_CM),
    rollWidthCm: sanitizePositiveNumber(raw.rollWidthCm, MAX_ROLL_WIDTH_CM),
    volumeM3: sanitizePositiveNumber(raw.volumeM3, MAX_VOLUME_M3),
    orientation: orientationValue,
    placementType,
    placementCustomText:
      placementType === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(raw.placementCustomText, MANUAL_ENTRY_TEXT_MAX_LENGTH) : undefined,
    maxStackCount: sanitizePositiveInteger(raw.maxStackCount, MAX_STACK_COUNT),
  };
  const hasAnyField = Object.values(result).some((field) => field !== undefined);
  return hasAnyField ? result : undefined;
}

export function sanitizeNakliyeDetails(value: unknown): NakliyeDetails | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const loadPreparationType = sanitizeString(raw.loadPreparationType, 50);
  // Geriye dönük uyumluluk: "+ Ek yükleme koşulları" paneli kaldırılmadan
  // ÖNCE oluşturulmuş eski ilanlarda loadingMethod, artık silinmiş
  // `loadingOperations` sarmalayıcısının İÇİNDE saklıydı — bu eski iç içe
  // biçim de (varsa) okunur, böylece eski bir ilanın Yükleme Yöntemi değeri
  // hiç kaybolmaz. Yeni ilanlar zaten düz `raw.loadingMethod` kullanır.
  const legacyLoadingOperations =
    typeof raw.loadingOperations === "object" && raw.loadingOperations !== null ? (raw.loadingOperations as Record<string, unknown>) : undefined;
  const loadingMethodFields = sanitizeLoadingMethod(
    raw.loadingMethod ?? legacyLoadingOperations?.loadingMethod,
    raw.loadingMethodCustomText ?? legacyLoadingOperations?.loadingMethodCustomText,
  );
  const result: NakliyeDetails = {
    loadPreparationType: loadPreparationType && (isLoadPreparationTypeId(loadPreparationType) || loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE) ? loadPreparationType : undefined,
    loadPreparationCustomText: loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE ? sanitizeString(raw.loadPreparationCustomText, 100) : undefined,
    measurementInfo: sanitizeMeasurementInfo(raw.measurementInfo),
    vehiclePreference: sanitizeVehiclePreference(raw.vehiclePreference),
    loadingMethod: loadingMethodFields.loadingMethod,
    loadingMethodCustomText: loadingMethodFields.loadingMethodCustomText,
    hazmat: sanitizeHazmatDetail(raw.hazmat),
    containerTransport: sanitizeContainerTransport(raw.containerTransport),
  };
  const hasAnyBlock = Object.values(result).some((block) => block !== undefined);
  return hasAnyBlock ? result : undefined;
}

/* ========================================================================
 * "Nakliye Çoklu Yük Grubu" görevi — bkz. types.ts#NakliyeCargoGroup
 * üstündeki doküman. Form katmanının TEK grup birimi — storage-container-
 * details-fields.tsx#StorageContainerGroupFieldValues İLE AYNI "id yalnızca
 * React key/hata eşleştirmesi" ilkesi. Ürün Bilgileri (productQuantity/
 * productTonnage/productType/productTonnageUnit) artık PER-GRUP — bir
 * Nakliye hizmetinin üst seviye AYNI adlı `ServiceEntry` alanları (job-
 * request-form.tsx/job-edit-form.tsx/admin-job-edit-form.tsx) bu görevden
 * sonra Nakliye için ARTIK KULLANILMAZ, yalnızca diğer kategoriler için
 * geçerli kalır. `createEmptyNakliyeCargoGroupFields`/`toCargoGroupsFields`/
 * `fromCargoGroupsFields` dışa aktarılır (dizi düzeyinde) — tekil
 * `cargoGroupToFields`/`fromCargoGroupFields` storage-container-details-
 * fields.tsx#toStorageContainerGroupFields/fromStorageContainerGroupFields
 * İLE AYNI şekilde BİLEREK private kalır.
 * ==================================================================== */
export type NakliyeCargoGroupFieldValues = {
  id: string;
  productQuantity: string;
  /** Paylaşılan "Toplam Ağırlık" — HEM normal HEM konteyner dalında kullanılır (görev talimatı: "toplam tonaj alanını tekrar etmeden kullan"), bkz. types.ts#NakliyeCargoGroup.containerTransport.grossWeightTon üstündeki doküman. */
  productTonnage: string;
  productTonnageUnit: "ton" | "kg";
  /** Konteyner modunun TEK tetikleyicisi — bkz. isNakliyeContainerProductType. */
  productType: string;
  /** Yalnızca productType === PRODUCT_TYPE_CUSTOM_VALUE iken anlamlı — product-type-combobox.tsx İLE AYNI desen. */
  productTypeCustomText: string;
  loadPreparationType: string;
  loadPreparationCustomText: string;
  measurement: NakliyeMeasurementFieldValues;
  containerType: string;
  containerTypeCustomText: string;
  containerLoadStatus: string;
  containerQuantity: string;
  containerContent: string;
  containerContentCustomText: string;
  /** Grup başına Tehlikeli Madde/ADR — bkz. types.ts#NakliyeCargoGroupHazmat. */
  hazmatStatus: string;
  hazmatAdrClass: string;
};

export function createEmptyNakliyeCargoGroupFields(): NakliyeCargoGroupFieldValues {
  return {
    id: crypto.randomUUID(),
    productQuantity: "",
    productTonnage: "",
    productTonnageUnit: "ton",
    productType: "",
    productTypeCustomText: "",
    loadPreparationType: "",
    loadPreparationCustomText: "",
    measurement: createEmptyMeasurementFields(),
    containerType: "",
    containerTypeCustomText: "",
    containerLoadStatus: "",
    containerQuantity: "",
    containerContent: "",
    containerContentCustomText: "",
    // "ADR varsayılan olarak Hayır olsun" (görev talimatı) — boş string DEĞİL,
    // CompactConditionToggle'ın `aria-checked` karşılaştırması `value === option.id`
    // olduğu için boş bir string HİÇBİR seçeneği işaretli göstermezdi.
    hazmatStatus: "hayir",
    hazmatAdrClass: "",
  };
}

function cargoGroupToFields(group: NakliyeCargoGroup): NakliyeCargoGroupFieldValues {
  const container = group.containerTransport;
  const isContainerMode = container.status === "evet";
  return {
    id: group.id,
    productQuantity: group.productQuantity !== undefined ? String(group.productQuantity) : "",
    // Paylaşılan tonaj alanı — yeni kayıtlarda HER ZAMAN group.productTonnage'dan
    // gelir (konteyner modunda da). Eski (bu görevden önce kaydedilmiş) bir
    // konteyner grubunun tonajı yalnızca container.grossWeightTon'da olabilir
    // — bu durumda o eski değer burada geriye dönük GÖSTERİLİR, kaybolmaz.
    productTonnage:
      group.productTonnage !== undefined
        ? String(group.productTonnage)
        : isContainerMode && container.grossWeightTon !== undefined
          ? String(container.grossWeightTon)
          : "",
    productTonnageUnit: group.productTonnageUnit === "kg" ? "kg" : "ton",
    // job-edit-form.tsx'in kendi (Nakliye-dışı) productType alanıyla AYNI
    // ilke — ham depolanmış metin doğrudan gösterilir, öneri listesiyle
    // eşleşip eşleşmediği kontrol edilmez; productTypeCustomText her zaman
    // "" ile başlar (kullanıcı yalnızca özel modu yeniden açarsa doldurulur).
    // Eski (bu görevden önce kaydedilmiş, toggle tabanlı) bir konteyner
    // grubunun productType'ı hiç yoktur — bu durumda "Konteyner" burada
    // SENTEZLENİR ki yeni tetikleyici mekanizması onu doğru tanısın (görev
    // talimatı: "eski konteyner Evet/Hayır yapısıyla kayıtlı ilanlar
    // açılırken hata oluşmasın... mevcut veriler yeni görünümle uyumlu
    // biçimde yorumlansın").
    productType: group.productType ?? (isContainerMode ? NAKLIYE_CONTAINER_PRODUCT_TYPE_VALUE : ""),
    productTypeCustomText: "",
    loadPreparationType: group.loadPreparationType ?? "",
    loadPreparationCustomText: group.loadPreparationCustomText ?? "",
    measurement: toMeasurementFields(group.measurementInfo),
    containerType: container.containerType ?? "",
    containerTypeCustomText: container.containerTypeCustomText ?? "",
    containerLoadStatus: container.loadStatus ?? "",
    containerQuantity: container.quantity !== undefined ? String(container.quantity) : "",
    containerContent: container.content ?? "",
    containerContentCustomText: container.contentCustomText ?? "",
    // Eski (bu görevden önce kaydedilmiş, tri-state) bir hazmat kaydı burada
    // GÜVENLİ GÖRÜNÜM olarak "hayir"a normalize edilir — ContainerToggle'ın
    // eski tri-state→binary dönüşümüyle AYNI ilke.
    hazmatStatus: group.hazmat?.status === "evet" ? "evet" : "hayir",
    hazmatAdrClass: group.hazmat?.adrClass ?? "",
  };
}

/** `groups` (bkz. nakliye-cargo-groups.ts#getJobCargoGroups — çağıran taraf zaten en az 1 elemanlı hâle getirir) dizisini form katmanının ham metin state dizisine çevirir. */
export function toCargoGroupsFields(groups: NakliyeCargoGroup[]): NakliyeCargoGroupFieldValues[] {
  return groups.map(cargoGroupToFields);
}

// "Aşılamaz Giriş Sınırları" görevi — katı `^\d+$` regex'i bilimsel gösterimi
// ("1e5") baştan reddeder, `max` konteyner adedinin (MAX_CONTAINER_QUANTITY)
// bir ilan/grup için makul üst sınırıdır.
function toPositiveIntegerOrUndefined(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}

/**
 * Bir grubun ham form state'ini gönderim anındaki `NakliyeCargoGroup`e
 * çevirir — `job-request-form.tsx#resolveProductInfoPayload`ın ürün alanı
 * ayrıştırma mantığıyla (parseProductQuantity/parseProductTonnage/"dökme"
 * için Ürün Adedi'ni atlama) AYNI — artık grup başına tekrarlanır.
 *
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — konteyner
 * modunun TEK tetikleyicisi artık `isNakliyeContainerProductType(fields.productType)`
 * (eski bağımsız `containerTransportStatus` alanı KALDIRILDI). İkili dal
 * kuralı hâlâ GEÇERLİ: konteyner modunda normal Yük Bilgileri dalına ait
 * TÜM alanlar (Yükün Hazırlanış Biçimi/Ölçü ve Yerleşim/Ürün Adedi) BİLEREK
 * payload'a hiç dahil edilmez; normal moddayken Konteyner Bilgileri dalına
 * ait TÜM alanlar hiç dahil edilmez. Toplam Ağırlık (`productTonnage`/
 * `productTonnageUnit`) BU KURALIN DIŞINDA — artık HER İKİ dalda da PAYLAŞILAN
 * TEK alan (görev talimatı: "toplam tonaj alanını tekrar etmeden kullan"),
 * bu yüzden `containerTransport.grossWeightTon` yeni yazımlarda ARTIK HİÇ
 * ÜRETİLMEZ (yalnızca eski kayıtların geriye dönük okunması için types.ts'te
 * ayakta kalır, bkz. o alanın kendi doküman notu).
 */
function fromCargoGroupFields(fields: NakliyeCargoGroupFieldValues): NakliyeCargoGroup {
  const isContainerMode = isNakliyeContainerProductType(fields.productType);

  const loadPreparationType =
    !isContainerMode && (isLoadPreparationTypeId(fields.loadPreparationType) || fields.loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE)
      ? fields.loadPreparationType
      : undefined;

  const skipQuantityForBulk = !isContainerMode && getProductQuantityFieldConfig(fields.loadPreparationType, fields.loadPreparationCustomText).useVolumeInstead;
  const quantityResult = isContainerMode || skipQuantityForBulk ? null : parseProductQuantity(fields.productQuantity);
  const tonnageRaw = fields.productTonnage.trim();
  const tonnageResult = tonnageRaw.length > 0 ? parseProductTonnage(fields.productTonnage, fields.productTonnageUnit === "kg" ? "kg" : "ton") : null;
  const resolvedProductType = isContainerMode
    ? NAKLIYE_CONTAINER_PRODUCT_TYPE_VALUE
    : fields.productType === PRODUCT_TYPE_CUSTOM_VALUE
      ? fields.productTypeCustomText.trim()
      : fields.productType.trim();

  const containerLoadStatus = fields.containerLoadStatus === "dolu" || fields.containerLoadStatus === "bos" ? fields.containerLoadStatus : undefined;
  const containerTransport: NakliyeContainerTransport = !isContainerMode
    ? { status: "hayir" }
    : {
        status: "evet",
        containerType: isContainerTypeId(fields.containerType) || fields.containerType === NAKLIYE_MANUAL_ENTRY_VALUE ? fields.containerType : undefined,
        containerTypeCustomText: fields.containerType === NAKLIYE_MANUAL_ENTRY_VALUE ? fields.containerTypeCustomText.trim() || undefined : undefined,
        loadStatus: containerLoadStatus,
        quantity: toPositiveIntegerOrUndefined(fields.containerQuantity, MAX_CONTAINER_QUANTITY),
        content:
          containerLoadStatus === "dolu" && (isContainerContentId(fields.containerContent) || fields.containerContent === NAKLIYE_MANUAL_ENTRY_VALUE)
            ? fields.containerContent
            : undefined,
        contentCustomText:
          containerLoadStatus === "dolu" && fields.containerContent === NAKLIYE_MANUAL_ENTRY_VALUE
            ? fields.containerContentCustomText.trim() || undefined
            : undefined,
      };

  const hazmat: NakliyeCargoGroup["hazmat"] =
    fields.hazmatStatus === "evet"
      ? { status: "evet", adrClass: fields.hazmatAdrClass.trim() || undefined }
      : fields.hazmatStatus === "hayir"
        ? { status: "hayir" }
        : undefined;

  return {
    id: fields.id,
    productQuantity: quantityResult?.ok ? quantityResult.value : undefined,
    productTonnage: tonnageResult?.ok ? tonnageResult.value : undefined,
    productTonnageUnit: isProductTonnageUnit(fields.productTonnageUnit) ? fields.productTonnageUnit : undefined,
    productType: resolvedProductType.length > 0 ? resolvedProductType : undefined,
    loadPreparationType,
    loadPreparationCustomText: loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE ? fields.loadPreparationCustomText.trim() || undefined : undefined,
    measurementInfo: isContainerMode ? undefined : fromMeasurementFields(loadPreparationType ?? "", fields.measurement),
    containerTransport,
    hazmat,
  };
}

/** `toCargoGroupsFields`in ters yönü — TÜM diziyi gönderim anındaki `NakliyeCargoGroup[]`e çevirir. Storage'ın kendi dizisinin aksine (bir grup zorunlu alanı eksikse ATLANIR) her grup HER ZAMAN çözümlenir — burada "eksik/geçersiz" durumu form doğrulaması (job-form-validation.ts) tarafından ayrıca engellenir, sessizce atlanmaz. */
export function fromCargoGroupsFields(groupsFields: NakliyeCargoGroupFieldValues[]): NakliyeCargoGroup[] {
  return groupsFields.map(fromCargoGroupFields);
}
