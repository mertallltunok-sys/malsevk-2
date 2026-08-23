import { isStorageGroupCategory, NAKLIYE_SERVICE_CATEGORY_ID } from "./service-catalog";

/**
 * Genel (kategoriden bağımsız) fotoğraf sayısı sınırları — projenin
 * TEK merkezi karar noktası, HER çağıran (job-photo-upload.tsx,
 * job-photo-editor.tsx, job-request-form.tsx, job-form-validation.ts,
 * job-store.ts) buradan okur. "Depolama İlan Oluşturma" görev talimatı
 * Depo Hizmetleri grubu için FARKLI bir aralık (4-15) istiyor — bu, mevcut
 * genel aralıkla (1-10) BİLEREK ÇELİŞİR (proje raporuna bkz.); çözüm
 * Depolamaya özel İKİNCİ bir yükleme bileşeni/doğrulama modülü kurmak
 * DEĞİL, bu TEK merkezi sabit çiftini kategoriye duyarlı hâle getirmektir —
 * `getMinPhotos`/`getMaxPhotos` bunun için eklendi; `category` verilmezse
 * ya da Depo Hizmetleri grubunun dışındaysa davranış BİREBİR eskisiyle
 * aynıdır (1-10). `MIN_PHOTOS`/`MAX_PHOTOS` ham sabitleri geriye dönük
 * uyumluluk için (ve genel/kategori-bağımsız bağlamlarda varsayılan olarak)
 * hâlâ dışa aktarılır.
 */
export const MAX_PHOTOS = 10;
export const MIN_PHOTOS = 1;
const STORAGE_MAX_PHOTOS = 15;
const STORAGE_MIN_PHOTOS = 4;

/** Nakliye Yeniden Tasarımı görevi: Nakliye de artık Depo Hizmetleri İLE AYNI (4-15) aralığı kullanır — operasyonu (yükleme/istifleme/araç) yeterince belgeleyebilmek için tek fotoğraf yetersiz kalıyordu; ikinci bir sabit çift İCAT EDİLMEDİ, mevcut STORAGE_MIN/MAX_PHOTOS aynen paylaşılır. */
function requiresWiderPhotoRange(category: string): boolean {
  return isStorageGroupCategory(category) || category === NAKLIYE_SERVICE_CATEGORY_ID;
}

export function getMinPhotos(category?: string): number {
  return category && requiresWiderPhotoRange(category) ? STORAGE_MIN_PHOTOS : MIN_PHOTOS;
}

export function getMaxPhotos(category?: string): number {
  return category && requiresWiderPhotoRange(category) ? STORAGE_MAX_PHOTOS : MAX_PHOTOS;
}

export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_FILE_INPUT = ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif";

export const PHOTOS_REQUIRED_MESSAGE =
  "Devam edebilmek için operasyonu gösteren en az 1 fotoğraf yüklemelisiniz.";

/** Bkz. getMinPhotos/getMaxPhotos üstündeki doküman — PHOTOS_REQUIRED_MESSAGE'ın kategoriye duyarlı hâli. */
export function getPhotosRequiredMessage(category?: string): string {
  const min = getMinPhotos(category);
  return min === MIN_PHOTOS
    ? PHOTOS_REQUIRED_MESSAGE
    : `Devam edebilmek için en az ${min} fotoğraf yüklemelisiniz.`;
}

export type ImageFormat = "jpeg" | "png" | "webp" | "heic";

/**
 * Dosya uzantısına/deklare edilen MIME türüne güvenmeden, dosyanın ilk
 * baytlarından ("magic number") gerçek biçimini algılar. Yalnızca hızlı,
 * istemci-tarafı bir ön-eleme sağlar; asıl/kesin doğrulama sunucu
 * tarafında (app/api/job-photos/process) gerçek bir görüntü kod
 * çözücüsüyle yapılır.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 12) {
    const boxType = bytesToAscii(bytes, 4, 8);
    if (boxType === "ftyp") {
      const brand = bytesToAscii(bytes, 8, 12).toLowerCase();
      const heicBrands = ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"];
      if (heicBrands.includes(brand)) return "heic";
    }
  }
  return null;
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let i = start; i < end; i++) result += String.fromCharCode(bytes[i]);
  return result;
}

export type PhotoCountCheck = { ok: true } | { ok: false; error: string };

export function validatePhotoCount(currentCount: number, addingCount: number): PhotoCountCheck {
  if (currentCount + addingCount > MAX_PHOTOS) {
    return { ok: false, error: `En fazla ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz.` };
  }
  return { ok: true };
}

export function validatePhotosPresent(count: number): PhotoCountCheck {
  if (count < MIN_PHOTOS) {
    return { ok: false, error: PHOTOS_REQUIRED_MESSAGE };
  }
  return { ok: true };
}

export type PhotoFileCheck = { ok: true } | { ok: false; error: string };

/**
 * Bir dosyanın boyutunu ve (magic number ile) gerçek biçimini kontrol eder.
 * `bytes`, dosyanın en az ilk 12 baytını içermelidir.
 */
export function validatePhotoFile(file: { size: number }, headerBytes: Uint8Array): PhotoFileCheck {
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    return { ok: false, error: "Fotoğraf boyutu 10 MB'ı geçemez." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Dosya boş veya bozuk." };
  }
  const format = detectImageFormat(headerBytes);
  if (!format) {
    return {
      ok: false,
      error: "Desteklenmeyen dosya biçimi. Yalnızca JPG, PNG, WEBP veya HEIC/HEIF yükleyebilirsiniz.",
    };
  }
  return { ok: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Dosya içeriğinin SHA-256 özetini çıkarır — aynı fotoğrafın yanlışlıkla
 * iki kez yüklenmesini, dosya adına değil gerçek içeriğe bakarak
 * engellemek için kullanılır.
 */
export async function hashFileContent(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const DUPLICATE_PHOTO_MESSAGE = "Bu fotoğraf zaten yüklendi.";
