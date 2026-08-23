/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — Depo Hizmetleri'nin
 * iki hazmat'a-özel alt kategorisi (`kimyasal-depolama`/`tehlikeli-madde-
 * depolama`, service-catalog.ts'in ZATEN var olan 12 üyesinden ikisi, YENİ
 * bir kategori DEĞİL) için TEK merkezi risk-grubu kataloğu.
 *
 * BİLEREK Nakliye ADR kataloğundan (storage-container-catalog.ts#
 * IMO_CLASS_OPTIONS) TAMAMEN AYRI: ADR karayolu TAŞIMACILIĞI sınıflandırmasıdır,
 * depolama uygunluğu ise deponun faaliyet kapsamına/izinlerine/ürünün
 * güvenlik bilgilerine bağlıdır (görev talimatının kendi kesin gerekçesi).
 * `adrHint` alanı YALNIZCA bilgilendirme amaçlıdır (görüntüleme, "bu risk
 * genellikle ADR X'e karşılık gelir" notu) — hiçbir otomatik eşleştirme/
 * yetkilendirme kararı bu alana dayanmaz (görev talimatı: "ADR numarası
 * eşleşti diye bir depocuyu otomatik uygun kabul etme").
 *
 * `id`ler kararlı, İngilizce-slug tarzı kod değerleridir — görünen Türkçe
 * etiketler ASLA veri anahtarı olarak kullanılmaz (görev talimatı).
 */

/** service-catalog.ts'in ZATEN var olan iki kategori id'si — storage-container-catalog.ts#STORAGE_CONTAINER_CATEGORY_ID İLE AYNI "sabit id sabiti" ilkesi. */
export const KIMYASAL_DEPOLAMA_CATEGORY_ID = "kimyasal-depolama";
export const TEHLIKELI_MADDE_DEPOLAMA_CATEGORY_ID = "tehlikeli-madde-depolama";

export function isKimyasalDepolamaCategory(categoryId: string | undefined | null): boolean {
  return categoryId === KIMYASAL_DEPOLAMA_CATEGORY_ID;
}
export function isTehlikeliMaddeDepolamaCategory(categoryId: string | undefined | null): boolean {
  return categoryId === TEHLIKELI_MADDE_DEPOLAMA_CATEGORY_ID;
}
/** Section 3/4'ün ORTAK "hazmat alanları bu kategoride mi gösteriliyor" gate'i — job-request-form.tsx/job-edit-form.tsx/admin-job-edit-form.tsx/job-detail-content.tsx/admin-job-detail.tsx TEK bu fonksiyonu çağırır. */
export function isHazardousStorageCategory(categoryId: string | undefined | null): boolean {
  return isKimyasalDepolamaCategory(categoryId) || isTehlikeliMaddeDepolamaCategory(categoryId);
}

export type StorageRiskGroupId =
  | "yanici-parlayici-sivilar"
  | "yanici-katilar"
  | "yanici-gazlar"
  | "basincli-gazlar"
  | "kendiliginden-yanabilen"
  | "suyla-temasinda-tehlikeli"
  | "oksitleyici-maddeler"
  | "organik-peroksitler"
  | "asindirici-asitler"
  | "asindirici-bazlar"
  | "diger-asindirici-reaktif"
  | "zehirli-akut-toksik"
  | "zararli-saglik-tehlikesi"
  | "cevreye-zararli"
  | "lityum-pil-batarya"
  | "patlayici-maddeler"
  | "bulasici-biyolojik"
  | "radyoaktif-maddeler";

export type StorageRiskGroupOption = {
  id: StorageRiskGroupId;
  label: string;
  /** Yalnızca bilgilendirme — bkz. bu dosyanın üstündeki doküman. Birden fazla ADR sınıfına karşılık gelebilecek riskler (ör. Patlayıcı Maddeler, 1.1–1.6) için `undefined` bırakılır, tek bir yanıltıcı kod SEÇİLMEZ. */
  adrHint?: string;
  /** Section 5: "özel izin gerektirir" — Patlayıcı/Bulaşıcı-Biyolojik/Radyoaktif. Yalnızca bilgilendirme amaçlı bir uyarı rozeti için; yetkilendirme kararını DEĞİŞTİRMEZ (admin onayı zaten tek karar noktasıdır). */
  requiresSpecialPermit?: boolean;
};

export type StorageRiskGroupCategory = {
  id: string;
  label: string;
  options: readonly StorageRiskGroupOption[];
};

export const STORAGE_RISK_GROUP_CATEGORIES: readonly StorageRiskGroupCategory[] = [
  {
    id: "fiziksel-yangin",
    label: "Fiziksel ve Yangın Riskleri",
    options: [
      { id: "yanici-parlayici-sivilar", label: "Yanıcı / Parlayıcı Sıvılar", adrHint: "3" },
      { id: "yanici-katilar", label: "Yanıcı Katılar", adrHint: "4.1" },
      { id: "yanici-gazlar", label: "Yanıcı Gazlar", adrHint: "2.1" },
      { id: "basincli-gazlar", label: "Basınçlı Gazlar", adrHint: "2.2" },
      { id: "kendiliginden-yanabilen", label: "Kendiliğinden Yanabilen veya Isınabilen Maddeler", adrHint: "4.2" },
      { id: "suyla-temasinda-tehlikeli", label: "Suyla Temasında Tehlikeli veya Yanıcı Gaz Çıkaran Maddeler", adrHint: "4.3" },
      { id: "oksitleyici-maddeler", label: "Oksitleyici Maddeler", adrHint: "5.1" },
      { id: "organik-peroksitler", label: "Organik Peroksitler", adrHint: "5.2" },
    ],
  },
  {
    id: "asindirici-reaktif",
    label: "Aşındırıcı ve Reaktif Maddeler",
    options: [
      { id: "asindirici-asitler", label: "Aşındırıcı Asitler", adrHint: "8" },
      { id: "asindirici-bazlar", label: "Aşındırıcı Bazlar", adrHint: "8" },
      { id: "diger-asindirici-reaktif", label: "Diğer Aşındırıcı veya Reaktif Maddeler", adrHint: "8" },
    ],
  },
  {
    id: "saglik-riskleri",
    label: "Sağlık Riskleri",
    options: [
      { id: "zehirli-akut-toksik", label: "Zehirli / Akut Toksik Maddeler", adrHint: "6.1" },
      { id: "zararli-saglik-tehlikesi", label: "Zararlı veya Ciddi Sağlık Tehlikesi Oluşturan Kimyasallar" },
    ],
  },
  {
    id: "cevresel-ozel",
    label: "Çevresel ve Özel Riskler",
    options: [
      { id: "cevreye-zararli", label: "Çevreye Zararlı Maddeler" },
      { id: "lityum-pil-batarya", label: "Lityum Pil / Batarya ve Benzeri Özel Ürünler", adrHint: "9" },
      { id: "patlayici-maddeler", label: "Patlayıcı Maddeler — Özel İzin Gerektirir", requiresSpecialPermit: true },
      { id: "bulasici-biyolojik", label: "Bulaşıcı / Biyolojik Riskli Maddeler — Özel İzin Gerektirir", adrHint: "6.2", requiresSpecialPermit: true },
      { id: "radyoaktif-maddeler", label: "Radyoaktif Maddeler — Özel İzin Gerektirir", adrHint: "7", requiresSpecialPermit: true },
    ],
  },
];

export const STORAGE_RISK_GROUP_OPTIONS: readonly StorageRiskGroupOption[] = STORAGE_RISK_GROUP_CATEGORIES.flatMap(
  (category) => category.options,
);

export function isStorageRiskGroupId(value: unknown): value is StorageRiskGroupId {
  return typeof value === "string" && STORAGE_RISK_GROUP_OPTIONS.some((option) => option.id === value);
}

export function getStorageRiskGroupOption(id: string | undefined): StorageRiskGroupOption | undefined {
  return STORAGE_RISK_GROUP_OPTIONS.find((option) => option.id === id);
}

export function getStorageRiskGroupLabel(id: string): string | undefined {
  return getStorageRiskGroupOption(id)?.label;
}

/**
 * job-store.ts#normalizeStoredJob (localStorage okuma) VE resolveStorageHazardFields
 * (yazma) TARAFINDAN paylaşılan TEK güvenli sanitizasyon — yalnızca TİP
 * güvenliği (DB'ye/localStorage'a asla yanlış tipte bir değer yazılmaz),
 * gerçek "en az bir grup seçilmeli mi" doğrulaması job-form-validation.ts'in
 * işidir. Tanınmayan bir id'yi (bilinçli değil, gerçek bir bozulma
 * durumunda) SESSİZCE ATLAR — storage-container-catalog.ts#sanitizeStorageContainerGroups
 * İLE AYNI "geçersiz elemanı atla, diziyi reddetme" ilkesi.
 */
export function sanitizeStorageRiskGroups(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((item): item is StorageRiskGroupId => isStorageRiskGroupId(item));
  return ids.length > 0 ? ids : undefined;
}

/** Birden fazla id'yi görüntüleme için "•" ile ayrılmış tek satıra çevirir — ham/tanınmayan bir id (kanıtsız silinmez) OLDUĞU GİBİ gösterilir. */
export function formatStorageRiskGroupsSummary(ids: readonly string[] | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  return ids.map((id) => getStorageRiskGroupLabel(id) ?? id).join(" • ");
}

/**
 * "Kimyasal Depolama" görevi — Depolanacak ürün tehlikeli madde kapsamında
 * mı? sorusu. Değer kümesi `storage-container-catalog.ts#YES_NO_OPTIONS`
 * İLE AYNI iki seçenek (Emin Değilim YOK) — ama görüntüleme SIRASI Nakliye
 * ADR toggle'ıyla (nakliye-transport-catalog.ts#CONTAINER_TOGGLE_OPTIONS)
 * AYNI, "Hayır" solda/varsayılan (görev talimatı: "Varsayılan seçim Hayır
 * olsun"). `isYesNoValue`/`yesNoToBoolean`/`booleanToYesNo` doğrudan yeniden
 * dışa aktarılır — ikinci bir kopya İCAT EDİLMEDİ.
 */
export const STORAGE_HAZARDOUS_TOGGLE_OPTIONS: readonly { id: "hayir" | "evet"; label: string }[] = [
  { id: "hayir", label: "Hayır" },
  { id: "evet", label: "Evet" },
];

export { isYesNoValue, yesNoToBoolean, booleanToYesNo } from "./storage-container-catalog";

/**
 * job-visibility.ts#resolveVisibility'nin Kimyasal Depolama/Tehlikeli Madde
 * Depolama dalı — storage-container-catalog.ts#isProviderEligibleForContainerJob
 * İLE AYNI rol, migration 0068'in `provider_can_view_job` SQL dalıyla ELLE
 * SENKRON tutulan istemci tarafı ayna (yalnızca UI'ı erken gizlemek için,
 * GERÇEK yetkilendirme sınırı her zaman RLS/RPC katmanıdır). FAIL-CLOSED:
 * `authorizedRiskGroupIds` boşsa ve job hazardous+risk-grubu gerektiriyorsa
 * `false` döner — storage_activity_scopes'un "null=SINIRSIZ" varsayılanından
 * KASITLI OLARAK FARKLI (bkz. migration 0068'in başlık dokümanı).
 */
export function isProviderEligibleForHazardousStorageJob(
  storageHazardous: boolean | undefined,
  storageRiskGroups: readonly string[] | undefined,
  authorizedRiskGroupIds: readonly string[],
): boolean {
  if (!storageHazardous || !storageRiskGroups || storageRiskGroups.length === 0) return true;
  return storageRiskGroups.every((riskGroupId) => authorizedRiskGroupIds.includes(riskGroupId));
}
