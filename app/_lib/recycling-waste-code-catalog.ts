/**
 * "Geri Dönüşüm & Atık Tahliye" ilan formunun resmî Atık Kodu kataloğu —
 * TEK merkezi doğruluk kaynağı, recycling-catalog.ts'in "Malzeme Kategorisi/
 * Alt Tür" (eski) alanlarından TAMAMEN AYRI, yeni bir dosya (o dosya
 * BÜYÜMESİN, iki kavram birbirine karışmasın diye).
 *
 * ============================================================================
 * VERİ KAYNAĞI — GERÇEK, DOĞRULANMIŞ, RESMÎ (görev talimatının kesin şartı:
 * "örnek veya uydurma kodlar gerçek kod gibi gösterilmemeli").
 * ============================================================================
 * Birincil kaynak: "Atık Yönetimi Yönetmeliği" (Resmî Gazete: 02.04.2015,
 * Sayı: 29314), EK-4 "ATIK LİSTESİ" — EK-4'ün kendisi 23.03.2017 tarih ve
 * 30016 sayılı Resmî Gazete ile değiştirilmiştir ("(Değişik:RG-23/3/2017-
 * 30016) EK-4") ve BU (yürürlükteki, en güncel) hâli kullanılmıştır. Metin,
 * T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın resmî "Sıfır
 * Atık" portalından (sifiratik.gov.tr) alınan PDF'ten çıkarılmış ve
 * mevzuat.gov.tr (MevzuatNo=20644) ile Lexpera'nın konsolide metniyle
 * çapraz doğrulanmıştır — ikisi de EK-4 için 23.03.2017 sonrası başka bir
 * değişiklik olmadığını teyit eder. AB'nin Avrupa Atık Kataloğu (Kod. Karar
 * 2000/532/EC, EUR-Lex konsolide metin 06.12.2023) ile de çapraz kontrol
 * edilmiştir — Türkiye listesi bu kodlar için AB listesinin BİREBİR (Türkçe)
 * çevirisidir, 2017 sonrası AB değişiklikleri bu 18 kategoriyi etkilemez.
 *
 * KAPSAM SINIRI (BİLEREK — görev talimatının kendi uyarısı: "kullanıcıyı
 * devasa, karışık ve düzensiz bir açılır menüyle karşı karşıya bırakma"):
 * EK-4'ün TAMAMI (20 bölüm, ~800 kod) DEĞİL, yalnızca aşağıdaki 18 atık
 * türü kovasına GERÇEKTEN ait, doğrulanmış ~70 kod içerir — her biri EK-4'ün
 * kendi bölüm/alt bölüm numarasıyla (ör. "15 01", "20 01") gruplanmıştır.
 * Bir kod BİRDEN FAZLA atık türü kovasına ait OLABİLİR (wasteTypeIds dizisi)
 * ama bu görev kapsamında rastlanan her kod yalnızca TEK bir türe en açık
 * şekilde karşılık geldiği için şimdilik hepsi tek elemanlı. Yıldızlı (*)
 * kodlar EK-1'in kendi tanımına göre TEHLİKELİ'dir — bu bilgi burada,
 * kodun kendisinde SABİT tutulur (kullanıcı asla değiştiremez, bkz.
 * job-request-form.tsx/recycling-fields.tsx'in bunu SALT OKUNUR göstermesi).
 * ============================================================================
 */

export type WasteTypeId =
  | "kagit-karton"
  | "plastik"
  | "metal-hurda"
  | "cam"
  | "ahsap"
  | "tekstil"
  | "elektronik-atik"
  | "pil-aku"
  | "atik-yag"
  | "bitkisel-atik-yagi"
  | "boya-vernik-solvent"
  | "kimyasal-atik"
  | "kimyasal-bulasmis-ambalaj"
  | "kontamine-bez-emici-malzeme"
  | "endustriyel-camur"
  | "lastik"
  | "insaat-yikim-atigi"
  | "organik-atik"
  | "diger";

export type WasteTypeOption = { id: WasteTypeId; label: string };

/** "B. ATIK TÜRÜ" — görev talimatının kendi 19 kalemlik listesi, sırası korunur (resmî kod sırası DEĞİL — bu ayrı bir seçim adımı). "diger" seçilirse serbest metin açıklaması istenir (recycling-fields.tsx). */
export const WASTE_TYPE_OPTIONS: readonly WasteTypeOption[] = [
  { id: "kagit-karton", label: "Kâğıt / Karton" },
  { id: "plastik", label: "Plastik" },
  { id: "metal-hurda", label: "Metal / Hurda" },
  { id: "cam", label: "Cam" },
  { id: "ahsap", label: "Ahşap" },
  { id: "tekstil", label: "Tekstil" },
  { id: "elektronik-atik", label: "Elektronik Atık" },
  { id: "pil-aku", label: "Pil / Akü" },
  { id: "atik-yag", label: "Atık Yağ" },
  { id: "bitkisel-atik-yagi", label: "Bitkisel Atık Yağ" },
  { id: "boya-vernik-solvent", label: "Boya / Vernik / Solvent" },
  { id: "kimyasal-atik", label: "Kimyasal Atık" },
  { id: "kimyasal-bulasmis-ambalaj", label: "Kimyasal Bulaşmış Ambalaj" },
  { id: "kontamine-bez-emici-malzeme", label: "Kontamine Bez / Emici Malzeme" },
  { id: "endustriyel-camur", label: "Endüstriyel Çamur" },
  { id: "lastik", label: "Lastik" },
  { id: "insaat-yikim-atigi", label: "İnşaat / Yıkım Atığı" },
  { id: "organik-atik", label: "Organik Atık" },
  { id: "diger", label: "Diğer" },
];

export function isWasteTypeId(value: unknown): value is WasteTypeId {
  return typeof value === "string" && WASTE_TYPE_OPTIONS.some((option) => option.id === value);
}

export function getWasteTypeLabel(id: string): string | undefined {
  return WASTE_TYPE_OPTIONS.find((option) => option.id === id)?.label;
}

export type WasteCodeEntry = {
  /** "15 01 10" biçiminde, boşluklu — EK-4'ün kendi gösterimiyle BİREBİR aynı (görüntülemede "15 01 10*" olarak yıldızla birleştirilir, bkz. formatWasteCodeForDisplay). */
  code: string;
  /** EK-4'ün kendi resmî Türkçe açıklaması — kısaltılmadan, uydurulmadan. */
  description: string;
  /** EK-1'in tanımına göre: yıldızlı kod = tehlikeli. Kullanıcı DEĞİŞTİREMEZ (bkz. görev bölüm D). */
  hazardous: boolean;
  /** Bu kodun ait olduğu EK-4 bölüm/alt bölümü (ör. "15 01") — grup başlığı için. */
  groupCode: string;
  groupLabel: string;
  /** Bu kodun "öne çıkarılacağı" atık türü/türleri (görev bölüm C: "seçilen atık türüne göre ilgili kodların öne çıkarılması mümkündür") — ASLA sert bir filtre değildir, bkz. getWasteCodeOptionsForType'ın kendi dokümanı. */
  wasteTypeIds: readonly WasteTypeId[];
};

/**
 * Resmî EK-4 bölüm/alt bölüm SIRASINA göre (görev talimatı: "resmî kod
 * sırasına göre ilerlemeli... alfabetik veya rastgele sıralanmamalı") —
 * bölüm numaraları artan sırada (02, 03, 04, 07, 08, 12, 13, 14, 15, 16, 17,
 * 19, 20), her bölüm içinde kodun kendisi artan sırada. Bu dizinin sırası
 * DEĞİŞTİRİLMEMELİDİR — WASTE_CODE_SELECT_ITEMS bu sıraya güvenir (bkz.
 * storage-container-catalog.ts#IMO_CLASS_SELECT_ITEMS İLE AYNI "tek geçişli,
 * sıra koruyan gruplama" ilkesi, Nakliye ADR sıralaması düzeltmesinden
 * ÖĞRENİLEN ders).
 */
export const WASTE_CODE_ENTRIES: readonly WasteCodeEntry[] = [
  { code: "02 01 03", description: "Bitki dokusu atıkları", hazardous: false, groupCode: "02 01", groupLabel: "02 01 — Tarım, Bahçıvanlık, Su Ürünleri Üretimi, Ormancılık, Avcılık ve Balıkçılıktan Kaynaklanan Atıklar", wasteTypeIds: ["organik-atik"] },
  { code: "02 01 06", description: "Ayrı toplanmış ve saha dışında işlem görecek hayvan dışkısı, idrar ve tezek (kirlenmiş toprak dahil), ayrı toplanmış ve saha dışında işlem gören sıvı atıklar", hazardous: false, groupCode: "02 01", groupLabel: "02 01 — Tarım, Bahçıvanlık, Su Ürünleri Üretimi, Ormancılık, Avcılık ve Balıkçılıktan Kaynaklanan Atıklar", wasteTypeIds: ["organik-atik"] },

  { code: "03 01 04", description: "Tehlikeli maddeler içeren talaş, yonga, kıymık, ahşap, kontraplak ve kaplamalar", hazardous: true, groupCode: "03 01", groupLabel: "03 01 — Ağaç İşlemeden ve Sunta ve Mobilya Üretiminden Kaynaklanan Atıklar", wasteTypeIds: ["ahsap"] },
  { code: "03 01 05", description: "03 01 04 dışındaki talaş, yonga, kıymık, ahşap, kontraplak ve kaplamalar", hazardous: false, groupCode: "03 01", groupLabel: "03 01 — Ağaç İşlemeden ve Sunta ve Mobilya Üretiminden Kaynaklanan Atıklar", wasteTypeIds: ["ahsap"] },

  { code: "03 03 08", description: "Geri dönüşüme gitmek üzere sınıflandırılan kağıt ve kartondan kaynaklanan atıklar", hazardous: false, groupCode: "03 03", groupLabel: "03 03 — Kağıt Hamuru, Kağıt ve Kartonun Üretim ve İşlenmesinden Kaynaklanan Atıklar", wasteTypeIds: ["kagit-karton"] },

  { code: "04 02 21", description: "İşlenmemiş tekstil elyafı atıkları", hazardous: false, groupCode: "04 02", groupLabel: "04 02 — Tekstil Endüstrisinden Kaynaklanan Atıklar", wasteTypeIds: ["tekstil"] },
  { code: "04 02 22", description: "İşlenmiş tekstil elyafı atıkları", hazardous: false, groupCode: "04 02", groupLabel: "04 02 — Tekstil Endüstrisinden Kaynaklanan Atıklar", wasteTypeIds: ["tekstil"] },

  { code: "07 02 13", description: "Atık plastik", hazardous: false, groupCode: "07 02", groupLabel: "07 02 — Plastik, Sentetik Kauçuk ve Yapay Elyafların İmalatı, Formülasyonu, Tedariki ve Kullanımından Kaynaklanan Atıklar", wasteTypeIds: ["plastik"] },

  { code: "08 01 11", description: "Organik çözücüler ya da diğer tehlikeli maddeler içeren atık boya ve vernikler", hazardous: true, groupCode: "08 01", groupLabel: "08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar", wasteTypeIds: ["boya-vernik-solvent"] },
  { code: "08 01 12", description: "08 01 11 dışındaki atık boya ve vernikler", hazardous: false, groupCode: "08 01", groupLabel: "08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar", wasteTypeIds: ["boya-vernik-solvent"] },
  { code: "08 01 13", description: "Organik çözücüler ya da diğer tehlikeli maddeler içeren boya ya da vernik çamurları", hazardous: true, groupCode: "08 01", groupLabel: "08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar", wasteTypeIds: ["boya-vernik-solvent"] },
  { code: "08 01 14", description: "08 01 13 dışındaki boya ya da vernik çamurları", hazardous: false, groupCode: "08 01", groupLabel: "08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar", wasteTypeIds: ["boya-vernik-solvent"] },

  { code: "12 01 01", description: "Demir metal çapakları ve talaşları", hazardous: false, groupCode: "12 01", groupLabel: "12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar", wasteTypeIds: ["metal-hurda"] },
  { code: "12 01 14", description: "Tehlikeli maddeler içeren işleme çamurları", hazardous: true, groupCode: "12 01", groupLabel: "12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar", wasteTypeIds: ["endustriyel-camur"] },
  { code: "12 01 15", description: "12 01 14 dışındaki işleme çamurları", hazardous: false, groupCode: "12 01", groupLabel: "12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar", wasteTypeIds: ["endustriyel-camur"] },

  { code: "13 01 10", description: "Mineral esaslı klor içermeyen hidrolik yağlar", hazardous: true, groupCode: "13 01", groupLabel: "13 01 — Atık Hidrolik Yağlar", wasteTypeIds: ["atik-yag"] },

  { code: "13 02 04", description: "Mineral esaslı klor içeren motor, şanzıman ve yağlama yağları", hazardous: true, groupCode: "13 02", groupLabel: "13 02 — Atık Motor, Şanzıman ve Yağlama Yağları", wasteTypeIds: ["atik-yag"] },
  { code: "13 02 05", description: "Mineral esaslı klor içermeyen motor, şanzıman ve yağlama yağları", hazardous: true, groupCode: "13 02", groupLabel: "13 02 — Atık Motor, Şanzıman ve Yağlama Yağları", wasteTypeIds: ["atik-yag"] },
  { code: "13 02 08", description: "Diğer motor, şanzıman ve yağlama yağları", hazardous: true, groupCode: "13 02", groupLabel: "13 02 — Atık Motor, Şanzıman ve Yağlama Yağları", wasteTypeIds: ["atik-yag"] },

  { code: "14 06 03", description: "Diğer çözücüler ve çözücü karışımları", hazardous: true, groupCode: "14 06", groupLabel: "14 06 — Atık Organik Çözücüler, Soğutucular ve Köpük/Aerosol İtici Gazlar", wasteTypeIds: ["boya-vernik-solvent"] },

  { code: "15 01 01", description: "Kağıt ve karton ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["kagit-karton"] },
  { code: "15 01 02", description: "Plastik ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["plastik"] },
  { code: "15 01 03", description: "Ahşap ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["ahsap"] },
  { code: "15 01 04", description: "Metalik ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["metal-hurda"] },
  { code: "15 01 07", description: "Cam ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["cam"] },
  { code: "15 01 09", description: "Tekstil ambalaj", hazardous: false, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["tekstil"] },
  { code: "15 01 10", description: "Tehlikeli maddelerin kalıntılarını içeren ya da tehlikeli maddelerle kontamine olmuş ambalajlar", hazardous: true, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["kimyasal-bulasmis-ambalaj"] },
  { code: "15 01 11", description: "Boş basınçlı konteynerler dahil, tehlikeli gözenekli katı yapı (örneğin asbest) içeren metalik ambalaj, boşaltıcı bir cihaz da içerebilir", hazardous: true, groupCode: "15 01", groupLabel: "15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)", wasteTypeIds: ["kimyasal-bulasmis-ambalaj"] },

  { code: "15 02 02", description: "Tehlikeli maddelerle kirlenmiş emiciler, filtre malzemeleri (başka bir şekilde tanımlanmamışsa yağ filtreleri), temizleme bezleri, koruyucu giysiler", hazardous: true, groupCode: "15 02", groupLabel: "15 02 — Emiciler, Filtre Malzemeleri, Temizleme Bezleri ve Koruyucu Giysiler", wasteTypeIds: ["kontamine-bez-emici-malzeme"] },
  { code: "15 02 03", description: "15 02 02 dışındaki emiciler, filtre malzemeleri, temizleme bezleri, koruyucu giysiler", hazardous: false, groupCode: "15 02", groupLabel: "15 02 — Emiciler, Filtre Malzemeleri, Temizleme Bezleri ve Koruyucu Giysiler", wasteTypeIds: ["kontamine-bez-emici-malzeme"] },

  { code: "16 01 03", description: "Ömrünü tamamlamış lastikler", hazardous: false, groupCode: "16 01", groupLabel: "16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar", wasteTypeIds: ["lastik"] },
  { code: "16 01 17", description: "Demir metaller", hazardous: false, groupCode: "16 01", groupLabel: "16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar", wasteTypeIds: ["metal-hurda"] },
  { code: "16 01 18", description: "Demir olmayan metaller", hazardous: false, groupCode: "16 01", groupLabel: "16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar", wasteTypeIds: ["metal-hurda"] },
  { code: "16 01 19", description: "Plastik", hazardous: false, groupCode: "16 01", groupLabel: "16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar", wasteTypeIds: ["plastik"] },
  { code: "16 01 20", description: "Cam", hazardous: false, groupCode: "16 01", groupLabel: "16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar", wasteTypeIds: ["cam"] },

  { code: "16 02 09", description: "PCB'ler içeren transformatörler ve kapasitörler", hazardous: true, groupCode: "16 02", groupLabel: "16 02 — Elektrikli ve Elektronik Ekipman Atıkları", wasteTypeIds: ["elektronik-atik"] },
  { code: "16 02 10", description: "16 02 09 dışındaki, PCB içeren ya da PCB ile kontamine olmuş ıskarta ekipmanlar", hazardous: true, groupCode: "16 02", groupLabel: "16 02 — Elektrikli ve Elektronik Ekipman Atıkları", wasteTypeIds: ["elektronik-atik"] },
  { code: "16 02 13", description: "16 02 09'dan 16 02 12'ye kadar olanların dışındaki tehlikeli parçalar içeren ıskarta ekipmanlar", hazardous: true, groupCode: "16 02", groupLabel: "16 02 — Elektrikli ve Elektronik Ekipman Atıkları", wasteTypeIds: ["elektronik-atik"] },
  { code: "16 02 14", description: "16 02 09'dan 16 02 13'e kadar olanların dışındaki ıskarta ekipmanlar", hazardous: false, groupCode: "16 02", groupLabel: "16 02 — Elektrikli ve Elektronik Ekipman Atıkları", wasteTypeIds: ["elektronik-atik"] },

  { code: "16 05 06", description: "Laboratuvar kimyasalları karışımları dahil, tehlikeli maddelerden oluşan ya da tehlikeli maddeler içeren laboratuvar kimyasalları", hazardous: true, groupCode: "16 05", groupLabel: "16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar", wasteTypeIds: ["kimyasal-atik"] },
  { code: "16 05 07", description: "Tehlikeli maddeler içeren ya da bunlardan oluşan ıskarta inorganik kimyasallar", hazardous: true, groupCode: "16 05", groupLabel: "16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar", wasteTypeIds: ["kimyasal-atik"] },
  { code: "16 05 08", description: "Tehlikeli maddeler içeren ya da bunlardan oluşan ıskarta organik kimyasallar", hazardous: true, groupCode: "16 05", groupLabel: "16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar", wasteTypeIds: ["kimyasal-atik"] },
  { code: "16 05 09", description: "16 05 06, 16 05 07 ya da 16 05 08 dışındaki ıskarta kimyasallar", hazardous: false, groupCode: "16 05", groupLabel: "16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar", wasteTypeIds: ["kimyasal-atik"] },

  { code: "16 06 01", description: "Kurşunlu piller ve akümülatörler", hazardous: true, groupCode: "16 06", groupLabel: "16 06 — Piller ve Akümülatörler", wasteTypeIds: ["pil-aku"] },
  { code: "16 06 02", description: "Nikel kadmiyum piller", hazardous: true, groupCode: "16 06", groupLabel: "16 06 — Piller ve Akümülatörler", wasteTypeIds: ["pil-aku"] },
  { code: "16 06 03", description: "Cıva içeren piller", hazardous: true, groupCode: "16 06", groupLabel: "16 06 — Piller ve Akümülatörler", wasteTypeIds: ["pil-aku"] },
  { code: "16 06 04", description: "Alkali piller (16 06 03 hariç)", hazardous: false, groupCode: "16 06", groupLabel: "16 06 — Piller ve Akümülatörler", wasteTypeIds: ["pil-aku"] },
  { code: "16 06 05", description: "Diğer piller ve akümülatörler", hazardous: false, groupCode: "16 06", groupLabel: "16 06 — Piller ve Akümülatörler", wasteTypeIds: ["pil-aku"] },

  { code: "17 01 01", description: "Beton", hazardous: false, groupCode: "17 01", groupLabel: "17 01 — Beton, Tuğla, Kiremit ve Seramik", wasteTypeIds: ["insaat-yikim-atigi"] },
  { code: "17 01 07", description: "17 01 06 dışındaki beton, tuğla, kiremit ve seramik karışımları ya da ayrılmış fraksiyonları", hazardous: false, groupCode: "17 01", groupLabel: "17 01 — Beton, Tuğla, Kiremit ve Seramik", wasteTypeIds: ["insaat-yikim-atigi"] },

  { code: "17 02 01", description: "Ahşap", hazardous: false, groupCode: "17 02", groupLabel: "17 02 — Ahşap, Cam ve Plastik", wasteTypeIds: ["ahsap"] },
  { code: "17 02 02", description: "Cam", hazardous: false, groupCode: "17 02", groupLabel: "17 02 — Ahşap, Cam ve Plastik", wasteTypeIds: ["cam"] },
  { code: "17 02 03", description: "Plastik", hazardous: false, groupCode: "17 02", groupLabel: "17 02 — Ahşap, Cam ve Plastik", wasteTypeIds: ["plastik"] },

  { code: "17 04 01", description: "Bakır, bronz, pirinç", hazardous: false, groupCode: "17 04", groupLabel: "17 04 — Metaller (Alaşımları Dahil)", wasteTypeIds: ["metal-hurda"] },
  { code: "17 04 05", description: "Demir ve çelik", hazardous: false, groupCode: "17 04", groupLabel: "17 04 — Metaller (Alaşımları Dahil)", wasteTypeIds: ["metal-hurda"] },
  { code: "17 04 09", description: "Tehlikeli maddelerle kontamine olmuş metal atıkları", hazardous: true, groupCode: "17 04", groupLabel: "17 04 — Metaller (Alaşımları Dahil)", wasteTypeIds: ["metal-hurda"] },

  { code: "17 06 05", description: "Asbest içeren inşaat malzemeleri", hazardous: true, groupCode: "17 06", groupLabel: "17 06 — Yalıtım Malzemeleri ve Asbest İçeren İnşaat Malzemeleri", wasteTypeIds: ["insaat-yikim-atigi"] },

  { code: "17 09 04", description: "17 09 01, 17 09 02 ve 17 09 03 dışındaki karışık inşaat ve yıkıntı atıkları", hazardous: false, groupCode: "17 09", groupLabel: "17 09 — Diğer İnşaat ve Yıkıntı Atıkları", wasteTypeIds: ["insaat-yikim-atigi"] },

  { code: "19 08 05", description: "Kentsel atıksuyun arıtılmasından kaynaklanan çamurlar", hazardous: false, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["endustriyel-camur"] },
  { code: "19 08 09", description: "Yağ ve su ayrışmasından kaynaklanan, sadece yenilebilir yağlar içeren yağ karışımları ve gres", hazardous: false, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["bitkisel-atik-yagi"] },
  { code: "19 08 11", description: "Endüstriyel atıksuyun biyolojik arıtılmasından kaynaklanan tehlikeli maddeler içeren çamurlar", hazardous: true, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["endustriyel-camur"] },
  { code: "19 08 12", description: "19 08 11 dışındaki, endüstriyel atıksuyun biyolojik arıtılmasından kaynaklanan çamurlar", hazardous: false, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["endustriyel-camur"] },
  { code: "19 08 13", description: "Endüstriyel atıksuyun diğer arıtılmasından kaynaklanan tehlikeli maddeler içeren çamurlar", hazardous: true, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["endustriyel-camur"] },
  { code: "19 08 14", description: "19 08 13 dışındaki, endüstriyel atıksuyun diğer arıtılmasından kaynaklanan çamurlar", hazardous: false, groupCode: "19 08", groupLabel: "19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["endustriyel-camur"] },

  { code: "19 12 01", description: "Kağıt ve karton", hazardous: false, groupCode: "19 12", groupLabel: "19 12 — Atıkların Mekanik Arıtımından (Örneğin Elle Ayırma, Kırma, Sıkıştırma, Pelet Yapma) Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)", wasteTypeIds: ["kagit-karton"] },

  { code: "20 01 01", description: "Kâğıt ve karton", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["kagit-karton"] },
  { code: "20 01 02", description: "Cam", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["cam"] },
  { code: "20 01 08", description: "Biyolojik olarak bozunabilir mutfak ve kantin atıkları", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["organik-atik"] },
  { code: "20 01 10", description: "Giysiler", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["tekstil"] },
  { code: "20 01 11", description: "Tekstil ürünleri", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["tekstil"] },
  { code: "20 01 13", description: "Çözücüler", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["boya-vernik-solvent"] },
  { code: "20 01 14", description: "Asitler", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["kimyasal-atik"] },
  { code: "20 01 15", description: "Alkalinler", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["kimyasal-atik"] },
  { code: "20 01 21", description: "Flüoresan lambalar ve diğer cıva içeren atıklar", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["elektronik-atik"] },
  { code: "20 01 25", description: "Yenilebilir sıvı ve katı yağlar", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["bitkisel-atik-yagi"] },
  { code: "20 01 26", description: "20 01 25 dışındaki sıvı ve katı yağlar", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["atik-yag"] },
  { code: "20 01 27", description: "Tehlikeli maddeler içeren boya, mürekkepler, yapıştırıcılar ve reçineler", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["boya-vernik-solvent"] },
  { code: "20 01 33", description: "16 06 01, 16 06 02 veya 16 06 03'ün altında geçen pil ve akümülatörler ve bu pilleri içeren sınıflandırılmamış karışık pil ve akümülatörler", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["pil-aku"] },
  { code: "20 01 34", description: "20 01 33 dışındaki pil ve akümülatörler", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["pil-aku"] },
  { code: "20 01 35", description: "20 01 21 ve 20 01 23 dışındaki, tehlikeli parçalar içeren ıskartaya çıkmış elektrikli ve elektronik ekipmanlar", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["elektronik-atik"] },
  { code: "20 01 36", description: "20 01 21, 20 01 23 ve 20 01 35 dışındaki ıskarta elektrikli ve elektronik ekipmanlar", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["elektronik-atik"] },
  { code: "20 01 37", description: "Tehlikeli maddeler içeren ahşap", hazardous: true, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["ahsap"] },
  { code: "20 01 38", description: "20 01 37 dışındaki ahşap", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["ahsap"] },
  { code: "20 01 39", description: "Plastikler", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["plastik"] },
  { code: "20 01 40", description: "Metaller", hazardous: false, groupCode: "20 01", groupLabel: "20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)", wasteTypeIds: ["metal-hurda"] },

  { code: "20 02 01", description: "Biyolojik olarak bozunabilir atıklar", hazardous: false, groupCode: "20 02", groupLabel: "20 02 — Bahçe ve Parklardan Kaynaklanan Atıklar (Mezarlıklardan Kaynaklanan Atıklar Dahil)", wasteTypeIds: ["organik-atik"] },
];

export function isWasteCode(value: unknown): value is string {
  return typeof value === "string" && WASTE_CODE_ENTRIES.some((entry) => entry.code === value);
}

export function getWasteCodeEntry(code: string | undefined | null): WasteCodeEntry | undefined {
  if (!code) return undefined;
  return WASTE_CODE_ENTRIES.find((entry) => entry.code === code);
}

/** "15 01 10*" biçiminde — tehlikeli bir kodun yıldızı burada, GÖRÜNTÜLEME anında eklenir (ham `code` alanında asla yıldız tutulmaz, veri/görünüm ayrımı). Tanınmayan bir kod OLDUĞU GİBİ (yıldızsız) döner, hiç uydurulmaz. */
export function formatWasteCodeForDisplay(code: string): string {
  const entry = getWasteCodeEntry(code);
  return entry?.hazardous ? `${code}*` : code;
}

/** "15 01 10* — Tehlikeli madde bulaşmış ambalajlar" biçiminde tam etiket — görev talimatının kendi örnek gösterimiyle BİREBİR aynı format. */
export function formatWasteCodeOptionLabel(entry: WasteCodeEntry): string {
  return `${formatWasteCodeForDisplay(entry.code)} — ${entry.description}`;
}

/**
 * Bir atık türü seçildiğinde "öne çıkarılacak" kodlar — SERT bir filtre
 * DEĞİLDİR (görev talimatının kesin şartı: "yanlış filtreleme nedeniyle
 * geçerli bir resmî kod kullanılamaz hale gelmemeli"). Seçici (recycling-
 * fields.tsx) HER ZAMAN TÜM WASTE_CODE_ENTRIES'i arama sonucunda gösterir;
 * bu fonksiyon yalnızca "type ile eşleşenler önce" sıralaması için kullanılır,
 * hiçbir kodu listeden ÇIKARMAZ.
 */
export function getRelevantWasteCodeCount(wasteTypeId: string): number {
  return WASTE_CODE_ENTRIES.filter((entry) => entry.wasteTypeIds.includes(wasteTypeId as WasteTypeId)).length;
}

/**
 * Aranabilir açılır menü için TEK geçişli, sıra-koruyan grup+öğe listesi —
 * storage-container-catalog.ts#IMO_CLASS_SELECT_ITEMS / nakliye-transport-
 * catalog.ts#ADR_HAZARD_CLASS_SELECT_ITEMS İLE BİREBİR AYNI desen (Nakliye
 * ADR sıralaması düzeltmesinden ÖĞRENİLEN ders: ÇİFT geçişli/filtrelemeli
 * bir gruplama kataloğu YENİDEN SIRALAR — burada TEK doğru desen baştan
 * kullanılır). Üst başlıklar (`kind: "group"`) SEÇİLEMEZ, yalnızca kod
 * öğeleri (`kind: "entry"`) seçilebilir.
 */
export const WASTE_CODE_SELECT_ITEMS: ({ kind: "group"; label: string; entries: WasteCodeEntry[] } | { kind: "entry"; entry: WasteCodeEntry })[] =
  (() => {
    const items: ({ kind: "group"; label: string; entries: WasteCodeEntry[] } | { kind: "entry"; entry: WasteCodeEntry })[] = [];
    for (const entry of WASTE_CODE_ENTRIES) {
      // IMO_CLASS_SELECT_ITEMS'ın (storage-container-catalog.ts) KENDİ
      // "grupsuz -> kind: 'entry'" kaçış kapısıyla AYNI — her WasteCodeEntry
      // GERÇEKTEN bir groupLabel taşıdığı için bugün pratikte hiç tetiklenmez,
      // ama tip imzasının vaat ettiği `kind: "entry"` dalını gerçekten
      // ÜRETMEYEN önceki sürüm gerçek bir bug'dı (bkz. bu dosyanın kendi
      // düzeltme notu, "recycling-fields.tsx"in tüketici tarafı).
      if (!entry.groupLabel) {
        items.push({ kind: "entry", entry });
        continue;
      }
      const lastItem = items[items.length - 1];
      if (lastItem?.kind === "group" && lastItem.label === entry.groupLabel) {
        lastItem.entries.push(entry);
      } else {
        items.push({ kind: "group", label: entry.groupLabel, entries: [entry] });
      }
    }
    return items;
  })();

/**
 * "D. TEHLİKE DURUMU" — TEK doğruluk kaynağı, kullanıcı ASLA değiştiremez
 * (görev talimatı: "Kullanıcı yıldızlı bir atığı manuel olarak 'tehlikesiz'
 * şeklinde değiştirememeli"). Tanınmayan/boş bir kod için `null` döner
 * ("atık kodunu bilmiyorum" durumu — bkz. RECYCLING_UNKNOWN_WASTE_CODE_VALUE)
 * — bu durumda tehlike durumu HİÇ gösterilmez/varsayılmaz, admin incelemesi
 * gerekir (görev bölüm C).
 */
export function deriveWasteCodeHazardous(code: string | undefined | null): boolean | null {
  const entry = getWasteCodeEntry(code);
  return entry ? entry.hazardous : null;
}

/** recycling-fields.tsx'in "Atık kodunu bilmiyorum" seçeneği için sentinel — gerçek bir kod DEĞİLDİR, WASTE_CODE_ENTRIES'te asla yer almaz. */
export const RECYCLING_UNKNOWN_WASTE_CODE_VALUE = "__bilinmiyor__";

/**
 * "E. TEHLİKELİ ATIK İÇİN EK BİLGİ" — "Atığın Tehlike Özelliği" çoklu
 * seçimi. storage-hazard-catalog.ts#StorageRiskGroupId İLE KARIŞTIRILMAZ
 * (görev talimatının kesin yasağı: "Depolama risk gruplarını olduğu gibi
 * atık sınıflandırması diye kopyalama") — TAMAMEN AYRI, bağımsız 6 kalemlik
 * bir katalog, sabit kodlarla (Türkçe etiket asla veri anahtarı değil).
 */
export type WasteHazardPropertyId = "yanici" | "asindirici" | "zehirli" | "oksitleyici" | "reaktif" | "cevreye-zararli";

export const WASTE_HAZARD_PROPERTY_OPTIONS: readonly { id: WasteHazardPropertyId; label: string }[] = [
  { id: "yanici", label: "Yanıcı" },
  { id: "asindirici", label: "Aşındırıcı" },
  { id: "zehirli", label: "Zehirli" },
  { id: "oksitleyici", label: "Oksitleyici" },
  { id: "reaktif", label: "Reaktif" },
  { id: "cevreye-zararli", label: "Çevreye Zararlı" },
];

export function isWasteHazardPropertyId(value: unknown): value is WasteHazardPropertyId {
  return typeof value === "string" && WASTE_HAZARD_PROPERTY_OPTIONS.some((option) => option.id === value);
}

export function getWasteHazardPropertyLabel(id: string): string | undefined {
  return WASTE_HAZARD_PROPERTY_OPTIONS.find((option) => option.id === id)?.label;
}

/**
 * "9. ÖZEL VE YÜKSEK RİSKLİ ATIKLAR" — genel depocu/atık yetkisi kapsamında
 * OTOMATİK açılmaması gereken, özel rejime tabi kodlar (görev talimatı:
 * "Tıbbi/enfeksiyöz atık, asbestli atık, patlayıcı nitelikli atık ve
 * benzeri... radyoaktif materyalleri genel kategoriye otomatik dahil
 * etme"). EK-4'teki karşılıkları: 18 01/18 02 (tıbbi atık, bu 18 kategorinin
 * DIŞINDA, hiç listelenmedi — MALSEVK kapsamı dışı), 17 06 05* (asbest,
 * yukarıda İnşaat/Yıkım altında GERÇEK bir kod olarak VAR). Bu fonksiyon,
 * böyle bir kodun genel faaliyet yetkisiyle DEĞİL, admin'in KENDİ AYRI
 * atık-kodu onayıyla eşleşmesi gerektiğini işaretler — provider_can_view_job
 * zaten HER kod için ayrı onay arar (bkz. migration, "genel firma
 * yetkisiyle eşleşme yapma" kuralı otomatik olarak sağlanır), bu fonksiyon
 * yalnızca ARAYÜZDE ekstra bir uyarı rozeti göstermek için kullanılır.
 */
export function requiresSpecialWasteCodeVerification(code: string | undefined | null): boolean {
  const entry = getWasteCodeEntry(code);
  return entry?.code === "17 06 05";
}
