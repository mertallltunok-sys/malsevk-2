import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server-client";

/**
 * Admin rotalarının (`app/admin`, `app/admin/iletisim-mesajlari`) TEK
 * server-side koruma noktası — bu görevin gereksinimi: "Admin route'larında
 * yalnız client-side gizleme yeterli değildir... server-side session,
 * profiles.role, gerektiğinde is_admin() RPC ile doğrulanmalı." Her iki
 * sayfanın kendi `page.tsx`'i (Sunucu Bileşeni) render etmeden ÖNCE bu
 * fonksiyonu `await`ler — panel bileşenlerinin (`AdminProviderDocumentReviewPanel`/
 * `ContactMessagesAdminPanel`) kendi `useSession()`/`AuthGateNotice`
 * gösterimi BİLEREK dokunulmadan bırakıldı (bu görevin kapsamı dışı, ayrıca
 * bu sunucu tarafı katmanın ALTINDA ikinci, zararsız bir savunma katmanı
 * olarak kalmaya devam ediyor).
 *
 * - Gerçek bir Supabase kullanıcısı yoksa: `/giris-yap`e yönlendirilir (bkz.
 *   `proxy.ts`nin AYNI `PROTECTED_ROUTE_PREFIXES` koruması — bu, o
 *   koruma bir şekilde atlanırsa/tutarsız davranırsa diye ikinci bir
 *   savunma katmanıdır).
 * - Kullanıcı var ama admin DEĞİLSE: `notFound()` — kaynak uygulamanın
 *   `app/gelistirme/demo-veri-sifirla`de zaten kullandığı AYNI "rotanın
 *   varlığını gizle" deseni (bkz. o sayfanın kendi `notFound()` kullanımı),
 *   "yetkiniz yok" gibi rotanın var olduğunu doğrulayan bir mesaj yerine.
 */
export async function requireAdminOrRedirect(currentPath: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/giris-yap?redirect=${encodeURIComponent(currentPath)}`);
  }

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    notFound();
  }
}
