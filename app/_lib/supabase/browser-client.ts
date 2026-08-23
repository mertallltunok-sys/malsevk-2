import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Tarayıcıda kullanılan TEK Supabase istemci FABRİKASI — Supabase'in kendi
 * resmi Next.js App Router deseniyle birebir aynı (bir fonksiyon, önceden
 * hesaplanmış bir modül-seviyesi sabit DEĞİL): `createBrowserClient` çağrı
 * başına yeni bir nesne üretir ama kimlik doğrulama depolama katmanı
 * (tarayıcı çerezleri) tüm çağrılar arasında zaten Supabase'in kendi iç
 * mekanizmasıyla tutarlıdır. Modül seviyesinde ÖNCEDEN çağrılmaz — yalnızca
 * bu dosyayı (dolaylı olarak sunucu bileşenlerinden bile) import eden her
 * yerin SSR sırasında `document`a dokunmaya ÇALIŞMASINI değil, yalnızca
 * gerçekten tarayıcıda çağrıldığında dokunmasını garanti eder.
 *
 * Her çağıran (session.ts, login-form.tsx, ...) AYNI bu fabrikayı kullanır —
 * "tek merkezi istemci mimarisi" gereksinimi bu tek dosyayla karşılanır,
 * hiçbir bileşen kendi `createBrowserClient` çağrısını tekrarlamaz.
 * `service_role` burada ASLA yoktur (bkz. env.ts) — yalnızca public URL +
 * anon/publishable anahtar.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
