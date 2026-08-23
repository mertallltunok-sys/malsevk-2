import { NAKLIYE_SERVICE_CATEGORY_ID } from "./service-catalog";
import {
  MAX_PRODUCT_QUANTITY,
  MAX_TONNAGE_KG,
  MAX_TONNAGE_TON,
  TONNAGE_KG_DECIMAL_PLACES,
  TONNAGE_TON_DECIMAL_PLACES,
} from "./field-limits";

/**
 * "Ürün Bilgileri" (Ürün Adedi / Tonaj / Ürün Cinsi) alanlarının TEK
 * doğruluk kaynağı: yalnızca sistemde GERÇEKTEN liman operasyonu sayılan bu
 * üç (birleştirilmiş) kategori. Metin/başlık eşleştirmesi (includes/
 * startsWith/görünen Türkçe etiket karşılaştırması) KESİNLİKLE kullanılmaz —
 * yalnızca service-catalog.ts'teki sabit kategori id'leri. Kategori
 * kataloğu sadeleştirmesiyle (bkz. service-catalog.ts#MERGED_CATEGORY_ID_ALIASES)
 * eski altı ayrı id (`lashing`/`unlashing`/`yukleme-gozetimi`/
 * `bosaltma-gozetimi`/`konteyner-dolum`/`konteyner-bosaltim`) üçe indi;
 * eski bir ilan/teklif üzerindeki id'ler `resolveServiceCategoryId` ile
 * okuma anında bu yeni id'lere çözülür, burada AYRICA bir eşleme
 * tutulmaz. O üç birleşik kategoriden biri, "Konteyner Dolum / Boşaltım"
 * (`konteyner-dolum-bosaltim`), daha sonra ("Development Temizliği" görevi,
 * Faz 1) sistemin aktif mimarisinden tamamen KALDIRILDI (bkz.
 * service-catalog.ts#REMOVED_CATEGORY_IDS) — bu yüzden aşağıdaki küme bugün
 * yalnızca İKİ id taşır, üç değil; `resolveServiceCategoryId` artık bu id
 * için `null` döndüğü için hiçbir yeni ilan/teklif zaten ona ulaşamaz.
 *
 * BİLEREK service-catalog.ts'teki "liman-hizmetleri" katalog GRUBUNUN
 * TAMAMI değildir — o grup ayrıca "liman-personeli"yi de içerir (kaldırıldı,
 * bkz. REMOVED_CATEGORY_IDS), bu görev tanımında açıkça listelenmediği için
 * kapsam DIŞIDIR. Depolama (tüm "depo-hizmetleri" alt kategorileri),
 * Forklift Hizmeti ("forklift"/"forklift-operatoru") ve Nakliye dışındaki
 * diğer TÜM kategoriler de BİLEREK kapsam DIŞIDIR. Nakliye AYRI bir
 * kategoridir — bu kümeye DAHİL DEĞİLDİR, kendi `isTransportationCategory`
 * kontrolüne sahiptir (aşağıda); ikisi yalnızca `requiresProductInfo`
 * üzerinden BİRLEŞİR. Oluşturma, düzenleme, doğrulama, kayıt (job-store.ts),
 * ilan detayı ve teklif ekranlarının HEPSİ bu dosyadaki fonksiyonları
 * çağırır — hiçbiri kendi kategori listesini tutmaz.
 */
export const PORT_SERVICE_CATEGORY_IDS: ReadonlySet<string> = new Set([
  "lashing-unlashing",
  "gozetim-hizmetleri",
]);

/** Bir kategori id'sinin gerçek bir Liman Hizmeti olup olmadığının TEK doğruluk kaynağı (bkz. PORT_SERVICE_CATEGORY_IDS üstündeki doküman). */
export function isPortServiceCategory(categoryId: string): boolean {
  return PORT_SERVICE_CATEGORY_IDS.has(categoryId);
}

/** Bir kategori id'sinin Nakliye olup olmadığının TEK doğruluk kaynağı — service-catalog.ts#NAKLIYE_SERVICE_CATEGORY_ID'nin AYNEN kullanımı, "nakliye" hiçbir yerde ayrıca hardcode edilmez. */
export function isTransportationCategory(categoryId: string): boolean {
  return categoryId === NAKLIYE_SERVICE_CATEGORY_ID;
}

/** Bu kategori seçiliyken ürün bilgisi alanları (Ürün Adedi/Tonaj/Ürün Cinsi) gösterilmeli mi — Liman Hizmetleri kapsamı İLE Nakliye'nin BİRLEŞİMİ. */
export function requiresProductInfo(categoryId: string): boolean {
  return isPortServiceCategory(categoryId) || isTransportationCategory(categoryId);
}

/** Tonaj yalnızca Nakliye'de ZORUNLU; Liman Hizmetleri kapsamındaki iki kategorinin (Konteyner Dolum/Boşaltım kaldırıldıktan sonra) TAMAMINDA isteğe bağlıdır. */
export function isTonnageRequired(categoryId: string): boolean {
  return isTransportationCategory(categoryId);
}

/**
 * "Ürün Cinsi" combobox'ının varsayılan öneri listesi — TEK doğruluk kaynağı.
 * Hiçbir bileşen bu listeyi kendi başına kopyalamaz; yeni bir ürün eklemek
 * yalnızca burayı değiştirmeyi gerektirir. Alfabetik (Türkçe harf sırası)
 * olarak sıralanır.
 */
const RAW_PRODUCT_TYPE_SUGGESTIONS: readonly string[] = [
  "Rulo Sac",
  "Big Bag",
  "Çelik Çubuk",
  "Boru",
  "Proje Yükü",
  "Levha Sac",
  "Filmaşin",
  "Profil",
  "Lama Demir",
  "Paket Sac",
  "H Profil",
  "Alüminyum Külçe",
  "Slab",
  "Ray",
  "Alüminyum",
  "Profil Demir",
  "Bakır",
  "Kütük Demir",
  "Paletli Yük",
  "L Profil",
  // "Konteyner" — Depolama'ya özel "Konteyner Bilgileri" alt alan grubunun
  // (bkz. storage-container-catalog.ts#isContainerProduct) tetikleyicisi
  // olarak seçilebilir/keşfedilebilir olması için eklendi. Bu liste
  // Liman/Nakliye ile PAYLAŞILIR — burada bir seçenek daha olması o
  // kategorilerin davranışını DEĞİŞTİRMEZ (Konteyner Bilgileri bölümü ayrıca
  // isStorageGroupCategory(category) şartını da arar).
  "Konteyner",
];

export const PRODUCT_TYPE_SUGGESTIONS: readonly string[] = [...RAW_PRODUCT_TYPE_SUGGESTIONS].sort((a, b) =>
  a.localeCompare(b, "tr-TR"),
);

/**
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — bu, bir
 * ÖNCEKİ görevin ("MALSEVK Nakliye — Ürün/Yük Cinsi'nden Konteyner'i
 * Kaldır") kararının BİLEREK TERSİ: o zaman "Konteyner" Nakliye'nin kendi
 * "Ürün/Yük Cinsi" listesinden çıkarılmıştı çünkü konteyner akışı AYRI bir
 * "Yük konteyner olarak mı taşınacak?" Hayır/Evet sorusuyla yönetiliyordu —
 * o soru artık TAMAMEN KALDIRILDI (bkz. types.ts#NakliyeCargoGroup üstündeki
 * doküman), konteyner akışının TEK tetikleyicisi artık doğrudan "Ürün/Yük
 * Cinsi = Konteyner" seçimidir (bkz. nakliye-transport-catalog.ts#
 * isNakliyeContainerProductType). Bu yüzden "Konteyner" burada YENİDEN
 * gerekli — görev talimatının kendi kesin sıralama kuralı: listenin EN
 * BAŞINDA, geri kalanı (PRODUCT_TYPE_SUGGESTIONS'ın alfabetik sıralı hâli,
 * "Konteyner" hariç tutularak tekrar etmesin diye) onu izler. PAYLAŞILAN
 * `PRODUCT_TYPE_SUGGESTIONS`ın KENDİSİ hâlâ değişmedi/alfabetik kalır — bu
 * yalnızca Nakliye'nin kendi `ProductTypeCombobox` çağrı yerlerinin (job-
 * request-form.tsx/job-edit-form.tsx/admin-job-edit-form.tsx, üçü de
 * nakliye-cargo-group-fields.tsx üzerinden) kullandığı, sıralaması farklı
 * bir GÖRÜNÜMdür — diğer TÜM kategoriler (Liman Hizmetleri, Depolama vb.)
 * değişmeden `PRODUCT_TYPE_SUGGESTIONS`ın kendisini kullanmaya devam eder.
 */
export const NAKLIYE_PRODUCT_TYPE_SUGGESTIONS: readonly string[] = [
  "Konteyner",
  ...PRODUCT_TYPE_SUGGESTIONS.filter((suggestion) => suggestion !== "Konteyner"),
];

/**
 * "Ürün Cinsi" listesinin sonunda görünen, listede yok/kendi ürününü
 * yazmak isteyen kullanıcı için özel seçenek — `job-location.ts`'in
 * `FACILITY_FREE_TEXT_VALUE` sentinel deseniyle AYNI ilke: bu değer form
 * state'inde ("Ürün Cinsi" alanının kendisinde) geçici bir işaretçi olarak
 * tutulur, GERÇEK serbest metin AYRI bir alanda (productTypeCustomText)
 * saklanır ve yalnızca gönderim anında ("özel mi, katalog mu" kararı
 * verilip) nihai `Job.productType` değerine çözümlenir — bu sentinel
 * hiçbir zaman kaydedilen veriye/görüntüye sızmaz.
 */
export const PRODUCT_TYPE_CUSTOM_VALUE = "__ozel_urun_cinsi__";

/** Bkz. PRODUCT_TYPE_CUSTOM_VALUE — kullanıcıya gösterilen seçenek metni. */
export const PRODUCT_TYPE_CUSTOM_OPTION_LABEL = "Listede Yok, Kendim Gireceğim";

export type ProductQuantityParseError = "empty" | "invalid" | "not-integer" | "not-positive" | "too-large";
export type ProductQuantityParseResult =
  | { ok: true; value: number }
  | { ok: false; error: ProductQuantityParseError };

/**
 * "Ürün Adedi" — yalnızca pozitif tam sayı kabul eder (bkz. görev tanımı),
 * en fazla `MAX_PRODUCT_QUANTITY` (1.000.000, "Tüm İlan Formlarında...
 * Aşılamaz Giriş Sınırları" görevi — field-limits.ts, önceki 999.999'dan
 * hizalandı). Katı `^\d+$` regex'i BİLEREK bilimsel gösterimi ("1e6"),
 * ondalık ayracını ve birden fazla işareti baştan reddeder — `Number(...)`
 * çağrılmadan ÖNCE.
 */
export function parseProductQuantity(raw: string): ProductQuantityParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return { ok: false, error: "invalid" };
  if (/[.,]/.test(trimmed)) return { ok: false, error: "not-integer" };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return { ok: false, error: "invalid" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_PRODUCT_QUANTITY) return { ok: false, error: "too-large" };

  return { ok: true, value };
}

export type ProductTonnageParseError = "empty" | "invalid" | "not-positive" | "too-large";
export type ProductTonnageParseResult =
  | { ok: true; value: number }
  | { ok: false; error: ProductTonnageParseError };

/**
 * "Tonaj" — ondalıklı sayı destekler (virgül ya da nokta ondalık ayracı
 * olarak kabul edilir, money.ts#parsePriceInput'un binlik-grup belirsizliği
 * tonaj değerleri için gereksiz olduğundan burada BİLEREK daha basit bir
 * kural uygulanır). "Tüm İlan Formlarında... Aşılamaz Giriş Sınırları"
 * görevi — bulunan gerçek açık: bu fonksiyon birimden (`ProductTonnageUnit`)
 * BAĞIMSIZ, tek bir sabit üst sınır/ondalık kuralı uyguluyordu; oysa Kg
 * birimindeki bir değer Ton biriminden ~1000× büyük olabilir (görev
 * talimatı: "Birim değiştiğinde sınırı doğru birim dönüşümüyle uygula").
 * `unit` opsiyonel — verilmezse (Depolama/Gözetim/Liman Hizmetleri gibi
 * birim seçimi OLMAYAN, her zaman "ton" anlamına gelen ~15 çağıran için)
 * ESKİ davranışla AYNI şekilde "ton" varsayılır, hiçbir mevcut çağıran
 * DEĞİŞMEK ZORUNDA kalmadı — yalnızca gerçekten birim seçimi olan Nakliye
 * çağıranları (job-request-form.tsx/job-edit-form.tsx/nakliye-transport-
 * catalog.ts/job-form-validation.ts) kendi `productTonnageUnit`'lerini geçer.
 */
export function parseProductTonnage(raw: string, unit: "ton" | "kg" = "ton"): ProductTonnageParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  const maxValue = unit === "kg" ? MAX_TONNAGE_KG : MAX_TONNAGE_TON;
  const maxDecimals = unit === "kg" ? TONNAGE_KG_DECIMAL_PLACES : TONNAGE_TON_DECIMAL_PLACES;
  if (!new RegExp(`^\\d+([.,]\\d{1,${maxDecimals}})?$`).test(trimmed)) return { ok: false, error: "invalid" };

  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > maxValue) return { ok: false, error: "too-large" };

  return { ok: true, value };
}

/** Örnek: 120 -> "120 adet". */
export function formatProductQuantity(value: number): string {
  return `${new Intl.NumberFormat("tr-TR").format(value)} adet`;
}

/**
 * "Toplam Ağırlık" birimi — YALNIZCA Nakliye'ye özeldir (bkz.
 * isTransportationCategory). Liman Hizmetleri'nin kendi Tonaj alanı BUNU
 * KULLANMAZ, her zaman sabit "ton" gösterir (bkz. formatProductTonnage'ın
 * ikinci parametresi) — ikinci bir birim kataloğu (recycling-catalog.ts#
 * RecyclingUnit/storage-product-fields.tsx'in kg/ton/adet'i) İLE
 * KARIŞTIRILMAZ, o ikisi 3 seçenekli VE farklı bir alana ait; bu yalnızca 2
 * seçenekli (Ton/Kg) ve yalnızca Job.productTonnageUnit'e aittir.
 */
export type ProductTonnageUnit = "ton" | "kg";

export const PRODUCT_TONNAGE_UNIT_OPTIONS: readonly { id: ProductTonnageUnit; label: string }[] = [
  { id: "ton", label: "Ton" },
  { id: "kg", label: "Kg" },
];

export function isProductTonnageUnit(value: unknown): value is ProductTonnageUnit {
  return value === "ton" || value === "kg";
}

/**
 * Örnek: 8.5 -> "8,5 ton", (750, "kg") -> "750 kg". `unit` verilmezse (Liman
 * Hizmetleri'nin kendi çağrıları VE bu alandan önce oluşturulmuş eski
 * Nakliye ilanları için) eski davranışla BİREBİR aynı, sabit "ton" —
 * kullanıcı arasında OTOMATİK bir dönüşüm YAPILMAZ, yalnızca son ekin
 * kendisi değişir (bkz. görev tanımı "Otomatik dönüşüm yapma").
 */
export function formatProductTonnage(value: number, unit?: ProductTonnageUnit): string {
  const unitLabel = unit === "kg" ? "kg" : "ton";
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value)} ${unitLabel}`;
}

type JobProductInfoFields = {
  category: string;
  productQuantity?: number;
  productTonnage?: number;
  /** Bkz. types.ts#Job.productTonnageUnit — yalnızca Nakliye'de anlamlı, Liman Hizmetleri'nde her zaman undefined (formatProductTonnage bu durumda sabit "ton" varsayılanına düşer). */
  productTonnageUnit?: ProductTonnageUnit;
  productType?: string;
};

/**
 * Bir ilanda ürün bilgisi kartı/satırı gösterilip gösterilmeyeceğinin TEK
 * doğruluk kaynağı — HER ZAMAN kapsam kontrolünü (requiresProductInfo:
 * Liman Hizmetleri ∪ Nakliye) gerçek veri varlığıyla birlikte ister. Bu,
 * "Mevcut Veriler" kuralının (bkz. görev tanımı) uygulama noktasıdır: kapsam
 * dışı bir kategoriye eskiden (kapsam farklıyken) yanlışlıkla yazılmış
 * kalıntı ürün bilgisi varsa bile — kayıt hiç silinmez/migrasyona uğramaz —
 * bu kontrol sayesinde arayüzün HİÇBİR yerinde gösterilmez.
 */
export function hasProductInfo(job: JobProductInfoFields): boolean {
  if (!requiresProductInfo(job.category)) return false;
  return job.productQuantity !== undefined || Boolean(job.productType);
}

/**
 * Kart/tablo gibi kompakt bağlamlar için tek satırlık özet — job-location.ts#
 * formatJobLocationLine'ın "•" ayraçlı birleştirme kuralını izler. Kapsam
 * dışı bir kategoride (bkz. hasProductInfo) ya da ürün bilgisi hiç
 * girilmemiş bir ilan için `null` döner.
 */
export function formatJobProductInfoLine(job: JobProductInfoFields): string | null {
  if (!hasProductInfo(job)) return null;
  const parts: string[] = [];
  if (job.productQuantity !== undefined) parts.push(formatProductQuantity(job.productQuantity));
  if (job.productTonnage !== undefined) parts.push(formatProductTonnage(job.productTonnage, job.productTonnageUnit));
  if (job.productType) parts.push(job.productType);
  return parts.length > 0 ? parts.join(" • ") : null;
}
