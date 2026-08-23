import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * `proxy.ts` içinden çağrılır — Supabase erişim token'ı süresi dolmadan
 * ÖNCE her istekte sessizce yeniler (Supabase'in resmi Next.js App Router
 * deseni). Bunu yapmazsak, bir sekmede uzun süre açık kalan bir kullanıcı
 * token süresi dolduğunda sessizce "oturumu kapanmış" gibi davranan
 * bileşenlerle karşılaşabilirdi.
 *
 * `supabase.auth.getUser()` (getSession() DEĞİL) kasıtlı olarak kullanılır —
 * yalnızca yerel çerezi okuyan `getSession()`in aksine, `getUser()` her
 * seferinde Supabase Auth sunucusuna karşı gerçek bir doğrulama isteği atar;
 * bu, proxy.ts'in route korumasının (aşağıda) sahte/bozuk bir çerezle
 * atlatılamamasını garanti eder.
 *
 * `request`/`supabaseResponse` çifti Supabase'in kendi dokümantasyonundaki
 * TAM desendir: `NextResponse.next({request})` her `setAll` çağrısından
 * SONRA yeniden oluşturulur ki hem giden isteğin hem dönen yanıtın çerezleri
 * senkron kalsın — aradaki adımlardan biri atlanırsa oturum yenilemesi
 * sessizce çalışmayı bırakabilir.
 */
export async function updateSupabaseSession(request: NextRequest): Promise<{
  response: NextResponse;
  userId: string | null;
}> {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, userId: user?.id ?? null };
}
