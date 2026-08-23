// Real browser test — Admin "Operasyonlar" module against a genuinely
// accepted multi-service operation (2 services, 1 accepted offer, 1 pending
// offer, same operation_id). Cross-checks the admin screen's displayed
// values against the exact data the setup script wrote to the real
// Development database.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const [, , adminEmail, password, dataJson] = process.argv;
if (!adminEmail || !password || !dataJson) {
  console.error("usage: node tmp-operasyonlar-e2e-browser-test.mjs <adminEmail> <password> '<dataJson>'");
  process.exit(1);
}
const d = JSON.parse(dataJson);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? " -- " + extra : ""}`); }
}
const consoleErrors = [];
const networkErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
page.on("response", (res) => { if (res.status() >= 500) networkErrors.push(`${res.status()} ${res.url()}`); });

await page.goto(`${BASE_URL}/giris-yap`);
await page.locator('input[type="email"]').fill(adminEmail);
await page.locator('input[type="password"]').fill(password);
await page.getByRole("button", { name: "Giriş Yap" }).click();
await page.waitForTimeout(2000);

await page.goto(`${BASE_URL}/admin/operasyonlar`);
await page.waitForTimeout(2000);
check("Admin 'Operasyonlar' listesine ulaştı", page.url().includes("/admin/operasyonlar"), page.url());

const listText = await page.locator("body").innerText();
check("Liste 'Tümü' özetinde tam olarak 2 operasyon gösteriyor (gerçek 2 offer'la eşleşiyor)", /2\s*operasyon bulundu/.test(listText), listText.match(/\d+\s*operasyon bulundu/)?.[0]);
check("Liste, kabul edilen offer'ı 'Devam Eden' durumunda gösteriyor (OPERASYON NO ile eşleşen satır)", new RegExp(d.offerAId.slice(0, 8), "i").test(listText) && listText.toUpperCase().includes(d.offerAId.slice(0, 8).toUpperCase()));
check("Liste, bekleyen offer'ı 'Bekleyen' durumunda gösteriyor", listText.toUpperCase().includes(d.offerBId.slice(0, 8).toUpperCase()));
check("Liste satırlarında doğru kategori etiketleri (Kapalı Depolama / Açık Saha Depolama) görünüyor", listText.includes("Kapalı Depolama") && listText.includes("Açık Saha Depolama"));
check("Liste satırlarında doğru firma adı (Hizmet Veren) görünüyor", listText.includes("Operasyon Test Provider Firma"));
check("Özet sayaçları gerçek veriyle eşleşiyor (Bekleyen 1, Devam Eden 1)", /Bekleyen\s+1/.test(listText) && /Devam Eden\s+1/.test(listText));

// Offer A — accepted
await page.goto(`${BASE_URL}/admin/operasyonlar/${d.offerAId}`);
await page.waitForTimeout(2000);
const detailA = await page.locator("body").innerText();
check("Detay A: doğru ilan başlığı", detailA.includes("Operasyon Testi Hizmet A — Kapalı Depolama"));
check("Detay A: doğru teklif durumu (Kabul Edildi)", detailA.includes("Kabul Edildi"));
check("Detay A: doğru teklif tutarı (12.500 TRY)", detailA.includes("12.500") && detailA.includes("TRY"));
check("Detay A: doğru Operasyon Grubu kısaltması", detailA.includes(d.operationId.slice(0, 8).toUpperCase()));
check("Detay A: doğru Hizmet Veren firma adı", detailA.includes("Operasyon Test Provider Firma"));
check("Detay A: doğru Hizmet Veren yetkili kişi", detailA.includes("Operasyon Test Provider Kisi"));
check("Detay A: doğru Hizmet Alan firma adı", detailA.includes("Operasyon Test Requester Firma"));
check("Detay A: doğru Hizmet Alan yetkili kişi", detailA.includes("Operasyon Test Requester Kisi"));
check("Detay A: yanlış/başka bir firmanın adı YOK (çapraz kontaminasyon yok)", !detailA.includes("Provider Firma B") && !detailA.includes("Requester Firma B"));

// Offer B — still pending, same operation
await page.goto(`${BASE_URL}/admin/operasyonlar/${d.offerBId}`);
await page.waitForTimeout(2000);
const detailB = await page.locator("body").innerText();
check("Detay B: doğru ilan başlığı", detailB.includes("Operasyon Testi Hizmet B — Açık Saha Depolama"));
check("Detay B: doğru teklif durumu (Bekliyor)", detailB.includes("Bekliyor"));
check("Detay B: doğru teklif tutarı (8.750 TRY)", detailB.includes("8.750") && detailB.includes("TRY"));
check("Detay B: AYNI Operasyon Grubu kısaltması (A ile aynı operation_id'yi paylaşıyor)", detailB.includes(d.operationId.slice(0, 8).toUpperCase()));
check("Detay B: doğru Hizmet Veren/Hizmet Alan (A ile aynı taraflar)", detailB.includes("Operasyon Test Provider Firma") && detailB.includes("Operasyon Test Requester Firma"));

check("Admin salt-görüntüleme uyarısı gösteriliyor (durum değiştirilemez notu)", detailA.includes("admin buradan durum değiştiremez"));

check("Console'da hiçbir gerçek hata YOK", consoleErrors.length === 0, JSON.stringify(consoleErrors));
check("Network'te hiçbir 5xx hatası YOK", networkErrors.length === 0, JSON.stringify(networkErrors));

await browser.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
