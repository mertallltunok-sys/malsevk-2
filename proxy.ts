import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSiteAccessGateActive, isValidSiteAccessToken, SITE_ACCESS_COOKIE } from "./app/_lib/site-access";
import { updateSupabaseSession } from "./app/_lib/supabase/middleware-client";

/**
 * Supabase Auth entegrasyonundan (bkz. session.ts) önce oturum açması
 * ZORUNLU rota önekleri — "en azından ilan oluşturma, teklif ekranları,
 * kullanıcı profili, belge yükleme, mesajlar, admin rotaları" görev
 * gereksinimini karşılar: `/panel/*` (profil, hesap ayarları, gelen
 * teklifler/verdiğim teklifler, bildirimler hepsi bu önek altında),
 * `/hizmet-talebi-olustur` (ilan oluşturma), `/admin/*` (bkz. admin
 * rotalarının AYRICA server-side `is_admin()` kontrolü için kendi
 * `page.tsx`'lerine bakın — bu yalnızca "oturum var mı" seviyesindedir) ve
 * `/kayit-tamamla` (yalnızca gerçek bir Supabase kullanıcısı ULAŞABİLİR —
 * "oturum var mı" kontrolü burada da yeterlidir, `role`in dolu/boş olması
 * `app/kayit-tamamla`in kendi bileşen-seviyesi kontrolüyle ayrıca ele alınır).
 * BİLEREK `/ilanlar/*`e uygulanmaz: o rota, misafirlerin ilan
 * görüntüleyebildiği (bkz. job-detail-content.tsx, role ile kapılı değil)
 * genel bir listeleme sayfasıyla, yalnızca sahibinin erişebildiği düzenleme
 * alt rotasını aynı önek altında karıştırır — bu ayrımı yanlış yapmak ya
 * misafir gezinmesini kırar ya da hiçbir koruma sağlamaz; bu yüzden bu
 * turda yalnızca her zaman TAMAMEN oturum gerektiren önekler eklendi (bkz.
 * son rapor "Bulunan risk" maddesi).
 */
const PROTECTED_ROUTE_PREFIXES = ["/panel", "/hizmet-talebi-olustur", "/admin", "/kayit-tamamla"];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Site geneli geçici geliştirme şifre kapısı. Uygulamanın kendi kullanıcı
 * giriş sistemiyle (users.ts/session.ts) İLGİSİZ, ondan tamamen ÖNCE
 * çalışan bir ağ katmanı — hiçbir iş mantığına/localStorage verisine dokunmaz.
 *
 * Yalnızca `NODE_ENV === "production"`da etkindir (Vercel preview/production
 * dahil — `next build` her ikisinde de NODE_ENV=production ayarlar). `npm
 * run dev` (yerel geliştirme) sırasında kapı tamamen devre dışıdır; mevcut
 * geliştirici deneyimi (browser-test-*.mjs script'leri, manuel test) hiç
 * etkilenmez. `npm run build && npm start` ile yerel "prod modu" test
 * ediliyorsa (`.env.local`'da tmp-*-prod.mjs script'leri için kullanılan
 * yöntem), bu kapı da Vercel'deki gibi etkinleşir — MALSEVK_SITE_PASSWORD
 * tanımlanmadan o script'ler artık geçemez; bu bilinçli bir davranıştır
 * (bkz. "Kalan riskler" raporu), ayrı bir istisna eklenmedi.
 *
 * Bu kapıdan SONRA, Supabase Auth entegrasyonu iki ayrı iş yapar: (1) her
 * istekte `updateSupabaseSession` ile erişim token'ını sessizce yeniler
 * (bkz. o dosyanın dokümantasyonu — bunu atlarsak uzun süre açık kalan bir
 * sekme token süresi dolunca sessizce "çıkış yapılmış" gibi davranırdı), (2)
 * yukarıdaki `PROTECTED_ROUTE_PREFIXES`e giren bir istekte gerçek bir
 * Supabase kullanıcısı yoksa `/giris-yap?redirect=...`e yönlendirir —
 * `app/giris-yap/page.tsx`in zaten okuduğu AYNI `redirect` query param'ı
 * kullanılır, yeni bir yönlendirme sözleşmesi icat edilmez. Redirect
 * döngüsü riski yok: `/giris-yap`in kendisi `PROTECTED_ROUTE_PREFIXES`e
 * girmez.
 */
export async function proxy(request: NextRequest) {
  if (isSiteAccessGateActive()) {
    const token = request.cookies.get(SITE_ACCESS_COOKIE)?.value;
    if (!isValidSiteAccessToken(token)) {
      const { pathname } = request.nextUrl;

      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Bu API'ye erişim için site şifresi gerekli." }, { status: 401 });
      }

      const url = request.nextUrl.clone();
      url.pathname = "/site-erisim";
      url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
  }

  const { response, userId } = await updateSupabaseSession(request);

  const { pathname } = request.nextUrl;
  if (isProtectedRoute(pathname) && !userId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Bu işlem için giriş yapmalısınız." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/giris-yap";
    url.search = `?redirect=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // _next dahili dosyaları, favicon ve şifre ekranının kendisi hariç HER
  // istek (sayfalar + /api/* dahil) kapıdan geçer — requirement 5/6.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|site-erisim).*)"],
};
