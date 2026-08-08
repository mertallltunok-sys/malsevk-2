// MALSEVK — forgot-password-form.tsx çift-gönderim koruması regresyon testi.
// Hızlı çift tıklama/Enter'ın Supabase'in kısıtlı saatlik e-posta kotasını
// gereksiz yere iki kez tüketmediğini gerçek tarayıcıda doğrular — ağdaki
// gerçek `resetPasswordForEmail` (auth/v1/recover) isteği sayısını sayar.
// İzole dizin kopyasındaki dev server'a karşı (canlı localhost:3000'e dokunmaz).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3055";
const ts = Date.now();

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

const browser = await chromium.launch();
const page = await browser.newPage();

let recoverRequestCount = 0;
page.on("request", (request) => {
  if (request.url().includes("/auth/v1/recover")) recoverRequestCount += 1;
});

console.log("=== Hızlı çift tıklama: yalnızca TEK istek gönderilmeli ===");
await page.goto(`${BASE_URL}/sifre-sifirla`);
await page.getByLabel("E-posta").fill(`doubleclick-${ts}@example.com`);

const button = page.getByRole("button", { name: "Sıfırlama Bağlantısı Gönder" });
// İki tıklamayı BİLEREK await ETMEDEN art arda tetikle (senkron kilit
// testinin asıl amacı: React state commit edilmeden önceki ikinci event).
await Promise.all([button.click(), button.click()]);
await page.waitForTimeout(2000);

check("Hızlı çift tıklamada yalnızca 1 gerçek resetPasswordForEmail isteği gönderildi", recoverRequestCount === 1, `count=${recoverRequestCount}`);
check("Başarı ekranı gösteriliyor", await page.getByText("şifre sıfırlama bağlantısını içeren bir e-posta gönderdik").isVisible().catch(() => false));

await browser.close();

console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Başarısız testler:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
