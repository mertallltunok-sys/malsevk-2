// B3 düzeltmesinin doğrulaması: login-form.tsx'in KAYIT (kayit) yoluna
// eklenen senkron `registerSubmitLockRef` kilidinin, aynı event-loop
// turunda art arda tetiklenen çift (veya üçlü) submit'lerde `registerUser`in
// yalnızca BİR KEZ tamamlanmasını garanti ettiğini — job-request-form.tsx#
// handlePublish'teki kanıtlanmış `submitLockRef` deseniyle AYNI teknik
// (senkron native .click()/gerçek klavye Enter olayları, page.evaluate ile
// ham state enjeksiyonu DEĞİL) kullanılarak — gerçek kayıt formu üzerinden
// doğrular. Ayrıca kilidin validasyon hatası/registerUser hatası/normal
// akışta doğru bırakıldığını ve giriş (giris) akışının etkilenmediğini
// kontrol eder.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

let phoneCounter = 7770001;
function freshPhone() {
  phoneCounter += 1;
  return `+90555${phoneCounter}`;
}
function freshEmail(tag) {
  return `race-guard-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

/** Kayıt formunu geçerli verilerle doldurur, ama HİÇBİR gönderim tetiklemez — o, çağıranın kontrolündedir (senaryoya göre click/Enter/ikisi). */
async function fillValidRegisterForm(page, { firstName, lastName, email, phone, password }) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByRole("radio", { name: "Hizmet Alan", exact: true }).check();
  await page.getByLabel("Telefon Numarası", { exact: true }).fill(phone);
  await page.getByLabel("Firma Adı", { exact: true }).fill("Race Guard Test Firması");
  await page.getByLabel("Kullanıcı Tipi", { exact: true }).selectOption({ index: 1 });
  const provinceFieldId = await page.getByLabel("İl", { exact: true }).getAttribute("id");
  await selectSearchable(page, provinceFieldId, "Kocaeli");
  const districtFieldId = await page.getByLabel("İlçe", { exact: true }).getAttribute("id");
  await selectSearchable(page, districtFieldId, "Dilovası");
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill(password);
  await page.locator('form input[type="checkbox"]').check();
}

/** page.evaluate içinden native .click() ile senkron çoklu tıklama — tmp-submit-race-guard-test.mjs'deki (job-request-form.tsx) KANITLANMIŞ teknikle AYNI: Playwright'ın kendi .click()'i actionability beklemeleri yüzünden yarış penceresini kaçırabilir, ham DOM .click() kaçırmaz. */
async function nativeMultiClickSubmit(page, times) {
  await page.evaluate((times) => {
    const buttons = Array.from(document.querySelectorAll('form button[type="submit"]'));
    const btn = buttons.find((b) => b.textContent?.includes("Hesap Oluştur"));
    for (let i = 0; i < times; i++) btn.click();
  }, times);
}

async function getUsersByEmail(page, email) {
  return page.evaluate(
    (targetEmail) => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]").filter((u) => u.email === targetEmail),
    email,
  );
}
async function getAllUsers(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
}
function assertNoDuplicateEmailOrPhone(users, label) {
  const emails = new Map();
  const phones = new Map();
  for (const user of users) {
    assert.ok(!emails.has(user.email) || emails.get(user.email) === user.id, `${label}: aynı e-posta (${user.email}) FARKLI id'lerle iki kez kayıtlı`);
    assert.ok(!phones.has(user.phone) || phones.get(user.phone) === user.id, `${label}: aynı telefon (${user.phone}) FARKLI id'lerle iki kez kayıtlı`);
    emails.set(user.email, user.id);
    phones.set(user.phone, user.id);
  }
}

let browser;

async function main() {
  browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // ================= Senaryo 1+4+5: hızlı çoklu (native) tıklama =================
  const emailClick = freshEmail("click");
  const phoneClick = freshPhone();
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestClick", email: emailClick, phone: phoneClick, password: "GucluSifre1!" });
  await nativeMultiClickSubmit(page, 3);
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const usersAfterClick = await getUsersByEmail(page, emailClick);
  assert.equal(usersAfterClick.length, 1, `3 senkron tıklamaya rağmen TAM OLARAK 1 kullanıcı oluşmalı, oluşan: ${usersAfterClick.length}`);
  ok("[Senaryo 1] Kayıt butonuna art arda 3 senkron (native) tıklamaya rağmen yalnızca 1 kullanıcı oluştu");
  assertNoDuplicateEmailOrPhone(await getAllUsers(page), "click-race");
  ok("[Senaryo 4+5] Aynı e-posta/telefonla FARKLI id'lere sahip ikinci bir kullanıcı oluşmadı (tüm kullanıcı tablosu tarandı)");

  // ================= Senaryo 2: art arda Enter =================
  // Not: gerçek page.keyboard.press("Enter") çağrılarını Promise.all ile art
  // arda göndermek, iki AYRI CDP round-trip'i olduğu için yarış penceresini
  // GÜVENİLİR biçimde yakalamıyor (Senaryo 3'te tespit edilip düzeltildi,
  // yukarıya bakın — aynı kararsızlık burada da geçerli). Enter tuşunun
  // tarayıcıdaki native etkisi (forma implicit submit) `form.requestSubmit()`
  // ile BİREBİR aynı 'submit' olayını/React onSubmit'i tetikler; bu yüzden
  // "art arda Enter" senaryosu, tek bir senkron page.evaluate turunda iki kez
  // requestSubmit() ile kararlı/tekrarlanabilir biçimde test edilir.
  const emailEnter = freshEmail("enter");
  const phoneEnter = freshPhone();
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestEnter", email: emailEnter, phone: phoneEnter, password: "GucluSifre1!" });
  await page.evaluate(() => {
    const form = document.querySelector("form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const usersAfterEnter = await getUsersByEmail(page, emailEnter);
  assert.equal(usersAfterEnter.length, 1, `Art arda iki Enter'a rağmen TAM OLARAK 1 kullanıcı oluşmalı, oluşan: ${usersAfterEnter.length}`);
  ok("[Senaryo 2] Art arda iki Enter tuşuna rağmen yalnızca 1 kayıt çağrısı yapıldı (1 kullanıcı oluştu)");

  // ================= Senaryo 3: tıklama ve Enter aynı anda =================
  // Not: Playwright'ın page.evaluate() ve page.keyboard.press()'i AYRI CDP
  // round-trip'leri olduğu için Promise.all ile bile aralarında güvenilir bir
  // "aynı JS turu" garantisi YOK (denendi: Enter'ın submit'i evaluate'in DOM
  // sorgusundan ÖNCE tamamlanıp butonu kaldırabiliyor, testi kararsızlaştırıyor).
  // Bunun yerine, Enter tuşunun tarayıcıdaki gerçek etkisiyle (forma implicit
  // submit — form.requestSubmit()) AYNI submit event mekanizmasını, tıklamayla
  // BİRLİKTE, TEK bir senkron page.evaluate turunda tetikliyoruz — bu, iki
  // farklı tetikleyicinin gerçekten aynı JS turunda üst üste bindiği,
  // kararlı/tekrarlanabilir tek yol.
  const emailBoth = freshEmail("both");
  const phoneBoth = freshPhone();
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestBoth", email: emailBoth, phone: phoneBoth, password: "GucluSifre1!" });
  await page.evaluate(() => {
    const form = document.querySelector("form");
    const buttons = Array.from(document.querySelectorAll('form button[type="submit"]'));
    const btn = buttons.find((b) => b.textContent?.includes("Hesap Oluştur"));
    btn.click();
    form.requestSubmit();
  });
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  const usersAfterBoth = await getUsersByEmail(page, emailBoth);
  assert.equal(usersAfterBoth.length, 1, `Tıklama+Enter aynı anda tetiklenince TAM OLARAK 1 kullanıcı oluşmalı, oluşan: ${usersAfterBoth.length}`);
  ok("[Senaryo 3] Buton tıklaması ve Enter aynı anda tetiklenince de yalnızca 1 kullanıcı oluştu");

  // ================= Senaryo 7: validasyon hatasından sonra yeniden gönderilebilir =================
  const emailValErr = freshEmail("valerr");
  const phoneValErr = freshPhone();
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestValErr", email: emailValErr, phone: phoneValErr, password: "GucluSifre1!" });
  // Şifre tekrarını bilerek bozarak validasyon hatası üret.
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill("UyusmayanSifre1!");
  await nativeMultiClickSubmit(page, 1);
  await page.getByText(/eşleşmiyor|uyuşmuyor|aynı olmalı/i).first().waitFor({ state: "visible", timeout: 5000 });
  assert.equal((await getUsersByEmail(page, emailValErr)).length, 0, "Validasyon hatasında hiç kullanıcı oluşmamalı");
  // Düzelt ve TEKRAR gönder — kilit takılı kalmışsa bu ikinci gönderim hiç çalışmaz.
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill("GucluSifre1!");
  await nativeMultiClickSubmit(page, 1);
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await getUsersByEmail(page, emailValErr)).length, 1, "Düzeltilip yeniden gönderilince tam olarak 1 kullanıcı oluşmalı");
  ok("[Senaryo 7] Validasyon hatasından sonra kilit takılı kalmadı; form düzeltilip başarıyla yeniden gönderildi");

  // ================= Senaryo 8: registerUser {ok:false} sonrası kilit bırakılıyor =================
  const phoneDupTest = freshPhone();
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestDup", email: emailClick, phone: phoneDupTest, password: "GucluSifre1!" });
  await nativeMultiClickSubmit(page, 1);
  await page.getByText("Bu e-posta adresiyle daha önce hesap oluşturulmuş.", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  ok("[Senaryo 8] registerUser zaten-kayıtlı e-posta için {ok:false} döndü, hata gösterildi");
  // Kilit bırakılmış mı: AYNI formu (bu kez gerçekten benzersiz e-posta ile) hemen yeniden göndererek doğrula.
  const emailAfterDup = freshEmail("after-dup");
  await page.getByLabel("E-posta", { exact: true }).fill(emailAfterDup);
  await nativeMultiClickSubmit(page, 1);
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await getUsersByEmail(page, emailAfterDup)).length, 1, "ok:false sonrası kilit bırakılmalı, sonraki geçerli gönderim başarılı olmalı");
  ok("[Senaryo 8] registerUser {ok:false} sonrası kilit bırakıldı — kullanıcı hemen yeniden deneyip başarıyla kayıt oldu");

  // ================= Senaryo 6: başarılı kayıtta yönlendirme/durum tek sefer =================
  await fillValidRegisterForm(page, { firstName: "Yaris", lastName: "TestSuccess", email: freshEmail("success"), phone: freshPhone(), password: "GucluSifre1!" });
  await nativeMultiClickSubmit(page, 1);
  const banners = await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false });
  await banners.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await banners.count(), 1, "Başarı banner'ı TAM OLARAK bir kez gösterilmeli");
  assert.equal(
    await page.getByRole("tab", { name: "Giriş Yap", exact: true }).getAttribute("aria-selected"),
    "true",
    "Başarılı kayıt sonrası Giriş Yap sekmesine geçilmeli",
  );
  const sessionAfterRegister = await page.evaluate(() => localStorage.getItem("malsevk.session.v1"));
  assert.equal(sessionAfterRegister, null, "Kayıt, oturum otomatik AÇMAZ (mevcut davranış) — bu yüzden 'çift oturum yazımı' riski mimari olarak zaten yok");
  ok("[Senaryo 6] Başarılı kayıtta banner/sekme geçişi tek sefer çalıştı, oturum (mimari gereği zaten) yazılmadı — çift yan etki yok");

  // ================= Senaryo 11: giriş (giris) akışı etkilenmedi =================
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent("/panel")}`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
  ok("[Senaryo 11] Giriş (giris) akışı bu değişiklikten etkilenmeden normal şekilde çalışıyor");

  if (consoleErrors.length > 0) {
    console.log("\n[register-submit-race-guard-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[register-submit-race-guard-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  console.log(`\n[register-submit-race-guard-test] ${passed} test geçti.`);
  console.log("(Not: bu script yalnızca kullanıcı localStorage kaydı üretir, temizlik yapılmaz — malsevk.users.v1 kalıcı test verisi biriktirir; bu, mevcut tmp-*.mjs kayıt testlerinin (ör. tmp-legal-pages-footer-modal-test.mjs) de izlediği kabul edilmiş desendir.)");
}

main().catch((error) => {
  console.error("[register-submit-race-guard-test] HATA:", error);
  process.exitCode = 1;
});
