import convert from "heic-convert";
import { NextResponse } from "next/server";
import sharp from "sharp";

// sharp yerel bir Node eklentisidir; Edge runtime'da çalışmaz.
export const runtime = "nodejs";

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const OUTPUT_JPEG_QUALITY = 85;

function looksLikeHeifContainer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).trim().toLowerCase();
  return ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"].includes(
    brand,
  );
}

type ProcessedImage = { buffer: Buffer; mimeType: string; width: number; height: number };

/**
 * Gerçek dosya içeriğini doğrular (uzantıya/deklare edilen MIME'a güvenmez),
 * gerekiyorsa HEIC/HEIF'i JPEG'e dönüştürür, EXIF yön bilgisine göre görüntüyü
 * otomatik olarak düzeltir ve tüm EXIF/GPS metadatasını (yeniden `withMetadata()`
 * çağrılmadığı için) kaldırır.
 *
 * sharp'ın paketlenmiş libvips'i HEIC konteynerini ayrıştırabilir ama çoğu
 * gerçek iPhone fotoğrafının kullandığı HEVC codec'ini çözemez (lisans
 * kısıtlaması nedeniyle derlenmemiş) — bu yüzden HEIC/HEIF konteynerleri önce
 * `heic-convert` (libheif/libde265 WASM, codec kısıtlaması yok) ile JPEG'e
 * çevrilir, ardından aynı sharp boru hattından (yön düzeltme + metadata
 * temizleme) geçirilir.
 */
async function processImageBuffer(inputBuffer: Buffer): Promise<ProcessedImage> {
  let workingBuffer: Buffer = inputBuffer;

  try {
    // Gerçek piksel verisinin çözülebildiğini doğrula (yalnızca metadata
    // okumak yetmez — bazı bozuk/sahte dosyalar metadata aşamasını geçebilir).
    await sharp(inputBuffer).resize(1, 1).toBuffer();
  } catch (directDecodeError) {
    if (!looksLikeHeifContainer(inputBuffer)) {
      throw new Error("Dosya bozuk veya geçerli bir resim değil.", { cause: directDecodeError });
    }
    try {
      const converted = await convert({ buffer: inputBuffer, format: "JPEG", quality: 0.92 });
      workingBuffer = Buffer.from(converted);
    } catch (heicError) {
      throw new Error("HEIC/HEIF dosyası işlenemedi veya bozuk.", { cause: heicError });
    }
  }

  const metadata = await sharp(workingBuffer).metadata();
  const allowedFormats = new Set(["jpeg", "png", "webp", "heif", "avif"]);
  if (!metadata.format || !allowedFormats.has(metadata.format)) {
    throw new Error("Desteklenmeyen dosya biçimi.");
  }

  // .rotate() (argümansız): EXIF orientation'a göre otomatik döndürür ve
  // etiketi düşürür. .withMetadata() ÇAĞRILMADIĞI için kalan tüm EXIF/GPS
  // verisi çıktıdan tamamen kaldırılır.
  let pipeline = sharp(workingBuffer).rotate();

  let mimeType: string;
  if (metadata.format === "png") {
    pipeline = pipeline.png();
    mimeType = "image/png";
  } else if (metadata.format === "webp") {
    pipeline = pipeline.webp({ quality: OUTPUT_JPEG_QUALITY });
    mimeType = "image/webp";
  } else {
    // jpeg, heif (dönüştürülmüş) ve avif -> güvenli/evrensel biçim olan JPEG
    pipeline = pipeline.jpeg({ quality: OUTPUT_JPEG_QUALITY, mozjpeg: true });
    mimeType = "image/jpeg";
  }

  const outputBuffer = await pipeline.toBuffer();
  const outputMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    mimeType,
    width: outputMeta.width ?? 0,
    height: outputMeta.height ?? 0,
  };
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Geçersiz istek." }, { status: 400 });
  }

  // NOT (mimari sınırı): Bu uygulamada gerçek bir backend/oturum sistemi yok
  // (bkz. app/_lib/users.ts, contact-access.ts) — `role` istemcinin kendi
  // localStorage oturumundan gönderdiği bir alandır, sunucu tarafında
  // bağımsız olarak doğrulanamaz. Gerçek uygulamadaki her istek her zaman
  // kullanıcının GERÇEK oturum rolünü gönderir (arayüz başka bir değer
  // göndermez); bu kontrol, ilanın gerçek sahipliğini
  // `app/_lib/job-store.ts#createJob/deleteJobPhoto` içinde tekrar
  // doğrulayan asıl yetkilendirme katmanına ek bir savunma derinliği
  // sağlar, tek başına sahte bir doğrudan HTTP isteğine karşı kesin
  // koruma iddia etmez.
  const role = formData.get("role");
  if (role !== "hizmet-alan") {
    return NextResponse.json(
      { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar fotoğraf yükleyebilir." },
      { status: 403 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Fotoğraf bulunamadı." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "Dosya boş veya bozuk." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Fotoğraf boyutu 10 MB'ı geçemez." },
      { status: 413 },
    );
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());

  try {
    const processed = await processImageBuffer(inputBuffer);
    return new NextResponse(new Uint8Array(processed.buffer), {
      status: 200,
      headers: {
        "Content-Type": processed.mimeType,
        "X-Photo-Width": String(processed.width),
        "X-Photo-Height": String(processed.height),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya bozuk veya geçerli bir resim değil.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
