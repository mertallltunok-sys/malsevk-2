// node scripts/test-photo-feature.mjs
//
// Operasyon fotoğrafı yükleme özelliğinin, gerçek tarayıcı/IndexedDB
// gerektirmeyen SAF mantığını (photo-validation.ts) doğrudan üretim koduna
// karşı test eder. Node 24'ün yerleşik TypeScript ayıklama desteğiyle .ts
// dosyası doğrudan import edilir.
//
// job-store.ts burada import EDİLEMEZ: içeri aktardığı "./local-storage"
// gibi yerel modülleri uzantısız çağırır (Next.js'in bundler çözümlemesi
// buna izin verir, düz Node ESM vermez). job-store.ts'teki yetkilendirme
// kurallarının (rol/sahiplik kontrolü) ve tam localStorage/IndexedDB
// akışının doğrulaması bu yüzden yalnızca gerçek bir tarayıcıda yapılabilir
// — bkz. scripts/browser-test-job-photos.mjs (Playwright).

import assert from "node:assert/strict";
import {
  ACCEPTED_FILE_INPUT,
  DUPLICATE_PHOTO_MESSAGE,
  MAX_PHOTOS,
  MAX_PHOTO_SIZE_BYTES,
  MIN_PHOTOS,
  PHOTOS_REQUIRED_MESSAGE,
  detectImageFormat,
  formatFileSize,
  hashFileContent,
  validatePhotoCount,
  validatePhotoFile,
  validatePhotosPresent,
} from "../app/_lib/photo-validation.ts";

let passed = 0;
function check(description, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${description}`);
}

console.log("[test-photo-feature] photo-validation.ts saf mantık testleri\n");

check("JPEG magic number doğru algılanıyor", () => {
  assert.equal(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "jpeg");
});

check("PNG magic number doğru algılanıyor", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageFormat(png), "png");
});

check("WEBP (RIFF....WEBP) magic number doğru algılanıyor", () => {
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(detectImageFormat(webp), "webp");
});

check("HEIC (ftyp+heic brand) magic number doğru algılanıyor", () => {
  const heic = new Uint8Array([
    0, 0, 0, 0x18,
    0x66, 0x74, 0x79, 0x70, // "ftyp"
    0x68, 0x65, 0x69, 0x63, // "heic"
  ]);
  assert.equal(detectImageFormat(heic), "heic");
});

check("PDF (%PDF) hiçbir bilinen resim biçimine eşleşmiyor", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
  assert.equal(detectImageFormat(pdf), null);
});

check("ZIP (PK..) hiçbir bilinen resim biçimine eşleşmiyor", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectImageFormat(zip), null);
});

check("HEIC uzantılı ama gerçek içeriği resim olmayan sahte dosya reddedilir (TEST 15)", () => {
  // ".heic" adında ama düz metin içeriğine sahip bir dosyanın baytları:
  const fakeHeic = new TextEncoder().encode("bu bir resim degil, duz metin");
  assert.equal(detectImageFormat(fakeHeic), null);
});

check("validatePhotoCount: 10 sınırı aşılınca reddedilir", () => {
  const result = validatePhotoCount(8, 3);
  assert.equal(result.ok, false);
  assert.match(result.error, /10/);
});

check("validatePhotoCount: sınır içinde kabul edilir", () => {
  assert.deepEqual(validatePhotoCount(5, 5), { ok: true });
});

check("validatePhotosPresent: 0 fotoğraf tam olarak istenen Türkçe mesajla reddedilir", () => {
  const result = validatePhotosPresent(0);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Devam edebilmek için operasyonu gösteren en az 1 fotoğraf yüklemelisiniz.");
  assert.equal(result.error, PHOTOS_REQUIRED_MESSAGE);
});

check("validatePhotoFile: 10MB üzeri dosya reddedilir", () => {
  const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const result = validatePhotoFile({ size: 11 * 1024 * 1024 }, jpegHeader);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Fotoğraf boyutu 10 MB'ı geçemez.");
});

check("validatePhotoFile: geçerli JPEG kabul edilir", () => {
  const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual(validatePhotoFile({ size: 2 * 1024 * 1024 }, jpegHeader), { ok: true });
});

check("validatePhotoFile: PDF (sahte uzantı önemsiz, gerçek içerik kontrol edilir) reddedilir", () => {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const result = validatePhotoFile({ size: 1024 }, pdfHeader);
  assert.equal(result.ok, false);
});

check("formatFileSize okunabilir birimler üretiyor", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
});

check("hashFileContent: aynı içerik aynı özeti üretir (mükerrer tespiti temeli)", async () => {
  const contentA = new TextEncoder().encode("ayni-fotograf-icerigi").buffer;
  const contentB = new TextEncoder().encode("ayni-fotograf-icerigi").buffer;
  const contentC = new TextEncoder().encode("farkli-fotograf-icerigi").buffer;
  const hashA = await hashFileContent(contentA);
  const hashB = await hashFileContent(contentB);
  const hashC = await hashFileContent(contentC);
  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);
});

check("Sabitler beklenen değerlerde (MAX_PHOTOS=10, MIN_PHOTOS=1, MAX 10MB)", () => {
  assert.equal(MAX_PHOTOS, 10);
  assert.equal(MIN_PHOTOS, 1);
  assert.equal(MAX_PHOTO_SIZE_BYTES, 10 * 1024 * 1024);
  assert.ok(ACCEPTED_FILE_INPUT.includes("heic"));
  assert.ok(DUPLICATE_PHOTO_MESSAGE.length > 0);
});

console.log(`\n[test-photo-feature] ${passed}/${passed} test geçti.`);
