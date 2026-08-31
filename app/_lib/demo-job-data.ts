/**
 * `app/_lib/jobs.ts` içindeki statik örnek/demo ilanların (`requesterId: null`,
 * hiçbir zaman Supabase/Storage'a değmemiş) yalnızca Local ve Development'ta
 * görünmesini sağlayan TEK merkezi karar noktası. `jobs.ts#getJobs`/`getJobById`
 * (bu fonksiyonun app genelindeki TEK çağıranları) bu kontrolü burada yapar —
 * başka hiçbir dosya/bileşen kendi Supabase ref veya `NODE_ENV` kontrolünü
 * icat etmemelidir (tek bir merkezi yardımcı, dağıtılmış kontroller değil).
 *
 * `NODE_ENV` HİÇ kullanılmaz — bir Vercel Preview build'i de (Production
 * hedefiyle aynı) her zaman `NODE_ENV=production` ile derlenir (`next build`
 * hedef ortamdan bağımsızdır), bu yüzden asıl ve TEK sinyal HANGİ Supabase
 * projesine bağlı olunduğudur (`NEXT_PUBLIC_SUPABASE_URL`, zaten `app/_lib/
 * supabase/env.ts#getSupabaseEnv`in okuduğu AYNI ortam değişkeni). Yerel
 * `next dev` süreci zaten Development ref'ini (`.env.local`) kullandığı için
 * ayrı bir "yerel ortam" istisnasına gerek yoktur — 2. madde bunu zaten kapsar.
 *
 * Karar sırası (güvenli varsayılan — belirsizlikte HER ZAMAN kapalı):
 *   1. Production ref (pltjquhskyckrgtbvgog) açıkça eşleşiyorsa → KAPALI
 *      (Development ref'iyle aynı anda eşleşse bile — pratikte imkansız,
 *      ama bu sıralama Production ref'in HER ZAMAN öncelikli olmasını garanti eder).
 *   2. Development ref (trfnmpihcnriqgikglpu) açıkça eşleşiyorsa → AÇIK.
 *   3. Başka her şey (eksik URL, bilinmeyen bir Supabase projesi, yerel Docker
 *      Supabase, CI, ...) → KAPALI. Fail-closed, koşulsuz.
 */
const PRODUCTION_SUPABASE_REF = "pltjquhskyckrgtbvgog";
const DEVELOPMENT_SUPABASE_REF = "trfnmpihcnriqgikglpu";

export function isDemoJobDataAllowed(): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (supabaseUrl.includes(PRODUCTION_SUPABASE_REF)) return false;
  if (supabaseUrl.includes(DEVELOPMENT_SUPABASE_REF)) return true;
  return false;
}
