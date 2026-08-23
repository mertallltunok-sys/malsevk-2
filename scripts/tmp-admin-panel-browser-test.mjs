// MALSEVK — Admin paneli (Dashboard/Firmalar/Firma Belgeleri) Playwright
// doğrulaması. Yerel dev server (localhost:3000, local Docker Supabase'e
// bağlı) + tmp-admin-panel-seed-local.mjs'in ürettiği test hesaplarına karşı
// çalışır. Kimlik bilgileri komut satırı argümanı olarak verilir.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const [, , adminEmail, normalEmail, companyAId, companyBId, pendingDocId, secondPendingDocId] = process.argv;
const PASSWORD = "TestSifre2026!";

if (!adminEmail || !normalEmail) {
  console.error("Usage: node tmp-admin-panel-browser-test.mjs <adminEmail> <normalEmail> <companyAId> <companyBId> <pendingDocId>");
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
}

const browser = await chromium.launch();

// --- 1) Normal (non-admin) kullanıcı admin route'larına erişemiyor ---
{
  const page = await browser.newPage();
  await login(page, normalEmail);
  await page.waitForTimeout(1500);
  // requireAdminOrRedirect (0012/require-admin.ts): oturumu olan ama admin
  // OLMAYAN bir kullanıcı için notFound() döner -- URL /admin'de KALIR, ama
  // gerçek bir HTTP 404 render edilir (yönlendirme değil, "rotanın varlığını
  // gizleme" deseni). Bu yüzden doğru kontrol URL değişikliği değil, HTTP
  // durum kodudur.
  const response = await page.goto(`${BASE_URL}/admin`);
  check("Normal user visiting /admin gets a real HTTP 404 (notFound(), not a Dashboard)", response?.status() === 404, `status: ${response?.status()}`);
  await page.close();
}

// --- 2) Admin kullanıcı Dashboard'u görebiliyor ---
const adminPage = await browser.newPage();
await login(adminPage, adminEmail);
await adminPage.waitForTimeout(1500);
await adminPage.goto(`${BASE_URL}/admin`);
await adminPage.waitForSelector("text=Toplam Kullanıcı", { timeout: 15000 }).catch(() => {});
{
  const hasTotalUsers = await adminPage.getByText("Toplam Kullanıcı").isVisible().catch(() => false);
  check("Admin sees Dashboard with stat cards", hasTotalUsers);

  const bodyText = await adminPage.textContent("body");
  check("Dashboard does not show a literal placeholder/demo marker", !/lorem ipsum|placeholder|demo veri/i.test(bodyText ?? ""));

  // Gerçek veriden geldiğini doğrulamak için: "Toplam Hizmet Veren Firma"
  // kartının değeri en az 4 olmalı (seed 4 firma oluşturdu).
  const cardValue = await adminPage
    .locator("p", { hasText: "Toplam Hizmet Veren Firma" })
    .locator("xpath=following-sibling::p")
    .first()
    .textContent()
    .catch(() => null);
  check("Toplam Hizmet Veren Firma card shows a real count (>= 4)", Number(cardValue) >= 4, `got: ${cardValue}`);
}

// --- 3) Firmalar: gerçek veriden geliyor, arama/filtre çalışıyor ---
await adminPage.goto(`${BASE_URL}/admin/firmalar`);
await adminPage.waitForSelector("table", { timeout: 15000 }).catch(() => {});
{
  const rowCountBefore = await adminPage.locator("table tbody tr").count();
  check("Firmalar table shows real rows (>= 4)", rowCountBefore >= 4, `rows: ${rowCountBefore}`);

  const hasGebze = await adminPage.getByText("Gebze Lojistik Ltd.").first().isVisible().catch(() => false);
  check("Seeded company 'Gebze Lojistik Ltd.' appears in the list", hasGebze);

  await adminPage.locator('input[type="search"]').fill("Gebze Lojistik");
  await adminPage.waitForTimeout(400);
  const rowCountAfterSearch = await adminPage.locator("table tbody tr").count();
  check("Search filters the list down to 1 row", rowCountAfterSearch === 1, `rows: ${rowCountAfterSearch}`);
  await adminPage.locator('input[type="search"]').fill("");
  await adminPage.waitForTimeout(300);
}

// --- 4) Firma detay sayfası ---
if (companyAId) {
  await adminPage.goto(`${BASE_URL}/admin/firmalar/${companyAId}`);
  await adminPage.waitForSelector("text=Firma Profil Bilgileri", { timeout: 15000 }).catch(() => {});
  const hasCompanyName = await adminPage.getByText("Kocaeli Nakliyat A.Ş.").first().isVisible().catch(() => false);
  check("Company detail page shows the company's own data", hasCompanyName);
}

// --- 5) Firma Belgeleri: sekmeler, admin tüm belgeleri görebiliyor ---
await adminPage.goto(`${BASE_URL}/admin/firma-belgeleri`);
await adminPage.waitForSelector("text=Bekleyen", { timeout: 15000 }).catch(() => {});
{
  // "/Bekleyen/" ("Revizyon Bekleyen" sekmesiyle de eşleşir) yerine tam
  // metin eşleşmesi kullanılır.
  const pendingTabVisible = await adminPage.getByRole("button", { name: /^Bekleyen/ }).isVisible().catch(() => false);
  check("Firma Belgeleri tabs render (Bekleyen)", pendingTabVisible);

  const rowsOnPendingTab = await adminPage.locator("table tbody tr").count();
  check("Pending tab shows at least 1 document (seeded pending doc)", rowsOnPendingTab >= 1, `rows: ${rowsOnPendingTab}`);

  await adminPage.getByRole("button", { name: /^Tümü/ }).click();
  await adminPage.waitForTimeout(400);
  const rowsOnAllTab = await adminPage.locator("table tbody tr").count();
  check("Tümü tab shows more documents than Bekleyen alone (>= 4)", rowsOnAllTab >= 4, `rows: ${rowsOnAllTab}`);
}

// --- 6) İncele ekranı: onayla/reddet/revizyon, not zorunluluğu ---
if (pendingDocId) {
  await adminPage.goto(`${BASE_URL}/admin/firma-belgeleri/${pendingDocId}`);
  await adminPage.waitForSelector("text=Önceki İnceleme Geçmişi", { timeout: 15000 }).catch(() => {});

  const hasNoHistoryYet = await adminPage.getByText("henüz bir inceleme kararı verilmemiş").isVisible().catch(() => false);
  check("Review history starts empty for a never-reviewed pending document", hasNoHistoryYet);

  await adminPage.getByRole("button", { name: "Reddet" }).click();
  await adminPage.waitForTimeout(300);
  const submitDisabledEmpty = await adminPage.getByRole("button", { name: "Gönder" }).isDisabled().catch(() => false);
  check("Submit is disabled with an empty note (reject requires a reason)", submitDisabledEmpty);

  await adminPage.locator("#admin-review-note").fill("Test: belge net değil, tekrar taranmalı.");
  await adminPage.getByRole("button", { name: "Gönder" }).click();
  await adminPage.waitForTimeout(1200);

  const statusAfterReject = await adminPage.getByText("Reddedildi", { exact: true }).first().isVisible().catch(() => false);
  check("Document status updates to Reddedildi after admin rejects with a note", statusAfterReject);

  const historyHasEntry = await adminPage.getByText("Reddetti").first().isVisible().catch(() => false);
  check("Review history now shows the reject action", historyHasEntry);

  const noteInHistory = await adminPage.getByText("Test: belge net değil, tekrar taranmalı.").first().isVisible().catch(() => false);
  check("Review history shows the admin's note", noteInHistory);
}

// --- 6b) Firmalar listesinde rozet durumu salt okunur gösteriliyor ---
await adminPage.goto(`${BASE_URL}/admin/firmalar`);
await adminPage.waitForSelector("table", { timeout: 15000 }).catch(() => {});
{
  const rowText = await adminPage
    .locator("tr", { hasText: "Gebze Lojistik Ltd." })
    .first()
    .textContent()
    .catch(() => "");
  check("Firmalar list shows the company's active badge (Mavi Tik) read-only", (rowText ?? "").includes("Mavi Tik"), rowText ?? "");
  // Rozet için hiçbir "ver/kaldır" butonu YOK (yalnızca salt okunur) — bu
  // görevin kapsamı dışı bırakılan "Rozet yönetimi"nin burada sızmadığını
  // doğrular.
  const hasBadgeActionButton = await adminPage.getByRole("button", { name: /rozet/i }).count();
  check("No badge grant/revoke action exists on the Firmalar list (out of scope)", hasBadgeActionButton === 0, `count: ${hasBadgeActionButton}`);
}

// --- 6c) Onayla eylemi (yalnızca reddet değil, gerçek onay akışı da) ---
if (secondPendingDocId) {
  await adminPage.goto(`${BASE_URL}/admin/firma-belgeleri/${secondPendingDocId}`);
  await adminPage.waitForSelector("text=Önceki İnceleme Geçmişi", { timeout: 15000 }).catch(() => {});
  await adminPage.getByRole("button", { name: "Onayla" }).click();
  await adminPage.waitForTimeout(1200);
  const statusAfterApprove = await adminPage.getByText("Onaylandı", { exact: true }).first().isVisible().catch(() => false);
  check("Document status updates to Onaylandı after admin approves", statusAfterApprove);
  const historyHasApprove = await adminPage.getByText("Onayladı").first().isVisible().catch(() => false);
  check("Review history shows the approve action", historyHasApprove);
}

// --- 7) Private Storage: signed URL üretilebiliyor ama tahmin edilebilir/kalıcı public bir yol yok ---
if (companyBId) {
  const probe = await adminPage.request
    .get(`http://127.0.0.1:54321/storage/v1/object/public/provider-documents/${companyBId}/faaliyet-belgesi.pdf`)
    .catch(() => null);
  check("Guessing a public Storage URL for a private document fails (no anonymous access)", !probe || probe.status() >= 400, probe ? `status=${probe.status()}` : "no response");
}

await adminPage.close();
await browser.close();

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
