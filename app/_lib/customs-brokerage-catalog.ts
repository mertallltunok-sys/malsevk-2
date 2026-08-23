import type { DocumentExtension } from "./document-validation";
import { GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID } from "./service-catalog";

/**
 * Gümrük Müşavirliği'ne ÖZEL "Operasyon Bilgileri" formu için TEK merkezi
 * katalog kaynağı — İşlem Türü, Gümrük Müdürlüğü ve Talep Edilen Hizmetler
 * listelerinin HİÇBİRİ başka bir dosyada (job-request-form.tsx,
 * job-edit-form.tsx, job-detail-content.tsx) tekrar yazılmaz; hepsi buradan
 * içe aktarılır. Diğer altı hizmet kategorisi (Nakliye, Lashing/Unlashing,
 * Gözetim Hizmetleri, Konteyner Dolum/Boşaltım, Forklift, Depolama vb.) bu
 * dosyadan HİÇ etkilenmez — mevcut `product-catalog.ts` (Ürün Bilgileri:
 * Ürün Adedi/Tonaj/Ürün Cinsi) ile bilerek TAMAMEN AYRI ve bağımsızdır; bu
 * iki katalog hiçbir alanı/işlevi paylaşmaz.
 */

export type CustomsBrokerageOption = { id: string; label: string };

/** "İşlem Türü" — Gümrük Müşavirliği ilanlarında ZORUNLU tekli seçim. */
export const CUSTOMS_TRANSACTION_TYPES: readonly CustomsBrokerageOption[] = [
  { id: "ithalat", label: "İthalat" },
  { id: "ihracat", label: "İhracat" },
  { id: "transit", label: "Transit" },
  { id: "antrepo", label: "Antrepo" },
  { id: "dahilde-isleme-rejimi", label: "Dahilde İşleme Rejimi (DİR)" },
  { id: "haricte-isleme-rejimi", label: "Hariçte İşleme Rejimi (HİR)" },
  { id: "gecici-ithalat", label: "Geçici İthalat" },
  { id: "gecici-ihracat", label: "Geçici İhracat" },
  { id: "serbest-bolge-islemleri", label: "Serbest Bölge İşlemleri" },
  { id: "diger", label: "Diğer" },
];

/**
 * "Gümrük Müdürlüğü" — Gümrük Müşavirliği ilanlarında ZORUNLU tekli seçim.
 * İlk sürümde BİLEREK yalnızca Kocaeli'nde bulunan gümrük müdürlükleri
 * listelenir (görev tanımı) — nationwide genişleme, il/ilçe verisinin
 * turkey-locations.ts'e taşınmasıyla birlikte ileride ele alınabilir.
 */
export const KOCAELI_CUSTOMS_OFFICES: readonly CustomsBrokerageOption[] = [
  { id: "dilovasi-gumruk-mudurlugu", label: "Dilovası Gümrük Müdürlüğü" },
  { id: "derince-gumruk-mudurlugu", label: "Derince Gümrük Müdürlüğü" },
  { id: "gebze-gumruk-mudurlugu", label: "Gebze Gümrük Müdürlüğü" },
];

/** "Talep Edilen Hizmetler" — Gümrük Müşavirliği ilanlarında isteğe bağlı çoklu seçim. */
export const CUSTOMS_REQUESTED_SERVICE_OPTIONS: readonly CustomsBrokerageOption[] = [
  { id: "ithalat-gumrukleme", label: "İthalat Gümrükleme" },
  { id: "ihracat-gumrukleme", label: "İhracat Gümrükleme" },
  { id: "transit-islemleri", label: "Transit İşlemleri" },
  { id: "antrepo-islemleri", label: "Antrepo İşlemleri" },
  { id: "t1-islemleri", label: "T1 İşlemleri" },
  { id: "t2-islemleri", label: "T2 İşlemleri" },
  { id: "atr-duzenlenmesi", label: "ATR Düzenlenmesi" },
  { id: "eur1-duzenlenmesi", label: "EUR.1 Düzenlenmesi" },
  { id: "mense-sahadetnamesi", label: "Menşe Şahadetnamesi" },
  { id: "gumruk-danismanligi", label: "Gümrük Danışmanlığı" },
  { id: "beyanname-hazirlama", label: "Beyanname Hazırlama" },
  { id: "diger", label: "Diğer" },
];

/**
 * Bu ilan/hizmet kartının Gümrük Müşavirliği'ne özel "Operasyon Bilgileri"
 * alanlarını (İşlem Türü/Gümrük Müdürlüğü/Talep Edilen Hizmetler/Ürün
 * Cinsi/GTİP/Beyan Kalem Sayısı/Konteyner Sayısı/Evrak) gösterip
 * göstermeyeceğinin TEK doğruluk kaynağı — service-catalog.ts#
 * GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID'nin AYNEN kullanımı, "gumruk-musavirligi"
 * hiçbir yerde ayrıca hardcode edilmez. job-request-form.tsx, job-edit-form.tsx,
 * job-store.ts ve job-detail-content.tsx HEPSİ bu tek fonksiyonu çağırır.
 */
export function isCustomsBrokerageCategory(categoryId: string): boolean {
  return categoryId === GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID;
}

export function isCustomsTransactionTypeId(value: unknown): value is string {
  return typeof value === "string" && CUSTOMS_TRANSACTION_TYPES.some((option) => option.id === value);
}

export function isCustomsOfficeId(value: unknown): value is string {
  return typeof value === "string" && KOCAELI_CUSTOMS_OFFICES.some((option) => option.id === value);
}

export function isCustomsRequestedServiceId(value: unknown): value is string {
  return typeof value === "string" && CUSTOMS_REQUESTED_SERVICE_OPTIONS.some((option) => option.id === value);
}

export function getCustomsTransactionTypeLabel(id: string): string | undefined {
  return CUSTOMS_TRANSACTION_TYPES.find((option) => option.id === id)?.label;
}

export function getCustomsOfficeLabel(id: string): string | undefined {
  return KOCAELI_CUSTOMS_OFFICES.find((option) => option.id === id)?.label;
}

/** Kayıtlı id dizisini (bkz. Job.customsRequestedServices), tanınmayan/eski id'leri sessizce atlayarak görünen etiketlere çevirir. */
export function getCustomsRequestedServiceLabels(ids: readonly string[]): string[] {
  return ids
    .map((id) => CUSTOMS_REQUESTED_SERVICE_OPTIONS.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));
}

type JobCustomsBrokerageSummaryFields = {
  category: string;
  customsTransactionType?: string;
  customsProductType?: string;
  customsRequestedServices?: string[];
};

/**
 * Kart/tablo gibi kompakt bağlamlar için tek satırlık özet —
 * product-catalog.ts#formatJobProductInfoLine ve recycling-catalog.ts#
 * formatRecyclingSummaryLine ile AYNI "•"-ayraçlı desen (masaüstü
 * genişlik/yoğunluk düzeltmesi görevi, Faz 2 — bu ikisi zaten vardı, bu
 * üçüncüsü aynı deseni tamamlıyor). "Destekleyici Evraklar" (yüklenen
 * dosya bağlantıları) BİLEREK bu satıra dahil DEĞİLDİR — metne indirgenecek
 * bir alan değil, kendi ayrı görüntüleme yüzeyinde kalır. Kapsam dışı bir
 * kategoride ya da hiç bilgi girilmemişse `null` döner.
 */
export function formatCustomsBrokerageSummaryLine(job: JobCustomsBrokerageSummaryFields): string | null {
  if (!isCustomsBrokerageCategory(job.category)) return null;
  const parts: string[] = [];
  if (job.customsTransactionType) {
    const label = getCustomsTransactionTypeLabel(job.customsTransactionType);
    if (label) parts.push(label);
  }
  if (job.customsProductType) parts.push(job.customsProductType);
  if (job.customsRequestedServices && job.customsRequestedServices.length > 0) {
    parts.push(getCustomsRequestedServiceLabels(job.customsRequestedServices).join(", "));
  }
  return parts.length > 0 ? parts.join(" • ") : null;
}

/**
 * "Evrak Yükleme" alanının kabul ettiği DAR uzantı alt kümesi (görev tanımı:
 * PDF, JPG, PNG, DOCX, XLSX) — document-validation.ts#ALLOWED_EXTENSIONS'ın
 * TAMAMI değil, o dosyanın kendi dokümantasyonundaki kuralla (dar bir alt
 * küme isteyen çağıran kendi listesini burada tanımlar) uyumlu.
 */
export const CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS: readonly DocumentExtension[] = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "docx",
  "xlsx",
];

export type CustomsCountParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: "invalid" | "not-positive" | "too-large" };

/**
 * "Tahmini Beyan Kalem Sayısı" VE "Konteyner Sayısı" — TEK paylaşılan
 * doğrulayıcı (görev gereksinimi: aynı liste/kural farklı dosyalarda tekrar
 * edilmesin). İkisi de isteğe bağlı pozitif tam sayıdır: boş girdi HATA
 * DEĞİLDİR (`value: undefined` ile başarı döner) — productQuantity'nin
 * (zorunlu) aksine, burada "girilmemiş" geçerli bir durumdur.
 */
export function parseCustomsCount(raw: string): CustomsCountParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "invalid" };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return { ok: false, error: "not-positive" };
  }
  if (value > 999_999) return { ok: false, error: "too-large" };
  return { ok: true, value };
}
