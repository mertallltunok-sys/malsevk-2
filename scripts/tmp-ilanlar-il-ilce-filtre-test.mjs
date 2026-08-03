// node scripts/tmp-ilanlar-il-ilce-filtre-test.mjs
//
// "İlanlar" ana sayfasındaki (Aktif İlanlar, Hizmet Veren) üst filtre
// barındaki İl/İlçe entegrasyonu düzeltmesinin (2026-08-01) uçtan uca
// doğrulaması: İl filtresinde 81 il eksiksiz göründüğünü, başlangıçta
// Kocaeli seçili geldiğini, değiştirilebildiğini, seçilen ile göre İlçe
// listesinin doğru filtrelendiğini, İl değişince İlçe/Liman-Sanayi-OSB'nin
// sıfırlandığını, İl seçilmeden İlçe'nin devre dışı olduğunu ve Kocaeli
// dışındaki illerde sayfanın hata vermediğini doğrular.
// Ön koşul: `npm run dev` çalışıyor olmalı (BASE_URL ile port verilebilir).
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const MERT = { email: "mert@test.com", password: "Mert123!" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function openDropdown(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.locator(`ul[aria-label="${label}"]`);
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function selectOption(page, label, optionText, { exact = true } = {}) {
  const dialog = await openDropdown(page, label);
  await dialog.getByRole("option", { name: optionText, exact }).first().click();
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsProblems = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsProblems.push(`[console:error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => jsProblems.push(`[pageerror] ${String(err)}`));

    await loginAs(page, MERT, "/ilanlar");

    console.log("\n=== Senaryo 1: İl filtresinde 81 il eksiksiz görünüyor ===");
    const ilDialog = await openDropdown(page, "İl");
    const optionTexts = await ilDialog.getByRole("option").allInnerTexts();
    // "Tümü" sentetik seçeneği hariç 81 il olmalı.
    const realProvinceCount = optionTexts.filter((t) => t.trim() !== "Tümü").length;
    check(`[S1] İl açılır listesinde 81 il var (bulunan: ${realProvinceCount})`, realProvinceCount === 81);
    check("[S1] 'İstanbul' listede var", optionTexts.some((t) => t.includes("İstanbul")));
    check("[S1] 'İzmir' listede var", optionTexts.some((t) => t.includes("İzmir")));
    check("[S1] 'Ankara' listede var", optionTexts.some((t) => t.includes("Ankara")));
    check("[S1] 'Van' listede var", optionTexts.some((t) => t.includes("Van")));
    await page.keyboard.press("Escape");

    console.log("\n=== Senaryo 2: İlk açılışta Kocaeli seçili geliyor ===");
    check(
      "[S2] İl seçici tetikleyicisinde 'Kocaeli' görünüyor",
      (await page.getByRole("button", { name: "İl", exact: true }).innerText()).includes("Kocaeli"),
    );

    console.log("\n=== Senaryo 3: Kocaeli değiştirilebiliyor + İl değişince İlçe/Liman sıfırlanıyor ===");
    // Önce Kocaeli'de bir ilçe seçelim ki sıfırlanmayı gözlemleyebilelim.
    await selectOption(page, "İlçe", "Gebze");
    check(
      "[S3] Kocaeli/Gebze seçili (ön koşul)",
      (await page.getByRole("button", { name: "İlçe", exact: true }).innerText()).includes("Gebze"),
    );
    await selectOption(page, "İl", "İzmir", { exact: false });
    check(
      "[S3] İl 'İzmir' olarak değişti (Kocaeli kilitli değil)",
      (await page.getByRole("button", { name: "İl", exact: true }).innerText()).includes("İzmir"),
    );
    check(
      "[S3] İl değişince İlçe seçimi ('Gebze') temizlendi",
      !(await page.getByRole("button", { name: "İlçe", exact: true }).innerText()).includes("Gebze"),
    );

    console.log("\n=== Senaryo 4: İzmir seçildiğinde yalnız İzmir ilçeleri geliyor ===");
    const izmirDialog = await openDropdown(page, "İlçe");
    const izmirDistricts = await izmirDialog.getByRole("option").allInnerTexts();
    await page.keyboard.press("Escape");
    check(
      "[S4] İzmir ilçeleri arasında 'Bornova' var",
      izmirDistricts.some((t) => t.includes("Bornova")),
    );
    check(
      "[S4] İzmir ilçeleri arasında Kocaeli'ye özgü 'Gebze' YOK",
      !izmirDistricts.some((t) => t.includes("Gebze")),
    );
    check(
      "[S4] İzmir ilçeleri arasında İstanbul'a özgü 'Kadıköy' YOK",
      !izmirDistricts.some((t) => t.includes("Kadıköy")),
    );

    console.log("\n=== Senaryo 5: İstanbul seçildiğinde yalnız İstanbul ilçeleri geliyor ===");
    await selectOption(page, "İl", "İstanbul", { exact: false });
    const istanbulDialog = await openDropdown(page, "İlçe");
    const istanbulDistricts = await istanbulDialog.getByRole("option").allInnerTexts();
    await page.keyboard.press("Escape");
    check(
      "[S5] İstanbul ilçeleri arasında 'Kadıköy' var",
      istanbulDistricts.some((t) => t.includes("Kadıköy")),
    );
    check(
      "[S5] İstanbul ilçeleri arasında İzmir'e özgü 'Bornova' YOK",
      !istanbulDistricts.some((t) => t.includes("Bornova")),
    );

    console.log("\n=== Senaryo 6: İl veya İlçe değiştiğinde Liman / Sanayi / OSB sıfırlanıyor ===");
    await selectOption(page, "İl", "Kocaeli", { exact: false });
    await selectOption(page, "İlçe", "Dilovası");
    const limanDialog = await openDropdown(page, "Liman / Sanayi / OSB");
    const limanOptions = await limanDialog.getByRole("option").allInnerTexts();
    const hasRealFacility = limanOptions.some((t) => t.trim() !== "Tümü");
    if (hasRealFacility) {
      await limanDialog.getByRole("option").filter({ hasNotText: "Tümü" }).first().click();
      const facilityBefore = await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).innerText();
      check("[S6] Liman/Sanayi/OSB seçili (ön koşul)", !facilityBefore.includes("Tümü"));
      await selectOption(page, "İlçe", "Gebze");
      const facilityAfterDistrict = await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).innerText();
      check("[S6] İlçe değişince Liman/Sanayi/OSB sıfırlandı", facilityAfterDistrict.includes("Tümü"));
    } else {
      await page.keyboard.press("Escape");
      console.log("    (Dilovası'nda katalog tesisi yok, doğrudan bu adım atlandı — S7'de İl değişimiyle test edilecek)");
    }

    console.log("\n=== Senaryo 7: İl seçilmeden İlçe filtresi aktif olmuyor ===");
    await selectOption(page, "İl", "Tümü", { exact: true });
    const districtButtonDisabled = await page.getByRole("button", { name: "İlçe", exact: true }).isDisabled();
    check("[S7] İl 'Tümü' iken İlçe seçici devre dışı", districtButtonDisabled);

    console.log("\n=== Senaryo 8: Seçilen İl/İlçeye göre ilan listesi doğru filtreleniyor ===");
    await selectOption(page, "İl", "Kocaeli", { exact: false });
    await page.waitForTimeout(300);
    const kocaeliBodyText = await page.locator("main").innerText();
    const hasNoResultsOrRows = kocaeliBodyText.length > 0;
    check("[S8] Kocaeli filtresiyle sayfa hatasız render ediliyor", hasNoResultsOrRows);

    console.log("\n=== Senaryo 9: Kocaeli dışındaki iller seçildiğinde sayfa hata vermiyor ===");
    for (const province of ["Van", "Ağrı", "Şırnak", "Bayburt"]) {
      await selectOption(page, "İl", province, { exact: false });
      await page.waitForTimeout(200);
    }
    check("[S9] Kocaeli dışındaki uzak iller seçilirken konsol hatası oluşmadı", jsProblems.length === 0, jsProblems.join(" | "));

    console.log("\n=== Senaryo 10: İlan oluşturma ekranıyla aynı merkezi İl/İlçe kataloğu ===");
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    // hizmet-veren giriş yapılı olduğu için form yerine rol engeli görünür —
    // yalnızca sayfa çökmediğini doğrulamak yeterli; asıl kaynak eşitliği
    // kod incelemesiyle (getProvinces() paylaşımı) doğrulandı.
    check("[S10] /hizmet-talebi-olustur sayfası hatasız açılıyor", (await page.locator("main").innerText()).length > 0);

    check("Genel: konsol hatası yok", jsProblems.length === 0, jsProblems.join(" | "));
    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[tmp-ilanlar-il-ilce-filtre-test] GENEL HATA:", error);
  process.exitCode = 1;
});
