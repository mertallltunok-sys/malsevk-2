/**
 * Faaliyet Belgesi / Faaliyet Raporu yükleme alanı için PAYLAŞILAN doğrulama
 * mantığı — hem istemci tarafındaki ön-eleme (provider-document-upload.tsx)
 * hem sunucu tarafındaki asıl doğrulama (app/api/provider-documents/validate)
 * BURADAN beslenir. Yalnızca `Uint8Array`/`string` üzerinde çalışır (Node'a
 * özgü `Buffer` KULLANILMAZ) — bu yüzden tarayıcı bundle'ına da güvenle dahil
 * edilebilir; ZIP-içi dosya adı taraması gibi yalnızca Node'da anlamlı olan,
 * daha derin/ikinci katman kontroller route.ts içinde ayrıca yapılır (bkz. o
 * dosyanın kendi dokümantasyonu) — job-photos pipeline'ındaki "istemci hızlı
 * ön-kontrol / sunucu asıl doğrulama" iki katmanlı deseniyle aynı mantık.
 */

export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENTS = 5;
export const MIN_DOCUMENTS = 1;

export type DocumentExtension =
  | "pdf"
  | "doc"
  | "docx"
  | "xls"
  | "xlsx"
  | "odt"
  | "jpg"
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "heif"
  | "tif"
  | "tiff";

const ALLOWED_EXTENSIONS: readonly DocumentExtension[] = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "odt",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
];

export const ACCEPTED_DOCUMENT_INPUT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const IMAGE_PREVIEWABLE_EXTENSIONS: readonly DocumentExtension[] = ["jpg", "jpeg", "png", "webp"];
const IMAGE_EXTENSIONS: readonly DocumentExtension[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
];

/**
 * Uzantı başına "içerik kabı" beklentisi — sunucu tarafı, dosyanın gerçek
 * magic number'ının bu beklentiyle eşleştiğini doğrular (bkz. route.ts).
 * docx/xlsx/odt üçü de ZIP konteynerinde taşındığı için aynı "zip" değerini
 * paylaşır; alt tür ayrımı (hangisinin gerçekten docx/xlsx/odt olduğu) yalnızca
 * Node tarafında ZIP girişi adı taramasıyla yapılabilir (bkz. route.ts).
 */
export const EXTENSION_CONTAINER: Readonly<Record<DocumentExtension, string>> = {
  pdf: "pdf",
  doc: "ole-cfb",
  xls: "ole-cfb",
  docx: "zip",
  xlsx: "zip",
  odt: "zip",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  tif: "tiff",
  tiff: "tiff",
};

/** Uzantı -> standart MIME türü. Sunucu tarafı doğrulama yanıtı ve belge metadata kaydı bu eşlemeyi kullanır. */
export const EXTENSION_MIME_TYPE: Readonly<Record<DocumentExtension, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * Çalıştırılabilir/script/riskli olduğu bilinen uzantılar — yalnızca dosya
 * adının SON uzantısı bu listeyle karşılaştırılmaz (zaten `ALLOWED_EXTENSIONS`
 * dışında kalarak elenir), asıl amacı `hasDangerousDoubleExtension` ile dosya
 * adının ORTASINDA gizlenmiş bir risk taşıyıp taşımadığını yakalamaktır (ör.
 * "faaliyet-belgesi.exe.pdf").
 */
const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "msi",
  "msix",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "js",
  "jse",
  "mjs",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "hta",
  "ps1",
  "ps1xml",
  "psm1",
  "psc1",
  "sh",
  "bash",
  "apk",
  "jar",
  "cpl",
  "msc",
  "dll",
  "html",
  "htm",
  "xhtml",
  "php",
  "php3",
  "php4",
  "php5",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "py",
  "rb",
  "pl",
  "reg",
  "docm",
  "xlsm",
  "pptm",
  "xlsb",
  "dotm",
  "xltm",
  "potm",
]);

export type DocumentValidationCheck = { ok: true } | { ok: false; error: string };

/** "Faaliyet-Belgesi.PDF" -> "pdf". Uzantısız dosya adları için `null`. */
export function getFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot === -1 || lastDot === trimmed.length - 1) return null;
  return trimmed.slice(lastDot + 1).toLowerCase();
}

export function isAllowedDocumentExtension(extension: string | null): extension is DocumentExtension {
  return extension !== null && (ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
}

export function isPreviewableImageExtension(extension: string): boolean {
  return (IMAGE_PREVIEWABLE_EXTENSIONS as readonly string[]).includes(extension);
}

export function isImageExtension(extension: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * Dosya adının ARA (son olmayan) noktalı bölümlerinden herhangi biri
 * tehlikeli/riskli bir uzantıyla eşleşiyorsa `true` döner — çift uzantı
 * saldırısının ("rapor.exe.pdf", "rapor.pdf.exe") yakalandığı yer burasıdır.
 * Son bölüm zaten `ALLOWED_EXTENSIONS` beyaz listesiyle ayrıca kontrol edilir.
 */
export function hasDangerousDoubleExtension(fileName: string): boolean {
  const segments = fileName.trim().toLowerCase().split(".");
  if (segments.length < 2) return false;
  const middleSegments = segments.slice(1, -1);
  return middleSegments.some((segment) => DANGEROUS_EXTENSIONS.has(segment));
}

const FILENAME_FORBIDDEN_CHARS = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

/**
 * Görüntüleme/depolama için güvenli hale getirilmiş dosya adı üretir: yol
 * ayırıcıları/kontrol karakterlerini kaldırır, güvenli bir karakter kümesine
 * indirger, aşırı uzun adları kısaltır — orijinal uzantı korunur.
 */
export function sanitizeFileName(fileName: string): string {
  const extension = getFileExtension(fileName);
  const base = extension ? fileName.slice(0, fileName.length - extension.length - 1) : fileName;
  const safeBase =
    Array.from(base.normalize("NFKC"))
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 32 || code === 127) return false;
        return !FILENAME_FORBIDDEN_CHARS.has(ch);
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "belge";
  return extension ? `${safeBase}.${extension}` : safeBase;
}

export function validateDocumentFileName(fileName: string): DocumentValidationCheck {
  if (hasDangerousDoubleExtension(fileName)) {
    return { ok: false, error: `${fileName}: Çift uzantılı veya güvenli olmayan dosya adı kabul edilmez.` };
  }
  const extension = getFileExtension(fileName);
  if (!isAllowedDocumentExtension(extension)) {
    return {
      ok: false,
      error: `${fileName}: Desteklenmeyen dosya türü. PDF, DOC, DOCX, XLS, XLSX, ODT veya JPG/PNG/WEBP/HEIC/HEIF/TIF yükleyebilirsiniz.`,
    };
  }
  return { ok: true };
}

export function validateDocumentSize(file: { size: number }): DocumentValidationCheck {
  if (file.size === 0) {
    return { ok: false, error: "Dosya boş veya bozuk." };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { ok: false, error: `Dosya boyutu ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB'ı geçemez.` };
  }
  return { ok: true };
}

export function validateDocumentCount(currentCount: number, addingCount: number): DocumentValidationCheck {
  if (currentCount + addingCount > MAX_DOCUMENTS) {
    return { ok: false, error: `En fazla ${MAX_DOCUMENTS} belge yükleyebilirsiniz.` };
  }
  return { ok: true };
}

export const DOCUMENTS_REQUIRED_MESSAGE =
  "Devam edebilmek için en az 1 faaliyet belgesi veya faaliyet raporu yüklemelisiniz.";

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) result += String.fromCharCode(bytes[i]);
  return result;
}

/**
 * Yalnızca magic number'a bakan KABA (coarse) bir konteyner sınıflandırması —
 * "%PDF-" (pdf), OLE Compound File imzası (ole-cfb, doc/xls'in ikisi de bunu
 * paylaşır — ayrımı yapılamaz, bkz. EXTENSION_CONTAINER dokümantasyonu), ZIP
 * yerel dosya başlığı (zip — docx/xlsx/odt'nin üçü de), ve bilinen resim
 * imzaları. ZIP içeriğinin GERÇEKTEN hangi Office/ODF türü olduğunun ayrımı
 * ve resimlerin gerçek kod çözümle doğrulanması yalnızca sunucu tarafında
 * (route.ts, Node/sharp) yapılır — bu fonksiyon yalnızca hızlı, istemci
 * tarafı bir ön-elemedir.
 */
export function detectDocumentContainerFormat(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && bytesToAscii(bytes, 0, 5) === "%PDF-") return "pdf";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    return "ole-cfb";
  }

  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  ) {
    return "zip";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";

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

  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return "tiff";
  }

  return null;
}

/**
 * İstemci tarafı hızlı ön-kontrol: dosya adı (çift/riskli uzantı + beyaz
 * liste), boyut ve magic-number-uzantı eşleşmesi. Asıl/kesin doğrulama
 * sunucu tarafındadır (bkz. app/api/provider-documents/validate) — tıpkı
 * photo-validation.ts#validatePhotoFile ile job-photos route ilişkisi gibi.
 */
export function validateDocumentClientSide(
  file: { name: string; size: number },
  headerBytes: Uint8Array,
): DocumentValidationCheck {
  const nameCheck = validateDocumentFileName(file.name);
  if (!nameCheck.ok) return nameCheck;

  const sizeCheck = validateDocumentSize(file);
  if (!sizeCheck.ok) return sizeCheck;

  const extension = getFileExtension(file.name) as DocumentExtension;
  const expectedContainer = EXTENSION_CONTAINER[extension];
  const detectedContainer = detectDocumentContainerFormat(headerBytes);
  if (detectedContainer !== expectedContainer) {
    return { ok: false, error: `${file.name}: Dosya içeriği, uzantısıyla uyuşmuyor veya dosya bozuk.` };
  }

  return { ok: true };
}
