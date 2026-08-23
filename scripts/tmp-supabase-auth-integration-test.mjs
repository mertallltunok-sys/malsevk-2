// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı gerçek Auth
// entegrasyon testleri. Hem ANON (public) hem SECRET (admin, yalnızca test
// kullanıcı kurulumu/temizliği için) anahtar kullanır — SECRET_KEY, bu
// script'i çağıran shell komutu tarafından yalnızca process.env üzerinden
// verilir, hiçbir zaman dosyaya yazılmaz/console.log edilmez. Gerçek dev
// server http://localhost:3001'de çalışıyor olmalıdır.
//
// DÜZELTME (ikinci çalıştırma): ilk çalıştırmada @example.com Supabase'in
// kendi e-posta biçim/alan doğrulamasınca reddedildi (gerçek MX kaydı yok) —
// gerçek MX kaydı olan bir alan adına (gmail.com, rastgele/tek kullanımlık
// yerel kısımla, gerçek bir e-posta ASLA gönderilmiyor çünkü token'lar
// generateLink ile üretiliyor) geçildi. Ayrıca HTTP confirm-route testi ile
// doğrudan-SDK verifyOtp testi ARTIK AYRI kullanıcılar kullanıyor — aynı
// tek-kullanımlık token'ı iki kez tüketmeye çalışmak ilk çalıştırmada 10-15
// numaralı testlerin "token yok" ile atlanmasına yol açmıştı.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = "http://localhost:3001";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni (URL/ANON/SECRET)");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const stamp = Date.now();
const emailA = `malsevk-auth-test-a-${stamp}@gmail.com`; // HTTP /auth/confirm route testi
const emailB = `malsevk-auth-test-b-${stamp}@gmail.com`; // doğrudan SDK verifyOtp + complete_registration RPC testi
const testPassword = "TestSifre2026!";
const createdUserIds = [];

async function main() {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) Public signUp (anon key, GERÇEK public akış) — gmail.com gerçek MX
  //    kaydına sahip olduğu için Supabase'in e-posta doğrulaması bunu kabul
  //    eder; token generateLink ile üretileceği için hiçbir gerçek e-posta
  //    ASLA gönderilmez/okunmaz.
  const signUpRes = await anon.auth.signUp({ email: emailA, password: testPassword });
  record("1. signUp (anon, public akış) başarılı", !signUpRes.error && !!signUpRes.data.user, signUpRes.error?.message);
  const userIdA = signUpRes.data.user?.id;
  if (userIdA) createdUserIds.push(userIdA);
  record("2. signUp anında oturum döndürmüyor (e-posta doğrulaması zorunlu)", signUpRes.data.session === null, signUpRes.data.session ? "session döndü" : "session=null (beklenen)");

  if (userIdA) {
    const { data: profileAfterSignup, error: profileErr } = await admin
      .from("profiles")
      .select("role, account_status, onboarding_completed")
      .eq("id", userIdA)
      .maybeSingle();
    record(
      "3. profiles satırı trigger ile otomatik oluştu (role NULL, account_status active)",
      !!profileAfterSignup && profileAfterSignup.role === null && profileAfterSignup.account_status === "active",
      profileErr?.message || JSON.stringify(profileAfterSignup),
    );
  } else {
    record("3. atlandı (userId yok)", false);
  }

  const unconfirmedLogin = await anon.auth.signInWithPassword({ email: emailA, password: testPassword });
  record("4. Doğrulanmamış e-posta ile login reddedildi", !!unconfirmedLogin.error, unconfirmedLogin.error ? `${unconfirmedLogin.error.code}: ${unconfirmedLogin.error.message}` : "REDDEDİLMEDİ");

  // 5-9: HTTP katmanı — app/auth/confirm/route.ts'i GERÇEK bir token ile uçtan uca test et.
  const linkA = await admin.auth.admin.generateLink({ type: "signup", email: emailA, password: testPassword });
  const tokenHashA = linkA.data?.properties?.hashed_token;
  record("5. generateLink (A) ile token_hash alındı", !!tokenHashA, linkA.error?.message);

  let confirmCookies = "";
  if (tokenHashA) {
    const confirmUrl = `${APP_ORIGIN}/auth/confirm?token_hash=${tokenHashA}&type=signup&next=${encodeURIComponent("/kayit-tamamla")}`;
    const confirmResp = await fetch(confirmUrl, { redirect: "manual" });
    const confirmLocation = confirmResp.headers.get("location") || "";
    confirmCookies = confirmResp.headers.getSetCookie?.().join("; ") ?? confirmResp.headers.get("set-cookie") ?? "";
    record("6. /auth/confirm gerçek token ile /kayit-tamamla'ya yönlendirdi", confirmLocation.includes("/kayit-tamamla"), confirmLocation);
    record("7. /auth/confirm Supabase oturum çerezi kurdu", confirmCookies.length > 0, confirmCookies ? "çerez alındı (değer gösterilmiyor)" : "çerez YOK");

    // 8) Aynı çerezle korumalı olmayan ama oturum gerektiren /kayit-tamamla'ya GET -> 200 (sayfa render edilebiliyor mu, sunucu tarafı çerez okuma çalışıyor mu).
    const cookieHeader = confirmCookies.split(/,\s*(?=[^;=]+=[^;=]+;)/).map((c) => c.split(";")[0]).join("; ");
    const kayitTamamlaResp = await fetch(`${APP_ORIGIN}/kayit-tamamla`, { headers: { Cookie: cookieHeader } });
    record("8. Çerezle /kayit-tamamla 200 döndü", kayitTamamlaResp.status === 200, String(kayitTamamlaResp.status));
  } else {
    record("6. atlandı (token yok)", false);
    record("7. atlandı (token yok)", false);
    record("8. atlandı (token yok)", false);
  }

  // 9) Bozuk/geçersiz token ile /auth/confirm -> hata sayfasına güvenli yönlendirme.
  const badConfirmResp = await fetch(`${APP_ORIGIN}/auth/confirm?token_hash=gecersiz-token&type=signup`, { redirect: "manual" });
  const badLocation = badConfirmResp.headers.get("location") || "";
  record("9. Geçersiz token /giris-yap?hata=... adresine güvenli yönlendirildi", badLocation.includes("hata=dogrulama-basarisiz"), badLocation);

  // 10-15: doğrudan SDK (verifyOtp) + complete_registration RPC — AYRI kullanıcı (B), token çakışması olmasın diye.
  const signUpB = await anon.auth.signUp({ email: emailB, password: testPassword });
  const userIdB = signUpB.data.user?.id;
  if (userIdB) createdUserIds.push(userIdB);

  const linkB = await admin.auth.admin.generateLink({ type: "signup", email: emailB, password: testPassword });
  const tokenHashB = linkB.data?.properties?.hashed_token;
  const sessionClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const verifyRes = tokenHashB ? await sessionClient.auth.verifyOtp({ type: "signup", token_hash: tokenHashB }) : { error: { message: "token yok" } };
  record("10. verifyOtp ile gerçek oturum kuruldu", !!verifyRes.data?.session, verifyRes.error?.message);

  let completedOk = false;
  if (verifyRes.data?.session) {
    const roleCheck = await sessionClient.from("profiles").select("role").eq("id", userIdB).maybeSingle();
    record("11. Doğrulama sonrası role hâlâ NULL (complete_registration bekleniyor)", roleCheck.data?.role === null, JSON.stringify(roleCheck.data));

    const badRole = await sessionClient.rpc("complete_registration", {
      p_role: "admin", p_full_name: "Test Kullanıcı", p_phone: "+905551234567",
      p_company_name: "Test Firma", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("12. complete_registration admin rolünü ML100 ile reddetti", badRole.error?.code === "ML100", `${badRole.error?.code}: ${badRole.error?.message}`);

    const missingField = await sessionClient.rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "", p_phone: "+905551234567",
      p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("13. complete_registration eksik alanı ML102 ile reddetti", missingField.error?.code === "ML102", `${missingField.error?.code}: ${missingField.error?.message}`);

    const okComplete = await sessionClient.rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "Test Kullanıcı", p_phone: "+905551234567",
      p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    completedOk = !okComplete.error && okComplete.data?.role === "hizmet-alan";
    record("14. complete_registration geçerli veriyle başarılı", completedOk, okComplete.error?.message || JSON.stringify(okComplete.data));

    const secondAttempt = await sessionClient.rpc("complete_registration", {
      p_role: "hizmet-alan", p_full_name: "Test Kullanıcı 2", p_phone: "+905551234567",
      p_company_name: "Test Firma", p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
    });
    record("15. İkinci complete_registration denemesi ML101 ile reddedildi", secondAttempt.error?.code === "ML101", `${secondAttempt.error?.code}: ${secondAttempt.error?.message}`);
  } else {
    for (const n of [11, 12, 13, 14, 15]) record(`${n}. atlandı (oturum yok)`, false);
  }

  // 16-17: login (B, artık doğrulanmış + tamamlanmış).
  if (completedOk) await sessionClient.auth.signOut();
  const okLogin = await anon.auth.signInWithPassword({ email: emailB, password: testPassword });
  record("16. Doğrulanmış+tamamlanmış hesapla login başarılı", !okLogin.error && !!okLogin.data.session, okLogin.error?.message);

  const wrongPassword = await anon.auth.signInWithPassword({ email: emailB, password: "YanlisSifre123!" });
  record("17. Yanlış şifre reddedildi", !!wrongPassword.error, wrongPassword.error ? wrongPassword.error.code : "REDDEDİLMEDİ");

  // 18-19: şifre sıfırlama recovery akışı (A kullanıcısı üzerinde, henüz doğrulanmamış olsa da resetPasswordForEmail zaten çalışır).
  const recoveryLink = await admin.auth.admin.generateLink({ type: "recovery", email: emailB });
  const recoveryTokenHash = recoveryLink.data?.properties?.hashed_token;
  record("18. Recovery generateLink token_hash alındı", !!recoveryTokenHash, recoveryLink.error?.message);
  if (recoveryTokenHash) {
    const recoveryConfirmResp = await fetch(`${APP_ORIGIN}/auth/confirm?token_hash=${recoveryTokenHash}&type=recovery`, { redirect: "manual" });
    const recoveryLocation = recoveryConfirmResp.headers.get("location") || "";
    record("19. Recovery /auth/confirm -> /sifre-guncelle yönlendirdi", recoveryLocation.includes("/sifre-guncelle"), recoveryLocation);
  } else {
    record("19. atlandı (recovery token yok)", false);
  }

  // 20: is_admin() — role='hizmet-alan' olan (B, tamamlanmış) kullanıcı için false dönmeli.
  if (okLogin.data.session) {
    const freshClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await freshClient.auth.setSession(okLogin.data.session);
    const isAdminRes = await freshClient.rpc("is_admin");
    record("20. is_admin() normal (hizmet-alan) kullanıcı için false", isAdminRes.data === false, JSON.stringify(isAdminRes.data));
    await freshClient.auth.signOut();
  } else {
    record("20. atlandı (oturum yok)", false);
  }

  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== ÖZET ===");
  console.log(`Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Başarısız testler:", failed.map((f) => f.name).join(" | "));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
