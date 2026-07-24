// Tanı: mobilde bildirimlerin "bazen okunmuş sayılmaması" sorununu 6
// kontrollü senaryoda test eder. Gerçek WebKit motoru (iOS Safari ile aynı
// engine) + gerçek dokunma (touch) emülasyonu kullanılır — Chromium +
// page.click() sentetik fare olayı gönderir ve bu tür bug'ları YENİDEN
// ÜRETEMEZ (önceki oturumda ayrı bir denemede doğrulandı).
//
// Her senaryo TAZE bir browser context'inde (izole localStorage) çalışır,
// böylece senaryolar birbirini kirletmez.
//
// BİLİNEN ARAÇ SINIRLAMASI (senaryo 2 ve 6'yı okurken göz önünde bulundurun):
// - Playwright 1.61.1'in `touchscreen` API'si yalnızca tek noktalı,
//   hareketsiz `tap(x, y)` sunar; touchmove/swipe yok. Bu yüzden gerçek
//   "parmak hafifçe kaydı -> tarayıcı native pipeline'ı click'i iptal etti"
//   davranışı JS'ten TETİKLENEMEZ (ne Chromium ne WebKit'in automation
//   API'si bunu açığa çıkarır). Senaryo 2, bunun yerine daha gerçekçi ve
//   test edilebilir bir riski hedefler: dokunuşun bildirim linki ile silme
//   butonu arasındaki sınıra yakın düşmesi (gerçek parmakla çok olası bir
//   isabet hatası).
// - Playwright'in CDP tabanlı ağ kısıtlama API'si (gerçek bant genişliği
//   simülasyonu) yalnızca Chromium'da var. Senaryo 6, bunun yerine
//   document/fetch/xhr isteklerine yapay gecikme ekleyerek bir YAKLAŞIKLAMA
//   uygular — gerçek bant genişliği kısıtlaması değildir.
import { webkit, devices } from "playwright";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };

let browser;
const results = [];

async function typeInto(page, locator, text) {
  await locator.tap();
  await page.keyboard.type(text);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await typeInto(page, page.locator('input[type="email"]'), email);
  await typeInto(page, page.locator('input[type="password"]'), password);
  await page.getByRole("button", { name: "Giriş Yap" }).tap();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

function clearSession(page) {
  return page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
}

function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

function readIds(page, userId) {
  return page.evaluate(
    (uid) => JSON.parse(localStorage.getItem(`malsevk_read_notifications_${uid}`) || "[]"),
    userId,
  );
}

async function injectJob(page, { jobId, title, requesterId }) {
  await page.evaluate(
    ({ jobId, title, requesterId }) => {
      const job = {
        id: jobId, title, category: "Depolama", province: "Kocaeli",
        district: "Gebze", workLocationType: "Test Tesis", workDate: "2026-12-01",
        description: `${title} - tanı senaryosu için oluşturulan test ilanı.`,
        operationDetails: "Test.", status: "yayinda", requesterId, photos: [],
      };
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push(job);
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { jobId, title, requesterId },
  );
}

async function submitOffer(page, jobId, note) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await typeInto(page, page.getByLabel("Teklif Fiyatı"), "4000");
  await typeInto(page, page.getByLabel("Tahmini Hizmet Süresi"), "1 gün");
  await typeInto(
    page,
    page.getByLabel("Teklif Açıklaması"),
    `${note}, yirmi karakterden uzun açıklama metni.`,
  );
  await page.getByRole("button", { name: "Teklif Gönder" }).tap();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

/**
 * Bir context içinde N farklı iş (job) + teklif (offer) oluşturarak Zeynep
 * için N farklı "yeni_teklif" bildirimi üretir. Job doğrudan localStorage'a
 * yazılır (hızlı, önceki oturumda doğrulanmış yöntem); teklif ise GERÇEK UI
 * akışıyla (form doldur + gönder) oluşturulur ki Offer şeması/iş kuralları
 * gerçek koddan geçsin. Dönen değer: zeynepId.
 */
async function seedNotifications(context, jobSpecs) {
  const page = await context.newPage();
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  const zeynepId = await getUserId(page, ZEYNEP.email);
  for (const spec of jobSpecs) {
    await injectJob(page, { ...spec, requesterId: zeynepId });
  }
  await clearSession(page);

  await loginAs(page, MERT.email, MERT.password);
  for (const spec of jobSpecs) {
    await submitOffer(page, spec.jobId, spec.title);
  }
  await clearSession(page);
  await page.close();
  return zeynepId;
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.dialogEvents = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      page.jsProblems.push(`[console:${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    page.jsProblems.push(`[pageerror] ${String(err)}`);
  });
  page.on("dialog", async (dialog) => {
    page.dialogEvents.push({ type: dialog.type(), message: dialog.message() });
    console.log(`    [dialog] type=${dialog.type()} message="${dialog.message()}"`);
    await dialog.dismiss();
  });
}

function countBellButtons(page) {
  return page.getByRole("button", { name: /Bildirimler/ }).count();
}

function bellButton(page) {
  return page.getByRole("button", { name: /Bildirimler/ }).first();
}

async function openBell(page) {
  await bellButton(page).tap();
  const menu = page.getByRole("menu", { name: "Bildirimler" });
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}

function menuRow(menu, index) {
  return menu.locator("li").nth(index);
}

async function readMenuItem(row) {
  const link = row.getByRole("menuitem");
  const href = await link.getAttribute("href");
  const cls = await link.getAttribute("class");
  return { link, href, isUnread: cls?.includes("font-semibold") ?? false };
}

async function checkDualInstance(page, record) {
  const count = await countBellButtons(page);
  check(
    record,
    "Mobil viewport'ta a11y ağacında erişilebilir tam olarak 1 bell butonu var",
    count === 1,
    `bulunan: ${count} (masaüstü instance'ı display:none ise a11y ağacından düşer, beklenen budur)`,
  );
}

function check(record, label, passed, detail) {
  record.checks.push({ label, passed, detail });
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function runScenario(name, fn) {
  console.log(`\n########## SENARYO: ${name} ##########`);
  const record = { name, checks: [], problems: [] };
  const context = await browser.newContext({ ...devices["iPhone 12"], hasTouch: true });
  try {
    await fn(context, record);
  } catch (error) {
    record.problems.push(`HATA (senaryo tamamlanamadı): ${error.stack || error}`);
    console.error("    [HATA]", error);
  } finally {
    await context.close();
  }
  results.push(record);
}

function printSummary() {
  console.log("\n\n================= ÖZET =================");
  let anyIssue = false;
  for (const r of results) {
    const failedChecks = r.checks.filter((c) => !c.passed);
    const clean = failedChecks.length === 0 && r.problems.length === 0;
    if (!clean) anyIssue = true;
    console.log(`\n[${clean ? "TEMİZ" : "İNCELE"}] ${r.name}`);
    for (const c of r.checks) {
      console.log(`   ${c.passed ? "OK  " : "FAIL"} ${c.label}${c.detail ? " (" + c.detail + ")" : ""}`);
    }
    for (const p of r.problems) {
      console.log(`   !!  ${p}`);
    }
  }
  console.log("\n==========================================");
  console.log(
    anyIssue
      ? "SONUÇ: En az bir senaryoda beklenmeyen durum tespit edildi — yukarıdaki FAIL/!! satırlarına bakın."
      : "SONUÇ: Tüm senaryolar beklendiği gibi geçti — bu script'in kapsadığı senaryolarda mobil-okundu sorunu tekrar üretilemedi.",
  );
}

async function scenario1(context, record) {
  const zeynepId = await seedNotifications(context, [{ jobId: "diag-s1-job", title: "Senaryo1 Is" }]);
  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);

  await checkDualInstance(page, record);

  const before = await readIds(page, zeynepId);
  let menu = await openBell(page);
  const row0 = menuRow(menu, 0);
  const item0Before = await readMenuItem(row0);
  check(record, "Dokunmadan önce bildirim 'okunmamış' stilinde", item0Before.isUnread, "");

  await item0Before.link.tap();
  await page.waitForTimeout(300);

  const afterIds = await readIds(page, zeynepId);
  check(
    record,
    "localStorage okundu anahtarı doğru güncellendi",
    afterIds.length === before.length + 1,
    `önce: ${JSON.stringify(before)}, sonra: ${JSON.stringify(afterIds)}`,
  );

  const navigated = page.url().includes("gelen-teklifler");
  check(record, "Yönlendirme doğru gerçekleşti", navigated, page.url());

  await page.goto(`${BASE_URL}/panel`);
  menu = await openBell(page);
  const item0After = await readMenuItem(menuRow(menu, 0));
  check(record, "Bildirim görsel olarak sönüyor (okundu stiline geçti)", !item0After.isUnread, "");

  const ariaLabel = await bellButton(page).getAttribute("aria-label");
  const hasUnreadBadge = /\d+ okunmamış/.test(ariaLabel ?? "");
  check(record, "Unread rozeti/aria-label anında düştü (0 okunmamış kaldı)", !hasUnreadBadge, `aria-label: "${ariaLabel}"`);

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function scenario2(context, record) {
  const zeynepId = await seedNotifications(context, [{ jobId: "diag-s2-job", title: "Senaryo2 Is" }]);
  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  await checkDualInstance(page, record);

  const before = await readIds(page, zeynepId);
  const menu = await openBell(page);
  const row = menuRow(menu, 0);
  const link = row.getByRole("menuitem");
  const deleteBtn = row.getByRole("button", { name: "Bildirimi sil" });

  const linkBox = await link.boundingBox();
  const delBox = await deleteBtn.boundingBox();

  // "Güvenli" nokta: silme butonunun sol kenarından belirgin şekilde
  // içeride (linkin metin alanı) — normal, isabetli bir dokunuşu temsil eder.
  const safeX = delBox.x - 12;
  const safeY = linkBox.y + linkBox.height / 2;

  // "Sınır" nokta: silme butonunun sol kenarına göre birkaç piksel — gerçek
  // parmakla çok olası bir isabet hatasını (link yerine silme butonuna
  // denk gelme) temsil eder.
  const boundaryX = delBox.x + 4;
  const boundaryY = delBox.y + delBox.height / 2;

  console.log(
    `    [bilgi] link kutusu: x=${linkBox.x.toFixed(1)}-${(linkBox.x + linkBox.width).toFixed(1)}, silme butonu kutusu: x=${delBox.x.toFixed(1)}-${(delBox.x + delBox.width).toFixed(1)} (boşluk: ${(delBox.x - (linkBox.x + linkBox.width)).toFixed(1)}px örtüşme/boşluk)`,
  );

  await page.touchscreen.tap(safeX, safeY);
  await page.waitForTimeout(300);

  const afterSafeTap = await readIds(page, zeynepId);
  const navigatedAfterSafe = page.url().includes("gelen-teklifler");
  check(
    record,
    "Linkin metin alanına yapılan normal dokunuş doğru şekilde okundu-işaretledi + yönlendirdi",
    afterSafeTap.length === before.length + 1 && navigatedAfterSafe,
    `readIds: ${JSON.stringify(afterSafeTap)}, url: ${page.url()}`,
  );
  check(
    record,
    "Güvenli nokta dokunuşu yanlışlıkla silme onayını TETİKLEMEDİ",
    page.dialogEvents.length === 0,
    page.dialogEvents.length ? JSON.stringify(page.dialogEvents) : "dialog yok",
  );

  // İkinci bildirim yok; sınır-noktası riskini AYNI satırda, taze bir
  // context ile tekrar test etmek için ikinci bir iş/bildirim seed edip
  // sınır noktasına dokunuyoruz (silme onayı tetiklenirse dismiss edilir,
  // gerçek bir silme gerçekleşmez — bkz. attachDiagnostics).
  await page.goto(`${BASE_URL}/panel`);
  const zeynepId2 = await getUserId(page, ZEYNEP.email);
  await injectJob(page, { jobId: "diag-s2-job-b", title: "Senaryo2 Is B", requesterId: zeynepId2 });
  await clearSession(page);
  await loginAs(page, MERT.email, MERT.password);
  await submitOffer(page, "diag-s2-job-b", "Senaryo2 Is B");
  await clearSession(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);

  const beforeBoundary = await readIds(page, zeynepId2);
  await openBell(page);

  await page.touchscreen.tap(boundaryX, boundaryY);
  await page.waitForTimeout(300);

  const afterBoundaryTap = await readIds(page, zeynepId2);
  const dialogAfterBoundary = page.dialogEvents.length > 0;
  const readMarkedByBoundaryTap = afterBoundaryTap.length === beforeBoundary.length + 1;
  console.log(
    `    [bilgi] sınır-noktası dokunuşu sonucu: silme-onayı-tetiklendi=${dialogAfterBoundary}, okundu-işaretlendi=${readMarkedByBoundaryTap}`,
  );
  check(
    record,
    "Sınır noktası dokunuşunun sonucu NET (ya link ya silme butonu tetiklendi, ikisi birden değil, sessiz kayıp yok)",
    dialogAfterBoundary !== readMarkedByBoundaryTap,
    `silme-onayı=${dialogAfterBoundary}, okundu=${readMarkedByBoundaryTap}`,
  );

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function scenario3(context, record) {
  const zeynepId = await seedNotifications(context, [{ jobId: "diag-s3-job", title: "Senaryo3 Is" }]);
  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password, "/panel/bildirimler");
  await checkDualInstance(page, record);

  const before = await readIds(page, zeynepId);
  const firstLink = page.locator("main").getByRole("link").first();
  await firstLink.waitFor({ state: "visible", timeout: 5000 });

  await firstLink.tap();
  await page.waitForTimeout(300);

  const afterIds = await readIds(page, zeynepId);
  check(
    record,
    "localStorage okundu anahtarı /panel/bildirimler sayfasından da doğru güncellendi",
    afterIds.length === before.length + 1,
    `önce: ${JSON.stringify(before)}, sonra: ${JSON.stringify(afterIds)}`,
  );

  const navigated = page.url().includes("gelen-teklifler");
  check(record, "Yönlendirme doğru gerçekleşti", navigated, page.url());

  // Çapraz sayfa yayılımı: tam liste sayfasında okunan bildirim, header
  // bell'inin unread rozetine de yansımalı (aynı paylaşılan store).
  await page.goto(`${BASE_URL}/panel`);
  const ariaLabel = await bellButton(page).getAttribute("aria-label");
  const hasUnreadBadge = /\d+ okunmamış/.test(ariaLabel ?? "");
  check(
    record,
    "/panel/bildirimler'de okunan bildirim, header bell rozetine de (çapraz sayfa) yansıdı",
    !hasUnreadBadge,
    `aria-label: "${ariaLabel}"`,
  );

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function scenario4(context, record) {
  const zeynepId = await seedNotifications(context, [{ jobId: "diag-s4-job", title: "Senaryo4 Is" }]);
  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  await checkDualInstance(page, record);

  const bell = bellButton(page);
  await bell.tap();
  await page.waitForTimeout(30);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(30);
  await bell.tap();
  await page.waitForTimeout(30);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(30);

  const before = await readIds(page, zeynepId);
  const menu = await openBell(page);
  check(record, "Hızlı aç/kapa döngüsünden sonra menü son açılışta düzgün göründü", await menu.isVisible(), "");

  const row0 = menuRow(menu, 0);
  const item0 = await readMenuItem(row0);
  await item0.link.tap();
  await page.waitForTimeout(300);

  const afterIds = await readIds(page, zeynepId);
  check(
    record,
    "Hızlı aç/kapa sonrası gerçek dokunuş yine de doğru okundu-işaretledi",
    afterIds.length === before.length + 1,
    `önce: ${JSON.stringify(before)}, sonra: ${JSON.stringify(afterIds)}`,
  );
  const navigated = page.url().includes("gelen-teklifler");
  check(record, "Yönlendirme doğru gerçekleşti", navigated, page.url());

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function scenario5(context, record) {
  const zeynepId = await seedNotifications(context, [
    { jobId: "diag-s5-job-a", title: "Senaryo5 Is A" },
    { jobId: "diag-s5-job-b", title: "Senaryo5 Is B" },
  ]);
  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  await checkDualInstance(page, record);

  const before = await readIds(page, zeynepId);
  check(record, "Başlangıçta 2 bildirim de okunmamış", before.length === 0, `önce: ${JSON.stringify(before)}`);

  let menu = await openBell(page);
  const rowCount = await menu.locator("li").count();
  check(record, "Dropdown'da 2 farklı bildirim listeleniyor", rowCount === 2, `bulunan: ${rowCount}`);

  const firstItem = await readMenuItem(menuRow(menu, 0));
  const firstHref = firstItem.href;
  await firstItem.link.tap();
  await page.waitForTimeout(300);

  const afterFirst = await readIds(page, zeynepId);
  check(record, "İlk bildirim okunmuş olarak işaretlendi", afterFirst.length === 1, JSON.stringify(afterFirst));
  const navigatedFirst = page.url().includes("gelen-teklifler");
  check(record, "İlk bildirimin yönlendirmesi doğru gerçekleşti", navigatedFirst, page.url());

  await page.goto(`${BASE_URL}/panel`);
  menu = await openBell(page);
  const item0 = await readMenuItem(menuRow(menu, 0));
  const item1 = await readMenuItem(menuRow(menu, 1));
  const readOne = [item0, item1].find((it) => it.href === firstHref);
  const stillUnread = [item0, item1].find((it) => it.href !== firstHref);
  check(
    record,
    "Önce okunan bildirim görsel olarak sönmüş, diğeri hâlâ 'okunmamış' stilinde (birbirini etkilemiyor)",
    Boolean(readOne && !readOne.isUnread && stillUnread && stillUnread.isUnread),
    `okunan.bold=${readOne?.isUnread}, diğeri.bold=${stillUnread?.isUnread}`,
  );

  await stillUnread.link.tap();
  await page.waitForTimeout(300);

  const afterSecond = await readIds(page, zeynepId);
  check(
    record,
    "İkinci bildirim de doğru işaretlendi (ilkinin üzerine yazılmadan, ikisi birden localStorage'da)",
    afterSecond.length === 2,
    JSON.stringify(afterSecond),
  );
  const navigatedSecond = page.url().includes("gelen-teklifler");
  check(record, "İkinci bildirimin yönlendirmesi doğru gerçekleşti", navigatedSecond, page.url());

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function scenario6(context, record) {
  const zeynepId = await seedNotifications(context, [{ jobId: "diag-s6-job", title: "Senaryo6 Is" }]);

  const DELAY_MS = 400;
  await context.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (type === "document" || type === "fetch" || type === "xhr") {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await route.continue();
  });

  const page = await context.newPage();
  attachDiagnostics(page);
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  await checkDualInstance(page, record);

  const before = await readIds(page, zeynepId);
  const menu = await openBell(page);
  const item0 = await readMenuItem(menuRow(menu, 0));

  await item0.link.tap();
  // Ağ gecikmesi aktifken, okundu yazısının yönlendirme/ağ isteği
  // TAMAMLANMADAN, anında gerçekleştiğini doğrula.
  await page.waitForTimeout(60);
  const immediatelyAfter = await readIds(page, zeynepId);
  check(
    record,
    "Okundu yazısı ağ gecikmesini beklemeden anında gerçekleşiyor (senkron localStorage yazımı)",
    immediatelyAfter.length === before.length + 1,
    `60ms sonra: ${JSON.stringify(immediatelyAfter)}`,
  );

  await page.waitForURL(/gelen-teklifler/, { timeout: 15000 });
  check(record, "Gecikmeli yönlendirme sonunda doğru sayfaya ulaşıldı", page.url().includes("gelen-teklifler"), page.url());

  record.problems.push(...page.jsProblems);
  await page.close();
}

async function main() {
  browser = await webkit.launch();
  await runScenario("1) Header zili — normal tek dokunuş", scenario1);
  await runScenario("2) Header zili — link/silme-butonu sınırına yakın dokunuş", scenario2);
  await runScenario("3) /panel/bildirimler sayfası — tek dokunuş", scenario3);
  await runScenario("4) Hızlı aç/kapa sonrası dokunuş", scenario4);
  await runScenario("5) Art arda iki farklı bildirime dokunma", scenario5);
  await runScenario("6) Yavaş ağ / gecikme simülasyonu altında dokunuş", scenario6);
  printSummary();
}

main()
  .catch((error) => {
    console.error("[diag] GENEL HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
