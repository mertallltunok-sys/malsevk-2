// Development Supabase projesine (trfnmpihcnriqgikglpu) VE zaten çalışan
// gerçek dev sunucusuna (http://localhost:3000) karşı: "Geri Dönüşüm &
// Atık Tahliye neden Hizmet Ekle ekranında görünmüyor" sorusunun kök
// nedenini GERÇEK tarayıcıda kanıtlar.
//
// KÖK NEDEN (önceden SQL ile doğrulandı): `geri-donusum-test@malsevk.test`
// hesabı için provider_service_authorizations satırı bu görevden ÖNCEKİ bir
// turda REVOKE EDİLMİŞTİ (revoked_at dolu, revoke_reason="....") — muhtemelen
// kullanıcının kendi admin panelinde yaptığı keşif sırasında. document-
// upload-content.tsx'in "Hangi hizmeti veriyorsunuz?" ekranı yalnızca
// status="not_selected" | "document_required" olan kategorileri gösterir
// (bkz. supabase-my-service-authorizations.ts#getMyServiceAuthorizations) —
// "authorized" VE "revoked" durumundaki bir kategori BİLEREK bu listede
// tekrar görünmez ("zaten eklediğiniz hizmetler tekrar görünmez"). Bu script
// TAZE (hiç dokunulmamış, status='not_selected') bir hizmet-veren hesabıyla
// aynı ekranı test ederek kataloğun/filtrenin GERÇEKTEN doğru çalıştığını
// kanıtlar.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = "http://localhost:3000";
const PASSWORD = "TestSifre2026!";
const stamp = Date.now();
const FRESH_PROVIDER_EMAIL = `recytest-freshprov-${stamp}@example.com`;

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
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 220) : ""));
}

async function main() {
  // -------------------------------------------------------------------
  // 1) TAZE bir hizmet-veren hesabı — hiç hizmet seçmemiş, hiç belge
  //    yüklememiş, hiç yetkilendirilmemiş (status='not_selected' garantisi).
  // -------------------------------------------------------------------
  const supa = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signUpError } = await supa.auth.signUp({ email: FRESH_PROVIDER_EMAIL, password: PASSWORD });
  if (signUpError) throw new Error(`signUp failed: ${signUpError.message}`);
  const { error: crError } = await supa.rpc("complete_registration", {
    p_role: "hizmet-veren",
    p_full_name: "Fresh Provider Catalog Test",
    p_phone: "+905321119966",
    p_company_name: "Fresh Provider Catalog Test Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  record("0. Taze hizmet-veren test hesabı oluşturuldu (hiçbir hizmeti yok)", !crError, crError?.message);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(FRESH_PROVIDER_EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 }).catch(() => {});
  record("1. Taze hesap gerçek UI'dan giriş yaptı", !page.url().includes("/giris-yap"), page.url());

  await page.goto(`${APP_ORIGIN}/panel/belge-yukleme`);
  await page.getByText("Hangi hizmeti veriyorsunuz?").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const pickerText = await page.locator("main").innerText().catch(() => "");
  record("2. 'Hangi hizmeti veriyorsunuz?' ekranı açıldı", pickerText.includes("Hangi hizmeti veriyorsunuz"));

  const recycleButton = page.getByRole("button", { name: "Geri Dönüşüm & Atık Tahliye", exact: true });
  const recycleVisible = await recycleButton.isVisible().catch(() => false);
  record("3. GERÇEK UI'DA 'Geri Dönüşüm & Atık Tahliye' seçeneği GÖRÜNÜYOR (taze hesap için)", recycleVisible, pickerText.includes("Geri Dönüşüm") ? "metin sayfada var" : "metin sayfada YOK");

  // Regresyon: eski kategoriler/gruplar hâlâ görünüyor mu?
  const regressionChecks = ["Gümrük Müşavirliği", "Lashing / Unlashing", "Gözetim Hizmetleri", "Konteyner Dolum / Boşaltım", "Personel Temini", "Acil Operasyon Desteği", "Operatör veya İş Makinesi Hizmeti Veriyorum", "Depo Hizmetleri Veriyorum"];
  const missingRegression = regressionChecks.filter((label) => !pickerText.includes(label));
  record("4. Regresyon yok — mevcut 8 seçenek de hâlâ görünüyor", missingRegression.length === 0, missingRegression.join(", ") || "hepsi mevcut");

  if (recycleVisible) {
    await recycleButton.click();
    await page.waitForTimeout(1000);
    const uploadStepText = await page.locator("main").innerText().catch(() => "");
    record("5. Seçilebiliyor VE belge yükleme adımına giriyor", uploadStepText.includes("Faaliyet Belgesi") || uploadStepText.includes("belgenizi yükleyin"), uploadStepText.slice(0, 200));
  }

  await browser.close();
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    console.log(`NOT: '${FRESH_PROVIDER_EMAIL}' hesabı silinemedi (secret key yok), Development'ta kaldı.`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
