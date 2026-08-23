import type { StorageContainerGroup } from "./types";
import { MANUAL_ENTRY_TEXT_MAX_LENGTH, MAX_CONTAINER_QUANTITY, MAX_STORAGE_CONTAINER_GROUPS, MAX_TONNAGE_TON } from "./field-limits";

/**
 * "Konteyner Grupları" — yalnızca hizmet türü "Konteyner Depolama"
 * (`konteyner-depolama`, service-catalog.ts'in "Depo Hizmetleri" grubunun
 * ZATEN var olan 12 üyesinden biri, YENİ bir kategori DEĞİL) seçildiğinde
 * gösterilen TEKRARLANABİLİR alan grubu — bir ilan, farklı ölçü/tip/yük
 * durumuna sahip birden fazla konteyner grubunu (ör. "20 adet 20 ft
 * Standart Boş" + "15 adet 40 ft High Cube Dolu") aynı anda taşıyabilir.
 *
 * TASARIM GEÇMİŞİ (bu modül üç kez yeniden tasarlandı, sırayla):
 *   1) Tekrarlanabilir satırlar + "kategori VE Depolanacak Ürün=Konteyner"
 *      tetiklemesi — gerçek kullanıcı testinde tetikleme hatası bulundu.
 *   2) Tek gruplu, düz 4-8 skaler alan, tetikleme YALNIZCA kategoriye bağlı
 *      — ama "Depolanacak Ürün Bilgileri" kartıyla MÜKERRER soru sorduğu
 *      (Miktar↔Konteyner Adedi, Ürün Cinsi↔Yük İçeriği) bulundu, o kart
 *      Konteyner Depolama'da gizlenip mevcut storageProductType/Quantity/
 *      Tonnage alanları relabel edilerek yeniden kullanıldı.
 *   3) GÜNCEL: tek ilanda BİRDEN FAZLA konteyner grubu gerekliliği —
 *      relabel edilmiş tekil storageProductType/Quantity/Tonnage artık
 *      YETERSİZ (N grup varken TEK değerli bir alan çalışmaz), bu yüzden
 *      "Depolanacak Ürün Bilgileri"nin relabel deneyi TERK EDİLDİ (kart
 *      Konteyner Depolama'da hâlâ gizli kalır, ama artık storageProductType/
 *      vb.'ni HİÇ kullanmaz — types.ts#Job.storageContainerGroups TEK,
 *      kendi kendine yeten veri kaynağıdır).
 *
 * Tetikleme kuralı YALNIZCA kategori id'sine bağlıdır — `isContainerStorageCategory`
 * TEK doğruluk kaynağıdır.
 */
export const STORAGE_CONTAINER_CATEGORY_ID = "konteyner-depolama";

export function isContainerStorageCategory(categoryId: string | undefined | null): boolean {
  return categoryId === STORAGE_CONTAINER_CATEGORY_ID;
}

export type StorageContainerSize = "20" | "40" | "45";
export const STORAGE_CONTAINER_SIZE_OPTIONS: readonly { id: StorageContainerSize; label: string }[] = [
  { id: "20", label: "20 ft" },
  { id: "40", label: "40 ft" },
  { id: "45", label: "45 ft" },
];
export function isStorageContainerSize(value: unknown): value is StorageContainerSize {
  return typeof value === "string" && STORAGE_CONTAINER_SIZE_OPTIONS.some((option) => option.id === value);
}
export function getStorageContainerSizeLabel(value: string): string | undefined {
  return STORAGE_CONTAINER_SIZE_OPTIONS.find((option) => option.id === value)?.label;
}

export type StorageContainerType = "standart" | "high-cube" | "reefer" | "open-top" | "tank";
export const STORAGE_CONTAINER_TYPE_OPTIONS: readonly { id: StorageContainerType; label: string }[] = [
  { id: "standart", label: "Standart" },
  { id: "high-cube", label: "High Cube" },
  { id: "reefer", label: "Reefer" },
  { id: "open-top", label: "Open Top" },
  { id: "tank", label: "Tank" },
];
export function isStorageContainerType(value: unknown): value is StorageContainerType {
  return typeof value === "string" && STORAGE_CONTAINER_TYPE_OPTIONS.some((option) => option.id === value);
}
export function getStorageContainerTypeLabel(value: string): string | undefined {
  return STORAGE_CONTAINER_TYPE_OPTIONS.find((option) => option.id === value)?.label;
}
/** Yalnızca Tip "reefer" iken Sıcaklık/Elektrik Bağlantısı alanları anlamlıdır — Dolu/Boş fark etmeksizin. */
export function isReeferContainerType(type: string | undefined): boolean {
  return type === "reefer";
}

export type StorageContainerStatus = "dolu" | "bos";
export const STORAGE_CONTAINER_STATUS_OPTIONS: readonly { id: StorageContainerStatus; label: string }[] = [
  { id: "dolu", label: "Dolu" },
  { id: "bos", label: "Boş" },
];
export function isStorageContainerStatus(value: unknown): value is StorageContainerStatus {
  return typeof value === "string" && STORAGE_CONTAINER_STATUS_OPTIONS.some((option) => option.id === value);
}
export function getStorageContainerStatusLabel(value: string): string | undefined {
  return STORAGE_CONTAINER_STATUS_OPTIONS.find((option) => option.id === value)?.label;
}
/**
 * Bir grubun Yük Durumu "dolu" DEĞİLSE Yük İçeriği/Brüt Ağırlık/Tehlikeli
 * Madde/UN/IMO'nun hiçbiri o grup için gösterilmez/anlamlı değildir. Reefer
 * sıcaklık/elektrik alanları BUNUN DIŞINDADIR — bkz. isReeferContainerType.
 */
export function isContainerLoadApplicable(status: string | undefined): boolean {
  return status === "dolu";
}

/** Tehlikeli Madde / Elektrik Bağlantısı Gerekiyor mu — AYNI iki seçenekli (Evet/Hayır) katalog, ikinci bir liste İCAT EDİLMEDİ. */
export const YES_NO_OPTIONS: readonly { id: "evet" | "hayir"; label: string }[] = [
  { id: "evet", label: "Evet" },
  { id: "hayir", label: "Hayır" },
];
export function isYesNoValue(value: unknown): value is "evet" | "hayir" {
  return value === "evet" || value === "hayir";
}
export function yesNoToBoolean(value: string): boolean | undefined {
  if (value === "evet") return true;
  if (value === "hayir") return false;
  return undefined;
}
export function booleanToYesNo(value: boolean | undefined): string {
  if (value === true) return "evet";
  if (value === false) return "hayir";
  return "";
}
/** Yalnızca Tehlikeli Madde "evet" iken UN Numarası/IMO Sınıfı anlamlıdır (VE Yük Durumu zaten "dolu" olmalıdır, bkz. isContainerLoadApplicable). */
export function isHazmatDetailApplicable(hazardousFormValue: string): boolean {
  return hazardousFormValue === "evet";
}

export const UN_NUMBER_MAX_LENGTH = 20;
export const CONTAINER_CONTENT_MAX_LENGTH = 300;

/**
 * IMO tehlike sınıfı — ARTIK serbest metin DEĞİL, yalnızca bu 20 kanonik
 * kodun biri (görev talimatı: "kullanıcı IMO sınıfını elle yazamasın").
 * `groupLabel` VARSA (Sınıf 1/2/4/5/6) seçenek bir `<optgroup>` İÇİNDE
 * gösterilir — ana başlık (ör. "Sınıf 1") kendisi SEÇİLEMEZ, yalnızca alt
 * sınıf seçilebilir; `groupLabel` YOKSA (Sınıf 3/7/8/9) doğrudan üst
 * seviyede seçilebilir TEK bir `<option>`dir — job-request-form.tsx#
 * SERVICE_CATEGORY_GROUPS'un `<select>`+`<optgroup>` deseniyle AYNI,
 * ikinci bir "gruplu seçim" bileşeni İCAT EDİLMEDİ (SearchableSelect
 * gruplamayı desteklemiyor, bu yüzden native `<select>` kullanılır).
 * Patlayıcılardaki `1.1A`/`1.1B` gibi UYUMLULUK GRUBU harfleri BİLEREK bu
 * listede YOK (görev talimatı: "bu görevde uyumluluk grubu alanı oluşturma").
 */
export type ImoClassCode =
  | "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "1.6"
  | "2.1" | "2.2" | "2.3"
  | "3"
  | "4.1" | "4.2" | "4.3"
  | "5.1" | "5.2"
  | "6.1" | "6.2"
  | "7"
  | "8"
  | "9";

export type ImoClassOption = { id: ImoClassCode; description: string; groupLabel?: string };

export const IMO_CLASS_OPTIONS: readonly ImoClassOption[] = [
  { id: "1.1", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Kütlesel patlama tehlikesi bulunan maddeler ve nesneler" },
  { id: "1.2", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Kütlesel patlama olmadan parça saçılma tehlikesi bulunan maddeler ve nesneler" },
  { id: "1.3", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Yangın tehlikesiyle birlikte düşük seviyeli patlama veya parça saçılma tehlikesi bulunan maddeler ve nesneler" },
  { id: "1.4", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Belirgin patlama tehlikesi bulunmayan maddeler ve nesneler" },
  { id: "1.5", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Kütlesel patlama tehlikesi bulunan ancak patlamaya karşı çok duyarsız maddeler" },
  { id: "1.6", groupLabel: "Sınıf 1 — Patlayıcı maddeler ve nesneler", description: "Kütlesel patlama tehlikesi bulunmayan, patlamaya karşı aşırı duyarsız nesneler" },
  { id: "2.1", groupLabel: "Sınıf 2 — Gazlar", description: "Yanıcı gazlar" },
  { id: "2.2", groupLabel: "Sınıf 2 — Gazlar", description: "Yanıcı olmayan ve zehirli olmayan gazlar" },
  { id: "2.3", groupLabel: "Sınıf 2 — Gazlar", description: "Zehirli gazlar" },
  { id: "3", description: "Yanıcı sıvılar" },
  { id: "4.1", groupLabel: "Sınıf 4 — Yanıcı katılar", description: "Yanıcı katılar, kendiliğinden tepkimeye giren maddeler ve duyarsızlaştırılmış patlayıcılar" },
  { id: "4.2", groupLabel: "Sınıf 4 — Yanıcı katılar", description: "Kendiliğinden yanmaya yatkın maddeler" },
  { id: "4.3", groupLabel: "Sınıf 4 — Yanıcı katılar", description: "Suyla temas ettiğinde yanıcı gaz çıkaran maddeler" },
  { id: "5.1", groupLabel: "Sınıf 5 — Oksitleyici maddeler ve organik peroksitler", description: "Oksitleyici maddeler" },
  { id: "5.2", groupLabel: "Sınıf 5 — Oksitleyici maddeler ve organik peroksitler", description: "Organik peroksitler" },
  { id: "6.1", groupLabel: "Sınıf 6 — Toksik ve bulaşıcı maddeler", description: "Zehirli maddeler" },
  { id: "6.2", groupLabel: "Sınıf 6 — Toksik ve bulaşıcı maddeler", description: "Bulaşıcı maddeler" },
  { id: "7", description: "Radyoaktif maddeler" },
  { id: "8", description: "Aşındırıcı maddeler" },
  { id: "9", description: "Diğer tehlikeli maddeler ve nesneler" },
];

export function isImoClassCode(value: unknown): value is ImoClassCode {
  return typeof value === "string" && IMO_CLASS_OPTIONS.some((option) => option.id === value);
}
export function getImoClassOption(code: string | undefined): ImoClassOption | undefined {
  return IMO_CLASS_OPTIONS.find((option) => option.id === code);
}
/** Dropdown'daki seçenek metni: "{kod} — {açıklama}" (grup başlığı burada TEKRARLANMAZ, `<optgroup label>` zaten gösteriyor). */
export function getImoClassOptionLabel(option: ImoClassOption): string {
  return `${option.id} — ${option.description}`;
}

/**
 * "ADR Sınıfı Sıralama Düzeltmesi" görevi — IMO/ADR sınıfı `<select>`
 * render sırasının TEK merkezi kaynağı. Kök neden: bazı çağıranlar (eski
 * nakliye-transport-fields.tsx#HazmatFields) `IMO_CLASS_OPTIONS`'u İKİ AYRI
 * geçişte render ediyordu — önce `groupLabel`i OLMAYAN seçenekler (3/7/8/9),
 * SONRA gruplu olanlar (`Array.from(new Set(...))` ile) — bu, katalogda
 * ZATEN doğru (1→9) olan sırayı render aşamasında BOZUYORDU (3/7/8/9 listenin
 * BAŞINA çıkıyordu). Bu fonksiyon `IMO_CLASS_OPTIONS`'u TEK bir geçişte,
 * dizinin KENDİ deklare edildiği (açıkça 1.1→9 kararlı) sırayla dolaşır —
 * alfabetik/metinsel bir sıralama ASLA uygulanmaz, yalnızca katalogdaki
 * konum kullanılır. Ardışık aynı `groupLabel`e sahip seçenekler tek bir
 * `{kind:"group"}` öğesinde toplanır (ana başlık kendisi SEÇİLEMEZ),
 * `groupLabel`i olmayanlar (3/7/8/9) `{kind:"single"}` olarak KENDİ doğru
 * konumlarında (yalnızca 2 ile 4 arasında, 9'dan sonra değil) kalır.
 * `storage-container-details-fields.tsx`teki (Konteyner Depolama IMO Sınıfı)
 * ÖNCEDEN VAR OLAN, DOĞRU ÇALIŞAN yerel kopyanın BİREBİR aynısıdır — TEK
 * merkezi kaynağa çıkarıldı, ikinci bir kopya artık YOK; hem Nakliye'nin ADR
 * Sınıfı hem Konteyner Depolama'nın IMO Sınıfı hem de bu görevle eklenen
 * her yeni ADR/IMO `<select>`i BUNU kullanır.
 */
export const IMO_CLASS_SELECT_ITEMS: ({ kind: "group"; label: string; options: ImoClassOption[] } | { kind: "single"; option: ImoClassOption })[] =
  (() => {
    const items: ({ kind: "group"; label: string; options: ImoClassOption[] } | { kind: "single"; option: ImoClassOption })[] = [];
    for (const option of IMO_CLASS_OPTIONS) {
      if (!option.groupLabel) {
        items.push({ kind: "single", option });
        continue;
      }
      const lastItem = items[items.length - 1];
      if (lastItem?.kind === "group" && lastItem.label === option.groupLabel) {
        lastItem.options.push(option);
      } else {
        items.push({ kind: "group", label: option.groupLabel, options: [option] });
      }
    }
    return items;
  })();

/**
 * Eski (serbest metin) bir IMO değerini kanonik koda çevirir — "IMO 3" →
 * "3", "Sınıf 3" → "3", "3.0" → "3", "2,1" → "2.1", "Sınıf 4.2" → "4.2".
 * Zaten kanonikse AYNEN döner. Tanınamayan bir değer için `null` döner —
 * ÇAĞIRAN TARAF bunu "sil" olarak yorumlamamalı, ham metni OLDUĞU GİBİ
 * göstermeye devam etmelidir (bkz. bu dosyanın en altındaki
 * `formatImoClassForDisplay` ve storage-container-details-fields.tsx#
 * toStorageContainerGroupFields — görev talimatı: "tanımlanamayan eski
 * değeri sessizce silme").
 */
export function canonicalizeImoClassCode(raw: string | undefined | null): ImoClassCode | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (isImoClassCode(trimmed)) return trimmed;
  const withoutPrefix = trimmed.replace(/^(imo|sınıf|sinif|class)\.?\s*/i, "").trim();
  const normalized = withoutPrefix.replace(",", ".").replace(/\.0$/, "");
  return isImoClassCode(normalized) ? normalized : null;
}

/**
 * Job detail ekranındaki tek satırlık gösterim metni — kanonik/kanonikleştirilebilir
 * bir değer için "{kod} – {açıklama}" (ör. "3 – Yanıcı Sıvılar"), aksi halde
 * eski ham değeri OLDUĞU GİBİ (veri kaybı YOK — görev talimatı: "ilan
 * detayında eski değer korunarak gösterilsin"). `raw` boşsa `undefined`.
 */
export function formatImoClassForDisplay(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const canonical = canonicalizeImoClassCode(raw);
  if (!canonical) return raw;
  const option = getImoClassOption(canonical);
  return option ? `${option.id} – ${option.description}` : raw;
}

/**
 * "Depocu Faaliyet Alanları" — Konteyner Depolama hizmet yetkisinin İNCE
 * TANELİ ayrıntıları (görev talimatı: "yeni ve bağımsız bir yetkilendirme
 * sistemi kurma... mevcut Depolama hizmet yetkisinin ayrıntıları olarak
 * çalışmalı"). `provider_documents.storage_activity_scopes` (belge
 * yüklerken TALEP edilen) ve `provider_service_authorizations.storage_
 * activity_scopes` (admin onayladıktan sonra FİİLEN verilen, kısmen
 * daraltılmış olabilir) sütunlarının TEK ortak değer kümesi — migration
 * 0059'daki SQL CHECK kısıtı bu listeyle ELLE senkron tutulur (PL/pgSQL
 * TypeScript'i içe aktaramaz, IMO_CLASS_OPTIONS için zaten kabul edilen
 * AYNI desen).
 */
export type StorageActivityScopeId =
  | "bos-konteyner-depolama"
  | "dolu-tehlikesiz-konteyner-depolama"
  | "reefer-konteyner-depolama"
  | "dolu-tehlikeli-konteyner-depolama";

export const STORAGE_ACTIVITY_SCOPE_OPTIONS: readonly { id: StorageActivityScopeId; label: string }[] = [
  { id: "bos-konteyner-depolama", label: "Boş Konteyner Depolama" },
  { id: "dolu-tehlikesiz-konteyner-depolama", label: "Dolu Tehlikesiz Konteyner Depolama" },
  { id: "reefer-konteyner-depolama", label: "Reefer Konteyner Depolama" },
  { id: "dolu-tehlikeli-konteyner-depolama", label: "Dolu Tehlikeli Konteyner Depolama" },
];

/** Yalnızca bu kapsam seçiliyken IMO sınıfı çoklu seçimi anlamlıdır/açılır. */
export const HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID: StorageActivityScopeId = "dolu-tehlikeli-konteyner-depolama";

export function isStorageActivityScopeId(value: unknown): value is StorageActivityScopeId {
  return typeof value === "string" && STORAGE_ACTIVITY_SCOPE_OPTIONS.some((option) => option.id === value);
}
export function getStorageActivityScopeLabel(id: string): string | undefined {
  return STORAGE_ACTIVITY_SCOPE_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * Bir provider'ın Konteyner Depolama için FİİLEN sahip olduğu yetki
 * ayrıntısı — `null` bir dizi ("kısıtlama kaydı yok") her zaman "SINIRSIZ"
 * (her şeyle eşleşir) anlamına gelir; bu, migration 0059'un geriye dönük
 * uyumluluk kararıdır: bu özellikten ÖNCE (ya da admin panelindeki eski
 * "Yetkilendir" butonuyla, kapsam seçmeden) verilmiş bir yetki asla sessizce
 * kısıtlanmaz/geçersiz hale gelmez — yalnızca belge tabanlı bir onay AÇIKÇA
 * dar bir dizi kaydettiğinde (boş dizi dahil) gerçek bir kısıtlama başlar.
 * Boş dizi (`[]`) ise "hiçbir kapsam/IMO onaylanmadı" anlamına gelir (tam
 * reddedilmiş bir belgeden kalan durum) — `null`la KARIŞTIRILMAMALI.
 */
export type ContainerStorageAuthorization = {
  scopes: string[] | null;
  imoClasses: string[] | null;
};

/**
 * TEK bir konteyner grubunun GEREKTİRDİĞİ faaliyet kapsamları + (varsa) IMO
 * sınıfı — Reefer EK bir gereksinimdir (kullanıcı onayıyla BİLEREK böyle):
 * Tip="reefer" olan bir grup, Boş/Dolu-Tehlikesiz/Dolu-Tehlikeli ekseninden
 * gelen gereksinimin YANINDA `reefer-konteyner-depolama`yı da gerektirir —
 * YERİNE değil (ör. Reefer+Dolu+Tehlikeli bir grup HEM Reefer HEM Dolu
 * Tehlikeli kapsamını + ilgili IMO sınıfını gerektirir). Bu fonksiyon
 * migration 0059'daki `public.container_group_required_scopes` SQL
 * fonksiyonuyla ELLE senkron tutulmalıdır (PL/pgSQL TypeScript'i içe
 * aktaramaz) — ikisi de görünürlük/teklif kararını AYNI şekilde vermelidir.
 */
export function getRequiredStorageActivityForGroup(group: {
  status?: string;
  type?: string;
  hazardous?: boolean;
  imoClass?: string;
}): { scopes: StorageActivityScopeId[]; imoClasses: ImoClassCode[] } {
  const scopes: StorageActivityScopeId[] = [];
  const imoClasses: ImoClassCode[] = [];

  if (group.status === "bos") {
    scopes.push("bos-konteyner-depolama");
  } else if (group.status === "dolu") {
    if (group.hazardous === true) {
      scopes.push("dolu-tehlikeli-konteyner-depolama");
      const canonical = canonicalizeImoClassCode(group.imoClass);
      if (canonical) imoClasses.push(canonical);
    } else {
      scopes.push("dolu-tehlikesiz-konteyner-depolama");
    }
  }
  if (group.type === "reefer") {
    scopes.push("reefer-konteyner-depolama");
  }

  return { scopes, imoClasses };
}

/** `getRequiredStorageActivityForGroup`in bir ilanın TÜM gruplarına yayılmış hâli — birleşim (dedup edilmiş), sıra önemsizdir (yalnızca üyelik kontrolü için kullanılır). */
export function getRequiredStorageActivityForJob(groups: readonly { status?: string; type?: string; hazardous?: boolean; imoClass?: string }[]): {
  scopes: StorageActivityScopeId[];
  imoClasses: ImoClassCode[];
} {
  const scopeSet = new Set<StorageActivityScopeId>();
  const imoSet = new Set<ImoClassCode>();
  for (const group of groups) {
    const required = getRequiredStorageActivityForGroup(group);
    for (const scope of required.scopes) scopeSet.add(scope);
    for (const imo of required.imoClasses) imoSet.add(imo);
  }
  return { scopes: [...scopeSet], imoClasses: [...imoSet] };
}

/**
 * Bir provider'ın, verilen konteyner gruplarının TAMAMININ gereksinimini
 * karşılayıp karşılamadığı — İLANDAKİ HER GRUP için AYRI AYRI kontrol
 * edilir (görev talimatı: "İlandaki bir konteyner grubunun gereksinimi bile
 * eksikse teklif oluşturma engellenmeli"), tek bir grup bile eksikse `false`
 * döner. `authorization` `null` (provider'ın konteyner-depolama için hiç
 * aktif yetkilendirmesi yoksa) her zaman `false` — bu fonksiyon YALNIZCA
 * kategori-seviyesi yetkilendirme ZATEN doğrulandıktan SONRA çağrılmalıdır
 * (bkz. job-visibility.ts#resolveVisibility, provider_can_view_job SQL
 * fonksiyonu İLE AYNI iki-aşamalı sıra).
 */
export function isProviderEligibleForContainerJob(
  groups: readonly { status?: string; type?: string; hazardous?: boolean; imoClass?: string }[] | undefined,
  authorization: ContainerStorageAuthorization | null,
): boolean {
  if (!authorization) return false;
  if (!groups || groups.length === 0) return true;

  for (const group of groups) {
    const required = getRequiredStorageActivityForGroup(group);
    if (authorization.scopes !== null) {
      for (const scope of required.scopes) {
        if (!authorization.scopes.includes(scope)) return false;
      }
    }
    if (required.imoClasses.length > 0 && authorization.imoClasses !== null) {
      for (const imo of required.imoClasses) {
        if (!authorization.imoClasses.includes(imo)) return false;
      }
    }
  }
  return true;
}

/** Bir grubun Konteyner Adedi — pozitif bir TAM SAYI olmalı (0/negatif/ondalıklı reddedilir), her grupta ZORUNLUDUR. */
export function parseContainerGroupQuantity(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

/**
 * İstenen Sıcaklık (°C) — reefer konteynerlerde sıkça eksi değerler
 * kullanıldığı için (ör. -18°C) işaretli (negatif olabilen) ondalıklı sayı
 * kabul eder — ikinci bir "sıcaklık" kataloğu/parseri başka hiçbir yerde
 * yok, bu TEK yer.
 */
export function parseReeferTemperature(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };
  if (!/^-?\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

/** Brüt Ağırlık (ton) — pozitif ondalıklı, product-catalog.ts#parseProductTonnage İLE AYNI kural (ikinci bir ayrıştırıcı İCAT EDİLMEDİ, yalnızca bu modülün kendi bağımsızlığı için burada da tanımlı). */
export function parseContainerGrossWeight(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

/**
 * TÜM grupların adetlerinin toplamı — görev tanımı: "toplam değer HİÇ ayrı
 * bir alan olarak saklanmaz/istemciden kabul edilmez, HER ZAMAN gruplardan
 * türetilir." Bu TEK fonksiyon hem istemci render'ında (canlı "Toplam
 * Konteyner: N Adet" göstergesi) hem sunucu tarafı okuma sonrası
 * gösterimde kullanılır — ikinci bir toplama mantığı İCAT EDİLMEZ.
 */
export function computeTotalContainerQuantity(groups: { quantity?: number }[]): number {
  return groups.reduce((sum, group) => sum + (typeof group.quantity === "number" && Number.isFinite(group.quantity) ? group.quantity : 0), 0);
}

/**
 * Tek bir grubun runtime tip koruması — `recyclingScopeOfWork`/
 * `customsRequestedServices` (dizi elemanları basit string) İLE AYNI
 * "eksikliği/bozukluğu hata sayma" ilkesi, ama her eleman NESNE olduğu için
 * alan bazında doğrulanır. Zorunlu dört alandan (quantity/size/type/status)
 * biri bile geçersizse TÜM grup atlanır (React key olarak kullanılan `id`
 * dahil, anlamsız bir grup gösterilemez); koşullu alanlar (content/
 * grossWeight/hazardous/unNumber/imoClass/reeferTemperature/
 * reeferElectrical) kendi koşuluna göre AYRICA süzülür — durumla/tiple
 * eşleşmeyen bir değer o TEK alanı yok sayar, grubun geri kalanını
 * etkilemez.
 */
export function sanitizeStorageContainerGroup(value: unknown): StorageContainerGroup | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  // "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: `quantity`nin
  // hiçbir üst sınırı yoktu, `grossWeight` pozitiflik dahi kontrol etmiyordu
  // (negatif bir ağırlık sessizce kabul ediliyordu) ve `content` (Yük İçeriği
  // serbest metni) hiçbir uzunluk sınırı olmadan doğrudan kabul ediliyordu.
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
  const quantity =
    typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && Number.isInteger(raw.quantity) && raw.quantity > 0 && raw.quantity <= MAX_CONTAINER_QUANTITY
      ? raw.quantity
      : undefined;
  const size = isStorageContainerSize(raw.size) ? raw.size : undefined;
  const type = isStorageContainerType(raw.type) ? raw.type : undefined;
  const status = isStorageContainerStatus(raw.status) ? raw.status : undefined;
  if (!id || quantity === undefined || !size || !type || !status) return null;

  const isLoaded = isContainerLoadApplicable(status);
  const isReefer = isReeferContainerType(type);
  const hazardous = isLoaded && typeof raw.hazardous === "boolean" ? raw.hazardous : undefined;

  return {
    id,
    quantity,
    size,
    type,
    status,
    content: isLoaded && typeof raw.content === "string" ? raw.content.trim().slice(0, MANUAL_ENTRY_TEXT_MAX_LENGTH) : undefined,
    grossWeight:
      isLoaded && typeof raw.grossWeight === "number" && Number.isFinite(raw.grossWeight) && raw.grossWeight > 0 && raw.grossWeight <= MAX_TONNAGE_TON
        ? raw.grossWeight
        : undefined,
    hazardous,
    unNumber: isLoaded && hazardous && typeof raw.unNumber === "string" ? raw.unNumber.trim().slice(0, UN_NUMBER_MAX_LENGTH) : undefined,
    imoClass: isLoaded && hazardous && typeof raw.imoClass === "string" ? raw.imoClass : undefined,
    // Reefer sıcaklığı — fiziksel olarak gerçekçi bir bant (-80°C ile +50°C
    // arası, gerçek reefer konteyner ekipmanının çok ötesinde cömert).
    reeferTemperature:
      isReefer && typeof raw.reeferTemperature === "number" && Number.isFinite(raw.reeferTemperature) && raw.reeferTemperature >= -80 && raw.reeferTemperature <= 50
        ? raw.reeferTemperature
        : undefined,
    reeferElectrical: isReefer && typeof raw.reeferElectrical === "boolean" ? raw.reeferElectrical : undefined,
  };
}

/**
 * `Job.storageContainerGroups`in TEK güvenli okuma yeri — bkz.
 * sanitizeStorageContainerGroup. Dizi hiç yoksa/bozuksa `undefined` döner.
 * "Aşılamaz Giriş Sınırları" görevi — bulunan gerçek açık: dizi uzunluğuna
 * hiçbir üst sınır YOKTU; `value.slice(0, MAX_STORAGE_CONTAINER_GROUPS)`
 * DB-yazma anındaki güvenlik ağıdır (UI'daki "+ Ekle" butonu zaten burada durur).
 */
export function sanitizeStorageContainerGroups(value: unknown): StorageContainerGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = value
    .slice(0, MAX_STORAGE_CONTAINER_GROUPS)
    .map(sanitizeStorageContainerGroup)
    .filter((group): group is StorageContainerGroup => group !== null);
  return groups.length > 0 ? groups : undefined;
}

/**
 * DEPRECATED alan grubundan (types.ts#Job.storageContainerSize/vb.'nin
 * kendi doküman notuna bkz.) TEK elemanlı bir grup dizisi türetir — "eski
 * tek gruplu ilanlar bozulmamalı" geriye dönük uyumluluk katmanı. `count`/
 * `content`/`grossWeight` BİLEREK job.storageProductQuantity/Type/Tonnage'tan
 * gelir (2. tasarımın "relabel edilmiş ortak alan" mirası) — bu üç alan da
 * yoksa (hiçbir eski veri kalmamışsa) senkron bir grup üretilmez.
 */
function legacyFlatFieldsToGroup(job: {
  storageContainerSize?: string;
  storageContainerType?: string;
  storageContainerStatus?: string;
  storageContainerHazardous?: boolean;
  storageContainerUnNumber?: string;
  storageContainerImoClass?: string;
  storageContainerReeferTemperature?: number;
  storageContainerReeferElectrical?: boolean;
  storageProductQuantity?: number;
  storageProductType?: string;
  storageProductTonnage?: number;
}): StorageContainerGroup | null {
  if (!job.storageContainerSize && !job.storageContainerType && !job.storageContainerStatus && job.storageProductQuantity === undefined) {
    return null;
  }
  return sanitizeStorageContainerGroup({
    id: "legacy-single-group",
    quantity: job.storageProductQuantity,
    size: job.storageContainerSize,
    type: job.storageContainerType,
    status: job.storageContainerStatus,
    content: job.storageProductType,
    grossWeight: job.storageProductTonnage,
    hazardous: job.storageContainerHazardous,
    unNumber: job.storageContainerUnNumber,
    imoClass: job.storageContainerImoClass,
    reeferTemperature: job.storageContainerReeferTemperature,
    reeferElectrical: job.storageContainerReeferElectrical,
  });
}

/**
 * Görüntüleme için TEK giriş noktası — `job.storageContainerGroups` doluysa
 * AYNEN döner; boşsa/yoksa DEPRECATED düz alanlardan (varsa) TEK elemanlı
 * bir dizi türetilir; o da yoksa boş dizi döner (çağıran taraf bölümü hiç
 * göstermez). Hiçbir çağıran `job.storageContainerGroups`i DOĞRUDAN
 * OKUMAMALI — her zaman bu fonksiyondan geçmeli, aksi halde eski tek gruplu
 * bir ilan sessizce boş görünür.
 */
export function normalizeStorageContainerGroupsForDisplay(job: {
  storageContainerGroups?: StorageContainerGroup[];
  storageContainerSize?: string;
  storageContainerType?: string;
  storageContainerStatus?: string;
  storageContainerHazardous?: boolean;
  storageContainerUnNumber?: string;
  storageContainerImoClass?: string;
  storageContainerReeferTemperature?: number;
  storageContainerReeferElectrical?: boolean;
  storageProductQuantity?: number;
  storageProductType?: string;
  storageProductTonnage?: number;
}): StorageContainerGroup[] {
  if (job.storageContainerGroups && job.storageContainerGroups.length > 0) return job.storageContainerGroups;
  const legacyGroup = legacyFlatFieldsToGroup(job);
  return legacyGroup ? [legacyGroup] : [];
}
