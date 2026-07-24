// job-request-form.tsx'e eklenen senkron submitLockRef kilidinin, aynı
// event-loop turunda art arda iki tıklamayla tetiklenen çift ilan
// oluşturma yarış durumunu gerçekten kapattığını doğrular. Ayrıca normal
// tek-tıklamalı akışın (oluşturma + doğru yönlendirme) bozulmadığını
// kontrol eder. Ön koşul: `npm run dev`.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const FIX = (name) => path.join(os.tmpdir(), name);
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

async function selectSearchable(page, labelText, optionText) {
  await page.locator(`label:text-is("${labelText}") + button`).click();
  await page.getByRole("textbox", { name: `${labelText} içinde ara` }).fill(optionText);
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

async function fillTesis(page, value) {
  const freeTextInput = page.locator('label:text-is("Tesis") + input');
  if ((await freeTextInput.count()) > 0) {
    await freeTextInput.fill(value);
    return;
  }
  await page.locator('label:text-is("Tesis") + button').click();
  await page.getByRole("listbox", { name: "Tesis" }).getByRole("option").first().click();
}

async function fillValidForm(page, { title }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByRole("button", { name: "İlanı Yayınla" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Lashing" });
  await page.locator('input[type="date"]').fill("2026-09-15");
  await page.locator('input[type="text"]').first().fill(title);
  await page
    .locator("textarea")
    .first()
    .fill("Bu ilan submit-race-guard testi icin olusturulmustur, en az yirmi karakter.");
  await selectSearchable(page, "İl", "Kocaeli");
  await selectSearchable(page, "İlçe", "Gebze");
  await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Diğer" });
  await fillTesis(page, "Test Tesisi Race Guard");
  await page.locator("textarea").nth(1).fill("Operasyon detaylari test amaclidir, en az on karakter.");
  await page.setInputFiles('input[type="file"]', [FIX("fixture-valid-1.jpg")]);
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return Boolean(btn) && !btn.disabled && Boolean(btn.textContent?.includes("İlanı Yayınla"));
    },
    undefined,
    { timeout: 20000, polling: 100 },
  );
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await loginAs(page, "zeynep@test.com", "Zeynep1!");

  // ---- [1] Aynı yarış senaryosu (iki senkron .click()) artık tek ilan mı oluşturuyor? ----
  const raceTitle = `Race Guard Testi ${Date.now()}`;
  await fillValidForm(page, { title: raceTitle });

  const beforeCount = await page.evaluate(
    () => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").length,
  );

  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    btn.click();
    btn.click();
    btn.click(); // önceki bulguda 2 tekrar oluşturuyordu -- daha da agresif, 3 tıklama ile test ediliyor
  });

  await page.waitForURL(/\/ilanlar\//, { timeout: 10000 });
  await page.waitForTimeout(1000);

  const afterState = await page.evaluate((title) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return {
      total: jobs.length,
      matching: jobs.filter((j) => j.title === title).length,
    };
  }, raceTitle);

  console.log(
    `  info Gönderim öncesi ilan sayısı: ${beforeCount}, sonrası: ${afterState.total}, aynı başlıkla eşleşen: ${afterState.matching}`,
  );
  assert.equal(
    afterState.matching,
    1,
    `Üç senkron tıklamaya rağmen TAM OLARAK 1 ilan oluşmalı, oluşan: ${afterState.matching}`,
  );
  ok("[1] Art arda üç senkron tıklamaya rağmen yalnızca 1 ilan oluştu -- yarış durumu kapatıldı");

  // ---- [2] Normal tek tıklamalı akış hâlâ çalışıyor mu (regresyon) ----
  const normalTitle = `Normal Akış Testi ${Date.now()}`;
  await fillValidForm(page, { title: normalTitle });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 10000 });
  await page.getByText(normalTitle).waitFor({ state: "visible", timeout: 5000 });
  ok("[2] Normal tek-tıklamalı gönderim hâlâ çalışıyor, oluşturulan ilanın detay sayfasına yönlendiriyor");

  const normalJob = await page.evaluate(
    (title) => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => j.title === title).length,
    normalTitle,
  );
  assert.equal(normalJob, 1, "Normal akışta da tam olarak 1 ilan oluşmalı");
  ok("[2] Normal akışta da tam olarak 1 ilan kalıcı oldu (fazladan çoğalma yok)");

  // ---- [3] Hizmet Taleplerim'de her iki ilan da görünüyor mu (regresyon) ----
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await page.getByText(raceTitle).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText(normalTitle).waitFor({ state: "visible", timeout: 10000 });
  ok("[3] Her iki ilan da Hizmet Taleplerim ekranında doğru şekilde görünüyor");

  // Temizlik
  await page.evaluate(
    ({ t1, t2 }) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter(
        (j) => j.title !== t1 && j.title !== t2,
      );
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { t1: raceTitle, t2: normalTitle },
  );

  if (consoleErrors.length > 0) {
    console.log("\n[submit-race-guard-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    throw new Error("Konsolda beklenmeyen hata bulundu");
  }
  ok("Konsolda hiç JS hatası yakalanmadı");

  console.log(`\n[submit-race-guard-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[submit-race-guard-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
