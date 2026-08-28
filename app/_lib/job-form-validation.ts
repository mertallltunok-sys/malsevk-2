import {
  isCustomsBrokerageCategory,
  isCustomsTransactionTypeId,
} from "./customs-brokerage-catalog";
import { isSimplifiedLocationCategory } from "./job-location";
import { isJobDateInPast } from "./jobs";
import { isTransportationCategory } from "./nakliye-route";
import { isNakliyeContainerProductType, isSelectableLoadPreparationTypeId, NAKLIYE_MANUAL_ENTRY_VALUE } from "./nakliye-transport-catalog";
import { MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";
import { isStorageGroupCategory, NAKLIYE_SERVICE_CATEGORY_ID } from "./service-catalog";
import { containsDangerousMarkup } from "./text-sanitization";
import { isHazardousStorageCategory, isTehlikeliMaddeDepolamaCategory } from "./storage-hazard-catalog";
import {
  isContainerStorageCategory,
  isContainerLoadApplicable,
  isHazmatDetailApplicable,
  isImoClassCode,
  isReeferContainerType,
  isStorageContainerSize,
  isStorageContainerStatus,
  isStorageContainerType,
  isYesNoValue,
  parseReeferTemperature,
  UN_NUMBER_MAX_LENGTH,
} from "./storage-container-catalog";
import {
  isRecyclingCategory,
  isRecyclingMaterialCondition,
  isRecyclingRequestedOperationId,
  isRecyclingScopeOfWorkId,
  isRecyclingUnit,
  isWasteQuantityUnit,
  parseRecyclingQuantity,
} from "./recycling-catalog";
import { deriveWasteCodeHazardous, isWasteCode, isWasteHazardPropertyId, isWasteTypeId } from "./recycling-waste-code-catalog";
import {
  isProductTonnageUnit,
  isTonnageRequired,
  parseProductQuantity,
  parseProductTonnage,
  PRODUCT_TYPE_CUSTOM_VALUE,
  requiresProductInfo,
} from "./product-catalog";
import {
  ADDRESS_MAX_LENGTH,
  MAX_CARGO_GROUPS,
  MAX_CONTAINER_QUANTITY,
  MAX_DIAMETER_CM,
  MAX_HEIGHT_CM,
  MAX_LENGTH_CM,
  MAX_ROLL_WIDTH_CM,
  MAX_STACK_COUNT,
  MAX_STORAGE_CONTAINER_GROUPS,
  MAX_VOLUME_M3,
  MAX_WIDTH_CM,
  MEASUREMENT_DECIMAL_PLACES,
  TITLE_MAX_LENGTH,
} from "./field-limits";

/**
 * MALSEVK genel ilan gizlilik kuralı, "İlan içeriğinden oluşabilecek
 * sızıntılar" — bir Hizmet Alan, tesis adını/telefon/e-postasını yapılandırılmış
 * alanlar yerine serbest metne (başlık/açıklama) yazarsa, sunucu tarafı
 * alan-maskeleme (bkz. supabase/migrations/0052) bunu ASLA yakalayamaz.
 * `containsDirectContactInfo` artık `contact-leak-detection.ts`de
 * MERKEZİLEŞTİRİLDİ (Genel Güvenlik görevi §8 — `offer-form-validation.ts`
 * de AYNI fonksiyonu kullanır) — burada yalnızca geriye dönük uyumluluk
 * için re-export edilir, hiçbir mevcut çağıran (job-request-form.tsx,
 * job-edit-form.tsx) değişmedi.
 */
import { containsDirectContactInfo } from "./contact-leak-detection";
export { containsDirectContactInfo };

export const DIRECT_CONTACT_INFO_TITLE_MESSAGE =
  "İlan başlığına telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklifiniz kabul edildikten sonra paylaşılabilir.";
export const DIRECT_CONTACT_INFO_DESCRIPTION_MESSAGE =
  "Açıklamaya firma/tesis adı, telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.";

export type JobFormFields = {
  category: string;
  title: string;
  description: string;
  province: string;
  district: string;
  /** "Liman / Sanayi / OSB" GÖRÜNEN adı — katalogdan seçilmiş bir tesisin adı ("catalog") ya da kullanıcının serbestçe yazdığı liman/sanayi/OSB adı ("custom"). */
  workLocationType: string;
  addressText: string;
  /** "catalog" — katalogdan seçildi. "custom" — "Listede yok, kendim gireceğim" seçildi. Depolama/Gümrük Müşavirliği'nde (bkz. isSimplifiedLocationCategory) hiç okunmaz — bu iki grup lokasyonu yalnızca İl/İlçe'dir. */
  locationMode: "catalog" | "custom";
  workDate: string;
  /** Bkz. types.ts#Job.workEndDate. İlan düzenleme (job-edit-form.tsx) her zaman bir değer gönderir — bu alandan önce oluşturulmuş (workEndDate'i hiç olmayan) bir ilan düzenlenirken form boş başlar ve validateWorkDateRange normal şekilde zorunlu kılar. */
  workEndDate: string;
  /** Yalnızca product-catalog.ts#requiresProductInfo(category) true iken doğrulanır/gösterilir — ham (henüz ayrıştırılmamış) metin girdisi. */
  productQuantity: string;
  /** Yalnızca requiresProductInfo true iken doğrulanır; Nakliye'de zorunlu, Liman Hizmetleri'nin tamamında isteğe bağlıdır (bkz. product-catalog.ts#isTonnageRequired). */
  productTonnage: string;
  /** Yalnızca isTransportationCategory(category) true iken anlamlı/doğrulanır — Liman Hizmetleri bu alanı hiç okumaz/göstermez, her zaman sabit "ton" kalır (bkz. product-catalog.ts#ProductTonnageUnit). Formda her zaman geçerli bir değerle (varsayılan "ton") başlar. */
  productTonnageUnit: string;
  /** Yalnızca requiresProductInfo true iken doğrulanır/gösterilir. Katalogdan bir öneri seçilmişse GERÇEK değeri, "Listede Yok, Kendim Gireceğim" seçilmişse product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE sentinel'ini taşır (gerçek metin bu durumda productTypeCustomText'tedir). */
  productType: string;
  /** Yalnızca productType === PRODUCT_TYPE_CUSTOM_VALUE iken doğrulanır/gösterilir — bkz. productType üstündeki doküman. */
  productTypeCustomText: string;
  /**
   * Yalnızca isTransportationCategory(category) true iken anlamlıdır —
   * `validateProductInfoFields`in "dokme" seçiliyken `productQuantity`
   * zorunluluğunu atlaması için ("Dinamik Ürün Adedi" görevi — Dökme'de adet
   * yerine AYNI measurement.volumeM3 alanı "Yaklaşık Hacim" olarak
   * gösterilir, o alan isteğe bağlıdır). Nakliye dışındaki kategorilerde hiç
   * okunmaz.
   */
  nakliyeLoadPreparationType?: string;
  /**
   * "Yük Bilgileri ve Konteyner Taşıması Birleştirmesi" görevi — Nakliye'nin
   * "Yük konteyner olarak mı taşınacak?" durumu ("evet"/"hayir"). "evet"
   * iken normal Yük Bilgileri (Ürün/Yük Cinsi/Adet/Tonaj) hiç GÖSTERİLMEDİĞİ
   * için `validateProductInfoFields` bu alanları hiç doğrulamaz — kullanıcının
   * göremediği bir alan yüzünden gönderim engellenmez. Nakliye dışındaki
   * kategorilerde hiç okunmaz.
   */
  nakliyeContainerTransportStatus?: string;
  /** Yalnızca customs-brokerage-catalog.ts#isCustomsBrokerageCategory(category) true iken doğrulanır/gösterilir — bkz. CustomsBrokerageFormFields. */
  customsTransactionType: string;
  customsRequestedServices: string[];
  /** Diğer hizmetlerin productType'ıyla AYNI seçim sistemi (product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS/ProductTypeCombobox) — katalogdan bir öneri GERÇEK değerini, "Listede Yok, Kendim Gireceğim" seçilmişse product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE sentinel'ini taşır (gerçek metin bu durumda customsProductTypeCustomText'tedir). Ayrı, bağımsız bir Job alanı (customsProductType) olarak kalır — productType ile BİRLEŞTİRİLMEZ. */
  customsProductType: string;
  /** Yalnızca customsProductType === PRODUCT_TYPE_CUSTOM_VALUE iken doğrulanır/gösterilir — bkz. productTypeCustomText üstündeki AYNI desen. */
  customsProductTypeCustomText: string;
  /** Yalnızca nakliye-route.ts#isTransportationCategory(category) true iken doğrulanır/gösterilir — bkz. validateNakliyeRouteSide. Bu durumda yukarıdaki province/district/workLocationType/addressText/locationMode "Yük Alınacak Yer"i temsil eder (bkz. validateJobForm). */
  deliveryProvince: string;
  deliveryDistrict: string;
  deliveryLocationType: "facility" | "open_address" | "";
  deliveryFacilityName: string;
  deliveryAddressText: string;
  /** Yalnızca recycling-catalog.ts#isRecyclingCategory(category) true iken doğrulanır/gösterilir — bkz. RecyclingFields. */
  recyclingMaterialCategoryId: string;
  recyclingMaterialSubtypeId: string;
  /** Ham (henüz ayrıştırılmamış) metin girdisi — bkz. recycling-catalog.ts#parseRecyclingQuantity. */
  recyclingQuantity: string;
  recyclingUnit: string;
  recyclingMaterialCondition: string;
  /** Yalnızca recyclingMaterialCondition === "diger" iken doğrulanır/gösterilir. */
  recyclingMaterialConditionNote: string;
  /** "Hizmet Kapsamı" çoklu seçimi — recycling-catalog.ts#RECYCLING_SCOPE_OF_WORK_OPTIONS'a ait id'ler. */
  recyclingScopeOfWork: string[];
  /** "A. Talep Edilen İşlem" — recycling-catalog.ts#RecyclingRequestedOperationId. */
  recyclingRequestedOperation: string;
  /** "C. Atık Kodu" — recycling-waste-code-catalog.ts#WASTE_CODE_ENTRIES'e ait gerçek bir kod. recyclingWasteCodeUnknown true iken doğrulanmaz. */
  recyclingWasteCode: string;
  /** "Atık kodunu bilmiyorum" — true iken recyclingWasteCode zorunlu değildir. */
  recyclingWasteCodeUnknown: boolean;
  /** "E. Tehlikeli Atık İçin Ek Bilgi" — yalnızca kod GERÇEKTEN tehlikeliyse (yıldızlı) zorunludur, bkz. deriveWasteCodeHazardous. */
  recyclingHazardProperties: string[];
  /** Yalnızca service-catalog.ts#isStorageGroupCategory(category) true iken doğrulanır/gösterilir — bkz. StorageProductFields. */
  storageProductType: string;
  /** Yalnızca storageProductType === PRODUCT_TYPE_CUSTOM_VALUE iken doğrulanır/gösterilir — bkz. productType üstündeki AYNI desen. */
  storageProductTypeCustomText: string;
  /** Ham (henüz ayrıştırılmamış) metin girdisi — bkz. product-catalog.ts#parseProductTonnage (AYNI ayrıştırma kuralı yeniden kullanılır). */
  storageProductQuantity: string;
  storageProductUnit: string;
  /** İsteğe bağlı — bkz. görev tanımı "Toplam Tonaj". */
  storageProductTonnage: string;
  /**
   * "Konteyner Grupları" — yalnızca storage-container-catalog.ts#
   * isContainerStorageCategory(category) true iken doğrulanır/gösterilir.
   * `storageProductType`/vb. yukarıdaki alanlarla HİÇBİR İLİŞKİSİ YOKTUR
   * (bu kategoride o dördü her zaman boş/`undefined` kalır — bir ilan
   * birden fazla konteyner grubu taşıyabildiği için TEK değerli o alanlar
   * artık kullanılamaz) — bkz. validateStorageContainerGroups. Dizi HER
   * ZAMAN en az 1 eleman içerir (form hiçbir zaman boş göndermez, "ilk grup
   * hazır gelir" — görev tanımı), ama doğrulama yine de bunu varsaymaz.
   */
  storageContainerGroups: StorageContainerGroupFieldsForValidation[];
  /** Yalnızca storage-hazard-catalog.ts#isHazardousStorageCategory(category) true iken doğrulanır/gösterilir — bkz. StorageHazardFields. Kimyasal Depolama'da "" | "hayir" | "evet", Tehlikeli Madde Depolama'da hiç render edilmez (her zaman "evet" kabul edilir). */
  storageHazardous: string;
  /** Bkz. storageHazardous üstündeki doküman — yalnızca hazmat "evet" iken en az 1 eleman zorunludur. */
  storageRiskGroups: string[];
  /**
   * "Operasyon Detayları" — form alanı (başlık/textarea) kaldırıldı (bkz.
   * görev tanımı), bu yüzden ARTIK doğrulanmaz/zorunlu değildir; alan
   * yalnızca eski ilanların mevcut değerini değişmeden `updateJob`'a geri
   * taşımak için burada tutulur (bkz. job-edit-form.tsx — artık düz bir
   * sabit, kullanıcı tarafından hiç değiştirilemez). Job.operationId ile
   * KARIŞTIRILMAMALI — operasyon gruplamasıyla hiçbir ilgisi yoktur.
   */
  operationDetails: string;
  photoCount: number;
};

/**
 * Gümrük Müşavirliği'ne özel "Operasyon Bilgileri" doğrulaması —
 * `validateJobForm` (ilan düzenleme) ve `validateServiceItem` (ilan
 * oluşturma) BİREBİR aynı kuralları paylaşır, `validateProductInfoFields`
 * ile AYNI desen (bkz. o fonksiyonun dokümantasyonu). Kategori
 * `isCustomsBrokerageCategory` kapsamı dışındaysa hiçbir alan doğrulanmaz —
 * bu durumda form zaten alanları göstermez.
 *
 * GTİP Kodu / Tahmini Beyan Kalem Sayısı / Konteyner Sayısı / Gümrük
 * Müdürlüğü formdan tamamen kaldırıldı — bu fonksiyon artık dördünü de
 * doğrulamaz (eski kayıtlarda bu alanlar varsa veri silinmez, yalnızca yeni
 * form akışı bunları hiç toplamaz/göstermez, bkz.
 * job-store.ts#resolveCustomsBrokerageFields). Gümrük Müdürlüğü'nün eski
 * yerinde artık Ürün Cinsi vardır (bkz. customs-brokerage-fields.tsx'in üst
 * ızgarası).
 *
 * customsProductType artık serbest metin DEĞİL — diğer hizmetlerin
 * productType'ıyla BİREBİR AYNI katalog+sentinel deseni (bkz.
 * validateProductInfoFields'ın productType/productTypeCustomText bloğu,
 * burada customsProductType/customsProductTypeCustomText için AYNEN
 * tekrarlanır — iki ayrı Job alanı olduğu için doğrulama da ayrı, ama kural
 * BİREBİR aynı: sentinel modundaysa customText zorunlu/100 karakter, değilse
 * kendisi zorunlu/100 karakter).
 */
function validateCustomsBrokerageFields(fields: {
  category: string;
  customsTransactionType: string;
  customsProductType: string;
  customsProductTypeCustomText: string;
}): {
  customsTransactionType?: string;
  customsProductType?: string;
  customsProductTypeCustomText?: string;
} {
  const errors: ReturnType<typeof validateCustomsBrokerageFields> = {};
  if (!isCustomsBrokerageCategory(fields.category)) return errors;

  if (!isCustomsTransactionTypeId(fields.customsTransactionType)) {
    errors.customsTransactionType = "İşlem türünü seçiniz.";
  }

  if (fields.customsProductType === PRODUCT_TYPE_CUSTOM_VALUE) {
    const customText = fields.customsProductTypeCustomText.trim();
    if (customText.length === 0) {
      errors.customsProductTypeCustomText = "Ürün cinsini yazmanız zorunludur.";
    } else if (customText.length > 100) {
      errors.customsProductTypeCustomText = "Ürün cinsi en fazla 100 karakter olabilir.";
    }
  } else {
    const customsProductType = fields.customsProductType.trim();
    if (customsProductType.length === 0) {
      errors.customsProductType = "Ürün cinsini giriniz.";
    } else if (customsProductType.length > 100) {
      errors.customsProductType = "Ürün cinsi en fazla 100 karakter olabilir.";
    }
  }

  return errors;
}

/**
 * Geri Dönüşüm & Atık Tahliye'ye özel alan grubu doğrulaması —
 * `validateCustomsBrokerageFields` ile BİREBİR aynı desen/rol. Kategori
 * `isRecyclingCategory` kapsamı dışındaysa hiçbir alan doğrulanmaz. Alt tür,
 * seçilen malzeme kategorisine GERÇEKTEN ait olmalıdır (bkz.
 * recycling-catalog.ts#isRecyclingMaterialSubtypeId) — kategoriler arası
 * çapraz bir alt tür seçimi (ör. "Plastik" seçiliyken "Bakır") hata verir.
 */
function validateRecyclingFields(fields: {
  category: string;
  recyclingMaterialCategoryId: string;
  recyclingMaterialSubtypeId: string;
  recyclingQuantity: string;
  recyclingUnit: string;
  recyclingMaterialCondition: string;
  recyclingMaterialConditionNote: string;
  recyclingScopeOfWork: string[];
  recyclingRequestedOperation: string;
  recyclingWasteCode: string;
  recyclingWasteCodeUnknown: boolean;
  recyclingHazardProperties: string[];
}): {
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: string;
  recyclingUnit?: string;
  recyclingMaterialCondition?: string;
  recyclingMaterialConditionNote?: string;
  recyclingScopeOfWork?: string;
  recyclingRequestedOperation?: string;
  recyclingWasteCode?: string;
  recyclingHazardProperties?: string;
} {
  const errors: ReturnType<typeof validateRecyclingFields> = {};
  if (!isRecyclingCategory(fields.category)) return errors;

  // "B. ATIK TÜRÜ" — YENİ 19 kalemlik düz liste (recycling-waste-code-catalog.ts#WASTE_TYPE_OPTIONS),
  // ESKİ "Malzeme Kategorisi -> Alt Tür" iki katmanlı seçicinin YERİNE geçer
  // (görev talimatının kendi onayı: "yeni liste eskisinin yerine geçsin").
  // recyclingMaterialSubtypeId alanı artık bir alt tür id'si DEĞİL, yalnızca
  // "diger" seçiliyken doldurulan serbest metin açıklamasıdır (eski
  // subtype tree'nin ikinci bir alan İCAT ETMEDEN yeniden kullanılması).
  // DÜZELTME (kök neden): bu alan artık recycling-waste-code-catalog.ts#
  // WasteTypeId taşır (recycling-fields.tsx#WASTE_TYPE_SELECT_OPTIONS
  // bunları üretir) — eski recycling-catalog.ts#isRecyclingMaterialCategoryId
  // (7 kategorilik ESKİ ağaç) ile doğrulamak "cam"/"ahsap"/"tekstil"/vb. 16
  // yeni id'nin TAMAMINI (yalnızca kagit-karton/plastik/metal-hurda id
  // string'leri iki ağaçta da rastlantısal olarak örtüştüğü için) her zaman
  // reddederdi. Doğru doğrulayıcı isWasteTypeId'dir.
  if (!isWasteTypeId(fields.recyclingMaterialCategoryId)) {
    errors.recyclingMaterialCategoryId = "Atık türünü seçiniz.";
  } else if (fields.recyclingMaterialCategoryId === "diger" && fields.recyclingMaterialSubtypeId.trim().length === 0) {
    errors.recyclingMaterialSubtypeId = "Atık türünü kısaca açıklayınız.";
  } else if (fields.recyclingMaterialSubtypeId.trim().length > 200) {
    errors.recyclingMaterialSubtypeId = "Açıklama en fazla 200 karakter olabilir.";
  }

  const quantityResult = parseRecyclingQuantity(fields.recyclingQuantity);
  if (!quantityResult.ok) {
    errors.recyclingQuantity = "Geçerli bir miktar giriniz.";
  }

  if (!isWasteQuantityUnit(fields.recyclingUnit)) {
    errors.recyclingUnit = "Birimi seçiniz.";
  }

  if (!isRecyclingMaterialCondition(fields.recyclingMaterialCondition)) {
    errors.recyclingMaterialCondition = "Malzeme durumunu seçiniz.";
  } else if (fields.recyclingMaterialCondition === "diger") {
    const note = fields.recyclingMaterialConditionNote.trim();
    if (note.length === 0) {
      errors.recyclingMaterialConditionNote = "Kısa bir açıklama giriniz.";
    } else if (note.length > 300) {
      errors.recyclingMaterialConditionNote = "Açıklama en fazla 300 karakter olabilir.";
    }
  }

  // "Hizmet Veren, teklif vermeden önce kendisinden ne beklendiğini bilir" —
  // en az bir kapsam seçeneği zorunludur (görev tanımının kendi sorusu:
  // "Hizmet kapsamında neler yapılmasını istiyorsunuz?"). Tanınmayan bir id
  // sessizce yok sayılır, hata üretmez (bkz. isRecyclingScopeOfWorkId).
  const validScopeCount = fields.recyclingScopeOfWork.filter((id) => isRecyclingScopeOfWorkId(id)).length;
  if (validScopeCount === 0) {
    errors.recyclingScopeOfWork = "En az bir işlem seçmelisiniz.";
  }

  // "A. TALEP EDİLEN İŞLEM" — YENİ, zorunlu.
  if (!isRecyclingRequestedOperationId(fields.recyclingRequestedOperation)) {
    errors.recyclingRequestedOperation = "Talep edilen işlemi seçiniz.";
  }

  // "C. ATIK KODU" — "Atık kodunu bilmiyorum" işaretliyse kod ZORUNLU
  // DEĞİLDİR (görev talimatı: "Sistem kullanıcının yerine tahminî atık kodu
  // oluşturmasın") — ilan yine de gönderilebilir, ama gerçek kod
  // girilmeden hiçbir depocuyla eşleşmez (fail-closed, bkz. provider_can_
  // view_job'un recycling dalı) ve admin incelemesi/düzeltmesi beklenir.
  if (!fields.recyclingWasteCodeUnknown && !isWasteCode(fields.recyclingWasteCode)) {
    errors.recyclingWasteCode = "Atık kodunu seçiniz (bilmiyorsanız 'Atık kodunu bilmiyorum' seçeneğini işaretleyebilirsiniz).";
  }

  // "E. TEHLİKELİ ATIK İÇİN EK BİLGİ" — yalnızca kod GERÇEKTEN tehlikeliyse
  // (yıldızlı) zorunludur; kod bilinmiyorsa (hazardous=null) hiç sorulmaz/
  // zorunlu kılınmaz (görev talimatı: "sistem kendiliğinden tehlikesiz
  // karar vermemeli" — belirsizlik burada YOK SAYILMAZ, yalnızca bu ek
  // alan atlanır, kodun kendisi zaten eksik olduğu için ilan atık-kodu
  // eşleşmesine hiç girmeyecektir).
  const hazardous = fields.recyclingWasteCodeUnknown ? null : deriveWasteCodeHazardous(fields.recyclingWasteCode);
  if (hazardous === true) {
    const validPropertyCount = fields.recyclingHazardProperties.filter((id) => isWasteHazardPropertyId(id)).length;
    if (validPropertyCount === 0) {
      errors.recyclingHazardProperties = "En az bir tehlike özelliği seçiniz.";
    }
  }

  return errors;
}

/**
 * "Depolanacak Ürün Bilgileri" doğrulaması — `validateCustomsBrokerageFields`
 * ile AYNI desen/rol. Kategori `isStorageGroupCategory` kapsamı dışındaysa
 * hiçbir alan doğrulanmaz. YALNIZCA "Konteyner Depolama" DA BİLEREK
 * ATLANIR — bu kategori için kart TAMAMEN GİZLİDİR ve bu dört alan artık
 * o kategoride HİÇ KULLANILMAZ (bir ilan birden fazla konteyner grubu
 * taşıyabildiği için TEK değerli bu alanlar yetersiz kalır) — bkz.
 * storage-container-catalog.ts'in kendi başlık dokümanındaki 3. tasarım
 * notu. Konteyner Depolama'nın kendi alanları `validateStorageContainerGroups`
 * tarafından, TAMAMEN AYRI bir (grup dizisi) kural setiyle doğrulanır.
 * `storageProductType`, customsProductType ile BİREBİR AYNI katalog+sentinel
 * deseni kullanır (product-catalog.ts# PRODUCT_TYPE_CUSTOM_VALUE) —
 * sentinel modundaysa customText zorunlu, değilse kendisi zorunlu.
 * Miktar/Tonaj ikisi de product-catalog.ts# parseProductTonnage ile
 * ayrıştırılır (AYNI ondalıklı-sayı kuralı, ikinci bir ayrıştırıcı İCAT
 * EDİLMEDİ) — Miktar zorunlu/0dan büyük, Tonaj isteğe bağlı (boşsa hiç
 * doğrulanmaz).
 */
function validateStorageProductFields(fields: {
  category: string;
  storageProductType: string;
  storageProductTypeCustomText: string;
  storageProductQuantity: string;
  storageProductUnit: string;
  storageProductTonnage: string;
}): {
  storageProductType?: string;
  storageProductTypeCustomText?: string;
  storageProductQuantity?: string;
  storageProductUnit?: string;
  storageProductTonnage?: string;
} {
  const errors: ReturnType<typeof validateStorageProductFields> = {};
  if (!isStorageGroupCategory(fields.category) || isContainerStorageCategory(fields.category)) return errors;

  if (fields.storageProductType === PRODUCT_TYPE_CUSTOM_VALUE) {
    const customText = fields.storageProductTypeCustomText.trim();
    if (customText.length === 0) {
      errors.storageProductTypeCustomText = "Ürün adını yazmanız zorunludur.";
    } else if (customText.length > 100) {
      errors.storageProductTypeCustomText = "Ürün adı en fazla 100 karakter olabilir.";
    }
  } else {
    const storageProductType = fields.storageProductType.trim();
    if (storageProductType.length === 0) {
      errors.storageProductType = "Ürün cinsini seçiniz.";
    } else if (storageProductType.length > 100) {
      errors.storageProductType = "Ürün cinsi en fazla 100 karakter olabilir.";
    }
  }

  if (!parseProductTonnage(fields.storageProductQuantity).ok) {
    errors.storageProductQuantity = "Geçerli bir miktar giriniz.";
  }

  if (!isRecyclingUnit(fields.storageProductUnit)) {
    errors.storageProductUnit = "Birimi seçiniz.";
  }

  if (fields.storageProductTonnage.trim().length > 0 && !parseProductTonnage(fields.storageProductTonnage).ok) {
    errors.storageProductTonnage = "Geçerli bir tonaj giriniz.";
  }

  return errors;
}

/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — kapsam dışı
 * (`isHazardousStorageCategory` false) HER kategoride hiç doğrulanmaz.
 * Kimyasal Depolama'da yalnızca `storageHazardous === "evet"` iken en az bir
 * risk grubu ZORUNLUDUR (Hayır iken/hiç seçilmemişken risk grubu hiç
 * doğrulanmaz — görev talimatı: "ADR veya tehlike sınıfı zorunlu
 * tutulmasın"). Tehlikeli Madde Depolama'da soru HİÇ sorulmadığı için
 * (görev talimatı) `storageHazardous`un kendisi burada hiç kontrol edilmez —
 * risk grubu HER ZAMAN zorunludur.
 */
function validateStorageHazardFields(fields: {
  category: string;
  storageHazardous: string;
  storageRiskGroups: string[];
}): { storageRiskGroups?: string } {
  const errors: ReturnType<typeof validateStorageHazardFields> = {};
  if (!isHazardousStorageCategory(fields.category)) return errors;

  const requiresRiskGroups = isTehlikeliMaddeDepolamaCategory(fields.category) || fields.storageHazardous === "evet";
  if (requiresRiskGroups && fields.storageRiskGroups.length === 0) {
    errors.storageRiskGroups = "En az bir depolama tehlike/risk grubu seçiniz.";
  }
  return errors;
}

export type StorageContainerGroupFieldsForValidation = {
  id: string;
  quantity: string;
  size: string;
  type: string;
  status: string;
  /** "Yük İçeriği" — product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE sentinel deseni. */
  content: string;
  contentCustomText: string;
  grossWeight: string;
  hazardous: string;
  unNumber: string;
  imoClass: string;
  reeferTemperature: string;
  reeferElectrical: string;
};

export type StorageContainerGroupErrors = Partial<Record<Exclude<keyof StorageContainerGroupFieldsForValidation, "id">, string>>;

/**
 * TEK bir konteyner grubunun doğrulaması — `validateStorageProductFields`
 * ile AYNI dosyada, AYNI desen ama TAMAMEN AYRI bir kural seti (bu
 * kategoride `validateStorageProductFields` hiç çağrılmaz, bkz. o
 * fonksiyonun kendi güncellenmiş dokümanı). Ölçü/Tip/Durum/Adet HER ZAMAN
 * zorunludur. Yük Durumu "dolu" DEĞİLSE Yük İçeriği/Brüt Ağırlık/Tehlikeli
 * Madde/UN/IMO'nun HİÇBİRİ doğrulanmaz (form zaten göstermez, bkz.
 * storage-container-details-fields.tsx'in kendi CANLI temizlemesi) —
 * "dolu" İSE Yük İçeriği VE Tehlikeli Madde zorunlu, Brüt Ağırlık isteğe
 * bağlıdır (girilmişse geçerli olmalı), Tehlikeli Madde "evet" İSE UN
 * Numarası/IMO Sınıfı da zorunlu olur. Reefer sıcaklık/elektrik alanları
 * BUNLARDAN BAĞIMSIZDIR — yalnızca Tip "reefer" iken (Dolu/Boş fark
 * etmeksizin) zorunludur. `validateStorageContainerGroups` (aşağıda) bu
 * fonksiyonu dizideki HER grup için ayrı ayrı çağırır.
 */
export function validateStorageContainerGroup(fields: StorageContainerGroupFieldsForValidation): StorageContainerGroupErrors {
  const errors: StorageContainerGroupErrors = {};

  const quantityTrimmed = fields.quantity.trim();
  if (quantityTrimmed.length === 0) {
    errors.quantity = "Konteyner adedini giriniz.";
  } else if (!/^\d+$/.test(quantityTrimmed) || Number(quantityTrimmed) <= 0) {
    errors.quantity = "Konteyner adedi için pozitif bir tam sayı giriniz.";
  } else if (Number(quantityTrimmed) > MAX_CONTAINER_QUANTITY) {
    // "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: Depolama
    // Konteyner Grupları'nın adet alanı hiçbir üst sınıra sahip değildi.
    errors.quantity = `Konteyner adedi en fazla ${MAX_CONTAINER_QUANTITY} olabilir.`;
  }

  if (!isStorageContainerSize(fields.size)) {
    errors.size = "Konteyner ölçüsünü seçiniz.";
  }
  if (!isStorageContainerType(fields.type)) {
    errors.type = "Konteyner tipini seçiniz.";
  }
  if (!isStorageContainerStatus(fields.status)) {
    errors.status = "Yük durumunu seçiniz.";
  }

  if (isContainerLoadApplicable(fields.status)) {
    if (fields.content === PRODUCT_TYPE_CUSTOM_VALUE) {
      const customText = fields.contentCustomText.trim();
      if (customText.length === 0) {
        errors.contentCustomText = "Yük içeriğini yazmanız zorunludur.";
      } else if (customText.length > 100) {
        errors.contentCustomText = "Yük içeriği en fazla 100 karakter olabilir.";
      }
    } else {
      const content = fields.content.trim();
      if (content.length === 0) {
        errors.content = "Yük içeriğini seçiniz.";
      } else if (content.length > 100) {
        errors.content = "Yük içeriği en fazla 100 karakter olabilir.";
      }
    }

    if (fields.grossWeight.trim().length > 0 && !parseProductTonnage(fields.grossWeight).ok) {
      errors.grossWeight = "Geçerli bir ağırlık giriniz.";
    }

    if (!isYesNoValue(fields.hazardous)) {
      errors.hazardous = "Tehlikeli madde olup olmadığını seçiniz.";
    } else if (isHazmatDetailApplicable(fields.hazardous)) {
      const unNumber = fields.unNumber.trim();
      if (unNumber.length === 0) {
        errors.unNumber = "UN numarasını giriniz.";
      } else if (unNumber.length > UN_NUMBER_MAX_LENGTH) {
        errors.unNumber = `UN numarası en fazla ${UN_NUMBER_MAX_LENGTH} karakter olabilir.`;
      }

      if (!isImoClassCode(fields.imoClass)) {
        errors.imoClass = "IMO sınıfını seçiniz.";
      }
    }
  }

  if (isReeferContainerType(fields.type)) {
    if (!parseReeferTemperature(fields.reeferTemperature).ok) {
      errors.reeferTemperature = "Geçerli bir sıcaklık giriniz.";
    }
    if (!isYesNoValue(fields.reeferElectrical)) {
      errors.reeferElectrical = "Elektrik bağlantısı gerekip gerekmediğini seçiniz.";
    }
  }

  return errors;
}

/**
 * TÜM konteyner grubu dizisinin doğrulaması — her grup `group.id`sine göre
 * anahtarlanmış KENDİ hata nesnesini alır (dizi index'ine GÖRE DEĞİL, bkz.
 * storage-container-details-fields.tsx#StorageContainerGroupsFields'ın AYNI
 * gerekçesi — bir grup silindiğinde diğerlerinin index'i kayar, `id` hiç
 * değişmez). En az 1 grup gerektirir (form bunu zaten garanti eder, ama
 * doğrulama yine de kontrol eder — boş bir dizi asla sessizce geçerli
 * sayılmaz).
 */
export function validateStorageContainerGroups(
  groups: StorageContainerGroupFieldsForValidation[],
): { groupErrors: Record<string, StorageContainerGroupErrors>; hasErrors: boolean } {
  const groupErrors: Record<string, StorageContainerGroupErrors> = {};
  // "Aşılamaz Giriş Sınırları" görevi — UI'daki "+ Ekle" butonu zaten
  // MAX_STORAGE_CONTAINER_GROUPS'ta durur (defense-in-depth'in birinci
  // katmanı); bu, doğrulamanın kendi (ikinci, form-bypass'a dayanıklı) katmanı.
  let hasErrors = groups.length === 0 || groups.length > MAX_STORAGE_CONTAINER_GROUPS;
  for (const group of groups) {
    const errors = validateStorageContainerGroup(group);
    if (Object.keys(errors).length > 0) {
      groupErrors[group.id] = errors;
      hasErrors = true;
    }
  }
  return { groupErrors, hasErrors };
}

/**
 * "Ürün Bilgileri" doğrulaması — `validateJobForm` (ilan düzenleme) ve
 * `validateServiceItem` (ilan oluşturma) BİREBİR aynı kuralları paylaşır,
 * dosyanın geri kalanındaki BİLİNÇLİ tekrar deseniyle (bkz. ServiceItemFields
 * üstündeki not) tutarlı olacak şekilde HER İKİSİNDE de çağrılır. Kategori
 * `requiresProductInfo` kapsamı dışındaysa üç alan da hiç doğrulanmaz — bu
 * durumda form zaten alanları göstermez. "Yük Bilgileri ve Konteyner
 * Taşıması Birleştirmesi" görevi — Nakliye'de Konteyner Taşıması=Evet iken
 * de AYNI şekilde hiç doğrulanmaz (normal Yük Bilgileri dalı tamamen
 * gizlenir, yerine yalnızca Konteyner Bilgileri kullanılır).
 */
function validateProductInfoFields(fields: {
  category: string;
  productQuantity: string;
  productTonnage: string;
  productTonnageUnit: string;
  productType: string;
  productTypeCustomText: string;
  nakliyeLoadPreparationType?: string;
}): {
  productQuantity?: string;
  productTonnage?: string;
  productTonnageUnit?: string;
  productType?: string;
  productTypeCustomText?: string;
} {
  const errors: ReturnType<typeof validateProductInfoFields> = {};
  if (!requiresProductInfo(fields.category)) return errors;

  // "Dinamik Ürün Adedi" görevi: Nakliye'de "dokme" seçiliyken Ürün Adedi
  // alanı hiç gösterilmez — yerine AYNI measurement.volumeM3 kaynağından
  // gelen "Yaklaşık Hacim" (isteğe bağlı) gösterilir, bu yüzden burada
  // productQuantity hiç zorunlu kılınmaz.
  const skipQuantityForBulk = isTransportationCategory(fields.category) && fields.nakliyeLoadPreparationType === "dokme";
  const quantityResult = skipQuantityForBulk ? { ok: true as const } : parseProductQuantity(fields.productQuantity);
  if (!quantityResult.ok) {
    switch (quantityResult.error) {
      case "empty":
        errors.productQuantity = "Ürün adedini giriniz.";
        break;
      case "not-integer":
        errors.productQuantity = "Ürün adedi yalnızca tam sayı olabilir.";
        break;
      case "not-positive":
        errors.productQuantity = "Ürün adedi pozitif bir sayı olmalıdır.";
        break;
      case "too-large":
        errors.productQuantity = "Ürün adedi çok büyük.";
        break;
      default:
        errors.productQuantity = "Geçerli bir ürün adedi giriniz.";
    }
  }

  const tonnageRequired = isTonnageRequired(fields.category);
  const tonnageRaw = fields.productTonnage.trim();
  if (tonnageRequired || tonnageRaw.length > 0) {
    // "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: bu çağrı
    // hep sabit "ton" varsayıyordu, oysa Nakliye'de kullanıcı Kg da
    // seçebilir (birim ~1000× fark yaratır, bkz. product-catalog.ts#
    // parseProductTonnage'ın güncellenmiş dokümanı). Nakliye dışı
    // kategorilerde `productTonnageUnit` her zaman "ton"dur (form birim
    // seçtirmez), bu yüzden bu satır o çağıranları HİÇ ETKİLEMEZ.
    const tonnageResult = parseProductTonnage(fields.productTonnage, fields.productTonnageUnit === "kg" ? "kg" : "ton");
    if (!tonnageResult.ok) {
      switch (tonnageResult.error) {
        case "empty":
          errors.productTonnage = "Tonaj bilgisini giriniz.";
          break;
        case "not-positive":
          errors.productTonnage = "Tonaj pozitif bir sayı olmalıdır.";
          break;
        case "too-large":
          errors.productTonnage = "Tonaj çok büyük.";
          break;
        default:
          errors.productTonnage = "Geçerli bir tonaj giriniz.";
      }
    }
  }

  // Birim yalnızca Nakliye'de anlamlıdır (bkz. görev tanımı) — Liman
  // Hizmetleri'nde hiç doğrulanmaz, formu da hiç göstermez (sabit "ton").
  // Gerçek formda her zaman geçerli bir varsayılanla (ton) başladığı için bu
  // esasen savunmacı bir kontroldür — "Birim seçimi zorunludur" kuralının
  // veri katmanındaki karşılığı.
  if (isTransportationCategory(fields.category) && !isProductTonnageUnit(fields.productTonnageUnit)) {
    errors.productTonnageUnit = "Ağırlık birimini seçiniz.";
  }

  // "Listede Yok, Kendim Gireceğim" seçiliyken gerçek metin productTypeCustomText'te
  // yaşar — productType o durumda yalnızca sentinel'i taşır, hiç doğrulanmaz
  // (bkz. product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE üstündeki doküman).
  if (fields.productType === PRODUCT_TYPE_CUSTOM_VALUE) {
    const customText = fields.productTypeCustomText.trim();
    if (customText.length === 0) {
      errors.productTypeCustomText = "Ürün cinsini yazmanız zorunludur.";
    } else if (customText.length > 100) {
      errors.productTypeCustomText = "Ürün cinsi en fazla 100 karakter olabilir.";
    }
  } else {
    const productType = fields.productType.trim();
    if (productType.length === 0) {
      errors.productType = "Ürün cinsini giriniz.";
    } else if (productType.length > 100) {
      errors.productType = "Ürün cinsi en fazla 100 karakter olabilir.";
    }
  }

  return errors;
}

/**
 * Nakliye Güzergâh Yönetimi — "Yük Alınacak Yer" VE "Teslim Edilecek Yer"nin
 * İKİSİ için de kullanılan TEK ortak konum doğrulaması ("aynı yapıda
 * çalışsın" gereksinimi, bkz. nakliye-location-fields.tsx). `validateJobForm`/
 * `validateServiceItem` bunu HER iki taraf için de (farklı alan adlarıyla
 * eşleyerek) ayrı ayrı çağırır — pickup mevcut/paylaşılan `province`/
 * `district`/`workLocationType`/`addressText`/`locationMode` alanlarını,
 * delivery kendi `delivery*` alanlarını kullanır. `facilityLabel`, tesis adının
 * KAYNAĞına (katalog ya da kullanıcının serbestçe yazdığı ad) bakılmaksızın
 * HER İKİ moda da AYNI alandan gelir (pickup'ta workLocationType, delivery'de
 * deliveryFacilityName — job-location.ts'in Nakliye DIŞI kategorilerdeki
 * "serbest metin adı aynı görünen alana yazılır" ilkesiyle AYNI). `locationType`
 * hata anahtarı "hiç yöntem seçilmedi" / "katalogdan tesis seçilmedi" /
 * "manuel ad girilmedi ya da çok uzun" durumlarını taşır. Açık adres artık
 * seçilen yönteme bakılmaksızın HER ZAMAN zorunludur (bkz. görev tanımı madde
 * 2/3) ve KENDİ, AYRI `addressText` hata anahtarı altında raporlanır — tesis
 * seçimiyle karıştırılmaz, ikisi birbirinden bağımsız doğrulanır.
 */
function validateNakliyeRouteSide(fields: {
  province: string;
  district: string;
  locationType: "facility" | "open_address" | "";
  /** facility modunda katalogdan seçilmiş tesisin çözümlenmiş adı, open_address modunda kullanıcının serbestçe yazdığı liman/sanayi/OSB adı. */
  facilityLabel: string;
  addressText: string;
}): { province?: string; district?: string; locationType?: string; addressText?: string } {
  const errors: ReturnType<typeof validateNakliyeRouteSide> = {};

  const province = fields.province.trim();
  if (province.length === 0) {
    errors.province = "İl seçiniz.";
  }

  const district = fields.district.trim();
  if (district.length === 0) {
    errors.district = "İlçe seçiniz.";
  }

  const facilityLabel = fields.facilityLabel.trim();
  if (fields.locationType === "facility") {
    if (facilityLabel.length === 0) {
      errors.locationType = "Liman / Sanayi / OSB seçiniz.";
    }
  } else if (fields.locationType === "open_address") {
    if (facilityLabel.length === 0) {
      errors.locationType = "Liman / Sanayi / OSB adını giriniz.";
    } else if (facilityLabel.length > 150) {
      errors.locationType = "Liman / Sanayi / OSB adı en fazla 150 karakter olabilir.";
    }
  } else {
    errors.locationType = 'Liman / Sanayi / OSB seçin veya "Listede yok, kendim gireceğim" ile tesis adını girin.';
  }

  // Açık adres artık seçilen yönteme (katalog tesis ya da manuel ad)
  // bakılmaksızın HER ZAMAN zorunlu (bkz. görev tanımı madde 2/3).
  const addressText = fields.addressText.trim();
  if (addressText.length === 0) {
    errors.addressText = "Açık adresi giriniz.";
  } else if (addressText.length < 10) {
    errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
  } else if (addressText.length > ADDRESS_MAX_LENGTH) {
    errors.addressText = `Açık adres en fazla ${ADDRESS_MAX_LENGTH} karakter olabilir.`;
  }

  return errors;
}

/**
 * Başlangıç/bitiş tarih çiftinin TEK ortak doğrulaması — hem `validateJobForm`
 * (ilan düzenleme) hem `validateServiceItem` (ilan oluşturma, tekil VE çoklu
 * operasyon) burayı çağırır; kural iki dosyada/iki yerde ayrı ayrı
 * kopyalanmaz. Geçmiş tarih politikası: başlangıç tarihi jobs.ts#
 * isJobDateInPast (TAMAMEN yerel takvime göre, UTC kaymasına karşı korumalı
 * — bkz. o fonksiyonun dokümanı) ile bugünden önce OLAMAZ; bu kontrol yalnızca
 * geçerli/parse edilebilir bir tarih üzerinde çalışır (boş/parse hatası zaten
 * kendi mesajını üretir, ikisi asla aynı anda üretilmez). Aynı gün
 * (workEndDate === workDate) geçerlidir.
 */
function validateWorkDateRange(
  workDateRaw: string,
  workEndDateRaw: string,
): { workDate?: string; workEndDate?: string } {
  const errors: { workDate?: string; workEndDate?: string } = {};

  const workDate = workDateRaw.trim();
  const workDateTime = new Date(workDateRaw).getTime();
  if (workDate.length === 0) {
    errors.workDate = "Başlangıç tarihini seçiniz.";
  } else if (Number.isNaN(workDateTime)) {
    errors.workDate = "Geçerli bir başlangıç tarihi seçiniz.";
  } else if (isJobDateInPast(workDate)) {
    errors.workDate = "Başlangıç tarihi geçmiş bir tarih olamaz.";
  }

  const workEndDate = workEndDateRaw.trim();
  const workEndDateTime = new Date(workEndDateRaw).getTime();
  if (workEndDate.length === 0) {
    errors.workEndDate = "Bitiş tarihini seçiniz.";
  } else if (Number.isNaN(workEndDateTime)) {
    errors.workEndDate = "Geçerli bir bitiş tarihi seçiniz.";
  } else if (workDate.length > 0 && !Number.isNaN(workDateTime) && workEndDateTime < workDateTime) {
    errors.workEndDate = "Bitiş tarihi başlangıç tarihinden önce olamaz.";
  }

  return errors;
}

export type JobFormErrors = Partial<Record<keyof JobFormFields, string>> & {
  /** Bkz. validateStorageContainerGroups — grup `id`sine göre anahtarlanmış, tek bir `string`e sığmayan per-grup hata nesnesi. */
  storageContainerGroupErrors?: Record<string, StorageContainerGroupErrors>;
};

/**
 * İl/ilçe/tesis değiştiğinde artık geçersiz kalan alanların eski hata
 * mesajlarını temizler — oluşturma (job-request-form.tsx) ve düzenleme
 * (job-edit-form.tsx) formları aynı mantığı burada paylaşır. Hiçbir alan
 * silinmeyecekse aynı referansı döner (gereksiz re-render olmasın diye).
 */
export function clearJobFormErrors(
  errors: JobFormErrors,
  fields: (keyof JobFormErrors)[],
): JobFormErrors {
  if (!fields.some((field) => field in errors)) return errors;
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

export function validateJobForm(fields: JobFormFields): JobFormErrors {
  const errors: JobFormErrors = {};

  if (fields.category.trim().length === 0) {
    errors.category = "Hizmet kategorisi seçiniz.";
  }

  const title = fields.title.trim();
  if (title.length === 0) {
    errors.title = "İlan başlığı zorunludur.";
  } else if (title.length < 5) {
    errors.title = "İlan başlığı en az 5 karakter olmalıdır.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `İlan başlığı en fazla ${TITLE_MAX_LENGTH} karakter olabilir.`;
  } else if (containsDirectContactInfo(title)) {
    errors.title = DIRECT_CONTACT_INFO_TITLE_MESSAGE;
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "İş açıklaması zorunludur.";
  } else if (description.length < 20) {
    errors.description = "İş açıklaması en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "İş açıklaması en fazla 1.000 karakter olabilir.";
  } else if (containsDirectContactInfo(description)) {
    errors.description = DIRECT_CONTACT_INFO_DESCRIPTION_MESSAGE;
  }

  // Nakliye: "Yük Alınacak Yer" (yukarıdaki paylaşılan province/district/
  // workLocationType/addressText/locationMode alanları) VE "Teslim Edilecek
  // Yer" (delivery* alanları) validateNakliyeRouteSide üzerinden AYNI kurala
  // göre doğrulanır — Nakliye dışındaki TÜM kategorilerde bu alanların
  // doğrulaması BİREBİR eskisiyle aynı kalır (aşağıdaki else dalı, hiç
  // değişmedi).
  if (isTransportationCategory(fields.category)) {
    const pickupErrors = validateNakliyeRouteSide({
      province: fields.province,
      district: fields.district,
      locationType: fields.locationMode === "custom" ? "open_address" : "facility",
      facilityLabel: fields.workLocationType,
      addressText: fields.addressText,
    });
    if (pickupErrors.province) errors.province = pickupErrors.province;
    if (pickupErrors.district) errors.district = pickupErrors.district;
    if (pickupErrors.locationType) errors.workLocationType = pickupErrors.locationType;
    if (pickupErrors.addressText) errors.addressText = pickupErrors.addressText;

    const deliveryErrors = validateNakliyeRouteSide({
      province: fields.deliveryProvince,
      district: fields.deliveryDistrict,
      locationType: fields.deliveryLocationType,
      facilityLabel: fields.deliveryFacilityName,
      addressText: fields.deliveryAddressText,
    });
    if (deliveryErrors.province) errors.deliveryProvince = deliveryErrors.province;
    if (deliveryErrors.district) errors.deliveryDistrict = deliveryErrors.district;
    if (deliveryErrors.locationType) errors.deliveryLocationType = deliveryErrors.locationType;
    if (deliveryErrors.addressText) errors.deliveryAddressText = deliveryErrors.addressText;
  } else if (isSimplifiedLocationCategory(fields.category)) {
    // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği: lokasyon yalnızca
    // İl/İlçe'dir — Liman/Sanayi/OSB, Açık Adres ve (Gümrük'ün eski) Bölge-
    // Mahalle/Konum Bağlantısı/Adres Tarifi hiç doğrulanmaz (form zaten bu
    // alanları göstermez, bkz. job-location.ts#isSimplifiedLocationCategory).
    const province = fields.province.trim();
    if (province.length === 0) {
      errors.province = "İl zorunludur.";
    } else if (province.length < 2) {
      errors.province = "Geçerli bir il giriniz.";
    }

    const district = fields.district.trim();
    if (district.length === 0) {
      errors.district = "İlçe zorunludur.";
    } else if (district.length < 2) {
      errors.district = "Geçerli bir ilçe giriniz.";
    }
  } else {
    const province = fields.province.trim();
    if (province.length === 0) {
      errors.province = "İl zorunludur.";
    } else if (province.length < 2) {
      errors.province = "Geçerli bir il giriniz.";
    }

    const district = fields.district.trim();
    if (district.length === 0) {
      errors.district = "İlçe zorunludur.";
    } else if (district.length < 2) {
      errors.district = "Geçerli bir ilçe giriniz.";
    }

    const isCustomLocation = fields.locationMode === "custom";

    const workLocationType = fields.workLocationType.trim();
    if (workLocationType.length === 0) {
      errors.workLocationType = isCustomLocation
        ? "Liman / Sanayi / OSB adını giriniz."
        : "Liman / Sanayi / OSB alanını belirtiniz.";
    } else if (workLocationType.length < 2) {
      errors.workLocationType = isCustomLocation
        ? "Geçerli bir liman / sanayi / OSB adı giriniz."
        : "Geçerli bir liman / sanayi / OSB giriniz.";
    } else if (workLocationType.length > 150) {
      errors.workLocationType = "Liman / Sanayi / OSB adı en fazla 150 karakter olabilir.";
    } else if (containsDangerousMarkup(workLocationType)) {
      errors.workLocationType = "Liman / Sanayi / OSB adı izin verilmeyen içerik barındırıyor.";
    } else if (containsDirectContactInfo(workLocationType)) {
      errors.workLocationType =
        "Bu alana telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.";
    }

    const addressText = fields.addressText.trim();
    if (addressText.length === 0) {
      errors.addressText = "Açık adresi giriniz.";
    } else if (addressText.length < 10) {
      errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
    } else if (addressText.length > ADDRESS_MAX_LENGTH) {
      errors.addressText = `Açık adres en fazla ${ADDRESS_MAX_LENGTH} karakter olabilir.`;
    }
  }

  const dateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (dateRangeErrors.workDate) errors.workDate = dateRangeErrors.workDate;
  if (dateRangeErrors.workEndDate) errors.workEndDate = dateRangeErrors.workEndDate;

  // "Nakliye Çoklu Yük Grubu" görevi — Nakliye'nin üst seviye (job/hizmet)
  // productQuantity/productTonnage/productType alanları artık HİÇ
  // kullanılmıyor (bkz. types.ts#Job.nakliyeCargoGroups üstündeki doküman);
  // gerçek doğrulama artık validateNakliyeCargoGroups ile grup başına
  // yapılır, bu yüzden burada Nakliye için TAMAMEN atlanır (aksi hâlde
  // formun hiç göstermediği/doldurmadığı eski üst seviye alanlar yüzünden
  // gönderim yanlışlıkla engellenirdi).
  const productInfoErrors = isTransportationCategory(fields.category) ? {} : validateProductInfoFields(fields);
  if (productInfoErrors.productQuantity) errors.productQuantity = productInfoErrors.productQuantity;
  if (productInfoErrors.productTonnage) errors.productTonnage = productInfoErrors.productTonnage;
  if (productInfoErrors.productTonnageUnit) errors.productTonnageUnit = productInfoErrors.productTonnageUnit;
  if (productInfoErrors.productType) errors.productType = productInfoErrors.productType;
  if (productInfoErrors.productTypeCustomText) errors.productTypeCustomText = productInfoErrors.productTypeCustomText;

  const customsErrors = validateCustomsBrokerageFields(fields);
  if (customsErrors.customsTransactionType) errors.customsTransactionType = customsErrors.customsTransactionType;
  if (customsErrors.customsProductType) errors.customsProductType = customsErrors.customsProductType;
  if (customsErrors.customsProductTypeCustomText) {
    errors.customsProductTypeCustomText = customsErrors.customsProductTypeCustomText;
  }

  const recyclingErrors = validateRecyclingFields(fields);
  if (recyclingErrors.recyclingMaterialCategoryId) errors.recyclingMaterialCategoryId = recyclingErrors.recyclingMaterialCategoryId;
  if (recyclingErrors.recyclingMaterialSubtypeId) errors.recyclingMaterialSubtypeId = recyclingErrors.recyclingMaterialSubtypeId;
  if (recyclingErrors.recyclingQuantity) errors.recyclingQuantity = recyclingErrors.recyclingQuantity;
  if (recyclingErrors.recyclingUnit) errors.recyclingUnit = recyclingErrors.recyclingUnit;
  if (recyclingErrors.recyclingMaterialCondition) errors.recyclingMaterialCondition = recyclingErrors.recyclingMaterialCondition;
  if (recyclingErrors.recyclingMaterialConditionNote) errors.recyclingMaterialConditionNote = recyclingErrors.recyclingMaterialConditionNote;
  if (recyclingErrors.recyclingScopeOfWork) errors.recyclingScopeOfWork = recyclingErrors.recyclingScopeOfWork;
  if (recyclingErrors.recyclingRequestedOperation) errors.recyclingRequestedOperation = recyclingErrors.recyclingRequestedOperation;
  if (recyclingErrors.recyclingWasteCode) errors.recyclingWasteCode = recyclingErrors.recyclingWasteCode;
  if (recyclingErrors.recyclingHazardProperties) errors.recyclingHazardProperties = recyclingErrors.recyclingHazardProperties;

  const storageErrors = validateStorageProductFields(fields);
  if (storageErrors.storageProductType) errors.storageProductType = storageErrors.storageProductType;
  if (storageErrors.storageProductTypeCustomText) errors.storageProductTypeCustomText = storageErrors.storageProductTypeCustomText;
  if (storageErrors.storageProductQuantity) errors.storageProductQuantity = storageErrors.storageProductQuantity;
  if (storageErrors.storageProductUnit) errors.storageProductUnit = storageErrors.storageProductUnit;
  if (storageErrors.storageProductTonnage) errors.storageProductTonnage = storageErrors.storageProductTonnage;

  if (isContainerStorageCategory(fields.category)) {
    const { groupErrors, hasErrors } = validateStorageContainerGroups(fields.storageContainerGroups);
    if (hasErrors) errors.storageContainerGroupErrors = groupErrors;
  }

  const storageHazardErrors = validateStorageHazardFields(fields);
  if (storageHazardErrors.storageRiskGroups) errors.storageRiskGroups = storageHazardErrors.storageRiskGroups;

  if (fields.photoCount < MIN_PHOTOS) {
    errors.photoCount = PHOTOS_REQUIRED_MESSAGE;
  }

  return errors;
}

/**
 * Çoklu Hizmet Operasyonu — Aşama 2.2: bir hizmet kartının TÜM kendi alanları
 * (kategori, başlık, hizmete özel açıklama, kendi başlangıç/bitiş tarihi,
 * kendi konumu). `JobFormFields`'ten BİLEREK AYRI tutulur — `job-request-form.tsx`
 * artık N hizmet kartı gösterebildiği ve her kart kendi başlığını/açıklamasını/
 * konumunu taşıdığı için bu alanlar birer TEKİL form alanı değil, her kart
 * için tekrarlanan bir yapıdır; `JobFormFields`/`validateJobForm` (yukarıda)
 * DEĞİŞTİRİLMEDİ ki job-edit-form.tsx (hâlâ tek başlık/açıklama/konum
 * kullanan, bu aşamada dokunulmayan form) bozulmasın. Kurallar (uzunluk
 * sınırları, custom-mod alanları vb.) BİLEREK `validateJobForm`daki karşılık
 * gelen kurallarla BİREBİR aynı tutulur — yalnızca hizmet başına tekrarlanır.
 */
export type ServiceItemFields = {
  category: string;
  title: string;
  description: string;
  workDate: string;
  workEndDate: string;
  /** Yalnızca nakliye-route.ts#isTransportationCategory(category) true iken doğrulanır/gösterilir — diğer kategorilerde operasyonun paylaşılan (her zaman "Kocaeli") ilini kullanmaya devam eder, bu alan hiç okunmaz. */
  province: string;
  district: string;
  /** "Liman / Sanayi / OSB" GÖRÜNEN adı (çözümlenmiş tesis adı ya da özel metin) — bkz. JobFormFields.workLocationType. */
  workLocationType: string;
  addressText: string;
  locationMode: "catalog" | "custom";
  /** Bkz. JobFormFields.productQuantity/productTonnage/productTonnageUnit/productType/productTypeCustomText — kurallar BİREBİR aynı. */
  productQuantity: string;
  productTonnage: string;
  productTonnageUnit: string;
  productType: string;
  productTypeCustomText: string;
  /** Bkz. JobFormFields.nakliyeLoadPreparationType — kural BİREBİR aynı. */
  nakliyeLoadPreparationType?: string;
  /** Bkz. JobFormFields.nakliyeContainerTransportStatus — kural BİREBİR aynı. */
  nakliyeContainerTransportStatus?: string;
  /** Bkz. JobFormFields.customsTransactionType/vb. — kurallar BİREBİR aynı. */
  customsTransactionType: string;
  customsRequestedServices: string[];
  customsProductType: string;
  customsProductTypeCustomText: string;
  /** Bkz. JobFormFields.deliveryProvince/vb. — kurallar BİREBİR aynı. */
  deliveryProvince: string;
  deliveryDistrict: string;
  deliveryLocationType: "facility" | "open_address" | "";
  deliveryFacilityName: string;
  deliveryAddressText: string;
  /** Bkz. JobFormFields.recyclingMaterialCategoryId/vb. — kurallar BİREBİR aynı. */
  recyclingMaterialCategoryId: string;
  recyclingMaterialSubtypeId: string;
  recyclingQuantity: string;
  recyclingUnit: string;
  recyclingMaterialCondition: string;
  recyclingMaterialConditionNote: string;
  recyclingScopeOfWork: string[];
  recyclingRequestedOperation: string;
  recyclingWasteCode: string;
  recyclingWasteCodeUnknown: boolean;
  recyclingHazardProperties: string[];
  /** Bkz. JobFormFields.storageProductType/vb. — kurallar BİREBİR aynı. */
  storageProductType: string;
  storageProductTypeCustomText: string;
  storageProductQuantity: string;
  storageProductUnit: string;
  storageProductTonnage: string;
  /** Bkz. JobFormFields.storageContainerGroups — kurallar BİREBİR aynı. */
  storageContainerGroups: StorageContainerGroupFieldsForValidation[];
  /** Bkz. JobFormFields.storageHazardous/storageRiskGroups — kurallar BİREBİR aynı. */
  storageHazardous: string;
  storageRiskGroups: string[];
};

export type ServiceItemErrors = Partial<Record<keyof ServiceItemFields, string>> & {
  /** Bkz. JobFormErrors.storageContainerGroupErrors — AYNI ilke. */
  storageContainerGroupErrors?: Record<string, StorageContainerGroupErrors>;
};

/**
 * `validateServiceItem`in konumla ilgili ürettiği hata anahtarları — "Ana
 * hizmetle aynı lokasyon" seçiliyken bu anahtarlar o kartın hata nesnesinden
 * çıkarılır (bkz. job-request-form.tsx), çünkü o kartın kendi PICKUP konum
 * alanları hiç gösterilmez/düzenlenemez. Nakliye'nin Teslim Edilecek Yer'i
 * (delivery* anahtarları) BİLEREK burada YOKTUR — "Ana hizmetle aynı
 * lokasyon" yalnızca pickup'ı etkiler, delivery her zaman bu kartın kendi
 * bağımsız alanıdır (bkz. görev tanımı — "Bu bilgiler yalnızca Nakliye
 * ilanına ait olacaktır").
 */
export const SERVICE_LOCATION_ERROR_KEYS: (keyof ServiceItemErrors)[] = [
  "province",
  "district",
  "workLocationType",
  "addressText",
];

/**
 * Tek bir hizmet kartının tam doğrulaması. Başlangıç/bitiş tarih çifti
 * `validateWorkDateRange`'e (yukarıda) devredilir — `validateJobForm` (ilan
 * düzenleme) da AYNI fonksiyonu çağırır, bu yüzden ikisi arasında asla
 * farklı/çelişkili bir tarih politikası oluşamaz. Bir karttaki hata yalnızca
 * o kartın kendi `ServiceItemErrors` nesnesinde döner; çağıran taraf
 * (job-request-form.tsx) bunu her kartın kendi yerel kimliğiyle (localId)
 * eşleştirip AYRI AYRI gösterir, bu yüzden bir karttaki hata diğerini hiç
 * etkilemez.
 */
export function validateServiceItem(fields: ServiceItemFields): ServiceItemErrors {
  const errors: ServiceItemErrors = {};

  if (fields.category.trim().length === 0) {
    errors.category = "Hizmet seçiniz.";
  }

  const title = fields.title.trim();
  if (title.length === 0) {
    errors.title = "İlan başlığı zorunludur.";
  } else if (title.length < 5) {
    errors.title = "İlan başlığı en az 5 karakter olmalıdır.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `İlan başlığı en fazla ${TITLE_MAX_LENGTH} karakter olabilir.`;
  } else if (containsDirectContactInfo(title)) {
    errors.title = DIRECT_CONTACT_INFO_TITLE_MESSAGE;
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "Hizmete özel açıklamayı giriniz.";
  } else if (description.length < 20) {
    errors.description = "Açıklama en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "Açıklama en fazla 1.000 karakter olabilir.";
  } else if (containsDirectContactInfo(description)) {
    errors.description = DIRECT_CONTACT_INFO_DESCRIPTION_MESSAGE;
  }

  if (isTransportationCategory(fields.category)) {
    const pickupErrors = validateNakliyeRouteSide({
      province: fields.province,
      district: fields.district,
      locationType: fields.locationMode === "custom" ? "open_address" : "facility",
      facilityLabel: fields.workLocationType,
      addressText: fields.addressText,
    });
    if (pickupErrors.province) errors.province = pickupErrors.province;
    if (pickupErrors.district) errors.district = pickupErrors.district;
    if (pickupErrors.locationType) errors.workLocationType = pickupErrors.locationType;
    if (pickupErrors.addressText) errors.addressText = pickupErrors.addressText;

    const deliveryErrors = validateNakliyeRouteSide({
      province: fields.deliveryProvince,
      district: fields.deliveryDistrict,
      locationType: fields.deliveryLocationType,
      facilityLabel: fields.deliveryFacilityName,
      addressText: fields.deliveryAddressText,
    });
    if (deliveryErrors.province) errors.deliveryProvince = deliveryErrors.province;
    if (deliveryErrors.district) errors.deliveryDistrict = deliveryErrors.district;
    if (deliveryErrors.locationType) errors.deliveryLocationType = deliveryErrors.locationType;
    if (deliveryErrors.addressText) errors.deliveryAddressText = deliveryErrors.addressText;
  } else if (isSimplifiedLocationCategory(fields.category)) {
    // Depolama (Kapalı/Açık Saha) VE Gümrük Müşavirliği: lokasyon yalnızca
    // İl/İlçe'dir — bkz. validateJobForm'daki AYNI mantık/gerekçe. İl bu
    // kartlarda da (Nakliye dışı diğer tüm kartlarda olduğu gibi) operasyonun
    // paylaşılan alanından gelir, bu yüzden burada ayrıca doğrulanmaz.
    const district = fields.district.trim();
    if (district.length === 0) {
      errors.district = "İlçe zorunludur.";
    } else if (district.length < 2) {
      errors.district = "Geçerli bir ilçe giriniz.";
    }
  } else {
    const district = fields.district.trim();
    if (district.length === 0) {
      errors.district = "İlçe zorunludur.";
    } else if (district.length < 2) {
      errors.district = "Geçerli bir ilçe giriniz.";
    }

    const isCustomLocation = fields.locationMode === "custom";

    const workLocationType = fields.workLocationType.trim();
    if (workLocationType.length === 0) {
      errors.workLocationType = isCustomLocation
        ? "Liman / Sanayi / OSB adını giriniz."
        : "Liman / Sanayi / OSB alanını belirtiniz.";
    } else if (workLocationType.length < 2) {
      errors.workLocationType = isCustomLocation
        ? "Geçerli bir liman / sanayi / OSB adı giriniz."
        : "Geçerli bir liman / sanayi / OSB giriniz.";
    } else if (workLocationType.length > 150) {
      errors.workLocationType = "Liman / Sanayi / OSB adı en fazla 150 karakter olabilir.";
    } else if (containsDangerousMarkup(workLocationType)) {
      errors.workLocationType = "Liman / Sanayi / OSB adı izin verilmeyen içerik barındırıyor.";
    } else if (containsDirectContactInfo(workLocationType)) {
      errors.workLocationType =
        "Bu alana telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.";
    }

    const addressText = fields.addressText.trim();
    if (addressText.length === 0) {
      errors.addressText = "Açık adresi giriniz.";
    } else if (addressText.length < 10) {
      errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
    } else if (addressText.length > ADDRESS_MAX_LENGTH) {
      errors.addressText = `Açık adres en fazla ${ADDRESS_MAX_LENGTH} karakter olabilir.`;
    }
  }

  const serviceDateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (serviceDateRangeErrors.workDate) errors.workDate = serviceDateRangeErrors.workDate;
  if (serviceDateRangeErrors.workEndDate) errors.workEndDate = serviceDateRangeErrors.workEndDate;

  // "Nakliye Çoklu Yük Grubu" görevi — Nakliye'nin üst seviye (job/hizmet)
  // productQuantity/productTonnage/productType alanları artık HİÇ
  // kullanılmıyor (bkz. types.ts#Job.nakliyeCargoGroups üstündeki doküman);
  // gerçek doğrulama artık validateNakliyeCargoGroups ile grup başına
  // yapılır, bu yüzden burada Nakliye için TAMAMEN atlanır (aksi hâlde
  // formun hiç göstermediği/doldurmadığı eski üst seviye alanlar yüzünden
  // gönderim yanlışlıkla engellenirdi).
  const productInfoErrors = isTransportationCategory(fields.category) ? {} : validateProductInfoFields(fields);
  if (productInfoErrors.productQuantity) errors.productQuantity = productInfoErrors.productQuantity;
  if (productInfoErrors.productTonnage) errors.productTonnage = productInfoErrors.productTonnage;
  if (productInfoErrors.productTonnageUnit) errors.productTonnageUnit = productInfoErrors.productTonnageUnit;
  if (productInfoErrors.productType) errors.productType = productInfoErrors.productType;
  if (productInfoErrors.productTypeCustomText) errors.productTypeCustomText = productInfoErrors.productTypeCustomText;

  const customsErrors = validateCustomsBrokerageFields(fields);
  if (customsErrors.customsTransactionType) errors.customsTransactionType = customsErrors.customsTransactionType;
  if (customsErrors.customsProductType) errors.customsProductType = customsErrors.customsProductType;
  if (customsErrors.customsProductTypeCustomText) {
    errors.customsProductTypeCustomText = customsErrors.customsProductTypeCustomText;
  }

  const recyclingErrors = validateRecyclingFields(fields);
  if (recyclingErrors.recyclingMaterialCategoryId) errors.recyclingMaterialCategoryId = recyclingErrors.recyclingMaterialCategoryId;
  if (recyclingErrors.recyclingMaterialSubtypeId) errors.recyclingMaterialSubtypeId = recyclingErrors.recyclingMaterialSubtypeId;
  if (recyclingErrors.recyclingQuantity) errors.recyclingQuantity = recyclingErrors.recyclingQuantity;
  if (recyclingErrors.recyclingUnit) errors.recyclingUnit = recyclingErrors.recyclingUnit;
  if (recyclingErrors.recyclingMaterialCondition) errors.recyclingMaterialCondition = recyclingErrors.recyclingMaterialCondition;
  if (recyclingErrors.recyclingMaterialConditionNote) errors.recyclingMaterialConditionNote = recyclingErrors.recyclingMaterialConditionNote;
  if (recyclingErrors.recyclingScopeOfWork) errors.recyclingScopeOfWork = recyclingErrors.recyclingScopeOfWork;
  if (recyclingErrors.recyclingRequestedOperation) errors.recyclingRequestedOperation = recyclingErrors.recyclingRequestedOperation;
  if (recyclingErrors.recyclingWasteCode) errors.recyclingWasteCode = recyclingErrors.recyclingWasteCode;
  if (recyclingErrors.recyclingHazardProperties) errors.recyclingHazardProperties = recyclingErrors.recyclingHazardProperties;

  const storageErrors = validateStorageProductFields(fields);
  if (storageErrors.storageProductType) errors.storageProductType = storageErrors.storageProductType;
  if (storageErrors.storageProductTypeCustomText) errors.storageProductTypeCustomText = storageErrors.storageProductTypeCustomText;
  if (storageErrors.storageProductQuantity) errors.storageProductQuantity = storageErrors.storageProductQuantity;
  if (storageErrors.storageProductUnit) errors.storageProductUnit = storageErrors.storageProductUnit;
  if (storageErrors.storageProductTonnage) errors.storageProductTonnage = storageErrors.storageProductTonnage;

  if (isContainerStorageCategory(fields.category)) {
    const { groupErrors, hasErrors } = validateStorageContainerGroups(fields.storageContainerGroups);
    if (hasErrors) errors.storageContainerGroupErrors = groupErrors;
  }

  const storageHazardErrors = validateStorageHazardFields(fields);
  if (storageHazardErrors.storageRiskGroups) errors.storageRiskGroups = storageHazardErrors.storageRiskGroups;

  return errors;
}

/**
 * Verilen hizmet kategorisi id'leri arasında birden fazla kartta seçilmiş
 * (yinelenen) olanları döndürür — boş seçim ("", henüz seçilmemiş kart)
 * yinelenen sayılmaz. `job-request-form.tsx` bunu iki amaçla kullanır:
 * (1) bir karttaki seçimi, halihazırda BAŞKA bir kartta seçilmiş
 * kategorileri devre dışı bırakmak için önceden engellemek, (2) buna
 * rağmen gönderim anında hâlâ bir yinelenme varsa (ör. programatik/hızlı
 * ardışık değişiklik) ilgili kart(lar)ın altında açık bir hata göstermek.
 * Veri katmanındaki asıl/atlanamaz doğrulama yine de job-store.ts#
 * createJobsForOperation'da tekrarlanır — bu yalnızca arayüzün ERKEN ve
 * anlaşılır uyarı gösterebilmesi içindir.
 */
export function findDuplicateServiceCategoryIds(categories: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const category of categories) {
    if (category.trim().length === 0) continue;
    if (seen.has(category)) duplicates.add(category);
    seen.add(category);
  }
  return duplicates;
}

/**
 * Aşama 2.2: başlık/açıklama/konum hizmet başına taşındıktan sonra,
 * operasyon genelinde paylaşılan alan fotoğraf sayısına indi.
 * `operationDetails` form alanı kaldırıldığı için (bkz. görev tanımı)
 * artık burada da doğrulanmaz — bkz. JobFormFields.operationDetails
 * üstündeki AYNI doküman; alan yalnızca her zaman `""` olarak
 * createJobsForOperation'a geçirilmek üzere tutulur.
 */
export type SharedOperationFields = {
  operationDetails: string;
  photoCount: number;
};

export type SharedOperationErrors = Partial<Record<keyof SharedOperationFields, string>>;

export function validateSharedOperationFields(fields: SharedOperationFields): SharedOperationErrors {
  const errors: SharedOperationErrors = {};

  if (fields.photoCount < MIN_PHOTOS) {
    errors.photoCount = PHOTOS_REQUIRED_MESSAGE;
  }

  return errors;
}

/* ============================================================================
 * "Nakliye Yeniden Tasarımı" / "Nakliye Alan Sadeleştirmesi" doğrulaması.
 * nakliye-transport-fields.tsx#NakliyeDetailsFieldValues İLE YAPISAL OLARAK
 * UYUMLU ama BURADA AYRICA (elle senkron) tanımlanır — StorageContainer-
 * GroupFieldsForValidation'ın ZATEN kurduğu "doğrulama katmanı bileşen
 * dosyasını içe aktarmaz, kendi paralel tipini taşır" ilkesiyle AYNI (bu
 * dosya `app/_components/`e hiç bağımlı olmamalı — katman yönü HER ZAMAN
 * _components -> _lib'dir). Yalnızca GERÇEKTEN doğrulama kuralı taşıyan
 * alanlar burada listelenir — TypeScript'in yapısal tipleme özelliği
 * sayesinde gerçek form state nesnesi bu DAR tipi otomatik olarak karşılar,
 * alanların TAMAMINI yeniden bildirmek GEREKMEZ.
 *
 * "Nakliye Alan Sadeleştirmesi" görevi: Taşıma Şekli/Sevkiyat Yapısı (+ tüm
 * sefer/tekrar alt alanları), Sıcaklık Kontrollü ve Gabari Dışı/Ağır Yük
 * TAMAMEN kaldırıldığı için bu alanlara ait hiçbir doğrulama kuralı kalmadı.
 * Yükün Hazırlanış Biçimi artık TEK seçimli bir dropdown (eskiden "en az bir
 * seçim" kuralı taşıyan çoklu-seçim dizisiydi) — aynı zorunlu durumu korur,
 * artık `loadPreparationType` boş olamaz kuralı olarak ifade edilir. Yükleme
 * Yöntemi ise (eskiden olduğu gibi) isteğe bağlı kalır — yalnızca "Listede
 * yok / Kendim gireceğim" seçilmişse serbest metin zorunlu olur (product-
 * catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE ile AYNI sentinel+zorunlu-metin deseni).
 * ========================================================================= */
/**
 * "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi — TÜM alanlar isteğe
 * bağlıdır (görev talimatı: "Doldurulmayan opsiyonel alanlar doğrulama
 * hatası oluşturmasın"), bu yüzden burada TEK kural şudur: kullanıcı bir
 * sayısal alanı GERÇEKTEN doldurduysa (boş değilse) değer pozitif ve sonlu
 * bir sayı olmalıdır — boş bırakmak asla hataya yol açmaz. `dimensionsUnknown`
 * true iken hiçbir alan hiç kontrol edilmez (nakliye-measurement-fields.tsx#
 * fromMeasurementFields zaten bu durumda hepsini payload'dan atıyor).
 */
export type NakliyeMeasurementFieldsForValidation = {
  dimensionsUnknown: boolean;
  widthCm: string;
  lengthCm: string;
  heightCm: string;
  outerDiameterCm: string;
  innerDiameterCm: string;
  diameterCm: string;
  rollWidthCm: string;
  volumeM3: string;
  maxStackCount: string;
};
export type NakliyeMeasurementFieldErrors = Partial<Record<keyof NakliyeMeasurementFieldsForValidation, string>>;

// "Tüm İlan Formlarında Gerçek, Alana Uygun ve Aşılamaz Giriş Sınırları"
// görevi — Genel Güvenlik görevinin §6'da eklediği TEK, düz `1_000_000`
// üst sınırı (bkz. eski MAX_MEASUREMENT_VALUE) gerçek alanları tek tek
// incelemeden konmuş genel bir sınırdı: En(≤1000cm)/Boy(≤5000cm)/
// Yükseklik(≤1000cm)/Çap(≤1000cm) gibi fiziksel olarak birbirinden çok
// farklı büyüklükteki alanların HEPSİ aynı (çok gevşek) sınırı paylaşıyordu
// — 999.999 cm (~10km) genişliğinde bir "palet" hâlâ kabul ediliyordu. Ayrıca
// `Number(trimmed.replace(",", "."))` bilimsel gösterimi ("1e5") HİÇ
// reddetmiyordu: `Number("1e5")` = 100000, sonlu/pozitif/≤1_000_000 olduğu
// için sessizce KABUL ediliyordu. Bu fonksiyon artık (a) alana özel bir üst
// sınır alır, (b) katı bir regex ile yalnızca "rakamlar + tek bir ondalık
// ayraç + en fazla N basamak" biçimini kabul eder — `e`/`E`/`+`/`-`/birden
// fazla ayraç/boşluk içeren HİÇBİR girdi `Number(...)`e ULAŞAMADAN reddedilir.
function validatePositiveNumberIfFilled(raw: string, max: number, decimalPlaces: number = MEASUREMENT_DECIMAL_PLACES): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (!new RegExp(`^\\d+([.,]\\d{1,${decimalPlaces}})?$`).test(trimmed)) return false;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= max;
}

/** "En Fazla İstif Katı" — yalnızca pozitif TAM SAYI (ondalık bir istif katı sayısı anlamsızdır), makul bir üst sınırla. */
function validatePositiveIntegerIfFilled(raw: string, max: number): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 && value <= max;
}

export function validateMeasurementFields(fields: NakliyeMeasurementFieldsForValidation): NakliyeMeasurementFieldErrors {
  const errors: NakliyeMeasurementFieldErrors = {};
  if (fields.dimensionsUnknown) return errors;
  const message = "Pozitif ve makul bir sayı giriniz.";
  if (!validatePositiveNumberIfFilled(fields.widthCm, MAX_WIDTH_CM)) errors.widthCm = `En en fazla ${MAX_WIDTH_CM.toLocaleString("tr-TR")} cm olabilir.`;
  if (!validatePositiveNumberIfFilled(fields.lengthCm, MAX_LENGTH_CM)) errors.lengthCm = `Boy en fazla ${MAX_LENGTH_CM.toLocaleString("tr-TR")} cm olabilir.`;
  if (!validatePositiveNumberIfFilled(fields.heightCm, MAX_HEIGHT_CM)) errors.heightCm = `Yükseklik en fazla ${MAX_HEIGHT_CM.toLocaleString("tr-TR")} cm olabilir.`;
  if (!validatePositiveNumberIfFilled(fields.outerDiameterCm, MAX_DIAMETER_CM)) errors.outerDiameterCm = message;
  if (!validatePositiveNumberIfFilled(fields.innerDiameterCm, MAX_DIAMETER_CM)) errors.innerDiameterCm = message;
  if (!validatePositiveNumberIfFilled(fields.diameterCm, MAX_DIAMETER_CM)) errors.diameterCm = message;
  if (!validatePositiveNumberIfFilled(fields.rollWidthCm, MAX_ROLL_WIDTH_CM)) errors.rollWidthCm = message;
  if (!validatePositiveNumberIfFilled(fields.volumeM3, MAX_VOLUME_M3)) errors.volumeM3 = message;
  if (!validatePositiveIntegerIfFilled(fields.maxStackCount, MAX_STACK_COUNT)) {
    errors.maxStackCount = `En fazla istif katı ${MAX_STACK_COUNT} olabilir ve tam sayı olmalıdır.`;
  }
  return errors;
}

/**
 * "Nakliye Çoklu Yük Grubu" görevi — bu obje artık YALNIZCA job/hizmet
 * seviyesinde GERÇEKTEN tekil kalan alanları taşır (Araç Tercihi/Yükleme
 * Yöntemi). Yükün Hazırlanış Biçimi/Ürün Bilgileri/Konteyner Bilgileri/
 * Tehlikeli Madde-ADR artık BURADA DEĞİL, grup başına `validateNakliyeCargoGroup`
 * ile doğrulanır (bkz. o fonksiyonun üstündeki doküman) — "Konteyner
 * Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi ADR'ı da job seviyesinden
 * grup seviyesine indirdi.
 */
export type NakliyeDetailsFieldsForValidation = {
  suggestByProvider: boolean;
  vehicleTypes: string[];
  trailerTypes: string[];
  loadingMethod: string;
  loadingMethodCustomText: string;
  /**
   * "Konteyner Taşımalarında Araç Tercihini Gizleme" görevi hâlâ geçerli —
   * ama artık TEK bir dala değil, TÜM yük gruplarına bakar: en az bir grup
   * hâlâ normal (Hayır) modundaysa Araç Tercihi gösterilir/zorunludur (o
   * grubun gerçek bir araca ihtiyacı olabilir) — yalnızca HER grup konteyner
   * modundaysa tamamen gizlenir/hiç doğrulanmaz (çekici/ekipmanı hizmet
   * veren belirler). Çağıran taraf (job-request-form.tsx/job-edit-form.tsx)
   * `cargoGroups.some(g => !isNakliyeContainerProductType(g.productType))`
   * ile hesaplar.
   */
  anyCargoGroupIsNormalMode: boolean;
};

export type NakliyeDetailsErrors = Partial<Record<"loadingMethodCustomText" | "vehiclePreference", string>>;

/**
 * Araç Tercihi/Yükleme Yöntemi doğrulaması — yalnızca bu ikisini render eden
 * ekranlarda (job-request-form.tsx VE job-edit-form.tsx) çağrılmalıdır.
 * Yükün Hazırlanış Biçimi/Ürün Bilgileri/Konteyner Bilgileri/Tehlikeli
 * Madde-ADR artık burada DEĞİL — bkz. validateNakliyeCargoGroup (grup başına).
 */
export function validateNakliyeDetails(fields: NakliyeDetailsFieldsForValidation): NakliyeDetailsErrors {
  const errors: NakliyeDetailsErrors = {};

  if (fields.loadingMethod === NAKLIYE_MANUAL_ENTRY_VALUE && fields.loadingMethodCustomText.trim().length === 0) {
    errors.loadingMethodCustomText = "Yükleme yöntemini yazmanız zorunludur.";
  }

  if (fields.anyCargoGroupIsNormalMode && !fields.suggestByProvider && fields.vehicleTypes.length === 0 && fields.trailerTypes.length === 0) {
    errors.vehiclePreference = "Araç veya kasa/dorse tipi seçiniz, ya da nakliyecinin uygun aracı önermesine izin verin.";
  }

  return errors;
}

export type NakliyeCargoGroupFieldsForValidation = {
  id: string;
  productQuantity: string;
  productTonnage: string;
  productTonnageUnit: string;
  productType: string;
  productTypeCustomText: string;
  loadPreparationType: string;
  loadPreparationCustomText: string;
  measurement: NakliyeMeasurementFieldsForValidation;
  containerType: string;
  containerLoadStatus: string;
  containerQuantity: string;
  containerContent: string;
  hazmatStatus: string;
  hazmatAdrClass: string;
};

export type NakliyeCargoGroupErrors = Partial<Record<
  "productQuantity" | "productTonnage" | "productTonnageUnit" | "productType" | "productTypeCustomText" |
  "loadPreparationType" | "loadPreparationCustomText" |
  "containerType" | "containerLoadStatus" | "containerQuantity" | "containerContent" |
  "hazmatAdrClass",
  string
>> & { measurement?: NakliyeMeasurementFieldErrors };

/**
 * "Nakliye Çoklu Yük Grubu" görevi — TEK bir Yük Grubu'nun doğrulaması,
 * `validateStorageContainerGroup`in ("Konteyner Grupları", storage-container-
 * catalog.ts) grup-başına ilkesiyle AYNI.
 *
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — ikili dal
 * kuralı hâlâ GEÇERLİ, ama tetikleyici artık `isNakliyeContainerProductType
 * (fields.productType)`: konteyner modunda normal Yük Bilgileri dalına ait
 * TÜM alanlar (Ürün Bilgileri dahil — `validateProductInfoFields` zaten AYNI
 * gate'i kendi içinde uygulardı, artık burada hiç çağrılmıyor) hiç
 * doğrulanmaz; normal moddayken Konteyner Bilgileri dalına ait TÜM alanlar
 * hiç doğrulanmaz. Toplam Ağırlık (`productTonnage`) BU KURALIN DIŞINDA —
 * artık HER İKİ dalda da PAYLAŞILAN TEK zorunlu alan (görev talimatı: "toplam
 * tonaj alanını tekrar etmeden kullan"), bu yüzden HER İKİ dalda da AYNI
 * `parseProductTonnage` kuralıyla doğrulanır — `validateProductInfoFields`in
 * kendi tonaj kontrolüyle AYNI switch/mesaj kümesi, konteyner dalında ikinci
 * kez çağrılamadığı için burada TEKRARLANIR (tek bir küçük, kararlı blok —
 * ikinci bir doğrulama fonksiyonu İCAT EDİLMEDİ). Tehlikeli Madde/ADR artık
 * grup seviyesinde, HER İKİ dalda da aynı şekilde doğrulanır — bir grubun ADR
 * tercihi diğer grubu hiç etkilemez (her çağrı bağımsız bir `fields` alır).
 */
export function validateNakliyeCargoGroup(fields: NakliyeCargoGroupFieldsForValidation): NakliyeCargoGroupErrors {
  const isContainerMode = isNakliyeContainerProductType(fields.productType);
  const errors: NakliyeCargoGroupErrors = {};

  if (!isContainerMode) {
    const productErrors = validateProductInfoFields({
      category: NAKLIYE_SERVICE_CATEGORY_ID,
      productQuantity: fields.productQuantity,
      productTonnage: fields.productTonnage,
      productTonnageUnit: fields.productTonnageUnit,
      productType: fields.productType,
      productTypeCustomText: fields.productTypeCustomText,
      nakliyeLoadPreparationType: fields.loadPreparationType,
    });
    Object.assign(errors, productErrors);

    // "Konteyner İçinde" görevi — `isSelectableLoadPreparationTypeId`
    // (LOAD_PREPARATION_TYPE_OPTIONS'a göre, legacy id'ler HARİÇ) BİLEREK
    // kullanılır: eski bir kayıttan gelen artık-seçilemeyen bir değer
    // (bugün yalnızca "konteyner-icinde") "seçilmemiş" sayılır, kullanıcı
    // kaydetmeden önce gerçekten yeni/geçerli bir seçim yapmaya zorlanır.
    if (
      fields.loadPreparationType.trim().length === 0 ||
      (fields.loadPreparationType !== NAKLIYE_MANUAL_ENTRY_VALUE && !isSelectableLoadPreparationTypeId(fields.loadPreparationType))
    ) {
      errors.loadPreparationType = "Yükün hazırlanış biçimini seçiniz.";
    } else if (fields.loadPreparationType === NAKLIYE_MANUAL_ENTRY_VALUE && fields.loadPreparationCustomText.trim().length === 0) {
      errors.loadPreparationCustomText = "Yükün hazırlanış biçimini yazmanız zorunludur.";
    }

    const measurementErrors = validateMeasurementFields(fields.measurement);
    if (Object.keys(measurementErrors).length > 0) errors.measurement = measurementErrors;
  } else {
    if (fields.containerType.trim().length === 0) errors.containerType = "Konteyner tipini seçiniz.";
    if (fields.containerLoadStatus.trim().length === 0) errors.containerLoadStatus = "Dolu/Boş seçiniz.";
    const quantityRaw = fields.containerQuantity.trim();
    if (quantityRaw.length === 0) {
      errors.containerQuantity = "Konteyner adedini giriniz.";
    } else if (!/^\d+$/.test(quantityRaw)) {
      // Katı tam-sayı regex'i — "Aşılamaz Giriş Sınırları" görevi: eski
      // `Number(quantityRaw)` bilimsel gösterimi ("1e5") reddetmiyordu.
      errors.containerQuantity = "Konteyner adedi pozitif bir tam sayı olmalıdır.";
    } else {
      const quantity = Number(quantityRaw);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.containerQuantity = "Konteyner adedi pozitif bir tam sayı olmalıdır.";
      } else if (quantity > MAX_CONTAINER_QUANTITY) {
        errors.containerQuantity = `Konteyner adedi en fazla ${MAX_CONTAINER_QUANTITY} olabilir.`;
      }
    }
    if (fields.containerLoadStatus === "dolu" && fields.containerContent.trim().length === 0) {
      errors.containerContent = "Konteyner içindeki yükü seçiniz.";
    }

    // Paylaşılan Toplam Ağırlık — konteyner dalında `validateProductInfoFields`
    // hiç çağrılmadığı için (o fonksiyon Ürün Adedi/Ürün Cinsi'ni de zorunlu
    // kılar, konteyner dalında ikisi de anlamsızdır) tonaj kontrolü burada
    // TEK BAŞINA tekrarlanır — Nakliye'de tonaj her zaman zorunludur (bkz.
    // product-catalog.ts#isTonnageRequired).
    const tonnageRaw = fields.productTonnage.trim();
    if (tonnageRaw.length === 0) {
      errors.productTonnage = "Tonaj bilgisini giriniz.";
    } else {
      const tonnageResult = parseProductTonnage(fields.productTonnage, fields.productTonnageUnit === "kg" ? "kg" : "ton");
      if (!tonnageResult.ok) {
        switch (tonnageResult.error) {
          case "not-positive":
            errors.productTonnage = "Tonaj pozitif bir sayı olmalıdır.";
            break;
          case "too-large":
            errors.productTonnage = "Tonaj çok büyük.";
            break;
          default:
            errors.productTonnage = "Geçerli bir tonaj giriniz.";
        }
      }
    }
  }

  if (fields.hazmatStatus === "evet" && fields.hazmatAdrClass.trim().length === 0) {
    errors.hazmatAdrClass = "ADR tehlike sınıfını seçiniz.";
  }

  return errors;
}

/**
 * TÜM Yük Grubu dizisinin doğrulaması — `validateStorageContainerGroups`
 * İLE AYNI desen: her grup `group.id`sine göre anahtarlanmış KENDİ hata
 * nesnesini alır (dizi index'ine GÖRE DEĞİL — bir grup silindiğinde
 * diğerlerinin index'i kayar, `id` hiç değişmez). En az 1 grup gerektirir
 * (form bunu zaten garanti eder, ama doğrulama yine de kontrol eder).
 */
export function validateNakliyeCargoGroups(
  groups: NakliyeCargoGroupFieldsForValidation[],
): { groupErrors: Record<string, NakliyeCargoGroupErrors>; hasErrors: boolean } {
  const groupErrors: Record<string, NakliyeCargoGroupErrors> = {};
  // "Aşılamaz Giriş Sınırları" görevi — İlan başına maksimum MAX_CARGO_GROUPS
  // (20) yük grubu (görev talimatı madde 2). UI'daki "+ Başka Yük Grubu Ekle"
  // butonu zaten bu sayıda durur; bu, doğrulamanın (form-bypass'a dayanıklı)
  // ikinci katmanı.
  let hasErrors = groups.length === 0 || groups.length > MAX_CARGO_GROUPS;
  for (const group of groups) {
    const errors = validateNakliyeCargoGroup(group);
    if (Object.keys(errors).length > 0) {
      groupErrors[group.id] = errors;
      hasErrors = true;
    }
  }
  return { groupErrors, hasErrors };
}
