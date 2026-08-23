import { SERVICE_CATEGORIES } from "./jobs";
import type { ExperienceRange, ServiceFeature } from "./types";

export type ServiceCategory = { id: string; label: string };

export type ServiceCategoryGroup = {
  id: string;
  label: string;
  /** Ana sayfa/filtre/form gibi TÜM sıra-duyarlı ekranların tek doğruluk kaynağı — küçük değer önce gösterilir. Hiçbir ekran kendi sıralamasını elle yapmaz; hepsi doğrudan (zaten bu alana göre sıralanmış) `SERVICE_CATEGORY_GROUPS` dizisini okur. */
  order: number;
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
 * Ana sayfadaki `services-section.tsx`in rol bazlı tanıtım/hızlı-erişim
 * bölümü de (bkz. `getAllServiceCategories` altında) BURADAN beslenir —
 * elle yazılmış ayrı bir hizmet listesi tutmaz.
 *
 * Kaldırılan/birleştirilen kategoriler (aşağıdaki `REMOVED_CATEGORY_IDS`/
 * `MERGED_CATEGORY_ID_ALIASES`e bkz.): "Liman Personeli", "Depo Personeli",
 * "Depo Düzenleme", "Paletleme", "Etiketleme", "Sayım Hizmeti", "Paletli
 * Ürün Depolama", "Ağır Yük Depolama", "Vardiyalı Çalışma", "Proje Yük"
 * kataloğa tamamen KALDIRILDI (eski kayıtlar için geriye dönük uyumluluk
 * yalnızca okuma anında normalize edilir, kayıtlar silinmez). Lashing+
 * Unlashing, Konteyner Dolum+Konteyner Boşaltım, Yükleme+Boşaltma Gözetimi
 * BİRLEŞTİRİLDİ (üçü de artık tek birer id) — ve o birleşik "Konteyner Dolum
 * / Boşaltım" (`konteyner-dolum-bosaltim`) hizmetinin KENDİSİ de daha sonra
 * ("Development Temizliği" görevi, Faz 1) tamamen KALDIRILDI — bkz.
 * `REMOVED_CATEGORY_IDS`. Aktif hizmet sayısı bugün 16'dır (Depo
 * Hizmetleri'nin 12 alt kategorisi kullanıcıya tek "Depolama Hizmetleri"
 * kimliğiyle gösterildiği için — bkz. `STORAGE_SERVICE_GROUP_ID` — DB satır
 * sayısıyla karıştırılmamalı).
 */
const RAW_SERVICE_CATEGORY_GROUPS: ServiceCategoryGroup[] = [
  {
    id: "nakliye-hizmetleri",
    label: "Nakliye Hizmetleri",
    order: 1,
    categories: [{ id: "nakliye", label: "Nakliye" }],
  },
  {
    id: "gumruk-hizmetleri",
    label: "Gümrük Hizmetleri",
    order: 2,
    categories: [{ id: "gumruk-musavirligi", label: "Gümrük Müşavirliği" }],
  },
  {
    id: "liman-hizmetleri",
    label: "Liman Hizmetleri",
    order: 3,
    categories: [
      { id: "lashing-unlashing", label: "Lashing / Unlashing" },
      { id: "gozetim-hizmetleri", label: "Gözetim Hizmetleri" },
    ],
  },
  {
    id: "is-makinesi-hizmetleri",
    label: "İş Makinesi Hizmetleri",
    order: 4,
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
    order: 5,
    categories: [
      { id: "forklift-operatoru", label: "Forklift Operatörü" },
      { id: "reach-stacker-operatoru", label: "Reach Stacker Operatörü" },
      { id: "vinc-operatoru", label: "Vinç Operatörü" },
      { id: "manlift-operatoru", label: "Manlift Operatörü" },
    ],
  },
  {
    id: "depo-hizmetleri",
    label: "Depo Hizmetleri",
    order: 6,
    categories: [
      { id: "ellecleme", label: "Elleçleme" },
      { id: "genel-depolama", label: "Genel Depolama" },
      { id: "acik-saha-depolama", label: "Açık Saha Depolama" },
      { id: "kapali-depolama", label: "Kapalı Depolama" },
      { id: "antrepo-gumruklu", label: "Antrepo (Gümrüklü)" },
      { id: "gecici-depolama", label: "Geçici Depolama" },
      { id: "konteyner-depolama", label: "Konteyner Depolama" },
      { id: "dokme-yuk-depolama", label: "Dökme Yük Depolama" },
      { id: "proje-yuku-depolama", label: "Proje Yükü Depolama" },
      { id: "soguk-hava-depolama", label: "Soğuk Hava Depolama" },
      { id: "kimyasal-depolama", label: "Kimyasal Depolama" },
      { id: "tehlikeli-madde-depolama", label: "Tehlikeli Madde Depolama" },
    ],
  },
  {
    id: "diger-hizmetler",
    label: "Diğer Hizmetler",
    order: 7,
    categories: [
      { id: "personel-temini", label: "Personel Temini" },
      { id: "acil-operasyon-destegi", label: "Acil Operasyon Desteği" },
    ],
  },
  {
    id: "geri-donusum-hizmetleri",
    label: "Geri Dönüşüm & Hizmetleri",
    order: 8,
    categories: [{ id: "geri-donusum-atik-tahliye", label: "Geri Dönüşüm & Atık Tahliye" }],
  },
];

/** `RAW_SERVICE_CATEGORY_GROUPS`in `order` alanına göre BİR KEZ sıralanmış hâli — tüm tüketiciler (login-form.tsx, service-info-editor.tsx, job-request-form.tsx, job-edit-form.tsx, services-section.tsx, job-listing-filters.ts) doğrudan bu diziyi okur, hiçbiri kendi sıralamasını yapmaz. */
export const SERVICE_CATEGORY_GROUPS: ServiceCategoryGroup[] = [...RAW_SERVICE_CATEGORY_GROUPS].sort(
  (a, b) => a.order - b.order,
);

/**
 * Kataloktan TAMAMEN kaldırılmış eski kategori id'leri — bir `Job`/
 * `ProviderProfile` kaydında bu id'lerden biri bulunursa (eski, kataloğun
 * bu değişiklikten önceki hâlinde oluşturulmuş kayıt) uygulama ÇÖKMEZ,
 * kayıt SİLİNMEZ; yalnızca `getCategoryDisplayLabel` bunun için özel bir
 * "Artık Kullanılmayan Hizmet" etiketi döner ve `resolveServiceCategoryId`
 * bunu geçersiz (null) sayarak ilan düzenlerken kullanıcının aktif bir
 * kategori seçmesini zorunlu kılar.
 */
export const REMOVED_CATEGORY_IDS: ReadonlySet<string> = new Set([
  "liman-personeli",
  "depo-personeli",
  "depo-duzenleme",
  "paletleme",
  "etiketleme",
  "sayim-hizmeti",
  "paletli-urun-depolama",
  "agir-yuk-depolama",
  "vardiyali-calisma",
  "proje-yuku",
  "konteyner-dolum-bosaltim",
]);

/** Bir kayıtta "Artık Kullanılmayan Hizmet" olarak gösterilecek kategori için güvenli, sahte-olmayan etiket. */
export const DEPRECATED_CATEGORY_LABEL = "Artık Kullanılmayan Hizmet";

/**
 * Birleştirme ÖNCESİ kullanılan tek-hizmetli eski id'lerden yeni birleşik
 * id'lere eşleme — TEK yer, `resolveServiceCategoryId` üzerinden hem
 * `Job.category` çözümüne (bkz. `resolveLegacyJobCategoryToId`) hem
 * `provider-services.ts`in okuma-anı normalizasyonuna hem
 * `migrateLegacyExpertiseToServiceCategoryIds`e beslenir — hiçbir dosya bu
 * altı id'yi kendi başına kopyalamaz.
 */
const MERGED_CATEGORY_ID_ALIASES: Readonly<Record<string, string>> = {
  lashing: "lashing-unlashing",
  unlashing: "lashing-unlashing",
  "konteyner-dolum": "konteyner-dolum-bosaltim",
  "konteyner-bosaltim": "konteyner-dolum-bosaltim",
  "yukleme-gozetimi": "gozetim-hizmetleri",
  "bosaltma-gozetimi": "gozetim-hizmetleri",
};

/**
 * Ham bir kategori id'sini (eski BİRLEŞTİRİLMİŞ id, güncel id, ya da
 * kaldırılmış/tanınmayan bir değer) güncel, geçerli bir katalog id'sine
 * çözer — TEK doğruluk kaynağı. Eski birleştirilmiş bir id ise yeni birleşik
 * id'yi döner (kullanıcıya asla fark ettirmeden); zaten geçerliyse olduğu
 * gibi döner; kaldırılmış ya da hiç tanınmayan bir değerse `null` döner
 * (çağıran taraf bunu "geçersiz/seçilmemiş" olarak ele alır). Eşlenen
 * (`aliased`) hedefin kendisi de `isServiceCategoryId` ile AYRICA doğrulanır
 * — bir birleştirme hedefi (bugün: yalnızca `konteyner-dolum-bosaltim`)
 * sonradan `REMOVED_CATEGORY_IDS`e taşınırsa, eski kısa alias'lardan
 * ("konteyner-dolum"/"konteyner-bosaltim") biri artık kataloğda olmayan bir
 * id'ye kör biçimde çözülmesin diye.
 */
export function resolveServiceCategoryId(rawId: string): string | null {
  const aliased = MERGED_CATEGORY_ID_ALIASES[rawId];
  if (aliased) return isServiceCategoryId(aliased) ? aliased : null;
  return isServiceCategoryId(rawId) ? rawId : null;
}

/**
 * Nakliye hizmet kategorisinin id'si — job-visibility.ts'teki Nakliye'ye özel
 * keşif izolasyonu kuralının (bkz. o dosyanın dokümantasyonu) tek referans
 * noktası. Diğer hiçbir dosya "nakliye" değerini elle yazmaz (magic string
 * yasak) — her zaman bu sabit üzerinden içe aktarılır.
 */
export const NAKLIYE_SERVICE_CATEGORY_ID = "nakliye";

/**
 * Gümrük Müşavirliği hizmet kategorisinin id'si — Nakliye ile AYNI iki merkezi
 * kurala tek referans noktası: (1) job-visibility.ts'teki keşif izolasyonu
 * (bkz. o dosyanın ISOLATED_SERVICE_CATEGORY_IDS listesi), (2) customs-license.ts'teki
 * "belge onaylanana kadar teklif veremez" kapısı. Diğer hiçbir dosya
 * "gumruk-musavirligi" değerini elle yazmaz (magic string yasak).
 */
export const GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID = "gumruk-musavirligi";

/**
 * Geri Dönüşüm & Atık Tahliye hizmet kategorisinin id'si — Nakliye/Gümrük
 * Müşavirliği ile AYNI ilke: diğer hiçbir dosya "geri-donusum-atik-tahliye"
 * değerini elle yazmaz (magic string yasak), her zaman bu sabit üzerinden
 * içe aktarılır (bkz. recycling-catalog.ts#isRecyclingCategory). Bu kategori
 * yetkilendirme/görünürlük açısından İZOLE DEĞİLDİR — 0038'den beri HER
 * kategori zaten admin onaylı `provider_service_authorizations` olmadan
 * görünmez/teklif alamaz, bu yüzden ayrı bir izolasyon kuralına gerek yok.
 */
export const RECYCLING_SERVICE_CATEGORY_ID = "geri-donusum-atik-tahliye";

/**
 * "Depo Hizmetleri" grubunun sabit id'si — bu grubun (bugün 12 alt kategori:
 * Elleçleme, Genel/Açık Saha/Kapalı/Antrepo (Gümrüklü)/Geçici/Konteyner/
 * Dökme Yük/Proje Yükü/Soğuk Hava/Kimyasal/Tehlikeli Madde Depolama) TEK
 * ortak referans noktası. "Depolama ilan oluşturma/admin/detay" görev
 * talimatı BİLEREK kategori adlarını tek tek yazmak yerine bu grup/hiyerarşi
 * kimliğini kullanmayı zorunlu kılar — böylece gruba gelecekte eklenecek
 * yeni bir alt kategori de otomatik olarak aynı kurala tabi olur.
 */
export const STORAGE_SERVICE_GROUP_ID = "depo-hizmetleri";

/** Bkz. STORAGE_SERVICE_GROUP_ID — o gruba ait TÜM alt kategori id'leri, sıralı. Grup bulunamazsa (olmamalı) boş dizi döner. */
export function getStorageGroupCategoryIds(): string[] {
  return SERVICE_CATEGORY_GROUPS.find((group) => group.id === STORAGE_SERVICE_GROUP_ID)?.categories.map(
    (category) => category.id,
  ) ?? [];
}

/**
 * Bir kategori id'sinin "Depo Hizmetleri" grubunun (bkz. STORAGE_SERVICE_
 * GROUP_ID) bir üyesi olup olmadığının TEK doğruluk kaynağı — Depolama'ya
 * özel HER davranışın (ürün bilgisi bölümü/otomatik süre/"Depolama Talebi"
 * kartı/sadeleştirilmiş konum/fotoğraf başlığı) tek gate'i budur. Metin/
 * başlık eşleştirmesi KESİNLİKLE kullanılmaz (bkz. product-catalog.ts'in
 * AYNI ilkesi) — yalnızca katalog id'si.
 *
 * TARİHÇE: bu kontrol eskiden yalnızca 2 alt kategoriyi (Kapalı Depolama,
 * Açık Saha Depolama — konum sadeleştirmesi kapsamında) kapsayan sabit bir
 * `STORAGE_LOCATION_ONLY_CATEGORY_IDS` kümesine dayanıyordu. Görev talimatı
 * ("Depo Hizmetleri grubunun TAMAMI, kategori adlarını tek tek yazmadan")
 * bunu 12 üyenin TAMAMINA genişletti — bu, o 2 kategori DIŞINDAKİ 10
 * kategorinin (Elleçleme, Antrepo Gümrüklü, Geçici/Konteyner/Dökme Yük/
 * Proje Yükü/Soğuk Hava/Kimyasal/Tehlikeli Madde Depolama, Genel Depolama)
 * konum gösterimini de (tesis/açık adres artık gizli, yalnızca İl/İlçe)
 * DEĞİŞTİREN BİLİNÇLİ bir karardır — kullanıcı onayıyla alınmıştır.
 */
export function isStorageGroupCategory(categoryId: string): boolean {
  return getStorageGroupCategoryIds().includes(categoryId);
}

/** Konum sadeleştirmesi (yalnızca İl/İlçe, bkz. job-location.ts#isSimplifiedLocationCategory) artık TÜM Depo Hizmetleri grubuna uygulanır — bkz. isStorageGroupCategory üstündeki "TARİHÇE" notu. */
export function isStorageOnlyLocationCategory(categoryId: string): boolean {
  return isStorageGroupCategory(categoryId);
}

/**
 * BELGE/YETKİ SADELEŞTİRMESİ — "Provider Authorization Group" kavramı, ilan
 * taksonomisinden (SERVICE_CATEGORY_GROUPS, yukarıda) TAMAMEN AYRI, İKİNCİ
 * bir katman: Hizmet Alan hâlâ 20 alt kategoriye ayrı ayrı ilan açabilir
 * (hiçbiri birleştirilmedi/kaldırılmadı) — yalnızca bir Hizmet Veren'in
 * /panel/belge-yukleme'de kaç AYRI belge yüklemesi gerektiği sadeleşiyor.
 * Her grup TEK bir `provider_documents.document_type` değerine karşılık
 * gelir (Gümrük Müşavirliği'nin CUSTOMS_LICENSE_DOCUMENT_TYPE'ı ile AYNI,
 * zaten var olan desen — ikinci bir yetkilendirme sistemi İCAT EDİLMEDİ):
 * bu TEK belge onaylandığında `review_provider_document` (0041'in otomatik
 * yetkilendirme zinciri, migration 0044'te genişletildi) `categoryIds`teki
 * HER kategori için mevcut `authorize_provider_service` RPC'sini (0038)
 * ayrı ayrı çağırır — `provider_service_authorizations` hâlâ TEK KAYNAK,
 * hâlâ kategori-bazlı satırlar, yalnızca tetikleyici tarafı gruplanmış.
 *
 * `categoryIds` burada KÖRLEMESİNE yazılmaz — ikisi de zaten var olan
 * `SERVICE_CATEGORY_GROUPS` girdilerinden TÜRETİLİR (depo için mevcut
 * `getStorageGroupCategoryIds()`, operatör/iş makinesi için `is-makinesi-
 * hizmetleri` + `operator-hizmetleri` gruplarının birleşimi) — TEK
 * doğruluk kaynağı budur, migration 0044'teki SQL bu id listesini AYNEN
 * (PL/pgSQL'in TypeScript'i içe aktaramaması nedeniyle) kopyalar; o dosyanın
 * kendi başlığı bu iki listenin burayla senkron tutulması gerektiğini not
 * eder.
 */
export type ProviderAuthorizationGroup = {
  id: string;
  label: string;
  /** Admin "Firma Belgeleri" ekranında bu belgenin onaylanmasının ne açacağını açıklayan tek cümle. */
  adminApprovalDescription: string;
  documentType: string;
  categoryIds: string[];
};

function findGroupCategoryIds(groupId: string): string[] {
  return SERVICE_CATEGORY_GROUPS.find((group) => group.id === groupId)?.categories.map((category) => category.id) ?? [];
}

export const PROVIDER_AUTHORIZATION_GROUPS: ProviderAuthorizationGroup[] = [
  {
    id: "operator-is-makinesi-yetkisi",
    label: "Operatör veya İş Makinesi Hizmeti Veriyorum",
    adminApprovalDescription: "Bu belge onaylandığında firmanın tüm iş makinesi ve operatör hizmet ilanlarına erişimi açılır.",
    documentType: "operator-is-makinesi-belgesi",
    categoryIds: [...findGroupCategoryIds("is-makinesi-hizmetleri"), ...findGroupCategoryIds("operator-hizmetleri")],
  },
  {
    id: "depo-hizmetleri-yetkisi",
    label: "Depo Hizmetleri Veriyorum",
    adminApprovalDescription: "Bu belge onaylandığında firmanın tüm Depo Hizmetleri ilanlarına erişimi açılır.",
    documentType: "depo-hizmetleri-belgesi",
    categoryIds: getStorageGroupCategoryIds(),
  },
];

/** Bir kategori id'si sadeleştirilmiş bir grubun parçasıysa o grubu döner — değilse (Liman Hizmetleri, Nakliye, Gümrük, Diğer Hizmetler'in tamamı dahil) `undefined`, bu kategoriler hâlâ TEK TEK belge/yetki gerektirir. */
export function findProviderAuthorizationGroupForCategory(categoryId: string): ProviderAuthorizationGroup | undefined {
  return PROVIDER_AUTHORIZATION_GROUPS.find((group) => group.categoryIds.includes(categoryId));
}

/** `document_type` değerinden grup tanımını bulur (belge onayı sonrası zincir, admin gösterimi, "zaten belgesi var" kontrolü için). */
export function getProviderAuthorizationGroupByDocumentType(documentType: string): ProviderAuthorizationGroup | undefined {
  return PROVIDER_AUTHORIZATION_GROUPS.find((group) => group.documentType === documentType);
}

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

export type ServiceCategoryWithGroup = ServiceCategory & { groupId: string; groupLabel: string };

/**
 * `SERVICE_CATEGORY_GROUPS`taki TÜM kategorileri tek, düz bir listede döner —
 * ana sayfadaki `services-section.tsx`in rol bazlı hizmet tanıtım/hızlı-erişim
 * bölümü BU fonksiyon üzerinden beslenir, kendi elle yazılmış bir listeyi
 * tutmaz. Bir kategori bu katalogdan kaldırılırsa (ya da yenisi eklenirse)
 * o bölüm bir sonraki render'da otomatik günceller — ayrıca bir "aktif/pasif"
 * bayrağı yoktur, katalogdaki varlığın kendisi "aktif" demektir. `id` zaten
 * grup çapında benzersizdir (bkz. `VALID_SERVICE_CATEGORY_IDS`) ama aynı
 * hizmetin iki kez listelenmesi ihtimaline karşı burada da bir `Set` ile
 * güvenceye alınır.
 */
export function getAllServiceCategories(): ServiceCategoryWithGroup[] {
  const seen = new Set<string>();
  const result: ServiceCategoryWithGroup[] = [];
  for (const group of SERVICE_CATEGORY_GROUPS) {
    for (const category of group.categories) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      result.push({ ...category, groupId: group.id, groupLabel: group.label });
    }
  }
  return result;
}

/**
 * Her katalog id'sinin `SERVICE_CATEGORY_GROUPS`taki (grup sırası, sonra grup
 * içi sıra) sabit konumu — bir kez hesaplanır, modül seviyesinde önbelleğe
 * alınır. Çoklu Hizmet Operasyonu listeleme özetinin (bkz.
 * job-listing-row.ts#OperationListingItem.services) hizmetleri "rastgele
 * sıralanmayacak, mevcut Service Catalog sırasına göre gösterilecek"
 * gereksinimi için TEK doğruluk kaynağıdır.
 */
const SERVICE_CATEGORY_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  SERVICE_CATEGORY_GROUPS.flatMap((group) => group.categories).map((category, index) => [category.id, index]),
);

/**
 * Bir kategori id'sinin katalogdaki sabit sırasındaki konumunu döner —
 * bilinmeyen/eski (legacy, ham Türkçe metin) bir değer için katalogdaki HİÇBİR
 * konumla çakışmayacak güvenli bir sonsuz-benzeri değer döner (listenin en
 * sonuna düşer), asla hata fırlatmaz veya sahte bir sıra uydurmaz.
 */
export function getServiceCategoryOrderIndex(id: string): number {
  return SERVICE_CATEGORY_ORDER_INDEX.get(id) ?? Number.MAX_SAFE_INTEGER;
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
  [LEGACY_LASHING]: ["lashing-unlashing"],
  [LEGACY_YUKLEME_BOSALTMA_GOZETIMI]: ["gozetim-hizmetleri"],
  [LEGACY_KONTEYNER_DOLUM]: ["konteyner-dolum-bosaltim"],
  [LEGACY_KONTEYNER_BOSALTIM]: ["konteyner-dolum-bosaltim"],
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
    const resolved = resolveServiceCategoryId(value);
    if (resolved) {
      ids.add(resolved);
      continue;
    }
    const mapped = LEGACY_CATEGORY_TO_SERVICE_IDS[value];
    mapped?.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

/**
 * `Job.category` (tekli seçim) için en iyi çaba ("best effort") migrasyonu
 * — `migrateLegacyExpertiseToServiceCategoryIds`in tekli karşılığıdır. Önce
 * `resolveServiceCategoryId` denenir (zaten geçerli bir id, ya da eski
 * BİRLEŞTİRİLMİŞ bir id — bkz. `MERGED_CATEGORY_ID_ALIASES` — ise onu
 * çözer); bulamazsa eski, ham Türkçe `jobs.ts#SERVICE_CATEGORIES` metnine
 * (`LEGACY_CATEGORY_TO_SERVICE_IDS`) bakılır — birden fazla yeni id'ye
 * karşılık gelen bir değerse eşlemedeki İLK id kullanılır (tek seçimlik bir
 * alan için makul bir varsayılan). Hiç eşleşme yoksa (ör. "Depolama", ya da
 * KALDIRILMIŞ bir kategori id'si — bkz. `REMOVED_CATEGORY_IDS`) `null`
 * döner — çağıran taraf (job-edit-form.tsx) bunu "kategori seçilmemiş" gibi
 * ele alır, kullanıcıyı yeni katalogdan geçerli bir kategori seçmeye
 * yönlendirir; ilanın kendi `category` alanı bu fonksiyon çağrılırken
 * DEĞİŞTİRİLMEZ. `LEGACY_CATEGORY_TO_SERVICE_IDS`teki eşlenmiş id de
 * (`resolveServiceCategoryId`in `aliased` dalıyla AYNI gerekçeyle)
 * `isServiceCategoryId` ile doğrulanır — eski ham Türkçe bir değer
 * (ör. "Konteyner Dolum") artık kataloğda olmayan bir hedefe eşleniyorsa
 * (bkz. `REMOVED_CATEGORY_IDS`) `null` döner, kör bir dangling id değil.
 */
export function resolveLegacyJobCategoryToId(rawCategory: string): string | null {
  const resolved = resolveServiceCategoryId(rawCategory);
  if (resolved) return resolved;
  const mapped = LEGACY_CATEGORY_TO_SERVICE_IDS[rawCategory]?.[0];
  return mapped && isServiceCategoryId(mapped) ? mapped : null;
}

/**
 * `Job.category`'nin GÜVENLİ görüntüleme etiketini üretir — hem yeni
 * (id tabanlı, eski BİRLEŞTİRİLMİŞ id dahil) hem eski (ham Türkçe metin)
 * kayıtlarla çalışır. `resolveServiceCategoryId` ile çözülebiliyorsa güncel
 * etiket gösterilir (eski "lashing" bir kayıt artık "Lashing / Unlashing"
 * gösterir — kullanıcı hiçbir fark görmez). Çözülemiyor ama bilinen bir
 * KALDIRILMIŞ id ise (bkz. `REMOVED_CATEGORY_IDS`) `DEPRECATED_CATEGORY_LABEL`
 * gösterilir. Hiçbiri değilse (eski ilanlarda olduğu gibi zaten okunabilir
 * bir Türkçe metin, ya da hiç tanınmayan bir değer) ham değer olduğu gibi
 * gösterilir — veri asla kaybolmaz/boş görünmez.
 */
export function getCategoryDisplayLabel(rawCategory: string): string {
  const resolved = resolveServiceCategoryId(rawCategory);
  if (resolved) return getServiceCategoryLabel(resolved) ?? resolved;
  if (REMOVED_CATEGORY_IDS.has(rawCategory)) return DEPRECATED_CATEGORY_LABEL;
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
 * yerden okuma yapmaz. `companyName` hem `StoredUser.companyName` (kayıt
 * anında girilen) hem `providerProfile.companyName` (Hesap Ayarları'ndan
 * sonradan girilen) olabileceği için çağıran taraf ikisinden hangisi
 * doluysa onu geçirir.
 *
 * DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi): eskiden
 * altıncı bir kriter olan "Hizmet Seçimi" (`serviceCategories.length > 0`)
 * buradan tamamen KALDIRILDI — Hizmet Veren artık kendi profilinden hizmet
 * seçemiyor (bkz. service-info-editor.tsx'in kendi başlık yorumu), bu
 * yüzden bu kart üzerinden asla etkilenemeyecek bir kritere göre yüzde
 * hesaplamak yanıltıcı olurdu. Kalan beş kriter (Firma Adı, Telefon,
 * E-posta, Çalışma Bölgeleri, Deneyim) eşit ağırlıklıdır.
 */
export function getProviderServiceInfoCompletion(input: {
  companyName: string | undefined;
  phone: string | undefined;
  email: string | undefined;
  regions: string[];
  experienceRange: ExperienceRange | undefined;
}): ServiceInfoCompletion {
  const checklist: ServiceInfoCompletionItem[] = [
    { label: "Firma Adı", met: Boolean(input.companyName?.trim()) },
    { label: "Telefon", met: Boolean(input.phone?.trim()) },
    { label: "E-posta", met: Boolean(input.email?.trim()) },
    { label: "Çalışma Bölgeleri", met: input.regions.length > 0 },
    { label: "Deneyim", met: input.experienceRange !== undefined },
  ];
  const metCount = checklist.filter((item) => item.met).length;
  const percent = Math.round((metCount / checklist.length) * 100);
  return { percent, checklist };
}
