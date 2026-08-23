// MALSEVK — Admin Paneli Faz 2: normal (admin olmayan) kullanıcının yeni 3
// modüle erişememesini doğrular. Yerel dev server + local Docker Supabase.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const [, , normalEmail] = process.argv;
const PASSWORD = "TestSifre2026!";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE_URL}/giris-yap`);
await page.locator('input[type="email"]').fill(normalEmail);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Giriş Yap" }).click();
await page.waitForTimeout(1500);

for (const path of ["/admin/rozet-yonetimi", "/admin/ilanlar", "/admin/operasyonlar"]) {
  const response = await page.goto(`${BASE_URL}${path}`);
  check(`Normal kullanıcı ${path} adresinde gerçek HTTP 404 alıyor`, response?.status() === 404, `status: ${response?.status()}`);
}

const anonPage = await browser.newPage();
for (const path of ["/admin/rozet-yonetimi", "/admin/ilanlar", "/admin/operasyonlar"]) {
  const response = await anonPage.goto(`${BASE_URL}${path}`);
  const url = anonPage.url();
  check(`Oturumsuz ziyaretçi ${path} adresinden /giris-yap'a yönlendiriliyor`, url.includes("/giris-yap"), `landed on: ${url}, status: ${response?.status()}`);
}

await browser.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
