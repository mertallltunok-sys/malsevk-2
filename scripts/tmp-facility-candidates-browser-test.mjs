// MALSEVK — Admin Paneli Faz 3 "Sistem Beslemesi" Playwright doğrulaması.
// Yerel dev server (local Docker Supabase'e bağlı) + tmp-facility-
// candidates-seed-local.mjs'in ürettiği test hesabına/adaylara karşı
// çalışır. tmp-admin-panel-phase2-browser-test.mjs İLE AYNI desen.
//
// PORT NOTU: BASE_URL varsayılan olarak 3000'dir. Eğer 3000'de zaten
// (ör. ".env.local" hosted projeye işaret eden) başka bir `next dev` süreci
// çalışıyorsa, Next.js 16'nın proje-dizini-başına tek-örnek kilidi ikinci
// bir örneğin AYNI .next dizinini kullanarak başlamasını engeller — bu
// durumda `next.config.ts`'ye GEÇİCİ bir `distDir` (ör. ".next-test") ekleyip
// farklı bir portta (`npx next dev -p <port>`) ayrı bir örnek başlatın,
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY'i .env.local'a DOKUNMADAN doğrudan
// process env olarak geçirin (Next, zaten ayarlı process.env değerlerini
// .env.local ile EZMEZ), testten sonra hem next.config.ts'yi hem
// tsconfig.json'ı (Next bu ayarları otomatik olarak tsconfig.json'a da
// yazar) TAM ORİJİNALİNE geri döndürün ve `.next-test`'i silin — .env.local
// hot-reload edilen paylaşılan bir dosyadır, ONA DOKUNMAK aynı dizindeki
// başka bir çalışan dev server'ı (varsa) da etkiler.
const BASE_URL = "http://localhost:3000";
const [, , adminEmail, candidateToApproveId, candidateToRejectId] = process.argv;
const PASSWORD = "TestSifre2026!";

if (!adminEmail || !candidateToApproveId || !candidateToRejectId) {
  console.error("Usage: node tmp-facility-candidates-browser-test.mjs <adminEmail> <candidateToApproveId> <candidateToRejectId>");
  process.exit(1);
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

async function login(page, email) {
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();

// --- 0) Normal (admin olmayan) kullanıcı /admin/sistem-beslemesi'ye erişemiyor ---
{
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/admin/sistem-beslemesi`);
  await page.waitForTimeout(1500);
  const url = page.url();
  check("Girişsiz ziyaretçi /admin/sistem-beslemesi'den giriş sayfasına yönlendiriliyor", url.includes("/giris-yap"), url);
  await page.close();
}

const page = await browser.newPage();
await login(page, adminEmail);

// --- 1) Sidebar'da Sistem Beslemesi modülü görünüyor ---
await page.goto(`${BASE_URL}/admin`);
await page.waitForTimeout(1000);
{
  const bodyText = await page.textContent("body");
  check("Admin sidebar'ında 'Sistem Beslemesi' linki var", /Sistem Beslemesi/.test(bodyText ?? ""));
}

// --- 2) Liste ekranı: gruplanmış aday + ham girdi örneği görünüyor ---
await page.goto(`${BASE_URL}/admin/sistem-beslemesi`);
await page.waitForSelector("text=aday bulundu", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Liste ekranı 'aday bulundu' sayacını gösteriyor", /\d+ aday bulundu/.test(bodyText ?? ""));
  check("Onaylanacak grubun önerilen adı listede görünüyor", /Playwright Test Port/.test(bodyText ?? ""));
  check("Bekleyen durumu gösteriliyor", /Bekleyen/.test(bodyText ?? ""));
}

// --- 3) Detay ekranı: benzer yazımlar + kullanım sayısı doğru ---
await page.goto(`${BASE_URL}/admin/sistem-beslemesi/${candidateToApproveId}`);
await page.waitForSelector("text=Benzer Yazımlar", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Detay ekranı 'Benzer Yazımlar' bölümünü gösteriyor", /Benzer Yazımlar/.test(bodyText ?? ""));
  check("3 farklı ham yazım listede görünüyor", /playwrighttestport/.test(bodyText ?? "") && /Playwright Test Port İşletmesi/.test(bodyText ?? ""));
  check("Toplam kullanım 3 gösteriliyor", /Toplam kullanım: 3/.test(bodyText ?? ""));
}

// --- 4) Tek tuşla ONAYLA (detay ekranından) ---
await page.getByRole("button", { name: "Onayla" }).first().click();
await page.waitForTimeout(1500);
{
  const bodyText = await page.textContent("body");
  check("Onay sonrası başarı mesajı görünüyor", /onayland[ıi]/i.test(bodyText ?? ""));
  check("Durum rozeti 'Onaylanan' olarak güncellendi", /Onaylanan/.test(bodyText ?? ""));
}

// --- 5) Liste ekranında artık 'Onaylanan' filtresiyle görünüyor, varsayılan (Bekleyen) filtrede değil ---
await page.goto(`${BASE_URL}/admin/sistem-beslemesi`);
await page.waitForTimeout(1000);
{
  const bodyTextPending = await page.textContent("body");
  const stillInPendingCard = new RegExp(`Playwright Test Port[\\s\\S]{0,400}Bekleyen`).test(bodyTextPending ?? "");
  check("Onaylanan aday varsayılan (Bekleyen) filtrede artık ONAYLA butonuyla görünmüyor", !stillInPendingCard, "beklenmedik şekilde hâlâ bekleyen görünüyor");
}

// --- 6) Reddet akışı: gerekçesiz reddedilemiyor, gerekçeyle reddediliyor ---
await page.goto(`${BASE_URL}/admin/sistem-beslemesi/${candidateToRejectId}`);
await page.waitForSelector('button:has-text("Reddet")', { timeout: 15000 }).catch(() => {});
await page.getByRole("button", { name: "Reddet" }).click();
await page.waitForTimeout(500);
{
  const submitButton = page.getByRole("button", { name: "Gönder" });
  const isDisabled = await submitButton.isDisabled().catch(() => null);
  check("Boş gerekçeyle 'Gönder' butonu devre dışı", isDisabled === true, `isDisabled=${isDisabled}`);
}
await page.locator("#fc-reject-reason").fill("Playwright testi: anlamsız girdi");
await page.getByRole("button", { name: "Gönder" }).click();
await page.waitForTimeout(1500);
{
  const bodyText = await page.textContent("body");
  check("Reddedilen adayın durumu 'Reddedilen' olarak güncellendi", /Reddedilen/.test(bodyText ?? ""));
  check("Red gerekçesi detay ekranında görünüyor", /Playwright testi: anlamsız girdi/.test(bodyText ?? ""));
}

await browser.close();

console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Başarısız testler:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
