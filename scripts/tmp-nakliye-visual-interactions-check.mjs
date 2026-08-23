// node scripts/tmp-nakliye-visual-interactions-check.mjs
// Paketleme seçimi -> "Ürün Adedi" gizlenmesi, Araç Tipi dropdown açılışı,
// ADR "Evet" -> ayrıntı panelinin açılması, "+ Ek yükleme koşulları" açılışı.
import { chromium } from "playwright";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const OUT_DIR = "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\screenshots";

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

function ok(msg) { console.log("  \u2713", msg); }
function fail(msg) { console.log("  \u2717 FAIL:", msg); process.exitCode = 1; }

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  page.on("pageerror", (err) => fail("Page error: " + err.message));

  await loginAs(page, "ilanveren@demo.test", "Demo123!");
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("nakliye");
  await page.waitForTimeout(400);

  // 1) Paketleme seçilmeden önce Ürün Adedi görünür olmalı
  const productQtyLabelBefore = await page.getByText("Ürün Adedi", { exact: true }).count();
  if (productQtyLabelBefore > 0) ok("Paketleme seçilmeden önce 'Ürün Adedi' görünür"); else fail("'Ürün Adedi' başlangıçta görünmüyor");

  // 2) Paletli seç -> Ürün Adedi gizlenmeli, Palet Adedi kartı açılmalı
  await page.getByRole("button", { name: "Paletli", exact: true }).click();
  await page.waitForTimeout(300);
  const productQtyLabelAfter = await page.getByText("Ürün Adedi", { exact: true }).count();
  if (productQtyLabelAfter === 0) ok("'Paletli' seçilince paylaşılan 'Ürün Adedi' gizlendi"); else fail("'Paletli' seçildikten sonra 'Ürün Adedi' hâlâ görünüyor (mükerrer alan riski)");
  const paletAdedi = await page.getByText("Palet Adedi", { exact: true }).count();
  if (paletAdedi > 0) ok("'Palet Adedi' özel alanı açıldı"); else fail("'Palet Adedi' alanı açılmadı");

  await page.screenshot({ path: path.join(OUT_DIR, "6-packaging-expanded.png") });

  // 3) Kasalı/Sandıklı da ekle -> iki kart birlikte
  await page.getByRole("button", { name: "Kasalı/Sandıklı", exact: true }).click();
  await page.waitForTimeout(300);
  const kasaAdedi = await page.getByText("Kasa/Sandık Adedi", { exact: true }).count();
  if (kasaAdedi > 0) ok("'Kasa/Sandık Adedi' özel alanı da açıldı (iki tip birlikte)"); else fail("'Kasa/Sandık Adedi' açılmadı");
  await page.screenshot({ path: path.join(OUT_DIR, "7-packaging-two-types.png") });

  // 4) Araç Tipi kompakt dropdown -> tıklayınca açılır, kapalı başlar
  const vehicleTrigger = page.locator('button[id$="-vehicle-types"]');
  const alreadyOpen = await page.locator('div[role="group"][aria-label="Araç Tipi"]').count();
  if (alreadyOpen === 0) ok("Araç Tipi dropdown kapalı başlıyor (duvar değil)"); else fail("Araç Tipi dropdown başlangıçta açık");
  await vehicleTrigger.click();
  await page.waitForTimeout(200);
  const openNow = await page.locator('div[role="group"][aria-label="Araç Tipi"]').count();
  if (openNow > 0) ok("Araç Tipi dropdown tıklanınca açılıyor"); else fail("Araç Tipi dropdown tıklanınca açılmadı");
  await page.screenshot({ path: path.join(OUT_DIR, "8-vehicle-dropdown-open.png") });
  await page.keyboard.press("Escape");

  // 5) ADR "Evet" -> ayrıntı paneli açılmalı
  const section6 = page.getByText("Özel Taşıma Koşulları", { exact: true }).first();
  await section6.scrollIntoViewIfNeeded();
  const adrToggle = page.locator('div[role="radiogroup"][aria-label="Tehlikeli Madde/ADR"] button', { hasText: "Evet" });
  await adrToggle.click();
  await page.waitForTimeout(300);
  const unNumberField = await page.getByText("UN Numarası", { exact: true }).count();
  if (unNumberField > 0) ok("ADR 'Evet' seçilince ayrıntı paneli (UN Numarası vb.) açıldı"); else fail("ADR 'Evet' sonrası ayrıntı paneli açılmadı");
  await page.screenshot({ path: path.join(OUT_DIR, "9-adr-expanded.png") });

  // 6) "+ Ek yükleme koşulları" kapalı başlamalı, tıklanınca açılmalı
  const section5 = page.getByText("Yükleme ve Teslimat", { exact: true }).first();
  await section5.scrollIntoViewIfNeeded();
  const siteTypeBefore = await page.getByText("Yer Tipi", { exact: true }).count();
  if (siteTypeBefore === 0) ok("'Ek yükleme koşulları' kapalı başlıyor (Yer Tipi vb. görünmüyor)"); else fail("Ek yükleme koşulları başlangıçta açık görünüyor");
  await page.getByRole("button", { name: "+ Ek yükleme koşulları" }).click();
  await page.waitForTimeout(300);
  const siteTypeAfter = await page.getByText("Yer Tipi", { exact: true }).count();
  if (siteTypeAfter > 0) ok("'+ Ek yükleme koşulları' tıklanınca açıldı"); else fail("'+ Ek yükleme koşulları' tıklanınca açılmadı");
  await page.screenshot({ path: path.join(OUT_DIR, "10-loading-extras-expanded.png") });

  await browser.close();
}

main().catch((err) => {
  console.error("HATA:", err);
  process.exit(1);
});
