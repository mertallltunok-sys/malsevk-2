import convert from "heic-convert";
import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  EXTENSION_CONTAINER,
  EXTENSION_MIME_TYPE,
  MAX_DOCUMENT_SIZE_BYTES,
  detectDocumentContainerFormat,
  getFileExtension,
  hasDangerousDoubleExtension,
  isAllowedDocumentExtension,
  sanitizeFileName,
  type DocumentExtension,
} from "../../../_lib/document-validation";

// sharp yerel bir Node eklentisidir; Edge runtime'da çalışmaz (bkz. job-photos/process/route.ts).
export const runtime = "nodejs";

/**
 * Faaliyet Belgesi/Raporu'nun SUNUCU tarafı, "asıl" doğrulaması —
 * app/_lib/document-validation.ts'teki istemci ön-kontrolünün derinleştirilmiş
 * hâli. Bu route hiçbir şey KALICI OLARAK SAKLAMAZ (job-photos/process ile
 * aynı, stateless bir doğrulama uç noktasıdır) — asıl dosya, doğrulama
 * geçtikten SONRA istemci tarafında IndexedDB'ye (photo-blob-store.ts, ilan
 * fotoğraflarıyla PAYLAŞILAN aynı blob deposu) yazılır. Bu yüzden burada bir
 * `role`/oturum kontrolü YOKTUR: kayıt akışında bu isteğin yapıldığı anda
 * henüz gerçek bir kullanıcı/oturum yoktur (bkz. provider-registration.ts) —
 * korunacak bir yetkilendirme sınırı değil, yalnızca girdi doğrulamasıdır.
 *
 * docx/xlsx/odt'nin üçü de ZIP konteyneri olduğu için (bkz.
 * document-validation.ts#EXTENSION_CONTAINER), alt tür ayrımı burada, Node
 * tarafında, ZIP içindeki bilinen giriş adlarının HAM BAYT ARAMASIYLA
 * yapılır — tam bir ZIP ayrıştırıcısı DEĞİLDİR (yeni bir bağımlılık eklemekten
 * kaçınmak için bilinçli, orantılı bir tercih), ama rastgele yeniden
 * adlandırılmış bir çalıştırılabilir/script dosyasının bu imzaları taşıması
 * pratikte imkânsızdır. Aynı taramada `vbaProject.bin` girişi de aranır —
 * varsa (makrolu bir Office dosyasının .docx/.xlsx olarak yeniden
 * adlandırılmış hâli olabilir) dosya UZANTISI ne olursa olsun reddedilir.
 *
 * Legacy .doc/.xls (OLE Compound File Binary) imzası ikisi için de AYNIDIR —
 * içerik düzeyinde doc/xls ayrımı yapılamaz (bilinen, kabul edilmiş bir
 * sınırlama; bkz. document-validation.ts#EXTENSION_CONTAINER dokümantasyonu),
 * bu yüzden bu ikisi için yalnızca gerçek bir OLE CFB dosyası olduğu
 * doğrulanır.
 */

const ZIP_ENTRY_MARKERS: Partial<Record<DocumentExtension, string[]>> = {
  docx: ["word/document.xml"],
  xlsx: ["xl/workbook.xml"],
  odt: ["mimetype", "opendocument.text"],
};

const MACRO_ENTRY_MARKER = "vbaProject.bin";

const IMAGE_EXTENSIONS_FOR_DECODE: readonly DocumentExtension[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "tif",
  "tiff",
  "heic",
  "heif",
];

function looksLikeHeifContainer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).trim().toLowerCase();
  return ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"].includes(brand);
}

async function verifyImageDecodable(buffer: Buffer, extension: DocumentExtension): Promise<boolean> {
  try {
    await sharp(buffer).resize(1, 1).toBuffer();
    return true;
  } catch {
    if ((extension === "heic" || extension === "heif") && looksLikeHeifContainer(buffer)) {
      try {
        await convert({ buffer, format: "JPEG", quality: 0.5 });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function verifyZipEntryMarkers(buffer: Buffer, extension: DocumentExtension): boolean {
  const text = buffer.toString("latin1");
  if (text.includes(MACRO_ENTRY_MARKER)) return false;
  const markers = ZIP_ENTRY_MARKERS[extension];
  if (!markers) return false;
  return markers.every((marker) => text.includes(marker));
}

function verifyPdfStructure(buffer: Buffer): boolean {
  const text = buffer.toString("latin1");
  return text.startsWith("%PDF-") && text.includes("%%EOF");
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Geçersiz istek." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Belge bulunamadı." }, { status: 400 });
  }

  if (hasDangerousDoubleExtension(file.name)) {
    return NextResponse.json(
      { ok: false, error: `${file.name}: Çift uzantılı veya güvenli olmayan dosya adı kabul edilmez.` },
      { status: 400 },
    );
  }

  const extension = getFileExtension(file.name);
  if (!isAllowedDocumentExtension(extension)) {
    return NextResponse.json({ ok: false, error: `${file.name}: Desteklenmeyen dosya türü.` }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "Dosya boş veya bozuk." }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Dosya boyutu ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB'ı geçemez.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const expectedContainer = EXTENSION_CONTAINER[extension];
  const detectedContainer = detectDocumentContainerFormat(buffer);
  if (detectedContainer !== expectedContainer) {
    return NextResponse.json(
      { ok: false, error: `${file.name}: Dosya içeriği, uzantısıyla uyuşmuyor veya dosya bozuk.` },
      { status: 400 },
    );
  }

  if (expectedContainer === "pdf" && !verifyPdfStructure(buffer)) {
    return NextResponse.json(
      { ok: false, error: `${file.name}: Geçerli bir PDF yapısı bulunamadı.` },
      { status: 400 },
    );
  }

  if (expectedContainer === "zip" && !verifyZipEntryMarkers(buffer, extension)) {
    return NextResponse.json(
      {
        ok: false,
        error: `${file.name}: Belge içeriği beklenen ${extension.toUpperCase()} yapısıyla eşleşmiyor veya makro içeriyor.`,
      },
      { status: 400 },
    );
  }

  if (
    (IMAGE_EXTENSIONS_FOR_DECODE as readonly string[]).includes(extension) &&
    !(await verifyImageDecodable(buffer, extension))
  ) {
    return NextResponse.json(
      { ok: false, error: `${file.name}: Dosya bozuk veya geçerli bir resim değil.` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    sanitizedFileName: sanitizeFileName(file.name),
    mimeType: EXTENSION_MIME_TYPE[extension],
    extension,
    size: file.size,
  });
}
