import locationsData from "../../data/locations/locations.json";
import districtsData from "../_data/turkey/districts.json";
import provincesData from "../_data/turkey/provinces.json";
import { slugifyTurkish } from "./turkish-text";

export type Province = { code: string; name: string };

/**
 * Kullanıcıya gösterilen SABİT 7 yer türü. Pipeline'ın daha ayrıntılı iç
 * sınıflandırması (konteyner terminali, ro-ro, tersane, lojistik merkezi...)
 * bu 7 kategoriden birine indirgenir — bkz.
 * scripts/locations/lib/canonical.mjs#PIPELINE_TYPE_TO_FACILITY_TYPE.
 */
export type FacilityType =
  | "LIMAN"
  | "OSB"
  | "SERBEST_BOLGE"
  | "DEPO"
  | "FABRIKA"
  | "ACIK_SAHA"
  | "DIGER";

export const FACILITY_TYPE_OPTIONS: { value: FacilityType; label: string }[] = [
  { value: "LIMAN", label: "Liman" },
  { value: "OSB", label: "OSB" },
  { value: "SERBEST_BOLGE", label: "Serbest Bölge" },
  { value: "DEPO", label: "Depo" },
  { value: "FABRIKA", label: "Fabrika" },
  { value: "ACIK_SAHA", label: "Açık Saha" },
  { value: "DIGER", label: "Diğer" },
];

const FACILITY_TYPE_VALUES = new Set(FACILITY_TYPE_OPTIONS.map((option) => option.value));

export type Facility = {
  id: string;
  name: string;
  type: FacilityType;
  /** İlin benzersiz ID'si (ör. "kocaeli") — görünen il adı değil. */
  provinceId: string;
  /** İlçenin benzersiz ID'si (ör. "dilovasi") — görünen ilçe adı değil. */
  districtId: string;
  /** Türkçe-duyarlı arama için ekstra yazımlar (ör. "Yilport", "YILPORT"). */
  aliases: string[];
};

/** data/locations/locations.json içindeki ham kayıt şekli (bkz. verify.mjs). */
type LocationRecord = {
  id: string;
  name: string;
  type: string;
  provinceId: string;
  districtId: string | null;
  aliases?: string[];
  active: boolean;
};

const provinces: Province[] = provincesData;
const districtsByProvinceCode: Record<string, string[]> = districtsData;
const provinceCodeByName = new Map(provinces.map((province) => [province.name, province.code]));

/**
 * TEK VE MERKEZİ VERİ KAYNAĞI: data/locations/locations.json.
 *
 * Bu dosya, Overpass/OSM pilotundan geçmiş iller (Kocaeli) için gerçek
 * doğrulanmış tesisleri VE henüz pilottan geçmemiş diğer iller için eski
 * elle yazılmış listelerden göçürülmüş kayıtları (bkz.
 * scripts/locations/migrate-legacy.mjs) TEK bir şema altında birleştirir.
 * Component içinde ayrı sabit liman/OSB/ilçe listesi YOKTUR; başka hiçbir
 * dosya bu verinin bir kopyasını tutmaz.
 *
 * Yalnızca `active === true` olan kayıtlar kullanıcıya gösterilir.
 * `districtId === null` olan (ilçesi doğrulanamamış) kayıtlar hiçbir ilçe
 * filtresinde görünmez — bu bilinen bir veri boşluğudur, hatalı eşleşmeye
 * yeğlenir.
 */
const facilities: Facility[] = (locationsData as LocationRecord[])
  .filter(
    (record): record is LocationRecord & { districtId: string } =>
      record.active && record.districtId !== null && FACILITY_TYPE_VALUES.has(record.type as FacilityType),
  )
  .map((record) => ({
    id: record.id,
    name: record.name,
    type: record.type as FacilityType,
    provinceId: record.provinceId,
    districtId: record.districtId,
    aliases: record.aliases ?? [],
  }));

export function getProvinces(): Province[] {
  return provinces;
}

export function getProvinceCodeByName(name: string): string | null {
  return provinceCodeByName.get(name) ?? null;
}

/** İl KODUNDAN (ör. "41"), tesis kayıtlarının kullandığı il ID'sini üretir (ör. "kocaeli"). */
export function getProvinceIdByCode(provinceCode: string): string | null {
  const province = provinces.find((item) => item.code === provinceCode);
  return province ? slugifyTurkish(province.name) : null;
}

export function getDistrictsByProvinceCode(provinceCode: string): string[] {
  return districtsByProvinceCode[provinceCode] ?? [];
}

/** İlçe ADINDAN (ör. "Dilovası"), tesis kayıtlarının kullandığı ilçe ID'sini üretir (ör. "dilovasi"). */
export function getDistrictId(districtName: string): string {
  return slugifyTurkish(districtName);
}

export function getFacilityTypeLabel(type: FacilityType): string {
  return FACILITY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

/**
 * TEMEL FİLTRE KURALI: Bir tesis yalnızca provinceId + districtId + type
 * ÜÇÜNÜN TAMAMI eşleştiğinde döner. Yalnızca isim karşılaştırmasıyla
 * filtreleme YAPILMAZ.
 */
export function getFacilitiesByProvinceDistrictAndType(
  provinceId: string,
  districtId: string,
  type: FacilityType,
): Facility[] {
  return facilities.filter(
    (facility) =>
      facility.provinceId === provinceId &&
      facility.districtId === districtId &&
      facility.type === type,
  );
}
