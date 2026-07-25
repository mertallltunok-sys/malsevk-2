import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSiteAccessGateActive, isValidSiteAccessToken, SITE_ACCESS_COOKIE } from "./app/_lib/site-access";

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
 */
export function proxy(request: NextRequest) {
  if (!isSiteAccessGateActive()) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SITE_ACCESS_COOKIE)?.value;
  if (isValidSiteAccessToken(token)) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Bu API'ye erişim için site şifresi gerekli." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/site-erisim";
  url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // _next dahili dosyaları, favicon ve şifre ekranının kendisi hariç HER
  // istek (sayfalar + /api/* dahil) kapıdan geçer — requirement 5/6.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|site-erisim).*)"],
};
