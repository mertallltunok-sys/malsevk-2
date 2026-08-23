import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Sunucu Bileşenleri / Route Handler'lar / Server Action'lar için Supabase
 * istemci fabrikası — kullanıcının oturumunu `next/headers#cookies()`
 * üzerinden okur, `localStorage`/tarayıcı belleği DEĞİL. Next.js 16'da
 * `cookies()` asenkron olduğu için bu fonksiyon da asenkrondur.
 *
 * `setAll` bir Sunucu Bileşeni içinde çağrılırsa Next.js bir hata fırlatır
 * (Sunucu Bileşenleri istek sırasında çerez YAZAMAZ) — bu beklenen ve
 * ZARARSIZDIR: oturum yenileme (token refresh) çerez yazımı zaten
 * `proxy.ts`/`middleware-client.ts` tarafından her istekte ayrıca yapılır
 * (bkz. o dosyanın dokümantasyonu), bu yüzden burada sessizce yutulur. Route
 * Handler'lardan (ör. `app/auth/confirm/route.ts`) çağrıldığında ise çerez
 * yazımı gerçekten gerçekleşir ve sorunsuz çalışır.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Bkz. yukarıdaki fonksiyon dokümantasyonu — Sunucu Bileşeni bağlamında beklenen, zararsız durum.
        }
      },
    },
  });
}
