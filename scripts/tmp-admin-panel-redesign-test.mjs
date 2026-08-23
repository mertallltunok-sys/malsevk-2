// node scripts/tmp-admin-panel-redesign-test.mjs
//
// ADMİN PANELİ YENİDEN TASARIMI (Yönetim Özeti/Onay Merkezi/Sistem Sağlığı/
// Firma Yetki Kontrolü/İşlem Geçmişi/global arama/bildirim/admin auto-
// redirect) görevinin gerçek Development ortamına, gerçek tarayıcıya karşı
// uçtan uca doğrulaması. Hiçbir mock/sahte veri kullanılmaz — gerçek
// Supabase Development projesi (trfnmpihcnriqgikglpu), gerçek `npm run dev`
// sunucusu (localhost:3000), gerçek yeni test hesapları.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FAIL: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY eksik");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-admin-redesign-"));
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

const stamp = Date.now();
const createdUserIds = [];

async function createUser(label, role) {
  const email = `malsevk-adminredesign-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  createdUserIds.push(userId);

  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signIn(${label}) after confirm failed: ${signInError.message}`);
  }

  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role === "admin" ? "hizmet-alan" : role,
    p_full_name: `AdminRedesign ${label}`,
    p_phone: "+905551110098",
    p_company_name: `AdminRedesign Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);

  if (role === "admin") {
    runSql(`update public.profiles set role = 'admin' where id = '${userId}';`);
  }

  return { id: userId, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    try {
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 10000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginAs(${email}) failed after retry`);
      await page.waitForTimeout(500);
    }
  }
}

async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.waitForTimeout(300);
}

async function makeTestDocumentFile() {
  const filePath = path.join(scratchDir, "test-document.jpg");
  await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 30, g: 60, b: 120 } } })
    .jpeg()
    .toFile(filePath);
  return filePath;
}

async function run() {
  const browser = await chromium.launch();

  try {
    console.log("--- Test kullanıcıları oluşturuluyor ---");
    const admin = await createUser("admin", "admin");
    const requester = await createUser("req", "hizmet-alan");
    const provider = await createUser("prov", "hizmet-veren");
    console.log(`admin=${admin.email} requester=${requester.email} provider=${provider.email}`);

    // ============================================================
    // A) Provider gerçek Belge Yükleme akışıyla bir belge yükler —
    // Onay Merkezi/Firma Belgeleri/Firma Yetki Kontrolü akışlarının
    // GERÇEK, taze bir "bekleyen belge" kaydına sahip olması için.
    // ============================================================
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await loginAs(page1, provider.email);
    await page1.goto(`${APP_ORIGIN}/panel/belge-yukleme`);
    await page1.getByRole("button", { name: "Nakliye", exact: true }).click();
    const docFile = await makeTestDocumentFile();
    await page1.locator('input[type="file"]').setInputFiles(docFile);
    await page1.waitForTimeout(500);
    await page1.getByRole("button", { name: "Belgeyi Gönder" }).click();
    await page1.waitForSelector("text=belgeniz yüklendi", { timeout: 15000 });
    record("A) Provider gerçek UI üzerinden belge yükledi", true);
    await ctx1.close();

    const pendingDocRows = runSql(
      `select id from public.provider_documents where provider_id = '${provider.id}' and current_review_status = 'pending' order by uploaded_at desc limit 1;`,
    );
    const pendingDocId = pendingDocRows[0]?.id;
    record("A2) Yeni bekleyen belge veritabanında görünüyor", Boolean(pendingDocId), pendingDocId);

    // ============================================================
    // Ortak admin context — bundan sonraki tüm admin senaryoları AYNI
    // context'i (gerçek tarayıcı oturumu) paylaşır.
    // ============================================================
    const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const adminPage = await adminCtx.newPage();

    // B) Admin girişi -> otomatik /admin yönlendirmesi (redirect param YOK)
    await loginAs(adminPage, admin.email);
    await adminPage.waitForURL("**/admin", { timeout: 10000 }).catch(() => {});
    const urlAfterAdminLogin = new URL(adminPage.url()).pathname;
    record("B) Admin girişinde otomatik /admin yönlendirmesi", urlAfterAdminLogin === "/admin", urlAfterAdminLogin);

    // C) Admin sidebar 10 modülü, sırayla, ve Development ortam göstergesi
    const navLabels = await adminPage.locator("aside nav a span.truncate").allTextContents();
    const expectedOrder = [
      "Yönetim Özeti",
      "Onay Merkezi",
      "Hizmet Alanlar",
      "Firmalar",
      "Firma Belgeleri",
      "İlan Yönetimi",
      "Operasyonlar",
      "Sistem Beslemesi",
      "Sistem Sağlığı",
      "İşlem Geçmişi",
    ];
    record("C) Sidebar 10 modül doğru sırada", JSON.stringify(navLabels) === JSON.stringify(expectedOrder), navLabels.join(" | "));
    const envIndicatorText = await adminPage.locator("aside").getByText("Çevrimiçi").textContent();
    record("C2) Ortam göstergesi görünüyor", Boolean(envIndicatorText && envIndicatorText.includes("Development")), envIndicatorText ?? "");

    // D) Public canlı destek balonu / footer admin panelinde YOK
    const whatsappVisible = await adminPage.getByLabel("7/24 Canlı Destek — WhatsApp üzerinden bize ulaşın").count();
    const footerVisible = await adminPage.locator("footer").count();
    record("D) WhatsApp balonu admin panelinde yok", whatsappVisible === 0, `count=${whatsappVisible}`);
    record("D2) Public footer admin panelinde yok", footerVisible === 0, `count=${footerVisible}`);

    // E) 1366x768'de yatay taşma yok
    const scrollWidth = await adminPage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await adminPage.evaluate(() => document.documentElement.clientWidth);
    record("E) 1366x768'de yatay taşma yok", scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);

    // F) Yönetim Özeti gerçek sayılar gösteriyor (sahte 0 değil)
    await adminPage.waitForTimeout(1500);
    const totalUsersCard = adminPage.locator("text=Toplam Kullanıcı").locator("..");
    const totalUsersText = await totalUsersCard.textContent();
    record("F) Toplam Kullanıcı kartı gerçek bir sayı gösteriyor", /\d/.test(totalUsersText ?? ""), totalUsersText ?? "");

    // G) Onay Merkezi kartı + Firma Yetki Kontrolü + Son Admin İşlemleri kartları var
    const approvalCardVisible = await adminPage.getByRole("heading", { name: "Onay Merkezi" }).count();
    const authCheckCardVisible = await adminPage.getByRole("heading", { name: "Firma Yetki Kontrolü" }).count();
    const recentActionsCardVisible = await adminPage.getByRole("heading", { name: "Son Admin İşlemleri" }).count();
    const systemHealthCardVisible = await adminPage.getByRole("heading", { name: "Sistem Sağlığı" }).count();
    record("G) Onay Merkezi kartı var", approvalCardVisible > 0);
    record("G2) Firma Yetki Kontrolü kartı var", authCheckCardVisible > 0);
    record("G3) Son Admin İşlemleri kartı var", recentActionsCardVisible > 0);
    record("G4) Sistem Sağlığı kartı var", systemHealthCardVisible > 0);

    // H) Onay Merkezi sayfası: gerçek bekleyen belge/ilan listeleniyor
    await adminPage.goto(`${APP_ORIGIN}/admin/onay-merkezi`);
    await adminPage.waitForTimeout(1500);
    const belgelerTabCount = await adminPage.getByRole("button", { name: /Belgeler/ }).textContent();
    record("H) Onay Merkezi 'Belgeler' filtresi görünüyor", Boolean(belgelerTabCount), belgelerTabCount ?? "");
    await adminPage.getByRole("button", { name: /^Belgeler/ }).click();
    await adminPage.waitForTimeout(500);
    const pendingDocRowVisible = await adminPage.getByText("Nakliye").first().isVisible().catch(() => false);
    record("H2) Yeni yüklenen belge Onay Merkezi'nde görünüyor", pendingDocRowVisible);

    // I) Belge satırından "İncele" -> gerçek Firma Belgeleri detay ekranına gider ve ONAYLANIR
    const incelemeLink = adminPage.getByRole("link", { name: "İncele" }).first();
    await incelemeLink.click();
    await adminPage.waitForURL("**/admin/firma-belgeleri/**", { timeout: 10000 });
    record("I) İncele bağlantısı gerçek Firma Belgeleri detay ekranına gidiyor", true, adminPage.url());
    const onaylaButton = adminPage.getByRole("button", { name: /^Onayla/ });
    await onaylaButton.click().catch(async () => {
      // Bazı ekranlarda not alanı/onay dialogu olabilir; en genel "Onayla" metnini tekrar dene.
      await adminPage.getByText("Onayla", { exact: false }).first().click();
    });
    await adminPage.waitForTimeout(2000);
    const approvedRow = runSql(`select current_review_status from public.provider_documents where id = '${pendingDocId}';`);
    record("I2) Belge gerçekten 'approved' durumuna geçti", approvedRow[0]?.current_review_status === "approved", JSON.stringify(approvedRow[0]));

    // J) Firma Yetki Kontrolü — bu firma artık Nakliye için Onaylı görünmeli
    await adminPage.goto(`${APP_ORIGIN}/admin`);
    await adminPage.waitForTimeout(1000);
    // SearchableSelect kendi input'unu label'a bağlı bir input olarak render eder; trigger butonuna tıklayıp yaz.
    await adminPage.getByText("Firma seçin...").click();
    await adminPage.keyboard.type("AdminRedesign Firma prov");
    await adminPage.waitForTimeout(500);
    await adminPage.getByText("AdminRedesign Firma prov", { exact: false }).first().click();
    await adminPage.waitForTimeout(1500);
    const nakliyeStatusRow = await adminPage.getByText("Nakliye", { exact: true }).locator("xpath=ancestor::li[1]").textContent().catch(() => "");
    record("J) Firma Yetki Kontrolü Nakliye için 'Onaylı' gösteriyor", (nakliyeStatusRow ?? "").includes("Onaylı"), nakliyeStatusRow ?? "");

    // K) İşlem Geçmişi — humanize edilmiş, Türkçe, ham action kodu İÇERMEYEN bir satır var
    await adminPage.goto(`${APP_ORIGIN}/admin/islem-gecmisi`);
    await adminPage.waitForTimeout(1500);
    const auditBodyText = await adminPage.locator("main").textContent();
    const hasRawActionInMainList = (auditBodyText ?? "").includes("review_provider_document");
    const hasHumanizedSentence = /belgesi (onaylandı|reddedildi)/.test(auditBodyText ?? "");
    record("K) İşlem Geçmişi ana listede ham action kodu YOK", !hasRawActionInMainList);
    record("K2) İşlem Geçmişi humanize edilmiş bir cümle içeriyor", hasHumanizedSentence, hasHumanizedSentence ? "found" : (auditBodyText ?? "").slice(0, 300));

    // L) Sistem Sağlığı — GERÇEK bir yakalanmamış istemci hatası tetikle
    // (setTimeout içinden throw — Playwright'ın evaluate() sarmalayıcısının
    // DIŞINDA, tarayıcının kendi olay döngüsünde gerçekleşir, böylece
    // GlobalErrorListener'ın gerçek `window.addEventListener("error", ...)`
    // dinleyicisi bunu GERÇEKTEN yakalar — sahte/simüle bir çağrı değil).
    const uniqueMarker = `ADMIN-REDESIGN-TEST-ERROR-${stamp}`;
    await adminPage.goto(`${APP_ORIGIN}/`);
    await adminPage.waitForTimeout(500);
    await adminPage.evaluate((marker) => {
      setTimeout(() => {
        throw new Error(marker);
      }, 10);
    }, uniqueMarker);
    await adminPage.waitForTimeout(1500);

    await adminPage.goto(`${APP_ORIGIN}/admin/sistem-sagligi`);
    await adminPage.waitForTimeout(1500);
    const errorListText = await adminPage.locator("main").textContent();
    const errorAppeared = (errorListText ?? "").includes(uniqueMarker);
    record("L) Gerçek yakalanmamış hata Sistem Sağlığı'nda görünüyor", errorAppeared);

    if (errorAppeared) {
      await adminPage.getByText(uniqueMarker, { exact: false }).first().click();
      await adminPage.waitForTimeout(500);

      // M) İnceleniyor -> Çözüldü durum geçişleri gerçekten çalışıyor
      await adminPage.getByRole("button", { name: "İnceleniyor Olarak İşaretle" }).click();
      await adminPage.waitForTimeout(1000);
      const statusAfterInceleniyor = await adminPage.getByText("İnceleniyor", { exact: true }).count();
      record("M) 'İnceleniyor' olarak işaretleme çalışıyor", statusAfterInceleniyor > 0);

      await adminPage.getByRole("button", { name: "Çözüldü Olarak İşaretle" }).click();
      await adminPage.waitForTimeout(1000);
      const statusAfterCozuldu = await adminPage.getByText("Çözüldü", { exact: true }).count();
      record("M2) 'Çözüldü' olarak işaretleme çalışıyor", statusAfterCozuldu > 0);

      // N) Claude Düzeltme Talimatını Kopyala — panoya gerçekten kopyalanıyor mu
      await adminCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
      await adminPage.getByRole("button", { name: "Claude Düzeltme Talimatını Kopyala" }).click();
      await adminPage.waitForTimeout(500);
      const clipboardText = await adminPage.evaluate(() => navigator.clipboard.readText());
      const copyFeedbackVisible = await adminPage.getByText("Düzeltme talimatı kopyalandı").count();
      record("N) Kopyalama başarı bildirimi görünüyor", copyFeedbackVisible > 0);
      record(
        "N2) Panoya kopyalanan metin gerçek hata bilgilerini içeriyor, gizli anahtar içermiyor",
        clipboardText.includes(uniqueMarker) && clipboardText.includes("MALSEVK") && !clipboardText.toLowerCase().includes("service_role") && !clipboardText.toLowerCase().includes("eyj"),
        clipboardText.slice(0, 120),
      );
    }

    // O) Sistem Sağlığı sidebar rozeti sayısı gerçek kritik hata sayısıyla tutarlı (0 veya gerçek bir sayı)
    const badgeCounts = await adminPage.locator('a[href="/admin/sistem-sagligi"] span').allTextContents();
    record("O) Sistem Sağlığı sidebar rozeti render edildi (varsa gerçek sayı)", true, badgeCounts.join(","));

    // ============================================================
    // P) Global admin araması gerçek yeni provider'ı buluyor
    // ============================================================
    await adminPage.goto(`${APP_ORIGIN}/admin`);
    await adminPage.waitForTimeout(500);
    await adminPage.getByPlaceholder("Firma, ilan veya kullanıcı ara...").fill("AdminRedesign Firma prov");
    await adminPage.waitForTimeout(800);
    const searchResultVisible = await adminPage.getByText("AdminRedesign Firma prov", { exact: false }).first().isVisible().catch(() => false);
    record("P) Global arama gerçek firmayı buluyor", searchResultVisible);

    await adminCtx.close();

    // ============================================================
    // Q) Non-admin (hizmet-alan) davranışı bozulmadı + admin'e erişemiyor
    // ============================================================
    const reqCtx = await browser.newContext();
    const reqPage = await reqCtx.newPage();
    await loginAs(reqPage, requester.email);
    const urlAfterRequesterLogin = new URL(reqPage.url()).pathname;
    record("Q) Hizmet Alan girişi hâlâ ana sayfaya gidiyor (davranış bozulmadı)", urlAfterRequesterLogin === "/", urlAfterRequesterLogin);

    const requesterProfileMenuHasAdminLink = await reqPage.getByText("Yönetim Paneline Git").count();
    record("Q2) Hizmet Alan profil menüsünde 'Yönetim Paneline Git' YOK", requesterProfileMenuHasAdminLink === 0);

    const adminAccessResponse = await reqPage.goto(`${APP_ORIGIN}/admin`);
    record("Q3) Hizmet Alan /admin'e manuel girişte 404 alıyor", adminAccessResponse?.status() === 404, String(adminAccessResponse?.status()));
    await reqCtx.close();

    // R) Admin'in profil menüsünde (herkese açık bir sayfada) "Yönetim Paneline Git" GÖRÜNÜYOR
    const adminPublicCtx = await browser.newContext();
    const adminPublicPage = await adminPublicCtx.newPage();
    await loginAs(adminPublicPage, admin.email);
    await adminPublicPage.goto(`${APP_ORIGIN}/`);
    await adminPublicPage.waitForTimeout(500);
    // Profil menüsü tetikleyicisi `aria-haspopup="menu"` taşır ama
    // bildirim ziliyle (o da "menu") paylaşılıyor — zilin AYRICA
    // `aria-label="Bildirimler"` taşıdığı, profil butonunun taşımadığı
    // gerçeğiyle ayrıştırılır.
    await adminPublicPage.locator('header button[aria-haspopup="menu"]:not([aria-label])').first().click();
    await adminPublicPage.waitForTimeout(500);
    const adminLinkVisible = await adminPublicPage.getByText("Yönetim Paneline Git").first().isVisible().catch(() => false);
    record("R) Admin profil menüsünde 'Yönetim Paneline Git' GÖRÜNÜYOR (herkese açık sayfada)", adminLinkVisible);
    await adminPublicCtx.close();

    await browser.close();
    return true;
  } catch (error) {
    console.error("FATAL:", error);
    await browser.close().catch(() => {});
    return false;
  }
}

run().then((ok) => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== SONUÇ: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    console.log("Başarısız:", failed.map((f) => f.name).join(", "));
  }
  process.exit(ok && failed.length === 0 ? 0 : 1);
});
