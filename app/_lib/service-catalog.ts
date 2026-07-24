import { SERVICE_CATEGORIES } from "./jobs";
import type { ExperienceRange, ServiceFeature } from "./types";

export type ServiceCategory = { id: string; label: string };

export type ServiceCategoryGroup = {
  id: string;
  label: string;
  categories: ServiceCategory[];
};

/**
 * PLATFORMUN TEK MERKEZİ HİZMET TAKSONOMİSİ — hem Hizmet Veren'in
 * "Hizmet Bilgilerim" (Panel > Profilim) sayfasındaki çoklu hizmet seçimi
 * hem de ilan oluşturma/düzenleme formundaki "Hizmet Kategorisi" seçimi
 * (job-request-form.tsx, job-edit-form.tsx) BURADAN beslenir — aynı hizmet
 * her iki tarafta da aynı `id` ile temsil edilir (ör. bir Hizmet Veren
 * "forklift-operatoru" seçmişse, bir ilan da aynı id'yi taşıyabilir).
 * Otomatik eşleştirme bu aşamada YOK — yalnızca ortak veri temeli hazırdır.
 *
 * `jobs.ts#SERVICE_CATEGORIES` (8 elemanlı, düz, eski liste) bu dosyanın
 * YERİNE GEÇMEZ — yalnızca aşağıdaki `LEGACY_CATEGORY_TO_SERVICE_IDS`
 * eşlemesi üzerinden BURAYA bağlanır (bkz. aşağıdaki migrasyon bölümü).
 * Ana sayfadaki `services-section.tsx`in kendi (bu dosyadan bağımsız,
 * ikon/açıklama içeren) tanıtım listesi bu görevin kapsamı dışında
 * bırakıldı — o saf pazarlama içeriğidir, ne Job.category'yi ne
 * ProviderProfile'ı okur/yazar.
 */
export const SERVICE_CATEGORY_GROUPS: ServiceCategoryGroup[] = [
  {
    id: "liman-hizmetleri",
    label: "Liman Hizmetleri",
    categories: [
      { id: "lashing", label: "Lashing" },
      { id: "unlashing", label: "Unlashing" },
      { id: "konteyner-dolum", label: "Konteyner Dolum" },
      { id: "konteyner-bosaltim", label: "Konteyner Boşaltım" },
      { id: "yukleme-gozetimi", label: "Yükleme Gözetimi" },
      { id: "bosaltma-gozetimi", label: "Boşaltma Gözetimi" },
      { id: "liman-personeli", label: "Liman Personeli" },
    ],
  },
  {
    id: "depo-hizmetleri",
    label: "Depo Hizmetleri",
    categories: [
      { id: "depo-personeli", label: "Depo Personeli" },
      { id: "depo-duzenleme", label: "Depo Düzenleme" },
      { id: "ellecleme", label: "Elleçleme" },
      { id: "paletleme", label: "Paletleme" },
      { id: "etiketleme", label: "Etiketleme" },
      { id: "sayim-hizmeti", label: "Sayım Hizmeti" },
    ],
  },
  {
    id: "is-makinesi-hizmetleri",
    label: "İş Makinesi Hizmetleri",
    categories: [
      { id: "forklift", label: "Forklift" },
      { id: "reach-stacker", label: "Reach Stacker" },
      { id: "vinc", label: "Vinç" },
      { id: "manlift", label: "Manlift" },
    ],
  },
  {
    id: "operator-hizmetleri",
    label: "Operatör Hizmetleri",
    categories: [
      { id: "forklift-operatoru", label: "Forklift Operatörü" },
      { id: "reach-stacker-operatoru", label: "Reach Stacker Operatörü" },
      { id: "vinc-operatoru", label: "Vinç Operatörü" },
      { id: "manlift-operatoru", label: "Manlift Operatörü" },
    ],
  },
  {
    id: "diger-hizmetler",
    label: "Diğer Hizmetler",
    categories: [
      { id: "personel-temini", label: "Personel Temini" },
      { id: "vardiyali-calisma", label: "Vardiyalı Çalışma" },
      { id: "acil-operasyon-destegi", label: "Acil Operasyon Desteği" },
    ],
  },
];

const VALID_SERVICE_CATEGORY_IDS = new Set(
  SERVICE_CATEGORY_GROUPS.flatMap((group) => group.categories.map((category) => category.id)),
);

export function isServiceCategoryId(value: unknown): value is string {
  return typeof value === "string" && VALID_SERVICE_CATEGORY_IDS.has(value);
}

/** Bir katalog id'sinin görünen Türkçe etiketini bulur; bilinmeyen id için `undefined` döner (sahte etiket üretilmez). */
export function getServiceCategoryLabel(id: string): string | undefined {
  for (const group of SERVICE_CATEGORY_GROUPS) {
    const found = group.categories.find((category) => category.id === id);
    if (found) return found.label;
  }
  return undefined;
}

// ============================================================
// Eski (jobs.ts#SERVICE_CATEGORIES) değerlerden yeni katalog
// id'lerine migrasyon eşlemesi
// ============================================================

const [
  LEGACY_LASHING,
  LEGACY_YUKLEME_BOSALTMA_GOZETIMI,
  LEGACY_KONTEYNER_DOLUM,
  LEGACY_KONTEYNER_BOSALTIM,
  LEGACY_FORKLIFT_OPERATORU,
  LEGACY_VINC_OPERATORU,
  LEGACY_REACH_STACKER_OPERATORU,
  LEGACY_DEPOLAMA,
] = SERVICE_CATEGORIES;
void LEGACY_DEPOLAMA; // bilerek eşlenmedi, bkz. aşağıdaki not.

/**
 * `jobs.ts#SERVICE_CATEGORIES`in eski, düz değerlerinden yukarıdaki yeni
 * hiyerarşik katalog id'lerine migrasyon eşlemesi. Bir eski değer BİRDEN
 * FAZLA yeni id'ye karşılık gelebilir (ör. "Yükleme / Boşaltma Gözetimi"
 * tek bir seçimken, yeni katalogda iki ayrı hizmettir) — bu yüzden değer
 * tipi `string[]`dir, tekli değil.
 *
 * "Depolama" BİLEREK bu eşlemede YOK: yeni katalogdaki "Depo Hizmetleri"
 * grubu (Depo Personeli/Düzenleme/Elleçleme/Paletleme/Etiketleme/Sayım)
 * genel "depolama" kavramının birebir karşılığı değil, daha dar/spesifik
 * alt hizmetlerdir — hangisine (ya da yeni bir kategoriye mi) karşılık
 * gelmesi gerektiği bir iş kararı gerektirir (bkz. rapor). Sahte/yanlış
 * bir eşleme uydurmak yerine BİLEREK boş bırakıldı; bu değeri taşıyan
 * veri KAYBOLMAZ (bkz. migrateLegacyExpertiseToServiceCategoryIds/
 * resolveLegacyJobCategoryToId — eşleşmeyen değerler sessizce atlanır,
 * orijinal veri olduğu gibi kalır).
 */
export const LEGACY_CATEGORY_TO_SERVICE_IDS: Readonly<Record<string, readonly string[]>> = {
  [LEGACY_LASHING]: ["lashing"],
  [LEGACY_YUKLEME_BOSALTMA_GOZETIMI]: ["yukleme-gozetimi", "bosaltma-gozetimi"],
  [LEGACY_KONTEYNER_DOLUM]: ["konteyner-dolum"],
  [LEGACY_KONTEYNER_BOSALTIM]: ["konteyner-bosaltim"],
  [LEGACY_FORKLIFT_OPERATORU]: ["forklift-operatoru"],
  [LEGACY_VINC_OPERATORU]: ["vinc-operatoru"],
  [LEGACY_REACH_STACKER_OPERATORU]: ["reach-stacker-operatoru"],
};

/**
 * `ProviderProfile.expertise` (eski, düz Türkçe metin dizisi) içindeki
 * değerleri, mümkün olanları yeni katalog id'lerine çevirerek döndürür —
 * SAF bir fonksiyondur, hiçbir yere yazmaz, `expertise`i değiştirmez.
 * Zaten geçerli bir katalog id'si olan değerler olduğu gibi kabul edilir.
 * Eşleşmeyen değerler (ör. "Depolama") sessizce atlanır — bu, veri kaybı
 * DEĞİLDİR: orijinal `expertise` dizisi çağıranın elinde bozulmadan durur,
 * yalnızca bu türetilmiş kümeye eklenemezler. Sonuç `Set` üzerinden
 * tekilleştirilir, bu yüzden tekrar tekrar çağrılması asla çoğaltma
 * üretmez (idempotenttir).
 */
export function migrateLegacyExpertiseToServiceCategoryIds(expertise: string[]): string[] {
  const ids = new Set<string>();
  for (const value of expertise) {
    if (isServiceCategoryId(value)) {
      ids.add(value);
      continue;
    }
    const mapped = LEGACY_CATEGORY_TO_SERVICE_IDS[value];
    mapped?.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

/**
 * `Job.category` (tekli seçim) için en iyi çaba ("best effort") migrasyonu
 * — `migrateLegacyExpertiseToServiceCategoryIds`in tekli karşılığıdır.
 * Zaten geçerli bir id ise olduğu gibi döner. Eski, birden fazla yeni
 * id'ye karşılık gelen bir değerse (ör. "Yükleme / Boşaltma Gözetimi")
 * eşlemedeki İLK id kullanılır — tek seçimlik bir alan için makul bir
 * varsayılan, ama tam karşılığın kaybolabileceği bilinen bir sınırlamadır
 * (bkz. rapor). Hiç eşleşme yoksa (ör. "Depolama") `null` döner — çağıran
 * taraf (job-edit-form.tsx) bunu "kategori seçilmemiş" gibi ele alır,
 * kullanıcıyı yeni katalogdan geçerli bir kategori seçmeye yönlendirir;
 * ilanın kendi `category` alanı bu fonksiyon çağrılırken DEĞİŞTİRİLMEZ.
 */
export function resolveLegacyJobCategoryToId(rawCategory: string): string | null {
  if (isServiceCategoryId(rawCategory)) return rawCategory;
  const mapped = LEGACY_CATEGORY_TO_SERVICE_IDS[rawCategory];
  return mapped?.[0] ?? null;
}

/**
 * `Job.category`'nin GÜVENLİ görüntüleme etiketini üretir — hem yeni
 * (id tabanlı) hem eski (ham Türkçe metin) kayıtlarla çalışır. Yeni bir
 * katalog id'si ise karşılığı gösterilir; değilse (eski ilanlarda olduğu
 * gibi zaten okunabilir bir Türkçe metin, ya da hiç tanınmayan bir değer)
 * olduğu gibi gösterilir — veri asla kaybolmaz/boş görünmez.
 */
export function getCategoryDisplayLabel(rawCategory: string): string {
  if (isServiceCategoryId(rawCategory)) {
    return getServiceCategoryLabel(rawCategory) ?? rawCategory;
  }
  return rawCategory;
}

// ============================================================
// Hizmet özellikleri / deneyim aralığı (Aşama 2)
// ============================================================

export const SERVICE_FEATURE_OPTIONS: { value: ServiceFeature; label: string }[] = [
  { value: "operatorlu", label: "Operatörlü Hizmet" },
  { value: "operatorsuz", label: "Operatörsüz Hizmet" },
  { value: "7-24", label: "7/24 Hizmet" },
  { value: "acil-hizmet", label: "Acil Hizmet Verebilir" },
  { value: "faturali", label: "Faturalı Hizmet" },
];

const VALID_SERVICE_FEATURES = new Set(SERVICE_FEATURE_OPTIONS.map((option) => option.value));

export function isServiceFeature(value: unknown): value is ServiceFeature {
  return typeof value === "string" && (VALID_SERVICE_FEATURES as Set<string>).has(value);
}

export const EXPERIENCE_RANGE_OPTIONS: { value: ExperienceRange; label: string }[] = [
  { value: "0-1", label: "0-1 Yıl" },
  { value: "1-3", label: "1-3 Yıl" },
  { value: "3-5", label: "3-5 Yıl" },
  { value: "5-10", label: "5-10 Yıl" },
  { value: "10+", label: "10+ Yıl" },
];

const VALID_EXPERIENCE_RANGES = new Set(EXPERIENCE_RANGE_OPTIONS.map((option) => option.value));

export function isExperienceRange(value: unknown): value is ExperienceRange {
  return typeof value === "string" && (VALID_EXPERIENCE_RANGES as Set<string>).has(value);
}

export type ServiceInfoCompletionItem = { label: string; met: boolean };

export type ServiceInfoCompletion = {
  /** 0-100 arası, en yakın tam sayıya yuvarlanmış. */
  percent: number;
  checklist: ServiceInfoCompletionItem[];
};

/**
 * "Profil Tamamlanma" yüzdesini hesaplar — saf bir fonksiyondur, hiçbir
 * yerden okuma yapmaz. Şimdilik yalnızca görev kapsamında belirtilen altı
 * alana bakar (Firma Adı, Telefon, E-posta, Hizmet Seçimi, Çalışma
 * Bölgeleri, Deneyim); her biri eşit ağırlıklıdır. `companyName` hem
 * `StoredUser.companyName` (kayıt anında girilen) hem
 * `providerProfile.companyName` (Hesap Ayarları'ndan sonradan girilen)
 * olabileceği için çağıran taraf ikisinden hangisi doluysa onu geçirir.
 * `serviceCategories` çağıran tarafından zaten migrasyon-birleştirilmiş
 * (bkz. service-info-editor.tsx) olarak geçirilmelidir.
 */
export function getProviderServiceInfoCompletion(input: {
  companyName: string | undefined;
  phone: string | undefined;
  email: string | undefined;
  regions: string[];
  serviceCategories: string[];
  experienceRange: ExperienceRange | undefined;
}): ServiceInfoCompletion {
  const checklist: ServiceInfoCompletionItem[] = [
    { label: "Firma Adı", met: Boolean(input.companyName?.trim()) },
    { label: "Telefon", met: Boolean(input.phone?.trim()) },
    { label: "E-posta", met: Boolean(input.email?.trim()) },
    { label: "Hizmet Seçimi", met: input.serviceCategories.length > 0 },
    { label: "Çalışma Bölgeleri", met: input.regions.length > 0 },
    { label: "Deneyim", met: input.experienceRange !== undefined },
  ];
  const metCount = checklist.filter((item) => item.met).length;
  const percent = Math.round((metCount / checklist.length) * 100);
  return { percent, checklist };
}
