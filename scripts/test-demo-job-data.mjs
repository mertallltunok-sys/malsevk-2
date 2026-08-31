// node scripts/test-demo-job-data.mjs
//
// demo-job-data.ts#isDemoJobDataAllowed'ın, statik demo ilanların (jobs.ts)
// Production'da kesinlikle görünmemesini sağlayan TEK karar noktasının, SAF
// mantığını doğrudan üretim koduna karşı test eder — sunucu/tarayıcı
// gerektirmez (bkz. test-photo-feature.mjs'in aynı deseni). Fonksiyon her
// çağrıda `process.env`i taze okur (modül yüklemesinde ÖNBELLEKLEMEZ), bu
// yüzden test senaryoları arasında ortam değişkenleri doğrudan mutasyonla
// değiştirilebilir.

import assert from "node:assert/strict";
import { isDemoJobDataAllowed } from "../app/_lib/demo-job-data.ts";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;

function setEnv(url, nodeEnv) {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}

let passed = 0;
function check(label, actual, expected) {
  assert.equal(actual, expected, `${label}: beklenen ${expected}, gelen ${actual}`);
  console.log(`PASS - ${label}`);
  passed++;
}

try {
  // 1) Production ref — kesin KAPALI, NODE_ENV ne olursa olsun (Production
  //    ref her zaman NODE_ENV'den önce kontrol edilir, asla ters çevrilemez;
  //    NODE_ENV artık fonksiyonun hiçbir dalında OKUNMUYOR bile — bu iki
  //    senaryo yalnızca "NODE_ENV'in hiçbir etkisi kalmadığını" kanıtlamak
  //    için ayrı tutuluyor).
  setEnv("https://pltjquhskyckrgtbvgog.supabase.co", "production");
  check("Production ref + NODE_ENV=production → kapalı", isDemoJobDataAllowed(), false);

  setEnv("https://pltjquhskyckrgtbvgog.supabase.co", "development");
  check("Production ref + NODE_ENV=development → KESİNLİKLE yine de kapalı", isDemoJobDataAllowed(), false);

  // 2) Development ref — AÇIK, NODE_ENV ne olursa olsun.
  setEnv("https://trfnmpihcnriqgikglpu.supabase.co", "production");
  check("Development ref + NODE_ENV=production → açık", isDemoJobDataAllowed(), true);

  setEnv("https://trfnmpihcnriqgikglpu.supabase.co", "development");
  check("Development ref + NODE_ENV=development → açık", isDemoJobDataAllowed(), true);

  // 3) Bilinmeyen/farklı bir Supabase projesi — artık NODE_ENV'den TAMAMEN
  //    bağımsız olarak koşulsuz KAPALI (önceki "yerel Docker Supabase"
  //    istisnası kaldırıldı — eksik/bilinmeyen URL'lerde demo ilanları
  //    açabiliyordu, bu da istenen fail-closed kuralını tam karşılamıyordu).
  setEnv("http://127.0.0.1:54321", "development");
  check("Bilinmeyen Supabase projesi + NODE_ENV=development → kapalı (artık AÇIK değil)", isDemoJobDataAllowed(), false);

  setEnv("http://127.0.0.1:54321", "production");
  check("Bilinmeyen Supabase projesi + NODE_ENV=production → kapalı", isDemoJobDataAllowed(), false);

  setEnv("http://127.0.0.1:54321", undefined);
  check("Bilinmeyen Supabase projesi + NODE_ENV tanımsız → kapalı", isDemoJobDataAllowed(), false);

  // 4) Eksik/tanımsız URL — güvenli varsayılan: KAPALI, NODE_ENV'den bağımsız.
  setEnv(undefined, "production");
  check("Eksik URL + NODE_ENV=production → kapalı", isDemoJobDataAllowed(), false);

  setEnv(undefined, "development");
  check("Eksik URL + NODE_ENV=development → kapalı (artık AÇIK değil)", isDemoJobDataAllowed(), false);

  setEnv(undefined, undefined);
  check("Hiçbir ortam değişkeni tanımsız → kapalı (fail-closed)", isDemoJobDataAllowed(), false);

  console.log(`\n${passed}/${passed} kontrol geçti.`);
} finally {
  setEnv(originalUrl, originalNodeEnv);
}
