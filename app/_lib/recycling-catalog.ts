import { formatWasteCodeForDisplay, getWasteTypeLabel, isWasteTypeId } from "./recycling-waste-code-catalog";
import { RECYCLING_SERVICE_CATEGORY_ID } from "./service-catalog";

/**
 * Geri Dönüşüm & Atık Tahliye hizmetine ÖZEL alan grubu için TEK merkezi
 * katalog kaynağı — Malzeme Kategorisi/Alt Tür/Birim/Malzeme Durumu/Yükleme
 * Durumu listelerinin HİÇBİRİ başka bir dosyada (job-request-form.tsx,
 * job-edit-form.tsx, job-card.tsx, admin-job-detail.tsx) tekrar yazılmaz;
 * hepsi buradan içe aktarılır — `customs-brokerage-catalog.ts` ile BİREBİR
 * aynı rol/desen. Diğer hiçbir hizmet kategorisi bu dosyadan etkilenmez.
 *
 * KASITLI OLARAK YOK: bir "İşlem Türü" (hizmet satın alma / alım teklifi)
 * ayrımı. MALSEVK'in temel modeli her hizmette aynıdır — Hizmet Alan ihtiyacı
 * için ilan açar, yetkili Hizmet Veren normal MALSEVK hizmet teklifi verir
 * (bkz. offers.ts, bu kategori için HİÇ değiştirilmedi). Geri dönüşüm bu
 * modelin dışına çıkmaz; bir alım-satım/ters-teklif kavramı bilerek
 * eklenmemiştir.
 */

export type RecyclingMaterialSubtype = { id: string; label: string };
export type RecyclingMaterialCategory = {
  id: string;
  label: string;
  subtypes: RecyclingMaterialSubtype[];
};

/**
 * "Malzeme Kategorisi" → "Alt Tür" — ilk sürümde desteklenen 7 kategori.
 * Her kategorinin kendi "Diğer" alt türü zaten listenin içinde — ayrı bir
 * serbest-metin sentinel'i (product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE
 * deseni) BİLEREK kullanılmadı, çünkü görev tanımı yalnızca Malzeme
 * Durumu'nun "Diğer"i için açıklama alanı istiyor (aşağıda).
 */
export const RECYCLING_MATERIAL_CATEGORIES: readonly RecyclingMaterialCategory[] = [
  {
    id: "metal-hurda",
    label: "Metal Hurda",
    subtypes: [
      { id: "demir-celik", label: "Demir / Çelik" },
      { id: "paslanmaz", label: "Paslanmaz" },
      { id: "aluminyum", label: "Alüminyum" },
      { id: "bakir", label: "Bakır" },
      { id: "pirinc", label: "Pirinç" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "ahsap-palet",
    label: "Ahşap / Palet",
    subtypes: [
      { id: "saglam-ikinci-el-palet", label: "Sağlam ikinci el palet" },
      { id: "kirik-palet", label: "Kırık palet" },
      { id: "ahsap-kasa-sandik", label: "Ahşap kasa / sandık" },
      { id: "kereste-ahsap-artigi", label: "Kereste / ahşap artığı" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "plastik",
    label: "Plastik",
    subtypes: [
      { id: "pe", label: "PE" },
      { id: "pp", label: "PP" },
      { id: "pvc", label: "PVC" },
      { id: "plastik-kasa", label: "Plastik kasa" },
      { id: "ambalaj-plastigi", label: "Ambalaj plastiği" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "kagit-karton",
    label: "Kağıt / Karton",
    subtypes: [
      { id: "karton-koli", label: "Karton / koli" },
      { id: "kagit", label: "Kağıt" },
      { id: "oluklu-mukavva", label: "Oluklu mukavva" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "ambalaj-atiklari",
    label: "Ambalaj Atıkları",
    subtypes: [
      { id: "strec-film", label: "Streç film" },
      { id: "plastik-cember", label: "Plastik çember" },
      { id: "metal-cember", label: "Metal çember" },
      { id: "big-bag", label: "Big-bag" },
      { id: "temiz-varil", label: "Temiz varil" },
      { id: "temiz-ibc", label: "Temiz IBC" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "elektrik-elektronik",
    label: "Elektrik / Elektronik",
    subtypes: [
      { id: "kablo", label: "Kablo" },
      { id: "elektrik-motoru", label: "Elektrik motoru" },
      { id: "elektrik-panosu", label: "Elektrik panosu" },
      { id: "elektronik-ekipman", label: "Elektronik ekipman" },
      { id: "diger", label: "Diğer" },
    ],
  },
  {
    id: "makine-ekipman-hurdasi",
    label: "Makine / Ekipman Hurdası",
    subtypes: [
      { id: "makine-hurdasi", label: "Makine hurdası" },
      { id: "motor", label: "Motor" },
      { id: "reduktor", label: "Redüktör" },
      { id: "raf-konstruksiyon", label: "Raf / konstrüksiyon" },
      { id: "diger", label: "Diğer" },
    ],
  },
];

/** Bu ilan/hizmet kartının Geri Dönüşüm & Atık Tahliye alanlarını gösterip göstermeyeceğinin TEK doğruluk kaynağı. */
export function isRecyclingCategory(categoryId: string): boolean {
  return categoryId === RECYCLING_SERVICE_CATEGORY_ID;
}

export function isRecyclingMaterialCategoryId(value: unknown): value is string {
  return typeof value === "string" && RECYCLING_MATERIAL_CATEGORIES.some((category) => category.id === value);
}

export function getRecyclingMaterialCategoryLabel(id: string): string | undefined {
  return RECYCLING_MATERIAL_CATEGORIES.find((category) => category.id === id)?.label;
}

function findMaterialCategory(categoryId: string): RecyclingMaterialCategory | undefined {
  return RECYCLING_MATERIAL_CATEGORIES.find((category) => category.id === categoryId);
}

/** Bir alt tür id'sinin GERÇEKTEN verilen malzeme kategorisine ait olup olmadığını doğrular — kategoriler arası çapraz eşleşmeyi (ör. "Plastik" seçiliyken "Bakır" alt türü) engeller. */
export function isRecyclingMaterialSubtypeId(materialCategoryId: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  return findMaterialCategory(materialCategoryId)?.subtypes.some((subtype) => subtype.id === value) ?? false;
}

export function getRecyclingMaterialSubtypeLabel(materialCategoryId: string, subtypeId: string): string | undefined {
  return findMaterialCategory(materialCategoryId)?.subtypes.find((subtype) => subtype.id === subtypeId)?.label;
}

/**
 * "B. ATIK TÜRÜ" görüntüleme köprüsü — job-detail-content.tsx/admin-job-
 * detail.tsx/job-request-form.tsx'in (Operasyon Özeti) TEK ortak çağırdığı
 * fonksiyon. `Job.recyclingMaterialCategoryId` bu alandan SONRA oluşturulmuş
 * TÜM kayıtlarda recycling-waste-code-catalog.ts#WasteTypeId taşır (YENİ,
 * 19 kalemlik düz liste); bu alandan ÖNCE oluşturulmuş kayıtlar hâlâ bu
 * dosyanın ESKİ `RECYCLING_MATERIAL_CATEGORIES` ağacının id'sini taşır —
 * service-catalog.ts#getCategoryDisplayLabel İLE AYNI "önce yeni katalog,
 * sonra eski katalog" köprüleme ilkesi. Hiçbir eski kayıt migrate/silinmez,
 * yalnızca okuma anında doğru kataloktan çözülür.
 */
export function getRecyclingMaterialTypeLabel(id: string): string | undefined {
  return getWasteTypeLabel(id) ?? getRecyclingMaterialCategoryLabel(id);
}

/**
 * `getRecyclingMaterialTypeLabel` İLE AYNI köprüleme ilkesi — ikinci
 * ("Alt Tür") satırı için. YENİ şemada `recyclingMaterialSubtypeId` artık
 * bir alt tür id'si DEĞİL, yalnızca `recyclingMaterialCategoryId === "diger"`
 * iken doldurulan serbest metin açıklamasıdır (bkz. recycling-fields.tsx) —
 * bu yüzden yeni bir kayıtta "diger" DIŞINDA hiçbir zaman ikinci bir satır
 * göstermez (yeni 19 kalemlik listenin kendi alt türü yoktur). ESKİ bir
 * kayıtta (id ESKİ ağaçta çözülüyorsa) `subtypeId` hâlâ gerçek bir alt tür
 * id'sidir — `getRecyclingMaterialSubtypeLabel` ile ESKİ şekilde çözülür.
 */
export function getRecyclingMaterialTypeDetailLine(materialCategoryId: string, subtypeId: string | undefined): string | undefined {
  if (!subtypeId) return undefined;
  if (isWasteTypeId(materialCategoryId)) {
    return materialCategoryId === "diger" ? subtypeId.trim() || undefined : undefined;
  }
  return getRecyclingMaterialSubtypeLabel(materialCategoryId, subtypeId);
}

/**
 * DİKKAT — `isRecyclingUnit` bu dosyanın DIŞINDA (job-edit-form.tsx/
 * job-request-form.tsx) storage-product-fields.tsx'in KENDİ storageProductUnit
 * alanı için de fırsatçı bir genel "kg|ton|adet" tip-koruyucusu olarak
 * YENİDEN KULLANILIYOR (iki alanın değer kümesi eskiden birebir aynıydı).
 * Bu yüzden BURADA "litre" eklenerek GENİŞLETİLMEZ — bu, storage'ın kendi
 * alanına da sessizce "litre"yi sızdırırdı (gerçek tip denetimiyle bulunan
 * bir regresyon riski). `RecyclingUnit`/`WASTE_QUANTITY_UNIT_OPTIONS`/
 * `isWasteQuantityUnit` (aşağıda) YENİ, AYRI bir çift — yalnızca Geri
 * Dönüşüm'ün kendi Miktar alanı (recycling-fields.tsx, job-form-validation.ts#
 * validateRecyclingFields) bunları kullanır.
 */
export type RecyclingUnit = "kg" | "ton" | "adet" | "litre";

export const RECYCLING_UNIT_OPTIONS: readonly { id: "kg" | "ton" | "adet"; label: string }[] = [
  { id: "kg", label: "kg" },
  { id: "ton", label: "ton" },
  { id: "adet", label: "adet" },
];

export function isRecyclingUnit(value: unknown): value is "kg" | "ton" | "adet" {
  return typeof value === "string" && RECYCLING_UNIT_OPTIONS.some((option) => option.id === value);
}

export function getRecyclingUnitLabel(unit: string): string | undefined {
  return RECYCLING_UNIT_OPTIONS.find((option) => option.id === unit)?.label ?? WASTE_QUANTITY_UNIT_OPTIONS.find((option) => option.id === unit)?.label;
}

/**
 * "F. MİKTAR" — görev talimatı "Birim: kg, ton, adet, litre" der; storage-
 * product-fields.tsx'in (Depo Hizmetleri) RECYCLING_UNIT_OPTIONS'u KASITLI
 * OLARAK ETKİLENMEZ (3 birim, "litre" YOK) — bu yüzden Geri Dönüşüm'ün
 * kendi Miktar alanı için AYRI, 4 birimli bir liste (recycling-fields.tsx
 * yalnızca BUNU kullanır, storage-product-fields.tsx eskisi gibi kalır).
 */
export type WasteQuantityUnit = "kg" | "ton" | "adet" | "litre";

export const WASTE_QUANTITY_UNIT_OPTIONS: readonly { id: WasteQuantityUnit; label: string }[] = [
  { id: "kg", label: "kg" },
  { id: "ton", label: "ton" },
  { id: "adet", label: "adet" },
  { id: "litre", label: "litre" },
];

export function isWasteQuantityUnit(value: unknown): value is WasteQuantityUnit {
  return typeof value === "string" && WASTE_QUANTITY_UNIT_OPTIONS.some((option) => option.id === value);
}

export type RecyclingMaterialCondition = "ayristirilmis" | "karisik" | "diger";

export const RECYCLING_MATERIAL_CONDITION_OPTIONS: readonly { id: RecyclingMaterialCondition; label: string }[] = [
  { id: "ayristirilmis", label: "Ayrıştırılmış" },
  { id: "karisik", label: "Karışık" },
  { id: "diger", label: "Diğer" },
];

export function isRecyclingMaterialCondition(value: unknown): value is RecyclingMaterialCondition {
  return typeof value === "string" && RECYCLING_MATERIAL_CONDITION_OPTIONS.some((option) => option.id === value);
}

export function getRecyclingMaterialConditionLabel(condition: string): string | undefined {
  return RECYCLING_MATERIAL_CONDITION_OPTIONS.find((option) => option.id === condition)?.label;
}

/**
 * "Hizmet Kapsamı" — Geri Dönüşüm & Atık Tahliye ANAHTAR TESLİM, tek başına
 * tamamlanabilir bir hizmettir: Hizmet Veren'in kullandığı araç/kamyon/
 * forklift/vinç/personel/taşıma organizasyonu KENDİ operasyonel işidir, bu
 * çoklu seçim yalnızca "hizmet kapsamında neler bekleniyor" sorusunu
 * yanıtlar — hiçbir seçenek (özellikle "Araca Yükleme" ya da "Taşıma")
 * otomatik olarak ayrı bir Forklift/Vinç/Nakliye ilanı OLUŞTURMAZ; bunlar
 * yalnızca bu TEK hizmetin fiyatlandırılan kapsamının parçalarıdır (bkz.
 * types.ts#Job.recyclingScopeOfWork). Hizmet Alan isterse mevcut Çoklu
 * Hizmet Operasyonu'ndan bağımsız bir Nakliye/Forklift hizmeti AYRICA
 * ekleyebilir — bu iki mekanizma arasında hiçbir otomatik/zorunlu bağlantı
 * yoktur (bkz. job-request-form.tsx'in Taşıma+Nakliye bilgilendirme notu,
 * salt bilgilendirme — çoklu hizmet mimarisine ikinci bir kontrol katmanı
 * EKLEMEZ).
 *
 * SADELEŞTİRME (uncommitted, "Geri Dönüşüm Hizmet Kapsamı Sadeleştirmesi"
 * görevi): eski 4 seçenek — sahadan-toplama/yukleme/tesisten-tahliye/tasima —
 * yeni 4 BAĞIMSIZ işleme indirgendi. "Tesisten tahliye" TAMAMEN KALDIRILDI
 * (sahadan-toplama ve tasima ile anlam çakışması yaratıyordu, görev
 * tanımının kendi gerekçesi) — Development'ta GERÇEK kayıt kontrolü yapıldı
 * (doğrudan pg bağlantısı), hiçbir ilanda "tesisten-tahliye" kullanılmadığı
 * doğrulandı; yine de KANITSIZ bir topluca-dönüştürme YAPILMADI (görev
 * tanımının kendi yasağı) — bu id hâlâ `RETIRED_SCOPE_OF_WORK_LABELS`'ta
 * kendi ESKİ etiketiyle tanınır (varsa bir gün ortaya çıkarsa veri
 * kaybolmaz/"undefined" göstermez), yalnızca artık SEÇİLEBİLİR değildir.
 * "yukleme" ise görev tanımının kendi yönlendirdiği 1:1 anlamsal yeniden
 * adlandırmayla (`LEGACY_SCOPE_OF_WORK_ALIASES`) "araca-yukleme"ye eşlenir —
 * hem ETİKET aramasında (getRecyclingScopeOfWorkLabel, eski kayıtlar hâlâ
 * "Araca Yükleme" gösterir) hem form DÜZENLEME ekranlarının kendi state
 * başlangıcında (bkz. resolveRecyclingScopeOfWorkIds, admin-job-edit-form.tsx/
 * job-edit-form.tsx'in ikisi de bunu kullanır) — DB'deki ham veri asla
 * otomatik/toplu YENİDEN YAZILMAZ, yalnızca kullanıcı o alanı GERÇEKTEN
 * düzenleyip kaydederse yeni id'yle kaydedilir (yan etki, zorlama değil).
 * "Tüm Süreç" (recycling-fields.tsx) 5. bir DEĞER DEĞİLDİR — hiçbir zaman
 * kaydedilmez, yalnızca dört gerçek id'yi aynı anda seçip kaldıran bir UI
 * kısayoludur (bkz. o bileşenin kendi dokümanı).
 */
export type RecyclingScopeOfWorkId = "sahadan-toplama" | "araca-yukleme" | "tasima" | "tesise-teslim";

export const RECYCLING_SCOPE_OF_WORK_OPTIONS: readonly { id: RecyclingScopeOfWorkId; label: string; description: string }[] = [
  {
    id: "sahadan-toplama",
    label: "Sahadan Toplama",
    description: "Dağınık veya farklı noktalardaki malzemenin sahada bir araya getirilmesi.",
  },
  {
    id: "araca-yukleme",
    label: "Araca Yükleme",
    description: "Malzemenin personel, forklift, vinç veya uygun ekipmanla taşıma aracına yüklenmesi.",
  },
  {
    id: "tasima",
    label: "Taşıma",
    description: "Malzemenin mevcut sahadan hedef kabul tesisine nakledilmesi.",
  },
  {
    id: "tesise-teslim",
    label: "Tesise Teslim",
    description: "Malzemenin geri dönüşüm, bertaraf veya uygun kabul tesisine teslim edilmesi.",
  },
];

/** Yalnızca ARTIK GERÇEKTEN yeniden adlandırılmış id'ler — bkz. dosya başındaki dokümantasyon. "tesisten-tahliye" BİLEREK burada YOK (kanıtsız eşleme yasağı). */
const LEGACY_SCOPE_OF_WORK_ALIASES: Partial<Record<string, RecyclingScopeOfWorkId>> = {
  yukleme: "araca-yukleme",
};

/** Yalnızca ESKİ kayıtların ETİKET görüntülemesi için — artık hiçbir formda SEÇİLEBİLİR değil (RECYCLING_SCOPE_OF_WORK_OPTIONS'ta yok), isRecyclingScopeOfWorkId de bu id için `false` döner (yeni yazımlarda asla kabul edilmez). */
const RETIRED_SCOPE_OF_WORK_LABELS: Record<string, string> = {
  "tesisten-tahliye": "Tesisten Tahliye",
};

export const ALL_RECYCLING_SCOPE_OF_WORK_IDS: readonly RecyclingScopeOfWorkId[] = RECYCLING_SCOPE_OF_WORK_OPTIONS.map(
  (option) => option.id,
);

export function isRecyclingScopeOfWorkId(value: unknown): value is RecyclingScopeOfWorkId {
  return typeof value === "string" && RECYCLING_SCOPE_OF_WORK_OPTIONS.some((option) => option.id === value);
}

/**
 * Bir form state dizisindeki ESKİ id'leri (yalnızca "yukleme") yeni
 * karşılıklarına çevirir — DB'ye yazmadan ÖNCE (görüntüleme/düzenleme
 * state'i başlatılırken) çağrılır, ham stored veriyi ASLA geriye dönük
 * toplu olarak DEĞİŞTİRMEZ. Tanınmayan/eski-ama-eşlenmeyen id'ler ("tesisten-
 * tahliye" dahil) OLDUĞU GİBİ bırakılır — ne kaybolur ne zorla yeniden
 * yorumlanır.
 */
export function resolveRecyclingScopeOfWorkIds(ids: readonly string[]): string[] {
  return ids.map((id) => LEGACY_SCOPE_OF_WORK_ALIASES[id] ?? id);
}

export function getRecyclingScopeOfWorkLabel(id: string): string | undefined {
  const resolvedId = LEGACY_SCOPE_OF_WORK_ALIASES[id] ?? id;
  return (
    RECYCLING_SCOPE_OF_WORK_OPTIONS.find((option) => option.id === resolvedId)?.label ??
    RETIRED_SCOPE_OF_WORK_LABELS[id]
  );
}

/** Kayıtlı id dizisini (bkz. types.ts#Job.recyclingScopeOfWork), tanınmayan id'leri sessizce atlayarak görünen etiketlere çevirir — customs-brokerage-catalog.ts#getCustomsRequestedServiceLabels ile AYNI desen. Eski "yukleme"/"tesisten-tahliye" id'leri de (bkz. getRecyclingScopeOfWorkLabel) doğru etiketle gösterilir. */
export function getRecyclingScopeOfWorkLabels(ids: readonly string[]): string[] {
  return ids
    .map((id) => getRecyclingScopeOfWorkLabel(id))
    .filter((label): label is string => Boolean(label));
}

/**
 * "Tehlikeli ve özel mevzuata tabi atıklar şu anda MALSEVK kapsamında
 * değildir" ESKİ kısıtlaması — "MALSEVK'in Geri Dönüşüm & Atık Tahliye
 * Hizmetinin Uçtan Uca Geliştirilmesi" göreviyle KALDIRILDI: bu görev
 * tehlikeli atıkları GERÇEK bir tehlike-durumu/risk-özelliği/admin onay
 * mekanizmasıyla (bkz. recycling-waste-code-catalog.ts, provider_recycling_
 * authorizations) desteklenen hâle getiriyor — artık kapsam dışı değiller,
 * yalnızca EK yetkilendirme/doğrulama gerektiriyorlar. Sabit BİLEREK
 * KORUNDU (silinmedi) — eski, bu metni okuyan herhangi bir kod/test hâlâ
 * derlenir, ama artık hiçbir yerden İÇE AKTARILMAZ/gösterilmez.
 * @deprecated Bkz. yukarıdaki not — recycling-fields.tsx artık bunu göstermiyor.
 */
export const HAZARDOUS_WASTE_DISCLAIMER_TEXT =
  "Tehlikeli ve özel mevzuata tabi atıklar şu anda MALSEVK kapsamında değildir.";

/**
 * "A. TALEP EDİLEN İŞLEM" — atığın NİHAİ hukuki/çevresel akıbeti. Görev
 * talimatının kendi eşleme tablosu: her işlem, arka planda GEREKEN
 * faaliyet yetkisi/yetkilerine (RecyclingActivityId) çözümlenir — bu,
 * provider_recycling_authorizations'ın "activity" ekseninin TEK girdisidir
 * (bkz. getRequiredRecyclingActivitiesForOperation). "Hangi işlemler
 * hizmete dahil olsun?" (RECYCLING_SCOPE_OF_WORK_OPTIONS, yukarıda) İLE
 * KARIŞTIRILMAZ — o, SAHADAKİ FİZİKSEL ADIMLARI (toplama/yükleme/taşıma/
 * teslim) sorar ve DEĞİŞMEDİ; bu YENİ alan atığın NE OLACAĞINI sorar.
 */
export type RecyclingRequestedOperationId =
  | "atik-tahliyesi-tasima"
  | "geri-donusum-geri-kazanim"
  | "bertaraf"
  | "tahliye-geri-kazanim"
  | "tahliye-bertaraf";

export const RECYCLING_REQUESTED_OPERATION_OPTIONS: readonly { id: RecyclingRequestedOperationId; label: string }[] = [
  { id: "atik-tahliyesi-tasima", label: "Atık Tahliyesi / Taşıma" },
  { id: "geri-donusum-geri-kazanim", label: "Geri Dönüşüm / Geri Kazanım" },
  { id: "bertaraf", label: "Bertaraf" },
  { id: "tahliye-geri-kazanim", label: "Tahliye + Geri Kazanım" },
  { id: "tahliye-bertaraf", label: "Tahliye + Bertaraf" },
];

export function isRecyclingRequestedOperationId(value: unknown): value is RecyclingRequestedOperationId {
  return typeof value === "string" && RECYCLING_REQUESTED_OPERATION_OPTIONS.some((option) => option.id === value);
}

export function getRecyclingRequestedOperationLabel(id: string): string | undefined {
  return RECYCLING_REQUESTED_OPERATION_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * "2. HİZMET VEREN: BELGE YÜKLEME VE FAALİYET SEÇİMİ" — bir depocunun/geri
 * dönüşüm firmasının GERÇEKLEŞTİREBİLDİĞİNİ iddia ettiği (ve admin'in AYRI
 * AYRI onaylayabileceği) 3 temel faaliyet. RecyclingRequestedOperationId'nin
 * BİREBİR karşılığıdır — 5 işlem seçeneği bu 3 faaliyetin kombinasyonlarıdır.
 */
export type RecyclingActivityId = "tasima" | "geri-kazanim" | "bertaraf";

export const RECYCLING_ACTIVITY_OPTIONS: readonly { id: RecyclingActivityId; label: string }[] = [
  { id: "tasima", label: "Atık Taşıma / Tahliye" },
  { id: "geri-kazanim", label: "Geri Kazanım / Geri Dönüşüm" },
  { id: "bertaraf", label: "Bertaraf" },
];

export function isRecyclingActivityId(value: unknown): value is RecyclingActivityId {
  return typeof value === "string" && RECYCLING_ACTIVITY_OPTIONS.some((option) => option.id === value);
}

export function getRecyclingActivityLabel(id: string): string | undefined {
  return RECYCLING_ACTIVITY_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * "Talep Edilen İşlem" → gereken faaliyet(ler) — TEK doğruluk kaynağı,
 * hem istemci (job-visibility.ts) hem sunucu (migration'daki plpgsql eşleme,
 * ELLE senkron tutulur) tarafından kullanılır. Örnek (görev talimatının
 * kendi tablosu): "Tahliye + Geri Kazanım" -> [tasima, geri-kazanim] —
 * bir sağlayıcının HER İKİSİ için de aktif yetkisi olmalı, yalnızca biri
 * yetmez (görev bölüm 4 örnek B: "Yalnızca taşıma yetkisi olan firma bu
 * ilana teklif verememeli").
 */
export function getRequiredRecyclingActivities(operationId: string): readonly RecyclingActivityId[] {
  switch (operationId) {
    case "atik-tahliyesi-tasima":
      return ["tasima"];
    case "geri-donusum-geri-kazanim":
      return ["geri-kazanim"];
    case "bertaraf":
      return ["bertaraf"];
    case "tahliye-geri-kazanim":
      return ["tasima", "geri-kazanim"];
    case "tahliye-bertaraf":
      return ["tasima", "bertaraf"];
    default:
      return [];
  }
}

/**
 * "İlan Eşleştirmesi ve Teklif Yetkisi" (görev bölüm 4) — `storage-hazard-
 * catalog.ts#isProviderEligibleForHazardousStorageJob` İLE AYNI rol/desen,
 * job-visibility.ts#resolveVisibility'nin Geri Dönüşüm & Atık Tahliye
 * dalında kullanılır. FAIL-CLOSED (hazardous storage kontrolünün "tehlikeli
 * değilse true" varsayımından KASITLI OLARAK FARKLI): atık kodu bilinmiyorsa/
 * yoksa HER ZAMAN false (görev bölüm 1.C, "sistem otomatik eşleşme
 * açmasın"). Talep edilen işlemin gerektirdiği HER faaliyet
 * `authorizedActivityIds`'te olmalı VE ilanın kendi atık kodu
 * `authorizedWasteCodes`'ta olmalı — ikisi de BAĞIMSIZ, migration 0069'daki
 * `provider_can_view_job`'ın SQL karşılığıyla ELLE senkron tutulan AYNI
 * mantık (bkz. bu dosyanın üstündeki "MİMARİ SINIRLAMA" notu — gerçek sınır
 * her zaman RLS/RPC).
 */
export function isProviderEligibleForRecyclingJob(
  job: { recyclingRequestedOperation?: string; recyclingWasteCode?: string; recyclingWasteCodeUnknown?: boolean },
  authorizedActivityIds: readonly string[],
  authorizedWasteCodes: readonly string[],
): boolean {
  if (job.recyclingWasteCodeUnknown || !job.recyclingWasteCode) return false;
  const requiredActivities = getRequiredRecyclingActivities(job.recyclingRequestedOperation ?? "");
  if (!requiredActivities.every((activity) => authorizedActivityIds.includes(activity))) return false;
  return authorizedWasteCodes.includes(job.recyclingWasteCode);
}

const MAX_RECYCLING_QUANTITY = 999_999;

export type RecyclingQuantityParseError = "empty" | "invalid" | "not-positive" | "too-large";
export type RecyclingQuantityParseResult =
  | { ok: true; value: number }
  | { ok: false; error: RecyclingQuantityParseError };

/**
 * "Miktar" — ondalıklı sayı destekler (product-catalog.ts#parseProductTonnage
 * ile AYNI kural: virgül ya da nokta ayraç, en fazla 2 hane) — kg/ton/adet
 * hepsinde aynı basit kural uygulanır, birim bazlı ayrı bir doğrulama dalı
 * İCAT EDİLMEDİ.
 */
export function parseRecyclingQuantity(raw: string): RecyclingQuantityParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false, error: "invalid" };

  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_RECYCLING_QUANTITY) return { ok: false, error: "too-large" };

  return { ok: true, value };
}

/** Örnek: 8, "ton" -> "8 ton". */
export function formatRecyclingQuantity(value: number, unit: string): string {
  const unitLabel = getRecyclingUnitLabel(unit) ?? unit;
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value)} ${unitLabel}`;
}

/**
 * "Teklifin Ticari Yönü" — Geri dönüşüm hizmetinde para akışının yönü diğer
 * TÜM hizmetlerden (Hizmet Alan her zaman öder) farklı olabilir: Hizmet
 * Veren atık için bedel TEKLİF edebilir (atık satın alma) ya da hiç ödeme
 * olmayabilir (ücretsiz alım). Bkz. types.ts#Offer.commercialDirection'ın
 * kendi dokümanı — bu SALT ETİKET/GÖRÜNÜM amaçlıdır, mevcut ödeme
 * altyapısı/`amount` alanı/offer durum akışı DEĞİŞMEDİ.
 */
export type RecyclingCommercialDirection = "hizmet-bedeli" | "atik-satin-alma" | "ucretsiz-alim";

export const RECYCLING_COMMERCIAL_DIRECTION_OPTIONS: readonly {
  id: RecyclingCommercialDirection;
  label: string;
  description: string;
}[] = [
  { id: "hizmet-bedeli", label: "Hizmet Bedeli", description: "Atık sahibi (Hizmet Alan) hizmet bedelini öder." },
  { id: "atik-satin-alma", label: "Atık Satın Alma Teklifi", description: "Hizmet Veren, atık için bir bedel teklif eder." },
  { id: "ucretsiz-alim", label: "Ücretsiz Alım", description: "Herhangi bir ödeme yapılmaz." },
];

export function isRecyclingCommercialDirection(value: unknown): value is RecyclingCommercialDirection {
  return typeof value === "string" && RECYCLING_COMMERCIAL_DIRECTION_OPTIONS.some((option) => option.id === value);
}

export function getRecyclingCommercialDirectionLabel(id: string): string | undefined {
  return RECYCLING_COMMERCIAL_DIRECTION_OPTIONS.find((option) => option.id === id)?.label;
}

/** Teklif kartlarında/özetlerde gösterilecek tek satırlık etiket — "Hizmet Bedeli: 8.000 TL" / "Atık Satın Alma Teklifi: 12.000 TL" / "Ücretsiz Alım" (tutar hiç gösterilmez, her zaman 0'dır). */
export function formatRecyclingCommercialDirectionLabel(direction: string, formattedAmount: string): string {
  if (direction === "ucretsiz-alim") return "Ücretsiz Alım";
  const label = getRecyclingCommercialDirectionLabel(direction) ?? "Hizmet Bedeli";
  return `${label}: ${formattedAmount}`;
}

type JobRecyclingSummaryFields = {
  category: string;
  recyclingMaterialCategoryId?: string;
  recyclingMaterialSubtypeId?: string;
  recyclingQuantity?: number;
  recyclingUnit?: string;
  recyclingMaterialCondition?: string;
  recyclingWasteCode?: string;
  recyclingWasteCodeUnknown?: boolean;
  recyclingHazardous?: boolean;
};

/**
 * Kart/tablo gibi kompakt bağlamlar için tek satırlık özet —
 * product-catalog.ts#formatJobProductInfoLine'ın "•" ayraçlı birleştirme
 * kuralını izler. Kapsam dışı bir kategoride ya da bilgi hiç girilmemişse
 * `null` döner. `getRecyclingMaterialTypeLabel`/`getRecyclingMaterialTypeDetailLine`
 * KULLANIR (doğrudan eski `getRecyclingMaterialCategoryLabel`/
 * `getRecyclingMaterialSubtypeLabel` DEĞİL) — bkz. o iki fonksiyonun kendi
 * "önce yeni katalog, sonra eski katalog" köprüleme dokümanı; bu satır
 * `job-listing-row.ts` üzerinden Aktif İlanlar kart/tablo görünümünde
 * HERKESE (Hizmet Veren) görünür, bu yüzden yeni bir kayıtta boş/"-"
 * göstermemesi kritiktir.
 */
export function formatRecyclingSummaryLine(job: JobRecyclingSummaryFields): string | null {
  if (!isRecyclingCategory(job.category)) return null;
  const parts: string[] = [];
  if (job.recyclingMaterialCategoryId) {
    const categoryLabel = getRecyclingMaterialTypeLabel(job.recyclingMaterialCategoryId);
    const detailLine = getRecyclingMaterialTypeDetailLine(job.recyclingMaterialCategoryId, job.recyclingMaterialSubtypeId);
    parts.push(detailLine ? `${categoryLabel} — ${detailLine}` : categoryLabel ?? "");
  }
  if (job.recyclingWasteCodeUnknown) {
    parts.push("Atık kodu bilinmiyor");
  } else if (job.recyclingWasteCode) {
    parts.push(formatWasteCodeForDisplay(job.recyclingWasteCode));
    if (job.recyclingHazardous) parts.push("Tehlikeli Atık");
  }
  if (job.recyclingQuantity !== undefined && job.recyclingUnit) {
    parts.push(`Tahmini ${formatRecyclingQuantity(job.recyclingQuantity, job.recyclingUnit)}`);
  }
  if (job.recyclingMaterialCondition) {
    const conditionLabel = getRecyclingMaterialConditionLabel(job.recyclingMaterialCondition);
    if (conditionLabel) parts.push(conditionLabel);
  }
  return parts.filter(Boolean).length > 0 ? parts.filter(Boolean).join(" • ") : null;
}
