import {
  isCustomsBrokerageCategory,
  isCustomsTransactionTypeId,
} from "./customs-brokerage-catalog";
import { isSimplifiedLocationCategory } from "./job-location";
import { isJobDateInPast } from "./jobs";
import { isTransportationCategory } from "./nakliye-route";
import { MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";
import {
  isTonnageRequired,
  parseProductQuantity,
  parseProductTonnage,
  PRODUCT_TYPE_CUSTOM_VALUE,
  requiresProductInfo,
} from "./product-catalog";

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
  /** Yalnızca requiresProductInfo true iken doğrulanır/gösterilir. Katalogdan bir öneri seçilmişse GERÇEK değeri, "Listede Yok, Kendim Gireceğim" seçilmişse product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE sentinel'ini taşır (gerçek metin bu durumda productTypeCustomText'tedir). */
  productType: string;
  /** Yalnızca productType === PRODUCT_TYPE_CUSTOM_VALUE iken doğrulanır/gösterilir — bkz. productType üstündeki doküman. */
  productTypeCustomText: string;
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
 * "Ürün Bilgileri" doğrulaması — `validateJobForm` (ilan düzenleme) ve
 * `validateServiceItem` (ilan oluşturma) BİREBİR aynı kuralları paylaşır,
 * dosyanın geri kalanındaki BİLİNÇLİ tekrar deseniyle (bkz. ServiceItemFields
 * üstündeki not) tutarlı olacak şekilde HER İKİSİNDE de çağrılır. Kategori
 * `requiresProductInfo` kapsamı dışındaysa üç alan da hiç doğrulanmaz — bu
 * durumda form zaten alanları göstermez.
 */
function validateProductInfoFields(fields: {
  category: string;
  productQuantity: string;
  productTonnage: string;
  productType: string;
  productTypeCustomText: string;
}): {
  productQuantity?: string;
  productTonnage?: string;
  productType?: string;
  productTypeCustomText?: string;
} {
  const errors: ReturnType<typeof validateProductInfoFields> = {};
  if (!requiresProductInfo(fields.category)) return errors;

  const quantityResult = parseProductQuantity(fields.productQuantity);
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
    const tonnageResult = parseProductTonnage(fields.productTonnage);
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
  } else if (addressText.length > 500) {
    errors.addressText = "Açık adres en fazla 500 karakter olabilir.";
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

export type JobFormErrors = Partial<Record<keyof JobFormFields, string>>;

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
  } else if (title.length > 150) {
    errors.title = "İlan başlığı en fazla 150 karakter olabilir.";
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "İş açıklaması zorunludur.";
  } else if (description.length < 20) {
    errors.description = "İş açıklaması en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "İş açıklaması en fazla 1.000 karakter olabilir.";
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
    }

    const addressText = fields.addressText.trim();
    if (addressText.length === 0) {
      errors.addressText = "Açık adresi giriniz.";
    } else if (addressText.length < 10) {
      errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
    } else if (addressText.length > 500) {
      errors.addressText = "Açık adres en fazla 500 karakter olabilir.";
    }
  }

  const dateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (dateRangeErrors.workDate) errors.workDate = dateRangeErrors.workDate;
  if (dateRangeErrors.workEndDate) errors.workEndDate = dateRangeErrors.workEndDate;

  const productInfoErrors = validateProductInfoFields(fields);
  if (productInfoErrors.productQuantity) errors.productQuantity = productInfoErrors.productQuantity;
  if (productInfoErrors.productTonnage) errors.productTonnage = productInfoErrors.productTonnage;
  if (productInfoErrors.productType) errors.productType = productInfoErrors.productType;
  if (productInfoErrors.productTypeCustomText) errors.productTypeCustomText = productInfoErrors.productTypeCustomText;

  const customsErrors = validateCustomsBrokerageFields(fields);
  if (customsErrors.customsTransactionType) errors.customsTransactionType = customsErrors.customsTransactionType;
  if (customsErrors.customsProductType) errors.customsProductType = customsErrors.customsProductType;
  if (customsErrors.customsProductTypeCustomText) {
    errors.customsProductTypeCustomText = customsErrors.customsProductTypeCustomText;
  }

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
  /** Bkz. JobFormFields.productQuantity/productTonnage/productType/productTypeCustomText — kurallar BİREBİR aynı. */
  productQuantity: string;
  productTonnage: string;
  productType: string;
  productTypeCustomText: string;
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
};

export type ServiceItemErrors = Partial<Record<keyof ServiceItemFields, string>>;

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
  } else if (title.length > 150) {
    errors.title = "İlan başlığı en fazla 150 karakter olabilir.";
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "Hizmete özel açıklamayı giriniz.";
  } else if (description.length < 20) {
    errors.description = "Açıklama en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "Açıklama en fazla 1.000 karakter olabilir.";
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
    }

    const addressText = fields.addressText.trim();
    if (addressText.length === 0) {
      errors.addressText = "Açık adresi giriniz.";
    } else if (addressText.length < 10) {
      errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
    } else if (addressText.length > 500) {
      errors.addressText = "Açık adres en fazla 500 karakter olabilir.";
    }
  }

  const serviceDateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (serviceDateRangeErrors.workDate) errors.workDate = serviceDateRangeErrors.workDate;
  if (serviceDateRangeErrors.workEndDate) errors.workEndDate = serviceDateRangeErrors.workEndDate;

  const productInfoErrors = validateProductInfoFields(fields);
  if (productInfoErrors.productQuantity) errors.productQuantity = productInfoErrors.productQuantity;
  if (productInfoErrors.productTonnage) errors.productTonnage = productInfoErrors.productTonnage;
  if (productInfoErrors.productType) errors.productType = productInfoErrors.productType;
  if (productInfoErrors.productTypeCustomText) errors.productTypeCustomText = productInfoErrors.productTypeCustomText;

  const customsErrors = validateCustomsBrokerageFields(fields);
  if (customsErrors.customsTransactionType) errors.customsTransactionType = customsErrors.customsTransactionType;
  if (customsErrors.customsProductType) errors.customsProductType = customsErrors.customsProductType;
  if (customsErrors.customsProductTypeCustomText) {
    errors.customsProductTypeCustomText = customsErrors.customsProductTypeCustomText;
  }

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
