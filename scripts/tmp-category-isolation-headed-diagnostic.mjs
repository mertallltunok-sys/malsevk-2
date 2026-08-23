// node scripts/tmp-category-isolation-headed-diagnostic.mjs
//
// TÜM HİZMET KATEGORİLERİ İZOLASYON DENETİMİ — headed (görünür) Chromium
// açar, KULLANICI kendi gerçek hesabıyla /giris-yap ekranında MANUEL giriş
// yapar (bu script şifreyi hiç görmez/istemez/kaydetmez) — script yalnızca
// giriş TAMAMLANDIKTAN SONRA, o oturumun GERÇEK, RLS ile sınırlı verisini
// uygulamanın KENDİ ekranlarından (Panel > Profilim > Hizmet Yetkileri,
// Aktif İlanlar, doğrudan ilan URL'leri) okur. Hiçbir service_role/gizli
// anahtar KULLANILMAZ/İSTENMEZ — yalnızca zaten oturum açmış gerçek
// kullanıcının kendi görebileceği sayfaları okur, bu yüzden RLS'i asla
// atlamaz.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (localhost:3000).
// Kullanım: node scripts/tmp-category-isolation-headed-diagnostic.mjs
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

// Anon anahtarla (herkese açık okuma) önceden tespit edilmiş, GERÇEK,
// onaylı/aktif Development ilanları — kategori bazlı doğrudan-URL erişim
// testi için. Bu liste PROMPT'taki isimlerden değil, gerçek `jobs` tablosu
// sorgusundan (bu script'i hazırlarken çalıştırıldı) alınmıştır.
const KNOWN_JOBS = [
  { categoryId: "nakliye", categoryLabel: "Nakliye", jobId: "3f719f5a-b5fe-48a9-be70-1b052c74f14a", title: "Operasyon - Nakliye" },
  { categoryId: "lashing-unlashing", categoryLabel: "Lashing / Unlashing", jobId: "c94fef54-d494-4b38-a54a-610123e3f41f", title: "PROF. LASHING EKİBİ ARIYORUZ." },
  { categoryId: "gumruk-musavirligi", categoryLabel: "Gümrük Müşavirliği", jobId: "0fc8391e-ad5c-45b4-a5ec-98177905723c", title: "gümrük müşavirine ihtiyacımız var" },
  { categoryId: "gozetim-hizmetleri", categoryLabel: "Gözetim Hizmetleri", jobId: "6f9b8af8-a092-4011-95d2-f37b193ef786", title: "RLS Probe İlanı" },
  { categoryId: "kapali-depolama", categoryLabel: "Kapalı Depolama", jobId: "9f9dba8b-e469-44cf-8567-5fa06fdf3e6f", title: "kapalı depo arıyoruz" },
  { categoryId: "geri-donusum-atik-tahliye", categoryLabel: "Geri Dönüşüm & Atık Tahliye", jobId: "230487c1-b428-4a12-ac28-c366f9efa457", title: "Fabrika sahamızdan acil metal hurdaların alınmasını istiyorum" },
  { categoryId: "konteyner-dolum-bosaltim", categoryLabel: "Konteyner Dolum / Boşaltım", jobId: "38f5be3d-d530-4ec7-9cbc-32faf61c7d23", title: "0034-B" },
];

// KALICI profil dizini (sistem temp'i DEĞİL, scratchpad altında) — oturum
// bu dizine kaydedilir, script erken sonlanırsa/pencere kapanırsa bile
// GERÇEK giriş oturumu diskte kalır ve bir sonraki çalıştırmada YENİDEN
// giriş istemeden aynı oturumla devam edilebilir.
const PROFILE_DIR =
  "C:/Users/merta/AppData/Local/Temp/claude/c--Users-merta-malsevk-2/673b8d14-085d-4ee5-80f7-209a097a3878/scratchpad/chrome-profile";

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  });
  const page = context.pages()[0] ?? (await context.newPage());

  // Kanıt toplama: konsol hataları + Supabase REST çağrılarının GERÇEK
  // durum kodları/gövdeleri (provider_service_authorizations/provider_
  // documents/provider_services) — "Yükleniyor..."da takılı kalma gibi bir
  // durumun sessiz bir ağ/RLS hatasından mı yoksa başka bir şeyden mi
  // kaynaklandığını kanıtlamak için.
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  const supabaseCalls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (/\/rest\/v1\/(provider_service_authorizations|provider_documents|provider_services|jobs)\b/.test(url)) {
      let bodySnippet = "";
      try {
        const text = await res.text();
        bodySnippet = text.slice(0, 300);
      } catch {
        bodySnippet = "(gövde okunamadı)";
      }
      supabaseCalls.push(`${res.status()} ${url.replace(/^https?:\/\/[^/]+/, "")} -> ${bodySnippet}`);
    }
  });

  // Zaten kalıcı profilden giriş yapılmış olabilir (bir önceki çalıştırmadan) —
  // önce mevcut durumu kontrol et, giriş EKRANINA gitmeden önce.
  await page.goto(`${BASE_URL}/panel`, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  let roleText = await page
    .getByRole("banner")
    .getByText(/Hizmet Alan|Hizmet Veren|Admin/)
    .first()
    .textContent()
    .catch(() => null);

  if (!roleText) {
    console.log("Bu kalıcı profilde henüz aktif bir oturum yok. Lütfen açılan pencerede KENDİ gerçek hesabınızla /giris-yap ekranından giriş yapın.");
    console.log("En fazla 10 dakika bekleyeceğim — giriş tamamlanınca script otomatik devam edecek.\n");
    await page.goto(`${BASE_URL}/giris-yap`, { timeout: 20000 });
    try {
      const roleLocator = page.getByRole("banner").getByText(/Hizmet Alan|Hizmet Veren|Admin/);
      await roleLocator.waitFor({ state: "visible", timeout: 600000 });
      roleText = (await roleLocator.first().textContent())?.trim() ?? null;
    } catch {
      console.log("10 dakika içinde giriş tamamlanmadı — script sonlandırılıyor. Oturum profili diske kaydedildiği için pencereyi kapatmadan tekrar çalıştırabilirsiniz.");
      return;
    }
  }
  console.log(`✓ Giriş algılandı (kalıcı profilden) — header rolü: "${roleText}"\n`);

  // 1) Panel > Profilim > "Hizmet Yetkileri" — GERÇEK, RLS-sınırlı, tüm
  // kategoriler için TEK doğruluk kaynağı (getMyServiceAuthorizations).
  console.log("=== 1) Panel > Profilim > Hizmet Yetkileri (GERÇEK oturumdan, tüm kategoriler) ===");
  await page.goto(`${BASE_URL}/panel/profil`, { timeout: 20000 });
  try {
    await page.getByRole("heading", { name: "Hizmet Yetkileri" }).waitFor({ state: "visible", timeout: 15000 });
    const loadingGone = await page
      .getByText("Yükleniyor...")
      .waitFor({ state: "hidden", timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!loadingGone) {
      console.log("  ✗ KART 20 SANİYE SONRA HÂLÂ 'Yükleniyor...' DURUMUNDA — getMyServiceAuthorizations sorgusu takılmış/yanıt vermiyor olabilir. Bu, ZİNCİRDEKİ GERÇEK BİR KIRILMA NOKTASI ADAYI.");
    }
    const cardText = await page.getByRole("heading", { name: "Hizmet Yetkileri" }).locator("..").innerText();
    console.log(cardText);
  } catch (e) {
    console.log(`  (Hizmet Yetkileri kartı bulunamadı/okunamadı: ${e.message} — bu hesap hizmet-veren olmayabilir)`);
  }

  // 2) Aktif İlanlar — hangi kategoriler filtre listesinde var, kaç ilan görünüyor.
  console.log("\n=== 2) Aktif İlanlar (/ilanlar) — filtre seçenekleri ve görünen ilan sayısı ===");
  await page.goto(`${BASE_URL}/ilanlar`, { timeout: 20000 });
  await page.waitForTimeout(3500); // yetki fetch'i + ilan listesi render'ı için önceki turdan daha uzun bekleme
  const categorySelectText = await page
    .locator('label:has-text("Hizmet Türü")')
    .locator("..")
    .innerText()
    .catch(() => "(Hizmet Türü filtresi bulunamadı)");
  console.log(`  Hizmet Türü filtre alanı: ${categorySelectText.replace(/\n/g, " | ")}`);
  const rowCountText = await page.locator("table tbody tr, ul[role='list'] > li").count().catch(() => 0);
  console.log(`  Görünen ilan satırı sayısı (filtre uygulanmamış hâliyle): ${rowCountText}`);

  // 3) Doğrudan ilan URL'si erişim testi — her bilinen kategori için.
  console.log("\n=== 3) Doğrudan ilan URL'si erişim testi (her kategori için gerçek, onaylı bir ilan) ===");
  for (const job of KNOWN_JOBS) {
    await page.goto(`${BASE_URL}/ilanlar/${job.jobId}`, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
    const notFound = await page.getByText("İlan bulunamadı veya artık yayında değil.").isVisible().catch(() => false);
    const titleVisible = await page.getByRole("heading", { name: job.title, exact: false }).isVisible().catch(() => false);
    const offerFormVisible = await page.getByLabel("Teklif Fiyatı").isVisible().catch(() => false);
    const authGateVisible = await page.getByText("teklif verebilmek için giriş yapmalısınız").isVisible().catch(() => false);
    const closedMessageVisible = await page.getByText(/teklif almaya açık değil|başka bir hizmet verenle/i).isVisible().catch(() => false);
    let verdict;
    if (notFound) verdict = "GÖRÜNMÜYOR (İlan bulunamadı — kategori yetkisi yok ya da moderasyon/izolasyon gizliyor)";
    else if (titleVisible && offerFormVisible) verdict = "GÖRÜNÜYOR + GERÇEK TEKLİF FORMU AÇIK";
    else if (titleVisible && authGateVisible) verdict = "GÖRÜNÜYOR ama teklif formu yerine 'giriş yapmalısınız' gösteriyor (oturum sorunu olabilir)";
    else if (titleVisible && closedMessageVisible) verdict = "GÖRÜNÜYOR ama teklif kapalı/başka sağlayıcıyla anlaşılmış (kategori izolasyonuyla ilgisiz, normal durum)";
    else if (titleVisible) verdict = "GÖRÜNÜYOR ama teklif alanı durumu netleşmedi (manuel kontrol edin)";
    else verdict = "BELİRSİZ (başlık da bulunamadı — sayfa farklı render olmuş olabilir)";
    console.log(`  [${job.categoryLabel}] ${job.jobId} — ${verdict}`);
  }

  console.log("\n=== 4) Konsol hataları (bu oturum boyunca) ===");
  if (consoleErrors.length === 0) {
    console.log("  (hiç konsol hatası yakalanmadı)");
  } else {
    consoleErrors.forEach((e) => console.log(`  ✗ ${e}`));
  }

  console.log("\n=== 5) Supabase REST çağrıları — provider_service_authorizations/provider_documents/provider_services/jobs ===");
  if (supabaseCalls.length === 0) {
    console.log("  (bu tablolara hiç REST çağrısı yakalanmadı — beklenmedik, sayfa hiç fetch yapmamış olabilir)");
  } else {
    supabaseCalls.forEach((c) => console.log(`  ${c}`));
  }

  console.log("\n=== Bitti. Bağlantı kapatılıyor (profil diskte kalıyor, tarayıcı penceresi kapanabilir). ===");
  await context.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Script hata verdi:", err);
  process.exit(1);
});
