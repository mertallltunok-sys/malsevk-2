import type { NextConfig } from "next";

// GENEL GÜVENLİK, VERİ DOĞRULAMA VE KÖTÜYE KULLANIM KORUMASI görevi §18 —
// önceden bu dosyada HİÇ güvenlik başlığı YOKTU. Sıkı bir CSP BİLEREK
// eklenmedi (görev gereksinimi: "mevcut işlevleri bozacak sert bir Content
// Security Policy uygulama" — Google Fonts, inline stil/script kullanımı,
// çeşitli üçüncü taraf gömme senaryoları test edilmeden kırılabilirdi);
// yalnızca hiçbir mevcut davranışı bozma riski taşımayan, düşük riskli/
// standart başlıklar eklenir. `/admin/:path*` için ayrıca `Cache-Control:
// no-store` — yetkili admin verisinin paylaşımlı/ortak bir önbellekte
// yanlış kullanıcıya sunulmasını engeller (görev gereksinimi).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // proxy.ts'in matcher'ı /api/job-photos/process (10MB'a kadar fotoğraf)
    // ve /api/provider-documents/validate (15MB'a kadar belge) rotalarını da
    // kapsıyor; Next.js 16'da proxy varsayılan olarak istek gövdesini 10MB'a
    // kadar tamponluyor (bkz. proxyClientMaxBodySize dokümantasyonu) — bu
    // sınır aşıldığında istek hata VERMEDEN sessizce kırpılıyor, bu da
    // sharp'ın "Dosya bozuk" hatasına yol açardı. Gerçek üst sınır
    // (MAX_DOCUMENT_SIZE_BYTES, document-validation.ts) 15MB olduğu için
    // multipart/form-data ek yükünü de karşılayacak şekilde 20MB'a çıkarıldı.
    proxyClientMaxBodySize: "20mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
