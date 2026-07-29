import type { NextConfig } from "next";

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
};

export default nextConfig;
