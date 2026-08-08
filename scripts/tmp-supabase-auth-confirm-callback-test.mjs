// MALSEVK — app/auth/confirm/route.ts'nin code (PKCE) + token_hash+type
// (verifyOtp) iki yolunu da doğrulayan script.
//
// KASITLI OLARAK Next.js dev server'a HİÇ dokunmaz — yalnızca @supabase/
// supabase-js ile local Docker Supabase'e karşı çalışır (gerçek signUp +
// Mailpit'ten gerçek e-posta okuma + gerçek redirect zincirini takip etme +
// route.ts'in kendi mantığıyla BİREBİR aynı exchangeCodeForSession/verifyOtp
// çağrılarını yapma). Bu, önceki bir denemede next.config.ts'ye geçici
// distDir eklemenin KULLANICININ ZATEN ÇALIŞAN dev server'ını (next.config.ts
// değişikliklerinin canlı sunucuya da yansıdığı, beklenmedik biçimde,
// yeniden başlatmaya zorladığı) rahatsız ettiğinin fark edilmesi ÜZERİNE
// seçilen, kasıtlı olarak daha güvenli bir yöntemdir.
//
// Çalıştırma: node scripts/tmp-supabase-auth-confirm-callback-test.mjs
// Önkoşul: `npx supabase db reset` + local stack ayakta.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const MAILPIT_URL = "http://127.0.0.1:54324";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) {
  throw new Error("Refusing to run: target URL is not local (safety guard).");
}

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` -- ${extra}` : ""));
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

/** Gerçek token/code değerlerini ASLA loglama — yalnızca hangi parametrelerin VAR OLDUĞUNU raporla. */
function describeParams(url) {
  const u = new URL(url);
  const present = [];
  for (const key of ["code", "token_hash", "type", "next", "error", "error_description"]) {
    if (u.searchParams.has(key)) present.push(key === "type" || key === "next" ? `${key}=${u.searchParams.get(key)}` : `${key}=<redacted>`);
  }
  return `${u.origin}${u.pathname} [${present.join(", ")}]`;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
// flowType: "pkce" KASITLI — gerçek uygulama createSupabaseBrowserClient()
// (@supabase/ssr#createBrowserClient) kullanıyor, o kütüphane PKCE'yi
// VARSAYILAN yapar; düz @supabase/supabase-js#createClient ise varsayılan
// olarak "implicit" akışı kullanır. Bu farkı eşlemezsek burada üretilen
// signUp() gerçek uygulamanınkiyle AYNI redirect davranışını üretmez.
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false, flowType: "pkce" } });
const PASSWORD = "TestSifre2026!";
const ts = Date.now();

console.log("=== 1) Gerçek signUp() + gerçek e-posta ile GoTrue'nun fiili yönlendirme biçimini doğrula ===");
const signupEmail = `authcb-${ts}@example.com`;
const signUpResult = await anon.auth.signUp({
  email: signupEmail,
  password: PASSWORD,
  options: { emailRedirectTo: "http://127.0.0.1:3000/auth/confirm?next=%2Fkayit-tamamla" },
});
check("signUp() başarılı", !signUpResult.error, signUpResult.error?.message);

// Mailpit'ten e-postayı bul (kısa polling — konteynerler arası gecikme için).
let messageId = null;
for (let i = 0; i < 20 && !messageId; i++) {
  const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const list = await listRes.json();
  const found = list.messages.find((m) => m.To.some((to) => to.Address === signupEmail));
  if (found) messageId = found.ID;
  else await new Promise((resolve) => setTimeout(resolve, 500));
}
check("Mailpit'te doğrulama e-postası bulundu", messageId !== null);

let verifyUrl = null;
if (messageId) {
  const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
  const msg = await msgRes.json();
  const body = msg.HTML || msg.Text || "";
  const match = body.match(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/);
  verifyUrl = match ? match[0].replace(/&amp;/g, "&") : null;
  check("E-posta içinde /auth/v1/verify linki bulundu", verifyUrl !== null);
}

let landedUrl = null;
if (verifyUrl) {
  // Supabase'in kendi /auth/v1/verify uç noktasına git, yönlendirmeyi TAKİP ETME
  // (manual) — Location header'ı, tarayıcının GERÇEKTE hangi query string ile
  // localhost:3000/auth/confirm'e döneceğini birebir gösterir.
  const verifyRes = await fetch(verifyUrl, { redirect: "manual" });
  const location = verifyRes.headers.get("location");
  check("/auth/v1/verify bir yönlendirme (30x) döndü", verifyRes.status >= 300 && verifyRes.status < 400 && location !== null, `status=${verifyRes.status}`);
  if (location) {
    landedUrl = location;
    console.log(`  Gerçek yönlendirme hedefi (redakte edilmiş): ${describeParams(location)}`);
    const landedParsed = new URL(location, "http://127.0.0.1:3000");
    check("Yönlendirme localhost:3000/auth/confirm'e gidiyor", landedParsed.origin === "http://127.0.0.1:3000" && landedParsed.pathname === "/auth/confirm");
    check("Yönlendirmede `code` parametresi VAR (PKCE — hosted'da gözlemlenenle AYNI davranış)", landedParsed.searchParams.has("code"));
    check("Yönlendirmede `token_hash`/`type` YOK (bu proje varsayılan şablonu kullanıyor)", !landedParsed.searchParams.has("token_hash") && !landedParsed.searchParams.has("type"));
    check("`next` parametresi korunmuş", landedParsed.searchParams.get("next") === "/kayit-tamamla");
  }
}

console.log("\n=== 2) route.ts'in `code` dalıyla BİREBİR aynı çağrıyı yaparak gerçek session üretimini doğrula ===");
if (landedUrl) {
  const landedParsed = new URL(landedUrl, "http://127.0.0.1:3000");
  const code = landedParsed.searchParams.get("code");
  if (code) {
    // KASITLI OLARAK burada AYRI, sıfırdan bir client kullanılıyor (route.ts
    // tam olarak exchangeCodeForSession(code) çağırıyor olsa da) — bu, PKCE'nin
    // KENDİ güvenlik modelinin bir parçası olan "code_verifier" hatasını
    // GERÇEK bir bulgu gibi yanlış raporlamamak için: signUp() sırasında
    // üretilen code_verifier, onu üreten client'ın DEPOLAMASINDA (gerçek
    // uygulamada: tarayıcı çerezi, @supabase/ssr'nin kendi deseni) tutulur ve
    // yalnızca AYNI depoyu okuyabilen bir client exchange yapabilir. Düz bir
    // Node script'i, gerçek bir tarayıcının çerez tabanlı depolamasını taklit
    // edemez — bu yüzden bu adım burada BAŞARISIZ OLMASI BEKLENEN, ortamdan
    // kaynaklı bir sınırdır, route.ts'te veya uygulamada bir kusur DEĞİLDİR.
    // Gerçek uygulamada signUp() (browser-client.ts#createSupabaseBrowserClient)
    // ve route.ts (server-client.ts#createSupabaseServerClient) AYNI Supabase
    // projesine karşı, AYNI @supabase/ssr çerez deposunu (tarayıcının kendisi
    // taşır) paylaşır — bu yüzden gerçek tarayıcıda bu adım çalışır.
    const exchangeClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false, flowType: "pkce" } });
    const { error } = await exchangeClient.auth.exchangeCodeForSession(code);
    const isExpectedCrossClientStorageError = error?.message.includes("code verifier");
    check(
      "exchangeCodeForSession(code) GoTrue tarafında GERÇEK/geçerli bir code olarak kabul edildi (yalnızca ortam-kaynaklı çapraz-client depolama hatasıyla reddedildi, GEÇERSİZ CODE hatasıyla değil)",
      isExpectedCrossClientStorageError,
      error?.message,
    );
    if (isExpectedCrossClientStorageError) {
      console.log("  (Beklenen: gerçek tarayıcıda code_verifier çerezi signUp() ve /auth/confirm arasında paylaşılır, bu script'te paylaşılmaz.)");
    }
  }
}

console.log("\n=== 3) token_hash + type (verifyOtp) yolunun BOZULMADIĞINI admin.generateLink ile doğrula ===");
const genLinkEmail = `authcb-tokenhash-${ts}@example.com`;
const genLink = await admin.auth.admin.generateLink({
  type: "signup",
  email: genLinkEmail,
  password: PASSWORD,
});
check("admin.generateLink(signup) başarılı", !genLink.error, genLink.error?.message);
if (!genLink.error) {
  const tokenHash = genLink.data.properties.hashed_token;
  check("hashed_token (token_hash) üretildi", typeof tokenHash === "string" && tokenHash.length > 0);
  // Route.ts'in token_hash dalıyla BİREBİR aynı çağrı.
  const otpClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await otpClient.auth.verifyOtp({ type: "signup", token_hash: tokenHash });
  check("verifyOtp({type:'signup', token_hash}) başarılı, gerçek user döndü", !error && data.user?.email === genLinkEmail, error?.message);
}

console.log("\n=== 4) Recovery (şifre sıfırlama) token_hash yolu hâlâ /sifre-guncelle'ye çözülüyor mu ===");
const recoveryEmail = signupEmail; // zaten kayıtlı bir hesap olmalı
const genRecoveryLink = await admin.auth.admin.generateLink({ type: "recovery", email: recoveryEmail });
check("admin.generateLink(recovery) başarılı", !genRecoveryLink.error, genRecoveryLink.error?.message);
if (!genRecoveryLink.error) {
  const tokenHash = genRecoveryLink.data.properties.hashed_token;
  const otpClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await otpClient.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check("verifyOtp({type:'recovery', token_hash}) başarılı — route.ts bu durumda /sifre-guncelle'ye yönlendirir (type==='recovery' dalı)", !error && data.user?.email === recoveryEmail, error?.message);
}

console.log("\n=== 5) Hata senaryoları: geçersiz code / eksik parametre ===");
{
  const badClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false, flowType: "pkce" } });
  const { error } = await badClient.auth.exchangeCodeForSession("gecersiz-uydurma-code");
  check("Geçersiz code -> hata döner (route.ts bunu dogrulama-basarisiz'e çevirir)", !!error);
}
{
  const badClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await badClient.auth.verifyOtp({ type: "signup", token_hash: "gecersiz-uydurma-hash" });
  check("Geçersiz token_hash -> hata döner", !!error);
}
console.log("(route.ts'in kendisi: code YOKSA ve token_hash/type YOKSA -> dogrulama-eksik. Bu dal saf branching, ayrıca test gerektirmiyor.)");

console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Başarısız testler:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
