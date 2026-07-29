import { MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";

export type JobFormFields = {
  category: string;
  title: string;
  description: string;
  province: string;
  district: string;
  /** Bölge/Tesis GÖRÜNEN adı — katalogdan seçilmiş bir tesisin adı ("catalog") ya da kullanıcının serbestçe yazdığı tesis/işletme adı ("custom"). */
  workLocationType: string;
  addressText: string;
  /** "catalog" — Bölge/Tesis merkezi kataloktan seçildi. "custom" — "Listede yok — tesis bilgilerini kendim gireceğim" seçildi; bu modda companyOrFactoryName zorunlu DEĞİLDİR, neighborhood/locationUrl/directionsNote isteğe bağlı olarak doğrulanır. */
  locationMode: "catalog" | "custom";
  /** Yalnızca locationMode "custom" olduğunda anlamlı, isteğe bağlı. */
  neighborhood: string;
  /** Yalnızca locationMode "custom" olduğunda anlamlı, isteğe bağlı. */
  locationUrl: string;
  /** Yalnızca locationMode "custom" olduğunda anlamlı, isteğe bağlı. */
  directionsNote: string;
  workDate: string;
  /** Bkz. types.ts#Job.workEndDate. İlan düzenleme (job-edit-form.tsx) her zaman bir değer gönderir — bu alandan önce oluşturulmuş (workEndDate'i hiç olmayan) bir ilan düzenlenirken form boş başlar ve validateWorkDateRange normal şekilde zorunlu kılar. */
  workEndDate: string;
  operationDetails: string;
  photoCount: number;
};

/**
 * Başlangıç/bitiş tarih çiftinin TEK ortak doğrulaması — hem `validateJobForm`
 * (ilan düzenleme) hem `validateServiceItem` (ilan oluşturma) burayı çağırır;
 * kural iki dosyada/iki yerde ayrı ayrı kopyalanmaz. Geçmiş tarih politikası:
 * yalnızca boş/parse edilemez olup olmadığı kontrol edilir, geçmiş bir tarih
 * reddedilmez. Aynı gün (workEndDate === workDate) geçerlidir.
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
      ? "Tesis / işletme adını belirtiniz."
      : "Bölge / Tesis alanını belirtiniz.";
  } else if (workLocationType.length < 2) {
    errors.workLocationType = isCustomLocation
      ? "Geçerli bir tesis / işletme adı giriniz."
      : "Geçerli bir bölge / tesis giriniz.";
  } else if (workLocationType.length > 150) {
    errors.workLocationType = "Tesis / işletme adı en fazla 150 karakter olabilir.";
  }

  const addressText = fields.addressText.trim();
  if (addressText.length === 0) {
    errors.addressText = "Açık adresi giriniz.";
  } else if (addressText.length < 10) {
    errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
  } else if (addressText.length > 500) {
    errors.addressText = "Açık adres en fazla 500 karakter olabilir.";
  }

  // Aşağıdaki üç alan yalnızca "custom" modda gösterilir ve tamamen isteğe
  // bağlıdır — yalnızca boşluk içeren bir değer boş sayılır (hata değil),
  // dolu bir değer varsa yalnızca makul uzunluk (ve locationUrl için çok
  // temel bir biçim) kontrolü yapılır.
  if (isCustomLocation) {
    const neighborhood = fields.neighborhood.trim();
    if (neighborhood.length > 100) {
      errors.neighborhood = "Bölge / mahalle en fazla 100 karakter olabilir.";
    }

    const locationUrl = fields.locationUrl.trim();
    if (locationUrl.length > 300) {
      errors.locationUrl = "Konum bağlantısı en fazla 300 karakter olabilir.";
    } else if (locationUrl.length > 0 && !/^https?:\/\/\S+\.\S+/i.test(locationUrl)) {
      errors.locationUrl = "Geçerli bir bağlantı giriniz (http:// veya https:// ile başlamalı).";
    }

    const directionsNote = fields.directionsNote.trim();
    if (directionsNote.length > 300) {
      errors.directionsNote = "Adres tarifi en fazla 300 karakter olabilir.";
    }
  }

  const dateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (dateRangeErrors.workDate) errors.workDate = dateRangeErrors.workDate;
  if (dateRangeErrors.workEndDate) errors.workEndDate = dateRangeErrors.workEndDate;

  const operationDetails = fields.operationDetails.trim();
  if (operationDetails.length === 0) {
    errors.operationDetails = "Operasyon detaylarını giriniz.";
  } else if (operationDetails.length < 10) {
    errors.operationDetails = "Operasyon detayları en az 10 karakter olmalıdır.";
  } else if (operationDetails.length > 1000) {
    errors.operationDetails = "Operasyon detayları en fazla 1.000 karakter olabilir.";
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
  district: string;
  /** Bölge/Tesis GÖRÜNEN adı (çözümlenmiş tesis adı ya da özel metin) — bkz. JobFormFields.workLocationType. */
  workLocationType: string;
  addressText: string;
  locationMode: "catalog" | "custom";
  neighborhood: string;
  locationUrl: string;
  directionsNote: string;
};

export type ServiceItemErrors = Partial<Record<keyof ServiceItemFields, string>>;

/** `validateServiceItem`in konumla ilgili ürettiği hata anahtarları — "Ana hizmetle aynı lokasyon" seçiliyken bu anahtarlar o kartın hata nesnesinden çıkarılır (bkz. job-request-form.tsx), çünkü o kartın kendi konum alanları hiç gösterilmez/düzenlenemez. */
export const SERVICE_LOCATION_ERROR_KEYS: (keyof ServiceItemErrors)[] = [
  "district",
  "workLocationType",
  "addressText",
  "neighborhood",
  "locationUrl",
  "directionsNote",
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
      ? "Tesis / işletme adını belirtiniz."
      : "Bölge / Tesis alanını belirtiniz.";
  } else if (workLocationType.length < 2) {
    errors.workLocationType = isCustomLocation
      ? "Geçerli bir tesis / işletme adı giriniz."
      : "Geçerli bir bölge / tesis giriniz.";
  } else if (workLocationType.length > 150) {
    errors.workLocationType = "Tesis / işletme adı en fazla 150 karakter olabilir.";
  }

  const addressText = fields.addressText.trim();
  if (addressText.length === 0) {
    errors.addressText = "Açık adresi giriniz.";
  } else if (addressText.length < 10) {
    errors.addressText = "Açık adres en az 10 karakter olmalıdır.";
  } else if (addressText.length > 500) {
    errors.addressText = "Açık adres en fazla 500 karakter olabilir.";
  }

  if (isCustomLocation) {
    const neighborhood = fields.neighborhood.trim();
    if (neighborhood.length > 100) {
      errors.neighborhood = "Bölge / mahalle en fazla 100 karakter olabilir.";
    }

    const locationUrl = fields.locationUrl.trim();
    if (locationUrl.length > 300) {
      errors.locationUrl = "Konum bağlantısı en fazla 300 karakter olabilir.";
    } else if (locationUrl.length > 0 && !/^https?:\/\/\S+\.\S+/i.test(locationUrl)) {
      errors.locationUrl = "Geçerli bir bağlantı giriniz (http:// veya https:// ile başlamalı).";
    }

    const directionsNote = fields.directionsNote.trim();
    if (directionsNote.length > 300) {
      errors.directionsNote = "Adres tarifi en fazla 300 karakter olabilir.";
    }
  }

  const serviceDateRangeErrors = validateWorkDateRange(fields.workDate, fields.workEndDate);
  if (serviceDateRangeErrors.workDate) errors.workDate = serviceDateRangeErrors.workDate;
  if (serviceDateRangeErrors.workEndDate) errors.workEndDate = serviceDateRangeErrors.workEndDate;

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
 * operasyon genelinde GERÇEKTEN paylaşılan yalnızca iki alan kaldı —
 * Operasyon Detayları ve fotoğraf sayısı. Kuralları `validateJobForm`'un
 * karşılık gelen kurallarıyla BİREBİR aynıdır.
 */
export type SharedOperationFields = {
  operationDetails: string;
  photoCount: number;
};

export type SharedOperationErrors = Partial<Record<keyof SharedOperationFields, string>>;

export function validateSharedOperationFields(fields: SharedOperationFields): SharedOperationErrors {
  const errors: SharedOperationErrors = {};

  const operationDetails = fields.operationDetails.trim();
  if (operationDetails.length === 0) {
    errors.operationDetails = "Operasyon detaylarını giriniz.";
  } else if (operationDetails.length < 10) {
    errors.operationDetails = "Operasyon detayları en az 10 karakter olmalıdır.";
  } else if (operationDetails.length > 1000) {
    errors.operationDetails = "Operasyon detayları en fazla 1.000 karakter olabilir.";
  }

  if (fields.photoCount < MIN_PHOTOS) {
    errors.photoCount = PHOTOS_REQUIRED_MESSAGE;
  }

  return errors;
}
