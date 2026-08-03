import { NAKLIYE_SERVICE_CATEGORY_ID } from "./service-catalog";

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
 * tutulmaz.
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
  "konteyner-dolum-bosaltim",
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

/** Tonaj yalnızca Nakliye'de ZORUNLU; Liman Hizmetleri kapsamındaki altı kategorinin TAMAMINDA isteğe bağlıdır. */
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
];

export const PRODUCT_TYPE_SUGGESTIONS: readonly string[] = [...RAW_PRODUCT_TYPE_SUGGESTIONS].sort((a, b) =>
  a.localeCompare(b, "tr-TR"),
);

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

const MAX_PRODUCT_QUANTITY = 999_999;

export type ProductQuantityParseError = "empty" | "invalid" | "not-integer" | "not-positive" | "too-large";
export type ProductQuantityParseResult =
  | { ok: true; value: number }
  | { ok: false; error: ProductQuantityParseError };

/** "Ürün Adedi" — yalnızca pozitif tam sayı kabul eder (bkz. görev tanımı). */
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

const MAX_PRODUCT_TONNAGE = 999_999;

export type ProductTonnageParseError = "empty" | "invalid" | "not-positive" | "too-large";
export type ProductTonnageParseResult =
  | { ok: true; value: number }
  | { ok: false; error: ProductTonnageParseError };

/**
 * "Tonaj" — ondalıklı sayı destekler (virgül ya da nokta ondalık ayracı
 * olarak kabul edilir, money.ts#parsePriceInput'un binlik-grup belirsizliği
 * tonaj değerleri için gereksiz olduğundan burada BİLEREK daha basit bir
 * kural uygulanır: tek bir ayraçtan sonra en fazla 2 hane).
 */
export function parseProductTonnage(raw: string): ProductTonnageParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false, error: "invalid" };

  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_PRODUCT_TONNAGE) return { ok: false, error: "too-large" };

  return { ok: true, value };
}

/** Örnek: 120 -> "120 adet". */
export function formatProductQuantity(value: number): string {
  return `${new Intl.NumberFormat("tr-TR").format(value)} adet`;
}

/** Örnek: 8.5 -> "8,5 ton". */
export function formatProductTonnage(value: number): string {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value)} ton`;
}

type JobProductInfoFields = {
  category: string;
  productQuantity?: number;
  productTonnage?: number;
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
  if (job.productTonnage !== undefined) parts.push(formatProductTonnage(job.productTonnage));
  if (job.productType) parts.push(job.productType);
  return parts.length > 0 ? parts.join(" • ") : null;
}
