// OSM adaylarını MALSEVK lokasyon türlerine sınıflandırma ve alakasız
// sonuçları (spor kulübü, restoran, cadde, otobüs terminali, yat limanı,
// havalimanı vb.) eleme mantığı. Gerçek Overpass çıktısı incelenerek
// kalibre edilmiştir (bkz. rapor).

const INCLUDE_NAME_KEYWORDS = [
  /\bliman\b/i,
  /liman[ıi]$/i,
  /port$/i,
  /\bterminal(i|ı)?\b/i,
  /\bosb\b/i,
  /organize sanayi/i,
  /serbest b[öo]lge/i,
  /lojistik/i,
  /\btersane/i,
  /\bkonteyner\b/i,
  /\bro[\s-]?ro\b/i,
];

const EXCLUDE_NAME_KEYWORDS = [
  /\bsport/i,
  /\bspor\b/i,
  /pasaport/i,
  /kaporta/i,
  /pizza/i,
  /\bhotel\b/i,
  /\botel\b/i,
  /\bsite(si)?\b/i,
  /\bcadde(si)?\b/i,
  /\bsokak(ı)?\b/i,
  /\bbulvar[ıi]?\b/i,
  /\byolu\b/i,
  /kav[şs]a[ğg][ıi]/i,
  /otob[üu]s/i,
  /havaliman/i,
  /\byat\b/i,
  /marina/i,
  /tekne/i,
  /gi[şs]e/i,
  /k[öo]fteci/i,
  /kavşak/i,
  /^liman$/i,
  /^osb$/i,
  /^terminal$/i,
  /heliport/i,
  /hastane/i,
  /tramvay/i,
  /feribot hatt[ıi]/i,
  /ferry hatt[ıi]/i,
  /→/,
  /^\d+[a-z]?\s/i, // "133M ..." gibi otobüs/metro hat numarası
  /^m\d+\s/i, // "M1 ..." gibi metro hat numarası
];

// İşin görüldüğü fiziksel bir tesisten çok idari/kurumsal bir ofisi
// gösteren adaylar (ör. bölge liman başkanlığı ofisi) iş yeri seçeneği
// olarak anlamlı değildir.
const EXCLUDE_ADMINISTRATIVE_KEYWORDS = [/liman ba[şs]kanl/i, /b[öo]lge ba[şs]kanl/i];

// place: mahalle/semt gibi idari adlandırmalar ("Derince Liman" isimli bir
// mahalle, fiziksel liman tesisi değildir). railway/public_transport: bir
// tren/feribot durağının adı sıkça yakındaki tesisten alınır (ör. "Derince
// Liman" adlı bir buffer_stop/istasyon durağı) ama kendisi bir tesis değildir.
const EXCLUDE_TAG_KEYS = [
  "highway",
  "shop",
  "leisure",
  "tourism",
  "amenity",
  "building",
  "place",
  "railway",
  "public_transport",
];
const ALLOWED_AMENITY_VALUES = new Set(["ferry_terminal"]);
const ALLOWED_BUILDING_VALUES = new Set(["warehouse", "industrial"]);

export function isLikelyRelevantCandidate(name, tags) {
  if (!name) return false;
  if (EXCLUDE_NAME_KEYWORDS.some((pattern) => pattern.test(name))) return false;
  if (EXCLUDE_ADMINISTRATIVE_KEYWORDS.some((pattern) => pattern.test(name))) return false;

  for (const key of EXCLUDE_TAG_KEYS) {
    const value = tags[key];
    if (!value) continue;
    if (key === "amenity" && ALLOWED_AMENITY_VALUES.has(value)) continue;
    if (key === "building" && ALLOWED_BUILDING_VALUES.has(value)) continue;
    return false;
  }

  const hasStrongTag =
    tags.landuse === "port" ||
    tags.craft === "shipyard" ||
    tags.industrial === "port" ||
    tags["seamark:type"] === "harbour" ||
    tags.man_made === "pier" ||
    tags.man_made === "wharf" ||
    tags.man_made === "breakwater";
  const hasNameMatch = INCLUDE_NAME_KEYWORDS.some((pattern) => pattern.test(name));

  return hasStrongTag || hasNameMatch;
}

export function classifyFacilityType(name, tags) {
  const lower = name.toLocaleLowerCase("tr-TR");
  if (tags.craft === "shipyard" || /tersane/.test(lower)) return "TERSANE";
  if (/\bosb\b|organize sanayi/.test(lower)) return "OSB";
  if (/serbest b[öo]lge/.test(lower)) return "SERBEST_BOLGE";
  if (/lojistik/.test(lower)) return "LOJISTIK_MERKEZI";
  if (/\bro[\s-]?ro\b/.test(lower)) return "RO_RO_TERMINALI";
  if (/konteyner/.test(lower)) return "KONTEYNER_TERMINALI";
  if (/tank terminal|s[ıi]v[ıi] y[üu]k/.test(lower)) return "SIVI_YUK_TERMINALI";
  if (/kuru y[üu]k/.test(lower)) return "KURU_YUK_TERMINALI";
  if (
    /liman|port$/.test(lower) ||
    tags.landuse === "port" ||
    tags.industrial === "port" ||
    tags["seamark:type"] === "harbour" ||
    tags.man_made === "pier" ||
    tags.man_made === "wharf" ||
    tags.man_made === "breakwater"
  )
    return "LIMAN";
  if (tags.building === "warehouse") return "DEPO";
  if (tags.landuse === "industrial") return "FABRIKA";
  return "DIGER";
}
