// node scripts/test-photo-api.mjs
//
// app/api/job-photos/process Route Handler'ını GERÇEK dosyalarla, çalışan
// bir dev sunucusuna karşı uçtan uca test eder (fetch ile doğrudan HTTP
// isteği — TEST 5/6/7/11/13/14/15'in API-seviyesi karşılığı). Ön koşul:
// `npm run dev` http://localhost:3000 üzerinde çalışıyor olmalı.

import sharp from "sharp";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
let passed = 0;

function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function callApi(role, fileBuffer, fileName, mimeType) {
  const formData = new FormData();
  formData.append("role", role);
  formData.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);
  const response = await fetch(`${BASE_URL}/api/job-photos/process`, {
    method: "POST",
    body: formData,
  });
  return response;
}

async function main() {
  const heicPath = path.join(os.tmpdir(), "sample-test.heic");
  const gpsJpegPath = path.join(os.tmpdir(), "gps-sample2.jpg");

  // TEST 7 (API seviyesi): Hizmet Veren rolüyle doğrudan istek reddedilmeli
  {
    const response = await callApi("hizmet-veren", Buffer.from("herhangi bir icerik"), "x.jpg", "image/jpeg");
    if (response.status !== 403) throw new Error(`Beklenen 403, gelen ${response.status}`);
    const body = await response.json();
    if (!body.error?.includes("Hizmet Alan")) throw new Error(`Beklenmeyen hata mesajı: ${body.error}`);
    ok("TEST 7 (API): role=hizmet-veren -> 403 + Türkçe yetki hatası");
  }

  // Giriş yapmamış / role alanı yok -> reddedilmeli
  {
    const formData = new FormData();
    formData.append("file", new Blob([Buffer.from("x")], { type: "image/jpeg" }), "x.jpg");
    const response = await fetch(`${BASE_URL}/api/job-photos/process`, { method: "POST", body: formData });
    if (response.status !== 403) throw new Error(`Beklenen 403, gelen ${response.status}`);
    ok("role alanı hiç gönderilmezse -> 403");
  }

  // TEST 5 (API seviyesi): 10MB üzeri dosya reddedilmeli
  {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const response = await callApi("hizmet-alan", oversized, "buyuk.jpg", "image/jpeg");
    if (response.status !== 413) throw new Error(`Beklenen 413, gelen ${response.status}`);
    const body = await response.json();
    if (body.error !== "Fotoğraf boyutu 10 MB'ı geçemez.") throw new Error(`Beklenmeyen mesaj: ${body.error}`);
    ok("TEST 5 (API): 10MB üzeri dosya -> 413 + Türkçe hata");
  }

  // TEST 6 (API seviyesi): PDF (gerçek içerik resim değil) reddedilmeli
  {
    const fakePdf = Buffer.from("%PDF-1.4\n%âãÏÓ\nbu bir PDF degil ama PDF gibi baslıyor");
    const response = await callApi("hizmet-alan", fakePdf, "sahte.pdf", "application/pdf");
    if (response.status !== 400) throw new Error(`Beklenen 400, gelen ${response.status}`);
    ok("TEST 6 (API): PDF içerik -> 400 reddedildi");
  }

  // TEST 15 (API seviyesi): ".heic" adında ama gerçek içeriği resim olmayan sahte dosya reddedilmeli
  {
    const fakeHeic = Buffer.from("bu dosya heic degil, duz metin icerik");
    const response = await callApi("hizmet-alan", fakeHeic, "sahte.heic", "image/heic");
    if (response.status !== 400) throw new Error(`Beklenen 400, gelen ${response.status}`);
    ok("TEST 15 (API): sahte .heic (gerçek içerik resim değil) -> 400 reddedildi");
  }

  // TEST 11 (API seviyesi): gerçek iPhone tarzı HEIC (HEVC codec) kabul edilmeli, JPEG'e dönüştürülmeli
  {
    const heicBuffer = await readFile(heicPath);
    const originalMeta = await sharp(heicBuffer).metadata();
    const response = await callApi("hizmet-alan", heicBuffer, "iphone-foto.heic", "image/heic");
    if (!response.ok) {
      const body = await response.json();
      throw new Error(`HEIC işlenemedi: ${response.status} ${body.error}`);
    }
    const contentType = response.headers.get("Content-Type");
    if (contentType !== "image/jpeg") throw new Error(`Beklenen image/jpeg, gelen ${contentType}`);
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    const outputMeta = await sharp(outputBuffer).metadata();
    if (outputMeta.format !== "jpeg") throw new Error(`Çıktı jpeg değil: ${outputMeta.format}`);
    if (outputMeta.exif) throw new Error("Çıktıda hâlâ EXIF verisi var, temizlenmemiş.");
    ok(
      `TEST 11 (API): gerçek HEIC (HEVC) kabul edildi, JPEG'e dönüştürüldü (${originalMeta.width}x${originalMeta.height} -> ${outputMeta.width}x${outputMeta.height}), EXIF temizlendi`,
    );
  }

  // TEST 14 (API seviyesi): GPS EXIF içeren gerçek JPEG -> görüntü kaydedilmeli ama GPS/EXIF kaldırılmalı
  {
    const gpsBuffer = await readFile(gpsJpegPath);
    const inputMeta = await sharp(gpsBuffer).metadata();
    if (!inputMeta.exif) throw new Error("Test dosyasında beklenen GPS EXIF verisi yok (test kurulumu hatalı).");

    const response = await callApi("hizmet-alan", gpsBuffer, "gps-foto.jpg", "image/jpeg");
    if (!response.ok) throw new Error(`GPS'li JPEG işlenemedi: ${response.status}`);
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    const outputMeta = await sharp(outputBuffer).metadata();
    if (outputMeta.width <= 0 || outputMeta.height <= 0) throw new Error("Görüntü boyutları geçersiz.");
    if (outputMeta.exif) throw new Error("Çıktıda hâlâ EXIF/GPS verisi var — kaldırılmamış!");
    ok("TEST 14 (API): GPS EXIF içeren JPEG kabul edildi, görüntü korundu, GPS/EXIF metadata tamamen kaldırıldı");
  }

  // TEST 13 (API seviyesi): EXIF Orientation=6 (90° CW) etiketli görüntü doğru döndürülmeli
  {
    // 400x300 (yatay) bir kaynak görüntü üret, orientation=6 etiketiyle
    // işaretle. Orientation=6 "fiziksel piksel arabellek 90° saat yönünde
    // döndürülmeli" anlamına gelir; doğru işlenirse çıktı 300x400 (dikey)
    // olmalıdır.
    const rawImage = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const inputMeta = await sharp(rawImage).metadata();
    if (inputMeta.orientation !== 6) throw new Error(`Test kurulumu hatalı: orientation=${inputMeta.orientation}`);

    const response = await callApi("hizmet-alan", rawImage, "dikey-telefon-foto.jpg", "image/jpeg");
    if (!response.ok) throw new Error(`Orientation'lı JPEG işlenemedi: ${response.status}`);
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    const outputMeta = await sharp(outputBuffer).metadata();

    if (outputMeta.width !== 300 || outputMeta.height !== 400) {
      throw new Error(
        `Yön düzeltmesi yanlış: beklenen 300x400 (dikey), gelen ${outputMeta.width}x${outputMeta.height}`,
      );
    }
    if (outputMeta.orientation) throw new Error("Çıktıda hâlâ orientation etiketi var, düzeltilip düşürülmemiş.");
    ok(
      `TEST 13 (API): EXIF Orientation=6 doğru uygulandı (400x300 girdi -> ${outputMeta.width}x${outputMeta.height} çıktı, dikey görünüyor), etiket düşürüldü`,
    );
  }

  // Geçerli düz JPEG (EXIF/orientation yok) sorunsuz kabul edilmeli
  {
    const plainJpeg = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 200, b: 10 } },
    })
      .jpeg()
      .toBuffer();
    const response = await callApi("hizmet-alan", plainJpeg, "duz.jpg", "image/jpeg");
    if (!response.ok) throw new Error(`Düz JPEG işlenemedi: ${response.status}`);
    ok("Düz JPEG (EXIF'siz) sorunsuz kabul edildi");
  }

  console.log(`\n[test-photo-api] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[test-photo-api] HATA:", error.message);
  process.exitCode = 1;
});
