// node scripts/tmp-supabase-real-heic-upload-e2e-test.mjs
//
// GERÇEK HEIC dosyasıyla uçtan uca test — sahte/uzantısı değiştirilmiş bir
// JPEG DEĞİL. Test dosyası Windows'un kendi Microsoft.HEIFImageExtension
// codec'i (WinRT Windows.Graphics.Imaging.BitmapEncoder, HeifEncoderId)
// kullanılarak GERÇEKTEN encode edildi — ftyp kutusu doğrulanmış "heic" ana
// markasını taşıyor VE app'in kendi heic-convert bağımlılığıyla başarıyla
// decode edildiği ayrıca kanıtlandı (bkz. proje raporu). Dosya GPS/Orientation
// EXIF verisi TAŞIYOR (46 bayt, sharp ile doğrulandı) — böylece sunucunun
// EXIF/GPS temizleme adımı gerçek anlamda test edilebiliyor (boş bir dosyada
// "temizlendi" kanıtlanamaz).
//
// Test dosyası: <scratchpad>/malsevk-real-test.heic
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HEIC_PATH = process.env.HEIC_FIXTURE_PATH;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

const SECRET_KEY = readFileSync(path.join(tmpdir(), "malsevk-sb-key.txt"), "utf8").trim();

if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}
if (!HEIC_PATH) {
  console.error("FAIL: HEIC_FIXTURE_PATH belirtilmedi");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const createdUserIds = [];
const uploadedStoragePaths = [];
let browser;
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-heictest-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `HeicTest ${label}`, p_phone: "+905551110300",
    p_company_name: `HeicTest Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}
async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.waitForTimeout(500);
}
async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");

  browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("requestfailed", (req) => failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`));

  await loginAs(page, requester.email);
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  console.log("\n=== GERÇEK .heic dosyasını gerçek job-photo-upload.tsx input'una yüklüyor ===");
  const heicBuffer = readFileSync(HEIC_PATH);
  record("Ön koşul: test dosyası gerçek 'heic' ftyp markası taşıyor", heicBuffer.toString("ascii", 8, 12) === "heic", heicBuffer.toString("ascii", 8, 12));

  await page.locator('input[type="file"]').setInputFiles([{ name: "gercek-test.heic", mimeType: "image/heic", buffer: heicBuffer }]);
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 25000 });
  await page.waitForTimeout(2000);

  const bodyText = await page.locator("main").innerText();
  const hasError = bodyText.includes("işlenirken") || bodyText.includes("işlenemedi") || bodyText.includes("bozuk");
  record("HEIC dosyası hatasız işlendi (sunucu tarafı dönüşüm başarılı)", !hasError, hasError ? bodyText.slice(0, 500) : "hata yok");

  const hasPreview = (await page.locator("img[src^='blob:']").count()) > 0;
  record("Önizleme (preview) açıldı", hasPreview);
  record("Konsol hatası yok", consoleErrors.length === 0, JSON.stringify(consoleErrors));
  record("Başarısız network isteği yok", failedRequests.length === 0, JSON.stringify(failedRequests));

  if (hasError) {
    console.log("--- DEBUG: sayfa metni ---");
    console.log(bodyText.slice(0, 2500));
    console.log("--- DEBUG: konsol hataları ---");
    console.log(JSON.stringify(consoleErrors, null, 2));
  }

  // İlanı tamamla, GERÇEK Supabase job + Storage senkronunu tetikle.
  // NOT: `locator("select").first()` fotoğraf yüklemesinden HEMEN SONRA
  // güvenilmez çıktı (gerçek bug DEĞİL, test script'inin kendi seçici
  // kırılganlığı — izole bir problar script'iyle doğrulandı: aynı tek
  // <select>, `getByLabel("Hizmet Kategorisi")` ile HER ZAMAN doğru
  // seçiliyor). Etiket bazlı seçici kullanılır.
  await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Gözetim Hizmetleri" });
  // NOT: `${stamp}` (Date.now(), 13 haneli) doğrudan başlığa eklenirse
  // containsDirectContactInfo (contact-leak-detection.ts) onu telefon
  // numarası SANIYOR ve "İlan başlığına telefon numarası..." hatasıyla
  // gönderimi GERÇEKTEN engelliyor — bu bir app bug'ı DEĞİL, doğru çalışan
  // bir PII koruması (izole bir aria-invalid dökümüyle doğrulandı). Ayırıcı
  // harfler ekleyerek ardışık rakam dizisini bölüyoruz.
  const uniqueTag = stamp.toString(36);
  await page.getByLabel("İlan Başlığı").fill(`HEIC Test İlanı ${uniqueTag}`);
  await page.getByLabel("Hizmete Özel Açıklama").fill("Gerçek HEIC dosyası testi, en az yirmi karakter açıklama.");
  await page.getByLabel("Ürün Adedi").fill("3");
  await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
  await page.locator('ul[aria-label="Ürün Cinsi"]').waitFor({ state: "visible", timeout: 5000 });
  await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
  await selectFromSearchable(page, "İl", "Kocaeli");
  await selectFromSearchable(page, "İlçe", "Gebze");
  await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
  const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: /Listede yok/ }).first().click();
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Sahası");
  await page.getByLabel("Açık Adres").fill("Test açık adresi, en az on karakter uzunlukta.");
  await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
  await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");

  console.log("--- DEBUG: gönderim öncesi GERÇEK alan değerleri (inputValue, doğru API) ---");
  console.log("Hizmet Kategorisi:", await page.getByLabel("Hizmet Kategorisi").inputValue());
  console.log("İlan Başlığı:", await page.getByLabel("İlan Başlığı").inputValue());
  console.log("Hizmete Özel Açıklama:", await page.getByLabel("Hizmete Özel Açıklama").inputValue());
  console.log("Ürün Adedi:", await page.getByLabel("Ürün Adedi").inputValue());
  console.log("Ürün Cinsi:", await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).inputValue());
  console.log("İl (buton):", await page.getByRole("button", { name: "İl", exact: true }).first().innerText());
  console.log("İlçe (buton):", await page.getByRole("button", { name: "İlçe", exact: true }).first().innerText());
  console.log("Liman/Sanayi/OSB (buton):", await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).innerText());
  console.log("Liman / Sanayi / OSB Adı:", await page.getByLabel("Liman / Sanayi / OSB Adı").inputValue());
  console.log("Açık Adres:", await page.getByLabel("Açık Adres").inputValue());
  console.log("Başlangıç Tarihi:", await page.getByLabel("Başlangıç Tarihi").inputValue());
  console.log("Bitiş Tarihi:", await page.getByLabel("Bitiş Tarihi").inputValue());
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  const reachedPreview = await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  if (!reachedPreview) {
    console.log("--- DEBUG: 'Operasyon Özeti' önizlemesine ULAŞILAMADI - form doğrulama hatası olabilir ---");
    const invalidEls = await page.locator('[aria-invalid="true"]').all();
    console.log(`DEBUG: aria-invalid="true" olan alan sayısı: ${invalidEls.length}`);
    for (const el of invalidEls) {
      const id = await el.getAttribute("id");
      const describedBy = await el.getAttribute("aria-describedby");
      const name = await el.getAttribute("name");
      let errorText = "";
      if (describedBy) {
        errorText = await page.locator(`#${describedBy}`).innerText().catch(() => "(bulunamadı)");
      }
      console.log(`  - id=${id} name=${name} aria-describedby=${describedBy} => "${errorText}"`);
    }
    console.log((await page.locator("main").innerText()).slice(0, 3000));
    throw new Error("Operasyon Özeti önizlemesine ulaşılamadı - form doğrulama hatası (yukarıdaki aria-invalid dökümüne bakın)");
  }
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  try {
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 40000 });
  } catch (navErr) {
    console.log("--- DEBUG: navigasyon başarısız, mevcut URL:", page.url(), "---");
    console.log((await page.locator("main").innerText()).slice(0, 3000));
    throw navErr;
  }
  const jobId = page.url().split("/ilanlar/")[1].split("?")[0];
  await page.waitForTimeout(2500); // best-effort Supabase job/photo senkronu için bekleme.

  // ============ GERÇEK Supabase Storage doğrulaması ============
  console.log("\n=== Supabase Storage'da GERÇEKTEN kaydedildiğini doğruluyor ===");
  const { data: photoObjects, error: listError } = await admin.storage.from("job-photos").list(`${requester.id}/${jobId}`);
  if (listError) {
    record("Supabase Storage'da fotoğraf nesnesi bulundu", false, listError.message);
  } else {
    record("Supabase Storage'da fotoğraf nesnesi bulundu", (photoObjects?.length ?? 0) > 0, JSON.stringify(photoObjects?.map((o) => o.name)));
    for (const obj of photoObjects ?? []) uploadedStoragePaths.push(`${requester.id}/${jobId}/${obj.name}`);
  }

  let downloadedBuffer = null;
  if (uploadedStoragePaths.length > 0) {
    const { data: downloaded, error: downloadError } = await admin.storage.from("job-photos").download(uploadedStoragePaths[0]);
    if (downloadError) {
      record("Storage'daki dosya indirilebiliyor", false, downloadError.message);
    } else {
      downloadedBuffer = Buffer.from(await downloaded.arrayBuffer());
      record("Storage'daki dosya indirilebiliyor", true, `${downloadedBuffer.length} bayt`);
    }
  }

  if (downloadedBuffer) {
    const meta = await sharp(downloadedBuffer).metadata();
    console.log("--- Storage'daki işlenmiş dosyanın metadata'sı ---");
    console.log(JSON.stringify(meta, null, 2));
    record("Uygun formata dönüştü (JPEG/PNG/WEBP, artık HEIC değil)", ["jpeg", "png", "webp"].includes(meta.format), meta.format);
    record("EXIF/GPS verisi TEMİZLENDİ (sunucu tarafı çıktıda yok)", !meta.exif, meta.exif ? `HÂLÂ ${meta.exif.length} bayt EXIF var` : "exif yok");
    record("10 MB dosya boyutu sınırı içinde", downloadedBuffer.length <= 10 * 1024 * 1024, `${downloadedBuffer.length} bayt`);
  }

  // ============ Temiz ikinci oturumdan görünürlük ============
  console.log("\n=== Temiz (yeni) ikinci oturumdan fotoğrafın görülebildiğini doğruluyor ===");
  if (uploadedStoragePaths.length > 0) {
    const { data: publicUrlData } = admin.storage.from("job-photos").getPublicUrl(uploadedStoragePaths[0]);
    const freshFetch = await fetch(publicUrlData.publicUrl);
    record("Public URL üzerinden (oturumsuz/temiz istekle) fotoğraf erişilebiliyor", freshFetch.ok, `HTTP ${freshFetch.status}`);
  }

  await logout(page);
  await loginAs(page, requester.email);
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const hasPhotoOnDetailPage = (await page.locator("img").count()) > 0;
  record("İlan detay sayfasında fotoğraf gerçekten render ediliyor", hasPhotoOnDetailPage);

  await browser.close();
}

async function cleanup() {
  // GERÇEK Storage'a yüklenen nesneler hesap silinmeden ÖNCE temizlenir.
  if (uploadedStoragePaths.length > 0) {
    const { error } = await admin.storage.from("job-photos").remove(uploadedStoragePaths);
    console.log(`Storage temizliği: ${uploadedStoragePaths.length} nesne ${error ? "BAŞARISIZ: " + error.message : "silindi"}`);
  }
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    const { execSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const sqlPath = path.join(tmpdir(), `heic-cleanup-${Date.now()}.sql`);
    writeFileSync(
      sqlPath,
      // SIRA ÖNEMLİ: notifications.offer_id -> offers.id FK'si var (bkz.
      // tmp-supabase-offer-lifecycle-regression-test.mjs'de bulunan/
      // düzeltilen AYNI hata) — notifications HER ZAMAN offers'tan ÖNCE
      // silinmeli. Bu script'te tipik olarak hiç teklif oluşmadığı için
      // pratikte tetiklenmedi ama tutarlılık için burada da düzeltildi.
      `delete from public.notifications where recipient_id in (${idList}) or actor_id in (${idList}) or offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})));` +
        `delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));` +
        `delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));` +
        `delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));` +
        `delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));` +
        `delete from public.jobs where requester_id in (${idList});`,
    );
    try {
      execSync(`npx supabase db query --file "${sqlPath}" --linked --output json`, { cwd: process.cwd(), stdio: "pipe" });
    } catch (e) {
      console.error("SQL cleanup failed:", e.message);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch((e) => console.error(`deleteUser(${id}) failed:`, e.message));
    }
  }
  if (browser) await browser.close().catch(() => {});
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
