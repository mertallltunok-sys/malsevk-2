import { chromium } from "playwright";

const APP_ORIGIN = "http://localhost:3000";
const EMAIL = "ctnrtest-prov-1787122609572@example.com";
const PASSWORD = "TestSifre2026!";
const JOB_ID = "32821d47-a04d-43f0-a457-082cccfaf610";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("CONSOLE ERROR:", msg.text());
});

await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Giriş Yap" }).click();
await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1000);
console.log("Login URL:", page.url());

await page.goto(`${APP_ORIGIN}/ilanlar/${JOB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
const text = await page.locator("body").innerText().catch(() => "");
console.log("=== FULL BODY TEXT ===");
console.log(text);
console.log("=== KONTEYNER SECTION ===");
console.log(text.match(/Konteyner Bilgileri[\s\S]{0,200}/)?.[0] ?? "(bulunamadı)");

await browser.close();
