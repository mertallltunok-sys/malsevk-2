import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType, User } from "@supabase/supabase-js";
import { isSafeNextPath } from "../../_lib/site-access";
import { createSupabaseServerClient } from "../../_lib/supabase/server-client";

/**
 * Supabase Auth'ın e-posta bağlantılarının (kayıt doğrulama VE şifre
 * sıfırlama, `type=recovery`) TEK ortak varış noktası.
 *
 * İKİ FARKLI GERİ DÖNÜŞ BİÇİMİNİ AYNI ANDA DESTEKLER (gerçek e-posta linki
 * üzerinden doğrulandı — bkz. sohbet geçmişi):
 *   1. `code` (PKCE) — `@supabase/ssr`'nin `createBrowserClient`/
 *      `createServerClient`'ı (browser-client.ts/server-client.ts, hiçbir
 *      flowType override'ı yok) VARSAYILAN olarak PKCE akışını kullanır.
 *      Hosted development projesindeki e-posta şablonu hâlâ Supabase'in
 *      varsayılan `{{ .ConfirmationURL }}` değişkenini kullandığı sürece
 *      (özel token_hash şablonuna geçilmedi), tıklanan link önce Supabase'in
 *      kendi `/auth/v1/verify` uç noktasına gider, doğrulama ORADA yapılır,
 *      ve tarayıcı buraya `token_hash`/`type` DEĞİL bir PKCE `code` ile geri
 *      döner — `exchangeCodeForSession(code)` ile gerçek bir oturuma çevrilir.
 *   2. `token_hash` + `type` — e-posta şablonu ileride `{{ .SiteURL }}/auth/
 *      confirm?token_hash={{ .TokenHash }}&type=...&next=...` biçiminde özel
 *      bir şablona geçirilirse (bu dosyanın önceki tasarımı, Supabase'in
 *      resmi Next.js App Router deseni), doğrulama BURADA `verifyOtp` ile
 *      yapılır — eski/kullanımdan kaldırılmış "implicit grant" (URL
 *      fragment'ı içinde token) deseni DEĞİL.
 * İki yol da BİRBİRİNİ DIŞLAMAZ — hangisi gelirse o işlenir, `code` önce
 * kontrol edilir (bugünkü fiili davranış budur) ama `token_hash`+`type`
 * deseni bozulmadan korunur.
 *
 * `next` parametresi `isSafeNextPath` (bkz. site-access.ts, açık yönlendirme
 * önlemi için zaten var olan TEK doğruluk kaynağı) ile doğrulanır — yalnızca
 * site-içi, göreli bir yola izin verilir; keyfi/dış bir adrese asla
 * yönlendirilmez. `code` yolunda GoTrue'nun `redirect_to`'ya (yani
 * `emailRedirectTo` olarak gönderdiğimiz TAM URL'ye) `code`'u EKLEMESİ
 * sayesinde `next` sorgu parametresi bu yolda da aynı şekilde korunur.
 *
 * NOT (recovery/`code` etkileşimi): `forgot-password-form.tsx#resetPasswordForEmail`
 * `redirectTo` olarak doğrudan `/sifre-guncelle`yi kullanır — bu route'a HİÇ
 * uğramaz (tarayıcının `@supabase/ssr` istemcisi orada `code`'u kendiliğinden,
 * sayfa yüklenirken otomatik olarak değiştirir). Bu yüzden buraya bir `code`
 * ile gelen istek, bugünkü gerçek kablolamada HER ZAMAN kayıt doğrulamasıdır
 * — `type` parametresi GERÇEKTEN de mevcutsa (bazı Supabase yapılandırmaları
 * `code`'un yanına `type` da ekleyebilir) yine de ona öncelik verilir, böylece
 * recovery şablonu ileride bu route'a yönlendirilecek şekilde değişse bile
 * doğru dala düşer.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next");
  const safeNext = rawNext && isSafeNextPath(rawNext) ? rawNext : null;

  const supabase = await createSupabaseServerClient();

  let user: User;
  if (code) {
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/giris-yap?hata=dogrulama-basarisiz`);
    }
    user = data.user;
  } else if (tokenHash && type) {
    const { error, data } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/giris-yap?hata=dogrulama-basarisiz`);
    }
    user = data.user;
  } else {
    return NextResponse.redirect(`${origin}/giris-yap?hata=dogrulama-eksik`);
  }

  // Şifre sıfırlama: gerçek bir (recovery) oturum artık kuruldu — yeni şifre
  // belirleme ekranına gider, kayıt tamamlama akışıyla hiç kesişmez. Yukarıdaki
  // dosya notunda açıklandığı gibi `code` yolunda bugün fiilen hiç
  // tetiklenmez (recovery /sifre-guncelle'ye doğrudan gider) ama `type`
  // gerçekten "recovery" olarak gelirse yine de doğru şekilde ele alınır.
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}${safeNext ?? "/sifre-guncelle"}`);
  }

  // Kayıt doğrulama (signup/email/magiclink/invite/code): kayıt zaten
  // tamamlanmışsa (ör. eski/tekrar tıklanmış bir bağlantı) doğrudan panele,
  // değilse kayıt tamamlama ekranına gider — `next` yalnızca kayıt henüz
  // tamamlanmamışken saygı görür, tamamlanmış bir hesabı asla eski bir
  // "next=/kayit-tamamla" değerine geri göndermez.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string | null }>();

  const destination = profile?.role ? "/panel" : (safeNext ?? "/kayit-tamamla");
  return NextResponse.redirect(`${origin}${destination}`);
}
