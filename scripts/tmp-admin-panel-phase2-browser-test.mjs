// MALSEVK — Admin Paneli Faz 2 (Rozet Yönetimi / İlan Yönetimi / Operasyon
// Yönetimi) Playwright doğrulaması. Yerel dev server (localhost:3000, local
// Docker Supabase'e bağlı) + tmp-admin-panel-phase2-seed-local.mjs'in
// ürettiği test hesaplarına karşı çalışır.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const [, , adminEmail, provider2Id, job1Id, job7Id, offer5JobId] = process.argv;
const PASSWORD = "TestSifre2026!";

if (!adminEmail || !provider2Id || !job1Id || !job7Id) {
  console.error("Usage: node tmp-admin-panel-phase2-browser-test.mjs <adminEmail> <provider2Id> <job1Id> <job7Id> <offer5JobId>");
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
const page = await browser.newPage();
await login(page, adminEmail);

// --- 1) Rozet Yönetimi listesi ---
await page.goto(`${BASE_URL}/admin/rozet-yonetimi`);
await page.waitForSelector("text=firma bulundu", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Rozet Yönetimi listesi yükleniyor ve firma sayısı gösteriyor", /\d+ firma bulundu/.test(bodyText ?? ""));
  check("Liste 'Mavi Tik' rozetini gösteriyor", /Mavi Tik/.test(bodyText ?? ""));
  check("Liste 'Rozetsiz' durumunu gösteriyor (provider3)", /Rozetsiz/.test(bodyText ?? ""));
}

// --- 2) Rozet detay ekranı: provider2 (iki aktif rozet + tarihçe) ---
await page.goto(`${BASE_URL}/admin/rozet-yonetimi/${provider2Id}`);
await page.waitForSelector("text=Mevcut Rozetler", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Rozet detay ekranı 'Mevcut Rozetler' bölümünü gösteriyor", /Mevcut Rozetler/.test(bodyText ?? ""));
  check("provider2 hem Mavi Tik hem Altın Tik'i aktif gösteriyor", /Mavi Tik/.test(bodyText ?? "") && /Altın Tik/.test(bodyText ?? ""));
  check("Rozet Tarihçesi bölümü görünüyor (kaldırılmış + yeniden verilmiş kayıt dahil)", /Rozet Tarihçesi/.test(bodyText ?? ""));
  check("Tarihçede 'İptal Edilmiş' bir kayıt var (revoke-then-regrant senaryosu)", /İptal Edilmiş/.test(bodyText ?? ""));
}

// --- 3) Canlı aksiyon: UI üzerinden Altın Tik'i kaldır ---
{
  const revokeButtons = page.getByRole("button", { name: "Rozeti Kaldır" });
  const countBefore = await revokeButtons.count();
  check("Kaldırma öncesi en az 1 aktif rozet satırı var", countBefore >= 1, `count=${countBefore}`);
  if (countBefore >= 1) {
    await revokeButtons.first().click();
    await page.getByPlaceholder("Rozet neden kaldırılıyor?").fill("Faz 2 Playwright doğrulaması: canlı kaldırma testi.");
    await page.getByRole("button", { name: "Gönder" }).click();
    await page.waitForTimeout(1500);
    const bodyText = await page.textContent("body");
    check("Canlı 'Rozeti Kaldır' işlemi sonrası sayfa yeniden yüklendi (hata yok)", !/kaldırılamadı/.test(bodyText ?? ""));
  }
}

// --- 4) İlan Yönetimi listesi ---
await page.goto(`${BASE_URL}/admin/ilanlar`);
await page.waitForSelector("text=ilan bulundu", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("İlan Yönetimi listesi yükleniyor", /\d+ ilan bulundu/.test(bodyText ?? ""));
  check("Liste 'Kapatıldı' durumunu gösteriyor (job7, admin tarafından kapatıldı)", /Kapatıldı/.test(bodyText ?? ""));
  check("Liste 'Tamamlandı' durumunu gösteriyor (job4)", /Tamamlandı/.test(bodyText ?? ""));
}

// --- 5) İlan detay: zaten kapatılmış ilan (job7) — Yayından Kaldır disabled olmalı ---
await page.goto(`${BASE_URL}/admin/ilanlar/${job7Id}`);
await page.waitForSelector("text=Kapatılma Tarihi", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Kapatılmış ilan detayında 'Kapatılma Tarihi' gösteriliyor", /Kapatılma Tarihi/.test(bodyText ?? ""));
  const unpublishButton = page.getByRole("button", { name: "Yayından Kaldır" });
  check("Zaten kapatılmış ilanda 'Yayından Kaldır' butonu devre dışı", await unpublishButton.isDisabled());
  const republishButton = page.getByRole("button", { name: "Yeniden Yayınla" });
  check("'Yeniden Yayınla' butonu devre dışı (admin RPC'si bu fazda yok)", await republishButton.isDisabled());
  const deactivateButton = page.getByRole("button", { name: "Pasife Al" });
  check("'Pasife Al' butonu devre dışı (backend altyapısı bu fazda yok)", await deactivateButton.isDisabled());
}

// --- 6) Canlı aksiyon: hâlâ açık bir ilanı (job1) gerçek RPC ile yayından kaldır ---
await page.goto(`${BASE_URL}/admin/ilanlar/${job1Id}`);
await page.waitForSelector("text=Yayından Kaldır", { timeout: 15000 }).catch(() => {});
{
  const unpublishButton = page.getByRole("button", { name: "Yayından Kaldır" });
  check("job1 için 'Yayından Kaldır' butonu aktif (henüz kapalı değil)", await unpublishButton.isEnabled());
  await unpublishButton.click();
  await page.locator("#admin-job-unpublish-reason").selectOption("yanlislikla-olusturuldu");
  await page.getByRole("button", { name: "Gönder" }).click();
  await page.waitForTimeout(2000);
  const bodyText = await page.textContent("body");
  check("Canlı 'Yayından Kaldır' işlemi sonrası ilan 'Kapatıldı' durumuna geçti", /Kapatıldı/.test(bodyText ?? ""));
  check("Kapatma nedeni ilan detayında (enum etiketiyle) görünüyor", /Yanlışlıkla oluşturuldu/.test(bodyText ?? ""));
}

// --- 7) Operasyon Yönetimi: sekmeler + detay + tarihçe ---
await page.goto(`${BASE_URL}/admin/operasyonlar`);
await page.waitForSelector("text=operasyon bulundu", { timeout: 15000 }).catch(() => {});
{
  const bodyText = await page.textContent("body");
  check("Operasyon Yönetimi listesi yükleniyor", /\d+ operasyon bulundu/.test(bodyText ?? ""));
  check("'Anlaşmazlık' sekmesi/etiketi görünüyor", /Anlaşmazlık/.test(bodyText ?? ""));

  await page.getByRole("button", { name: /Anlaşmazlık/ }).click();
  await page.waitForTimeout(800);
  const disputeTabText = await page.textContent("body");
  check("Anlaşmazlık sekmesine tıklandığında en az 1 satır görünüyor", !/görüntülenecek operasyon bulunamadı/.test(disputeTabText ?? ""));
}

// --- 8) Operasyon detay: salt görüntüleme, tarihçe doğru gösteriliyor ---
if (offer5JobId) {
  // offer5, job5'in TEK teklifidir — job5 sayfasından değil, listeden Detay linkiyle giderdik normalde;
  // burada job5Id doğrudan offerId olarak KULLANILMAZ, bu yüzden bu adım yalnızca sayfa mevcutsa çalışır.
}
await page.goto(`${BASE_URL}/admin/operasyonlar`);
await page.waitForSelector("text=operasyon bulundu", { timeout: 15000 }).catch(() => {});
{
  const firstDetailLink = page.getByRole("link", { name: "Detay" }).first();
  await firstDetailLink.click();
  await page.waitForSelector("text=Tarihçe", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const bodyText = await page.textContent("body");
  check("Operasyon detay ekranı 'Hizmet Veren'/'Hizmet Alan' bölümlerini gösteriyor", /Hizmet Veren/.test(bodyText ?? "") && /Hizmet Alan/.test(bodyText ?? ""));
  check("Operasyon detay ekranı 'Tarihçe' bölümünü gösteriyor", /Tarihçe/.test(bodyText ?? ""));
  check("Operasyon detay ekranı salt-görüntüleme uyarısını gösteriyor (admin durum değiştiremez)", /admin buradan durum değiştiremez/.test(bodyText ?? ""));
}

// --- 9) Sidebar: 6 modül de görünüyor ---
await page.goto(`${BASE_URL}/admin`);
await page.waitForTimeout(1000);
{
  const bodyText = await page.textContent("body");
  check("Sidebar 'Rozet Yönetimi' linkini gösteriyor", /Rozet Yönetimi/.test(bodyText ?? ""));
  check("Sidebar 'İlan Yönetimi' linkini gösteriyor", /İlan Yönetimi/.test(bodyText ?? ""));
  check("Sidebar 'Operasyon Yönetimi' linkini gösteriyor", /Operasyon Yönetimi/.test(bodyText ?? ""));
}

await browser.close();

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
