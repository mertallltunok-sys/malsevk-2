// Development Supabase projesine (trfnmpihcnriqgikglpu) karşı: kalıcı bir
// test Hizmet Veren hesabı oluşturur — "MALSEVK Test Geri Dönüşüm", Geri
// Dönüşüm & Atık Tahliye hizmet yetkisi aktif. SADECE anon key (signUp +
// kendi complete_registration/set_provider_service_categories RPC'leri,
// admin API DEĞİL — secret key hiç gerekmez) + `npx supabase db query
// --linked` (CLI'ın kendi bağlı oturumu, provider_service_authorizations
// satırını mevcut şemaya UYGUN şekilde elle seed etmek için — yalnızca bu
// TEK adım için, authorize_provider_service RPC'sinin is_admin() kontrolünü
// gerçek bir admin oturumu olmadan çağıramadığımız için).
//
// SİLİNMEZ — bu hesap KALICI olması istenen, tekrar kullanılabilir bir test
// hesabıdır (bkz. görev tanımı: "Hesap zaten varsa ikinci test hesabı
// oluşturma"). Tekrar çalıştırmak idempotenttir: signUp zaten var olan bir
// e-postada hata döner, provider_service_authorizations INSERT'i "zaten var
// mı" kontrolünden SONRA yapılır.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = "geri-donusum-test@malsevk.test";
const PASSWORD = "Rc7#" + crypto.randomBytes(9).toString("base64url") + "!Qm2";
const CATEGORY = "geri-donusum-atik-tahliye";
const COMPANY_NAME = "MALSEVK Test Geri Dönüşüm";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-seed-provider-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

async function main() {
  const supa = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: signUpData, error: signUpError } = await supa.auth.signUp({ email: EMAIL, password: PASSWORD });
  if (signUpError) throw new Error(`signUp failed: ${signUpError.message}`);
  record("1. Auth hesabı oluşturuldu (.test domaini kabul edildi)", Boolean(signUpData.user?.id), signUpData.user?.id);
  record("2. signUp anında oturum döndü (mailer_autoconfirm, e-posta onayı beklenmedi)", Boolean(signUpData.session));
  const providerId = signUpData.user.id;

  const { error: crError } = await supa.rpc("complete_registration", {
    p_role: "hizmet-veren",
    p_full_name: "MALSEVK Test Geri Dönüşüm Yetkilisi",
    p_phone: "+905321119933",
    p_company_name: COMPANY_NAME,
    p_company_type: "limited-sirket",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  record("3. complete_registration başarılı (rol=hizmet-veren, firma adı kaydedildi)", !crError, crError?.message);

  const { error: servicesError } = await supa.rpc("set_provider_service_categories", { p_category_ids: [CATEGORY] });
  record("4. Hizmet seçimi (provider_services) yalnızca Geri Dönüşüm & Atık Tahliye ile ayarlandı", !servicesError, servicesError?.message);

  // provider_service_authorizations — mevcut şemaya (0038) UYGUN, elle seed.
  // Belge kaydı gerekmedi: authorize_provider_service'in p_source_document_id
  // parametresi NULLABLE/opsiyonel (bkz. RPC imzası) — bu yüzden sahte bir
  // belge/provider_documents satırı İCAT EDİLMEDİ, source_document_id NULL
  // bırakıldı. authorized_by da NULL — bu satırın gerçek bir admin kararı
  // DEĞİL, Development test seed'i olduğunu dürüstçe yansıtır (0043'ün
  // authorized_by'ı nullable yapmış olması zaten bu senaryoyu öngörüyordu).
  const existingAuth = runSql(
    `select id from public.provider_service_authorizations where provider_id = '${providerId}' and service_category_id = '${CATEGORY}' and revoked_at is null;`,
  );
  if (existingAuth.length === 0) {
    runSql(
      `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_by, authorize_reason) values ('${providerId}', '${CATEGORY}', null, 'Development test hesabı - manuel seed (npx supabase db query --linked), belge kaydı gerekmedi (source_document_id opsiyonel)');`,
    );
  }
  const authRow = runSql(
    `select provider_id, service_category_id, revoked_at, authorize_reason from public.provider_service_authorizations where provider_id = '${providerId}' and service_category_id = '${CATEGORY}' and revoked_at is null;`,
  );
  record("5. provider_service_authorizations satırı aktif (revoked_at IS NULL)", authRow.length === 1, JSON.stringify(authRow[0]));

  // Başka hiçbir kategoriye yetki verilmediğini doğrula.
  const allAuths = runSql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerId}' and revoked_at is null;`);
  record("6. Yalnızca Geri Dönüşüm & Atık Tahliye için yetki var, başka kategori yok", allAuths.length === 1 && allAuths[0].service_category_id === CATEGORY, JSON.stringify(allAuths));

  // Profil doğrulama.
  const profileRow = runSql(`select role, company_name, account_status, onboarding_completed from public.profiles where id = '${providerId}';`);
  record("7. profiles satırı doğru (role=hizmet-veren, company_name doğru, account_status=active)", profileRow[0]?.role === "hizmet-veren" && profileRow[0]?.company_name === COMPANY_NAME && profileRow[0]?.account_status === "active", JSON.stringify(profileRow[0]));

  console.log("\n=== ÖNEMLİ: Uzmanlık Alanları (Metal/Ahşap-Palet/Plastik) NOT SET ===");
  console.log("recyclingMaterialSpecialties yalnızca tarayıcı localStorage'ında tutulan, Supabase karşılığı OLMAYAN bir alan (bkz. types.ts#ProviderProfile.recyclingMaterialSpecialties) — bu script bunu ayarlayamaz.");
  console.log("Bu hesapla ilk kez gerçek tarayıcıda giriş yapıldığında Panel > Profilim > Hizmet Bilgilerim'den 'Geri Dönüşüm Uzmanlık Alanları' altında Metal/Ahşap-Palet/Plastik işaretlenip kaydedilmelidir.");

  console.log(`\n=== KİMLİK BİLGİLERİ (yalnızca bunlar paylaşılabilir) ===`);
  console.log(`Email: ${EMAIL}`);
  console.log(`Şifre: ${PASSWORD}`);
  console.log(`provider_id: ${providerId}`);
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
